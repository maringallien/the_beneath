/**
 * @file level/HotReloadBus.ts
 * @description Tiny pub/sub bridging Vite HMR to the scene lifecycle — the HMR layer publishes a raw LDtk JSON string and subscribers (typically one live scene) re-run their world-build pipeline; a trailing debounce collapses the per-save burst some editors/file-systems emit (write-temp-then-rename, multiple flushes) into exactly one rebuild; subscriber exceptions are isolated so one bad handler can't poison the others or kill the bus; dev-only by nature.
 * @module level
 */

const RELOAD_DEBOUNCE_MS = 120;

type LdtkUpdateHandler = (rawJson: string) => void;

const handlers = new Set<LdtkUpdateHandler>();
let pendingRaw: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * @function    flush
 * @description Fires the pending JSON to all subscribers; each runs in its own try/catch so one bad handler can't block others; no-op when nothing is pending.
 * @calledby src/level/HotReloadBus.ts → publishLdtkUpdate (via the debounce timer, once the rapid-save burst settles)
 * @calls    each registered subscriber, with a dev-only error log on a thrown handler
 */
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

/**
 * @function    publishLdtkUpdate
 * @description Publishes a new LDtk JSON string, restarting the debounce so rapid saves collapse into one flush; stores the JSON and (re)arms the debounce timer.
 * @param   rawJson  The latest raw LDtk JSON string.
 * @calledby src/ldtk/ldtkData.ts → the Vite HMR module-update path, when an LDtk source change is accepted
 * @calls    the timer machinery, which eventually fans out via flush
 */
export function publishLdtkUpdate(rawJson: string): void {
  pendingRaw = rawJson;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(flush, RELOAD_DEBOUNCE_MS);
}

/**
 * @function    subscribeLdtkUpdate
 * @description Registers a subscriber and returns its unsubscribe function (call on scene teardown).
 * @param   handler  A fn receiving the newest raw LDtk JSON on each flush.
 * @returns an unsubscribe fn that removes the handler from the subscriber set.
 * @calledby src/scenes/GameScene.ts → a scene wiring up its live-reload handler at setup
 * @calls    set add/delete on the subscriber registry; no further delegation
 */
export function subscribeLdtkUpdate(handler: LdtkUpdateHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
