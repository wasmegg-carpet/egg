// Reads an ascension-planner plan save and slices out its Humility visits.
//
// AP's export is not changed for this: a visit is a maximal run of actions whose snapshot says
// the player is on Humility, and every plan-side budget the optimizer needs is on that run's
// snapshots. AP owns everything time-varying because it simulates forward; this app only ever sees
// "now", which is why the budgets have to arrive rather than be derived here.
//
// The run's *first* snapshot carries all of them but one: arriving is a `shift`, and a shift is
// the one action whose snapshot describes a farm that exists for no part of the visit. See
// `earningsRateOf`.

import { ei } from 'lib';

import {
  AP_FTL_RESEARCH_ID,
  AP_ZEROG_RESEARCH_ID,
  NON_HUMILITY_EGG_IDS,
  type PlanSave,
  type PlanSaveAction,
  SUPPORTED_PLAN_SAVE_VERSION,
} from './schema';

export interface HumilityVisit {
  // The id of the action that entered Humility. The join key AP matches on when the answer comes
  // back, and the only staleness check there is.
  visitId: string;
  visitIndex: number;
  label: string;

  // Seconds since the epoch at which the player arrives on Humility, for looking up whether a 2x
  // mission capacity event is running then. Null when the save carries no readable ascension
  // start, in which case the visit is still planable, just undated.
  arrivalTimestamp: number | null;
  // Time the plan spends on Humility after arriving. Zero is normal and means the plan has
  // nothing scheduled there yet, which is exactly when a player comes here — the visit page
  // takes a manual budget in that case.
  plannedDurationSeconds: number;

  // Per-egg fuel banked in the tank on arrival, Humility excluded.
  fuelByEgg: Map<ei.Egg, number>;
  tankLevel: number;
  // What the plan holds the moment it lands on Humility, which is nothing: shifting zeroes the
  // bank. Everything the visit has to spend is therefore earned during it.
  bankValue: number;
  // The rate the farm runs at on Humility, not the rate at the instant of arrival — see
  // `earningsRateOf`.
  earningsPerSecond: number;

  epicResearchFTLLevel: number;
  epicResearchZerogLevel: number;
}

export class PlanSaveError extends Error {}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// AP's library writes an envelope around the save — `{version, type, name, data}` for one plan,
// `{version, type, plans: [{name, data}]}` for the whole library — and its own importer reads the
// bare save too. All three shapes reach this file picker, so the envelope is peeled here and
// everything below only ever sees the save. The version checked is always the inner one: the
// envelope carries a version of its own that numbers a different thing.
function unwrapPlanEnvelope(json: Record<string, unknown>): Record<string, unknown> {
  if (json.type === 'plan') {
    if (!isRecord(json.data)) throw new PlanSaveError('Plan export has no `data`.');
    return json.data;
  }
  if (json.type === 'library') {
    throw new PlanSaveError(
      'That is a whole ascension-planner library, which can hold several plans. ' +
        'Export the one plan you want to solve and load that file instead.'
    );
  }
  return json;
}

// Validated rather than cast: the file is picked by the user and a missing `endState` further in
// would surface as a budget of NaN rather than as a message they can act on.
export function parsePlanSave(json: unknown): PlanSave {
  if (!isRecord(json)) throw new PlanSaveError('Not a plan file: expected a JSON object.');
  const save = unwrapPlanEnvelope(json);
  const { version, actions, initialState } = save;
  if (typeof version !== 'number') {
    throw new PlanSaveError('Not an ascension-planner plan file: no `version`.');
  }
  if (version !== SUPPORTED_PLAN_SAVE_VERSION) {
    throw new PlanSaveError(
      `This plan file is version ${version}; the planner here reads version ${SUPPORTED_PLAN_SAVE_VERSION}. ` +
        'Re-export it from a matching ascension-planner build.'
    );
  }
  if (!Array.isArray(actions)) throw new PlanSaveError('Plan file has no `actions` list.');
  if (!isRecord(initialState)) throw new PlanSaveError('Plan file has no `initialState`.');
  return save as unknown as PlanSave;
}

// AP writes the ascension start as a wall clock plus an IANA zone. Restated here rather than
// imported: the whole seam is two JSON documents, and this is the one calculation on the far side
// of it that has to agree.
function localTimestampInTimezone(dateStr: string, timeStr: string, timezone: string): number | null {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  if (![y, m, d, h, min].every(Number.isFinite)) return null;
  const guessUTC = Date.UTC(y, m - 1, d, h, min, 0);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(guessUTC));
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    const wallClockUTC = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second')
    );
    const offsetMs = wallClockUTC - guessUTC;
    return Math.floor((guessUTC - offsetMs) / 1000);
  } catch {
    // An unrecognized timezone. The visit stays planable, just undated.
    return null;
  }
}

function ascensionStartSeconds(save: PlanSave): number | null {
  const v = save.virtueState;
  if (!v?.ascensionDate || !v.ascensionTime || !v.ascensionTimezone) return null;
  return localTimestampInTimezone(v.ascensionDate, v.ascensionTime, v.ascensionTimezone);
}

function secondsOf(action: PlanSaveAction): number {
  const t = action.totalTimeSeconds;
  return Number.isFinite(t) && t > 0 ? t : 0;
}

// `shift` sets population to 1 (`ascension-planner/src/engine/apply/actions.ts`), so the snapshot
// on the action that enters Humility is the farm with a single chicken in it — a rate nine orders
// of magnitude under what the visit is actually flown at, and one it holds for no part of the
// visit. What is wanted is the rate the farm returns to once the habs refill, so it is taken as
// the best seen across the visit's own actions and the one action before arrival: a later action
// in the run witnesses that rate directly, and when the plan has scheduled nothing on Humility yet
// — the case a player comes here for — there is no such action, leaving the pre-shift farm, same
// capacity and same artifacts with its population not yet zeroed, as the only witness to it.
//
// The trough can never win a maximum, which is what makes one action of slack enough here.
function earningsRateOf(action: PlanSaveAction | undefined): number {
  const state = action?.endState;
  if (!state) return 0;
  return Math.max(
    Number.isFinite(state.onlineEarnings) ? state.onlineEarnings : 0,
    Number.isFinite(state.offlineEarnings) ? state.offlineEarnings : 0
  );
}

function fuelByEggOf(action: PlanSaveAction): Map<ei.Egg, number> {
  const amounts = action.endState?.fuelTankAmounts ?? {};
  const fuels = new Map<ei.Egg, number>();
  for (const [egg, id] of NON_HUMILITY_EGG_IDS) {
    const amount = amounts[egg];
    fuels.set(id, Number.isFinite(amount) && (amount as number) > 0 ? (amount as number) : 0);
  }
  return fuels;
}

export function sliceHumilityVisits(save: PlanSave): HumilityVisit[] {
  const ftl = save.initialState.epicResearchLevels?.[AP_FTL_RESEARCH_ID] ?? 0;
  // AP has no epic-research action, so epic research is fixed for the whole plan and reading it
  // off the initial state is right at every visit. `store_fuel` / `remove_fuel` do exist, which
  // is why the tank is read per visit instead.
  const zerog = save.initialState.epicResearchLevels?.[AP_ZEROG_RESEARCH_ID] ?? 0;
  const start = ascensionStartSeconds(save);

  const visits: HumilityVisit[] = [];
  let elapsed = 0;
  let current: HumilityVisit | null = null;
  let previous: PlanSaveAction | undefined;

  for (const action of save.actions) {
    const onHumility = action?.endState?.currentEgg === 'humility';

    if (onHumility && current === null) {
      const index = visits.length;
      current = {
        visitId: action.id,
        visitIndex: index,
        label: `Humility #${index + 1}`,
        arrivalTimestamp: start === null ? null : start + elapsed + secondsOf(action),
        plannedDurationSeconds: 0,
        fuelByEgg: fuelByEggOf(action),
        tankLevel: Number.isFinite(action.endState?.tankLevel) ? action.endState.tankLevel : 0,
        bankValue: Number.isFinite(action.endState?.bankValue) ? action.endState.bankValue : 0,
        earningsPerSecond: Math.max(earningsRateOf(action), earningsRateOf(previous)),
        epicResearchFTLLevel: ftl,
        epicResearchZerogLevel: zerog,
      };
      visits.push(current);
    } else if (onHumility && current !== null) {
      // Time the plan already spends on Humility after arriving. The departing shift is not part
      // of the run and so is not counted.
      current.plannedDurationSeconds += secondsOf(action);
      current.earningsPerSecond = Math.max(current.earningsPerSecond, earningsRateOf(action));
    } else if (!onHumility) {
      current = null;
    }

    elapsed += secondsOf(action);
    previous = action;
  }

  return visits;
}

// What one ship may cost at this visit: what the plan says is in the bank on arrival — nothing,
// since shifting zeroes it — plus what the farm earns over however long the visit is budgeted to
// run. The duration is a parameter because the plan's own figure is zero for a visit whose
// missions have not been scheduled yet, which is the case a player comes here to fill in.
//
// This is a per-ship filter, not a spend limit: the optimizer drops options costing more than it
// but nothing bounds the plan's total, so the total is reported and warned on instead.
export function gemBudgetFor(visit: HumilityVisit, durationSeconds: number): number {
  const seconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  return visit.bankValue + visit.earningsPerSecond * seconds;
}
