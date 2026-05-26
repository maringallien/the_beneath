import Phaser from 'phaser';
import { playOneShot } from '../audio';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';

const DOOR_OPEN_RADIUS_PX = 80;
// Strictly greater than DOOR_OPEN_RADIUS_PX to give hysteresis — without
// the gap, the door would flicker open/closed (and slam-spam) when the
// player hovers near the boundary.
const DOOR_CLOSE_RADIUS_PX = 140;
const DOOR_OPEN_RADIUS_SQ = DOOR_OPEN_RADIUS_PX * DOOR_OPEN_RADIUS_PX;
const DOOR_CLOSE_RADIUS_SQ = DOOR_CLOSE_RADIUS_PX * DOOR_CLOSE_RADIUS_PX;
const DOOR_SLAM_SOUND_ID = 'door_slam';
const DOOR_IDENTIFIER = 'Door_spawn';
const DOOR_ANIM_KEY = 'door_open_idle';

// Frame offsets counted from the end of the door_open_idle clip.
// -2 = second-to-last frame (open pose), -1 = last frame (closed pose).
const OPEN_FRAME_FROM_END = -2;
const CLOSED_FRAME_FROM_END = -1;

// Proximity-driven door. The door_open_idle clip is treated as a one-shot
// transition between two end-of-clip poses: the second-to-last frame is
// the "open" pose used when the player is near, and the last frame is
// the "closed" pose used when the player is outside the close radius.
// Each open↔closed transition replays the clip from frame 0 and freezes
// it on the target pose, and also fires the door slam SFX.
//
// First update silently snaps to whichever pose the player's current
// distance implies (no animation play), so a door spawned next to the
// player at scene start doesn't slam or animate immediately.
export class Door extends AnimatedEntity {
  private isOpen = false;
  private initialized = false;
  private readonly fullAnimKey: string;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, DOOR_IDENTIFIER);
    this.fullAnimKey = entityAnimFullKey(DOOR_IDENTIFIER, DOOR_ANIM_KEY);
    // The player↔doors collider (registered in GameScene) treats the door as
    // a wall when closed. Immovable keeps the player from shoving the door
    // out of place during contact.
    this.body.setImmovable(true);
    // AnimatedEntity kicks off the clip with a random progress offset for
    // visual variety. For a door driven by proximity that's noise — halt
    // it on the closed pose until the first update() resolves real state.
    this.snapToPose(CLOSED_FRAME_FROM_END);
  }

  // True when the door is fully open and the player should pass through.
  // GameScene's player↔doors collider uses this as its process callback so
  // the collision is skipped only while the door is open.
  isPassable(): boolean {
    return this.isOpen;
  }

  update(playerX: number, playerY: number): void {
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const distSq = dx * dx + dy * dy;

    if (!this.initialized) {
      this.isOpen = distSq <= DOOR_OPEN_RADIUS_SQ;
      this.initialized = true;
      this.snapToPose(
        this.isOpen ? OPEN_FRAME_FROM_END : CLOSED_FRAME_FROM_END,
      );
      return;
    }

    if (this.isOpen && distSq >= DOOR_CLOSE_RADIUS_SQ) {
      this.isOpen = false;
      playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
      this.playToPose(CLOSED_FRAME_FROM_END);
    } else if (!this.isOpen && distSq <= DOOR_OPEN_RADIUS_SQ) {
      this.isOpen = true;
      playOneShot(this.scene, DOOR_SLAM_SOUND_ID);
      this.playToPose(OPEN_FRAME_FROM_END);
    }
  }

  // Jumps the sprite directly to the target pose with no animation play.
  // Used on construction and first update so the door doesn't visibly
  // animate when the scene loads.
  private snapToPose(offsetFromEnd: number): void {
    const targetFrame = this.poseFrame(offsetFromEnd);
    if (!targetFrame) return;
    this.anims.stop();
    this.anims.setCurrentFrame(targetFrame);
  }

  // Replays the clip from frame 0 and freezes it on the target pose.
  // Used on open↔closed transitions so the door visibly animates between
  // the two states.
  private playToPose(offsetFromEnd: number): void {
    const targetFrame = this.poseFrame(offsetFromEnd);
    if (!targetFrame) return;
    this.play(this.fullAnimKey);
    this.anims.stopOnFrame(targetFrame);
  }

  private poseFrame(
    offsetFromEnd: number,
  ): Phaser.Animations.AnimationFrame | null {
    const anim = this.scene.anims.get(this.fullAnimKey);
    if (!anim) return null;
    const index = anim.frames.length + offsetFromEnd;
    return anim.frames[index] ?? null;
  }
}
