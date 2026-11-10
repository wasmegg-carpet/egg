/**
 * Finds the artifact loadout with the highest offline earnings, or the highest offline internal
 * hatchery rate, for a farm state.
 *
 * Only artifacts and stones that touch the goal are tried (for earnings: egg value, laying rate,
 * shipping, away earnings, the SE and PE bonuses; for IHR: those plus internal hatchery rate, so
 * slots IHR can't use still earn), plus the gusset when the population needs it to stay within hab
 * capacity. Only what's in the player's inventory is used, and no stone more times than they have
 * it; with no inventory everything counts as owned.
 *
 * Ties at the current population (e.g. a lay-limited farm, where shipping does nothing yet) are
 * broken by offline earnings with full habs.
 */
import { artifactOptions, stoneOptions, getArtifact } from './data';
import { calculateArtifactModifiers, artifactSlotCount } from './calculator';
import type { ArtifactOption, EquippedArtifact, StoneOption } from './types';
import { ownedStoneCount, ownsArtifact, type PlayerInventory } from './inventory';
import { computeSnapshot } from 'lib/planners/engine/compute';
import type { EngineState, SimulationContext } from '@/engine/types';
import { calculateEarningBonus } from '@/calculations/earnings';

const CLARITY_FAMILY = 'clarity-stone';
const LIGHT_OF_EGGENDIL_FAMILY = 'light-of-eggendil';
const GUSSET_FAMILIES = ['gusset', 'ornate-gusset'];

export type ArtifactGoal = 'offlineEarnings' | 'ihr';

const IHR_TARGET = 'internal hatchery rate';
const EARNING_TARGETS = new Set([
  'egg value',
  'enlightenment egg value',
  'egg laying rate',
  'shipping rate',
  'away earnings',
  'Egg of Prophecy bonus',
  'bonus per Soul Egg',
]);

/** Multipliers (and the two additive bonuses) one or more slots give. */
interface Effects {
  eggValue: number;
  layRate: number;
  shipping: number;
  away: number;
  habCap: number;
  ihr: number;
  soulEggBonus: number;
  prophecyEggBonus: number;
}

interface SlotConfig {
  familyIndex: number;
  slot: EquippedArtifact;
  effects: Effects;
}

const NO_EFFECTS: Effects = {
  eggValue: 1,
  layRate: 1,
  shipping: 1,
  away: 1,
  habCap: 1,
  ihr: 1,
  soulEggBonus: 0,
  prophecyEggBonus: 0,
};

function combine(a: Effects, b: Effects): Effects {
  return {
    eggValue: a.eggValue * b.eggValue,
    layRate: a.layRate * b.layRate,
    shipping: a.shipping * b.shipping,
    away: a.away * b.away,
    habCap: a.habCap * b.habCap,
    ihr: a.ihr * b.ihr,
    soulEggBonus: a.soulEggBonus + b.soulEggBonus,
    prophecyEggBonus: a.prophecyEggBonus + b.prophecyEggBonus,
  };
}

function slotEffects(slot: EquippedArtifact): Effects {
  const mods = calculateArtifactModifiers([slot]);
  return {
    eggValue: mods.eggValue.totalMultiplier,
    layRate: mods.eggLayingRate.totalMultiplier,
    shipping: mods.shippingRate.totalMultiplier,
    away: mods.awayEarnings.totalMultiplier,
    habCap: mods.habCapacity.totalMultiplier,
    ihr: mods.internalHatcheryRate.totalMultiplier,
    soulEggBonus: mods.soulEggBonus.totalMultiplier,
    prophecyEggBonus: mods.prophecyEggBonus.totalMultiplier,
  };
}

/**
 * The versions worth trying, by family: any not beaten on both effect and stone slots. A stronger
 * version isn't always better, since it needs a slot for clarity to do anything.
 */
function bestVersionsByFamily(filter: (a: ArtifactOption) => boolean): ArtifactOption[][] {
  const families = new Map<string, ArtifactOption[]>();
  for (const a of artifactOptions) {
    if (!filter(a)) continue;
    families.set(a.familyId, [...(families.get(a.familyId) ?? []), a]);
  }
  return [...families.values()].map(versions =>
    versions.filter(
      (a, i) =>
        !versions.some(
          (b, j) =>
            j !== i &&
            b.effectDelta >= a.effectDelta &&
            b.slots >= a.slots &&
            (b.effectDelta > a.effectDelta || b.slots > a.slots || j < i)
        )
    )
  );
}

/** All multisets of `size` items from `items`. */
function multisets<T>(items: T[], size: number, start = 0): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  for (let i = start; i < items.length; i++) {
    for (const rest of multisets(items, size - 1, i)) out.push([items[i], ...rest]);
  }
  return out;
}

/** An artifact and the family of stone for each socket (null: leave it empty). */
interface SlotPlan {
  familyIndex: number;
  artifactId: string;
  sockets: (string | null)[];
}

/**
 * The ways to socket an artifact, by stone family. Which tier goes in is settled when the artifact
 * is placed, from the stones still free, so the search doesn't grow with the tiers owned.
 */
function slotPlans(artifact: ArtifactOption, familyIndex: number, stoneFamilies: string[], allowEmpty: boolean) {
  const isLight = artifact.familyId === LIGHT_OF_EGGENDIL_FAMILY;
  // Light of Eggendil works in full with no clarity, and clarity in it does nothing.
  const families = isLight ? stoneFamilies.filter(f => f !== CLARITY_FAMILY) : stoneFamilies;
  // Sockets can only go unfilled when stones can run out.
  const pool: (string | null)[] = allowEmpty ? [...families, null] : families;
  const plans: SlotPlan[] = [];
  for (const sockets of multisets(pool, artifact.slots)) {
    if (!isLight && !sockets.includes(CLARITY_FAMILY)) continue; // does nothing without clarity
    plans.push({ familyIndex, artifactId: artifact.id, sockets });
  }
  return plans;
}

export type OptimizeResult =
  | { ok: true; loadout: EquippedArtifact[]; offlineEarnings: number; offlineIHR: number }
  | { ok: false; reason: string };

/** Scores compare in order; a later one only breaks ties in the earlier ones. */
type Score = number[];
function better(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) {
    const tolerance = 1e-9 * Math.max(Math.abs(a[i]), Math.abs(b[i]));
    if (Math.abs(a[i] - b[i]) > tolerance) return a[i] > b[i];
  }
  return false;
}

export interface OptimizeOptions {
  beamWidth?: number;
  /** What the player owns; null or missing counts everything as owned. */
  inventory?: PlayerInventory | null;
}

export function optimizeOfflineEarnings(state: EngineState, context: SimulationContext, options: OptimizeOptions = {}) {
  return optimizeArtifacts(state, context, 'offlineEarnings', options);
}

export function optimizeIHR(state: EngineState, context: SimulationContext, options: OptimizeOptions = {}) {
  return optimizeArtifacts(state, context, 'ihr', options);
}

export function optimizeArtifacts(
  state: EngineState,
  context: SimulationContext,
  goal: ArtifactGoal,
  options: OptimizeOptions = {}
): OptimizeResult {
  const beamWidth = options.beamWidth ?? 1500;
  const slotCount = artifactSlotCount(state.proPermit);
  const population = state.population || 0;

  const inventory = options.inventory;
  const allowEmpty = inventory != null;
  const targets = new Set(EARNING_TARGETS);
  if (goal === 'ihr') targets.add(IHR_TARGET);

  // Usable stones by family, strongest tier first.
  const stoneTiers = new Map<string, StoneOption[]>();
  for (const s of stoneOptions) {
    if (s.familyId !== CLARITY_FAMILY && !targets.has(s.effectTarget)) continue;
    if (ownedStoneCount(inventory, s.id) <= 0) continue;
    stoneTiers.set(s.familyId, [...(stoneTiers.get(s.familyId) ?? []), s].sort((a, b) => b.tier - a.tier));
  }
  // Clarity first, so sockets list it first.
  const stoneFamilies = [...stoneTiers.keys()].sort(
    (a, b) => Number(b === CLARITY_FAMILY) - Number(a === CLARITY_FAMILY)
  );

  const owned = (a: ArtifactOption) => ownsArtifact(inventory, a.id);
  const candidates = bestVersionsByFamily(a => owned(a) && targets.has(a.effectTarget) && a.effectDelta > 0);
  const plansByFamily = candidates.map((versions, i) =>
    versions.flatMap(a => slotPlans(a, i, stoneFamilies, allowEmpty))
  );

  const configCache = new Map<string, SlotConfig>();
  /** Fills a plan with the strongest stones still free; null when there aren't enough. */
  function place(plan: SlotPlan, used: Map<string, number>): SlotConfig | null {
    const taken = new Map<string, number>();
    const stones: (string | null)[] = [];
    for (const family of plan.sockets) {
      if (family === null) {
        stones.push(null);
        continue;
      }
      const stone = stoneTiers
        .get(family)!
        .find(s => (used.get(s.id) ?? 0) + (taken.get(s.id) ?? 0) < ownedStoneCount(inventory, s.id));
      if (!stone) return null;
      taken.set(stone.id, (taken.get(stone.id) ?? 0) + 1);
      stones.push(stone.id);
    }
    const key = `${plan.artifactId}:${stones.join(',')}`;
    let config = configCache.get(key);
    if (!config) {
      const slot: EquippedArtifact = { artifactId: plan.artifactId, stones };
      config = { familyIndex: plan.familyIndex, slot, effects: slotEffects(slot) };
      configCache.set(key, config);
    }
    return config;
  }
  function stonesUsed(configs: SlotConfig[]): Map<string, number> {
    const used = new Map<string, number>();
    for (const c of configs) {
      for (const id of c.slot.stones) if (id) used.set(id, (used.get(id) ?? 0) + 1);
    }
    return used;
  }

  // Base values with no artifacts, which the effects then scale.
  const empty: EngineState = { ...state, artifactLoadout: [] };
  const baseNow = computeSnapshot(empty, context, { freezePopulation: true });
  const baseFull = computeSnapshot(empty, context, { skipGrowth: true });
  const earningBonus = (e: Effects) =>
    calculateEarningBonus({
      soulEggs: state.soulEggs,
      prophecyEggs: state.prophecyEggs,
      te: state.te,
      soulFoodLevel: context.epicResearchLevels['soul_eggs'] || 0,
      prophecyBonusLevel: context.epicResearchLevels['prophecy_bonus'] || 0,
      artifactSoulEggBonus: e.soulEggBonus,
      artifactProphecyEggBonus: e.prophecyEggBonus,
    });
  const baseBonusFactor = 1 + earningBonus(NO_EFFECTS);
  // Everything else offline earnings multiply by (colleggtibles, permit, doubler, event).
  const otherFactor =
    baseFull.elr > 0 ? baseFull.offlineEarnings / (baseFull.eggValue * baseFull.elr * baseBonusFactor) : 0;

  // Offline IHR is the base rate times the artifact multiplier, so the multiplier ranks it.
  const score = (e: Effects): Score => {
    const perEgg = baseNow.eggValue * e.eggValue * (1 + earningBonus(e)) * otherFactor * e.away;
    const ship = baseNow.shippingCapacity * e.shipping;
    const now = perEgg * Math.min(baseNow.layRate * e.layRate, ship);
    const full = perEgg * Math.min(baseFull.layRate * e.layRate * e.habCap, ship);
    return goal === 'ihr' ? [e.ihr, now, full] : [now, full];
  };

  // A gusset goes in first when the population wouldn't fit without one.
  interface Partial {
    configs: SlotConfig[];
    effects: Effects;
    score: Score;
  }
  let beam: Partial[];
  const neededHabCap = population / baseNow.habCapacity;
  if (neededHabCap > 1 + 1e-12) {
    const gussets = bestVersionsByFamily(a => owned(a) && GUSSET_FAMILIES.includes(a.familyId)).flat();
    const noneUsed = new Map<string, number>();
    const placed = gussets
      .flatMap(g => slotPlans(g, -1, stoneFamilies, allowEmpty))
      .map(plan => place(plan, noneUsed))
      .filter((c): c is SlotConfig => c !== null);
    const fits = [...new Set(placed)].filter(c => c.effects.habCap >= neededHabCap);
    if (fits.length === 0 || slotCount === 0) {
      return { ok: false, reason: 'No loadout keeps hab capacity above the current population.' };
    }
    beam = fits.map(c => ({ configs: [c], effects: c.effects, score: score(c.effects) }));
  } else {
    beam = [{ configs: [], effects: NO_EFFECTS, score: score(NO_EFFECTS) }];
  }

  // Beam search: add one slot at a time, any family not used yet; each set is kept once.
  const keyOf = (configs: SlotConfig[]) =>
    configs
      .map(c => `${c.slot.artifactId}:${c.slot.stones.join(',')}`)
      .sort()
      .join('|');
  const start = beam[0].configs.length;
  for (let filled = start; filled < slotCount; filled++) {
    const next: Partial[] = [...beam];
    const seen = new Set(beam.map(p => keyOf(p.configs)));
    for (const p of beam) {
      const familiesUsed = new Set(p.configs.map(c => c.familyIndex));
      const used = stonesUsed(p.configs);
      for (let f = 0; f < plansByFamily.length; f++) {
        if (familiesUsed.has(f)) continue;
        for (const plan of plansByFamily[f]) {
          const c = place(plan, used);
          if (!c) continue;
          const configs = [...p.configs, c];
          const key = keyOf(configs);
          if (seen.has(key)) continue;
          seen.add(key);
          const effects = combine(p.effects, c.effects);
          next.push({ configs, effects, score: score(effects) });
        }
      }
    }
    next.sort((a, b) => (better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : 0));
    beam = next.slice(0, beamWidth);
  }

  // Check the leaders with the real engine (hab capacity rounds per hab) and take the best that fits.
  const toLoadout = (p: Partial): EquippedArtifact[] => {
    const loadout: EquippedArtifact[] = p.configs.map(c => ({ artifactId: c.slot.artifactId, stones: [...c.slot.stones] }));
    while (loadout.length < Math.max(4, state.artifactLoadout.length)) loadout.push({ artifactId: null, stones: [] });
    return loadout;
  };
  let best: { loadout: EquippedArtifact[]; score: Score; offlineEarnings: number; offlineIHR: number } | null = null;
  for (const p of beam.slice(0, 50)) {
    const loadout = toLoadout(p);
    const trial: EngineState = { ...state, artifactLoadout: loadout };
    const now = computeSnapshot(trial, context, { freezePopulation: true });
    if (now.habCapacity < population) continue;
    const full = computeSnapshot(trial, context, { skipGrowth: true });
    // Unclamped IHR multiplier: the engine's 500/min floor would hide differences below it.
    const ihr = calculateArtifactModifiers(loadout).internalHatcheryRate.totalMultiplier;
    const earnings = [now.offlineEarnings, full.offlineEarnings];
    const s = goal === 'ihr' ? [ihr, ...earnings] : earnings;
    if (!best || better(s, best.score)) {
      best = { loadout, score: s, offlineEarnings: now.offlineEarnings, offlineIHR: now.offlineIHR };
    }
  }
  if (!best) return { ok: false, reason: 'No loadout keeps hab capacity above the current population.' };
  return { ok: true, loadout: best.loadout, offlineEarnings: best.offlineEarnings, offlineIHR: best.offlineIHR };
}

/** Short description of a loadout, e.g. for a confirmation message. */
export function describeLoadout(loadout: EquippedArtifact[]): string {
  return loadout
    .filter(s => s.artifactId)
    .map(s => getArtifact(s.artifactId)?.label ?? s.artifactId)
    .join(', ');
}
