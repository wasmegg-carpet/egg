// Preprocessing for the planner: restricted recipe DAG, normalized budgets,
// filtered and duplicate-merged option groups.

import type { LaunchOption, RecipeDAG } from '../types';
import type { PlanProblem } from './types';

const GROUP_CAP = 1e9;

export interface Group {
  // Normalized: a fraction of the whole tank, and of one slot's horizon.
  fuelFraction: number;
  timeFraction: number;
  timeSeconds: number;
  yieldByItem: number[];
  legendaryByTarget: number[];
  cap: number;
  members: number[]; // original option indices, ascending; output lands on members[0]
}

export interface Model {
  targets: string[];
  craftables: string[];
  items: string[];
  consRows: number[][]; // items x craftables
  // Per craftable, its children; `childCraft` is -1 when the child is not crafted.
  craftChildren: { itemIdx: number; childCraft: number }[][];
  baseInventoryByItem: number[];
  Qs: number[];
  targetCraftIdx: number[]; // craft column per target; -1 when not craftable
  slots: number;
  timeCapacitySeconds: number;
  // Upper bound per craft column; Infinity where nothing bounds it.
  craftCaps: number[];
  craftPrices: number[];
  craftBudgetCapacity: number;
  groups: Group[];
}

type Entry = [string, number];

interface Candidate {
  fuelFraction: number;
  timeFraction: number;
  timeSeconds: number;
  yieldEntries: Entry[]; // sorted by item id
  legendaryEntries: Entry[]; // sorted by target id
  cap: number;
  index: number;
}

function cmpEntries(a: Entry[], b: Entry[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i][0] !== b[i][0]) return a[i][0] < b[i][0] ? -1 : 1;
    if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
  }
  return a.length - b.length;
}

function cmpKey(a: Candidate, b: Candidate): number {
  if (a.fuelFraction !== b.fuelFraction) return a.fuelFraction - b.fuelFraction;
  if (a.timeFraction !== b.timeFraction) return a.timeFraction - b.timeFraction;
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
      if (!(child.quantity > 0)) continue;
      const itemIdx = itemIndex.get(child.nodeId);
      if (itemIdx === undefined) {
        bound = Infinity;
        break;
      }
      let supply = dropped[itemIdx];
      const producer = craftIndex.get(child.nodeId);
      if (producer !== undefined) supply += caps[producer];
      const limit = supply / child.quantity;
      if (limit < bound) bound = limit;
    }
    caps[idx] = Number.isFinite(bound) && bound >= 0 ? bound : Infinity;
  }
  return caps;
}

export function buildModel(problem: PlanProblem): Model {
  const dag: RecipeDAG = problem.dag;
  const targets = [...problem.targets];

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
      consRows[itemIndex.get(child.nodeId)!][j] += child.quantity;
    }
  }
  for (const [item, i] of itemIndex) {
    const producer = craftIndex.get(item);
    if (producer !== undefined) consRows[i][producer] -= 1;
  }

  const craftChildren = craftables.map(id =>
    dag
      .get(id)!
      .children.filter(child => child.quantity > 0)
      .map(child => ({
        itemIdx: itemIndex.get(child.nodeId)!,
        childCraft: craftIndex.get(child.nodeId) ?? -1,
      }))
  );

  const baseInventoryByItem = items.map(item => {
    const quantity = problem.baseYield.get(item) ?? 0;
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
  });
  const Qs = targets.map(t => {
    const node = dag.get(t);
    return node ? -Math.log(1 - node.legendaryCraftProbability) : 0;
  });
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

  // Normalized budgets: fuel 1, per-slot time 1. `fuelCapacity <= 0` reads as
  // "all fuel costs are 0".
  const fuelCap = problem.fuelCapacity;
  const timeCap = problem.timeCapacityPerSlot;
  const slots = problem.slots;

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
    const fuelFraction = fuelCap > 0 ? opt.actualFuel / fuelCap : 0;
    const timeFraction = timeCap > 0 ? opt.actualTime / timeCap : Infinity;
    if (timeFraction > 1) return;

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

    const cap = Math.min(
      fuelFraction > 0 ? Math.floor(1 / fuelFraction) : GROUP_CAP,
      timeFraction > 0 ? Math.floor(slots / timeFraction) : GROUP_CAP,
      GROUP_CAP
    );
    if (cap < 1) return;

    candidates.push({
      fuelFraction,
      timeFraction,
      timeSeconds: opt.actualTime,
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
      groups[groups.length - 1].members.push(cand.index);
      continue;
    }
    const yieldByItem = new Array<number>(items.length).fill(0);
    for (const [item, qty] of cand.yieldEntries) yieldByItem[itemIndex.get(item)!] = qty;
    const legendaryByTarget = targets.map(t => {
      const hit = cand.legendaryEntries.find(e => e[0] === t);
      return hit ? hit[1] : 0;
    });
    groups.push({
      fuelFraction: cand.fuelFraction,
      timeFraction: cand.timeFraction,
      timeSeconds: cand.timeSeconds,
      yieldByItem,
      legendaryByTarget,
      cap: cand.cap,
      members: [cand.index],
    });
  }
  for (const grp of groups) grp.members.sort((a, b) => a - b);

  return {
    targets,
    craftables,
    items,
    consRows,
    craftChildren,
    baseInventoryByItem,
    Qs,
    targetCraftIdx,
    slots,
    timeCapacitySeconds: timeCap,
    craftCaps: craftUpperBounds(dag, targets, craftables, craftIndex, items, itemIndex, baseInventoryByItem, groups),
    craftPrices,
    craftBudgetCapacity,
    groups,
  };
}
