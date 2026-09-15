// HiGHS as WebAssembly (`highs`, lovasoa/highs-js): the loader, and the text interface it insists on.
// Options are applied *after* `Highs_readModel`, so nothing governing ingestion takes effect and `milp.ts`
// scales rows instead (SPEC.md section 3).

import highsLoader from 'highs';
import wasmUrl from 'highs/runtime?url';
import { INF, SOLVER_OPTIONS, type MilpModel, type MilpSolution, type MilpSolve } from './types';

// On Windows `wasmUrl` arrives as `/@fs/C:/...`, and stripping only the `/@fs`
// prefix leaves a leading slash the loader cannot open ahead of the drive letter,
// so the drive-letter branch strips that slash too.
const wasmLocation = (() => {
  if (typeof self !== 'undefined' || !wasmUrl.startsWith('/@fs/')) return wasmUrl;
  const path = wasmUrl.slice('/@fs'.length);
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
})();

let cached: Promise<MilpSolve> | null = null;

export function loadHighs(): Promise<MilpSolve> {
  cached ??= highsLoader({ locateFile: () => wasmLocation })
    .then((highs): MilpSolve => {
      return (model, limits) => {
        // Serialized outside the `try` on purpose: the backstop below is for HiGHS
        // throwing, not for laundering a crash in our own writer into `unknown`.
        const lp = writeLp(model);
        let raw: RawHighsSolution;
        try {
          raw = highs.solve(lp, {
            ...SOLVER_OPTIONS,
            mip_max_nodes: limits.maxNodes,
            mip_rel_gap: limits.relGap,
          } as Parameters<typeof highs.solve>[1]);
        } catch {
          // HiGHS can throw out of `Highs_run` on a model it reads perfectly well
          // ("HiGHS error -1"). See SPEC.md section 8.
          return { status: 'unknown', objective: 0, columnValues: new Float64Array(model.columnCount) };
        }
        return readSolution(model, raw);
      };
    })
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached;
}

// Shortest round-trippable form; the LP reader takes scientific notation.
function num(value: number): string {
  if (value >= INF) return '+inf';
  if (value <= -INF) return '-inf';
  return String(value);
}

function term(coefficient: number, column: number): string {
  return coefficient < 0 ? ` - ${num(-coefficient)} x${column}` : ` + ${num(coefficient)} x${column}`;
}

const TERMS_PER_LINE = 8;

function writeLp(model: MilpModel): string {
  const out: string[] = ['Maximize'];

  const objective: string[] = [];
  for (let j = 0; j < model.columnCount; j++) {
    if (model.objective[j] !== 0) objective.push(term(model.objective[j], j));
  }
  // An empty objective is legal but has no syntax; anchor it on a zero term.
  if (objective.length === 0) objective.push(' 0 x0');
  out.push(` obj:${objective[0]}`);
  for (let i = 1; i < objective.length; i += TERMS_PER_LINE) {
    out.push(objective.slice(i, i + TERMS_PER_LINE).join(''));
  }

  out.push('Subject To');
  for (let r = 0; r < model.rowCount; r++) {
    const start = model.offsets[r];
    const end = r + 1 < model.rowCount ? model.offsets[r + 1] : model.indices.length;
    if (end <= start) continue;
    const terms: string[] = [];
    for (let k = start; k < end; k++) terms.push(term(model.values[k], model.indices[k]));

    const lo = model.rowLower[r];
    const up = model.rowUpper[r];
    const relations: string[] =
      lo === up ? [`= ${num(lo)}`] : [...(up < INF ? [`<= ${num(up)}`] : []), ...(lo > -INF ? [`>= ${num(lo)}`] : [])];
    if (relations.length === 0) continue;

    relations.forEach((relation, i) => {
      out.push(` ${model.rowNames[r]}_${i}:${terms[0]}`);
      for (let k = 1; k < terms.length; k += TERMS_PER_LINE) {
        out.push(terms.slice(k, k + TERMS_PER_LINE).join(''));
      }
      out.push(` ${relation}`);
    });
  }

  out.push('Bounds');
  for (let j = 0; j < model.columnCount; j++) {
    const lo = model.columnLower[j];
    const up = model.columnUpper[j];
    if (lo === 0 && up >= INF) continue; // the format's default
    if (lo <= -INF && up >= INF) out.push(` x${j} free`);
    else out.push(` ${num(lo)} <= x${j} <= ${num(up)}`);
  }

  const integers: string[] = [];
  for (let j = 0; j < model.columnCount; j++) {
    if (model.columnIsInteger[j]) integers.push(`x${j}`);
  }
  if (integers.length > 0) {
    out.push('General');
    for (let i = 0; i < integers.length; i += 16) out.push(` ${integers.slice(i, i + 16).join(' ')}`);
  }

  out.push('End');
  return out.join('\n');
}

interface RawHighsSolution {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal?: number; Index?: number }>;
}

// Every status the wasm build can report (`highs/types.d.ts`), mapped by name. Enumerated rather than
// tested for the two or three that were expected: what fell through before was read as a plan whenever
// any primal came back, and 'Unbounded' comes back with one. An unbounded *scale* LP is reachable — a
// craftable with no children leaves its column with no upper bound (SPEC.md sections 2 and 4) — and its
// point is a waypoint on a ray, not a ceiling to measure sigma against.
const STATUS: Readonly<Record<string, MilpSolution['status']>> = {
  Optimal: 'optimal',
  Empty: 'optimal',
  Infeasible: 'infeasible',
  // HiGHS could not tell the two apart; either way there is no plan in it.
  'Primal infeasible or unbounded': 'infeasible',
  Unbounded: 'unbounded',
  // Stopped without a verdict on the model, which may still carry a real incumbent, so `hasPrimal`
  // decides below. 'Unknown' is not an edge case: this build reports it for *every* MIP solve, one that
  // exhausted the node limit (SPEC.md section 7) and one that closed the gap alike.
  Unknown: 'feasible',
  'Bound on objective reached': 'feasible',
  'Target for objective reached': 'feasible',
  'Time limit reached': 'feasible',
  'Iteration limit reached': 'feasible',
  // The solve never got far enough to mean anything; a primal left over from one of these is not a plan.
  'Not Set': 'unknown',
  'Load error': 'unknown',
  'Model error': 'unknown',
  'Presolve error': 'unknown',
  'Solve error': 'unknown',
  'Postsolve error': 'unknown',
};

function readSolution(model: MilpModel, solution: RawHighsSolution): MilpSolution {
  // Keyed by *name*, not the reported `Index` — see SPEC.md section 8.
  const columnValues = new Float64Array(model.columnCount);
  let hasPrimal = false;
  for (const [name, column] of Object.entries(solution.Columns)) {
    if (typeof column.Primal !== 'number') continue;
    const j = Number(name.slice(1));
    if (!Number.isInteger(j) || j < 0 || j >= model.columnCount) continue;
    columnValues[j] = column.Primal;
    hasPrimal = true;
  }

  // A status this build does not list is treated like a limit: it is what a newer HiGHS stopping for a
  // reason of its own looks like, and only the presence of a primal decides.
  const mapped = STATUS[solution.Status] ?? 'feasible';
  const status = mapped === 'feasible' && !hasPrimal ? 'unknown' : mapped;

  return { status, objective: solution.ObjectiveValue, columnValues };
}
