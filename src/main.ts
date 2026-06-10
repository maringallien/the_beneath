import Phaser from 'phaser';
import { gameConfig } from './config/gameConfig';

const game = new Phaser.Game(gameConfig);

// The music on/off preference (the OPTIONS speaker icon) gates ONLY the
// soundtrack now — it is applied by the MusicPlayer (src/audio/MusicPlayer.ts),
// which subscribes to the preference and fades the looping track in/out. It is
// deliberately NOT wired to game.sound.mute here: ambience and SFX must keep
// playing when music is muted, so there is no master-mute apply in this file.

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
