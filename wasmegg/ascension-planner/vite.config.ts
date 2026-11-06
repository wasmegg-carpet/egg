import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { simVersion } from './scripts/simVersion';

/** Stamps the Table Builder's tables; a checkout without git (or git itself) failing shouldn't break the build. */
function simVersionOrUnknown(): string {
  try {
    return simVersion();
  } catch {
    return 'unknown';
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ascension-planner/',
  define: {
    __SIM_VERSION__: JSON.stringify(simVersionOrUnknown()),
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [vue(), vueJsx()],
  build: {
    chunkSizeWarningLimit: 2000,
  },

  server: {
    host: true,
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ['warn', 'error'],
    },
  },
});
