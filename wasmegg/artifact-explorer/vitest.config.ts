import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// The arena is opt-in, via `ARENA`. `pnpm arena` sets it; `pnpm test` does not.
//
// Excluded here rather than skipped inside the spec, because a skip still pays for the file's imports: the
// roster awaits the 3.4MB HiGHS wasm at module scope and the instance generator pulls in the ~18MB loot
// dataset, which is 90 seconds before a single `describe` callback runs.
const ARENA_REQUESTED = process.env.ARENA !== undefined;

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Only the sweep itself. Excluding the whole of `src/oracle/` would silently retire the plain unit tests
    // and the self-gating ones — including the specs `arena:check`, `repro` and `test:oracle` name directly,
    // which would then select no files at all and exit non-zero.
    exclude: [...configDefaults.exclude, ...(ARENA_REQUESTED ? [] : ['src/oracle/arena/invariants.spec.ts'])],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    },
  },
});
