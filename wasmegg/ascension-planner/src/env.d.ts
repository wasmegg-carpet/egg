/// <reference types="vite/client" />

/** Commit the simulator was built from, `-dirty` if uncommitted (vite.config.ts, scripts/simVersion.ts). */
declare const __SIM_VERSION__: string;

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
