// The seam between the ascension-planner (AP) and this app. Two file formats meet here: AP's
// plan save, which this app reads and never writes, and `humility-plan.json`, which this app
// writes and AP reads. No runtime is shared across it, so every shape either side relies on is
// restated here and validated on the way in.
//
// Ships and durations cross as enum *names*. AP keeps its own `DurationType`
// (SHORT = 1, LONG = 2, EPIC = 3) while the protobuf this app uses numbers them from zero, so
// AP's `EPIC` is the protobuf's `TUTORIAL`. Raw integers would produce a plan that is silently
// wrong and no type checker would catch it. Targets go the other way and cross as the numeric
// `ei.ArtifactSpec.Name`, which comes from the shared protobuf and has no AP-side copy to drift
// from; AP re-derives the display name through lib.

import { ei } from 'lib';

export const HUMILITY_PLAN_SCHEMA = 'eggverse.humility-plan';
export const HUMILITY_PLAN_SCHEMA_VERSION = 1;

// The only version of AP's plan save this reader understands.
export const SUPPORTED_PLAN_SAVE_VERSION = 1;

export type VirtueEgg = 'curiosity' | 'integrity' | 'humility' | 'resilience' | 'kindness';

// Humility is absent on purpose: `phases.ts` strips it from every mission's fuel cost, so a
// budget for it would constrain nothing. AP puts it back from its own table on import.
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
// `humility-plan.json`, this app's output
// ---------------------------------------------------------------------------

export interface HumilityPlanTarget {
  nodeId: string;
  targetAfxId: ei.ArtifactSpec.Name;
  probability: number;
  expectedCrafts: number;
}

// One launch line. Aggregated on (ship, duration, targetAfxId): targeting is a first-class axis
// of the optimizer's model, so a `{ship, duration, count}` triple cannot express its answer.
export interface HumilityPlanLaunch {
  ship: string; // ei.MissionInfo.Spaceship name
  duration: string; // ei.MissionInfo.DurationType name
  targetAfxId: ei.ArtifactSpec.Name;
  count: number;
}

export interface HumilityPlanVisit {
  // The id of the AP action that entered Humility, and the join key on import. For a plan that
  // starts on Humility, the `start_ascension` id.
  visitId: string;
  visitIndex: number;
  label: string;

  targets: HumilityPlanTarget[];
  // THIS VISIT ONLY. Not cycle-wide: one legendary of a target satisfies the whole cycle, so the
  // product over visits would overstate the result.
  jointProbability: number;

  launches: HumilityPlanLaunch[];

  makespanSeconds: number;
  rawMakespanSeconds: number;
  // No humility key — the importer re-derives all five figures from AP's own table and treats
  // these four as a cross-check.
  fuelRequired: Partial<Record<VirtueEgg, number>>;
  gemCost: number;
  gemBudget: number;
  effort: string;
}

export interface HumilityPlanFile {
  schema: typeof HUMILITY_PLAN_SCHEMA;
  schemaVersion: number;
  source: 'artifact-explorer';
  generatedAt: number;
  planLabel: string;
  visits: HumilityPlanVisit[];
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
