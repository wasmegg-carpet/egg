/**
 * Smart Wait for Population: the fastest way to the player's target, EnD (10B chickens) or NAH
 * (the habs at their absolute max), with the artifacts they own, buying the internal hatchery and
 * Wormhole Dampening research that gets them there.
 *
 * Sets: start on the highest-IHR set. Each time the habs fill, switch to the highest-IHR set that
 * still has room (usually a gusset with clarity and life stones), and repeat. The hatchery rate
 * doesn't depend on population, so using the fastest set with room at every moment is the quickest
 * route: in practice the gusset's life stones give way to clarity stones one fill at a time.
 *
 * Wormhole Dampening: EnD needs only the levels that let the roomiest set hold 10B (more is a waste
 * of time); NAH needs every level. They're bought as late as is safe: before each purchase or wait,
 * if the next level could no longer be saved for before the habs are at their most, it's bought now.
 *
 * Internal hatchery research: otherwise the time goes to it. The next level of each is priced as a
 * milestone (the Research tab's Milestones view: earnings research that pays for itself on the way,
 * then the target); one counts if it's bought before the habs fill and gets to the target sooner,
 * the time buying it included. The soonest that counts is bought, then it all goes again.
 */
import { computeSnapshot } from 'lib/planners/engine/compute';
import { applyTime, boostTransitionsFrom } from '@/engine/apply';
import { computeResearchMilestoneChain, type ChainItem } from 'lib/planners/calculations/milestoneChain';
import { researchCostModifiersAt } from 'lib/planners/engine/researchSale';
import { getNextPacificTime, isResearchSaleActive } from 'lib/planners/events';
import { getSaleAwareTimeToSave } from 'lib/planners/calculations/researchROI';
import { isPortalHab } from 'lib/planners/habs';
import { getResearchById, isTierUnlocked } from './commonResearch';
import { calculateHabCapacity_Full, getHabCapacityResearches } from 'lib/planners/calculations/habCapacity';
import type { EngineState, SimulationContext } from '@/engine/types';
import {
  activeSlots,
  artifactSlotCount,
  calculateArtifactModifiers,
  getArtifact,
  getStone,
  type EquippedArtifact,
} from '@/lib/artifacts';
import { optimizeIHR } from '@/lib/artifacts/optimizeArtifacts';
import type { PlayerInventory } from '@/lib/artifacts/inventory';
import { TROPHY_TARGETS } from './goals';
import type { CalculationsSnapshot, WaitForPopulationPayload } from '@/types';

/** Chicken Universe, the biggest hab. */
const BEST_HAB_ID = 18;
const WORMHOLE_DAMPENING = 'wormhole_dampening';
/** A safety stop: a real plan settles in a handful of swaps. */
const MAX_STEPS = 30;
/** A safety stop on purchases and swaps together: a farm far behind on hatchery research buys hundreds of levels. */
const MAX_ROUNDS = 3000;
/** Common internal hatchery research (the epic Internal Hatchery Calm isn't bought here). */
const IHR_RESEARCH_IDS = [
  'internal_hatchery1',
  'internal_hatchery2',
  'internal_hatchery3',
  'internal_hatchery4',
  'internal_hatchery5',
  'neural_linking',
];

export const DIAMOND_POPULATION = TROPHY_TARGETS.find(t => t.id === 'diamond')!.population;

/** NAH's set: a T4L gusset with three T4 clarity stones. */
const NAH_LOADOUT: EquippedArtifact[] = [
  { artifactId: 'gusset-4-3', stones: ['clarity-stone-4', 'clarity-stone-4', 'clarity-stone-4'] },
];

/**
 * NAH for this player: four Chicken Universes, every hab research level (all of Wormhole
 * Dampening), and a T4L gusset with three T4 clarity stones, with the player's own hab size
 * colleggtibles. (The Goals panel's NAH assumes those colleggtibles maxed.)
 */
export function playerNahPopulation(context: SimulationContext): number {
  const researchLevels = Object.fromEntries(getHabCapacityResearches().map(r => [r.id, r.maxLevel]));
  const habCapacity = calculateArtifactModifiers(NAH_LOADOUT).habCapacity;
  return calculateHabCapacity_Full({
    habIds: [BEST_HAB_ID, BEST_HAB_ID, BEST_HAB_ID, BEST_HAB_ID],
    researchLevels,
    habCapMultiplier: context.colleggtibleModifiers.habCap,
    artifactMultiplier: habCapacity.totalMultiplier,
    artifactEffects: habCapacity.effects,
  }).totalFinalCapacity;
}

/** EnD: 10B chickens (Enlightenment Diamond). NAH: the habs at their absolute max. */
export type SmartWaitTarget = 'end' | 'nah';

/** A research level bought during a step, with the milestone chain that gets there. */
export interface SmartWaitPurchase {
  kind: 'ihr' | 'wd';
  researchId: string;
  name: string;
  toLevel: number;
  maxLevel: number;
  /** The milestone chain: earnings purchases that pay for themselves first, the target last. */
  items: ChainItem[];
  spent: number;
  /** Seconds from the start of the smart wait. */
  startSeconds: number;
  endSeconds: number;
}

/** A wait for the habs to fill (or, for EnD, for 10B chickens). */
export interface SmartWaitHatch {
  seconds: number;
  /** Offline internal hatchery rate, chickens per minute. */
  ihr: number;
  habCapacity: number;
  /** The population it waits for. */
  population: number;
  /** True when it stops at the target (EnD) rather than full habs. */
  toTarget: boolean;
  startPopulation: number;
  endSeconds: number;
}

export type SmartWaitEvent = { kind: 'purchase'; purchase: SmartWaitPurchase } | { kind: 'wait'; wait: SmartWaitHatch };

export interface SmartWaitStep {
  /** The whole set equipped for this step. */
  loadout: EquippedArtifact[];
  /** Slots that differ from the step before (every filled slot for the first step's set). */
  changedSlots: number[];
  /** False when the set is already equipped: nothing to swap. */
  swaps: boolean;
  startPopulation: number;
  /** Seconds from the start of the smart wait. */
  startSeconds: number;
  /** Offline internal hatchery rate and hab capacity when the set goes on. */
  ihr: number;
  habCapacity: number;
  /** Research and waits while this set is on, in order. */
  events: SmartWaitEvent[];
  endSeconds: number;
  endPopulation: number;
}

export interface WormholeDampeningNote {
  currentLevel: number;
  maxLevel: number;
  /** More levels to hold the target, with every other hab research bought; null if even max can't. */
  levelsNeeded: number | null;
  /** Hab capacity at max Wormhole Dampening with the rest of hab research bought. */
  capacityAtMax: number;
  /** False when some hab slot isn't a Chicken Universe, which the estimate leaves as it is. */
  allBestHabs: boolean;
}

/** Where the smart wait passes a population: during which step, and when. */
export interface PopulationCrossing {
  stepIndex: number;
  /** Seconds from the start of the smart wait. */
  seconds: number;
}

export type SmartWaitPlan =
  | {
      ok: true;
      target: SmartWaitTarget;
      steps: SmartWaitStep[];
      finalPopulation: number;
      totalSeconds: number;
      /** When it passes 10B (EnD), or null if it starts past it or never gets there. */
      end: PopulationCrossing | null;
      nahPopulation: number;
      /** Whether the final habs are NAH (`playerNahPopulation`). */
      reachesNah: boolean;
      /** Whether it gets to the target. */
      reachesTarget: boolean;
      /** The Wormhole Dampening level the target needs (what's bought towards). */
      wormholeDampeningGoal: number;
      /** Set when the final population is below Diamond (10B). */
      wormholeDampening: WormholeDampeningNote | null;
    }
  | { ok: false; reason: string };

/** A slot as a key: its artifact and its stones, in any order. */
const slotKey = (s: EquippedArtifact) => `${s.artifactId ?? ''}:${s.stones.filter(Boolean).sort().join(',')}`;
const loadoutKey = (loadout: EquippedArtifact[]) => loadout.map(slotKey).join('|');

/**
 * `next` with its artifacts moved to the slots they (or their family) hold in `prev`, so a swap
 * shows only what really changes rather than every artifact the search listed in another order.
 * Only the first `slotCount` slots count (2 on a Standard permit), so nothing moves past them.
 */
export function alignLoadout(prev: EquippedArtifact[], next: EquippedArtifact[], slotCount = 4): EquippedArtifact[] {
  const length = Math.max(prev.length, next.length);
  const out: (EquippedArtifact | null)[] = Array.from({ length }, () => null);
  const left = next.filter(s => s.artifactId);
  const familyOf = (id: string | null) => getArtifact(id)?.familyId;
  const take = (match: (s: EquippedArtifact, p: EquippedArtifact) => boolean) => {
    prev.forEach((p, i) => {
      if (i >= slotCount || out[i] || !p.artifactId) return;
      const at = left.findIndex(s => match(s, p));
      if (at >= 0) out[i] = left.splice(at, 1)[0];
    });
  };
  take((s, p) => slotKey(s) === slotKey(p));
  take((s, p) => s.artifactId === p.artifactId);
  take((s, p) => familyOf(s.artifactId) === familyOf(p.artifactId));
  // New artifacts go where an old one left, in slot order, so they stay in the slots that count.
  for (let i = 0; i < slotCount && left.length > 0; i++) if (!out[i]) out[i] = left.shift()!;
  return out.map(s => s ?? { artifactId: null, stones: [] });
}

function slotChanged(a: EquippedArtifact | undefined, b: EquippedArtifact | undefined): boolean {
  const empty = { artifactId: null, stones: [] };
  return slotKey(a ?? empty) !== slotKey(b ?? empty);
}

/** The slots of `next` that differ from `prev`. */
export function changedSlotIndexes(prev: EquippedArtifact[], next: EquippedArtifact[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(prev.length, next.length); i++) {
    if (slotChanged(prev[i], next[i])) out.push(i);
  }
  return out;
}

/**
 * How many more Wormhole Dampening levels the habs need to hold `target` with `loadout`, counting
 * every other hab research as bought and keeping the current habs.
 */
export function wormholeDampeningNeeded(
  state: EngineState,
  context: SimulationContext,
  loadout: EquippedArtifact[],
  target = DIAMOND_POPULATION
): WormholeDampeningNote {
  const researches = getHabCapacityResearches();
  const levels = { ...state.researchLevels };
  for (const r of researches) if (r.id !== WORMHOLE_DAMPENING) levels[r.id] = r.maxLevel;
  const wd = researches.find(r => r.id === WORMHOLE_DAMPENING)!;
  const currentLevel = state.researchLevels[WORMHOLE_DAMPENING] || 0;
  const habCapacity = calculateArtifactModifiers(activeSlots(loadout, state.proPermit)).habCapacity;
  const capacityAt = (level: number) =>
    calculateHabCapacity_Full({
      habIds: state.habIds,
      researchLevels: { ...levels, [WORMHOLE_DAMPENING]: level },
      habCapMultiplier: context.colleggtibleModifiers.habCap,
      artifactMultiplier: habCapacity.totalMultiplier,
      artifactEffects: habCapacity.effects,
    }).totalFinalCapacity;

  let levelsNeeded: number | null = null;
  for (let level = currentLevel; level <= wd.maxLevel; level++) {
    if (capacityAt(level) >= target) {
      levelsNeeded = level - currentLevel;
      break;
    }
  }
  return {
    currentLevel,
    maxLevel: wd.maxLevel,
    levelsNeeded,
    capacityAtMax: capacityAt(wd.maxLevel),
    allBestHabs: state.habIds.every(id => id === BEST_HAB_ID),
  };
}

export interface SmartWaitOptions {
  inventory?: PlayerInventory | null;
  /** What to aim for (NAH when not given). */
  target?: SmartWaitTarget;
  /**
   * Beam width for the swaps after the first set. Narrower than the Max IHR button's: each swap only
   * moves a stone or two, and the whole plan runs on a click. The first set uses the button's width.
   */
  swapBeamWidth?: number;
  /** False to leave research out (sets and waits only). */
  research?: boolean;
  /**
   * EnD's Wormhole Dampening: 'fastest' (default) also tries the extra levels that let a faster set
   * hold 10B; 'fewest' buys only the levels 10B needs.
   */
  wormholeDampeningGoal?: 'fastest' | 'fewest';
  /** The calendar time (seconds) the smart wait starts at, for research sales and 2x earnings. */
  absoluteStartTime?: number;
  /** Called between rounds, so a caller on the main thread can let the page paint. */
  onProgress?: () => Promise<void> | void;
}

/** How long a Wormhole Dampening level bought at full habs may take to save for before giving up. */
const WD_AT_FULL_HABS_LIMIT_SECONDS = 5 * 365 * 86400;

/**
 * The sets the smart wait goes through with no research bought: the Max IHR set, then at each full
 * habs the highest-IHR set with more room, until none holds more.
 */
export function planArtifactLoadouts(
  state: EngineState,
  context: SimulationContext,
  options: SmartWaitOptions = {}
): { ok: true; loadouts: EquippedArtifact[][] } | { ok: false; reason: string } {
  const search = { inventory: options.inventory, beamWidth: options.swapBeamWidth ?? 300 };
  const first = optimizeIHR(state, context, { inventory: options.inventory });
  if (!first.ok) return { ok: false, reason: first.reason };

  const slotCount = artifactSlotCount(state.proPermit);
  const loadouts: EquippedArtifact[][] = [];
  let current: EngineState = state;
  let loadout = alignLoadout(state.artifactLoadout, first.loadout, slotCount);
  for (let i = 0; i < MAX_STEPS; i++) {
    loadouts.push(loadout);
    const trial: EngineState = { ...current, artifactLoadout: activeSlots(loadout, current.proPermit) };
    const snapshot = computeSnapshot(trial, context, { freezePopulation: true });
    current = { ...trial, population: Math.max(current.population || 0, snapshot.habCapacity) };
    const next = optimizeIHR(current, context, { ...search, habCapacityAbove: current.population });
    if (!next.ok) break;
    loadout = alignLoadout(loadout, next.loadout, slotCount);
  }
  return { ok: true, loadouts };
}

interface SetOption {
  loadout: EquippedArtifact[];
  habCapacity: number;
  ihr: number;
}

/** The highest-IHR set whose habs hold more than `population` (bigger habs on a tie), or null. */
function pickSet(options: SetOption[], population: number): SetOption | null {
  let best: SetOption | null = null;
  for (const o of options) {
    if (o.habCapacity < population + 1) continue;
    if (!best || o.ihr > best.ihr || (o.ihr === best.ihr && o.habCapacity > best.habCapacity)) best = o;
  }
  return best;
}

type Chain = ReturnType<typeof computeResearchMilestoneChain>;

/** The smart wait's steps from `state` to the target: the sets to equip, the research to buy, and the waits. */
export async function planSmartPopulationWait(
  state: EngineState,
  context: SimulationContext,
  options: SmartWaitOptions = {}
): Promise<SmartWaitPlan> {
  const target = options.target ?? 'nah';
  const base = planArtifactLoadouts(state, context, options);
  if (!base.ok) return base;
  const slotCount = artifactSlotCount(state.proPermit);
  const absoluteStart =
    options.absoluteStartTime ?? context.ascensionStartTime + ((state.lastStepTime || 0) - context.planStartOffset);
  const goal = target === 'end' ? DIAMOND_POPULATION : Infinity;
  const research = options.research !== false;

  // What each set holds and hatches at a research level (cached: population changes neither).
  const setCache = new Map<string, SetOption[]>();
  const setsAt = (st: EngineState): SetOption[] => {
    const key = JSON.stringify([st.researchLevels, st.habIds]);
    let sets = setCache.get(key);
    if (!sets) {
      sets = base.loadouts.map(loadout => {
        const snap = computeSnapshot({ ...st, artifactLoadout: activeSlots(loadout, st.proPermit) }, context, {
          freezePopulation: true,
        });
        return { loadout, habCapacity: snap.habCapacity, ihr: snap.offlineIHR };
      });
      setCache.set(key, sets);
    }
    return sets;
  };
  /** Seconds from `st` until the population reaches `upTo` (or the habs their most), buying nothing. */
  const secondsUntil = (st: EngineState, upTo: number): number => {
    const sets = setsAt(st);
    let population = st.population || 0;
    let seconds = 0;
    for (let i = 0; i < MAX_STEPS && population < upTo; i++) {
      const set = pickSet(sets, population);
      if (!set || !(set.ihr > 0)) break;
      const to = Math.min(set.habCapacity, upTo);
      seconds += (to - population) / (set.ihr / 60);
      population = to;
    }
    return seconds;
  };

  // Wormhole Dampening: the level the target needs. Its tier may still be locked; other purchases on
  // the way can unlock it.
  const wd = getResearchById(WORMHOLE_DAMPENING)!;
  const wdLevel = (st: EngineState) => st.researchLevels[WORMHOLE_DAMPENING] || 0;
  const hasPortalHab = state.habIds.some(id => id !== null && isPortalHab({ id }));
  let wdGoal = wdLevel(state);
  if (research && hasPortalHab) {
    wdGoal = wd.levels;
    if (target === 'end') {
      for (let level = wdLevel(state); level <= wd.levels; level++) {
        const trial = { ...state, researchLevels: { ...state.researchLevels, [WORMHOLE_DAMPENING]: level } };
        if (Math.max(...setsAt(trial).map(set => set.habCapacity)) >= DIAMOND_POPULATION) {
          wdGoal = level;
          break;
        }
      }
    }
  }
  const needsWd = (st: EngineState) => wdLevel(st) < wdGoal && isTierUnlocked(st.researchLevels, wd.tier);

  const chainTo = (
    st: EngineState,
    snapshot: CalculationsSnapshot,
    now: number,
    researchId: string,
    maxSeconds: number
  ) =>
    computeResearchMilestoneChain(
      { researchId, targetLevel: (st.researchLevels[researchId] || 0) + 1 },
      st,
      snapshot,
      context,
      researchCostModifiersAt(snapshot, context),
      now,
      getNextPacificTime(6, 9, now),
      undefined,
      maxSeconds
    );

  /**
   * Whether the next Wormhole Dampening level can still be saved for, from `st` at `now`, before the
   * habs are at their most. Priced as a straight buy (sale-aware): a milestone chain only gets there
   * sooner, so this errs on the early side.
   */
  const wdInTime = (st: EngineState, snapshot: CalculationsSnapshot, now: number) => {
    const purchase = getSaleAwareTimeToSave(
      wd,
      wdLevel(st),
      researchCostModifiersAt(snapshot, context),
      isResearchSaleActive(now),
      now,
      snapshot,
      boostTransitionsFrom(snapshot, now)
    );
    return purchase.waitSeconds <= secondsUntil(st, Infinity);
  };

  /** The soonest internal hatchery research that lands before the habs fill and gets to the target sooner. */
  function bestHatcheryResearch(st: EngineState, snapshot: CalculationsSnapshot, now: number, fillSeconds: number) {
    if (!research) return null;
    const withoutSeconds = secondsUntil(st, goal);
    let best: { researchId: string; chain: Chain } | null = null;
    for (const researchId of IHR_RESEARCH_IDS) {
      const r = getResearchById(researchId);
      if (!r || (st.researchLevels[researchId] || 0) >= r.levels || !isTierUnlocked(st.researchLevels, r.tier))
        continue;
      const chain = chainTo(st, snapshot, now, researchId, fillSeconds);
      if (!chain.reached || !chain.endState || chain.totalSeconds >= fillSeconds) continue;
      if (best && chain.totalSeconds >= best.chain.totalSeconds) continue;
      if (chain.totalSeconds + secondsUntil(chain.endState, goal) >= withoutSeconds - 1) continue;
      best = { researchId, chain };
    }
    return best;
  }

  /** The plan with Wormhole Dampening bought up to `wdLevelGoal`. */
  async function run(wdLevelGoal: number): Promise<SmartWaitPlan> {
    wdGoal = wdLevelGoal;
    const steps: SmartWaitStep[] = [];
    let end: PopulationCrossing | null = null;
    /** Records EnD if the population passes it during `seconds` of growth from here. */
    const noteEnd = (at: number, population: number, ihr: number, capacity: number, seconds: number) => {
      if (end || population >= DIAMOND_POPULATION || capacity < DIAMOND_POPULATION || !(ihr > 0)) return;
      const growing = (DIAMOND_POPULATION - population) / (ihr / 60);
      if (growing <= seconds + 1e-6) end = { stepIndex: steps.length - 1, seconds: at + growing };
    };

    let st = state;
    let equipped = state.artifactLoadout;
    let stepSet: EquippedArtifact[] | null = null;
    let elapsed = 0;

    const buy = (researchId: string, chain: Chain, snapshot: CalculationsSnapshot) => {
      const step = steps[steps.length - 1];
      const r = getResearchById(researchId)!;
      const level = st.researchLevels[researchId] || 0;
      noteEnd(elapsed, st.population || 0, snapshot.offlineIHR, snapshot.habCapacity, chain.totalSeconds);
      step.events.push({
        kind: 'purchase',
        purchase: {
          kind: researchId === WORMHOLE_DAMPENING ? 'wd' : 'ihr',
          researchId,
          name: r.name,
          toLevel: level + 1,
          maxLevel: r.levels,
          items: chain.items,
          spent: chain.items.reduce((sum, item) => sum + item.price, 0),
          startSeconds: elapsed,
          endSeconds: elapsed + chain.totalSeconds,
        },
      });
      st = chain.endState!;
      elapsed += chain.totalSeconds;
      // The step shows the set as it stands after its research.
      if (chain.endSnapshot) {
        step.ihr = chain.endSnapshot.offlineIHR;
        step.habCapacity = chain.endSnapshot.habCapacity;
      }
      step.endSeconds = elapsed;
      step.endPopulation = st.population || 0;
    };

    for (let rounds = 0; rounds < MAX_ROUNDS; rounds++) {
      await options.onProgress?.();
      const population = st.population || 0;
      if (population >= goal) break;
      const now = absoluteStart + elapsed;
      const set = pickSet(setsAt(st), population);

      if (!set) {
        // The habs are at their most: only more Wormhole Dampening makes room.
        if (!needsWd(st) || steps.length === 0) break;
        const snapshot = computeSnapshot(st, context, { skipEpochConversion: true });
        const chain = chainTo(st, snapshot, now, WORMHOLE_DAMPENING, WD_AT_FULL_HABS_LIMIT_SECONDS);
        if (!chain.reached || !chain.endState) break;
        buy(WORMHOLE_DAMPENING, chain, snapshot);
        continue;
      }

      if (!stepSet || loadoutKey(set.loadout) !== loadoutKey(stepSet)) {
        const loadout = alignLoadout(equipped, set.loadout, slotCount);
        steps.push({
          loadout,
          changedSlots:
            steps.length === 0
              ? loadout.flatMap((s, i) => (s.artifactId ? [i] : []))
              : changedSlotIndexes(equipped, loadout),
          swaps: loadoutKey(loadout) !== loadoutKey(equipped),
          startPopulation: population,
          startSeconds: elapsed,
          ihr: set.ihr,
          habCapacity: set.habCapacity,
          events: [],
          endSeconds: elapsed,
          endPopulation: population,
        });
        equipped = loadout;
        stepSet = set.loadout;
        st = {
          ...st,
          artifactLoadout: activeSlots(loadout, st.proPermit),
          artifactSets: { ...st.artifactSets, [SMART_WAIT_SET]: loadout },
          activeArtifactSet: SMART_WAIT_SET,
        };
      }
      const step = steps[steps.length - 1];

      const snapshot = computeSnapshot(st, context, { skipEpochConversion: true });
      const ihr = snapshot.offlineIHR;
      if (!(ihr > 0)) return { ok: false, reason: 'The hatchery rate is zero, so the habs never fill.' };
      const fillTo = Math.min(snapshot.habCapacity, goal);
      const fillSeconds = Math.max(0, fillTo - population) / (ihr / 60);
      const hatchery = bestHatcheryResearch(st, snapshot, now, fillSeconds);
      const waited = () => {
        const after = applyTime(st, fillSeconds, snapshot, { transitions: boostTransitionsFrom(snapshot, now) });
        // Exactly there, so rounding can't leave room for another round of the same set.
        return { ...after, population: Math.max(population, fillTo) };
      };

      // Wormhole Dampening now if, after the next purchase or wait, it would no longer come in time.
      if (needsWd(st)) {
        const inTimeAfter = hatchery
          ? wdInTime(hatchery.chain.endState!, hatchery.chain.endSnapshot!, now + hatchery.chain.totalSeconds)
          : (() => {
              const after = waited();
              return wdInTime(after, computeSnapshot(after, context, { skipEpochConversion: true }), now + fillSeconds);
            })();
        if (!inTimeAfter) {
          const chain = chainTo(st, snapshot, now, WORMHOLE_DAMPENING, WD_AT_FULL_HABS_LIMIT_SECONDS);
          if (chain.reached && chain.endState) {
            buy(WORMHOLE_DAMPENING, chain, snapshot);
            continue;
          }
          wdGoal = wdLevel(st); // out of reach: stop trying
        }
      }

      if (hatchery) {
        buy(hatchery.researchId, hatchery.chain, snapshot);
        continue;
      }

      // No hatchery research to buy: Wormhole Dampening as soon as it is affordable (before these habs
      // fill, so the set can still change when they do). Room sooner keeps the faster sets in play
      // longer, and the earnings research its chain buys makes the later levels come sooner.
      if (needsWd(st)) {
        const chain = chainTo(st, snapshot, now, WORMHOLE_DAMPENING, fillSeconds);
        if (chain.reached && chain.endState && chain.totalSeconds < fillSeconds) {
          buy(WORMHOLE_DAMPENING, chain, snapshot);
          continue;
        }
      }

      noteEnd(elapsed, population, ihr, snapshot.habCapacity, fillSeconds);
      st = waited();
      elapsed += fillSeconds;
      step.events.push({
        kind: 'wait',
        wait: {
          seconds: fillSeconds,
          ihr,
          habCapacity: snapshot.habCapacity,
          population: fillTo,
          toTarget: fillTo >= goal,
          startPopulation: population,
          endSeconds: elapsed,
        },
      });
      step.endSeconds = elapsed;
      step.endPopulation = st.population || 0;
    }

    const finalPopulation = st.population || 0;
    const nahPopulation = playerNahPopulation(context);
    // Per-hab rounding can leave the habs a few chickens either side of the target.
    const reachesNah = finalPopulation >= nahPopulation * (1 - 1e-9);
    return {
      ok: true,
      target,
      steps,
      finalPopulation,
      totalSeconds: elapsed,
      end,
      nahPopulation,
      reachesNah,
      reachesTarget: target === 'end' ? finalPopulation >= DIAMOND_POPULATION : reachesNah,
      wormholeDampeningGoal: wdGoal,
      wormholeDampening: finalPopulation < DIAMOND_POPULATION ? wormholeDampeningNeeded(st, context, equipped) : null,
    };
  }

  // EnD: the fewest Wormhole Dampening levels can leave a slower, roomier set to finish on. A few
  // more levels can let a faster set hold 10B instead; try each such level and keep the fastest.
  if (target !== 'end' || !research || !hasPortalHab || options.wormholeDampeningGoal === 'fewest') return run(wdGoal);
  const candidates = [wdGoal];
  const fastestHolding = (level: number) => {
    const trial = { ...state, researchLevels: { ...state.researchLevels, [WORMHOLE_DAMPENING]: level } };
    const holding = setsAt(trial).filter(set => set.habCapacity >= DIAMOND_POPULATION);
    return holding.length ? Math.max(...holding.map(set => set.ihr)) : 0;
  };
  let fastest = fastestHolding(wdGoal);
  for (let level = wdGoal + 1; level <= wd.levels; level++) {
    const ihr = fastestHolding(level);
    if (ihr > fastest * (1 + 1e-9)) {
      candidates.push(level);
      fastest = ihr;
    }
  }
  let best: SmartWaitPlan | null = null;
  for (const level of candidates) {
    const plan = await run(level);
    if (!plan.ok) return plan;
    // More levels only when it reaches 10B sooner (by more than a minute).
    if (!best?.ok || (plan.reachesTarget && (!best.reachesTarget || plan.totalSeconds < best.totalSeconds - 60))) {
      best = plan;
    }
  }
  return best!;
}

/**
 * What a swap changes in one slot, in words: "T4 Life stone → T4 Clarity stone" when only stones
 * move, otherwise the artifact that comes in (and the one it replaces).
 */
export function describeSlotSwap(prev: EquippedArtifact | undefined, next: EquippedArtifact): string {
  const nextArtifact = getArtifact(next.artifactId);
  const prevArtifact = getArtifact(prev?.artifactId ?? null);
  if (!nextArtifact) return prevArtifact ? `Remove ${prevArtifact.label}` : '';
  if (prevArtifact?.id !== nextArtifact.id) {
    return prevArtifact ? `${nextArtifact.label} replaces ${prevArtifact.label}` : nextArtifact.label;
  }
  // Same artifact: the stones that leave and the ones that come in.
  const count = (stones: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const id of stones) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const before = count(prev?.stones ?? []);
  const after = count(next.stones);
  const diff = (a: Map<string, number>, b: Map<string, number>) =>
    [...a].flatMap(([id, n]) => {
      const extra = n - (b.get(id) ?? 0);
      if (extra <= 0) return [];
      const label = getStone(id)?.label ?? id;
      return [extra > 1 ? `${extra}× ${label}` : label];
    });
  const out = diff(before, after);
  const inn = diff(after, before);
  return `${nextArtifact.label}: ${out.join(', ') || 'empty socket'} → ${inn.join(', ') || 'empty socket'}`;
}

/** The set the smart wait saves its loadouts to: an enlightenment farm has just the one. */
export const SMART_WAIT_SET = 'earnings' as const;

export type SmartWaitAction =
  | { type: 'update_artifact_set'; payload: { setName: typeof SMART_WAIT_SET; newLoadout: EquippedArtifact[] } }
  | { type: 'equip_artifact_set'; payload: { setName: typeof SMART_WAIT_SET } }
  | {
      type: 'wait_for_full_habs';
      payload: { habCapacity: number; ihr: number; currentPopulation: number; totalTimeSeconds: number };
    }
  | { type: 'wait_for_population'; payload: WaitForPopulationPayload };

/** One thing to add to the plan: an action as it is, or a research purchase to buy the milestone way. */
export type SmartWaitOp =
  | { kind: 'action'; action: SmartWaitAction }
  | { kind: 'purchase'; purchase: SmartWaitPurchase };

/**
 * What a smart wait adds to the plan. Each step saves its set (when it differs; the first also
 * equips it if another set is on), then its research and waits in order: Wait for Full Habs, or for
 * the last wait to EnD, Wait for Population to 10B.
 */
export function smartWaitOps(
  plan: Extract<SmartWaitPlan, { ok: true }>,
  start: {
    artifactSets: Partial<Record<string, EquippedArtifact[] | null>>;
    activeArtifactSet: string | null;
  }
): SmartWaitOp[] {
  const ops: SmartWaitOp[] = [];
  let saved = start.artifactSets[SMART_WAIT_SET] ?? [];
  for (const [i, step] of plan.steps.entries()) {
    if (loadoutKey(saved) !== loadoutKey(step.loadout)) {
      const newLoadout = step.loadout.map(s => ({ artifactId: s.artifactId, stones: [...s.stones] }));
      ops.push({
        kind: 'action',
        action: { type: 'update_artifact_set', payload: { setName: SMART_WAIT_SET, newLoadout } },
      });
      saved = step.loadout;
    }
    if (i === 0 && start.activeArtifactSet !== SMART_WAIT_SET) {
      ops.push({ kind: 'action', action: { type: 'equip_artifact_set', payload: { setName: SMART_WAIT_SET } } });
    }
    for (const event of step.events) {
      if (event.kind === 'purchase') {
        ops.push({ kind: 'purchase', purchase: event.purchase });
        continue;
      }
      const w = event.wait;
      ops.push({
        kind: 'action',
        action: w.toTarget
          ? {
              type: 'wait_for_population',
              payload: {
                targetPopulation: w.population,
                label: 'EnD',
                currentPopulation: w.startPopulation,
                ihr: w.ihr,
                reachable: true,
                totalTimeSeconds: w.seconds,
              },
            }
          : {
              type: 'wait_for_full_habs',
              payload: {
                habCapacity: w.habCapacity,
                ihr: w.ihr,
                currentPopulation: w.startPopulation,
                totalTimeSeconds: w.seconds,
              },
            },
      });
    }
  }
  return ops;
}
