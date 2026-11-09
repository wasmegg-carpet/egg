import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Bundles scripts/buildTable.ts into a Node-runnable ESM file. SSR mode reuses the app's own module
 * resolution (`@/`, the `lib` workspace), so the table is built by exactly the simulation code the
 * browser runs. `ssr.noExternal` bundles workspace packages that Node couldn't resolve as bare
 * imports.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      lib: fileURLToPath(new URL('../../lib', import.meta.url)),
    },
  },
  ssr: {
    noExternal: true,
    target: 'node',
  },
  build: {
    ssr: true,
    outDir: 'dist-scripts',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: { buildTable: 'scripts/buildTable.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
});
