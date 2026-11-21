// Preprocessing for the planner: restricted recipe DAG, normalized budgets,
// filtered and duplicate-merged option groups.

import type { CapacityVariant, LaunchOption, RecipeDAG } from '../types';
import { fuelCostOnAxis, normalizeProblem, padSecondsOf, type FuelAxis, type PlanProblem } from './types';
import { qOf } from '../objective';
import { daySchedule, windowShape, type DaySchedule } from './days';

// Stand-ins for a bound no budget gives; see SPEC.md section 2. `UNBOUNDED_PER_SLOT` is `milp.ts`'s column
// bound and lives here so `boundsFollowFromRows` below can read the same number.
const UNBOUNDED_GROUP = 1e9;
export const UNBOUNDED_PER_SLOT = 1e6;

export interface Group {
  // Normalized: a fraction of each fuel budget, and of one slot's horizon. One
  // entry per `Model.fuelAxes`, in that order.
  fuelFractions: number[];
  timeFraction: number;
  timeSeconds: number;
  // Sleep windows each launch flies through; 0 for a daytime launch and for every launch of a problem
  // without a sleep window. See SPEC.md section 9.
  nights: number;
  // Which capacity it flies at; `normal` for every launch of a problem without an event window. See SPEC.md
  // section 11.
  variant: CapacityVariant;
  // Whether it goes up at T+0 in the night the plan starts in (`LaunchOption.atStartSeconds`, SPEC.md section 17),
  // and then the most any member holds its slot from T+0, its charge (`atStartSeconds`); false and 0 for every other
  // launch.
  atStart: boolean;
  atStartBlock: number;
  // Seconds the fueling pad takes to fuel one launch (`padSecondsOf`, SPEC.md section 18); 0 without a fueling rate.
  // Part of the group key, so every member fuels exactly as long.
  padSeconds: number;
  yieldByItem: number[];
  legendaryByTarget: number[];
  cap: number;
  members: number[]; // original option indices, ascending; output lands on members[0]
  // For a doubled group, the `normal` group a launch of it is flown as when the layout cannot start it inside the
  // window: its own normal twin (the same flight at 1x), or, when dominance pruned the twin, a surviving normal
  // group that dominates the twin. -1 for a normal group, and for a doubled one whose twin is not on the menu at
  // all, which the layout then trims rather than demotes. See SPEC.md section 13.
  twin: number;
  // The group a launch of this one is flown as when it goes up inside the 2x window as an `event` launch, and as
  // the slot's `overhang`, the reverse of `twin` (SPEC.md section 16): for a doubled group, itself in its own
  // variant and the same flight's other doubled group in the other; for a normal group, its own doubled copy or,
  // when that was pruned or never on the menu, the first kept group of that variant that dominates the copy it
  // would have been. -1 where there is neither.
  copy: Record<DoubledVariant, number>;
}

export type DoubledVariant = Exclude<CapacityVariant, 'normal'>;

export interface Model {
  // Sorted by node id; `requestedOrder` maps back to the caller's order.
  sortedTargets: string[];
  requestedOrder: number[];
  craftables: string[];
  items: string[];
  consRows: number[][]; // items x craftables
  // Per craftable, its children; `childCraft` is -1 when the child is not crafted.
  craftChildren: { itemIdx: number; childCraft: number }[][];
  baseInventoryByItem: number[];
  Qs: number[];
  targetCraftIdx: number[]; // craft column per target; -1 when not craftable
  slots: number;
  // The budgets `Group.fuelFractions` is normalized against; only the count is
  // load-bearing downstream, but the axes themselves make a model self-describing.
  fuelAxes: readonly FuelAxis[];
  timeCapacitySeconds: number;
  // Whole sleep windows per slot; 0 when the problem has none, which also drops every option that
  // spends one. The `night_k` rows read it (SPEC.md section 9).
  nightsPerSlot: number;
  // The day the nights are cut from, when the problem carries `sleep`: what the fit rows and the layout read
  // (SPEC.md section 10). Null is today's problem.
  day: DaySchedule | null;
  // Seconds of 2x capacity event left, from the plan's start; 0 when the problem has none, which also drops
  // every doubled option. The verifier reads it (SPEC.md section 11).
  eventWindowSeconds: number;
  // What the window rows hold a slot's `event` launches to: `eventWindowBudget` waking seconds and
  // `eventWindowNights` nights. Without a sleep window the window itself and no night; with one, the waking seconds
  // and the whole nights before the last waking instant at or before its end, `eventWindowLatest`, since no launch
  // goes up asleep (SPEC.md sections 13 and 14). `eventWindowPartial` is the part of that instant's waking window
  // before it, which the window's per-day fit rows read. With a wake offset, `eventWindowLatest` and
  // `eventWindowPartial` are on the regular day from the wake-up at or before the plan's start, as `day` is, and
  // `eventWindowBudget` is the plan's own waking seconds (SPEC.md section 17).
  eventWindowBudget: number;
  eventWindowNights: number;
  eventWindowLatest: number;
  eventWindowPartial: number;
  // With the fueling pad and a sleep window, how early the window rows read the 2x window as closing
  // (`windowPadReserve`, SPEC.md section 18), which the layout works to as well; 0 otherwise.
  eventWindowPadReserve: number;
  // Upper bound per craft column; Infinity where nothing bounds it.
  craftCaps: number[];
  craftPrices: number[];
  craftBudgetCapacity: number;
  // Eggs a second the fueling pad moves (`PlanProblem.fuelingRate`, SPEC.md section 18); 0 without one, when every
  // launch fuels in no time.
  fuelingRate: number;
  groups: Group[];
}

type Entry = [string, number];

interface Candidate {
  fuelFractions: number[];
  timeFraction: number;
  timeSeconds: number;
  nights: number;
  variant: CapacityVariant;
  atStart: boolean;
  atStartBlock: number;
  padSeconds: number;
  yieldEntries: Entry[]; // sorted by item id
  legendaryEntries: Entry[]; // sorted by target id
  cap: number;
  index: number;
}

// A total order on the variants, for the group key; nothing else reads it.
const VARIANT_RANK: Readonly<Record<CapacityVariant, number>> = { normal: 0, event: 1, overhang: 2 };

function cmpEntries(a: Entry[], b: Entry[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i][0] !== b[i][0]) return a[i][0] < b[i][0] ? -1 : 1;
    if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
  }
  return a.length - b.length;
}

// Elementwise, and a total order: two options that cost the same fuel in total but
// draw it from different eggs must not merge into one group.
function cmpFractions(a: number[], b: number[]): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function cmpKey(a: Candidate, b: Candidate): number {
  const fuel = cmpFractions(a.fuelFractions, b.fuelFractions);
  if (fuel !== 0) return fuel;
  if (a.timeFraction !== b.timeFraction) return a.timeFraction - b.timeFraction;
  // A daytime launch and its overnight twin may charge the same waking seconds; they spend different budgets.
  if (a.nights !== b.nights) return a.nights - b.nights;
  // An `event` and an `overhang` copy of one launch are identical in every number above and below: merged, one
  // of the two rows holding the window would lose its column. Without a window every variant is `normal`.
  if (a.variant !== b.variant) return VARIANT_RANK[a.variant] - VARIANT_RANK[b.variant];
  // A launch at T+0 and the same numbers flown later spend different budgets (the start row). Without a night at
  // the start no launch goes up at T+0, and this never decides.
  if (a.atStart !== b.atStart) return a.atStart ? 1 : -1;
  // Two options of equal fuel fractions can still fuel for different lengths, when one draws on an egg no axis
  // budgets. Without a fueling rate every pad time is 0, and this never decides.
  if (a.padSeconds !== b.padSeconds) return a.padSeconds - b.padSeconds;
  return cmpEntries(a.yieldEntries, b.yieldEntries) || cmpEntries(a.legendaryEntries, b.legendaryEntries);
}

function craftUpperBounds(
  dag: RecipeDAG,
  targets: readonly string[],
  craftables: readonly string[],
  craftIndex: ReadonlyMap<string, number>,
  items: readonly string[],
  itemIndex: ReadonlyMap<string, number>,
  baseInventoryByItem: readonly number[],
  groups: readonly Group[]
): number[] {
  const dropped = new Array<number>(items.length);
  for (let i = 0; i < items.length; i++) {
    let total = baseInventoryByItem[i];
    for (const grp of groups) {
      const y = grp.yieldByItem[i];
      if (y > 0) total += y * grp.cap;
    }
    dropped[i] = Number.isFinite(total) ? total : Infinity;
  }

  // Post-order. Reverse first-visit order is NOT enough: with two targets sharing an ingredient, the second
  // is discovered after the shared node and would read a bound that had not been computed yet.
  const caps = new Array<number>(craftables.length).fill(Infinity);
  const seen = new Set<string>();
  const order: number[] = [];
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = dag.get(id);
    if (node) for (const child of node.children) visit(child.nodeId);
    const idx = craftIndex.get(id);
    if (idx !== undefined) order.push(idx);
  };
  for (const t of targets) visit(t);

  for (const idx of order) {
    const node = dag.get(craftables[idx]);
    if (!node || node.children.length === 0) continue;
    let bound = Infinity;
    for (const child of node.children) {
      if (!(child.qty > 0)) continue;
      const itemIdx = itemIndex.get(child.nodeId);
      if (itemIdx === undefined) {
        bound = Infinity;
        break;
      }
      let supply = dropped[itemIdx];
      const producer = craftIndex.get(child.nodeId);
      if (producer !== undefined) supply += caps[producer];
      const limit = supply / child.qty;
      if (limit < bound) bound = limit;
    }
    caps[idx] = Number.isFinite(bound) && bound >= 0 ? bound : Infinity;
  }
  return caps;
}

// The wall-clock seconds one launch holds its slot for: its waking seconds and the nights it flies through; without
// a sleep window, its seconds.
export function blockSeconds(seconds: number, nights: number, day: DaySchedule | null): number {
  return day === null ? seconds : seconds + nights * day.sleepSeconds;
}

// The most `event` launches of `seconds` waking seconds and `nights` nights one slot's window rows admit: by the
// window's waking seconds and by its nights (SPEC.md section 14); `UNBOUNDED_PER_SLOT` when it charges neither.
export function eventLaunches(seconds: number, nights: number, window: { waking: number; nights: number }): number {
  return Math.min(
    seconds > 0 ? maxLaunches(window.waking, seconds) : UNBOUNDED_PER_SLOT,
    nights > 0 ? Math.floor(window.nights / nights) : UNBOUNDED_PER_SLOT
  );
}

// Largest whole number of launches that fits: the count `n` with `n * unitCost <= capacity`. Computed
// from the two quantities rather than from their ratio's reciprocal, which `Math.floor` then drops a
// launch off — a 1-second mission in a 93-second slot gives `1/(1/93) = 93.00000000000001` one way and
// `92.99999999999999` the other. The multiplication is the same arithmetic the row itself is checked in.
export function maxLaunches(capacity: number, unitCost: number): number {
  const n = Math.floor(capacity / unitCost);
  return (n + 1) * unitCost <= capacity ? n + 1 : n;
}

// Whether the rows alone bound this group's columns. They do not when a zero fraction leaves `perSlotCap`
// or `cap` on a stand-in, and a group taking another's launches on is the one thing that can walk a column
// into such a cap. A positive duration whose slot-row bound is under `UNBOUNDED_PER_SLOT` settles it: every other
// term in either minimum is then that bound or smaller. So does a night: the `night_k` row bounds a group that
// spends one by `floor(nightsPerSlot / nights)` per slot, whatever its duration. Without that second clause a
// zero-second overnight launch (a short ship sent at bedtime) would get a private class and could never
// stand in for anything. See SPEC.md section 9. And so does the overhang row, which holds every `overhang` group
// to one launch per slot whatever its duration (SPEC.md section 11).
export function boundsFollowFromRows(grp: Group, timeCapacitySeconds: number, nightsPerSlot: number): boolean {
  if (grp.timeSeconds > 0 && maxLaunches(timeCapacitySeconds, grp.timeSeconds) <= UNBOUNDED_PER_SLOT) return true;
  if (grp.variant === 'overhang') return true;
  // The start row holds a launch at T+0 to one a slot (SPEC.md section 17).
  if (grp.atStart) return true;
  return (
    grp.nights > 0 && Number.isFinite(nightsPerSlot) && Math.floor(nightsPerSlot / grp.nights) <= UNBOUNDED_PER_SLOT
  );
}

// `taker` dominates `given` when every launch of `given` could have been flown as a `taker` in the same
// slot: no more fuel, no more seconds, and at least as much of every item the conservation rows read and
// of every target's legendary drops. Compared exactly rather than to a tolerance, which is what keeps the
// relation transitive. See SPEC.md section 1.
function dominates(taker: Group, given: Group): boolean {
  // Only within a variant. A doubled copy costs exactly what its normal twin does and yields twice as much, so
  // across variants it would prune the twin, though the window rows cap how often it may fly. SPEC.md section 11.
  if (taker.variant !== given.variant) return false;
  // Nor across T+0 and later: a T+0 launch spends the start row, and is timed from T+0 (SPEC.md section 17).
  if (taker.atStart !== given.atStart) return false;
  if (taker.timeSeconds > given.timeSeconds) return false;
  // Nights are a budget of their own: without this an overnight variant, which charges fewer waking seconds,
  // would prune its own daytime twin.
  if (taker.nights > given.nights) return false;
  // Nor one that fuels longer on the pad, which every launch of the plan queues for (SPEC.md section 18). Without a
  // fueling rate both are 0.
  if (taker.padSeconds > given.padSeconds) return false;
  let strict =
    taker.timeSeconds < given.timeSeconds || taker.nights < given.nights || taker.padSeconds < given.padSeconds;
  // Every axis, not the total: drawing less of one egg does not excuse drawing more of another, or a
  // pruned group's launches would land on a dominator the player cannot fuel.
  for (let a = 0; a < taker.fuelFractions.length; a++) {
    if (taker.fuelFractions[a] > given.fuelFractions[a]) return false;
    if (taker.fuelFractions[a] < given.fuelFractions[a]) strict = true;
  }
  for (let i = 0; i < taker.yieldByItem.length; i++) {
    if (taker.yieldByItem[i] < given.yieldByItem[i]) return false;
    if (taker.yieldByItem[i] > given.yieldByItem[i]) strict = true;
  }
  for (let t = 0; t < taker.legendaryByTarget.length; t++) {
    if (taker.legendaryByTarget[t] < given.legendaryByTarget[t]) return false;
    if (taker.legendaryByTarget[t] > given.legendaryByTarget[t]) strict = true;
  }
  return strict;
}

// Requiring strictness makes `dominates` a strict partial order, so every dropped group has a dominator
// that itself survives, and testing each group against the whole menu, dropped ones included, leaves the
// survivors a function of the group set rather than of the order it was walked in.
function pruneDominated(groups: readonly Group[], timeCapacitySeconds: number, nightsPerSlot: number): Group[] {
  return groups.filter(
    given =>
      !groups.some(
        taker =>
          taker !== given && boundsFollowFromRows(taker, timeCapacitySeconds, nightsPerSlot) && dominates(taker, given)
      )
  );
}

// Whether `normal` is the same flight as the doubled group `doubled` at 1x: the same fuel, seconds and nights, and
// exactly half of every drop. Doubling is exact in floating point, so this is an equality test, as the group key is.
function isTwin(normal: Group, doubled: Group): boolean {
  return normal.variant === 'normal' && sameFlight(normal, doubled, 2);
}

// Whether `b` flies what `a` does, with every drop `factor` times as large: the same fuel, seconds and nights.
function sameFlight(a: Group, b: Group, factor: number): boolean {
  const same = (x: readonly number[], y: readonly number[], f: number) =>
    x.length === y.length && x.every((v, i) => v * f === y[i]);
  return (
    a.timeSeconds === b.timeSeconds &&
    a.nights === b.nights &&
    a.atStart === b.atStart &&
    a.padSeconds === b.padSeconds &&
    same(a.fuelFractions, b.fuelFractions, 1) &&
    same(a.yieldByItem, b.yieldByItem, factor) &&
    same(a.legendaryByTarget, b.legendaryByTarget, factor)
  );
}

// Sets `twin` on every kept doubled group, as an index into `kept`. The twin is looked for among every group,
// pruned ones included: when dominance dropped it, the first kept group (in group order) that dominates it
// stands in, which flies in the same launch slot in no more seconds, nights or fuel and yields at least as much,
// and one always survives, since the relation is a strict partial order (SPEC.md section 1). Only within the
// normal variant, as dominance itself is. No menu from `capacityVariants` reaches the stand-in (a pruned twin's
// doubled copies are pruned with it); it is kept because the solver takes any menu, and a hand-built one in
// `window-sleep.spec.ts` does reach it (SPEC.md section 13).
// Sets `copy` on every kept group (SPEC.md section 16). A doubled group's copies are exact: the same flight in the
// other doubled variant, or nothing, since relabelling a doubled launch changes no yield. A normal group's are its own
// doubled copies when they were kept; otherwise the first kept group of that variant, in group order, that dominates
// the copy it would have had, which flies in the same launch slot in no more seconds, nights or fuel on any axis and
// yields at least as much. Unlike a twin's stand-in it need not bound its own columns: it is chosen after the MILP.
function linkCopies(kept: Group[]): void {
  kept.forEach(grp => {
    for (const variant of ['event', 'overhang'] as const) {
      if (grp.variant === variant) {
        grp.copy[variant] = kept.indexOf(grp);
        continue;
      }
      const factor = grp.variant === 'normal' ? 2 : 1;
      const own = kept.findIndex(other => other.variant === variant && sameFlight(grp, other, factor));
      if (own >= 0 || grp.variant !== 'normal') {
        grp.copy[variant] = own;
        continue;
      }
      const wouldBe: Group = {
        ...grp,
        variant,
        yieldByItem: grp.yieldByItem.map(y => 2 * y),
        legendaryByTarget: grp.legendaryByTarget.map(y => 2 * y),
      };
      grp.copy[variant] = kept.findIndex(other => other.variant === variant && dominates(other, wouldBe));
    }
  });
}

function linkTwins(all: readonly Group[], kept: Group[], timeCapacitySeconds: number, nightsPerSlot: number): void {
  const index = new Map(kept.map((grp, g) => [grp, g]));
  for (const grp of kept) {
    if (grp.variant === 'normal') continue;
    const twin = all.find(other => isTwin(other, grp));
    if (twin === undefined) continue;
    const standIn =
      index.get(twin) ??
      kept.findIndex(
        taker =>
          taker.variant === 'normal' &&
          boundsFollowFromRows(taker, timeCapacitySeconds, nightsPerSlot) &&
          dominates(taker, twin)
      );
    grp.twin = standIn ?? -1;
  }
}

// The shortest fuelling of any doubled option, under a quarter of the window: how long before the 2x window's close
// the second of two launches meeting at one instant goes up at the soonest (SPEC.md section 18). Fuellings too short
// to count (`PAD_LEVEL_FLOOR` in `milp.ts`'s terms) are passed over, and none leaves no reserve.
function windowPadReserve(options: readonly LaunchOption[], rate: number, window: number): number {
  let least = Infinity;
  for (const opt of options) {
    const pad = padSecondsOf(opt, rate);
    if ((opt.variant ?? 'normal') !== 'normal' && pad >= 2 ** -10 && pad < least) least = pad;
  }
  return Number.isFinite(least) ? Math.min(least, window / 4) : 0;
}

export function buildModel(raw: PlanProblem): Model {
  // The same boundary `optimizeFull` enters through, and idempotent, so entering it twice costs a copy
  // and nothing else. Everything below may assume budgets are finite and target ids unique.
  const problem = normalizeProblem(raw);
  const dag: RecipeDAG = problem.dag;

  // Sorted so the model is a function of the target *set*: the closure below visits targets in order, so
  // permuting the caller's list permutes every row and column and a node-limited search then diverges.
  // `requestedOrder` is a bijection back onto the caller's list, which the deduplication above is what
  // makes possible.
  const requested = [...problem.targets];
  const requestedOrder = requested.map((_, i) => i).sort((a, b) => (requested[a] < requested[b] ? -1 : 1));
  const targets = requestedOrder.map(i => requested[i]);

  const orderIds: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    orderIds.push(id);
    const node = dag.get(id);
    if (!node) return;
    for (const child of node.children) visit(child.nodeId);
  };
  for (const t of targets) visit(t);

  const craftables: string[] = [];
  for (const id of orderIds) {
    const node = dag.get(id);
    if (node && !node.isLeaf) craftables.push(id);
  }
  const craftIndex = new Map(craftables.map((id, i) => [id, i]));

  const items: string[] = [];
  const itemIndex = new Map<string, number>();
  for (const id of craftables) {
    for (const child of dag.get(id)!.children) {
      if (!itemIndex.has(child.nodeId)) {
        itemIndex.set(child.nodeId, items.length);
        items.push(child.nodeId);
      }
    }
  }

  const consRows = items.map(() => new Array<number>(craftables.length).fill(0));
  for (const id of craftables) {
    const j = craftIndex.get(id)!;
    for (const child of dag.get(id)!.children) {
      consRows[itemIndex.get(child.nodeId)!][j] += child.qty;
    }
  }
  for (const [item, i] of itemIndex) {
    const producer = craftIndex.get(item);
    if (producer !== undefined) consRows[i][producer] -= 1;
  }

  const craftChildren = craftables.map(id =>
    dag
      .get(id)!
      .children.filter(child => child.qty > 0)
      .map(child => ({
        itemIdx: itemIndex.get(child.nodeId)!,
        childCraft: craftIndex.get(child.nodeId) ?? -1,
      }))
  );

  const baseInventoryByItem = items.map(item => {
    const quantity = problem.ownedStock.get(item) ?? 0;
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
  });
  const Qs = targets.map(t => qOf(dag.get(t)?.legendaryCraftProbability ?? 0));
  const targetCraftIdx = targets.map(t => craftIndex.get(t) ?? -1);

  // A negative or non-finite price is dropped: it would be a craft that *earns*
  // budget, on a continuous column nothing else bounds.
  const budget = problem.craftBudget;
  const craftPrices = craftables.map(id => {
    const price = budget?.unitPrices.get(id) ?? 0;
    return Number.isFinite(price) && price > 0 ? price : 0;
  });
  const capped = budget !== undefined && Number.isFinite(budget.capacity) && budget.capacity >= 0;
  const craftBudgetCapacity = capped && craftPrices.some(p => p > 0) ? budget!.capacity : Infinity;

  // Normalized budgets: every fuel axis 1, per-slot time 1. An axis the player has nothing on
  // affords nothing: a positive cost against it is unaffordable at any count, so the option falls
  // out on `cap < 1` below, exactly as `timeFraction` already handles a zero time budget.
  const axes = problem.fuelAxes;
  const timeCap = problem.timeCapacityPerSlot;
  // Absent is 0: a problem with no sleep window has no night to spend (SPEC.md section 9).
  const nightsCap = problem.nightsPerSlot ?? 0;
  // Absent is 0: no window, so nothing may fly doubled (SPEC.md section 11).
  const window = problem.eventWindowSeconds ?? 0;
  const slots = problem.slots;
  // Absent is 0: every launch fuels in no time (SPEC.md section 18).
  const fuelingRate = problem.fuelingRate ?? 0;
  const day = problem.sleep ? daySchedule(problem.sleep, timeCap, nightsCap) : null;
  // Without a sleep window, the window itself and no night (SPEC.md section 11); with one, what lies before its last
  // waking instant (sections 13 and 14), on the regular day when the plan starts after wake-up (section 17). Starting
  // in the night, the regular day starts at the next wake-up, `firstNight` in: what is left of the window after it,
  // and when it closes before then, nothing but the launches at T+0 goes up inside it.
  // With the fueling pad as well, the window rows read it as closing `padReserve` early (SPEC.md section 18): the
  // shortest fuelling any doubled option has. A window closing at a wake-up, as a 48-hour one does from a wake-up, has
  // every slot's doubled launch that waited out the night go up at that one instant, and the pad lets one of them.
  const firstNight = day?.firstNightSeconds ?? 0;
  const padReserve =
    day !== null && fuelingRate > 0 && window > 0 ? windowPadReserve(problem.options, fuelingRate, window) : 0;
  const shapeWindow = window - padReserve;
  const shape =
    day === null
      ? { latest: window, nights: 0, waking: window, partial: window }
      : firstNight > 0 && shapeWindow < firstNight
        ? { latest: 0, nights: 0, waking: 0, partial: 0 }
        : windowShape(shapeWindow - firstNight, day.wakingSeconds, day.wakeOffsetSeconds);

  const candidates: Candidate[] = [];
  problem.options.forEach((opt: LaunchOption, index: number) => {
    // A malformed cost falls through the comparisons below rather than failing loudly:
    // `NaN > 1` is false, and a negative cost *buys* fuel budget or discounts a slot.
    if (
      !Number.isFinite(opt.actualFuel) ||
      !Number.isFinite(opt.actualTime) ||
      opt.actualFuel < 0 ||
      opt.actualTime < 0
    ) {
      return;
    }
    const costs = axes.map(ax => fuelCostOnAxis(opt, ax));
    if (costs.some(c => !Number.isFinite(c) || c < 0)) return;
    const fuelFractions = axes.map((ax, a) => (ax.capacity > 0 ? costs[a] / ax.capacity : costs[a] > 0 ? Infinity : 0));
    const timeFraction = timeCap > 0 ? opt.actualTime / timeCap : Infinity;
    if (timeFraction > 1) return;
    // Without a sleep window a launch goes up no sooner than its own fuelling after T+0, so one whose fuelling and
    // flight together are longer than the slot never ends in time (SPEC.md section 18). Without a rate this is the
    // test above.
    const padSeconds = padSecondsOf(opt, problem.fuelingRate);
    if (day === null && padSeconds > 0 && opt.actualTime + padSeconds > timeCap) return;
    // More nights than a slot has fits no slot, exactly as more seconds than one does not. A malformed count
    // falls out with it rather than reaching a row.
    const nights = opt.nights ?? 0;
    if (!Number.isInteger(nights) || nights < 0 || nights > nightsCap) return;
    // A doubled option with no window has no row to hold it inside one, so it is dropped rather than flown at 2x
    // unconstrained; an `event` one charging more waking seconds or nights than the window has before its last
    // waking instant cannot go up and land inside it with anything after it, and its column would be pinned at 0.
    // A malformed variant falls out with them. Without a sleep window that is its seconds against the window
    // (SPEC.md sections 11 and 14).
    const variant = opt.variant ?? 'normal';
    if (!Object.prototype.hasOwnProperty.call(VARIANT_RANK, variant)) return;
    if (variant !== 'normal' && !(window > 0)) return;
    if (variant === 'event' && (opt.actualTime > shape.waking || nights > shape.nights)) return;
    // A launch at T+0 exists only when the plan starts in the night, and has to be back by the horizon (SPEC.md
    // section 17). A malformed charge falls out with it.
    const atStart = opt.atStartSeconds !== undefined;
    const atStartBlock = atStart ? opt.atStartSeconds! : 0;
    if (atStart && (!(firstNight > 0) || !(atStartBlock >= 0) || atStartBlock > day!.planHorizonSeconds)) return;
    // A launch at T+0 goes up inside any 2x window, which opens at T+0, and the game doubles it (section 16): flown at
    // 1x it is a fault wherever the menu has its doubled copy, and `capacityVariants` gives every option an
    // `overhang` one. So with a window only its doubled copies are kept, and the window rows see it, as the
    // labelling they rest on has it (section 13). A window that closes before the first wake-up has nothing doubled
    // in it but the launches at T+0, each of which is its slot's last doubled launch, an `overhang`.
    if (atStart && variant === 'normal' && window > 0) return;
    if (firstNight > 0 && window < firstNight && variant !== 'normal' && (!atStart || variant === 'event')) return;

    const yieldEntries: Entry[] = [];
    for (const [item, qty] of opt.yieldVector) {
      if (qty > 0 && itemIndex.has(item)) {
        if (!Number.isFinite(qty)) return;
        yieldEntries.push([item, qty]);
      }
    }
    const legendaryEntries: Entry[] = [];
    for (const t of targets) {
      const qty = opt.legendaryYieldVector.get(t) ?? 0;
      if (qty > 0) {
        if (!Number.isFinite(qty)) return;
        legendaryEntries.push([t, qty]);
      }
    }
    if (yieldEntries.length === 0 && legendaryEntries.length === 0) return;
    yieldEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    legendaryEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    // The tightest axis binds; an option needing more of one egg than the player has
    // gets a fraction above 1 and falls out on `cap < 1`.
    const cap = Math.min(
      ...costs.map((cost, a) => (cost > 0 ? maxLaunches(axes[a].capacity, cost) : UNBOUNDED_GROUP)),
      opt.actualTime > 0 ? maxLaunches(slots * timeCap, opt.actualTime) : UNBOUNDED_GROUP,
      // Whole numbers on both sides, so the quotient is exact.
      nights > 0 ? Math.floor((slots * nightsCap) / nights) : UNBOUNDED_GROUP,
      // The window rows' bounds, restated per group as the time and night bounds are.
      variant === 'event' && (opt.actualTime > 0 || nights > 0)
        ? slots * eventLaunches(opt.actualTime, nights, shape)
        : UNBOUNDED_GROUP,
      variant === 'overhang' || atStart ? slots : UNBOUNDED_GROUP,
      UNBOUNDED_GROUP
    );
    if (cap < 1) return;

    candidates.push({
      fuelFractions,
      timeFraction,
      timeSeconds: opt.actualTime,
      nights,
      variant,
      atStart,
      atStartBlock,
      padSeconds,
      yieldEntries,
      legendaryEntries,
      cap,
      index,
    });
  });

  candidates.sort((a, b) => cmpKey(a, b) || a.index - b.index);
  const groups: Group[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (i > 0 && cmpKey(candidates[i - 1], cand) === 0) {
      const into = groups[groups.length - 1];
      into.members.push(cand.index);
      into.atStartBlock = Math.max(into.atStartBlock, cand.atStartBlock);
      continue;
    }
    const yieldByItem = new Array<number>(items.length).fill(0);
    for (const [item, qty] of cand.yieldEntries) yieldByItem[itemIndex.get(item)!] = qty;
    const legendaryByTarget = targets.map(t => {
      const hit = cand.legendaryEntries.find(e => e[0] === t);
      return hit ? hit[1] : 0;
    });
    groups.push({
      fuelFractions: cand.fuelFractions,
      timeFraction: cand.timeFraction,
      timeSeconds: cand.timeSeconds,
      nights: cand.nights,
      variant: cand.variant,
      atStart: cand.atStart,
      atStartBlock: cand.atStartBlock,
      padSeconds: cand.padSeconds,
      yieldByItem,
      legendaryByTarget,
      cap: cand.cap,
      members: [cand.index],
      twin: -1,
      copy: { event: -1, overhang: -1 },
    });
  }
  for (const grp of groups) grp.members.sort((a, b) => a - b);

  // Dropped before `craftUpperBounds`, which counts every group at its cap: fewer groups only tightens a
  // bound that stays an over-statement of what the remaining ones can supply.
  const kept = pruneDominated(groups, timeCap, nightsCap);
  linkTwins(groups, kept, timeCap, nightsCap);
  linkCopies(kept);

  return {
    sortedTargets: targets,
    requestedOrder,
    craftables,
    items,
    consRows,
    craftChildren,
    baseInventoryByItem,
    Qs,
    targetCraftIdx,
    slots,
    fuelAxes: axes,
    timeCapacitySeconds: timeCap,
    nightsPerSlot: nightsCap,
    day,
    eventWindowSeconds: window,
    eventWindowBudget: shape.waking,
    eventWindowNights: shape.nights,
    eventWindowLatest: shape.latest,
    eventWindowPartial: shape.partial,
    eventWindowPadReserve: padReserve,
    craftCaps: craftUpperBounds(dag, targets, craftables, craftIndex, items, itemIndex, baseInventoryByItem, kept),
    craftPrices,
    craftBudgetCapacity,
    fuelingRate,
    groups: kept,
  };
}
