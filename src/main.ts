import Phaser from 'phaser';
import { gameConfig } from './config/gameConfig';

/**
 * @file main.ts
 * @description Application entry point — constructs the single Phaser.Game from gameConfig and suspends Web Audio while the tab is hidden (music muting is handled by MusicPlayer, not here).
 * @module app
 */

const game = new Phaser.Game(gameConfig);

// Music preference is handled by MusicPlayer only — no master mute here so SFX/ambience keep playing.

// Suspend Web Audio on tab-hide; visibilitychange catches tab-switches that don't fire window blur.
// We only resume contexts we suspended so we never override Phaser's blur handling or the autoplay lock.
let suspendedByVisibility = false;

const webAudioContext = (): AudioContext | null =>
  game.sound instanceof Phaser.Sound.WebAudioSoundManager
    ? game.sound.context
    : null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const context = webAudioContext();
    if (context) {
      // Only suspend a running context; leave a still-locked one alone.
      if (context.state === 'running') {
        void context.suspend();
        suspendedByVisibility = true;
      }
    } else {
      // HTML5 Audio / NoAudio fallback (rare under Phaser.AUTO).
      game.sound.pauseAll();
      suspendedByVisibility = true;
    }
  } else if (suspendedByVisibility) {
    suspendedByVisibility = false;
    const context = webAudioContext();
    if (context) {
      void context.resume();
    } else {
      game.sound.resumeAll();
    }
  }
});
