import Phaser from 'phaser';
import { getTriggersFor, playOneShot } from '../audio';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey, getEntityTrap } from './entityRegistryLoader';

// Wall-clock pause after the bear trap's snap animation finishes before it
// re-arms and switches back to the idle/armed loop. Gives the snap a
// visible "settled" beat so the player sees the trap as triggered before
// it's ready to bite again.
const TRAP_REARM_DELAY_MS = 800;

// Trigger style for ejector-class traps. 'overhead' fires while the player
// is in the airspace above the body (smoke/flame ejector). 'attached-ground'
// fires while the player is standing on the specific tile beneath the body
// (spike ejector). Trigger condition itself is computed in GameScene; the
// trap only stores the active boolean and drives cycle bookkeeping.
export type EjectorKind = 'overhead' | 'attached-ground';

// Per-identifier ejector behavior.
//   `trailingCycles`: full cycles to play after the trigger releases.
//     Overhead ejectors snap straight back to idle (0); attached-ground
//     (spike) ejectors play 2 trailing cycles for a "windup releases" feel.
//   `damageFrame`: 0-based frame index within the cycle animation at which
//     TRAP_DAMAGE_FRAME fires. If omitted, the animation midpoint is used —
//     fine for symmetric extend/retract cycles. Spike ejector extends early
//     in its 18-frame sheet, so it overrides to frame 4.
const EJECTOR_BY_IDENTIFIER: Record<
  string,
  {
    readonly kind: EjectorKind;
    readonly trailingCycles: number;
    readonly damageFrame?: number;
    // Side-specific damage frames for traps that fire in opposite horizontal
    // directions across the cycle (e.g. the shocker zaps left, then right).
    // When set, replaces the single `damageFrame` — the trap emits one
    // damage event per side, payload-tagged so GameScene can gate damage to
    // victims on the matching side of the trap. Mutually exclusive with
    // `damageFrame`; if both are set, directional wins.
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

// Custom event emitted by snap/ejector traps when their damaging animation
// crosses its midpoint frame. GameScene listens and applies damage to any
// victim currently overlapping the trap's body — that's how a player can
// jump off a bear trap mid-snap (or out of an ejector's column mid-cycle)
// and avoid the hit. Subscribers get the trap that fired as the first arg,
// followed by an optional side tag ('left' | 'right') for directional
// ejectors (the shocker fires twice per cycle, once per side).
export const TRAP_DAMAGE_FRAME_EVENT = 'trap-damage-frame';

// Side tag passed to TRAP_DAMAGE_FRAME_EVENT subscribers for directional
// ejectors. Undefined for omnidirectional traps (snap + non-directional
// ejectors), where the damage zone alone decides who gets hit.
export type TrapDamageSide = 'left' | 'right';

// LDtk identifier for the ceiling-hung sword. Drives a separate state machine
// in Trap (idle → snapping → falling → embedded) rather than ejector/snap
// semantics: the trigger fires when the player passes UNDER the sword, the
// string visibly snaps, the sword falls via Arcade gravity, and it embeds
// in the floor on landing. Single fixture for now, so identifier-matching
// is cleaner than adding registry plumbing for a one-off behavior.
const SWAYING_SWORD_IDENTIFIER = 'Swaying_sword_spawn';
const SWAYING_SWORD_ANIM_SNAP = 'swaying_sword_animation2';
const SWAYING_SWORD_ANIM_FALL = 'swaying_sword_animation3';
const SWAYING_SWORD_ANIM_EMBED = 'swaying_sword_animation4';

export type SwayingSwordState = 'idle' | 'snapping' | 'falling' | 'embedded';

// Passive damage source. The trap plays its looping animation in place and
// damages on body overlap. The "directly above" semantics are enforced in
// GameScene's overlap handlers by comparing centers — the victim's body
// center must sit above the trap's body center for damage to apply, so
// walking past a side-mounted trap doesn't tick damage.
//
// Re-tick cadence is handled by the victim's own invuln/hurt window rather
// than a per-trap timer: standing on spikes ticks at PLAYER_INVULN_MS for
// the player, and at the enemy's hurt-state duration for enemies.
//
// Traps with `directContactAnimation` (e.g. the bear trap) swap to that
// animation only when something makes direct ground-contact — stepping
// directly onto the trap from above, not when jumping through the airspace
// above it. The swap is one-shot per arming cycle; after the snap anim
// completes plus TRAP_REARM_DELAY_MS, the trap re-arms by switching back
// to its default animation and accepting a fresh trigger.
//
// Damage on snap traps is also gated by the directContact check — overlap
// alone doesn't hurt the victim, only a clean "landed on it" contact does.
// That keeps a player jumping through the airspace above a bear trap from
// silently taking damage.
export class Trap extends AnimatedEntity {
  private readonly damage: number;
  private readonly directContactAnimation: string | null;
  private readonly snapFullAnimKey: string | null;
  private directContactTriggered = false;
  private rearmTimer: Phaser.Time.TimerEvent | null = null;
  // Per-frame "is the player currently in the trigger zone?" signal updated
  // by GameScene.updateTraps. Definition of "in the trigger zone" depends on
  // ejectorKind ('overhead' = in the column above; 'attached-ground' =
  // standing on the tile beneath). Drives the next-cycle decision when the
  // current cycle completes: replay while the player is still triggering,
  // run trailing cycles after release, park on frame 0 when fully done.
  private triggerActive = false;
  // True between "cycle started" and "cycle's ANIMATION_COMPLETE fired".
  // While set, a fresh trigger does NOT restart the animation — the cycle in
  // progress is allowed to finish, even if the player has been knocked out
  // of the trigger zone mid-cycle.
  private cycleInProgress = false;
  // Trailing-cycle counter: decremented each time a post-release cycle
  // completes. Set to trailingCycleCount when the trigger releases. While
  // > 0, onAnimComplete chains another cycle even with triggerActive=false.
  private trailingCyclesRemaining = 0;
  // Ejector behavior for this trap, or null for non-ejector (passive / snap)
  // traps. Identifier-derived so non-ejector traps keep their normal
  // looping behavior without per-entity registry plumbing.
  private readonly ejectorKind: EjectorKind | null;
  // Number of full cycles to play after the trigger releases. 0 for overhead
  // (instant return to idle), 2 for attached-ground (windup-tail feel).
  private readonly trailingCycleCount: number;
  // Cached full key for the cycling animation, used by onAnimComplete to
  // recognise its own completion event vs. unrelated animation completes
  // (e.g. the bear-trap snap on a different trap subclass instance).
  private readonly cycleFullAnimKey: string | null;
  // Animation whose midpoint frame fires the TRAP_DAMAGE_FRAME event.
  // Set for snap traps (the snap animation) and ejector traps (the
  // eject/cycle animation). Null for passive traps that damage on every
  // overlap tick — those keep their previous immediate-damage semantics.
  private readonly damagingAnimFullKey: string | null;
  // 0-based frame index within damagingAnimFullKey at which the damage
  // event fires — conventionally the animation's midpoint so the visual
  // telegraphs the danger and the victim has time to escape before the hit.
  private readonly damageFrameIndex: number;
  // Per-cycle guard so TRAP_DAMAGE_FRAME emits at most once per snap/cycle
  // even though ANIMATION_UPDATE fires for every frame transition. Reset
  // each time a new cycle starts (triggerDirectContact, startCycle).
  private damageFrameFired = false;
  // Directional damage frames for ejectors that fire in opposite directions
  // across the cycle (e.g. shocker — left at one frame, right at another).
  // Null for omnidirectional traps; when set, `damageFrameIndex` is unused
  // and the per-side `*DamageFired` flags drive the once-per-cycle emit.
  private readonly directionalDamageFrames: {
    readonly left: number;
    readonly right: number;
  } | null;
  // Per-cycle guards for the left/right damage emissions. Reset alongside
  // damageFrameFired in startCycle / triggerDirectContact so each cycle
  // starts with all flags cleared.
  private leftDamageFired = false;
  private rightDamageFired = false;
  // Tracks `${animKey}:${triggerName}` entries already fired during the
  // current anim play, so per-frame ANIMATION_UPDATE doesn't re-trigger
  // the same sound. Cleared on ANIMATION_START — mirrors Enemy.ts.
  private readonly firedTriggers = new Set<string>();
  // Swaying-sword state machine. Non-null only for the ceiling-hung sword;
  // 'idle' = the swaying loop is playing and the trap is armed, 'snapping'
  // = the string-snap animation is playing, 'falling' = gravity is on and
  // the blade is in the air, 'embedded' = blade has landed and the trap is
  // spent. State transitions live in tickSwayingSwordFall (grounded check)
  // and onAnimComplete (snap → falling transition).
  private swayingSwordState: SwayingSwordState | null;
  // Pre-resolved full anim key for the swaying-sword snap animation. Cached
  // at constructor time so onAnimComplete can route by key without re-running
  // entityAnimFullKey on every animation event. Fall/embed completions are
  // ignored (the state machine advances on the grounded check, not on those
  // animations completing), so we only need to recognise the snap key.
  private readonly swayingSwordSnapKey: string | null;
  // Original spawn coordinates for swaying-sword traps. The sword falls under
  // gravity and ends up embedded in the floor; resetting it (when the player
  // leaves the level) needs to restore the ceiling-hung position.
  private readonly spawnX: number;
  private readonly spawnY: number;
  // Optional virtual damage zone for ejector traps. When set, GameScene's
  // overhead trigger and isInTrapDamageZone use this rect (offset from the
  // body center) instead of the physics body itself — so the body can stay
  // small (matched to the visible device, for bullet/sword hit fidelity)
  // while the actual hazard area still reaches the player.
  private readonly damageZoneConfig: {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null;

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
    // Animation-gated damage applies to either the snap animation or the
    // ejection cycle. Snap wins if both are somehow defined — no entity
    // currently mixes the two, so the ordering is conservative.
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
      // Hold the ejector on frame 0 (closed/no-flame pose) until the player
      // enters the trigger zone. Phaser's anim system stops playback but
      // leaves the frame parked here.
      this.anims.stop();
      this.setFrame(0);
    }
  }

  getDamage(): number {
    return this.damage;
  }

  // True iff this trap should switch animation when something steps on it
  // from above. Used by GameScene to gate the body-position check that
  // triggers the snap and gates damage — non-snap traps skip both.
  hasDirectContactAnimation(): boolean {
    return this.directContactAnimation !== null;
  }

  // True iff this trap is currently armed and able to snap (and damage).
  // Snap traps that have already triggered stay "spent" until the re-arm
  // timer expires and resets them.
  isArmed(): boolean {
    return !this.directContactTriggered;
  }

  // True iff this trap delegates damage to the animation midpoint via
  // TRAP_DAMAGE_FRAME instead of firing damage on every overlap tick.
  // GameScene's overlap handlers use this to skip the immediate-damage
  // path for snap and ejector traps — those get a single deferred hit
  // per cycle, gated on "still in the danger zone at the damage frame".
  hasDeferredDamage(): boolean {
    return this.damagingAnimFullKey !== null;
  }

  // One-shot animation swap fired when something lands directly on the
  // trap. Idempotent within a single arming cycle: subsequent calls after
  // the first are no-ops so something standing on a snapped trap doesn't
  // restart the snap animation every frame. After the snap anim completes
  // (handled in onAnimComplete) the trap re-arms via TRAP_REARM_DELAY_MS.
  // Damage itself doesn't apply here — it fires at the snap's midpoint via
  // TRAP_DAMAGE_FRAME, so a victim who jumps off before the midpoint
  // escapes the bite even though they triggered the snap.
  triggerDirectContact(): void {
    if (this.directContactTriggered) return;
    if (!this.directContactAnimation) return;
    this.directContactTriggered = true;
    this.damageFrameFired = false;
    this.leftDamageFired = false;
    this.rightDamageFired = false;
    this.playLogical(this.directContactAnimation);
  }

  // Ejector kind for this trap, or null for non-ejectors. Used by GameScene
  // to pick the right per-frame trigger condition: overhead (in airspace
  // above body) or attached-ground (standing on the tile directly below).
  getEjectorKind(): EjectorKind | null {
    return this.ejectorKind;
  }

  // World-space damage-zone rect for ejector traps that configured one. Null
  // when no zone is configured — callers fall back to the physics body. The
  // rect is recomputed from body.center each call so it tracks the trap if
  // the body ever moves (it doesn't today, but the math is cheap).
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

  // Current swaying-sword state, or null if this trap is not a swaying sword.
  // GameScene uses this to gate the per-frame "player passes under" trigger
  // check and to drive the fall→embedded grounded check.
  getSwayingSwordState(): SwayingSwordState | null {
    return this.swayingSwordState;
  }

  // Original spawn position. GameScene uses this to resolve which LDtk level a
  // swaying-sword trap belongs to (the blade's runtime position changes once
  // it falls and embeds, so the live x/y can't be used for the lookup).
  getSpawnX(): number {
    return this.spawnX;
  }

  getSpawnY(): number {
    return this.spawnY;
  }

  // Fires the swaying sword: plays the string-snap animation; once that
  // completes the trap transitions into 'falling' (gravity on, blade-in-air
  // texture). Idempotent — re-calling while not in 'idle' is a no-op so a
  // player loitering under the sword during the snap doesn't restart it.
  triggerSwayingSword(): void {
    if (this.swayingSwordState !== 'idle') return;
    this.swayingSwordState = 'snapping';
    this.playLogical(SWAYING_SWORD_ANIM_SNAP);
  }

  // Per-frame hook from GameScene for swaying-sword traps. While in 'falling',
  // transitions to 'embedded' only when a solid terrain tile sits directly
  // beneath the blade — GameScene supplies that flag because the tilemap
  // lookup lives on the scene. Arcade's own `body.blocked.down` could also be
  // checked but body-vs-body contact (a bird crossing the fall path) can
  // muddy `touching.down`, so we trust the explicit tile probe instead. No-op
  // in every other state so GameScene can call this unconditionally on every
  // swaying-sword trap each frame.
  tickSwayingSwordFall(onSolidTerrain: boolean): void {
    if (this.swayingSwordState !== 'falling') return;
    if (!onSolidTerrain) return;
    this.swayingSwordState = 'embedded';
    this.body.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.playLogical(SWAYING_SWORD_ANIM_EMBED);
  }

  // True iff this trap is currently dangerous as a falling sword: gravity-on,
  // mid-air, damage on body overlap. GameScene's overlap handlers use this to
  // skip the standard "victim center above trap center" gate — the falling
  // sword damages everything below it, which is the inverse semantic.
  isFallingSword(): boolean {
    return this.swayingSwordState === 'falling';
  }

  // Restores a triggered swaying-sword trap to its armed/idle state. Called
  // by GameScene when the player has left the level the sword belongs to —
  // the embedded blade is meant to persist for as long as the player is in
  // the level, then re-arm off-screen so a returning player encounters a
  // fresh trap. No-op when the trap is already idle or isn't a swaying sword.
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

  // Called per-frame from GameScene.updateTraps for ejector traps. Stores
  // the trigger state and drives cycle bookkeeping:
  //   - Active transition (false→true): starts a cycle if none in progress;
  //     clears any pending trailing cycles so we go back to pure looping.
  //   - Release transition (true→false): arms trailing-cycle counter so
  //     onAnimComplete keeps playing the configured number of extra full
  //     cycles before parking on frame 0.
  // Never stops an in-progress cycle — animation completion always drives
  // the state machine, which keeps visuals coherent if the player gets
  // knocked out of the trigger zone mid-cycle. No-op for non-ejector traps.
  setTriggered(active: boolean): void {
    if (this.ejectorKind == null) return;
    const wasActive = this.triggerActive;
    this.triggerActive = active;
    if (active) {
      // Re-entering during trailing window cancels the countdown so the
      // trap resumes pure looping without prematurely returning to idle.
      this.trailingCyclesRemaining = 0;
      if (!this.cycleInProgress) {
        this.startCycle();
      }
    } else if (wasActive) {
      this.trailingCyclesRemaining = this.trailingCycleCount;
      // Defensive: trigger released with no cycle running shouldn't happen
      // (a cycle was started when triggerActive was first set), but if it
      // does, kick off the first trailing cycle now so the counter still
      // drains. Without this the trap would stick in idle with trailing > 0.
      if (!this.cycleInProgress && this.trailingCyclesRemaining > 0) {
        this.trailingCyclesRemaining--;
        this.startCycle();
      }
    }
  }

  private startCycle(): void {
    if (this.cycleFullAnimKey == null) return;
    this.cycleInProgress = true;
    this.damageFrameFired = false;
    this.leftDamageFired = false;
    this.rightDamageFired = false;
    // Override repeat to 0 — the registry marks this animation as looping
    // (`loops: true`) so Phaser's default play() would repeat indefinitely
    // and never fire ANIMATION_COMPLETE, defeating the cycle accounting.
    // Forcing a one-shot cycle here makes "play through to the end, then
    // decide whether to loop again" the explicit lifecycle.
    this.play({ key: this.cycleFullAnimKey, repeat: 0 });
  }

  // Per-frame hook on the trap sprite. When the damaging animation reaches
  // its midpoint frame, emit TRAP_DAMAGE_FRAME so GameScene can apply damage
  // to anything still overlapping. The flag prevents the emit from firing
  // twice in the same cycle (ANIMATION_UPDATE fires on every frame change).
  // Directional ejectors emit twice per cycle (once per side, tagged with
  // 'left' / 'right'); each side has its own once-per-cycle guard.
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

  // Single-frame animations (e.g. swaying sword anim3/anim4) never emit
  // ANIMATION_UPDATE — Phaser only fires UPDATE on frame transitions. Process
  // triggers here too so first-frame sounds still fire for those anims.
  private onAnimStart(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    this.firedTriggers.clear();
    this.fireFrameTriggers(animation, frame);
  }

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

  private onAnimComplete(animation: Phaser.Animations.Animation): void {
    // Swaying-sword string-snap finished — flip to 'falling': gravity on,
    // blade-in-air texture, and let Arcade carry the sprite into the floor.
    // tickSwayingSwordFall handles the landing transition. Snap completion is
    // the only state advance driven by ANIMATION_COMPLETE; anim3 (falling)
    // and anim4 (embedded) also fire COMPLETE but we ignore them — anim3's
    // single frame is just held while gravity does the work, and anim4 is
    // the terminal state with no further transitions.
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
        // Player is still in the trigger zone — chain another cycle so the
        // ejector keeps firing as long as they linger.
        this.startCycle();
      } else if (this.trailingCyclesRemaining > 0) {
        // Player has left but trailing cycles still owed — keep going.
        this.trailingCyclesRemaining--;
        this.startCycle();
      } else {
        // Trigger fully released and trailing budget exhausted — park on
        // frame 0 (idle pose) until the next trigger.
        this.anims.stop();
        this.setFrame(0);
      }
    }
  }
}
