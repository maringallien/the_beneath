import Phaser from 'phaser';
import { playOneShot } from '../audio';
import {
  KEY_DOOR_ICON_ANCHOR_GAP_PX,
  KEY_DOOR_INTERACTION_RANGE_SQ,
  KEY_DOOR_LOCKED_EVENT,
} from '../constants';
import { hasKey, type BossKeyId } from '../state/runProgress';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';

// ── Identity & audio ───────────────────────────────────────────────────────
const DOOR_IDENTIFIER = 'Door_spawn';
const DOOR_SLAM_SOUND_ID = 'door_slam';

// ── Proximity hysteresis ───────────────────────────────────────────────────
// Open inside the inner radius, slam shut outside the (strictly larger) outer one; the
// gap is hysteresis so a player hovering near the boundary doesn't flicker / slam-spam.
const DOOR_OPEN_RADIUS_PX = 80;
const DOOR_CLOSE_RADIUS_PX = 140;
const DOOR_OPEN_RADIUS_SQ = DOOR_OPEN_RADIUS_PX * DOOR_OPEN_RADIUS_PX;
const DOOR_CLOSE_RADIUS_SQ = DOOR_CLOSE_RADIUS_PX * DOOR_CLOSE_RADIUS_PX;

// 1-based frame within door_open at which the door becomes passable. Player
// is blocked through the first 7 swing frames so the wall is solid while
// the door is visibly still in the way.
const DOOR_OPEN_PASSABLE_FRAME = 8;

type DoorState = 'closed' | 'opening' | 'open';

/**
 * @file entities/Door.ts
 * @description Proximity door with an optional key-locked variant. A plain door opens when the player enters DOOR_OPEN_RADIUS_PX (slam + door_open one-shot, then idles open) and slams shut when they retreat past DOOR_CLOSE_RADIUS_PX; the first update tick snaps silently to the state matching the player's start distance, so a save loaded next to a door doesn't slam at scene start. A door given a non-null requiredKey is instead key-locked: it ignores proximity and implements Interactable, so a completed hold-E unlocks it when the matching key is in the run-progress store (after which it behaves like a proximity door) or signals "find the key" when it isn't.
 * @module entities
 */
export class Door extends AnimatedEntity implements Interactable {
  private doorState: DoorState = 'closed';
  private initialized = false;
  // null for a plain proximity door; retained after unlock so isKeyLocked() stays stable
  private readonly requiredKey: BossKeyId | null;
  // flipped false by unlock(); thereafter the normal proximity machine runs
  private locked: boolean;

  /**
   * @function    constructor
   * @description Build a door; a non-null requiredKey makes it key-locked. The result is immovable and wired to settle on the open-idle loop when its open swing completes.
   * @param   x, y         Spawn position (world px).
   * @param   requiredKey  BossKeyId for a key-locked door, or null for a plain proximity door.
   * @calledby src/entities/EntityFactory.ts → the Door_spawn factory during a level's spawn walk
   * @calls    the AnimatedEntity base setup and the Phaser ANIMATION_COMPLETE_KEY hook for the open swing
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    requiredKey: BossKeyId | null = null,
  ) {
    super(scene, x, y, DOOR_IDENTIFIER);
    this.requiredKey = requiredKey;
    this.locked = requiredKey !== null;
    // immovable so the player can't shove the door during contact
    this.body.setImmovable(true);

    const openCompleteEvent = `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${entityAnimFullKey(
      DOOR_IDENTIFIER,
      'door_open',
    )}`;
    this.on(openCompleteEvent, this.onOpenAnimationComplete, this);
  }

  /** True when this door was authored as key-locked (even after it unlocks); the scene registers only key doors with the interaction system. */
  isKeyLocked(): boolean {
    return this.requiredKey !== null;
  }

  /**
   * @function    isPassable
   * @description True when the player may pass through; an opening door becomes passable at frame 8 of the swing, so the wall stays solid while the door is visibly still in the way.
   * @returns whether the collider should let the player (or projectiles) through.
   * @calledby src/scenes/GameScene.ts → the player/enemy/projectile-vs-door collider process callbacks each frame
   * @calls    the current-animation frame index lookup only
   */
  isPassable(): boolean {
    if (this.locked) return false;
    if (this.doorState === 'open') return true;
    if (this.doorState === 'opening') {
      const idx = this.anims.currentFrame?.index ?? 1;
      return idx >= DOOR_OPEN_PASSABLE_FRAME;
    }
    return false;
  }

  /**
   * @function    update
   * @description Proximity state machine — opens when the player is close, slams shut when they retreat; the first tick snaps silently to the state matching the player's start distance (no slam on load). No-op on a still-locked key door.
   * @param   playerX, playerY  The player's world position this frame.
   * @calledby Phaser per-frame update loop (via src/scenes/GameScene.ts → its door-update pass, for each unlocked door)
   * @calls    src/entities/AnimatedEntity.ts → playLogical and src/audio → playOneShot for slams
   */
  update(playerX: number, playerY: number): void {
    if (this.locked) return;

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const distSq = dx * dx + dy * dy;

    if (!this.initialized) {
      this.initialized = true;
      if (distSq <= DOOR_OPEN_RADIUS_SQ) {
        this.doorState = 'open';
        this.playLogical('door_open_idle');
      }
      return;
    }

    if (this.doorState === 'closed') {
      if (distSq <= DOOR_OPEN_RADIUS_SQ) {
        this.doorState = 'opening';
        this.playLogical('door_open');
        playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
      }
      return;
    }

    if (distSq >= DOOR_CLOSE_RADIUS_SQ) {
      this.doorState = 'closed';
      this.playLogical('door_closed_idle');
      playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
    }
  }

  // ── Interactable (key-locked doors only) ─────────────────────────────────

  /** Hold-E prompt icon floats centered above the door's top edge. */
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - KEY_DOOR_ICON_ANCHOR_GAP_PX };
  }

  /** Squared distance within which the E prompt is offered. */
  getInteractionRangeSq(): number {
    return KEY_DOOR_INTERACTION_RANGE_SQ;
  }

  /** Only a still-locked key door advertises the E prompt. */
  canInteract(): boolean {
    return this.requiredKey !== null && this.locked;
  }

  /**
   * @function    onInteract
   * @description Hold-E complete: unlock if the player has the matching key, else emit the "find the key" event for the HUD to surface.
   * @calledby src/entities/InteractionManager.ts → update, when the player completes a hold on a still-locked key door
   * @calls    src/state/runProgress.ts → hasKey, the unlock transition, and the scene event bus (KEY_DOOR_LOCKED_EVENT)
   */
  onInteract(): void {
    if (this.requiredKey === null || !this.locked) return;
    if (hasKey(this.requiredKey)) {
      this.unlock();
    } else {
      this.scene.events.emit(KEY_DOOR_LOCKED_EVENT);
    }
  }

  /**
   * @function    unlock
   * @description Transition a key door into the open swing and hand control to the proximity machine from here on (clears the locked flag, plays the open swing, and slams).
   * @calledby src/entities/Door.ts → onInteract, on a successful key check from a completed hold-E
   * @calls    src/entities/AnimatedEntity.ts → playLogical and src/audio → playOneShot for the slam
   */
  private unlock(): void {
    this.locked = false;
    this.initialized = true;
    this.doorState = 'opening';
    this.playLogical('door_open');
    playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
  }

  /**
   * @function    onOpenAnimationComplete
   * @description Settle onto the open-idle loop once the open swing finishes; no-ops unless the door is still in the opening state.
   * @calledby Phaser door_open ANIMATION_COMPLETE_KEY event (registered in the constructor)
   * @calls    src/entities/AnimatedEntity.ts → playLogical for the open-idle loop
   */
  private onOpenAnimationComplete(): void {
    if (this.doorState !== 'opening') return;
    this.doorState = 'open';
    this.playLogical('door_open_idle');
  }
}
