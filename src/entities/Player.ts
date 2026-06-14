import Phaser from 'phaser';
import {
  getTriggersFor,
  playOneShot,
  setPlayerStateSoundActive,
} from '../audio';
import {
  PlayerMovementAudio,
  type MovementAudioInput,
} from './playerMovementAudio';
import {
  buildProjectileFireConfigs,
  type ProjectileFireConfig,
} from './playerProjectileConfig';
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
  PROJECTILE_BARREL_LENGTH_PX,
  GUN_OVERLAY_PIVOT_OFFSET_X,
  GUN_OVERLAY_PIVOT_OFFSET_Y,
  PLAYER_MAX_HEALTH,
  PLAYER_INVULN_MS,
  PLAYER_HURT_KNOCKBACK_X,
  PLAYER_HURT_KNOCKBACK_Y,
  FALL_DAMAGE_SAFE_SPEED,
  FALL_DAMAGE_SPEED_PER_HP,
  FALL_DAMAGE_MAX,
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
  getAnimationSourceMode,
  getAnimationStage,
  getSpriteAnchor,
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

// Sample offset below body.bottom when probing the tile underfoot. Body.bottom
// sits at the top edge of the floor tile while standing; +4px lands safely
// inside the tile beneath without risking overshoot into the next cell down.
const FOOTSTEP_TILE_PROBE_OFFSET_Y = 4;

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
  | 'key_widow'
  | 'key_heart';

const SWORD_SLASH_IMPACT_SOUND_IDS = [
  'sword_slash_impact_1',
  'sword_slash_impact_2',
  'sword_slash_impact_3',
] as const;

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
// 20 px above the enemy center keeps the slash hitbox inside every body while still looking like a hover.
const TELEPORT_HOVER_OFFSET_Y = 20;
// Cuts the hover at frame 20 and drops into fall so the post-strike recovery frames are skipped.
const TELEPORT_HOVER_END_FRAME = 20;
// Brief pause between chained swings so each hit reads as discrete rather than a continuous blur.
const COMBO_INTERSWING_DELAY_MS = 125;
const LEFT_MOUSE_BUTTON = 0;
// Debug fly speed (G key): free WASD flight with gravity and collision off.
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
// block_idle loops forever (never completes); block is the hit-reaction one-shot that does.
const BLOCK_KEYS: ReadonlySet<string> = fullKeysForLogical('block');
const LEDGE_CLIMB_KEYS: ReadonlySet<string> = fullKeysForLogical('ledge_climb');
const TAKE_HIT_KEYS: ReadonlySet<string> = fullKeysForLogical('take_hit');
const DEATH_KEYS: ReadonlySet<string> = fullKeysForLogical('death');

// Event emitted on the Player sprite when health hits zero. GameScene listens
// to schedule a restart after the death animation has had time to play.
export const PLAYER_DIED_EVENT = 'player-died';

/**
 * @function    requireAnimKey
 * @description Resolve a mode+logical animation key at module load, throwing if absent — a missing required animation is a registry bug, not a recoverable state.
 * @param   mode     Character mode id.
 * @param   logical  Logical animation key.
 * @returns the resolved full animation key string; throws if the registry has no such key.
 * @calledby module-load constant setup pinning a known-required animation key (TELEPORT_ANIM_KEY)
 * @calls    src/sprites/characterLoader.ts → animKey, then the Error constructor on a miss
 */
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

/**
 * @file entities/Player.ts
 * @description The player-controlled avatar — owns the whole player feel: a souls-like movement kit (run, jump with jump-cut + fall-bonus gravity, dash, roll, wall-slide, ledge-climb) over a small locked-action state machine (attack/dash/roll/block/climb/hurt/dead) that gates input while an action plays. Combat spans three mouse-wheel-switched weapon families (MODE_ORDER): the sword_master melee combo (magic stance, roll-attack, teleport finisher) and two gunslinger overlay modes that fire projectiles. Tracks every resource (health, gun1/gun2 ammo, magic orbs, stamina, coins, heal items) and enforces caps (base + run-progress upgrades), and runs hurt/block/fall-damage/death. Animation drives both visual state and audio (logical-key anims + frame-indexed sound triggers); lockedAction + currentVisualState are the spine almost every branch keys off. Reads keyboard + mouse and a per-frame tick; emits the sprite/body, projectiles, sword damage, audio, the optional gun overlay, and PLAYER_DIED_EVENT.
 * @module entities
 */
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
  // Created on gunslinger entry, destroyed on exit so it never lingers during sword_master play.
  private playerGun: PlayerGun | null = null;
  private currentVisualState: PlayerVisualState = 'idle';
  private lockedAction: LockedAction = null;
  private attackCounter = 0;
  private queuedAttack = false;
  // Guards onAnimationComplete so a short anim completing before the delay timer doesn't end the lock early.
  private chainedSwingPending = false;
  private chainedSwingTimer: Phaser.Time.TimerEvent | null = null;
  private teleportFired = false;
  private firedProjectile = false;
  // Tracks fired audio triggers (animKey:triggerName) so each fires once per play; cleared per swing.
  private readonly firedTriggers: Set<string> = new Set();
  private magicMode = false;
  private currentAttackKind: AttackKind = 'regular';
  private wallSlideDirection: MoveDirection = 0;
  // Locked at roll start so a cursor-driven facing change mid-roll doesn't alter the trajectory.
  private rollDirection: 1 | -1 = 1;
  private wheelCooldownUntil = 0;
  private flyMode = false;
  private health = PLAYER_MAX_HEALTH;
  private gun1Ammo = INITIAL_GUN1_AMMO;
  private gun2Ammo = INITIAL_GUN2_AMMO;
  private magic = INITIAL_MAGIC;
  private stamina = INITIAL_STAMINA;
  private coins = INITIAL_COINS;
  // Carried healing items; healItemCooldownUntil is the anti-spam lockout timestamp.
  private healItems = INITIAL_HEAL_ITEMS;
  private healItemCooldownUntil = 0;
  // Accumulates delta-ms toward the next stamina pip; reset to 0 on a dash.
  private staminaRegenAccumMs = 0;
  private invulnerableUntil = 0;
  // Peak downward velocity this airborne arc; consumed on touchdown to compute fall damage.
  private fallPeakVy = 0;
  // Drives cloth/footstep/fall sound loops; fed a per-frame input struct from update().
  private readonly movementAudio: PlayerMovementAudio;
  // Enemies already hit this swing; prevents the per-frame scan from dealing damage twice.
  private readonly swordHitTargets: Set<Enemy> = new Set();
  // One impact sound per swing regardless of how many enemies it catches; cleared per swing.
  private swordImpactPlayedThisSwing: boolean = false;
  private readonly attackPointerHandler: PointerHandler;
  private readonly wheelHandler: WheelHandler;
  private readonly postUpdateHandler: () => void;
  // When false, update bails early and pointer/wheel handlers no-op (landing-page freeze).
  private controlsEnabled = true;

  /**
   * @function    constructor
   * @description Wire physics, keys, input/anim/post-update listeners, and movement-audio; throws on missing textures or registry gaps.
   * @param   scene  Owning Phaser scene.
   * @param   x, y   Spawn position (world px).
   * @calledby src/entities/EntityFactory.ts → the player factory when a level's world is built
   * @calls    Phaser physics/input setup, src/entities/playerProjectileConfig.ts → buildProjectileFireConfigs, the PlayerMovementAudio constructor, and the initial idle animation
   */
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
    // Cap Y only so long falls can't tunnel through floors; dash/run X speed is uncapped.
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
    this.movementAudio = new PlayerMovementAudio(scene, () =>
      this.probeFootSurface(),
    );

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

    // POST_UPDATE so the gun reads physics-resolved x/y; update() would trail by one frame.
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

  // ── Mode + control accessors ─────────────────────────────────────────────
  /** The active weapon mode (sword_master / gunslinger_gun1 / gunslinger_gun2). */
  getCurrentMode(): CharacterModeId {
    return this.currentMode;
  }

  /** True while the magic sword stance is active (F toggles; clears when wheeling to a gun). */
  isMagicMode(): boolean {
    return this.magicMode;
  }

  /**
   * @function    setControlsEnabled
   * @description Freeze all input and zero velocity; re-enabling restores normal play next frame.
   * @param   enabled  False to freeze, true to resume.
   * @calledby src/scenes/GameScene.ts → the landing-page freeze and cutscene/transition seams that suspend player control
   * @calls    the velocity setter when freezing; otherwise just flips the gate
   */
  setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
    if (!enabled) {
      this.setVelocity(0, 0);
    }
  }

  /**
   * @function    vanishForWarp
   * @description Hide the sprite and disable the body for the victory warp — no way back, run ends.
   * @calledby src/scenes/GameScene.ts → the portal victory warp once the player commits to the level-13 exit
   * @calls    the sprite visibility and body-enable toggles only
   */
  vanishForWarp(): void {
    this.setVisible(false);
    this.body.enable = false;
  }

  /**
   * @function    setCurrentMode
   * @description Programmatic mode swap (used by save/HMR restore); skips the wheel cooldown and the floor re-snap. Clears magic stance when leaving sword_master and re-syncs the gun + anim. No-op if already in that mode.
   * @param   mode  The character mode to switch to.
   * @calledby src/scenes/playerSnapshot.ts → save/HMR restore reapplying a previously-active weapon mode
   * @calls    src/entities/Player.ts → ensurePlayerGunForMode and applyModeChangeAnimation
   */
  setCurrentMode(mode: CharacterModeId): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    if (mode !== 'sword_master') {
      this.magicMode = false;
    }
    this.ensurePlayerGunForMode();
    this.applyModeChangeAnimation();
  }

  // ── Per-frame update ─────────────────────────────────────────────────────
  /**
   * @function    update
   * @description Per-frame driver: state machine then fall-damage then movement audio, in that order.
   * @calledby Phaser per-frame update loop (via src/scenes/GameScene.ts → update)
   * @calls    src/entities/Player.ts → updateInner and updateFallDamage, then src/entities/playerMovementAudio.ts → update
   */
  update(): void {
    this.updateInner();
    this.updateFallDamage();
    this.movementAudio.update(this.buildMovementAudioInput());
  }

  /** Packs this frame's physics/state into the struct the movement-audio rig expects. */
  private buildMovementAudioInput(): MovementAudioInput {
    return {
      deltaMs: this.scene.game.loop.delta,
      flyMode: this.flyMode,
      dead: this.lockedAction === 'dead',
      hurtPlaying: this.lockedAction === 'hurt',
      bodyMoving: this.currentVisualState !== 'idle',
      running: this.currentVisualState === 'run',
      onGround: this.body.blocked.down || this.body.touching.down,
      descending: this.body.velocity.y > 0,
      wallSliding: this.wallSlideDirection !== 0,
      y: this.y,
    };
  }

  /** Samples the IntGrid tile directly underfoot for footstep sound selection. */
  private probeFootSurface(): number {
    const sceneWithIntGrid = this.scene as unknown as IntGridQueryScene;
    return sceneWithIntGrid.getIntGridValueAt(
      this.x,
      this.body.bottom + FOOTSTEP_TILE_PROBE_OFFSET_Y,
    );
  }

  /**
   * @function    updateInner
   * @description Main per-frame input/state machine: locked-action branch first, then free movement, jump, and wall-slide; sets velocity/facing/visual-state and may transition into a locked action.
   * @calledby src/entities/Player.ts → update, ahead of fall-damage and audio
   * @calls    tickStaminaRegen, the fly-mode/heal/aim handlers, the action starters (startDash/startRoll/startBlock/startClimb), and updateVisualState
   */
  private updateInner(): void {
    if (!this.controlsEnabled) {
      // Landing-page freeze: zero X and bail; gravity left on so the player settles to the floor.
      this.setVelocityX(0);
      return;
    }
    if (this.lockedAction === 'dead') {
      // No input/facing; gravity still settles the corpse where knockback left it.
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

    // tryUseHealingItem owns all the guards; this is unconditional — it self-no-ops when impossible.
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.tryUseHealingItem();
    }

    // Cursor-driven body facing (gunslinger). Before movement so velocity logic
    // can still run; the movement-direction setFacing below is sword_master-only.
    this.updateAimFacing();

    // Block reads the held RMB state, not a press edge, so it can engage the first free grounded frame.
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

    // Gunslinger shots are overlay-only; movement still runs (unlike sword swings which freeze).
    const isGunslingerShooting =
      this.lockedAction === 'attack' && this.isGunslingerMode();

    if (this.lockedAction !== null && !isGunslingerShooting) {
      if (this.lockedAction === 'attack') {
        const onFloorNow = this.body.blocked.down || this.body.touching.down;
        // Roll/jump cancel a grounded sword swing and have priority; JustDown prevents double-firing below.
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
          // Air swings allow lateral steering; facing stays locked to the attack's start direction.
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
    // Wall-slide scrape loop; force-cleared by cancelTransientState/toggleFlyMode so it can't stick.
    setPlayerStateSoundActive(
      this.scene,
      'wallSlide',
      this.wallSlideDirection !== 0,
    );

    this.updateVisualState();
  }

  /** True during the sword_master roll-attack (the slide-on-velocity swing); gunslinger attack1 is not one. */
  private isRollAttackInProgress(): boolean {
    return (
      this.currentMode === 'sword_master' &&
      this.attackCounter === ROLL_ATTACK_STEP
    );
  }

  /** True when the current mode is either gun (drives the gun-overlay combat path). */
  private isGunslingerMode(): boolean {
    return (
      this.currentMode === 'gunslinger_gun1' ||
      this.currentMode === 'gunslinger_gun2'
    );
  }

  /**
   * @function    tryAdvanceMode
   * @description Step through MODE_ORDER by ±1, swapping the weapon mode, starting the wheel cooldown, and re-snapping the body so the feet stay planted when grounded. No-op while a locked action runs or at the list ends.
   * @param   direction  +1 forward / -1 back through MODE_ORDER.
   * @calledby src/entities/Player.ts → the wheel handler, on a scroll requesting the next/previous weapon mode
   * @calls    ensurePlayerGunForMode, applyModeChangeAnimation, and the inverse body-position math
   */
  private tryAdvanceMode(direction: 1 | -1): void {
    if (this.lockedAction !== null) return;
    const currentIndex = MODE_ORDER.indexOf(this.currentMode);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= MODE_ORDER.length) return;
    // Capture floor contact + body.bottom BEFORE the swap so it can be restored.
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
      // Inverse body math: body.bottom = sprite.y - displayOriginY*scaleY + offset.y*scaleY + body.height
      const newY =
        prevBodyBottom +
        this.displayOriginY * this.scaleY -
        this.body.offset.y * this.scaleY -
        this.body.height;
      this.setPosition(this.x, newY);
    }
  }

  /** Replays the current visual state's anim in the new mode's art so a weapon swap keeps the same pose. */
  private applyModeChangeAnimation(): void {
    const logical = this.visualStateToLogical(this.currentVisualState);
    this.playLogical(logical);
  }

  /** Maps visual state to the logical anim key for a mode swap; locked states all collapse to idle. */
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

  /**
   * @function    playLogical
   * @description Resolve and play the mode-specific animation key, syncing the gun overlay; returns false when the current mode has no such key.
   * @param   logical  Logical animation key.
   * @param   options  ignoreIfPlaying flag plus optional repeat/duration overrides.
   * @returns true if the animation played; false when the current mode has no such key.
   * @calledby widely used — every state transition and visual-state update that shows a body pose
   * @calls    the Phaser sprite animation play (with derived frameRate when a duration is given) and src/entities/Player.ts → syncGunOverlayForBodyAnim
   */
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
        // frameRate:null forces Phaser to derive the rate from duration —
        // otherwise calculateDuration prefers anim.frameRate and ignores it.
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

  // ── Combat / attacks ─────────────────────────────────────────────────────
  /**
   * @function    handleAttackInput
   * @description Route an LMB press to the right attack: queue a combo follow-up, a roll-attack, a teleport (Space), or a fresh swing.
   * @calledby src/entities/Player.ts → the attack pointer handler, on a left-mouse-button press while controls are enabled
   * @calls    startAttackAnim, the scene's nearest-enemy query (teleport gate), and tryConsumeGunslingerAmmo
   */
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
      // attack6 needs a live in-sight enemy; no target = no-op so you can't blink blindly.
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

  /**
   * @function    tickStaminaRegen
   * @description Tick stamina regen once per frame, refilling whole pips up to the cap; paused during a dash so back-to-back dashes can't exploit it.
   * @calledby src/entities/Player.ts → updateInner, before reading dash input
   * @calls    only field math on the regen accumulator and stamina count
   */
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

  /**
   * @function    tryConsumeGunslingerAmmo
   * @description Deduct one shot's ammo so the caller can abort silently on an empty mag.
   * @returns true if a shot was paid for (or no ammo applies); false when the active gun's magazine is empty.
   * @calledby src/entities/Player.ts → handleAttackInput, before starting a gunslinger shot
   * @calls    only field math on the per-gun ammo counts
   */
  private tryConsumeGunslingerAmmo(): boolean {
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

  /** First combo step for the current mode (sword_master opens at COMBO_FIRST_STEP; gunslinger has a single attack, step 1). */
  private getFirstComboStep(): number {
    return this.currentMode === 'sword_master' ? COMBO_FIRST_STEP : 1;
  }

  /** Last combo step for the current mode (sword_master combos up to MAX_COMBO_STEP; gunslinger caps at its single attack, step 1). */
  private getMaxComboStep(): number {
    return this.currentMode === 'sword_master' ? MAX_COMBO_STEP : 1;
  }

  /**
   * @function    scheduleChainedSwing
   * @description Queue the next combo swing after a brief hold so each hit reads as discrete; the finisher (MAX_COMBO_STEP) fires immediately.
   * @param   step  The combo step to play next.
   * @calledby src/entities/Player.ts → onAnimationComplete and onAnimationUpdate, when a queued swing is accepted (anim-complete or cancel-stage)
   * @calls    cancelChainedSwingTimer, startAttackAnim, and a scene delayed-call for the inter-swing gap
   */
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

  /**
   * @function    cancelChainedSwingTimer
   * @description Cancel any pending chained-swing timer and clear the pending flag, so an interrupt (hurt/death/mode-swap) can't fire a queued follow-up swing.
   * @calledby src/entities/Player.ts → any interrupt aborting a queued combo (scheduleChainedSwing, cancelTransientState, endLockedAction, endTeleportHoverAndFall, toggleFlyMode)
   * @calls    the Phaser timer-event remove; no further delegation
   */
  private cancelChainedSwingTimer(): void {
    if (this.chainedSwingTimer) {
      this.chainedSwingTimer.remove(false);
      this.chainedSwingTimer = null;
    }
    this.chainedSwingPending = false;
  }

  /**
   * @function    startAttackAnim
   * @description Single entry for every attack: pays any magic cost, sets the attack lock, resets per-swing hit/trigger state, and plays the body or gun-overlay anim.
   * @param   step  The combo/attack step to play.
   * @calledby src/entities/Player.ts → handleAttackInput and scheduleChainedSwing, for every swing/shot
   * @calls    playLogical / the magic-attack play (sword) or the gun overlay play (gunslinger), and the velocity setter
   */
  private startAttackAnim(step: number): void {
    // Pay the per-swing magic cost; fall back to a regular swing when the meter
    // can't pay so the combo keeps flowing. Re-entered per chained swing.
    if (this.currentAttackKind === 'magic') {
      if (this.magic < MAGIC_COST_PER_SWING) {
        this.currentAttackKind = 'regular';
      } else {
        this.magic -= MAGIC_COST_PER_SWING;
      }
    }
    this.lockedAction = 'attack';
    // Fresh per-swing state so a re-attack (combo continuation, chained roll/
    // teleport) hits the same enemy again and re-arms the impact SFX + triggers.
    this.swordHitTargets.clear();
    this.swordImpactPlayedThisSwing = false;
    this.firedTriggers.clear();
    // Gunslinger fire animates only the gun overlay; the body keeps tracking
    // idle/run/fall via updateVisualState, so the player can move/jump mid-shot.
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

  // ── Movement abilities (dash / roll / block / climb) ─────────────────────
  /**
   * @function    startDash
   * @description Start a dash — lock into the dash state, set dash velocity, play the timed dash anim, spend one stamina bar, and reset the regen timer.
   * @calledby src/entities/Player.ts → updateInner, on a Shift press when dash is available and stamina allows
   * @calls    resolveFacingDirection, the dash-duration playLogical, and the velocity/stamina setters
   */
  private startDash(): void {
    const direction = this.resolveFacingDirection();
    this.lockedAction = 'dash';
    this.currentVisualState = 'dash';
    this.setFacing(direction === -1);
    this.setVelocityX(PLAYER_DASH_SPEED * direction);
    this.playLogical('dash', { duration: PLAYER_DASH_DURATION_MS });
    this.stamina = Math.max(0, this.stamina - DASH_STAMINA_COST);
    this.staminaRegenAccumMs = 0;
  }

  /**
   * @function    startRoll
   * @description Lock into a roll, pinning the direction now so a cursor flip mid-roll can't change the trajectory; plays the roll sound + anim and sets initial velocity (held at zero for the gunslinger wind-up).
   * @calledby src/entities/Player.ts → updateInner, on an S press while grounded or an S cancel out of a grounded sword swing
   * @calls    resolveFacingDirection, the roll one-shot sound, and the roll playLogical
   */
  private startRoll(): void {
    const direction = this.resolveFacingDirection();
    this.lockedAction = 'roll';
    this.currentVisualState = 'roll';
    this.setFacing(direction === -1);
    this.rollDirection = direction;
    playOneShot(this.scene, ROLL_SOUND_ID);
    // Gunslinger roll winds up (frames 0..1 held in place by the state machine);
    // sword_master rolls accelerate immediately.
    if (this.isGunslingerMode()) {
      this.setVelocityX(0);
    } else {
      this.setVelocityX(PLAYER_ROLL_SPEED * direction);
    }
    this.playLogical('roll');
  }

  /**
   * @function    startBlock
   * @description Raise the block guard — lock into the block state, stop horizontal motion, and play the block-idle loop; held while RMB is down, ends the frame it releases.
   * @calledby src/entities/Player.ts → updateInner, on a held right-mouse-button while grounded and block is available
   * @calls    the velocity setter and the block-idle playLogical
   */
  private startBlock(): void {
    this.lockedAction = 'block';
    this.currentVisualState = 'block';
    this.setVelocityX(0);
    this.playLogical('block_idle');
  }

  /**
   * @function    findLedgeWall
   * @description Probe for a climbable ledge just past the leading edge: wall at head height with clear air above.
   * @param   wallDirection  Which side the player is pressing into (-1 left / +1 right).
   * @returns a LedgeTrigger (direction, wall top, edge X) when a grabbable ledge is found; null otherwise.
   * @calledby src/entities/Player.ts → updateInner, in the airborne wall-contact branch deciding whether to start a ledge climb
   * @calls    two physics overlap-rect probes (clear air above, solid wall below the head)
   */
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

  /**
   * @function    findGrazingWall
   * @description Check the next-frame predicted position for a ledge edge — catches fast arcs that skip wall contact.
   * @param   direction  Horizontal travel direction (-1 / +1).
   * @returns a LedgeTrigger when the predicted box would clip a grabbable ledge edge; null otherwise.
   * @calledby src/entities/Player.ts → updateInner, in the airborne branch when rising and moving but not yet wall-touching
   * @calls    a physics overlap-rect probe at the integrated next-frame position
   */
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

  /**
   * @function    startClimb
   * @description Lock the climb — zero velocity, disable gravity, face the wall, and snap the body flush onto the ledge.
   * @param   trigger  The LedgeTrigger describing direction, wall top, and edge X.
   * @calledby src/entities/Player.ts → updateInner, when findLedgeWall/findGrazingWall confirms a climbable edge
   * @calls    the ledge-climb playLogical and the inverse body-position math
   */
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

  // ── Animation / visual state ─────────────────────────────────────────────
  /** Direction a dash/roll commits to: pressed A/D if any, else the current facing. */
  private resolveFacingDirection(): 1 | -1 {
    if (this.keyA.isDown && !this.keyD.isDown) return -1;
    if (this.keyD.isDown && !this.keyA.isDown) return 1;
    return this.flipX ? -1 : 1;
  }

  /**
   * @function    updateVisualState
   * @description Set the body's locomotion animation from physics state — pick idle/run/fall/wall_slide and play it, freezing the fall frame on frame 0 while ascending.
   * @calledby src/entities/Player.ts → updateInner, at the end of the free-movement branch
   * @calls    playLogical and the anim pause/resume + setFrame for the rising-fall hold
   */
  private updateVisualState(): void {
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

  /**
   * @function    onAnimationComplete
   * @description Route an animation finishing: advance a queued combo, settle/end block, end dash/roll/hurt locks, freeze death, or re-anchor after a ledge climb.
   * @param   animation  The Phaser animation that just completed.
   * @calledby Phaser ANIMATION_COMPLETE event (registered in the constructor)
   * @calls    scheduleChainedSwing, endLockedAction, the block-idle replay, and the inverse body math after a ledge climb
   */
  private onAnimationComplete(animation: Phaser.Animations.Animation): void {
    const key = animation.key;
    if (ATTACK_KEYS.has(key)) {
      // A chained swing is already queued — hold this frame and let the timer fire.
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

    // Full block strip done = hit-reaction finished: settle to block_idle if still
    // held, else close the block. (block_idle loops, so it never lands here.)
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

  /**
   * @function    onAnimationUpdate
   * @description Per-frame anim hook: fire once-per-play audio triggers, run the teleport appear/hover→fall handoff, and advance a queued combo at the cancel stage.
   * @param   animation  Current Phaser animation.
   * @param   frame      The frame just shown.
   * @calledby Phaser ANIMATION_UPDATE event (registered in the constructor)
   * @calls    src/audio → playOneShot, applyTeleport / endTeleportHoverAndFall, and scheduleChainedSwing
   */
  private onAnimationUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    // Fire data-driven audio triggers once per play; runs before the teleport branch so attack6 isn't skipped.
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
      // Hover phase: hand off to the fall flow at the hover-end frame. The
      // playLogical('fall') inside swaps the anim, so this can't re-enter later.
      if (frame.index >= TELEPORT_HOVER_END_FRAME) {
        this.endTeleportHoverAndFall();
      }
      return;
    }
    // Advance a queued combo at the 'cancel' stage to skip trailing recovery frames.
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

  /**
   * @function    onGunOverlayUpdate
   * @description Gun overlay's per-frame hook: fire once-per-play audio triggers and spawn exactly one projectile at the configured fire frame. No-op outside an active gunslinger attack.
   * @param   animation  Current overlay animation.
   * @param   frame      The frame just shown.
   * @calledby Phaser ANIMATION_UPDATE event on the gun overlay (registered in ensurePlayerGunForMode)
   * @calls    src/audio → playOneShot and src/entities/Player.ts → spawnProjectile
   */
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

  /**
   * @function    onGunOverlayComplete
   * @description End the attack lock when the gun overlay's fire animation finishes. No-op unless this is the active gun's fire overlay.
   * @param   animation  The overlay animation that completed.
   * @calledby Phaser ANIMATION_COMPLETE event on the gun overlay (registered in ensurePlayerGunForMode)
   * @calls    src/entities/Player.ts → endLockedAction
   */
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

  /**
   * @function    applyTeleport
   * @description Blink to just above the nearest enemy and freeze there for the hover (gravity off, velocity zeroed); no-op if the target already died.
   * @calledby src/entities/Player.ts → onAnimationUpdate, once the teleport appear frame is reached
   * @calls    the scene's nearest-enemy query and the position/gravity/velocity setters
   */
  private applyTeleport(): void {
    const scene = this.scene as unknown as NearestEnemyScene;
    const target = scene.getNearestEnemy(this.x, this.y);
    if (target) {
      this.setPosition(target.x, target.y - TELEPORT_HOVER_OFFSET_Y);
    }
    this.body.setAllowGravity(false);
    this.setVelocity(0, 0);
  }

  /**
   * @function    endTeleportHoverAndFall
   * @description End the teleport hover: clear all attack/teleport flags, re-enable gravity, and drop into the fall anim.
   * @calledby src/entities/Player.ts → onAnimationUpdate, at the hover-end frame
   * @calls    cancelChainedSwingTimer and the fall playLogical
   */
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

  /**
   * @function    spawnProjectile
   * @description Spawn a projectile from the visible muzzle toward the cursor and raise a gunshot alert at the player's position.
   * @param   config  The active gun's fire config (mode, speed, damage).
   * @calledby src/entities/Player.ts → onGunOverlayUpdate, on the fire frame during a gunslinger shot
   * @calls    the scene's spawnProjectile and alertEnemiesToGunshot seams
   */
  private spawnProjectile(config: ProjectileFireConfig): void {
    const pointer = this.scene.input.activePointer;
    const cursorX = pointer?.worldX ?? this.x;
    const cursorY = pointer?.worldY ?? this.y;
    const pivotSign = this.flipX ? -1 : 1;
    // Pivot is source-pixel space, so scale it to world space to land on the visible grip.
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
    // Gunfire is loud — alert enemies to the player's position (the firing spot
    // they path toward). Only guns spawn projectiles, so this runs for shots only.
    spawner.alertEnemiesToGunshot(this.x, this.y);
  }

  /**
   * @function    applySwordHits
   * @description Scan the forward hitbox on the strike frames, dealing one-shot-per-enemy sword damage and playing a single impact SFX per swing. Sword swings only.
   * @calledby src/entities/Player.ts → updateInner, in the locked-attack branch
   * @calls    a physics overlap-rect over dynamic bodies, src/entities/Enemy.ts → takeDamage, and the slash one-shot sound
   */
  private applySwordHits(): void {
    if (this.lockedAction !== 'attack') return;
    if (this.isGunslingerMode()) return;
    // Gate hits to the 'strike' frames so the wind-up doesn't connect; anims with
    // no strike stage fall back to every-frame (lets the gate roll out per-anim).
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
    // Swing kind is fixed for the whole swing (resolved in startAttackAnim), so
    // pick the per-hit damage once here rather than per overlapping enemy.
    const swingDamage =
      this.currentAttackKind === 'magic'
        ? SWORD_MAGIC_ATTACK_DAMAGE
        : SWORD_ATTACK_DAMAGE;
    const facing: 1 | -1 = this.flipX ? -1 : 1;
    const hitboxX =
      facing === 1 ? this.x : this.x - SWORD_ATTACK_REACH_X;
    const hitboxY = this.y - SWORD_ATTACK_REACH_Y / 2;
    // Dynamic bodies only — enemies are dynamic; the static tilemap layer is
    // irrelevant to a melee hit.
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
        // Indestructible: the blade clinks off (impact SFX) but the trap
        // survives, so a hazard can't be cleared by swinging at it.
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
      // One impact SFX per swing; overlapping hits (AoE) would muddy the audio.
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

  // ── Resources / stats / pickups ──────────────────────────────────────────
  /** Current hit points (live, not max). */
  getHealth(): number {
    return this.health;
  }

  /** Maximum hit points (fixed). */
  getMaxHealth(): number {
    return PLAYER_MAX_HEALTH;
  }

  /** Current stamina bars (consumed by dashing, regen over time). */
  getStamina(): number {
    return this.stamina;
  }
  /** Maximum stamina bars (fixed). */
  getMaxStamina(): number {
    return MAX_STAMINA;
  }

  /** Current carried magic orbs (spent per magic swing). */
  getMagic(): number {
    return this.magic;
  }
  /**
   * @function    getMaxMagic
   * @description Live magic cap: base plus the uneven per-tier capacity steps of each purchased Orb Pouch tier owned; derived so upgrades survive respawn.
   * @returns the current magic cap.
   * @calledby src/entities/Player.ts → magic clamping on pickup/restore, and src/scenes/gameHud.ts → the HUD reading the live cap
   * @calls    src/state/runProgress.ts → hasUpgrade per Orb Pouch tier
   */
  getMaxMagic(): number {
    let max = BASE_MAX_MAGIC;
    MAGIC_UPGRADE_LEVELS.forEach((levelId, tier) => {
      if (hasUpgrade(upgradeId('magic', levelId))) {
        max += MAGIC_UPGRADE_CAPACITY_STEPS[tier];
      }
    });
    return max;
  }

  /** Current pistol (gun1) ammo. */
  getGun1Ammo(): number {
    return this.gun1Ammo;
  }
  /** Live pistol cap: base plus the Ammo Storage upgrades bought this run (one upgrade raises both guns); derived like getMaxMagic. */
  getMaxGun1Ammo(): number {
    return BASE_MAX_GUN1_AMMO + countUpgrades('ammo') * GUN1_CAPACITY_UPGRADE_STEP;
  }

  /** Current shotgun (gun2) ammo. */
  getGun2Ammo(): number {
    return this.gun2Ammo;
  }
  /** Live shotgun cap: base plus the same Ammo Storage upgrade count as gun1. */
  getMaxGun2Ammo(): number {
    return BASE_MAX_GUN2_AMMO + countUpgrades('ammo') * GUN2_CAPACITY_UPGRADE_STEP;
  }

  /** Current gold coin count. */
  getCoins(): number {
    return this.coins;
  }
  /** Coin HUD digit-budget sentinel (not a real cap — see player constants). */
  getMaxCoins(): number {
    return MAX_COINS;
  }

  /** Current carried healing items. */
  getHealItems(): number {
    return this.healItems;
  }
  /** Maximum carried healing items. */
  getMaxHealItems(): number {
    return MAX_HEAL_ITEMS;
  }

  /**
   * @function    applyRestoredState
   * @description Restore resource fields from a snapshot, clamping each into [0, its live cap], and reset the stamina regen accumulator.
   * @param   state  Snapshot of health, gun1/gun2 ammo, magic, stamina, and optional coins/healItems.
   * @calledby src/scenes/playerSnapshot.ts → save/respawn restoring resources after a checkpoint or HMR reload
   * @calls    the live-cap getters and Phaser's clamp helper
   */
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
    this.gun1Ammo = Phaser.Math.Clamp(state.gun1Ammo, 0, this.getMaxGun1Ammo());
    this.gun2Ammo = Phaser.Math.Clamp(state.gun2Ammo, 0, this.getMaxGun2Ammo());
    this.magic = Phaser.Math.Clamp(state.magic, 0, this.getMaxMagic());
    this.stamina = Phaser.Math.Clamp(state.stamina, 0, MAX_STAMINA);
    this.coins = Phaser.Math.Clamp(state.coins ?? this.coins, 0, MAX_COINS);
    this.healItems = Phaser.Math.Clamp(
      state.healItems ?? this.healItems,
      0,
      MAX_HEAL_ITEMS,
    );
    this.staminaRegenAccumMs = 0;
  }

  /**
   * @function    addPickup
   * @description Grant a pickup's resource clamped at cap; boss keys record an unlock instead of adding a number.
   * @param   kind    The pickup kind.
   * @param   amount  Units to grant; ignored for key kinds.
   * @calledby src/scenes/GameScene.ts → collecting a world pickup, and src/entities/Player.ts → tryPurchase granting a shop resource
   * @calls    the live-cap getters and src/state/runProgress.ts → recordKeyCollected
   */
  addPickup(kind: PickupKind, amount: number): void {
    if (kind === 'gun1') {
      this.gun1Ammo = Math.min(this.getMaxGun1Ammo(), this.gun1Ammo + amount);
    } else if (kind === 'gun2') {
      this.gun2Ammo = Math.min(this.getMaxGun2Ammo(), this.gun2Ammo + amount);
    } else if (kind === 'magic') {
      this.magic = Math.min(this.getMaxMagic(), this.magic + amount);
    } else if (kind === 'heal') {
      this.healItems = Math.min(MAX_HEAL_ITEMS, this.healItems + amount);
    } else if (
      kind === 'key_storms' ||
      kind === 'key_widow' ||
      kind === 'key_heart'
    ) {
      // Record the boss-key unlock (the persistent door-unlock source of truth).
      recordKeyCollected(kind);
    } else {
      this.coins = Math.min(MAX_COINS, this.coins + amount);
    }
  }

  /** Current count for a pickup-kind resource (boss keys alias coins); lets the shop dim rows the buyer is already maxed on. */
  getResourceValue(kind: PickupKind): number {
    if (kind === 'gun1') return this.gun1Ammo;
    if (kind === 'gun2') return this.gun2Ammo;
    if (kind === 'magic') return this.magic;
    if (kind === 'heal') return this.healItems;
    return this.coins;
  }

  /** Cap for a pickup-kind resource (the live derived cap for ammo/magic). */
  getResourceMax(kind: PickupKind): number {
    if (kind === 'gun1') return this.getMaxGun1Ammo();
    if (kind === 'gun2') return this.getMaxGun2Ammo();
    if (kind === 'magic') return this.getMaxMagic();
    if (kind === 'heal') return MAX_HEAL_ITEMS;
    return MAX_COINS;
  }

  /** True if the player can actually benefit from this pickup right now (not at cap). */
  canPickUp(kind: PickupKind): boolean {
    if (kind === 'gun1' || kind === 'gun2' || kind === 'heal') {
      return this.getResourceValue(kind) < this.getResourceMax(kind);
    }
    return true;
  }

  /**
   * @function    tryPurchase
   * @description Atomic shop buy: charge coins and either record an upgrade or grant a resource.
   * @param   item  A ShopItem: an upgrade with an id, or a resource pickup with kind + grant amount + price.
   * @returns true if the purchase went through; false on insufficient coins, an already-owned upgrade, or a maxed resource.
   * @calledby src/ui/ShopOverlay.ts → confirming a buy
   * @calls    src/state/runProgress.ts → recordUpgradePurchased, addPickup, and the resource value/cap getters
   */
  tryPurchase(item: ShopItem): boolean {
    if (this.coins < item.price) return false;
    if (item.kind === 'upgrade') {
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

  /** True if this run owns the given capacity upgrade — lets the shop show an OWNED (sold-out) state, mirroring MAX on a fully-stocked resource. */
  ownsUpgrade(id: string): boolean {
    return hasUpgrade(id);
  }

  /**
   * @function    tryUseHealingItem
   * @description Spend one heal item on Q; refuses mid-action, empty, full, or on cooldown (souls-like discipline).
   * @returns true if a heal was spent; false when locked, on cooldown, out of items, or already at full health.
   * @calledby src/entities/Player.ts → updateInner, on a Q press
   * @calls    the heal one-shot sound and field math on health/items/cooldown
   */
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

  // ── Damage / death ───────────────────────────────────────────────────────
  /** True once the player has entered the dead state. */
  isDead(): boolean {
    return this.lockedAction === 'dead';
  }

  /** True while any locked action owns input — the gate that suspends hold-E so the player can't swing and open a chest at once. */
  isInteractionBlocked(): boolean {
    return this.lockedAction !== null;
  }

  /**
   * @function    hurt
   * @description Apply a hit — block negates a front hit, back-attacks land; deducts health, plays the grunt, applies knockback + i-frames, and enters hurt or dead state. No-op while dead or invulnerable.
   * @param   damage   HP to remove.
   * @param   sourceX  Attacker X, for facing and knockback direction.
   * @param   _sourceY  Unused (kept for the hurt-caller signature).
   * @param   options  Hurt source (melee / projectile), selecting the grunt variant.
   * @calledby src/entities/Enemy.ts and src/scenes/trapSystem.ts / GameScene.ts → an enemy or trap hit landing on the player
   * @calls    the hurt one-shot sound, the velocity setters, enterDeadState on a lethal hit, and the take-hit/block animations
   */
  hurt(
    damage: number,
    sourceX: number,
    _sourceY: number,
    options: PlayerHurtOptions = {},
  ): void {
    if (this.lockedAction === 'dead') return;
    if (this.scene.time.now < this.invulnerableUntil) return;

    // Block negates a front hit (souls-like): facing +1 = looking right, -1 left;
    // a source on the facing side lands on the raised shield.
    if (this.lockedAction === 'block') {
      const facing: 1 | -1 = this.flipX ? -1 : 1;
      const sourceDirection: 1 | -1 = sourceX >= this.x ? 1 : -1;
      if (facing === sourceDirection) {
        // Short i-frame so one swing can't re-fire through the block; play the
        // block-reaction strip (the complete handler settles it back / ends it).
        this.invulnerableUntil = this.scene.time.now + PLAYER_INVULN_MS;
        this.playLogical('block');
        return;
      }
    }

    this.health = Math.max(0, this.health - damage);

    // Grunt on every landed hit (block/invuln already returned); before the
    // fatal check so the killing blow grunts too. Shots use a distinct variant.
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

  /**
   * @function    updateFallDamage
   * @description Track peak descent speed while airborne and apply scaled damage on touchdown past the safe speed.
   * @calledby src/entities/Player.ts → update, after the state machine
   * @calls    applyFallDamage when a hard landing exceeds the safe threshold; resets the peak otherwise
   */
  private updateFallDamage(): void {
    if (
      this.lockedAction === 'dead' ||
      this.flyMode ||
      !this.controlsEnabled ||
      !this.body.allowGravity
    ) {
      this.fallPeakVy = 0;
      return;
    }
    const onGround = this.body.blocked.down || this.body.touching.down;
    if (!onGround) {
      // velocity.y > 0 is downward; max() ignores the rising half of a jump.
      this.fallPeakVy = Math.max(this.fallPeakVy, this.body.velocity.y);
      return;
    }
    const impactVy = this.fallPeakVy;
    this.fallPeakVy = 0;
    if (impactVy <= FALL_DAMAGE_SAFE_SPEED) return;
    const damage = Math.min(
      FALL_DAMAGE_MAX,
      Math.ceil((impactVy - FALL_DAMAGE_SAFE_SPEED) / FALL_DAMAGE_SPEED_PER_HP),
    );
    if (damage > 0) this.applyFallDamage(damage);
  }

  /**
   * @function    applyFallDamage
   * @description Apply landing damage without knockback or block, respecting the existing i-frame window; deducts health, plays the grunt, sets i-frames, and enters hurt or dead state.
   * @param   damage  HP to remove from the hard landing.
   * @calledby src/entities/Player.ts → updateFallDamage, when a landing crosses the damage threshold
   * @calls    the hurt one-shot sound, enterDeadState on a lethal landing, and the take-hit animation
   */
  private applyFallDamage(damage: number): void {
    if (this.scene.time.now < this.invulnerableUntil) return;
    this.health = Math.max(0, this.health - damage);
    playOneShot(this.scene, HURT_SOUND_ID);
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

  /**
   * @function    enterDeadState
   * @description Lock to 'dead', play the death anim + boom SFX, and emit PLAYER_DIED_EVENT for the scene.
   * @calledby src/entities/Player.ts → hurt / applyFallDamage, when health reaches zero
   * @calls    cancelTransientState, the death playLogical, the boom one-shot, and the event emitter (PLAYER_DIED_EVENT)
   */
  private enterDeadState(): void {
    this.cancelTransientState();
    this.lockedAction = 'dead';
    this.currentVisualState = 'idle';
    this.playLogical('death');
    playOneShot(this.scene, UI_BOOM_SOUND_ID);
    this.emit(PLAYER_DIED_EVENT);
  }

  /**
   * @function    cancelTransientState
   * @description Reset all in-flight attack/teleport/projectile flags, re-enable gravity, and silence the wall-slide loop.
   * @calledby src/entities/Player.ts → any interrupt before a new state (hurt, enterDeadState, applyFallDamage, the roll/jump cancel out of an attack)
   * @calls    cancelChainedSwingTimer and the wall-slide state-sound toggle
   */
  private cancelTransientState(): void {
    this.cancelChainedSwingTimer();
    this.queuedAttack = false;
    this.attackCounter = 0;
    this.teleportFired = false;
    this.firedProjectile = false;
    this.firedTriggers.clear();
    this.body.setAllowGravity(true);
    setPlayerStateSoundActive(this.scene, 'wallSlide', false);
  }

  /**
   * @function    endLockedAction
   * @description Release the locked action and combo flags, returning the body to idle — but for a gunslinger shot it only re-idles the overlay, leaving the body's locomotion alone.
   * @calledby src/entities/Player.ts → the animation-complete handlers and any state that finishes a locked action
   * @calls    cancelChainedSwingTimer, the gun overlay idle play, and the idle playLogical
   */
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
    if (wasGunslingerAttack) {
      this.playerGun?.playOverlay('idle');
      return;
    }
    this.currentVisualState = 'idle';
    this.playLogical('idle', { ignoreIfPlaying: true });
  }

  /**
   * @function    applyAnimationAnchor
   * @description Re-anchor origin, scale, and physics body size/offset for the just-started animation, resolved against the current flipX.
   * @param   animation  The animation that just started.
   * @calledby Phaser ANIMATION_START event (registered in the constructor) and src/entities/Player.ts → setFacing on a flip
   * @calls    src/sprites/characterLoader.ts → getSpriteAnchor and the origin/scale/body setters
   */
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
    // Source size already pre-divided by scale (see header) → lands on PHYSICS_BODY.
    this.body.setSize(bodySourceWidth, bodySourceHeight);
    this.body.setOffset(bodyOffsetX, bodyOffsetY);
  }

  /**
   * @function    toggleFlyMode
   * @description Debug: G toggles no-gravity/no-collision WASD flight for panning across LDtk levels, clearing all action/wall-slide state on entry/exit.
   * @calledby src/entities/Player.ts → updateInner, on a G press
   * @calls    cancelChainedSwingTimer, the wall-slide state-sound toggle, and the idle playLogical
   */
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

  /**
   * @function    updateFlyMode
   * @description One frame of 4-directional WASD flight at constant speed — sets velocity, faces travel direction, and plays run while moving or idle while still.
   * @calledby src/entities/Player.ts → updateInner, while fly mode is active
   * @calls    the velocity/facing setters and the run/idle playLogical
   */
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

  // ── Facing + gun rig ─────────────────────────────────────────────────────
  /**
   * @function    setFacing
   * @description Flip the sprite and re-apply the current animation's anchor so the body offset mirrors correctly; no-op if already facing that way.
   * @param   faceLeft  True to face left.
   * @calledby src/entities/Player.ts → movement, dash/roll/climb starts, updateAimFacing, and fly mode; also src/scenes/playerSnapshot.ts → restore
   * @calls    the flip setter and applyAnimationAnchor for the current animation
   */
  setFacing(faceLeft: boolean): void {
    if (this.flipX === faceLeft) return;
    this.setFlipX(faceLeft);
    const currentAnim = this.anims.currentAnim;
    if (currentAnim) {
      this.applyAnimationAnchor(currentAnim);
    }
  }

  /**
   * @function    updateAimFacing
   * @description Gunslinger-only: face the body toward the cursor (even while standing still) so the body's flip never disagrees with the gun overlay's 360-degree aim. No-op outside a gun mode or without a pointer.
   * @calledby src/entities/Player.ts → updateInner, before movement, while in a gun mode
   * @calls    setFacing
   */
  private updateAimFacing(): void {
    if (!this.isGunslingerMode()) return;
    const pointer = this.scene.input.activePointer;
    if (!pointer) return;
    this.setFacing(pointer.worldX < this.x);
  }

  /**
   * @function    ensurePlayerGunForMode
   * @description Create, swap, or destroy the gun overlay to match the current mode (idempotent) — wired for gun modes, gone for sword_master.
   * @calledby src/entities/Player.ts → tryAdvanceMode and setCurrentMode, on every mode change
   * @calls    the PlayerGun constructor + its anim-update/complete listener hookup, src/entities/PlayerGun.ts → setMode, and destroyPlayerGun
   */
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
        // Listeners are torn down automatically when the overlay is destroyed.
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

  /**
   * @function    destroyPlayerGun
   * @description Destroy the gun overlay if present (so it never lingers as an invisible sprite during sword_master play) and null the handle.
   * @calledby src/entities/Player.ts → ensurePlayerGunForMode (switching to sword_master) and the constructor's destroy cleanup
   * @calls    the overlay's destroy; no-ops when no overlay exists
   */
  private destroyPlayerGun(): void {
    if (!this.playerGun) return;
    this.playerGun.destroy();
    this.playerGun = null;
  }

  /**
   * @function    syncGunOverlayForBodyAnim
   * @description Show the gun overlay over gunslinger-body art (re-idling it unless attacking) and hide it otherwise. No-op when no overlay exists.
   * @param   bodyAnimKey  The body animation key just played.
   * @param   _logical     Unused logical key (kept for the call signature).
   * @calledby src/entities/Player.ts → playLogical, after every body animation play
   * @calls    src/sprites/characterLoader.ts → getAnimationSourceMode and the overlay visibility + idle play
   */
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

  /**
   * @function    syncPlayerGun
   * @description Snap the gun overlay to the hand pivot and aim it at the cursor; runs post-physics to avoid trailing the player by a frame. No-op when no overlay exists.
   * @calledby Phaser POST_UPDATE event (registered in the constructor), after physics resolves the player's position
   * @calls    src/entities/PlayerGun.ts → syncToOwner
   */
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
