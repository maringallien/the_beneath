import Phaser from 'phaser';
import { GRAVITY_Y } from '../constants';
import { BootScene } from '../scenes/BootScene';
import { GameScene } from '../scenes/GameScene';
import { LandingScene } from '../scenes/LandingScene';
import { PauseScene } from '../scenes/PauseScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { VictoryScene } from '../scenes/VictoryScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1d1d',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false
    }
  },
  // RESIZE mode locks the canvas to the parent #game element (which is 100vw x
  // 100vh), so the game fills the browser viewport. Camera zoom in GameScene
  // controls how zoomed-in the world appears, decoupled from window size.
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: 'game'
  },
  // LandingScene is last so it renders above GameScene when launched as an
  // overlay during the first-boot landing-page flow. PauseScene and
  // VictoryScene also sit above GameScene for the same reason; their relative
  // order doesn't matter — they're never on screen together. The merchant shop
  // is rendered as a DOM overlay (src/ui/ShopOverlay) instead of a Phaser
  // scene, so it doesn't appear here.
  scene: [BootScene, PreloadScene, GameScene, PauseScene, LandingScene, VictoryScene]
};
