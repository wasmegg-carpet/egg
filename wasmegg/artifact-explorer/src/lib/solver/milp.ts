// The mixed-integer program handed to HiGHS: the continuous per-target scale
// LPs, and the integer outer-approximation MILP. See SPEC.md sections 2-4.

import { UNBOUNDED_PER_SLOT, boundsFollowFromRows, maxLaunches, type Model } from './model';
import { finiteQ, logHit } from '../objective';
import { INF, type MilpModel } from './types';

// Uncapped on purpose — deliberately not `objective.gPrime`. See SPEC.md section 4.
function slopeAt(s: number): number {
  return 1 / Math.expm1(s);
}

export interface Layout {
  slots: number;
  groups: number;
  crafts: number;
  targets: number;
  // Slot columns are per duration class, not per group: the slot and order rows read only a mission's
  // duration, so groups of one duration share `slots` columns and a `class_c` row ties their totals to
  // them. See SPEC.md section 2. `classCap` is the per-slot column bound; `classSeconds` the row coefficient.
  classes: number;
  classOf: number[];
  classSeconds: number[];
  classCap: number[];
  groupTotalBase: number;
  craftBase: number;
  // Score in units of theta: sigma in the 'oa' variant, and the raw score in 'scale', where theta is 1.
  scoreBase: number;
  envelopeBase: number;
  columnCount: number;
}

export type Variant = 'scale' | 'oa';

// A group shares a class only when its duration alone bounds its per-slot count (the same test the
// dominance pass applies): a group on the `UNBOUNDED_PER_SLOT` stand-in has a per-group per-slot cap no
// shared column can carry, so it keeps a class of its own with exactly the bound it had before.
function durationClasses(model: Model): Pick<Layout, 'classes' | 'classOf' | 'classSeconds' | 'classCap'> {
  const classOf = new Array<number>(model.groups.length);
  const classSeconds: number[] = [];
  const classCap: number[] = [];
  const shared = new Map<number, number>();
  model.groups.forEach((grp, g) => {
    // In seconds, like the slot row this bound must not contradict (SPEC.md section 3).
    const byTime = grp.timeSeconds > 0 ? maxLaunches(model.timeCapacitySeconds, grp.timeSeconds) : UNBOUNDED_PER_SLOT;
    if (boundsFollowFromRows(grp, model.timeCapacitySeconds)) {
      let c = shared.get(grp.timeSeconds);
      if (c === undefined) {
        c = classSeconds.length;
        shared.set(grp.timeSeconds, c);
        classSeconds.push(grp.timeSeconds);
        classCap.push(byTime);
      }
      classOf[g] = c;
    } else {
      classOf[g] = classSeconds.length;
      classSeconds.push(grp.timeSeconds);
      classCap.push(Math.max(0, Math.min(grp.cap, byTime, UNBOUNDED_PER_SLOT)));
    }
  });
  return { classes: classSeconds.length, classOf, classSeconds, classCap };
}

export function layoutOf(model: Model, variant: Variant): Layout {
  const withZ = variant === 'oa';
  const slots = model.slots;
  const groups = model.groups.length;
  const crafts = model.craftables.length;
  const targets = model.sortedTargets.length;
  const classes = durationClasses(model);
  const groupTotalBase = classes.classes * slots;
  const craftBase = groupTotalBase + groups;
  const scoreBase = craftBase + crafts;
  const envelopeBase = scoreBase + targets;
  return {
    slots,
    groups,
    crafts,
    targets,
    ...classes,
    groupTotalBase,
    craftBase,
    scoreBase,
    envelopeBase: withZ ? envelopeBase : -1,
    columnCount: withZ ? envelopeBase + targets : envelopeBase,
  };
}

export function nCol(layout: Layout, durationClass: number, slot: number): number {
  return durationClass * layout.slots + slot;
}

export function effectiveQs(model: Model): number[] {
  return model.Qs.map(finiteQ);
}

// Kept 1000x clear of HiGHS's `small_matrix_value` (1e-9), which silently
// discards entries at ingestion. See SPEC.md section 3.
const SAFE_COEFFICIENT = 1e-6;

// The same margin below `large_matrix_value` (1e15), which rejects the model.
const SAFE_LARGE_COEFFICIENT = 1e12;

// The ends of the ingestion window themselves: HiGHS *discards* an entry at or below the first and
// treats one at or above the second as infinite, both while reading the model, where no option can
// reach them (SPEC.md section 3). Scaling keeps rows clear of both; these are what says so.
const SMALL_MATRIX_VALUE = 1e-9;
const LARGE_MATRIX_VALUE = 1e15;

function scaleBound(bound: number, scale: number): number {
  if (bound >= INF) return INF;
  if (bound <= -INF) return -INF;
  const scaled = bound * scale;
  if (scaled >= INF) return INF;
  if (scaled <= -INF) return -INF;
  return scaled;
}

class Rows {
  private readonly names: string[] = [];
  private readonly offsets: number[] = [];
  private readonly indices: number[] = [];
  private readonly values: number[] = [];
  private readonly lower: number[] = [];
  private readonly upper: number[] = [];
  private current: Map<number, number> | null = null;
  private currentName = '';

  begin(name: string): void {
    this.current = new Map();
    this.currentName = name;
  }

  add(column: number, coefficient: number): void {
    if (coefficient === 0) return;
    const row = this.current!;
    row.set(column, (row.get(column) ?? 0) + coefficient);
  }

  end(lo: number, up: number): void {
    const row = this.current!;
    const name = this.currentName;
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
    // A row with no entries reads `0 in [lo, up]` and is dropped along with its bounds. Sound only
    // because every row built here has 0 between its own bounds; one that did not would be an
    // infeasible row, and dropping it would make the model feasible instead of unsolvable.
    if (entries.length === 0) return;
    entries.sort((a, b) => a[0] - b[0]);

    const headroom = largest > 0 ? SAFE_LARGE_COEFFICIENT / largest : Infinity;
    const scale = smallest < SAFE_COEFFICIENT ? Math.max(1, Math.min(1 / smallest, headroom)) : 1;

    // The check is on the entries as HiGHS will read them, not on how many there are: a row whose own
    // dynamic range is wider than the window cannot be written at any scale, and handing it over anyway
    // deletes its smallest terms silently — a budget row losing its coefficients stops budgeting, with
    // nothing anywhere saying so.
    if (smallest * scale <= SMALL_MATRIX_VALUE || largest * scale >= LARGE_MATRIX_VALUE) {
      throw new Error(
        `row ${name} spans ${smallest * scale} to ${largest * scale} after scaling, outside ` +
          `HiGHS's ingestion window (${SMALL_MATRIX_VALUE}, ${LARGE_MATRIX_VALUE})`
      );
    }

    this.names.push(name);
    this.offsets.push(this.indices.length);
    for (const [column, coefficient] of entries) {
      this.indices.push(column);
      this.values.push(coefficient * scale);
    }
    this.lower.push(scaleBound(lo, scale));
    this.upper.push(scaleBound(up, scale));
  }

  freeze(): Pick<MilpModel, 'rowCount' | 'rowNames' | 'rowLower' | 'rowUpper' | 'offsets' | 'indices' | 'values'> {
    return {
      rowCount: this.offsets.length,
      rowNames: this.names.slice(),
      rowLower: Float64Array.from(this.lower),
      rowUpper: Float64Array.from(this.upper),
      offsets: Int32Array.from(this.offsets),
      indices: Int32Array.from(this.indices),
      values: Float64Array.from(this.values),
    };
  }
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

  for (let c = 0; c < layout.classes; c++) {
    for (let k = 0; k < layout.slots; k++) {
      const col = nCol(layout, c, k);
      columnUpper[col] = layout.classCap[c];
      columnIsInteger[col] = withZ ? 1 : 0;
    }
  }
  // Integer too: a class row only fixes the *sum* of its members' totals, and a whole class count split
  // fractionally between two groups is not a plan.
  for (let g = 0; g < layout.groups; g++) {
    columnUpper[layout.groupTotalBase + g] = model.groups[g].cap;
    columnIsInteger[layout.groupTotalBase + g] = withZ ? 1 : 0;
  }
  for (let p = 0; p < layout.crafts; p++) {
    const cap = model.craftCaps[p];
    if (Number.isFinite(cap) && cap >= 0 && cap < INF) columnUpper[layout.craftBase + p] = cap;
  }

  if (withZ) {
    for (let t = 0; t < layout.targets; t++) {
      columnLower[layout.envelopeBase + t] = -INF;
      columnUpper[layout.envelopeBase + t] = 0;
    }
  }

  const rows = new Rows();

  for (let c = 0; c < layout.classes; c++) {
    rows.begin(`class_c${c}`);
    for (let g = 0; g < layout.groups; g++) if (layout.classOf[g] === c) rows.add(layout.groupTotalBase + g, 1);
    for (let k = 0; k < layout.slots; k++) rows.add(nCol(layout, c, k), -1);
    rows.end(0, 0);
  }

  for (let i = 0; i < model.items.length; i++) {
    rows.begin(`cons_i${i}`);
    for (let p = 0; p < layout.crafts; p++) rows.add(layout.craftBase + p, model.consRows[i][p]);
    for (let g = 0; g < layout.groups; g++) rows.add(layout.groupTotalBase + g, -model.groups[g].yieldByItem[i]);
    rows.end(-INF, model.baseInventoryByItem[i]);
  }

  for (let t = 0; t < layout.targets; t++) {
    rows.begin(`score_t${t}`);
    rows.add(layout.scoreBase + t, theta[t]);
    const craft = model.targetCraftIdx[t];
    if (craft >= 0) rows.add(layout.craftBase + craft, -qs[t]);
    for (let g = 0; g < layout.groups; g++) rows.add(layout.groupTotalBase + g, -model.groups[g].legendaryByTarget[t]);
    rows.end(0, 0);
  }

  for (let a = 0; a < model.fuelAxes.length; a++) {
    rows.begin(`fuel_a${a}`);
    for (let g = 0; g < layout.groups; g++) rows.add(layout.groupTotalBase + g, model.groups[g].fuelFractions[a]);
    rows.end(-INF, 1);
  }

  if (Number.isFinite(model.craftBudgetCapacity)) {
    rows.begin('price');
    for (let p = 0; p < layout.crafts; p++) rows.add(layout.craftBase + p, model.craftPrices[p]);
    rows.end(-INF, model.craftBudgetCapacity);
  }

  // Raw seconds rather than normalized — not cosmetic, see SPEC.md section 3.
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`slot_k${k}`);
    for (let c = 0; c < layout.classes; c++) rows.add(nCol(layout, c, k), layout.classSeconds[c]);
    rows.end(-INF, model.timeCapacitySeconds);
  }

  for (let k = 0; k + 1 < layout.slots; k++) {
    rows.begin(`order_k${k}`);
    for (let c = 0; c < layout.classes; c++) {
      const seconds = layout.classSeconds[c];
      rows.add(nCol(layout, c, k), seconds);
      rows.add(nCol(layout, c, k + 1), -seconds);
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

// A tangent slope below this is flat, in nats, over every sigma the MILP can reach. Pinned to the
// judge's own resolution (`EXACT_PRECISION.gapTol`): no decision it can see turns on less.
const FLAT_CUT_SLOPE = 1e-12;

// Not 1: at raw-score magnitudes every reduced cost is inside HiGHS's dual
// feasibility tolerance and it reports optimal at zero. See SPEC.md section 4.
const SCALE_LP_OBJECTIVE = 1e9;

export function scaleLps(model: Model, qs: readonly number[]): (t: number) => MilpModel {
  const ones = new Array<number>(model.sortedTargets.length).fill(1);
  const core = buildCore(model, qs, ones, 'scale');
  const build = finisher(core);
  // Locals for the same reason `finisher` takes them: the returned closure outlives the solve loop, and
  // reading them off `core` would keep the whole sparse matrix reachable alongside `finisher`'s frozen copy.
  const { columnCount, scoreBase } = core.layout;
  return t => {
    const objective = new Float64Array(columnCount);
    objective[scoreBase + t] = SCALE_LP_OBJECTIVE;
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
    for (let j = 0; j < sigmaGrid.length; j++) {
      const gridPoint = sigmaGrid[j];
      const s = theta[t] * gridPoint;
      if (!(s > 0) || !Number.isFinite(s)) continue;
      const slope = theta[t] * slopeAt(s);
      const rhs = logHit(s) - slope * gridPoint;
      if (!Number.isFinite(slope) || !Number.isFinite(rhs)) continue;
      rows.begin(`cut_t${t}_${j}`);
      rows.add(layout.envelopeBase + t, 1);
      // Dropped here rather than by HiGHS at ingestion, which is where it went before and said nothing:
      // past s ~ 400 the slope underflows next to the unit coefficient above and the row leaves the
      // window `Rows.end` now enforces. Sound because sigma <= 1, so the term is worth at most `slope`
      // nats across the whole feasible range and the cut it leaves is the same tangent held flat — which
      // may sit under g by that much, a thousandth of the envelope error the grid already carries.
      if (slope >= FLAT_CUT_SLOPE) rows.add(layout.scoreBase + t, -slope);
      rows.end(-INF, rhs);
    }
  }

  const objective = new Float64Array(layout.columnCount);
  for (let t = 0; t < layout.targets; t++) objective[layout.envelopeBase + t] = 1;
  return finisher(core)(objective);
}

export function decodeCounts(model: Model, layout: Layout, columnValues: Float64Array): number[] {
  const counts = new Array<number>(model.groups.length).fill(0);
  for (let g = 0; g < layout.groups; g++) {
    const v = columnValues[layout.groupTotalBase + g];
    if (Number.isFinite(v) && v > 0) counts[g] = Math.min(Math.round(v), model.groups[g].cap);
  }
  return counts;
}
