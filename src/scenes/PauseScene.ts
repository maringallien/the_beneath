import Phaser from 'phaser';
import { playOneShot } from '../audio';
import {
  PAUSE_CONTINUE_TEXTURE_KEY,
  PAUSE_DIM_ALPHA,
  PAUSE_DIM_COLOR,
  PAUSE_FRAME_COLOR,
  PAUSE_FRAME_CORNER_ACCENT_OFFSET_PX,
  PAUSE_FRAME_CORNER_ACCENT_SIZE_PX,
  PAUSE_FRAME_PADDING_PX,
  PAUSE_FRAME_STROKE_PX,
  PAUSE_NEW_GAME_TEXTURE_KEY,
  PAUSE_OPTIONS_TEXTURE_KEY,
  PAUSE_QUIT_TEXTURE_KEY,
  PAUSE_SELECTED_TINT,
  PAUSE_UNSELECTED_TINT,
  PAUSE_WORD_DISPLAY_SCALE,
  PAUSE_WORD_GAP_PX,
  SCENE_KEYS,
  UI_BUTTON_HOVER_SOUND_ID,
} from '../constants';
import { OptionsOverlay } from '../ui/OptionsOverlay';
import type { GameScene } from './GameScene';

// The four pause-menu actions, in display order (left → right). Continue is
// first so opening the menu pre-selects "resume" — a reflexive Enter keeps the
// player in the game.
type PauseAction = 'continue' | 'newGame' | 'options' | 'quit';

interface PauseButtonDef {
  readonly action: PauseAction;
  readonly textureKey: string;
}

const BUTTON_DEFS: ReadonlyArray<PauseButtonDef> = [
  { action: 'continue', textureKey: PAUSE_CONTINUE_TEXTURE_KEY },
  { action: 'newGame', textureKey: PAUSE_NEW_GAME_TEXTURE_KEY },
  { action: 'options', textureKey: PAUSE_OPTIONS_TEXTURE_KEY },
  { action: 'quit', textureKey: PAUSE_QUIT_TEXTURE_KEY },
];

// Launched on top of GameScene via `scene.launch(PAUSE)` followed by
// `scene.pause(GAME)`. The separate-scene approach is idiomatic Phaser: it
// halts the underlying scene's update loop, physics, tweens, and timers in
// one call — no need to thread a "paused" flag through every entity.
//
// Actions:
//   Continue → resume GameScene.
//   New Game → abandon the run and rebuild GameScene straight into gameplay.
//   Options  → open the OptionsOverlay (controls list + music toggle).
//   Quit     → abandon the run and return to the home/title screen.
export class PauseScene extends Phaser.Scene {
  private dim!: Phaser.GameObjects.Rectangle;
  private frame!: Phaser.GameObjects.Graphics;
  private buttons: Phaser.GameObjects.Image[] = [];
  private selectedIndex = 0;
  // DOM options panel, created lazily on first open and reused thereafter.
  // Destroyed in onShutdown if it happens to be open when the scene stops.
  private optionsOverlay: OptionsOverlay | null = null;

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
    // math — positions are the visual center of each word. Mouse: click to
    // confirm, hover to focus + play the UI click (on pointerover so
    // re-hovering the already-selected button still clicks).
    this.buttons = BUTTON_DEFS.map((def, index) => {
      const image = this.add
        .image(0, 0, def.textureKey)
        .setOrigin(0.5, 0.5)
        .setScale(PAUSE_WORD_DISPLAY_SCALE);
      image.setInteractive({ useHandCursor: true });
      image.on('pointerdown', () => this.activate(def.action));
      image.on('pointerover', () => {
        this.setSelection(index);
        playOneShot(this, UI_BUTTON_HOVER_SOUND_ID);
      });
      return image;
    });

    // Frame is drawn after the words because strokeRect needs the resolved
    // word bounds to size itself. Created here, populated in layout().
    this.frame = this.add.graphics();

    this.layout();
    this.applySelectionTint();

    // Keyboard navigation. Event listeners are scoped to this scene and
    // auto-detach on scene.stop(), so no manual cleanup is required. While the
    // options panel is open, this scene's keyboard is disabled (see
    // openOptions) so the panel's own ESC/M handlers are the only ones live.
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
    // If the scene is stopping while the options panel is still open (e.g. a
    // forced teardown), drop its DOM + window listener so they don't outlive
    // the scene.
    this.optionsOverlay?.destroy();
    this.optionsOverlay = null;
  }

  // Centers the row of word sprites around the viewport midpoint with
  // PAUSE_WORD_GAP_PX between each, then draws the bounding-box frame around
  // their combined bounds plus PAUSE_FRAME_PADDING_PX.
  private layout(): void {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    const widths = this.buttons.map((button) => button.displayWidth);
    const totalWidth =
      widths.reduce((sum, w) => sum + w, 0) +
      PAUSE_WORD_GAP_PX * (this.buttons.length - 1);

    // Walk left → right placing each word's center half its own width past the
    // running cursor, so the row stays symmetric around cx regardless of the
    // per-word width differences.
    let cursor = cx - totalWidth / 2;
    this.buttons.forEach((button, index) => {
      const w = widths[index];
      button.setPosition(cursor + w / 2, cy);
      cursor += w + PAUSE_WORD_GAP_PX;
    });

    this.drawFrame();
  }

  // Bounding box + four corner accent squares. Uses getBounds() on every word
  // sprite to compute the wrapping rect so the frame fits whatever size the
  // source PNGs end up at when scaled — no hardcoded widths.
  private drawFrame(): void {
    const bounds = this.buttons.map((button) => button.getBounds());
    const left = Math.min(...bounds.map((b) => b.left));
    const right = Math.max(...bounds.map((b) => b.right));
    const top = Math.min(...bounds.map((b) => b.top));
    const bottom = Math.max(...bounds.map((b) => b.bottom));

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
    const count = this.buttons.length;
    this.setSelection((this.selectedIndex - 1 + count) % count);
  }

  private selectNext(): void {
    this.setSelection((this.selectedIndex + 1) % this.buttons.length);
  }

  private setSelection(index: number): void {
    if (this.selectedIndex === index) return;
    this.selectedIndex = index;
    this.applySelectionTint();
  }

  // Selected = full-brightness (white passthrough); the rest dim via setTint.
  private applySelectionTint(): void {
    this.buttons.forEach((button, index) => {
      button.setTint(
        index === this.selectedIndex
          ? PAUSE_SELECTED_TINT
          : PAUSE_UNSELECTED_TINT,
      );
    });
  }

  private confirmSelection(): void {
    this.activate(BUTTON_DEFS[this.selectedIndex].action);
  }

  private activate(action: PauseAction): void {
    switch (action) {
      case 'continue':
        this.resumeGame();
        break;
      case 'newGame':
        // Fresh run, straight into gameplay (skip the title screen).
        this.restartRun(false);
        break;
      case 'options':
        this.openOptions();
        break;
      case 'quit':
        // Back to the home/title screen (landing overlay over a fresh world).
        this.restartRun(true);
        break;
    }
  }

  // Resume GameScene then stop self. Order matters: resume-before-stop is the
  // symmetric counterpart of GameScene's launch-before-pause. The animation
  // manager is resumed here to mirror the pauseAll() done when the menu opened.
  private resumeGame(): void {
    this.anims.resumeAll();
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }

  // New Game and Quit both abandon the current run. showLanding=false drops the
  // player straight into a fresh world (New Game); showLanding=true re-shows the
  // home/title screen (Quit).
  //
  // GameScene rebuilds its world IN PLACE (tearDownWorld + buildWorld, the same
  // mechanism respawn uses) rather than via scene.restart(): Phaser reuses the
  // scene instance on restart, so its fields keep the previous world's state and
  // the non-idempotent buildWorld stacks a second world on top — which froze the
  // screen. The GameScene instance is alive while paused, so the rebuild runs
  // directly across the pause boundary; we then resume it (its update loop was
  // halted by scene.pause) and stop this overlay.
  private restartRun(showLanding: boolean): void {
    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    gameScene.restartRun(showLanding);
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }

  // Opens the DOM options panel over the menu. The full-viewport backdrop
  // intercepts mouse events so the pause buttons underneath can't be clicked
  // through it; this scene's keyboard is disabled so its ESC/arrow navigation
  // doesn't fight the panel's own ESC/M handlers. Re-enabled on close.
  private openOptions(): void {
    if (this.optionsOverlay?.isOpen()) return;
    if (!this.optionsOverlay) {
      const parent = this.game.canvas.parentElement ?? document.body;
      this.optionsOverlay = new OptionsOverlay(parent);
    }
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.optionsOverlay.open({
      onClose: () => {
        // Re-enable on the next tick so the same ESC/click that closed the
        // panel isn't also handled by this scene's menu navigation this frame.
        this.time.delayedCall(0, () => {
          if (this.input.keyboard) this.input.keyboard.enabled = true;
        });
      },
    });
  }
}
