import { ei } from 'lib';
import {
  createSimAction,
  generateActionId,
  type Action,
  type ActionPayloadMap,
  type ActionType,
  type VirtueEgg,
} from '@/types';
import { simulate } from '@/engine/simulate';
import type { EngineState, SimulationContext } from '@/engine/types';
import { TANK_CAPACITIES } from '@/stores/fuelTank';
import { fuelForLaunches, launchCost } from './rockets/launches';
import {
  fuelShortfalls,
  humilityVisitInsertIndex,
  HumilityPlanError,
  launchSchedule,
  resolveLaunches,
  type HumilityPlanVisit,
} from './humilityPlan';

export function humilitySourceTag(visitId: string): string {
  return `humility-plan:${visitId}`;
}

function validateTank(amounts: Record<VirtueEgg, number>, level: number): void {
  const capacity = TANK_CAPACITIES[level];
  const total = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  if (capacity === undefined || !Number.isFinite(total) || total > capacity + capacity * 1e-12) {
    throw new HumilityPlanError(`This import would overflow the fuel tank (${total} eggs; capacity ${capacity ?? 0}).`);
  }
}

// Account for fuel spent between an earlier egg visit and the new launch, including
// consumption that the original simulation clamped to an empty tank.
function fuelToStore(
  actions: Action[],
  egg: VirtueEgg,
  required: number,
  insertIndex: number,
  launchIndex: number
): number {
  let needed = required;
  for (let i = launchIndex - 1; i >= insertIndex && needed > 0; i--) {
    const action = actions[i];
    if (action.type === 'store_fuel' && action.payload.egg === egg)
      needed = Math.max(0, needed - action.payload.amount);
    if (action.type === 'remove_fuel' && action.payload.egg === egg) needed += action.payload.amount;
    if (action.type === 'launch_missions') needed += action.payload.fuelConsumed[egg] ?? 0;
  }
  return Math.max(0, needed - (actions[insertIndex - 1].endState.fuelTankAmounts[egg] ?? 0));
}

/**
 * How much more fuel the tank will take at each step, as a budget successive stores draw down.
 * Fuel stored before an earlier Humility launch shares the tank with the fuel that launch has not
 * spent yet, so what a store can take is the least free space over the whole stretch its fuel
 * sits through, and each egg sees what the eggs before it left.
 */
function tankSpace(actions: readonly Action[]) {
  const free = actions.map(({ endState }) => {
    const stored = Object.values(endState.fuelTankAmounts).reduce((sum, amount) => sum + amount, 0);
    return (TANK_CAPACITIES[endState.tankLevel] ?? 0) - stored;
  });
  return function claim(from: number, until: number, wanted: number): number {
    let amount = wanted;
    for (let i = from; i < until; i++) amount = Math.min(amount, free[i]);
    if (!(amount > 0)) return 0;
    for (let i = from; i < until; i++) free[i] -= amount;
    return amount;
  };
}

/** Build and validate a replacement without mutating the live plan. */
export function stageHumilityVisit(
  original: Action[],
  visit: HumilityPlanVisit,
  base: EngineState,
  context: SimulationContext
): { actions: Action[]; initialEgg?: VirtueEgg } {
  const tag = humilitySourceTag(visit.visitId);
  let actions = simulate(
    original.filter(action => action.sourceTag !== tag),
    context,
    base
  );
  let launchIndex = humilityVisitInsertIndex(actions, visit.visitId);
  if (launchIndex === null)
    throw new HumilityPlanError(`This plan no longer has the visit ${visit.label} was solved for.`);
  let arrivalIndex = actions.findIndex(action => action.id === visit.visitId);
  let previous = actions[launchIndex - 1].endState;
  const launches = resolveLaunches(visit);
  const required = fuelForLaunches(launches);
  // Check before expanding counts into individual scheduling entries. Humility is left out of the
  // requirement: the farm is on Humility for the whole visit, so that fuel comes off production and
  // never has to fit in the tank alongside the rest — the same exemption the mission grid's budget
  // makes (`isOverBudget` in `stores/rockets.ts`). Counting it here rejected plans whose four
  // stored fuels fit.
  validateTank({ ...required, humility: 0 }, previous.tankLevel);

  let initialEgg: VirtueEgg | undefined;
  if (arrivalIndex === 0 && actions[0].type === 'start_ascension') {
    initialEgg = fuelShortfalls(required, previous.fuelTankAmounts).find(fuel => fuel.egg !== 'humility')?.egg;
    if (initialEgg) {
      const start = actions[0];
      const initialFarmState = start.payload.initialFarmState;
      const fuelStart: Action<'start_ascension'> = {
        ...start,
        id: generateActionId(),
        payload: {
          ...start.payload,
          initialEgg,
          ...(initialFarmState && {
            initialFarmState: { ...initialFarmState, eggType: ei.Egg[initialEgg.toUpperCase() as keyof typeof ei.Egg] },
          }),
        },
      };
      // Keep the visit id on its new incoming shift so exports and restaging still find it.
      const arrival = {
        ...createSimAction('shift', { fromEgg: initialEgg, toEgg: 'humility', newShiftCount: 0 }),
        id: visit.visitId,
        timestamp: Date.now(),
      };
      base = { ...base, currentEgg: initialEgg };
      actions = simulate([fuelStart, arrival, ...actions.slice(1)], context, base);
      arrivalIndex = 1;
      launchIndex = humilityVisitInsertIndex(actions, visit.visitId)!;
      previous = actions[launchIndex - 1].endState;
    }
  }

  const insertions = new Map<number, Action[]>();
  const timestamp = Date.now();
  function action<T extends ActionType>(type: T, payload: ActionPayloadMap[T], cost = 0): Action<T> {
    return { ...createSimAction(type, payload, cost), id: generateActionId(), timestamp, sourceTag: tag };
  }
  function insert(index: number, additions: Action[]): void {
    insertions.set(index, [...(insertions.get(index) ?? []), ...additions]);
  }
  /** Weaves the pending insertions, indexed against `source`, into it, and takes them. */
  function weave(source: Action[]): Action[] {
    const candidate: Action[] = [];
    for (let i = 0; i <= source.length; i++) {
      candidate.push(...(insertions.get(i) ?? []));
      if (i < source.length) candidate.push(source[i]);
    }
    insertions.clear();
    return candidate;
  }

  // Only the four eggs that have to be tanked. A store is how fuel for an egg the farm is not
  // producing at launch time gets into the tank, so each one is placed in that egg's own visit;
  // Humility needs none, because the farm is producing Humility right up to the launch.
  const claim = tankSpace(actions);
  for (const { egg } of fuelShortfalls(required, previous.fuelTankAmounts)) {
    if (egg === 'humility') continue;
    let eggIndex = arrivalIndex - 1;
    while (eggIndex >= 0 && actions[eggIndex].endState.currentEgg !== egg) eggIndex--;
    if (eggIndex < 0) continue;
    // That search reaches back across earlier Humility launches, which hold their own fuel in the
    // tank until they go, so this visit takes only what fits the whole way from there. Storing the
    // full amount is what would overflow the earlier launch; the rest is picked up below.
    const insertIndex = eggIndex + 1;
    const wanted = fuelToStore(actions, egg, required[egg], insertIndex, launchIndex);
    const amount = claim(insertIndex - 1, arrivalIndex, wanted);
    if (amount > 0) insert(insertIndex, [action('store_fuel', { egg, amount, timeSeconds: 0 })]);
  }
  const filled = insertions.size > 0 ? simulate(weave(actions), context, base) : actions;
  arrivalIndex = filled.findIndex(step => step.id === visit.visitId);
  launchIndex = humilityVisitInsertIndex(filled, visit.visitId)!;
  previous = filled[launchIndex - 1].endState;

  // Whatever the plan's own visits to an egg could not hold — including all of it, for an egg the
  // plan never visits — is stored in a phase of its own just before this visit. Opening a phase by
  // hand is shift, wait for the habs the shift emptied, then work, so a staged phase opens the same
  // way. The payload is re-derived against the post-shift state on every simulate, so these are
  // seeds.
  const newPhases: Action[] = [];
  for (const { egg } of fuelShortfalls(required, previous.fuelTankAmounts)) {
    if (egg === 'humility') continue;
    newPhases.push(
      action('shift', { fromEgg: previous.currentEgg, toEgg: egg, newShiftCount: 0 }),
      action('wait_for_full_habs', {
        habCapacity: previous.habCapacity,
        ihr: previous.offlineIHR,
        currentPopulation: 1,
        totalTimeSeconds: 0,
      }),
      action('store_fuel', {
        egg,
        amount: fuelToStore(filled, egg, required[egg], arrivalIndex, launchIndex),
        timeSeconds: 0,
      })
    );
  }
  insert(arrivalIndex, newPhases);

  const ftl = context.epicResearchLevels['afx_mission_time'] ?? 0;
  const schedule = launchSchedule(launches, ftl);
  const launch = action(
    'launch_missions',
    {
      missions: launches.map(launch => ({ ...launch })),
      totalTimeSeconds: schedule.totalSeconds,
      totalMissions: schedule.totalMissions,
      fuelConsumed: required,
    },
    launchCost(launches)
  );
  insert(launchIndex, [launch]);

  const result = simulate(weave(filled), context, base);
  for (const step of result) validateTank(step.endState.fuelTankAmounts, step.endState.tankLevel);
  const launchedIndex = result.findIndex(step => step.id === launch.id);
  const launched = result[launchedIndex];
  const remaining = Math.max(0, visit.makespanSeconds - launched.totalTimeSeconds);
  if (remaining === 0) return { actions: result, initialEgg };
  const tail = simulate(
    [action('wait_for_time', { totalTimeSeconds: remaining }), ...result.slice(launchedIndex + 1)],
    context,
    launched.endState,
    launchedIndex + 1
  );
  return { actions: [...result.slice(0, launchedIndex + 1), ...tail], initialEgg };
}
