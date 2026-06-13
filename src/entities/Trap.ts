import Phaser from 'phaser';
import { getTriggersFor, playOneShot } from '../audio';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey, getEntityTrap } from './entityRegistryLoader';

/**
 * Trap — the hazard entity, hosting three distinct trigger/damage machines.
 *
 * One class covers passive damage-on-overlap traps (spikes), directContact snap
 * traps (the bear trap), trigger-driven ejector traps (smoke/flame, shocker,
 * spike ejector), and the one-off swaying-sword fixture. Which machine runs is
 * resolved at construction from the LDtk identifier + the registry trap block.
 * Damage is gated, not automatic: snap/ejector traps defer the hit to a midpoint
 * animation frame (TRAP_DAMAGE_FRAME_EVENT) so a victim who escapes the danger
 * zone before that frame is spared, while the "directly above" / side-of-trap
 * geometry that decides *who* gets hit is computed in GameScene, not here.
 *
 * Inputs:  scene, spawn x/y, LDtk identifier; per-frame trigger booleans and a
 *          grounded-tile flag pushed in by GameScene's trap update.
 * Outputs: drives its own animation + Arcade gravity (falling sword), plays
 *          trigger-keyed one-shots, and emits TRAP_DAMAGE_FRAME_EVENT.
 * @calledby the gameplay scene — spawned at level load, then ticked each frame
 *           with the trigger state the scene computes per trap kind.
 * @calls    the shared audio one-shot player, the registry/animation helpers,
 *           and the Arcade body for the swaying sword's fall.
 */

// bear trap waits this long before re-arming
const TRAP_REARM_DELAY_MS = 800;

// which spatial trigger condition this ejector uses
export type EjectorKind = 'overhead' | 'attached-ground';

// Per-identifier ejector tuning: trailing cycle count, damage frame, and optional
// per-side directional damage frames for ejectors that fire left then right.
const EJECTOR_BY_IDENTIFIER: Record<
  string,
  {
    readonly kind: EjectorKind;
    readonly trailingCycles: number;
    readonly damageFrame?: number;
    // left/right damage frames for ejectors that fire in both directions (e.g. shocker)
    readonly directionalDamageFrames?: {
      readonly left: number;
      readonly right: number;
    };
  }
> = {
  Smoke_flame_ejector_red_spawn: { kind: 'overhead', trailingCycles: 0 },
  Shocker_ejector_spawn: {
    kind: 'overhead',
    trailingCycles: 0,
    directionalDamageFrames: { left: 5, right: 12 },
  },
  Spike_ejector_spawn: {
    kind: 'attached-ground',
    trailingCycles: 2,
    damageFrame: 4,
  },
};

// fired when a snap/ejector reaches its damage frame; GameScene damages whoever
// is still in the zone — escape before the frame and you avoid the hit
export const TRAP_DAMAGE_FRAME_EVENT = 'trap-damage-frame';

// side tag on TRAP_DAMAGE_FRAME_EVENT for directional ejectors; undefined for omnidirectional traps
export type TrapDamageSide = 'left' | 'right';

// the ceiling-hung sword, which runs its own idle→snapping→falling→embedded machine
const SWAYING_SWORD_IDENTIFIER = 'Swaying_sword_spawn';
const SWAYING_SWORD_ANIM_SNAP = 'swaying_sword_animation2';
const SWAYING_SWORD_ANIM_FALL = 'swaying_sword_animation3';
const SWAYING_SWORD_ANIM_EMBED = 'swaying_sword_animation4';

export type SwayingSwordState = 'idle' | 'snapping' | 'falling' | 'embedded';

export class Trap extends AnimatedEntity {
  private readonly damage: number;
  private readonly directContactAnimation: string | null;
  private readonly snapFullAnimKey: string | null;
  private directContactTriggered = false;
  private rearmTimer: Phaser.Time.TimerEvent | null = null;
  // set each frame by GameScene; drives the next-cycle decision on completion
  private triggerActive = false;
  // true while the current ejector cycle is still playing
  private cycleInProgress = false;
  // decremented each time a post-release cycle completes
  private trailingCyclesRemaining = 0;
  private readonly ejectorKind: EjectorKind | null;
  private readonly trailingCycleCount: number;
  // cached so onAnimComplete can recognise its own completion vs. others
  private readonly cycleFullAnimKey: string | null;
  // the anim whose midpoint frame fires the damage event (snap or eject cycle)
  private readonly damagingAnimFullKey: string | null;
  private readonly damageFrameIndex: number;
  // once-per-cycle guard so TRAP_DAMAGE_FRAME emits at most once per cycle
  private damageFrameFired = false;
  // directional damage frames for ejectors that fire left then right (e.g. shocker)
  private readonly directionalDamageFrames: {
    readonly left: number;
    readonly right: number;
  } | null;
  // once-per-cycle guards for the two directional damage emissions
  private leftDamageFired = false;
  private rightDamageFired = false;
  // dedup set so per-frame ANIMATION_UPDATE doesn't re-fire the same sound
  private readonly firedTriggers = new Set<string>();
  // swaying-sword state machine; null on non-sword traps
  private swayingSwordState: SwayingSwordState | null;
  // cached full key for the snap anim so onAnimComplete can route by key
  private readonly swayingSwordSnapKey: string | null;
  // original ceiling position; needed to reset the sword when the player leaves the level
  private readonly spawnX: number;
  private readonly spawnY: number;
  // virtual damage zone for ejectors so the physics body can stay small (device-sized)
  // while the hazard reach still covers the player
  private readonly damageZoneConfig: {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null;

  // build a trap from its LDtk identifier, selecting the right damage machine
  constructor(scene: Phaser.Scene, x: number, y: number, identifier: string) {
    super(scene, x, y, identifier);
    const trap = getEntityTrap(identifier);
    if (!trap) {
      throw new Error(
        `Trap: identifier "${identifier}" has no trap block — should have been spawned as AnimatedEntity`,
      );
    }
    this.spawnX = x;
    this.spawnY = y;
    this.damage = trap.damage;
    this.directContactAnimation = trap.directContactAnimation ?? null;
    this.damageZoneConfig = trap.damageZone ?? null;
    this.snapFullAnimKey =
      this.directContactAnimation == null
        ? null
        : entityAnimFullKey(identifier, this.directContactAnimation);
    const ejectorConfig = EJECTOR_BY_IDENTIFIER[identifier];
    this.ejectorKind = ejectorConfig?.kind ?? null;
    this.trailingCycleCount = ejectorConfig?.trailingCycles ?? 0;
    this.cycleFullAnimKey =
      this.ejectorKind != null
        ? entityAnimFullKey(identifier, this.config.defaultAnimation)
        : null;
    this.directionalDamageFrames = ejectorConfig?.directionalDamageFrames ?? null;
    if (identifier === SWAYING_SWORD_IDENTIFIER) {
      this.swayingSwordState = 'idle';
      this.swayingSwordSnapKey = entityAnimFullKey(
        identifier,
        SWAYING_SWORD_ANIM_SNAP,
      );
    } else {
      this.swayingSwordState = null;
      this.swayingSwordSnapKey = null;
    }
    // snap wins over ejector cycle if somehow both are defined
    if (this.directContactAnimation != null && this.snapFullAnimKey != null) {
      const snapAnim = this.config.animations[this.directContactAnimation];
      this.damagingAnimFullKey = this.snapFullAnimKey;
      this.damageFrameIndex = Math.floor(snapAnim.frameCount / 2);
    } else if (this.ejectorKind != null && this.cycleFullAnimKey != null) {
      const cycleAnim = this.config.animations[this.config.defaultAnimation];
      this.damagingAnimFullKey = this.cycleFullAnimKey;
      this.damageFrameIndex =
        ejectorConfig?.damageFrame ?? Math.floor(cycleAnim.frameCount / 2);
    } else {
      this.damagingAnimFullKey = null;
      this.damageFrameIndex = 0;
    }

    this.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.onAnimComplete,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimUpdate,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_START,
      this.onAnimStart,
      this,
    );
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.rearmTimer) {
        this.rearmTimer.remove(false);
        this.rearmTimer = null;
      }
    });

    if (this.ejectorKind != null) {
      // park on frame 0 (closed/no-flame pose) until the player enters the trigger zone
      this.anims.stop();
      this.setFrame(0);
    }
  }

  // Damage this trap deals per hit (registry-configured).
  getDamage(): number {
    return this.damage;
  }

  // True iff this is a snap trap; gates the scene's snap-and-damage body check.
  hasDirectContactAnimation(): boolean {
    return this.directContactAnimation !== null;
  }

  // True iff armed and able to snap; a triggered snap trap stays spent until
  // its re-arm timer resets it.
  isArmed(): boolean {
    return !this.directContactTriggered;
  }

  // True iff damage is deferred to the midpoint frame (snap/ejector) rather than
  // dealt on every overlap tick; one gated hit per cycle, not continuous.
  hasDeferredDamage(): boolean {
    return this.damagingAnimFullKey !== null;
  }

  // fire the snap animation; damage hits at the midpoint frame, so escaping before it avoids the hit
  triggerDirectContact(): void {
    if (this.directContactTriggered) return;
    if (!this.directContactAnimation) return;
    this.directContactTriggered = true;
    this.damageFrameFired = false;
    this.leftDamageFired = false;
    this.rightDamageFired = false;
    this.playLogical(this.directContactAnimation);
  }

  // Ejector kind (overhead / attached-ground), or null for non-ejectors; the
  // scene uses it to pick the per-frame trigger condition.
  getEjectorKind(): EjectorKind | null {
    return this.ejectorKind;
  }

  // virtual damage zone rect in world space for ejectors; null means fall back to the physics body
  getDamageZoneBounds(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    centerX: number;
    centerY: number;
  } | null {
    if (this.damageZoneConfig == null) return null;
    const centerX = this.body.center.x + this.damageZoneConfig.offsetX;
    const centerY = this.body.center.y + this.damageZoneConfig.offsetY;
    const halfW = this.damageZoneConfig.width / 2;
    const halfH = this.damageZoneConfig.height / 2;
    return {
      left: centerX - halfW,
      right: centerX + halfW,
      top: centerY - halfH,
      bottom: centerY + halfH,
      centerX,
      centerY,
    };
  }

  // Current swaying-sword state, or null if this trap is not a swaying sword;
  // gates the scene's "player passes under" and fall→embedded checks.
  getSwayingSwordState(): SwayingSwordState | null {
    return this.swayingSwordState;
  }

  // Original spawn position — the scene resolves the sword's owning LDtk level
  // from this, since the blade's live x/y change once it falls and embeds.
  getSpawnX(): number {
    return this.spawnX;
  }

  // See getSpawnX — the original spawn y.
  getSpawnY(): number {
    return this.spawnY;
  }

  // start the sword falling; no-op unless idle so loitering under it can't restart the snap
  triggerSwayingSword(): void {
    if (this.swayingSwordState !== 'idle') return;
    this.swayingSwordState = 'snapping';
    this.playLogical(SWAYING_SWORD_ANIM_SNAP);
  }

  // embed the blade when solid terrain is beneath it; no-op in all other states
  tickSwayingSwordFall(onSolidTerrain: boolean): void {
    if (this.swayingSwordState !== 'falling') return;
    if (!onSolidTerrain) return;
    this.swayingSwordState = 'embedded';
    this.body.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.playLogical(SWAYING_SWORD_ANIM_EMBED);
  }

  // True iff dangerous as an in-air falling sword; the scene then inverts the
  // usual "victim above trap" gate, since the blade damages everything below it.
  isFallingSword(): boolean {
    return this.swayingSwordState === 'falling';
  }

  // restore the embedded sword to its ceiling spawn so a returning player finds it fresh
  resetSwayingSword(): void {
    if (this.swayingSwordState === null) return;
    if (this.swayingSwordState === 'idle') return;
    this.swayingSwordState = 'idle';
    this.body.setAllowGravity(false);
    this.body.setVelocity(0, 0);
    this.setPosition(this.spawnX, this.spawnY);
    this.body.reset(this.spawnX, this.spawnY);
    this.playLogical(this.config.defaultAnimation);
  }

  // push the per-frame trigger state; starts/chains cycles and arms the trailing-cycle tail
  setTriggered(active: boolean): void {
    if (this.ejectorKind == null) return;
    const wasActive = this.triggerActive;
    this.triggerActive = active;
    if (active) {
      // re-entry during the trailing window cancels the countdown (resume looping)
      this.trailingCyclesRemaining = 0;
      if (!this.cycleInProgress) {
        this.startCycle();
      }
    } else if (wasActive) {
      this.trailingCyclesRemaining = this.trailingCycleCount;
      // defensive: release with no cycle running — kick off the first trailing cycle
      if (!this.cycleInProgress && this.trailingCyclesRemaining > 0) {
        this.trailingCyclesRemaining--;
        this.startCycle();
      }
    }
  }

  // play one ejector cycle as a one-shot so ANIMATION_COMPLETE fires and the machine can decide to continue
  private startCycle(): void {
    if (this.cycleFullAnimKey == null) return;
    this.cycleInProgress = true;
    this.damageFrameFired = false;
    this.leftDamageFired = false;
    this.rightDamageFired = false;
    this.play({ key: this.cycleFullAnimKey, repeat: 0 });
  }

  // drive frame-keyed audio then emit the damage event when the damage frame is reached
  private onAnimUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    this.fireFrameTriggers(animation, frame);

    if (this.damagingAnimFullKey == null) return;
    if (animation.key !== this.damagingAnimFullKey) return;

    if (this.directionalDamageFrames !== null) {
      if (
        !this.leftDamageFired &&
        frame.index >= this.directionalDamageFrames.left
      ) {
        this.leftDamageFired = true;
        this.emit(TRAP_DAMAGE_FRAME_EVENT, this, 'left');
      }
      if (
        !this.rightDamageFired &&
        frame.index >= this.directionalDamageFrames.right
      ) {
        this.rightDamageFired = true;
        this.emit(TRAP_DAMAGE_FRAME_EVENT, this, 'right');
      }
      return;
    }

    if (this.damageFrameFired) return;
    if (frame.index < this.damageFrameIndex) return;
    this.damageFrameFired = true;
    this.emit(TRAP_DAMAGE_FRAME_EVENT, this);
  }

  // clear the fired-trigger set and fire frame-0 audio (single-frame anims never get UPDATE)
  private onAnimStart(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    this.firedTriggers.clear();
    this.fireFrameTriggers(animation, frame);
  }

  // play any audio triggers registered for the current frame, deduped per play
  private fireFrameTriggers(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    const triggers = getTriggersFor(animation.key);
    for (const trigger of triggers) {
      if (frame.index < trigger.frameIndex) continue;
      const fireKey = `${animation.key}:${trigger.name}`;
      if (this.firedTriggers.has(fireKey)) continue;
      const seekSec = trigger.audioStartOffsetMs
        ? trigger.audioStartOffsetMs / 1000
        : 0;
      playOneShot(this.scene, trigger.soundId, seekSec, this);
      this.firedTriggers.add(fireKey);
    }
  }

  // route animation-complete by machine: sword snap→falling, snap→rearm, ejector→chain or park
  private onAnimComplete(animation: Phaser.Animations.Animation): void {
    if (
      this.swayingSwordState === 'snapping' &&
      this.swayingSwordSnapKey != null &&
      animation.key === this.swayingSwordSnapKey
    ) {
      this.swayingSwordState = 'falling';
      this.body.setAllowGravity(true);
      this.playLogical(SWAYING_SWORD_ANIM_FALL);
      return;
    }

    if (
      this.snapFullAnimKey != null &&
      animation.key === this.snapFullAnimKey &&
      this.directContactTriggered
    ) {
      if (this.rearmTimer) {
        this.rearmTimer.remove(false);
      }
      this.rearmTimer = this.scene.time.delayedCall(
        TRAP_REARM_DELAY_MS,
        () => {
          this.rearmTimer = null;
          this.directContactTriggered = false;
          this.playLogical(this.config.defaultAnimation);
        },
      );
      return;
    }

    if (
      this.cycleFullAnimKey != null &&
      animation.key === this.cycleFullAnimKey
    ) {
      this.cycleInProgress = false;
      if (this.triggerActive) {
        this.startCycle(); // still triggered — keep firing while they linger
      } else if (this.trailingCyclesRemaining > 0) {
        this.trailingCyclesRemaining--;
        this.startCycle(); // player left, trailing cycles still owed
      } else {
        // released and trailing budget spent — park on frame 0 (idle pose)
        this.anims.stop();
        this.setFrame(0);
      }
    }
  }
}
