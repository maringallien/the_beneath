import Phaser from 'phaser';
import { GRAVITY_Y } from '../constants';
import { BootScene } from '../scenes/BootScene';
import { GameScene } from '../scenes/GameScene';
import { LandingScene } from '../scenes/LandingScene';
import { PauseScene } from '../scenes/PauseScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { VictoryScene } from '../scenes/VictoryScene';

/**
 * @file config/gameConfig.ts
 * @description The single Phaser.Game config object — renderer, world physics, scaling, and the scene roster the entry point hands to new Phaser.Game. Two non-obvious choices: arcade physics steps per rendered frame (fixedStep:false) so motion stays smooth at any refresh rate, and the scene array is ordered so overlay scenes (landing/pause/victory) render above GameScene. The merchant shop is a DOM overlay, not a scene, so it is deliberately absent. Consumed once by src/main.ts.
 * @module config
 */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1d1d',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false,
      // Step physics once per rendered frame using the real frame delta,
      // instead of Phaser's default fixed 60 Hz step (fixedStep: true). The
      // fixed step advances bodies only ~every other frame on a 120 Hz display
      // while the camera follow-lerp runs every frame, so the player's on-screen
      // position oscillated — reading as blur/ghosting and, at high fall speed,
      // a second trailing copy of the character; enemies juddered the same way.
      // Stepping per frame keeps physics aligned with render at ANY refresh rate
      // (60/120/144/240). Movement is velocity/delta-based, so feel is unchanged.
      fixedStep: false
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
