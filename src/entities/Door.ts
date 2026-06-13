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

const DOOR_IDENTIFIER = 'Door_spawn';
const DOOR_SLAM_SOUND_ID = 'door_slam';

const DOOR_OPEN_RADIUS_PX = 80;
// Strictly greater than DOOR_OPEN_RADIUS_PX. Without the gap the door
// flickers (and slam-spams) when the player hovers near the boundary.
const DOOR_CLOSE_RADIUS_PX = 140;
const DOOR_OPEN_RADIUS_SQ = DOOR_OPEN_RADIUS_PX * DOOR_OPEN_RADIUS_PX;
const DOOR_CLOSE_RADIUS_SQ = DOOR_CLOSE_RADIUS_PX * DOOR_CLOSE_RADIUS_PX;

// 1-based frame within door_open at which the door becomes passable. Player
// is blocked through the first 7 swing frames so the wall is solid while
// the door is visibly still in the way.
const DOOR_OPEN_PASSABLE_FRAME = 8;

type DoorState = 'closed' | 'opening' | 'open';

/**
 * Door — a proximity-driven door, with an optional key-locked variant.
 *
 * A plain door opens when the player enters DOOR_OPEN_RADIUS_PX (slam + the
 * door_open one-shot, then idles open) and slams shut when they retreat past
 * DOOR_CLOSE_RADIUS_PX. The first update tick snaps silently to the state
 * matching the player's start distance, so a save loaded next to a door doesn't
 * slam at scene start. A door given a non-null `requiredKey` is instead
 * key-locked: it ignores proximity and implements Interactable, so a completed
 * hold-E unlocks it when the matching key is in the run-progress store (after
 * which it behaves like a proximity door) or signals "find the key" when it isn't.
 *
 * Inputs:  scene, spawn x/y, optional requiredKey; per-tick player position.
 * Outputs: drives its own animation + collider passability; plays door_slam and
 *          emits KEY_DOOR_LOCKED_EVENT.
 * @calledby the gameplay scene — spawned at level load, ticked each frame, and
 *           (for key doors) driven by the hold-to-interact system.
 * @calls    the shared audio one-shot player and the entity animation helpers.
 */
export class Door extends AnimatedEntity implements Interactable {
  private doorState: DoorState = 'closed';
  private initialized = false;
  // null for a plain proximity door; retained after unlock so isKeyLocked() stays stable
  private readonly requiredKey: BossKeyId | null;
  // flipped false by unlock(); thereafter the normal proximity machine runs
  private locked: boolean;

  // build a door; non-null requiredKey makes it key-locked
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

  // True when this door was authored as key-locked (even after it unlocks); the
  // scene registers only key doors with the interaction system.
  isKeyLocked(): boolean {
    return this.requiredKey !== null;
  }

  // true when the player may pass through; opening doors become passable at frame 8 of the swing
  isPassable(): boolean {
    if (this.locked) return false;
    if (this.doorState === 'open') return true;
    if (this.doorState === 'opening') {
      const idx = this.anims.currentFrame?.index ?? 1;
      return idx >= DOOR_OPEN_PASSABLE_FRAME;
    }
    return false;
  }

  // proximity state machine: opens when the player is close, slams shut when they retreat
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

  // ── Interactable (key-locked doors only) ────────────────────────────────

  // hold-E prompt icon floats centered above the door's top edge
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - KEY_DOOR_ICON_ANCHOR_GAP_PX };
  }

  // squared distance within which the E prompt is offered
  getInteractionRangeSq(): number {
    return KEY_DOOR_INTERACTION_RANGE_SQ;
  }

  // only a still-locked key door advertises the E prompt
  canInteract(): boolean {
    return this.requiredKey !== null && this.locked;
  }

  // hold-E complete: unlock if the player has the key, else emit the "find the key" event
  onInteract(): void {
    if (this.requiredKey === null || !this.locked) return;
    if (hasKey(this.requiredKey)) {
      this.unlock();
    } else {
      this.scene.events.emit(KEY_DOOR_LOCKED_EVENT);
    }
  }

  // transition to the open swing and let the proximity machine take over from here
  private unlock(): void {
    this.locked = false;
    this.initialized = true;
    this.doorState = 'opening';
    this.playLogical('door_open');
    playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
  }

  // settle onto the open-idle loop once the swing animation completes
  private onOpenAnimationComplete(): void {
    if (this.doorState !== 'opening') return;
    this.doorState = 'open';
    this.playLogical('door_open_idle');
  }
}
