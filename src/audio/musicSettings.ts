/**
 * musicSettings — the persistent music-volume preference and its pub/sub.
 *
 * Owns the soundtrack volume as module state (the single source of truth across
 * the app), driven by the OPTIONS-panel volume bar. Gates the soundtrack ONLY —
 * ambience and SFX are unaffected. Volume 0 means muted; the speaker icon and
 * the M-key shortcut flip between 0 and the last audible level. The value is
 * mirrored to localStorage so it survives reloads, and a notify list lets the
 * soundtrack follow the slider live without polling. All localStorage access is
 * wrapped in try/catch (it can throw under private-browsing quotas or disabled
 * storage) and falls back to the in-memory value.
 *
 * Inputs:  the OPTIONS volume bar / mute shortcut; localStorage on load.
 * Outputs: the current volume, an enabled boolean, and change notifications.
 * @calledby the OPTIONS UI (set/toggle) and the soundtrack player (read +
 *           subscribe for its live target level).
 * @calls    localStorage for persistence and the registered change listeners.
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

export function getMusicVolume(): number {
  return musicVolume;
}

// true when the track is audible (volume > 0); drives the speaker-icon state
export function isMusicEnabled(): boolean {
  return musicVolume > 0;
}

// sets, persists, and broadcasts the music volume; no-ops when unchanged; remembers non-zero levels for unmute
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

// toggles mute; unmutes to the last audible level (or default); returns the new enabled state
export function toggleMusicMuted(): boolean {
  if (musicVolume > 0) {
    setMusicVolume(0);
  } else {
    setMusicVolume(lastAudibleVolume > 0 ? lastAudibleVolume : DEFAULT_MUSIC_VOLUME);
  }
  return musicVolume > 0;
}

// subscribes to volume changes; returns an unsubscribe function
export function onMusicVolumeChange(listener: MusicVolumeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
