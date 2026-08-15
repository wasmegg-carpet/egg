// The arena is only worth running if the harness and the candidates cannot see each other. That is a
// property of the import graph, so it is asserted here rather than left to review. See ARENA.md.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ARENA = __dirname;
const TESTS = resolve(ARENA, '..');
const SRC = resolve(TESTS, '../src');
const LIB = join(SRC, 'lib');
// The shared spec fixtures. `optimize` there runs the planner in-process, so it is as much a way to reach
// the incumbent as `src/lib` is, and candidates are held away from both.
const UNIT = join(TESTS, 'unit');
const SOLVERS = join(ARENA, 'solvers');

function readSource(rel: string): string {
  return readFileSync(resolve(ARENA, rel), 'utf8');
}

function importsOf(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = bare.exec(source)) !== null) out.push(m[1]);
  const dynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamic.exec(source)) !== null) out.push(m[1]);
  const reexport = /(?:^|\n)\s*export\s[^;]*?from\s+['"]([^'"]+)['"]/g;
  while ((m = reexport.exec(source)) !== null) out.push(m[1]);
  return out;
}

// Type-only imports move no code and are not a coupling; this strips the two statement forms erased
// wholesale. An inline `import { type X }` is still reported, erring toward over-flagging.
function valueImportsOf(source: string): string[] {
  const withoutTypeImports = source
    .replace(/(?:^|\n)\s*import\s+type\s[^;]*?;/g, '\n')
    .replace(/(?:^|\n)\s*export\s+type\s[^;]*?from\s+['"][^'"]+['"]\s*;/g, '\n');
  return importsOf(withoutTypeImports);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  const bare = spec.split('?')[0];
  let base: string;
  if (bare.startsWith('@/')) base = join(SRC, bare.slice(2));
  else if (bare.startsWith('./') || bare.startsWith('../')) base = resolve(dirname(fromFile), bare);
  else return null;
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts'), `${base}.vue`, `${base}.json`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function within(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
}

function libModules(): string[] {
  return walk(LIB)
    .filter(p => !p.endsWith('.spec.ts'))
    .map(p => relative(LIB, p).split(sep).join('/'))
    .sort();
}

// Files that make up the fixed part of the arena: the problem, the rules, the
// judge and the scoreboard.
const HARNESS_FILES = [
  'contract.ts',
  'harness.ts',
  'instances.ts',
  'invariants.ts',
  'pack-feasibility.ts',
  'scorecard.ts',
];

// The planner and everything downstream of it. The harness must not run any of
// this: it is the thing being measured.
const IMPLEMENTATION = [
  'concave.ts', // the objective's own g/g'/line search; the judge re-derives all three
  'lp.ts', // the incumbent's LP
  'optimizer-client.ts', // worker-backed entry point to the planner
  'optimizer-core.ts', // the plan pipeline; calls the planner
  // Prices a finished plan and derives the cap's per-craft prices from the same curve. Everything here
  // reads a plan, so the module sits downstream.
  'optimizer-cost.ts',
  'optimizer-tree.ts', // craft-tree assembly from a plan
  'optimizer-views.ts', // render models built from a plan
  'optimizer-worker-protocol.ts',
  'optimizer.worker.ts',
  'packing.ts', // the app's packer — the arena has its own, on purpose
  'solver/evaluator.ts', // objective evaluation; the judge is re-derived, not shared
  'solver/highs.ts',
  'solver/milp.ts',
  'solver/model.ts',
  'solver/oa.ts',
  'solver/simplex.ts',
  'solver/types.ts',
  'value-function.ts',
];

// Game data, problem construction and pure types. The harness needs these to state a problem at all, and
// none of them decide anything about a plan.
const PROBLEM_SURFACE = [
  'artifacts.ts',
  'filter.ts',
  'index.ts',
  'loot-json.ts',
  'loot.ts',
  'missions.ts',
  'phases.ts',
  'tank-ids.ts',
  'types.ts',
];

// The entries allowed to import production code, because they *are* production code: each is a shim around
// `src/lib/solver/`. The exception stays narrow — only into `src/lib/solver/`, and only for a file that does
// no solving of its own, which the shim check below enforces on every entry in this list.
const SHIM_ENTRIES = [join(SOLVERS, 'highs', 'index.ts')];
const SHIMS_MAY_IMPORT = join(LIB, 'solver');

describe('arena independence', () => {
  it('the src/lib classification is exhaustive and has no dead entries', () => {
    const classified = [...IMPLEMENTATION, ...PROBLEM_SURFACE].sort();
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified).toEqual(libModules());
    // The planner specifically must be on the forbidden side, whatever else moves.
    expect(IMPLEMENTATION).toContain('optimizer-core.ts');
    expect(IMPLEMENTATION.filter(m => m.startsWith('solver/')).length).toBeGreaterThan(0);
  });

  it('the harness imports no solver implementation', () => {
    const forbidden = new Set(IMPLEMENTATION.map(m => join(LIB, m)));
    const offenders: string[] = [];
    for (const file of HARNESS_FILES) {
      const from = resolve(ARENA, file);
      for (const spec of valueImportsOf(readSource(file))) {
        const target = resolveSpec(from, spec);
        if (target !== null && forbidden.has(target)) offenders.push(`${file} imports ${spec}`);
        if (spec.includes('/solvers/') || spec.includes('./solvers') || spec.includes('registry')) {
          offenders.push(`${file} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the harness names no solver', () => {
    // `registry.ts` is the only file allowed to know which candidates exist. Code only: a comment may cite
    // `src/lib/solver/SPEC.md` as the document an invariant was argued in.
    const offenders: string[] = [];
    for (const file of HARNESS_FILES) {
      const src = stripComments(readSource(file));
      if (/\bhighs\b/.test(src)) offenders.push(`${file} mentions a solver id`);
    }
    expect(offenders).toEqual([]);
  });

  it('no solver imports the judge, the feasibility rule or the checks', () => {
    const forbidden = ['evaluate', 'pack-feasibility', 'invariants', 'scorecard', 'harness', 'instances'];
    const offenders: string[] = [];
    for (const path of walk(SOLVERS)) {
      for (const spec of valueImportsOf(readFileSync(path, 'utf8'))) {
        if (forbidden.some(bad => spec.includes(bad))) {
          offenders.push(`${path.slice(ARENA.length + 1)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('candidates re-derive everything: no value import from src/lib or tests/unit', () => {
    // Types move no code. What is excluded is running any of the incumbent's machinery — its LP, its tangent
    // grid, its packer, its search. `SHIM_ENTRIES` is a named exception; everything else here is still forbidden.
    //
    // `tests/unit` is barred on the same grounds as `src/lib`, not as a tidiness rule: `spec-helpers.ts`
    // there calls `optimizeFull`, so a candidate reaching it would be the incumbent measured against itself.
    const offenders: string[] = [];
    for (const path of walk(SOLVERS)) {
      const rel = path.slice(SOLVERS.length + 1);
      for (const spec of valueImportsOf(readFileSync(path, 'utf8'))) {
        const target = resolveSpec(path, spec);
        if (target === null || !(within(LIB, target) || within(UNIT, target))) continue;
        if (SHIM_ENTRIES.includes(path) && within(SHIMS_MAY_IMPORT, target)) continue;
        offenders.push(`${rel} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shim entries are shims and nothing more', () => {
    // The exception above is only safe while the files it exempts contain no solving of their own. Pinned on
    // every exempted file rather than the first, so adding an entry cannot smuggle logic in with it.
    for (const entry of SHIM_ENTRIES) {
      expect(existsSync(entry), `${entry} is listed as a shim but does not exist`).toBe(true);
      const code = readFileSync(entry, 'utf8')
        .split('\n')
        .filter(line => !/^\s*(\/\/|$)/.test(line))
        .join('\n');
      expect(code.length, entry).toBeLessThan(700);
      expect(/\bfor\s*\(|\bwhile\s*\(|\bfunction\b/.test(code), entry).toBe(false);
      // It must go through the same entry points `optimizer-core.ts` does.
      expect(code, entry).toContain("from '@/lib/solver/oa'");
      expect(code, entry).toContain("from '@/lib/solver/highs'");
    }
  });

  it('production never imports the arena', () => {
    // Widened with the move: production may not reach into `tests/` at all, of which the arena is one part.
    const offenders: string[] = [];
    for (const path of walk(LIB)) {
      for (const spec of importsOf(readFileSync(path, 'utf8'))) {
        const target = resolveSpec(path, spec);
        if (target !== null && within(TESTS, target)) {
          offenders.push(`${relative(SRC, path)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the feasibility rule stands alone', () => {
    // It is the goalpost for C1 and for every k-opt move, so it must not be
    // reachable from anything a candidate can change.
    expect(importsOf(readSource('pack-feasibility.ts'))).toEqual([]);
  });

  it('every registered solver has a distinct id', () => {
    return import('./registry').then(({ SOLVERS: registered }) => {
      const ids = registered.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every(id => /^[a-z0-9-]+$/.test(id))).toBe(true);
    });
  });
});
