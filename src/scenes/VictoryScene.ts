import Phaser from 'phaser';
import {
  SCENE_KEYS,
  VICTORY_DIM_ALPHA,
  VICTORY_DIM_COLOR,
  VICTORY_FADE_IN_MS,
  VICTORY_HOLD_MS,
  VICTORY_TITLE_COLOR,
  VICTORY_TITLE_FONT_SIZE_PX,
  VICTORY_TITLE_TEXT,
  VICTORY_TITLE_VIEWPORT_FRACTION_Y,
} from '../constants';
import type { GameScene } from './GameScene';

/**
 * @file scenes/VictoryScene.ts
 * @description Full-screen "YOU WON" win overlay launched atop the game scene (paused beneath it) when the final boss (the Heart Hoarder) dies. Fades a solid-black scrim and title in over the frozen world, holds for VICTORY_HOLD_MS, then auto-returns to the title (a click / Enter / Space skips the hold). The return path rebuilds the world in place AND resets the run-progress store, then re-shows the landing page — the same path the pause menu's Quit takes — so play resumes behind a fresh title screen. The title reuses the Nosifer display font for thematic continuity with the start screen.
 * @module scenes
 */
export class VictoryScene extends Phaser.Scene {
  private dim!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  // Prevents the auto-return timer and a skip input from both firing restartRun.
  private accepting = true;

  constructor() {
    super({ key: SCENE_KEYS.VICTORY });
  }

  /**
   * @function    create
   * @description Builds the scrim and title, fades them in, then on full reveal arms the skip and schedules the auto-return; skip is armed only after the reveal so the killing blow can't trigger it.
   * @calledby Phaser scene lifecycle at create, when the win overlay is launched on the final boss's death (via src/scenes/GameScene.ts)
   * @calls    src/scenes/VictoryScene.ts → layout, armSkip, returnToTitle and the tween system
   */
  create(): void {
    this.accepting = true;
    const { width, height } = this.cameras.main;

    this.dim = this.add
      .rectangle(0, 0, width, height, VICTORY_DIM_COLOR, VICTORY_DIM_ALPHA)
      .setOrigin(0, 0);

    this.title = this.add
      .text(0, 0, VICTORY_TITLE_TEXT, {
        fontFamily: 'Nosifer',
        fontSize: `${VICTORY_TITLE_FONT_SIZE_PX}px`,
        color: VICTORY_TITLE_COLOR,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
    this.title.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    this.layout();

    // Fade in from transparent for a soft reveal over the frozen world.
    this.dim.setAlpha(0);
    this.title.setAlpha(0);
    this.tweens.add({
      targets: this.dim,
      alpha: VICTORY_DIM_ALPHA,
      duration: VICTORY_FADE_IN_MS,
      ease: 'Sine.easeOut',
    });
    this.tweens.add({
      targets: this.title,
      alpha: 1,
      duration: VICTORY_FADE_IN_MS,
      ease: 'Sine.easeOut',
      // On full reveal: arm skip, then hold and return home on its own.
      onComplete: () => {
        this.armSkip();
        this.time.delayedCall(VICTORY_HOLD_MS, () => this.returnToTitle());
      },
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  /**
   * @function    armSkip
   * @description Arms click/Enter/Space to skip the hold; bound after the reveal so the killing blow can't trigger it.
   * @calledby src/scenes/VictoryScene.ts → the title fade-in's onComplete, once the overlay is fully revealed
   * @calls    Phaser input/keyboard binding to src/scenes/VictoryScene.ts → returnToTitle
   */
  private armSkip(): void {
    this.input.on('pointerdown', this.returnToTitle, this);
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', this.returnToTitle, this);
      kb.on('keydown-SPACE', this.returnToTitle, this);
    }
  }

  /**
   * @function    onResize
   * @description Stretch the scrim to the new viewport and re-center the title.
   * @calledby Phaser scale-manager RESIZE event (registered in create), since the canvas follows the window
   * @calls    src/scenes/VictoryScene.ts → layout after resizing the dim rectangle
   */
  private onResize(): void {
    const { width, height } = this.cameras.main;
    this.dim.setSize(width, height);
    this.layout();
  }

  /**
   * @function    onShutdown
   * @description Drop the resize listener so it doesn't outlive the scene.
   * @calledby Phaser SHUTDOWN event (registered once in create)
   * @calls    the scale manager to remove the resize listener
   */
  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  /** Center the title horizontally at the configured viewport fraction down. */
  private layout(): void {
    const { width, height } = this.cameras.main;
    this.title.setPosition(width / 2, height * VICTORY_TITLE_VIEWPORT_FRACTION_Y);
  }

  /**
   * @function    returnToTitle
   * @description Rebuilds the world back to the title, resets run progress, resumes the game scene, and stops this overlay; the accepting flag guards the auto-return timer and a skip input from both firing.
   * @calledby src/scenes/VictoryScene.ts → the auto-return timer (in create) or a skip input armed by armSkip
   * @calls    src/scenes/GameScene.ts → restartRun and Phaser scene resume/stop
   */
  private returnToTitle(): void {
    if (!this.accepting) return;
    this.accepting = false;
    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    gameScene.restartRun(true);
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }
}
