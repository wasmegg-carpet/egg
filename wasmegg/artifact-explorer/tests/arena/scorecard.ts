// Sweep driver and reporting. Correctness (invariant violations) and quality (the judged joint
// probability on the unperturbed instance) are measured apart; quality is in log10, spanning 1e-1 to 1e-19.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ArenaSolver } from './contract';
import { run, takeLayoutTally, type LayoutTally } from './harness';
import { generateInstance } from './instances';
import { runChecks, type Check, type InvariantId, type Violation, type ViolationId } from './invariants';

export interface InstanceResult {
  seed: number;
  label: string;
  targets: number;
  options: number;
  joint: number;
  // Wall clock of the single unperturbed solve, not of the whole check set.
  solveMs: number;
  checkMs: number;
  violations: Violation[];
  // Set when the instance was not solved at all: it has a sleep window and the candidate does not declare
  // sleep support. Such an instance has no joint, no latency and no violations, and counts as neither clean
  // nor failing.
  skipped?: string;
  // Checks that did not run on this instance, for the same reason.
  skippedChecks: InvariantId[];
}

export interface SweepResult {
  solverId: string;
  description: string;
  instances: InstanceResult[];
  totalMs: number;
  // What the candidate reported about laying its sleep-aware plans out, over every fresh solve of the sweep.
  layout: LayoutTally;
}

export function sweep(
  solver: ArenaSolver,
  seeds: number[],
  checks: Check[],
  onInstance?: (r: InstanceResult) => void
): SweepResult {
  const instances: InstanceResult[] = [];
  const started = Date.now();
  takeLayoutTally(solver.plan);
  for (const seed of seeds) {
    const inst = generateInstance(seed);
    if (inst.sleepSeconds > 0 && !solver.sleepAware) {
      const r: InstanceResult = {
        seed,
        label: inst.label,
        targets: inst.targets.length,
        options: 0,
        joint: 0,
        solveMs: 0,
        checkMs: 0,
        violations: [],
        skipped: 'sleep window on, candidate not sleep-aware',
        skippedChecks: [],
      };
      instances.push(r);
      onInstance?.(r);
      continue;
    }
    let solved;
    try {
      solved = run(solver.plan, inst);
    } catch (err) {
      instances.push({
        seed,
        label: inst.label,
        targets: inst.targets.length,
        options: 0,
        joint: 0,
        solveMs: 0,
        checkMs: 0,
        violations: [
          {
            invariant: 'C0-contract',
            instance: inst.label,
            detail: `solver threw: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        skippedChecks: [],
      });
      continue;
    }
    const t0 = Date.now();
    const { violations, skipped } = runChecks(solver.plan, inst, checks, solver.sleepAware ?? false);
    const r: InstanceResult = {
      seed,
      label: inst.label,
      targets: inst.targets.length,
      options: solved.problem.options.length,
      joint: solved.joint,
      solveMs: solved.elapsedMs,
      checkMs: Date.now() - t0,
      violations,
      skippedChecks: skipped,
    };
    instances.push(r);
    onInstance?.(r);
  }
  return {
    solverId: solver.id,
    description: solver.description,
    instances,
    totalMs: Date.now() - started,
    layout: takeLayoutTally(solver.plan),
  };
}

const log10 = (p: number) => (p > 0 ? Math.log10(p) : -Infinity);

interface InvariantTally {
  invariant: ViolationId;
  count: number;
  instances: number;
  worstNats: number;
  collapses: number; // a positive probability became exactly 0
  rescues: number; // exactly 0 became a positive probability
}

function tally(r: SweepResult): InvariantTally[] {
  const byId = new Map<string, InvariantTally>();
  for (const inst of r.instances) {
    const seen = new Set<string>();
    for (const v of inst.violations) {
      const t = byId.get(v.invariant) ?? {
        invariant: v.invariant,
        count: 0,
        instances: 0,
        worstNats: 0,
        collapses: 0,
        rescues: 0,
      };
      t.count++;
      if (!seen.has(v.invariant)) {
        t.instances++;
        seen.add(v.invariant);
      }
      if (v.nats !== undefined) {
        if (v.nats === -Infinity) t.collapses++;
        else if (v.nats === Infinity) t.rescues++;
        else if (Number.isFinite(v.nats) && Math.abs(v.nats) > Math.abs(t.worstNats)) {
          t.worstNats = v.nats;
        }
      }
      byId.set(v.invariant, t);
    }
  }
  return [...byId.values()].sort((a, b) => b.count - a.count);
}

function pad(s: string | number, n: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(n) : str.padEnd(n);
}

export function formatScorecard(r: SweepResult): string {
  const lines: string[] = [];
  const ran = r.instances.filter(i => i.skipped === undefined);
  const skippedInstances = r.instances.length - ran.length;
  const total = ran.reduce((a, i) => a + i.violations.length, 0);
  const clean = ran.filter(i => i.violations.length === 0).length;

  lines.push('');
  lines.push(`=== ${r.solverId} ===`);
  lines.push(`    ${r.description}`);
  lines.push(
    `    ${r.instances.length} instances` +
      (skippedInstances > 0 ? ` (${skippedInstances} skipped)` : '') +
      `, ${(r.totalMs / 1000).toFixed(1)}s total, ` +
      `${total} violation(s), ${clean}/${ran.length} instances clean`
  );
  if (skippedInstances > 0) {
    const reasons = [...new Set(r.instances.map(i => i.skipped).filter(Boolean))].join('; ');
    lines.push(`    skipped ${skippedInstances} instance(s), not solved: ${reasons}`);
  }
  const skippedChecks = new Map<string, number>();
  for (const i of ran) for (const id of i.skippedChecks) skippedChecks.set(id, (skippedChecks.get(id) ?? 0) + 1);
  for (const [id, n] of skippedChecks) {
    lines.push(`    skipped ${id} on ${n} instance(s): candidate not sleep-aware`);
  }

  const t = tally(r);
  if (t.length === 0) {
    lines.push('    no violations');
  } else {
    lines.push('');
    lines.push(
      `    ${pad('invariant', 22)}${pad('count', 7, true)}${pad('instances', 11, true)}${pad('worst finite', 16, true)}${pad('to/from zero', 16, true)}`
    );
    for (const row of t) {
      const worst = row.worstNats === 0 ? '-' : `${row.worstNats.toFixed(4)} nats`;
      const zeros =
        row.collapses === 0 && row.rescues === 0
          ? '-'
          : [row.collapses > 0 ? `${row.collapses}x p->0` : '', row.rescues > 0 ? `${row.rescues}x 0->p` : '']
              .filter(Boolean)
              .join(' ');
      lines.push(
        `    ${pad(row.invariant, 22)}${pad(row.count, 7, true)}${pad(row.instances, 11, true)}${pad(worst, 16, true)}${pad(zeros, 16, true)}`
      );
    }
  }

  const solveTimes = ran.map(i => i.solveMs).sort((a, b) => a - b);
  if (solveTimes.length > 0) {
    const q = (f: number) => solveTimes[Math.min(solveTimes.length - 1, Math.floor(f * solveTimes.length))];
    lines.push('');
    lines.push(
      `    solve latency: median ${q(0.5).toFixed(0)}ms, p90 ${q(0.9).toFixed(0)}ms, max ${solveTimes[solveTimes.length - 1].toFixed(0)}ms`
    );
  }

  const lt = r.layout;
  if (lt.solves > 0) {
    lines.push(
      `    layout (candidate-reported, ${lt.solves} fresh sleep-on solve(s)): ${lt.plansTrimmed} plan(s) trimmed, ` +
        `${lt.launchesTrimmed} launch(es) dropped (${lt.overnightTrimmed} overnight), ${lt.layoutSolves} layout MILP(s) ` +
        `(${lt.marginResolves} margin re-solve(s)), ${lt.verifierRetries} verifier retr${lt.verifierRetries === 1 ? 'y' : 'ies'}`
    );
  }

  const finite = ran.filter(i => i.joint > 0);
  const zero = ran.length - finite.length;
  if (finite.length > 0) {
    const meanLog = finite.reduce((a, i) => a + log10(i.joint), 0) / finite.length;
    lines.push(
      `    quality: mean log10(joint) ${meanLog.toFixed(3)} over ${finite.length} scoring instance(s)` +
        (zero > 0 ? `, ${zero} at exactly 0` : '')
    );
  }
  return lines.join('\n');
}

// Head-to-head on the unperturbed instance. A positive log10 delta means `b` found the better plan.
export function formatComparison(a: SweepResult, b: SweepResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`=== ${b.solverId} vs ${a.solverId} (plan quality on the unperturbed instance) ===`);
  lines.push('');
  const w = Math.max(16, a.solverId.length + 2, b.solverId.length + 2);
  lines.push(
    `    ${pad('instance', 12)}${pad('T', 4, true)}${pad('opts', 7, true)}${pad(a.solverId, w, true)}${pad(b.solverId, w, true)}${pad('delta log10', 14, true)}`
  );

  const bySeed = new Map(a.instances.map(i => [i.seed, i]));
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let sumDelta = 0;
  let counted = 0;
  for (const ib of b.instances) {
    const ia = bySeed.get(ib.seed);
    if (!ia) continue;
    if (ia.skipped !== undefined || ib.skipped !== undefined) {
      lines.push(`    ${pad(ib.label, 12)}${pad(ib.targets, 4, true)}    skipped (${ib.skipped ?? ia.skipped})`);
      continue;
    }
    const la = log10(ia.joint);
    const lb = log10(ib.joint);
    let delta: string;
    if (!Number.isFinite(la) && !Number.isFinite(lb)) {
      delta = 'both 0';
      ties++;
    } else if (!Number.isFinite(la)) {
      delta = '+inf';
      wins++;
    } else if (!Number.isFinite(lb)) {
      delta = '-inf';
      losses++;
    } else {
      const d = lb - la;
      delta = d.toFixed(4);
      sumDelta += d;
      counted++;
      if (d > 1e-9) wins++;
      else if (d < -1e-9) losses++;
      else ties++;
    }
    lines.push(
      `    ${pad(ib.label, 12)}${pad(ib.targets, 4, true)}${pad(ib.options, 7, true)}` +
        `${pad(ia.joint.toExponential(3), w, true)}${pad(ib.joint.toExponential(3), w, true)}${pad(delta, 14, true)}`
    );
  }
  lines.push('');
  lines.push(
    `    ${b.solverId} better on ${wins}, worse on ${losses}, tied on ${ties}` +
      (counted > 0
        ? `; mean delta ${(sumDelta / counted).toFixed(4)} log10 over ${counted} comparable instance(s)`
        : '')
  );
  return lines.join('\n');
}

export function writeResults(dir: string, r: SweepResult): string {
  const path = resolve(dir, `${r.solverId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  // JSON has no infinity, and `JSON.stringify` silently writes `null` for one.
  writeFileSync(
    path,
    JSON.stringify(r, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 2)
  );
  return path;
}
