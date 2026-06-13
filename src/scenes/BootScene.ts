import Phaser from 'phaser';
import { SCENE_KEYS } from '../constants';

/**
 * BootScene — the first scene Phaser runs; an immediate hand-off to preload.
 *
 * Does no asset work itself — it exists as a stable, near-empty entry point so
 * the game-config scene order has a fixed starting key, then jumps straight to
 * the preload scene that loads the real assets.
 *
 * Inputs:  none beyond the scene key registered with the game config.
 * Outputs: starts the preload scene.
 * @calledby the Phaser game's scene boot, as the configured initial scene.
 * @calls    the scene manager to start the preload scene.
 */
export class BootScene extends Phaser.Scene {
  // Registers this scene under the boot key.
  constructor() {
    super({ key: SCENE_KEYS.BOOT });
  }

  // Phaser scene-create hook: immediately transitions to the preload scene.
  create(): void {
    this.scene.start(SCENE_KEYS.PRELOAD);
  }
}
