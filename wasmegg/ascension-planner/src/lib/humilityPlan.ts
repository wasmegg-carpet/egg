// Reads the artifact explorer’s Humility plans. Ships and durations cross as enum names;
// target ids use the shared protobuf enum. Fuel is derived from this app’s tables.

import { ei } from 'lib';

import type { Action, VirtueEgg } from '@/types';
import { VIRTUE_EGGS } from '@/types';
import { Spaceship, DurationType, VIRTUE_FUEL_REQUIREMENTS, missionName } from '@/lib/missions';
import { type Launch, launchEntries } from '@/lib/rockets/launches';
import { scheduleMissions, type ScheduleResult } from '@/lib/rockets/scheduler';

export const HUMILITY_PLAN_SCHEMA = 'eggverse.humility-plan';
export const HUMILITY_PLAN_SCHEMA_VERSION = 1;

export interface HumilityPlanLaunch {
  ship: string;
  duration: string;
  targetAfxId: number;
  count: number;
}

export interface HumilityPlanVisit {
  visitId: string;
  visitIndex: number;
  label: string;
  jointProbability: number;
  launches: HumilityPlanLaunch[];
  makespanSeconds: number;
  fuelRequired: Partial<Record<VirtueEgg, number>>;
  gemCost: number;
  gemBudget: number;
}

export interface HumilityPlanFile {
  schema: string;
  schemaVersion: number;
  source: string;
  generatedAt: number;
  planLabel: string;
  visits: HumilityPlanVisit[];
}

export class HumilityPlanError extends Error {}

/**
 * The explorer's ship names are the protobuf's, and our `Spaceship` mirrors that enum exactly, so
 * the name lookup is the mapping. A name we do not have is an error rather than a skip: dropping
 * a ship would quietly shrink the plan.
 */
function shipByName(name: string): Spaceship | undefined {
  const ship = (Spaceship as unknown as Record<string, number | undefined>)[name];
  return typeof ship === 'number' ? (ship as Spaceship) : undefined;
}

function shipFromName(name: unknown): Spaceship {
  if (typeof name !== 'string') throw new HumilityPlanError(`Launch has no ship name.`);
  const ship = shipByName(name);
  if (ship === undefined) throw new HumilityPlanError(`Unknown ship "${name}".`);
  return ship;
}

/**
 * Only the three durations this app plans. `TUTORIAL` exists in the protobuf and has no
 * equivalent here; it is the exact value our `EPIC` collides with numerically, which is why this
 * mapping is by name and why the missing case is rejected rather than defaulted.
 */
const DURATION_BY_NAME: Record<string, DurationType> = {
  SHORT: DurationType.SHORT,
  LONG: DurationType.LONG,
  EPIC: DurationType.EPIC,
};

function durationFromName(name: unknown): DurationType {
  if (typeof name !== 'string') throw new HumilityPlanError(`Launch has no duration name.`);
  const duration = DURATION_BY_NAME[name];
  if (typeof duration !== 'number') throw new HumilityPlanError(`Unsupported mission duration "${name}".`);
  return duration;
}

/**
 * How a launch reads in the mission grid. Listing the file's enum names instead ("EPIC ATREGGIES")
 * left the reader matching them against the grid by eye. An unmappable name is shown as it came:
 * this renders the file before staging validates it, and staging is what rejects such a name.
 */
export function launchLabel(launch: HumilityPlanLaunch): string {
  const ship = shipByName(launch.ship);
  const duration = DURATION_BY_NAME[launch.duration];
  if (ship === undefined || duration === undefined) return `${launch.duration} ${launch.ship}`;
  return missionName(ship, duration);
}

export interface ResolvedLaunch extends Launch {
  targetAfxId: number;
}

export function resolveLaunches(visit: HumilityPlanVisit): ResolvedLaunch[] {
  if (!Array.isArray(visit.launches)) throw new HumilityPlanError(`Visit "${visit.label}" has no launches.`);
  return visit.launches.map(launch => {
    if (!isRecord(launch)) throw new HumilityPlanError(`Visit "${visit.label}" has an invalid launch.`);
    const count = launch.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new HumilityPlanError(`Visit "${visit.label}" has a launch with a count of ${launch.count}.`);
    }
    const targetAfxId = launch.targetAfxId;
    if (
      typeof targetAfxId !== 'number' ||
      !Number.isInteger(targetAfxId) ||
      ei.ArtifactSpec.Name[targetAfxId] === undefined
    ) {
      throw new HumilityPlanError(`Visit "${visit.label}" has a launch with an invalid target id.`);
    }
    const ship = shipFromName(launch.ship);
    const duration = durationFromName(launch.duration);
    if (!Array.isArray(VIRTUE_FUEL_REQUIREMENTS[ship]?.[duration])) {
      throw new HumilityPlanError(`Unsupported mission ${launch.ship} / ${launch.duration}.`);
    }
    return { ship, duration, targetAfxId, count };
  });
}

export interface FuelDrift {
  egg: VirtueEgg;
  ours: number;
  theirs: number;
}

/**
 * Compares our derived figures against the explorer's for the four eggs it reports. Relative,
 * because these run to 1e14 and an absolute epsilon would be meaningless; 0.1% is far tighter
 * than any real table disagreement and far looser than float noise.
 */
const FUEL_DRIFT_TOLERANCE = 1e-3;

export function fuelDrift(visit: HumilityPlanVisit, ours: Record<VirtueEgg, number>): FuelDrift[] {
  const drift: FuelDrift[] = [];
  for (const egg of VIRTUE_EGGS) {
    if (egg === 'humility') continue; // never in the file, by design
    const theirs = visit.fuelRequired?.[egg];
    if (theirs === undefined || !Number.isFinite(theirs)) continue;
    const scale = Math.max(Math.abs(ours[egg]), Math.abs(theirs), 1);
    if (Math.abs(ours[egg] - theirs) / scale > FUEL_DRIFT_TOLERANCE) {
      drift.push({ egg, ours: ours[egg], theirs });
    }
  }
  return drift;
}

/**
 * Every Humility visit in a plan, in plan order. A visit is a maximal run of actions whose snapshot
 * says Humility, keyed on the first of them — the same rule the artifact explorer slices by, so the
 * id it writes into a solved visit is an id that appears here.
 *
 * The one place that rule is spelled. Deriving both the ids and the insertion point from the same
 * walk is what makes "this id names a run that is still on Humility" structural rather than a check
 * each caller has to remember: an id that no longer heads a Humility run simply is not in here.
 */
export interface HumilityVisitRun {
  visitId: string;
  /** Index of the run's last action; the launch goes after it. */
  endIndex: number;
}

export function humilityVisitRuns(actions: readonly Action[]): HumilityVisitRun[] {
  const runs: HumilityVisitRun[] = [];
  actions.forEach((action, index) => {
    if (action.endState?.currentEgg !== 'humility') return;
    const current = runs[runs.length - 1];
    if (current && current.endIndex === index - 1) current.endIndex = index;
    else runs.push({ visitId: action.id, endIndex: index });
  });
  return runs;
}

export function humilityVisitIds(actions: readonly Action[]): string[] {
  return humilityVisitRuns(actions).map(run => run.visitId);
}

/**
 * Which of a file's visits this plan can still take, and the only check there is: does the visit
 * still exist here. Resolved as a prefix — the walk stops at the first visit the plan has lost,
 * and every later one is withheld even if its own id survived. A file's visits are a sequence of
 * answers to one cycle; once the plan no longer contains one of them, the plan the rest were
 * solved against is not this plan any more, and staging them would be staging into a shape that
 * changed underneath.
 *
 * Nothing else is compared. Budgets, tank contents and timings all move as a plan is edited, and
 * an answer that has merely gone slightly stale is still worth having; only a vanished visit makes
 * one meaningless.
 */
export function stageableVisitIds(file: HumilityPlanFile, planVisitIds: readonly string[]): Set<string> {
  const inPlan = new Set(planVisitIds);
  const stageable = new Set<string>();
  for (const visit of file.visits) {
    if (!inPlan.has(visit.visitId)) break;
    stageable.add(visit.visitId);
  }
  return stageable;
}

/**
 * Where a visit's launch goes: the end of that visit's run of actions, not its start. The player's
 * own actions inside the visit — fuel stored, research bought — come first, and the fuel and bank
 * this app derives are read from the snapshot at the insertion point, so the later position is the
 * more accurate one. Null when the plan no longer contains the visit — including when a shift
 * retargeted to another egg leaves the id in place while the visit it named is gone.
 */
export function humilityVisitInsertIndex(actions: readonly Action[], visitId: string): number | null {
  const run = humilityVisitRuns(actions).find(r => r.visitId === visitId);
  return run ? run.endIndex + 1 : null;
}

export interface FuelShortfall {
  egg: VirtueEgg;
  amount: number;
}

/**
 * What has to be stored before the launch, given what the tank already holds where the launch is
 * going. Only the eggs that fall short: the tank is not topped up to the requirement, it is
 * brought up to it.
 */
export function fuelShortfalls(
  required: Record<VirtueEgg, number>,
  inTank: Partial<Record<VirtueEgg, number>>
): FuelShortfall[] {
  const shortfalls: FuelShortfall[] = [];
  for (const egg of VIRTUE_EGGS) {
    const missing = required[egg] - (inTank[egg] ?? 0);
    if (missing > 0) shortfalls.push({ egg, amount: missing });
  }
  return shortfalls;
}

/**
 * How long the launch occupies the plan, scheduled by this app rather than copied from the file:
 * the makespan depends on the FTL level, which lives in this plan's initial state and can have
 * been edited since the file was written.
 */
export function launchSchedule(launches: readonly ResolvedLaunch[], ftlLevel: number): ScheduleResult {
  return scheduleMissions(launchEntries(launches, ftlLevel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, field: string, maximum = Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new HumilityPlanError(`Invalid ${field}: expected a finite number between 0 and ${maximum}.`);
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HumilityPlanError(`Invalid ${field}: expected a nonempty string.`);
  }
}

export function parseHumilityPlan(json: unknown): HumilityPlanFile {
  if (!isRecord(json)) {
    throw new HumilityPlanError('Not a Humility plan: expected a JSON object.');
  }
  const file = json;
  if (file.schema !== HUMILITY_PLAN_SCHEMA) {
    throw new HumilityPlanError(
      'That is not a Humility plan file. Export one from the artifact explorer’s mission optimizer.'
    );
  }
  if (file.schemaVersion !== HUMILITY_PLAN_SCHEMA_VERSION) {
    throw new HumilityPlanError(
      `This file is schema version ${file.schemaVersion}; this planner reads version ` +
        `${HUMILITY_PLAN_SCHEMA_VERSION}. Update one side or re-export from a matching build.`
    );
  }
  if (!Array.isArray(file.visits) || file.visits.length === 0) {
    throw new HumilityPlanError('That Humility plan has no solved visits in it.');
  }
  if (file.source !== 'artifact-explorer') throw new HumilityPlanError('Unknown Humility plan source.');
  requireString(file.planLabel, 'plan label');
  requireNumber(file.generatedAt, 'generation timestamp');
  const ids = new Set<string>();
  const indices = new Set<number>();
  for (const visit of file.visits) {
    if (!isRecord(visit)) throw new HumilityPlanError('Invalid Humility visit.');
    requireString(visit.visitId, 'visit id');
    requireString(visit.label, 'visit label');
    requireNumber(visit.visitIndex, 'visit index', Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(visit.visitIndex)) throw new HumilityPlanError('Visit index must be an integer.');
    if (ids.has(visit.visitId) || indices.has(visit.visitIndex)) {
      throw new HumilityPlanError('Duplicate Humility visit id or index.');
    }
    ids.add(visit.visitId);
    indices.add(visit.visitIndex);
    requireNumber(visit.jointProbability, 'joint probability', 1);
    for (const field of ['makespanSeconds', 'gemCost', 'gemBudget']) requireNumber(visit[field], field);
    if (!isRecord(visit.fuelRequired)) throw new HumilityPlanError('Visit has no fuel requirements.');
    for (const [egg, amount] of Object.entries(visit.fuelRequired)) {
      if (!VIRTUE_EGGS.includes(egg as VirtueEgg)) throw new HumilityPlanError(`Unknown fuel egg "${egg}".`);
      requireNumber(amount, `${egg} fuel`);
    }
    resolveLaunches(visit as unknown as HumilityPlanVisit);
  }
  return file as unknown as HumilityPlanFile;
}
