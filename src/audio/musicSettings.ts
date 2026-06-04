// Persistent "music on/off" preference.
//
// There is no music track in the game yet, but the pause-menu options panel
// exposes a toggle (a speaker icon) so the wiring is ready ahead of time. When
// a music layer is added later, its playback code should:
//   - read isMusicEnabled() to decide whether to start a track, and
//   - subscribe via onMusicEnabledChange() to start/stop the track live when
//     the player flips the toggle mid-session.
// Until then, toggling only flips and persists this preference — there is
// nothing audible to gate yet.
//
// The preference is kept in module state (single source of truth across the
// app) and mirrored to localStorage so it survives reloads. Reads/writes are
// wrapped in try/catch because localStorage can throw (private-browsing
// quotas, disabled storage); on failure we fall back to the in-memory value.

const STORAGE_KEY = 'the_beneath.musicEnabled';

type MusicEnabledListener = (enabled: boolean) => void;

const listeners = new Set<MusicEnabledListener>();

let musicEnabled = readPersistedPreference();

// Music defaults to ON when no preference has been stored yet. A malformed or
// unreadable value also resolves to ON so a storage hiccup never leaves the
// player silently muted.
function readPersistedPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function isMusicEnabled(): boolean {
  return musicEnabled;
}

// Sets the preference and notifies subscribers. No-ops when the value is
// unchanged so listeners aren't fired redundantly.
export function setMusicEnabled(value: boolean): void {
  if (value === musicEnabled) return;
  musicEnabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Persistence failed; the in-memory value still drives this session.
  }
  for (const listener of listeners) listener(musicEnabled);
}

// Flips the preference and returns the new value — convenient for a UI toggle.
export function toggleMusicEnabled(): boolean {
  setMusicEnabled(!musicEnabled);
  return musicEnabled;
}

// Subscribes to changes; returns an unsubscribe function. Future music
// playback code uses this to react to the toggle without polling.
export function onMusicEnabledChange(
  listener: MusicEnabledListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
