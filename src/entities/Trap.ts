import Phaser from 'phaser';
import { getTriggersFor, playOneShot } from '../audio';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey, getEntityTrap } from './entityRegistryLoader';

/**
 * @file entities/Trap.ts
 * @description Hazard entity hosting three damage machines — passive spike overlap, directContact snap traps, trigger-driven ejectors (smoke/flame, shocker, spike ejector), plus the one-off swaying sword; which machine runs is resolved at construction from the LDtk identifier and registry trap block. Snap/ejector damage is gated to a midpoint frame (TRAP_DAMAGE_FRAME_EVENT); the "directly above"/side geometry that decides who gets hit is computed in GameScene.
 * @module entities
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

  /**
   * @function    constructor
   * @description Build a trap from its LDtk identifier — resolve the registry trap block, select the damage machine (snap, ejector, or swaying sword) and its damage-frame index, wire the anim-event hooks, and park ejectors on frame 0 until triggered.
   * @param   scene       Owning Phaser scene.
   * @param   x, y        Spawn position (world px).
   * @param   identifier  LDtk identifier whose registry trap block configures the machine.
   * @calledby src/entities/EntityFactory.ts → trap spawning when a registry entry has a trap block
   * @calls    the AnimatedEntity base setup, the registry trap lookup, the anim-key builder, and the Phaser animation/destroy hooks; throws if the identifier has no trap block
   */
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

  /** Damage this trap deals per hit (registry-configured). */
  getDamage(): number {
    return this.damage;
  }

  /** True iff this is a snap trap; gates the scene's snap-and-damage body check. */
  hasDirectContactAnimation(): boolean {
    return this.directContactAnimation !== null;
  }

  /** True iff armed and able to snap; a triggered snap trap stays spent until its re-arm timer resets it. */
  isArmed(): boolean {
    return !this.directContactTriggered;
  }

  /** True iff damage is deferred to the midpoint frame (snap/ejector) — one gated hit per cycle, not continuous. */
  hasDeferredDamage(): boolean {
    return this.damagingAnimFullKey !== null;
  }

  /**
   * @function    triggerDirectContact
   * @description Fire the snap animation; damage hits at the midpoint frame, so escaping before it avoids the hit. No-op if already triggered or if this trap has no direct-contact animation.
   * @calledby src/scenes/trapSystem.ts → onPlayerHitsTrap / onEnemyHitsTrap, when an armed snap trap makes direct contact
   * @calls    src/entities/AnimatedEntity.ts → playLogical
   */
  triggerDirectContact(): void {
    if (this.directContactTriggered) return;
    if (!this.directContactAnimation) return;
    this.directContactTriggered = true;
    this.damageFrameFired = false;
    this.leftDamageFired = false;
    this.rightDamageFired = false;
    this.playLogical(this.directContactAnimation);
  }

  /** Ejector kind (overhead / attached-ground), or null for non-ejectors; the scene uses it to pick the per-frame trigger condition. */
  getEjectorKind(): EjectorKind | null {
    return this.ejectorKind;
  }

  /**
   * @function    getDamageZoneBounds
   * @description Virtual damage-zone rect in world space for ejectors, letting the physics body stay small while the hazard reach still covers the player; null means fall back to the physics body.
   * @returns a left/right/top/bottom/center rect, or null when no zone is set.
   * @calledby src/scenes/trapSystem.ts → update and isInTrapDamageZone, testing whether a victim is in the hazard reach
   * @calls    the Arcade body center only
   */
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

  /** Current swaying-sword state, or null if this trap is not a swaying sword; gates the scene's pass-under and fall→embedded checks. */
  getSwayingSwordState(): SwayingSwordState | null {
    return this.swayingSwordState;
  }

  /** Original spawn X — the scene resolves the sword's owning LDtk level from this, since the blade's live x/y change once it falls and embeds. */
  getSpawnX(): number {
    return this.spawnX;
  }

  /** Original spawn Y (see getSpawnX). */
  getSpawnY(): number {
    return this.spawnY;
  }

  /**
   * @function    triggerSwayingSword
   * @description Start the sword falling; no-op unless idle so loitering under it can't restart the snap.
   * @calledby src/scenes/trapSystem.ts → update, when the player passes under an idle swaying sword
   * @calls    src/entities/AnimatedEntity.ts → playLogical
   */
  triggerSwayingSword(): void {
    if (this.swayingSwordState !== 'idle') return;
    this.swayingSwordState = 'snapping';
    this.playLogical(SWAYING_SWORD_ANIM_SNAP);
  }

  /**
   * @function    tickSwayingSwordFall
   * @description Embed the blade when solid terrain is beneath it; no-op in any state other than falling.
   * @param   onSolidTerrain  True when ground is detected under the blade.
   * @calledby src/scenes/trapSystem.ts → update, while a sword is falling
   * @calls    the Arcade body setters and src/entities/AnimatedEntity.ts → playLogical
   */
  tickSwayingSwordFall(onSolidTerrain: boolean): void {
    if (this.swayingSwordState !== 'falling') return;
    if (!onSolidTerrain) return;
    this.swayingSwordState = 'embedded';
    this.body.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.playLogical(SWAYING_SWORD_ANIM_EMBED);
  }

  /** True iff dangerous as an in-air falling sword; the scene then inverts the usual "victim above trap" gate, since the blade damages everything below it. */
  isFallingSword(): boolean {
    return this.swayingSwordState === 'falling';
  }

  /**
   * @function    resetSwayingSword
   * @description Restore a fallen/embedded sword to its ceiling spawn so a returning player finds it fresh; no-op if already idle or if this trap is not a swaying sword.
   * @calledby src/scenes/trapSystem.ts → update, when the player leaves the sword's level
   * @calls    the Arcade body reset/setters and src/entities/AnimatedEntity.ts → playLogical
   */
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

  /**
   * @function    setTriggered
   * @description Push the per-frame trigger state for an ejector; entering the zone starts/keeps cycles looping, leaving it arms the trailing-cycle tail. No-op on non-ejector traps.
   * @param   active  True while the player is inside the trigger zone.
   * @calledby src/scenes/trapSystem.ts → update, with the computed trigger state
   * @calls    src/entities/Trap.ts → startCycle
   */
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

  /**
   * @function    startCycle
   * @description Play one ejector cycle as a one-shot (repeat 0) so ANIMATION_COMPLETE fires and the machine can decide whether to continue; resets the per-cycle damage guards. No-op without a cycle anim key.
   * @calledby src/entities/Trap.ts → setTriggered (zone entry) and onAnimComplete (chain/trailing logic)
   * @calls    the Phaser sprite animation play
   */
  private startCycle(): void {
    if (this.cycleFullAnimKey == null) return;
    this.cycleInProgress = true;
    this.damageFrameFired = false;
    this.leftDamageFired = false;
    this.rightDamageFired = false;
    this.play({ key: this.cycleFullAnimKey, repeat: 0 });
  }

  /**
   * @function    onAnimUpdate
   * @description Drive frame-keyed audio, then emit the damage event when the damaging anim reaches its damage frame — once per cycle for an omnidirectional trap, or once each for the left/right frames of a directional ejector.
   * @param   animation  The playing animation.
   * @param   frame      Its current frame.
   * @calledby Phaser ANIMATION_UPDATE event (registered in the constructor)
   * @calls    src/entities/Trap.ts → fireFrameTriggers and the entity event emitter (TRAP_DAMAGE_FRAME_EVENT)
   */
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

  /**
   * @function    onAnimStart
   * @description Clear the fired-trigger dedupe set and fire any frame-0 audio, covering single-frame anims that never emit ANIMATION_UPDATE.
   * @param   animation  The starting animation.
   * @param   frame      Its first frame.
   * @calledby Phaser ANIMATION_START event (registered in the constructor)
   * @calls    src/entities/Trap.ts → fireFrameTriggers
   */
  private onAnimStart(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    this.firedTriggers.clear();
    this.fireFrameTriggers(animation, frame);
  }

  /**
   * @function    fireFrameTriggers
   * @description Play any audio triggers registered for the current frame, deduped per play so a held frame doesn't re-fire the same sound.
   * @param   animation  The playing animation.
   * @param   frame      Its current frame.
   * @calledby src/entities/Trap.ts → onAnimStart and onAnimUpdate, each frame
   * @calls    src/audio → getTriggersFor and playOneShot
   */
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

  /**
   * @function    onAnimComplete
   * @description Route an animation-complete by machine: a sword snap advances to falling (gravity on), a snap trap schedules its re-arm timer, and an ejector either chains another cycle (still triggered or trailing) or parks on frame 0.
   * @param   animation  The animation that just completed.
   * @calledby Phaser ANIMATION_COMPLETE event (registered in the constructor)
   * @calls    the Arcade body, src/entities/AnimatedEntity.ts → playLogical, src/entities/Trap.ts → startCycle, and the scene's delayed-call timer for the snap re-arm
   */
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
