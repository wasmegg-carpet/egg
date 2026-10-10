/**
 * The recommendation algorithm, explained
 * =======================================
 *
 * There are some artifacts that independently contribute effects and stone
 * slots to SE gain (or clothed TE for virtue):
 *
 * - Demeters necklace;
 * - Tungsten ankh;
 * - Pheonix feather;
 * - Quantum metronome;
 * - Dilithium monocle;
 * - Lunar totem;
 * - Puzzle cube (virtue only);
 * - Gusset (only preload);
 * - Chalice (only all-in-one and multi).
 *
 * There are some stones that independently contribute effects:
 *
 * - Shell stones;
 * - Tachyon stones;
 * - Soul stones (not independent from each other);
 * - Life stones (only all-in-one and multi);
 * - Lunar stones;
 *
 * Then there are two complex classes of interdependent items:
 *
 * - Book of Basan and prophecy stones;
 * - Vial of Martian dust and terra stones.
 *
 * The algorithm uses divide and conquer + exhaustive search with pruning.
 */

import {
  Artifact,
  ArtifactAssemblyStatus,
  ArtifactAssemblyStatusNonMissing,
  ArtifactSet,
  Farm,
  getNumProphecyEggs,
  Inventory,
  InventoryFamily,
  InventoryItem,
  Item,
  newItem,
} from '..';
// Separated from other barrel imports due to module level references
// causing circular import crashes when running test frameworks
import { ei } from '../proto';
import { Strategy, isVirtueStrategy, isElrStrategy, ELR_TARGET_AFX_IDS, ELR_STONE_FAMILY_IDS } from './strategies';
import { EquippedArtifact } from './types';
import { createEmptyLoadout } from './calculator';
import { getArtifact } from './options';

const debug = import.meta.env.DEV || import.meta.env.VITE_APP_BETA;
import Name = ei.ArtifactSpec.Name;
import Rarity = ei.ArtifactSpec.Rarity;
import Type = ei.ArtifactSpec.Type;

type ArtifactSlotCount = number;
type StoneSlotCount = number;

// Strategies and their classification helpers live in strategies.ts, re-exported
// here so existing `Strategy` imports keep resolving.
export * from './strategies';

export class Contender {
  constructor(
    public artifacts: Item[],
    public stones: Item[],
    public numArtifactSlotsTaken: ArtifactSlotCount,
    public numStoneSlotsTaken: StoneSlotCount,
    public effectMultiplier: number
  ) {}

  static fromArtifactSet(set: ArtifactSet): Contender {
    const artifacts = set.artifacts.map(a => a.host);
    const stones = set.artifacts.map(a => a.stones).flat();
    const numArtifactSlotsTaken = artifacts.length;
    const numStoneSlotsTaken = -artifacts.reduce((sum, a) => sum + a.slots, 0) + stones.length;
    return new Contender(artifacts, stones, numArtifactSlotsTaken, numStoneSlotsTaken, 1);
  }

  calibrate(): void {
    this.numArtifactSlotsTaken = this.artifacts.length;
    this.numStoneSlotsTaken = -this.artifacts.reduce((sum, a) => sum + a.slots, 0) + this.stones.length;
  }

  adjustLunar(maxRCB: number): void {
    this.effectMultiplier /= maxRCB;
  }

  equals(other: Contender): boolean {
    if (this.numArtifactSlotsTaken !== other.numArtifactSlotsTaken) {
      return false;
    }
    if (this.numStoneSlotsTaken !== other.numStoneSlotsTaken) {
      return false;
    }
    const a1 = this.artifacts.map(a => a.key).sort();
    const a2 = other.artifacts.map(a => a.key).sort();
    if (a1.join('\t') !== a2.join('\t')) {
      return false;
    }
    const s1 = this.stones.map(s => s.key).sort();
    const s2 = other.stones.map(s => s.key).sort();
    if (s1.join('\t') !== s2.join('\t')) {
      return false;
    }
    return true;
  }

  toString(): string {
    const artifactKeys = this.artifacts.map(a => a.id);
    const stoneKeys = this.stones.map(s => s.id);
    return (
      `{ ` +
      `#artifact-slots: ${this.numArtifactSlotsTaken}; ` +
      `#stone-slots: ${this.numStoneSlotsTaken}; ` +
      `effect: ${this.effectMultiplier.toFixed(6)} ` +
      `(${(this.effectMultiplier ** 0.21).toFixed(6)}); ` +
      `[${artifactKeys.join(', ')}; ${stoneKeys.join(', ')}]` +
      ' }'
    );
  }

  debug(): void {
    if (!debug) {
      return;
    }
    const artifactKeys = this.artifacts.map(a => a.id);
    const stoneKeys = this.stones.map(s => s.id);
    console.debug(
      `#artifact-slots: %c${this.numArtifactSlotsTaken}%c; ` +
        `#stone-slots: %c${this.numStoneSlotsTaken}%c; ` +
        `effect: %c${this.effectMultiplier.toFixed(6)} ` +
        `%c(${(this.effectMultiplier ** 0.21).toFixed(6)})`,
      'color: green',
      'color: reset',
      'color: green',
      'color: reset',
      'color: green',
      'color: dodgerblue'
    );
    console.debug(`%c[${artifactKeys.join(', ')}; ${stoneKeys.join(', ')}]`, 'color: #666');
  }

  assertNumArtifactSlotsTaken(n: number): void {
    if (this.numArtifactSlotsTaken !== n) {
      throw new Error(`expected ${n} artifact slots taken, got ${this.numArtifactSlotsTaken}`);
    }
  }

  assertNumStoneSlotsTaken(n: number): void {
    if (this.numStoneSlotsTaken !== n) {
      throw new Error(`expected ${n} stone slots taken, got ${this.numStoneSlotsTaken}`);
    }
  }
}

class Contenders {
  contenders: Map<ArtifactSlotCount, Map<StoneSlotCount, Contender>>;

  constructor(contenders?: Contender[]) {
    this.contenders = new Map();
    if (contenders !== undefined) {
      for (const contender of contenders) {
        this.add(contender);
      }
    }
  }

  add(contender: Contender): void {
    const na = contender.numArtifactSlotsTaken;
    const ns = contender.numStoneSlotsTaken;
    const c = this.contenders.get(na);
    if (c) {
      const cc = c.get(ns);
      if (cc) {
        if (cc.effectMultiplier < contender.effectMultiplier) {
          c.set(ns, contender);
        }
      } else {
        c.set(ns, contender);
      }
    } else {
      this.contenders.set(na, new Map([[ns, contender]]));
    }
  }

  *iter(): Generator<Contender, void> {
    for (const na of [...this.contenders.keys()].sort((na1, na2) => na1 - na2)) {
      const c = this.contenders.get(na)!;
      for (const ns of [...c.keys()].sort((ns1, ns2) => ns1 - ns2)) {
        yield c.get(ns)!;
      }
    }
  }

  get length(): number {
    let len = 0;
    /* eslint-disable @typescript-eslint/no-unused-vars */
    for (const c of this.iter()) {
      len++;
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */
    return len;
  }

  get isEmpty(): boolean {
    for (const c of this.iter()) {
      return false;
    }

    return true;
  }

  // Make sure that given the same number of artifact slots taken, a contender
  // with more stone slots taken should have a strictly better effect
  // multiplier.
  trim(): void {
    for (const artifactSlotCount of [...this.contenders.keys()].sort((a, b) => a - b)) {
      const contendersForArtifactSlots = this.contenders.get(artifactSlotCount)!;
      let bestEffectMultiplierSoFar = 0;
      for (const stoneSlotCount of [...contendersForArtifactSlots.keys()].sort((a, b) => a - b)) {
        const currentContender = contendersForArtifactSlots.get(stoneSlotCount)!;
        const currentEffectMultiplier = currentContender.effectMultiplier;
        if (currentEffectMultiplier <= bestEffectMultiplierSoFar) {
          // This contender uses more stone slots but has worse or equal effect - remove it
          contendersForArtifactSlots.delete(stoneSlotCount);
        } else {
          bestEffectMultiplierSoFar = currentEffectMultiplier;
        }
      }
    }
  }

  debug(description?: string): void {
    if (!debug) {
      return;
    }
    if (description) {
      console.debug(`%c${description}:`, 'color: orangered');
    }
    for (const c of this.iter()) {
      c.debug();
    }
  }

  assertNumArtifactSlotsTaken(n: number): void {
    for (const c of this.iter()) {
      c.assertNumArtifactSlotsTaken(n);
    }
  }

  assertNumStoneSlotsTaken(n: number): void {
    for (const c of this.iter()) {
      c.assertNumStoneSlotsTaken(n);
    }
  }
}

function contendersInArtifactFamily(
  family: InventoryFamily | undefined,
  getEffectMultiplier: (delta: number) => number,
  opts?: { rareOrAbove?: boolean }
): Contenders {
  const contenders = new Contenders();
  if (!family) {
    return contenders;
  }
  if (family.type !== Type.ARTIFACT) {
    throw new Error(`${Type[family.type]} is not an artifact`);
  }
  const rarities = opts?.rareOrAbove
    ? [Rarity.LEGENDARY, Rarity.EPIC, Rarity.RARE]
    : [Rarity.LEGENDARY, Rarity.EPIC, Rarity.RARE, Rarity.COMMON];
  for (const tier of family.tiers) {
    for (const rarity of rarities) {
      if (tier.haveRarity[rarity] > 0) {
        const artifact = newItem({
          name: tier.afxId,
          level: tier.afxLevel,
          rarity,
        });
        const effectDelta = tier.effectDelta(rarity);
        contenders.add(
          new Contender([artifact], [], 1, -tier.stoneSlotCount(rarity), getEffectMultiplier(effectDelta))
        );
        break;
      }
    }
  }
  contenders.trim();
  contenders.debug(`Contenders in family ${Name[family.afxId]}`);
  return contenders;
}

function contendersInArtifactFamilyWithSlots(
  family: InventoryFamily | undefined,
  getEffectMultiplier: (delta: number, stoneSlots: number) => number,
  prioritizeSlots: boolean
): Contenders {
  const contenders = new Contenders();
  if (!family) {
    return contenders;
  }
  if (family.type !== Type.ARTIFACT) {
    throw new Error(`${Type[family.type]} is not an artifact`);
  }
  const rarities = [Rarity.LEGENDARY, Rarity.EPIC, Rarity.RARE, Rarity.COMMON];
  for (const tier of family.tiers) {
    for (const rarity of rarities) {
      if (tier.haveRarity[rarity] > 0) {
        const artifact = newItem({
          name: tier.afxId,
          level: tier.afxLevel,
          rarity,
        });
        const effectDelta = tier.effectDelta(rarity);
        const stoneSlots = tier.stoneSlotCount(rarity);
        contenders.add(new Contender([artifact], [], 1, -stoneSlots, getEffectMultiplier(effectDelta, stoneSlots)));
        break;
      }
    }
  }
  contenders.trim();
  contenders.debug(`Contenders in family ${Name[family.afxId]}`);
  return contenders;
}

function bestsInStoneFamily(family: InventoryFamily | undefined, n: number): Item[] {
  if (!family) {
    return [];
  }
  if (family.type !== Type.STONE) {
    throw new Error(`${Type[family.type]} is not a stone`);
  }
  const stones = <Item[]>[];
  for (const tier of [...family.tiers].filter(t => t.type === Type.STONE).sort((t1, t2) => t2.afxLevel - t1.afxLevel)) {
    const stone = newItem({
      name: tier.afxId,
      level: tier.afxLevel,
      rarity: Rarity.COMMON,
    });
    const count = tier.haveCommon;
    for (let i = 0; i < count && n > 0; i++) {
      stones.push(stone);
      n--;
    }
    if (n === 0) {
      break;
    }
  }
  return stones;
}

function maxSpareStoneSlotsInContenders(contenders: Contenders): number {
  let max = 0;
  for (const c of contenders.iter()) {
    if (-c.numStoneSlotsTaken > max) {
      max = -c.numStoneSlotsTaken;
    }
  }
  return max;
}

function combine(...contenders: Contender[]): Contender {
  const artifacts = (<Item[]>[]).concat(...contenders.map(c => c.artifacts));
  const stones = (<Item[]>[]).concat(...contenders.map(c => c.stones));
  const numArtifactSlotsTaken = contenders.reduce((sum, c) => sum + c.numArtifactSlotsTaken, 0);
  const numStoneSlotsTaken = contenders.reduce((sum, c) => sum + c.numStoneSlotsTaken, 0);
  const effectMultiplier = contenders.reduce((product, c) => product * c.effectMultiplier, 1);
  return new Contender(artifacts, stones, numArtifactSlotsTaken, numStoneSlotsTaken, effectMultiplier);
}

function addStonesToContenders(
  contenders: Contenders,
  availableStones: Item[],
  getEffect: (contender: Contender, stones: Item[]) => number,
  maxStoneSlots: number
): Contenders {
  const stonedContenders = new Contenders();
  for (const contender of contenders.iter()) {
    const maxNumStones = Math.min(maxStoneSlots - contender.numStoneSlotsTaken, availableStones.length);
    for (let i = 0; i <= maxNumStones; i++) {
      const stones = availableStones.slice(0, i);
      stonedContenders.add(
        new Contender(
          contender.artifacts,
          contender.stones.concat(stones),
          contender.numArtifactSlotsTaken,
          contender.numStoneSlotsTaken + i,
          getEffect(contender, stones)
        )
      );
    }
  }
  stonedContenders.trim();
  return stonedContenders;
}

function* combinations<T>(pool: T[], r: number): Generator<T[], void> {
  const n = pool.length;
  if (r > n) {
    return;
  }
  const indices = range(r);
  yield indices.map(i => pool[i]);
  while (true) {
    let i;
    for (i = r - 1; i >= 0; i--) {
      if (indices[i] !== i + n - r) {
        break;
      }
    }
    if (i < 0) {
      return;
    }
    indices[i]++;
    for (let j = i + 1; j < r; j++) {
      indices[j] = indices[j - 1] + 1;
    }
    yield indices.map(i => pool[i]);
  }
}

function* product<T>(...pools: T[][]): Generator<T[], void> {
  if (pools.length === 0) {
    return;
  } else if (pools.length === 1) {
    for (const t of pools[0]) {
      yield [t];
    }
  } else {
    for (const t of pools[0]) {
      for (const tt of product(...pools.slice(1))) {
        yield [t, ...tt];
      }
    }
  }
}

function newArray<T>(n: number, fill: () => T): T[] {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push(fill());
  }
  return arr;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function recommendArtifactSet(
  backup: ei.IBackup,
  strategy: Strategy,
  opts?: { excludedIds?: string[]; debug?: boolean; requireGusset?: boolean }
): Contender {
  const debug = opts?.debug ?? false;
  const isVirtue = isVirtueStrategy(strategy);
  const inventory = new Inventory(backup.artifactsDb!, {
    excludedIds: opts?.excludedIds,
    virtue: isVirtue,
  });

  const families = new Map<Name, InventoryFamily>();
  for (const family of inventory.catalog) {
    families.set(family.afxId, family);
  }

  const artifactSlots =
    strategy === Strategy.STANDARD_PERMIT_SINGLE_PRELOAD || strategy === Strategy.STANDARD_PERMIT_VIRTUE_CTE ? 2 : 4;

  // Effect multiplier functions
  const virtueMultiplierFunc = (delta: number) => 1 + delta;
  const prestigeMultiplierFunc = (delta: number) => 1 + delta;
  const inactiveMultiplierFunc = () => 1; // For artifacts/stones not relevant to strategy

  // For virtue, cube has research discount effect
  const cubeMultiplierFunc = isVirtue
    ? (delta: number) => 1 / (1 + delta) // Research price discount: delta is negative, so 1/(1+delta) gives boost
    : inactiveMultiplierFunc;

  // Determine which artifacts and stones are active for this strategy
  const necklaceFunc = isVirtue ? virtueMultiplierFunc : prestigeMultiplierFunc;
  const ankhFunc = isVirtue ? virtueMultiplierFunc : prestigeMultiplierFunc;
  // Lunar totem only contributes away earnings — only active for lunar-prestige and virtue strategies.
  const totemFunc =
    isVirtue || strategy === Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO ? prestigeMultiplierFunc : inactiveMultiplierFunc;
  const cubeFunc = cubeMultiplierFunc;
  // Chalice only contributes for all-in-one and multi strategies.
  const chaliceFunc =
    strategy === Strategy.PRO_PERMIT_MULTI || strategy === Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO
      ? prestigeMultiplierFunc
      : inactiveMultiplierFunc;
  // Gusset only contributes for preload strategies.
  const gussetFunc =
    strategy === Strategy.STANDARD_PERMIT_SINGLE_PRELOAD ||
    strategy === Strategy.PRO_PERMIT_SINGLE_PRELOAD ||
    strategy === Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO
      ? prestigeMultiplierFunc
      : inactiveMultiplierFunc;
  const shellStoneFunc = isVirtue ? virtueMultiplierFunc : prestigeMultiplierFunc;
  // Lunar stones only contribute away earnings — only active for lunar-prestige and virtue strategies.
  const lunarStoneFunc =
    isVirtue || strategy === Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO ? prestigeMultiplierFunc : inactiveMultiplierFunc;

  // For prestige-specific artifacts
  let homeFarm: Farm | null = null;
  let numProphecyEggs = 0;
  let monoclePowerIndex = 1;

  if (!isVirtue) {
    homeFarm = new Farm(backup, backup.farms![0]);
    numProphecyEggs = getNumProphecyEggs(backup);

    // monocle power index depends on strategy
    switch (strategy) {
      case Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO:
      case Strategy.STANDARD_PERMIT_SINGLE_PRELOAD:
      case Strategy.PRO_PERMIT_SINGLE_PRELOAD:
        monoclePowerIndex = 2; // Monocle affects bird feeds and soul beacons
        break;
      case Strategy.PRO_PERMIT_MULTI:
        monoclePowerIndex = 3; // Monocle affects bird feeds, soul beacons, and tachyon prisms
        break;
    }
  }

  const bestFeathers = contendersInArtifactFamily(
    families.get(Name.PHOENIX_FEATHER),
    isVirtue ? inactiveMultiplierFunc : prestigeMultiplierFunc
  );
  const bestNecklaces = contendersInArtifactFamily(families.get(Name.DEMETERS_NECKLACE), necklaceFunc);
  const bestAnkhs = contendersInArtifactFamily(families.get(Name.TUNGSTEN_ANKH), ankhFunc);
  const bestMonocles = contendersInArtifactFamily(
    families.get(Name.DILITHIUM_MONOCLE),
    isVirtue ? inactiveMultiplierFunc : delta => (1 + delta) ** monoclePowerIndex
  );
  const bestMetronomes = contendersInArtifactFamily(
    families.get(Name.QUANTUM_METRONOME),
    isVirtue ? inactiveMultiplierFunc : prestigeMultiplierFunc
  );
  const bestChalices = contendersInArtifactFamily(families.get(Name.THE_CHALICE), chaliceFunc);
  // For virtue or when gusset is required, prioritize stone slots over effect
  const bestGussets = contendersInArtifactFamily(families.get(Name.ORNATE_GUSSET), gussetFunc);
  const bestTotems = contendersInArtifactFamily(families.get(Name.LUNAR_TOTEM), totemFunc);
  const bestCubes = contendersInArtifactFamily(families.get(Name.PUZZLE_CUBE), cubeFunc);

  // Validate gusset availability if required
  if (opts?.requireGusset && bestGussets.isEmpty) {
    throw new Error('Gusset required but none available in inventory');
  }

  // Other artifacts as stone holders
  const others = [
    Name.AURELIAN_BROOCH,
    Name.NEODYMIUM_MEDALLION,
    Name.MERCURYS_LENS,
    Name.BEAK_OF_MIDAS,
    Name.CARVED_RAINSTICK,
    Name.INTERSTELLAR_COMPASS,
    Name.TITANIUM_ACTUATOR,
    Name.SHIP_IN_A_BOTTLE,
    Name.TACHYON_DEFLECTOR,
  ]
    .concat(isVirtue ? [] : [Name.PUZZLE_CUBE])
    .map(afxId =>
      contendersInArtifactFamily(families.get(afxId), inactiveMultiplierFunc, {
        rareOrAbove: true,
      })
    )
    .filter(c => !c.isEmpty);
  const getNumStoneSlotsTaken = (contenders: Contenders): number => {
    for (const c of contenders.iter()) {
      return c.numStoneSlotsTaken;
    }
    return 0;
  };
  others.sort((c1, c2) => getNumStoneSlotsTaken(c1) - getNumStoneSlotsTaken(c2));
  if (others.length > artifactSlots) {
    others.length = artifactSlots;
  }

  const choices = [
    bestFeathers,
    bestNecklaces,
    bestAnkhs,
    bestMonocles,
    bestMetronomes,
    bestChalices,
    bestGussets,
    bestTotems,
    ...(isVirtue ? [bestCubes] : []),
  ]
    .filter(c => !c.isEmpty)
    .concat(others);

  while (choices.length < artifactSlots) {
    // Slots intentionally left empty due to the lack of potentially effective artifacts.
    choices.push(new Contenders([new Contender([], [], 1, 0, 1)]));
  }

  // independentArtifactCombos[n] is the contenders with n artifact slots taken.
  const independentArtifactCombos = newArray(artifactSlots + 1, () => new Contenders());
  for (let n = artifactSlots - 2; n <= artifactSlots; n++) {
    const combos = new Contenders();
    if (opts?.requireGusset) {
      // Only generate combos that include a gusset
      const otherChoices = choices.filter(c => c !== bestGussets);
      // Generate combos with n-1 slots from other choices, plus 1 gusset
      for (const familyCombo of combinations(otherChoices, n - 1)) {
        const pools = [...familyCombo, bestGussets].map(family => [...family.iter()]);
        for (const combo of product(...pools)) {
          combos.add(combine(...combo));
        }
      }
    } else {
      for (const familyCombo of combinations(choices, n)) {
        const pools = familyCombo.map(family => [...family.iter()]);
        for (const combo of product(...pools)) {
          combos.add(combine(...combo));
        }
      }
    }
    combos.trim();
    independentArtifactCombos[n] = combos;
    combos.debug(`${n} independent artifact combos`);
    combos.assertNumArtifactSlotsTaken(n);
  }

  const maxSpareStoneSlotsForOtherCombos = maxSpareStoneSlotsInContenders(independentArtifactCombos[artifactSlots]);

  // For virtue, skip book/prophecy and vial/terra combos
  let prophecyCombos: Contenders[];
  let rcbCombos: Contenders[];

  if (isVirtue) {
    prophecyCombos = [new Contenders([new Contender([], [], 0, 0, 1)]), new Contenders()];
    rcbCombos = [new Contenders([new Contender([], [], 0, 0, 1)]), new Contenders()];
  } else {
    // Note that here we're using effectMultiplier only to take advantage of
    // existing code. What's stored is the additive effect to each prophecy egg.
    const bestBooks = contendersInArtifactFamily(families.get(Name.BOOK_OF_BASAN), delta => delta);
    const noBook = new Contenders([new Contender([], [], 0, 0, 0)]);
    const bestProphecyStones = bestsInStoneFamily(
      families.get(Name.PROPHECY_STONE),
      maxSpareStoneSlotsForOtherCombos + maxSpareStoneSlotsInContenders(bestBooks)
    );
    const bareProphecyEggBonus = homeFarm!.bareProphecyEggBonus;
    const getProphecyComboEffect = (contender: Contender, stones: Item[]): number => {
      // Recall that contender.effectMultiplier is actually the delta of the book.
      const prophecyEggBonus =
        bareProphecyEggBonus + contender.effectMultiplier + stones.reduce((sum, stone) => sum + stone.effectDelta, 0);
      return ((1 + prophecyEggBonus) / (1 + bareProphecyEggBonus)) ** numProphecyEggs;
    };
    prophecyCombos = [
      addStonesToContenders(noBook, bestProphecyStones, getProphecyComboEffect, maxSpareStoneSlotsForOtherCombos),
      addStonesToContenders(bestBooks, bestProphecyStones, getProphecyComboEffect, maxSpareStoneSlotsForOtherCombos),
    ];
    for (let i = 0; i < 2; i++) {
      prophecyCombos[i].debug(`${i} book prophecy combos`);
      prophecyCombos[i].assertNumArtifactSlotsTaken(i);
    }

    // Similar to books, effectMultiplier stored here is additive effect to max RCB.
    const bestVials = contendersInArtifactFamily(families.get(Name.VIAL_MARTIAN_DUST), delta => delta);
    const noVial = new Contenders([new Contender([], [], 0, 0, 0)]);
    const bestTerraStones = bestsInStoneFamily(
      families.get(Name.TERRA_STONE),
      maxSpareStoneSlotsForOtherCombos + maxSpareStoneSlotsInContenders(bestVials)
    );
    const bareMaxRCB = homeFarm!.bareMaxRunningChickenBonusWithMaxedCommonResearches;
    const getRcbComboEffect = (contender: Contender, stones: Item[]): number => {
      // Recall that contender.effectMultiplier is actually the delta of the vial.
      const maxRCB =
        bareMaxRCB + contender.effectMultiplier + stones.reduce((sum, stone) => sum + stone.effectDelta, 0);
      return strategy == Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO ? 1 : maxRCB / bareMaxRCB;
    };
    rcbCombos = [
      addStonesToContenders(noVial, bestTerraStones, getRcbComboEffect, maxSpareStoneSlotsForOtherCombos),
      addStonesToContenders(bestVials, bestTerraStones, getRcbComboEffect, maxSpareStoneSlotsForOtherCombos),
    ];
    for (let i = 0; i < 2; i++) {
      rcbCombos[i].debug(`${i} vial RCB combos`);
      rcbCombos[i].assertNumArtifactSlotsTaken(i);
    }
  }

  // i1 is the number of artifact slots taken by the prophecy combo (0 or 1),
  // and i2 is the number taken by the RCB combo (again, 0 or 1).
  const independentStoneFreeCombos = new Contenders();
  let maxIndependentStoneSlots = 0;
  for (let i1 = 0; i1 < 2; i1++) {
    for (let i2 = 0; i2 < 2; i2++) {
      const nIndependent = artifactSlots - i1 - i2;
      for (const prophecyCombo of prophecyCombos[i1].iter()) {
        for (const rcbCombo of rcbCombos[i2].iter()) {
          for (const independentCombo of independentArtifactCombos[nIndependent].iter()) {
            const combined = combine(prophecyCombo, rcbCombo, independentCombo);
            if (combined.numStoneSlotsTaken <= 0) {
              independentStoneFreeCombos.add(combined);
              if (-combined.numStoneSlotsTaken > maxIndependentStoneSlots) {
                maxIndependentStoneSlots = -combined.numStoneSlotsTaken;
              }
            }
          }
        }
      }
    }
  }
  independentStoneFreeCombos.trim();
  independentStoneFreeCombos.debug('Combos ready for independent stones');
  independentStoneFreeCombos.assertNumArtifactSlotsTaken(artifactSlots);

  // Independent stones
  const bestLunarStones = bestsInStoneFamily(families.get(Name.LUNAR_STONE), maxIndependentStoneSlots).map(stone => ({
    stone,
    multiplier: isVirtue
      ? lunarStoneFunc(stone.effectDelta)
      : strategy === Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO
        ? 1 + stone.effectDelta
        : 1,
  }));
  const bestShellStones = bestsInStoneFamily(families.get(Name.SHELL_STONE), maxIndependentStoneSlots).map(stone => ({
    stone,
    multiplier: shellStoneFunc(stone.effectDelta),
  }));

  let bestTachyonStones: { stone: Item; multiplier: number }[] = [];
  let bestSoulStones: { stone: Item; multiplier: number }[] = [];
  let bestLifeStones: { stone: Item; multiplier: number }[] = [];

  if (!isVirtue) {
    bestTachyonStones = bestsInStoneFamily(families.get(Name.TACHYON_STONE), maxIndependentStoneSlots).map(stone => ({
      stone,
      multiplier: 1 + stone.effectDelta,
    }));
    let soulBonusAccumulator = homeFarm!.bareSoulEggBonus;
    bestSoulStones = bestsInStoneFamily(families.get(Name.SOUL_STONE), maxIndependentStoneSlots).map(stone => {
      const before = soulBonusAccumulator;
      soulBonusAccumulator += stone.effectDelta;
      const after = soulBonusAccumulator;
      return { stone, multiplier: after / before };
    });
    bestLifeStones = bestsInStoneFamily(families.get(Name.LIFE_STONE), maxIndependentStoneSlots).map(stone => ({
      stone,
      multiplier: 1 + stone.effectDelta,
    }));
  }

  const bestIndependentStones = (<{ stone: Item; multiplier: number }[]>[])
    .concat(bestShellStones, bestTachyonStones, bestSoulStones, bestLifeStones, bestLunarStones)
    .sort((s1, s2) => s2.multiplier - s1.multiplier)
    .slice(0, maxIndependentStoneSlots)
    .map(s => new Contender([], [s.stone], 0, 1, s.multiplier));

  let stoneCombo = new Contender([], [], 0, 0, 1);
  const bestIndependentStoneCombos = range(maxIndependentStoneSlots + 1).map(n => {
    if (n === 0) {
      // Empty.
    } else if (n <= bestIndependentStones.length) {
      stoneCombo = combine(stoneCombo, bestIndependentStones[n - 1]);
    } else {
      // Not enough stones, add phantom stone.
      stoneCombo = combine(stoneCombo, new Contender([], [], 0, 1, 1));
    }
    stoneCombo.assertNumStoneSlotsTaken(n);
    return stoneCombo;
  });
  if (debug) {
    console.debug(`%cBest independent stone combos:`, 'color: orangered');
  }
  for (const c of bestIndependentStoneCombos) {
    c.debug();
  }

  const finishedCombos = new Contenders();
  for (const c of independentStoneFreeCombos.iter()) {
    finishedCombos.add(combine(c, bestIndependentStoneCombos[-c.numStoneSlotsTaken]));
  }
  finishedCombos.trim();
  finishedCombos.debug('Best finished combos');
  finishedCombos.assertNumArtifactSlotsTaken(artifactSlots);
  finishedCombos.assertNumStoneSlotsTaken(0);

  const flattened = [...finishedCombos.iter()];
  if (flattened.length !== 1) {
    throw new Error(`expected 1 winner, found ${flattened.length}: ${flattened}`);
  }
  const winner = flattened[0];
  winner.calibrate();

  if (strategy === Strategy.PRO_PERMIT_LUNAR_PRELOAD_AIO) {
    winner.adjustLunar(homeFarm!.bareMaxRunningChickenBonusWithMaxedCommonResearches);
  }

  return winner;
}

class ImpossibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpossibleError';
  }
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

// Check if a stoned artifact in choices (1) has the specified host item and (2)
// all its stones are within the stonePool. If there are multiple candidates,
// choose one with the most stones.
function findMatchingItem(host: Item, stonePool: Item[], choices: Artifact[]): Artifact | null {
  const hostKey = host.key;
  const stonePoolCounter = new Counter(stonePool.map(s => s.key));
  let match: Artifact | null = null;
  let matchStoneCount = 0;
  for (const choice of choices) {
    if (choice.key !== hostKey || choice.stones.length <= matchStoneCount) {
      continue;
    }
    if (stonePoolCounter.contains(choice.stones.map(s => s.key))) {
      match = choice;
      matchStoneCount = choice.stones.length;
    }
  }
  return match;
}

class Counter<T> {
  counts: Map<T, number>;

  constructor(s: Iterable<T>) {
    this.counts = new Map<T, number>();
    for (const el of s) {
      this.counts.set(el, (this.counts.get(el) ?? 0) + 1);
    }
  }

  contains(c: Counter<T> | Iterable<T>) {
    const counts = c instanceof Counter ? c.counts : new Counter(c).counts;
    for (const [el, count] of counts.entries()) {
      if ((this.counts.get(el) ?? 0) < count) {
        return false;
      }
    }
    return true;
  }
}

// Extract an item from items if it exists (items is updated in place) and
// returns it. Returns null if it doesn't exist.
function extractItem(items: Item[], wantedItem: Item): Item | null {
  const wantedKey = wantedItem.key;
  for (let i = 0; i < items.length; i++) {
    if (items[i].key === wantedKey) {
      const extracted = items[i];
      items.splice(i, 1);
      return extracted;
    }
  }
  return null;
}

/**
 * Convert a Contender to an ArtifactSet with assembly statuses.
 * This function takes the recommended artifact/stone combination and constructs
 * actual Artifact objects, matching against the currently equipped set and inventory.
 *
 * @param contender - The winning contender from recommendArtifactSet
 * @param guide - The currently equipped artifact set
 * @param inventory - The player's artifact inventory
 * @returns Object with the constructed artifact set and assembly status for each artifact
 */
export function contenderToArtifactSet(
  contender: Contender,
  guide: ArtifactSet,
  inventory: Inventory
): { artifactSet: ArtifactSet; assemblyStatuses: ArtifactAssemblyStatusNonMissing[] } {
  // First test if the currently equipped set is already optimal, and if so
  // directly return it.
  if (contender.equals(Contender.fromArtifactSet(guide))) {
    return {
      artifactSet: new ArtifactSet(guide.artifacts, false),
      assemblyStatuses: guide.artifacts.map(() => ArtifactAssemblyStatus.EQUIPPED),
    };
  }

  const unstonedArtifacts = [...contender.artifacts].sort((a1, a2) => {
    if (a1.slots !== a2.slots) {
      return a1.slots - a2.slots;
    }
    if (a1.baseCraftingPrice !== a2.baseCraftingPrice) {
      return a1.baseCraftingPrice - a2.baseCraftingPrice;
    }
    return a1.quality - a2.quality;
  });
  const stones = [...contender.stones];
  const guideArtifacts = guide.artifacts;
  const inventoryArtifacts = inventory.stoned;

  let constructedArtifacts: Artifact[] = [];
  for (const host of unstonedArtifacts) {
    if (host.slots === 0) {
      constructedArtifacts.push(new Artifact(host, []));
      continue;
    }
    // Attempt to find a match first in the guide set, then in the inventory.
    const match = findMatchingItem(host, stones, guideArtifacts) || findMatchingItem(host, stones, inventoryArtifacts);
    const constructed = match !== null ? new Artifact(match.host, [...match.stones]) : new Artifact(host, []);
    constructedArtifacts.push(constructed);
    for (const stone of constructed.stones) {
      const extracted = extractItem(stones, stone);
      if (extracted === null) {
        throw new ImpossibleError(`trying to slot ${stone.id} which doesn't exist in the recommendation`);
      }
    }
  }

  // Put in the remaining stones, less expensive ones first, so that future
  // replacements hopefully happen on cheaper hosts first.
  if (stones.length > 0) {
    stones.sort((s1, s2) => s1.baseCraftingPrice - s2.baseCraftingPrice);
    for (const constructed of constructedArtifacts) {
      while (stones.length > 0 && constructed.stones.length < constructed.slots) {
        constructed.stones.push(stones.shift()!);
      }
      if (stones.length === 0) {
        break;
      }
    }
  }
  if (stones.length > 0) {
    throw new ImpossibleError(`nowhere to slot some stones in the recommendation: ${stones.map(s => s.id).join(', ')}`);
  }

  // Reorder constructed artifacts to best match the guide set.
  const reordered: (Artifact | null)[] = [...constructedArtifacts];
  while (reordered.length < guideArtifacts.length) {
    reordered.push(null);
  }
  for (let i = 0; i < guideArtifacts.length; i++) {
    const guideAfxId = guideArtifacts[i].afxId;
    if (reordered[i]?.afxId === guideAfxId) {
      continue;
    }
    for (let j = 0; j < reordered.length; j++) {
      if (reordered[j]?.afxId === guideAfxId) {
        [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
        break;
      }
    }
  }
  constructedArtifacts = reordered.filter(notNull);
  const constructedSet = new ArtifactSet(constructedArtifacts, false);

  // Double check.
  const constructedContender = Contender.fromArtifactSet(constructedSet);
  if (!constructedContender.equals(contender)) {
    console.error(`constructed:`, constructedArtifacts);
    throw new ImpossibleError(
      `constructed set differ from contender generated by recommendataion engine: ` +
        `got ${constructedContender}, expected ${contender}`
    );
  }

  const guideArtifactKeys = new Set(guideArtifacts.map(artifact => artifact.completeKey));
  const inventoryArtifactKeys = new Set(inventoryArtifacts.map(artifact => artifact.completeKey));
  const assemblyStatuses = <ArtifactAssemblyStatusNonMissing[]>[];
  for (const artifact of constructedArtifacts) {
    const key = artifact.completeKey;
    if (guideArtifactKeys.has(key)) {
      assemblyStatuses.push(ArtifactAssemblyStatus.EQUIPPED);
    } else if (artifact.stones.length === 0) {
      // Unstoned artifacts are trivially "assembled".
      assemblyStatuses.push(ArtifactAssemblyStatus.ASSEMBLED);
      continue;
    } else {
      assemblyStatuses.push(
        inventoryArtifactKeys.has(key) ? ArtifactAssemblyStatus.ASSEMBLED : ArtifactAssemblyStatus.AWAITING_ASSEMBLY
      );
    }
  }

  return {
    artifactSet: constructedSet,
    assemblyStatuses,
  };
}

// ---------------------------------------------------------------------------
// Delivery-rate (effective lay rate) recommendation
//
// Unlike the drift-based search above, delivery rate is maximized by a small
// set of interdependent artifacts (Quantum Metronome, Interstellar Compass,
// Ornate Gusset) whose value comes from their stone slots as much as from their
// own effects. The search therefore enumerates artifact STRUCTURES (combinations
// of 1-4 owned artifacts) and greedily balances Tachyon/Quantum stones into the
// free slots, scoring each candidate with a caller-supplied callback — the
// lay-rate/shipping/hab-capacity formulas differ per app.
// ---------------------------------------------------------------------------

/**
 * Metrics produced by an {@link RecommendElrSetOptions.evaluate} callback for a
 * candidate loadout.
 */
export interface ElrMetrics {
  layRate: number;
  shipRate: number;
  elr: number;
}

export interface RecommendElrSetOptions {
  /** Prebuilt virtue inventory; defaults to one built from the backup. */
  inventory?: Inventory;
  /** Skip Gussets when generating candidate structures. */
  excludeGusset?: boolean;
  /**
   * Skip the up-to-495-combo artifact STRUCTURE search entirely and evaluate stone placement for
   * exactly this structure instead — one `artifactId` per slot (`null` for an empty slot), same
   * shape as a prior call's own return value's `.map(slot => slot.artifactId)`. Any stones on
   * those slots are ignored; stone placement is always re-solved fresh against the given research
   * state, since which stone type (tachyon vs. quantum) belongs in each slot depends on which of
   * lay rate/shipping capacity is currently the bottleneck — that shifts as research levels
   * change, even though which ARTIFACTS are worth equipping doesn't (that's driven by owned
   * inventory and target-artifact tiers, neither of which a research purchase changes). Intended
   * for callers that already know the winning structure from an earlier, unforced call against
   * the same backup and just want that same structure's stats at a different research level —
   * skipping the structure search this way is roughly 500x cheaper per call, since only one
   * structure's stone placement runs instead of every combo's.
   */
  forcedArtifacts?: (string | null)[];
  /** If the winning set is functionally identical to this one, return it unchanged. */
  currentSet?: (EquippedArtifact | null)[] | null;
  /** Stone slot count for a given artifact option ID (defaults to the shared registry). */
  slotsForArtifact?: (artifactId: string | null) => number;
  /**
   * Compute the lay rate, shipping rate, and effective lay rate (delivery rate) for a candidate
   * loadout under the caller's farm state. Supplied by each app since the underlying lay
   * rate/shipping/hab-capacity formulas differ between the planner and the companion.
   */
  evaluate: (loadout: EquippedArtifact[]) => ElrMetrics;
}

/**
 * Find the optimal delivery-rate (effective lay rate) artifact set for one of the ELR strategies.
 *
 * Thin strategy-aware entry over {@link recommendElrArtifactSet}: validates the strategy and
 * builds the virtue inventory when the caller doesn't supply one (the search only makes sense
 * over the virtue artifact inventory).
 */
export function recommendElrSet(
  backup: ei.IBackup,
  strategy: Strategy,
  options: RecommendElrSetOptions
): EquippedArtifact[] {
  if (!isElrStrategy(strategy)) {
    throw new Error(`strategy ${Strategy[strategy]} is not a delivery-rate (ELR) strategy`);
  }
  if (!backup.artifactsDb) {
    return createEmptyLoadout();
  }
  const { inventory, ...searchOptions } = options;
  return recommendElrArtifactSet(
    backup,
    inventory ?? new Inventory(backup.artifactsDb, { virtue: true }),
    searchOptions
  );
}

/**
 * Find the artifact set that maximizes effective lay rate (delivery rate) for the given virtue
 * inventory, balancing Metronomes, Compasses, and Gussets with Tachyon/Quantum stones.
 *
 * The structure search and stone placement are app-agnostic; the caller supplies an `evaluate`
 * callback that turns a candidate loadout into lay rate/shipping/ELR metrics.
 */
function recommendElrArtifactSet(
  backup: ei.IBackup,
  inventory: Inventory,
  options: Omit<RecommendElrSetOptions, 'inventory'>
): EquippedArtifact[] {
  const excludeGusset = options.excludeGusset ?? false;
  const slotsForArtifact = options.slotsForArtifact ?? (id => (id ? (getArtifact(id)?.slots ?? 0) : 0));

  // 1. Identify candidate artifact STRUCTURES to search over — skipped entirely when
  // `forcedArtifacts` is given: the search collapses to the one caller-supplied structure
  // instead of the up-to-495-combo search below, so step 3 only ever evaluates stone placement
  // for that one structure.
  let candidateLoadouts: EquippedArtifact[][];

  if (options.forcedArtifacts) {
    const forcedLoadout: EquippedArtifact[] = options.forcedArtifacts.map(artifactId => ({
      artifactId,
      stones: new Array(slotsForArtifact(artifactId)).fill(null),
    }));
    while (forcedLoadout.length < 4) forcedLoadout.push({ artifactId: null, stones: [] });
    candidateLoadouts = [forcedLoadout];
  } else {
    const name = ei.ArtifactSpec.Name;
    const targetAfxIds = new Set(ELR_TARGET_AFX_IDS);

    // Candidate Wrapper
    type Candidate = { item: InventoryItem; rarity: ei.ArtifactSpec.Rarity; slots: number; isTarget: boolean };
    const afxGroups = new Map<number, Candidate[]>();

    for (const item of inventory.items) {
      if (item.have === 0 || !item.isArtifact) continue;

      const afxId = item.afxId;
      if (excludeGusset && afxId === name.ORNATE_GUSSET) continue;

      const isTarget = targetAfxIds.has(afxId);

      // Find best rarity for this tier
      for (const rarity of [
        ei.ArtifactSpec.Rarity.LEGENDARY,
        ei.ArtifactSpec.Rarity.EPIC,
        ei.ArtifactSpec.Rarity.RARE,
        ei.ArtifactSpec.Rarity.COMMON,
      ]) {
        if (item.haveRarity[rarity] > 0) {
          const slots = item.stoneSlotCount(rarity);
          const cand: Candidate = { item, rarity, slots, isTarget };

          if (!afxGroups.has(afxId)) afxGroups.set(afxId, []);
          afxGroups.get(afxId)!.push(cand);
          break; // Only take best rarity of each tier
        }
      }
    }

    const finalCandidates: Candidate[] = [];

    // Sort each AFX group by "goodness"
    for (const [afxId, group] of afxGroups.entries()) {
      const isTarget = targetAfxIds.has(afxId);

      if (isTarget) {
        // Keep only the Pareto-optimal tier/rarity for this family: a candidate
        // is dropped when some other owned tier is at least as good on both
        // base effect delta and stone slots (and strictly better on one). This
        // reduces a T4 Legendary (typically max delta AND max slots) down to a
        // single candidate, but keeps genuine trade-offs alive -- e.g. a T2
        // Epic Gusset (fewer tiers, more slots) survives alongside a T4 Common
        // Gusset (more delta, no slots) because neither dominates the other,
        // and it's the stone/ELR search below that has to settle it.
        const delta = (c: Candidate) => c.item.effectDelta(c.rarity);
        const pareto = group.filter(
          a =>
            !group.some(
              b => b !== a && delta(b) >= delta(a) && b.slots >= a.slots && (delta(b) > delta(a) || b.slots > a.slots)
            )
        );
        finalCandidates.push(...pareto);
      } else {
        group.sort((a, b) => {
          if (a.slots !== b.slots) return b.slots - a.slots;
          return b.item.tierNumber - a.item.tierNumber;
        });
        // For non-targets, we only care about the single best carrier from this family
        finalCandidates.push(group[0]);
      }
    }

    // Pick top 4 of the non-target leaders based on slots
    const targetCands = finalCandidates.filter(c => c.isTarget);
    const nonTargetCands = finalCandidates
      .filter(c => !c.isTarget)
      .sort((a, b) => b.slots - a.slots)
      .slice(0, 4);

    const topCandidates = [...targetCands, ...nonTargetCands];

    // Search through combinations of 1 to 4 artifacts
    // 12C4 = 495, which is small enough.
    function combinations<T>(array: T[], r: number): T[][] {
      const result: T[][] = [];
      function helper(start: number, combo: T[]) {
        if (combo.length === r) {
          result.push([...combo]);
          return;
        }
        for (let i = start; i < array.length; i++) {
          helper(i + 1, [...combo, array[i]]);
        }
      }
      helper(0, []);
      return result;
    }

    const combos = [
      ...combinations(topCandidates, 1),
      ...combinations(topCandidates, 2),
      ...combinations(topCandidates, 3),
      ...combinations(topCandidates, 4),
    ];

    candidateLoadouts = combos
      .filter(comboWrappers => {
        // Ensure all artifacts in the combination are from unique families
        const families = new Set(comboWrappers.map(w => w.item.props.family.afx_id));
        return families.size === comboWrappers.length;
      })
      .map(comboWrappers => {
        const loadout: EquippedArtifact[] = comboWrappers.map(wrapper => ({
          // Use the family ID from props. This maps correctly to gusset-x-y instead of ornate-gusset-x-y
          artifactId: `${wrapper.item.props.family.id}-${wrapper.item.tierNumber}-${wrapper.rarity}`,
          stones: new Array(wrapper.slots).fill(null),
        }));
        while (loadout.length < 4) loadout.push({ artifactId: null, stones: [] });
        return loadout;
      });
  }

  // 2. Gather available stones (Tachyon and Quantum)
  const tachyonStones = inventory.items
    .filter(i => i.isStone && i.props.family.id === ELR_STONE_FAMILY_IDS.tachyon && i.tierNumber >= 2)
    .map(i => ({
      id: i.id,
      delta: i.props.effects?.[0]?.effect_delta || 0,
      count: i.haveCommon,
      tier: i.tierNumber,
    }))
    .sort((a, b) => b.tier - a.tier);

  const quantumStones = inventory.items
    .filter(i => i.isStone && i.props.family.id === ELR_STONE_FAMILY_IDS.quantum && i.tierNumber >= 2)
    .map(i => ({
      id: i.id,
      delta: i.props.effects?.[0]?.effect_delta || 0,
      count: i.haveCommon,
      tier: i.tierNumber,
    }))
    .sort((a, b) => b.tier - a.tier);

  // 3. Optimization Loop
  let bestSet: EquippedArtifact[] = createEmptyLoadout();
  let maxELR = -1;
  let bestMetrics: ElrMetrics | null = null;

  for (const loadout of candidateLoadouts) {
    const totalStoneSlots = loadout.reduce((sum, slot) => sum + slot.stones.length, 0);

    const evaluateStones = (stones: (string | null)[]): ElrMetrics => {
      const tempLoadout: EquippedArtifact[] = JSON.parse(JSON.stringify(loadout));
      let sIdx = 0;
      for (const slot of tempLoadout) {
        for (let i = 0; i < slot.stones.length; i++) {
          slot.stones[i] = stones[sIdx++];
        }
      }
      return options.evaluate(tempLoadout);
    };

    const remTachyonStones = tachyonStones.map(s => ({ ...s }));
    const remQuantumStones = quantumStones.map(s => ({ ...s }));
    const currentStones: (string | null)[] = new Array(totalStoneSlots).fill(null);

    for (let slotIdx = 0; slotIdx < totalStoneSlots; slotIdx++) {
      const metrics = evaluateStones(currentStones);

      if (metrics.layRate < metrics.shipRate) {
        const bestTachyon = remTachyonStones.find(s => s.count > 0);
        if (bestTachyon) {
          currentStones[slotIdx] = bestTachyon.id;
          bestTachyon.count--;
        } else {
          const bestQuantum = remQuantumStones.find(s => s.count > 0);
          if (bestQuantum) {
            currentStones[slotIdx] = bestQuantum.id;
            bestQuantum.count--;
          }
        }
      } else {
        const bestQuantum = remQuantumStones.find(s => s.count > 0);
        if (bestQuantum) {
          currentStones[slotIdx] = bestQuantum.id;
          bestQuantum.count--;
        } else {
          const bestTachyon = remTachyonStones.find(s => s.count > 0);
          if (bestTachyon) {
            currentStones[slotIdx] = bestTachyon.id;
            bestTachyon.count--;
          }
        }
      }
    }

    currentStones.sort((a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;

      const isTa = a.indexOf('quantum') === 0;
      const isTb = b.indexOf('quantum') === 0;
      if (isTa && !isTb) return -1;
      if (!isTa && isTb) return 1;

      const tierA = parseInt(a.split('-').pop() || '0', 10);
      const tierB = parseInt(b.split('-').pop() || '0', 10);
      return tierB - tierA;
    });

    const bestStonesForThisLoadout = currentStones;
    const bestMetricsForThisLoadout = evaluateStones(currentStones);
    const bestELRForThisLoadout = bestMetricsForThisLoadout.elr;

    const currentBestLayRate = bestMetricsForThisLoadout?.layRate ?? -1;
    const globalBestLayRate = bestMetrics?.layRate ?? -1;

    const isGlobalBetter =
      bestELRForThisLoadout > maxELR || (bestELRForThisLoadout === maxELR && currentBestLayRate > globalBestLayRate);

    if (isGlobalBetter) {
      maxELR = bestELRForThisLoadout;
      const optimizedLoadout = JSON.parse(JSON.stringify(loadout));
      let sIdx = 0;
      for (const slot of optimizedLoadout) {
        for (let i = 0; i < slot.stones.length; i++) {
          slot.stones[i] = bestStonesForThisLoadout[sIdx++];
        }
      }
      bestSet = optimizedLoadout;
      bestMetrics = bestMetricsForThisLoadout;
    }
  }

  if (options.currentSet && isFunctionallyIdentical(bestSet, options.currentSet)) {
    return options.currentSet as EquippedArtifact[];
  }

  return bestSet;
}

/**
 * Compare two artifact sets for functional equivalence.
 */
export function isFunctionallyIdentical(
  setA: EquippedArtifact[],
  setB: (EquippedArtifact | null)[] | undefined
): boolean {
  if (!setA || !setB) return false;

  const targetAfxIds = ELR_TARGET_AFX_IDS;

  const normalize = (set: (EquippedArtifact | null)[]) => {
    const targets: string[] = []; // Target IDs (e.g. quantum-metronome-4-3)
    const holderSlots: number[] = []; // Slot counts for non-target artifacts
    const stoneCounts: Record<string, number> = {};

    for (const slot of set) {
      if (!slot?.artifactId) continue;
      const artifact = getArtifact(slot.artifactId);
      if (!artifact) continue;

      if (targetAfxIds.includes(artifact.afxId as ei.ArtifactSpec.Name)) {
        targets.push(slot.artifactId);
      } else {
        holderSlots.push(artifact.slots);
      }

      for (const stoneId of slot.stones) {
        if (stoneId) {
          stoneCounts[stoneId] = (stoneCounts[stoneId] || 0) + 1;
        }
      }
    }

    return JSON.stringify({
      targets: targets.sort(),
      holders: holderSlots.sort((a, b) => a - b),
      stones: Object.entries(stoneCounts).sort((a, b) => a[0].localeCompare(b[0])),
    });
  };

  return normalize(setA) === normalize(setB);
}
