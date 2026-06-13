import Phaser from 'phaser';
import { gameConfig } from './config/gameConfig';

/**
 * main — application entry point.
 *
 * Constructs the single Phaser.Game from gameConfig and installs the tab-hidden
 * audio guard. Music muting is NOT handled here: the music preference gates only
 * the soundtrack and is applied by the MusicPlayer, so SFX and ambience are left
 * alone. This file's one job beyond construction is suspending Web Audio while
 * the tab is hidden (see the visibility handler below).
 *
 * Inputs:  gameConfig; the DOM visibilitychange event.
 * Outputs: the running Phaser game; suspend/resume of the Web Audio output.
 * @calledby the browser, as the bundle's top-level module on page load.
 * @calls    Phaser game construction and the Web Audio context suspend/resume.
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
