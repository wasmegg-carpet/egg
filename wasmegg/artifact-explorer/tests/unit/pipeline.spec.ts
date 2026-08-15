// End-to-end coverage of the production pipeline on real game data. Assertions stick to structure and
// invariants so loot data refreshes do not break them; the one exact-recipe check is stable game design.

import { describe, it, expect } from 'vitest';
import { ei, perfectShipsConfig } from 'lib';
import { buildRecipeDag, computeBaseYield } from '@/lib';
import { optimize } from './spec-helpers';
import { enumerateLaunchOptions } from '@/lib/phases';

const Name = ei.ArtifactSpec.Name;

describe('buildRecipeDag', () => {
  it('builds the real puzzle cube recipe chain', () => {
    const dag = buildRecipeDag(['puzzle-cube-4'], 30);

    for (const tier of ['puzzle-cube-1', 'puzzle-cube-2', 'puzzle-cube-3', 'puzzle-cube-4']) {
      expect(dag.has(tier)).toBe(true);
    }
    expect(dag.get('puzzle-cube-4')!.isLeaf).toBe(false);
    expect(dag.get('puzzle-cube-1')!.isLeaf).toBe(true);
    expect(dag.get('puzzle-cube-1')!.children).toEqual([]);
    expect(dag.get('puzzle-cube-2')!.children).toEqual([{ nodeId: 'puzzle-cube-1', quantity: 3 }]);

    // every child reference resolves within the DAG
    for (const node of dag.values()) {
      for (const child of node.children) {
        expect(dag.has(child.nodeId)).toBe(true);
        expect(child.quantity).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('puts the legendary craft probability on the root only', () => {
    const dag = buildRecipeDag(['puzzle-cube-4'], 30);
    const root = dag.get('puzzle-cube-4')!;
    expect(root.legendaryCraftProbability).toBeGreaterThan(0);
    expect(root.legendaryCraftProbability).toBeLessThanOrEqual(1);
    for (const node of dag.values()) {
      if (node.id === root.id) continue;
      expect(node.legendaryCraftProbability).toBe(0);
    }
  });
});

describe('enumerateLaunchOptions', () => {
  const dag = buildRecipeDag(['puzzle-cube-4'], 30);

  it('produces well-formed options from real loot data', () => {
    const options = enumerateLaunchOptions(perfectShipsConfig, dag);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.actualTime).toBeGreaterThan(0);
      expect(o.actualFuel).toBeGreaterThanOrEqual(0);
      for (const itemId of o.yieldVector.keys()) {
        expect(dag.has(itemId)).toBe(true);
      }
      for (const itemId of o.legendaryYieldVector.keys()) {
        expect(dag.has(itemId)).toBe(true);
      }
    }
    expect(options.some(o => o.targetAfxId === Name.UNKNOWN)).toBe(true);
    expect(options.some(o => o.targetAfxId === Name.PUZZLE_CUBE)).toBe(true);
  });

  it('floors every mission duration up to the launch period without dropping any', () => {
    const base = enumerateLaunchOptions(perfectShipsConfig, dag);
    // 6h splits the real option set: some missions are shorter, some longer
    const launchPeriod = 6 * 3600;
    const floored = enumerateLaunchOptions(perfectShipsConfig, dag, launchPeriod);
    // the floor is a soft penalty, not a cutoff
    expect(floored.length).toBe(base.length);
    const baseById = new Map(base.map(o => [o.id, o]));
    let sawRaised = false;
    let sawUnchanged = false;
    for (const o of floored) {
      const original = baseById.get(o.id)!;
      expect(o.rawTime).toBeCloseTo(original.actualTime);
      expect(o.actualTime).toBeCloseTo(Math.max(o.rawTime, launchPeriod));
      if (o.rawTime >= launchPeriod) {
        expect(o.actualTime).toBeCloseTo(o.rawTime);
        sawUnchanged = true;
      } else {
        expect(o.actualTime).toBeCloseTo(launchPeriod);
        sawRaised = true;
      }
    }
    expect(sawRaised).toBe(true);
    expect(sawUnchanged).toBe(true);
  });
});

describe('optimize', () => {
  const config = {
    desiredArtifactNodeIds: ['puzzle-cube-4'],
    includeNotEnoughData: false,
    fuelTankCapacity: 2_000_000_000,
    timeBudgetSeconds: 3 * 24 * 3600,
  };

  it('returns a plan the page can render', async () => {
    const dag = buildRecipeDag(config.desiredArtifactNodeIds, 30);
    const baseYield = computeBaseYield(null, config.desiredArtifactNodeIds, dag);
    const sol = await optimize(config, perfectShipsConfig, dag, baseYield);

    expect(sol.choiceHistory.length).toBeGreaterThan(0);
    // sorted by ship, so the launch list reads in fleet order
    for (let i = 1; i < sol.choiceHistory.length; i++) {
      expect(sol.choiceHistory[i - 1].ship.shipType).toBeLessThanOrEqual(sol.choiceHistory[i].ship.shipType);
    }
    expect(sol.expectedDrops.length).toBeGreaterThan(0);
    for (const row of sol.expectedDrops) {
      expect(row.expected).toBeGreaterThan(0);
      expect(row.iconUrl).toMatch(/^https:/);
    }
  });

  it('reports running time as the busiest slot real flight time', async () => {
    const dag = buildRecipeDag(config.desiredArtifactNodeIds, 30);
    const baseYield = computeBaseYield(null, config.desiredArtifactNodeIds, dag);
    const launchPeriod = 3600; // high effort: 1 launch / slot / hour
    const sol = await optimize(config, perfectShipsConfig, dag, baseYield, launchPeriod);

    // `runningTimeSeconds` is the "you will be done in" figure on the card, and
    // it is raw flight time rather than the floored time the solver packs with.
    expect(sol.slots).toBeDefined();
    expect(sol.slots!.length).toBe(3);
    const busiest = sol.slots!.reduce((a, b) => (b.loadSeconds > a.loadSeconds ? b : a));
    expect(busiest.missionCount).toBeGreaterThan(0);
    expect(sol.runningTimeSeconds).toBe(Math.round(busiest.rawLoadSeconds));
    expect(sol.runningTimeSeconds).toBeLessThanOrEqual(sol.timeUnitsUsed);

    // with a zero launch period nothing is floored: raw flight = makespan
    const rawSol = await optimize(config, perfectShipsConfig, dag, baseYield, 0);
    expect(rawSol.runningTimeSeconds).toBe(rawSol.timeUnitsUsed);
  });
});
