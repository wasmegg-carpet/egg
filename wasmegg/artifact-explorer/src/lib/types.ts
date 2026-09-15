import { ei, MissionType } from 'lib';

type integer = number;
export type { integer };

export interface LaunchOption {
  id: string;
  ship: MissionType;
  target: string | null;
  targetAfxId: ei.ArtifactSpec.Name; // UNKNOWN when untargeted
  actualFuel: number;
  fuelByEgg: Map<ei.Egg, number>;
  // effective duration for budgeting: rawTime floored up to the effort
  // level's launch period
  actualTime: number;
  rawTime: number; // true (unfloored) boosted duration
  cost: number;
  // everything this launch drops, per single ship — display only
  supplyVector: Map<string, number>;
  // subset of supplyVector restricted to recipe ingredients; this is what stocks
  // the craft-conservation rows in `solver/model.ts`
  yieldVector: Map<string, number>;
  legendaryYieldVector: Map<string, number>;
}

export interface DAGChildRef {
  nodeId: string;
  qty: integer;
}

export interface DAGNode {
  id: string;
  isLeaf: boolean; // raw drop only, not craftable
  children: DAGChildRef[];
  legendaryCraftProbability: number; // non-zero only on the targeted root
}

export type RecipeDAG = Map<string, DAGNode>;

// A cap on what the plan's crafts may cost in golden eggs. `unitPrices` is linear, not the real curve;
// see `computeCraftUnitPrices` in optimizer-cost.ts for what that costs the bound.
export interface CraftBudget {
  capacity: number; // golden eggs
  unitPrices: ReadonlyMap<string, number>; // per craft, by node id
}

export interface LaunchSolution {
  ship: MissionType;
  actualFuel: number;
  actualFuelByEgg: Map<ei.Egg, number>;
  actualTime: number;
  target: string;
  targetAfxId: ei.ArtifactSpec.Name;
  // total count of single-ship missions of this type across all three slots
  numShipsLaunched: integer;
  supplyVector: Map<string, number>;
  legendarySupplyVector: Map<string, number>;
}

// The three slots run concurrently, so the plan's wall-clock is the busiest
// slot's load.
export interface SlotSummary {
  loadSeconds: number;
  rawLoadSeconds: number;
  missionCount: integer;
}

export interface DropRow {
  itemId: string;
  name: string;
  iconUrl: string;
  expected: number;
  relevant: boolean;
}

export interface TargetProbability {
  nodeId: string;
  bestProbability: number;
  craftProbability: number;
  dropProbability: number;
  expectedCrafts: number;
}

export interface OptimizerSolution {
  // these scalar fields describe the primary target only; multi-target
  // consumers must read perTarget
  bestProbability: number;
  craftProbability: number;
  dropProbability: number;
  expectedCrafts: number;
  fuelUsed: number;
  fuelByEgg: Map<ei.Egg, number>;
  timeUnitsUsed: integer; // makespan: the busiest slot's floored load
  runningTimeSeconds: integer; // the busiest slot's real (raw) flight time
  slots?: SlotSummary[];
  choiceHistory: LaunchSolution[];
  expectedDrops: DropRow[];
  supplyByItem: Map<string, number>;
  // owned-inventory head start already baked into supplyByItem
  ownedStock: Map<string, number>;
  recipeDag: RecipeDAG;
  craftPrimal: Map<string, number>;
  perTarget: TargetProbability[]; // perTarget[0] mirrors the scalar fields
  // P(a legendary of EVERY selected target): the product over perTarget.
  jointProbability: number;
}

export interface OptimizerConfig {
  desiredArtifactNodeIds: string[];
  includeNotEnoughData: boolean;
  fuelTankCapacity: integer;
  timeBudgetSeconds: number;
}
