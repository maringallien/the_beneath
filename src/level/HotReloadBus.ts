/**
 * HotReloadBus — a tiny pub/sub that bridges Vite HMR to the scene lifecycle.
 *
 * Decouples HMR's module-scoped accept callback from Phaser's scene-scoped
 * lifecycle: the HMR layer publishes a new raw LDtk JSON string, and subscribers
 * (typically a single live scene) re-run their world-build pipeline. A trailing
 * debounce collapses the burst of file-change events some editors/file-systems
 * emit per save (write-temp-then-rename, multiple flushes) so one save triggers
 * exactly one rebuild. Subscriber exceptions are isolated so one bad handler
 * can't poison the others or kill the bus. Dev-only by nature.
 *
 * Inputs:  raw LDtk JSON strings from the HMR accept callback; subscriber fns.
 * Outputs: debounced fan-out of the latest JSON to every live subscriber.
 * @calledby the Vite HMR module-update path (publish) and a scene wiring up its
 *           live-reload handler (subscribe).
 * @calls    each registered subscriber with the newest raw JSON.
 */

const RELOAD_DEBOUNCE_MS = 120;

type LdtkUpdateHandler = (rawJson: string) => void;

const handlers = new Set<LdtkUpdateHandler>();
let pendingRaw: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Fires the pending JSON to all subscribers; each runs in its own try/catch so one bad handler can't block others.
function flush(): void {
  if (pendingRaw === null) return;
  const raw = pendingRaw;
  pendingRaw = null;
  debounceTimer = null;
  for (const handler of handlers) {
    try {
      handler(raw);
    } catch (error) {
      // Isolate bad subscribers; log in dev but keep the bus running.
      if (import.meta.env.DEV) {
        console.error('[HotReloadBus] subscriber threw:', error);
      }
    }
  }
}

// Publishes a new LDtk JSON string, restarting the debounce so rapid saves collapse into one flush.
export function publishLdtkUpdate(rawJson: string): void {
  pendingRaw = rawJson;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(flush, RELOAD_DEBOUNCE_MS);
}

// Registers a subscriber and returns its unsubscribe function (call on scene teardown).
export function subscribeLdtkUpdate(handler: LdtkUpdateHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
