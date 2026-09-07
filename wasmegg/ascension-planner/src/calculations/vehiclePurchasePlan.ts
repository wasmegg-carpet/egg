import { getDiscountedVehiclePrice, getDiscountedTrainCarPrice, getVehicleType, type VehicleCostModifiers } from '@/lib/vehicles';
import { getTimeToSave } from '@/engine/apply';
import type { CalculationsSnapshot } from '@/types';

export interface VehicleMultipliers {
  universalMultiplier: number;
  hoverMultiplier: number;
  hyperloopMultiplier: number;
  epicMultiplier: number;
  shippingCapMultiplier: number;
  artifactMultiplier: number;
}

export const HYPERLOOP_ID = 11;

/**
 * Capacity of a single vehicle slot (eggs/second), given the slot's vehicle/train
 * length and the effective multipliers in play.
 */
export function calculateVehicleCapacity(
  slot: { vehicleId: number | null; trainLength: number },
  universalMultiplier: number,
  hoverMultiplier: number,
  hyperloopMultiplier: number,
  epicMultiplier: number,
  shippingCapMultiplier: number,
  artifactMultiplier: number
): number {
  if (slot.vehicleId === null) return 0;
  const vt = getVehicleType(slot.vehicleId);
  if (!vt) return 0;

  const trainLength = vt.isHyperloop ? slot.trainLength : 1;
  const baseCapacity = vt.baseCapacityPerSecond * trainLength;

  const vehicleHoverMult = vt.isHover ? hoverMultiplier : 1;
  const vehicleHyperloopMult = vt.isHyperloop ? hyperloopMultiplier : 1;

  return (
    baseCapacity *
    universalMultiplier *
    epicMultiplier *
    vehicleHoverMult *
    vehicleHyperloopMult *
    shippingCapMultiplier *
    artifactMultiplier
  );
}

export interface VehiclePurchaseStep {
  slotIndex: number;
  type: 'upgrade_hyperloop' | 'add_car';
  cost: number;
  waitSeconds: number;
}

export interface VehiclePlanResult {
  steps: VehiclePurchaseStep[];
  totalSeconds: number;
  allMaxed: boolean;
}

/**
 * Bank/population/earnings fields a vehicle planner needs to track as it virtually
 * simulates purchases forward in time — the subset of `CalculationsSnapshot` that
 * `getTimeToSave`/`applyVirtualVehiclePurchase` read and mutate.
 */
export interface VehiclePlanningSnapshot {
  bankValue: number;
  offlineEarnings: number;
  population: number;
  habCapacity: number;
  offlineIHR: number;
  shippingCapacity: number;
  ratePerChickenPerSecond: number;
  elr: number;
  layRate: number;
}

function makeCapacityOf(multipliers: VehicleMultipliers) {
  return (slot: { vehicleId: number | null; trainLength: number }) =>
    calculateVehicleCapacity(
      slot,
      multipliers.universalMultiplier,
      multipliers.hoverMultiplier,
      multipliers.hyperloopMultiplier,
      multipliers.epicMultiplier,
      multipliers.shippingCapMultiplier,
      multipliers.artifactMultiplier
    );
}

/**
 * Mutates `snapshot` in place to reflect one purchase: population grows for `seconds`
 * (the wait spent saving for it), shippingCapacity/elr/offlineEarnings move with the
 * resulting capacity delta, and `price` comes out of the bank.
 */
function applyVirtualVehiclePurchase(
  snapshot: VehiclePlanningSnapshot,
  oldCap: number,
  newCap: number,
  price: number,
  seconds: number,
  earningsPerEgg: number
): void {
  const P0 = snapshot.population;
  const I = snapshot.offlineIHR / 60;
  // seconds can be Infinity (unaffordable in finite time); P0 + I * Infinity would be
  // NaN when I is 0, so branch instead of letting that multiplication happen. Given
  // infinite time, population settles at habCapacity if it grows at all, else stays put.
  snapshot.population = seconds === Infinity ? (I > 0 ? snapshot.habCapacity : P0) : Math.min(snapshot.habCapacity, P0 + I * seconds);
  snapshot.shippingCapacity += newCap - oldCap;

  snapshot.layRate = snapshot.population * snapshot.ratePerChickenPerSecond;
  snapshot.elr = Math.min(snapshot.layRate, snapshot.shippingCapacity);
  snapshot.offlineEarnings = snapshot.elr * earningsPerEgg;

  snapshot.bankValue = Math.max(0, snapshot.bankValue - price);
}

/**
 * Simulate maxing out every vehicle slot: upgrade to Hyperloop, then fill its train
 * cars, one slot fully before moving to the next (not globally-greedy across slots -
 * this mirrors the manual planner's "Max Vehicles" button exactly, slot 0 to slot N).
 *
 * Only sensible with an unbounded time horizon (see `planVehiclesForTimeLimit` for the
 * bounded-budget case): it always commits straight to Hyperloop for every slot, on the
 * assumption there's enough time to eventually afford it, so any intermediate tier would
 * just be sunk cost.
 */
export function planMaxVehicles(
  vehicles: { vehicleId: number | null; trainLength: number }[],
  maxSlots: number,
  maxTrainLength: number,
  costModifiers: VehicleCostModifiers,
  isSaleActive: boolean,
  multipliers: VehicleMultipliers,
  startSnapshot: VehiclePlanningSnapshot
): VehiclePlanResult {
  const steps: VehiclePurchaseStep[] = [];
  let totalSeconds = 0;

  const capacityOf = makeCapacityOf(multipliers);

  const virtualVehicles = vehicles.map(v => ({ ...v })).slice(0, maxSlots);
  while (virtualVehicles.length < maxSlots) {
    virtualVehicles.push({ vehicleId: null, trainLength: 1 });
  }

  // Earnings per shipped egg stays constant as slots are upgraded (only shippingCapacity/elr move).
  const earningsPerEgg = startSnapshot.elr > 0 ? startSnapshot.offlineEarnings / startSnapshot.elr : 0;

  const virtualSnapshot: VehiclePlanningSnapshot = { ...startSnapshot };

  for (let i = 0; i < maxSlots; i++) {
    const slot = virtualVehicles[i];
    let currentLength = 1;

    // 1. Upgrade to Hyperloop
    if (slot.vehicleId !== HYPERLOOP_ID) {
      const currentHyperloopCount = virtualVehicles.filter(v => v.vehicleId === HYPERLOOP_ID).length;
      const price = getDiscountedVehiclePrice(HYPERLOOP_ID, currentHyperloopCount, costModifiers, isSaleActive);
      const seconds = getTimeToSave(price, virtualSnapshot as CalculationsSnapshot);

      totalSeconds += seconds;
      steps.push({ slotIndex: i, type: 'upgrade_hyperloop', cost: price, waitSeconds: seconds });

      const oldCap = capacityOf(slot);
      const newCap = capacityOf({ vehicleId: HYPERLOOP_ID, trainLength: 1 });
      applyVirtualVehiclePurchase(virtualSnapshot, oldCap, newCap, price, seconds, earningsPerEgg);

      virtualVehicles[i] = { vehicleId: HYPERLOOP_ID, trainLength: 1 };
    } else {
      currentLength = slot.trainLength;
    }

    // 2. Add cars
    for (let l = currentLength; l < maxTrainLength; l++) {
      const carPrice = getDiscountedTrainCarPrice(l, costModifiers, isSaleActive);
      const seconds = getTimeToSave(carPrice, virtualSnapshot as CalculationsSnapshot);

      totalSeconds += seconds;
      steps.push({ slotIndex: i, type: 'add_car', cost: carPrice, waitSeconds: seconds });

      const oldCap = capacityOf({ vehicleId: HYPERLOOP_ID, trainLength: l });
      const newCap = capacityOf({ vehicleId: HYPERLOOP_ID, trainLength: l + 1 });
      applyVirtualVehiclePurchase(virtualSnapshot, oldCap, newCap, carPrice, seconds, earningsPerEgg);

      virtualVehicles[i].trainLength = l + 1;
    }
  }

  return { steps, totalSeconds, allMaxed: steps.length === 0 };
}

export interface VehicleTimeStep {
  type: 'vehicle' | 'car';
  slotIndex: number;
  vehicleId?: number; // present when type === 'vehicle' — the tier being bought, not necessarily Hyperloop
  cost: number;
  waitSeconds: number;
}

export interface VehicleTimePlanResult {
  steps: VehicleTimeStep[];
  totalSeconds: number;
}

interface VehicleCandidate {
  type: 'vehicle' | 'car';
  slotIndex: number;
  vehicleId?: number;
  cost: number;
  score: number;
}

/**
 * List every purchase (upgrade any slot to any higher vehicle tier, or add a car to a
 * Hyperloop slot) that would increase that slot's capacity, each scored by
 * deltaCapacity/cost ROI — a purchase adding >1000 capacity always outranks pure ROI, so
 * a game-changing jump (e.g. the first Hyperloop) doesn't get starved by a swarm of
 * marginally-better-ROI trinkets. No affordability filtering here; callers apply their
 * own notion of "affordable" (a budget, or a time limit via `getTimeToSave`).
 */
function scoreVehicleCandidates(
  virtualSlots: { vehicleId: number | null; trainLength: number }[],
  maxTrainLength: number,
  costModifiers: VehicleCostModifiers,
  isSaleActive: boolean,
  multipliers: VehicleMultipliers
): VehicleCandidate[] {
  const capacityOf = makeCapacityOf(multipliers);
  const candidates: VehicleCandidate[] = [];

  const vehicleCounts: Record<number, number> = {};
  for (const slot of virtualSlots) {
    if (slot.vehicleId !== null) {
      vehicleCounts[slot.vehicleId] = (vehicleCounts[slot.vehicleId] || 0) + 1;
    }
  }

  const scoreOf = (deltaCap: number, cost: number) => {
    const roi = deltaCap / Math.max(cost, 1e-10);
    return deltaCap > 1000 ? deltaCap * 1000 + roi : roi;
  };

  for (let i = 0; i < virtualSlots.length; i++) {
    const slot = virtualSlots[i];

    // 1. Consider upgrading vehicle to any higher tier, not just Hyperloop
    const currentId = slot.vehicleId;
    const startId = currentId === null ? 0 : currentId + 1;

    for (let nextId = startId; nextId <= HYPERLOOP_ID; nextId++) {
      const cost = getDiscountedVehiclePrice(nextId, vehicleCounts[nextId] || 0, costModifiers, isSaleActive);
      const deltaCap = capacityOf({ vehicleId: nextId, trainLength: 1 }) - capacityOf(slot);
      if (deltaCap >= 0) {
        candidates.push({ type: 'vehicle', slotIndex: i, vehicleId: nextId, cost, score: scoreOf(deltaCap, cost) });
      }
    }

    // 2. Consider adding a Hyperloop car
    if (slot.vehicleId === HYPERLOOP_ID && slot.trainLength < maxTrainLength) {
      const cost = getDiscountedTrainCarPrice(slot.trainLength, costModifiers, isSaleActive);
      const deltaCap = capacityOf({ ...slot, trainLength: slot.trainLength + 1 }) - capacityOf(slot);
      if (deltaCap > 0) {
        candidates.push({ type: 'car', slotIndex: i, cost, score: scoreOf(deltaCap, cost) });
      }
    }
  }

  return candidates;
}

/**
 * Simulate spending a bounded amount of *time* (not a pre-computed budget) on whichever
 * single next purchase — upgrade any slot to any higher vehicle tier, or add a car to a
 * Hyperloop slot — has the best deltaCapacity/cost ROI and still fits inside the
 * remaining `timeLimit`, repeating until nothing scores fits.
 *
 * Re-picks from scratch after every purchase, recomputing each candidate's wait via
 * `getTimeToSave` against the *current* (post-purchase) snapshot — so a slot's capacity
 * gain feeding back into a higher ELR (when shipping capacity was the bottleneck, as it
 * usually is for a low earner) correctly speeds up saving for the next purchase, rather
 * than assuming the pre-purchase earnings rate holds for the whole window.
 *
 * This is the counterpart to `planMaxVehicles` for a *bounded* time horizon: a low earner
 * can't afford a single Hyperloop within the window, but can afford several cheap
 * lower-tier vehicles across many slots — each raising shippingCapacity (and thus ELR,
 * when capacity-bound) sooner than waiting the whole window for one Hyperloop would.
 * Also used by the manual "5 Min Max Shipping" button (`VehicleActions.vue`) so the auto
 * planner and the manual UI pick purchases via the exact same logic, just with a
 * different `timeLimit`.
 */
export function planVehiclesForTimeLimit(
  vehicles: { vehicleId: number | null; trainLength: number }[],
  maxSlots: number,
  maxTrainLength: number,
  costModifiers: VehicleCostModifiers,
  isSaleActive: boolean,
  multipliers: VehicleMultipliers,
  timeLimit: number,
  startSnapshot: VehiclePlanningSnapshot
): VehicleTimePlanResult {
  const capacityOf = makeCapacityOf(multipliers);

  const virtualSlots = vehicles.map(v => ({ ...v })).slice(0, maxSlots);
  while (virtualSlots.length < maxSlots) {
    virtualSlots.push({ vehicleId: null, trainLength: 1 });
  }

  const earningsPerEgg = startSnapshot.elr > 0 ? startSnapshot.offlineEarnings / startSnapshot.elr : 0;
  const virtualSnapshot: VehiclePlanningSnapshot = { ...startSnapshot };

  const steps: VehicleTimeStep[] = [];
  let elapsedSeconds = 0;

  while (true) {
    const candidates = scoreVehicleCandidates(virtualSlots, maxTrainLength, costModifiers, isSaleActive, multipliers);

    let best: (VehicleCandidate & { waitSeconds: number }) | null = null;
    for (const candidate of candidates) {
      const waitSeconds = getTimeToSave(candidate.cost, virtualSnapshot as CalculationsSnapshot);
      // Infinity means genuinely unaffordable (see getTimeToSave's doc comment), not just
      // slow — never select it, regardless of how much of timeLimit is left (this also
      // guards a timeLimit of Infinity itself, where elapsedSeconds + Infinity > Infinity
      // is false and this candidate would otherwise pass the check below).
      if (!isFinite(waitSeconds)) continue;
      if (elapsedSeconds + waitSeconds > timeLimit) continue;
      if (!best || candidate.score > best.score) {
        best = { ...candidate, waitSeconds };
      }
    }

    if (!best) break;

    const oldSlot = virtualSlots[best.slotIndex];
    const newSlot =
      best.type === 'vehicle' ? { vehicleId: best.vehicleId!, trainLength: 1 } : { ...oldSlot, trainLength: oldSlot.trainLength + 1 };

    elapsedSeconds += best.waitSeconds;
    steps.push({
      type: best.type,
      slotIndex: best.slotIndex,
      vehicleId: best.vehicleId,
      cost: best.cost,
      waitSeconds: best.waitSeconds,
    });

    applyVirtualVehiclePurchase(virtualSnapshot, capacityOf(oldSlot), capacityOf(newSlot), best.cost, best.waitSeconds, earningsPerEgg);
    virtualSlots[best.slotIndex] = newSlot;
  }

  return { steps, totalSeconds: elapsedSeconds };
}
