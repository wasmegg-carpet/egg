/**
 * Which build made or saved a plan, so a plan someone sends in can be traced to the code that
 * produced it.
 */

// Set by the ascension planner's vite config (scripts/simVersion.ts); undefined where no build
// defines it (the enlightenment planner, Node scripts), which `typeof` checks without throwing.
declare const __SIM_VERSION__: string | undefined;

export interface BuildStamp {
  /** The commit the code was built from (`2da01de4`, `-dirty` with uncommitted simulator code), or 'unknown'. */
  simVersion: string;
  /** Origin and path of the page that ran it, without the query or hash; null outside a browser. */
  site: string | null;
  /** When, as an ISO timestamp. */
  at: string;
}

export function buildStamp(): BuildStamp {
  return {
    simVersion: typeof __SIM_VERSION__ === 'string' ? __SIM_VERSION__ : 'unknown',
    site: typeof location === 'undefined' ? null : location.origin + location.pathname,
    at: new Date().toISOString(),
  };
}
