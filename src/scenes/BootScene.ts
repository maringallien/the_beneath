import Phaser from 'phaser';
import { SCENE_KEYS } from '../constants';

/**
 * @file scenes/BootScene.ts
 * @description The first scene Phaser runs — a stable, near-empty entry point that immediately hands off to the preload scene; does no asset work itself.
 * @module scenes
 */
export class BootScene extends Phaser.Scene {
  /** Registers this scene under the boot key. */
  constructor() {
    super({ key: SCENE_KEYS.BOOT });
  }

  /**
   * @function    create
   * @description Immediately transitions to the preload scene that loads the real assets.
   * @calledby Phaser scene lifecycle, at the configured initial scene's create step
   * @calls    the scene manager to start the preload scene
   */
  create(): void {
    this.scene.start(SCENE_KEYS.PRELOAD);
  }
}
