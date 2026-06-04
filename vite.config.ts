import { defineConfig } from 'vite';
import { animResizerSavePlugin } from './tools/anim-resizer/save-plugin.mjs';
import { animSoundAlignerSavePlugin } from './tools/anim-sound-aligner/save-plugin.mjs';

export default defineConfig({
  base: './',
  // Both save plugins self-restrict via `apply: 'serve'` so they're no-ops
  // in production builds — listing them here at the top level is fine.
  plugins: [animResizerSavePlugin(), animSoundAlignerSavePlugin()],
  server: {
    port: 3000,
    open: true,
    watch: {
      // The game watches the_beneath.ldtk through the `?raw` import in
      // src/ldtk/ldtkData.ts, which puts it in Vite's module graph. But the
      // file is ~8 MB and LDtk rewrites the whole thing on every save, so the
      // default watcher can fire the change event mid-write — Vite then reads a
      // truncated JSON string and the HMR handler (onLdtkChange) skips the
      // reload. awaitWriteFinish makes chokidar wait until the file size stops
      // changing before emitting, so a Save in LDtk reliably hot-reloads the
      // level (terrain, entities, and the General_enemy_spawn reinforcement
      // markers) instead of intermittently dropping the update.
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100
      }
    }
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    // Multi-page setup so each /tools/*.html ships as its own bundled
    // entry alongside the game. Relative paths are resolved against this
    // config file's directory by Vite.
    rollupOptions: {
      input: {
        main: 'index.html',
        'anim-resizer': 'tools/anim-resizer.html',
        'anim-sound-aligner': 'tools/anim-sound-aligner.html'
      }
    }
  }
});
