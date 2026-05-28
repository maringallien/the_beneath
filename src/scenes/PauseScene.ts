import Phaser from 'phaser';
import {
  PAUSE_CONTINUE_TEXTURE_KEY,
  PAUSE_DIM_ALPHA,
  PAUSE_DIM_COLOR,
  PAUSE_FRAME_COLOR,
  PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX,
  PAUSE_FRAME_CORNER_ACCENT_SIZE_PX,
  PAUSE_FRAME_PADDING_PX,
  PAUSE_FRAME_STROKE_PX,
  PAUSE_QUIT_TEXTURE_KEY,
  PAUSE_SELECTED_TINT,
  PAUSE_UNSELECTED_TINT,
  PAUSE_WORD_DISPLAY_SCALE,
  PAUSE_WORD_GAP_PX,
  SCENE_KEYS,
} from '../constants';

// Index into the menu's two options. Continue is 0 so opening the menu
// pre-selects "resume" — a reflexive Enter keeps the player in the game.
type SelectionIndex = 0 | 1;

// Launched on top of GameScene via `scene.launch(PAUSE)` followed by
// `scene.pause(GAME)`. The separate-scene approach is idiomatic Phaser: it
// halts the underlying scene's update loop, physics, tweens, and timers in
// one call — no need to thread a "paused" flag through every entity. Closes
// via Continue / ESC (resume) or Quit (stop GameScene and restart through
// PreloadScene → fresh world).
export class PauseScene extends Phaser.Scene {
  private dim!: Phaser.GameObjects.Rectangle;
  private frame!: Phaser.GameObjects.Graphics;
  private continueImage!: Phaser.GameObjects.Image;
  private quitImage!: Phaser.GameObjects.Image;
  private selectedIndex: SelectionIndex = 0;

  constructor() {
    super({ key: SCENE_KEYS.PAUSE });
  }

  create(): void {
    const { width, height } = this.cameras.main;

    // Full-viewport dim. Sits below every other PauseScene object at depth 0.
    // Origin top-left so positioning at (0, 0) covers the canvas cleanly.
    this.dim = this.add
      .rectangle(0, 0, width, height, PAUSE_DIM_COLOR, PAUSE_DIM_ALPHA)
      .setOrigin(0, 0);

    // Word sprites are sized via setScale rather than setDisplaySize so the
    // source pixel grid scales uniformly. Origin centered for easier layout
    // math — positions are the visual center of each word.
    this.continueImage = this.add
      .image(0, 0, PAUSE_CONTINUE_TEXTURE_KEY)
      .setOrigin(0.5, 0.5)
      .setScale(PAUSE_WORD_DISPLAY_SCALE);
    this.quitImage = this.add
      .image(0, 0, PAUSE_QUIT_TEXTURE_KEY)
      .setOrigin(0.5, 0.5)
      .setScale(PAUSE_WORD_DISPLAY_SCALE);

    // Mouse: click to confirm, hover to focus. Hit area follows the scaled
    // sprite automatically because setInteractive() uses the display size.
    this.continueImage.setInteractive({ useHandCursor: true });
    this.quitImage.setInteractive({ useHandCursor: true });
    this.continueImage.on('pointerdown', () => this.resumeGame());
    this.quitImage.on('pointerdown', () => this.quitGame());
    this.continueImage.on('pointerover', () => this.setSelection(0));
    this.quitImage.on('pointerover', () => this.setSelection(1));

    // Frame is drawn after the words because strokeRect needs the resolved
    // word bounds to size itself. Created here, populated in layout().
    this.frame = this.add.graphics();

    this.layout();
    this.applySelectionTint();

    // Keyboard navigation. Event listeners are scoped to this scene and
    // auto-detach on scene.stop(), so no manual cleanup is required.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ESC', this.resumeGame, this);
      kb.on('keydown-LEFT', this.selectPrevious, this);
      kb.on('keydown-RIGHT', this.selectNext, this);
      kb.on('keydown-A', this.selectPrevious, this);
      kb.on('keydown-D', this.selectNext, this);
      kb.on('keydown-ENTER', this.confirmSelection, this);
      kb.on('keydown-SPACE', this.confirmSelection, this);
    }

    // Re-layout on window resize so the menu re-centers on the new viewport.
    // gameConfig uses Phaser.Scale.RESIZE, so the canvas dimensions follow
    // window size; without this the dim shrinks/grows incorrectly and the
    // centered group drifts off-center.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private onResize(): void {
    const { width, height } = this.cameras.main;
    this.dim.setSize(width, height);
    this.layout();
  }

  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  // Centers the two word sprites around the viewport midpoint with
  // PAUSE_WORD_GAP_PX between them, then draws the bounding-box frame
  // around their combined bounds plus PAUSE_FRAME_PADDING_PX.
  private layout(): void {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    const continueWidth = this.continueImage.displayWidth;
    const quitWidth = this.quitImage.displayWidth;
    // Total horizontal span of the two words + gap. Each word centers itself
    // half its own width away from the inner gap midpoint, so the result is
    // symmetric around cx regardless of width difference between the words.
    const totalWidth = continueWidth + PAUSE_WORD_GAP_PX + quitWidth;
    const leftEdge = cx - totalWidth / 2;

    this.continueImage.setPosition(leftEdge + continueWidth / 2, cy);
    this.quitImage.setPosition(
      leftEdge + continueWidth + PAUSE_WORD_GAP_PX + quitWidth / 2,
      cy,
    );

    this.drawFrame();
  }

  // Bounding box + four corner accent squares. Uses getBounds() on both
  // word sprites to compute the wrapping rect so the frame fits whatever
  // size the source PNGs end up at when scaled — no hardcoded widths.
  private drawFrame(): void {
    const continueBounds = this.continueImage.getBounds();
    const quitBounds = this.quitImage.getBounds();

    const left = Math.min(continueBounds.left, quitBounds.left);
    const right = Math.max(continueBounds.right, quitBounds.right);
    const top = Math.min(continueBounds.top, quitBounds.top);
    const bottom = Math.max(continueBounds.bottom, quitBounds.bottom);

    const padding = PAUSE_FRAME_PADDING_PX;
    const rectX = left - padding;
    const rectY = top - padding;
    const rectW = right - left + padding * 2;
    const rectH = bottom - top + padding * 2;

    this.frame.clear();
    this.frame.lineStyle(PAUSE_FRAME_STROKE_PX, PAUSE_FRAME_COLOR, 1);
    this.frame.strokeRect(rectX, rectY, rectW, rectH);

    // Corner accents: small filled squares sitting just outside each corner
    // of the outer stroke. Decorates the frame without committing to a
    // 9-slice asset and reads as deliberate UI rather than a plain border.
    const accentSize = PAUSE_FRAME_CORNER_ACCENT_SIZE_PX;
    const accentOffset = PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX;
    const accentHalf = accentSize / 2;
    this.frame.fillStyle(PAUSE_FRAME_COLOR, 1);
    const corners: ReadonlyArray<[number, number]> = [
      [rectX - accentOffset, rectY - accentOffset],
      [rectX + rectW + accentOffset, rectY - accentOffset],
      [rectX - accentOffset, rectY + rectH + accentOffset],
      [rectX + rectW + accentOffset, rectY + rectH + accentOffset],
    ];
    for (const [x, y] of corners) {
      this.frame.fillRect(x - accentHalf, y - accentHalf, accentSize, accentSize);
    }
  }

  private selectPrevious(): void {
    this.setSelection(this.selectedIndex === 0 ? 1 : 0);
  }

  private selectNext(): void {
    this.setSelection(this.selectedIndex === 0 ? 1 : 0);
  }

  private setSelection(index: SelectionIndex): void {
    if (this.selectedIndex === index) return;
    this.selectedIndex = index;
    this.applySelectionTint();
  }

  private applySelectionTint(): void {
    if (this.selectedIndex === 0) {
      this.continueImage.setTint(PAUSE_SELECTED_TINT);
      this.quitImage.setTint(PAUSE_UNSELECTED_TINT);
    } else {
      this.continueImage.setTint(PAUSE_UNSELECTED_TINT);
      this.quitImage.setTint(PAUSE_SELECTED_TINT);
    }
  }

  private confirmSelection(): void {
    if (this.selectedIndex === 0) {
      this.resumeGame();
    } else {
      this.quitGame();
    }
  }

  // Resume GameScene then stop self. Order matters: resume-before-stop is the
  // symmetric counterpart of GameScene's launch-before-pause. Animation
  // manager is resumed here to mirror the pauseAll() done when the menu
  // opened.
  private resumeGame(): void {
    this.anims.resumeAll();
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }

  // Quit = restart the run. Stops both scenes and re-enters PreloadScene,
  // which then starts GameScene with a fresh world. Animations are resumed
  // first because they were paused globally by GameScene; leaving them
  // paused would freeze every sprite on the fresh world too.
  private quitGame(): void {
    this.anims.resumeAll();
    this.scene.stop(SCENE_KEYS.GAME);
    this.scene.stop();
    this.scene.start(SCENE_KEYS.PRELOAD);
  }
}
