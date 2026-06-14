/**
 * @file audio/musicSettings.ts
 * @description Persistent music-volume preference and its pub/sub, held as module state (single source of truth), driven by the OPTIONS volume bar. Gates the soundtrack ONLY (ambience/SFX unaffected); volume 0 = muted, the speaker icon and M-key flip 0 ↔ last-audible. Mirrored to localStorage (try/catch falls back to in-memory under private-browsing/quota), and a listener list lets the soundtrack track the slider live without polling.
 * @module audio
 */

const VOLUME_KEY = 'the_beneath.musicVolume';
// legacy boolean key from before the volume bar; read once for migration so a muted player stays muted
const LEGACY_ENABLED_KEY = 'the_beneath.musicEnabled';

// matches main_theme's intended mix so a fresh player hears the right volume without configuring anything
export const DEFAULT_MUSIC_VOLUME = 0.45;

type MusicVolumeListener = (volume: number) => void;

const listeners = new Set<MusicVolumeListener>();

let musicVolume = readPersistedVolume();

// unmuting restores this so a low-volume player doesn't jump to the full default
let lastAudibleVolume = musicVolume > 0 ? musicVolume : DEFAULT_MUSIC_VOLUME;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// reads persisted volume from localStorage on init; migrates the legacy boolean key; falls back to default
function readPersistedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? clamp01(parsed) : DEFAULT_MUSIC_VOLUME;
    }
    if (localStorage.getItem(LEGACY_ENABLED_KEY) === 'false') return 0;
    return DEFAULT_MUSIC_VOLUME;
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}

/** Current music volume in [0, 1]. */
export function getMusicVolume(): number {
  return musicVolume;
}

/** True when the track is audible (volume > 0); drives the speaker-icon state. */
export function isMusicEnabled(): boolean {
  return musicVolume > 0;
}

/**
 * @function    setMusicVolume
 * @description Sets, persists, and broadcasts the music volume; no-ops when unchanged; remembers non-zero levels for a later unmute.
 * @param   value  Target volume; clamped to [0, 1], non-finite → 0.
 * @calledby src/ui/ManualOverlay.ts → the OPTIONS volume bar as the player drags it, and toggleMusicMuted below
 * @calls    the clamp helper, localStorage persistence, and each subscribed change listener (so the live soundtrack tracks the slider)
 */
export function setMusicVolume(value: number): void {
  const next = clamp01(value);
  if (next === musicVolume) return;
  musicVolume = next;
  if (next > 0) lastAudibleVolume = next;
  try {
    localStorage.setItem(VOLUME_KEY, String(next));
  } catch {
    // persistence failed; in-memory value still drives this session
  }
  for (const listener of listeners) listener(musicVolume);
}

/**
 * @function    toggleMusicMuted
 * @description Toggles mute — drops to 0 when audible, otherwise restores the last audible level (or the default if none was remembered).
 * @returns the new enabled state (true = now audible); drives a volume change and its broadcast as a side effect.
 * @calledby src/ui/ManualOverlay.ts → the OPTIONS speaker icon and the M-key mute shortcut
 * @calls    setMusicVolume, which persists and notifies subscribers
 */
export function toggleMusicMuted(): boolean {
  if (musicVolume > 0) {
    setMusicVolume(0);
  } else {
    setMusicVolume(lastAudibleVolume > 0 ? lastAudibleVolume : DEFAULT_MUSIC_VOLUME);
  }
  return musicVolume > 0;
}

/**
 * @function    onMusicVolumeChange
 * @description Subscribes a listener to volume changes.
 * @param   listener  Callback invoked with the new volume on each change.
 * @returns an unsubscribe function that removes the listener.
 * @calledby src/audio/MusicPlayer.ts → ensureSubscribed, so the soundtrack follows the slider live without polling
 * @calls    —
 */
export function onMusicVolumeChange(listener: MusicVolumeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
