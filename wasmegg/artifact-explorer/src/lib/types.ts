import { ei, MissionType } from 'lib';

// documents intent only, not enforced
type integer = number;
export type { integer };

// Which capacity a launch flies at, and what constrains when it may go up. Egg, Inc.'s 2x mission capacity
// event doubles the capacity of any mission that *launches* inside the window; return time is irrelevant.
//   normal   1x. Always available, unconstrained in time.
//   event    2x, and must finish launching inside the window — the solver bounds a slot's total `event`
//            duration by the seconds of window remaining, so every one of them starts inside it.
//   overhang 2x, at most one per slot: the launch that starts at the window boundary. It consumes no window
//            budget because nothing follows it inside the window.
export type CapacityVariant = 'normal' | 'event' | 'overhang';

export interface LaunchOption {
  id: string;
  ship: MissionType;
  variant: CapacityVariant;
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
  // subset of supplyVector restricted to recipe ingredients; this is what
  // the optimizer feeds the inner LP
  yieldVector: Map<string, number>;
  legendaryYieldVector: Map<string, number>;
}

export interface DAGChildRef {
  nodeId: string;
  quantity: integer;
}

export interface DAGNode {
  id: string;
  isLeaf: boolean; // raw drop only, not craftable
  children: DAGChildRef[];
  legendaryCraftProbability: number; // non-zero only on the targeted root
}

export type RecipeDAG = Map<string, DAGNode>;

// A cap on what the plan's crafts may cost in golden eggs. `unitPrices` is a *linear* price per craft, which
// the real curve is not, so the row is an upper bound on the true bill: a plan that satisfies it is always
// affordable, while a plan leaning hard on one node may be rejected despite fitting. See OPTIMIZER.md.
export interface CraftBudget {
  capacity: number; // golden eggs
  unitPrices: ReadonlyMap<string, number>; // per craft, by node id
}

export interface LaunchSolution {
  ship: MissionType;
  variant: CapacityVariant;
  actualFuel: number;
  actualFuelByEgg: Map<ei.Egg, number>;
  actualTime: number;
  target: string;
  targetAfxId: ei.ArtifactSpec.Name;
  // count of single-ship missions of this type: a run within one slot in `SlotSummary.runs`,
  // a plan-wide total in the merged view `launchTotals` derives
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
  // This slot's launch order, flown front to back from offset 0. Doubled runs come first, so the
  // boundary between them and the rest is where the event window closes; below it the order is free.
  runs: LaunchSolution[];
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
  // One entry per mission slot, always.
  slots: SlotSummary[];
  // The window this plan was solved against, in seconds; 0 when no event was in play. Carried on the
  // solution rather than read back off the filters, which stay editable after a solve.
  eventWindowSeconds: number;
  expectedDrops: DropRow[];
  finalYieldVector: Map<string, number>;
  // owned-inventory head start already baked into finalYieldVector
  baseYield: Map<string, number>;
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
