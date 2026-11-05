/**
 * Finds the artifact loadout with the highest offline earnings, or the highest offline internal
 * hatchery rate, for a farm state.
 *
 * Only artifacts and stones that touch the goal are tried (for earnings: egg value, laying rate,
 * shipping, away earnings, the SE and PE bonuses; for IHR: those plus internal hatchery rate, so
 * slots IHR can't use still earn), plus the gusset when the population needs it to stay within hab
 * capacity. The planner doesn't know the player's inventory, so every artifact counts as
 * owned, the same as the artifact picker.
 *
 * Ties at the current population (e.g. a lay-limited farm, where shipping does nothing yet) are
 * broken by offline earnings with full habs.
 */
import { artifactOptions, stoneOptions, getArtifact } from './data';
import { calculateArtifactModifiers, artifactSlotCount } from './calculator';
import type { ArtifactOption, EquippedArtifact, StoneOption } from './types';
import { computeSnapshot } from '@/engine/compute';
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

/** The strongest version of each family (most effect, then most stone slots). */
function bestPerFamily(filter: (a: ArtifactOption) => boolean): ArtifactOption[] {
  const best = new Map<string, ArtifactOption>();
  for (const a of artifactOptions) {
    if (!filter(a)) continue;
    const b = best.get(a.familyId);
    if (!b || a.effectDelta > b.effectDelta || (a.effectDelta === b.effectDelta && a.slots > b.slots)) {
      best.set(a.familyId, a);
    }
  }
  return [...best.values()];
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

function slotConfigs(artifact: ArtifactOption, familyIndex: number, stones: StoneOption[], clarity: StoneOption) {
  const isLight = artifact.familyId === LIGHT_OF_EGGENDIL_FAMILY;
  // Light of Eggendil works in full with no clarity, and clarity in it does nothing.
  const pool = isLight ? stones : [clarity, ...stones];
  const configs: SlotConfig[] = [];
  for (const combo of multisets(pool, artifact.slots)) {
    if (!isLight && !combo.includes(clarity)) continue; // does nothing without clarity
    const slot: EquippedArtifact = { artifactId: artifact.id, stones: combo.map(s => s.id) };
    configs.push({ familyIndex, slot, effects: slotEffects(slot) });
  }
  return configs;
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

export function optimizeOfflineEarnings(state: EngineState, context: SimulationContext, options: { beamWidth?: number } = {}) {
  return optimizeArtifacts(state, context, 'offlineEarnings', options);
}

export function optimizeIHR(state: EngineState, context: SimulationContext, options: { beamWidth?: number } = {}) {
  return optimizeArtifacts(state, context, 'ihr', options);
}

export function optimizeArtifacts(
  state: EngineState,
  context: SimulationContext,
  goal: ArtifactGoal,
  options: { beamWidth?: number } = {}
): OptimizeResult {
  const beamWidth = options.beamWidth ?? 1500;
  const slotCount = artifactSlotCount(state.proPermit);
  const population = state.population || 0;

  const bestStones = new Map<string, StoneOption>();
  for (const s of stoneOptions) {
    const b = bestStones.get(s.familyId);
    if (!b || s.tier > b.tier) bestStones.set(s.familyId, s);
  }
  const clarity = bestStones.get(CLARITY_FAMILY)!;
  const targets = new Set(EARNING_TARGETS);
  if (goal === 'ihr') targets.add(IHR_TARGET);
  const stones = [...bestStones.values()].filter(s => targets.has(s.effectTarget));

  const candidates = bestPerFamily(a => targets.has(a.effectTarget) && a.effectDelta > 0);
  const configsByFamily = candidates.map((a, i) => slotConfigs(a, i, stones, clarity));

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
    const gussets = bestPerFamily(a => GUSSET_FAMILIES.includes(a.familyId));
    const fits = gussets
      .flatMap(g => slotConfigs(g, -1, stones, clarity))
      .filter(c => c.effects.habCap >= neededHabCap);
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
      const used = new Set(p.configs.map(c => c.familyIndex));
      for (let f = 0; f < configsByFamily.length; f++) {
        if (used.has(f)) continue;
        for (const c of configsByFamily[f]) {
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
