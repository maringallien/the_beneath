import Phaser from 'phaser';
import { SCENE_KEYS, ASSET_KEYS } from '../constants';
import {
  preloadAllCharacters,
  registerAllCharacterAnimations,
} from '../sprites/characterLoader';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.PRELOAD });
  }

  preload(): void {
    this.createLoadingBar();
    preloadAllCharacters(this);
  }

  create(): void {
    this.createPlaceholderTextures();
    registerAllCharacterAnimations(this);
    this.scene.start(SCENE_KEYS.GAME);
  }

  private createLoadingBar(): void {
    const { width, height } = this.cameras.main;

    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const progressBar = this.add.graphics();

    const loadingText = this.add
      .text(width / 2, height / 2 - 50, 'Loading...', {
        fontSize: '20px',
        color: '#ffffff'
      })
      .setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });
  }

  private createPlaceholderTextures(): void {
    const platformGraphics = this.make.graphics({ x: 0, y: 0 }, false);
    platformGraphics.fillStyle(0x7ed321);
    platformGraphics.fillRect(0, 0, 64, 16);
    platformGraphics.generateTexture(ASSET_KEYS.PLATFORM, 64, 16);
    platformGraphics.destroy();
  }
}
