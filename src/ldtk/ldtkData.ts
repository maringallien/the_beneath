import ldtkRaw from '../../the_beneath.ldtk?raw';
import { publishLdtkUpdate } from '../level/HotReloadBus';

/**
 * @file ldtk/ldtkData.ts
 * @description Re-exports the bundled .ldtk file's raw string (Vite ?raw) as the one source the level loader parses, and registers the dev-only HMR accept callback that forwards fresh level JSON onto the HotReloadBus — the single place import.meta.hot is touched, keeping it out of gameplay code.
 * @module ldtk
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
