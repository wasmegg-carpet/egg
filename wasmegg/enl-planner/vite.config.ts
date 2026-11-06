import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/enl-planner/',
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
