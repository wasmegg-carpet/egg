/**
 * Vehicles, train cars and habs as earnings purchases, ranked by the same payback time as research.
 * Only the enlightenment planner uses this (PROFILE.hasFarmPurchasesInRoi): there research, vehicles
 * and habs can all be bought in any order, while the ascension planner buys them in separate steps.
 *
 * One candidate per group of matching slots: empty slots are interchangeable, and so are slots
 * holding the same vehicle (or hab, or train length), so listing each of them would only repeat the
 * same row. Within a group:
 *
 * - Every upgrade is scored by payback time. The fastest is the starting pick.
 * - A bigger option that raises earnings more replaces the pick if it can be afforded before the
 *   pick would have paid for itself (the pick would be money thrown away), or if buying the pick
 *   first gets the bigger one barely any sooner (the pick would be a wasted step). So a
 *   shipping-capped farm with a cheap empty slot gets one purchase of the right vehicle, not a run
 *   of small upgrades to the same slot, while a small vehicle that really does speed up saving for
 *   a much bigger one is still listed.
 * - A bigger option that adds no more earnings (the farm is no longer shipping-capped, say) never
 *   replaces the pick, so it stops at enough capacity.
 *
 * Fleet size research adds a slot but no earnings by itself, so its payback is never finite. When
 * every slot holds a vehicle, each fleet research's next level is paired with the best vehicle for
 * the slot it adds, and the pair is scored as one purchase. Graviton Coupling is the same for train
 * cars: when every Hyperloop train is as long as it can be, its next level is paired with one more
 * car.
 *
 * Vehicle and hab sales are toggled by hand in the plan rather than following the weekly research
 * sale, so the research sale's 70%-payback check doesn't apply to them. It does apply to a research
 * pair, since the research part of it is cheaper at the sale.
 */
import {
  getCommonResearches,
  getDiscountedResearchPrice,
  isTierUnlocked,
  type ResearchCostModifiers,
} from '@planner/calculations/commonResearch';
import type { EngineState, SimulationContext } from '@planner/engine/types';
import type { CalculationsSnapshot } from '@planner/types';
import { applyAction, applyTime, boostTransitionsFrom, getTimeToSave } from '@planner/engine/apply';
import { createSimAction } from '@planner/types/actions/meta';
import { PROFILE } from '@planner/lib/profile';
import { getHabById, countHabsOfType } from '../habs';
import { isHabId } from '../../farm/hab_space';
import { vehicleTypes, countVehiclesOfType } from '../vehicles';
import { calculateMaxVehicleSlots, calculateMaxTrainLength, GRAVITON_COUPLING_ID } from './shippingCapacity';
import { calculatePurchasePayback, meetsROIByDeadline } from './researchROI';
import { computeSnapshot } from '../engine/compute';
import { createBaseEngineState } from '../engine/adapter';
import { isEarningsBoostActive, isResearchSaleActive } from '../events';

export const HYPERLOOP_ID = 11;
const MAX_VEHICLE_ID = vehicleTypes.length - 1;
const HAB_SLOT_COUNT = 4;
const MAX_HAB_ID = 18;

export type FarmPurchase =
  | {
      kind: 'vehicle';
      slotIndex: number;
      vehicleId: number;
      fromVehicleId: number | null;
      /** Fleet research bought first to add the slot this vehicle goes in. */
      fleetResearch?: { researchId: string; fromLevel: number; price: number };
    }
  | {
      kind: 'train_car';
      slotIndex: number;
      fromLength: number;
      toLength: number;
      /** Graviton Coupling bought first to make room for this car. */
      couplingResearch?: { researchId: string; fromLevel: number; price: number };
    }
  | { kind: 'hab'; slotIndex: number; habId: number; fromHabId: number | null };

/** One engine action of a farm purchase, in the order they're bought. */
export interface FarmPurchaseStep {
  type: 'buy_research' | 'buy_vehicle' | 'buy_train_car' | 'buy_hab';
  payload: Record<string, unknown>;
  cost: number;
}

export interface FarmRankingItem {
  purchase: FarmPurchase;
  steps: FarmPurchaseStep[];
  /** Total price of every step. */
  price: number;
  timeToBuySeconds: number;
  roiSeconds: number;
  totalRoiSeconds: number;
  earningsDelta: number;
  /** Extra earnings per second once the habs are full: what the selection rule compares. */
  fullHabsEarningsGain: number;
  /** Only a fleet research pair can be held back by the research sale. */
  showSaleWarning: boolean;
  duringSale: boolean;
  duringEarningsBoost: boolean;
  nextSnapshot: CalculationsSnapshot;
}

export interface FarmCandidateOptions {
  /** Habs count as earnings purchases (false in the Hab Space chain, where they're the target). */
  includeHabs: boolean;
  /** Vehicles and train cars count (false in the ROI view's Max Vehicles mode). */
  includeVehicles: boolean;
  mods: ResearchCostModifiers;
  /** The research sale a fleet research pair's 70% check looks ahead to. */
  roiDeadline: number;
  /**
   * Quick Buy prices without the calendar, like its research: no 2x boost changes while saving up,
   * and fleet research priced at this sale state rather than the one at `absoluteSimTime`.
   */
  ignoreCalendar?: { isResearchSale: boolean };
}

function vehicleCostModifiers(context: SimulationContext) {
  return {
    bustUnionsLevel: context.epicResearchLevels['bust_unions'] || 0,
    vehicleCostMultiplier: context.colleggtibleModifiers.vehicleCost || 1,
  };
}

function habCostModifiers(context: SimulationContext) {
  return {
    cheaperContractorsLevel: context.epicResearchLevels['cheaper_contractors'] || 0,
    habCostMultiplier: context.colleggtibleModifiers.habCost || 1,
  };
}

function vehicleSlots(state: EngineState, slotCount: number) {
  return Array.from({ length: slotCount }, (_, i) => state.vehicles[i] ?? { vehicleId: null, trainLength: 1 });
}

/** Earnings per second with the habs full, so purchases bought at different times compare fairly. */
function fullHabsEarnings(snapshot: CalculationsSnapshot, context: SimulationContext): number {
  if (snapshot.population >= snapshot.habCapacity) return snapshot.offlineEarnings;
  const state = { ...createBaseEngineState(snapshot), population: snapshot.habCapacity };
  return computeSnapshot(state, context, { skipEpochConversion: true }).offlineEarnings;
}

/** Applies a farm purchase's steps to `state`. */
export function applyFarmPurchase(state: EngineState, steps: FarmPurchaseStep[]): EngineState {
  return steps.reduce(
    (next, step) => applyAction(next, createSimAction(step.type, step.payload as never, step.cost)),
    state
  );
}

/**
 * Buying a smaller option on the way to a bigger one is skipped when it gets the bigger one less than
 * this much sooner (whichever is larger): an extra purchase isn't worth a minute or a few percent.
 */
const SKIP_TOLERANCE_FRACTION = 0.05;
const SKIP_TOLERANCE_SECONDS = 60;

/**
 * Picks the option to list from one group's options (smallest first). Starts from the fastest
 * payback, then moves up to each bigger option that raises earnings more and either:
 * - can be afforded before the current pick would have paid for itself, or
 * - is owned about as soon by buying it directly as by buying the current pick first and saving
 *   from there (see SKIP_TOLERANCE_*).
 * Null if nothing in the group ever pays for itself.
 */
export function pickFarmOption(options: FarmRankingItem[]): FarmRankingItem | null {
  let pickIndex = -1;
  options.forEach((option, i) => {
    if (!isFinite(option.totalRoiSeconds)) return;
    if (pickIndex === -1 || option.totalRoiSeconds < options[pickIndex].totalRoiSeconds) pickIndex = i;
  });
  if (pickIndex === -1) return null;

  let pick = options[pickIndex];
  for (const option of options.slice(pickIndex + 1)) {
    if (!isFinite(option.totalRoiSeconds)) continue;
    if (option.fullHabsEarningsGain <= pick.fullHabsEarningsGain * (1 + 1e-9)) continue;
    const viaPick = pick.timeToBuySeconds + getTimeToSave(option.price, pick.nextSnapshot);
    const savedByPick = option.timeToBuySeconds - viaPick;
    if (
      option.timeToBuySeconds <= pick.totalRoiSeconds ||
      savedByPick <= Math.max(SKIP_TOLERANCE_FRACTION * option.timeToBuySeconds, SKIP_TOLERANCE_SECONDS)
    ) {
      pick = option;
    }
  }
  return pick;
}

/** Every farm purchase worth listing from `state`, one per group of matching slots. */
export function listFarmPurchaseCandidates(
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  absoluteSimTime: number,
  options: FarmCandidateOptions
): FarmRankingItem[] {
  if (snapshot.offlineEarnings <= 0) return [];
  const transitions = options.ignoreCalendar ? [] : boostTransitionsFrom(snapshot, absoluteSimTime);
  const earningsNow = fullHabsEarnings(snapshot, context);

  const score = (purchase: FarmPurchase, steps: FarmPurchaseStep[], duringSale: boolean): FarmRankingItem => {
    const price = steps.reduce((sum, step) => sum + step.cost, 0);
    const timeToBuySeconds = getTimeToSave(price, snapshot, transitions);
    const actions = steps.map(step => createSimAction(step.type, step.payload as never, step.cost));
    const { roiSeconds, nextSnapshot } = isFinite(timeToBuySeconds)
      ? calculatePurchasePayback(actions, price, timeToBuySeconds, snapshot, context, absoluteSimTime)
      : { roiSeconds: Infinity, nextSnapshot: snapshot };
    const earningsDelta = isFinite(roiSeconds) && roiSeconds > 0 ? price / roiSeconds : 0;
    const completesAt = absoluteSimTime + timeToBuySeconds;
    const hasResearch = steps.some(step => step.type === 'buy_research');
    return {
      purchase,
      steps,
      price,
      timeToBuySeconds,
      roiSeconds,
      totalRoiSeconds: timeToBuySeconds + roiSeconds,
      earningsDelta,
      fullHabsEarningsGain: fullHabsEarnings(nextSnapshot, context) - earningsNow,
      showSaleWarning: hasResearch && !meetsROIByDeadline(earningsDelta, price, completesAt, options.roiDeadline, 70),
      duringSale,
      duringEarningsBoost: !options.ignoreCalendar && isEarningsBoostActive(completesAt),
      nextSnapshot,
    };
  };

  const candidates: FarmRankingItem[] = [];
  if (options.includeVehicles) candidates.push(...vehicleCandidates(state, context, absoluteSimTime, options, score));
  if (options.includeHabs) candidates.push(...habCandidates(state, context, score));
  return candidates;
}

type Score = (purchase: FarmPurchase, steps: FarmPurchaseStep[], duringSale: boolean) => FarmRankingItem;

function vehicleStep(state: EngineState, context: SimulationContext, slotIndex: number, vehicleId: number) {
  const before = state.vehicles.slice(0, slotIndex) as { vehicleId: number | null }[];
  const cost = PROFILE.pricing.vehicle(
    vehicleId,
    countVehiclesOfType(before, vehicleId),
    vehicleCostModifiers(context),
    state.activeSales.vehicle
  );
  return {
    type: 'buy_vehicle' as const,
    payload: { slotIndex, vehicleId, trainLength: vehicleId === HYPERLOOP_ID ? 1 : undefined },
    cost,
  };
}

/** The pick among `slotIndex`'s upgrades, with `prefix` steps bought first (fleet research). */
function bestVehicleForSlot(
  state: EngineState,
  context: SimulationContext,
  slotIndex: number,
  fromVehicleId: number | null,
  score: Score,
  prefix: FarmPurchaseStep[] = [],
  fleetResearch?: { researchId: string; fromLevel: number; price: number }
): FarmRankingItem | null {
  const options: FarmRankingItem[] = [];
  for (let vehicleId = fromVehicleId === null ? 0 : fromVehicleId + 1; vehicleId <= MAX_VEHICLE_ID; vehicleId++) {
    const steps = [...prefix, vehicleStep(state, context, slotIndex, vehicleId)];
    options.push(
      score({ kind: 'vehicle', slotIndex, vehicleId, fromVehicleId, fleetResearch }, steps, state.activeSales.vehicle)
    );
  }
  return pickFarmOption(options);
}

function vehicleCandidates(
  state: EngineState,
  context: SimulationContext,
  absoluteSimTime: number,
  options: FarmCandidateOptions,
  score: Score
): FarmRankingItem[] {
  const slotCount = calculateMaxVehicleSlots(state.researchLevels);
  const slots = vehicleSlots(state, slotCount);
  const maxTrainLength = calculateMaxTrainLength(state.researchLevels);
  const results: FarmRankingItem[] = [];

  // First slot of each group: the cheapest one to buy into, since prices count earlier slots.
  const seen = new Set<string>();
  slots.forEach((slot, slotIndex) => {
    const key = slot.vehicleId === HYPERLOOP_ID ? `${HYPERLOOP_ID}:${slot.trainLength}` : String(slot.vehicleId);
    if (seen.has(key)) return;
    seen.add(key);

    if (slot.vehicleId === HYPERLOOP_ID) {
      if (slot.trainLength >= maxTrainLength) return;
      const cost = PROFILE.pricing.trainCar(slot.trainLength, vehicleCostModifiers(context), state.activeSales.vehicle);
      const purchase: FarmPurchase = {
        kind: 'train_car',
        slotIndex,
        fromLength: slot.trainLength,
        toLength: slot.trainLength + 1,
      };
      const item = score(purchase, [{ type: 'buy_train_car', payload: { ...purchase }, cost }], state.activeSales.vehicle);
      if (isFinite(item.totalRoiSeconds)) results.push(item);
      return;
    }

    const pick = bestVehicleForSlot(state, context, slotIndex, slot.vehicleId, score);
    if (pick) results.push(pick);
  });

  const isSale = options.ignoreCalendar ? options.ignoreCalendar.isResearchSale : isResearchSaleActive(absoluteSimTime);
  const researchStepFor = (researchId: string): FarmPurchaseStep | null => {
    const research = getCommonResearches().find(r => r.id === researchId);
    if (!research) return null;
    const fromLevel = state.researchLevels[research.id] || 0;
    if (fromLevel >= research.levels || !isTierUnlocked(state.researchLevels, research.tier)) return null;
    const price = getDiscountedResearchPrice(research, fromLevel, options.mods, isSale);
    return { type: 'buy_research', payload: { researchId: research.id, fromLevel, toLevel: fromLevel + 1 }, cost: price };
  };

  // Every Hyperloop train is full: pair Graviton Coupling's next level with one more car.
  const trains = slots.map((slot, slotIndex) => ({ slot, slotIndex })).filter(t => t.slot.vehicleId === HYPERLOOP_ID);
  if (trains.length > 0 && trains.every(t => t.slot.trainLength >= maxTrainLength)) {
    const researchStep = researchStepFor(GRAVITON_COUPLING_ID);
    if (researchStep) {
      const { slot, slotIndex } = trains[0];
      const cost = PROFILE.pricing.trainCar(slot.trainLength, vehicleCostModifiers(context), state.activeSales.vehicle);
      const purchase: FarmPurchase = {
        kind: 'train_car',
        slotIndex,
        fromLength: slot.trainLength,
        toLength: slot.trainLength + 1,
        couplingResearch: {
          researchId: GRAVITON_COUPLING_ID,
          fromLevel: researchStep.payload.fromLevel as number,
          price: researchStep.cost,
        },
      };
      const carStep: FarmPurchaseStep = {
        type: 'buy_train_car',
        payload: { slotIndex, fromLength: slot.trainLength, toLength: slot.trainLength + 1 },
        cost,
      };
      const item = score(purchase, [researchStep, carStep], state.activeSales.vehicle);
      if (isFinite(item.totalRoiSeconds)) results.push(item);
    }
  }

  // Every slot is in use: pair each fleet research's next level with a vehicle for its new slot.
  if (slots.every(slot => slot.vehicleId !== null)) {
    let bestPair: FarmRankingItem | null = null;
    for (const research of getCommonResearches()) {
      if (!research.categories.split(',').some(c => c.trim() === 'fleet_size')) continue;
      const fromLevel = state.researchLevels[research.id] || 0;
      if (fromLevel >= research.levels || !isTierUnlocked(state.researchLevels, research.tier)) continue;
      const price = getDiscountedResearchPrice(research, fromLevel, options.mods, isSale);
      const researchStep: FarmPurchaseStep = {
        type: 'buy_research',
        payload: { researchId: research.id, fromLevel, toLevel: fromLevel + 1 },
        cost: price,
      };
      const withSlot = applyFarmPurchase(state, [researchStep]);
      if (calculateMaxVehicleSlots(withSlot.researchLevels) <= slotCount) continue;
      const pair = bestVehicleForSlot(withSlot, context, slotCount, null, score, [researchStep], {
        researchId: research.id,
        fromLevel,
        price,
      });
      if (pair && (!bestPair || pair.totalRoiSeconds < bestPair.totalRoiSeconds)) bestPair = pair;
    }
    if (bestPair) results.push(bestPair);
  }

  return results;
}

function habCandidates(state: EngineState, context: SimulationContext, score: Score): FarmRankingItem[] {
  const habIds = Array.from({ length: HAB_SLOT_COUNT }, (_, i) => state.habIds[i] ?? null);
  const results: FarmRankingItem[] = [];
  const seen = new Set<number | null>();
  habIds.forEach((fromHabId, slotIndex) => {
    if (seen.has(fromHabId)) return;
    seen.add(fromHabId);
    const options: FarmRankingItem[] = [];
    for (let habId = fromHabId === null ? 0 : fromHabId + 1; habId <= MAX_HAB_ID; habId++) {
      if (!isHabId(habId)) continue;
      const cost = PROFILE.pricing.hab(
        getHabById(habId),
        countHabsOfType(habIds.slice(0, slotIndex), habId),
        habCostModifiers(context),
        state.activeSales.hab
      );
      const purchase: FarmPurchase = { kind: 'hab', slotIndex, habId, fromHabId };
      options.push(score(purchase, [{ type: 'buy_hab', payload: { slotIndex, habId }, cost }], state.activeSales.hab));
    }
    const pick = pickFarmOption(options);
    if (pick) results.push(pick);
  });
  return results;
}

/** A farm purchase in a chain (Milestones, Hab Space, Smart Buy's plans), alongside research items. */
export interface FarmChainItem {
  kind: 'farm';
  purchase: FarmPurchase;
  steps: FarmPurchaseStep[];
  price: number;
  timeToBuySeconds: number;
  /** Seconds from the chain's start until this purchase. */
  buyToHereSeconds: number;
  roiSeconds: number;
  totalRoiSeconds: number;
  showSaleWarning: boolean;
  duringSale: boolean;
  duringEarningsBoost: boolean;
}

export function isFarmChainItem(item: object): item is FarmChainItem {
  return (item as FarmChainItem).kind === 'farm';
}

/** `item` as a chain item bought `timeToBuySeconds` in, before rebasing onto the chain's own clock. */
export function toFarmChainItem(item: FarmRankingItem): FarmChainItem {
  return {
    kind: 'farm',
    purchase: item.purchase,
    steps: item.steps,
    price: item.price,
    timeToBuySeconds: item.timeToBuySeconds,
    buyToHereSeconds: item.timeToBuySeconds,
    roiSeconds: item.roiSeconds,
    totalRoiSeconds: item.totalRoiSeconds,
    showSaleWarning: item.showSaleWarning,
    duringSale: item.duringSale,
    duringEarningsBoost: item.duringEarningsBoost,
  };
}

/**
 * Saves up for and buys `item` from the state it was listed from, the way the research chains buy a
 * research level: the steps are applied, then the time to afford them passes.
 */
export function simulateFarmPurchase(
  item: FarmRankingItem,
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  absoluteSimTime: number
): { state: EngineState; snapshot: CalculationsSnapshot; totalSecondsSpent: number } | null {
  if (!isFinite(item.timeToBuySeconds)) return null;
  const transitions = boostTransitionsFrom(snapshot, absoluteSimTime);
  const bought = applyTime(applyFarmPurchase(state, item.steps), item.timeToBuySeconds, snapshot, { transitions });
  return {
    state: bought,
    snapshot: computeSnapshot(bought, context, { skipEpochConversion: true }),
    totalSecondsSpent: item.timeToBuySeconds,
  };
}
