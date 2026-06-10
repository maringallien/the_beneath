import Phaser from 'phaser';
import { getSoundDefinition } from './soundRegistryLoader';
import { getMusicVolume, onMusicVolumeChange } from './musicSettings';

// The game's single looping soundtrack. Unlike ambience/SFX (owned by
// SoundManager and driven by level transitions or world proximity), the music
// is one persistent track that plays for the whole session and is gated by the
// music VOLUME preference (the OPTIONS volume bar) — ambience and SFX are never
// affected, so muting the music leaves the rest of the mix intact.
//
// Like SoundManager, the BaseSound lives on Phaser's game-scoped sound manager
// (scene.sound is one shared instance across every scene), so it survives
// scene.restart (respawn) and the landing→gameplay handoff without restarting.
// State is kept at module scope as the single source of truth.

// Swell-in length for the initial auto-start (page load). Slider adjustments do
// NOT use this — they snap so the volume tracks the bar with no lag.
const MUSIC_FADE_MS = 1200;

// The scene whose tween manager drives the swell-in. Refreshed on every
// playMusic call (always GameScene, alive for the whole session). scene.sound is
// the game-global manager regardless of which scene this points at, so unlock
// and playback are unaffected by which scene owns the fade.
let musicScene: Phaser.Scene | null = null;

// The currently-loaded track id and its BaseSound (created lazily, reused after).
let currentTrackId: string | null = null;
let music: Phaser.Sound.BaseSound | null = null;

// Whether play() has been called on the current track. The first time it becomes
// audible we swell it in; every later volume change snaps so the slider feels
// responsive. Stays false while muted-from-load so we don't spin up a silent
// loop until the player actually raises the volume.
let started = false;

// One-time guards: a single onMusicVolumeChange subscription and at most one
// armed UNLOCKED listener (browsers block audio until the first user gesture).
let subscribed = false;
let unlockArmed = false;

// Starts (or re-asserts) the game soundtrack. Idempotent: calling it again with
// the same id just refreshes the owning scene and re-applies the current volume —
// it never restarts a track that's already playing, so respawns, the
// landing→gameplay handoff, and New Game all keep the music seamless.
//
// Safe to call before the audio context is unlocked: if the sound manager is
// still locked (no user gesture yet), playback is deferred to the UNLOCKED
// event so the track begins at the earliest moment the browser allows.
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
    // Created at volume 0; applyState raises it to the current preference.
    music = scene.sound.add(soundId, { loop: def.loop, volume: 0 });
    started = false;
  }

  applyState(true);
}

// Reconciles actual playback against the desired state (music volume + unlock
// status). `swell` controls whether a track that STARTS in this call fades in
// (true for the page-load auto-start) or snaps (false for live slider changes).
function applyState(swell: boolean): void {
  if (music === null || musicScene === null || currentTrackId === null) return;
  const volume = getMusicVolume();

  // Nothing can be audible until the first user gesture unlocks Web Audio. Arm a
  // one-shot listener (if there's anything to play) and bail; applyState re-runs
  // with a swell on unlock. scene.sound is the shared game manager, so this works
  // no matter which scene armed it.
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
      // Already running — track the slider instantly.
      setMusicVolumeNow(volume, false);
    }
  } else if (started) {
    // Muted: drop to silence but keep the single loop alive (one source at
    // volume 0 costs the audio thread next to nothing, and an unmute resumes
    // seamlessly). Snap so the bar feels immediate.
    setMusicVolumeNow(0, false);
  }
}

// Sets the track volume — tweened over MUSIC_FADE_MS when `fade` is true AND the
// owning scene's tween manager is running, otherwise snapped. Snapping covers
// the responsive-slider path and the case where the owning scene is paused (the
// pause menu is open, where its tweens wouldn't advance).
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
    // Phaser declares setVolume on the concrete sound subclasses, not BaseSound;
    // all three implement it, so the cast is safe (same pattern as SoundManager).
    (music as Phaser.Sound.WebAudioSound).setVolume(target);
  }
}

// Subscribes once to the music volume preference so the bar (and the M-key /
// icon mute) tracks live. The unsubscribe handle is intentionally dropped — the
// soundtrack lives for the whole app session.
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  onMusicVolumeChange(() => applyState(false));
}

// Arms a single UNLOCKED listener that re-runs applyState (with a swell) once the
// browser's autoplay lock lifts on the first click/keypress. Guarded so repeated
// pre-unlock playMusic calls don't stack listeners.
function armUnlockListener(): void {
  if (unlockArmed || musicScene === null) return;
  unlockArmed = true;
  musicScene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
    unlockArmed = false;
    applyState(true);
  });
}

// Stops and destroys the active track. Only used when switching to a different
// soundtrack id (not part of the normal single-track flow), so a new BaseSound
// can be created cleanly without leaking the old one.
function teardownCurrent(): void {
  if (music === null) return;
  if (musicScene !== null) musicScene.tweens.killTweensOf(music);
  music.stop();
  music.destroy();
  music = null;
  started = false;
}
