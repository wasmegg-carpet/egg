// The arena is only worth running if the harness and the candidates cannot see each other. That is a
// property of the import graph, so it is asserted here rather than left to review. See ARENA.md.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ARENA = __dirname;
const TESTS = resolve(ARENA, '..');
const SRC = resolve(TESTS, '../src');
// The optimizer is shared with the ascension planner and lives in the workspace's `lib`.
const LIB = resolve(TESTS, '../../../lib/mission-optimizer');
const LIB_SPEC = 'lib/mission-optimizer';
// The explorer's own barrel re-exports the shared one, so it is as much a way in as `LIB` is.
const APP_LIB = join(SRC, 'lib');
// The shared spec fixtures. `optimize` there runs the planner in-process, so it is as much a way to reach
// the incumbent as `lib/mission-optimizer` is, and candidates are held away from both.
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
  else if (bare === LIB_SPEC || bare.startsWith(`${LIB_SPEC}/`)) base = join(LIB, bare.slice(LIB_SPEC.length));
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
  'calendar.ts',
  'capacity.ts',
  'contract.ts',
  'harness.ts',
  'instances.ts',
  'invariants.ts',
  'pack-feasibility.ts',
  'scorecard.ts',
  'sleep.ts',
];

// The planner and everything downstream of it. The harness must not run any of
// this: it is the thing being measured.
const IMPLEMENTATION = [
  'capacity.ts', // the app's 2x capacity variants; the arena states its problems with its own `capacity.ts`
  'objective.ts', // the objective's own g/g'/line search and the craft-count-to-probability step; the judge re-derives all three
  'optimizer-client.ts', // worker-backed entry point to the planner
  'optimizer-core.ts', // the plan pipeline; calls the planner
  // Prices a finished plan and derives the cap's per-craft prices from the same curve. Everything here
  // reads a plan, so the module sits downstream.
  'optimizer-cost.ts',
  'fueling.ts', // the apps' fueling rate from a tank size; the arena states its pad with its own rate in `instances.ts`
  'optimizer-tree.ts', // craft-tree assembly from a plan
  'optimizer-views.ts', // render models built from a plan
  'optimizer-worker-protocol.ts',
  'optimizer.worker.ts',
  // The ascension-planner seam. `write.ts` projects a finished plan; the other two read the file
  // that supplies one's budgets. None of it is anything the arena states a problem with.
  'plan/read.ts',
  'plan/schema.ts',
  'plan/write.ts',
  'schedule-settings.ts', // the apps' sleep and 2x event settings, bounded by `sleep.ts` and `capacity.ts`
  'sleep.ts', // the app's sleep variants and capacities; the arena states its problems with its own `sleep.ts`
  'solver/days.ts',
  'solver/evaluator.ts', // objective evaluation; the judge is re-derived, not shared
  'solver/highs.ts',
  'solver/layout.ts',
  'solver/milp.ts',
  'solver/model.ts',
  'solver/pad.ts', // the planner's fueling-pad schedule; the arena checks the pad rule with `calendar.ts` instead
  'solver/simplex.ts',
  'solver/solve.ts',
  'solver/types.ts',
  'solver/verify.ts', // the planner's own calendar verifier; the arena verifies with `calendar.ts` instead
];

// Game data, problem construction and pure types. The harness needs these to state a problem at all, and
// none of them decide anything about a plan.
const PROBLEM_SURFACE = [
  'artifact-catalog.ts',
  'effort.ts',
  'index.ts',
  'loot-data.d.ts', // what the type checker sees in place of the dataset; no code
  'loot-json.ts',
  'loot.ts',
  'missions.ts',
  'player-data.ts',
  'problem-inputs.ts',
  'types.ts',
];

// The entries allowed to import production code, because they *are* production code: each is a shim around
// `lib/mission-optimizer/solver/`. The exception stays narrow — only into `lib/mission-optimizer/solver/`, and only for a file that does
// no solving of its own, which the shim check below enforces on every entry in this list.
const SHIM_ENTRIES = [join(SOLVERS, 'highs', 'index.ts')];
const SHIMS_MAY_IMPORT = join(LIB, 'solver');

describe('arena independence', () => {
  it('the lib/mission-optimizer classification is exhaustive and has no dead entries', () => {
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
    // `lib/mission-optimizer/solver/SPEC.md` as the document an invariant was argued in.
    const offenders: string[] = [];
    for (const file of HARNESS_FILES) {
      const src = stripComments(readSource(file));
      if (/\bhighs\b/.test(src)) offenders.push(`${file} mentions a solver id`);
    }
    expect(offenders).toEqual([]);
  });

  it('no solver imports the judge, the feasibility rule or the checks', () => {
    const forbidden = [
      'evaluate',
      'pack-feasibility',
      'invariants',
      'scorecard',
      'harness',
      'instances',
      '/sleep',
      '/calendar',
      '/capacity',
    ];
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

  it('candidates re-derive everything: no value import from lib/mission-optimizer or tests/unit', () => {
    // Types move no code. What is excluded is running any of the incumbent's machinery — its LP, its tangent
    // grid, its packer, its search. `SHIM_ENTRIES` is a named exception; everything else here is still forbidden.
    //
    // `tests/unit` is barred on the same grounds as `lib/mission-optimizer`, not as a tidiness rule: `spec-helpers.ts`
    // there calls `optimizeFull`, so a candidate reaching it would be the incumbent measured against itself.
    const offenders: string[] = [];
    for (const path of walk(SOLVERS)) {
      const rel = path.slice(SOLVERS.length + 1);
      for (const spec of valueImportsOf(readFileSync(path, 'utf8'))) {
        const target = resolveSpec(path, spec);
        if (target === null || !(within(LIB, target) || within(APP_LIB, target) || within(UNIT, target))) continue;
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
      expect(code, entry).toContain("from 'lib/mission-optimizer/solver/solve'");
      expect(code, entry).toContain("from 'lib/mission-optimizer/solver/highs'");
    }
  });

  it('production never imports the arena', () => {
    // Widened with the move: production may not reach into `tests/` at all, of which the arena is one part.
    const offenders: string[] = [];
    // Both halves of production: the shared optimizer and what the explorer keeps of its own.
    for (const root of [LIB, APP_LIB]) {
      for (const path of walk(root)) {
        for (const spec of importsOf(readFileSync(path, 'utf8'))) {
          const target = resolveSpec(path, spec);
          if (target !== null && within(TESTS, target)) {
            offenders.push(`${relative(root, path)} imports ${spec}`);
          }
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

  it('the sleep model stands alone', () => {
    // It decides what a launch costs once the player sleeps, which is as much the goalpost as the packer.
    expect(importsOf(readSource('sleep.ts'))).toEqual([]);
  });

  it('the capacity model stands alone', () => {
    // It decides what a doubled launch yields, which is as much the goalpost as the sleep model.
    expect(importsOf(readSource('capacity.ts'))).toEqual([]);
  });

  it('the calendar verifier stands alone', () => {
    // C1 for a sleep-aware problem. Sharing anything with the planner's own verifier (`lib/mission-optimizer/solver/verify.ts`)
    // or its layout would let a wrong rule pass on both sides at once.
    expect(importsOf(readSource('calendar.ts'))).toEqual([]);
    const code = stripComments(readSource('calendar.ts'));
    expect(/verify|layout|slotFault/.test(code)).toBe(false);
  });

  it('every registered solver has a distinct id', () => {
    return import('./registry').then(({ SOLVERS: registered }) => {
      const ids = registered.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every(id => /^[a-z0-9-]+$/.test(id))).toBe(true);
    });
  });
});
