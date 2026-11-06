import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  // vite.config.ts stamps the real commit; tests only need the global to exist.
  define: {
    __SIM_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    // Shared planner code lives in lib/planners; its specs run under both planners.
    include: ['src/**/*.{test,spec}.ts', '../../lib/planners/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    },
  },
});
