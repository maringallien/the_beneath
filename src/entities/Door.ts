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

// Proximity-driven door. Default state is the looping door_closed_idle
// (1 frame). When the player enters DOOR_OPEN_RADIUS_PX the door fires
// door_slam and plays the 14-frame door_open one-shot; on ANIMATION_COMPLETE
// it idles on door_open_idle. When the player retreats past
// DOOR_CLOSE_RADIUS_PX the door fires door_slam again and snaps directly
// to door_closed_idle.
//
// The first update tick snaps silently to the state matching the player's
// initial distance, so a save loaded near a door doesn't slam at scene
// start.
//
// Key-locked variant: a door created with a non-null `requiredKey` is locked.
// It ignores proximity entirely (stays closed and solid) and implements
// Interactable so InteractionManager drives a hold-E open. On the completed
// hold it checks the persistent run-progress store: with the matching key it
// unlocks (plays the open swing and from then on behaves like a normal
// proximity door); without it, it emits KEY_DOOR_LOCKED_EVENT so GameScene can
// show the "find the key" message. canInteract() goes false once unlocked so
// the door falls out of the interaction system.
export class Door extends AnimatedEntity implements Interactable {
  private doorState: DoorState = 'closed';
  private initialized = false;
  // The key this door needs, or null for a plain proximity door. Retained even
  // after unlocking so isKeyLocked() stays a stable "this was a key door"
  // predicate for GameScene's registration filter.
  private readonly requiredKey: BossKeyId | null;
  // True while the door is key-locked and not yet opened. Flipped false by
  // unlock(); from then on the door runs the normal proximity state machine.
  private locked: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    requiredKey: BossKeyId | null = null,
  ) {
    super(scene, x, y, DOOR_IDENTIFIER);
    this.requiredKey = requiredKey;
    this.locked = requiredKey !== null;
    // The player↔doors collider's process callback gates on isPassable();
    // setImmovable keeps the player from shoving the closed door out of
    // place during contact.
    this.body.setImmovable(true);

    // Scoped completion listener for door_open only. door_closed_idle and
    // door_open_idle loop and never complete, so the scope is documentation
    // more than necessity.
    const openCompleteEvent = `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${entityAnimFullKey(
      DOOR_IDENTIFIER,
      'door_open',
    )}`;
    this.on(openCompleteEvent, this.onOpenAnimationComplete, this);
  }

  // True when this door was authored as key-locked (regardless of current
  // unlocked state). GameScene uses it to register only key doors with the
  // InteractionManager.
  isKeyLocked(): boolean {
    return this.requiredKey !== null;
  }

  // True when the player↔doors collider should skip collision. A still-locked
  // key door is always solid. Closed = no. Opening = yes once the visible door
  // has swung past DOOR_OPEN_PASSABLE_FRAME (Phaser frame index is 1-based).
  // Open = yes.
  isPassable(): boolean {
    if (this.locked) return false;
    if (this.doorState === 'open') return true;
    if (this.doorState === 'opening') {
      const idx = this.anims.currentFrame?.index ?? 1;
      return idx >= DOOR_OPEN_PASSABLE_FRAME;
    }
    return false;
  }

  update(playerX: number, playerY: number): void {
    // Locked key doors never auto-open — they stay closed and solid until the
    // player completes a hold-E with the matching key (see onInteract/unlock).
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

  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - KEY_DOOR_ICON_ANCHOR_GAP_PX };
  }

  getInteractionRangeSq(): number {
    return KEY_DOOR_INTERACTION_RANGE_SQ;
  }

  // Only a still-locked key door advertises the E prompt. Plain doors and
  // already-unlocked doors return false so they never enter the interaction
  // system's closest-target search.
  canInteract(): boolean {
    return this.requiredKey !== null && this.locked;
  }

  // Fired by InteractionManager when the player completes the hold. With the
  // matching key the door unlocks; without it, signal the scene to show the
  // "find the key" message. The hold itself (0.5s ring) already happened, so
  // this reads as "tried to open it" per the spec.
  onInteract(): void {
    if (this.requiredKey === null || !this.locked) return;
    if (hasKey(this.requiredKey)) {
      this.unlock();
    } else {
      this.scene.events.emit(KEY_DOOR_LOCKED_EVENT);
    }
  }

  // Transition a locked door into the open swing, after which it behaves like a
  // normal proximity door. Sets initialized=true so the next update() tick
  // doesn't snap-reset the state, and reuses door_open + the existing
  // onOpenAnimationComplete handler so the unlock looks identical to a normal
  // open (swing + slam).
  private unlock(): void {
    this.locked = false;
    this.initialized = true;
    this.doorState = 'opening';
    this.playLogical('door_open');
    playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
  }

  private onOpenAnimationComplete(): void {
    if (this.doorState !== 'opening') return;
    this.doorState = 'open';
    this.playLogical('door_open_idle');
  }
}
