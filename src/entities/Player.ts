import Phaser from 'phaser';
import {
  PLAYER_WALK_SPEED,
  PLAYER_RUN_SPEED,
  PLAYER_SPRINT_SPEED,
  WALK_TO_RUN_MS,
  DOUBLE_TAP_WINDOW_MS,
  PLAYER_JUMP_VELOCITY,
  JUMP_CUT_VELOCITY_MULTIPLIER,
  FALL_BONUS_GRAVITY,
  PLAYER_DASH_SPEED,
  PLAYER_DASH_DURATION_MS,
  PLAYER_ROLL_SPEED,
  WALL_SLIDE_MAX_VY,
  WHEEL_COOLDOWN_MS,
  PROJECTILE_GUN1_SPEED,
  PROJECTILE_GUN2_SPEED,
  PROJECTILE_GUN1_MUZZLE_OFFSET_X,
  PROJECTILE_GUN1_MUZZLE_OFFSET_Y,
  PROJECTILE_GUN2_MUZZLE_OFFSET_X,
  PROJECTILE_GUN2_MUZZLE_OFFSET_Y,
} from '../constants';
import {
  animKey,
  fullKeysForLogical,
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
import type {
  ProjectileDirection,
  ProjectileSpawnOptions,
} from './Projectile';

// Structural interface so Player doesn't need to import GameScene (avoids a
// circular dependency between Player ↔ GameScene).
interface ProjectileSpawnerScene {
  spawnProjectile(options: ProjectileSpawnOptions): void;
}

interface ProjectileFireConfig {
  readonly attackKey: string;
  readonly fireFrame: number;
  readonly speed: number;
  readonly muzzleOffsetX: number;
  readonly muzzleOffsetY: number;
  readonly mode: 'gunslinger_gun1' | 'gunslinger_gun2';
}

const PHYSICS_BODY_WIDTH = 24;
const PHYSICS_BODY_HEIGHT = 40;
const ROLL_ATTACK_STEP = 1;
const ROLL_ATTACK_STOP_FRAME = 4;
const COMBO_FIRST_STEP = 2;
const MAX_COMBO_STEP = 5;
const TELEPORT_ATTACK_STEP = 6;
const TELEPORT_DISTANCE_PX = 150;
const LEFT_MOUSE_BUTTON = 0;

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
const BLOCK_KEYS: ReadonlySet<string> = fullKeysForLogical('block');
const LEDGE_CLIMB_KEYS: ReadonlySet<string> = fullKeysForLogical('ledge_climb');

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
const GUN1_ATTACK1_KEY = requireAnimKey('gunslinger_gun1', 'attack1');
const GUN2_ATTACK1_KEY = requireAnimKey('gunslinger_gun2', 'attack1');

function buildProjectileFireConfigs(): ReadonlyMap<
  'gunslinger_gun1' | 'gunslinger_gun2',
  ProjectileFireConfig
> {
  const map = new Map<
    'gunslinger_gun1' | 'gunslinger_gun2',
    ProjectileFireConfig
  >();
  const gun1Stage = getAnimationStage(GUN1_ATTACK1_KEY, 'fire');
  const gun2Stage = getAnimationStage(GUN2_ATTACK1_KEY, 'fire');
  if (!gun1Stage || !gun2Stage) {
    throw new Error(
      `Missing "fire" stage on gunslinger attack1. gun1=${gun1Stage}, gun2=${gun2Stage}. ` +
        'Did the animation registry get out of sync?',
    );
  }
  map.set('gunslinger_gun1', {
    attackKey: GUN1_ATTACK1_KEY,
    fireFrame: gun1Stage.startFrame,
    speed: PROJECTILE_GUN1_SPEED,
    muzzleOffsetX: PROJECTILE_GUN1_MUZZLE_OFFSET_X,
    muzzleOffsetY: PROJECTILE_GUN1_MUZZLE_OFFSET_Y,
    mode: 'gunslinger_gun1',
  });
  map.set('gunslinger_gun2', {
    attackKey: GUN2_ATTACK1_KEY,
    fireFrame: gun2Stage.startFrame,
    speed: PROJECTILE_GUN2_SPEED,
    muzzleOffsetX: PROJECTILE_GUN2_MUZZLE_OFFSET_X,
    muzzleOffsetY: PROJECTILE_GUN2_MUZZLE_OFFSET_Y,
    mode: 'gunslinger_gun2',
  });
  return map;
}

type AttackKind = 'regular' | 'magic';

type PlayerVisualState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'fall'
  | 'attack'
  | 'dash'
  | 'roll'
  | 'block'
  | 'wall_slide'
  | 'climb';
type SpeedTier = 'walk' | 'run' | 'sprint';
type MoveDirection = -1 | 0 | 1;
type LockedAction = 'attack' | 'dash' | 'roll' | 'block' | 'climb' | null;
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
  private readonly keyShift: Phaser.Input.Keyboard.Key;
  private readonly keySpace: Phaser.Input.Keyboard.Key;
  private readonly teleportAppearStartFrame: number;
  private readonly projectileFireConfigs: ReadonlyMap<
    'gunslinger_gun1' | 'gunslinger_gun2',
    ProjectileFireConfig
  >;
  private currentMode: CharacterModeId = 'sword_master';
  private currentVisualState: PlayerVisualState = 'idle';
  private lockedAction: LockedAction = null;
  private attackCounter = 0;
  private queuedAttack = false;
  private teleportFired = false;
  private firedProjectile = false;
  private magicMode = false;
  private currentAttackKind: AttackKind = 'regular';
  private moveDirection: MoveDirection = 0;
  private moveStartMs: number | null = null;
  private lastTapAMs: number | null = null;
  private lastTapDMs: number | null = null;
  private sprintHoldDirection: MoveDirection = 0;
  private wasRightDown = false;
  private wallSlideDirection: MoveDirection = 0;
  private wheelCooldownUntil = 0;
  private readonly attackPointerHandler: PointerHandler;
  private readonly wheelHandler: WheelHandler;

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
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

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
      if (pointer.button === LEFT_MOUSE_BUTTON) {
        this.handleAttackInput();
      }
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.attackPointerHandler);

    this.wheelHandler = (_pointer, _over, _dx, dy) => {
      if (dy === 0) return;
      if (this.scene.time.now < this.wheelCooldownUntil) return;
      // Browser convention: wheel-up scrolls the page upward => deltaY < 0.
      // The user's spec is "scroll up advances the sequence".
      this.tryAdvanceMode(dy < 0 ? 1 : -1);
    };
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.wheelHandler);

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off(
        Phaser.Input.Events.POINTER_DOWN,
        this.attackPointerHandler,
      );
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.wheelHandler);
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

  update(): void {
    const rightDown = this.scene.input.activePointer.rightButtonDown();
    const rightJustPressed = rightDown && !this.wasRightDown;
    this.wasRightDown = rightDown;

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
        if (this.isRollAttackInProgress()) {
          const frame = this.anims.currentFrame;
          if (frame && frame.index >= ROLL_ATTACK_STOP_FRAME) {
            this.setVelocityX(0);
          }
        } else {
          this.setVelocityX(0);
        }
      } else if (this.lockedAction === 'block') {
        if (!rightDown) {
          this.endLockedAction();
        } else {
          this.setVelocityX(0);
        }
      }
      this.moveDirection = 0;
      this.moveStartMs = null;
      this.sprintHoldDirection = 0;
      return;
    }

    const onFloor = this.body.blocked.down || this.body.touching.down;

    if (
      rightJustPressed &&
      onFloor &&
      isActionAvailable(this.currentMode, 'block')
    ) {
      this.startBlock();
      return;
    }

    if (
      Phaser.Input.Keyboard.JustDown(this.keyShift) &&
      isActionAvailable(this.currentMode, 'dash')
    ) {
      this.startDash();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyS) && onFloor) {
      this.startRoll();
      return;
    }

    this.updateSprintIntent();

    let inputDirection: MoveDirection = 0;
    if (this.keyA.isDown && !this.keyD.isDown) inputDirection = -1;
    else if (this.keyD.isDown && !this.keyA.isDown) inputDirection = 1;

    if (inputDirection === 0) {
      this.moveDirection = 0;
      this.moveStartMs = null;
      this.setVelocityX(0);
    } else {
      if (inputDirection !== this.moveDirection) {
        this.moveDirection = inputDirection;
        this.moveStartMs = this.scene.time.now;
      }
      const speed = this.getSpeedForTier(this.getCurrentSpeedTier());
      this.setVelocityX(speed * inputDirection);
      this.setFacing(inputDirection === -1);
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
    this.applyModeChangeAnimation();
    if (wasOnFloor) {
      const newY =
        prevBodyBottom +
        this.displayOriginY -
        this.body.offset.y -
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
      case 'walk':
        return 'walk';
      case 'run':
        return 'run';
      case 'sprint':
        return 'sprint';
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
      const playArgs: Phaser.Types.Animations.PlayAnimationConfig = { key };
      if (options.repeat !== undefined) playArgs.repeat = options.repeat;
      if (options.duration !== undefined) playArgs.duration = options.duration;
      this.play(playArgs, ignoreIfPlaying);
    } else {
      this.play(key, ignoreIfPlaying);
    }
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

    const onFloor = this.body.blocked.down || this.body.touching.down;
    // Sword-master attacks are ground-only. Gunslinger fires from anywhere
    // (idle, moving, jumping, falling).
    if (!onFloor && !this.isGunslingerMode()) {
      return;
    }

    if (this.keySpace.isDown) {
      // Teleport-attack is sword_master-only — gunslinger has no attack6.
      if (this.currentMode !== 'sword_master') return;
      this.attackCounter = TELEPORT_ATTACK_STEP;
      this.currentAttackKind = 'regular';
      this.startAttackAnim(this.attackCounter);
      return;
    }

    this.attackCounter = this.getFirstComboStep();
    this.currentAttackKind = this.magicMode ? 'magic' : 'regular';
    this.startAttackAnim(this.attackCounter);
  }

  private getFirstComboStep(): number {
    return this.currentMode === 'sword_master' ? COMBO_FIRST_STEP : 1;
  }

  private getMaxComboStep(): number {
    return this.currentMode === 'sword_master' ? MAX_COMBO_STEP : 1;
  }

  private startAttackAnim(step: number): void {
    this.lockedAction = 'attack';
    this.currentVisualState = 'attack';
    // Roll-attack carries momentum from the roll. Gunslinger fires while
    // moving/jumping, so its velocity must persist. All other attacks
    // freeze the player in place.
    if (step !== ROLL_ATTACK_STEP && !this.isGunslingerMode()) {
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
  }

  private startRoll(): void {
    const direction = this.resolveFacingDirection();
    this.lockedAction = 'roll';
    this.currentVisualState = 'roll';
    this.setFacing(direction === -1);
    this.setVelocityX(PLAYER_ROLL_SPEED * direction);
    this.playLogical('roll');
  }

  private startBlock(): void {
    this.lockedAction = 'block';
    this.currentVisualState = 'block';
    this.setVelocityX(0);
    this.playLogical('block', { repeat: 0 });
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
    const newSpriteY =
      targetBodyTop + this.displayOriginY - this.body.offset.y;
    this.setPosition(newSpriteX, newSpriteY);
  }

  private resolveFacingDirection(): 1 | -1 {
    if (this.keyA.isDown && !this.keyD.isDown) return -1;
    if (this.keyD.isDown && !this.keyA.isDown) return 1;
    return this.flipX ? -1 : 1;
  }

  private updateVisualState(): void {
    // Gunslinger attack is a movement-tolerant overlay — keep the firing
    // animation playing instead of letting walk/run/idle/fall transitions
    // clobber it.
    if (this.lockedAction === 'attack' && this.isGunslingerMode()) {
      return;
    }
    const onFloor = this.body.blocked.down || this.body.touching.down;
    const vx = this.body.velocity.x;
    const vy = this.body.velocity.y;

    let next: 'idle' | 'walk' | 'run' | 'sprint' | 'fall' | 'wall_slide';
    if (!onFloor) {
      next = this.wallSlideDirection !== 0 ? 'wall_slide' : 'fall';
    } else if (vx !== 0) {
      next = this.getCurrentSpeedTier();
    } else {
      next = 'idle';
    }

    if (next === this.currentVisualState && next !== 'fall') {
      return;
    }
    const previousState = this.currentVisualState;
    this.currentVisualState = next;

    switch (next) {
      case 'idle':
        this.playLogical('idle', { ignoreIfPlaying: true });
        break;
      case 'walk':
        this.playLogical('walk', { ignoreIfPlaying: true });
        break;
      case 'run':
        this.playLogical('run', { ignoreIfPlaying: true });
        break;
      case 'sprint':
        this.playLogical('sprint', { ignoreIfPlaying: true });
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

    // Gunslinger's wall_slide reuses the `fall` Phaser animation, so playing
    // the same key with ignoreIfPlaying:true won't fire ANIMATION_START and
    // the per-state anchor override in applyAnimationAnchor doesn't refresh
    // automatically. Force a refresh whenever entering or leaving wall_slide.
    if (
      previousState !== next &&
      (previousState === 'wall_slide' || next === 'wall_slide') &&
      this.isGunslingerMode()
    ) {
      const currentAnim = this.anims.currentAnim;
      if (currentAnim) {
        this.applyAnimationAnchor(currentAnim);
      }
    }
  }

  private updateSprintIntent(): void {
    const now = this.scene.time.now;
    if (Phaser.Input.Keyboard.JustDown(this.keyA)) {
      const last = this.lastTapAMs;
      this.sprintHoldDirection =
        last !== null && now - last < DOUBLE_TAP_WINDOW_MS ? -1 : 0;
      this.lastTapAMs = now;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyD)) {
      const last = this.lastTapDMs;
      this.sprintHoldDirection =
        last !== null && now - last < DOUBLE_TAP_WINDOW_MS ? 1 : 0;
      this.lastTapDMs = now;
    }
    if (this.sprintHoldDirection === -1 && !this.keyA.isDown) {
      this.sprintHoldDirection = 0;
    }
    if (this.sprintHoldDirection === 1 && !this.keyD.isDown) {
      this.sprintHoldDirection = 0;
    }
  }

  private getCurrentSpeedTier(): SpeedTier {
    if (this.moveDirection === 0 || this.moveStartMs === null) return 'walk';
    if (this.sprintHoldDirection === this.moveDirection) return 'sprint';
    const elapsed = this.scene.time.now - this.moveStartMs;
    if (elapsed >= WALK_TO_RUN_MS) return 'run';
    return 'walk';
  }

  private getSpeedForTier(tier: SpeedTier): number {
    switch (tier) {
      case 'walk':
        return PLAYER_WALK_SPEED;
      case 'run':
        return PLAYER_RUN_SPEED;
      case 'sprint':
        return PLAYER_SPRINT_SPEED;
    }
  }

  private onAnimationComplete(animation: Phaser.Animations.Animation): void {
    const key = animation.key;
    if (ATTACK_KEYS.has(key)) {
      if (this.queuedAttack && this.attackCounter < this.getMaxComboStep()) {
        this.queuedAttack = false;
        this.attackCounter += 1;
        this.startAttackAnim(this.attackCounter);
        return;
      }
      this.endLockedAction();
      return;
    }

    if (DASH_KEYS.has(key) || ROLL_KEYS.has(key) || BLOCK_KEYS.has(key)) {
      this.endLockedAction();
      return;
    }

    if (LEDGE_CLIMB_KEYS.has(key)) {
      const targetBodyBottom = this.body.bottom;
      this.body.setAllowGravity(true);
      this.endLockedAction();
      const targetBodyTop = targetBodyBottom - PHYSICS_BODY_HEIGHT;
      const newSpriteY =
        targetBodyTop + this.displayOriginY - this.body.offset.y;
      this.setPosition(this.x, newSpriteY);
    }
  }

  private onAnimationUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    if (animation.key === TELEPORT_ANIM_KEY) {
      if (this.teleportFired) return;
      if (frame.index < this.teleportAppearStartFrame) return;
      this.applyTeleport();
      this.teleportFired = true;
      return;
    }
    if (this.firedProjectile) return;
    if (this.lockedAction !== 'attack') return;
    if (
      this.currentMode !== 'gunslinger_gun1' &&
      this.currentMode !== 'gunslinger_gun2'
    ) {
      return;
    }
    const config = this.projectileFireConfigs.get(this.currentMode);
    if (!config) return;
    if (animation.key !== config.attackKey) return;
    if (frame.index < config.fireFrame) return;
    this.spawnProjectile(config);
    this.firedProjectile = true;
  }

  private applyTeleport(): void {
    const direction = this.flipX ? -1 : 1;
    this.x += TELEPORT_DISTANCE_PX * direction;
  }

  private spawnProjectile(config: ProjectileFireConfig): void {
    const direction: ProjectileDirection = this.flipX ? -1 : 1;
    const spawnX = this.x + config.muzzleOffsetX * direction;
    const spawnY = this.y + config.muzzleOffsetY;
    const spawner = this.scene as unknown as ProjectileSpawnerScene;
    spawner.spawnProjectile({
      x: spawnX,
      y: spawnY,
      mode: config.mode,
      direction,
      speed: config.speed,
    });
  }

  private endLockedAction(): void {
    this.lockedAction = null;
    this.queuedAttack = false;
    this.attackCounter = 0;
    this.teleportFired = false;
    this.firedProjectile = false;
    this.currentVisualState = 'idle';
    this.playLogical('idle', { ignoreIfPlaying: true });
  }

  private applyAnimationAnchor(animation: Phaser.Animations.Animation): void {
    let { originX, originY, bodyOffsetX, bodyOffsetY } = getSpriteAnchor(
      animation.key,
      PHYSICS_BODY_WIDTH,
      PHYSICS_BODY_HEIGHT,
      this.flipX,
    );
    // Gunslinger has no dedicated wall-slide art and falls back to the `fall`
    // animation, which renders the character centered in a 48 px frame —
    // leaving a ~6 px gap between the visible torso and the wall. Re-anchor
    // on the torso's wall-side edge (frame x≈18 unflipped) so body.right
    // (right wall) or body.left (left wall) sits flush against the character.
    if (this.currentVisualState === 'wall_slide' && this.isGunslingerMode()) {
      const frame = animation.frames[0]?.frame;
      const frameWidth = frame?.width ?? 48;
      const wallSlideAx = 18;
      const effectiveAx = this.flipX ? frameWidth - wallSlideAx : wallSlideAx;
      originX = effectiveAx / frameWidth;
      bodyOffsetX = effectiveAx - PHYSICS_BODY_WIDTH / 2;
    }
    this.setOrigin(originX, originY);
    this.body.setOffset(bodyOffsetX, bodyOffsetY);
  }

  private setFacing(faceLeft: boolean): void {
    if (this.flipX === faceLeft) return;
    this.setFlipX(faceLeft);
    const currentAnim = this.anims.currentAnim;
    if (currentAnim) {
      this.applyAnimationAnchor(currentAnim);
    }
  }
}
