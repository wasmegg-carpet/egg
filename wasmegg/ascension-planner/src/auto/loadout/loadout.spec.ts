import { describe, it, expect } from 'vitest';
import { allModifiersFromColleggtibles, modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { getOptimalELRSet, getOptimalELRSetFromPool, getOptimalELRSetFromSource } from '@/lib/artifacts/virtue';
import { redactBackupForStorage } from '@/lib/artifacts/utils';
import { createSimAction } from '@/types/actions/meta';
import {
  buildLoadoutInputsFromBackup,
  buildLoadoutInputsFromSets,
  countUncertainDeliverySlots,
  createEmptyStonePool,
  deliveryCandidatesBySlot,
  deliverySearchFromInputs,
  extractUsedLoadout,
  hashLoadoutInputs,
  seedFixedDeliveryFromAuto,
  socketEarningsStones,
  stonePoolFromBackup,
  toDeliveryCandidate,
  type AutoLoadoutInputs,
} from './index';
import { AfxName as N, AfxRarity as R, invArtifact, invStone, syntheticBackup } from './testBackup';

const T4R_METRONOME = 'quantum-metronome-4-1';
const T3E_METRONOME = 'quantum-metronome-3-2';
const T4L_METRONOME = 'quantum-metronome-4-3';

const lowTEBackup = () =>
  syntheticBackup([
    invArtifact(N.QUANTUM_METRONOME, 4, R.RARE),
    invArtifact(N.QUANTUM_METRONOME, 3, R.EPIC),
    invArtifact(N.INTERSTELLAR_COMPASS, 4, R.EPIC),
    invArtifact(N.TUNGSTEN_ANKH, 4, R.LEGENDARY),
    invStone(N.QUANTUM_STONE, 4, 3),
    invStone(N.TACHYON_STONE, 3, 2),
    invStone(N.LUNAR_STONE, 4, 2),
    invStone(N.SHELL_STONE, 2, 5),
  ]);

describe('buildLoadoutInputsFromBackup', () => {
  it('reads stone counts per family and tier', () => {
    const stones = stonePoolFromBackup(lowTEBackup());
    expect(stones.quantum).toEqual({ 2: 0, 3: 0, 4: 3 });
    expect(stones.tachyon).toEqual({ 2: 0, 3: 2, 4: 0 });
    expect(stones.lunar).toEqual({ 2: 0, 3: 0, 4: 2 });
    expect(stones.shell).toEqual({ 2: 5, 3: 0, 4: 0 });
  });

  it('starts delivery in auto mode with both non-dominated metronomes as candidates', () => {
    const inputs = buildLoadoutInputsFromBackup(lowTEBackup());
    expect(inputs.delivery.mode).toBe('auto');
    const ids = inputs.delivery.mode === 'auto' ? inputs.delivery.candidates.map(c => c.artifactId) : [];
    expect(ids).toContain(T4R_METRONOME);
    expect(ids).toContain(T3E_METRONOME);
  });

  it('falls back to the saved sets with a fixed delivery set and no stones', () => {
    const inputs = buildLoadoutInputsFromSets({
      earnings: null,
      elr: [{ artifactId: T4L_METRONOME, stones: ['quantum-stone-4'] }],
    });
    expect(inputs.delivery).toEqual({ mode: 'fixed', artifactIds: [T4L_METRONOME, null, null, null] });
    expect(inputs.stones).toEqual(createEmptyStonePool());
  });
});

describe('deliveryCandidatesBySlot', () => {
  it('flags the metronome slot as uncertain when owning a T4R and a T3E', () => {
    const views = deliveryCandidatesBySlot(buildLoadoutInputsFromBackup(lowTEBackup()));
    expect(views[0]).toEqual({ kind: 'choice', artifactIds: [T4R_METRONOME, T3E_METRONOME] });
    expect(countUncertainDeliverySlots(buildLoadoutInputsFromBackup(lowTEBackup()))).toBe(1);
  });

  it('shows a single tile when owning only a T4L metronome', () => {
    const backup = syntheticBackup([invArtifact(N.QUANTUM_METRONOME, 4, R.LEGENDARY)]);
    const views = deliveryCandidatesBySlot(buildLoadoutInputsFromBackup(backup));
    expect(views).toEqual([
      { kind: 'artifact', artifactId: T4L_METRONOME },
      { kind: 'empty' },
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
  });

  it('never shows a dominated candidate as a choice (T4L beats T4R on effect and slots)', () => {
    const inputs = buildLoadoutInputsFromBackup(syntheticBackup([invArtifact(N.QUANTUM_METRONOME, 4, R.LEGENDARY)]));
    if (inputs.delivery.mode === 'auto') inputs.delivery.candidates.push(toDeliveryCandidate(T4R_METRONOME));
    expect(deliveryCandidatesBySlot(inputs)[0]).toEqual({ kind: 'artifact', artifactId: T4L_METRONOME });
  });

  it('a hand-edited list (T4L swapped for T4R + T3E) shows the choice, and H1 picks one of them', () => {
    const inputs = buildLoadoutInputsFromBackup(
      syntheticBackup([
        invArtifact(N.QUANTUM_METRONOME, 4, R.LEGENDARY),
        invArtifact(N.INTERSTELLAR_COMPASS, 4, R.LEGENDARY),
        invStone(N.QUANTUM_STONE, 4, 6),
      ])
    );
    if (inputs.delivery.mode !== 'auto') throw new Error('expected auto');
    inputs.delivery.candidates = [
      ...inputs.delivery.candidates.filter(c => c.artifactId !== T4L_METRONOME),
      toDeliveryCandidate(T4R_METRONOME),
      toDeliveryCandidate(T3E_METRONOME),
    ];

    expect(deliveryCandidatesBySlot(inputs)[0]).toEqual({ kind: 'choice', artifactIds: [T4R_METRONOME, T3E_METRONOME] });

    const set = getOptimalELRSetFromSource(deliverySearchFromInputs(inputs), {
      assumeMaxHabsVehicles: true,
      commonResearch: { comfortable_nests: 50, hen_house_ac: 50 },
      epicResearchLevels: {},
      colleggtibleModifiers: modifiersFromColleggtibleTiers({}),
    });
    const metronomes = set.map(s => s.artifactId).filter(id => id?.startsWith('quantum-metronome-'));
    expect(metronomes).toHaveLength(1);
    expect([T4R_METRONOME, T3E_METRONOME]).toContain(metronomes[0]);
  });

  it('seeds a fixed set from the first option of each slot', () => {
    const seeded = seedFixedDeliveryFromAuto(buildLoadoutInputsFromBackup(lowTEBackup()));
    expect(seeded[0]).toBe(T4R_METRONOME);
    expect(seeded).toHaveLength(4);
  });
});

describe('deliverySearchFromInputs', () => {
  const backup = lowTEBackup();
  const opts = {
    assumeMaxHabsVehicles: true,
    commonResearch: { comfortable_nests: 50, hen_house_ac: 50 },
    epicResearchLevels: {},
    colleggtibleModifiers: allModifiersFromColleggtibles(backup),
  };

  it('auto inputs from a backup give the same delivery set as the backup path', () => {
    const { pool, forcedArtifacts } = deliverySearchFromInputs(buildLoadoutInputsFromBackup(backup));
    expect(forcedArtifacts).toBeUndefined();
    expect(getOptimalELRSetFromPool(pool, opts)).toEqual(getOptimalELRSet(backup, opts));
  });

  it('fixed inputs force exactly the chosen artifacts and still place stones from the pool', () => {
    const inputs = buildLoadoutInputsFromBackup(backup);
    inputs.delivery = { mode: 'fixed', artifactIds: [T3E_METRONOME, null, null, null] };
    const { pool, forcedArtifacts } = deliverySearchFromInputs(inputs);
    const set = getOptimalELRSetFromPool(pool, { ...opts, forcedArtifacts });
    expect(set.map(s => s.artifactId)).toEqual([T3E_METRONOME, null, null, null]);
    expect(set[0].stones.every(s => s !== null && /^(quantum|tachyon)-stone-/.test(s))).toBe(true);
  });

  it('the source dispatcher (used by C3 ranking and H1) honours a fixed set and accepts a backup', () => {
    const inputs = buildLoadoutInputsFromBackup(backup);
    inputs.delivery = { mode: 'fixed', artifactIds: [T3E_METRONOME, null, null, null] };
    const fromInputs = getOptimalELRSetFromSource(deliverySearchFromInputs(inputs), opts);
    expect(fromInputs.map(s => s.artifactId)).toEqual([T3E_METRONOME, null, null, null]);
    expect(getOptimalELRSetFromSource(backup, opts)).toEqual(getOptimalELRSet(backup, opts));
    // A caller-forced structure (rankResearchByELRImpact's per-candidate calls) wins over the source's.
    const forced = getOptimalELRSetFromSource(deliverySearchFromInputs(inputs), { ...opts, forcedArtifacts: [T4R_METRONOME] });
    expect(forced[0].artifactId).toBe(T4R_METRONOME);
  });

  it('places no stones when the pool has none', () => {
    const inputs = buildLoadoutInputsFromBackup(backup);
    inputs.stones = createEmptyStonePool();
    inputs.delivery = { mode: 'fixed', artifactIds: [T3E_METRONOME, null, null, null] };
    const { pool, forcedArtifacts } = deliverySearchFromInputs(inputs);
    const set = getOptimalELRSetFromPool(pool, { ...opts, forcedArtifacts });
    expect(set[0].stones).toEqual([null, null]);
  });
});

describe('socketEarningsStones', () => {
  const ankh = [{ artifactId: 'tungsten-ankh-4-3', stones: [] }, { artifactId: null, stones: [] }];

  it('fills sockets from lunar and shell only, within the pool counts', () => {
    const stones = createEmptyStonePool();
    stones.lunar[4] = 1;
    stones.shell[2] = 1;
    stones.quantum[4] = 9;
    const set = socketEarningsStones(ankh, stones);
    expect(set).toHaveLength(4);
    expect(set[0].stones).toHaveLength(3);
    expect([...set[0].stones].sort()).toEqual(['lunar-stone-4', 'shell-stone-2', null].sort());
  });

  it('uses the highest tier available first', () => {
    const stones = createEmptyStonePool();
    stones.lunar[2] = 3;
    stones.lunar[4] = 1;
    const set = socketEarningsStones(ankh, stones);
    expect(set[0].stones).toEqual(['lunar-stone-4', 'lunar-stone-2', 'lunar-stone-2']);
  });

  it('picks the stone that raises Clothed TE more', () => {
    const stones = createEmptyStonePool();
    stones.lunar[2] = 1;
    stones.shell[4] = 1;
    const set = socketEarningsStones([{ artifactId: 'demeters-necklace-2-1', stones: [] }], stones);
    // One socket, so only the better of the two lands.
    expect(set[0].stones).toHaveLength(1);
    expect(['lunar-stone-2', 'shell-stone-4']).toContain(set[0].stones[0]);
  });
});

describe('hashLoadoutInputs', () => {
  it('ignores earnings stones but not stone counts', () => {
    const a = buildLoadoutInputsFromBackup(lowTEBackup());
    const b: AutoLoadoutInputs = JSON.parse(JSON.stringify(a));
    b.earnings = b.earnings.map(s => ({ ...s, stones: s.stones.map(() => 'lunar-stone-4') }));
    expect(hashLoadoutInputs(b)).toBe(hashLoadoutInputs(a));
    b.stones.quantum[4] = 0;
    expect(hashLoadoutInputs(b)).not.toBe(hashLoadoutInputs(a));
  });
});

describe('extractUsedLoadout', () => {
  it('reads C1 earnings and H1 delivery from the actions', () => {
    const resolved = buildLoadoutInputsFromBackup(lowTEBackup());
    const h1Set = [
      { artifactId: T4R_METRONOME, stones: ['quantum-stone-4'] },
      { artifactId: null, stones: [] },
      { artifactId: null, stones: [] },
      { artifactId: null, stones: [] },
    ];
    const actions = [
      createSimAction('update_artifact_set', {
        setName: 'earnings',
        newLoadout: [{ artifactId: 'tungsten-ankh-4-3', stones: ['lunar-stone-4', null, null] }],
      }),
      createSimAction('update_artifact_set', { setName: 'elr', newLoadout: h1Set }),
    ];
    const inputs = extractUsedLoadout(actions, resolved);
    expect(inputs.earnings[0]).toEqual({ artifactId: 'tungsten-ankh-4-3', stones: [null, null, null] });
    expect(inputs.delivery).toEqual({ mode: 'fixed', artifactIds: [T4R_METRONOME, null, null, null] });
    expect(inputs.stones).toEqual(resolved.stones);
  });
});

describe('getOptimalELRSet on a saved plan\'s redacted backup', () => {
  const backup = syntheticBackup([
    invArtifact(N.QUANTUM_METRONOME, 4, R.LEGENDARY),
    invArtifact(N.TUNGSTEN_ANKH, 4, R.LEGENDARY),
    invStone(N.QUANTUM_STONE, 4, 12),
    invStone(N.TACHYON_STONE, 4, 12),
  ]);
  const redacted = redactBackupForStorage(backup)!;
  const stones = (set: { stones: (string | null)[] }[]) => set.flatMap(slot => slot.stones);
  const opts = {
    commonResearch: { leafsprings: 30, lightweight_boxes: 40, driver_training: 30, micro_coupling: 5 },
    epicResearchLevels: {},
    colleggtibleModifiers: modifiersFromColleggtibleTiers({}),
  };
  const farm = {
    habIds: [18, 18, 18, 18],
    vehicles: new Array(17).fill(null).map(() => ({ vehicleId: 11, trainLength: 8 })),
  };

  it('has no farm', () => {
    expect(redacted.farms).toBeUndefined();
  });

  it('assumes a maxed fleet, not a single trike, and balances stones', () => {
    const set = getOptimalELRSet(redacted, { ...opts, assumeMaxHabsVehicles: true });
    expect(stones(set).some(s => s?.startsWith('tachyon-stone'))).toBe(true);
    expect(set).toEqual(getOptimalELRSet({ ...redacted, farms: [{}] }, { ...opts, assumeMaxHabsVehicles: true }));
  });

  it('ignores a passed farm when assuming maxed habs and vehicles', () => {
    const trike = { habIds: [0, null, null, null], vehicles: [{ vehicleId: 0, trainLength: 1 }] };
    expect(getOptimalELRSet(redacted, { ...opts, ...trike, assumeMaxHabsVehicles: true })).toEqual(
      getOptimalELRSet(redacted, { ...opts, assumeMaxHabsVehicles: true })
    );
  });

  it('optimizes for the passed farm when not assuming maxed habs and vehicles', () => {
    const passed = getOptimalELRSet(redacted, { ...opts, ...farm, assumeMaxHabsVehicles: false });
    const fromFarm = getOptimalELRSet(
      { ...redacted, farms: [{ habs: farm.habIds as number[], vehicles: farm.vehicles.map(v => v.vehicleId), trainLength: farm.vehicles.map(v => v.trainLength) }] },
      { ...opts, assumeMaxHabsVehicles: false }
    );
    expect(passed).toEqual(fromFarm);
    expect(stones(passed).some(s => s?.startsWith('tachyon-stone'))).toBe(true);
  });
});
