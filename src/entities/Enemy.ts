import Phaser from 'phaser';
import {
  getTriggersFor,
  pauseEntitySoundSequence,
  playOneShot,
  resumeEntitySoundSequence,
  setEnemyWalkSoundEnabled,
  unregisterEntityAudio,
} from '../audio';
import { ENEMY_COMBAT_TIMEOUT_MS } from '../constants';
import type { LoiterPathPoint } from '../ldtk/types';
import { rollDrop } from './AmmoDrop';
import type { AmmoDropSpawnerScene } from './AmmoDropSpawnerScene';
import { AnimatedEntity } from './AnimatedEntity';
import { EnemyHealthBar } from './EnemyHealthBar';
import type { EnemyProjectileSpawnOptions } from './EnemyProjectile';
import {
  entityAnimFullKey,
  getEntityBehavior,
} from './entityRegistryLoader';
import type {
  AnimatedEntityAttackConfig,
  AnimatedEntityBehaviorConfig,
  AnimatedEntityHitboxConfig,
} from './entityRegistryTypes';
import { Player } from './Player';

export type EnemyState =
  | 'idle'
  | 'loiter'
  | 'chase'
  | 'attack'
  | 'recover'
  | 'hurt'
  | 'dead';

// Knockback applied on hurt. Smaller than the player's because enemies are
// typically smaller/lighter; tweak per-entity later if it feels wrong.
const ENEMY_HURT_KNOCKBACK_X = 80;
const ENEMY_HURT_KNOCKBACK_Y = -120;
// Duration of the hurt state. Decoupled from animation length because (a)
// many entities lack a take_hit sheet so ANIMATION_COMPLETE never fires, and
// (b) hurt anim lengths vary widely between entities — a uniform window
// keeps hit feedback consistent. After this window the entity zeros its
// X velocity and resumes idle.
const HURT_DURATION_MS = 250;
// Fall damage tuning. A small descent (jumping over a low ledge) shouldn't
// hurt — only meaningful falls do. 350 px/s is roughly 3 tiles of free
// fall at the project's 800 px/s² gravity (v = √(2·g·h) → ≈ 220 px/s for
// 30 px ≈ 2 tiles, ≈ 280 px/s for 50 px), so 350 catches multi-tile drops
// without false-positives on short hops. Damage scales linearly past the
// threshold to make falls progressively more punishing.
const FALL_DAMAGE_VELOCITY_THRESHOLD = 350;
const FALL_DAMAGE_PER_VELOCITY = 1 / 30;
// Default detection radius for the boss-encounter sting when an entity sets
// encounterSoundId but leaves encounterRadius unset. Roughly one screen-width
// at typical zoom — large enough to feel like "stepping into the arena"
// rather than "right next to the boss".
const DEFAULT_ENCOUNTER_RADIUS = 300;
// Jump velocity for chase-time obstacle hops. Solving v² = 2·g·h with
// g = 800 (project gravity) and h = 2 tiles + margin → 40 px gives
// v ≈ 253 px/s. -260 keeps a comfortable buffer so a 2-tile wall is cleared
// without scraping; the chase X velocity keeps the body moving forward
// during the arc so it lands on the far side.
const ENEMY_JUMP_VELOCITY = -260;
// Loiter behavior for airborne enemies (gravity:false). Replaces idle so a
// crow/wasp out of chase range doesn't freeze mid-air in a grounded idle
// pose. Drifts toward a randomized point above the player at a fraction of
// the chase speed, repicking the target periodically for organic motion.
const LOITER_SPEED_MULTIPLIER = 0.55;
const LOITER_TARGET_MIN_RADIUS = 30;
const LOITER_TARGET_MAX_RADIUS = 60;
// Default vertical offset (px) for teleport-attack destinations, applied on
// top of the ground-projection done in beginTeleportAppear. Negative = above
// the floor; 0 = standing on the floor. Five tiles of headroom gives a tall
// boss sprite room to play a full falling-strike appear animation without
// clipping into the player before the damage frame fires. Override per-attack
// via targetOffsetY (e.g. 0 for a "rises from the floor" entrance).
const DEFAULT_TELEPORT_OFFSET_Y = -80;
// Loiter targets are anchored to the player, so without a cap a wasp at
// the far side of the map drifts toward the player from across the level.
// Beyond chaseRange × this multiplier the airborne enemy hovers in place
// (velocity zeroed, walk anim still playing) instead of converging.
const LOITER_ENGAGEMENT_CHASE_MULTIPLIER = 4;
// Target lives above the player: angles measured CCW from +x in radians.
// -π (180°) → straight left; -π/2 (270°) → straight up; 0 → right. The
// range [-3π/4, -π/4] sweeps the upper hemisphere from upper-left to
// upper-right, so loiter points sit above and around the player.
const LOITER_ANGLE_MIN = -Math.PI * 0.75;
const LOITER_ANGLE_MAX = -Math.PI * 0.25;
const LOITER_REFRESH_MIN_MS = 1500;
const LOITER_REFRESH_MAX_MS = 3000;
// World-pixel distance below which we treat the loiter target as reached
// and repick early, so the crow doesn't stutter against a target it
// already overshot.
const LOITER_TARGET_REACHED_DIST = 12;

// Animation key suffixes that should pause an entity's ambience sequence
// (e.g. the heart hoarder's cloth flap) while playing, then resume when the
// clip finishes. Match on suffix so any entity using these logical animation
// names participates without per-entity wiring. Idempotent against the
// teleport-attack pause/resume path that bosses like the widow already run.
const TELEPORT_ANIM_SUFFIXES: ReadonlyArray<string> = [
  '_teleport_disappear',
  '_teleport_appear',
];
function isTeleportAnimationKey(key: string): boolean {
  for (const suffix of TELEPORT_ANIM_SUFFIXES) {
    if (key.endsWith(suffix)) return true;
  }
  return false;
}

// Structural interface so Enemy doesn't need to import GameScene (avoids a
// circular dependency between Enemy ↔ GameScene). GameScene implements every
// member directly.
interface EnemyHelperScene {
  spawnEnemyProjectile(options: EnemyProjectileSpawnOptions): void;
  // True when the world-pixel segment from (x1,y1) to (x2,y2) intersects a
  // solid collision tile. Used to gate chase and ranged-attack initiation.
  isLineBlocked(x1: number, y1: number, x2: number, y2: number): boolean;
  // True iff a solid collision tile exists at the given world coords. Used
  // for obstacle detection: enemy chase samples a point just ahead/up to
  // decide whether to jump.
  isTileSolidAt(x: number, y: number): boolean;
  // Raw IntGrid value at the given world coords (1=ground, 2=bridge, 0=empty).
  // Used to gate surface-specific footstep loops during chase — mirrors the
  // probe Player.ts uses to switch between pebble and metal-stairs slots.
  getIntGridValueAt(x: number, y: number): number;
  // World rect of the LDtk level containing (x, y), or null if the point sits
  // outside any level. Used by arena-bound bosses to snapshot their spawn
  // level on construction so movement/teleport can be clamped to the arena.
  getLevelBoundsAt(
    x: number,
    y: number,
  ): { worldX: number; worldY: number; pxWid: number; pxHei: number } | null;
}

// IntGrid values from the LDtk source. Match the constants in Player.ts —
// kept in sync by hand because the values are part of the LDtk schema, not
// runtime data, so factoring them out would just add an import for two ints.
const INTGRID_GROUND_VALUE = 1;
const INTGRID_BRIDGE_VALUE = 2;
// Sample offset below body.bottom when probing the tile under the enemy's
// feet. Same value as Player.ts FOOTSTEP_TILE_PROBE_OFFSET_Y — body.bottom
// sits at the top edge of the floor tile while grounded; +4 px lands safely
// inside the tile beneath.
const FOOTSTEP_TILE_PROBE_OFFSET_Y = 4;

// Animated entity that gains health, damage, and a behavior block. Owns the
// AI state machine: when the player is within range, plays the configured
// attack animation and applies damage on the configured frame — melee via a
// transient overlapRect hitbox, ranged/magic via an EnemyProjectile aimed
// at the player. Multi-attack bosses authored with `attackPool` pick a
// random eligible attack per cycle; the `contact` type damages on body
// overlap (no animation), and `heal` self-casts when HP falls below a
// configurable fraction of max.
export class Enemy extends AnimatedEntity {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly behavior: AnimatedEntityBehaviorConfig;
  // Stable LDtk instance id. Threaded through so the SoundManager can tear
  // down static `entitySounds` anchors (keyed by iid) when this enemy dies —
  // moving anchors are keyed by sprite ref and torn down separately.
  private readonly iid: string;
  // World coords the enemy was placed at on construction. Captured so the
  // respawn manager can rebuild a killed enemy at exactly the same LDtk
  // position regardless of where the corpse settled (knockback, gravity).
  private readonly spawnX: number;
  private readonly spawnY: number;
  // Flattened attack list: either the single `attack` from the registry, or
  // every entry in `attackPool`. Chase fields (aggressive / chaseRange /
  // moveSpeed / walkAnimation) are read from `attacks[0]` — multi-attack
  // bosses should put the chase-bearing entry first.
  private readonly attacks: ReadonlyArray<AnimatedEntityAttackConfig>;
  private health: number;
  private enemyState: EnemyState = 'idle';
  // Wall-clock timestamp at which the post-attack recover window ends. Set
  // when an attack animation completes; used to gate the next attack cycle.
  private cooldownUntil = 0;
  // Facing direction: 1 = right, -1 = left. Updated each tick to face the
  // player, except while an attack is committed (facing locks at attack
  // entry so the hitbox direction matches the animation the player sees).
  private facingDirection: 1 | -1 = 1;
  // Pending hurt-state exit timer. Tracked so repeated hits can cancel the
  // old timer and start a fresh window, preventing the entity from snapping
  // back to idle mid-stagger.
  private hurtTimer: Phaser.Time.TimerEvent | null = null;
  // Set to true the first frame the attack animation reaches its configured
  // damage frame — keeps the per-frame ANIMATION_UPDATE handler from firing
  // damage more than once per swing. Used by non-melee attacks (one event per
  // cycle); melee multi-hitbox attacks track per-hitbox firing via
  // `firedMeleeHitboxes` so a swing can stamp rects on several frames.
  private attackFired = false;
  // Indices into `currentAttack.hitboxes` that have already fired this swing.
  // Each entry's effective frame (per-hitbox `frame` or attack default) is
  // checked in onAnimUpdate; once fired the index is added here so a hitbox
  // can't double-dip if the animation re-emits ANIMATION_UPDATE on the same
  // frame. Cleared on attack entry / interrupt alongside `attackFired`.
  private firedMeleeHitboxes = new Set<number>();
  // Per-swing fired set for multi-frame AoE (attack.damageFrames). Each
  // entry is the frame index that already fired its damage rect this
  // swing. Cleared alongside firedMeleeHitboxes on attack entry / interrupt
  // so the next swing's frames can fire again.
  private firedAoeDamageFrames = new Set<number>();
  // The attack chosen for the in-flight swing. null when idle/chase/recover.
  // Stored so the ANIMATION_UPDATE/ANIMATION_COMPLETE handlers know which
  // damage frame and which animation key to watch for — pool-based bosses
  // can't read `behavior.attack` for this because they have many.
  private currentAttack: AnimatedEntityAttackConfig | null = null;
  // Multi-phase state for `teleport` attacks. 'disappear' = wind-up clip
  // playing at the pre-teleport position; 'appear' = visual-only reappear
  // clip playing at the destination (only used when the attack opts into
  // an `appearAnimation`); 'strike' = damage-bearing `animation` playing at
  // the destination. null otherwise. Two-phase teleports go disappear →
  // strike directly; three-phase go disappear → appear → strike. Drives
  // the ANIMATION_COMPLETE chaining without polluting `enemyState`.
  private teleportPhase: 'disappear' | 'appear' | 'strike' | null = null;
  // Tracks whether gravity was enabled before a teleport began so the body
  // can be restored after the appear clip completes (or on hurt/death
  // mid-teleport). Gravity is suppressed for the full teleport so the boss
  // doesn't fall mid-pose during the appear animation.
  private teleportRestoreGravity = false;
  // Scene-time at which the next projectile-triggered teleport becomes
  // eligible. Stamped on trigger (not on completion) so a rapid-fire weapon
  // can't chain the boss into an unfightable teleport-lock. Independent of
  // the chosen attack's own recastCooldownMs — projectile reactions bypass
  // that lockout so the boss can always respond.
  private projectileReactionReadyAt = 0;
  // Per-attack contact cooldown timestamps. Contact attacks damage on body
  // overlap with the player and use their own cooldown to prevent tick-storms;
  // tracked per-attack so multiple contact entries (rare, but possible) don't
  // share a single timer.
  private readonly contactCooldowns = new Map<
    AnimatedEntityAttackConfig,
    number
  >();
  // Per-attack recast timestamps. An attack with recastCooldownMs becomes
  // ineligible until this map's stored value is in the past. Independent
  // of the global recover state — meant to gate signature heavy attacks
  // (e.g. Shadow_of_storms attack3 AoE) so they don't dominate the
  // attack pool's uniform random pick once they're the only eligible
  // option at range.
  private readonly attackReadyAt = new Map<
    AnimatedEntityAttackConfig,
    number
  >();
  // Tracks `${animKey}:${triggerName}` entries that have already fired during
  // the current anim play. Cleared on ANIMATION_START so the next play of the
  // same anim re-arms its triggers, and on ANIMATION_REPEAT so triggers on a
  // looping animation (e.g. per-step walk impacts) re-fire each cycle.
  private readonly firedTriggers = new Set<string>();
  // Sounds spawned by triggers with stopOnAnimComplete=true. Stopped on
  // ANIMATION_START (new anim begins) or ANIMATION_COMPLETE (current anim
  // ends) so an audio clip longer than the anim doesn't overhang.
  private activeTriggerSounds: Phaser.Sound.BaseSound[] = [];
  // Captured during update(player) so the asynchronous ANIMATION_UPDATE /
  // ANIMATION_COMPLETE handlers have something to aim a projectile at. Null
  // until the first update tick.
  private playerRef: Player | null = null;
  // Fall-damage tracking. `peakFallVelocity` records the highest downward
  // velocity observed while airborne; on landing (transition from
  // airborne → grounded) it's converted into damage and reset. Only
  // gravity-enabled enemies can fall, so airborne entities (crows, wasps)
  // never accrue fall damage even if their velocity briefly spikes.
  private peakFallVelocity = 0;
  private wasAirborne = false;
  // Latches true once the encounter sting (boss intro sound) has fired so the
  // sound plays exactly once per Enemy instance. A scene.restart respawn
  // creates a new Enemy and gets a fresh sting.
  private encounterTriggered = false;
  // Scene-time at which the boss is allowed to start attacking/chasing.
  // Initialized in the constructor: entities without engageDelayMs default to
  // 0 (always ready, legacy behavior). Entities WITH engageDelayMs are set to
  // +Infinity so the boss is held idle until the encounter trigger arms the
  // real timer — defensive against any edge case where the encounter trigger
  // is late (player position not yet inside the arena rect, off-by-one on the
  // bounds check, etc.) that would otherwise let the boss free-engage in the
  // pre-trigger window. Set to `now + behavior.engageDelayMs` when the
  // encounter trigger fires.
  private engageReadyAt: number;
  // Loiter target in world coords. Repicked on entry, on expiry of
  // loiterRefreshAt, or when the entity gets within
  // LOITER_TARGET_REACHED_DIST of the current point.
  private loiterTargetX = 0;
  private loiterTargetY = 0;
  private loiterRefreshAt = 0;
  // Authored patrol route in world-space px (LDtk Point-Array field
  // "loiterPath"). null = no path → fall back to the original player-anchored
  // random-drift loiter (airborne enemies) or plain idle (grounded). When
  // set, the entity walks between waypoints in ping-pong order.
  private readonly loiterPath: ReadonlyArray<LoiterPathPoint> | null;
  // Index into loiterPath of the waypoint the entity is currently moving
  // toward. Snapped to the nearest waypoint on each (re)entry into loiter
  // (e.g. after a chase/attack/recover cycle) so the entity resumes from
  // wherever it ended up, not from where it stopped patrolling.
  private pathIndex = 0;
  // Ping-pong direction: +1 walks pathIndex forward through the array, -1
  // walks it backward. Flipped at the endpoints so the entity sweeps the
  // path A→B→C→B→A→B→C…
  private pathDirection: 1 | -1 = 1;
  // World rect of the LDtk level the entity spawned in. Captured at
  // construction when behavior.stayInSpawnLevel is true so arena-bound bosses
  // can clamp movement/teleport destinations to a fixed arena. null when the
  // flag is off, or when spawn coords didn't resolve to a level (defensive —
  // bosses are always placed inside an LDtk level in practice).
  private readonly spawnLevelBounds: {
    readonly worldX: number;
    readonly worldY: number;
    readonly pxWid: number;
    readonly pxHei: number;
  } | null;
  // Floating combat HP bar. Null when the entity opted out via
  // behavior.hideHealthBar, or has no attacks at all (passive decoration foes
  // can be hit but the bar is suppressed — they're not really combat
  // encounters). Disposed in the existing DESTROY listener.
  private readonly healthBar: EnemyHealthBar | null;
  // True once the player has dealt damage to this enemy. Drives bar
  // visibility and the combat-timeout HP reset. Enemy-attacks-player does
  // NOT flip this flag — per design, the bar appears only after the player
  // engages this enemy first.
  private inCombat = false;
  // Scene-time at which the combat window expires. Refreshed on every
  // player-dealt damage event; once it elapses we restore HP and hide the
  // bar. Sentinel 0 == not in combat.
  private combatTimeoutAt = 0;
  // Latches true the moment the death-explosion AoE fires so the frame-
  // trigger path in onAnimUpdate and the no-anim fallback in enterDeadState
  // can't double-fire. No-op for entities without behavior.deathExplosion.
  private deathExplosionFired = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    identifier: string,
    iid: string,
    loiterPath: ReadonlyArray<LoiterPathPoint> | null = null,
  ) {
    super(scene, x, y, identifier);
    this.iid = iid;
    this.spawnX = x;
    this.spawnY = y;
    // Single-waypoint paths are expanded with the spawn position as an
    // implicit first waypoint, so one click in LDtk defines a useful
    // ping-pong patrol (spawn ↔ point). Multi-waypoint paths use what the
    // author wrote. Zero-waypoint / null falls back to legacy loiter.
    if (loiterPath && loiterPath.length === 1) {
      this.loiterPath = [{ x, y }, loiterPath[0]];
    } else if (loiterPath && loiterPath.length >= 2) {
      this.loiterPath = loiterPath;
    } else {
      this.loiterPath = null;
    }
    const behavior = getEntityBehavior(identifier);
    if (!behavior) {
      // Defensive: EntityFactory should only construct Enemy for entries
      // that have a behavior block. If we reach here without one, the
      // factory branching is broken.
      throw new Error(
        `Enemy: identifier "${identifier}" has no behavior block — should have been spawned as AnimatedEntity`,
      );
    }
    this.behavior = behavior;
    this.health = behavior.health;
    // attackPool wins when both are set — the schema treats `attack` as the
    // single-attack shorthand. Empty list is valid (passive enemies).
    this.attacks =
      behavior.attackPool ??
      (behavior.attack ? [behavior.attack] : []);

    if (behavior.immovable) {
      // Anchor the entity to its LDtk spawn position. Gravity off so it
      // doesn't drift downward; immovable so player collisions can't shove
      // it sideways either. takeDamage also skips knockback for these.
      this.body.setAllowGravity(false);
      this.body.setImmovable(true);
    }

    // Snapshot the spawn level rect once for arena-bound bosses. clampToArena
    // and the teleport destination clamp read this each tick. Lookup runs only
    // when the flag is set so the helper-scene call cost is paid only by
    // bosses that opt in.
    if (behavior.stayInSpawnLevel) {
      const helper = scene as unknown as EnemyHelperScene;
      this.spawnLevelBounds = helper.getLevelBoundsAt(x, y);
    } else {
      this.spawnLevelBounds = null;
    }

    // Bosses with engageDelayMs start locked (engageReadyAt = +Infinity) so
    // the engage-gate in update() holds them in idle until the encounter
    // trigger arms the real timer. Others default to 0 so the gate is a no-op.
    this.engageReadyAt =
      behavior.engageDelayMs !== undefined
        ? Number.POSITIVE_INFINITY
        : 0;

    // Lazy-build the floating HP bar. Skipped for opt-out entities (the_hive,
    // swarm wasps, anything authoring hideHealthBar:true) and for purely
    // passive entities with no attacks — those technically have HP but aren't
    // "combat" in any meaningful sense, so a bar would just litter the world.
    // The bar starts hidden; the player's first hit on this enemy flips
    // inCombat on and setVisible follows.
    if (behavior.hideHealthBar !== true && this.attacks.length > 0) {
      this.healthBar = new EnemyHealthBar(scene, behavior.healthBarOffsetY ?? 0);
    } else {
      this.healthBar = null;
    }

    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimUpdate,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.onAnimComplete,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_START,
      this.onAnimStart,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_REPEAT,
      this.onAnimRepeat,
      this,
    );

    // Cancel any pending hurt timer when the sprite is destroyed (e.g. on
    // HMR teardown or death-anim complete). Without this, the delayedCall
    // can fire against a destroyed body and throw.
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hurtTimer) {
        this.hurtTimer.remove(false);
        this.hurtTimer = null;
      }
      this.stopActiveTriggerSounds();
      // Phaser doesn't auto-destroy plain Graphics objects when a sibling
      // sprite is destroyed; without this the bar would survive HMR teardown
      // (which clears the enemies group without restarting the scene).
      this.healthBar?.destroy();
    });
  }

  getHealth(): number {
    return this.health;
  }

  getState(): EnemyState {
    return this.enemyState;
  }

  getBehavior(): AnimatedEntityBehaviorConfig {
    return this.behavior;
  }

  isDead(): boolean {
    return this.enemyState === 'dead';
  }

  // Stable LDtk instance id. Same iid is reused when the respawn manager
  // rebuilds this enemy so iid-keyed audio anchors line back up.
  getIid(): string {
    return this.iid;
  }

  getSpawnX(): number {
    return this.spawnX;
  }

  getSpawnY(): number {
    return this.spawnY;
  }

  // Authored patrol route in world-space px (null when unset). The respawn
  // manager forwards this so the rebuilt enemy resumes the same path.
  getLoiterPath(): ReadonlyArray<LoiterPathPoint> | null {
    return this.loiterPath;
  }

  // True when the registry flags this entity as a boss. Bosses opt out of
  // the auto-respawn system entirely.
  isBoss(): boolean {
    return this.behavior.isBoss === true;
  }

  // True while the boss is mid-teleport blink (disappear or appear clip
  // playing). GameScene's projectile overlap checks this so bullets pass
  // through without damage or impact — the boss is "not there" visually
  // during the blink, and ignoring projectile reactions during the blink
  // also avoids a re-trigger loop where a shot lands on the appear frame
  // and immediately kicks off another teleport.
  isInTeleportBlink(): boolean {
    return this.teleportPhase === 'disappear' || this.teleportPhase === 'appear';
  }

  // Called by GameScene.update() each frame. Drives the AI state machine.
  // Inert when the entity has no attack — passive enemies still spawn as
  // killable targets without attacking back.
  update(player: Player): void {
    // Sprite was destroyed (e.g. by the off-world cleanup below on a prior
    // frame) but still sits in the spawned.enemies array — bail before
    // touching this.body, which is null after destroy.
    if (!this.active || !this.body) return;

    // Off-world safety net: knockback from a sword hit at a ledge edge can
    // slide a small-bodied enemy (dagger/archer bandits) over the side, and
    // the world bounds don't catch them — they'd fall forever and keep
    // ticking AI. Destroy any enemy that has fallen well below the world
    // bottom so the update loop reclaims the slot. Death animation is
    // skipped intentionally — the corpse is off-screen anyway.
    const worldBottom = this.scene.physics.world.bounds.bottom;
    if (this.body.top > worldBottom + 200) {
      this.destroy();
      return;
    }

    // Fall-damage tracking runs unconditionally (above the state-machine
    // gate) so an enemy hit mid-fall still records its peak velocity and
    // applies the impact damage on landing. trackFallDamage early-returns
    // on dead so a corpse doesn't accrue further hits while it settles.
    this.trackFallDamage();

    // Arena bound: snap the body back inside the spawn level rect every
    // frame. Catches chase momentum, hurt knockback, and any teleport
    // reposition that landed at the edge. No-op when stayInSpawnLevel is
    // unset (spawnLevelBounds stays null).
    this.clampToArena();

    // Combat HP bar bookkeeping runs above the dead/hurt early-return so
    // (a) the combat timeout still ticks while the enemy is mid-hurt and
    // (b) a corpse plays its death anim with the bar hidden rather than
    // frozen mid-position. Anchor follows body.top so animation-frame
    // anchor swaps (applyAnimationAnchor resizes the body) don't desync.
    // Visibility hides during the teleport-disappear/appear blink for the
    // same reason projectile overlap does — the boss visually isn't there.
    this.maybeExitCombat();
    if (this.healthBar) {
      this.healthBar.setAnchor(this.body.center.x, this.body.top);
      this.healthBar.setVisible(
        this.inCombat && !this.isInTeleportBlink() && !this.isDead(),
      );
    }

    if (this.enemyState === 'dead' || this.enemyState === 'hurt') return;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    // Boss-encounter sting + engage-delay start: fires once the first time
    // the player crosses into the boss's engagement zone. For arena-bound
    // bosses (stayInSpawnLevel → spawnLevelBounds set) the zone is the arena
    // rect itself — semantically "player walked into the room", which avoids
    // the airborne-boss failure where 2D distance never drops below the
    // configured encounterRadius because the boss hovers above the floor
    // (e.g. The_heart_hoarder at Y=2616 with the player on the floor at
    // Y=2720: 2D dist stays ~100 px above the X-only separation, so a tight
    // encounterRadius would never trigger and the boss would teleport-strike
    // before the engage delay armed). Falls back to the configured 2D radius
    // (or DEFAULT_ENCOUNTER_RADIUS) for non-arena bosses. Sting is camera-
    // fixed (no emitter passed) so it plays at full volume — bosses are
    // arena-scale events and the sting is a UI moment, not a spatial cue.
    // Latched on `encounterTriggered` so re-aggro within the same Enemy
    // doesn't re-fire either side effect. Runs above the attack-less early-
    // return so attack-less bosses (entrance-only set pieces, decorative
    // arena foes) still trigger the sting on approach.
    if (
      !this.encounterTriggered &&
      (this.behavior.encounterSoundId !== undefined ||
        this.behavior.engageDelayMs !== undefined)
    ) {
      const bounds = this.spawnLevelBounds;
      const inZone = bounds
        ? player.x >= bounds.worldX &&
          player.x <= bounds.worldX + bounds.pxWid &&
          player.y >= bounds.worldY &&
          player.y <= bounds.worldY + bounds.pxHei
        : dist <=
          (this.behavior.encounterRadius ?? DEFAULT_ENCOUNTER_RADIUS);
      if (inZone) {
        if (this.behavior.encounterSoundId !== undefined) {
          playOneShot(this.scene, this.behavior.encounterSoundId);
        }
        if (this.behavior.engageDelayMs !== undefined) {
          this.engageReadyAt =
            this.scene.time.now + this.behavior.engageDelayMs;
        }
        this.encounterTriggered = true;
      }
    }

    if (this.attacks.length === 0) return;

    this.playerRef = player;

    // Contact attacks run independently of the swing state machine — fire
    // first so a chase-and-bump enemy (wasp) damages on contact even mid-
    // recover. The player's own invuln window prevents tick-storms.
    this.applyContactDamage(player);

    // Face the player whenever we're free to — locked while attacking so
    // the committed swing's hitbox direction matches what the animation
    // showed.
    if (this.enemyState !== 'attack') {
      this.facingDirection = dx >= 0 ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }

    if (this.enemyState === 'recover') {
      if (this.scene.time.now < this.cooldownUntil) {
        // Keep loiter-capable entities drifting during the cooldown so a
        // crow that just landed an attack continues hovering visibly
        // instead of freezing mid-air for ~1s. Animation is already set
        // to walk by onAnimComplete's recover transition.
        if (this.canLoiter()) this.updateLoiter(player);
        return;
      }
      this.enterIdle();
      // Fall through so a player still in range triggers a fresh attack
      // this same tick rather than burning a frame in idle.
    }

    if (this.enemyState === 'attack') {
      const isDive = this.currentAttack?.type === 'dive';
      // Don't drift during the swing. Immovable bodies already have zero
      // velocity from physics, but the explicit zero keeps the velocity
      // model uniform across all enemies. Airborne entities (gravity off)
      // also need Y zeroed — nothing pulls them down to a natural rest.
      // Exception: 'dive' attacks rely on the velocity set in
      // enterAttackState carrying through the whole animation, so we
      // skip the zero for them.
      if (!this.behavior.immovable && !isDive) {
        this.setVelocityX(0);
        if (!this.body.allowGravity) this.setVelocityY(0);
      }
      if (isDive && !this.attackFired) {
        this.applyDiveContact(player);
      }
      return;
    }

    // Engage delay: bosses with engageDelayMs hold in idle for that window
    // after the encounter trigger fires, giving the player time to enter the
    // arena before the boss commits. Skips attack-picking, chase, AND loiter
    // — loiter would drift the boss around the player (and a horizontal-only
    // boss like the heart hoarder would jitter against arena walls), which
    // defeats the "let the player enter the room" intent. Forces plain idle
    // (velocity zeroed) regardless of canLoiter eligibility. enterIdle is
    // guarded by the state check so we don't restart the animation each
    // frame. engageReadyAt stays at 0 for entities without the flag, so
    // this branch is a no-op for them.
    if (this.scene.time.now < this.engageReadyAt) {
      if (this.enemyState !== 'idle') {
        this.enterIdle();
      } else if (!this.behavior.immovable) {
        // Already idle, but make sure we stay parked — a contact attack
        // earlier in update() or any other side effect can leave residual
        // velocity that would drift the boss across the arena over 3 s.
        this.body.setVelocityX(0);
        if (!this.body.allowGravity) this.body.setVelocityY(0);
      }
      return;
    }

    const pick = this.pickAttack(dist);
    if (pick) {
      // Ranged/magic attacks need a clear line to the player — firing at a
      // wall is a wasted swing and looks broken. Melee swings still commit
      // through walls: the hitbox is short and usually can't reach the
      // player through a 16 px tile, and short-circuiting melee here would
      // make wall-hugging trivially exploitable.
      if (pick.type === 'ranged' || pick.type === 'magic') {
        const helper = this.scene as unknown as EnemyHelperScene;
        if (helper.isLineBlocked(this.x, this.y, player.x, player.y)) {
          this.enterIdleOrLoiter(player);
          return;
        }
      }
      this.enterAttackState(pick);
      return;
    }

    // No eligible attack — try to chase. Chase fields live on attacks[0]
    // (the lead/default attack); pool-based bosses authoring multiple
    // attacks should put the chase-bearing entry first.
    const chaseLead = this.attacks[0];
    const canChase =
      chaseLead.aggressive &&
      chaseLead.chaseRange != null &&
      chaseLead.moveSpeed != null &&
      !this.behavior.immovable;

    if (canChase && dist <= chaseLead.chaseRange!) {
      const helper = this.scene as unknown as EnemyHelperScene;
      // Chase is gated on line-of-sight so enemies don't pathologically
      // shove against walls between them and the player.
      if (helper.isLineBlocked(this.x, this.y, player.x, player.y)) {
        this.enterIdleOrLoiter(player);
        return;
      }
      if (this.enemyState !== 'chase') {
        this.enemyState = 'chase';
        const walkAnim = chaseLead.walkAnimation;
        if (walkAnim) this.playLogical(walkAnim);
      }
      // Refresh per-frame so surface-gated footsteps (pebble vs metal stairs)
      // flip when the enemy walks onto/off a bridge. Airborne chasers (no
      // gravity) and chasers off any IntGrid tile resolve to `null`, which
      // silences surface anchors while still letting `'always'` anchors play
      // (e.g. ghoul mud footsteps stay audible even mid-hop).
      setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
      if (this.body.allowGravity) {
        // Ground-bound chase: drive horizontally, hop short walls
        // (≤ 2 tiles) so the chaser can follow the player up small steps.
        if (this.shouldJumpOverObstacle()) {
          this.setVelocityY(ENEMY_JUMP_VELOCITY);
        }
        this.setVelocityX(chaseLead.moveSpeed! * this.facingDirection);
      } else if (this.behavior.horizontalMovementOnly) {
        // Airborne but horizontal-locked (heart hoarder): chase along X only.
        // Y stays parked so the boss glides on a fixed line and only changes
        // elevation through its own attack-driven repositioning (teleport).
        const speed = chaseLead.moveSpeed!;
        this.setVelocityX(Math.sign(dx) * speed);
        this.setVelocityY(0);
      } else {
        // Airborne chase (crows, wasps): home in on the player in 2D.
        // Normalize so diagonal flight isn't faster than cardinal flight,
        // and gate on len > 0 to avoid divide-by-zero when the entity is
        // overlapping the player (rare, but possible with contact attackers).
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const speed = chaseLead.moveSpeed!;
          this.setVelocityX((dx / len) * speed);
          this.setVelocityY((dy / len) * speed);
        } else {
          this.body.setVelocity(0, 0);
        }
      }
      return;
    }

    this.enterIdleOrLoiter(player);
  }

  // Public damage entry point. Called by GameScene's projectile-overlap
  // handler and by Player.applySwordHits during melee. Source coords are
  // used to compute knockback direction. `skipKnockback` is set by the
  // fall-damage path so a hard landing doesn't fling the enemy sideways
  // off the spot they just landed on. `sourceIsPlayer` (default true)
  // distinguishes player-dealt damage from environmental damage (traps,
  // fall) — only player-dealt damage flips the enemy into combat and shows
  // the floating HP bar.
  takeDamage(
    damage: number,
    sourceX: number,
    _sourceY: number,
    options: { skipKnockback?: boolean; sourceIsPlayer?: boolean } = {},
  ): void {
    if (this.enemyState === 'dead') return;
    this.health = Math.max(0, this.health - damage);
    if (options.sourceIsPlayer !== false) {
      this.enterCombat();
    }
    // Push the new HP value into the bar regardless of source — if the
    // player already engaged this enemy, a trap finishing it off should
    // drain the bar visibly. Hidden bars dedup the redraw internally.
    this.healthBar?.setHealth(this.health, this.behavior.health);

    // Once the disappear/appear blink clip has started it plays to
    // completion — the boss is mid-blink and the body position is owned
    // by the teleport state machine. Damage still registers (HP drops,
    // death still triggers) but knockback, hurt-state transition, and
    // hurtAnimation are suppressed. Without this, a well-timed hit during
    // teleport_disappear would freeze the boss in the hurt pose at its
    // pre-teleport position and the player would skip the entire mechanic.
    //
    // The teleport 'strike' phase is NOT protected — it plays a regular
    // attack animation (attack2/attack3) and should interrupt like any
    // other swing when the boss takes a hit mid-attack.
    const midBlink =
      this.teleportPhase === 'disappear' || this.teleportPhase === 'appear';

    if (
      !midBlink &&
      !this.behavior.immovable &&
      !options.skipKnockback
    ) {
      const knockbackDir: 1 | -1 = this.x >= sourceX ? 1 : -1;
      this.setVelocityX(ENEMY_HURT_KNOCKBACK_X * knockbackDir);
      if (this.body.allowGravity) {
        this.setVelocityY(ENEMY_HURT_KNOCKBACK_Y);
      }
    }

    if (this.health <= 0) {
      this.enterDeadState();
      return;
    }

    if (midBlink) {
      // Damage took effect; the teleport ANIMATION_COMPLETE handler will run
      // its normal transition out (endTeleport restores gravity + audio,
      // enterIdle / beginTeleportStrike pick up the next state).
      if (this.behavior.hurtSoundId) {
        playOneShot(this.scene, this.behavior.hurtSoundId, 0, this);
      }
      return;
    }

    this.enemyState = 'hurt';
    // Reset attack-frame guard so the next attack post-recovery can fire
    // its damage frame again.
    this.attackFired = false;
    this.firedMeleeHitboxes.clear();
    this.firedAoeDamageFrames.clear();
    this.currentAttack = null;
    // Clears the teleport phase + restores gravity when a hit cancels a
    // mid-blink boss. No-op if no teleport was active.
    this.endTeleport();
    setEnemyWalkSoundEnabled(this, false);
    if (this.behavior.hurtAnimation) {
      this.playLogical(this.behavior.hurtAnimation);
    }
    if (this.behavior.hurtSoundId) {
      playOneShot(this.scene, this.behavior.hurtSoundId, 0, this);
    }

    // Replace any pending hurt timer so back-to-back hits start a fresh
    // window instead of letting the first one snap us back to idle mid-flinch.
    if (this.hurtTimer) {
      this.hurtTimer.remove(false);
    }
    this.hurtTimer = this.scene.time.delayedCall(HURT_DURATION_MS, () => {
      this.hurtTimer = null;
      if (this.enemyState !== 'hurt') return;
      this.enterIdle();
    });
  }

  // Flips the enemy into combat (or refreshes the timer if already in
  // combat) and reveals the floating HP bar. Called from takeDamage when
  // sourceIsPlayer is true. Idempotent — repeated calls within the window
  // just slide the timeout forward. No-op for entities with no bar
  // (hideHealthBar opt-out / attack-less passives) so the early return
  // saves the redundant scene.time read.
  private enterCombat(): void {
    if (!this.healthBar) return;
    this.inCombat = true;
    this.combatTimeoutAt = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
  }

  // Called each tick before the dead/hurt early-return. When the combat
  // window lapses, restore HP to max and hide the bar. Dead enemies are
  // skipped — a corpse mid-death-anim must not "heal" back to full and
  // ride out a 20 s timer. Live enemies in any other state (idle, loiter,
  // chase, attack, recover, hurt) are eligible to reset.
  private maybeExitCombat(): void {
    if (!this.inCombat) return;
    if (this.enemyState === 'dead') return;
    if (this.scene.time.now < this.combatTimeoutAt) return;
    this.inCombat = false;
    this.combatTimeoutAt = 0;
    this.health = this.behavior.health;
    this.healthBar?.setHealth(this.health, this.behavior.health);
    this.healthBar?.setVisible(false);
  }

  // IntGrid value under the enemy's feet, mapped to the surface tag used by
  // surface-gated walk-sound anchors. Returns null for airborne enemies (no
  // gravity), enemies currently off-grid (mid-jump), or tile values that
  // aren't ground/bridge — those callers want surface anchors muted while
  // `'always'` anchors continue to play.
  private currentWalkSurface(): 'ground' | 'bridge' | null {
    if (!this.body.allowGravity) return null;
    if (!this.body.blocked.down && !this.body.touching.down) return null;
    const helper = this.scene as unknown as EnemyHelperScene;
    const tile = helper.getIntGridValueAt(
      this.x,
      this.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y,
    );
    if (tile === INTGRID_GROUND_VALUE) return 'ground';
    if (tile === INTGRID_BRIDGE_VALUE) return 'bridge';
    return null;
  }

  // Picks a non-contact attack the enemy is eligible to use right now.
  // Heal only eligible when HP < threshold so bosses save it for when
  // they're bloodied. Melee/ranged/magic eligible when dist <= range. If
  // multiple are eligible (e.g. several melee attacks of overlapping
  // range), one is picked uniformly at random — gives bosses a varied
  // attack rhythm without scripting a sequence.
  private pickAttack(dist: number): AnimatedEntityAttackConfig | null {
    const now = this.scene.time.now;
    const eligible: AnimatedEntityAttackConfig[] = [];
    for (const attack of this.attacks) {
      if (attack.type === 'contact') continue;
      // Per-attack lockout — skip if this specific attack is still on
      // its recast timer regardless of range / heal-threshold.
      const readyAt = this.attackReadyAt.get(attack) ?? 0;
      if (now < readyAt) continue;
      if (attack.type === 'heal') {
        const threshold = attack.healThreshold ?? 0.5;
        if (this.health / this.behavior.health >= threshold) continue;
        eligible.push(attack);
        continue;
      }
      if (attack.range != null && dist <= attack.range) {
        // minRange gates the lower bound (used by 'dive' / 'aoe'). Other
        // types leave it undefined and pass freely.
        const minRange = attack.minRange ?? 0;
        if (dist < minRange) continue;
        eligible.push(attack);
      }
    }
    if (eligible.length === 0) return null;
    // Weighted pick: each entry's `weight` (default 1) acts as a relative
    // probability. Bosses use this to bias toward signature attacks (e.g.,
    // the heart hoarder's slam at weight 3 vs its AoE at weight 1) without
    // needing duplicate registry entries. Negative/zero weights are clamped
    // to 0 so a misconfigured entry can't drag the total to nonsense.
    let totalWeight = 0;
    for (const a of eligible) totalWeight += Math.max(0, a.weight ?? 1);
    if (totalWeight <= 0) {
      return eligible[Math.floor(Math.random() * eligible.length)];
    }
    let pick = Math.random() * totalWeight;
    for (const a of eligible) {
      pick -= Math.max(0, a.weight ?? 1);
      if (pick < 0) return a;
    }
    // Floating-point slack guard — pick the last entry if rounding leaves
    // `pick` non-negative after the loop.
    return eligible[eligible.length - 1];
  }

  private enterAttackState(attack: AnimatedEntityAttackConfig): void {
    this.enemyState = 'attack';
    this.attackFired = false;
    this.firedMeleeHitboxes.clear();
    this.firedAoeDamageFrames.clear();
    this.currentAttack = attack;
    setEnemyWalkSoundEnabled(this, false);
    if (attack.type === 'heal') {
      playOneShot(this.scene, 'heal_spell_cast', 0, this);
    }
    // Stamp the per-attack recast lockout at swing start (not end) so the
    // "this attack last fired N seconds ago" semantic is intuitive.
    if (attack.recastCooldownMs != null) {
      this.attackReadyAt.set(
        attack,
        this.scene.time.now + attack.recastCooldownMs,
      );
    }
    if (attack.type === 'dive') {
      // Commit a one-shot velocity that lands the body on the player at
      // the moment the dive animation finishes. The attack-branch in
      // update() skips its usual velocity-zero for 'dive' so this
      // momentum persists for the full swing.
      this.applyDiveVelocity(attack);
    } else if (!this.behavior.immovable) {
      this.setVelocityX(0);
      if (!this.body.allowGravity) this.setVelocityY(0);
    }
    if (attack.type === 'teleport') {
      // Phase 1: play the disappear clip at the pre-teleport position. The
      // ANIMATION_COMPLETE handler re-fires us into phase 2 (reposition +
      // appear). Gravity is suspended for the full attack so the boss
      // doesn't fall through the appear pose — restored on appear complete
      // (or hurt/death interrupt).
      this.teleportPhase = 'disappear';
      this.teleportRestoreGravity = this.body.allowGravity;
      if (this.teleportRestoreGravity) {
        this.body.setAllowGravity(false);
      }
      this.setVelocity(0, 0);
      // Pause the body-movement sequence (if the entity has one) for the
      // duration of the teleport. endTeleport mirrors this with a resume so
      // the playlist picks up mid-clip rather than restarting. Pause is a
      // no-op for entities without a registered sequence.
      pauseEntitySoundSequence(this);
      if (attack.disappearAnimation != null) {
        this.playLogical(attack.disappearAnimation);
      }
      return;
    }
    // Validator guarantees animation is set for melee/ranged/magic/heal/dive;
    // contact never enters this state.
    if (attack.animation != null) {
      this.playLogical(attack.animation);
    }
  }

  // Resets gravity to the pre-teleport state and clears the phase flag.
  // Called from the appear-complete path and from interrupt paths
  // (enterHurtState / enterDeadState) so a hurt-cancelled teleport doesn't
  // leave the boss permanently hovering. Resume mirrors the pause issued at
  // teleport-start so the body-movement sequence continues mid-clip on the
  // far side of the teleport. Death interrupts the resume immediately via
  // unregisterEntityAudio below — a one-frame audible blip is acceptable
  // and avoids leaving the playlist permanently paused if any future code
  // path bypasses unregisterEntityAudio.
  private endTeleport(): void {
    if (this.teleportRestoreGravity) {
      this.body.setAllowGravity(true);
      this.teleportRestoreGravity = false;
    }
    this.teleportPhase = null;
    resumeEntitySoundSequence(this);
  }

  // Reactive teleport triggered by GameScene when the player fires a
  // projectile within behavior.dodgeOnProjectile.triggerRangePx. Picks one of
  // the entity's own `type: 'teleport'` attacks (the existing gap-closers)
  // and enters its attack state — the gap-closer's disappear → appear →
  // strike sequence runs as if the AI loop had picked it, landing the boss
  // next to the player. No-ops when disabled, on cooldown, mid-teleport,
  // or in a non-actionable enemyState (dead / hurt). Bypasses the chosen
  // attack's own recastCooldownMs so the boss can always respond.
  notifyPlayerProjectileFired(originX: number, originY: number): void {
    const cfg = this.behavior.dodgeOnProjectile;
    if (!cfg) return;
    if (this.enemyState === 'dead' || this.enemyState === 'hurt') return;
    if (this.teleportPhase !== null) return;
    if (this.scene.time.now < this.projectileReactionReadyAt) return;
    const dx = originX - this.x;
    const dy = originY - this.y;
    if (dx * dx + dy * dy > cfg.triggerRangePx * cfg.triggerRangePx) return;
    const teleport = this.pickProjectileReactionTeleport();
    if (!teleport) return;
    this.projectileReactionReadyAt = this.scene.time.now + cfg.cooldownMs;
    // enterAttackState clears attack guards, sets currentAttack, and (for
    // teleport) suspends gravity + plays the disappear clip. Calling it
    // here overrides whatever state the boss is currently in.
    this.enterAttackState(teleport);
  }

  // Picks a teleport attack from the pool for a projectile reaction.
  // Prefers entries currently off recastCooldownMs but falls back to any
  // teleport so the projectile reaction itself bypasses the recast — the
  // block's own `cooldownMs` is the throttle.
  private pickProjectileReactionTeleport(): AnimatedEntityAttackConfig | null {
    const teleports = this.attacks.filter((a) => a.type === 'teleport');
    if (teleports.length === 0) return null;
    const now = this.scene.time.now;
    const offRecast = teleports.filter(
      (a) => (this.attackReadyAt.get(a) ?? 0) <= now,
    );
    const pool = offRecast.length > 0 ? offRecast : teleports;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Phase 1 → 2 transition for teleport attacks. Ground-projects from the
  // cached player position down to the first solid tile so the boss lands at
  // a known reference point — attack.targetOffsetY applies on top (negative
  // = above ground for falling-strike framings; 0 = on ground). body.reset
  // zeroes velocity and re-anchors physics in one call — safer than
  // setPosition for a teleport because it also clears any residual hurt
  // knockback the body may carry.
  //
  // Branches on `appearAnimation`:
  //   - Set (three-phase): the reappear clip lands ELEVATED by one body-height
  //     above the strike target so the boss's body sits where the strike
  //     clip's frame 0 visually places it (strike artwork typically shows the
  //     boss raised in the frame for a falling/diving attack). The body is
  //     then repositioned back down to the strike target inside
  //     beginTeleportStrike.
  //   - Unset (two-phase legacy): the strike clip plays directly at the
  //     strike target (used by e.g. The_tarnished_widow whose teleport_appear
  //     IS the damage clip).
  private beginTeleportAppear(attack: AnimatedEntityAttackConfig): void {
    if (attack.animation == null) return;
    const player = this.playerRef;
    if (player !== null) {
      const offsetY = attack.targetOffsetY ?? DEFAULT_TELEPORT_OFFSET_Y;
      const destX = this.clampArenaX(player.x);
      const groundY = this.findGroundY(destX, player.body.bottom);
      const strikeBodyBottom = groundY + offsetY;

      // Three-phase only: shift the reappear up by one body-height when the
      // strike clip is a slam-style framing (boss in mid-air at frame 0,
      // falling into the target during the appear clip). Opt-in via
      // `appearElevated`. Default: land at ground level — correct for
      // ground-stance follow-ups like attack2/attack3.
      const landingBodyBottom =
        attack.appearAnimation != null && attack.appearElevated === true
          ? strikeBodyBottom - this.config.physicsBody.height
          : strikeBodyBottom;

      // Solve for sprite.y so body.bottom lands at landingBodyBottom. The
      // distance between sprite.y and body.bottom depends on the current
      // animation's anchor + body size; capture it from the live body so
      // entities whose body sits low in an oversized frame (e.g. the heart
      // hoarder) compute correctly. A small drift remains because the next
      // animation's ANIMATION_START re-anchors the body, but matching frame
      // sizes between the disappear/appear/strike clips keeps that to a
      // pixel or two.
      const bodyBottomToSpriteY = this.body.bottom - this.y;
      const destY = landingBodyBottom - bodyBottomToSpriteY;
      this.body.reset(destX, destY);
      // Face the player on landing so the next clip's hitbox (mirrored by
      // facingDirection in fireMeleeAttack) is oriented toward them.
      this.facingDirection = player.x >= this.x ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }
    if (attack.appearAnimation != null) {
      // Three-phase: play the visual reappear clip; its ANIMATION_COMPLETE
      // handler will call beginTeleportStrike to launch the damage clip.
      // No attackFired reset here — this clip carries no damage frame.
      this.teleportPhase = 'appear';
      this.playLogical(attack.appearAnimation);
      return;
    }
    // Two-phase legacy: jump straight to the strike clip.
    this.beginTeleportStrike(attack);
  }

  // Phase 2 → 3 (three-phase) or Phase 1 → 2 (two-phase) transition: plays
  // the damage-bearing `animation` at the destination. Clears the attackFired
  // guard so the strike clip's damage frame can fire.
  //
  // Three-phase + appearElevated only: repositions the body DOWN to the strike
  // target — the reappear placed us elevated by one body-height (so its visual
  // matched the slam strike's frame 0 body position); now we land where the
  // strike's damage hitboxes and the recover-to-floor are configured to be.
  // When appearElevated is false the reappear already landed on the ground, so
  // no body snap is needed (and snapping would just re-floor a body already
  // on the floor).
  private beginTeleportStrike(attack: AnimatedEntityAttackConfig): void {
    if (attack.animation == null) return;
    if (attack.appearAnimation != null && attack.appearElevated === true) {
      const player = this.playerRef;
      if (player !== null) {
        const offsetY = attack.targetOffsetY ?? DEFAULT_TELEPORT_OFFSET_Y;
        const destX = this.x;
        const groundY = this.findGroundY(destX, player.body.bottom);
        const strikeBodyBottom = groundY + offsetY;
        const bodyBottomToSpriteY = this.body.bottom - this.y;
        const destY = strikeBodyBottom - bodyBottomToSpriteY;
        this.body.reset(destX, destY);
      }
    }
    this.teleportPhase = 'strike';
    this.attackFired = false;
    this.firedMeleeHitboxes.clear();
    this.firedAoeDamageFrames.clear();
    this.playLogical(attack.animation);
  }

  // Walks downward tile-by-tile from `startY` at column `x` to find the first
  // solid collision tile, returning that tile's top edge in world space (the
  // surface a body.bottom can rest on). Falls back to `startY` when nothing
  // solid is found within 48 tiles (player is over a pit). Mirrors the
  // groundProjectVfx loop in fireAoeAttack so both paths agree on what
  // "ground beneath the player" means.
  //
  // No +1 on startTileY: when the player is grounded their body.bottom sits
  // exactly on the tile boundary (e.g. y=80 = top of tile 5), and Math.floor
  // already maps that to the floor tile (5). Skipping ahead would land us in
  // the tile *below* the floor and we'd report its top (= the floor's bottom)
  // as the ground — placing the widow inside the floor by one tile.
  private findGroundY(x: number, startY: number): number {
    const helper = this.scene as unknown as EnemyHelperScene;
    const TILE_SIZE = 16;
    const startTileY = Math.floor(startY / TILE_SIZE);
    const maxTiles = 48;
    for (let i = 0; i < maxTiles; i++) {
      const probeY = (startTileY + i) * TILE_SIZE + TILE_SIZE / 2;
      if (helper.isTileSolidAt(x, probeY)) {
        return (startTileY + i) * TILE_SIZE;
      }
    }
    return startY;
  }

  // Sets body velocity so the entity travels straight to the player's
  // current position over the duration of the dive animation. Uses the
  // registered Phaser anim's duration (frameCount × ms-per-frame) — the
  // anim must already exist in the scene since registerAllEntityAnimations
  // ran in PreloadScene.create() long before any AI tick.
  private applyDiveVelocity(attack: AnimatedEntityAttackConfig): void {
    if (!this.playerRef || attack.animation == null) return;
    const fullKey = entityAnimFullKey(this.getIdentifier(), attack.animation);
    const anim = this.scene.anims.get(fullKey);
    const durationMs = anim?.duration ?? 0;
    if (durationMs <= 0) return;
    const dx = this.playerRef.x - this.x;
    const dy = this.playerRef.y - this.y;
    // Phaser body velocity is px/s; durationMs is ms — convert.
    this.setVelocityX((dx * 1000) / durationMs);
    this.setVelocityY((dy * 1000) / durationMs);
  }

  private enterIdle(): void {
    this.enemyState = 'idle';
    this.currentAttack = null;
    if (!this.behavior.immovable) {
      this.body.setVelocityX(0);
      if (!this.body.allowGravity) this.body.setVelocityY(0);
    }
    this.playAmbientAnimation();
    setEnemyWalkSoundEnabled(this, false);
  }

  // The animation to display when the entity has no committed action.
  // Loiter-capable entities (airborne with walkAnimation) use walk so a
  // crow doesn't hold its grounded idle pose mid-air; everything else
  // falls back to the registry's defaultAnimation, mirroring its
  // original semantics so partial-anim entities (e.g. The_hive uses
  // 'take_off' as its resting pose) keep working.
  private playAmbientAnimation(): void {
    if (this.canLoiter()) {
      const walkAnim = this.attacks[0]?.walkAnimation;
      if (walkAnim) {
        this.playLogical(walkAnim);
        return;
      }
    }
    this.playLogical(this.config.defaultAnimation);
  }

  // Returns x clamped so a body of this entity's width centered there fits
  // inside spawnLevelBounds. Used by the teleport destination math so a
  // player standing at the far edge of an adjacent level can't pull the boss
  // out of its arena. Returns x unchanged when no arena is configured.
  private clampArenaX(x: number): number {
    const bounds = this.spawnLevelBounds;
    if (!bounds) return x;
    const halfWidth = this.body.width / 2;
    const minCenterX = bounds.worldX + halfWidth;
    const maxCenterX = bounds.worldX + bounds.pxWid - halfWidth;
    return Phaser.Math.Clamp(x, minCenterX, maxCenterX);
  }

  // Pulls the body back inside spawnLevelBounds when chase/knockback/teleport
  // has carried it past either side edge. Y is left alone — the level rect
  // includes the floor and ceiling, so vertical clamping would fight the
  // physics floor for grounded entities. Velocity is zeroed at the side that
  // would push the body further out so the next tick doesn't immediately
  // re-cross. No-op when the boss didn't opt into stayInSpawnLevel.
  private clampToArena(): void {
    const bounds = this.spawnLevelBounds;
    if (!bounds) return;
    const halfWidth = this.body.width / 2;
    const minCenterX = bounds.worldX + halfWidth;
    const maxCenterX = bounds.worldX + bounds.pxWid - halfWidth;
    if (this.body.center.x < minCenterX) {
      this.body.x = minCenterX - halfWidth;
      if (this.body.velocity.x < 0) this.body.setVelocityX(0);
    } else if (this.body.center.x > maxCenterX) {
      this.body.x = maxCenterX - halfWidth;
      if (this.body.velocity.x > 0) this.body.setVelocityX(0);
    }
  }

  // Routes the "nothing to commit to right now" outcome. Airborne enemies
  // with a walkAnimation enter loiter (drift around the player playing
  // walk) so they don't freeze in a grounded idle pose mid-air; everything
  // else falls back to the regular idle.
  private enterIdleOrLoiter(player: Player): void {
    if (this.canLoiter()) {
      if (this.enemyState !== 'loiter') {
        this.enterLoiter(player);
      }
      this.updateLoiter(player);
      return;
    }
    if (this.enemyState !== 'idle') {
      this.enterIdle();
    }
  }

  // Gate for loiter eligibility. Two distinct paths:
  //   - LDtk-authored patrol: any non-immovable enemy with a walkAnimation
  //     and moveSpeed on its lead attack can walk its loiterPath, regardless
  //     of gravity. Grounded enemies steer X only; airborne steer X and Y.
  //   - Player-anchored drift (legacy): gravity-off airborne enemies without
  //     a path still drift around the player so they don't freeze mid-air.
  // Immovable airborne entities (e.g. the_hive) are excluded — they're
  // anchored to their spawn.
  private canLoiter(): boolean {
    if (this.behavior.immovable) return false;
    const lead = this.attacks[0];
    if (!lead) return false;
    if (lead.walkAnimation == null || lead.moveSpeed == null) return false;
    if (this.loiterPath) return true;
    return !this.body.allowGravity;
  }

  private enterLoiter(player: Player): void {
    this.enemyState = 'loiter';
    this.currentAttack = null;
    const walkAnim = this.attacks[0]?.walkAnimation;
    if (walkAnim) this.playLogical(walkAnim);
    setEnemyWalkSoundEnabled(this, true);
    if (this.loiterPath) {
      // Snap to the nearest waypoint so the entity resumes patrol from where
      // a chase/knockback left it, rather than stubbornly walking back to a
      // stale index. Direction is preserved across re-entries so the sweep
      // pattern stays consistent.
      this.pathIndex = this.findNearestWaypointIndex();
    } else {
      this.pickLoiterTarget(player);
    }
  }

  private updateLoiter(player: Player): void {
    if (this.loiterPath) {
      this.updatePathLoiter();
      return;
    }
    const lead = this.attacks[0];
    const chaseRange = lead?.chaseRange;
    if (chaseRange != null) {
      const engagementRange = chaseRange * LOITER_ENGAGEMENT_CHASE_MULTIPLIER;
      const distToPlayer = Math.hypot(
        player.x - this.x,
        player.y - this.y,
      );
      if (distToPlayer > engagementRange) {
        this.body.setVelocity(0, 0);
        return;
      }
    }
    const dx = this.loiterTargetX - this.x;
    const dy = this.loiterTargetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (
      this.scene.time.now >= this.loiterRefreshAt ||
      dist < LOITER_TARGET_REACHED_DIST
    ) {
      this.pickLoiterTarget(player);
    }
    const moveSpeed = lead?.moveSpeed;
    if (moveSpeed == null || dist === 0) {
      this.body.setVelocity(0, 0);
      return;
    }
    const speed = moveSpeed * LOITER_SPEED_MULTIPLIER;
    this.setVelocityX((dx / dist) * speed);
    // Horizontal-locked airborne bosses (heart hoarder) drift only along X
    // — the Y component of the player-anchored loiter target is ignored so
    // the boss stays at its current elevation.
    this.setVelocityY(this.behavior.horizontalMovementOnly ? 0 : (dy / dist) * speed);
  }

  // Walks the entity toward loiterPath[pathIndex]. On arrival, advances the
  // index in pathDirection; flips direction at the endpoints (ping-pong).
  // Grounded enemies (gravity on) only steer X — gravity carries Y, and the
  // jump-over-obstacle logic from the chase path is also reused here so a
  // bandit on a stepped patrol can hop short walls between waypoints.
  // Movement uses lead.moveSpeed (no LOITER_SPEED_MULTIPLIER): authored
  // patrols should look purposeful, not drifty.
  private updatePathLoiter(): void {
    const path = this.loiterPath;
    if (!path) return;
    const lead = this.attacks[0];
    const moveSpeed = lead?.moveSpeed;
    if (moveSpeed == null) {
      this.body.setVelocity(0, 0);
      return;
    }

    const target = path[this.pathIndex];
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    // Arrival check differs by mode: airborne uses 2D so the entity stops
    // when it reaches the waypoint in any direction; grounded uses X-only
    // because gravity parks the body at the floor regardless of the
    // waypoint's authored Y, so a 2D check would never resolve when the
    // waypoint cell-center sits above floor level. Horizontal-locked
    // airborne bodies (heart hoarder) likewise stay at their own Y, so
    // the same X-only rule applies — a 2D check would never resolve.
    const arrived =
      this.body.allowGravity || this.behavior.horizontalMovementOnly
        ? Math.abs(dx) < LOITER_TARGET_REACHED_DIST
        : Math.hypot(dx, dy) < LOITER_TARGET_REACHED_DIST;

    if (arrived) {
      this.advancePathIndex();
      return;
    }

    // Face the direction of travel so the sprite flips at endpoints rather
    // than walking backwards. update() locks facing while attacking so this
    // only runs while we're actually loitering.
    this.facingDirection = dx >= 0 ? 1 : -1;
    this.setFacing(this.facingDirection === -1);

    if (this.body.allowGravity) {
      // Ground patrol: only steer X. Reuses the chase code's obstacle hop so
      // a step or low wall between waypoints isn't a hard stop.
      if (this.shouldJumpOverObstacle()) {
        this.setVelocityY(ENEMY_JUMP_VELOCITY);
      }
      this.setVelocityX(moveSpeed * this.facingDirection);
    } else if (this.behavior.horizontalMovementOnly) {
      // Airborne but horizontal-locked patrol: steer X toward the waypoint
      // and ignore its Y. Lets a heart-hoarder-style boss use an authored
      // path without drifting vertically between waypoints.
      this.setVelocityX(Math.sign(dx) * moveSpeed);
      this.setVelocityY(0);
    } else {
      // Airborne patrol: head straight toward the waypoint in 2D.
      const dist = Math.hypot(dx, dy);
      this.setVelocityX((dx / dist) * moveSpeed);
      this.setVelocityY((dy / dist) * moveSpeed);
    }
  }

  // Ping-pong increment: bumps pathIndex by pathDirection, flipping when
  // either endpoint would overflow. A two-point path produces 0→1→0→1…;
  // longer paths sweep end-to-end.
  private advancePathIndex(): void {
    if (!this.loiterPath) return;
    const lastIndex = this.loiterPath.length - 1;
    let next = this.pathIndex + this.pathDirection;
    if (next > lastIndex || next < 0) {
      this.pathDirection = (this.pathDirection * -1) as 1 | -1;
      next = this.pathIndex + this.pathDirection;
    }
    this.pathIndex = next;
  }

  // Picks the waypoint index closest to the entity's current position. Used
  // when (re)entering loiter so the entity resumes patrol from the nearest
  // point on the route — keeps the chase→recover→patrol transition smooth.
  private findNearestWaypointIndex(): number {
    const path = this.loiterPath;
    if (!path || path.length === 0) return 0;
    let bestIndex = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < path.length; i++) {
      const dx = path[i].x - this.x;
      const dy = path[i].y - this.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private pickLoiterTarget(player: Player): void {
    const radius =
      LOITER_TARGET_MIN_RADIUS +
      Math.random() * (LOITER_TARGET_MAX_RADIUS - LOITER_TARGET_MIN_RADIUS);
    const angle =
      LOITER_ANGLE_MIN +
      Math.random() * (LOITER_ANGLE_MAX - LOITER_ANGLE_MIN);
    this.loiterTargetX = player.x + Math.cos(angle) * radius;
    this.loiterTargetY = player.y + Math.sin(angle) * radius;
    this.loiterRefreshAt =
      this.scene.time.now +
      LOITER_REFRESH_MIN_MS +
      Math.random() * (LOITER_REFRESH_MAX_MS - LOITER_REFRESH_MIN_MS);
  }

  private enterDeadState(): void {
    this.enemyState = 'dead';
    this.currentAttack = null;
    // Same teleport-state cleanup as enterHurtState — a killing blow during
    // a teleport leaves the corpse falling under restored gravity instead
    // of hovering at the appear position.
    this.endTeleport();
    // Cut any spatial loops and periodic schedulers this enemy owns at the
    // moment of death. The sprite itself sticks around for the death anim,
    // but a corpse shouldn't keep flapping its wings, cawing, or buzzing.
    // Covers both the sprite-keyed moving anchors and the iid-keyed static
    // anchors (e.g. the hive's bee buzz).
    unregisterEntityAudio(this, this.iid);
    // Zero both axes so a corpse plays its death anim in place. Gravity-on
    // corpses still fall to the floor (gravity re-applies downward velocity
    // every tick); gravity-off corpses (crows, wasps) actually need Y zeroed
    // too — without it, a crow killed mid-ascent keeps drifting up while
    // playing its death animation. Body stays collidable with terrain so
    // gravity-on corpses settle on the floor instead of tunneling through.
    // Damage interactions are already gated by isDead() at every call site
    // (applyContactDamage, sword overlaps, projectile overlaps).
    this.setVelocity(0, 0);
    const deathAnim = this.behavior.deathAnimation ?? 'death';
    const played = this.playLogical(deathAnim);
    if (!played) {
      // No death animation registered — destroy immediately so the corpse
      // doesn't linger on its last hurt/idle frame forever. Spawn the ammo
      // drop here (rather than on animation-complete) so this short-circuit
      // path doesn't silently skip loot. Fire the explosion now too: the
      // frame-trigger path can't run without an animation timeline to
      // listen on, so falling through here would silently drop the AoE.
      this.maybeTriggerDeathExplosion();
      this.maybeSpawnAmmoDrop();
      this.destroy();
    }
  }

  // Applies the configured death-explosion AoE damage burst, if any. Called
  // from onAnimUpdate when the death animation reaches the configured frame,
  // and from enterDeadState's no-anim fallback when no death animation is
  // registered. Hits the player and every other live Enemy whose body center
  // sits inside the radius; self is excluded so the dying entity doesn't
  // double-tick its own death. sourceIsPlayer:false on the enemy damage path
  // keeps unrelated enemies from flipping into combat (and revealing their
  // HP bar) from a third-party blast. Chain explosions are intentional — a
  // hive caught inside another hive's blast will trigger its own burst when
  // its own death frame lands. Latched via deathExplosionFired so the
  // frame-trigger path can't double-fire on a re-emitted ANIMATION_UPDATE.
  private maybeTriggerDeathExplosion(): void {
    if (this.deathExplosionFired) return;
    const explosion = this.behavior.deathExplosion;
    if (!explosion) return;
    this.deathExplosionFired = true;
    const cx = this.body.center.x;
    const cy = this.body.center.y;
    const r = explosion.radius;
    const bodies = this.scene.physics.overlapRect(
      cx - r,
      cy - r,
      r * 2,
      r * 2,
      true,
      false,
    ) as Phaser.Physics.Arcade.Body[];
    const rSq = r * r;
    for (const body of bodies) {
      const obj = body.gameObject;
      if (obj === this) continue;
      // overlapRect uses the axis-aligned bounding rect; reject targets
      // whose body center sits outside the inscribed circle so a corner
      // of the square AOI doesn't reach further than authored.
      const dx = body.center.x - cx;
      const dy = body.center.y - cy;
      if (dx * dx + dy * dy > rSq) continue;
      if (obj instanceof Player) {
        if (obj.isDead()) continue;
        obj.hurt(explosion.damage, cx, cy);
        continue;
      }
      if (obj instanceof Enemy) {
        if (obj.isDead()) continue;
        obj.takeDamage(explosion.damage, cx, cy, { sourceIsPlayer: false });
      }
    }
  }

  // Rolls each entry in the enemy's `drops` array (if any) and asks the scene
  // to spawn a pickup per successful roll, at the corpse's current body center.
  // Called from both death paths: (a) the death-anim ANIMATION_COMPLETE
  // handler, and (b) the no-death-anim short-circuit in enterDeadState above.
  // Body center is cached into locals before any destroy() so the spawn
  // position survives even if the call site destroys this sprite immediately
  // after.
  private maybeSpawnAmmoDrop(): void {
    const drops = this.config.drops;
    if (!drops || drops.length === 0) return;
    const spawnX = this.body.center.x;
    const spawnY = this.body.center.y;
    const spawner = this.scene as unknown as AmmoDropSpawnerScene;
    for (const dropConfig of drops) {
      const kind = rollDrop(dropConfig);
      if (!kind) continue;
      spawner.spawnAmmoDrop(kind, spawnX, spawnY);
    }
  }

  // Per-frame attack-animation hook: fires the configured damage frame
  // exactly once per swing. Gated on enemyState so a hurt-interrupt or
  // death mid-attack short-circuits without applying damage.
  //
  // Also drives animation-frame audio triggers from
  // animationSoundTriggers.json — independent of attack state so hurt/idle
  // anims could carry audio too. firedTriggers gates each trigger to one
  // play per anim run; ANIMATION_START clears it.
  private onAnimUpdate(
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
      const sound = playOneShot(this.scene, trigger.soundId, seekSec, this);
      if (sound !== null && trigger.stopOnAnimComplete) {
        this.activeTriggerSounds.push(sound);
      }
      this.firedTriggers.add(fireKey);
    }

    // Death-explosion AoE frame trigger. Fires once when the death animation
    // reaches behavior.deathExplosion.frame (0-indexed), aligning damage with
    // the visible blast peak rather than the first frame of the death anim.
    // Gated on enemyState='dead' + the death anim's full key so a non-death
    // animation reaching the same numeric frame index can't fire the burst.
    // Self-latching via deathExplosionFired inside maybeTriggerDeathExplosion.
    if (
      this.enemyState === 'dead' &&
      this.behavior.deathExplosion &&
      !this.deathExplosionFired
    ) {
      const deathAnimKey = this.behavior.deathAnimation ?? 'death';
      const deathFullKey = entityAnimFullKey(this.getIdentifier(), deathAnimKey);
      if (
        animation.key === deathFullKey &&
        frame.index >= this.behavior.deathExplosion.frame
      ) {
        this.maybeTriggerDeathExplosion();
      }
    }

    if (this.enemyState !== 'attack') return;
    const attack = this.currentAttack;
    if (!attack || attack.animation == null) return;
    const expectedKey = entityAnimFullKey(this.getIdentifier(), attack.animation);
    if (animation.key !== expectedKey) return;

    // Melee fires hitbox-by-hitbox: each hitbox stamps its rect on its own
    // frame (defaulting to attack.frame), so a single swing can deliver
    // damage at multiple points (e.g., body slam on frame 17, follow-up
    // sword strike on frame 21). Per-hitbox `firedMeleeHitboxes` guards
    // against double-fires if ANIMATION_UPDATE re-emits the same frame.
    // Teleport attacks share this path so a teleport-then-strike can use
    // the same multi-frame multi-hitbox semantics (the appear clip plays
    // here; disappear-clip frames are filtered out by the animation-key
    // check above).
    if (
      (attack.type === 'melee' || attack.type === 'teleport') &&
      attack.hitboxes
    ) {
      const damage = attack.damage;
      if (damage == null) return;
      for (let i = 0; i < attack.hitboxes.length; i++) {
        if (this.firedMeleeHitboxes.has(i)) continue;
        const hb = attack.hitboxes[i];
        const targetFrame = hb.frame ?? attack.frame ?? 0;
        if (frame.index < targetFrame) continue;
        this.firedMeleeHitboxes.add(i);
        this.fireSingleMeleeHitbox(hb, damage);
      }
      return;
    }

    // Multi-frame AoE: each entry in `damageFrames` fires its own
    // independent damage rect once per swing. Walks the sorted list in
    // ascending order and fires every frame ≤ current that hasn't fired
    // yet, so a missed ANIMATION_UPDATE for one frame doesn't skip damage
    // — the catch-up runs on the next tick. Per-frame tracking lives in
    // `firedAoeDamageFrames` (cleared on attack entry / interrupt).
    if (attack.type === 'aoe' && attack.damageFrames) {
      for (const damageFrame of attack.damageFrames) {
        if (this.firedAoeDamageFrames.has(damageFrame)) continue;
        if (frame.index < damageFrame) break;
        this.firedAoeDamageFrames.add(damageFrame);
        this.fireAttackEffect(attack);
      }
      return;
    }

    // Non-melee attacks remain single-event: one fireAttackEffect call
    // per swing, gated by `attackFired`.
    if (this.attackFired) return;
    if (attack.frame == null) return;
    if (frame.index < attack.frame) return;
    this.fireAttackEffect(attack);
    this.attackFired = true;
  }

  private onAnimStart(animation: Phaser.Animations.Animation): void {
    this.firedTriggers.clear();
    this.stopActiveTriggerSounds();
    if (isTeleportAnimationKey(animation.key)) {
      pauseEntitySoundSequence(this);
    }
  }

  // Looping animations don't re-fire ANIMATION_START on each cycle, so per-
  // step triggers (footsteps, beat impacts) authored with repeatPerLoop:true
  // need their fired-flag reset here to fire again on the next loop. Triggers
  // that omit the flag stay fired so long body-ambience clips (e.g. the
  // widow's machinery layer on idle/walk) don't restack every 0.75s.
  private onAnimRepeat(animation: Phaser.Animations.Animation): void {
    const triggers = getTriggersFor(animation.key);
    for (const trigger of triggers) {
      if (trigger.repeatPerLoop) {
        this.firedTriggers.delete(`${animation.key}:${trigger.name}`);
      }
    }
  }

  // Stops and discards any trigger-spawned sounds marked
  // stopOnAnimComplete. playOneShot's own COMPLETE handler will destroy
  // them once stop() fires; we just drop our refs.
  private stopActiveTriggerSounds(): void {
    for (const sound of this.activeTriggerSounds) {
      if (sound.isPlaying || sound.isPaused) sound.stop();
    }
    this.activeTriggerSounds = [];
  }

  private onAnimComplete(animation: Phaser.Animations.Animation): void {
    this.stopActiveTriggerSounds();
    if (isTeleportAnimationKey(animation.key)) {
      resumeEntitySoundSequence(this);
    }
    if (this.enemyState === 'dead') {
      const deathAnim = this.behavior.deathAnimation ?? 'death';
      const deathFullKey = entityAnimFullKey(this.getIdentifier(), deathAnim);
      if (animation.key === deathFullKey) {
        this.maybeSpawnAmmoDrop();
        this.destroy();
      }
      return;
    }

    const attack = this.currentAttack;
    // Teleport disappear → appear/strike: when the disappear clip ends,
    // reposition the body to the destination and either play the visual
    // reappear clip (three-phase) or jump directly to the strike clip
    // (two-phase). Returns early so the standard "attack animation complete
    // → recover" branch below doesn't run on the disappear clip.
    if (
      this.enemyState === 'attack' &&
      attack &&
      attack.type === 'teleport' &&
      this.teleportPhase === 'disappear' &&
      attack.disappearAnimation != null
    ) {
      const disappearFullKey = entityAnimFullKey(
        this.getIdentifier(),
        attack.disappearAnimation,
      );
      if (animation.key === disappearFullKey) {
        this.beginTeleportAppear(attack);
        return;
      }
    }
    // Teleport appear → strike (three-phase only): when the visual reappear
    // clip ends, launch the damage-bearing strike clip. Returns early so the
    // standard "attack animation complete → recover" branch doesn't run on
    // the reappear clip (the strike clip hasn't played yet).
    if (
      this.enemyState === 'attack' &&
      attack &&
      attack.type === 'teleport' &&
      this.teleportPhase === 'appear' &&
      attack.appearAnimation != null
    ) {
      const appearFullKey = entityAnimFullKey(
        this.getIdentifier(),
        attack.appearAnimation,
      );
      if (animation.key === appearFullKey) {
        this.beginTeleportStrike(attack);
        return;
      }
    }
    if (this.enemyState === 'attack' && attack && attack.animation != null) {
      const attackFullKey = entityAnimFullKey(this.getIdentifier(), attack.animation);
      if (animation.key === attackFullKey) {
        // Teleport strike phase ended: restore gravity before falling through
        // to the shared recover transition so the boss drops naturally.
        if (attack.type === 'teleport') {
          this.endTeleport();
        }
        this.enemyState = 'recover';
        this.cooldownUntil = this.scene.time.now + attack.cooldownMs;
        this.currentAttack = null;
        this.playAmbientAnimation();
        // Seed a fresh loiter target so the recover-window movement aims
        // somewhere sensible. Path-walkers re-snap to the nearest waypoint
        // (so the entity walks the patrol during cooldown instead of
        // homing on a stale faraway index from before the chase). The
        // legacy random-drift path picks a new player-anchored point so
        // the crow doesn't backtrack to a stale target.
        if (this.canLoiter()) {
          if (this.loiterPath) {
            this.pathIndex = this.findNearestWaypointIndex();
          } else if (this.playerRef) {
            this.pickLoiterTarget(this.playerRef);
          }
        }
      }
    }
  }

  // Dispatch to the appropriate per-frame effect for the in-flight attack.
  // Contact attacks never reach here (they don't enter attack state); the
  // remaining types are the ones validated to have animation + frame.
  // Dive is also not routed here — its damage path is the per-tick
  // applyDiveContact, not a frame-gated effect.
  private fireAttackEffect(attack: AnimatedEntityAttackConfig): void {
    if (attack.type === 'melee') {
      this.fireMeleeAttack(attack);
      return;
    }
    if (attack.type === 'heal') {
      this.applyHeal(attack);
      return;
    }
    if (attack.type === 'aoe') {
      this.fireAoeAttack(attack);
      return;
    }
    if (attack.type === 'teleport') {
      // Teleport's damage frame lives inside the appear clip and uses the
      // same transient rect as melee. fireMeleeAttack reads hitbox + damage
      // directly off the attack config — no special-case needed.
      this.fireMeleeAttack(attack);
      return;
    }
    // ranged / magic — same delivery, different art
    this.fireProjectileAttack(attack);
  }

  // Dive damage delivery: runs every tick of an in-flight 'dive' from the
  // attack-state branch in update(). Caller already gated on attackFired so
  // we only need to check overlap. Sets attackFired on hit so the same
  // dive can't multi-tick — even if the player keeps overlapping the body
  // (e.g. they didn't move out of the way), the damage applies once and
  // the player's invuln window absorbs the rest. Dive that misses (no
  // overlap before the animation ends) simply deals no damage.
  private applyDiveContact(player: Player): void {
    const attack = this.currentAttack;
    if (!attack || attack.type !== 'dive') return;
    const damage = attack.damage;
    if (damage == null) return;
    if (!this.scene.physics.world.overlap(this, player)) return;
    player.hurt(damage, this.x, this.y);
    this.attackFired = true;
  }

  // AoE damage delivery: snapshots the player's position at the damage
  // frame and spawns a one-shot VFX sprite there. The VFX has its own
  // body and an overlap collider against the player; first overlap deals
  // damage once. When the VFX's animation completes, the sprite and
  // overlap collider both clean themselves up — independent of the boss's
  // lifetime, so a boss-death mid-cast still resolves the in-flight
  // strike. Origin is derived from the registry anchor so the VFX
  // visually centers on the strike point (matches AnimatedEntity's
  // anchor convention without needing to instantiate one).
  private fireAoeAttack(attack: AnimatedEntityAttackConfig): void {
    if (!this.playerRef) return;
    const vfxKey = attack.vfxAnimation;
    const damage = attack.damage;
    if (damage == null) return;

    // Opt-in dodge window: bosses with requireGroundedTarget set on their
    // AoE skip the strike entirely if the player is airborne at the damage
    // frame. The wind-up animation already played — this is the reward for
    // a well-timed jump. Damage is bundled into the VFX overlap below, so
    // skipping spawn skips damage too.
    //
    // minAirborneDodgeClearancePx refines the binary check: airborne alone
    // isn't enough — the player's feet must clear the nearest ground tile
    // below them by at least this many pixels. Small hops still get hit.
    if (attack.requireGroundedTarget) {
      const onGround =
        this.playerRef.body.blocked.down ||
        this.playerRef.body.touching.down;
      if (!onGround) {
        const minClearance = attack.minAirborneDodgeClearancePx;
        if (minClearance === undefined) return;
        const helper = this.scene as unknown as EnemyHelperScene;
        const TILE_SIZE = 16;
        const playerBottom = this.playerRef.body.bottom;
        const playerX = this.playerRef.x;
        // Probe one tile below the player's feet downward, matching the
        // groundProjectVfx tile-walk pattern. No ground within 48 tiles ⇒
        // treat as infinite clearance (player is over a pit and clearly
        // out of reach of a ground-based strike).
        const startTileY = Math.floor(playerBottom / TILE_SIZE) + 1;
        const maxTiles = 48;
        let groundY = playerBottom + maxTiles * TILE_SIZE;
        for (let i = 0; i < maxTiles; i++) {
          const probeY = (startTileY + i) * TILE_SIZE + TILE_SIZE / 2;
          if (helper.isTileSolidAt(playerX, probeY)) {
            groundY = (startTileY + i) * TILE_SIZE;
            break;
          }
        }
        const clearance = groundY - playerBottom;
        if (clearance >= minClearance) return;
      }
    }

    // Sky-cover check for volley-style AoEs (e.g. arrow rain). Casts straight
    // up from the player's head; if any solid tile sits in the 128 px column
    // above them, the projectile is treated as blocked by overhead geometry
    // and the strike is suppressed. 128 px (8 tiles) leaves wide-open caverns
    // hittable while tunnels and low-ceiling corridors stay safe.
    if (attack.requireOpenSky) {
      const helper = this.scene as unknown as EnemyHelperScene;
      const headX = this.playerRef.x;
      const headY = this.playerRef.body.top;
      if (helper.isLineBlocked(headX, headY, headX, headY - 128)) return;
    }

    const strikeX = this.playerRef.x;
    // Anchor to the player's feet so the VFX's bottom-anchored frame
    // (e.g. attack3_vfx with anchorY near frameHeight) sits on the
    // ground rather than at the player's body center.
    let strikeY = this.playerRef.body.bottom;

    // Ground projection: walk downward tile-by-tile from the snapshotted
    // player position until a solid collision tile is found, then anchor
    // the VFX to the top of that tile. Keeps mid-jump strikes visually
    // grounded instead of popping into mid-air at the player's feet. If
    // nothing solid is found within the probe range (player over a pit),
    // strikeY falls back to body.bottom — VFX still spawns, just at the
    // player's air position rather than off-screen.
    if (attack.groundProjectVfx) {
      const helper = this.scene as unknown as EnemyHelperScene;
      const TILE_SIZE = 16;
      const startTileY = Math.floor(strikeY / TILE_SIZE);
      const maxTiles = 48;
      for (let i = 0; i < maxTiles; i++) {
        const probeY = (startTileY + i) * TILE_SIZE + TILE_SIZE / 2;
        if (helper.isTileSolidAt(strikeX, probeY)) {
          strikeY = (startTileY + i) * TILE_SIZE;
          break;
        }
      }
    }

    // Capture everything the spawn closure needs into locals so a delayed
    // call still works correctly if the enemy dies during the delay window
    // (consistent with the existing "boss-death mid-cast still resolves the
    // in-flight strike" guarantee).
    const scene = this.scene;
    const depth = this.depth;
    const vfxConfig = vfxKey != null ? this.config.animations[vfxKey] : null;
    const playerRef = this.playerRef;
    const delayMs = attack.vfxDelayMs ?? 0;

    // Sound is scheduled independently of the VFX spawn so its audible peak
    // can land on the first VFX frames even when the audio is front-loaded.
    // Lead is clamped to delayMs — the trigger fires at the damage frame and
    // we can't fire a sound before that.
    if (attack.vfxSoundId) {
      const soundId = attack.vfxSoundId;
      const lead = Math.min(attack.vfxSoundLeadMs ?? 0, delayMs);
      const soundOffsetMs = delayMs - lead;
      const strikeEmitter = { x: strikeX, y: strikeY };
      if (soundOffsetMs <= 0) {
        playOneShot(scene, soundId, 0, strikeEmitter);
      } else {
        scene.time.delayedCall(soundOffsetMs, () => {
          playOneShot(scene, soundId, 0, strikeEmitter);
        });
      }
    }

    // Sprite-less AoE: no vfxAnimation → no impact visual. Damage is
    // delivered by a single overlapRect at the snapshotted strike point
    // when the delay elapses. Box is sized to the player body plus a
    // small margin so a player who held position eats the hit, but one
    // who steps/jumps out during the delay dodges cleanly. Per-attack
    // damageHalfWidth / damageHalfHeight overrides tighten or widen the
    // dodge window (e.g. heart_hoarder attack3 uses a narrower rect so
    // a sidestep actually dodges the strike).
    const SPRITELESS_HALF_W = attack.damageHalfWidth ?? 24;
    const SPRITELESS_HALF_H = attack.damageHalfHeight ?? 32;
    const applySpritelessDamage = (): void => {
      const overlaps = scene.physics.overlapRect(
        strikeX - SPRITELESS_HALF_W,
        strikeY - SPRITELESS_HALF_H * 2,
        SPRITELESS_HALF_W * 2,
        SPRITELESS_HALF_H * 2,
        true,
        false,
      ) as Phaser.Physics.Arcade.Body[];
      const hurtSource = attack.hurtSource;
      for (const body of overlaps) {
        if (body.gameObject === playerRef) {
          playerRef.hurt(
            damage,
            strikeX,
            strikeY,
            hurtSource ? { source: hurtSource } : undefined,
          );
          return;
        }
      }
    };

    if (vfxKey == null) {
      if (delayMs > 0) {
        scene.time.delayedCall(delayMs, applySpritelessDamage);
      } else {
        applySpritelessDamage();
      }
      return;
    }

    const vfxFullKey = entityAnimFullKey(this.getIdentifier(), vfxKey);
    const spawnVfx = (): void => {
      const vfx = scene.physics.add.sprite(strikeX, strikeY, vfxFullKey);
      vfx.setDepth(depth);

      if (vfxConfig) {
        const originX =
          vfxConfig.anchorX != null
            ? vfxConfig.anchorX / vfxConfig.frameWidth
            : 0.5;
        const originY =
          vfxConfig.anchorY != null
            ? vfxConfig.anchorY / vfxConfig.frameHeight
            : 0.5;
        vfx.setOrigin(originX, originY);
        // displayScale is the resizer's primary tuning knob; apply it
        // explicitly because this VFX sprite isn't an AnimatedEntity and
        // doesn't go through applyAnimationAnchor where scale would
        // normally be set.
        if (vfxConfig.displayScale != null) {
          vfx.setScale(vfxConfig.displayScale);
        }
      }

      const vfxBody = vfx.body as Phaser.Physics.Arcade.Body;
      vfxBody.setAllowGravity(false);

      let damageDealt = false;
      const hurtSource = attack.hurtSource;
      const overlapCollider = scene.physics.add.overlap(
        vfx,
        playerRef,
        () => {
          if (damageDealt) return;
          playerRef.hurt(
            damage,
            strikeX,
            strikeY,
            hurtSource ? { source: hurtSource } : undefined,
          );
          damageDealt = true;
        },
      );

      const vfxFiredTriggers = new Set<string>();
      vfx.on(
        Phaser.Animations.Events.ANIMATION_UPDATE,
        (
          animation: Phaser.Animations.Animation,
          frame: Phaser.Animations.AnimationFrame,
        ) => {
          const triggers = getTriggersFor(animation.key);
          for (const trigger of triggers) {
            if (frame.index < trigger.frameIndex) continue;
            const fireKey = `${animation.key}:${trigger.name}`;
            if (vfxFiredTriggers.has(fireKey)) continue;
            const seekSec = trigger.audioStartOffsetMs
              ? trigger.audioStartOffsetMs / 1000
              : 0;
            playOneShot(scene, trigger.soundId, seekSec, vfx);
            vfxFiredTriggers.add(fireKey);
          }
        },
      );

      vfx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        overlapCollider.destroy();
        vfx.destroy();
      });
      vfx.play(vfxFullKey);
    };

    if (delayMs > 0) {
      scene.time.delayedCall(delayMs, spawnVfx);
    } else {
      spawnVfx();
    }
  }

  // Used by `teleport` attacks (single damage event on the appear clip's
  // frame). Iterates every configured hitbox in one pass — the per-frame
  // spreading that melee uses lives in `onAnimUpdate` so teleport isn't
  // forced to thread frame-state through its two-phase flow.
  private fireMeleeAttack(attack: AnimatedEntityAttackConfig): void {
    const hitboxes = attack.hitboxes;
    const damage = attack.damage;
    if (!hitboxes || damage == null) return;
    for (const hb of hitboxes) {
      if (this.fireSingleMeleeHitbox(hb, damage)) return;
    }
  }

  // Stamps a single transient rect at the configured offset (mirrored by
  // facing) and applies damage to the first player body it overlaps. Returns
  // true when a hit landed so callers can short-circuit further checks for
  // the same swing (damage applies once per cast even when several rects
  // overlap the player simultaneously).
  private fireSingleMeleeHitbox(
    hb: AnimatedEntityHitboxConfig,
    damage: number,
  ): boolean {
    let hx: number;
    let hy: number;
    let hw: number;
    let hh: number;
    if (hb.matchBody) {
      // Body-tracking hitbox: stamp directly at the live physics body's
      // world rect. Independent of facing (the body is already mirrored
      // by applyAnimationAnchor's flipX path) and independent of frame
      // anchor — useful for "swing lands on the boss body itself" hits.
      hx = this.body.x;
      hy = this.body.y;
      hw = this.body.width;
      hh = this.body.height;
    } else {
      const facing = this.facingDirection;
      hx =
        facing === 1
          ? this.x + hb.offsetX
          : this.x - hb.offsetX - hb.width;
      hy = this.y + hb.offsetY - hb.height / 2;
      hw = hb.width;
      hh = hb.height;
    }
    const overlaps = this.scene.physics.overlapRect(
      hx,
      hy,
      hw,
      hh,
      true,
      false,
    ) as Phaser.Physics.Arcade.Body[];
    for (const body of overlaps) {
      const obj = body.gameObject;
      if (obj instanceof Player) {
        obj.hurt(damage, this.x, this.y);
        return true;
      }
    }
    return false;
  }

  private fireProjectileAttack(attack: AnimatedEntityAttackConfig): void {
    if (!this.playerRef) return;
    const idleKey = attack.projectileAnimIdle;
    const explodeKey = attack.projectileAnimExplode;
    const speed = attack.projectileSpeed;
    const damage = attack.damage;
    if (
      idleKey == null ||
      explodeKey == null ||
      speed == null ||
      damage == null
    ) {
      return;
    }
    // Origin offsets default to 0 (sprite center). X mirrors with facing so a
    // staff/arm tip on the right side of the idle sprite still fires forward
    // when the entity is flipped to face left.
    const originOffsetX = (attack.projectileOriginX ?? 0) * this.facingDirection;
    const originOffsetY = attack.projectileOriginY ?? 0;
    const originX = this.x + originOffsetX;
    const originY = this.y + originOffsetY;
    const dx = this.playerRef.x - originX;
    const dy = this.playerRef.y - originY;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const vx = (dx / len) * speed;
    const vy = (dy / len) * speed;
    const helper = this.scene as unknown as EnemyHelperScene;
    helper.spawnEnemyProjectile({
      x: originX,
      y: originY,
      velocityX: vx,
      velocityY: vy,
      damage,
      idleAnimKey: entityAnimFullKey(this.getIdentifier(), idleKey),
      explodeAnimKey: entityAnimFullKey(this.getIdentifier(), explodeKey),
    });
  }

  // Self-cast HP restore on the heal animation's configured frame. Clamps
  // to behavior.health (max). Mirrors the takeDamage clamp at the bottom
  // edge so the boss can't over-heal beyond its registered cap.
  private applyHeal(attack: AnimatedEntityAttackConfig): void {
    const amount = attack.heal;
    if (amount == null) return;
    this.health = Math.min(this.behavior.health, this.health + amount);
  }

  // Iterates every contact-type entry and applies damage to the player on
  // body overlap, gated per-attack by cooldown. The player's own invuln
  // window absorbs the rest of the noise — without it, an enemy stuck
  // overlapping the player would tick every frame the cooldown allows.
  private applyContactDamage(player: Player): void {
    for (const attack of this.attacks) {
      if (attack.type !== 'contact') continue;
      const damage = attack.damage;
      if (damage == null) continue;
      const ready = this.contactCooldowns.get(attack) ?? 0;
      if (this.scene.time.now < ready) continue;
      if (!this.scene.physics.world.overlap(this, player)) continue;
      player.hurt(damage, this.x, this.y);
      this.contactCooldowns.set(
        attack,
        this.scene.time.now + attack.cooldownMs,
      );
    }
  }

  // Records the peak downward velocity each airborne frame; on the
  // airborne→grounded transition, converts it into impact damage. Airborne
  // entities (gravity:false — crows, wasps) opt out entirely. Damage
  // scales linearly past FALL_DAMAGE_VELOCITY_THRESHOLD so a hop over a
  // ledge is harmless but a multi-tile drop hurts.
  private trackFallDamage(): void {
    if (this.enemyState === 'dead') return;
    if (!this.body.allowGravity) return;

    const onGround = this.body.blocked.down || this.body.touching.down;
    if (!onGround) {
      this.wasAirborne = true;
      if (this.body.velocity.y > this.peakFallVelocity) {
        this.peakFallVelocity = this.body.velocity.y;
      }
      return;
    }
    if (
      this.wasAirborne &&
      this.peakFallVelocity > FALL_DAMAGE_VELOCITY_THRESHOLD
    ) {
      const damage = Math.floor(
        (this.peakFallVelocity - FALL_DAMAGE_VELOCITY_THRESHOLD) *
          FALL_DAMAGE_PER_VELOCITY,
      );
      if (damage > 0) {
        this.takeDamage(damage, this.x, this.y, {
          skipKnockback: true,
          sourceIsPlayer: false,
        });
      }
    }
    this.wasAirborne = false;
    this.peakFallVelocity = 0;
  }

  // True when a chasing ground enemy is standing in front of a wall ≤ 2
  // tiles tall and should hop over it. Gravity-off enemies skip this
  // entirely — they have no useful "jump" semantics. Sampling at
  // body.bottom - 8 avoids hitting the floor tile the enemy is standing
  // on; the +4 px offset ahead avoids self-collision with the body's own
  // bounding box. probeY - 32 (two tiles up + one tile clearance) must
  // be empty so a 3-tile wall is rejected.
  private shouldJumpOverObstacle(): boolean {
    if (!this.body.allowGravity) return false;
    if (!this.body.blocked.down) return false;
    const helper = this.scene as unknown as EnemyHelperScene;
    const aheadX =
      this.facingDirection === 1
        ? this.body.right + 4
        : this.body.left - 4;
    const probeY = this.body.bottom - 8;
    if (!helper.isTileSolidAt(aheadX, probeY)) return false;
    if (helper.isTileSolidAt(aheadX, probeY - 32)) return false;
    return true;
  }
}
