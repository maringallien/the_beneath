import Phaser from 'phaser';
import {
  getTriggersFor,
  playOneShot,
  setPlayerStateSoundActive,
} from '../audio';
import {
  PLAYER_RUN_SPEED,
  PLAYER_JUMP_VELOCITY,
  JUMP_CUT_VELOCITY_MULTIPLIER,
  FALL_BONUS_GRAVITY,
  PLAYER_DASH_SPEED,
  PLAYER_DASH_DURATION_MS,
  PLAYER_MAX_FALL_SPEED,
  PLAYER_ROLL_SPEED,
  WALL_SLIDE_MAX_VY,
  WHEEL_COOLDOWN_MS,
  PROJECTILE_GUN1_SPEED,
  PROJECTILE_GUN2_SPEED,
  PROJECTILE_GUN1_DAMAGE,
  PROJECTILE_GUN2_DAMAGE,
  PROJECTILE_BARREL_LENGTH_PX,
  GUN_OVERLAY_PIVOT_OFFSET_X,
  GUN_OVERLAY_PIVOT_OFFSET_Y,
  GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER,
  PLAYER_MAX_HEALTH,
  PLAYER_INVULN_MS,
  PLAYER_HURT_KNOCKBACK_X,
  PLAYER_HURT_KNOCKBACK_Y,
  SWORD_ATTACK_DAMAGE,
  SWORD_MAGIC_ATTACK_DAMAGE,
  SWORD_ATTACK_REACH_X,
  SWORD_ATTACK_REACH_Y,
  INITIAL_COINS,
  INITIAL_GUN1_AMMO,
  INITIAL_GUN2_AMMO,
  INITIAL_HEAL_ITEMS,
  INITIAL_MAGIC,
  INITIAL_STAMINA,
  MAX_COINS,
  BASE_MAX_GUN1_AMMO,
  BASE_MAX_GUN2_AMMO,
  BASE_MAX_MAGIC,
  GUN1_CAPACITY_UPGRADE_STEP,
  GUN2_CAPACITY_UPGRADE_STEP,
  MAGIC_UPGRADE_CAPACITY_STEPS,
  MAGIC_UPGRADE_LEVELS,
  MAX_HEAL_ITEMS,
  MAX_STAMINA,
  AMMO_COST_PER_SHOT,
  DASH_STAMINA_COST,
  HEAL_ITEM_RESTORE_AMOUNT,
  HEAL_ITEM_USE_COOLDOWN_MS,
  STAMINA_REGEN_INTERVAL_MS,
  MAGIC_COST_PER_SWING,
  UI_BOOM_SOUND_ID,
} from '../constants';
import { Enemy } from './Enemy';
import type { ShopItem } from './shop/shopTypes';
import {
  countUpgrades,
  hasUpgrade,
  recordKeyCollected,
  recordUpgradePurchased,
  upgradeId,
} from '../state/runProgress';
import { Trap } from './Trap';
import {
  animKey,
  fullKeysForLogical,
  getAnimationNaturalDurationMs,
  getAnimationSourceMode,
  getAnimationStage,
  getSpriteAnchor,
  gunOverlayAnimKey,
  isActionAvailable,
  magicAttackAnimKey,
  magicAttackKeySet,
  MODE_ORDER,
} from '../sprites/characterLoader';
import type {
  CharacterModeId,
  LogicalAnimationKey,
} from '../sprites/characterTypes';
import type { ProjectileSpawnOptions } from './Projectile';
import { PlayerGun } from './PlayerGun';

// Structural interface so Player doesn't need to import GameScene (avoids a
// circular dependency between Player ↔ GameScene).
interface ProjectileSpawnerScene {
  spawnProjectile(options: ProjectileSpawnOptions): void;
  alertEnemiesToGunshot(x: number, y: number): void;
}

// Same circular-dependency dodge as ProjectileSpawnerScene — Player calls
// the IntGrid lookup defined on GameScene without importing the class.
interface IntGridQueryScene {
  getIntGridValueAt(x: number, y: number): number;
}

// Lets the teleport-attack target the nearest live enemy without Player
// having to import Enemy (which would form a cycle, since Enemy imports
// Player). GameScene implements this directly.
interface NearestEnemyScene {
  getNearestEnemy(x: number, y: number): { x: number; y: number } | null;
}

// IntGrid values from the LDtk source. Each maps to a distinct footstep
// surface — pebble loop for ground, metal-stairs loop for bridge. Mutually
// exclusive: only the slot matching the tile underfoot is active.
const INTGRID_GROUND_VALUE = 1;
const INTGRID_BRIDGE_VALUE = 2;

// Sample offset below body.bottom when probing the tile underfoot. Body.bottom
// sits at the top edge of the floor tile while standing; +4px lands safely
// inside the tile beneath without risking overshoot into the next cell down.
const FOOTSTEP_TILE_PROBE_OFFSET_Y = 4;

// Minimum vertical descent (pixels, from airborne apex to landing Y) before
// a ground contact fires the land sound. 3 tiles × 16 px = 48 px. Small
// hops, terrain flicker, and the spawn settle never accumulate enough drop
// from their peak to cross this — only meaningful falls do. Replaces an
// earlier airtime threshold which fired on small low jumps that nonetheless
// stayed airborne long enough.
const MIN_LAND_FALL_DISTANCE_PX = 48;

// Falling-whoosh tuning. The wind swell only starts once the player has been
// in a continuous free fall for FALL_WHOOSH_DELAY_MS — long enough that small
// hops and ledge steps (which land well under this) never trigger it. Once
// armed it fades IN over FADE_IN_MS (a slow swell) and, on landing, OUT over
// the much shorter FADE_OUT_MS so the wind doesn't linger over the land thud.
const FALL_WHOOSH_DELAY_MS = 300;
const FALL_WHOOSH_FADE_IN_MS = 650;
const FALL_WHOOSH_FADE_OUT_MS = 180;

const LAND_SOUND_ID = 'player_jump_land';
const HURT_SOUND_ID = 'player_hurt_grunt';
const PROJECTILE_HURT_SOUND_ID = 'player_hurt_projectile';
const ROLL_SOUND_ID = 'player_roll';

export type PlayerHurtSource = 'melee' | 'projectile';

export interface PlayerHurtOptions {
  readonly source?: PlayerHurtSource;
}

export type PickupKind =
  | 'gun1'
  | 'gun2'
  | 'magic'
  | 'coin'
  | 'heal'
  | 'key_storms'
  | 'key_widow';

const SWORD_SLASH_IMPACT_SOUND_IDS = [
  'sword_slash_impact_1',
  'sword_slash_impact_2',
  'sword_slash_impact_3',
] as const;

interface ProjectileFireConfig {
  // Overlay anim key (the gun sprite). The body has no attack1 anymore —
  // firing is overlay-only, so the lifecycle (fire-frame trigger, complete
  // event) is sourced from the overlay's animation events.
  readonly overlayKey: string;
  readonly fireFrame: number;
  readonly speed: number;
  readonly damage: number;
  readonly mode: 'gunslinger_gun1' | 'gunslinger_gun2';
  // Overlay play duration (ms). Undefined = use the registry's natural
  // duration. Set for gun1 to apply the fire-rate multiplier, which also
  // shortens the locked-attack window so the player can fire again sooner.
  readonly overlayDurationMs?: number;
}

const PHYSICS_BODY_WIDTH = 16;
const PHYSICS_BODY_HEIGHT = 24;
const ROLL_ATTACK_STEP = 1;
const ROLL_ATTACK_STOP_FRAME = 4;
const GUNSLINGER_ROLL_STOP_FRAME = 7;
// Gunslinger roll has a 2-frame wind-up before any lateral travel begins, so
// velocity is held at zero until the body has visibly committed to the dive.
const GUNSLINGER_ROLL_LATERAL_START_FRAME = 2;
const COMBO_FIRST_STEP = 2;
const MAX_COMBO_STEP = 5;
const TELEPORT_ATTACK_STEP = 6;
// Vertical gap between the player's sprite center and the targeted enemy's
// body center when attack6's 'appear' stage fires. The slash hitbox extends
// SWORD_ATTACK_REACH_Y/2 (15 px) below player.y, so overlap requires
// offset <= 15 + body.height/2. The smallest fightable enemy body is ~22 px
// (Ghoul) → cap at 26; 20 keeps the slash safely inside every enemy while
// still suspending the player visibly above the target.
const TELEPORT_HOVER_OFFSET_Y = 20;
// attack6's appear stage runs frames 7-26, but the back half (post-strike
// recovery) drags when the target is airborne — the player visibly hangs
// in mid-air playing the rest of the swing animation. We hold the hover
// position with gravity off through frame 19, then at this frame we switch
// the body to the standard fall animation so the regular fall→land flow
// takes over and attack6's frames 20+ are skipped.
const TELEPORT_HOVER_END_FRAME = 20;
// Brief recovery hold between chained sword_master swings so each strike reads
// as a discrete hit instead of a continuous blur. Applies to both the
// cancel-stage chain (early advance) and the animation-complete chain.
// The player stays in lockedAction='attack' (velocity 0) during the hold, with
// the previous swing's final frame held on screen.
const COMBO_INTERSWING_DELAY_MS = 125;
const LEFT_MOUSE_BUTTON = 0;
// Debug fly mode: 4-directional WASD movement at constant speed, gravity and
// tile collision disabled. Lets the camera be panned across the whole world
// to verify every LDtk level renders, without bridging gaps between levels.
const FLY_SPEED = 400;

// Mode-aware key sets for onAnimationComplete dispatch. Built once at module
// load from the character registries.
const ATTACK_KEYS: ReadonlySet<string> = new Set<string>([
  ...fullKeysForLogical('attack1'),
  ...fullKeysForLogical('attack2'),
  ...fullKeysForLogical('attack3'),
  ...fullKeysForLogical('attack4'),
  ...fullKeysForLogical('attack5'),
  ...fullKeysForLogical('attack6'),
  ...magicAttackKeySet(),
]);
const DASH_KEYS: ReadonlySet<string> = fullKeysForLogical('dash');
const ROLL_KEYS: ReadonlySet<string> = fullKeysForLogical('roll');
// The held guard is the looping block_idle pose (hold-driven, never completes).
// The full block strip is now a one-shot "hit reaction": it completes, so it
// DOES participate in onAnimationComplete dispatch — settling back to block_idle
// while the button stays down. block_idle itself loops forever, so it never
// reaches onAnimationComplete.
const BLOCK_KEYS: ReadonlySet<string> = fullKeysForLogical('block');
const LEDGE_CLIMB_KEYS: ReadonlySet<string> = fullKeysForLogical('ledge_climb');
const TAKE_HIT_KEYS: ReadonlySet<string> = fullKeysForLogical('take_hit');
const DEATH_KEYS: ReadonlySet<string> = fullKeysForLogical('death');

// Event emitted on the Player sprite when health hits zero. GameScene listens
// to schedule a restart after the death animation has had time to play.
export const PLAYER_DIED_EVENT = 'player-died';

function requireAnimKey(
  mode: CharacterModeId,
  logical: LogicalAnimationKey,
): string {
  const key = animKey(mode, logical);
  if (!key) {
    throw new Error(`Missing animation: ${mode}.${logical}`);
  }
  return key;
}

// Teleport always uses sword_master attack6 (the only mode that has it).
const TELEPORT_ANIM_KEY = requireAnimKey('sword_master', 'attack6');

function buildProjectileFireConfigs(): ReadonlyMap<
  'gunslinger_gun1' | 'gunslinger_gun2',
  ProjectileFireConfig
> {
  const map = new Map<
    'gunslinger_gun1' | 'gunslinger_gun2',
    ProjectileFireConfig
  >();
  // Firing is overlay-only — the gun sprite's attack1 is the visible gunshot,
  // so its "fire" stage frame index drives projectile spawn timing and its
  // animation-complete event ends the locked-attack window.
  const gun1OverlayKey = gunOverlayAnimKey('gunslinger_gun1', 'attack1');
  const gun2OverlayKey = gunOverlayAnimKey('gunslinger_gun2', 'attack1');
  const gun1Stage = getAnimationStage(gun1OverlayKey, 'fire');
  const gun2Stage = getAnimationStage(gun2OverlayKey, 'fire');
  if (!gun1Stage || !gun2Stage) {
    throw new Error(
      `Missing "fire" stage on gunslinger overlay attack1. gun1=${gun1Stage}, gun2=${gun2Stage}. ` +
        'Did the animation registry get out of sync?',
    );
  }
  const gun1OverlayNatural = getAnimationNaturalDurationMs(gun1OverlayKey);
  if (gun1OverlayNatural == null) {
    throw new Error('Missing natural duration for gun1 overlay attack1');
  }
  map.set('gunslinger_gun1', {
    overlayKey: gun1OverlayKey,
    fireFrame: gun1Stage.startFrame,
    speed: PROJECTILE_GUN1_SPEED,
    damage: PROJECTILE_GUN1_DAMAGE,
    mode: 'gunslinger_gun1',
    overlayDurationMs: gun1OverlayNatural / GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER,
  });
  map.set('gunslinger_gun2', {
    overlayKey: gun2OverlayKey,
    fireFrame: gun2Stage.startFrame,
    speed: PROJECTILE_GUN2_SPEED,
    damage: PROJECTILE_GUN2_DAMAGE,
    mode: 'gunslinger_gun2',
  });
  return map;
}

type AttackKind = 'regular' | 'magic';

type PlayerVisualState =
  | 'idle'
  | 'run'
  | 'fall'
  | 'attack'
  | 'dash'
  | 'roll'
  | 'block'
  | 'wall_slide'
  | 'climb';
type MoveDirection = -1 | 0 | 1;
type LockedAction =
  | 'attack'
  | 'dash'
  | 'roll'
  | 'block'
  | 'climb'
  | 'hurt'
  | 'dead'
  | null;
type PointerHandler = (pointer: Phaser.Input.Pointer) => void;
type WheelHandler = (
  pointer: Phaser.Input.Pointer,
  currentlyOver: Phaser.GameObjects.GameObject[],
  deltaX: number,
  deltaY: number,
  deltaZ: number,
) => void;

interface LedgeTrigger {
  direction: MoveDirection;
  wallTop: number;
  wallEdgeX: number;
}

type ArcadeBody = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly keyW: Phaser.Input.Keyboard.Key;
  private readonly keyA: Phaser.Input.Keyboard.Key;
  private readonly keyS: Phaser.Input.Keyboard.Key;
  private readonly keyD: Phaser.Input.Keyboard.Key;
  private readonly keyF: Phaser.Input.Keyboard.Key;
  private readonly keyG: Phaser.Input.Keyboard.Key;
  private readonly keyShift: Phaser.Input.Keyboard.Key;
  private readonly keySpace: Phaser.Input.Keyboard.Key;
  // Q consumes one healing item (see tryUseHealingItem). JustDown-gated so a
  // held key uses exactly one per press, on top of the time cooldown below.
  private readonly keyQ: Phaser.Input.Keyboard.Key;
  private readonly teleportAppearStartFrame: number;
  private readonly projectileFireConfigs: ReadonlyMap<
    'gunslinger_gun1' | 'gunslinger_gun2',
    ProjectileFireConfig
  >;
  private currentMode: CharacterModeId = 'sword_master';
  // Live only while currentMode is a gunslinger variant. Created on entry,
  // destroyed on exit so the overlay never lingers as an invisible sprite
  // during sword_master play.
  private playerGun: PlayerGun | null = null;
  private currentVisualState: PlayerVisualState = 'idle';
  private lockedAction: LockedAction = null;
  private attackCounter = 0;
  private queuedAttack = false;
  // Pending chained combo swing: when set, onAnimationComplete must NOT call
  // endLockedAction for an attack key — the delayed-call timer below will
  // start the next swing after COMBO_INTERSWING_DELAY_MS. Needed because
  // short anims (e.g. attack3) can fire ANIMATION_COMPLETE before the
  // cancel-stage timer elapses; without this gate the previous swing would
  // end and idle would flash before the timer fires the next swing.
  private chainedSwingPending = false;
  private chainedSwingTimer: Phaser.Time.TimerEvent | null = null;
  private teleportFired = false;
  private firedProjectile = false;
  // One-shot tracking for animation-driven audio triggers. Key format:
  // `${animKey}:${triggerName}`. A trigger is fired exactly once per anim
  // playthrough; the set is cleared at startAttackAnim and on hurt/death
  // cancellation so chained attacks (combo continuations, roll-attacks)
  // re-arm the triggers cleanly.
  private readonly firedTriggers: Set<string> = new Set();
  private magicMode = false;
  private currentAttackKind: AttackKind = 'regular';
  private wallSlideDirection: MoveDirection = 0;
  // Captured at startRoll for gunslinger so the lateral velocity applied
  // mid-roll (after the wind-up frames) reflects the original commit, not
  // any cursor-driven flipX change that updateAimFacing made during the roll.
  private rollDirection: 1 | -1 = 1;
  private wheelCooldownUntil = 0;
  private flyMode = false;
  private health = PLAYER_MAX_HEALTH;
  private gun1Ammo = INITIAL_GUN1_AMMO;
  private gun2Ammo = INITIAL_GUN2_AMMO;
  private magic = INITIAL_MAGIC;
  private stamina = INITIAL_STAMINA;
  private coins = INITIAL_COINS;
  // Carried healing items. Raised by pickups (drops/shop) via addPickup,
  // lowered by tryUseHealingItem (Q). healItemCooldownUntil is the scene-time
  // stamp before which a second use is ignored (anti-spam).
  private healItems = INITIAL_HEAL_ITEMS;
  private healItemCooldownUntil = 0;
  // Milliseconds accumulated toward the next stamina-bar tick. Advances by
  // game.loop.delta each frame the player is not dashing; on crossing
  // STAMINA_REGEN_INTERVAL_MS we grant one bar and subtract the interval.
  // Reset to 0 on dash so the regen cadence restarts after a consumption.
  private staminaRegenAccumMs = 0;
  private invulnerableUntil = 0;
  // Apex sprite.y during the current airborne phase (lowest y value =
  // highest visual point, since the Y axis points down), or null when
  // grounded. Each airborne frame updates this to min(currentY, previousApex)
  // so a jump-and-fall correctly anchors the apex at the peak rather than
  // the launch point. updateLandingSound diffs landingY against this apex
  // to gate the one-shot land-sound on a minimum vertical drop.
  private airborneApexY: number | null = null;
  // Milliseconds of continuous free fall accumulated so far, used to gate the
  // falling-whoosh behind FALL_WHOOSH_DELAY_MS. Reset to 0 the moment the
  // player is no longer in a qualifying fall (grounded, rising, wall-sliding,
  // dead, or fly mode). See updateFallingSound.
  private fallWhooshElapsedMs = 0;
  // Per-attack set of enemies already damaged by the current sword swing.
  // Each sword attack scans the forward hitbox every frame it's active; this
  // set prevents one swing from ticking damage repeatedly against the same
  // enemy. Cleared at startAttackAnim (and again when the lockedAction ends).
  private readonly swordHitTargets: Set<Enemy> = new Set();
  // True once the impact SFX has played for the current swing. Each sword
  // attack plays exactly one impact sound on the first landed hit, regardless
  // of how many enemies the swing connects with — multiple overlapping
  // impacts clip and muddy the swing audio. Cleared in startAttackAnim.
  private swordImpactPlayedThisSwing: boolean = false;
  private readonly attackPointerHandler: PointerHandler;
  private readonly wheelHandler: WheelHandler;
  private readonly postUpdateHandler: () => void;
  // External freeze flag used by GameScene's landing-page flow. When false,
  // updateInner() zeroes velocity and early-returns, and the pointer/wheel
  // handlers no-op so clicking the START button doesn't fire a projectile
  // and mouse-wheel scrolling doesn't swap modes.
  private controlsEnabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const initialIdleKey = animKey('sword_master', 'idle');
    if (!initialIdleKey || !scene.textures.exists(initialIdleKey)) {
      throw new Error(
        `Sword master textures not loaded — expected key "${initialIdleKey}". ` +
          'Did PreloadScene run before this Player was constructed?',
      );
    }
    super(scene, x, y, initialIdleKey);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setSize(PHYSICS_BODY_WIDTH, PHYSICS_BODY_HEIGHT);
    this.setCollideWorldBounds(true);
    // Cap downward velocity below tile_size_px * fps so long falls can't
    // tunnel through floor tiles. Only the Y axis is constrained — leave the
    // default X cap intact so dash and run aren't clamped.
    this.body.maxVelocity.y = PLAYER_MAX_FALL_SPEED;
    this.on(
      Phaser.Animations.Events.ANIMATION_START,
      this.applyAnimationAnchor,
      this,
    );

    if (!scene.input.keyboard) {
      throw new Error('Keyboard input is not available');
    }
    scene.input.mouse?.disableContextMenu();
    const kb = scene.input.keyboard;
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyF = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.keyG = kb.addKey(Phaser.Input.Keyboard.KeyCodes.G);
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyQ = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    const appearStage = getAnimationStage(TELEPORT_ANIM_KEY, 'appear');
    if (!appearStage) {
      throw new Error(
        `Missing "appear" stage for ${TELEPORT_ANIM_KEY}. ` +
          'Did the animation registry get out of sync?',
      );
    }
    this.teleportAppearStartFrame = appearStage.startFrame;

    this.projectileFireConfigs = buildProjectileFireConfigs();

    this.attackPointerHandler = (pointer) => {
      if (!this.controlsEnabled) return;
      if (pointer.button === LEFT_MOUSE_BUTTON) {
        this.handleAttackInput();
      }
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.attackPointerHandler);

    this.wheelHandler = (_pointer, _over, _dx, dy) => {
      if (!this.controlsEnabled) return;
      if (dy === 0) return;
      if (this.scene.time.now < this.wheelCooldownUntil) return;
      // Browser convention: wheel-up scrolls the page upward => deltaY < 0.
      // The user's spec is "scroll up advances the sequence".
      this.tryAdvanceMode(dy < 0 ? 1 : -1);
    };
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.wheelHandler);

    // Sync the gun in POST_UPDATE — by then Arcade physics has written the
    // body's resolved position back to sprite x/y. Doing it inside update()
    // (which runs before POST_UPDATE) reads the previous frame's sprite
    // position, so the gun trails the body by one frame; under gravity that
    // lag grows visibly each frame and the gun appears to detach mid-fall.
    this.postUpdateHandler = () => this.syncPlayerGun();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.postUpdateHandler);

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off(
        Phaser.Input.Events.POINTER_DOWN,
        this.attackPointerHandler,
      );
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.wheelHandler);
      scene.events.off(
        Phaser.Scenes.Events.POST_UPDATE,
        this.postUpdateHandler,
      );
      this.destroyPlayerGun();
    });

    this.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.onAnimationComplete,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimationUpdate,
      this,
    );

    this.playLogical('idle');
  }

  getCurrentMode(): CharacterModeId {
    return this.currentMode;
  }

  // True while the magic sword stance is selected (F toggles it; sword_master
  // only, and it auto-clears when wheeling to a gun — see line ~988). Drives the
  // HUD weapon indicator's magic sub-tag (PlayerHudOverlay.updateWeapon).
  isMagicMode(): boolean {
    return this.magicMode;
  }

  // External freeze toggle for the landing-page flow. When disabled,
  // updateInner() short-circuits and the pointer/wheel handlers no-op, so
  // the player is fully inert (no movement, no attack from a stray click
  // on the START button, no mode swap from a stray scroll). Re-enabling
  // restores normal input handling immediately.
  setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
    if (!enabled) {
      this.setVelocity(0, 0);
    }
  }

  // Programmatic mode swap, used by HMR snapshot/restore. Bypasses the wheel
  // cooldown and the body-bottom snap that tryAdvanceMode does — callers
  // restoring after a teardown have already set the player's position
  // explicitly, so re-snapping here would just stomp on it.
  setCurrentMode(mode: CharacterModeId): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    if (mode !== 'sword_master') {
      this.magicMode = false;
    }
    this.ensurePlayerGunForMode();
    this.applyModeChangeAnimation();
  }

  update(): void {
    this.updateInner();
    // Drive state-driven sound loops off the body's resulting visual state.
    // Placed AFTER updateInner so predicates see the new currentVisualState
    // (run/fall/idle/...) and lockedAction, not last frame's. A single call
    // per slot covers every early-return path in updateInner — predicates
    // naturally map dead → silent and gunslinger-fire-while-standing → silent.
    this.updateMovementSound();
    this.updateFootstepsSound();
    this.updateLandingSound();
    this.updateFallingSound();
    // Gun sync is handled in the scene's POST_UPDATE handler so it runs after
    // Arcade physics has written body positions back to sprite x/y — see the
    // constructor's postUpdateHandler registration for the rationale.
  }

  // Cloth-movement loop is active whenever the body anim is not idle and the
  // player isn't dead. The hurt branch is special-cased because take_hit
  // animates while currentVisualState is still 'idle' (hurt() sets the
  // visual state to idle before kicking the take_hit anim) — without the
  // carve-out the sound would cut on every hit.
  //
  // Fly mode is debug-only; cloth sound stays silent there even though
  // updateFlyMode sets currentVisualState='run' while moving.
  private updateMovementSound(): void {
    if (this.flyMode) {
      setPlayerStateSoundActive(this.scene, 'movement', false);
      return;
    }
    const dead = this.lockedAction === 'dead';
    const bodyMoving = this.currentVisualState !== 'idle';
    const hurtPlaying = this.lockedAction === 'hurt';
    const active = !dead && (bodyMoving || hurtPlaying);
    setPlayerStateSoundActive(this.scene, 'movement', active);
  }

  // Footstep loops are active only while the player is actively running
  // (visualState 'run') AND grounded. The surface underfoot decides which
  // slot plays: ground tiles → pebbles, bridge tiles → metal stairs. The
  // two slots are mutually exclusive because the tile value can only be one
  // thing — when the player walks from ground onto bridge mid-stride, the
  // ground slot fades down while the bridge slot fades up, and the short
  // PLAYER_STATE_CROSSFADE_MS overlap masks the seam. Locked actions
  // (dash, roll, attack, block, climb, hurt, dead) cannot reach 'run'
  // visualState, so they're naturally excluded without explicit branches.
  // Fly mode silences both for the same reason as movement.
  private updateFootstepsSound(): void {
    if (this.flyMode) {
      setPlayerStateSoundActive(this.scene, 'footstepsGround', false);
      setPlayerStateSoundActive(this.scene, 'footstepsBridge', false);
      return;
    }
    const isRunning = this.currentVisualState === 'run';
    const onGround = this.body.blocked.down || this.body.touching.down;
    let tileValue = 0;
    if (isRunning && onGround) {
      const sceneWithIntGrid = this.scene as unknown as IntGridQueryScene;
      tileValue = sceneWithIntGrid.getIntGridValueAt(
        this.x,
        this.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y,
      );
    }
    setPlayerStateSoundActive(
      this.scene,
      'footstepsGround',
      tileValue === INTGRID_GROUND_VALUE,
    );
    setPlayerStateSoundActive(
      this.scene,
      'footstepsBridge',
      tileValue === INTGRID_BRIDGE_VALUE,
    );
  }

  // One-shot land sound on every airborne → grounded transition where the
  // descent from the airborne apex is at least MIN_LAND_FALL_DISTANCE_PX
  // (~3 tiles). Small hops, terrain flicker, and the spawn settle don't
  // accumulate enough vertical drop. Death blocks the sound: a dying body
  // catching the floor mid-knockback shouldn't punctuate the death anim.
  private updateLandingSound(): void {
    if (this.lockedAction === 'dead') {
      this.airborneApexY = null;
      return;
    }
    const onGround = this.body.blocked.down || this.body.touching.down;
    if (onGround) {
      if (this.airborneApexY !== null) {
        const fallDistance = this.y - this.airborneApexY;
        this.airborneApexY = null;
        if (fallDistance >= MIN_LAND_FALL_DISTANCE_PX) {
          playOneShot(this.scene, LAND_SOUND_ID);
        }
      }
    } else if (this.airborneApexY === null || this.y < this.airborneApexY) {
      // First airborne frame OR the player kept ascending past last apex —
      // record/raise the apex so the eventual fall is measured from the
      // true peak, not the launch point.
      this.airborneApexY = this.y;
    }
  }

  // Soft wind whoosh that swells in while the player is in a sustained free
  // fall. A continuous-fall timer (fallWhooshElapsedMs) gates the sound behind
  // FALL_WHOOSH_DELAY_MS so brief hops and ledge steps never trigger it — only
  // falls long enough to build speed do. Excludes wall-slides (the scrape loop
  // already covers that descent), the rising half of a jump, death, and fly
  // mode. The slot fades IN slowly on activation and OUT quickly on landing
  // via the per-call fade durations passed to setPlayerStateSoundActive.
  private updateFallingSound(): void {
    const onGround = this.body.blocked.down || this.body.touching.down;
    const descending = this.body.velocity.y > 0;
    const dead = this.lockedAction === 'dead';
    const wallSliding = this.wallSlideDirection !== 0;
    const falling =
      !this.flyMode && !onGround && descending && !dead && !wallSliding;

    if (falling) {
      this.fallWhooshElapsedMs += this.scene.game.loop.delta;
    } else {
      this.fallWhooshElapsedMs = 0;
    }

    const active = this.fallWhooshElapsedMs >= FALL_WHOOSH_DELAY_MS;
    setPlayerStateSoundActive(
      this.scene,
      'falling',
      active,
      active ? FALL_WHOOSH_FADE_IN_MS : FALL_WHOOSH_FADE_OUT_MS,
    );
  }

  private updateInner(): void {
    if (!this.controlsEnabled) {
      // Landing-page freeze: zero lateral velocity so the player stands
      // still, then bail before any input/state-machine work runs. Gravity
      // is left alone so the player settles on the floor on first frame
      // instead of hanging in mid-air at the LDtk spawn pivot.
      this.setVelocityX(0);
      return;
    }
    if (this.lockedAction === 'dead') {
      // No input, no facing updates. Gravity still applies via the body's
      // own settings; the corpse settles wherever the knockback put it.
      return;
    }

    this.tickStaminaRegen();

    if (Phaser.Input.Keyboard.JustDown(this.keyG)) {
      this.toggleFlyMode();
    }
    if (this.flyMode) {
      this.updateFlyMode();
      return;
    }

    // Q consumes a healing item. tryUseHealingItem owns every guard (cooldown,
    // empty stash, already-full, dead), so this stays a single unconditional
    // call — it self-no-ops when a heal isn't possible.
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.tryUseHealingItem();
    }

    // Cursor-driven body facing in gunslinger mode. Runs before the rest of
    // update() so movement logic can still override velocity without fighting
    // facing — the in-mode setFacing call below is gated on sword_master.
    this.updateAimFacing();

    // Block is hold-to-engage, driven by the held state (not a press edge).
    // Using the edge here would drop a press made during a locked action
    // (e.g. tapping RMB near the end of an attack): the edge is consumed on
    // the frame it happens while still attack-locked, so when the attack ends
    // the held button is no longer "just pressed" and block never starts.
    // Reading the held state means block engages the first unlocked, grounded
    // frame the button is down — right after the attack animation completes.
    const rightDown = this.scene.input.activePointer.rightButtonDown();

    if (this.lockedAction !== 'climb') {
      this.body.setGravityY(
        this.body.velocity.y > 0 ? FALL_BONUS_GRAVITY : 0,
      );
    }

    // F toggles magic stance only in sword_master mode. Gunslinger modes have
    // no magic registry; F is a no-op there.
    if (
      Phaser.Input.Keyboard.JustDown(this.keyF) &&
      this.currentMode === 'sword_master'
    ) {
      this.magicMode = !this.magicMode;
    }

    // Gunslinger fires while moving / jumping: the attack animation plays as
    // an overlay but movement input still runs. Sword-master attacks freeze
    // the player in place via the locked-action branch below.
    const isGunslingerShooting =
      this.lockedAction === 'attack' && this.isGunslingerMode();

    if (this.lockedAction !== null && !isGunslingerShooting) {
      if (this.lockedAction === 'attack') {
        const onFloorNow = this.body.blocked.down || this.body.touching.down;
        // Roll and jump have priority over attacks: either one, pressed while
        // grounded, immediately cancels an in-progress sword swing. Gunslinger
        // fire is an overlay rather than a locked action, so it already permits
        // roll/jump and never enters this branch. JustDown consumes the key, so
        // the normal roll/jump handlers further down don't also re-fire it.
        if (onFloorNow && Phaser.Input.Keyboard.JustDown(this.keyS)) {
          this.cancelTransientState();
          this.startRoll();
          return;
        }
        if (onFloorNow && Phaser.Input.Keyboard.JustDown(this.keyW)) {
          this.cancelTransientState();
          this.lockedAction = null;
          this.setVelocityY(PLAYER_JUMP_VELOCITY);
          this.currentVisualState = 'fall';
          this.playLogical('fall');
          return;
        }
        // Sword swings damage enemies via a per-frame overlap scan. Runs only
        // for sword_master modes; gunslinger fires its own projectiles.
        this.applySwordHits();
        if (this.isRollAttackInProgress()) {
          const frame = this.anims.currentFrame;
          if (frame && frame.index >= ROLL_ATTACK_STOP_FRAME) {
            this.setVelocityX(0);
          }
        } else if (onFloorNow) {
          // Ground swings freeze the player in place.
          this.setVelocityX(0);
        } else {
          // Air swings allow lateral input control so the player can steer
          // mid-jump-attack. Facing stays locked so the swing's hitbox
          // direction matches where the attack started — no input leaves
          // existing horizontal momentum intact.
          let airAttackDirection: MoveDirection = 0;
          if (this.keyA.isDown && !this.keyD.isDown) airAttackDirection = -1;
          else if (this.keyD.isDown && !this.keyA.isDown) airAttackDirection = 1;
          if (airAttackDirection !== 0) {
            this.setVelocityX(PLAYER_RUN_SPEED * airAttackDirection);
          }
        }
      } else if (this.lockedAction === 'block') {
        if (!rightDown) {
          this.endLockedAction();
        } else {
          this.setVelocityX(0);
        }
      } else if (this.lockedAction === 'roll' && this.isGunslingerMode()) {
        const frame = this.anims.currentFrame;
        if (frame) {
          if (
            frame.index < GUNSLINGER_ROLL_LATERAL_START_FRAME ||
            frame.index >= GUNSLINGER_ROLL_STOP_FRAME
          ) {
            this.setVelocityX(0);
          } else {
            this.setVelocityX(PLAYER_ROLL_SPEED * this.rollDirection);
          }
        }
      }
      return;
    }

    const onFloor = this.body.blocked.down || this.body.touching.down;

    if (
      rightDown &&
      onFloor &&
      isActionAvailable(this.currentMode, 'block')
    ) {
      this.startBlock();
      return;
    }

    if (
      Phaser.Input.Keyboard.JustDown(this.keyShift) &&
      isActionAvailable(this.currentMode, 'dash') &&
      this.stamina >= DASH_STAMINA_COST
    ) {
      this.startDash();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyS) && onFloor) {
      this.startRoll();
      return;
    }

    let inputDirection: MoveDirection = 0;
    if (this.keyA.isDown && !this.keyD.isDown) inputDirection = -1;
    else if (this.keyD.isDown && !this.keyA.isDown) inputDirection = 1;

    if (inputDirection === 0) {
      this.setVelocityX(0);
    } else {
      this.setVelocityX(PLAYER_RUN_SPEED * inputDirection);
      // Gunslinger facing is driven by the cursor (see updateAimFacing); only
      // sword_master flips with movement direction.
      if (!this.isGunslingerMode()) {
        this.setFacing(inputDirection === -1);
      }
    }

    let wallContact: MoveDirection = 0;
    if (!onFloor) {
      const touchingLeft =
        this.body.blocked.left || this.body.touching.left;
      const touchingRight =
        this.body.blocked.right || this.body.touching.right;
      if (touchingLeft && this.keyA.isDown) wallContact = -1;
      else if (touchingRight && this.keyD.isDown) wallContact = 1;
    }

    if (
      wallContact !== 0 &&
      this.body.velocity.y <= 0 &&
      isActionAvailable(this.currentMode, 'ledge_climb')
    ) {
      const ledgeWall = this.findLedgeWall(wallContact);
      if (ledgeWall) {
        this.startClimb(ledgeWall);
        return;
      }
    }
    if (
      !onFloor &&
      this.body.velocity.y < 0 &&
      this.body.velocity.x !== 0 &&
      isActionAvailable(this.currentMode, 'ledge_climb')
    ) {
      const grazingDirection: MoveDirection =
        this.body.velocity.x > 0 ? 1 : -1;
      const grazing = this.findGrazingWall(grazingDirection);
      if (grazing) {
        this.startClimb(grazing);
        return;
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyW) && onFloor) {
      this.setVelocityY(PLAYER_JUMP_VELOCITY);
    }
    if (
      Phaser.Input.Keyboard.JustUp(this.keyW) &&
      this.body.velocity.y < 0
    ) {
      this.setVelocityY(this.body.velocity.y * JUMP_CUT_VELOCITY_MULTIPLIER);
    }

    this.wallSlideDirection =
      wallContact !== 0 && this.body.velocity.y > 0 ? wallContact : 0;
    if (
      this.wallSlideDirection !== 0 &&
      this.body.velocity.y > WALL_SLIDE_MAX_VY
    ) {
      this.setVelocityY(WALL_SLIDE_MAX_VY);
    }
    // State-driven scrape loop. Crossfades via PLAYER_STATE_CROSSFADE_MS so
    // grabbing/releasing a wall doesn't click. Force-cleared in
    // cancelTransientState and toggleFlyMode so death/fly-mode can't leave it
    // stuck on.
    setPlayerStateSoundActive(
      this.scene,
      'wallSlide',
      this.wallSlideDirection !== 0,
    );

    this.updateVisualState();
  }

  private isRollAttackInProgress(): boolean {
    // Roll-attack only exists in sword_master (regular and magic). Gunslinger
    // attack1 is its only attack, not a roll-cancel — so the slide-on-velocity
    // behavior must not apply there.
    return (
      this.currentMode === 'sword_master' &&
      this.attackCounter === ROLL_ATTACK_STEP
    );
  }

  private isGunslingerMode(): boolean {
    return (
      this.currentMode === 'gunslinger_gun1' ||
      this.currentMode === 'gunslinger_gun2'
    );
  }

  private tryAdvanceMode(direction: 1 | -1): void {
    // Gate switches to "free" states. Mid-action wheel input is silently
    // dropped so swaps never interrupt an attack/dash/roll/block/climb.
    if (this.lockedAction !== null) return;
    const currentIndex = MODE_ORDER.indexOf(this.currentMode);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= MODE_ORDER.length) return;
    // Capture floor contact + body.bottom BEFORE the new mode's anchor takes
    // effect. Modes have different frame heights (sword_master 37, gunslinger
    // 48) and different bodyOffsetY, so swapping leaves body.bottom several
    // pixels below the floor surface. We re-snap sprite.y after the swap so
    // body.bottom is preserved. Mid-air swaps deliberately skip the snap —
    // a vertical teleport would be more jarring than the natural body shift,
    // and physics will reconcile on the next ground contact.
    const wasOnFloor = this.body.blocked.down || this.body.touching.down;
    const prevBodyBottom = this.body.bottom;
    this.currentMode = MODE_ORDER[nextIndex];
    this.wheelCooldownUntil = this.scene.time.now + WHEEL_COOLDOWN_MS;
    // Magic stance is sword_master-only; clear it when switching away so we
    // don't snap back into magic if the player wheels back to sword_master.
    if (this.currentMode !== 'sword_master') {
      this.magicMode = false;
    }
    this.ensurePlayerGunForMode();
    this.applyModeChangeAnimation();
    if (wasOnFloor) {
      // Inverse of Phaser's body math:
      //   body.bottom = sprite.y - displayOriginY*scaleY + offset.y*scaleY + body.height
      // Solve for sprite.y so body.bottom = prevBodyBottom.
      const newY =
        prevBodyBottom +
        this.displayOriginY * this.scaleY -
        this.body.offset.y * this.scaleY -
        this.body.height;
      this.setPosition(this.x, newY);
    }
  }

  private applyModeChangeAnimation(): void {
    const logical = this.visualStateToLogical(this.currentVisualState);
    this.playLogical(logical);
  }

  private visualStateToLogical(
    state: PlayerVisualState,
  ): LogicalAnimationKey {
    switch (state) {
      case 'run':
        return 'run';
      case 'fall':
        return 'fall';
      case 'wall_slide':
        return 'wall_slide';
      case 'idle':
      case 'attack':
      case 'dash':
      case 'roll':
      case 'block':
      case 'climb':
      default:
        return 'idle';
    }
  }

  private playLogical(
    logical: LogicalAnimationKey,
    options: {
      ignoreIfPlaying?: boolean;
      repeat?: number;
      duration?: number;
    } = {},
  ): boolean {
    const key = animKey(this.currentMode, logical);
    if (!key) return false;
    const ignoreIfPlaying = options.ignoreIfPlaying ?? false;
    const hasOverrides =
      options.repeat !== undefined || options.duration !== undefined;
    if (hasOverrides) {
      const playArgs: Record<string, unknown> = { key };
      if (options.repeat !== undefined) playArgs.repeat = options.repeat;
      if (options.duration !== undefined) {
        playArgs.duration = options.duration;
        // Phaser's calculateDuration prefers frameRate when both are
        // non-null, and frameRate falls back to anim.frameRate (12) when
        // unset — silently ignoring our duration override. Passing
        // frameRate: null forces it to derive frameRate from duration.
        playArgs.frameRate = null;
      }
      this.play(
        playArgs as unknown as Phaser.Types.Animations.PlayAnimationConfig,
        ignoreIfPlaying,
      );
    } else {
      this.play(key, ignoreIfPlaying);
    }
    this.syncGunOverlayForBodyAnim(key, logical);
    return true;
  }

  private handleAttackInput(): void {
    if (this.lockedAction === 'attack') {
      if (
        this.isRollAttackInProgress() ||
        this.attackCounter === TELEPORT_ATTACK_STEP
      ) {
        return;
      }
      this.queuedAttack = true;
      return;
    }
    if (this.lockedAction === 'roll') {
      // Roll-attack is sword_master-only.
      if (this.currentMode !== 'sword_master') return;
      this.attackCounter = ROLL_ATTACK_STEP;
      this.currentAttackKind = this.magicMode ? 'magic' : 'regular';
      this.startAttackAnim(this.attackCounter);
      return;
    }
    if (this.lockedAction !== null) {
      return;
    }

    if (this.keySpace.isDown) {
      // Teleport-attack is sword_master-only — gunslinger has no attack6.
      if (this.currentMode !== 'sword_master') return;
      // attack6 only activates when there's a valid teleport target: a live
      // enemy in the player's level with clear line of sight (getNearestEnemy
      // applies both gates). With nothing in sight the press is a no-op, so the
      // player can't blink to an off-screen or cross-level enemy.
      const scene = this.scene as unknown as NearestEnemyScene;
      if (!scene.getNearestEnemy(this.x, this.y)) return;
      this.attackCounter = TELEPORT_ATTACK_STEP;
      this.currentAttackKind = 'regular';
      this.startAttackAnim(this.attackCounter);
      return;
    }

    this.attackCounter = this.getFirstComboStep();
    this.currentAttackKind = this.magicMode ? 'magic' : 'regular';
    if (this.isGunslingerMode() && !this.tryConsumeGunslingerAmmo()) {
      return;
    }
    this.startAttackAnim(this.attackCounter);
  }

  // Advances the stamina regen accumulator by this frame's delta and grants
  // one bar each time it crosses STAMINA_REGEN_INTERVAL_MS. No-ops at full
  // stamina or during a dash — during dash the regen is paused so the
  // player can't infinitely chain dashes by burning a tiny regen window
  // mid-animation.
  private tickStaminaRegen(): void {
    if (this.lockedAction === 'dash') return;
    if (this.stamina >= MAX_STAMINA) {
      this.staminaRegenAccumMs = 0;
      return;
    }
    this.staminaRegenAccumMs += this.scene.game.loop.delta;
    while (
      this.staminaRegenAccumMs >= STAMINA_REGEN_INTERVAL_MS &&
      this.stamina < MAX_STAMINA
    ) {
      this.stamina += 1;
      this.staminaRegenAccumMs -= STAMINA_REGEN_INTERVAL_MS;
    }
    if (this.stamina >= MAX_STAMINA) {
      this.staminaRegenAccumMs = 0;
    }
  }

  // Checks ammo for the current gunslinger mode against AMMO_COST_PER_SHOT
  // and decrements on success. Returns false (caller silently aborts) when
  // the magazine is dry — no overlay anim, no SFX. Callers in non-gunslinger
  // modes must not invoke this; the helper assumes the gunslinger branch.
  private tryConsumeGunslingerAmmo(): boolean {
    // TEMP: infinite ammo for testing — never checks or decrements the
    // magazine. Remove this early-return to restore normal ammo consumption.
    return true;
    if (this.currentMode === 'gunslinger_gun1') {
      if (this.gun1Ammo < AMMO_COST_PER_SHOT) return false;
      this.gun1Ammo -= AMMO_COST_PER_SHOT;
      return true;
    }
    if (this.currentMode === 'gunslinger_gun2') {
      if (this.gun2Ammo < AMMO_COST_PER_SHOT) return false;
      this.gun2Ammo -= AMMO_COST_PER_SHOT;
      return true;
    }
    return true;
  }

  private getFirstComboStep(): number {
    return this.currentMode === 'sword_master' ? COMBO_FIRST_STEP : 1;
  }

  private getMaxComboStep(): number {
    return this.currentMode === 'sword_master' ? MAX_COMBO_STEP : 1;
  }

  // Schedules the next chained combo swing after a brief recovery hold.
  // Caller has already advanced attackCounter. lockedAction stays 'attack' for
  // the duration so the player can't move/jump and so queued tap-aheads from
  // handleAttackInput land cleanly. Pending state is cleared on hurt/death/
  // mode-swap via cancelChainedSwingTimer (see cancelTransientState).
  //
  // Exception: the 3rd→4th swing transition (step 4 → MAX_COMBO_STEP) plays
  // back-to-back with no recovery hold, by design — that pair flows as one
  // continuous combo finisher for both regular and magic stances.
  private scheduleChainedSwing(step: number): void {
    this.cancelChainedSwingTimer();
    if (step === MAX_COMBO_STEP) {
      this.startAttackAnim(step);
      return;
    }
    this.chainedSwingPending = true;
    this.chainedSwingTimer = this.scene.time.delayedCall(
      COMBO_INTERSWING_DELAY_MS,
      () => {
        this.chainedSwingTimer = null;
        this.chainedSwingPending = false;
        this.startAttackAnim(step);
      },
    );
  }

  private cancelChainedSwingTimer(): void {
    if (this.chainedSwingTimer) {
      this.chainedSwingTimer.remove(false);
      this.chainedSwingTimer = null;
    }
    this.chainedSwingPending = false;
  }

  private startAttackAnim(step: number): void {
    // Magic-stance affordance check. Each magic swing costs
    // MAGIC_COST_PER_SWING; when the meter can't pay, fall back to a regular
    // sword swing so combos keep flowing instead of stalling. Runs per-swing
    // because chained swings (scheduleChainedSwing → startAttackAnim) re-enter
    // here and each one independently pays the cost.
    if (this.currentAttackKind === 'magic') {
      if (this.magic < MAGIC_COST_PER_SWING) {
        this.currentAttackKind = 'regular';
      } else {
        this.magic -= MAGIC_COST_PER_SWING;
      }
    }
    this.lockedAction = 'attack';
    // Each new swing starts with a fresh set so a re-attack against the same
    // enemy lands again. This includes combo continuations (queuedAttack →
    // step+1) and chained roll/teleport attacks.
    this.swordHitTargets.clear();
    this.swordImpactPlayedThisSwing = false;
    this.firedTriggers.clear();
    // Gunslinger firing animates the gun overlay only — the body keeps
    // tracking physics state (idle/run/fall) so the player can move and
    // jump while shooting. visualState is left alone so updateVisualState
    // continues to drive body anims; lockedAction='attack' is purely a
    // cooldown/trigger flag, not a freeze.
    if (this.isGunslingerMode()) {
      const config = this.projectileFireConfigs.get(
        this.currentMode as 'gunslinger_gun1' | 'gunslinger_gun2',
      );
      if (this.playerGun) {
        this.playerGun.playOverlay('attack1', config?.overlayDurationMs);
      }
      return;
    }

    this.currentVisualState = 'attack';
    // Roll-attack carries momentum from the roll. Other sword_master attacks
    // freeze the player in place.
    if (step !== ROLL_ATTACK_STEP) {
      this.setVelocityX(0);
    }
    if (this.currentAttackKind === 'magic') {
      this.play(magicAttackAnimKey(step));
      return;
    }
    const logical = `attack${step}` as LogicalAnimationKey;
    this.playLogical(logical);
  }

  private startDash(): void {
    const direction = this.resolveFacingDirection();
    this.lockedAction = 'dash';
    this.currentVisualState = 'dash';
    this.setFacing(direction === -1);
    this.setVelocityX(PLAYER_DASH_SPEED * direction);
    this.playLogical('dash', { duration: PLAYER_DASH_DURATION_MS });
    this.stamina = Math.max(0, this.stamina - DASH_STAMINA_COST);
    // Reset the regen cadence so the next bar arrives a full interval after
    // this dash, not a fraction of one inherited from prior idle time.
    this.staminaRegenAccumMs = 0;
  }

  private startRoll(): void {
    const direction = this.resolveFacingDirection();
    this.lockedAction = 'roll';
    this.currentVisualState = 'roll';
    this.setFacing(direction === -1);
    this.rollDirection = direction;
    playOneShot(this.scene, ROLL_SOUND_ID);
    // Gunslinger roll has a wind-up: lateral velocity is gated by frame in
    // updateInner so frames 0..1 stay in place. Sword_master rolls accelerate
    // immediately as before.
    if (this.isGunslingerMode()) {
      this.setVelocityX(0);
    } else {
      this.setVelocityX(PLAYER_ROLL_SPEED * direction);
    }
    this.playLogical('roll');
  }

  private startBlock(): void {
    this.lockedAction = 'block';
    this.currentVisualState = 'block';
    this.setVelocityX(0);
    // Block is a sustained guard, not a one-shot. The held pose is the static
    // block_idle frame (loops:true → repeat:-1 on a single frame), so the guard
    // holds for as long as the right button is down. The block's lifetime is
    // owned by the hold: updateState ends it the frame rightDown goes false (see
    // the lockedAction === 'block' branch), and because block_idle never emits
    // ANIMATION_COMPLETE, onAnimationComplete never cuts it short. While held,
    // hurt() negates every front hit — not just the first — and plays the full
    // block strip as a one-shot reaction that settles back to block_idle.
    this.playLogical('block_idle');
  }

  private findLedgeWall(wallDirection: MoveDirection): LedgeTrigger | null {
    const PROBE_WIDTH = 4;
    const PROBE_HEIGHT = 4;
    const probeX =
      wallDirection === 1
        ? this.body.right + 1
        : this.body.left - 1 - PROBE_WIDTH;
    const above = this.scene.physics.overlapRect(
      probeX,
      this.body.top - PROBE_HEIGHT - 4,
      PROBE_WIDTH,
      PROBE_HEIGHT,
      false,
      true,
    );
    if (above.length > 0) return null;
    const below = this.scene.physics.overlapRect(
      probeX,
      this.body.top + 2,
      PROBE_WIDTH,
      PROBE_HEIGHT,
      false,
      true,
    ) as ArcadeBody[];
    if (below.length === 0) return null;
    const wallBody = below[0];
    return {
      direction: wallDirection,
      wallTop: wallBody.top,
      wallEdgeX: wallDirection === 1 ? wallBody.left : wallBody.right,
    };
  }

  private findGrazingWall(direction: MoveDirection): LedgeTrigger | null {
    const dt = this.scene.game.loop.delta / 1000;
    const dx = this.body.velocity.x * dt;
    const dy = this.body.velocity.y * dt;
    const nextLeft = this.body.left + dx;
    const nextTop = this.body.top + dy;
    const overlaps = this.scene.physics.overlapRect(
      nextLeft,
      nextTop,
      PHYSICS_BODY_WIDTH,
      PHYSICS_BODY_HEIGHT,
      false,
      true,
    ) as ArcadeBody[];
    for (const wallBody of overlaps) {
      if (
        wallBody.top > nextTop &&
        wallBody.top < nextTop + PHYSICS_BODY_HEIGHT
      ) {
        return {
          direction,
          wallTop: wallBody.top,
          wallEdgeX: direction === 1 ? wallBody.left : wallBody.right,
        };
      }
    }
    return null;
  }

  private startClimb(trigger: LedgeTrigger): void {
    this.lockedAction = 'climb';
    this.currentVisualState = 'climb';
    this.setVelocityX(0);
    this.setVelocityY(0);
    this.body.setAllowGravity(false);
    this.setFacing(trigger.direction === -1);
    this.playLogical('ledge_climb');
    const targetBodyLeft =
      trigger.direction === 1
        ? trigger.wallEdgeX
        : trigger.wallEdgeX - PHYSICS_BODY_WIDTH;
    const targetBodyTop = trigger.wallTop - PHYSICS_BODY_HEIGHT;
    const newSpriteX = targetBodyLeft + PHYSICS_BODY_WIDTH / 2;
    // body.position.y = sprite.y - displayOriginY*scaleY + offset.y*scaleY,
    // so sprite.y = body.top + (displayOriginY - offset.y) * scaleY.
    const newSpriteY =
      targetBodyTop +
      (this.displayOriginY - this.body.offset.y) * this.scaleY;
    this.setPosition(newSpriteX, newSpriteY);
  }

  private resolveFacingDirection(): 1 | -1 {
    if (this.keyA.isDown && !this.keyD.isDown) return -1;
    if (this.keyD.isDown && !this.keyA.isDown) return 1;
    return this.flipX ? -1 : 1;
  }

  private updateVisualState(): void {
    // Gunslinger firing doesn't animate the body — it animates the gun
    // overlay only. So no early return is needed; the body keeps switching
    // between idle/run/fall normally even while the overlay plays attack1.
    const onFloor = this.body.blocked.down || this.body.touching.down;
    const vx = this.body.velocity.x;
    const vy = this.body.velocity.y;

    let next: 'idle' | 'run' | 'fall' | 'wall_slide';
    if (!onFloor) {
      next = this.wallSlideDirection !== 0 ? 'wall_slide' : 'fall';
    } else if (vx !== 0) {
      next = 'run';
    } else {
      next = 'idle';
    }

    if (next === this.currentVisualState && next !== 'fall') {
      return;
    }
    this.currentVisualState = next;

    switch (next) {
      case 'idle':
        this.playLogical('idle', { ignoreIfPlaying: true });
        break;
      case 'run':
        this.playLogical('run', { ignoreIfPlaying: true });
        break;
      case 'wall_slide':
        this.playLogical('wall_slide', { ignoreIfPlaying: true });
        break;
      case 'fall':
        this.playLogical('fall', { ignoreIfPlaying: true });
        if (vy < 0) {
          this.anims.pause();
          this.setFrame(0);
        } else {
          this.anims.resume();
        }
        break;
    }

  }

  private onAnimationComplete(animation: Phaser.Animations.Animation): void {
    const key = animation.key;
    if (ATTACK_KEYS.has(key)) {
      // A chained swing was already scheduled by the cancel-stage path in
      // onAnimationUpdate — the delayed-call timer owns the next swing. Just
      // hold the final frame and let the timer fire startAttackAnim. Without
      // this gate, endLockedAction would run for short anims (e.g. attack3)
      // whose total duration is shorter than COMBO_INTERSWING_DELAY_MS.
      if (this.chainedSwingPending) {
        return;
      }
      if (this.queuedAttack && this.attackCounter < this.getMaxComboStep()) {
        this.queuedAttack = false;
        this.attackCounter += 1;
        this.scheduleChainedSwing(this.attackCounter);
        return;
      }
      this.endLockedAction();
      return;
    }

    // The full block strip completing means a hit-reaction just finished. If
    // the guard is still up and the button is still held, settle back to the
    // static block_idle pose; otherwise the button was released mid-reaction —
    // close out the block. (block_idle loops forever and never lands here.)
    if (BLOCK_KEYS.has(key)) {
      if (this.lockedAction !== 'block') return;
      if (this.scene.input.activePointer.rightButtonDown()) {
        this.playLogical('block_idle');
      } else {
        this.endLockedAction();
      }
      return;
    }

    if (DASH_KEYS.has(key) || ROLL_KEYS.has(key)) {
      this.endLockedAction();
      return;
    }

    if (TAKE_HIT_KEYS.has(key)) {
      if (this.lockedAction === 'hurt') {
        this.endLockedAction();
      }
      return;
    }

    if (DEATH_KEYS.has(key)) {
      // One-shot death; freeze the corpse so it doesn't keep sliding once it
      // settles. Locked action stays 'dead' until the scene restarts.
      this.setVelocity(0, 0);
      return;
    }

    if (LEDGE_CLIMB_KEYS.has(key)) {
      const targetBodyBottom = this.body.bottom;
      this.body.setAllowGravity(true);
      this.endLockedAction();
      const targetBodyTop = targetBodyBottom - PHYSICS_BODY_HEIGHT;
      // Same inverse-body math as startClimb — anchor in source pixels times
      // scaleY converts to world-space sprite Y for the new (post-climb) anim.
      const newSpriteY =
        targetBodyTop +
        (this.displayOriginY - this.body.offset.y) * this.scaleY;
      this.setPosition(this.x, newSpriteY);
    }
  }

  private onAnimationUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    // Animation-frame-driven audio triggers. Authored via the
    // anim-sound-aligner tool and persisted to animationSoundTriggers.json.
    // The loop fires each trigger at most once per anim play (gated by
    // firedTriggers), which is cleared on every startAttackAnim and on
    // hurt/death/endLockedAction so chained swings re-arm cleanly.
    //
    // Runs before the teleport branch so attack6's triggers fire too — the
    // teleport early-return below intentionally suppresses combo-cancel.
    const triggers = getTriggersFor(animation.key);
    for (const trigger of triggers) {
      if (frame.index < trigger.frameIndex) continue;
      const fireKey = `${animation.key}:${trigger.name}`;
      if (this.firedTriggers.has(fireKey)) continue;
      const seekSec = trigger.audioStartOffsetMs
        ? trigger.audioStartOffsetMs / 1000
        : 0;
      playOneShot(this.scene, trigger.soundId, seekSec);
      this.firedTriggers.add(fireKey);
    }

    if (animation.key === TELEPORT_ANIM_KEY) {
      if (!this.teleportFired) {
        if (frame.index >= this.teleportAppearStartFrame) {
          this.applyTeleport();
          this.teleportFired = true;
        }
        return;
      }
      // Hover phase. Hand off to the regular fall flow once we reach the
      // hover-end frame; the playLogical('fall') call inside swaps the
      // active animation, so this branch can't re-enter on later frames.
      if (frame.index >= TELEPORT_HOVER_END_FRAME) {
        this.endTeleportHoverAndFall();
      }
      return;
    }
    // Combo cancellation: an attack animation can declare a 'cancel' stage in
    // its registry config marking the frame from which the swing is "done" —
    // any remaining frames are recovery padding. While a queued follow-up is
    // pending and the playhead is in that range, advance to the next combo
    // step instead of waiting for ANIMATION_COMPLETE. Lets attack2/attack3
    // (and their magic counterparts) chain at the active rhythm without
    // burning the trailing dead frames between swings.
    if (
      this.lockedAction === 'attack' &&
      this.queuedAttack &&
      !this.chainedSwingPending &&
      this.attackCounter < this.getMaxComboStep() &&
      ATTACK_KEYS.has(animation.key)
    ) {
      const cancelStage = getAnimationStage(animation.key, 'cancel');
      if (cancelStage && frame.index >= cancelStage.startFrame) {
        this.queuedAttack = false;
        this.attackCounter += 1;
        this.scheduleChainedSwing(this.attackCounter);
      }
    }
  }

  // Overlay-driven projectile spawn + audio. Body no longer plays attack1, so
  // the fire-frame projectile spawn and the gun's sound triggers both live on
  // the overlay's animation update. Sound playback delegates to the data-driven
  // animationSoundTriggers.json (authored via anim-sound-aligner) so the shot
  // and shell-drop timings are tunable from the tool — same path the body
  // attacks use in onAnimationUpdate.
  private onGunOverlayUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    if (this.lockedAction !== 'attack') return;
    if (!this.isGunslingerMode()) return;
    const config = this.projectileFireConfigs.get(
      this.currentMode as 'gunslinger_gun1' | 'gunslinger_gun2',
    );
    if (!config) return;
    if (animation.key !== config.overlayKey) return;

    const triggers = getTriggersFor(animation.key);
    for (const trigger of triggers) {
      if (frame.index < trigger.frameIndex) continue;
      const fireKey = `${animation.key}:${trigger.name}`;
      if (this.firedTriggers.has(fireKey)) continue;
      const seekSec = trigger.audioStartOffsetMs
        ? trigger.audioStartOffsetMs / 1000
        : 0;
      playOneShot(this.scene, trigger.soundId, seekSec);
      this.firedTriggers.add(fireKey);
    }

    if (this.firedProjectile) return;
    if (frame.index < config.fireFrame) return;
    this.spawnProjectile(config);
    this.firedProjectile = true;
  }

  // Overlay-driven attack-end. With the body no longer playing attack1, the
  // gun overlay's attack1 completion is what closes the locked-attack window.
  private onGunOverlayComplete(
    animation: Phaser.Animations.Animation,
  ): void {
    if (this.lockedAction !== 'attack') return;
    if (!this.isGunslingerMode()) return;
    const config = this.projectileFireConfigs.get(
      this.currentMode as 'gunslinger_gun1' | 'gunslinger_gun2',
    );
    if (!config) return;
    if (animation.key !== config.overlayKey) return;
    this.endLockedAction();
  }

  private applyTeleport(): void {
    const scene = this.scene as unknown as NearestEnemyScene;
    const target = scene.getNearestEnemy(this.x, this.y);
    if (target) {
      this.setPosition(target.x, target.y - TELEPORT_HOVER_OFFSET_Y);
    }
    // No else: handleAttackInput only starts attack6 when a valid target is in
    // sight, so a null target here means it died or broke line of sight during
    // the wind-up — the player then holds position rather than blinking nowhere
    // (an earlier fallback hopped blindly in the facing direction).
    // Hold the new position until TELEPORT_HOVER_END_FRAME by suspending
    // gravity and zeroing velocity. Without this, an enemy in the sky leaves
    // the player dropping immediately on frame 7 — the visual reads as a
    // failed teleport rather than a magical hover-and-strike. Gravity is
    // restored in endTeleportHoverAndFall (or cancelTransientState on
    // interrupt) so the standard fall/land sequence picks back up.
    this.body.setAllowGravity(false);
    this.setVelocity(0, 0);
  }

  // Closes attack6's hover window: clears the attack lockedAction (so input
  // re-arms), re-enables gravity, and snaps the body to the fall animation
  // so updateVisualState's standard fall→idle/run transitions handle the
  // rest. Effectively cuts off attack6 at TELEPORT_HOVER_END_FRAME — the
  // trailing frames (drawn-out post-strike recovery) are skipped because
  // the animation has already been swapped out by playLogical('fall').
  private endTeleportHoverAndFall(): void {
    this.cancelChainedSwingTimer();
    this.lockedAction = null;
    this.queuedAttack = false;
    this.attackCounter = 0;
    this.teleportFired = false;
    this.firedProjectile = false;
    this.firedTriggers.clear();
    this.body.setAllowGravity(true);
    this.currentVisualState = 'fall';
    this.playLogical('fall');
  }

  private spawnProjectile(config: ProjectileFireConfig): void {
    // Aim is taken from the gun pivot (grip) → cursor. The barrel extends
    // along the gun's local +X, so rotating (PROJECTILE_BARREL_LENGTH_PX, 0)
    // by `angle` places the spawn at the visible muzzle for any firing
    // direction; the same `angle` drives the velocity vector.
    const pointer = this.scene.input.activePointer;
    const cursorX = pointer?.worldX ?? this.x;
    const cursorY = pointer?.worldY ?? this.y;
    const pivotSign = this.flipX ? -1 : 1;
    // Pivot is in source-pixel space relative to the body's frame center, so
    // it scales with sprite.scaleX/Y to land on the visible grip when the
    // body animation has a non-1 displayScale.
    const pivotX =
      this.x + GUN_OVERLAY_PIVOT_OFFSET_X * pivotSign * this.scaleX;
    const pivotY = this.y + GUN_OVERLAY_PIVOT_OFFSET_Y * this.scaleY;
    const angle = Math.atan2(cursorY - pivotY, cursorX - pivotX);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const spawnX = pivotX + PROJECTILE_BARREL_LENGTH_PX * cosA;
    const spawnY = pivotY + PROJECTILE_BARREL_LENGTH_PX * sinA;
    const spawner = this.scene as unknown as ProjectileSpawnerScene;
    spawner.spawnProjectile({
      x: spawnX,
      y: spawnY,
      mode: config.mode,
      velocityX: config.speed * cosA,
      velocityY: config.speed * sinA,
      damage: config.damage,
    });
    // Gunfire is loud — alert nearby enemies to where we fired from so they
    // investigate it. Only guns spawn projectiles (the sword/magic stay silent),
    // so this runs for gunshots only. The player's position is "the place the
    // gun was fired", the exact spot enemies path toward.
    spawner.alertEnemiesToGunshot(this.x, this.y);
  }

  // Per-frame overlap scan during a sword attack. Builds a forward rect and
  // applies the swing's damage (SWORD_MAGIC_ATTACK_DAMAGE for a magic swing,
  // else SWORD_ATTACK_DAMAGE) to each Enemy whose body overlaps. The
  // per-attack `swordHitTargets` set guarantees each enemy takes at most one
  // hit per swing even though this runs every frame the attack is locked.
  // Called only for sword_master mode; gunslinger damage flows through the
  // projectile → enemy overlap registered on the GameScene.
  private applySwordHits(): void {
    if (this.lockedAction !== 'attack') return;
    if (this.isGunslingerMode()) return;
    // Gate hit detection to the visual strike window. Without this, an enemy
    // standing inside the hitbox at the very first frame of a swing would
    // take damage (and play the impact SFX) during the wind-up — well before
    // the blade has visibly connected. The `strike` stage on each attack
    // animation marks the frames during which the blade is actually swinging
    // through its arc. Attacks without a `strike` stage fall back to the
    // legacy "every frame" behavior so the gate can be rolled out per-anim.
    const currentAnim = this.anims.currentAnim;
    const currentFrame = this.anims.currentFrame;
    if (currentAnim && currentFrame) {
      const strikeStage = getAnimationStage(currentAnim.key, 'strike');
      if (strikeStage) {
        if (
          currentFrame.index < strikeStage.startFrame ||
          currentFrame.index > strikeStage.endFrame
        ) {
          return;
        }
      }
    }
    // Magic swings cost an orb and hit harder than free regular swings. The
    // kind is fixed for the whole swing (set in startAttackAnim, which already
    // downgraded magic→regular if no orb could be spent), so resolve the
    // per-hit damage once here rather than per overlapping enemy.
    const swingDamage =
      this.currentAttackKind === 'magic'
        ? SWORD_MAGIC_ATTACK_DAMAGE
        : SWORD_ATTACK_DAMAGE;
    const facing: 1 | -1 = this.flipX ? -1 : 1;
    const hitboxX =
      facing === 1 ? this.x : this.x - SWORD_ATTACK_REACH_X;
    const hitboxY = this.y - SWORD_ATTACK_REACH_Y / 2;
    // Phaser's overlapRect returns Arcade Bodies (dynamic+static depending
    // on flags). Dynamic-only is what we want — enemies have dynamic bodies;
    // the tilemap collision layer is static and irrelevant here.
    const hits = this.scene.physics.overlapRect(
      hitboxX,
      hitboxY,
      SWORD_ATTACK_REACH_X,
      SWORD_ATTACK_REACH_Y,
      true,
      false,
    ) as Phaser.Physics.Arcade.Body[];
    for (const body of hits) {
      const obj = body.gameObject;
      if (obj instanceof Trap) {
        // Traps are indestructible hazards — mirrors the projectile→trap rule
        // (GameScene.onProjectileHitsTrap): the blade clinks off with the
        // impact SFX but the trap survives, so the player can't clear a hazard
        // by swinging at it.
        if (!obj.active) continue;
        if (!this.swordImpactPlayedThisSwing) {
          const slashId =
            SWORD_SLASH_IMPACT_SOUND_IDS[
              Math.floor(Math.random() * SWORD_SLASH_IMPACT_SOUND_IDS.length)
            ];
          playOneShot(this.scene, slashId);
          this.swordImpactPlayedThisSwing = true;
        }
        continue;
      }
      if (!(obj instanceof Enemy)) continue;
      if (obj.isDead()) continue;
      if (this.swordHitTargets.has(obj)) continue;
      obj.takeDamage(swingDamage, this.x);
      this.swordHitTargets.add(obj);
      // One impact SFX per swing — overlapping impacts (e.g. AoE attack5
      // catching two enemies) clip and muddy the whoosh. Damage application
      // still runs per-enemy above; only the audio is deduped.
      if (!this.swordImpactPlayedThisSwing) {
        const slashId =
          SWORD_SLASH_IMPACT_SOUND_IDS[
            Math.floor(Math.random() * SWORD_SLASH_IMPACT_SOUND_IDS.length)
          ];
        playOneShot(this.scene, slashId);
        this.swordImpactPlayedThisSwing = true;
      }
    }
  }

  getHealth(): number {
    return this.health;
  }

  getMaxHealth(): number {
    return PLAYER_MAX_HEALTH;
  }

  getStamina(): number {
    return this.stamina;
  }
  getMaxStamina(): number {
    return MAX_STAMINA;
  }

  getMagic(): number {
    return this.magic;
  }
  // Live orb cap: base plus the Orb Pouch upgrades bought this run. Derived
  // (not stored) so it stays correct across level transitions and death/respawn
  // — the upgrade count lives in runProgress, which survives world rebuilds.
  getMaxMagic(): number {
    // The three tiers raise the cap unevenly (3 → 6 → 8 → 10), so sum the gain
    // of each purchased tier rather than multiplying a count by a uniform step.
    let max = BASE_MAX_MAGIC;
    MAGIC_UPGRADE_LEVELS.forEach((levelId, tier) => {
      if (hasUpgrade(upgradeId('magic', levelId))) {
        max += MAGIC_UPGRADE_CAPACITY_STEPS[tier];
      }
    });
    return max;
  }

  getGun1Ammo(): number {
    return this.gun1Ammo;
  }
  // Live pistol cap: base plus the Ammo Storage upgrades bought this run (one
  // upgrade raises both guns). Derived for the same reason as getMaxMagic.
  getMaxGun1Ammo(): number {
    return BASE_MAX_GUN1_AMMO + countUpgrades('ammo') * GUN1_CAPACITY_UPGRADE_STEP;
  }

  getGun2Ammo(): number {
    return this.gun2Ammo;
  }
  // Live shotgun cap: base plus the same Ammo Storage upgrade count as gun1.
  getMaxGun2Ammo(): number {
    return BASE_MAX_GUN2_AMMO + countUpgrades('ammo') * GUN2_CAPACITY_UPGRADE_STEP;
  }

  getCoins(): number {
    return this.coins;
  }
  getMaxCoins(): number {
    return MAX_COINS;
  }

  getHealItems(): number {
    return this.healItems;
  }
  getMaxHealItems(): number {
    return MAX_HEAL_ITEMS;
  }

  // Bulk state setter used by the save/respawn pipeline (and HMR restore).
  // Position, velocity, mode, and facing are restored by the existing
  // setPosition/setVelocity/setCurrentMode/setFacing calls in GameScene; this
  // method handles only the resource fields that don't have public setters
  // elsewhere. Each value is clamped to its per-kind max so a snapshot
  // produced under a higher cap (e.g. a future upgrade) can't push the player
  // above the current limit.
  //
  // Note for future maintainers: if you add new player state fields that
  // need to survive death/respawn, add them to PlayerSnapshot in GameScene
  // AND to this method so the round-trip stays complete.
  applyRestoredState(state: {
    health: number;
    gun1Ammo: number;
    gun2Ammo: number;
    magic: number;
    stamina: number;
    coins?: number;
    healItems?: number;
  }): void {
    this.health = Phaser.Math.Clamp(state.health, 0, PLAYER_MAX_HEALTH);
    // Clamp to the player's CURRENT caps (base + purchased upgrades). Upgrades
    // live in runProgress, which survives the respawn rebuild, so a snapshot
    // taken while upgraded restores its full ammo here; one taken before the
    // upgrade simply can't exceed the now-higher cap. A snapshot authored under
    // a higher cap than the live one (e.g. a future down-tune) is clamped down.
    this.gun1Ammo = Phaser.Math.Clamp(state.gun1Ammo, 0, this.getMaxGun1Ammo());
    this.gun2Ammo = Phaser.Math.Clamp(state.gun2Ammo, 0, this.getMaxGun2Ammo());
    this.magic = Phaser.Math.Clamp(state.magic, 0, this.getMaxMagic());
    this.stamina = Phaser.Math.Clamp(state.stamina, 0, MAX_STAMINA);
    // Coins field is optional so legacy snapshots predating the coin economy
    // restore with the field absent — default to the player's current value
    // (which is INITIAL_COINS at construction).
    this.coins = Phaser.Math.Clamp(state.coins ?? this.coins, 0, MAX_COINS);
    // Heal items: optional for the same legacy-snapshot reason as coins.
    this.healItems = Phaser.Math.Clamp(
      state.healItems ?? this.healItems,
      0,
      MAX_HEAL_ITEMS,
    );
    this.staminaRegenAccumMs = 0;
  }

  // Pickup-driven resource grant. Clamped at the per-kind max so a fresh drop
  // never pushes a count past capacity. Used by GameScene's player↔drops overlap
  // handler; consumption (firing depletes ammo, casting depletes magic) is a
  // separate follow-up (see the player-resources TODO trail elsewhere).
  addPickup(kind: PickupKind, amount: number): void {
    if (kind === 'gun1') {
      this.gun1Ammo = Math.min(this.getMaxGun1Ammo(), this.gun1Ammo + amount);
    } else if (kind === 'gun2') {
      this.gun2Ammo = Math.min(this.getMaxGun2Ammo(), this.gun2Ammo + amount);
    } else if (kind === 'magic') {
      this.magic = Math.min(this.getMaxMagic(), this.magic + amount);
    } else if (kind === 'heal') {
      this.healItems = Math.min(MAX_HEAL_ITEMS, this.healItems + amount);
    } else if (kind === 'key_storms' || kind === 'key_widow') {
      // Boss keys aren't a numeric resource — record the unlock in the
      // persistent run-progress store (the source of truth for door unlocking,
      // which survives death/respawn). `amount` is ignored; collecting a key is
      // idempotent. Must be handled before the coin fall-through below so a key
      // pickup doesn't silently grant coins.
      recordKeyCollected(kind);
    } else {
      this.coins = Math.min(MAX_COINS, this.coins + amount);
    }
  }

  // Current value for a pickup-kind resource, so ShopScene can dim rows where
  // the buyer is already at max for that resource (no point selling a no-op).
  // Coins are included for completeness but the shop never sells coins.
  getResourceValue(kind: PickupKind): number {
    if (kind === 'gun1') return this.gun1Ammo;
    if (kind === 'gun2') return this.gun2Ammo;
    if (kind === 'magic') return this.magic;
    if (kind === 'heal') return this.healItems;
    return this.coins;
  }

  getResourceMax(kind: PickupKind): number {
    if (kind === 'gun1') return this.getMaxGun1Ammo();
    if (kind === 'gun2') return this.getMaxGun2Ammo();
    if (kind === 'magic') return this.getMaxMagic();
    if (kind === 'heal') return MAX_HEAL_ITEMS;
    return MAX_COINS;
  }

  // True when picking up `kind` would still benefit the player — i.e. the
  // backing resource isn't already at capacity. Ammo (gun1/gun2) and healing
  // hearts (heal) are gated so a maxed pickup is left on the ground instead of
  // being silently wasted on overlap; it's collected later, the moment a shot
  // or a heal frees a slot while the player still stands on it. Coins and boss
  // keys are always collectable: coins have ample headroom in practice, and
  // keys are idempotent unlocks rather than a capped numeric resource (their
  // getResourceValue aliases coins, so a max-check would be meaningless).
  canPickUp(kind: PickupKind): boolean {
    if (kind === 'gun1' || kind === 'gun2' || kind === 'heal') {
      return this.getResourceValue(kind) < this.getResourceMax(kind);
    }
    return true;
  }

  // Atomic shop purchase: rejects (returns false, no state change) when the
  // buyer can't afford the price OR already has the resource at max. On
  // success deducts coins and grants the resource via addPickup so the clamp
  // logic stays in one place. ShopScene calls this directly across the pause
  // boundary — see the planner notes for why a direct call (not an event)
  // works here: GameScene is paused but the Player instance is still alive.
  tryPurchase(item: ShopItem): boolean {
    if (this.coins < item.price) return false;
    if (item.kind === 'upgrade') {
      // One-time capacity upgrade: refuse if this shop's upgrade is already
      // owned (so it can't be bought twice), otherwise charge and record the
      // purchase in run-progress. No resource is granted — recording the
      // upgrade raises getMax* for the matching line, widening the cap the
      // player then fills via drops/restocks.
      if (hasUpgrade(item.id)) return false;
      this.coins -= item.price;
      recordUpgradePurchased(item.id);
      return true;
    }
    if (this.getResourceValue(item.pickupKind) >= this.getResourceMax(item.pickupKind)) {
      return false;
    }
    this.coins -= item.price;
    this.addPickup(item.pickupKind, item.grantAmount);
    return true;
  }

  // Whether this run has bought the capacity upgrade with the given id. Lets the
  // shop overlay show an OWNED (sold-out) state for an upgrade the player
  // already has, mirroring the MAX state on a fully-stocked resource.
  ownsUpgrade(id: string): boolean {
    return hasUpgrade(id);
  }

  // Q-driven heal. Spends one carried healing item to restore
  // HEAL_ITEM_RESTORE_AMOUNT health, clamped to PLAYER_MAX_HEALTH. No item is
  // spent (returns false) when the player is mid-committed-action (attack,
  // dash, roll, block, climb, hurt, or dead), empty-handed, already at full
  // health, or still inside the post-use cooldown — so a wasted press never
  // silently burns a heart. Gating on lockedAction (rather than only 'dead')
  // enforces the same souls-like discipline as the rest of the kit: you must
  // create space to drink, and can't negate a hit by healing inside the
  // post-hurt invulnerability window. Returns true only on an actual heal.
  // (To allow quick-potion healing at any time, relax this to `=== 'dead'`.)
  tryUseHealingItem(): boolean {
    if (this.lockedAction !== null) return false;
    if (this.scene.time.now < this.healItemCooldownUntil) return false;
    if (this.healItems <= 0) return false;
    if (this.health >= PLAYER_MAX_HEALTH) return false;
    this.healItems -= 1;
    this.health = Math.min(
      PLAYER_MAX_HEALTH,
      this.health + HEAL_ITEM_RESTORE_AMOUNT,
    );
    this.healItemCooldownUntil =
      this.scene.time.now + HEAL_ITEM_USE_COOLDOWN_MS;
    playOneShot(this.scene, 'heal_spell_cast');
    return true;
  }

  isDead(): boolean {
    return this.lockedAction === 'dead';
  }

  // True while any action (attack/dash/roll/block/climb/hurt/dead) owns the
  // player's input. Consumed by InteractionManager as the gate that suspends
  // hold-E progress so the player can't be swinging a sword and simultaneously
  // opening a chest. Structural — InteractionManager imports it via its own
  // InteractionPlayerQuery interface, no Player import needed.
  isInteractionBlocked(): boolean {
    return this.lockedAction !== null;
  }

  hurt(
    damage: number,
    sourceX: number,
    _sourceY: number,
    options: PlayerHurtOptions = {},
  ): void {
    if (this.lockedAction === 'dead') return;
    if (this.scene.time.now < this.invulnerableUntil) return;

    // Block negates damage from the front only — souls-like discipline.
    // facing = +1 when looking right (flipX false), -1 when looking left.
    // A source on the same side as facing means the player is looking at it,
    // so the swing/shot lands on the raised shield. Back-attacks still hurt
    // so block isn't omnipotent.
    if (this.lockedAction === 'block') {
      const facing: 1 | -1 = this.flipX ? -1 : 1;
      const sourceDirection: 1 | -1 = sourceX >= this.x ? 1 : -1;
      if (facing === sourceDirection) {
        // Still grant a short invuln window so a single attack can't burn
        // through block by re-firing within the same swing.
        this.invulnerableUntil = this.scene.time.now + PLAYER_INVULN_MS;
        // Play the full block strip as a one-shot "took a hit on the shield"
        // reaction. onAnimationComplete settles it back to block_idle if the
        // button is still held (or ends the block if it was released). The
        // invuln window above means a fresh reaction only triggers per distinct
        // hit, so this never stutter-restarts within one swing.
        this.playLogical('block');
        return;
      }
    }

    this.health = Math.max(0, this.health - damage);

    // Voice grunt on every successful hit — block and invuln have already
    // early-returned. Placed before the fatal-check so the killing blow
    // gets the grunt too, played alongside the death anim instead of
    // omitted. Projectile hits substitute a punchy arrow-impact variant so
    // taking a shot feels distinct from being meleed.
    const hurtSoundId =
      options.source === 'projectile' ? PROJECTILE_HURT_SOUND_ID : HURT_SOUND_ID;
    playOneShot(this.scene, hurtSoundId);

    const knockbackDir: 1 | -1 = this.x >= sourceX ? 1 : -1;
    this.setVelocityX(PLAYER_HURT_KNOCKBACK_X * knockbackDir);
    this.setVelocityY(PLAYER_HURT_KNOCKBACK_Y);
    this.invulnerableUntil = this.scene.time.now + PLAYER_INVULN_MS;

    if (this.health <= 0) {
      this.enterDeadState();
      return;
    }

    this.cancelTransientState();
    this.lockedAction = 'hurt';
    this.currentVisualState = 'idle';
    this.playLogical('take_hit');
  }

  private enterDeadState(): void {
    this.cancelTransientState();
    this.lockedAction = 'dead';
    this.currentVisualState = 'idle';
    this.playLogical('death');
    // Heavy impact stinger punctuating death. The game-global sound manager
    // keeps it alive through the scene.restart() / respawn-from-save rebuild
    // that GameScene fires RESPAWN_DELAY_MS after PLAYER_DIED_EVENT.
    playOneShot(this.scene, UI_BOOM_SOUND_ID);
    this.emit(PLAYER_DIED_EVENT);
  }

  // Clears in-flight action flags so a previous attack/dash/roll/block/climb
  // doesn't leak side effects after hurt/death interrupts it. Restores gravity
  // (climb disables it) and re-shows the gun overlay since the body anim is
  // about to change.
  private cancelTransientState(): void {
    this.cancelChainedSwingTimer();
    this.queuedAttack = false;
    this.attackCounter = 0;
    this.teleportFired = false;
    this.firedProjectile = false;
    this.firedTriggers.clear();
    this.body.setAllowGravity(true);
    // Wall-slide loop is driven from the per-frame velocity check, but hurt/
    // death routes bypass that update path for the rest of the action so kill
    // the loop here to avoid a stuck scrape during the take-hit/death anim.
    setPlayerStateSoundActive(this.scene, 'wallSlide', false);
  }

  private endLockedAction(): void {
    const wasGunslingerAttack =
      this.lockedAction === 'attack' && this.isGunslingerMode();
    this.cancelChainedSwingTimer();
    this.lockedAction = null;
    this.queuedAttack = false;
    this.attackCounter = 0;
    this.teleportFired = false;
    this.firedProjectile = false;
    this.firedTriggers.clear();
    // Gunslinger firing doesn't change the body's visual state, so closing
    // the locked-attack window must NOT snap the body back to idle — the
    // body is already showing the correct run/jump/fall/idle pose driven
    // by updateVisualState(). Just clear the flags and re-arm the overlay
    // back to idle (the gun's attack1 is one-shot and would otherwise sit
    // on its last frame until the next body anim change).
    if (wasGunslingerAttack) {
      this.playerGun?.playOverlay('idle');
      return;
    }
    this.currentVisualState = 'idle';
    this.playLogical('idle', { ignoreIfPlaying: true });
  }

  private applyAnimationAnchor(animation: Phaser.Animations.Animation): void {
    const {
      originX,
      originY,
      bodySourceWidth,
      bodySourceHeight,
      bodyOffsetX,
      bodyOffsetY,
      displayScale,
    } = getSpriteAnchor(
      animation.key,
      PHYSICS_BODY_WIDTH,
      PHYSICS_BODY_HEIGHT,
      this.flipX,
    );
    this.setOrigin(originX, originY);
    this.setScale(displayScale);
    // Body source size is divided by scale so that Phaser's auto-scaling
    // (body.width = sourceWidth * scale) lands on PHYSICS_BODY size in world.
    this.body.setSize(bodySourceWidth, bodySourceHeight);
    this.body.setOffset(bodyOffsetX, bodyOffsetY);
  }

  // Debug fly mode: enables free WASD movement across the world so the camera
  // can pan over every LDtk level. Disables gravity and tile collision so gaps
  // between scattered levels don't trap the player. All in-progress locked
  // actions (attack/dash/roll/block/climb) are cleared so re-entering normal
  // mode starts clean. Mode swaps via wheel still work in fly mode.
  private toggleFlyMode(): void {
    this.flyMode = !this.flyMode;
    if (this.flyMode) {
      this.body.setAllowGravity(false);
      this.body.checkCollision.none = true;
      this.cancelChainedSwingTimer();
      this.lockedAction = null;
      this.queuedAttack = false;
      this.attackCounter = 0;
      this.teleportFired = false;
      this.firedProjectile = false;
      this.wallSlideDirection = 0;
      setPlayerStateSoundActive(this.scene, 'wallSlide', false);
      this.setVelocity(0, 0);
      this.currentVisualState = 'idle';
      this.playLogical('idle', { ignoreIfPlaying: true });
    } else {
      this.body.setAllowGravity(true);
      this.body.checkCollision.none = false;
      this.setVelocity(0, 0);
      this.currentVisualState = 'idle';
      this.playLogical('idle', { ignoreIfPlaying: true });
    }
  }

  private updateFlyMode(): void {
    let vx = 0;
    let vy = 0;
    if (this.keyA.isDown && !this.keyD.isDown) vx = -FLY_SPEED;
    else if (this.keyD.isDown && !this.keyA.isDown) vx = FLY_SPEED;
    if (this.keyW.isDown && !this.keyS.isDown) vy = -FLY_SPEED;
    else if (this.keyS.isDown && !this.keyW.isDown) vy = FLY_SPEED;
    this.setVelocity(vx, vy);
    if (vx < 0) this.setFacing(true);
    else if (vx > 0) this.setFacing(false);
    const moving = vx !== 0 || vy !== 0;
    const nextState: PlayerVisualState = moving ? 'run' : 'idle';
    if (nextState !== this.currentVisualState) {
      this.currentVisualState = nextState;
      this.playLogical(moving ? 'run' : 'idle', { ignoreIfPlaying: true });
    }
  }

  setFacing(faceLeft: boolean): void {
    if (this.flipX === faceLeft) return;
    this.setFlipX(faceLeft);
    const currentAnim = this.anims.currentAnim;
    if (currentAnim) {
      this.applyAnimationAnchor(currentAnim);
    }
  }

  // Body faces toward the cursor in gunslinger modes so the gun overlay's
  // 360° aim never disagrees with the body's left/right flip. Runs even
  // while standing still — the player turns to track the mouse.
  private updateAimFacing(): void {
    if (!this.isGunslingerMode()) return;
    const pointer = this.scene.input.activePointer;
    if (!pointer) return;
    this.setFacing(pointer.worldX < this.x);
  }

  // Creates the PlayerGun on entry to a gunslinger mode, swaps its art on a
  // gun1 ↔ gun2 transition, and destroys it on exit to sword_master. Idempotent.
  private ensurePlayerGunForMode(): void {
    if (
      this.currentMode === 'gunslinger_gun1' ||
      this.currentMode === 'gunslinger_gun2'
    ) {
      if (this.playerGun) {
        this.playerGun.setMode(this.currentMode);
      } else {
        this.playerGun = new PlayerGun(
          this.scene,
          this.x,
          this.y,
          this.currentMode,
        );
        // Body no longer plays attack1, so projectile spawn timing and
        // attack-end signaling come from the gun overlay's own animation
        // events. Listeners are torn down automatically when the sprite is
        // destroyed in destroyPlayerGun().
        this.playerGun.on(
          Phaser.Animations.Events.ANIMATION_UPDATE,
          this.onGunOverlayUpdate,
          this,
        );
        this.playerGun.on(
          Phaser.Animations.Events.ANIMATION_COMPLETE,
          this.onGunOverlayComplete,
          this,
        );
      }
    } else {
      this.destroyPlayerGun();
    }
  }

  private destroyPlayerGun(): void {
    if (!this.playerGun) return;
    this.playerGun.destroy();
    this.playerGun = null;
  }

  // Toggles overlay visibility based on the registry the body anim came from
  // (gun visible only when the body is rendering no_gun art). The overlay's
  // attack/idle choice is driven independently — startAttackAnim triggers
  // attack1, and the overlay-anim-complete handler returns to idle. Calling
  // playOverlay('idle') here mid-fire would clobber the in-progress attack
  // (the body switches between idle/run/fall during a shot), so the idle
  // re-arm is gated on lockedAction != 'attack'.
  private syncGunOverlayForBodyAnim(
    bodyAnimKey: string,
    _logical: LogicalAnimationKey,
  ): void {
    if (!this.playerGun) return;
    const source = getAnimationSourceMode(bodyAnimKey);
    if (source === 'gunslinger_body') {
      this.playerGun.setVisible(true);
      if (this.lockedAction !== 'attack') {
        this.playerGun.playOverlay('idle');
      }
    } else {
      this.playerGun.setVisible(false);
    }
  }

  // Each-frame pose update: gun grip snaps to the player's hand pivot and
  // rotates to face the cursor. Skipped when there's no active overlay so
  // sword_master frames don't pay for the math.
  private syncPlayerGun(): void {
    if (!this.playerGun) return;
    const pointer = this.scene.input.activePointer;
    const cursorX = pointer?.worldX ?? this.x;
    const cursorY = pointer?.worldY ?? this.y;
    this.playerGun.syncToOwner(
      this.x,
      this.y,
      this.flipX,
      this.scaleX,
      cursorX,
      cursorY,
    );
  }
}
