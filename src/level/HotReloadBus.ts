// Decouples Vite HMR's module-scoped accept callback from Phaser's scene-scoped
// lifecycle. The HMR layer publishes a new raw LDtk JSON string here;
// subscribers (typically a single GameScene instance) re-run their world-build
// pipeline. A trailing debounce collapses bursts of file-change events that
// some editors/file-systems emit when saving (write-temp-then-rename, multiple
// flushes), preventing duplicate teardowns within a single LDtk save.

const RELOAD_DEBOUNCE_MS = 120;

type LdtkUpdateHandler = (rawJson: string) => void;

const handlers = new Set<LdtkUpdateHandler>();
let pendingRaw: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (pendingRaw === null) return;
  const raw = pendingRaw;
  pendingRaw = null;
  debounceTimer = null;
  for (const handler of handlers) {
    try {
      handler(raw);
    } catch (error) {
      // One bad subscriber must not poison sibling subscribers; surface the
      // error in dev so the user notices, but keep the bus alive.
      if (import.meta.env.DEV) {
        console.error('[HotReloadBus] subscriber threw:', error);
      }
    }
  }
}

export function publishLdtkUpdate(rawJson: string): void {
  pendingRaw = rawJson;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(flush, RELOAD_DEBOUNCE_MS);
}

export function subscribeLdtkUpdate(handler: LdtkUpdateHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
