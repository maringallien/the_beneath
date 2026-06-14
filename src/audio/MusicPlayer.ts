import Phaser from 'phaser';
import { getSoundDefinition } from './soundRegistryLoader';
import { getMusicVolume, onMusicVolumeChange } from './musicSettings';

/**
 * @file audio/MusicPlayer.ts
 * @description Owns the game's single looping soundtrack — one persistent track for the whole session, gated only by the music VOLUME preference (muting it leaves ambience/SFX untouched). Its BaseSound lives on Phaser's game-scoped sound manager, so it survives scene.restart (respawn) and the landing→gameplay handoff without restarting; all state is module-scope. Driven by the gameplay scene's startup/handoff; reads the sound-definition lookup, Phaser's game-global sound + tween managers, and the music-volume store.
 * @module audio
 */

// swell-in on page load; slider adjustments snap so the bar feels immediate
const MUSIC_FADE_MS = 1200;

// the scene whose tweens drive the swell; refreshed each playMusic call (scene.sound is game-global regardless)
let musicScene: Phaser.Scene | null = null;

// currently loaded track id and its BaseSound (created lazily, reused after)
let currentTrackId: string | null = null;
let music: Phaser.Sound.BaseSound | null = null;

// false until play() is called; first activation swells in, later volume changes snap
let started = false;

// one-shot guards for the volume subscription and the browser unlock listener
let subscribed = false;
let unlockArmed = false;

/**
 * @function    playMusic
 * @description Asserts the soundtrack; idempotent for the same id, replaces on a different id, and defers if the audio context is still locked.
 * @param   scene    The active Phaser scene whose tweens drive the swell (scene.sound is game-global regardless).
 * @param   soundId  Registry id of the track to play.
 * @calledby src/scenes/GameScene.ts → gameplay startup and the landing→gameplay handoff, when the soundtrack should be (re)asserted
 * @calls    getSoundDefinition, then applyState — the reconciler that starts/raises/snaps playback against the volume preference
 */
export function playMusic(scene: Phaser.Scene, soundId: string): void {
  musicScene = scene;
  ensureSubscribed();

  if (soundId !== currentTrackId) {
    teardownCurrent();
    const def = getSoundDefinition(soundId);
    if (def === null) {
      currentTrackId = null;
      return;
    }
    currentTrackId = soundId;
    // start at volume 0; applyState raises it to the current preference
    music = scene.sound.add(soundId, { loop: def.loop, volume: 0 });
    started = false;
  }

  applyState(true);
}

/**
 * @function    applyState
 * @description Reconciles playback against the volume + unlock state — arms the UNLOCKED listener while locked; a muted track stays alive at volume 0 so unmute resumes cleanly.
 * @param   swell  True to fade volume in (first activation), false to snap (slider/pause-menu path).
 * @calledby playMusic, the volume-change subscription, and the UNLOCKED-listener callback
 * @calls    getMusicVolume, armUnlockListener, and setMusicVolumeNow
 */
function applyState(swell: boolean): void {
  if (music === null || musicScene === null || currentTrackId === null) return;
  const volume = getMusicVolume();

  // bail while locked; the armed UNLOCKED listener re-runs this when the browser allows
  if (musicScene.sound.locked) {
    if (volume > 0) armUnlockListener();
    return;
  }

  if (volume > 0) {
    if (!started) {
      music.play();
      started = true;
      setMusicVolumeNow(volume, swell);
    } else {
      // already running — track the slider instantly
      setMusicVolumeNow(volume, false);
    }
  } else if (started) {
    // muted: drop to silence but keep the loop alive (volume 0 costs almost nothing; unmute resumes cleanly)
    setMusicVolumeNow(0, false);
  }
}

/**
 * @function    setMusicVolumeNow
 * @description Sets the track volume — tweens when fade is true and the scene is active, snaps otherwise (slider / pause-menu path).
 * @param   target  Target volume in [0, 1].
 * @param   fade    True to tween over MUSIC_FADE_MS, false to set instantly.
 * @calledby applyState
 * @calls    the scene tween manager, or setVolume on the concrete WebAudioSound
 */
function setMusicVolumeNow(target: number, fade: boolean): void {
  if (music === null || musicScene === null) return;
  musicScene.tweens.killTweensOf(music);
  if (fade && musicScene.sys.isActive()) {
    musicScene.tweens.add({
      targets: music,
      volume: target,
      duration: MUSIC_FADE_MS,
    });
  } else {
    // setVolume is on concrete subclasses; cast is safe for all three (same pattern as SoundManager)
    (music as Phaser.Sound.WebAudioSound).setVolume(target);
  }
}

/**
 * @function    ensureSubscribed
 * @description Subscribes once to volume changes so the slider tracks live; the unsubscribe is intentionally dropped (the track lives for the session).
 * @calledby playMusic
 * @calls    onMusicVolumeChange (which re-runs applyState on each change)
 */
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  onMusicVolumeChange(() => applyState(false));
}

/**
 * @function    armUnlockListener
 * @description Arms a one-shot UNLOCKED listener that swells the track in on the first user gesture; guarded against stacking.
 * @calledby applyState, while the audio context is still locked
 * @calls    the scene sound manager's one-shot UNLOCKED handler, which re-runs applyState
 */
function armUnlockListener(): void {
  if (unlockArmed || musicScene === null) return;
  unlockArmed = true;
  musicScene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
    unlockArmed = false;
    applyState(true);
  });
}

/**
 * @function    teardownCurrent
 * @description Stops and destroys the current track when switching to a different id; prevents leaking the old BaseSound.
 * @calledby playMusic, when soundId differs from the current track
 * @calls    the scene tween + sound managers (killTweensOf/stop/destroy)
 */
function teardownCurrent(): void {
  if (music === null) return;
  if (musicScene !== null) musicScene.tweens.killTweensOf(music);
  music.stop();
  music.destroy();
  music = null;
  started = false;
}
