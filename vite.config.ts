import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
    chunkSizeWarningLimit: 2000
  }
});
