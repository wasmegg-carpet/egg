// The mixed-integer program handed to HiGHS: the continuous per-target scale
// LPs, and the integer outer-approximation MILP. See SPEC.md sections 2-4.

import {
  UNBOUNDED_PER_SLOT,
  blockSeconds,
  boundsFollowFromRows,
  eventLaunches,
  maxLaunches,
  type Model,
} from './model';
import { finiteQ, logHit } from '../objective';
import { INF, type MilpModel } from './types';
import type { CapacityVariant } from '../types';
import { FIT_INTEGER_TOL, WINDOW_TOL, fitCoefficient, fitQs, leastWakingIn } from './days';

// Uncapped on purpose — deliberately not `objective.gPrime`. See SPEC.md section 4.
function slopeAt(s: number): number {
  return 1 / Math.expm1(s);
}

export interface Layout {
  slots: number;
  groups: number;
  crafts: number;
  targets: number;
  // Slot columns are per duration class, not per group: the slot, night, window and order rows read only a
  // mission's duration, nights and capacity variant, so groups sharing all three share `slots` columns and a
  // `class_c` row ties their totals to them. See SPEC.md sections 2, 9 and 11. `classCap` is the per-slot column
  // bound; `classSeconds`, `classNights` and `classVariant` what the rows read. `classCharge` is what `slot_k`
  // charges a launch: its seconds, except a doubled launch under a sleep window, which must go up inside the 2x
  // window and is charged the fewest waking seconds its block can hold when it does (SPEC.md section 14).
  classes: number;
  classOf: number[];
  classSeconds: number[];
  classNights: number[];
  classVariant: CapacityVariant[];
  classCap: number[];
  classCharge: number[];
  // Whether the class goes up at T+0 in the night the plan starts in, and the most any of its groups then holds its
  // slot from T+0 (SPEC.md section 17); false and 0 for every other class.
  classAtStart: boolean[];
  classAtStartBlock: number[];
  // The fueling pad's levels (SPEC.md section 18): `padLevels` ascending, the first launch of a slot fuelling for at
  // least `padLevels[0]` and, where the slot flies no class that can go first fuelling for at most `padLevels[j - 1]`,
  // for at least `padLevels[j]`; `classPadLevel` is each class's own level, its shortest fuelling rounded down onto
  // them, and `classFirst` whether it can be a slot's first launch (`padLevelsOf`). One binary column per slot and
  // level past the first, from `padBase` (`padCol`). Empty, and no column, without a fueling rate.
  padLevels: number[];
  classPadLevel: number[];
  classFirst: boolean[];
  padBase: number;
  groupTotalBase: number;
  craftBase: number;
  // Score in units of theta: sigma in the 'oa' variant, and the raw score in 'scale', where theta is 1.
  scoreBase: number;
  envelopeBase: number;
  columnCount: number;
}

export type Variant = 'scale' | 'oa';

// A group shares a class only when its rows alone bound its per-slot count (the same test the dominance
// pass applies): a group on the `UNBOUNDED_PER_SLOT` stand-in has a per-group per-slot cap no shared column
// can carry, so it keeps a class of its own with exactly the bound it had before. A class is keyed by
// (seconds, nights, variant): a daytime launch and an overnight one of equal waking seconds spend different
// budgets, and so do a launch and its doubled copies. Without a sleep window or an event window every group
// has 0 nights and is `normal`, and the classes are exactly the durations.
function durationClasses(
  model: Model
): Pick<
  Layout,
  | 'classes'
  | 'classOf'
  | 'classSeconds'
  | 'classNights'
  | 'classVariant'
  | 'classCap'
  | 'classCharge'
  | 'classAtStart'
  | 'classAtStartBlock'
> {
  const classOf = new Array<number>(model.groups.length);
  const classSeconds: number[] = [];
  const classNights: number[] = [];
  const classVariant: CapacityVariant[] = [];
  const classCap: number[] = [];
  const classCharge: number[] = [];
  const classAtStart: boolean[] = [];
  const classAtStartBlock: number[] = [];
  // Keyed by variant, and a launch at T+0 apart from the same numbers flown later (SPEC.md section 17), and with the
  // fueling pad by pad level, so a class's level is every one of its groups' (SPEC.md section 18).
  const shared = new Map<number, Map<number, Map<string, number>>>();
  const padLevel = padLevelOf(model);
  model.groups.forEach((grp, g) => {
    // In seconds, like the slot row this bound must not contradict (SPEC.md section 3).
    const byTime = grp.timeSeconds > 0 ? maxLaunches(model.timeCapacitySeconds, grp.timeSeconds) : UNBOUNDED_PER_SLOT;
    // And in whole nights, like the night row (SPEC.md section 9).
    const byNights = grp.nights > 0 ? Math.floor(model.nightsPerSlot / grp.nights) : UNBOUNDED_PER_SLOT;
    // And by the window rows, in the waking seconds and nights they charge (SPEC.md sections 11 and 14).
    const byWindow =
      grp.variant === 'overhang' || grp.atStart
        ? 1
        : grp.variant === 'event'
          ? eventLaunches(grp.timeSeconds, grp.nights, {
              waking: model.eventWindowBudget,
              nights: model.eventWindowNights,
            })
          : UNBOUNDED_PER_SLOT;
    if (boundsFollowFromRows(grp, model.timeCapacitySeconds, model.nightsPerSlot)) {
      let bySeconds = shared.get(grp.timeSeconds);
      if (bySeconds === undefined) {
        bySeconds = new Map();
        shared.set(grp.timeSeconds, bySeconds);
      }
      let byNightsClass = bySeconds.get(grp.nights);
      if (byNightsClass === undefined) {
        byNightsClass = new Map();
        bySeconds.set(grp.nights, byNightsClass);
      }
      const key =
        (grp.atStart ? `${grp.variant}@start` : grp.variant) +
        (model.fuelingRate > 0 ? `@pad${padLevel(grp.padSeconds)}` : '');
      let c = byNightsClass.get(key);
      if (c === undefined) {
        c = classSeconds.length;
        byNightsClass.set(key, c);
        classSeconds.push(grp.timeSeconds);
        classNights.push(grp.nights);
        classVariant.push(grp.variant);
        classCap.push(Math.min(byTime, byNights, byWindow));
        classCharge.push(slotCharge(model, grp));
        classAtStart.push(grp.atStart);
        classAtStartBlock.push(grp.atStartBlock);
      }
      classAtStartBlock[c] = Math.max(classAtStartBlock[c], grp.atStartBlock);
      classOf[g] = c;
    } else {
      classOf[g] = classSeconds.length;
      classSeconds.push(grp.timeSeconds);
      classNights.push(grp.nights);
      classVariant.push(grp.variant);
      classCap.push(Math.max(0, Math.min(grp.cap, byTime, byNights, byWindow, UNBOUNDED_PER_SLOT)));
      classCharge.push(slotCharge(model, grp));
      classAtStart.push(grp.atStart);
      classAtStartBlock.push(grp.atStartBlock);
    }
  });
  return {
    classes: classSeconds.length,
    classOf,
    classSeconds,
    classNights,
    classVariant,
    classCap,
    classCharge,
    classAtStart,
    classAtStartBlock,
  };
}

// What `slot_k` charges one launch of `grp`. Its waking seconds, the least its block holds wherever it goes up;
// but a doubled launch must go up inside the 2x window, and under a sleep window the least its block holds when it
// starts no later than the window's last waking instant can be more (SPEC.md section 14). Rounded down by
// `WINDOW_TOL` so float error never makes it more than that least, and never below the seconds themselves: without
// a sleep window, or for a launch the window does not constrain, it is the seconds exactly.
// A launch at T+0 in the night starts at a known instant, and its seconds are exactly what it holds after the first
// wake-up (SPEC.md section 17), so it is charged them whatever its variant.
function slotCharge(
  model: Model,
  grp: Pick<Model['groups'][number], 'timeSeconds' | 'nights' | 'variant' | 'atStart'>
): number {
  const day = model.day;
  if (day === null || grp.variant === 'normal' || grp.atStart) return grp.timeSeconds;
  const block = blockSeconds(grp.timeSeconds, grp.nights, day);
  const least = leastWakingIn(block, model.eventWindowLatest, day.wakingSeconds, day.wakeOffsetSeconds) - WINDOW_TOL;
  return least > grp.timeSeconds ? least : grp.timeSeconds;
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
  const padBase = withZ ? envelopeBase + targets : envelopeBase;
  const pad = padLevelsOf(model, classes.classOf, padLevelOf(model));
  return {
    slots,
    groups,
    crafts,
    targets,
    ...classes,
    ...pad,
    padBase,
    groupTotalBase,
    craftBase,
    scoreBase,
    envelopeBase: withZ ? envelopeBase : -1,
    columnCount: padBase + slots * Math.max(0, pad.padLevels.length - 1),
  };
}

// What the fueling pad takes from a slot before its first launch (SPEC.md section 18): that launch goes up no sooner
// than its own fuelling after T+0, so the slot's waking seconds up to then are in no launch's reach. With a sleep
// window that is no more than what is left of the first waking window, and nothing when the plan starts in the
// night, whose first launches go up in it; never more than the slot holds, so an empty slot stays feasible. Each
// class's shortest fuelling is rounded down to a power of four seconds (to 0 under `PAD_LEVEL_FLOOR`), which keeps the
// levels few, a dozen at most, and the loss a lower bound. Even a fraction of a second counts: a slot its launches
// fill to the horizon exactly has no room for any. No levels without a fueling rate, or when every class rounds to 0.
const PAD_LEVEL_FLOOR = 2 ** -10;
// So that a fuelling of exactly a power of four lands on its own level whatever `log2` rounds it to.
const PAD_LEVEL_TOL = 1e-12;

function padLevelOf(model: Model): (pad: number) => number {
  const day = model.day;
  const most =
    !(model.fuelingRate > 0) || (day !== null && day.firstNightSeconds > 0)
      ? 0
      : Math.min(model.timeCapacitySeconds, day === null ? Infinity : day.wakingSeconds - day.wakeOffsetSeconds);
  return pad => Math.min(most, pad >= PAD_LEVEL_FLOOR ? 16 ** Math.floor(Math.log2(pad) / 4 + PAD_LEVEL_TOL) : 0);
}

// With a 2x window a slot's first launch goes up inside it, and so doubled (SPEC.md section 16), unless the menu has
// no doubled copy of it: so only those classes can be first, and a slot with none of them starts no sooner than the
// window's close, which the rows cap the loss at. Without a window every class can be first.
function padLevelsOf(
  model: Model,
  classOf: readonly number[],
  level: (pad: number) => number
): Pick<Layout, 'padLevels' | 'classPadLevel' | 'classFirst'> {
  const classes = classOf.length > 0 ? Math.max(...classOf) + 1 : 0;
  const shortest = new Array<number>(classes).fill(Infinity);
  const classFirst = new Array<boolean>(classes).fill(!(model.eventWindowSeconds > 0));
  model.groups.forEach((grp, g) => {
    const c = classOf[g];
    shortest[c] = Math.min(shortest[c], grp.padSeconds);
    if (grp.variant !== 'normal' || grp.copy.event < 0 || grp.copy.overhang < 0) classFirst[c] = true;
  });
  const classPadLevel = shortest.map(level);
  const padLevels = [...new Set(classPadLevel)].sort((a, b) => a - b);
  if (!(model.fuelingRate > 0) || !(padLevels[padLevels.length - 1] > 0)) {
    return { padLevels: [], classPadLevel, classFirst };
  }
  return { padLevels, classPadLevel, classFirst };
}

export function padCol(layout: Layout, slot: number, level: number): number {
  return layout.padBase + slot * (layout.padLevels.length - 1) + level - 1;
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
  for (let k = 0; k < layout.slots; k++) {
    for (let j = 1; j < layout.padLevels.length; j++) {
      columnUpper[padCol(layout, k, j)] = 1;
      columnIsInteger[padCol(layout, k, j)] = withZ ? 1 : 0;
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

  // Raw seconds rather than normalized — not cosmetic, see SPEC.md section 3. A doubled launch under a sleep window
  // may be charged more than its seconds (SPEC.md section 14); every other launch is charged its seconds.
  // With the fueling pad, a slot also loses what its first launch's fuelling takes (`padLevelsOf`, SPEC.md section
  // 18): at least the top level, less each step down to a level the slot flies a class at that can go first, which
  // `padlevel` allows only when it does. A valid inequality: the loss it charges is at most the shortest fuelling of
  // any class the slot flies that can be its first launch. With a 2x window, no more than the window's own waking
  // seconds, before which a slot with no doubled launch has none. Without a fueling rate there are no levels, and the
  // row is the one it was.
  const levels = layout.padLevels.map(v => (model.eventWindowSeconds > 0 ? Math.min(v, model.eventWindowBudget) : v));
  const padTerms = (k: number) => {
    for (let j = 1; j < levels.length; j++) rows.add(padCol(layout, k, j), -(levels[j] - levels[j - 1]));
  };
  const padTop = levels.length > 0 ? levels[levels.length - 1] : 0;
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`slot_k${k}`);
    for (let c = 0; c < layout.classes; c++) rows.add(nCol(layout, c, k), layout.classCharge[c]);
    padTerms(k);
    rows.end(-INF, model.timeCapacitySeconds - padTop);
  }
  for (let k = 0; k < layout.slots; k++) {
    for (let j = 1; j < levels.length; j++) {
      rows.begin(`padlevel_k${k}_j${j}`);
      rows.add(padCol(layout, k, j), 1);
      for (let c = 0; c < layout.classes; c++) {
        if (layout.classFirst[c] && layout.classPadLevel[c] <= layout.padLevels[j - 1])
          rows.add(nCol(layout, c, k), -1);
      }
      rows.end(-INF, 0);
    }
  }

  // Whole nights against whole nights, so no scaling question arises. Without a sleep window every class
  // has 0 nights, the row has no entries, and `Rows.end` drops it: the model is today's exactly. Slots stay
  // interchangeable under this row, so `order_k` below remains a pure symmetry break. See SPEC.md section 9.
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`night_k${k}`);
    for (let c = 0; c < layout.classes; c++) rows.add(nCol(layout, c, k), layout.classNights[c]);
    rows.end(-INF, model.nightsPerSlot);
  }

  // The 2x capacity event window, two rows per slot: a slot's `event` launches hold it for at most the window, and
  // it holds at most one `overhang`. Exact together, not a relaxation, while launches go up back to back (SPEC.md
  // section 11). With a sleep window `window_k` holds an `event` launch's waking seconds to the waking seconds
  // before the window's last waking instant, and `windownight_k` its nights to the whole nights before it: valid
  // inequalities, and a relaxation the layout makes true (sections 13 and 14). Raw seconds, for the slot row's
  // reason; whole nights against whole nights. Without a window no class is doubled, the rows have no entries, and
  // `Rows.end` drops them: the model is today's exactly; without a sleep window no class spends a night, and
  // `windownight_k` is dropped the same way. One window shared by every slot, so slots stay interchangeable and
  // `order_k` remains a pure symmetry break.
  // With the fueling pad the slot's `event` launches, and the `overhang` after them, go up after its first launch
  // too, so the window also loses what that launch's fuelling takes, as `slot_k` does above, capped as it is there at
  // the window's waking seconds, which keeps the row satisfiable by a slot with no doubled launch. And each doubled
  // launch is charged its own fuelling (its class's level) on top of its seconds. That part is a reservation, not a
  // valid inequality: a launch whose slot frees up while the pad is busy with another slot's ship waits for its own
  // fuelling, which the pad fuels only from then, and where every slot's launches meet (at T+0, at a wake-up, on a cadence
  // of whole days) all but one of them do. A doubled launch that waits past the window's close loses its yield, so the
  // window is where waiting is reserved for. Without levels, the row above exactly.
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`window_k${k}`);
    for (let c = 0; c < layout.classes; c++) {
      const reserve =
        levels.length > 0 && model.eventWindowSeconds > 0
          ? Math.min(layout.classPadLevel[c], model.eventWindowBudget)
          : 0;
      if (layout.classVariant[c] === 'event') rows.add(nCol(layout, c, k), layout.classSeconds[c] + reserve);
      if (layout.classVariant[c] === 'overhang') rows.add(nCol(layout, c, k), reserve);
    }
    if (model.eventWindowSeconds > 0) padTerms(k);
    rows.end(-INF, model.eventWindowBudget - (model.eventWindowSeconds > 0 ? padTop : 0));
  }
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`windownight_k${k}`);
    for (let c = 0; c < layout.classes; c++) {
      if (layout.classVariant[c] === 'event') rows.add(nCol(layout, c, k), layout.classNights[c]);
    }
    rows.end(-INF, model.eventWindowNights);
  }
  // At most one launch a slot at T+0, when the plan starts in the night: the one instant before the first wake-up the
  // player is up to launch, and a slot flies one block at a time (SPEC.md section 17). Without such a night no class
  // goes up at T+0, the row has no entries, and `Rows.end` drops it.
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`start_k${k}`);
    for (let c = 0; c < layout.classes; c++) {
      if (layout.classAtStart[c]) rows.add(nCol(layout, c, k), 1);
    }
    rows.end(-INF, 1);
  }
  for (let k = 0; k < layout.slots; k++) {
    rows.begin(`overhang_k${k}`);
    for (let c = 0; c < layout.classes; c++) {
      if (layout.classVariant[c] === 'overhang') rows.add(nCol(layout, c, k), 1);
    }
    rows.end(-INF, 1);
  }

  // The fueling pad (SPEC.md section 18): every doubled launch goes up by the 2x window's close, and the pad fuels one
  // ship at a time from an empty pad at T+0, so the last of them goes up no sooner than all their fuelling summed. A
  // valid inequality on the group totals, across every slot. Without a fueling rate or without a window it has no
  // entries, and `Rows.end` drops it.
  rows.begin('pad_window');
  if (model.eventWindowSeconds > 0) {
    for (let g = 0; g < layout.groups; g++) {
      const grp = model.groups[g];
      if (grp.variant !== 'normal') rows.add(layout.groupTotalBase + g, grp.padSeconds);
    }
  }
  rows.end(-INF, model.eventWindowSeconds);

  // Per-day fit rows, only with a sleep window: the slot row pools a slot's waking seconds across its days,
  // and these say how many launches of each length one waking window holds. Valid inequalities, so they cut
  // off no plan that fits real days; they cost no columns. Absent `sleep`, nothing here runs. See SPEC.md
  // section 10.
  const day = model.day;
  if (day !== null) {
    const fitQ = fitQs(layout.classSeconds, layout.classNights, day.wakingSeconds);
    // A plan that starts after wake-up finds the first waking window's first `wakeOffsetSeconds` taken: a daytime
    // item of its own in that window, worth `u^(q)` of it in every fit row and every window fit row, whose right-hand
    // sides lose that much (SPEC.md section 17). None, and every row is the one above exactly.
    const busy = (q: number) =>
      day.wakeOffsetSeconds > 0 ? fitCoefficient(day.wakeOffsetSeconds, 0, day.wakingSeconds, q) : 0;
    for (let k = 0; k < layout.slots; k++) {
      for (const q of fitQ) {
        rows.begin(`fit_k${k}_q${q}`);
        for (let c = 0; c < layout.classes; c++) {
          rows.add(
            nCol(layout, c, k),
            fitCoefficient(layout.classSeconds[c], layout.classNights[c], day.wakingSeconds, q)
          );
        }
        rows.end(-INF, day.windows - busy(q));
      }
    }

    // The same per-day fit, for the `event` launches against the waking windows before the 2x window's last
    // waking instant: its whole ones, and the part of the one that instant falls in, which holds launches summing
    // to at most `eventWindowPartial` and so, under `u^(q)`, at most `floor((q + 1) * partial / W) / q`, and never
    // more than one window. Only with a window and a sleep window. SPEC.md section 14.
    const isEvent = (c: number) => layout.classVariant[c] === 'event';
    const eventQ = fitQs(
      layout.classSeconds.map((sec, c) => (isEvent(c) ? sec : 0)),
      layout.classNights,
      day.wakingSeconds
    );
    for (let k = 0; k < layout.slots; k++) {
      for (const q of eventQ) {
        rows.begin(`windowfit_k${k}_q${q}`);
        for (let c = 0; c < layout.classes; c++) {
          if (isEvent(c)) {
            rows.add(
              nCol(layout, c, k),
              fitCoefficient(layout.classSeconds[c], layout.classNights[c], day.wakingSeconds, q)
            );
          }
        }
        const partial = Math.floor(((q + 1) * model.eventWindowPartial) / day.wakingSeconds + FIT_INTEGER_TOL) / q;
        rows.end(-INF, model.eventWindowNights + Math.min(1, partial) - busy(q));
      }
    }
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

// A target whose ceiling `theta` is so large that even the grid's floor lies far up the curve, at a score past
// `FLAT_FLOOR_SCORE`, has every cut where `log(1 - e^-s)` is all but flat, and abandoning it costs the envelope
// almost nothing (the deepest cut at 4 prices it at 0.09 nats, at 82 at nothing at all), when the true cost is
// every plan's joint. Such a target's grid is continued below its floor, at the grid's own spacing, down to
// `DEEPEST_CUT_SCORE`, where abandoning it costs about 5.6 nats. See SPEC.md section 15.
export const FLAT_FLOOR_SCORE = 4;
export const DEEPEST_CUT_SCORE = 1e-2;

// `sigmaGrid` itself when its floor is at most `FLAT_FLOOR_SCORE` in score, which is every target whose ceiling is
// under `FLAT_FLOOR_SCORE / floor`; otherwise continued below its floor as above. SPEC.md section 15.
export function extendedGrid(sigmaGrid: readonly number[], theta: number): readonly number[] {
  const sorted = [...sigmaGrid].filter(x => x > 0).sort((a, b) => a - b);
  if (sorted.length < 2 || !(theta * sorted[0] > FLAT_FLOOR_SCORE)) return sigmaGrid;
  const step = sorted[0] / sorted[1];
  if (!(step > 0 && step < 1)) return sigmaGrid;
  const extra: number[] = [];
  let point = sorted[0];
  do {
    point *= step;
    extra.push(point);
  } while (theta * point > DEEPEST_CUT_SCORE);
  return [...sigmaGrid, ...extra];
}

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
    const grid = extendedGrid(sigmaGrid, theta[t]);
    for (let j = 0; j < grid.length; j++) {
      const gridPoint = grid[j];
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
