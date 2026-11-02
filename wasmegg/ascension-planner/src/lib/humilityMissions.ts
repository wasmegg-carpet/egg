// Reads the artifact explorer's humility missions files. Ships and durations cross as enum names;
// target ids use the shared protobuf enum. Fuel is derived from this app's tables.

import { ei } from 'lib';

import type { Action, VirtueEgg } from '@/types';
import { VIRTUE_EGGS } from '@/types';
import { Spaceship, DurationType, VIRTUE_FUEL_REQUIREMENTS, missionName } from '@/lib/missions';
import { type Launch, launchEntries } from '@/lib/rockets/launches';
import { scheduleMissions, type ScheduleResult } from '@/lib/rockets/scheduler';

// The id predates the humility missions rename and is kept so existing exported files keep parsing.
export const HUMILITY_MISSIONS_SCHEMA = 'eggverse.humility-plan';
export const HUMILITY_MISSIONS_SCHEMA_VERSION = 1;

export interface HumilityMissionsLaunch {
  ship: string;
  duration: string;
  targetAfxId: number;
  count: number;
}

export interface HumilityMissionsVisit {
  visitId: string;
  visitIndex: number;
  label: string;
  jointProbability: number;
  launches: HumilityMissionsLaunch[];
  makespanSeconds: number;
  fuelRequired: Partial<Record<VirtueEgg, number>>;
  gemCost: number;
  gemBudget: number;
}

export interface HumilityMissionsFile {
  schema: string;
  schemaVersion: number;
  source: string;
  generatedAt: number;
  planLabel: string;
  visits: HumilityMissionsVisit[];
}

export class HumilityMissionsError extends Error {}

/** Look up protobuf ship names. */
function shipByName(name: string): Spaceship | undefined {
  const ship = (Spaceship as unknown as Record<string, number | undefined>)[name];
  return typeof ship === 'number' ? (ship as Spaceship) : undefined;
}

function shipFromName(name: unknown): Spaceship {
  if (typeof name !== 'string') throw new HumilityMissionsError(`Launch has no ship name.`);
  const ship = shipByName(name);
  if (ship === undefined) throw new HumilityMissionsError(`Unknown ship "${name}".`);
  return ship;
}

/** Map durations by name: our EPIC = 3 collides with protobuf TUTORIAL. */
const DURATION_BY_NAME: Record<string, DurationType> = {
  SHORT: DurationType.SHORT,
  LONG: DurationType.LONG,
  EPIC: DurationType.EPIC,
};

function durationFromName(name: unknown): DurationType {
  if (typeof name !== 'string') throw new HumilityMissionsError(`Launch has no duration name.`);
  const duration = DURATION_BY_NAME[name];
  if (typeof duration !== 'number') throw new HumilityMissionsError(`Unsupported mission duration "${name}".`);
  return duration;
}

/** Use mission-grid labels; show unknown names until staging validates them. */
export function launchLabel(launch: HumilityMissionsLaunch): string {
  const ship = shipByName(launch.ship);
  const duration = DURATION_BY_NAME[launch.duration];
  if (ship === undefined || duration === undefined) return `${launch.duration} ${launch.ship}`;
  return missionName(ship, duration);
}

export interface ResolvedLaunch extends Launch {
  targetAfxId: number;
}

export function resolveLaunches(visit: HumilityMissionsVisit): ResolvedLaunch[] {
  if (!Array.isArray(visit.launches)) throw new HumilityMissionsError(`Visit "${visit.label}" has no launches.`);
  return visit.launches.map(launch => {
    if (!isRecord(launch)) throw new HumilityMissionsError(`Visit "${visit.label}" has an invalid launch.`);
    const count = launch.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new HumilityMissionsError(`Visit "${visit.label}" has a launch with a count of ${launch.count}.`);
    }
    const targetAfxId = launch.targetAfxId;
    if (
      typeof targetAfxId !== 'number' ||
      !Number.isInteger(targetAfxId) ||
      ei.ArtifactSpec.Name[targetAfxId] === undefined
    ) {
      throw new HumilityMissionsError(`Visit "${visit.label}" has a launch with an invalid target id.`);
    }
    const ship = shipFromName(launch.ship);
    const duration = durationFromName(launch.duration);
    if (!Array.isArray(VIRTUE_FUEL_REQUIREMENTS[ship]?.[duration])) {
      throw new HumilityMissionsError(`Unsupported mission ${launch.ship} / ${launch.duration}.`);
    }
    return { ship, duration, targetAfxId, count };
  });
}

export interface FuelDrift {
  egg: VirtueEgg;
  ours: number;
  theirs: number;
}

/** Compare the four exported fuel amounts with a 0.1% relative tolerance. */
const FUEL_DRIFT_TOLERANCE = 1e-3;

export function fuelDrift(visit: HumilityMissionsVisit, ours: Record<VirtueEgg, number>): FuelDrift[] {
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
 * Find consecutive Humility action runs, keyed by their first action, as in the explorer.
 * Derive visit IDs and insertion points together so both refer to the same runs.
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
 * Accept the prefix of exported visits still present in the plan. Stop at the first
 * missing visit, even if later IDs survive. Budgets and timings are not checked.
 */
export function stageableVisitIds(file: HumilityMissionsFile, planVisitIds: readonly string[]): Set<string> {
  const inPlan = new Set(planVisitIds);
  const stageable = new Set<string>();
  for (const visit of file.visits) {
    if (!inPlan.has(visit.visitId)) break;
    stageable.add(visit.visitId);
  }
  return stageable;
}

/** False when none of the file's visits are in the plan, e.g. it came from another plan. */
export function fileMatchesPlan(file: HumilityMissionsFile, planVisitIds: readonly string[]): boolean {
  const inPlan = new Set(planVisitIds);
  return file.visits.some(visit => inPlan.has(visit.visitId));
}

/** Insert after the visit's actions so their fuel and research apply; null if missing. */
export function humilityVisitInsertIndex(actions: readonly Action[], visitId: string): number | null {
  const run = humilityVisitRuns(actions).find(r => r.visitId === visitId);
  return run ? run.endIndex + 1 : null;
}

export interface FuelShortfall {
  egg: VirtueEgg;
  amount: number;
}

/** Fuel shortfalls at the insertion point. */
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

/** Recompute makespan using the plan's current FTL level. */
export function launchSchedule(launches: readonly ResolvedLaunch[], ftlLevel: number): ScheduleResult {
  return scheduleMissions(launchEntries(launches, ftlLevel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, field: string, maximum = Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new HumilityMissionsError(`Invalid ${field}: expected a finite number between 0 and ${maximum}.`);
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HumilityMissionsError(`Invalid ${field}: expected a nonempty string.`);
  }
}

export function parseHumilityMissions(json: unknown): HumilityMissionsFile {
  if (!isRecord(json)) {
    throw new HumilityMissionsError('Not a humility missions file: expected a JSON object.');
  }
  const file = json;
  if (file.schema !== HUMILITY_MISSIONS_SCHEMA) {
    throw new HumilityMissionsError(
      "That is not a humility missions file. Export one from the artifact explorer's mission optimizer."
    );
  }
  if (file.schemaVersion !== HUMILITY_MISSIONS_SCHEMA_VERSION) {
    throw new HumilityMissionsError(
      `This file is schema version ${file.schemaVersion}; this planner reads version ` +
        `${HUMILITY_MISSIONS_SCHEMA_VERSION}. Update one side or re-export from a matching build.`
    );
  }
  if (!Array.isArray(file.visits) || file.visits.length === 0) {
    throw new HumilityMissionsError('That humility missions file has no solved visits in it.');
  }
  if (file.source !== 'artifact-explorer') throw new HumilityMissionsError('Unknown humility missions file source.');
  requireString(file.planLabel, 'plan label');
  requireNumber(file.generatedAt, 'generation timestamp');
  const ids = new Set<string>();
  const indices = new Set<number>();
  for (const visit of file.visits) {
    if (!isRecord(visit)) throw new HumilityMissionsError('Invalid Humility visit.');
    requireString(visit.visitId, 'visit id');
    requireString(visit.label, 'visit label');
    requireNumber(visit.visitIndex, 'visit index', Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(visit.visitIndex)) throw new HumilityMissionsError('Visit index must be an integer.');
    if (ids.has(visit.visitId) || indices.has(visit.visitIndex)) {
      throw new HumilityMissionsError('Duplicate Humility visit id or index.');
    }
    ids.add(visit.visitId);
    indices.add(visit.visitIndex);
    requireNumber(visit.jointProbability, 'joint probability', 1);
    for (const field of ['makespanSeconds', 'gemCost', 'gemBudget']) requireNumber(visit[field], field);
    if (!isRecord(visit.fuelRequired)) throw new HumilityMissionsError('Visit has no fuel requirements.');
    for (const [egg, amount] of Object.entries(visit.fuelRequired)) {
      if (!VIRTUE_EGGS.includes(egg as VirtueEgg)) throw new HumilityMissionsError(`Unknown fuel egg "${egg}".`);
      requireNumber(amount, `${egg} fuel`);
    }
    resolveLaunches(visit as unknown as HumilityMissionsVisit);
  }
  return file as unknown as HumilityMissionsFile;
}
