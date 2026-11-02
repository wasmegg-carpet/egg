/**
 * Standard permit: offline earnings halved, at most 2 silos, at most 2 active artifacts.
 * `proPermit` undefined always means Pro (plans and snapshots from before Standard was supported).
 */
import { beforeEach, describe, it, expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useInitialStateStore } from '@/stores/initialState';
import { allModifiersFromColleggtibles } from 'lib/collegtibles';
import { activeSlots, artifactSlotCount, summarizeLoadout } from '@/lib/artifacts';
import { calculateClothedTEForSet, getOptimalEarningsSet, getOptimalELRSet } from '@/lib/artifacts/virtue';
import { calculateEarnings } from '@/calculations/earnings';
import { maxSilos, nextSiloCost, MAX_SILOS } from '@/stores/silos';
import { applyAction } from '@/engine/apply';
import type { EngineState } from '@/engine/types';
import { maxedBaseState, maxedContext } from '@/buildTable/maxedAccount';
import { contextAt, startStateAt } from '@/buildTable/cell';
import { runUntilShift } from '@/auto/ascension';
import { runH1 } from '@/auto/shifts/h1';
import { createSimAction } from '@/types/actions/meta';
import { deliveryCandidatesBySlot, summarizeLoadoutInputs, buildLoadoutInputsFromBackup } from '@/auto/loadout';
import { AfxName as N, AfxRarity as R, invArtifact, invStone, syntheticBackup } from '@/auto/loadout/testBackup';

const FOUR = [
  { artifactId: 'lunar-totem-4-3', stones: ['lunar-stone-4', null, null] },
  { artifactId: 'puzzle-cube-4-3', stones: [] },
  { artifactId: 'demeters-necklace-4-3', stones: ['shell-stone-4'] },
  { artifactId: 'tungsten-ankh-4-3', stones: [] },
];

const inventory = () =>
  syntheticBackup([
    invArtifact(N.QUANTUM_METRONOME, 4, R.LEGENDARY),
    invArtifact(N.INTERSTELLAR_COMPASS, 4, R.LEGENDARY),
    invArtifact(N.ORNATE_GUSSET, 4, R.LEGENDARY),
    invArtifact(N.LUNAR_TOTEM, 4, R.LEGENDARY),
    invArtifact(N.DEMETERS_NECKLACE, 4, R.LEGENDARY),
    invArtifact(N.TUNGSTEN_ANKH, 4, R.LEGENDARY),
    invArtifact(N.PUZZLE_CUBE, 4, R.LEGENDARY),
    invStone(N.QUANTUM_STONE, 4, 6),
    invStone(N.TACHYON_STONE, 4, 6),
    invStone(N.LUNAR_STONE, 4, 6),
  ]);

const filled = (loadout: { artifactId: string | null }[]) => loadout.filter(s => s.artifactId).length;

describe('artifact slots', () => {
  it('Pro (or unspecified) allows 4 artifacts, Standard 2', () => {
    expect(artifactSlotCount(true)).toBe(4);
    expect(artifactSlotCount(undefined)).toBe(4);
    expect(artifactSlotCount(false)).toBe(2);
  });

  it('activeSlots empties slots 3–4 for Standard but keeps 4 entries', () => {
    const active = activeSlots(FOUR, false);
    expect(active).toHaveLength(4);
    expect(active.map(s => s.artifactId)).toEqual(['lunar-totem-4-3', 'puzzle-cube-4-3', null, null]);
    expect(active[2].stones).toEqual([]);
    expect(activeSlots(FOUR, true)).toBe(FOUR);
    // The input loadout is not changed: ignored slots are kept, just not counted.
    expect(FOUR[2].artifactId).toBe('demeters-necklace-4-3');
  });

  it('the history summary strikes through ignored artifacts and skips their stones', () => {
    const summary = summarizeLoadout(FOUR, 2);
    expect(summary.match(/line-through/g)).toHaveLength(2);
    expect(summary).toContain('Lunar');
    expect(summary).not.toContain('Shell');
  });
});

describe('silos', () => {
  it('caps at 2 for Standard and 10 for Pro', () => {
    expect(maxSilos(false)).toBe(2);
    expect(maxSilos(true)).toBe(MAX_SILOS);
    expect(maxSilos(undefined)).toBe(MAX_SILOS);
  });

  it('a Standard player can buy the 2nd silo but not a 3rd', () => {
    expect(nextSiloCost(1, false)).toBe(nextSiloCost(1, true));
    expect(nextSiloCost(2, false)).toBe(Infinity);
    expect(Number.isFinite(nextSiloCost(2, true))).toBe(true);
  });
});

describe('earnings', () => {
  const input = {
    eggValue: 1,
    effectiveLayRate: 100,
    te: 0,
    earningsMultiplier: 1,
    awayEarningsMultiplier: 2,
    artifactAwayMultiplier: 3,
    videoDoublerMultiplier: 1,
    eventMultiplier: 1,
    artifactEffects: [],
  };

  it('Standard halves offline earnings only', () => {
    const pro = calculateEarnings({ ...input, proPermit: true });
    const standard = calculateEarnings({ ...input, proPermit: false });
    expect(standard.onlineEarnings).toBe(pro.onlineEarnings);
    expect(standard.offlineEarnings).toBe(pro.offlineEarnings / 2);
    expect(standard.permitAwayMultiplier).toBe(0.5);
  });

  it('an unspecified permit is Pro', () => {
    expect(calculateEarnings(input).offlineEarnings).toBe(
      calculateEarnings({ ...input, proPermit: true }).offlineEarnings
    );
  });
});

describe('engine', () => {
  it('equipping a 4-artifact set with Standard activates only the first 2, and the set keeps all 4', () => {
    let state: EngineState = { ...maxedBaseState(), proPermit: false };
    state = applyAction(state, createSimAction('update_artifact_set', { setName: 'earnings', newLoadout: FOUR }));
    state = applyAction(state, createSimAction('equip_artifact_set', { setName: 'earnings' }));
    expect(state.artifactLoadout.map(s => s.artifactId)).toEqual(['lunar-totem-4-3', 'puzzle-cube-4-3', null, null]);
    expect(state.artifactSets.earnings!.map(s => s.artifactId)).toEqual(FOUR.map(s => s.artifactId));
  });

  it('Pro keeps all 4 active', () => {
    let state: EngineState = { ...maxedBaseState(), proPermit: true };
    state = applyAction(state, createSimAction('change_artifacts', { fromLoadout: [], toLoadout: FOUR }));
    expect(filled(state.artifactLoadout)).toBe(4);
  });
});

describe('optimizers', () => {
  const backup = inventory();
  const opts = {
    assumeMaxHabsVehicles: true,
    commonResearch: { comfortable_nests: 50, hen_house_ac: 50 },
    epicResearchLevels: {},
    colleggtibleModifiers: allModifiersFromColleggtibles(backup),
  };

  it('the delivery set has at most 2 artifacts with Standard', () => {
    const standard = getOptimalELRSet(backup, { ...opts, proPermit: false });
    expect(standard).toHaveLength(4);
    expect(filled(standard)).toBeLessThanOrEqual(2);
    expect(standard.slice(2).every(s => s.artifactId === null)).toBe(true);
    expect(filled(getOptimalELRSet(backup, { ...opts, proPermit: true }))).toBe(4);
  });

  it('the earnings set has at most 2 artifacts with Standard, padded to 4 slots', () => {
    const standard = getOptimalEarningsSet(backup, false);
    expect(standard).toHaveLength(4);
    expect(filled(standard)).toBe(2);
    expect(filled(getOptimalEarningsSet(backup, true))).toBe(4);
  });

  it('Clothed TE ignores artifacts past slot 2 with Standard', () => {
    const base = { truthEggs: 100, colleggtibleModifiers: opts.colleggtibleModifiers, labUpgradeLevel: 0 };
    const all = calculateClothedTEForSet(FOUR, { ...base, proPermit: false });
    const firstTwo = calculateClothedTEForSet(activeSlots(FOUR, false), { ...base, proPermit: false });
    expect(all).toBe(firstTwo);
    expect(calculateClothedTEForSet(FOUR, { ...base, proPermit: true })).toBeGreaterThan(all);
  });
});

describe('auto planner run', () => {
  it('C1 through R1 and H1 never use more than 2 silos or 2 active artifacts', () => {
    const start = 1_793_368_800; // 2026-10-30 08:00 America/Denver
    const context = contextAt(maxedContext(), start);
    const state = startStateAt({ ...maxedBaseState(), proPermit: false }, 200);
    const preC3 = runUntilShift(state, context, 'C3');

    const snapshots = preC3.actions.map(a => a.endState);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snap of snapshots) {
      expect(snap.proPermit).toBe(false);
      expect(snap.siloCount).toBeLessThanOrEqual(2);
      expect(filled(snap.artifactLoadout)).toBeLessThanOrEqual(2);
    }
    // C1 saves the earnings set it equips as just the 2 that count.
    const earningsUpdate = preC3.actions.find(
      a => a.type === 'update_artifact_set' && a.payload.setName === 'earnings'
    );
    expect(
      earningsUpdate && filled((earningsUpdate.payload as { newLoadout: { artifactId: string | null }[] }).newLoadout)
    ).toBe(2);
    // The silo budget is still spent: the one silo a Standard farm can buy.
    expect(preC3.state.siloCount).toBe(2);

    const h1 = runH1(preC3.state, context);
    expect(filled(h1.endState.artifactLoadout)).toBeLessThanOrEqual(2);
    expect(filled(h1.endState.artifactSets.elr!)).toBeLessThanOrEqual(2);
  }, 60000);
});

describe('auto planner loadout inputs', () => {
  const backup = inventory();

  it('the default earnings set follows the chosen permit', () => {
    expect(filled(buildLoadoutInputsFromBackup(backup, false).earnings)).toBe(2);
    expect(filled(buildLoadoutInputsFromBackup(backup, true).earnings)).toBe(4);
  });

  it('with 3 target families and 2 slots, H1 picks 2 of all candidates; slots 3–4 are empty', () => {
    const inputs = buildLoadoutInputsFromBackup(backup, false);
    const views = deliveryCandidatesBySlot(inputs, 2);
    expect(views.map(v => v.kind)).toEqual(['any', 'any', 'empty', 'empty']);
  });

  it('the summary counts only the slots that count', () => {
    const inputs = buildLoadoutInputsFromBackup(backup, true);
    expect(summarizeLoadoutInputs(inputs, false, 2)).toMatch(/^Earnings 2\/2 \(Standard permit\) · /);
    expect(summarizeLoadoutInputs(inputs, false)).toMatch(/^Earnings 4\/4 · /);
  });
});

describe('toggling the permit', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const earningsBackup = () =>
    syntheticBackup([
      invArtifact(N.LUNAR_TOTEM, 4, R.LEGENDARY),
      invArtifact(N.DEMETERS_NECKLACE, 4, R.LEGENDARY),
      invArtifact(N.TUNGSTEN_ANKH, 4, R.LEGENDARY),
      invArtifact(N.PUZZLE_CUBE, 4, R.LEGENDARY),
      invStone(N.LUNAR_STONE, 4, 6),
      invStone(N.SHELL_STONE, 4, 6),
    ]);

  const storeWithRecommendedSet = () => {
    const store = useInitialStateStore();
    store.rawBackup = earningsBackup();
    store.proPermit = true;
    store.updateArtifactSet('earnings', getOptimalEarningsSet(store.rawBackup, true));
    return store;
  };

  it("re-picks the recommended earnings set: Standard's best 2 include the lunar totem", () => {
    const store = storeWithRecommendedSet();
    // Pro's pick doesn't lead with the totem, so keeping its first 2 would drop it.
    expect(store.artifactSets.earnings!.slice(0, 2).map(s => s.artifactId)).not.toContain('lunar-totem-4-3');
    store.setProPermit(false);
    expect(store.artifactSets.earnings).toEqual(getOptimalEarningsSet(store.rawBackup!, false));
    expect(store.artifactSets.earnings!.slice(0, 2).map(s => s.artifactId)).toContain('lunar-totem-4-3');
    // And back again.
    store.setProPermit(true);
    expect(filled(store.artifactSets.earnings!)).toBe(4);
  });

  it('keeps an earnings set the player edited', () => {
    const store = storeWithRecommendedSet();
    const edited = [...store.artifactSets.earnings!].reverse();
    store.updateArtifactSet('earnings', edited);
    store.setProPermit(false);
    expect(store.artifactSets.earnings).toEqual(edited);
  });
});
