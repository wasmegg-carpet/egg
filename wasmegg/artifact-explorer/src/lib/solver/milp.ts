// The mixed-integer program handed to HiGHS: the continuous per-target scale
// LPs, and the integer outer-approximation MILP. See SPEC.md sections 2-4.

import type { Model } from './model';
import { logHit } from '../concave';
import { INF, type MilpModel } from './types';

export const Q_CERTAIN_PROXY = 1e4;

const MAX_PER_SLOT = 1e6;

// Uncapped on purpose — deliberately not `concave.gPrime`. See SPEC.md section 4.
function slopeAt(s: number): number {
  return 1 / Math.expm1(s);
}

export interface Layout {
  slots: number;
  groups: number;
  crafts: number;
  targets: number;
  nBase: number;
  aBase: number;
  cBase: number;
  sBase: number;
  zBase: number;
  columnCount: number;
}

export type Variant = 'scale' | 'oa';

export function layoutOf(model: Model, variant: Variant): Layout {
  const withZ = variant === 'oa';
  const slots = model.slots;
  const groups = model.groups.length;
  const crafts = model.craftables.length;
  const targets = model.targets.length;
  const nBase = 0;
  const aBase = nBase + groups * slots;
  const cBase = aBase + groups;
  const sBase = cBase + crafts;
  const zBase = sBase + targets;
  return {
    slots,
    groups,
    crafts,
    targets,
    nBase,
    aBase,
    cBase,
    sBase,
    zBase: withZ ? zBase : -1,
    columnCount: withZ ? zBase + targets : zBase,
  };
}

export function nCol(layout: Layout, group: number, slot: number): number {
  return layout.nBase + group * layout.slots + slot;
}

export function effectiveQs(model: Model): number[] {
  return model.Qs.map(q => (Number.isFinite(q) ? q : Q_CERTAIN_PROXY));
}

// Kept 1000x clear of HiGHS's `small_matrix_value` (1e-9), which silently
// discards entries at ingestion. See SPEC.md section 3.
const SAFE_COEFFICIENT = 1e-6;

// The same margin below `large_matrix_value` (1e15), which rejects the model.
const SAFE_LARGE_COEFFICIENT = 1e12;

function scaleBound(bound: number, scale: number): number {
  if (bound >= INF) return INF;
  if (bound <= -INF) return -INF;
  const scaled = bound * scale;
  if (scaled >= INF) return INF;
  if (scaled <= -INF) return -INF;
  return scaled;
}

class Rows {
  private readonly offsets: number[] = [];
  private readonly indices: number[] = [];
  private readonly values: number[] = [];
  private readonly lower: number[] = [];
  private readonly upper: number[] = [];
  private current: Map<number, number> | null = null;

  begin(): void {
    this.current = new Map();
  }

  add(column: number, coefficient: number): void {
    if (coefficient === 0) return;
    const row = this.current!;
    row.set(column, (row.get(column) ?? 0) + coefficient);
  }

  end(lo: number, up: number): void {
    const row = this.current!;
    this.current = null;

    const entries: [number, number][] = [];
    let smallest = Infinity;
    let largest = 0;
    for (const [column, coefficient] of row) {
      if (coefficient === 0) continue;
      entries.push([column, coefficient]);
      const magnitude = Math.abs(coefficient);
      if (magnitude < smallest) smallest = magnitude;
      if (magnitude > largest) largest = magnitude;
    }
    if (entries.length === 0) return;
    entries.sort((a, b) => a[0] - b[0]);

    const headroom = largest > 0 ? SAFE_LARGE_COEFFICIENT / largest : Infinity;
    const scale = smallest < SAFE_COEFFICIENT ? Math.max(1, Math.min(1 / smallest, headroom)) : 1;

    this.offsets.push(this.indices.length);
    for (const [column, coefficient] of entries) {
      this.indices.push(column);
      this.values.push(coefficient * scale);
    }
    this.lower.push(scaleBound(lo, scale));
    this.upper.push(scaleBound(up, scale));
  }

  freeze(): Pick<MilpModel, 'rowCount' | 'rowLower' | 'rowUpper' | 'offsets' | 'indices' | 'values'> {
    return {
      rowCount: this.offsets.length,
      rowLower: Float64Array.from(this.lower),
      rowUpper: Float64Array.from(this.upper),
      offsets: Int32Array.from(this.offsets),
      indices: Int32Array.from(this.indices),
      values: Float64Array.from(this.values),
    };
  }
}

function perSlotCap(model: Model, group: number): number {
  const grp = model.groups[group];
  const byTime = grp.timeFraction > 0 ? Math.floor(1 / grp.timeFraction) : MAX_PER_SLOT;
  return Math.max(0, Math.min(grp.cap, byTime, MAX_PER_SLOT));
}

interface Core {
  layout: Layout;
  rows: Rows;
  columnLower: Float64Array;
  columnUpper: Float64Array;
  columnIsInteger: Uint8Array;
}

function buildCore(model: Model, qs: readonly number[], theta: readonly number[], variant: Variant): Core {
  const withZ = variant === 'oa';
  const layout = layoutOf(model, variant);
  const columnLower = new Float64Array(layout.columnCount);
  const columnUpper = new Float64Array(layout.columnCount).fill(INF);
  const columnIsInteger = new Uint8Array(layout.columnCount);

  for (let g = 0; g < layout.groups; g++) {
    const cap = perSlotCap(model, g);
    for (let k = 0; k < layout.slots; k++) {
      const col = nCol(layout, g, k);
      columnUpper[col] = cap;
      columnIsInteger[col] = withZ ? 1 : 0;
    }
    columnUpper[layout.aBase + g] = model.groups[g].cap;
  }
  for (let p = 0; p < layout.crafts; p++) {
    const cap = model.craftCaps[p];
    if (Number.isFinite(cap) && cap >= 0 && cap < INF) columnUpper[layout.cBase + p] = cap;
  }

  if (withZ) {
    for (let t = 0; t < layout.targets; t++) {
      columnLower[layout.zBase + t] = -INF;
      columnUpper[layout.zBase + t] = 0;
    }
  }

  const rows = new Rows();

  for (let g = 0; g < layout.groups; g++) {
    rows.begin();
    rows.add(layout.aBase + g, 1);
    for (let k = 0; k < layout.slots; k++) rows.add(nCol(layout, g, k), -1);
    rows.end(0, 0);
  }

  for (let i = 0; i < model.items.length; i++) {
    rows.begin();
    for (let p = 0; p < layout.crafts; p++) rows.add(layout.cBase + p, model.consRows[i][p]);
    for (let g = 0; g < layout.groups; g++) rows.add(layout.aBase + g, -model.groups[g].yieldByItem[i]);
    rows.end(-INF, model.baseInventoryByItem[i]);
  }

  for (let t = 0; t < layout.targets; t++) {
    rows.begin();
    rows.add(layout.sBase + t, theta[t]);
    const craft = model.targetCraftIdx[t];
    if (craft >= 0) rows.add(layout.cBase + craft, -qs[t]);
    for (let g = 0; g < layout.groups; g++) rows.add(layout.aBase + g, -model.groups[g].legendaryByTarget[t]);
    rows.end(0, 0);
  }

  rows.begin();
  for (let g = 0; g < layout.groups; g++) rows.add(layout.aBase + g, model.groups[g].fuelFraction);
  rows.end(-INF, 1);

  // Raw seconds rather than normalized — not cosmetic, see SPEC.md section 3.
  for (let k = 0; k < layout.slots; k++) {
    rows.begin();
    for (let g = 0; g < layout.groups; g++) rows.add(nCol(layout, g, k), model.groups[g].timeSeconds);
    rows.end(-INF, model.timeCapacitySeconds);
  }

  for (let k = 0; k + 1 < layout.slots; k++) {
    rows.begin();
    for (let g = 0; g < layout.groups; g++) {
      const seconds = model.groups[g].timeSeconds;
      rows.add(nCol(layout, g, k), seconds);
      rows.add(nCol(layout, g, k + 1), -seconds);
    }
    rows.end(0, INF);
  }

  return { layout, rows, columnLower, columnUpper, columnIsInteger };
}

// Locals rather than `core`, so the closure does not retain its `Rows`.
function finisher(core: Core): (objective: Float64Array) => MilpModel {
  const frozen = core.rows.freeze();
  const { columnLower, columnUpper, columnIsInteger } = core;
  const columnCount = core.layout.columnCount;
  return objective => ({
    columnCount,
    columnLower,
    columnUpper,
    columnIsInteger,
    objective,
    ...frozen,
  });
}

// Not 1: at raw-score magnitudes every reduced cost is inside HiGHS's dual
// feasibility tolerance and it reports optimal at zero. See SPEC.md section 4.
const SCALE_LP_OBJECTIVE = 1e9;

export function scaleLps(model: Model, qs: readonly number[]): (t: number) => MilpModel {
  const ones = new Array<number>(model.targets.length).fill(1);
  const core = buildCore(model, qs, ones, 'scale');
  const build = finisher(core);
  return t => {
    const objective = new Float64Array(core.layout.columnCount);
    objective[core.layout.sBase + t] = SCALE_LP_OBJECTIVE;
    return build(objective);
  };
}

export function buildOaMilp(
  model: Model,
  qs: readonly number[],
  theta: readonly number[],
  sigmaGrid: readonly number[]
): MilpModel {
  const core = buildCore(model, qs, theta, 'oa');
  const { layout, rows } = core;

  for (let t = 0; t < layout.targets; t++) {
    for (const at of sigmaGrid) {
      const s = theta[t] * at;
      if (!(s > 0) || !Number.isFinite(s)) continue;
      const slope = theta[t] * slopeAt(s);
      const rhs = logHit(s) - slope * at;
      if (!Number.isFinite(slope) || !Number.isFinite(rhs)) continue;
      rows.begin();
      rows.add(layout.zBase + t, 1);
      rows.add(layout.sBase + t, -slope);
      rows.end(-INF, rhs);
    }
  }

  const objective = new Float64Array(layout.columnCount);
  for (let t = 0; t < layout.targets; t++) objective[layout.zBase + t] = 1;
  return finisher(core)(objective);
}

export function decodeCounts(model: Model, layout: Layout, columnValues: Float64Array): number[] {
  const counts = new Array<number>(model.groups.length).fill(0);
  for (let g = 0; g < layout.groups; g++) {
    let total = 0;
    for (let k = 0; k < layout.slots; k++) {
      const v = columnValues[nCol(layout, g, k)];
      if (Number.isFinite(v) && v > 0) total += Math.round(v);
    }
    counts[g] = Math.min(total, model.groups[g].cap);
  }
  return counts;
}
