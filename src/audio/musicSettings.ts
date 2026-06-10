// Persistent music VOLUME preference, driven by the volume bar in the OPTIONS
// panel. The MusicPlayer reads getMusicVolume() for the soundtrack's target
// level and subscribes via onMusicVolumeChange() to follow the slider live.
//
// This gates the soundtrack ONLY — ambience and SFX are unaffected. Volume 0
// means muted; the speaker icon and the M-key shortcut flip between 0 and the
// last audible level via toggleMusicMuted().
//
// The value is kept in module state (single source of truth across the app) and
// mirrored to localStorage so it survives reloads. Reads/writes are wrapped in
// try/catch because localStorage can throw (private-browsing quotas, disabled
// storage); on failure we fall back to the in-memory value.

const VOLUME_KEY = 'the_beneath.musicVolume';
// Legacy on/off key from before the volume bar existed. Read once for migration
// so a player who had music muted stays muted after the upgrade.
const LEGACY_ENABLED_KEY = 'the_beneath.musicEnabled';

// Default level when nothing is stored — matches main_theme's registry-designed
// mix so a fresh player hears the soundtrack at its intended volume.
export const DEFAULT_MUSIC_VOLUME = 0.45;

type MusicVolumeListener = (volume: number) => void;

const listeners = new Set<MusicVolumeListener>();

let musicVolume = readPersistedVolume();

// Remembered level for mute/unmute: unmuting restores this rather than the
// default, so a player who set music low doesn't jump back to full default when
// they un-mute. Seeded from the loaded volume (or the default if loaded muted).
let lastAudibleVolume = musicVolume > 0 ? musicVolume : DEFAULT_MUSIC_VOLUME;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Loads the persisted volume, falling back to DEFAULT_MUSIC_VOLUME for a fresh
// player or an unreadable value. Migrates the legacy boolean: a stored
// musicEnabled === 'false' (and no volume yet) resolves to muted.
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

// Convenience boolean for the speaker-icon on/off state. Music is "enabled"
// whenever it's audible.
export function isMusicEnabled(): boolean {
  return musicVolume > 0;
}

// Sets the music volume (clamped to [0, 1]), persists it, and notifies
// subscribers. No-ops when unchanged so listeners don't fire redundantly.
export function setMusicVolume(value: number): void {
  const next = clamp01(value);
  if (next === musicVolume) return;
  musicVolume = next;
  if (next > 0) lastAudibleVolume = next;
  try {
    localStorage.setItem(VOLUME_KEY, String(next));
  } catch {
    // Persistence failed; the in-memory value still drives this session.
  }
  for (const listener of listeners) listener(musicVolume);
}

// Mutes (→ 0) or unmutes (→ last audible level) the music. Returns the new
// enabled state. Drives the M-key shortcut and the speaker-icon click.
export function toggleMusicMuted(): boolean {
  if (musicVolume > 0) {
    setMusicVolume(0);
  } else {
    setMusicVolume(lastAudibleVolume > 0 ? lastAudibleVolume : DEFAULT_MUSIC_VOLUME);
  }
  return musicVolume > 0;
}

// Subscribes to volume changes; returns an unsubscribe function. The MusicPlayer
// uses this to track the slider without polling.
export function onMusicVolumeChange(listener: MusicVolumeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
