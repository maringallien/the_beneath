import type { Trigger } from './state';

const SAVE_ENDPOINT = '/__anim-sound-aligner/save';
// Vite serves /public at the site root, so `src/audio/animationSoundTriggers.json`
// is reachable via `/src/audio/animationSoundTriggers.json` during dev because
// the Vite dev server also proxies project-relative paths under /@fs and /. We
// fetch the file via its raw URL — Vite serves it as static JSON in dev.
const TRIGGERS_FETCH_URL = '/src/audio/animationSoundTriggers.json';

export interface SaveResult {
  readonly ok: boolean;
  readonly mode: 'endpoint' | 'download';
  readonly errors: ReadonlyArray<string>;
}

export interface PersistedTriggers {
  readonly triggers: Record<string, ReadonlyArray<Trigger>>;
}

// Best-effort load of the on-disk file. Missing file (404) is normal on
// first run and returns an empty map. Malformed JSON surfaces as an error
// the caller can show in the status line.
export async function loadTriggers(): Promise<{
  ok: boolean;
  data: Map<string, ReadonlyArray<Trigger>>;
  error?: string;
}> {
  try {
    const res = await fetch(TRIGGERS_FETCH_URL, { cache: 'no-store' });
    if (res.status === 404) {
      return { ok: true, data: new Map() };
    }
    if (!res.ok) {
      return { ok: false, data: new Map(), error: `HTTP ${res.status}` };
    }
    const raw = await res.json();
    return parseTriggers(raw);
  } catch (err) {
    return { ok: false, data: new Map(), error: String(err) };
  }
}

function parseTriggers(raw: unknown): {
  ok: boolean;
  data: Map<string, ReadonlyArray<Trigger>>;
  error?: string;
} {
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, data: new Map(), error: 'not an object' };
  }
  const triggersField = (raw as Record<string, unknown>).triggers;
  if (triggersField == null || typeof triggersField !== 'object') {
    return { ok: false, data: new Map(), error: 'missing "triggers" object' };
  }
  const out = new Map<string, ReadonlyArray<Trigger>>();
  for (const [animKey, list] of Object.entries(
    triggersField as Record<string, unknown>,
  )) {
    if (!Array.isArray(list)) {
      return {
        ok: false,
        data: new Map(),
        error: `triggers["${animKey}"] is not an array`,
      };
    }
    const triggers: Trigger[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') {
        return {
          ok: false,
          data: new Map(),
          error: `triggers["${animKey}"] contains a non-object entry`,
        };
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.name !== 'string' || e.name.length === 0) {
        return {
          ok: false,
          data: new Map(),
          error: `triggers["${animKey}"] missing string "name"`,
        };
      }
      if (typeof e.soundId !== 'string' || e.soundId.length === 0) {
        return {
          ok: false,
          data: new Map(),
          error: `triggers["${animKey}"] missing string "soundId"`,
        };
      }
      if (
        typeof e.frameIndex !== 'number' ||
        !Number.isInteger(e.frameIndex) ||
        e.frameIndex < 1
      ) {
        return {
          ok: false,
          data: new Map(),
          error: `triggers["${animKey}"] invalid "frameIndex"`,
        };
      }
      let audioStartOffsetMs: number | undefined;
      if (e.audioStartOffsetMs !== undefined) {
        if (
          typeof e.audioStartOffsetMs !== 'number' ||
          !Number.isFinite(e.audioStartOffsetMs) ||
          e.audioStartOffsetMs < 0
        ) {
          return {
            ok: false,
            data: new Map(),
            error: `triggers["${animKey}"] invalid "audioStartOffsetMs"`,
          };
        }
        if (e.audioStartOffsetMs > 0) audioStartOffsetMs = e.audioStartOffsetMs;
      }
      triggers.push(
        audioStartOffsetMs === undefined
          ? { name: e.name, soundId: e.soundId, frameIndex: e.frameIndex }
          : {
              name: e.name,
              soundId: e.soundId,
              frameIndex: e.frameIndex,
              audioStartOffsetMs,
            },
      );
    }
    if (triggers.length > 0) out.set(animKey, triggers);
  }
  return { ok: true, data: out };
}

// Serializes the triggers map into the on-disk JSON shape, then POSTs it
// to the save endpoint. On 404 / network error falls back to a download
// of the file so the user can drop it into src/audio/ manually.
export async function saveTriggers(
  triggers: ReadonlyMap<string, ReadonlyArray<Trigger>>,
): Promise<SaveResult> {
  const payload: PersistedTriggers = {
    triggers: Object.fromEntries(triggers.entries()),
  };
  try {
    const res = await fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 404) {
      downloadJson('animationSoundTriggers.json', formatJson(payload));
      return { ok: true, mode: 'download', errors: [] };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        mode: 'endpoint',
        errors: [`${res.status}: ${text}`],
      };
    }
    return { ok: true, mode: 'endpoint', errors: [] };
  } catch {
    // Network unreachable — fall back to download.
    downloadJson('animationSoundTriggers.json', formatJson(payload));
    return { ok: true, mode: 'download', errors: [] };
  }
}

function formatJson(payload: PersistedTriggers): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
