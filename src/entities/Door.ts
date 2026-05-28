import Phaser from 'phaser';
import { playOneShot } from '../audio';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';

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
export class Door extends AnimatedEntity {
  private doorState: DoorState = 'closed';
  private initialized = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, DOOR_IDENTIFIER);
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

  // True when the player↔doors collider should skip collision. Closed = no.
  // Opening = yes once the visible door has swung past
  // DOOR_OPEN_PASSABLE_FRAME (Phaser frame index is 1-based). Open = yes.
  isPassable(): boolean {
    if (this.doorState === 'open') return true;
    if (this.doorState === 'opening') {
      const idx = this.anims.currentFrame?.index ?? 1;
      return idx >= DOOR_OPEN_PASSABLE_FRAME;
    }
    return false;
  }

  update(playerX: number, playerY: number): void {
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

  private onOpenAnimationComplete(): void {
    if (this.doorState !== 'opening') return;
    this.doorState = 'open';
    this.playLogical('door_open_idle');
  }
}
