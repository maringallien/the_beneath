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

// Full-screen win overlay launched on top of GameScene (which is paused beneath
// it) when the final boss (the Heart Hoarder) dies. Fades a solid-black scrim +
// "YOU WON" title in over the frozen world, holds for VICTORY_HOLD_MS, then
// auto-returns to the home/title screen. A click / Enter / Space skips the hold.
//
// Return path: GameScene.restartRun(true) rebuilds the world, resets the run-
// progress store, and re-shows the landing page — the same path the pause menu's
// Quit uses. Mirrors PauseScene's launch/resume/stop dance: GameScene.
// triggerVictory() does launch(VICTORY) → pause(GAME); returnToTitle() rebuilds
// the world, resumes GAME (so its update loop is live behind the re-shown landing
// page), then stops this scene.
//
// The title reuses the Nosifer display font for thematic continuity with the
// start screen.
export class VictoryScene extends Phaser.Scene {
  private dim!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  // Guards against a double-activation (the auto-return timer racing a skip
  // click / key) firing two restartRun calls.
  private accepting = true;

  constructor() {
    super({ key: SCENE_KEYS.VICTORY });
  }

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

    // Fade the black scrim + title in from transparent for a soft reveal over
    // the frozen world.
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
      // Once "YOU WON" is fully revealed, hold it, then return home on its own.
      // Skip inputs are armed only here — not during the fade — so the attack
      // click that landed the killing blow can't instantly bounce the player
      // home before the screen has even shown.
      onComplete: () => {
        this.armSkip();
        this.time.delayedCall(VICTORY_HOLD_MS, () => this.returnToTitle());
      },
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // Lets an impatient player skip the hold and go home immediately. Bound after
  // the reveal so a held attack input can't skip the screen on frame one.
  private armSkip(): void {
    this.input.on('pointerdown', this.returnToTitle, this);
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', this.returnToTitle, this);
      kb.on('keydown-SPACE', this.returnToTitle, this);
    }
  }

  private onResize(): void {
    const { width, height } = this.cameras.main;
    this.dim.setSize(width, height);
    this.layout();
  }

  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  private layout(): void {
    const { width, height } = this.cameras.main;
    this.title.setPosition(width / 2, height * VICTORY_TITLE_VIEWPORT_FRACTION_Y);
  }

  // Abandon the run and go back to the home/title screen. GameScene.restartRun
  // rebuilds the world in place AND resets the run-progress store; we then resume
  // GameScene (its loop was halted by triggerVictory's pause) and stop this
  // overlay, leaving the landing page on top of a fresh world.
  private returnToTitle(): void {
    if (!this.accepting) return;
    this.accepting = false;
    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    gameScene.restartRun(true);
    this.scene.resume(SCENE_KEYS.GAME);
    this.scene.stop();
  }
}
