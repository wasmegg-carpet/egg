/**
 * The commit a table is built from, e.g. `2da01de4` (AutoAutoAP compares it with its own
 * `SIM_VERSION`), with `-dirty` when simulator code is uncommitted. Used by scripts/buildTable.ts
 * at run time and by vite.config.ts at build time (the Chain Finder's in-browser builds).
 * Run from the ascension-planner workspace directory.
 */
import { execSync } from 'node:child_process';

/** Code a cell depends on: a change here outside a commit is marked `-dirty` on the stamp. */
const SIM_PATHS = ['src/auto', 'src/engine', 'src/calculations', 'src/lib', 'src/buildTable', '../../lib'];

export function simVersion(): string {
  const hash = execSync('git rev-parse --short=8 HEAD', { encoding: 'utf8' }).trim();
  const dirty = execSync(`git status --porcelain -- ${SIM_PATHS.join(' ')}`, { encoding: 'utf8' }).trim();
  return dirty ? `${hash}-dirty` : hash;
}
