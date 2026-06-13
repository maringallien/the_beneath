import Phaser from 'phaser';
import {
  getTriggersFor,
  pauseEntitySoundSequence,
  playOneShot,
  resumeEntitySoundSequence,
  setEnemyWalkSoundEnabled,
  unregisterEntityAudio,
} from '../audio';
import {
  BOSS_DEFEATED_EVENT,
  BOSS_ROUND_BREAK_MS,
  ENEMY_ALERT_ICON_HOLD_MS,
  ENEMY_ALERT_SPEED_MUL,
  ENEMY_ALERT_STING_SOUND_ID,
  ENEMY_COMBAT_TIMEOUT_MS,
  ENEMY_CONFLICT_WINDOW_MS,
  ENEMY_DETECTION_RANGE_PX,
  ENEMY_HEALTH_MULTIPLIER,
  ENEMY_HUNT_SPEED_MUL,
  ENEMY_RETURN_POST_TIMEOUT_MS,
  ENEMY_SEARCH_FLIP_MS,
  ENEMY_SEARCH_LOOK_MS,
  ENEMY_SEARCH_REACH_DIST_PX,
  ENEMY_SEARCH_TRAVEL_TIMEOUT_MS,
  ENEMY_SPOT_STOP_MS,
  ENEMY_VISION_HALF_ANGLE_DEG,
  ENEMY_VISION_NEAR_RADIUS_PX,
  HOARDER_SEPARATION_MIN_DX_PX,
  HOARDER_SEPARATION_PUSH_SPEED,
  HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX,
  NAV_LOS_GRACE_MS,
  PLAYER_RUN_SPEED,
} from '../constants';
import type { LoiterPathPoint } from '../ldtk/types';
import { rollDrop } from './AmmoDrop';
import type { AmmoDropSpawnerScene } from './AmmoDropSpawnerScene';
import { AnimatedEntity } from './AnimatedEntity';
import { roundForRatio } from './bossRounds';
import { EnemyAlertIcon, type AlertGlyph } from './EnemyAlertIcon';
import {
  alertLevel,
  classifyAlert,
  isInDetectionCone,
  type AlertState,
} from './enemyDetection';
import type { EnemyHelperScene } from './enemyHelperScene';
import { EnemyNavFollower } from './EnemyNavFollower';
import {
  findLeapLanding,
  findWallMountLaunch,
  FOOTSTEP_TILE_PROBE_OFFSET_Y,
  hasReachablePlatformAhead,
  isBlockedByWall,
  isLedgeAhead,
  LEAP_PROBE_SAMPLE_PX,
  overheadEscapeDir,
  shouldJumpOverObstacle,
  TILE_PX,
  UP_LEAP_SCAN_REACH_PX,
  type LeapProbeContext,
} from './enemyLeapProbes';
import { EnemyHealthBar } from './EnemyHealthBar';
import {
  entityAnimFullKey,
  getEntityBehavior,
} from './entityRegistryLoader';
import type {
  AnimatedEntityAttackConfig,
  AnimatedEntityBehaviorConfig,
  AnimatedEntityGreetConfig,
  AnimatedEntityHitboxConfig,
  AnimatedEntityWanderConfig,
} from './entityRegistryTypes';
import { Player } from './Player';
import type { TeleportCoordinator } from './teleportCoordinator';

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
// uniform hurt window so a missing or short take_hit animation doesn't skip the flinch feedback
const HURT_DURATION_MS = 250;
// only multi-tile drops (≥3 tiles free-fall at 800 px/s² gravity) cross this threshold; short hops don't register
const FALL_DAMAGE_VELOCITY_THRESHOLD = 350;
const FALL_DAMAGE_PER_VELOCITY = 1 / 30;
// fallback encounter sting radius — roughly one screen-width, the "stepping into the arena" feel
const DEFAULT_ENCOUNTER_RADIUS = 300;
// fallback dormant wake range — under one screen-width so the bot wakes when plainly in view, not from across the arena
const DEFAULT_DORMANT_WAKE_RANGE = 220;
// Summon spawn placement: minions appear flanking the caster, alternating
// sides and stepping outward so a spawned pair doesn't stack on one pixel.
const SUMMON_SPAWN_OFFSET_X = 28;
const SUMMON_SPAWN_SPACING_X = 22;
// clears a 2-tile wall with a small buffer (v=√(2·g·h), g=800, h≈40px → -260)
const ENEMY_JUMP_VELOCITY = -260;
// minimum horizontal speed for any gap-leap — floored to the player's run speed so slow enemies still clear the same gaps
const ENEMY_LEAP_HORIZONTAL_SPEED = PLAYER_RUN_SPEED;
// how long a wedged chaser can make no headway before it shows the idle pose instead of running in place
const CHASE_STILL_GRACE_MS = 250;
// minimum displacement to count as "moving" — prevents wall-pinned jitter from refreshing the movement timestamp
const CHASE_MOVE_EPSILON_PX = 6;
// minimum height advantage before grounded chasers attempt an up-leap
const UP_LEAP_MIN_RISE_PX = 24;
// throttle for the overhang-escape leap search (~12 Hz) — expensive enough to cap, fast enough to catch the window
const UP_PROBE_INTERVAL_MS = 80;
// drift speed fraction for airborne loitering — slow enough to look organic, fast enough to track the player
const LOITER_SPEED_MULTIPLIER = 0.55;
const LOITER_TARGET_MIN_RADIUS = 30;
const LOITER_TARGET_MAX_RADIUS = 60;
// default Y offset above ground for teleport landing — 5 tiles of headroom so a falling-strike appear clip doesn't clip the player early
const DEFAULT_TELEPORT_OFFSET_Y = -80;
// beyond chaseRange × this factor the airborne enemy hovers in place instead of drifting in from across the map
const LOITER_ENGAGEMENT_CHASE_MULTIPLIER = 4;
// upper hemisphere sweep [-3π/4, -π/4] so drift targets sit above and around the player
const LOITER_ANGLE_MIN = -Math.PI * 0.75;
const LOITER_ANGLE_MAX = -Math.PI * 0.25;
// full-circle sweep for home-anchored wasps — the hive can be anywhere so orbit it evenly
const HOME_LOITER_ANGLE_MIN = -Math.PI;
const HOME_LOITER_ANGLE_MAX = Math.PI;
// leash hysteresis — wasp only re-engages when the player re-enters this fraction of the radius, preventing flip-flopping at the edge
const HOME_LEASH_REENGAGE_FACTOR = 0.85;
const LOITER_REFRESH_MIN_MS = 1500;
const LOITER_REFRESH_MAX_MS = 3000;
// arrival threshold — repick when this close so the crow doesn't stutter on a past-overshot target
const LOITER_TARGET_REACHED_DIST = 12;
// patrol dwell cadence — randomized stroll/pause intervals so the back-and-forth never looks mechanical
const PATH_WALK_INTERVAL_MIN_MS = 2500;
const PATH_WALK_INTERVAL_MAX_MS = 5500;
const PATH_PAUSE_DURATION_MIN_MS = 700;
const PATH_PAUSE_DURATION_MAX_MS = 1800;
// default wander radius for grounded path-less non-boss enemies; behavior.wander.radius overrides this
const DEFAULT_WANDER_RADIUS = 200;
// Minimum step (px) between consecutive wander targets so a fresh pick is never
// so close it "arrives" instantly and stutters the stroller in place.
const WANDER_MIN_TARGET_STEP_PX = 24;
// symmetric 4-tile climb/drop limit so a stroller can always climb back out and never triggers fall damage
const WANDER_LEAP_MAX_RISE_PX = 64;
const WANDER_LEAP_MAX_DROP_PX = 64;
// higher than chase jump ceiling so a stroller can top a 4-tile platform; findLeapLanding still starts from the minimum
const WANDER_MAX_LAUNCH_VELOCITY = -380;
// tiny greeting bob impulse — about a 9 px pop so it reads as a friendly bounce, not a real jump
const GREET_HOP_VELOCITY = -120;
// Spacing (ms) between a greeter's successive bobs. It only actually launches
// when grounded, so this is a floor on the cadence, not an exact period.
const GREET_HOP_INTERVAL_MS = 240;
// ~5 Hz scan throttle keeps the O(enemy count) partner search off the per-frame path
const GREET_SCAN_INTERVAL_MS = 200;
// tight vertical band so a partner one platform up is never treated as "beside", even though wanderers now leap several tiles
const GREET_SAME_FLOOR_PX = 12;
// per-instance speed spread so a same-frame wave desyncs into a staggered pack rather than a lockstep blob
const CHASE_SPEED_JITTER = 0.18;
// perpendicular weave so airborne swarms fly in independent arcs — sideways fraction preserves the forward closing speed
const AIRBORNE_WEAVE_FRACTION = 0.4;
const AIRBORNE_WEAVE_FREQ_MIN = 2.2; // rad/s
const AIRBORNE_WEAVE_FREQ_MAX = 4.0; // rad/s
// range multiplier for combo chaining only — the opener's knockback shoves the player outside strict range, so the chain gets slack
const COMBO_FOLLOWUP_RANGE_TOLERANCE = 2;

// anim suffixes that pause an entity's ambience loop during teleport and resume it on clip-end
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

// LDtk intgrid values (kept in sync with Player.ts by hand — they're schema constants, not runtime data)
const INTGRID_GROUND_VALUE = 1;
const INTGRID_BRIDGE_VALUE = 2;

// per-spawn overrides for the boss self-copy system — inherits registry behavior but ships with low HP and no damage
export interface EnemySpawnOverrides {
  // deals no damage and is invisible to boss/round-fight systems — used for self-copies
  readonly harmless?: boolean;
  // Overrides the computed max (and starting) health. Lets a copy be low-HP
  // without needing a separate registry entry.
  readonly maxHealth?: number;
  // X offset from player.x when chasing; gives each self-copy a distinct slot so they don't all stack
  readonly chaseStandoffX?: number;
  // shared coordinator for the self-copy group's one-at-a-time teleport gate and separation pass
  readonly attackCoordinator?: TeleportCoordinator;
}

/**
 * Enemy — the enemy/boss AI state machine and combat actor.
 *
 * An AnimatedEntity that gains health, damage, and a registry behavior block,
 * and runs the per-frame AI: idle/loiter, chase (grounded with wall-hop /
 * gap-leap / wall-mount locomotion, or airborne 2D homing), the stealth
 * detection→search→return-to-post loop, and the attack cycle. Attack types
 * are melee (transient overlapRect hitboxes), ranged/magic (an aimed or
 * straight EnemyProjectile), contact (body-overlap, no animation), dive,
 * aoe (a VFX sprite or sprite-less rect at the player's feet), teleport
 * (disappear→appear→strike blink), heal (self-cast below an HP fraction), and
 * summon. Multi-attack bosses authored with `attackPool` pick a weighted-random
 * eligible attack per cycle. Round-fight bosses add the 3-round freeze/banner
 * mechanic and a self-copy split coordinated for one-teleport-at-a-time and
 * lateral de-stacking. A persistent active-combat (aggro) window — not mere
 * range — leashes pursuit and drives the alert HUD.
 *
 * Inputs:  scene, spawn x/y, identifier, LDtk iid, an optional authored
 *          loiterPath, and optional per-spawn overrides; the live Player each
 *          frame; the registry behavior/attack config; the EnemyHelperScene's
 *          tile/level/projectile/summon queries.
 * Outputs: mutates its own body (velocity/facing/position), plays animations
 *          and spatial audio, stamps damage rects / spawns projectiles, drives
 *          the floating HP bar + overhead alert glyph, and emits
 *          BOSS_DEFEATED_EVENT on a boss death.
 * @calledby the gameplay scene — spawned at level load (and on respawn),
 *           ticked every frame, and poked by the boss-fight, gunshot-hearing,
 *           hive-defense, and projectile-dodge systems.
 * @calls    the shared audio layer, the leap probes / nav follower locomotion
 *           helpers, the detection helpers, and the scene's tile/projectile/
 *           summon services.
 */
export class Enemy extends AnimatedEntity {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly behavior: AnimatedEntityBehaviorConfig;
  // LDtk instance id — used to key and tear down static entitySounds anchors on death
  private readonly iid: string;
  // LDtk placement coords so the respawn manager rebuilds at the right spot even after knockback/gravity drift
  private readonly spawnX: number;
  private readonly spawnY: number;
  // flat attack list from registry; chase fields (chaseRange, moveSpeed, etc.) read from attacks[0]
  private readonly attacks: ReadonlyArray<AnimatedEntityAttackConfig>;
  // authored HP × ENEMY_HEALTH_MULTIPLIER (regular enemies); bosses keep the raw authored value
  private readonly maxHealth: number;
  private health: number;
  private enemyState: EnemyState = 'idle';
  // Wall-clock timestamp at which the post-attack recover window ends. Set
  // when an attack animation completes; used to gate the next attack cycle.
  private cooldownUntil = 0;
  // 1=right, -1=left; locked at attack entry so hitboxes match the animation direction
  private facingDirection: 1 | -1 = 1;
  // pending hurt-exit timer; re-armed on each hit so stacked hits extend the stagger instead of cutting it short
  private hurtTimer: Phaser.Time.TimerEvent | null = null;
  // latched true on the first damage frame so non-melee attacks don't fire twice; melee uses firedMeleeHitboxes instead
  private attackFired = false;
  // tracks which hitbox indices have already fired this swing to prevent double-hits
  private firedMeleeHitboxes = new Set<number>();
  // tracks which AoE damage frames have already fired this swing (parallel to firedMeleeHitboxes)
  private firedAoeDamageFrames = new Set<number>();
  // the in-flight attack; null at rest — animation handlers read this, not behavior.attacks, since bosses have many
  private currentAttack: AnimatedEntityAttackConfig | null = null;
  // which leg of a teleport is playing: disappear → (appear) → strike; null when not teleporting
  private teleportPhase: 'disappear' | 'appear' | 'strike' | null = null;
  // whether gravity was on before the teleport so it can be re-enabled on the other side
  private teleportRestoreGravity = false;
  // cooldown before the boss can dodge-teleport again; stamped on trigger so burst fire can't lock the boss
  private projectileReactionReadyAt = 0;
  // per-attack cooldown timestamps so body-contact entries don't tick-storm the player
  private readonly contactCooldowns = new Map<
    AnimatedEntityAttackConfig,
    number
  >();
  // per-attack recast timestamps so heavy signature moves don't monopolise the random pick
  private readonly attackReadyAt = new Map<
    AnimatedEntityAttackConfig,
    number
  >();
  // "animKey:triggerName" entries already fired this play; cleared on start/repeat so loops re-arm
  private readonly firedTriggers = new Set<string>();
  // sounds that must stop when the triggering animation ends rather than playing out
  private activeTriggerSounds: Phaser.Sound.BaseSound[] = [];
  // cached player reference so async animation handlers can aim; null before the first update tick
  private playerRef: Player | null = null;
  // peak downward velocity while airborne; converted to damage on landing (airborne entities never accrue this)
  private peakFallVelocity = 0;
  private wasAirborne = false;
  // committed leap direction; locked at takeoff so mid-air player movement doesn't redirect the arc
  private leapDirX: 1 | -1 | 0 = 0;
  // movement bookkeeping for the chase idle/walk swap — anchor + timestamp track real progress, animMoving avoids restarts
  private chaseAnchorX = 0;
  private chaseAnchorY = 0;
  private chaseMovedAt = 0;
  private chaseAnimMoving = false;
  // timestamp of the last overhang-escape probe so it runs at ~12 Hz, not every frame
  private lastUpProbeAt = 0;
  // walk-out direction when stranded under a platform; held so the AI doesn't immediately walk back under
  private escapeDirX: 1 | -1 | 0 = 0;
  private escapeFromX = 0;
  // latched true once the boss intro sting fires so it plays exactly once per instance
  private encounterTriggered = false;
  // when the boss may start engaging; +Infinity until the encounter trigger fires, then now+engageDelayMs
  private engageReadyAt: number;
  // current drift destination; repicked on entry, on expiry, or on arrival
  private loiterTargetX = 0;
  private loiterTargetY = 0;
  private loiterRefreshAt = 0;
  // hive anchor point; wasps orbit this rather than the player, and chase is leashed around it
  private homeAnchorX: number | null = null;
  private homeAnchorY: number | null = null;
  // true while the wasp has broken off chase; player must come back inside the hysteresis ring to re-engage
  private leashBroken = false;
  // while in the future, the wasp ignores its leash and pursues anywhere (hive under attack)
  private homeAlarmUntil = 0;
  // LDtk-authored patrol waypoints; null falls back to random drift (airborne) or idle (grounded)
  private readonly loiterPath: ReadonlyArray<LoiterPathPoint> | null;
  // index of the waypoint being headed toward; snapped to nearest on loiter re-entry after a chase
  private pathIndex = 0;
  // ping-pong direction along the patrol path; flips at each endpoint
  private pathDirection: 1 | -1 = 1;
  // patrol dwell timers — pathPauseUntil > now means parked; nextPathPauseAt is when the next dwell starts
  private pathPauseUntil = 0;
  private nextPathPauseAt = 0;
  // authored wander config (radius, greet); wanderTargetX is the stroll target; wanderWalkAnimOn avoids redundant anim swaps
  private readonly wanderConfig: AnimatedEntityWanderConfig | null;
  private wanderTargetX = 0;
  private wanderWalkAnimOn = false;
  // greeting state: greetUntil > now = active; hopsLeft/nextHopAt pace the bobs; nextGreetAt/nextGreetScanAt throttle retries
  private greetUntil = 0;
  private greetFacing: 1 | -1 = 1;
  private greetHopsLeft = 0;
  private greetNextHopAt = 0;
  private nextGreetAt = 0;
  private nextGreetScanAt = 0;
  // LDtk level rect captured at spawn; bosses clamp movement and teleport destinations to this arena
  private readonly spawnLevelBounds: {
    readonly worldX: number;
    readonly worldY: number;
    readonly pxWid: number;
    readonly pxHei: number;
  } | null;
  // floating HP bar; null for attack-less or hideHealthBar entities
  private readonly healthBar: EnemyHealthBar | null;
  // true once the player has hit this enemy; bar only appears when the player engages first
  private inCombat = false;
  // when the combat window expires and HP is restored; refreshed each hit; 0 = not in combat
  private combatTimeoutAt = 0;
  // aggro window expiry; while in the future the enemy pursues past chaseRange regardless of the aggressive flag; 0 = calm
  private aggroUntil = 0;
  // while in the future, LOS is bypassed and the enemy chases through walls (boss convergence pass); 0 = normal
  private convergeUntil = 0;
  // ── Stealth / detection ──────────────────────────────────────────────────
  // persistent awareness state driving the HUD brackets; the overhead glyph is a separate transient escalation flash
  private alertState: AlertState = 'normal';
  // previous frame's state so escalation edges flash the glyph exactly once
  private prevAlertState: AlertState = 'normal';
  // cached LOS result so the chase/search branches don't re-raycast
  private lastVisible = false;
  // last-seen player position; search heads here, not to the live player (no wall-tracking)
  private lastSeenX = 0;
  private lastSeenY = 0;
  private hasLastSeen = false;

  // ── A* nav path-following (NavGraph / NavPathfinder) ──────────────────────
  // route state lives in the follower; Enemy drives steering + LOS-grace; shared by chase and search
  private readonly nav = new EnemyNavFollower();
  // grace window so a brief LOS flash (jump apex) doesn't discard the active route
  private navHoldUntil = 0;
  // resolved detection range and cone half-angle (authored override or global default, computed once)
  private readonly detectionRange: number;
  private readonly visionHalfAngleRad: number;
  // chase-speed multiplier when alert (authored override or global default)
  private readonly alertSpeedMul: number;
  // opts out of the cone/glyph/HUD detection system; uses legacy always-on aggro instead (wasps)
  private readonly ignoresStealth: boolean;
  // while in the future, the enemy reads as red "!" conflict; refreshed each attack/contact
  private conflictUntil = 0;
  // holds the enemy still for the "stop and show ?" beat before it rushes; 0 = not stopped
  private investigateStopUntil = 0;
  // momentary overhead glyph and when it auto-hides; separate from the persistent HUD brackets
  private iconGlyph: AlertGlyph = 'none';
  private iconHideAt = 0;
  // ── Search-after-losing-sight (last-seen hunt + return to post) ───────────
  // deadline for reaching the last-seen spot before bailing to the look-around; 0 = not hunting
  private searchTravelUntil = 0;
  // when the look-around scan ends; armed on arrival at the last-seen spot
  private searchLookUntil = 0;
  // when to flip facing during the look-around scan
  private searchNextFlipAt = 0;
  // true while walking back to the spawn post after giving up the hunt
  private returningToPost = false;
  // deadline + best-dist for the return walk; pushed out on progress so a wedged return settles in place rather than pacing
  private returnPostDeadline = 0;
  private returnPostBestDist = Infinity;
  // overhead "?"/"!" glyph widget; null for attack-less NPCs
  private alertIcon: EnemyAlertIcon | null = null;
  // latched true once the death-explosion fires so the animation path and no-anim fallback can't double-fire
  private deathExplosionFired = false;
  // highest round reached (1-based, never decreases) so heals can't rewind the banner or re-fire it
  private roundReached = 1;
  // while in the future the boss is frozen invulnerable for the "Round N" cinematic beat; 0 = no break
  private roundBreakUntil = 0;
  // harmless copies deal no damage and are invisible to boss/HUD/round-break systems
  private readonly harmless: boolean;
  // X offset added to the player position when chasing so self-copies flank rather than pile on the same point
  private readonly chaseStandoffX: number;
  // shared coordinator for the boss self-copy group; enforces one-teleport-at-a-time and separation
  private teleportCoordinator: TeleportCoordinator | null;
  // per-instance movement personality so same-frame packs desync into a staggered swarm (bosses get mul=1, weave=0)
  private readonly chaseSpeedMul: number;
  private readonly weavePhase: number;
  private readonly weaveFreq: number;
  // dormant = sleeping until spotted; waking = wake clip playing; dormantWakeAnim cached to skip re-reads each tick
  private dormant = false;
  private waking = false;
  private readonly dormantWakeAnim: string | null;
  // live minions from summon attacks; pruned before each cast to enforce summonMaxAlive
  private activeSummons: Enemy[] = [];

  // builds the enemy from its registry entry — HP, attacks, detection, movement personality, HP bar, alert glyph, and animation event hooks
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    identifier: string,
    iid: string,
    loiterPath: ReadonlyArray<LoiterPathPoint> | null = null,
    spawnOverrides: EnemySpawnOverrides | null = null,
  ) {
    super(scene, x, y, identifier);
    this.iid = iid;
    this.spawnX = x;
    this.spawnY = y;
    // one-waypoint paths become spawn ↔ point ping-pong; multi-waypoint paths use what was authored
    if (loiterPath && loiterPath.length === 1) {
      this.loiterPath = [{ x, y }, loiterPath[0]];
    } else if (loiterPath && loiterPath.length >= 2) {
      this.loiterPath = loiterPath;
    } else {
      this.loiterPath = null;
    }
    const behavior = getEntityBehavior(identifier);
    if (!behavior) {
      // EntityFactory should never route here without a behavior block; if it does, the factory is broken
      throw new Error(
        `Enemy: identifier "${identifier}" has no behavior block — should have been spawned as AnimatedEntity`,
      );
    }
    this.behavior = behavior;
    // only the explicitly authored config; default wander for other grounded enemies is resolved live in wanderRadius()
    this.wanderConfig = behavior.wander ?? null;
    this.dormantWakeAnim = behavior.dormant?.wakeAnimation ?? null;
    this.harmless = spawnOverrides?.harmless === true;
    this.chaseStandoffX = spawnOverrides?.chaseStandoffX ?? 0;
    // copies join the coordinator at construction; the boss joins later via setTeleportCoordinator
    this.teleportCoordinator = spawnOverrides?.attackCoordinator ?? null;
    if (this.teleportCoordinator) {
      this.teleportCoordinator.register(this);
    }
    // bake per-instance personality so siblings in the same wave desync
    this.chaseSpeedMul = 1 + (Math.random() * 2 - 1) * CHASE_SPEED_JITTER;
    this.weavePhase = Math.random() * Math.PI * 2;
    this.weaveFreq =
      AIRBORNE_WEAVE_FREQ_MIN +
      Math.random() * (AIRBORNE_WEAVE_FREQ_MAX - AIRBORNE_WEAVE_FREQ_MIN);
    // per-spawn override wins; bosses keep authored HP; everyone else gets the global multiplier applied
    this.maxHealth =
      spawnOverrides?.maxHealth ??
      (behavior.isBoss === true
        ? behavior.health
        : Math.round(behavior.health * ENEMY_HEALTH_MULTIPLIER));
    this.health = this.maxHealth;
    // attackPool wins when both are set — the schema treats `attack` as the
    // single-attack shorthand. Empty list is valid (passive enemies).
    this.attacks =
      behavior.attackPool ??
      (behavior.attack ? [behavior.attack] : []);

    // sight range falls back to attacks[0].chaseRange, then the global default
    this.detectionRange =
      behavior.detectionRange ??
      this.attacks[0]?.chaseRange ??
      ENEMY_DETECTION_RANGE_PX;
    this.visionHalfAngleRad = Phaser.Math.DegToRad(
      behavior.visionHalfAngleDeg ?? ENEMY_VISION_HALF_ANGLE_DEG,
    );
    this.alertSpeedMul = behavior.alertSpeedMul ?? ENEMY_ALERT_SPEED_MUL;
    this.ignoresStealth = behavior.ignoresStealth === true;

    if (behavior.immovable) {
      // no gravity or knockback for immovable entities (e.g. the hive)
      this.body.setAllowGravity(false);
      this.body.setImmovable(true);
    }

    // capture spawn level rect so clampToArena and teleport clamps work each tick; only for stayInSpawnLevel bosses
    if (behavior.stayInSpawnLevel) {
      const helper = scene as unknown as EnemyHelperScene;
      this.spawnLevelBounds = helper.getLevelBoundsAt(x, y);
    } else {
      this.spawnLevelBounds = null;
    }

    // +Infinity keeps the boss frozen until the encounter trigger fires; 0 disables the gate for everyone else
    this.engageReadyAt =
      behavior.engageDelayMs !== undefined
        ? Number.POSITIVE_INFINITY
        : 0;

    // round-fight bosses use BossHud instead (suppressing the bar also disables the 20 s combat-timeout heal);
    // harmless copies get a bar anyway since BossHud ignores them
    if (
      behavior.hideHealthBar !== true &&
      (behavior.roundFight !== true || this.harmless) &&
      this.attacks.length > 0
    ) {
      this.healthBar = new EnemyHealthBar(scene, behavior.healthBarOffsetY ?? 0);
    } else {
      this.healthBar = null;
    }

    // glyph for fighters only; wasps are exempt (ignoresStealth); harmless copies keep it to read as alerted
    this.alertIcon =
      this.attacks.length > 0 && !this.ignoresStealth
        ? new EnemyAlertIcon(scene)
        : null;

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

    // skip dormant for harmless copies (fight-ready immediately) and path walkers (patrol beats sleeping)
    if (behavior.dormant && !this.harmless && !this.loiterPath) {
      this.dormant = true;
      this.holdDormantPose();
    }

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hurtTimer) {
        this.hurtTimer.remove(false);
        this.hurtTimer = null;
      }
      this.stopActiveTriggerSounds();
      // Graphics/Text objects aren't auto-destroyed with the sprite; reclaim them manually
      this.healthBar?.destroy();
      this.alertIcon?.destroy();
    });
  }

  // Current hit points (live, not max).
  getHealth(): number {
    return this.health;
  }

  // Current AI state-machine state.
  getState(): EnemyState {
    return this.enemyState;
  }

  // The resolved registry behavior block this enemy was built from.
  getBehavior(): AnimatedEntityBehaviorConfig {
    return this.behavior;
  }

  // True once the enemy has entered its terminal dead state.
  isDead(): boolean {
    return this.enemyState === 'dead';
  }

  // Stable LDtk instance id. Same iid is reused when the respawn manager
  // rebuilds this enemy so iid-keyed audio anchors line back up.
  getIid(): string {
    return this.iid;
  }

  // World X this enemy was constructed at (its respawn anchor).
  getSpawnX(): number {
    return this.spawnX;
  }

  // World Y this enemy was constructed at (its respawn anchor).
  getSpawnY(): number {
    return this.spawnY;
  }

  // Authored patrol route in world-space px (null when unset). The respawn
  // manager forwards this so the rebuilt enemy resumes the same path.
  getLoiterPath(): ReadonlyArray<LoiterPathPoint> | null {
    return this.loiterPath;
  }

  // true for real bosses; harmless copies return false so their death can't trigger a premature win
  isBoss(): boolean {
    return this.behavior.isBoss === true && !this.harmless;
  }

  // True when this boss uses the 3-round fight system (screen-wide segmented
  // bar + "Round N" banner + per-threshold freeze). Drives GameScene/BossHud.
  isRoundFight(): boolean {
    return this.behavior.roundFight === true && !this.harmless;
  }

  // authored health × ENEMY_HEALTH_MULTIPLIER (bosses keep the raw value)
  getMaxHealth(): number {
    return this.maxHealth;
  }

  // Current latched round (1-based). Stays at 1 for non-round-fight enemies.
  getRound(): number {
    return this.roundReached;
  }

  // true once the player stepped into the encounter radius; gates the round UI
  hasEncountered(): boolean {
    return this.encounterTriggered;
  }

  // true while the aggro window is live (blows traded / attack committed); drives boss convergence swarm
  isInConflict(): boolean {
    return this.isAggro();
  }

  // true while the "Round N" freeze is live; projectile overlaps are skipped during this window
  isInRoundBreak(): boolean {
    return this.roundBreakUntil > this.scene.time.now;
  }

  // registry displayName or a derived version (strip "_spawn", underscores → spaces, capitalize)
  getDisplayName(): string {
    return this.behavior.displayName ?? this.deriveDisplayName();
  }

  // Fallback display name from the identifier: drop a trailing "_spawn",
  // underscores → spaces, capitalize; "Boss" if nothing remains.
  private deriveDisplayName(): string {
    const words = this.getIdentifier()
      .replace(/_spawn$/, '')
      .replace(/_/g, ' ')
      .trim();
    return words.length > 0
      ? words.charAt(0).toUpperCase() + words.slice(1)
      : 'Boss';
  }

  // true during disappear/appear clips; projectiles pass through and reactions are suppressed to avoid re-trigger loops
  isInTeleportBlink(): boolean {
    return this.teleportPhase === 'disappear' || this.teleportPhase === 'appear';
  }

  // main per-frame AI tick — runs the whole state machine from cleanup through detection, attack selection, and locomotion
  update(player: Player): void {
    // body is null after destroy; guard so stale array entries don't throw
    if (!this.active || !this.body) return;

    // enemies knocked off a ledge fall forever; destroy them when they clear the world bottom
    const worldBottom = this.scene.physics.world.bounds.bottom;
    if (this.body.top > worldBottom + 200) {
      this.destroy();
      return;
    }

    // run unconditionally so a mid-fall hit still records peak velocity and applies impact on landing
    this.trackFallDamage();

    this.clampToArena();

    // run above the dead/hurt return so the timeout still ticks and the bar hides correctly on death
    this.maybeExitCombat();
    if (this.healthBar) {
      this.healthBar.setAnchor(this.body.center.x, this.body.top);
      this.healthBar.setVisible(
        this.inCombat && !this.isInTeleportBlink() && !this.isDead(),
      );
    }

    if (this.enemyState === 'dead' || this.enemyState === 'hurt') {
      // clear glyph/state on death so the HUD brackets don't stay lit for a corpse
      if (this.enemyState === 'dead') {
        this.alertState = 'normal';
        this.prevAlertState = 'normal';
        this.iconGlyph = 'none';
        this.alertIcon?.setGlyph('none');
      }
      return;
    }

    this.applyHoarderSeparation();

    // round break: hold position and skip all AI until the freeze lapses
    if (this.roundBreakUntil > 0) {
      if (this.scene.time.now < this.roundBreakUntil) {
        if (!this.behavior.immovable) {
          this.body.setVelocityX(0);
          if (!this.body.allowGravity) this.body.setVelocityY(0);
        }
        return;
      }
      this.roundBreakUntil = 0;
      this.enterIdle();
    }

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    // dormant entities hold their sleep pose and run no AI until the player comes in range and in LOS
    if (this.dormant) {
      if (!this.behavior.immovable) {
        this.body.setVelocityX(0);
        if (!this.body.allowGravity) this.body.setVelocityY(0);
      }
      if (this.waking) return; // wake clip is mid-play; wait for it to finish
      const wakeRange = this.behavior.dormant?.range ?? DEFAULT_DORMANT_WAKE_RANGE;
      const helper = this.scene as unknown as EnemyHelperScene;
      if (
        this.dormantWakeAnim != null &&
        dist <= wakeRange &&
        !helper.isLineBlocked(this.x, this.y, player.x, player.y)
      ) {
        // Face the player as it wakes so the first attack points the right way.
        this.facingDirection = dx >= 0 ? 1 : -1;
        this.setFacing(this.facingDirection === -1);
        this.waking = true;
        this.playLogical(this.dormantWakeAnim);
      }
      return;
    }

    // fires once when the player enters the engagement zone; arena bosses use the level rect, others use 2D radius
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
        // harmless copies share the registry entry but must stay silent or every copy blares the sting
        if (this.behavior.encounterSoundId !== undefined && !this.harmless) {
          playOneShot(this.scene, this.behavior.encounterSoundId);
        }
        if (this.behavior.engageDelayMs !== undefined) {
          this.engageReadyAt =
            this.scene.time.now + this.behavior.engageDelayMs;
        }
        this.encounterTriggered = true;
      }
    }

    // attack-less characters (spirit walkers) just patrol/idle and return; no chase or fight logic
    if (this.attacks.length === 0) {
      this.enterIdleOrLoiter(player);
      return;
    }

    this.playerRef = player;

    // contact attacks run before the state machine so a wasp damages even while recovering
    this.applyContactDamage(player);

    // resolve LOS/detection this frame so facing and chase logic read an up-to-date alert state
    this.updateAlertState(player, dx, dist);

    // movement code owns facing in normal/search; lock during an attack so the hitbox matches the animation
    if (this.enemyState !== 'attack' && this.shouldFacePlayer()) {
      this.facingDirection = dx >= 0 ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }

    if (this.enemyState === 'recover') {
      if (this.scene.time.now < this.cooldownUntil) {
        // path-walkers in conflict hold still through the cooldown; airborne entities keep drifting so they don't freeze mid-air
        if (this.isAggro() && this.loiterPath) {
          if (!this.behavior.immovable) {
            this.body.setVelocityX(0);
            if (!this.body.allowGravity) this.body.setVelocityY(0);
          }
        } else if (this.canLoiter()) {
          this.updateLoiter(player);
        }
        return;
      }
      this.enterIdle();
      // Fall through so a player still in range triggers a fresh attack
      // this same tick rather than burning a frame in idle.
    }

    if (this.enemyState === 'attack') {
      const isDive = this.currentAttack?.type === 'dive';
      // zero velocity during the swing; dive attacks carry the velocity set at entry so skip the zero
      if (!this.behavior.immovable && !isDive) {
        this.setVelocityX(0);
        if (!this.body.allowGravity) this.setVelocityY(0);
      }
      if (isDive && !this.attackFired) {
        this.applyDiveContact(player);
      }
      return;
    }

    // hold in idle (velocity zeroed) until the engage window opens; gates both attack and loiter
    if (this.scene.time.now < this.engageReadyAt) {
      if (this.enemyState !== 'idle') {
        this.enterIdle();
      } else if (!this.behavior.immovable) {
        // zero residual velocity so contact-attack side effects don't drift the boss during the delay
        this.body.setVelocityX(0);
        if (!this.body.allowGravity) this.body.setVelocityY(0);
      }
      return;
    }

    // ── Stealth/detection gates ───────────────────────────────────────────
    // 1. fresh spot: hold still and show "?" before rushing (the stop-then-rush tell)
    if (
      this.isStealthEnabled() &&
      this.isAggro() &&
      this.scene.time.now < this.investigateStopUntil
    ) {
      if (this.enemyState !== 'idle') this.enterIdle();
      return;
    }
    // 2. lost sight while aware → hunt the last-seen spot; returns before attack-picking so it can't swing blind
    if (this.isSearching()) {
      this.updateSearch(player);
      return;
    }
    // 3. gave up the hunt — walk back to spawn post before resuming idle
    if (this.isReturningToPost()) {
      this.updateReturnToPost();
      return;
    }
    // 4. oblivious — neither attacks nor chases; player can slip past within range
    if (this.isStealthEnabled() && !this.isAggro()) {
      this.enterIdleOrLoiter(player);
      return;
    }

    const pick = this.pickAttack(dist);
    if (pick) {
      // ranged/magic need LOS; melee commits through walls (short range + wall-hugging exploit risk)
      const losBlocked =
        (pick.type === 'ranged' || pick.type === 'magic') &&
        (this.scene as unknown as EnemyHelperScene).isLineBlocked(
          this.x,
          this.y,
          player.x,
          player.y,
        );
      if (!losBlocked) {
        this.enterAttackState(pick);
        return;
      }
      // walled off: out of conflict stay put; in conflict chase to find a clear line
      if (!this.isAggro()) {
        this.enterIdleOrLoiter(player);
        return;
      }
    }

    // no usable attack — try to chase; chase fields live on attacks[0]
    const chaseLead = this.attacks[0];
    const canMove =
      chaseLead.moveSpeed != null && !this.behavior.immovable;
    // chase triggers: (1) aggressive flag + in chaseRange, or (2) aggroed (fight was joined); stealth enemies use detection gate instead
    const inConfiguredChaseRange =
      !this.isStealthEnabled() &&
      chaseLead.aggressive === true &&
      chaseLead.chaseRange != null &&
      dist <= chaseLead.chaseRange;

    // home leash: wasp breaks off when the player strays past homeLeashRange; hysteresis prevents flip-flopping at the edge
    const leashRange = this.behavior.homeLeashRange;
    let beyondLeash = false;
    if (
      this.homeAnchorX != null &&
      this.homeAnchorY != null &&
      leashRange != null &&
      !this.isConverging() &&
      !this.isHomeAlarmed()
    ) {
      const distPlayerToHome = Math.hypot(
        player.x - this.homeAnchorX,
        player.y - this.homeAnchorY,
      );
      if (this.leashBroken) {
        if (distPlayerToHome <= leashRange * HOME_LEASH_REENGAGE_FACTOR) {
          this.leashBroken = false;
        }
      } else if (distPlayerToHome > leashRange) {
        this.leashBroken = true;
      }
      beyondLeash = this.leashBroken;
    } else {
      // leash not in force — clear the latch so the next leash window starts clean
      this.leashBroken = false;
    }

    if (canMove && !beyondLeash && (this.isAggro() || inConfiguredChaseRange)) {
      const helper = this.scene as unknown as EnemyHelperScene;
      // LOS gate: converging enemies bypass it so arena spiders drop off ledges to engage; normal chase respects it
      const now = this.scene.time.now;
      const losBlocked =
        !this.isConverging() &&
        helper.isLineBlocked(this.x, this.y, player.x, player.y);
      // airborne chasers navigate in 2D so they grind walls without the gate
      if (losBlocked && !this.body.allowGravity) {
        this.enterEngagedFallback(player);
        return;
      }
      // A* routing around walls when LOS is blocked; cleared instantly on LOS return; refreshes aggro during detours
      let navWp: { x: number; y: number } | null = null;
      if (this.body.allowGravity && !this.isBoss()) {
        if (losBlocked) {
          navWp = this.followNavPath(player.x, player.y);
          if (navWp) {
            this.refreshAggro();
            this.navHoldUntil = now + NAV_LOS_GRACE_MS;
          }
        } else if (now < this.navHoldUntil && this.nav.hasPath()) {
          // brief LOS flash (jump apex) while mid-route — hold the path a moment before dropping to direct homing
          navWp = this.followNavPath(player.x, player.y);
        } else {
          this.clearNavPath();
        }
      }
      // track self-movement (not dist-to-player) to drive walk/idle-pose; first chase frame counts as moving
      const enteringChase = this.enemyState !== 'chase';
      let chaseMoving = true;
      if (this.body.allowGravity && !this.isConverging()) {
        const movedSq =
          (this.x - this.chaseAnchorX) ** 2 + (this.y - this.chaseAnchorY) ** 2;
        if (
          enteringChase ||
          this.chaseMovedAt === 0 ||
          movedSq > CHASE_MOVE_EPSILON_PX * CHASE_MOVE_EPSILON_PX
        ) {
          // Fresh chase, or the body moved a real margin since the last mark —
          // (re)anchor here and stamp the movement time.
          this.chaseAnchorX = this.x;
          this.chaseAnchorY = this.y;
          this.chaseMovedAt = now;
        }
        chaseMoving = now - this.chaseMovedAt < CHASE_STILL_GRACE_MS;
      } else {
        this.chaseMovedAt = 0;
      }
      // swap walk/idle clip only on a change so the animation isn't restarted every frame
      const walkAnim = chaseLead.walkAnimation;
      if (enteringChase) this.enemyState = 'chase';
      if (enteringChase || chaseMoving !== this.chaseAnimMoving) {
        this.chaseAnimMoving = chaseMoving;
        if (chaseMoving && walkAnim) {
          this.playLogical(walkAnim);
        } else {
          this.playAmbientAnimation();
        }
      }
      // surface-gated footsteps re-resolve each frame so they flip when walking onto/off a bridge tile
      setEnemyWalkSoundEnabled(this, chaseMoving, this.currentWalkSurface());
      // per-instance jitter desyncs same-frame swarms; stealth enemies also get the alertSpeedMul boost
      const alertBoost =
        this.isStealthEnabled() && this.isAggro() ? this.alertSpeedMul : 1;
      const speedMul = (this.isBoss() ? 1 : this.chaseSpeedMul) * alertBoost;
      if (this.body.allowGravity) {
        // grounded chase: hop walls, leap gaps, mount overhangs, or drive horizontally — in priority order
        const dir = this.facingDirection;
        const moveX = chaseLead.moveSpeed! * speedMul;
        const leapX = Math.max(moveX, ENEMY_LEAP_HORIZONTAL_SPEED);
        // A* route active — steer to the next waypoint; skip straight-at-player logic
        if (navWp) {
          this.steerToNavWaypoint(navWp, moveX);
          return;
        }
        if (this.body.blocked.down) {
          this.leapDirX = 0;
          // wedged with no LOS — stop grinding; stay in chase so it resumes the instant LOS clears
          if (losBlocked && !chaseMoving) {
            this.setVelocityX(0);
            return;
          }
          const blockedAhead =
            dir === 1 ? this.body.blocked.right : this.body.blocked.left;
          const playerAbove = dy < -UP_LEAP_MIN_RISE_PX;
          if (shouldJumpOverObstacle(this.probeCtx)) {
            this.setVelocityY(ENEMY_JUMP_VELOCITY);
            this.setVelocityX(moveX * dir);
          } else if (isLedgeAhead(this.probeCtx, dir)) {
              // leap across/up/down — whichever landing closes best on the player; horizontal speed held by leapDirX
            const landing = findLeapLanding(this.probeCtx, dir, leapX, player);
            if (landing) {
              this.leapDirX = dir;
              this.setVelocityY(landing.vy);
              this.setVelocityX(leapX * dir);
            } else {
              // Nothing reachable toward the player off this edge — park instead
              // of walking into the void.
              this.setVelocityX(0);
            }
          } else if (playerAbove && blockedAhead) {
            // player above and wall ahead: mount it; null = keep pressing (stuck-tracker will reroute)
            const mountVy = findWallMountLaunch(this.probeCtx, dir);
            if (mountVy !== null) {
              this.leapDirX = dir;
              this.setVelocityY(mountVy);
              this.setVelocityX(leapX * dir);
            } else {
              this.setVelocityX(moveX * dir);
            }
          } else if (playerAbove) {
            // player above on open ground: throttled upward-leap probe; takeoff window is before the platform edge
            const now = this.scene.time.now;
            let climbed = false;
            if (
              now - this.lastUpProbeAt >= UP_PROBE_INTERVAL_MS &&
              hasReachablePlatformAhead(this.probeCtx, dir)
            ) {
              this.lastUpProbeAt = now;
              const landing = findLeapLanding(this.probeCtx, dir, leapX, player);
              if (landing && landing.y < this.body.bottom - UP_LEAP_MIN_RISE_PX) {
                this.leapDirX = dir;
                this.escapeDirX = 0;
                this.setVelocityY(landing.vy);
                this.setVelocityX(leapX * dir);
                climbed = true;
              }
            }
            if (!climbed) {
              // not jumpable yet — escape from under the platform or close on the player to reach a takeoff edge
              const underDir = overheadEscapeDir(this.probeCtx);
              if (underDir !== 0 && this.tryEscapeStep(underDir, moveX)) {
                // latch direction + start X so the continuation below stays on course until clear of the overhang
                this.escapeDirX = underDir;
                this.escapeFromX = this.x;
              } else if (
                underDir !== 0 &&
                this.tryEscapeStep((-underDir) as 1 | -1, moveX)
              ) {
                // nearer edge drops off — head for the far edge to still escape without stepping into the void
                this.escapeDirX = (-underDir) as 1 | -1;
                this.escapeFromX = this.x;
              } else if (
                underDir === 0 &&
                this.escapeDirX !== 0 &&
                Math.abs(this.x - this.escapeFromX) <= UP_LEAP_SCAN_REACH_PX &&
                this.tryEscapeStep(this.escapeDirX, moveX)
              ) {
                // just cleared — keep the latched direction until the up-probe fires so the AI doesn't walk back under
              } else {
                // clear of any overhang, or every escape route drops off — close on the player
                this.escapeDirX = 0;
                this.setVelocityX(moveX * dir);
              }
            }
          } else {
            this.setVelocityX(moveX * dir);
          }
        } else if (this.leapDirX !== 0) {
          this.setVelocityX(leapX * this.leapDirX);
        } else {
          this.setVelocityX(moveX * dir);
        }
      } else if (this.behavior.horizontalMovementOnly) {
        // horizontal-locked airborne boss: glides on a fixed Y line; standoff + deadzone prevent jitter on arrival
        const speed = chaseLead.moveSpeed!;
        const targetDx = dx + this.chaseStandoffX;
        this.setVelocityX(
          Math.abs(targetDx) < HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX
            ? 0
            : Math.sign(targetDx) * speed,
        );
        this.setVelocityY(0);
      } else {
        // airborne 2D homing; normalize so diagonal flight isn't faster; guard len > 0 for contact-overlap
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const speed = chaseLead.moveSpeed! * speedMul;
          const nx = dx / len;
          const ny = dy / len;
          // perpendicular weave so flyers arc on individual rhythms; radial speed unchanged; bosses get weave=0
          const weave = this.isBoss()
            ? 0
            : Math.sin(
                (this.scene.time.now / 1000) * this.weaveFreq + this.weavePhase,
              ) * AIRBORNE_WEAVE_FRACTION;
          // (-ny, nx) is the unit vector perpendicular to the homing direction.
          this.setVelocityX((nx - ny * weave) * speed);
          this.setVelocityY((ny + nx * weave) * speed);
        } else {
          this.body.setVelocity(0, 0);
        }
      }
      return;
    }

    // not pursuing — reset movement tracker so the next pursuit starts with a fresh window
    this.chaseMovedAt = 0;
    this.enterEngagedFallback(player);
  }

  // single damage entry point — applies HP loss then routes to death, round-break, or hurt; mid-blink and round-break hits handled specially
  takeDamage(
    damage: number,
    sourceX: number,
    options: { skipKnockback?: boolean; sourceIsPlayer?: boolean } = {},
  ): void {
    if (this.enemyState === 'dead') return;
    // invulnerable during the round freeze (the hit that STARTS the break still lands; subsequent ones are dropped)
    if (this.roundBreakUntil > this.scene.time.now) return;
    // a hit wakes a dormant ambusher (no wake clip — it was rudely roused)
    if (this.dormant) {
      this.dormant = false;
      this.waking = false;
    }
    this.health = Math.max(0, this.health - damage);
    if (options.sourceIsPlayer !== false) {
      this.enterCombat();
      this.refreshAggro();
      // being struck counts as spotted — record last-seen so a concealed attacker is still investigated
      if (this.playerRef) this.recordLastSeen(this.playerRef);
    }
    // update the bar regardless of source so a trap finishing the enemy drains it visibly
    this.healthBar?.setHealth(this.health, this.maxHealth);

    // mid-blink: HP drops and death triggers, but knockback/hurt are suppressed so the teleport mechanic isn't skipped
    // (strike phase is NOT protected — it's a regular attack animation and can be interrupted)
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

    // cross a round threshold → cinematic freeze instead of normal hurt; latched so heals can't rewind
    if (this.isRoundFight()) {
      const computedRound = roundForRatio(this.health / this.maxHealth);
      if (computedRound > this.roundReached) {
        this.roundReached = computedRound;
        this.beginRoundBreak();
        return;
      }
    }

    if (midBlink) {
      // HP already updated; ANIMATION_COMPLETE will handle the transition out of teleport
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
    this.clearCurrentAttack();
    this.endTeleport();
    setEnemyWalkSoundEnabled(this, false);
    if (this.behavior.hurtAnimation) {
      this.playLogical(this.behavior.hurtAnimation);
    }
    if (this.behavior.hurtSoundId) {
      playOneShot(this.scene, this.behavior.hurtSoundId, 0, this);
    }

    // re-arm the timer so back-to-back hits extend the stagger window rather than cutting it short
    if (this.hurtTimer) {
      this.hurtTimer.remove(false);
    }
    this.hurtTimer = this.scene.time.delayedCall(HURT_DURATION_MS, () => {
      this.hurtTimer = null;
      if (this.enemyState !== 'hurt') return;
      this.enterIdle();
    });
  }

  // opens (or slides) the combat window and reveals the HP bar; no-op for bar-less enemies
  private enterCombat(): void {
    if (!this.healthBar) return;
    this.inCombat = true;
    this.combatTimeoutAt = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
  }

  // when the combat window lapses, restores HP to full and hides the bar
  private maybeExitCombat(): void {
    if (!this.inCombat) return;
    if (this.enemyState === 'dead') return;
    if (this.scene.time.now < this.combatTimeoutAt) return;
    this.inCombat = false;
    this.combatTimeoutAt = 0;
    this.health = this.maxHealth;
    this.healthBar?.setHealth(this.health, this.maxHealth);
    this.healthBar?.setVisible(false);
  }

  // freezes the boss invulnerable for the "Round N" banner beat, cancelling any in-flight swing or teleport
  private beginRoundBreak(): void {
    this.roundBreakUntil = this.scene.time.now + BOSS_ROUND_BREAK_MS;
    this.enemyState = 'idle';
    this.attackFired = false;
    this.firedMeleeHitboxes.clear();
    this.firedAoeDamageFrames.clear();
    this.clearCurrentAttack();
    this.endTeleport();
    setEnemyWalkSoundEnabled(this, false);
    if (this.hurtTimer) {
      this.hurtTimer.remove(false);
      this.hurtTimer = null;
    }
    if (!this.behavior.immovable) {
      this.body.setVelocityX(0);
      if (!this.body.allowGravity) this.body.setVelocityY(0);
    }
    // hold a neutral pose rather than freezing on a mid-attack frame
    this.playAmbientAnimation();
  }

  // returns the surface type under the enemy's feet for walk-sound selection, or null when airborne/off-grid
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

  // picks a weighted-random eligible attack this frame, or null when nothing is in range/off lockout
  private pickAttack(dist: number): AnimatedEntityAttackConfig | null {
    // no attacking mid-jump; flyers (gravity off) are exempt
    if (
      this.body.allowGravity &&
      !this.body.blocked.down &&
      !this.body.touching.down
    ) {
      return null;
    }
    const now = this.scene.time.now;
    const eligible: AnimatedEntityAttackConfig[] = [];
    for (const attack of this.attacks) {
      if (attack.type === 'contact') continue;
      // combo-only finishers are never selected on their own; they run via tryEnterComboFollowup only
      if (attack.comboOnly === true) continue;
      // Per-attack lockout — skip if this specific attack is still on
      // its recast timer regardless of range / heal-threshold.
      const readyAt = this.attackReadyAt.get(attack) ?? 0;
      if (now < readyAt) continue;
      // group teleport lock so copies don't all blink simultaneously; melee/aoe stay eligible while blocked
      if (
        attack.type === 'teleport' &&
        this.teleportCoordinator?.isLockedByOther(this) === true
      ) {
        continue;
      }
      if (attack.type === 'heal') {
        const threshold = attack.healThreshold ?? 0.5;
        if (this.health / this.maxHealth >= threshold) continue;
        eligible.push(attack);
        continue;
      }
      if (attack.range != null && dist <= attack.range) {
        // minRange gates the lower bound (used by 'dive' / 'aoe'). Other
        // types leave it undefined and pass freely.
        const minRange = attack.minRange ?? 0;
        if (dist < minRange) continue;
        // skip a straight shot when the muzzle Y doesn't intersect the player's body (different elevation)
        if (
          attack.projectileStraight === true &&
          attack.verticalAlignMarginPx != null &&
          !this.straightShotAligned(attack)
        ) {
          continue;
        }
        eligible.push(attack);
      }
    }
    if (eligible.length === 0) return null;
    // weighted random pick; weights bias signature moves without duplicate registry entries
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

  // true when the muzzle's Y line passes through the player's body — gates a straight shooter to only fire on-row
  private straightShotAligned(attack: AnimatedEntityAttackConfig): boolean {
    const player = this.playerRef;
    if (!player) return false;
    const muzzleY = this.y + (attack.projectileOriginY ?? 0);
    const margin = attack.verticalAlignMarginPx ?? 0;
    return (
      muzzleY >= player.body.top - margin &&
      muzzleY <= player.body.bottom + margin
    );
  }

  // commits a chosen attack — enters attack state, opens aggro/conflict, resets damage guards, and kicks off the animation
  private enterAttackState(attack: AnimatedEntityAttackConfig): void {
    this.enemyState = 'attack';
    // committing an attack sustains aggro and opens the shorter conflict window (red "!")
    this.refreshAggro();
    this.conflictUntil = this.scene.time.now + ENEMY_CONFLICT_WINDOW_MS;
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
      // bake a one-shot velocity so the dive arc lands on the player when the anim finishes
      this.applyDiveVelocity(attack);
    } else if (!this.behavior.immovable) {
      this.setVelocityX(0);
      if (!this.body.allowGravity) this.setVelocityY(0);
    }
    if (attack.type === 'teleport') {
      // claim the group lock for the full disappear→appear→strike sequence; released by clearCurrentAttack
      this.teleportCoordinator?.acquire(this);
      // phase 1: disappear at current position; gravity suspended so the appear pose doesn't fall through
      this.teleportPhase = 'disappear';
      this.teleportRestoreGravity = this.body.allowGravity;
      if (this.teleportRestoreGravity) {
        this.body.setAllowGravity(false);
      }
      this.setVelocity(0, 0);
      // pause the body-sound sequence for the teleport; endTeleport resumes it mid-clip
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

  // chance-based combo chaining — launches the follow-up attack directly after the opener completes, skipping recover
  private tryEnterComboFollowup(attack: AnimatedEntityAttackConfig): boolean {
    const nextAnim = attack.comboNextAnimation;
    if (nextAnim == null) return false;
    if (Math.random() * 100 >= (attack.comboChancePct ?? 0)) return false;
    const next = this.attacks.find(
      (a) => a !== attack && a.animation === nextAnim,
    );
    if (!next) return false;
    // Respect the follow-up's own per-attack recast lockout.
    if (this.scene.time.now < (this.attackReadyAt.get(next) ?? 0)) return false;
    const player = this.playerRef;
    if (player) {
      const dist = Math.hypot(player.x - this.x, player.y - this.y);
      // range-check with tolerance; strict range would sever every combo the moment the opener connects
      // combo-only links (no range) chain unconditionally — reachability was vetted by the opener
      if (
        attack.range != null &&
        dist > attack.range * COMBO_FOLLOWUP_RANGE_TOLERANCE
      ) {
        return false;
      }
      // re-face before the follow-up; facing is locked during 'attack' so update() won't do it
      this.facingDirection = player.x >= this.x ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }
    this.enterAttackState(next);
    return true;
  }

  // restores gravity and resumes the body-sound sequence after a teleport blink; safe to call with no active teleport
  private endTeleport(): void {
    if (this.teleportRestoreGravity) {
      this.body.setAllowGravity(true);
      this.teleportRestoreGravity = false;
    }
    this.teleportPhase = null;
    resumeEntitySoundSequence(this);
  }

  // releases the group teleport lock (if held) and clears currentAttack — all attack-exit paths go through here
  private clearCurrentAttack(): void {
    if (this.currentAttack?.type === 'teleport') {
      this.teleportCoordinator?.release(this);
    }
    this.currentAttack = null;
  }

  // reactive teleport-dodge — when the player fires within range, blinks the boss beside them
  notifyPlayerProjectileFired(originX: number, originY: number): void {
    const cfg = this.behavior.dodgeOnProjectile;
    if (!cfg) return;
    if (this.enemyState === 'dead' || this.enemyState === 'hurt') return;
    if (this.teleportPhase !== null) return;
    // Honor the group teleport lock here too — a reactive dodge mustn't blink a
    // second hoarder onto the player while a group-mate is mid-teleport.
    if (this.teleportCoordinator?.isLockedByOther(this) === true) return;
    if (this.scene.time.now < this.projectileReactionReadyAt) return;
    const dx = originX - this.x;
    const dy = originY - this.y;
    if (dx * dx + dy * dy > cfg.triggerRangePx * cfg.triggerRangePx) return;
    const teleport = this.pickProjectileReactionTeleport();
    if (!teleport) return;
    this.projectileReactionReadyAt = this.scene.time.now + cfg.cooldownMs;
    // enterAttackState handles everything — guards, gravity, disappear clip — and overrides current state
    this.enterAttackState(teleport);
  }

  // picks a teleport attack for the projectile-dodge reaction, preferring off-recast entries
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

  // teleport phase 1→2: repositions to the player's ground, then plays the appear clip (three-phase) or jumps straight to the strike (two-phase)
  private beginTeleportAppear(attack: AnimatedEntityAttackConfig): void {
    if (attack.animation == null) return;
    const player = this.playerRef;
    if (player !== null) {
      const offsetY = attack.targetOffsetY ?? DEFAULT_TELEPORT_OFFSET_Y;
      const destX = this.clampArenaX(player.x);
      const groundY = this.findGroundY(destX, player.body.bottom);
      const strikeBodyBottom = groundY + offsetY;

      // appearElevated: shift the reappear up by one body-height for slam-style framing (opt-in)
      const landingBodyBottom =
        attack.appearAnimation != null && attack.appearElevated === true
          ? strikeBodyBottom - this.config.physicsBody.height
          : strikeBodyBottom;

      // derive sprite.y from the live body offset so oversized frames (heart hoarder) compute correctly
      const bodyBottomToSpriteY = this.body.bottom - this.y;
      const destY = landingBodyBottom - bodyBottomToSpriteY;
      this.body.reset(destX, destY);
      // face the player so the next clip's hitbox is oriented correctly
      this.facingDirection = player.x >= this.x ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }
    if (attack.appearAnimation != null) {
      // three-phase: play visual reappear; ANIMATION_COMPLETE chains to beginTeleportStrike
      this.teleportPhase = 'appear';
      this.playLogical(attack.appearAnimation);
      return;
    }
    // Two-phase legacy: jump straight to the strike clip.
    this.beginTeleportStrike(attack);
  }

  // teleport appear→strike: snaps body to the strike position (elevated slams only) and plays the damage animation
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

  // no +1 on startTileY — body.bottom is on the tile boundary so Math.floor already points at the floor tile
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

  // sets a one-shot velocity so the dive body lands on the player exactly when the clip ends
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

  // snaps the body forward by the lunge distance (clamped so it can't cross gaps or world edges)
  private applyLungeDisplacement(distance: number): void {
    const safe = this.safeLungeDistance(distance);
    this.body.reset(this.x + safe * this.facingDirection, this.y);
  }

  // clamps lunge distance to the furthest step that stays in world bounds and over solid ground
  private safeLungeDistance(distance: number): number {
    if (distance <= 0) return distance;
    const helper = this.scene as unknown as EnemyHelperScene;
    const dir = this.facingDirection;
    const probeY = this.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y;
    const bounds = this.scene.physics.world.bounds;
    const halfWidth = this.body.width / 2;
    const minCenterX = bounds.left + halfWidth;
    const maxCenterX = bounds.right - halfWidth;
    const startCenterX = this.body.center.x;
    // Only gravity-bound entities fall into gaps; flyers can lunge over air.
    const guardGaps = this.body.allowGravity;
    let safe = 0;
    for (let d = LEAP_PROBE_SAMPLE_PX; ; d += LEAP_PROBE_SAMPLE_PX) {
      // Clamp the final sample to the exact endpoint so a fully-clear path
      // lands at `distance` rather than the last whole step short of it.
      const step = Math.min(d, distance);
      const candidateCenterX = startCenterX + step * dir;
      if (candidateCenterX < minCenterX || candidateCenterX > maxCenterX) break;
      if (guardGaps && !helper.isTileSolidAt(candidateCenterX, probeY)) break;
      safe = step;
      if (step >= distance) break;
    }
    return safe;
  }

  // drops to idle: cancels any swing, parks the body, shows the resting pose, and mutes footsteps
  private enterIdle(): void {
    this.enemyState = 'idle';
    this.clearCurrentAttack();
    if (!this.behavior.immovable) {
      this.body.setVelocityX(0);
      if (!this.body.allowGravity) this.body.setVelocityY(0);
    }
    this.playAmbientAnimation();
    setEnemyWalkSoundEnabled(this, false);
  }

  // shows the resting pose — airborne loiterers keep their walk clip, everything else shows the idle animation
  private playAmbientAnimation(): void {
    // airborne loiterers hold their fly clip at rest; grounded entities snap to idle so they don't "run in place"
    if (!this.body.allowGravity && this.canLoiter()) {
      const walkAnim = this.effectiveWalkAnimation();
      if (walkAnim) {
        this.playLogical(walkAnim);
        return;
      }
    }
    this.playLogical(this.config.defaultAnimation);
  }

  // plays the sleep clip (or freezes on wake-clip frame 0) while the entity waits to be spotted
  private holdDormantPose(): void {
    // play the sleep clip if authored; bad config falls through to the wake-frame-0 pose
    const sleepAnim = this.behavior.dormant?.sleepAnimation;
    if (sleepAnim != null && this.playLogical(sleepAnim)) return;
    if (this.dormantWakeAnim == null) return;
    const wakeKey = entityAnimFullKey(this.getIdentifier(), this.dormantWakeAnim);
    // play then pause immediately to freeze on frame 0; no arg to pause() avoids stale frame refs on HMR
    this.play(wakeKey);
    this.anims.pause();
  }

  // clamps x to the spawn-level arena bounds so teleport destinations can't follow the player out of the room
  private clampArenaX(x: number): number {
    const bounds = this.spawnLevelBounds;
    if (!bounds) return x;
    const halfWidth = this.body.width / 2;
    const minCenterX = bounds.worldX + halfWidth;
    const maxCenterX = bounds.worldX + bounds.pxWid - halfWidth;
    return Phaser.Math.Clamp(x, minCenterX, maxCenterX);
  }

  // pulls the body back inside the arena rect each frame and zeroes outward velocity; X-only, no-op without stayInSpawnLevel
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

  // true while the aggro window is live (traded blows recently); lapses ENEMY_COMBAT_TIMEOUT_MS after the last exchange
  private isAggro(): boolean {
    return this.scene.time.now < this.aggroUntil;
  }

  // re-arms the aggro window; called on every exchange of blows to keep a sustained fight engaged
  private refreshAggro(): void {
    this.aggroUntil = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
  }

  // ── Stealth / detection ──────────────────────────────────────────────────

  // 0/1/2 for normal/investigating/conflict; GameScene takes the max to colour the HUD corner brackets
  getAlertLevel(): 0 | 1 | 2 {
    return alertLevel(this.alertState);
  }

  // stealth is disabled for bosses, boss-fight enemies, and stealth-exempt swarmers (wasps)
  private isStealthEnabled(): boolean {
    if (this.alertIcon == null) return false; // attack-less / stealth-exempt
    if (this.ignoresStealth) return false; // wasps & other legacy swarmers
    if (this.isBoss()) return false;
    return !(this.scene as unknown as EnemyHelperScene).isStealthDisabled();
  }

  // true when the enemy should face the player this frame; stealth-off enemies always do (legacy behavior)
  private shouldFacePlayer(): boolean {
    if (!this.isStealthEnabled()) return true;
    if (this.alertState === 'conflict') return true;
    if (this.alertState === 'investigating') return this.lastVisible;
    return false; // normal
  }

  // Snapshots the player's position as the last-seen spot a searcher heads for.
  private recordLastSeen(player: Player): void {
    this.lastSeenX = player.x;
    this.lastSeenY = player.y;
    this.hasLastSeen = true;
  }

  // true when the player is visible this frame — cone+range+LOS for stealth, range+LOS only for bosses
  private canSeePlayer(
    player: Player,
    dx: number,
    dist: number,
    stealthEnabled: boolean,
    helper: EnemyHelperScene,
  ): boolean {
    if (stealthEnabled) {
      if (
        !isInDetectionCone(
          dx,
          dist,
          this.facingDirection,
          this.detectionRange,
          this.visionHalfAngleRad,
          ENEMY_VISION_NEAR_RADIUS_PX,
        )
      ) {
        return false;
      }
    } else if (dist > this.detectionRange) {
      return false;
    }
    return !helper.isLineBlocked(this.x, this.y, player.x, player.y);
  }

  // handles a fresh spot — opens aggro, arms the stop-and-investigate telegraph, plays the alert sting
  private onSpotted(): void {
    this.refreshAggro();
    this.returningToPost = false;
    this.searchTravelUntil = 0;
    this.searchLookUntil = 0;
    this.investigateStopUntil = this.scene.time.now + ENEMY_SPOT_STOP_MS;
    if (!this.harmless) {
      playOneShot(this.scene, ENEMY_ALERT_STING_SOUND_ID, 0, this);
    }
  }

  // alerts the enemy to a nearby gunshot, pointing last-seen at the exact shot location regardless of LOS
  hearGunshot(x: number, y: number): void {
    if (this.isDead() || !this.isStealthEnabled()) return;
    const fresh = !this.isAggro();
    this.lastSeenX = x;
    this.lastSeenY = y;
    this.hasLastSeen = true;
    if (fresh) {
      this.onSpotted();
    } else {
      // already hunting — retarget to the new cue and reset hunt budgets without re-flashing the telegraph
      this.refreshAggro();
      this.returningToPost = false;
      this.searchTravelUntil = 0;
      this.searchLookUntil = 0;
    }
  }

  // per-frame detection pass: checks LOS, opens/refreshes aggro on a spot, classifies alert state, and drives the overhead glyph
  private updateAlertState(player: Player, dx: number, dist: number): void {
    if (this.alertIcon == null) return;
    const now = this.scene.time.now;
    const helper = this.scene as unknown as EnemyHelperScene;
    const stealthEnabled = this.isStealthEnabled();

    const visible = this.canSeePlayer(player, dx, dist, stealthEnabled, helper);
    this.lastVisible = visible;

    if (visible) {
      this.returningToPost = false;
      this.searchTravelUntil = 0;
      this.searchLookUntil = 0;
      const wasAware = this.isAggro();
      this.recordLastSeen(player);
      if (stealthEnabled && !wasAware) {
        // Fresh spot: stop, telegraph, then rush (handled by the update() gates).
        this.onSpotted();
      } else {
        // Already aware, or stealth off — keep the window alive (no telegraph).
        this.refreshAggro();
      }
    }

    // conflict = mid-swing/recover or inside the post-attack window; decoupled from range so "!" only appears on actual engagement
    const aware = this.isAggro();
    const inConflict =
      this.enemyState === 'attack' ||
      this.enemyState === 'recover' ||
      now < this.conflictUntil;
    this.alertState = classifyAlert({ inConflict, aware });

    this.alertIcon.setAnchor(this.body.center.x, this.body.top);
    this.updateAlertIcon(now);
  }

  // flashes "?" or "!" on an alert escalation and auto-hides after the hold window
  private updateAlertIcon(now: number): void {
    const icon = this.alertIcon;
    if (icon == null) return;
    let flash: AlertGlyph = 'none';
    if (this.prevAlertState === 'normal' && this.alertState === 'investigating') {
      flash = 'suspect';
    } else if (
      this.prevAlertState !== 'conflict' &&
      this.alertState === 'conflict'
    ) {
      flash = 'detect';
    }
    this.prevAlertState = this.alertState;

    if (flash !== 'none') {
      this.iconGlyph = flash;
      this.iconHideAt = now + ENEMY_ALERT_ICON_HOLD_MS;
      icon.setGlyph(flash);
    } else if (this.iconGlyph !== 'none' && now >= this.iconHideAt) {
      this.iconGlyph = 'none';
      icon.setGlyph('none');
    }
  }

  // true when alerted but LOS is lost; stealth-enabled only — boss-fight enemies keep legacy pursuit
  private isSearching(): boolean {
    return (
      this.isStealthEnabled() &&
      this.isAggro() &&
      !this.lastVisible &&
      this.hasLastSeen
    );
  }

  // two-phase hunt: beeline to the last-seen spot, then look around before giving up
  private updateSearch(player: Player): void {
    const now = this.scene.time.now;
    if (this.searchTravelUntil === 0 && this.searchLookUntil === 0) {
      // First frame of this hunt — arm the travel backstop. The look-around scan
      // budget is armed later, the moment the enemy arrives (or is walled off).
      this.searchTravelUntil = now + ENEMY_SEARCH_TRAVEL_TIMEOUT_MS;
    }

    const dxSeen = this.lastSeenX - this.x;
    const dySeen = this.lastSeenY - this.y;
    const distSeen = Math.hypot(dxSeen, dySeen);
    const moveSpeed = this.effectiveMoveSpeed();
    const canMove = moveSpeed != null && !this.behavior.immovable;
    const arrived = distSeen <= ENEMY_SEARCH_REACH_DIST_PX;
    // an impassable wall is treated as "arrived" so the enemy scans instead of wall-grinding
    const dirSeen: 1 | -1 = dxSeen >= 0 ? 1 : -1;
    const wallBlocked =
      canMove && this.body.allowGravity && isBlockedByWall(this.probeCtx, dirSeen);
    // A* route to last-seen when a straight beeline won't reach; null → wall-block gate sends to scan
    const navWp =
      canMove && this.body.allowGravity && !arrived
        ? this.followNavPath(this.lastSeenX, this.lastSeenY)
        : null;

    // ── Travel phase ──────────────────────────────────────────────────────
    // head to the spot; refresh aggro each step so a distant gunshot hunt doesn't lapse mid-walk
    if (
      !arrived &&
      canMove &&
      now < this.searchTravelUntil &&
      (navWp !== null || !wallBlocked)
    ) {
      this.refreshAggro();
      // discard a stale look budget from a transient wall-block so arrival gets a full fresh scan
      this.searchLookUntil = 0;
      // Hunt pace — quicker than the in-sight chase so a faraway shot is closed
      // on urgently.
      const speed = moveSpeed * ENEMY_HUNT_SPEED_MUL * this.chaseSpeedMul;
      // Play the walk clip only on entry — replaying it every frame would freeze
      // it on frame 0 (play() restarts), matching the chase block's care.
      if (this.enemyState !== 'chase') {
        this.enemyState = 'chase';
        const walkAnim = this.effectiveWalkAnimation();
        if (walkAnim) this.playLogical(walkAnim);
      }
      setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
      if (navWp) {
        // Follow the A* route around the obstacle.
        this.steerToNavWaypoint(navWp, speed);
      } else if (this.body.allowGravity) {
        // No route — straight grounded beeline (steers X only).
        this.facingDirection = dirSeen;
        this.setFacing(this.facingDirection === -1);
        if (shouldJumpOverObstacle(this.probeCtx)) this.setVelocityY(ENEMY_JUMP_VELOCITY);
        this.setVelocityX(speed * this.facingDirection);
      } else {
        // Airborne hunt — steer in 2D toward the spot.
        this.facingDirection = dirSeen;
        this.setFacing(this.facingDirection === -1);
        const len = distSeen || 1;
        this.setVelocityX((dxSeen / len) * speed);
        this.setVelocityY(
          this.behavior.horizontalMovementOnly ? 0 : (dySeen / len) * speed,
        );
      }
      return;
    }

    // ── Look-around phase ─────────────────────────────────────────────────
    // arm once on arrival, then flip facing at intervals until the budget lapses
    if (this.searchLookUntil === 0) {
      this.searchLookUntil = now + ENEMY_SEARCH_LOOK_MS;
      this.searchNextFlipAt = now + ENEMY_SEARCH_FLIP_MS;
    }
    if (now >= this.searchLookUntil) {
      this.giveUpHunt();
      this.enterIdleOrLoiter(player);
      return;
    }
    if (!this.behavior.immovable) {
      this.setVelocityX(0);
      if (!this.body.allowGravity) this.setVelocityY(0);
    }
    setEnemyWalkSoundEnabled(this, false);
    if (this.enemyState !== 'idle') this.enterIdle();
    if (now >= this.searchNextFlipAt) {
      this.facingDirection = (this.facingDirection === 1 ? -1 : 1) as 1 | -1;
      this.setFacing(this.facingDirection === -1);
      this.searchNextFlipAt = now + ENEMY_SEARCH_FLIP_MS;
    }
  }

  // gives up the hunt: clears aggro/converge/search state and arms the walk-back-to-post
  private giveUpHunt(): void {
    this.aggroUntil = 0;
    this.convergeUntil = 0;
    this.investigateStopUntil = 0;
    this.searchTravelUntil = 0;
    this.searchLookUntil = 0;
    this.hasLastSeen = false;
    this.clearNavPath();
    this.returningToPost = true;
    this.returnPostDeadline = 0; // armed fresh on the first updateReturnToPost frame
  }

  // true while walking back to spawn post after giving up the chase; cleared on arrival or re-detection
  private isReturningToPost(): boolean {
    return (
      this.returningToPost && this.isStealthEnabled() && !this.isAggro()
    );
  }

  // walks back to the spawn post via A*, settling in place if the route stalls or the post becomes unreachable
  private updateReturnToPost(): void {
    const now = this.scene.time.now;
    const moveSpeed = this.effectiveMoveSpeed();
    if (moveSpeed == null || this.behavior.immovable) {
      this.finishReturnToPost();
      return;
    }
    const dxHome = this.spawnX - this.x;
    const dyHome = this.spawnY - this.y;
    const grounded = this.body.allowGravity;
    // grounded: horizontal-only arrival (Y offset would cause jitter); airborne: 2D distance
    const homeReached = grounded
      ? Math.abs(dxHome) <= ENEMY_SEARCH_REACH_DIST_PX &&
        Math.abs(dyHome) <= TILE_PX * 2
      : Math.hypot(dxHome, dyHome) <= ENEMY_SEARCH_REACH_DIST_PX;
    if (homeReached) {
      this.finishReturnToPost();
      return;
    }
    // give up if no meaningful progress toward home within ENEMY_RETURN_POST_TIMEOUT_MS (door closed, route stalled)
    const distHome = Math.hypot(dxHome, dyHome);
    if (
      this.returnPostDeadline === 0 ||
      distHome < this.returnPostBestDist - TILE_PX
    ) {
      this.returnPostBestDist = distHome;
      this.returnPostDeadline = now + ENEMY_RETURN_POST_TIMEOUT_MS;
    } else if (now >= this.returnPostDeadline) {
      this.finishReturnToPost();
      return;
    }
    const speed = moveSpeed * LOITER_SPEED_MULTIPLIER;
    // Route home around walls/doors via A* — the enemy may have crossed terrain to
    // reach the shot that a straight walk-back can't retrace.
    const navWp = grounded ? this.followNavPath(this.spawnX, this.spawnY) : null;
    // hold still while the route cools or when horizontally home (avoids left/right oscillation with the reactive beeline)
    const holding =
      navWp === null &&
      (this.nav.isSuppressed(now) ||
        (grounded && Math.abs(dxHome) <= ENEMY_SEARCH_REACH_DIST_PX));
    if (holding) {
      if (this.enemyState !== 'idle') this.enterIdle();
      if (!this.behavior.immovable) {
        this.setVelocityX(0);
        if (!grounded) this.setVelocityY(0);
      }
      setEnemyWalkSoundEnabled(this, false);
      return;
    }
    // set walk clip on entry only; per-frame play() would restart it on frame 0
    if (this.enemyState !== 'chase') {
      this.enemyState = 'chase';
      const walkAnim = this.effectiveWalkAnimation();
      if (walkAnim) this.playLogical(walkAnim);
    }
    setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
    if (navWp) {
      this.steerToNavWaypoint(navWp, speed);
      return;
    }
    // Genuinely no route — a gentle reactive beeline toward the post.
    this.facingDirection = dxHome >= 0 ? 1 : -1;
    this.setFacing(this.facingDirection === -1);
    if (grounded) {
      if (shouldJumpOverObstacle(this.probeCtx)) this.setVelocityY(ENEMY_JUMP_VELOCITY);
      this.setVelocityX(speed * this.facingDirection);
    } else {
      const len = distHome || 1;
      this.setVelocityX((dxHome / len) * speed);
      this.setVelocityY(
        this.behavior.horizontalMovementOnly ? 0 : (dyHome / len) * speed,
      );
    }
  }

  // finishes the return-to-post walk: clears flags and drops to idle
  private finishReturnToPost(): void {
    this.returningToPost = false;
    this.returnPostDeadline = 0;
    this.returnPostBestDist = Infinity;
    this.clearNavPath();
    this.enterIdle();
  }

  // forces the entity into pursuit by opening the aggro window without needing a hit
  forcePursue(): void {
    this.refreshAggro();
  }

  // forcePursue plus LOS bypass — enemies close through walls, un-stranding reinforcements on upper ledges
  forceConverge(): void {
    this.forcePursue();
    this.convergeUntil = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
  }

  // immediately clears all aggro/converge/alarm windows so the enemy stops chasing right now
  dropPursuit(): void {
    this.aggroUntil = 0;
    this.convergeUntil = 0;
    this.homeAlarmUntil = 0;
    this.leashBroken = false;
    if (this.enemyState === 'chase') {
      this.enterIdle();
    }
  }

  // full fight reset: restores HP/round, re-arms encounter gate, clears all windows, and snaps the body home
  resetEncounter(): void {
    this.health = this.maxHealth;
    this.healthBar?.setHealth(this.health, this.maxHealth);
    this.roundReached = 1;
    this.encounterTriggered = false;
    this.engageReadyAt =
      this.behavior.engageDelayMs !== undefined
        ? Number.POSITIVE_INFINITY
        : 0;
    this.aggroUntil = 0;
    this.convergeUntil = 0;
    this.homeAlarmUntil = 0;
    this.roundBreakUntil = 0;
    // clear summons so a fresh fight doesn't count minions from the abandoned one against the cap
    this.activeSummons = [];
    this.leashBroken = false;
    this.attackFired = false;
    this.firedMeleeHitboxes.clear();
    this.firedAoeDamageFrames.clear();
    this.clearCurrentAttack();
    this.endTeleport();
    this.teleportCoordinator = null;
    if (this.hurtTimer) {
      this.hurtTimer.remove(false);
      this.hurtTimer = null;
    }
    // Snap home and stop dead — body.reset repositions the sprite to the spawn
    // point and zeroes velocity/acceleration in one call.
    this.body.reset(this.spawnX, this.spawnY);
    setEnemyWalkSoundEnabled(this, false);
    this.enterIdle();
  }

  // joins this enemy to a boss self-copy group's coordinator (used on the boss itself when the split begins)
  setTeleportCoordinator(coordinator: TeleportCoordinator): void {
    this.teleportCoordinator = coordinator;
    coordinator.register(this);
  }

  // nudges boss self-copies apart when they stack, proportional to overlap; skips the active teleporter
  private applyHoarderSeparation(): void {
    const coordinator = this.teleportCoordinator;
    if (!coordinator || !this.body) return;
    if (this.teleportPhase !== null) return;
    let push = 0;
    for (const other of coordinator.getMembers()) {
      if (other === this || !other.active || !other.body) continue;
      const dx = this.x - other.x;
      const absDx = Math.abs(dx);
      if (absDx >= HOARDER_SEPARATION_MIN_DX_PX) continue;
      // break ties on iid when perfectly stacked so the pair always splits the same way
      const dir = dx !== 0 ? Math.sign(dx) : this.iid < other.iid ? -1 : 1;
      // Closer overlap pushes harder (0 at the edge of MIN_DX, 1 when fully
      // stacked), so members ease into their gap rather than snapping.
      push += dir * ((HOARDER_SEPARATION_MIN_DX_PX - absDx) / HOARDER_SEPARATION_MIN_DX_PX);
    }
    if (push === 0) return;
    const clamped = Math.max(-1, Math.min(1, push));
    // Move the game object; the arcade body re-syncs from it next physics step,
    // and update()'s clampToArena keeps the nudge inside the arena.
    this.x += clamped * HOARDER_SEPARATION_PUSH_SPEED;
  }

  // spawn point exposed so GameScene can anchor wasps to the nearest hive
  getSpawnPoint(): { readonly x: number; readonly y: number } {
    return { x: this.spawnX, y: this.spawnY };
  }

  // sets the hive orbit/leash anchor; idempotent so re-applying on respawn is safe
  setHomeAnchor(x: number, y: number): void {
    this.homeAnchorX = x;
    this.homeAnchorY = y;
  }

  // home anchor or null for player-anchored enemies; GameScene uses this to match a wasp to its hive
  getHomeAnchor(): { readonly x: number; readonly y: number } | null {
    return this.homeAnchorX != null && this.homeAnchorY != null
      ? { x: this.homeAnchorX, y: this.homeAnchorY }
      : null;
  }

  // raises hive-defense alarm — drops the home leash and chases the player for one combat window
  raiseHomeAlarm(): void {
    this.homeAlarmUntil = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
    this.refreshAggro();
  }

  // True while the hive-defense alarm window is live (leash suppressed).
  private isHomeAlarmed(): boolean {
    return this.scene.time.now < this.homeAlarmUntil;
  }

  // True while the converge window (opened by forceConverge) is live. Read by
  // the chase LOS gate to let arena enemies pursue through geometry.
  private isConverging(): boolean {
    return this.scene.time.now < this.convergeUntil;
  }

  // engaged but can't reach the player — holds position for path-walkers, falls to loiter for drifters
  private enterEngagedFallback(player: Player): void {
    if (this.isAggro() && this.loiterPath) {
      if (this.enemyState !== 'idle') {
        this.enterIdle();
      }
      return;
    }
    this.enterIdleOrLoiter(player);
  }

  // ══ Idle-motion cluster: loiter / patrol / wander / greet ══════════════════
  // Kept in-class (not extracted): shared state with chase locomotion would need a ~25-member accessor surface to pull out.

  // routes the "nothing to do" outcome — loiter-capable entities loiter, everything else idles
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

  // attacks[0] wins; falls back to behavior block so attack-less characters (spirit walkers) can still patrol
  private effectiveWalkAnimation(): string | undefined {
    return this.attacks[0]?.walkAnimation ?? this.behavior.walkAnimation;
  }

  private effectiveMoveSpeed(): number | undefined {
    return this.attacks[0]?.moveSpeed ?? this.behavior.moveSpeed;
  }

  // true when this entity can patrol/wander/drift — path-walkers, default wanderers, and airborne enemies all qualify
  private canLoiter(): boolean {
    if (this.behavior.immovable) return false;
    if (
      this.effectiveWalkAnimation() == null ||
      this.effectiveMoveSpeed() == null
    ) {
      return false;
    }
    if (this.loiterPath) return true;
    // no path: grounded area-wanders by default (wanderRadius returns null for bosses/stationary); airborne keeps legacy drift
    if (this.body.allowGravity) return this.wanderRadius() != null;
    return true;
  }

  // returns the wander radius (authored or default), or null for bosses/stationary enemies that should hold idle
  private wanderRadius(): number | null {
    if (this.wanderConfig) return this.wanderConfig.radius;
    if (
      this.body.allowGravity &&
      !this.loiterPath &&
      !this.behavior.isBoss &&
      !this.behavior.stationary
    ) {
      return DEFAULT_WANDER_RADIUS;
    }
    return null;
  }

  // enters loiter and seeds the appropriate movement mode (patrol snap, wander start, or drift target pick)
  private enterLoiter(player: Player): void {
    this.enemyState = 'loiter';
    this.clearCurrentAttack();
    const walkAnim = this.effectiveWalkAnimation();
    if (walkAnim) this.playLogical(walkAnim);
    setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
    if (this.loiterPath) {
      // snap to nearest waypoint so patrol resumes from wherever the chase left the entity
      this.pathIndex = this.findNearestWaypointIndex();
      // fresh dwell cadence so a resumed patrol doesn't immediately stop
      this.pathPauseUntil = 0;
      this.scheduleNextPathPause(this.scene.time.now);
    } else if (this.body.allowGravity && this.wanderRadius() != null) {
      // fresh cadence + first wander target; clear any lingering greeting so entry starts clean
      this.pathPauseUntil = 0;
      this.scheduleNextPathPause(this.scene.time.now);
      this.greetUntil = 0;
      this.greetHopsLeft = 0;
      this.wanderWalkAnimOn = true;
      this.pickWanderTarget();
    } else {
      this.pickLoiterTarget(player);
    }
  }

  // per-frame loiter dispatch — routes to path-follow, area-wander, or the legacy anchored drift
  private updateLoiter(player: Player): void {
    if (this.loiterPath) {
      this.updatePathLoiter();
      return;
    }
    if (this.body.allowGravity && this.wanderRadius() != null) {
      this.updateAreaWander();
      return;
    }
    const lead = this.attacks[0];
    const homeAnchored = this.homeAnchorX != null && this.homeAnchorY != null;
    const chaseRange = lead?.chaseRange;
    // player-anchored: hover in place past engagement range; home-anchored: always drift toward home (wasp returns to hive)
    if (!homeAnchored && chaseRange != null) {
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
    const moveSpeed = this.effectiveMoveSpeed();
    if (moveSpeed == null || dist === 0) {
      this.body.setVelocity(0, 0);
      return;
    }
    const speed = moveSpeed * LOITER_SPEED_MULTIPLIER;
    this.setVelocityX((dx / dist) * speed);
    // horizontal-locked boss: zero Y so it stays at its current elevation
    this.setVelocityY(this.behavior.horizontalMovementOnly ? 0 : (dy / dist) * speed);
  }

  // walks the authored patrol path in ping-pong order, with periodic idle dwells so it looks like strolling
  private updatePathLoiter(): void {
    const path = this.loiterPath;
    if (!path) return;
    const moveSpeed = this.effectiveMoveSpeed();
    if (moveSpeed == null) {
      this.body.setVelocity(0, 0);
      return;
    }

    const now = this.scene.time.now;
    if (now < this.pathPauseUntil) {
      // Parked at a dwell — hold position (gravity keeps grounded bodies on
      // the floor, so only zero Y when airborne) and keep idling.
      this.setVelocityX(0);
      if (!this.body.allowGravity) this.setVelocityY(0);
      return;
    }
    if (this.pathPauseUntil !== 0) {
      // Dwell just elapsed: resume the walk pose/sound and schedule the next.
      this.pathPauseUntil = 0;
      const walkAnim = this.effectiveWalkAnimation();
      if (walkAnim) this.playLogical(walkAnim);
      setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
      this.scheduleNextPathPause(now);
    } else if (now >= this.nextPathPauseAt) {
      // Time to stop and observe for a beat.
      this.beginPathPause(now);
      return;
    }

    const target = path[this.pathIndex];
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    // grounded/horizontal-locked: X-only arrival (Y is owned by gravity so a 2D check never resolves)
    const arrived =
      this.body.allowGravity || this.behavior.horizontalMovementOnly
        ? Math.abs(dx) < LOITER_TARGET_REACHED_DIST
        : Math.hypot(dx, dy) < LOITER_TARGET_REACHED_DIST;

    if (arrived) {
      this.advancePathIndex();
      return;
    }

    // face the travel direction so the sprite flips at endpoints rather than moonwalking
    this.facingDirection = dx >= 0 ? 1 : -1;
    this.setFacing(this.facingDirection === -1);

    if (this.body.allowGravity) {
      // Ground patrol: only steer X. Reuses the chase code's obstacle hop so
      // a step or low wall between waypoints isn't a hard stop.
      if (shouldJumpOverObstacle(this.probeCtx)) {
        this.setVelocityY(ENEMY_JUMP_VELOCITY);
      }
      this.setVelocityX(moveSpeed * this.facingDirection);
    } else if (this.behavior.horizontalMovementOnly) {
      // horizontal-locked boss: X only so it doesn't drift vertically between waypoints
      this.setVelocityX(Math.sign(dx) * moveSpeed);
      this.setVelocityY(0);
    } else {
      // Airborne patrol: head straight toward the waypoint in 2D.
      const dist = Math.hypot(dx, dy);
      this.setVelocityX((dx / dist) * moveSpeed);
      this.setVelocityY((dy / dist) * moveSpeed);
    }
  }

  // starts a patrol dwell: parks the body, shows idle pose, and mutes footsteps for a randomized beat
  private beginPathPause(now: number): void {
    this.pathPauseUntil =
      now +
      PATH_PAUSE_DURATION_MIN_MS +
      Math.random() * (PATH_PAUSE_DURATION_MAX_MS - PATH_PAUSE_DURATION_MIN_MS);
    this.setVelocityX(0);
    if (!this.body.allowGravity) this.setVelocityY(0);
    this.playLogical(this.config.defaultAnimation);
    setEnemyWalkSoundEnabled(this, false);
  }

  // Schedules the next dwell a randomized stroll-interval out from `now`.
  private scheduleNextPathPause(now: number): void {
    this.nextPathPauseAt =
      now +
      PATH_WALK_INTERVAL_MIN_MS +
      Math.random() * (PATH_WALK_INTERVAL_MAX_MS - PATH_WALK_INTERVAL_MIN_MS);
  }

  // advances the ping-pong path index, flipping direction at either endpoint
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

  // returns the index of the nearest waypoint so patrol resumes from the right spot after a chase
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

  // picks the next drift target — home-anchored enemies orbit the hive, player-anchored ones hover above the player
  private pickLoiterTarget(player: Player): void {
    const radius =
      LOITER_TARGET_MIN_RADIUS +
      Math.random() * (LOITER_TARGET_MAX_RADIUS - LOITER_TARGET_MIN_RADIUS);
    // home-anchored enemies orbit in a full circle; player-anchored keep the upper hemisphere spread
    const homeAnchored = this.homeAnchorX != null && this.homeAnchorY != null;
    const anchorX = homeAnchored ? this.homeAnchorX! : player.x;
    const anchorY = homeAnchored ? this.homeAnchorY! : player.y;
    const angleMin = homeAnchored ? HOME_LOITER_ANGLE_MIN : LOITER_ANGLE_MIN;
    const angleMax = homeAnchored ? HOME_LOITER_ANGLE_MAX : LOITER_ANGLE_MAX;
    const angle = angleMin + Math.random() * (angleMax - angleMin);
    this.loiterTargetX = anchorX + Math.cos(angle) * radius;
    this.loiterTargetY = anchorY + Math.sin(angle) * radius;
    this.loiterRefreshAt =
      this.scene.time.now +
      LOITER_REFRESH_MIN_MS +
      Math.random() * (LOITER_REFRESH_MAX_MS - LOITER_REFRESH_MIN_MS);
  }

  // ── Spawn-anchored ground wander (behavior.wander) ───────────────────────

  // picks the next stroll target within the wander band, always at least WANDER_MIN_TARGET_STEP_PX away
  private pickWanderTarget(): void {
    const radius = this.wanderRadius() ?? 0;
    const minX = this.spawnX - radius;
    const maxX = this.spawnX + radius;
    let target = minX + Math.random() * (maxX - minX);
    if (Math.abs(target - this.x) < WANDER_MIN_TARGET_STEP_PX) {
      // dead-band: step toward spawn so the entity drifts to center rather than picking a target under its feet
      const toward: 1 | -1 = this.spawnX >= this.x ? 1 : -1;
      target = this.x + toward * WANDER_MIN_TARGET_STEP_PX;
    }
    this.wanderTargetX = Math.max(minX, Math.min(maxX, target));
  }

  // true if the wander leap's landing is inside the band and within the climb/drop reach
  private isWanderLandingAllowed(landing: { x: number; y: number }): boolean {
    const radius = this.wanderRadius() ?? 0;
    if (Math.abs(landing.x - this.spawnX) > radius) return false;
    // Y grows downward: dy > 0 = landing below the foot (a drop), dy < 0 = above
    // (a climb). Allow drops up to MAX_DROP and climbs up to MAX_RISE.
    const dy = landing.y - this.body.bottom;
    if (dy < -WANDER_LEAP_MAX_RISE_PX) return false;
    if (dy > WANDER_LEAP_MAX_DROP_PX) return false;
    return true;
  }

  // sets a new target back toward spawn so the stroller doesn't re-probe a ledge or wall it just declined
  private turnBackFromEdge(blockedDir: 1 | -1): void {
    const radius = this.wanderRadius() ?? 0;
    const back = (-blockedDir) as 1 | -1;
    const step = Math.max(WANDER_MIN_TARGET_STEP_PX, radius * 0.5);
    const target = this.x + back * step;
    this.wanderTargetX = Math.max(
      this.spawnX - radius,
      Math.min(this.spawnX + radius, target),
    );
  }

  // swaps between the walk clip and the idle pose for the wander, only on change to avoid restarting the animation
  private setWanderWalking(walking: boolean): void {
    if (walking === this.wanderWalkAnimOn) return;
    this.wanderWalkAnimOn = walking;
    if (walking) {
      const walkAnim = this.effectiveWalkAnimation();
      if (walkAnim) this.playLogical(walkAnim);
      setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
    } else {
      this.playLogical(this.config.defaultAnimation);
      setEnemyWalkSoundEnabled(this, false);
    }
  }

  // The authored greeting config (behavior.wander.greet), or null.
  private greetConfig(): AnimatedEntityGreetConfig | null {
    return this.wanderConfig?.greet ?? null;
  }

  // per-frame stroll: greet partner if nearby, rest-break cadence, then walk toward target with obstacle hopping
  private updateAreaWander(): void {
    const moveSpeed = this.effectiveMoveSpeed();
    if (moveSpeed == null) {
      this.body.setVelocity(0, 0);
      return;
    }
    const now = this.scene.time.now;

    // (1) Greeting in progress: full stop, face the partner, bob. Only launch a
    // hop while grounded so each bob is a real pop off the floor.
    if (now < this.greetUntil) {
      this.setWanderWalking(false);
      this.facingDirection = this.greetFacing;
      this.setFacing(this.greetFacing === -1);
      this.setVelocityX(0);
      if (
        this.greetHopsLeft > 0 &&
        this.body.blocked.down &&
        now >= this.greetNextHopAt
      ) {
        this.setVelocityY(GREET_HOP_VELOCITY);
        this.greetHopsLeft--;
        this.greetNextHopAt = now + GREET_HOP_INTERVAL_MS;
      }
      return;
    }

    // (2) Look for a greeting partner (throttled). If a greeting starts this
    // frame, bail and let the gate above own it next frame.
    if (this.greetConfig() && now >= this.nextGreetScanAt) {
      this.nextGreetScanAt = now + GREET_SCAN_INTERVAL_MS;
      this.tryStartGreeting(now);
      if (now < this.greetUntil) {
        this.setWanderWalking(false);
        this.setVelocityX(0);
        return;
      }
    }

    // (3) Rest breaks: stroll for a random interval then idle a random beat — so wander doesn't look like constant pacing
    if (now < this.pathPauseUntil) {
      this.setWanderWalking(false);
      this.setVelocityX(0);
      return;
    }
    if (this.pathPauseUntil !== 0) {
      // Dwell just elapsed — clear it and schedule the next stroll interval.
      this.pathPauseUntil = 0;
      this.scheduleNextPathPause(now);
    } else if (now >= this.nextPathPauseAt) {
      // Time to stop and observe for a beat.
      this.pathPauseUntil =
        now +
        PATH_PAUSE_DURATION_MIN_MS +
        Math.random() *
          (PATH_PAUSE_DURATION_MAX_MS - PATH_PAUSE_DURATION_MIN_MS);
      this.setWanderWalking(false);
      this.setVelocityX(0);
      return;
    }

    // (4) Walk toward the target. X-only arrival: gravity owns Y on a grounded
    // body, so the authored target Y (== spawn row) is never reached exactly.
    const dx = this.wanderTargetX - this.x;
    if (Math.abs(dx) < LOITER_TARGET_REACHED_DIST) {
      this.pickWanderTarget();
      return;
    }
    const dir: 1 | -1 = dx >= 0 ? 1 : -1;
    this.facingDirection = dir;
    this.setFacing(dir === -1);
    this.setWanderWalking(true);

    const leapX = Math.max(moveSpeed, ENEMY_LEAP_HORIZONTAL_SPEED);
    if (this.body.blocked.down) {
      this.leapDirX = 0;
      if (shouldJumpOverObstacle(this.probeCtx)) {
        // Small wall between here and the target — hop it like a patrol step.
        this.setVelocityY(ENEMY_JUMP_VELOCITY);
        this.setVelocityX(moveSpeed * dir);
      } else if (isLedgeAhead(this.probeCtx, dir)) {
        // only leap if the landing stays inside the wander band; otherwise turn back
        const landing = findLeapLanding(this.probeCtx, 
          dir,
          leapX,
          { x: this.wanderTargetX, y: this.y },
          WANDER_MAX_LAUNCH_VELOCITY,
        );
        if (landing && this.isWanderLandingAllowed(landing)) {
          this.leapDirX = dir;
          this.setVelocityY(landing.vy);
          this.setVelocityX(leapX * dir);
        } else {
          this.setVelocityX(0);
          this.turnBackFromEdge(dir);
        }
      } else if (isBlockedByWall(this.probeCtx, dir)) {
        // wall too tall to mount — turn back rather than grinding into it
        this.setVelocityX(0);
        this.turnBackFromEdge(dir);
      } else {
        this.setVelocityX(moveSpeed * dir);
      }
    } else if (this.leapDirX !== 0) {
      // Airborne mid-leap: hold the committed arc so it clears the gap.
      this.setVelocityX(leapX * this.leapDirX);
    } else {
      this.setVelocityX(moveSpeed * dir);
    }
  }

  // ── Wander greetings (behavior.wander.greet) ──────────────────────────────

  // looks for a same-floor wanderer to greet; on a chance roll, starts a synchronized greeting on both
  private tryStartGreeting(now: number): void {
    const greet = this.greetConfig();
    if (greet == null) return;
    if (now < this.nextGreetAt) return;
    if (!this.body.blocked.down) return;
    const helper = this.scene as unknown as EnemyHelperScene;
    const proximitySq = greet.proximityPx * greet.proximityPx;
    let partner: Enemy | null = null;
    let bestDistSq = proximitySq;
    helper.forEachEnemy((other) => {
      if (other === this) return;
      if (!other.isGreetAvailable(greet.group, now)) return;
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      // reject partners on platforms above/below — must be on the same floor
      if (Math.abs(dy) > GREET_SAME_FLOOR_PX) return;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        partner = other;
      }
    });
    if (partner == null) return;
    if (Math.random() > greet.chance) {
      // Declined this crossing — brief cooldown so we don't reroll every scan
      // while they stand next to each other.
      this.nextGreetAt = now + GREET_SCAN_INTERVAL_MS * 4;
      return;
    }
    // Mutual: both stop and face each other on the same frame.
    const chosen: Enemy = partner;
    this.beginGreet(chosen.x, now);
    chosen.beginGreet(this.x, now);
  }

  // true when this entity is willing and ready to accept a greeting from a same-group partner
  isGreetAvailable(group: string, now: number): boolean {
    const greet = this.greetConfig();
    if (greet == null || greet.group !== group) return false;
    if (this.enemyState !== 'loiter') return false;
    if (!this.body.blocked.down) return false;
    if (now < this.greetUntil) return false;
    if (now < this.nextGreetAt) return false;
    return true;
  }

  // starts the greeting bob sequence, facing the partner — called on both entities the same frame
  beginGreet(partnerX: number, now: number): void {
    const greet = this.greetConfig();
    if (greet == null) return;
    this.greetFacing = partnerX >= this.x ? 1 : -1;
    this.greetHopsLeft = greet.hops;
    this.greetNextHopAt = now;
    // Window covers every hop plus a tail beat so the last bob lands before the
    // stroll resumes; a hop delayed by mid-air frames still fits.
    this.greetUntil =
      now + (greet.hops + 1) * GREET_HOP_INTERVAL_MS;
    this.nextGreetAt = this.greetUntil + greet.cooldownMs;
    this.setVelocityX(0);
    this.setWanderWalking(false);
    this.facingDirection = this.greetFacing;
    this.setFacing(this.greetFacing === -1);
  }

  // ══ End of the idle-motion cluster ═════════════════════════════════════════

  // kills the enemy: emits the boss-defeated event, tears down audio, plays death anim, or destroys immediately if no anim
  private enterDeadState(): void {
    this.enemyState = 'dead';
    this.clearCurrentAttack();
    // emit boss-defeated so GameScene records the kill, clears the arena, and triggers victory if it's the last boss
    if (this.isBoss()) {
      this.scene.events.emit(
        BOSS_DEFEATED_EVENT,
        this.getIdentifier(),
        this.x,
        this.y,
      );
    }
    // same teleport cleanup as enterHurtState — killing blow mid-blink must restore gravity
    this.endTeleport();
    // kill audio loops at death so the corpse doesn't keep cawing/buzzing through its death anim
    unregisterEntityAudio(this, this.iid);
    // zero velocity so the corpse plays its anim in place; airborne corpses need Y cleared too or they drift
    this.setVelocity(0, 0);
    const deathAnim = this.behavior.deathAnimation ?? 'death';
    const played = this.playLogical(deathAnim);
    if (!played) {
      // no death anim — destroy immediately and fire loot/explosion here so the short-circuit path doesn't skip them
      this.maybeTriggerDeathExplosion();
      this.maybeSpawnAmmoDrop();
      this.destroy();
    }
  }

  // fires the death-explosion AoE (if configured), damaging the player and nearby enemies; latched to fire once
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
      // overlapRect returns a square; discard anything outside the inscribed circle radius
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
        obj.takeDamage(explosion.damage, cx, { sourceIsPlayer: false });
      }
    }
  }

  // rolls the drops table and spawns any loot at the corpse's position; harmless copies drop nothing
  private maybeSpawnAmmoDrop(): void {
    // Harmless copies (boss self-clones) drop nothing — otherwise killing them
    // would yield the source boss's full loot table and be farmable.
    if (this.harmless) return;
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

  // per-frame animation hook: fires audio triggers, the death-explosion, and damage frames for the current attack
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

    // fires the death-explosion AoE on the configured frame so damage aligns with the visual blast peak
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

    // each melee hitbox fires on its own frame so a swing can hit at multiple points; firedMeleeHitboxes guards double-fires
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

    // each AoE damageFrame fires independently; catch-up on the next tick if an update was missed
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

  // re-arms the trigger set on a new clip, stops overhanging sounds, and pauses audio sequences for teleport clips
  private onAnimStart(animation: Phaser.Animations.Animation): void {
    this.firedTriggers.clear();
    this.stopActiveTriggerSounds();
    if (isTeleportAnimationKey(animation.key)) {
      pauseEntitySoundSequence(this);
    }
  }

  // re-arms only per-loop triggers (footsteps, beat impacts) on each repeat; long one-shots stay fired
  private onAnimRepeat(animation: Phaser.Animations.Animation): void {
    const triggers = getTriggersFor(animation.key);
    for (const trigger of triggers) {
      if (trigger.repeatPerLoop) {
        this.firedTriggers.delete(`${animation.key}:${trigger.name}`);
      }
    }
  }

  // stops any trigger sounds that shouldn't outlive the current animation clip
  private stopActiveTriggerSounds(): void {
    for (const sound of this.activeTriggerSounds) {
      if (sound.isPlaying || sound.isPaused) sound.stop();
    }
    this.activeTriggerSounds = [];
  }

  // clip-end router: handles death → destroy, wake → idle, teleport phase chain, and attack → combo/recover
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

    // wake clip done — clear dormant flags and hand off to normal AI
    if (this.waking && this.dormantWakeAnim != null) {
      const wakeKey = entityAnimFullKey(this.getIdentifier(), this.dormantWakeAnim);
      if (animation.key === wakeKey) {
        this.waking = false;
        this.dormant = false;
        this.enterIdle();
        return;
      }
    }

    const attack = this.currentAttack;
    // disappear clip done — reposition and begin appear or strike; bail before the recover branch
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
    // appear clip done (three-phase) — launch the strike clip; bail before the recover branch
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
        // try to chain a combo follow-up attack; if it fires, skip the recover path
        if (this.tryEnterComboFollowup(attack)) {
          return;
        }
        // advance the body to the lunge endpoint so idle resumes where the character landed
        if (attack.lungeDistance != null && !this.behavior.immovable) {
          this.applyLungeDisplacement(attack.lungeDistance);
        }
        this.enemyState = 'recover';
        this.cooldownUntil = this.scene.time.now + attack.cooldownMs;
        this.clearCurrentAttack();
        this.playAmbientAnimation();
        // seed a fresh loiter target so cooldown movement goes somewhere sensible
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

  // dispatches a damage-frame event to the correct per-type handler (melee, AoE, projectile, heal, summon)
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
      // teleport damage lives in the appear clip and uses the same melee hitbox path
      this.fireMeleeAttack(attack);
      return;
    }
    if (attack.type === 'summon') {
      this.fireSummonAttack(attack);
      return;
    }
    // ranged / magic — same delivery, different art
    this.fireProjectileAttack(attack);
  }

  // checks body overlap each tick of a dive and damages the player once on contact
  private applyDiveContact(player: Player): void {
    const attack = this.currentAttack;
    if (!attack || attack.type !== 'dive') return;
    const damage = attack.damage;
    if (damage == null) return;
    if (!this.scene.physics.world.overlap(this, player)) return;
    if (!this.harmless) player.hurt(damage, this.x, this.y);
    this.attackFired = true;
  }

  // fires an AoE at the player's ground position — optional dodge gates (airborne, open sky), VFX sprite or spriteless rect
  private fireAoeAttack(attack: AnimatedEntityAttackConfig): void {
    if (!this.playerRef) return;
    const vfxKey = attack.vfxAnimation;
    const damage = attack.damage;
    if (damage == null) return;

    // dodge window: skip the AoE if the player is airborne (and clears the minAirborneDodgeClearancePx threshold)
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
        // probe downward for the nearest ground tile; no tile in 48 rows = over a pit, treat as infinite clearance
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

    // open-sky check: suppress volley AoEs when a solid tile blocks the 128 px column above the player
    if (attack.requireOpenSky) {
      const helper = this.scene as unknown as EnemyHelperScene;
      const headX = this.playerRef.x;
      const headY = this.playerRef.body.top;
      if (helper.isLineBlocked(headX, headY, headX, headY - 128)) return;
    }

    const strikeX = this.playerRef.x;
    // anchor to player's feet so a bottom-anchored VFX frame sits on the ground, not the body center
    let strikeY = this.playerRef.body.bottom;

    // walk downward to find the nearest solid tile and anchor VFX there; falls back to body.bottom over a pit
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

    // snapshot locals before the delay so the closure still works if the enemy dies mid-cast
    const scene = this.scene;
    const depth = this.depth;
    const vfxConfig = vfxKey != null ? this.config.animations[vfxKey] : null;
    const playerRef = this.playerRef;
    const delayMs = attack.vfxDelayMs ?? 0;

    // schedule sound separately so it can lead the VFX spawn by up to delayMs
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

    // spriteless AoE: a delayed overlapRect at the strike point; damageHalfWidth/Height tune the dodge window
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
          if (!this.harmless) {
            playerRef.hurt(
              damage,
              strikeX,
              strikeY,
              hurtSource ? { source: hurtSource } : undefined,
            );
          }
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
        // VFX sprites bypass applyAnimationAnchor, so apply displayScale manually
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
          if (!this.harmless) {
            playerRef.hurt(
              damage,
              strikeX,
              strikeY,
              hurtSource ? { source: hurtSource } : undefined,
            );
          }
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

  // spawns minions flanking the caster, alternating sides, capped by summonMaxAlive
  private fireSummonAttack(attack: AnimatedEntityAttackConfig): void {
    if (this.harmless) return;
    const kinds = attack.summonKinds;
    const count = attack.summonCount;
    if (!kinds || kinds.length === 0 || count == null) return;
    // Prune dead/destroyed before counting live summons against the cap.
    const live = this.activeSummons.filter((e) => e.active && !e.isDead());
    let budget = count;
    if (attack.summonMaxAlive != null) {
      budget = Math.min(count, attack.summonMaxAlive - live.length);
    }
    if (budget <= 0) {
      this.activeSummons = live;
      return;
    }
    const helper = this.scene as unknown as EnemyHelperScene;
    const spawned: Enemy[] = [];
    for (let i = 0; i < budget; i++) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      // Alternate sides and step outward so a spawned pair flanks the caster
      // instead of stacking on one pixel.
      const sign = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i / 2);
      const offsetX =
        sign * (SUMMON_SPAWN_OFFSET_X + rank * SUMMON_SPAWN_SPACING_X);
      const minion = helper.summonEnemyAt(kind, this.x + offsetX, this.y);
      if (minion) spawned.push(minion);
    }
    this.activeSummons = [...live, ...spawned];
  }

  // stamps each hitbox in order until one connects; used for teleport's single damage event
  private fireMeleeAttack(attack: AnimatedEntityAttackConfig): void {
    const hitboxes = attack.hitboxes;
    const damage = attack.damage;
    if (!hitboxes || damage == null) return;
    for (const hb of hitboxes) {
      if (this.fireSingleMeleeHitbox(hb, damage)) return;
    }
  }

  // stamps one transient hitbox rect and hurts the player on overlap; harmless copies skip the damage but still return true
  private fireSingleMeleeHitbox(
    hb: AnimatedEntityHitboxConfig,
    damage: number,
  ): boolean {
    let hx: number;
    let hy: number;
    let hw: number;
    let hh: number;
    if (hb.matchBody) {
      // body-tracking hitbox: stamps the live body rect, independent of facing or frame anchor
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
        // Harmless copies still "connect" (return true so the strike resolves
        // and this hitbox isn't re-fired) but deal no damage or knockback.
        if (!this.harmless) obj.hurt(damage, this.x, this.y);
        return true;
      }
    }
    return false;
  }

  // spawns a projectile from the muzzle — straight (horizontal) or aimed at the player's position
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
    // origin X mirrors with facing so right-side muzzles still shoot forward when flipped
    const originOffsetX = (attack.projectileOriginX ?? 0) * this.facingDirection;
    const originOffsetY = attack.projectileOriginY ?? 0;
    const originX = this.x + originOffsetX;
    const originY = this.y + originOffsetY;
    let vx: number;
    let vy: number;
    if (attack.projectileStraight === true) {
      // straight shot: fly horizontally so the player dodges by elevation rather than sidestepping
      vx = speed * this.facingDirection;
      vy = 0;
    } else {
      // Aimed: home onto the player's position at fire time.
      const dx = this.playerRef.x - originX;
      const dy = this.playerRef.y - originY;
      const len = Math.hypot(dx, dy);
      if (len === 0) return;
      vx = (dx / len) * speed;
      vy = (dy / len) * speed;
    }
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

  // restores HP by the heal amount, clamped to maxHealth
  private applyHeal(attack: AnimatedEntityAttackConfig): void {
    const amount = attack.heal;
    if (amount == null) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  // damages the player on body overlap for each contact attack, gated by per-attack cooldowns
  private applyContactDamage(player: Player): void {
    for (const attack of this.attacks) {
      if (attack.type !== 'contact') continue;
      const damage = attack.damage;
      if (damage == null) continue;
      const ready = this.contactCooldowns.get(attack) ?? 0;
      if (this.scene.time.now < ready) continue;
      if (!this.scene.physics.world.overlap(this, player)) continue;
      if (!this.harmless) player.hurt(damage, this.x, this.y);
      // contact damage counts as conflict — keeps the enemy chasing and lights the red "!" icon
      this.refreshAggro();
      this.conflictUntil = this.scene.time.now + ENEMY_CONFLICT_WINDOW_MS;
      this.contactCooldowns.set(
        attack,
        this.scene.time.now + attack.cooldownMs,
      );
    }
  }

  // records peak fall velocity each airborne frame and applies impact damage on landing
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
        this.takeDamage(damage, this.x, {
          skipKnockback: true,
          sourceIsPlayer: false,
        });
      }
    }
    this.wasAirborne = false;
    this.peakFallVelocity = 0;
  }

  // read-only snapshot for the locomotion probe helpers in enemyLeapProbes.ts
  private get probeCtx(): LeapProbeContext {
    return {
      body: this.body,
      helper: this.scene as unknown as EnemyHelperScene,
      x: this.x,
      y: this.y,
      facingDirection: this.facingDirection,
    };
  }

  // Drops the current nav path so the next pursuit replans from a clean state.
  private clearNavPath(): void {
    this.nav.clear();
  }

  // thin wrapper around the nav follower — returns the next waypoint toward the goal, or null if no route
  private followNavPath(
    goalX: number,
    goalY: number,
  ): { x: number; y: number } | null {
    const helper = this.scene as unknown as EnemyHelperScene;
    return this.nav.follow(
      this.body.center.x,
      this.body.bottom,
      goalX,
      goalY,
      this.scene.time.now,
      helper,
    );
  }

  // steers one grounded step toward a nav waypoint using the chase locomotion primitives (hop, leap, mount)
  private steerToNavWaypoint(
    wp: { x: number; y: number },
    moveSpeed: number,
  ): void {
    const dir: 1 | -1 = wp.x >= this.body.center.x ? 1 : -1;
    this.facingDirection = dir;
    this.setFacing(dir === -1);
    const leapX = Math.max(moveSpeed, ENEMY_LEAP_HORIZONTAL_SPEED);
    if (this.body.blocked.down) {
      this.leapDirX = 0;
      const wpAbove = wp.y - this.body.bottom < -UP_LEAP_MIN_RISE_PX;
      if (shouldJumpOverObstacle(this.probeCtx)) {
        this.setVelocityY(ENEMY_JUMP_VELOCITY);
        this.setVelocityX(moveSpeed * dir);
      } else if (isLedgeAhead(this.probeCtx, dir) || wpAbove) {
        const landing = findLeapLanding(this.probeCtx, dir, leapX, wp);
        // For an ABOVE waypoint, only commit the leap if it actually gains height.
        // skip the leap if it can't gain height — let the stall watchdog reroute rather than bounce in place
        const leapHelps =
          landing !== null &&
          (!wpAbove || landing.y < this.body.bottom - UP_LEAP_MIN_RISE_PX / 2);
        if (leapHelps && landing) {
          this.leapDirX = dir;
          this.setVelocityY(landing.vy);
          this.setVelocityX(leapX * dir);
        } else {
          const mountVy = wpAbove ? findWallMountLaunch(this.probeCtx, dir) : null;
          if (mountVy !== null) {
            this.leapDirX = dir;
            this.setVelocityY(mountVy);
            this.setVelocityX(leapX * dir);
          } else {
            this.setVelocityX(moveSpeed * dir);
          }
        }
      } else {
        this.setVelocityX(moveSpeed * dir);
      }
    } else if (this.leapDirX !== 0) {
      this.setVelocityX(leapX * this.leapDirX);
    } else {
      this.setVelocityX(moveSpeed * dir);
    }
  }

  // steps sideways to escape from under a platform, refusing if a ledge is ahead; returns false so caller can try the other way
  private tryEscapeStep(escapeDir: 1 | -1, moveX: number): boolean {
    if (isLedgeAhead(this.probeCtx, escapeDir)) return false;
    this.facingDirection = escapeDir;
    this.setFacing(escapeDir === -1);
    this.setVelocityX(moveX * escapeDir);
    return true;
  }

}
