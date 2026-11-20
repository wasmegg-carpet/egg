import { ei, MissionType } from '../index';

type integer = number;
export type { integer };

// Which capacity a launch flies at, during a 2x mission capacity event: the event doubles the capacity of any
// mission that *launches* inside its window, whenever it lands.
//   normal   1x, and nothing constrains when it goes up.
//   event    2x, and the solver bounds a slot's total `event` seconds by the window, so each starts inside it.
//   overhang 2x, at most one per slot: the launch that goes up after the slot's `event` launches, still inside
//            the window. It spends no window seconds, because nothing doubled follows it.
// The split between the last two exists only to make "launches inside the window" linear; see `solver/SPEC.md`
// section 11.
export type CapacityVariant = 'normal' | 'event' | 'overhang';

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
  // Sleep windows this launch flies through; absent or 0 is a daytime launch. Set only alongside
  // `PlanProblem.nightsPerSlot` (by `sleepVariants` in `sleep.ts`, and by the arena's own copy), in which
  // case `actualTime` counts waking seconds. The solver budgets it per slot (`solver/SPEC.md` section 9).
  nights?: number;
  // Present only on a variant flown at the plan's start while the player is in the night (a wake offset past the
  // waking window): the option's whole charge, `max(rawTime, launch period)`, from T+0. Such a launch goes up at
  // T+0 and nowhere else; `actualTime` and `nights` are then the waking seconds and whole nights it holds after
  // the first wake-up (`startVariants` in `sleep.ts`, and the arena's own copy; `solver/SPEC.md` section 17).
  atStartSeconds?: number;
  // Absent is `normal`. Set only alongside `PlanProblem.eventWindowSeconds` (by `capacityVariants` in
  // `capacity.ts`, and by the arena's own copy), in which case the doubled variants carry twice the drops.
  variant?: CapacityVariant;
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
  // Sleep windows the solver budgeted each of these launches for: the night count of the variant it chose. Absent
  // on a plan made without a sleep window. What a launch actually flies through depends on when the calendar
  // sends it up, and is `SlotLaunch.nights`; the views read that.
  nights?: number;
  // The capacity these launches fly at. Absent on a plan made without an event window; on one made with it,
  // `event` and `overhang` are doubled launches (the same mission can appear once per variant) and `normal` is not.
  variant?: CapacityVariant;
  // Present when these launches go up at T+0 in the night (`LaunchOption.atStartSeconds`): the seconds from T+0
  // each holds its slot at least.
  atStartSeconds?: number;
  target: string;
  targetAfxId: ei.ArtifactSpec.Name;
  // total count of single-ship missions of this type across all three slots
  numShipsLaunched: integer;
  supplyVector: Map<string, number>;
  legendarySupplyVector: Map<string, number>;
}

// One launch on a slot's timeline, as the solver's verified calendar placed it. It names its `choiceHistory` entry
// by index rather than carrying the ship, so the timeline costs the worker boundary two numbers a launch and
// cannot disagree with the totals about what was flown, its capacity included: the solver's verifier holds a
// doubled launch to a doubled variant and a 1x launch to a `normal` one.
export interface SlotLaunch {
  // Index into `OptimizerSolution.choiceHistory`.
  choice: integer;
  // Seconds from the start of the plan (wake-up on day 0 with a sleep window, or `wakeOffsetSeconds` after it).
  launchAt: number;
  // On a sleep-aware plan, the sleep windows this ship is in the air for, read off its launch time and flight
  // (`nightsFlown` in `optimizer-core.ts`): what the timeline and the totals show. It can differ from the entry's
  // `nights`, the variant the solver budgeted it as. Absent on a plan made around the clock.
  nights?: number;
}

// The three slots run concurrently, so the plan's wall-clock is the busiest
// slot's load. `loadSeconds` is read off the verified calendar: the moment the slot's last launch is back and,
// on a sleep-aware plan, the player is awake to collect it, nights and idle hours included.
export interface SlotSummary {
  loadSeconds: number;
  rawLoadSeconds: number;
  // The slot's launches in launch order.
  launches: SlotLaunch[];
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
  // Makespan: the busiest slot's floored load. With a sleep window, wall-clock seconds from the plan's start (its
  // first wake-up, unless `wakeOffsetSeconds` says otherwise) to the end of the last-finishing slot's calendar, so
  // it counts the nights too.
  timeUnitsUsed: integer;
  runningTimeSeconds: integer; // the busiest slot's real (raw) flight time
  // The sleep window the plan was laid out around, in seconds a day. Absent when it was planned around the
  // clock, which is also what tells the card and the export that `choiceHistory` carries no `nights`.
  sleepSeconds?: number;
  // How long the player had been awake when the plan starts, in seconds: wake-ups fall at `k * 86400 -
  // wakeOffsetSeconds` on the plan's clock, so day `k` of the plan runs from there (the first day is the rest of
  // the waking day the player is in). Absent when the plan starts at wake-up, as it always did, and on a plan made
  // around the clock. Set only alongside `sleepSeconds`.
  wakeOffsetSeconds?: number;
  // The 2x capacity event window the plan was solved against, in seconds from the start of the plan. Absent when
  // there was none, which is also what tells the card and the export that `choiceHistory` carries no `variant`.
  // Carried on the solution rather than read back off the settings, which stay editable after a solve.
  eventWindowSeconds?: number;
  // Eggs a second the fueling pad moved, which the plan's launch times were spaced by (`solver/SPEC.md` section 18).
  // Absent when the plan was solved with instant fueling.
  fuelingRate?: number;
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
