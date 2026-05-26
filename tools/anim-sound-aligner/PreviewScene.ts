import Phaser from 'phaser';
import {
  DEFAULT_CHARACTER_FPS,
  preloadAllCharacters,
  preloadAllEntities,
  registerAllCharacterAnimations,
  registerAllEntityAnimations,
  type AnimationListing,
} from '../../src/sprites/characterLoader';

// Frame indices are exposed 1-based to match the rest of the project (see
// Phaser's AnimationFrame.index convention and swordMaster.json
// stages.*.startFrame). Phaser's `setCurrentFrame` and frame indexing in
// `anims.currentAnim.frames` are 0-based internally, so all conversion
// lives in this file.
function toOneBased(zeroBased: number): number {
  return zeroBased + 1;
}
function toZeroBased(oneBased: number): number {
  return Math.max(0, oneBased - 1);
}

export interface PreviewSceneCallbacks {
  readonly onFrameChange: (frameIndexOneBased: number) => void;
  // Fired when a loop-iteration of the in-tool playback completes. The
  // Playback engine listens to re-trigger audio in lockstep with the next
  // iteration's start.
  readonly onLoopRestart: () => void;
}

export interface PreviewSceneOptions {
  readonly width: number;
  readonly height: number;
  readonly initialZoom: number;
  readonly callbacks: PreviewSceneCallbacks;
  readonly onReady?: () => void;
}

export class PreviewScene extends Phaser.Scene {
  private readonly callbacks: PreviewSceneCallbacks;
  private readonly initialZoom: number;
  private readonly onReady?: () => void;
  private currentListing: AnimationListing | null = null;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;
  private listingByKey: Map<string, AnimationListing> = new Map();
  // Track frame index emissions so we don't fire onFrameChange for the
  // same frame more than once per loop iteration.
  private lastEmittedFrame: number = -1;
  private playing: boolean = false;

  constructor(opts: PreviewSceneOptions) {
    super('PreviewScene');
    this.callbacks = opts.callbacks;
    this.initialZoom = opts.initialZoom;
    this.onReady = opts.onReady;
  }

  preload(): void {
    preloadAllCharacters(this);
    preloadAllEntities(this);
  }

  create(): void {
    registerAllCharacterAnimations(this, { defaultFps: DEFAULT_CHARACTER_FPS });
    registerAllEntityAnimations(this, { defaultFps: DEFAULT_CHARACTER_FPS });
    this.cameras.main.setBackgroundColor('#1e1e1e');
    this.cameras.main.centerOn(0, 0);
    this.cameras.main.setZoom(this.initialZoom);

    this.gridGraphics = this.add.graphics();
    this.gridGraphics.setDepth(0);
    this.drawCheckerboard();

    this.onReady?.();
  }

  setListings(listings: ReadonlyArray<AnimationListing>): void {
    this.listingByKey = new Map(listings.map((l) => [l.fullKey, l]));
  }

  setZoom(zoom: number): void {
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(0, 0);
  }

  selectAnimation(fullKey: string | null): void {
    if (fullKey === null) {
      this.disposeSprite();
      this.currentListing = null;
      this.lastEmittedFrame = -1;
      return;
    }
    const listing = this.listingByKey.get(fullKey);
    if (!listing) return;
    if (this.currentListing?.fullKey === fullKey) {
      // Re-select same anim: rewind so the user gets a clean playback.
      this.seekTo(1);
      return;
    }
    this.disposeSprite();
    this.currentListing = listing;
    const sprite = this.add.sprite(0, 0, listing.fullKey);
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(2);
    sprite.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimUpdate,
      this,
    );
    sprite.on(
      Phaser.Animations.Events.ANIMATION_REPEAT,
      this.onAnimRepeat,
      this,
    );
    this.sprite = sprite;
    // Stage on frame 0 (zero-based) without playing yet; Playback drives
    // the actual play() / pause() lifecycle.
    sprite.anims.play({ key: listing.fullKey, repeat: -1 });
    sprite.anims.pause();
    this.playing = false;
    this.lastEmittedFrame = -1;
    this.emitFrame(1);
  }

  // Forces loop playback so the user can iterate on alignment without
  // restarting. Audio side is restarted from the Playback engine when
  // onLoopRestart fires (raised from the ANIMATION_REPEAT handler).
  play(): void {
    if (!this.sprite || !this.currentListing) return;
    if (this.playing) return;
    this.sprite.anims.resume();
    this.playing = true;
  }

  pause(): void {
    if (!this.sprite) return;
    if (!this.playing) return;
    this.sprite.anims.pause();
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  // 1-based frame index. Clamps to the current animation's frame count.
  seekTo(frameIndexOneBased: number): void {
    const listing = this.currentListing;
    const sprite = this.sprite;
    if (!listing || !sprite) return;
    const frameCount = listing.anim.frames.frameCount;
    const clamped = Math.max(1, Math.min(frameCount, frameIndexOneBased));
    const zb = toZeroBased(clamped);
    const anim = sprite.anims.currentAnim;
    if (anim && anim.frames[zb]) {
      sprite.anims.pause();
      this.playing = false;
      sprite.anims.setCurrentFrame(anim.frames[zb]);
      this.emitFrame(clamped);
    }
  }

  stepFrame(delta: 1 | -1): void {
    const listing = this.currentListing;
    const sprite = this.sprite;
    if (!listing || !sprite) return;
    const cur = sprite.anims.currentFrame
      ? toOneBased(sprite.anims.currentFrame.index - 1)
      : 1;
    this.seekTo(cur + delta);
  }

  getCurrentFrameIndex(): number {
    const sprite = this.sprite;
    if (!sprite || !sprite.anims.currentFrame) return -1;
    return toOneBased(sprite.anims.currentFrame.index - 1);
  }

  // Phaser ANIMATION_UPDATE handler. `currentFrame.index` is 1-based at
  // runtime (verified against swordMaster.json stage.startFrame usage in
  // Player.ts), so we forward it unchanged.
  private onAnimUpdate = (
    _animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void => {
    this.emitFrame(frame.index);
  };

  private onAnimRepeat = (): void => {
    this.lastEmittedFrame = -1;
    this.callbacks.onLoopRestart();
  };

  private emitFrame(oneBased: number): void {
    if (oneBased === this.lastEmittedFrame) return;
    this.lastEmittedFrame = oneBased;
    this.callbacks.onFrameChange(oneBased);
  }

  private disposeSprite(): void {
    if (this.sprite) {
      this.sprite.off(
        Phaser.Animations.Events.ANIMATION_UPDATE,
        this.onAnimUpdate,
        this,
      );
      this.sprite.off(
        Phaser.Animations.Events.ANIMATION_REPEAT,
        this.onAnimRepeat,
        this,
      );
      this.sprite.destroy();
    }
    this.sprite = null;
    this.playing = false;
  }

  private drawCheckerboard(): void {
    const g = this.gridGraphics;
    if (!g) return;
    g.clear();
    g.fillStyle(0x252525, 1);
    g.fillRect(-200, -200, 400, 400);
    g.lineStyle(1, 0x333333, 1);
    for (let x = -200; x <= 200; x += 8) g.lineBetween(x, -200, x, 200);
    for (let y = -200; y <= 200; y += 8) g.lineBetween(-200, y, 200, y);
    g.lineStyle(1, 0x555555, 1);
    g.lineBetween(-200, 0, 200, 0);
    g.lineBetween(0, -200, 0, 200);
  }
}
