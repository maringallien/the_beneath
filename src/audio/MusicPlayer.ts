import Phaser from 'phaser';
import { getSoundDefinition } from './soundRegistryLoader';
import { getMusicVolume, onMusicVolumeChange } from './musicSettings';

/**
 * MusicPlayer — owns the game's single looping soundtrack.
 *
 * Unlike ambience/SFX (owned by SoundManager, driven by level transitions or
 * world proximity), the music is one persistent track that plays for the whole
 * session, gated only by the music VOLUME preference (the OPTIONS volume bar) —
 * muting the music leaves ambience and SFX untouched. Like SoundManager, the
 * BaseSound lives on Phaser's game-scoped sound manager (scene.sound is one
 * shared instance across every scene), so it survives scene.restart (respawn)
 * and the landing→gameplay handoff without restarting. All state is held at
 * module scope as the single source of truth.
 *
 * Inputs:  a scene + sound id to play; the live music-volume preference; the
 *          browser audio-unlock gesture.
 * Outputs: drives a Phaser BaseSound (play/volume/teardown) and a volume-fade
 *          tween; subscribes to the volume preference.
 * @calledby the gameplay scene's startup/handoff paths, asserting the soundtrack.
 * @calls    the sound-definition lookup, Phaser's game-global sound manager and
 *           tween manager, and the music-volume preference store.
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

// asserts the soundtrack; idempotent for the same id, replaces on a different id; defers if audio context is still locked
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

// reconciles playback against volume+unlock state; arms UNLOCKED listener while locked; muted track stays alive at volume 0
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

// sets track volume; tweens when fade=true and scene is active, snaps otherwise (slider/pause-menu path)
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

// subscribes once to volume changes so the slider tracks live; unsubscribe intentionally dropped (lives for the session)
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  onMusicVolumeChange(() => applyState(false));
}

// arms a one-shot UNLOCKED listener that swells in the track on the first user gesture; guarded against stacking
function armUnlockListener(): void {
  if (unlockArmed || musicScene === null) return;
  unlockArmed = true;
  musicScene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
    unlockArmed = false;
    applyState(true);
  });
}

// stops/destroys the current track when switching to a different id; prevents leaking the old BaseSound
function teardownCurrent(): void {
  if (music === null) return;
  if (musicScene !== null) musicScene.tweens.killTweensOf(music);
  music.stop();
  music.destroy();
  music = null;
  started = false;
}
