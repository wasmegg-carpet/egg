// Reproduction tool for oracle findings: dumps the exact `optimizeFull` inputs behind a finding, plus the
// solver's plan and the oracle's (`pnpm repro random-single:1234`). Run under `vitest.config.ts` rather than
// `vite.config.ts`, because the app config's `base` makes `highs/runtime?url` resolve to a prefixed path the
// wasm loader cannot open outside a browser.

import { optimizeFull } from '@/lib/optimizer-core';
import { bruteForceBestJoint } from './enumerate';
import { evaluateAllocationJoint, OracleInstance } from './evaluate';
import { FAMILIES, Family, generateInstance } from './generate';

const SPEC = process.argv[2] ?? process.env.ORACLE_REPRO ?? '';

function fmtAlloc(inst: OracleInstance, alloc: number[]): string {
  const parts: string[] = [];
  alloc.forEach((k, i) => {
    if (k > 0) {
      parts.push(`${k} ships of ${inst.options[i].id}`);
    }
  });
  return parts.length ? parts.join(', ') : '(launch nothing)';
}

async function main(): Promise<void> {
  const [family, seedStr] = SPEC.split(':');
  if (!FAMILIES.includes(family as Family) || !/^\d+$/.test(seedStr ?? '')) {
    throw new Error(`usage: pnpm repro <family>:<seed>, e.g. random-single:1234 (families: ${FAMILIES.join(', ')})`);
  }
  const inst = generateInstance(family as Family, Number(seedStr));
  if (!inst) {
    throw new Error(`${SPEC} generates no instance (rejected as oversized or decision-free)`);
  }

  console.log(`\n=== instance ${SPEC} ===`);
  console.log(`targets: ${inst.targets.join(', ')}`);
  console.log(`fuelCapacity: ${inst.fuelCapacity}`);
  console.log(`timeCapacityPerSlot: ${inst.timeCapacityPerSlot} s`);
  console.log(`baseYield: ${JSON.stringify([...inst.baseYield])}`);
  console.log('options (the ONLY missions the solver was offered):');
  for (const o of inst.options) {
    console.log(
      `  ${o.id}: fuel/ship=${o.actualFuel}, time/ship=${o.actualTime}s, ` +
        `yield=${JSON.stringify([...o.yieldVector])}, legendary=${JSON.stringify([...o.legendaryYieldVector])}`
    );
  }

  const sol = await optimizeFull({
    options: inst.options,
    recipeDag: inst.dag,
    desiredArtifactNodeIds: inst.targets,
    fuelCapacity: inst.fuelCapacity,
    timeCapacityPerSlot: inst.timeCapacityPerSlot,
    baseYield: inst.baseYield,
    craftBudget: inst.craftBudget,
    maximumCost: Infinity,
  });
  const alloc = new Array<number>(inst.options.length).fill(0);
  for (const h of sol.choiceHistory) {
    const i = inst.options.findIndex(
      o => o.actualFuel === h.actualFuel && o.actualTime === h.actualTime && o.targetAfxId === h.targetAfxId
    );
    if (i === -1) {
      throw new Error(
        `choiceHistory entry (fuel=${h.actualFuel}, time=${h.actualTime}, target=${h.targetAfxId}) matches no input option`
      );
    }
    alloc[i] += h.numShipsLaunched;
  }
  const planEval = evaluateAllocationJoint(inst, alloc);
  const fuelUsed = alloc.reduce((t, k, i) => t + k * inst.options[i].actualFuel, 0);
  const makespan = (sol.slots ?? []).reduce((m, s) => Math.max(m, s.loadSeconds), 0);

  console.log(`\nsolver plan: ${fmtAlloc(inst, alloc)}`);
  console.log(`  reported jointProbability: ${sol.jointProbability}`);
  console.log(`  independent evaluation:    ${planEval.jointProbability}`);
  console.log(
    `  uses fuel ${fuelUsed}/${inst.fuelCapacity} (${((100 * fuelUsed) / Math.max(1, inst.fuelCapacity)).toFixed(1)}%), ` +
      `busiest slot ${makespan}/${inst.timeCapacityPerSlot}s (${((100 * makespan) / Math.max(1, inst.timeCapacityPerSlot)).toFixed(1)}%)`
  );
  console.log(`  slots: ${JSON.stringify(sol.slots ?? [])}`);

  const oracle = bruteForceBestJoint(inst);
  console.log(`\noracle plan: ${fmtAlloc(inst, oracle.bestAllocation)}`);
  console.log(`  jointProbability: ${oracle.bestJointProbability}`);
  console.log(`  gap vs solver plan: ${(oracle.bestJointProbability - planEval.jointProbability).toExponential(3)}`);
  console.log(`  (negative gap means the solver plan is infeasible and priced on overspent budget)`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
