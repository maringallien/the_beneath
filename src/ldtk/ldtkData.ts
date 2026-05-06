import ldtkRaw from '../../the_beneath.ldtk?raw';
import { publishLdtkUpdate } from '../level/HotReloadBus';

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
