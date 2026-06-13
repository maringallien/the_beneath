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
import { ManualOverlay } from '../ui/ManualOverlay';
import type { GameScene } from './GameScene';

/**
 * PauseScene — the pause-menu overlay scene.
 *
 * Launched on top of the game scene which is then paused beneath it; running
 * the menu as a separate scene is idiomatic Phaser — pausing the underlying
 * scene halts its update loop, physics, tweens, and timers in one call, with no
 * "paused" flag threaded through every entity. Renders a dimmed scrim, a
 * centered column of word-sprite buttons inside a drawn frame, and offers four
 * actions: Continue (resume the game), New Game (abandon the run and rebuild
 * straight into gameplay), Options (open the How-to-Play manual), and Quit
 * (abandon the run and return to the home/title screen). Resume/rebuild always
 * resumes-then-stops, the symmetric counterpart of the launch-then-pause that
 * opened it.
 *
 * Inputs:  the pause UI tuning constants and a handle to the game scene.
 * Outputs: the menu overlay; on action, game resume or an in-place run rebuild.
 * @calledby the pause flow, when the player opens the menu mid-game.
 * @calls    the game scene's run-rebuild path, Phaser resume/stop, and the manual.
 */

// Four menu actions in display order; Continue is first so Enter reflexively resumes.
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

export class PauseScene extends Phaser.Scene {
  private dim!: Phaser.GameObjects.Rectangle;
  private frame!: Phaser.GameObjects.Graphics;
  private buttons: Phaser.GameObjects.Image[] = [];
  private selectedIndex = 0;
  // DOM manual overlay, created lazily; destroyed on shutdown if still open.
  private manualOverlay: ManualOverlay | null = null;

  constructor() {
    super({ key: SCENE_KEYS.PAUSE });
  }

  // Builds the dim, word-sprite buttons, frame, and keyboard navigation.
  create(): void {
    const { width, height } = this.cameras.main;

    // Full-viewport dim; origin top-left so (0,0) covers the canvas.
    this.dim = this.add
      .rectangle(0, 0, width, height, PAUSE_DIM_COLOR, PAUSE_DIM_ALPHA)
      .setOrigin(0, 0);

    // setScale keeps pixel grid uniform; pointerover so re-hovering the selected button still plays the click.
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

    // Frame is created here but sized in layout() once word bounds are known.
    this.frame = this.add.graphics();

    this.layout();
    this.applySelectionTint();

    // Keyboard navigation; auto-detaches on stop. Keyboard is disabled while the manual is open.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ESC', this.resumeGame, this);
      kb.on('keydown-UP', this.selectPrevious, this);
      kb.on('keydown-DOWN', this.selectNext, this);
      kb.on('keydown-W', this.selectPrevious, this);
      kb.on('keydown-S', this.selectNext, this);
      kb.on('keydown-ENTER', this.confirmSelection, this);
      kb.on('keydown-SPACE', this.confirmSelection, this);
    }

    // Re-center on resize; canvas follows the window so the dim and group would drift without it.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // Stretch the dim to the new viewport and re-center the menu.
  private onResize(): void {
    const { width, height } = this.cameras.main;
    this.dim.setSize(width, height);
    this.layout();
  }

  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    // Drop the manual overlay's DOM node if the scene stops while it's open.
    this.manualOverlay?.destroy();
    this.manualOverlay = null;
  }

  // Centers the button column in the viewport then redraws the frame around it.
  private layout(): void {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    const heights = this.buttons.map((button) => button.displayHeight);
    const totalHeight =
      heights.reduce((sum, h) => sum + h, 0) +
      PAUSE_WORD_GAP_PX * (this.buttons.length - 1);

    // Walk top → bottom, placing each word's center half its height past the cursor.
    let cursor = cy - totalHeight / 2;
    this.buttons.forEach((button, index) => {
      const h = heights[index];
      button.setPosition(cx, cursor + h / 2);
      cursor += h + PAUSE_WORD_GAP_PX;
    });

    this.drawFrame();
  }

  // Draws a stroked rect plus four corner accent squares around the button group.
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

    // Small filled squares outside each corner of the stroke — decorates without needing a 9-slice asset.
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

  // Move selection up one, wrapping to the bottom.
  private selectPrevious(): void {
    const count = this.buttons.length;
    this.setSelection((this.selectedIndex - 1 + count) % count);
  }

  // Move selection down one, wrapping to the top.
  private selectNext(): void {
    this.setSelection((this.selectedIndex + 1) % this.buttons.length);
  }

  // Set the focused button (no-op if unchanged) and refresh the tints.
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

  // Fire the currently focused button's action (Enter / Space).
  private confirmSelection(): void {
    this.activate(BUTTON_DEFS[this.selectedIndex].action);
  }

  // Dispatches the selected action to resume, new game, options, or quit.
  private activate(action: PauseAction): void {
    switch (action) {
      case 'continue':
        this.resumeGame();
        break;
      case 'newGame':
        // Skip the title screen and drop straight into a fresh run.
        this.restartRun(false);
        break;
      case 'options':
        this.openManual();
        break;
      case 'quit':
        // Rebuild the world and re-show the title screen.
        this.restartRun(true);
        break;
    }
  }

  // Resumes the game scene then stops this overlay (resume-before-stop mirrors the launch-before-pause).
  private resumeGame(): void {
    this.anims.resumeAll();
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }

  // Rebuilds the world in place, then resumes the game and stops this overlay.
  private restartRun(showLanding: boolean): void {
    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    gameScene.restartRun(showLanding);
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }

  // Opens the How-to-Play manual; disables this scene's keyboard while the panel is up.
  private openManual(): void {
    if (this.manualOverlay?.isOpen()) return;
    if (!this.manualOverlay) {
      const parent = this.game.canvas.parentElement ?? document.body;
      this.manualOverlay = new ManualOverlay(parent, this);
    }
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.manualOverlay.open({
      onClose: () => {
        // Re-enable on next tick so the closing ESC/click doesn't also trigger menu navigation.
        this.time.delayedCall(0, () => {
          if (this.input.keyboard) this.input.keyboard.enabled = true;
        });
      },
    });
  }
}
