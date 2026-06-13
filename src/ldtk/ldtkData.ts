import ldtkRaw from '../../the_beneath.ldtk?raw';
import { publishLdtkUpdate } from '../level/HotReloadBus';

/**
 * ldtkData — the raw LDtk project JSON plus its hot-reload wiring.
 *
 * Re-exports the level file's raw string (imported via Vite's `?raw`) as the
 * one source the level loader parses, and registers the dev-only HMR accept
 * callback. Routing edits through the HotReloadBus keeps `import.meta.hot` out
 * of the gameplay code — this module is the only place that touches it.
 *
 * Inputs:  the bundled .ldtk file (?raw); Vite HMR updates in dev.
 * Outputs: the ldtkRaw string; forwarded level updates onto the hot-reload bus.
 * @calledby the level loader at startup; the dev server on a .ldtk file change.
 * @calls    the hot-reload bus to broadcast fresh level JSON.
 */
export { ldtkRaw };

// Vite watches the ?raw import dependency; when the .ldtk file changes the
// dev server re-evaluates this module and the accept callback fires with the
// fresh raw JSON. We forward it to the HotReloadBus instead of touching the
// scene directly to keep `import.meta.hot` out of game code.
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (!newModule) return;
    const raw = (newModule as { ldtkRaw?: unknown }).ldtkRaw;
    if (typeof raw === 'string') {
      publishLdtkUpdate(raw);
    }
  });
}
