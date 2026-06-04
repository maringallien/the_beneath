import Phaser from 'phaser';
import { isMusicEnabled, onMusicEnabledChange } from './audio';
import { gameConfig } from './config/gameConfig';

const game = new Phaser.Game(gameConfig);

// Apply the music/sound preference (toggled from the pause-menu options panel)
// to the game's global sound manager, and keep it in sync whenever the player
// flips it. There is no dedicated music track yet, so the preference currently
// drives the MASTER mute — turning it off silences ambience + SFX too, and a
// future music bus would be scoped here instead. `game.sound` is only created
// during boot, so the initial apply waits for the READY event; later toggles
// run well after boot when the manager is live. The guard keeps both paths
// safe regardless of timing.
const applyAudioPreference = (): void => {
  if (game.sound) {
    game.sound.mute = !isMusicEnabled();
  }
};
game.events.once(Phaser.Core.Events.READY, applyAudioPreference);
onMusicEnabledChange(applyAudioPreference);

// Pause all audio while the game tab is in the background.
//
// Phaser's pauseOnBlur suspends the Web Audio context on window *blur*, but
// switching to another browser *tab* fires `visibilitychange` without a window
// blur — the page keeps OS focus, only the tab is hidden. The render loop
// stalls (requestAnimationFrame is throttled while hidden), yet Web Audio runs
// on its own thread, so looping ambience/music keeps playing. Listen to the DOM
// visibility event directly and suspend/resume the audio output to match. We
// only resume a context we suspended ourselves, so this never overrides
// Phaser's own blur/focus handling or the pre-gesture autoplay lock (the
// context stays 'suspended' until the first user interaction unlocks it).
let suspendedByVisibility = false;

const webAudioContext = (): AudioContext | null =>
  game.sound instanceof Phaser.Sound.WebAudioSoundManager
    ? game.sound.context
    : null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const context = webAudioContext();
    if (context) {
      // Only a running context can be meaningfully suspended; a still-locked
      // one (no user gesture yet) is left alone.
      if (context.state === 'running') {
        void context.suspend();
        suspendedByVisibility = true;
      }
    } else {
      // HTML5 Audio / NoAudio fallback (uncommon under Phaser.AUTO).
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
