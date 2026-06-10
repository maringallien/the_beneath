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
  NAV_GOAL_HYSTERESIS_TILES,
  NAV_LOS_GRACE_MS,
  NAV_REPLAN_INTERVAL_MS,
  NAV_STALL_COOLDOWN_MS,
  NAV_STALL_MS,
  NAV_WAYPOINT_REACH_X_PX,
  NAV_WAYPOINT_REACH_Y_PX,
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
// Dormant/wake (ambush turrets like the wheel bot). Default line-of-sight
// detection distance used when behavior.dormant.range is unset — a bit under
// one screen-width so the bot wakes when the player is plainly in view, not
// from clear across an open arena it happens to share a sightline with.
const DEFAULT_DORMANT_WAKE_RANGE = 220;
// Summon spawn placement: minions appear flanking the caster, alternating
// sides and stepping outward so a spawned pair doesn't stack on one pixel.
const SUMMON_SPAWN_OFFSET_X = 28;
const SUMMON_SPAWN_SPACING_X = 22;
// Jump velocity for chase-time obstacle hops. Solving v² = 2·g·h with
// g = 800 (project gravity) and h = 2 tiles + margin → 40 px gives
// v ≈ 253 px/s. -260 keeps a comfortable buffer so a 2-tile wall is cleared
// without scraping; the chase X velocity keeps the body moving forward
// during the arc so it lands on the far side.
const ENEMY_JUMP_VELOCITY = -260;
// Cross-gap leaping (chase only). When a grounded chaser reaches a ledge with
// open air ahead, it searches for the GENTLEST jump arc that lands on solid
// ground toward the player and commits that — otherwise it stops at the edge
// instead of walking into the void. The search escalates from a one-tile hop up
// to the player's own jump velocity (PLAYER_JUMP_VELOCITY) and no further, so
// the enemy clears exactly the gaps the player can, in any direction (up / down
// / across), but never over-jumps a small gap and rockets into the ceiling.
// Horizontal leap speed is floored at the player's run speed so a slow enemy
// still gets the player's reach mid-leap.
const ENEMY_LEAP_HORIZONTAL_SPEED = PLAYER_RUN_SPEED;
// --- Grounded chase "is it actually moving?" detection (run vs idle pose) ---
// A grounded chaser can keep "chasing" while its body makes no headway — wedged
// against a wall it can't mount, parked at a ledge it can't leap. Rather than
// freeze it mid-stride ("running in place") or make it give up and wander off, we
// drive the chase ANIMATION off real self-movement: it plays the walk clip while
// moving and drops to its idle pose while wedged, but stays engaged (facing the
// player, velocity still aimed at it) so it resumes the instant it can move again
// — e.g. the player drops to a reachable spot. The metric is self-movement, not
// distance-to-player: a chaser closing the last few pixels (or detouring around
// terrain) is moving, so it keeps running; it never mistakes "player stepped just
// out of reach" for "stuck" (which an earlier distance-based stuck-bail did — it
// idled instead of closing back in). The grace window keeps a normally-moving
// chaser from flickering to idle on a single stationary frame.
const CHASE_STILL_GRACE_MS = 250;
// Minimum body displacement (px) since the last movement mark that still counts
// as "moving", so frame jitter — or a body wedged against a wall, which physics
// pins to ~0 movement — doesn't keep refreshing the movement timestamp.
const CHASE_MOVE_EPSILON_PX = 6;
// Up-leap (mounting a platform whose vertical face is directly ahead). Only fires
// when the player sits at least this far above the chaser, so it never jumps at a
// wall to reach a level or below player.
const UP_LEAP_MIN_RISE_PX = 24;
// Throttle for the climb-from-under-an-overhang search. That branch runs the full
// leap ladder, so cap it per enemy; between probes the enemy keeps walking toward
// the player. ~12 Hz reacts fast enough to catch the takeoff window while walking
// past it without paying the search every frame.
const UP_PROBE_INTERVAL_MS = 80;
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
// Home-anchored loiter (hive-tethered wasps) orbits a fixed world point rather
// than the player. Unlike the player-anchored spread above — which keeps the
// target in the upper hemisphere so the flyer hovers *above* the player — a
// home anchor can sit on a ceiling, wall, or floor, so the target sweeps the
// full circle [-π, π] around it for an even orbit.
const HOME_LOITER_ANGLE_MIN = -Math.PI;
const HOME_LOITER_ANGLE_MAX = Math.PI;
// Hysteresis for the home chase-leash. A home-anchored enemy breaks off the
// chase when the player passes the full leash radius, but only re-engages once
// the player comes back within this fraction of it. The gap stops a player
// hovering at exactly the radius from flipping the wasp between chase and
// drift-home every frame.
const HOME_LEASH_REENGAGE_FACTOR = 0.85;
const LOITER_REFRESH_MIN_MS = 1500;
const LOITER_REFRESH_MAX_MS = 3000;
// World-pixel distance below which we treat the loiter target as reached
// and repick early, so the crow doesn't stutter against a target it
// already overshot.
const LOITER_TARGET_REACHED_DIST = 12;
// Patrol dwell ("wandering"): while walking an authored loiterPath, the entity
// periodically halts and idles for a short beat so the back-and-forth reads as
// strolling-and-observing rather than a metronomic march. Both the stroll
// interval and the pause length are randomized per-occurrence so the cadence
// never looks mechanical. Applies to every path-follower (grounded NPCs,
// combat enemies patrolling out of combat, airborne flyers) — the dwell lives
// in updatePathLoiter, which only runs in the out-of-combat loiter state, so
// chase/attack are never delayed by a pause.
const PATH_WALK_INTERVAL_MIN_MS = 2500;
const PATH_WALK_INTERVAL_MAX_MS = 5500;
const PATH_PAUSE_DURATION_MIN_MS = 700;
const PATH_PAUSE_DURATION_MAX_MS = 1800;
// Spawn-anchored ground wander (see updateAreaWander). A grounded character
// with no authored loiterPath wanders by default, strolling within a radius of
// its spawn X and reusing the path dwell timers/constants above for its rest
// breaks. An authored behavior.wander block only overrides the tuning (radius,
// social greeting). These tune the parts not authored per-entity.
// Default stroll radius (world px) for a character that wanders by default — no
// authored loiterPath and no explicit behavior.wander. An authored
// behavior.wander.radius overrides this; bosses and behavior.stationary
// characters never default-wander (they hold idle). Matches the spirit walkers'
// authored radius so the ambient stroll reads consistently.
const DEFAULT_WANDER_RADIUS = 200;
// Minimum step (px) between consecutive wander targets so a fresh pick is never
// so close it "arrives" instantly and stutters the stroller in place.
const WANDER_MIN_TARGET_STEP_PX = 24;
// Vertical reach gates for a committed wander leap, measured from the takeoff
// foot to the landing. A stroller climbs up to ~4 tiles and drops up to ~4 tiles
// — symmetric so it can always climb back out of any drop it takes (no
// stranding), and a 4-tile fall stays under the fall-damage threshold. Beyond
// either bound it declines the leap and turns back from the edge.
const WANDER_LEAP_MAX_RISE_PX = 64;
const WANDER_LEAP_MAX_DROP_PX = 64;
// Wander jumps reach higher than the chase ceiling (PLAYER_JUMP_VELOCITY) so a
// stroller reliably lands atop a 4-tile-high platform: v=√(2·g·h), -380 ≈ a
// 90 px apex (~5.6 tiles), clearing a 64 px climb with margin. findLeapLanding
// still escalates from the one-tile floor, so flat gaps keep their gentle hop —
// this only raises the ceiling it may reach when a climb actually demands it.
const WANDER_MAX_LAUNCH_VELOCITY = -380;
// Greeting (behavior.wander.greet). Tiny hop impulse — a fraction of the 2-tile
// obstacle hop (ENEMY_JUMP_VELOCITY) so the greet bob reads as a friendly
// bounce, not a jump. v=√(2·g·h) with g=GRAVITY_Y (800) → -120 ≈ a 9 px bob.
const GREET_HOP_VELOCITY = -120;
// Spacing (ms) between a greeter's successive bobs. It only actually launches
// when grounded, so this is a floor on the cadence, not an exact period.
const GREET_HOP_INTERVAL_MS = 240;
// Throttle (ms) for the greet partner scan. Greeting is ambient flavor, so a
// ~5 Hz look for a nearby partner is plenty and keeps the O(enemy count) scan
// off the per-frame path.
const GREET_SCAN_INTERVAL_MS = 200;
// Greeting partners must be on the same floor — within this vertical band (px)
// of each other. Tight (under a tile) so a walker on a platform above or below
// is never treated as "beside" the one looking to greet, even though wanderers
// now leap several tiles up/down.
const GREET_SAME_FLOOR_PX = 12;
// Per-instance chase variation. Reinforcement waves spawn many identical
// enemies on the same frame; with one shared moveSpeed and pure straight-line
// homing they chase the player as a single synchronized mass, which reads as a
// rigid blob marching in lockstep. Each Enemy picks a fixed speed multiplier in
// [1 - JITTER, 1 + JITTER] at construction, so faster ones pull ahead and
// slower ones lag and a pack naturally spreads into a staggered formation
// within a second or two. Fixed (not re-rolled per frame) so each enemy keeps a
// stable personality rather than jittering in place.
const CHASE_SPEED_JITTER = 0.18;
// Airborne chasers (crows, wasps) additionally weave perpendicular to their
// homing vector so a swarm flies in independent arcs instead of one straight
// line. Each instance gets a random phase and angular frequency; the sideways
// velocity is a fraction of its (preserved) forward closing speed, so they
// still converge on the player at moveSpeed while weaving around the approach.
const AIRBORNE_WEAVE_FRACTION = 0.4;
const AIRBORNE_WEAVE_FREQ_MIN = 2.2; // rad/s
const AIRBORNE_WEAVE_FREQ_MAX = 4.0; // rad/s
// Combo chaining tolerates the player being knocked beyond the lead attack's
// strict range before it launches the follow-up. Every melee connect flings the
// player back (PLAYER_HURT_KNOCKBACK_X), so a 1-for-1 range check would sever a
// legitimate in-range combo the instant the opener lands — the player is shoved
// out of `range` before the chain decision runs. The lead attack's range is
// multiplied by this factor for the continue-decision ONLY (initial attack
// selection still uses the strict range), so a flurry like the assassin's
// attack1→attack2→attack3 stays fluid while still bailing if the player has
// genuinely fled the encounter.
const COMBO_FOLLOWUP_RANGE_TOLERANCE = 2;

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

// IntGrid values from the LDtk source. Match the constants in Player.ts —
// kept in sync by hand because the values are part of the LDtk schema, not
// runtime data, so factoring them out would just add an import for two ints.
const INTGRID_GROUND_VALUE = 1;
const INTGRID_BRIDGE_VALUE = 2;

// Per-spawn overrides applied at construction time, bypassing the registry
// defaults for a single Enemy instance. Used by the boss self-copy system
// (GameScene.spawnBossSelfCopies): a copy is built from the boss's own registry
// entry — so it inherits every animation, attack, and AI behavior — but is
// rendered harmless and given hand-set low HP.
export interface EnemySpawnOverrides {
  // When true the enemy deals no damage to the player and is invisible to the
  // boss/round-fight systems: it never emits the boss-defeated event, is never
  // selected as the active boss, shows no round HUD, and never round-breaks.
  readonly harmless?: boolean;
  // Overrides the computed max (and starting) health. Lets a copy be low-HP
  // without needing a separate registry entry.
  readonly maxHealth?: number;
  // Signed horizontal offset (world px) added to the player's X when this enemy
  // computes its chase target. Lets self-copies of a horizontal-movement-only
  // boss hold distinct stand-off slots beside the player instead of all homing
  // to the same player.x and stacking into one entity. 0 / unset = home dead-on.
  readonly chaseStandoffX?: number;
  // Shared coordinator joining this enemy to its boss self-copy group. Gates
  // teleports to one member at a time and feeds the lateral-separation pass so
  // the group never stacks into one sprite (see TeleportCoordinator). Unset for
  // everyone outside a split.
  readonly attackCoordinator?: TeleportCoordinator;
}

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
  // Effective max HP: authored behavior.health scaled by
  // ENEMY_HEALTH_MULTIPLIER for regular enemies (bosses keep their authored
  // value). Current health drains from here, the bar reads it as the
  // denominator, and combat-reset/heal clamp to it.
  private readonly maxHealth: number;
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
  // Committed horizontal direction of an in-flight chase leap (see
  // findLeapLanding and the grounded-chase branch). Set at takeoff so the enemy
  // holds its arc toward the chosen landing even if the player darts to the
  // other side mid-jump; reset to 0 on every grounded chase frame. 0 = not
  // leaping, in which case ordinary wall-hops keep their normal chase speed.
  private leapDirX: 1 | -1 | 0 = 0;
  // Self-movement tracker driving the grounded chase animation (walk while
  // moving, idle pose while wedged against a wall/ledge it can't pass — so a
  // blocked chaser shows an idle pose instead of "running in place", yet stays
  // engaged and resumes the instant it can move). `chaseAnchorX`/`chaseAnchorY`
  // mark where the body last registered real movement; `chaseMovedAt` is when
  // that was (0 = fresh/idle, re-armed on the next chase frame). `chaseAnimMoving`
  // caches which clip is currently showing so it's only swapped on a flip, never
  // restarted every frame. Reset when it stops chasing.
  private chaseAnchorX = 0;
  private chaseAnchorY = 0;
  private chaseMovedAt = 0;
  private chaseAnimMoving = false;
  // Throttle for the climb-from-under-an-overhang probe (a full ladder search).
  // Holds the last time it ran so it fires a few times a second, not every frame.
  private lastUpProbeAt = 0;
  // Escape-from-under-a-platform latch. When stranded beneath a platform the
  // chaser walks out to its nearer edge; this holds that direction so, once the
  // body clears the edge, "head toward the player" doesn't immediately pull it
  // back under before it reaches the takeoff window. `escapeFromX` is where the
  // latch was last refreshed, used to abort the escape after a bounded distance
  // if no jump materialises. 0 = not escaping.
  private escapeDirX: 1 | -1 | 0 = 0;
  private escapeFromX = 0;
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
  // World point this enemy loiters around and centers its chase leash on, or
  // null for the legacy player-anchored drift + un-leashed chase. Set after
  // spawn by GameScene for hive-tethered swarmers (wasps): the nearest hive's
  // spawn point, or the wasp's own spawn point when its level has no hive.
  // Survives respawns because GameScene re-applies it via the same post-spawn
  // pass. A captured world point — so wasps keep orbiting even after the hive
  // they were anchored to is destroyed.
  private homeAnchorX: number | null = null;
  private homeAnchorY: number | null = null;
  // Latches true while a home-anchored enemy has broken off its chase because
  // the player left the home leash radius. Drives the leash hysteresis: once
  // set, the player must return within HOME_LEASH_REENGAGE_FACTOR of the radius
  // to clear it and let the chase resume. Reset whenever the leash isn't in
  // force (no anchor, or forced convergence) so a re-engaged enemy starts clean.
  private leashBroken = false;
  // Scene-time at which the hive-defense alarm lapses. While in the future, a
  // home-anchored enemy ignores its leash and pursues the player no matter how
  // far the player has strayed from the hive — raised when the player attacks
  // the hive this wasp is anchored to (see raiseHomeAlarm). Decays like the
  // aggro window, after which territorial leashing resumes.
  private homeAlarmUntil = 0;
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
  // Patrol-dwell timers (scene-time ms). While walking an authored loiterPath
  // the entity strolls for a randomized interval, then halts and idles for a
  // randomized beat — see updatePathLoiter. pathPauseUntil > now means it is
  // currently parked at a dwell (0 = walking); nextPathPauseAt is when the
  // next dwell begins. Both reset on every (re)entry into loiter so a patrol
  // resumed after a chase starts clean rather than pausing immediately.
  private pathPauseUntil = 0;
  private nextPathPauseAt = 0;
  // Authored wander config (behavior.wander) only — null for everything else.
  // Whether a character actually area-wanders is decided live in wanderRadius(),
  // which falls back to a default stroll for grounded path-less characters; this
  // field just carries the authored radius + greet for the spirit walkers.
  // wanderTargetX is the current stroll target X; wanderWalkAnimOn tracks whether
  // the walk clip (vs the resting idle pose) is currently showing so
  // updateAreaWander only swaps animations on change rather than every frame.
  // See updateAreaWander / wanderRadius.
  private readonly wanderConfig: AnimatedEntityWanderConfig | null;
  private wanderTargetX = 0;
  private wanderWalkAnimOn = false;
  // Greeting (behavior.wander.greet). While greetUntil > now a greeting is in
  // progress: the entity is parked, facing greetFacing, bobbing tiny hops.
  // greetHopsLeft counts the bobs remaining and greetNextHopAt paces them.
  // nextGreetAt is the per-instance cooldown before it greets again; the scan
  // for a partner is throttled to nextGreetScanAt. All scene-time ms.
  private greetUntil = 0;
  private greetFacing: 1 | -1 = 1;
  private greetHopsLeft = 0;
  private greetNextHopAt = 0;
  private nextGreetAt = 0;
  private nextGreetScanAt = 0;
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
  // Scene-time at which combat aggro lapses. Refreshed on every exchange of
  // blows with the player — taking a player-dealt hit, committing an attack,
  // or landing contact damage. While aggroed the entity is "in conflict": it
  // abandons its loiter path / idle drift and pursues the player, chasing
  // past its configured chaseRange and ignoring its `aggressive` flag, until
  // the window lapses (ENEMY_COMBAT_TIMEOUT_MS after the last exchange) and
  // it gives up and resumes patrolling. Decoupled from inCombat (which is
  // gated on the floating HP bar) so it applies to every character —
  // bar-less swarm minions and bosses included. Sentinel 0 == not aggroed.
  private aggroUntil = 0;
  // Scene-time until which this enemy ignores the chase line-of-sight gate and
  // closes on the player through geometry. Opened by forceConverge() (the boss
  // round-fight convergence) and refreshed each frame while the fight is live,
  // so every enemy in the arena — including spiders stranded on a higher ledge
  // with the arena floor between them and the player — pursues instead of
  // idling behind cover. Lapses like the aggro window once the boss is gone;
  // sentinel 0 == respect LOS (normal exploration behavior).
  private convergeUntil = 0;
  // ── Stealth / detection ──────────────────────────────────────────────────
  // Derived awareness state (see enemyDetection.ts), recomputed every frame in
  // updateAlertState from line-of-sight + the active-combat window. Persistent —
  // it drives the aggregated HUD corner brackets via getAlertLevel. The overhead glyph
  // is a SEPARATE, transient flash keyed off escalations of this state.
  private alertState: AlertState = 'normal';
  // Previous frame's alertState, so an escalation edge (normal→investigating, or
  // →conflict) can flash the momentary overhead "?"/"!" glyph exactly once.
  private prevAlertState: AlertState = 'normal';
  // Whether the enemy could see the player on the most recent frame. Cached so
  // the chase/facing/search code can branch on "currently has eyes on" without
  // recomputing the line-of-sight raycast.
  private lastVisible = false;
  // Player's last-seen world position + whether one has been recorded. A
  // searching enemy heads here (not to the live player) so a hidden player isn't
  // magically tracked through walls.
  private lastSeenX = 0;
  private lastSeenY = 0;
  private hasLastSeen = false;

  // ── A* nav path-following (NavGraph / NavPathfinder) ──────────────────────
  // When aggro but blind to the target, the enemy follows an A* route toward the
  // target's standable cell instead of grinding straight at it. navPath holds the
  // world-px waypoints; navPathIdx is the current one; the rest throttle replans
  // and detect when the goal has moved to a new tile. Shared by the chase and
  // last-seen-search code (only one runs per frame).
  private navPath: ReadonlyArray<{ x: number; y: number }> | null = null;
  private navPathIdx = 0;
  private navReplanAt = 0;
  private navGoalCellX = Number.NaN;
  private navGoalCellY = Number.NaN;
  // Stall watchdog: wall-clock time of the last waypoint ADVANCE. If no waypoint
  // advances for NAV_STALL_MS the route is abandoned (see followNavPath).
  private navProgressAt = 0;
  // After a stall-abandon, path-following is suppressed until this time so the
  // enemy doesn't immediately re-path an unmakeable route (anti-bounce).
  private navSuppressUntil = 0;
  // While actively routing, pushed to now + NAV_LOS_GRACE_MS each frame; lets a
  // momentary line-of-sight (a jump apex) pass without dropping the route.
  private navHoldUntil = 0;
  // Resolved sight range / vision-cone half-angle (radians) for this instance —
  // authored overrides fall back to the global detection constants (computed
  // once in the constructor).
  private readonly detectionRange: number;
  private readonly visionHalfAngleRad: number;
  // On-the-hunt chase-speed multiplier for this instance (behavior.alertSpeedMul
  // or the global default), resolved once in the constructor.
  private readonly alertSpeedMul: number;
  // True when this enemy opts out of the stealth/detection system entirely
  // (behavior.ignoresStealth) — no vision cone, no glyph, no HUD contribution;
  // legacy always-on aggro/chase instead. Used by hive-leashed wasps.
  private readonly ignoresStealth: boolean;
  // Scene-time at which the active-combat window closes. Refreshed each time the
  // enemy commits an attack or lands contact damage; while it's open the enemy
  // reads as "conflict" (red "!"), otherwise an aware enemy is merely
  // "investigating" (yellow "?"). Decouples the red state from mere attack range
  // so a spotted enemy doesn't snap straight to "!" before it actually engages.
  private conflictUntil = 0;
  // Scene-time until which a freshly-spotting enemy holds still (the "stop and
  // show ?" telegraph) before it rushes to investigate. Sentinel 0 == not in the
  // stop beat.
  private investigateStopUntil = 0;
  // Transient overhead glyph + the scene-time it auto-hides at. The glyph flashes
  // on an escalation (a fresh spot → "?", an engage → "!") and clears after
  // ENEMY_ALERT_ICON_HOLD_MS even while the enemy stays aware — a momentary tell,
  // not a persistent label (the HUD corner brackets is the persistent readout).
  private iconGlyph: AlertGlyph = 'none';
  private iconHideAt = 0;
  // ── Search-after-losing-sight (last-seen hunt + return to post) ───────────
  // Scene-time by which the travel leg of a hunt must reach the last-seen / heard
  // spot before it bails to the look-around scan regardless (ENEMY_SEARCH_TRAVEL_
  // TIMEOUT_MS). Sentinel 0 == not currently hunting. Travel and the scan below
  // are budgeted separately so a far gunshot is walked to, not abandoned mid-step.
  private searchTravelUntil = 0;
  // Scene-time at which the current "look around the last-seen spot" scan ends.
  // Armed only once the enemy ARRIVES (or is walled off), so it times the scan,
  // not the travel.
  private searchLookUntil = 0;
  // Scene-time of the next facing flip while scanning ("looks around").
  private searchNextFlipAt = 0;
  // True once the enemy has given up the hunt and is walking back toward its
  // spawn / patrol post; cleared on arrival or on re-detecting the player.
  private returningToPost = false;
  // Progress-gated give-up for the walk home: the deadline (armed on the first
  // return frame, pushed out on every meaningful step closer) and the best
  // distance-to-post seen so far. If no headway is made before the deadline the
  // enemy settles where it is rather than pacing in place. See updateReturnToPost.
  private returnPostDeadline = 0;
  private returnPostBestDist = Infinity;
  // Overhead "?"/"!" detection glyph. Built only for enemies that can fight
  // (attack-less NPCs never detect), disposed via the DESTROY listener.
  private alertIcon: EnemyAlertIcon | null = null;
  // Latches true the moment the death-explosion AoE fires so the frame-
  // trigger path in onAnimUpdate and the no-anim fallback in enterDeadState
  // can't double-fire. No-op for entities without behavior.deathExplosion.
  private deathExplosionFired = false;
  // Highest round this boss has reached, 1-based. Latched upward (never
  // decreases) so a heal that pushes HP back across a threshold can't rewind
  // the round or re-fire the banner. Only meaningful when behavior.roundFight
  // is set; stays 1 otherwise. Recomputed from current HP in takeDamage.
  private roundReached = 1;
  // Scene-time at which the current round-transition freeze ends. While
  // `now < roundBreakUntil` the boss holds position and is invulnerable (the
  // cinematic "Round N" beat). Sentinel 0 == not in a break. Only ever set
  // for round-fight bosses, so the gates that read it are no-ops elsewhere.
  private roundBreakUntil = 0;
  // Per-spawn "harmless copy" flag (see EnemySpawnOverrides). When set, this
  // enemy deals no damage and reports isBoss()/isRoundFight() === false so the
  // boss-encounter, win-condition, HUD, and round-break systems ignore it.
  private readonly harmless: boolean;
  // Signed horizontal stand-off (world px) added to the player's X when this
  // enemy picks its chase target (see EnemySpawnOverrides.chaseStandoffX). Lets
  // self-copies of a horizontal-movement-only boss flank the player on distinct
  // X slots instead of all homing to the same point. 0 for everyone else.
  private readonly chaseStandoffX: number;
  // Shared boss self-copy coordinator (see EnemySpawnOverrides.attackCoordinator
  // / TeleportCoordinator). null outside a split; set on copies at construction
  // and on the boss via setTeleportCoordinator when round 3 begins. Drives the
  // one-teleport-at-a-time lock and the lateral separation pass.
  private teleportCoordinator: TeleportCoordinator | null;
  // Fixed-at-construction movement "personality" that desynchronizes packs
  // spawned on one frame (see CHASE_SPEED_JITTER / AIRBORNE_WEAVE_*). chaseSpeedMul
  // scales chase speed per-instance; weavePhase/weaveFreq drive the airborne
  // sideways weave. Bosses ignore both (mul forced to 1, weave to 0) so their
  // hand-tuned movement is unaffected.
  private readonly chaseSpeedMul: number;
  private readonly weavePhase: number;
  private readonly weaveFreq: number;
  // Dormant-until-spotted state (behavior.dormant). `dormant` holds the entity
  // inert (no AI, no encounter) until it gains line of sight; `waking` is the
  // brief window while the one-shot wake clip plays before normal AI resumes.
  // dormantWakeAnim caches the logical wake-animation key so the gate doesn't
  // re-read behavior.dormant each tick. All inert when behavior.dormant unset.
  private dormant = false;
  private waking = false;
  private readonly dormantWakeAnim: string | null;
  // Minions this entity has summoned that are still alive (type:'summon'
  // attacks). Pruned before each cast to enforce summonMaxAlive. Never tracked
  // for entities without a summon attack.
  private activeSummons: Enemy[] = [];

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
    // Authored spawn-anchored wander config (behavior.wander), or null. Only
    // carries the per-entity tuning (radius + social greeting) for characters
    // that author it — the spirit walkers. The *default* wander for any other
    // grounded, path-less, non-boss character is decided live in wanderRadius()
    // (not cached here): doing it at update time reads the body's final gravity
    // state and keeps the rule correct even for enemy instances that predate a
    // hot-reload, rather than freezing a constructor-time decision.
    this.wanderConfig = behavior.wander ?? null;
    this.dormantWakeAnim = behavior.dormant?.wakeAnimation ?? null;
    // A "harmless copy" (boss self-clone, see EnemySpawnOverrides) keeps the
    // source entry's animations/attacks/AI but deals no damage and is excluded
    // from the boss/round-fight machinery (isBoss/isRoundFight return false).
    this.harmless = spawnOverrides?.harmless === true;
    this.chaseStandoffX = spawnOverrides?.chaseStandoffX ?? 0;
    // Copies arrive with the group's coordinator in their overrides — join the
    // group now so the teleport lock + separation see them from frame one. The
    // boss (built long before the split) joins later via setTeleportCoordinator.
    this.teleportCoordinator = spawnOverrides?.attackCoordinator ?? null;
    if (this.teleportCoordinator) {
      this.teleportCoordinator.register(this);
    }
    // Roll this instance's movement personality once. Math.random is used
    // elsewhere in this class (attack selection) — no seeded RNG needed since
    // the only goal is that sibling enemies differ from one another.
    this.chaseSpeedMul = 1 + (Math.random() * 2 - 1) * CHASE_SPEED_JITTER;
    this.weavePhase = Math.random() * Math.PI * 2;
    this.weaveFreq =
      AIRBORNE_WEAVE_FREQ_MIN +
      Math.random() * (AIRBORNE_WEAVE_FREQ_MAX - AIRBORNE_WEAVE_FREQ_MIN);
    // An explicit per-spawn health override wins; otherwise bosses are exempt
    // from the global health bump (their HP is hand-tuned around the round-fight
    // thresholds) and everyone else scales by the global multiplier. Rounded so
    // HP stays integer (clean boss thirds / HUD reads).
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

    // Detection tuning. Sight range falls back to the lead attack's chaseRange
    // (an enemy "sees" about as far as it would give chase), then to the global
    // default; the cone half-angle and on-the-hunt speed boost fall back to
    // their global constants.
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
    // Also skipped for round-fight bosses: their HP is shown on the screen-
    // wide BossHud bar instead, and suppressing the floating bar here also
    // disables the 20 s combat-timeout heal (enterCombat early-returns with no
    // bar, so inCombat never flips and maybeExitCombat never resets HP) —
    // exactly what a persistent boss fight needs. The bar starts hidden; the
    // player's first hit on a normal enemy flips inCombat on and setVisible
    // follows.
    // Harmless self-copies are the exception to the round-fight skip: they're
    // built from a round-fight boss's entry (so behavior.roundFight is true) but
    // are excluded from the BossHud, so without a floating bar they'd show no HP
    // at all. The `|| this.harmless` keeps them reading like a regular enemy.
    if (
      behavior.hideHealthBar !== true &&
      (behavior.roundFight !== true || this.harmless) &&
      this.attacks.length > 0
    ) {
      this.healthBar = new EnemyHealthBar(scene, behavior.healthBarOffsetY ?? 0);
    } else {
      this.healthBar = null;
    }

    // Overhead "?"/"!" detection glyph: only for enemies that can fight (attack-
    // less NPCs never enter the detection machine) and that aren't exempt from
    // stealth (ignoresStealth — wasps), mirroring the health bar's lazy build.
    // Harmless self-copies keep it so a chasing copy still reads as alerted
    // during a boss fight.
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

    // Cancel any pending hurt timer when the sprite is destroyed (e.g. on
    // HMR teardown or death-anim complete). Without this, the delayedCall
    // can fire against a destroyed body and throw.
    // Dormant entities start inert, holding their asleep pose (a looping
    // `sleepAnimation` when set, else the curled first frame of the wake clip);
    // the update() dormant-gate plays the wake clip forward and clears the flag
    // once the player is spotted. Two opt-outs: harmless self-copies (they
    // inherit a dormant boss entry but must act immediately as part of the
    // fight), and instances given an authored walk path — a patrolling ambusher
    // makes no sense, so it skips the sleep/wake cycle and just walks its route.
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
      // Phaser doesn't auto-destroy plain Graphics objects when a sibling
      // sprite is destroyed; without this the bar would survive HMR teardown
      // (which clears the enemies group without restarting the scene). The
      // alert glyph is a Text object with the same lifecycle, so reclaim it too.
      this.healthBar?.destroy();
      this.alertIcon?.destroy();
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
  // the auto-respawn system entirely. Harmless copies report false so a copy's
  // death never emits BOSS_DEFEATED_EVENT (which would record the real boss as
  // defeated and could trigger a premature victory).
  isBoss(): boolean {
    return this.behavior.isBoss === true && !this.harmless;
  }

  // True when this boss uses the 3-round fight system (screen-wide segmented
  // bar + "Round N" banner + per-threshold freeze). Drives GameScene/BossHud.
  isRoundFight(): boolean {
    return this.behavior.roundFight === true && !this.harmless;
  }

  // Max HP — the registry's authored health scaled by ENEMY_HEALTH_MULTIPLIER
  // (bosses exempt; see the constructor). Current health drains from here; the
  // round-fight bar reads both to compute its fill ratio.
  getMaxHealth(): number {
    return this.maxHealth;
  }

  // Current latched round (1-based). Stays at 1 for non-round-fight enemies.
  getRound(): number {
    return this.roundReached;
  }

  // True once the boss-encounter trigger has fired (player entered the arena /
  // encounter radius). GameScene uses this to decide when the round UI shows.
  hasEncountered(): boolean {
    return this.encounterTriggered;
  }

  // True while this enemy is in active conflict — blows have been traded with
  // the player (it took or dealt damage) or it committed an attack, and the
  // aggro window hasn't lapsed. Distinct from hasEncountered() (mere room
  // entry): the boss round-fight convergence keys off this so arena enemies
  // only swarm once the fight is actually joined, not the instant the player
  // steps into the room. For a round-fight boss, inCombat never flips (the
  // floating health bar is suppressed), so the aggro window is the only
  // reliable "fight is live" signal.
  isInConflict(): boolean {
    return this.isAggro();
  }

  // True during a round-transition freeze: the boss is parked and invulnerable
  // while the "Round N" banner plays. GameScene's projectile overlap skips
  // impacts during this window (mirrors the teleport-blink pass-through).
  isInRoundBreak(): boolean {
    return this.roundBreakUntil > this.scene.time.now;
  }

  // Human-readable name for the round-fight bar. Prefers the registry's
  // displayName; falls back to a name derived from the entity identifier
  // (strip a trailing "_spawn", underscores → spaces, capitalize).
  getDisplayName(): string {
    return this.behavior.displayName ?? this.deriveDisplayName();
  }

  private deriveDisplayName(): string {
    const words = this.getIdentifier()
      .replace(/_spawn$/, '')
      .replace(/_/g, ' ')
      .trim();
    return words.length > 0
      ? words.charAt(0).toUpperCase() + words.slice(1)
      : 'Boss';
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

    if (this.enemyState === 'dead' || this.enemyState === 'hurt') {
      // A corpse skips the detection pass below, so clear its alert glyph AND
      // its alert state here — otherwise a stale glyph floats over the body and
      // getAlertLevel keeps the HUD corner brackets lit for a dead enemy.
      if (this.enemyState === 'dead') {
        this.alertState = 'normal';
        this.prevAlertState = 'normal';
        this.iconGlyph = 'none';
        this.alertIcon?.setGlyph('none');
      }
      return;
    }

    // Lateral de-stacking for grouped self-copies — runs across every live
    // state (idle / chase / attack / recover) so a hoarder pile that formed in
    // any of them slides apart. No-op outside a split, and skips the active
    // teleporter internally so a blink/strike placement is never perturbed.
    this.applyHoarderSeparation();

    // Round-transition freeze: while the break timer is live the boss is
    // parked and invulnerable (takeDamage gates on the same field). Hold
    // position and skip all AI until it lapses, then resume from idle. Only
    // round-fight bosses ever set roundBreakUntil, so this is inert otherwise.
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

    // Dormant gate: an ambush entity stays inert — holding its curled wake-pose
    // frame, running no encounter/chase/attack logic — until it gains a clear
    // line of sight to the player within the wake range. On first sight it
    // plays its wake clip once (waking=true); onAnimComplete clears both flags
    // and hands off to the normal AI loop, which then idles until the player is
    // within an attack's range. Returns early for the whole dormant + waking
    // window so nothing below runs before the entity has woken.
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
        // Harmless copies share the boss's encounterSoundId but must stay
        // silent — otherwise each copy re-blares the boss encounter sting.
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

    // Attack-less characters (e.g. spirit walkers) never fight: they patrol
    // their loiterPath under gravity — or stand idle when they have no path —
    // using the same movement code as any other character, then return before
    // all the attack/chase logic below. A hit can still knock them back, but
    // with no attack to resolve they can't be drawn into a chase; they just
    // resume walking their route.
    if (this.attacks.length === 0) {
      this.enterIdleOrLoiter(player);
      return;
    }

    this.playerRef = player;

    // Contact attacks run independently of the swing state machine — fire
    // first so a chase-and-bump enemy (wasp) damages on contact even mid-
    // recover. The player's own invuln window prevents tick-storms.
    this.applyContactDamage(player);

    // Stealth/detection pass: resolve whether the enemy can see the player this
    // frame, ramp suspicion → detection (opening the aggro window on a lock-on),
    // and drive the overhead "?"/"!" glyph. Runs before the facing/chase logic
    // below so both read this frame's alert state. No-op for attack-less NPCs.
    this.updateAlertState(player, dx, dist);

    // Face the player only while engaging or with eyes on them — in normal and
    // searching states the movement code (loiter/wander/search) owns facing, so
    // a turned back stays a real blind spot. Locked while attacking so the
    // committed swing's hitbox direction matches the animation shown.
    if (this.enemyState !== 'attack' && this.shouldFacePlayer()) {
      this.facingDirection = dx >= 0 ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }

    if (this.enemyState === 'recover') {
      if (this.scene.time.now < this.cooldownUntil) {
        // A path-walker in conflict holds position through the post-attack
        // cooldown rather than stepping back onto its patrol route — it has
        // abandoned the loiter path to focus on the player and resumes the
        // chase as soon as the cooldown ends. Out of conflict (or with no
        // authored path) loiter-capable entities keep drifting so a crow
        // that just landed an attack hovers visibly instead of freezing
        // mid-air for ~1s. Animation is already set to walk by
        // onAnimComplete's recover transition.
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

    // ── Stealth/detection gates ───────────────────────────────────────────
    // Stealth-enabled enemies only; bosses and boss-fight enemies skip these
    // and engage on range as before.
    //
    // 1. Spotting telegraph: a freshly-spotted enemy holds still and shows the
    //    "?" for a beat before it commits — the readable "stop, then rush" tell.
    if (
      this.isStealthEnabled() &&
      this.isAggro() &&
      this.scene.time.now < this.investigateStopUntil
    ) {
      if (this.enemyState !== 'idle') this.enterIdle();
      return;
    }
    // 2. Lost the player while aware → hunt the last-seen spot (rush there, look
    //    around, give up) rather than tracking a player it can't see. Returns
    //    before attack-picking so it can't swing at a hidden target through a wall.
    if (this.isSearching()) {
      this.updateSearch(player);
      return;
    }
    // 3. Gave up the hunt and can't passively drift home (a stationary guard):
    //    walk back to the spawn post before resuming idle.
    if (this.isReturningToPost()) {
      this.updateReturnToPost();
      return;
    }
    // 4. Oblivious: not yet detected, so it neither attacks nor chases — the
    //    player can slip past or behind it even within attack range.
    if (this.isStealthEnabled() && !this.isAggro()) {
      this.enterIdleOrLoiter(player);
      return;
    }

    const pick = this.pickAttack(dist);
    if (pick) {
      // Ranged/magic attacks need a clear line to the player — firing at a
      // wall is a wasted swing and looks broken. Melee swings still commit
      // through walls: the hitbox is short and usually can't reach the
      // player through a 16 px tile, and short-circuiting melee here would
      // make wall-hugging trivially exploitable.
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
      // The shot is walled off. Out of conflict the entity just holds /
      // loiters. In conflict it falls through to the chase block below so it
      // repositions toward the player for a clear line rather than standing
      // there or wandering back onto its patrol.
      if (!this.isAggro()) {
        this.enterIdleOrLoiter(player);
        return;
      }
    }

    // No usable attack right now — try to chase. Chase fields live on
    // attacks[0] (the lead/default attack); pool-based bosses authoring
    // multiple attacks should put the chase-bearing entry first.
    const chaseLead = this.attacks[0];
    const canMove =
      chaseLead.moveSpeed != null && !this.behavior.immovable;
    // Two ways into the chase: (1) the entity is flagged aggressive and the
    // player sits inside its configured chaseRange (the original behavior),
    // or (2) the entity is in conflict (aggroed) — once the player has drawn
    // it into a fight it pursues regardless of the aggressive flag or
    // chaseRange, abandoning any loiter path to focus on attacking. The aggro
    // window is the leash, so a player who fully disengages is eventually
    // dropped and the entity resumes patrolling.
    // The legacy "aggressive enemy auto-chases anything in chaseRange" trigger.
    // For stealth-enabled enemies it's replaced by the detection gate — sight
    // opens the aggro window in updateAlertState — so they only pursue once
    // they've actually spotted the player. Bosses and boss-fight enemies keep
    // the always-on trigger.
    const inConfiguredChaseRange =
      !this.isStealthEnabled() &&
      chaseLead.aggressive === true &&
      chaseLead.chaseRange != null &&
      dist <= chaseLead.chaseRange;

    // Home leash: a hive-tethered swarmer (wasp) only pursues while the player
    // is within homeLeashRange of its home anchor (the hive). Past that it
    // breaks off — even mid-aggro — and falls through to enterEngagedFallback,
    // which drifts it back to loiter around home. Gated on a home anchor +
    // leash range actually being set, so every other enemy is unaffected.
    // Forced convergence (boss round-fight) overrides the leash so arena
    // scripting can still pull reinforcement wasps onto the player. A
    // break-off/re-engage hysteresis gap (leashBroken) keeps a player loitering
    // at the radius from toggling chase on and off every frame.
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
      // Leash not in force (no home anchor, forced convergence, or hive-defense
      // alarm raised) — clear the latch so the enemy re-evaluates from a clean
      // state next time leashing applies.
      this.leashBroken = false;
    }

    if (canMove && !beyondLeash && (this.isAggro() || inConfiguredChaseRange)) {
      const helper = this.scene as unknown as EnemyHelperScene;
      // Chase is gated on line-of-sight so enemies don't pathologically shove
      // against walls between them and the player. Converging enemies (boss-room
      // round fight) skip the gate and close on the player through geometry, so
      // a spider on a higher ledge walks off and drops down to engage instead of
      // idling behind the arena floor. The gate still stands during normal
      // exploration, where wall-grinding pursuit would look broken.
      const now = this.scene.time.now;
      const losBlocked =
        !this.isConverging() &&
        helper.isLineBlocked(this.x, this.y, player.x, player.y);
      // Airborne chasers keep a strict sightline gate — they navigate in 2D and
      // would otherwise grind against walls between them and the player.
      if (losBlocked && !this.body.allowGravity) {
        this.enterEngagedFallback(player);
        return;
      }
      // Nav path-following: when grounded and blind to the player, route around
      // the blocking geometry via A* instead of grinding straight at it (or
      // giving up). Cleared the instant line-of-sight returns, so in-sight
      // chasing is unchanged. Airborne / converging chasers navigate in 2D /
      // through scripted geometry and never route; bosses keep their hand-tuned
      // (and arena-clamped) movement. While a route is active the enemy refreshes
      // its aggro window so a detour that briefly leaves chaseRange doesn't drop
      // it out of the chase mid-path.
      let navWp: { x: number; y: number } | null = null;
      if (this.body.allowGravity && !this.isBoss()) {
        if (losBlocked) {
          navWp = this.followNavPath(player.x, player.y);
          if (navWp) {
            this.refreshAggro();
            this.navHoldUntil = now + NAV_LOS_GRACE_MS;
          }
        } else if (now < this.navHoldUntil && this.navPath !== null) {
          // LOS only just cleared (e.g. at a jump apex) while mid-route — keep
          // following briefly so a momentary sightline doesn't drop the path and
          // bounce. A genuinely clear sightline lapses the grace and direct homing
          // resumes below.
          navWp = this.followNavPath(player.x, player.y);
        } else {
          this.clearNavPath();
        }
      }
      // Decide whether the chaser is actually making headway, to drive its
      // animation (walk while moving, idle pose while wedged) without ever leaving
      // the chase — see CHASE_STILL_GRACE_MS. Self-movement, not distance-to-
      // player, so closing the last few px (or detouring around terrain) still
      // reads as moving. Airborne and converging chasers always read as moving
      // (they navigate in 2D / are scripted through geometry). The first frame of
      // a fresh chase counts as moving so it shows the walk clip at once instead of
      // inheriting a stale wedged state from a prior chase (e.g. right after an
      // attack/recover cycle, before the body has stepped).
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
      // Enter/stay in chase, showing the walk clip while moving and the idle pose
      // while wedged. Swap the clip only on a flip so it isn't restarted (frozen
      // on frame 0) every frame; footsteps follow the same moving/idle state.
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
      // Surface-gated footsteps (pebble vs metal stairs) follow the moving state,
      // and re-resolve per-frame so they flip when the chaser walks onto/off a
      // bridge. Off any IntGrid tile they resolve to `null`, silencing surface
      // anchors while still letting `'always'` anchors play (e.g. ghoul mud).
      setEnemyWalkSoundEnabled(this, chaseMoving, this.currentWalkSurface());
      // Per-instance chase-speed spread so a same-frame swarm desyncs instead
      // of chasing in lockstep. Bosses keep their exact hand-tuned speed. A
      // stealth enemy that has detected the player also gets the on-the-hunt
      // speed boost (the spec's "moves at a higher speed than its walk") on top
      // of the jitter; bosses/boss-fight enemies are unaffected.
      const alertBoost =
        this.isStealthEnabled() && this.isAggro() ? this.alertSpeedMul : 1;
      const speedMul = (this.isBoss() ? 1 : this.chaseSpeedMul) * alertBoost;
      if (this.body.allowGravity) {
        // Ground-bound chase. Each grounded frame, in priority order:
        //   1. Hop a short solid wall directly ahead (≤2 tiles) — small steps.
        //   2. At a ledge with open air ahead, leap toward the player — the
        //      wall-aware probe finds the up / down / across landing that best
        //      closes on the player (including riding up a wall-attached platform
        //      in a vertical shaft); otherwise stop at the edge, never the void.
        //   3. Player on a platform above with a wall directly ahead — mount it
        //      (a flush-wall climb the ledge probe can't be launched from).
        //   4. Player above while on open ground — climb onto an overhead
        //      platform once positioned under its edge.
        //   5. Otherwise drive horizontally toward the player.
        // While airborne mid-leap, hold the committed leap momentum so the arc
        // actually clears the gap; an ordinary wall-hop (no leap committed)
        // keeps normal chase speed so short hops are unchanged.
        const dir = this.facingDirection;
        const moveX = chaseLead.moveSpeed! * speedMul;
        const leapX = Math.max(moveX, ENEMY_LEAP_HORIZONTAL_SPEED);
        // Following an A* route around blocking geometry: steer toward the next
        // waypoint with the shared locomotion primitives and skip the straight-
        // at-player logic (and the wedged-bail below — there's a path to walk).
        if (navWp) {
          this.steerToNavWaypoint(navWp, moveX);
          return;
        }
        if (this.body.blocked.down) {
          this.leapDirX = 0;
          // Wedged against geometry with no sightline to the player: stop pushing
          // into the wall. Stay in chase (the idle pose + silenced footsteps are
          // already set above, since chaseMoving is false, and facing still tracks
          // the player), so the instant LOS returns or the player closes the chase
          // resumes — but don't grind meanwhile. Gated on !chaseMoving (no headway
          // for CHASE_STILL_GRACE_MS), so an in-progress mount/leap/step is never
          // cut off: a productive climb is airborne (out of this blocked.down
          // branch) or still reads as moving. Airborne chasers bailed on losBlocked
          // far above; converging (boss-room) chasers have losBlocked === false.
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
            // Leap toward the player: up a shaft, down to a lower platform, or
            // across a gap — whichever lands closest to the player. The launch
            // is the gentlest that lands solidly (see findLeapLanding); its
            // horizontal speed is held through the arc by the leapDirX latch.
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
            // Player above and a wall blocks the walk forward: mount it (see
            // findWallMountLaunch). Null → keep pressing; the stuck-tracker
            // reroutes instead of hammering a wall it can't climb.
            const mountVy = findWallMountLaunch(this.probeCtx, dir);
            if (mountVy !== null) {
              this.leapDirX = dir;
              this.setVelocityY(mountVy);
              this.setVelocityX(leapX * dir);
            } else {
              this.setVelocityX(moveX * dir);
            }
          } else if (playerAbove) {
            // Player on a platform above while we're on open ground (no ledge,
            // no flush wall). Probe an up-leap onto a platform ahead-and-above
            // (throttled — it's the full ladder search) and commit when one lands
            // higher than here. The takeoff window is BEFORE the platform's near
            // edge, so the probe must run while the platform is still ahead.
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
              // Can't jump from here yet — choose how to reposition. Every
              // escape step goes through tryEscapeStep, which ledge-guards the
              // move (so working out from under a platform never walks the body
              // off its own floor) and faces the travel direction (so it
              // doesn't moonwalk away from the player it's facing).
              const underDir = overheadEscapeDir(this.probeCtx);
              if (underDir !== 0 && this.tryEscapeStep(underDir, moveX)) {
                // Stranded under a platform: walking out toward its nearer edge.
                // Latch the direction and where we started so the continuation
                // below carries us into the takeoff window once we're clear.
                this.escapeDirX = underDir;
                this.escapeFromX = this.x;
              } else if (
                underDir !== 0 &&
                this.tryEscapeStep((-underDir) as 1 | -1, moveX)
              ) {
                // Nearer edge runs off a ledge — head for the far edge instead
                // so we still get out from under without stepping into the void.
                this.escapeDirX = (-underDir) as 1 | -1;
                this.escapeFromX = this.x;
              } else if (
                underDir === 0 &&
                this.escapeDirX !== 0 &&
                Math.abs(this.x - this.escapeFromX) <= UP_LEAP_SCAN_REACH_PX &&
                this.tryEscapeStep(this.escapeDirX, moveX)
              ) {
                // Just cleared the overhang — keep going the latched way into
                // the takeoff window (tryEscapeStep set velocity + facing) so
                // "toward the player" doesn't pull us back under before the
                // up-probe fires next tick.
              } else {
                // Free of any overhang, or every escape route runs off a ledge —
                // close on the player to reach a takeoff edge. dir was
                // ledge-checked by the outer branch, so moving that way is safe.
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
        // Airborne but horizontal-locked (heart hoarder): chase along X only.
        // Y stays parked so the boss glides on a fixed line and only changes
        // elevation through its own attack-driven repositioning (teleport).
        // chaseStandoffX offsets the target X so self-copies hold distinct slots
        // beside the player instead of all homing to player.x and stacking (0
        // for the boss itself). A deadzone parks the enemy on its slot rather
        // than flip-flopping velocity sign every frame once it arrives.
        const speed = chaseLead.moveSpeed!;
        const targetDx = dx + this.chaseStandoffX;
        this.setVelocityX(
          Math.abs(targetDx) < HORIZONTAL_CHASE_STANDOFF_DEADZONE_PX
            ? 0
            : Math.sign(targetDx) * speed,
        );
        this.setVelocityY(0);
      } else {
        // Airborne chase (crows, wasps): home in on the player in 2D.
        // Normalize so diagonal flight isn't faster than cardinal flight,
        // and gate on len > 0 to avoid divide-by-zero when the entity is
        // overlapping the player (rare, but possible with contact attackers).
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const speed = chaseLead.moveSpeed! * speedMul;
          const nx = dx / len;
          const ny = dy / len;
          // Perpendicular weave: add a sideways oscillation so each flyer arcs
          // on its own rhythm instead of homing dead-straight alongside its
          // packmates. The forward (radial) component stays exactly `speed`, so
          // the closing rate is unchanged — only the lateral path differs.
          // Bosses get weave = 0, preserving their straight 2D homing.
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

    // Not pursuing this frame (out of range, leashed, or can't move) — idle the
    // movement tracker so the next pursuit re-arms from a fresh window.
    this.chaseMovedAt = 0;
    this.enterEngagedFallback(player);
  }

  // Public damage entry point. Called by GameScene's projectile-overlap
  // handler and by Player.applySwordHits during melee. `sourceX` is used to
  // compute knockback direction. `skipKnockback` is set by the fall-damage
  // path so a hard landing doesn't fling the enemy sideways off the spot
  // they just landed on. `sourceIsPlayer` (default true) distinguishes
  // player-dealt damage from environmental damage (traps, fall) — only
  // player-dealt damage flips the enemy into combat and shows the floating
  // HP bar.
  takeDamage(
    damage: number,
    sourceX: number,
    options: { skipKnockback?: boolean; sourceIsPlayer?: boolean } = {},
  ): void {
    if (this.enemyState === 'dead') return;
    // Invulnerable during a round-transition beat. The hit that STARTS the
    // break still lands (the break is armed below, after HP is applied), so
    // this only ignores SUBSEQUENT hits during the cinematic freeze. Covers
    // every damage source (projectile, melee, trap, fall) since they all
    // funnel through here.
    if (this.roundBreakUntil > this.scene.time.now) return;
    // A hit wakes a dormant ambusher immediately — being struck counts as
    // being spotted. Clear the flags so the normal hurt → AI flow takes over
    // (no wake clip; it was rudely roused) instead of snapping back to the
    // curled pose in the dormant gate next tick.
    if (this.dormant) {
      this.dormant = false;
      this.waking = false;
    }
    this.health = Math.max(0, this.health - damage);
    if (options.sourceIsPlayer !== false) {
      this.enterCombat();
      // A player-dealt hit puts the entity into conflict: it drops whatever
      // it was loitering at and pursues until the aggro window lapses.
      this.refreshAggro();
      // Being struck counts as being spotted — remember where the player is so
      // an enemy hit from concealment (a player ducking behind cover between
      // shots) heads over to investigate instead of standing there. Guarded on
      // playerRef so a hit landed before this enemy's first update() is safe.
      if (this.playerRef) this.recordLastSeen(this.playerRef);
    }
    // Push the new HP value into the bar regardless of source — if the
    // player already engaged this enemy, a trap finishing it off should
    // drain the bar visibly. Hidden bars dedup the redraw internally.
    this.healthBar?.setHealth(this.health, this.maxHealth);

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

    // Round-fight: did this non-lethal hit cross into a higher (latched)
    // round? If so, enter the cinematic round-break — freeze + invulnerable +
    // "Round N" banner (GameScene polls getRound()) — instead of the normal
    // hurt/knockback flow. Latched via roundReached so a later self-heal can't
    // rewind the round. Lethal hits returned at enterDeadState above, so the
    // final section's killing blow ends the fight rather than "advancing".
    if (this.isRoundFight()) {
      const computedRound = roundForRatio(this.health / this.maxHealth);
      if (computedRound > this.roundReached) {
        this.roundReached = computedRound;
        this.beginRoundBreak();
        return;
      }
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
    this.clearCurrentAttack();
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
    this.health = this.maxHealth;
    this.healthBar?.setHealth(this.health, this.maxHealth);
    this.healthBar?.setVisible(false);
  }

  // Begins a round-transition beat: freeze the boss in place and make it
  // invulnerable for BOSS_ROUND_BREAK_MS while the "Round N" banner plays;
  // update() resumes it from idle when the window lapses. Mirrors the
  // hurt-block cleanup so an in-flight swing or teleport is fully cancelled
  // before the freeze. Called from takeDamage when a non-lethal hit crosses a
  // round threshold.
  private beginRoundBreak(): void {
    this.roundBreakUntil = this.scene.time.now + BOSS_ROUND_BREAK_MS;
    this.enemyState = 'idle';
    this.attackFired = false;
    this.firedMeleeHitboxes.clear();
    this.firedAoeDamageFrames.clear();
    this.clearCurrentAttack();
    // Restores gravity + clears the teleport phase if the crossing hit landed
    // mid-teleport, so the boss doesn't freeze mid-blink.
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
    // Hold a neutral pose for the beat rather than freezing on a mid-attack
    // frame.
    this.playAmbientAnimation();
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
    // No attacking mid-jump. A gravity-bound enemy that has left the ground
    // (leaping a gap, hopping onto a platform, or knocked into the air) holds
    // its swing until it lands — a melee hit or shot fired from the air reads
    // as broken and lets the enemy strike from places it shouldn't reach. The
    // check is gated on allowGravity so flyers (crows, wasps), which are
    // airborne by design, are unaffected; it mirrors the off-grid idiom in
    // currentWalkSurface.
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
      // Combo-only follow-ups are never selected on their own — they run only
      // via tryEnterComboFollowup as another attack's chain. Skipping here is
      // what makes a strict "B only after A" finisher (e.g. assassin attack2)
      // unreachable except as the attack1 follow-up.
      if (attack.comboOnly === true) continue;
      // Per-attack lockout — skip if this specific attack is still on
      // its recast timer regardless of range / heal-threshold.
      const readyAt = this.attackReadyAt.get(attack) ?? 0;
      if (now < readyAt) continue;
      // Group teleport lock — only one boss self-copy may be mid-teleport at a
      // time. Without this the whole hoarder family blinks onto the player at
      // once (every teleport repositions to the player's spot), reading as one
      // stacked sprite and landing attack1 in unison. Skip teleports while a
      // group-mate holds the lock; melee/aoe stay eligible so the others keep
      // pressuring instead of freezing. No coordinator (solo boss) = no gate.
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
        // Straight projectiles fly horizontally, so a shot can only connect
        // when the muzzle's Y line passes through the player's body. When the
        // attack opts in via verticalAlignMarginPx, skip it while the player is
        // on a different elevation — the entity then falls through to chase and
        // repositions onto the player's row (or closes for melee) instead of
        // firing volleys that sail over/under them. Without this gate a mobile
        // straight shooter (hell bot) wastes every shot at a player one platform
        // up and never approaches.
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

  // True when a straight projectile fired right now would pass through the
  // player's body vertically — i.e. the muzzle's Y line (the same origin the
  // shot spawns from, this.y + projectileOriginY) sits within the player's body
  // height, expanded by the attack's verticalAlignMarginPx. Gates straight
  // ranged/magic attacks in pickAttack so a turret-style shooter only commits
  // when the shot can actually connect; off-row it chases to align instead.
  // Returns false (not aligned → don't fire) when there's no player reference
  // yet, so the entity defers to chasing rather than firing blind.
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

  private enterAttackState(attack: AnimatedEntityAttackConfig): void {
    this.enemyState = 'attack';
    // Committing an attack means the entity is engaged — sustain the aggro
    // window so it keeps pursuing between swings (chasing past chaseRange,
    // not drifting back to its patrol) for the whole fight, and open the
    // shorter active-combat window that flips the alert state to conflict
    // (red "!") and keeps it there between swings.
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
      // Claim the group teleport lock for the whole disappear → appear → strike
      // sequence so no group-mate blinks onto the player alongside us. Released
      // by clearCurrentAttack on every attack-exit path (recover / hurt / dead /
      // round-break / idle / loiter). pickAttack already gated others out, and
      // updates run single-threaded, so this is a safe unconditional claim. No-op
      // for a solo boss (no coordinator).
      this.teleportCoordinator?.acquire(this);
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

  // Combo chaining: after `attack` completes, with `comboChancePct` probability
  // launch its paired follow-up (`comboNextAnimation`) directly, bypassing the
  // recover/cooldown gap so the pair reads as one 1-2 combo. Returns true when a
  // follow-up was launched (caller must then skip the recover transition).
  // Bounded because the follow-up itself has no comboNextAnimation.
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
      // Don't chain into empty space if the player has genuinely left the
      // combo's reach — but tolerate the knockback the lead hit just dealt, or a
      // strict check would sever every combo the moment the opener connects (the
      // hit shoves the player out of `range`). Combo-only links carry no range of
      // their own (attack.range == null, e.g. assassin attack2→attack3) and chain
      // unconditionally; reachability was already vetted by the opener.
      if (
        attack.range != null &&
        dist > attack.range * COMBO_FOLLOWUP_RANGE_TOLERANCE
      ) {
        return false;
      }
      // Facing locks during 'attack', so update() won't re-orient us between
      // swings — re-face the player here so the follow-up points the right way.
      this.facingDirection = player.x >= this.x ? 1 : -1;
      this.setFacing(this.facingDirection === -1);
    }
    this.enterAttackState(next);
    return true;
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

  // Single exit point for the in-flight swing: releases the group teleport lock
  // (no-op unless this was a teleport we held) before clearing currentAttack.
  // Every state that ends or cancels an attack — recover, hurt, dead, round-
  // break, idle, loiter — routes through here so a teleport interrupted mid-blink
  // can never strand the lock and freeze every group-mate's teleport.
  private clearCurrentAttack(): void {
    if (this.currentAttack?.type === 'teleport') {
      this.teleportCoordinator?.release(this);
    }
    this.currentAttack = null;
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

  // Snaps the body forward by up to `distance` source px in the facing
  // direction at the end of a lunge attack (see
  // AnimatedEntityAttackConfig.lungeDistance). body.reset repositions body +
  // sprite together and zeroes velocity — correct for the attack→recover
  // handoff. The distance is first clamped by safeLungeDistance so the snap
  // can't drop the enemy through the world edge or out over a gap; clampToArena
  // on the next tick still pulls an arena-bound boss back inside its rect.
  private applyLungeDisplacement(distance: number): void {
    const safe = this.safeLungeDistance(distance);
    this.body.reset(this.x + safe * this.facingDirection, this.y);
  }

  // Clamps a requested lunge displacement to the furthest forward distance
  // (0..distance) that keeps the body inside the world bounds and — for
  // gravity-bound entities — over solid ground. body.reset teleports with no
  // collision, and a path-walking enemy like the assassin has no
  // spawnLevelBounds for clampToArena to rescue it, so an unclamped lunge can
  // reset the body past the world edge (it falls through the world) or off a
  // ledge (it falls to its death). Steps along the path at LEAP_PROBE_SAMPLE_PX
  // — fine enough that a one-tile gap can't slip between samples — and stops at
  // the first unsafe step, parking the body at the near edge instead of
  // teleporting it across the gap. Flyers (no gravity) skip the ground check so
  // they can still lunge over open air.
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

  // The animation to display when the entity has no committed action.
  // Loiter-capable entities (airborne with walkAnimation) use walk so a
  // crow doesn't hold its grounded idle pose mid-air; everything else
  // falls back to the registry's defaultAnimation, mirroring its
  // original semantics so partial-anim entities (e.g. The_hive uses
  // 'take_off' as its resting pose) keep working.
  private playAmbientAnimation(): void {
    // Only AIRBORNE loiterers (crows, wasps) hold their walk/fly clip while at
    // rest — a flyer snapping to a grounded idle pose mid-air looks broken.
    // Grounded entities, including authored path-walkers (canLoiter() is true
    // for them too), show the idle pose when standing still; their walk clip is
    // for actual locomotion only. Without the gravity gate a path-walking melee
    // enemy (e.g. the assassin) would "run in place" through its post-attack
    // recover — the body is parked there but this resting animation is showing.
    if (!this.body.allowGravity && this.canLoiter()) {
      const walkAnim = this.effectiveWalkAnimation();
      if (walkAnim) {
        this.playLogical(walkAnim);
        return;
      }
    }
    this.playLogical(this.config.defaultAnimation);
  }

  // Shows the dormant pose: the curled first frame of the wake clip, held
  // paused. Called once at construction for dormant entities; the update()
  // dormant-gate plays the clip forward from here when the player is spotted.
  private holdDormantPose(): void {
    // When the entity defines an explicit looping sleep clip (e.g. the wheel
    // bot's curled 'sleep'), rest on that while dormant; the gate swaps to the
    // one-shot wake clip on first sight. playLogical returns false if the key
    // is missing, so a bad config falls through to the wake-frame-0 pose.
    const sleepAnim = this.behavior.dormant?.sleepAnimation;
    if (sleepAnim != null && this.playLogical(sleepAnim)) return;
    if (this.dormantWakeAnim == null) return;
    const wakeKey = entityAnimFullKey(this.getIdentifier(), this.dormantWakeAnim);
    // play() starts the clip at frame 0; pausing immediately holds that curled
    // first frame. Passing no frame to pause() avoids caching a live frame
    // object that can go stale (and silently no-op) across an animation-manager
    // rebuild on HMR.
    this.play(wakeKey);
    this.anims.pause();
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

  // True while the entity is actively in conflict with the player — it has
  // traded blows recently and hasn't yet timed out. Drives the "abandon the
  // loiter path and focus on the player" behavior in update(): aggroed
  // entities chase past their configured chaseRange (and even without the
  // aggressive flag) and hold ground facing the player instead of resuming
  // a patrol.
  private isAggro(): boolean {
    return this.scene.time.now < this.aggroUntil;
  }

  // (Re)starts the aggro window. Called on every exchange of blows with the
  // player so a sustained fight keeps the entity engaged; the window lapses
  // ENEMY_COMBAT_TIMEOUT_MS after the last exchange, at which point the
  // entity gives up the chase and returns to its loiter path / idle.
  private refreshAggro(): void {
    this.aggroUntil = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
  }

  // ── Stealth / detection ──────────────────────────────────────────────────

  // Aggregated detection level for the HUD corner brackets (0 normal,
  // 1 investigating, 2 conflict). GameScene takes the max across all live
  // enemies each frame and recolours the corners faint-white / yellow / red.
  getAlertLevel(): 0 | 1 | 2 {
    return alertLevel(this.alertState);
  }

  // Stealth applies when this enemy can fight, isn't a boss, and no boss fight
  // is active. Bosses and every enemy during a boss fight are "always
  // detectable" — they bypass the facing gate and the stop-and-investigate
  // telegraph and fall back to the legacy always-on aggro/chase.
  private isStealthEnabled(): boolean {
    if (this.alertIcon == null) return false; // attack-less / stealth-exempt
    if (this.ignoresStealth) return false; // wasps & other legacy swarmers
    if (this.isBoss()) return false;
    return !(this.scene as unknown as EnemyHelperScene).isStealthDisabled();
  }

  // Whether to point the enemy at the live player this frame. Only while
  // engaging or with eyes on them; in normal/searching states the movement code
  // owns facing, so a turned back is a genuine blind spot. Stealth-off enemies
  // always face the player (legacy look-at-player-every-frame behavior).
  private shouldFacePlayer(): boolean {
    if (!this.isStealthEnabled()) return true;
    if (this.alertState === 'conflict') return true;
    if (this.alertState === 'investigating') return this.lastVisible;
    return false; // normal
  }

  private recordLastSeen(player: Player): void {
    this.lastSeenX = player.x;
    this.lastSeenY = player.y;
    this.hasLastSeen = true;
  }

  // Can the enemy see the player this frame? Stealth on: within the detection
  // radius AND inside the forward vision cone (a turned back is a blind spot),
  // with a clear line — no collision tile between them (the player "behind tiles
  // on the collision layer"). Stealth off (boss fight / boss): within range +
  // clear line only, no cone. The cone/range test is cheap and gates the LOS
  // raycast so the per-tile walk only runs for a player who's already close and
  // in front.
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

  // The moment of spotting (fresh line of sight while not already aware): open
  // the aggro window, arm the stop-and-investigate telegraph, and play the
  // one-shot alert sting — spatial, so distant lock-ons stay quiet, and a no-op
  // until an 'enemy_alert' sound is registered. Harmless copies stay silent.
  // last-seen is recorded by the caller before this runs.
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

  // React to the player firing a gun nearby. Gunfire is loud, so — unlike the
  // silent sword/magic — the enemy is alerted even with no line of sight and
  // investigates the EXACT spot the shot came from. Reuses the spot machinery
  // (aggro window + "?" stop-telegraph + sting) but points last-seen at the
  // gunshot rather than the player, so the existing search code (isSearching →
  // updateSearch) walks the enemy straight there. GameScene calls this on every
  // stealth-enabled enemy within ENEMY_GUNSHOT_HEARING_RADIUS_PX of a shot;
  // isStealthEnabled() already excludes bosses, wasps, attack-less NPCs, and any
  // enemy during a boss fight (they use legacy always-on aggro instead).
  hearGunshot(x: number, y: number): void {
    if (this.isDead() || !this.isStealthEnabled()) return;
    const fresh = !this.isAggro();
    this.lastSeenX = x;
    this.lastSeenY = y;
    this.hasLastSeen = true;
    if (fresh) {
      this.onSpotted();
    } else {
      // Already hunting — retarget to the newer, louder cue and keep the aggro
      // window alive without re-flashing the telegraph. Re-arm both hunt budgets
      // so it beelines to the NEW spot rather than continuing toward the stale one
      // or sitting in a finished scan.
      this.refreshAggro();
      this.returningToPost = false;
      this.searchTravelUntil = 0;
      this.searchLookUntil = 0;
    }
  }

  // Per-frame detection pass (pure parts in enemyDetection.ts). Resolves line of
  // sight, opens aggro on a fresh spot, classifies the alert state from the
  // active-combat window, and flashes the transient overhead glyph. No-op for
  // attack-less NPCs (no icon).
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

    // Conflict = actively engaging: mid-swing/recover, or inside the post-attack
    // combat window (refreshed on each attack / contact hit). Decoupling the red
    // "!" from mere attack range is what stops a spotted enemy snapping straight
    // to "!" before it has actually closed in and engaged.
    const aware = this.isAggro();
    const inConflict =
      this.enemyState === 'attack' ||
      this.enemyState === 'recover' ||
      now < this.conflictUntil;
    this.alertState = classifyAlert({ inConflict, aware });

    this.alertIcon.setAnchor(this.body.center.x, this.body.top);
    this.updateAlertIcon(now);
  }

  // Drives the transient overhead glyph: flash a yellow "?" on a fresh spot
  // (normal→investigating) and a red "!" on engaging (→conflict), then auto-hide
  // after ENEMY_ALERT_ICON_HOLD_MS even while the enemy stays aware. No re-flash
  // on de-escalation (conflict→investigating shows nothing). The HUD corner brackets,
  // driven separately off the persistent alertState, is the lasting readout.
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

  // True when alerted but currently without eyes on the player — the enemy
  // should hunt the last-seen spot rather than track the hidden player. Only
  // stealth-enabled fighters search; boss-fight enemies keep legacy pursuit.
  private isSearching(): boolean {
    return (
      this.isStealthEnabled() &&
      this.isAggro() &&
      !this.lastVisible &&
      this.hasLastSeen
    );
  }

  // Hunt the player's last-seen / heard location in two phases: TRAVEL — beeline
  // to the spot at the hunt pace, keeping the aggro window alive so a far gunshot
  // is actually reached — then LOOK — scan the area ("looks around") and give up.
  // The travel backstop (ENEMY_SEARCH_TRAVEL_TIMEOUT_MS) ends a hunt that can't
  // reach the spot (blocked path); re-seeing the player drops out of search
  // immediately (isSearching → false the moment lastVisible flips).
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
    // A tall wall between the searcher and the last-seen spot (e.g. a gunshot
    // heard through a wall) can't be crossed by the hunt's hop-only locomotion.
    // Treat it like "arrived": stop and run the look-around scan rather than
    // grinding the wall for the whole travel budget.
    const dirSeen: 1 | -1 = dxSeen >= 0 ? 1 : -1;
    const wallBlocked =
      canMove && this.body.allowGravity && isBlockedByWall(this.probeCtx, dirSeen);
    // Route around blocking geometry to the last-seen / heard spot via A* when a
    // straight hop-only beeline won't reach it (e.g. a gunshot heard through a
    // wall). null when no route exists — then the wall-block gate below sends the
    // enemy to the look-around scan instead of grinding the wall.
    const navWp =
      canMove && this.body.allowGravity && !arrived
        ? this.followNavPath(this.lastSeenX, this.lastSeenY)
        : null;

    // ── Travel phase ──────────────────────────────────────────────────────
    // Still en route, able to move, and inside the travel backstop: head to the
    // spot — following a nav route when one exists, else a straight beeline.
    // Refresh the aggro window every step so a long trek to a distant gunshot
    // doesn't lapse mid-walk — arrival (→ scan → give up) or the backstop ends the
    // hunt, never the combat timeout catching the enemy in transit.
    if (
      !arrived &&
      canMove &&
      now < this.searchTravelUntil &&
      (navWp !== null || !wallBlocked)
    ) {
      this.refreshAggro();
      // Discard any look budget armed by a transient wall-block we've since
      // cleared, so reaching the spot always earns a fresh scan rather than a
      // half-elapsed one.
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
    // Arrived, walled off, immovable, or the travel backstop fired. Arm the scan
    // budget once, then stop and flip to look each way on a steady cadence until
    // it lapses, at which point the hunt ends.
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

  // Ends the hunt now: drop the aggro/converge windows, clear the last-seen
  // memory, and arm an explicit walk back to the spawn post. Every enemy returns
  // (not just stationary guards): an enemy that A*-routed across rooms to a
  // gunshot can't retrace the way home on reactive loiter/wander alone, so
  // updateReturnToPost path-finds it back, after which normal patrol resumes.
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

  // True while walking back to the spawn post after giving up (only for enemies
  // that don't loiter/wander home on their own). Cleared on arrival or the
  // instant the player is re-detected (aggro re-opens).
  private isReturningToPost(): boolean {
    return (
      this.returningToPost && this.isStealthEnabled() && !this.isAggro()
    );
  }

  // Walks the enemy back toward its spawn point at a calm pace, then resumes
  // idle. Grounded enemies steer X only (gravity carries the rest).
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
    // Arrived: a grounded enemy judges by HORIZONTAL distance (gravity owns Y, and
    // a small foot-vs-spawn-point Y offset must not block arrival and leave it
    // jittering at the post); airborne judges in 2D. The Y bound still rejects a
    // false "home" on a different floor directly above/below the post.
    const homeReached = grounded
      ? Math.abs(dxHome) <= ENEMY_SEARCH_REACH_DIST_PX &&
        Math.abs(dyHome) <= TILE_PX * 2
      : Math.hypot(dxHome, dyHome) <= ENEMY_SEARCH_REACH_DIST_PX;
    if (homeReached) {
      this.finishReturnToPost();
      return;
    }
    // Progress-gated give-up: arm the deadline on the first frame and push it out
    // whenever the enemy gets meaningfully closer to the post. If it makes no
    // headway for ENEMY_RETURN_POST_TIMEOUT_MS (route stalled, post unreachable —
    // e.g. behind a now-closed door), settle here rather than pacing forever.
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
    // Hold still (rather than reactive-beeline) while a stalled route cools down —
    // the reactive direction can oppose the route's and produce the left/right
    // oscillation — or when already horizontally home (a different floor). Decided
    // before the clip so a held enemy shows idle, not a walk-in-place.
    const holding =
      navWp === null &&
      (now < this.navSuppressUntil ||
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
    // Moving home — walk clip on entry only (play() restarts, so a per-frame call
    // would freeze it on frame 0).
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

  // Ends a return-to-post: clears the flag + deadline + nav path and drops to
  // idle (normal idle → loiter/wander resumes next frame).
  private finishReturnToPost(): void {
    this.returningToPost = false;
    this.returnPostDeadline = 0;
    this.returnPostBestDist = Infinity;
    this.clearNavPath();
    this.enterIdle();
  }

  // External trigger to force this entity into pursuit without a blow having
  // landed — used by the boss round-fight system to make every enemy in the
  // arena abandon its loiter path and converge on the player when a round
  // starts. Same effect as trading a blow: it (re)opens the aggro window, so
  // update() chases the player regardless of the aggressive flag or chaseRange.
  // GameScene calls this each frame while the fight is live, so pursuit never
  // lapses mid-fight; it decays normally once the boss is gone.
  forcePursue(): void {
    this.refreshAggro();
  }

  // forcePursue plus a line-of-sight bypass: the enemy not only chases (aggro
  // window) but closes on the player even through walls/floors. Used by the boss
  // round-fight convergence so every enemy in the arena reaches the player —
  // most visibly a reinforcement spider spawned on a higher ledge, which under
  // plain forcePursue would idle because the arena floor blocks LOS. GameScene
  // calls this each frame while the fight is live, so both the aggro and
  // converge windows stay open; they decay together once the boss is gone and
  // the enemy resumes normal, LOS-respecting behavior.
  forceConverge(): void {
    this.forcePursue();
    this.convergeUntil = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
  }

  // External trigger to make this enemy give up the chase on the spot: clears
  // the aggro, converge, and hive-alarm windows so it stops pursuing now rather
  // than ENEMY_COMBAT_TIMEOUT_MS after the last blow. Used by the boss-fight
  // escape system — while the player is outside the arena every arena enemy is
  // dropped each frame so nothing trails the player out of the room; they fall
  // back to their loiter path / home drift / idle. A live chase is broken
  // immediately; other states unwind through update()'s normal routing once the
  // windows are clear.
  dropPursuit(): void {
    this.aggroUntil = 0;
    this.convergeUntil = 0;
    this.homeAlarmUntil = 0;
    this.leashBroken = false;
    if (this.enemyState === 'chase') {
      this.enterIdle();
    }
  }

  // Full fight reset, called by GameScene's escape system when the player
  // abandons the arena past the grace window. Restores this boss to its
  // pre-encounter state so a returning player meets a fresh fight: HP and round
  // back to full, the encounter latch + engage gate re-armed (re-entering
  // replays the sting and engage delay), every aggro/converge/break window
  // cleared, any committed swing or mid-blink teleport unwound (mirrors
  // beginRoundBreak's cleanup — restores gravity, releases the group teleport
  // lock), and the body snapped home to its spawn point. The self-copy
  // coordinator ref is dropped because GameScene destroys the copies on reset.
  // enterIdle leaves the boss resting until the encounter re-triggers.
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
    // A fresh fight shouldn't count minions summoned in the abandoned one
    // against the summon cap. (Defensive: summon attacks are on non-boss
    // entities today, but resetEncounter is the right place to clear this.)
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

  // Joins this enemy to a boss self-copy group's shared coordinator. Used for
  // the BOSS itself, which is constructed long before it splits — copies receive
  // the coordinator through their spawn overrides instead. Registers so the
  // separation pass and teleport lock include the boss from the moment round 3
  // begins. Idempotent (register is a Set add).
  setTeleportCoordinator(coordinator: TeleportCoordinator): void {
    this.teleportCoordinator = coordinator;
    coordinator.register(this);
  }

  // Lateral de-stacking for grouped self-copies. The chase stand-off slots only
  // spread members while actively chasing; teleport landings, edge-clamped
  // slots, and the zero-velocity attack/recover/idle states can still leave two
  // hoarders overlapping. Each frame, nudge this member away (X only — the
  // family is horizontal-movement-only) from any group-mate within MIN_DX, so
  // the trio never collapses into a single sprite. No-op outside a split (no
  // coordinator). The active teleporter is skipped so its blink reposition /
  // strike placement is never perturbed; a stacked group-mate of the teleporter
  // still slides off it (the teleporter holds its spot, the other moves the full
  // amount via the iid tie-break).
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
      // Direction away from the overlap. Perfectly stacked (dx === 0) breaks the
      // tie on the stable per-spawn iid so the pair splits apart deterministically
      // instead of both picking the same side and never separating.
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

  // World point this enemy was constructed at. Exposed so GameScene can tether
  // hive-anchored swarmers (wasps) to a hive's spawn point and fall back to the
  // wasp's own spawn when its level has no hive.
  getSpawnPoint(): { readonly x: number; readonly y: number } {
    return { x: this.spawnX, y: this.spawnY };
  }

  // Sets the world point this enemy orbits while loitering and centers its
  // chase leash on (see homeAnchorX/Y, homeLeashRange). Called post-spawn by
  // GameScene; idempotent, so re-applying it on respawn is safe.
  setHomeAnchor(x: number, y: number): void {
    this.homeAnchorX = x;
    this.homeAnchorY = y;
  }

  // World point this enemy currently orbits / leashes to, or null when it uses
  // the legacy player-anchored behavior. Exposed so GameScene can match a wasp
  // to the hive it's anchored to when that hive is attacked.
  getHomeAnchor(): { readonly x: number; readonly y: number } | null {
    return this.homeAnchorX != null && this.homeAnchorY != null
      ? { x: this.homeAnchorX, y: this.homeAnchorY }
      : null;
  }

  // Raises the hive-defense alarm: the entity drops its home leash and pursues
  // the player for one combat window, regardless of how far the player has
  // strayed from the hive. Called when the player attacks the hive this wasp is
  // anchored to, so shooting the hive immediately turns its whole swarm on the
  // player. Opens the aggro window too, so the chase fires this tick.
  raiseHomeAlarm(): void {
    this.homeAlarmUntil = this.scene.time.now + ENEMY_COMBAT_TIMEOUT_MS;
    this.refreshAggro();
  }

  private isHomeAlarmed(): boolean {
    return this.scene.time.now < this.homeAlarmUntil;
  }

  // True while the converge window (opened by forceConverge) is live. Read by
  // the chase LOS gate to let arena enemies pursue through geometry.
  private isConverging(): boolean {
    return this.scene.time.now < this.convergeUntil;
  }

  // Routes the "can't attack or reach the player right now" outcome while in
  // conflict. An aggroed path-walker holds its ground (facing the player,
  // updated each tick in update()) rather than walking back onto its patrol
  // route — it stays here only because it can't currently close on the
  // player (no move speed, or line-of-sight blocked). Airborne drifters with
  // no authored path keep their anti-freeze drift via the normal routing, and
  // out-of-conflict entities fall through to the regular idle/loiter.
  private enterEngagedFallback(player: Player): void {
    if (this.isAggro() && this.loiterPath) {
      if (this.enemyState !== 'idle') {
        this.enterIdle();
      }
      return;
    }
    this.enterIdleOrLoiter(player);
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

  // Patrol movement source, decoupled from combat. The lead attack's
  // walkAnimation/moveSpeed win when present (every existing combat entity);
  // otherwise these fall back to the behavior block so an attack-less
  // character (spirit walkers) patrols its loiterPath with the same code.
  // Each getter returns undefined when no source supplies a value.
  private effectiveWalkAnimation(): string | undefined {
    return this.attacks[0]?.walkAnimation ?? this.behavior.walkAnimation;
  }

  private effectiveMoveSpeed(): number | undefined {
    return this.attacks[0]?.moveSpeed ?? this.behavior.moveSpeed;
  }

  // Gate for loiter eligibility. Two distinct paths:
  //   - LDtk-authored patrol: any non-immovable character with an effective
  //     walkAnimation and moveSpeed (from its lead attack or, for attack-less
  //     NPCs, the behavior block) walks its loiterPath, regardless of gravity.
  //     Grounded characters steer X only; airborne steer X and Y.
  //   - Player-anchored drift (legacy): gravity-off airborne enemies without
  //     a path still drift around the player so they don't freeze mid-air.
  // Immovable airborne entities (e.g. the_hive) are excluded — they're
  // anchored to their spawn.
  private canLoiter(): boolean {
    if (this.behavior.immovable) return false;
    if (
      this.effectiveWalkAnimation() == null ||
      this.effectiveMoveSpeed() == null
    ) {
      return false;
    }
    if (this.loiterPath) return true;
    // No patrol path: grounded characters area-wander by default. wanderRadius()
    // returns a radius for grounded, non-boss, non-stationary characters (and
    // for any authored behavior.wander), and null for bosses / stationary
    // characters so they hold idle here. Airborne enemies keep their legacy
    // player-anchored drift.
    if (this.body.allowGravity) return this.wanderRadius() != null;
    return true;
  }

  // Effective spawn-anchored wander radius, or null when this character must not
  // area-wander. An authored behavior.wander.radius wins; otherwise wandering is
  // the default for a grounded, path-less, non-boss, non-stationary character,
  // at DEFAULT_WANDER_RADIUS. Computed live (never cached at construction) so it
  // reads the body's final gravity state and so the rule reaches every such
  // character — including instances that predate a hot-reload.
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

  private enterLoiter(player: Player): void {
    this.enemyState = 'loiter';
    this.clearCurrentAttack();
    const walkAnim = this.effectiveWalkAnimation();
    if (walkAnim) this.playLogical(walkAnim);
    setEnemyWalkSoundEnabled(this, true, this.currentWalkSurface());
    if (this.loiterPath) {
      // Snap to the nearest waypoint so the entity resumes patrol from where
      // a chase/knockback left it, rather than stubbornly walking back to a
      // stale index. Direction is preserved across re-entries so the sweep
      // pattern stays consistent.
      this.pathIndex = this.findNearestWaypointIndex();
      // Start the dwell cadence fresh: clear any in-flight pause and schedule
      // the first stroll interval so a patrol resumed after a chase doesn't
      // immediately stop to idle.
      this.pathPauseUntil = 0;
      this.scheduleNextPathPause(this.scene.time.now);
    } else if (this.body.allowGravity && this.wanderRadius() != null) {
      // Spawn-anchored stroll. Start the rest-break cadence fresh and pick a
      // first target within the wander band. Clear any greeting carried over
      // from a prior loiter session (e.g. interrupted by a knockback) so a
      // fresh entry starts clean. enterLoiter already played the walk clip
      // above, so mark the walk pose as showing to keep setWanderWalking synced.
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
    // Player-anchored drifters hover in place once the player wanders past
    // engagement range (their target is anchored to the player, so without this
    // they'd converge from across the map). Home-anchored enemies orbit a fixed
    // point, so they keep drifting toward it regardless of where the player is —
    // this is what flies a wasp back to its hive after a chase breaks off.
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
    const moveSpeed = this.effectiveMoveSpeed();
    if (moveSpeed == null) {
      this.body.setVelocity(0, 0);
      return;
    }

    // Patrol dwell: periodically halt and idle so the walk reads as wandering
    // rather than a constant march. Only runs here (out-of-combat loiter), so
    // a pause never delays chase/attack — those preempt loiter entirely.
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
      if (shouldJumpOverObstacle(this.probeCtx)) {
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

  // Begins a patrol dwell: parks the body, drops into the idle pose, and mutes
  // the walk loop for a randomized short beat. updatePathLoiter holds this
  // state until pathPauseUntil elapses, then resumes the walk. Grounded bodies
  // keep their Y to gravity; airborne bodies are fully stopped so they hover.
  private beginPathPause(now: number): void {
    this.pathPauseUntil =
      now +
      PATH_PAUSE_DURATION_MIN_MS +
      Math.random() * (PATH_PAUSE_DURATION_MAX_MS - PATH_PAUSE_DURATION_MIN_MS);
    this.setVelocityX(0);
    if (!this.body.allowGravity) this.setVelocityY(0);
    // Idle pose (registry defaultAnimation) rather than the walk clip, so the
    // entity visibly stops to observe. Mirrors enterIdle's resting semantics.
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
    // Home-anchored enemies (wasps) orbit a fixed point (their hive) across the
    // full circle; player-anchored drifters keep the upper-hemisphere spread so
    // they hover above the player.
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
  // A grounded character with no authored loiterPath strolls within
  // wander.radius of its spawn X, resting between strolls and using the shared
  // leap probe to hop level gaps that land back in-bounds. Drives the 'loiter'
  // state for these characters (see canLoiter / updateLoiter dispatch).

  // Picks the next stroll target: a random X within the wander band centered on
  // spawnX, nudged at least WANDER_MIN_TARGET_STEP_PX off the current spot so
  // the pick never resolves as "already arrived". Y is left to gravity — the
  // band is horizontal, matching the grounded patrol convention.
  private pickWanderTarget(): void {
    const radius = this.wanderRadius() ?? 0;
    const minX = this.spawnX - radius;
    const maxX = this.spawnX + radius;
    let target = minX + Math.random() * (maxX - minX);
    if (Math.abs(target - this.x) < WANDER_MIN_TARGET_STEP_PX) {
      // Roll landed in the dead-band — step toward spawn instead so the entity
      // drifts back to center rather than picking a target under its feet.
      const toward: 1 | -1 = this.spawnX >= this.x ? 1 : -1;
      target = this.x + toward * WANDER_MIN_TARGET_STEP_PX;
    }
    this.wanderTargetX = Math.max(minX, Math.min(maxX, target));
  }

  // Gate for committing a wander leap: the landing must stay within the wander
  // band horizontally (so strolling never carries the entity out of its
  // vicinity) and within the climb/drop reach vertically (so it crosses gaps and
  // steps up or down to nearby platforms, but turns back at a too-tall climb or
  // a deep pit rather than stranding itself or diving to its death).
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

  // After declining a leap at a ledge, retarget back toward spawn (away from the
  // edge) so the next step walks off the brink instead of re-probing it every
  // frame. The net effect is the stroller paces between the gaps that bound its
  // area.
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

  // Toggles the walk clip vs the resting idle pose for the wander, swapping only
  // on change so the animation isn't restarted every frame. Mirrors the chase
  // animation's moving/idle latch.
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

  private greetConfig(): AnimatedEntityGreetConfig | null {
    return this.wanderConfig?.greet ?? null;
  }

  // Per-frame stroll update for grounded wanderers. Priority each frame:
  //   1. A greeting in progress → park, face the partner, bob tiny hops.
  //   2. Otherwise (throttled) look for a same-group partner to greet.
  //   3. Otherwise honor the rest-break cadence (stop and idle a beat).
  //   4. Otherwise walk toward the current target, hopping small walls and
  //      leaping level in-bounds gaps — turning back at any ledge it can't
  //      safely clear so it never strolls into a hole.
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

    // (3) Rest breaks: stroll for a randomized interval, then halt and idle a
    // randomized beat so the wander reads as "wander and pause", not constant
    // pacing. Reuses the authored-path dwell timers/constants for the cadence.
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
        // Open air ahead. Commit a leap only when the probe finds a roughly
        // level landing that stays inside the wander band; otherwise turn back
        // so the stroller never drops into a hole or wanders out of its area.
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
        // A wall too tall to hop stands directly ahead (the hop case above
        // already handled short walls). The stroller can't mount it, so turn
        // back and pace away instead of grinding into it — same response as a
        // ledge it can't leap.
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

  // Scans for a nearby same-group wanderer to greet (called throttled from
  // updateAreaWander). On finding an available partner within proximity on the
  // same floor, rolls `chance`; on success begins a synchronized greeting on
  // both this entity and the partner (each faces the other). A decline arms a
  // short cooldown so a lingering pair doesn't reroll every scan.
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
      // Same floor only: a tight vertical band rejects a walker on a platform
      // above or below (wanderers now leap several tiles, so this uses its own
      // tolerance rather than the leap reach).
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

  // True when this entity could accept a greeting right now: it's a wanderer of
  // the given group, currently strolling (loiter state), grounded, not already
  // greeting, and off its greet cooldown. Used by a would-be partner's scan so
  // beginGreet only ever lands on a willing, grounded stroller. Public so the
  // initiator can poll candidates returned by the scene's forEachEnemy.
  isGreetAvailable(group: string, now: number): boolean {
    const greet = this.greetConfig();
    if (greet == null || greet.group !== group) return false;
    if (this.enemyState !== 'loiter') return false;
    if (!this.body.blocked.down) return false;
    if (now < this.greetUntil) return false;
    if (now < this.nextGreetAt) return false;
    return true;
  }

  // Begins a greeting: face the given partner X and start the tiny-hop bob
  // sequence, dropping to the resting idle pose (no jump anim exists — the bob
  // conveys it). Public so an initiator can pull its partner into the same
  // greeting on the same frame. No-op for non-greeters.
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

  private enterDeadState(): void {
    this.enemyState = 'dead';
    this.clearCurrentAttack();
    // Announce boss deaths on the scene bus so GameScene can record the defeat
    // (persistent run-progress), clear the boss's arena, and fire the victory
    // flow when the final boss falls. The boss's world position rides along so
    // GameScene can resolve the level whose enemies should be wiped. Emitted once
    // here — enterDeadState runs a single time per death, before either the
    // animation-complete or no-anim drop path — so the signal fires regardless
    // of which death path the corpse takes.
    if (this.isBoss()) {
      this.scene.events.emit(
        BOSS_DEFEATED_EVENT,
        this.getIdentifier(),
        this.x,
        this.y,
      );
    }
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
        obj.takeDamage(explosion.damage, cx, { sourceIsPlayer: false });
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

    // Wake clip finished: the dormant entity has fully woken. Clear both flags
    // and drop into idle so the normal AI loop takes over next tick (engaging
    // once the player is within an attack's range). Only the wake clip's own
    // completion is consumed here — any other completion while waking falls
    // through to the normal handling rather than being silently swallowed.
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
        // Combo follow-up: chance to chain directly into the paired attack,
        // skipping the recover/cooldown gap. Bounded — the follow-up has no
        // comboNextAnimation, so it ends in recover normally.
        if (this.tryEnterComboFollowup(attack)) {
          return;
        }
        // Lunge attacks bake forward travel into their frames while the body
        // holds still; advance the body to the lunge-end now (not on a chained
        // follow-up, handled above) so idle resumes where the character landed
        // instead of snapping back to the launch point.
        if (attack.lungeDistance != null && !this.behavior.immovable) {
          this.applyLungeDisplacement(attack.lungeDistance);
        }
        this.enemyState = 'recover';
        this.cooldownUntil = this.scene.time.now + attack.cooldownMs;
        this.clearCurrentAttack();
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
    if (attack.type === 'summon') {
      this.fireSummonAttack(attack);
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
    if (!this.harmless) player.hurt(damage, this.x, this.y);
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

  // Summon delivery: spawns `summonCount` minions (each a random pick from
  // summonKinds) flanking the caster, capped by summonMaxAlive against this
  // caster's still-alive summons. The scene wires each into the world as a
  // normal pursuing enemy. Harmless self-copies never summon.
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
        // Harmless copies still "connect" (return true so the strike resolves
        // and this hitbox isn't re-fired) but deal no damage or knockback.
        if (!this.harmless) obj.hurt(damage, this.x, this.y);
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
    let vx: number;
    let vy: number;
    if (attack.projectileStraight === true) {
      // Straight volley: fly horizontally along facing (vy = 0) so the player
      // dodges by changing elevation rather than just sidestepping. Facing was
      // locked toward the player when the attack committed, so the shot still
      // heads the player's way — it just won't track up/down. Used by turret
      // shooters (hell bot, wheel bot).
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

  // Self-cast HP restore on the heal animation's configured frame. Clamps
  // to maxHealth. Mirrors the takeDamage clamp at the bottom edge so the
  // enemy can't over-heal beyond its (scaled) cap.
  private applyHeal(attack: AnimatedEntityAttackConfig): void {
    const amount = attack.heal;
    if (amount == null) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
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
      if (!this.harmless) player.hurt(damage, this.x, this.y);
      // Landing contact damage counts as an exchange of blows — keep the entity
      // engaged so it pursues a player who backs out of touch range, and open
      // the active-combat window so a stinging swarmer reads as conflict (red
      // "!"), not merely investigating.
      this.refreshAggro();
      this.conflictUntil = this.scene.time.now + ENEMY_CONFLICT_WINDOW_MS;
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
        this.takeDamage(damage, this.x, {
          skipKnockback: true,
          sourceIsPlayer: false,
        });
      }
    }
    this.wasAirborne = false;
    this.peakFallVelocity = 0;
  }

  // Read-only view of this enemy for the shared locomotion probes
  // (enemyLeapProbes.ts). Rebuilt per call — the probes only borrow it for
  // the duration of one query.
  private get probeCtx(): LeapProbeContext {
    return {
      body: this.body,
      helper: this.scene as unknown as EnemyHelperScene,
      x: this.x,
      y: this.y,
      facingDirection: this.facingDirection,
    };
  }

  // Returns the enemy's current nav path (world-px waypoints) for the debug
  // overlay, or null when not path-following.
  getNavPathForDebug(): ReadonlyArray<{ x: number; y: number }> | null {
    return this.navPath;
  }

  // Drops the current nav path so the next pursuit replans from a clean state.
  private clearNavPath(): void {
    if (this.navPath === null) return;
    this.navPath = null;
    this.navPathIdx = 0;
    this.navGoalCellX = Number.NaN;
    this.navGoalCellY = Number.NaN;
  }

  // Maintains and advances an A* path toward (goalX, goalY) — the target's foot
  // point — returning the world-px waypoint to steer toward this frame, or null
  // when no route exists or the path is exhausted (caller falls back to reactive
  // steering). Replans on a throttle, when the goal moves to a new tile, or when
  // the path runs out. Grounded callers only.
  private followNavPath(
    goalX: number,
    goalY: number,
  ): { x: number; y: number } | null {
    const now = this.scene.time.now;
    // Post-stall cooldown: after abandoning a route it couldn't make progress on,
    // don't immediately re-path the same way — use reactive locomotion for a beat
    // so the enemy doesn't oscillate on an unmakeable jump.
    if (now < this.navSuppressUntil) return null;
    const goalCellX = Math.floor(goalX / TILE_PX);
    const goalCellY = Math.floor(goalY / TILE_PX);
    // Replan on the throttle, when the path is gone/exhausted, or when the goal
    // has drifted at least NAV_GOAL_HYSTERESIS_TILES from the cell the current
    // path targets. The hysteresis stops a walking player thrashing the path (and
    // the follow direction) every tile crossed. The `!(... < ...)` form replans
    // when the prior goal cell is NaN (first call), too.
    const goalShift = Math.max(
      Math.abs(goalCellX - this.navGoalCellX),
      Math.abs(goalCellY - this.navGoalCellY),
    );
    if (
      this.navPath === null ||
      now >= this.navReplanAt ||
      !(goalShift < NAV_GOAL_HYSTERESIS_TILES)
    ) {
      this.navReplanAt = now + NAV_REPLAN_INTERVAL_MS;
      this.navGoalCellX = goalCellX;
      this.navGoalCellY = goalCellY;
      const helper = this.scene as unknown as EnemyHelperScene;
      this.navPath = helper.findEnemyPath(
        this.body.center.x,
        this.body.bottom,
        goalX,
        goalY,
      );
      this.navPathIdx = 0;
      this.navProgressAt = now;
    }
    const path = this.navPath;
    if (path === null || path.length === 0) return null;
    // Advance past waypoints already reached (the first is usually the enemy's
    // own start cell, cleared immediately).
    const prevIdx = this.navPathIdx;
    while (this.navPathIdx < path.length) {
      const wp = path[this.navPathIdx];
      if (
        Math.abs(wp.x - this.body.center.x) <= NAV_WAYPOINT_REACH_X_PX &&
        Math.abs(wp.y - this.body.bottom) <= NAV_WAYPOINT_REACH_Y_PX
      ) {
        this.navPathIdx++;
      } else {
        break;
      }
    }
    if (this.navPathIdx >= path.length) {
      // Reached the goal cell — within a tile of the target. Clear so the caller
      // steers directly from here.
      this.navPath = null;
      return null;
    }
    // Stall watchdog: progress is ADVANCING A WAYPOINT (not raw body movement — an
    // up/down bounce on an unmakeable jump moves without getting anywhere). If no
    // waypoint advances for NAV_STALL_MS, abandon the route and arm the cooldown
    // so the enemy stops retrying it and falls back to reactive steering.
    if (this.navPathIdx > prevIdx) {
      this.navProgressAt = now;
    } else if (now - this.navProgressAt > NAV_STALL_MS) {
      this.clearNavPath();
      this.navSuppressUntil = now + NAV_STALL_COOLDOWN_MS;
      return null;
    }
    return path[this.navPathIdx];
  }

  // Steers one grounded step toward a nav waypoint, reusing the chase locomotion
  // primitives (hop a short wall, leap a gap / up to the waypoint, mount a flush
  // wall). The graph guarantees each waypoint is one such step from the last, so
  // this never needs the player-chase's full climb-from-under search.
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
        // When the body can't reach the upper node, findLeapLanding returns the
        // best in-reach landing — which is back on THIS level — and leaping it
        // just bounces in place. Skipping the leap lets the stall watchdog abandon
        // the unmakeable route instead of oscillating on it. Gap/down leaps
        // (wpAbove false) are unaffected.
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

  // Drives one sideways reposition step at `moveX` in `escapeDir` while the
  // enemy works its way out from under an overhead platform to set up an
  // up-leap. Adds the two guards the raw setVelocityX escape moves lacked:
  // (1) refuses the step when a ledge lies that way, so escaping a platform
  // never marches the body off the floor it's standing on (it would fall to
  // its death); (2) faces the travel direction, so the sprite doesn't moonwalk
  // — face the player while stepping away from it. Returns true when it moved;
  // false when a ledge blocks the route, so the caller can try the other way
  // or close on the player instead of driving into the void.
  private tryEscapeStep(escapeDir: 1 | -1, moveX: number): boolean {
    if (isLedgeAhead(this.probeCtx, escapeDir)) return false;
    this.facingDirection = escapeDir;
    this.setFacing(escapeDir === -1);
    this.setVelocityX(moveX * escapeDir);
    return true;
  }

}
