// The arena roster: one line per candidate. Nothing else in the harness needs to know a candidate exists,
// and the harness never imports a solver module directly. Baseline first — `formatComparison` reads `SOLVERS[0]`.

import type { ArenaSolver } from './contract';
import { highs } from './solvers/highs';

export const SOLVERS: ArenaSolver[] = [highs];

export function selectedSolvers(): ArenaSolver[] {
  const spec = process.env.SOLVER;
  if (!spec) return SOLVERS;
  return spec
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(id => {
      const found = SOLVERS.find(s => s.id === id);
      if (!found) {
        throw new Error(`unknown solver "${id}"; registered: ${SOLVERS.map(s => s.id).join(', ')}`);
      }
      return found;
    });
}
