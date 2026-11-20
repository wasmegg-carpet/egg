// File formats exchanged with ascension-planner (AP); no shared runtime.
// Ships and durations use enum names because AP and protobuf duration numbers differ
// (AP EPIC = 3, protobuf EPIC = 2). Targets use the shared numeric ei.ArtifactSpec.Name.

import { ei } from '../../index';

export const HUMILITY_MISSIONS_SCHEMA = 'eggverse.humility-plan';
export const HUMILITY_MISSIONS_SCHEMA_VERSION = 1;

// The only version of AP's plan save this reader understands.
export const SUPPORTED_PLAN_SAVE_VERSION = 1;

export type VirtueEgg = 'curiosity' | 'integrity' | 'humility' | 'resilience' | 'kindness';

// No humility key: `makeLaunchOption` in problem-inputs.ts strips it from every mission's cost.
// AP re-derives it from its own table on import.
export const NON_HUMILITY_EGG_IDS: ReadonlyArray<readonly [VirtueEgg, ei.Egg]> = [
  ['curiosity', ei.Egg.CURIOSITY],
  ['integrity', ei.Egg.INTEGRITY],
  ['resilience', ei.Egg.RESILIENCE],
  ['kindness', ei.Egg.KINDNESS],
];

// ---------------------------------------------------------------------------
// AP's plan save, narrowed to what this app reads
// ---------------------------------------------------------------------------

export interface PlanSaveEndState {
  tankLevel: number;
  fuelTankAmounts: Partial<Record<VirtueEgg, number>>;
  bankValue: number;
  onlineEarnings: number;
  offlineEarnings: number;
  currentEgg: VirtueEgg;
}

export interface PlanSaveAction {
  id: string;
  type: string;
  totalTimeSeconds: number;
  payload?: unknown;
  endState: PlanSaveEndState;
}

export interface PlanSave {
  version: number;
  initialState: {
    epicResearchLevels: Record<string, number>;
  };
  virtueState?: {
    ascensionDate?: string;
    ascensionTime?: string;
    ascensionTimezone?: string;
  };
  actions: PlanSaveAction[];
}

// AP's epic research ids, as they appear in `initialState.epicResearchLevels`.
export const AP_FTL_RESEARCH_ID = 'afx_mission_time';
export const AP_ZEROG_RESEARCH_ID = 'afx_mission_capacity';

// ---------------------------------------------------------------------------
// The humility missions file, this app's output
// ---------------------------------------------------------------------------

export interface HumilityMissionsTarget {
  nodeId: string;
  targetAfxId: ei.ArtifactSpec.Name;
  probability: number;
  expectedCrafts: number;
}

// One launch line. Aggregated on (ship, duration, targetAfxId, doubled): targeting is a first-class axis
// of the optimizer's model, so a `{ship, duration, count}` triple cannot express its answer.
export interface HumilityMissionsLaunch {
  ship: string; // ei.MissionInfo.Spaceship name
  duration: string; // ei.MissionInfo.DurationType name
  targetAfxId: ei.ArtifactSpec.Name;
  count: number;
  // Launched inside a 2x mission capacity event, so each brings home twice the loot. Absent on a 1x line, and so
  // on every line of a file written before the field existed, which still reads as it did: the same mission flown
  // at both capacities is two lines, one with the marker and one without.
  doubled?: true;
}

export interface HumilityMissionsVisit {
  // The id of the AP action that entered Humility, and the join key on import. For a plan that
  // starts on Humility, the `start_ascension` id.
  visitId: string;
  visitIndex: number;
  label: string;

  targets: HumilityMissionsTarget[];
  // For this visit only, not for the cycle: one legendary of a target satisfies the whole cycle,
  // so the product over visits would overstate the result.
  jointProbability: number;

  launches: HumilityMissionsLaunch[];

  // Wall-clock seconds from the first launch until the busiest slot's last ship is back, which is how long
  // AP waits the visit out. On a plan made around a sleep window it is read off the day-by-day calendar and
  // so counts the nights, and the hours a ship that landed overnight waited for the player to wake.
  makespanSeconds: number;
  rawMakespanSeconds: number;
  // No humility key. The importer re-derives all five figures from AP's own table and treats
  // these four as a cross-check.
  fuelRequired: Partial<Record<VirtueEgg, number>>;
  gemCost: number;
  gemBudget: number;
  // The launch cadence the plan was solved at. With `sleepSeconds` present it is the cadence while awake.
  effort: string;
  // Seconds a day the plan leaves launch-free for sleep. Absent on a plan made around the clock, so a file
  // exported without a sleep window is exactly what it was before the field existed. AP does not read it;
  // `launches` already folds daytime and overnight launches of a mission into one line.
  sleepSeconds?: number;
  // How long the player had been awake when the plan starts, in seconds, with `sleepSeconds`. Absent on a plan that
  // starts at wake-up, so such a file is exactly what it was before the field existed. AP does not read it.
  wakeOffsetSeconds?: number;
  // The 2x capacity event window the plan was solved against, in seconds from its start. Absent on a plan made
  // without one, as `sleepSeconds` is. AP does not read it; the launches it doubled carry `doubled`.
  eventWindowSeconds?: number;
  // Eggs a second the fueling pad moved, which spaced the plan's launches (one pad for every slot). Absent on a plan
  // solved with instant fueling, so such a file is exactly what it was before the field existed. AP does not read it.
  fuelingRate?: number;
}

export interface HumilityMissionsFile {
  schema: typeof HUMILITY_MISSIONS_SCHEMA;
  schemaVersion: number;
  source: 'artifact-explorer';
  generatedAt: number;
  planLabel: string;
  visits: HumilityMissionsVisit[];
}

// ---------------------------------------------------------------------------
// Enum names
// ---------------------------------------------------------------------------

export function spaceshipEnumName(ship: ei.MissionInfo.Spaceship): string {
  const name = ei.MissionInfo.Spaceship[ship];
  if (name === undefined) throw new Error(`unknown spaceship ${ship}`);
  return name;
}

export function durationEnumName(duration: ei.MissionInfo.DurationType): string {
  const name = ei.MissionInfo.DurationType[duration];
  if (name === undefined) throw new Error(`unknown duration type ${duration}`);
  return name;
}
