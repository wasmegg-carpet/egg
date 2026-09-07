import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// The arena is opt-in, via `ARENA`. `pnpm arena` sets it; `pnpm test` does not.
//
// Excluded here rather than skipped inside the spec, because a skip still pays for the file's imports: the
// roster awaits the 3.4MB HiGHS wasm at module scope and the instance generator pulls in the ~18MB loot
// dataset, which is 90 seconds before a single `describe` callback runs.
const ARENA_REQUESTED = process.env.ARENA !== undefined;

// `tests/arena/invariants.spec.ts`. Kept as a constant because getting it wrong fails open: a stale path
// matches nothing, the exclude silently does nothing, and `pnpm test` starts running the 12-minute sweep.
const ARENA_SWEEP = 'tests/arena/invariants.spec.ts';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    // Only the sweep itself. Excluding the whole of `tests/arena/` would silently retire the arena's own
    // checks — including the spec `arena:check` names directly, which would then select no files at all and
    // exit non-zero.
    exclude: [...configDefaults.exclude, ...(ARENA_REQUESTED ? [] : [ARENA_SWEEP])],
    coverage: {
      provider: 'v8',
      // `src/` is production only, so this needs no spec exclusion: the tests live under `tests/`.
      include: ['src/**/*.ts'],
    },
  },
});
