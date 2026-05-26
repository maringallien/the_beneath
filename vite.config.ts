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
    open: true
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
