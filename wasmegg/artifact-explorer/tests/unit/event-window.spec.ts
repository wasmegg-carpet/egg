// The 2x mission capacity window: `PlanProblem.eventWindowSeconds` and `LaunchOption.variant` in the model, the
// duration classes, the `window_k` and `overhang_k` rows and the certifier. See
// `lib/mission-optimizer/solver/SPEC.md` section 11.

import { describe, expect, it } from 'vitest';
import { buildModel } from 'lib/mission-optimizer/solver/model';
import { buildOaMilp, effectiveQs, layoutOf, scaleLps } from 'lib/mission-optimizer/solver/milp';
import { DEFAULT_TUNING, assertVerified, solveWith } from 'lib/mission-optimizer/solver/solve';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { normalizeProblem, type PlanProblem, type PlanResult } from 'lib/mission-optimizer/solver/types';
import { doubledCopiesOnMenu, slotFault } from 'lib/mission-optimizer/solver/verify';
import type { CapacityVariant, LaunchOption } from 'lib/mission-optimizer/types';
import { craftDag, makeOpt } from './spec-helpers';

// A doubled copy of `opt`, the way the app's and the arena's variant generators make one: the same flight,
// twice the drops.
function doubled(opt: LaunchOption, variant: CapacityVariant): LaunchOption {
  const twice = (m: Map<string, number>) => new Map([...m].map(([k, q]) => [k, 2 * q]));
  return {
    ...opt,
    id: `${opt.id}::${variant}`,
    variant,
    supplyVector: twice(opt.supplyVector),
    yieldVector: twice(opt.yieldVector),
    legendaryYieldVector: twice(opt.legendaryYieldVector),
  };
}

// Each option, then its `event` copy (when it fits the window) and its `overhang` copy.
function withDoubles(options: LaunchOption[], window: number): LaunchOption[] {
  return options.flatMap(o => [
    { ...o, variant: 'normal' as const },
    ...(o.actualTime <= window ? [doubled(o, 'event')] : []),
    doubled(o, 'overhang'),
  ]);
}

function problemOf(options: LaunchOption[], extra: Partial<PlanProblem> = {}): PlanProblem {
  return {
    options,
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 1000,
    timeCapacityPerSlot: 1000,
    slots: 3,
    ownedStock: new Map<string, number>(),
    ...extra,
  };
}

function milpOf(problem: PlanProblem) {
  const model = buildModel(problem);
  const qs = effectiveQs(model);
  return { model, milp: buildOaMilp(model, qs, [1], DEFAULT_TUNING.sigmaGrid), scale: scaleLps(model, qs)(0) };
}

describe('the event window in the model', () => {
  it('keeps a launch and its doubled copies apart, and never merges event into overhang', () => {
    const model = buildModel(problemOf(withDoubles([makeOpt(1, 100, [['B', 1]])], 500), { eventWindowSeconds: 500 }));
    expect(model.groups.map(g => g.variant)).toEqual(['normal', 'event', 'overhang']);
    expect(model.groups.every(g => g.members.length === 1)).toBe(true);
  });

  it('does not prune a launch by its own doubled copy', () => {
    // Regression for the dominance hazard: the doubled copies cost exactly what the normal one does and yield
    // twice as much, so a dominance test blind to the variant drops the normal one, though the window lets the
    // doubled ones fly only a few times per slot. Here only the normal one can fill the slots.
    const model = buildModel(problemOf(withDoubles([makeOpt(1, 10, [['B', 1]])], 10), { eventWindowSeconds: 10 }));
    expect(model.groups.map(g => g.variant).sort()).toEqual(['event', 'normal', 'overhang']);
  });

  it('still prunes within a variant', () => {
    // The fast ship's normal copy beats the slow one's, and so do its doubled copies beat theirs.
    const slow = makeOpt(1, 20, [['B', 1]]);
    const fast = makeOpt(1, 10, [['B', 1]]);
    const model = buildModel(problemOf(withDoubles([slow, fast], 100), { eventWindowSeconds: 100 }));
    expect(model.groups).toHaveLength(3);
    expect(model.groups.every(g => g.timeSeconds === 10)).toBe(true);
  });

  it('drops every doubled option when the problem has no window', () => {
    const options = withDoubles([makeOpt(1, 100, [['B', 1]])], 500);
    for (const extra of [{}, { eventWindowSeconds: 0 }, { eventWindowSeconds: -5 }, { eventWindowSeconds: NaN }]) {
      const model = buildModel(problemOf(options, extra));
      expect(model.eventWindowSeconds).toBe(0);
      expect(model.groups.map(g => g.members)).toEqual([[0]]);
    }
  });

  it('drops an event option longer than the whole window, and a malformed variant', () => {
    const base = makeOpt(1, 100, [['B', 1]]);
    const options = [
      doubled(base, 'event'),
      { ...doubled(base, 'overhang'), variant: 'triple' as unknown as CapacityVariant },
      doubled(base, 'overhang'),
    ];
    const model = buildModel(problemOf(options, { eventWindowSeconds: 99 }));
    expect(model.groups.map(g => g.members)).toEqual([[2]]);
  });

  it('caps a doubled group by the window rows, and keys and bounds classes by variant', () => {
    const options = withDoubles([makeOpt(1, 30, [['B', 1]])], 100);
    const model = buildModel(problemOf(options, { eventWindowSeconds: 100 }));
    const byVariant = Object.fromEntries(model.groups.map(g => [g.variant, g]));
    expect(byVariant.normal.cap).toBe(100);
    expect(byVariant.event.cap).toBe(3 * 3);
    expect(byVariant.overhang.cap).toBe(3);
    const layout = layoutOf(model, 'oa');
    expect(layout.classSeconds).toEqual([30, 30, 30]);
    expect(layout.classVariant).toEqual(['normal', 'event', 'overhang']);
    expect(layout.classCap).toEqual([33, 3, 1]);
  });

  it('writes one window row and one overhang row per slot, over the doubled classes only', () => {
    const options = withDoubles([makeOpt(1, 30, [['B', 1]]), makeOpt(2, 300, [['B', 5]])], 100);
    const { model, milp } = milpOf(problemOf(options, { eventWindowSeconds: 100 }));
    const layout = layoutOf(model, 'oa');
    const rowOf = (name: string) => {
      const r = milp.rowNames.indexOf(name);
      expect(r).toBeGreaterThanOrEqual(0);
      const end = r + 1 < milp.rowCount ? milp.offsets[r + 1] : milp.indices.length;
      const entries: [number, number][] = [];
      for (let i = milp.offsets[r]; i < end; i++) entries.push([milp.indices[i], milp.values[i]]);
      return { entries, upper: milp.rowUpper[r] };
    };
    for (let k = 0; k < 3; k++) {
      const window = rowOf(`window_k${k}`);
      expect(window.upper).toBe(100);
      // The 300-second launch has no event copy at a 100-second window; the 30-second one has.
      expect(window.entries.map(([col, v]) => [layout.classVariant[Math.floor(col / 3)], v])).toEqual([['event', 30]]);
      const overhang = rowOf(`overhang_k${k}`);
      expect(overhang.upper).toBe(1);
      expect(overhang.entries.map(([col, v]) => [layout.classVariant[Math.floor(col / 3)], v])).toEqual([
        ['overhang', 1],
        ['overhang', 1],
      ]);
    }
  });
});

describe('a problem without an event window builds today’s model', () => {
  const menu = (): LaunchOption[] => [
    makeOpt(2, 20, [['B', 1]]),
    makeOpt(1, 30, [['B', 2]]),
    makeOpt(3, 0, [['B', 4]]),
    makeOpt(1, 30, [['B', 2]]),
    makeOpt(5, 300, [['B', 9]]),
  ];

  it('writes no window rows', () => {
    const { milp } = milpOf(problemOf(menu()));
    expect(milp.rowNames.some(name => name.startsWith('window_') || name.startsWith('overhang_'))).toBe(false);
  });

  it('matches, matrix for matrix, the same menu stated as normal variants under a zero or absent window', () => {
    const today = milpOf(problemOf(menu()));
    const variants: [LaunchOption[], Partial<PlanProblem>][] = [
      [menu().map(o => ({ ...o, variant: 'normal' as const })), {}],
      [menu(), { eventWindowSeconds: 0 }],
      [menu().map(o => ({ ...o, variant: 'normal' as const })), { eventWindowSeconds: 0 }],
      // Doubled copies on the menu, appended, with no window to fly them in: dropped, and nothing else moves.
      [[...menu(), ...menu().flatMap(o => [doubled(o, 'event'), doubled(o, 'overhang')])], {}],
      [[...menu(), ...menu().flatMap(o => [doubled(o, 'event'), doubled(o, 'overhang')])], { eventWindowSeconds: 0 }],
    ];
    for (const [options, extra] of variants) {
      const other = milpOf(problemOf(options, extra));
      expect(other.milp).toEqual(today.milp);
      expect(other.scale).toEqual(today.scale);
    }
  });

  it('returns the same plan for a zero window as for an absent one', async () => {
    const solve = await loadHighs();
    const options = [makeOpt(1, 10, [['B', 2]]), makeOpt(2, 20, [['B', 5]])];
    const absent = solveWith(problemOf(options, { fuelCapacity: 50, timeCapacityPerSlot: 100 }), solve);
    const zero = solveWith(
      problemOf(options, { fuelCapacity: 50, timeCapacityPerSlot: 100, eventWindowSeconds: 0 }),
      solve
    );
    expect(zero).toEqual(absent);
  });
});

describe('the event window in the MILP', () => {
  it('flies the normal launch alongside its doubled copies, up to the window', async () => {
    // One 10-second launch, a 10-second window and 100-second slots: per slot, one `event` launch, then the
    // `overhang` at t = 10, then eight more at 1x. Had the doubled copies pruned the normal one, each slot would
    // hold two launches.
    const solve = await loadHighs();
    const options = withDoubles([makeOpt(0, 10, [['B', 1]])], 10);
    const result = solveWith(
      problemOf(options, { timeCapacityPerSlot: 100, eventWindowSeconds: 10 }),
      solve,
      DEFAULT_TUNING
    );
    expect(result.allocation).toEqual([24, 3, 3]);
  });

  it('a window shorter than every launch doubles exactly one launch per slot', async () => {
    const solve = await loadHighs();
    const options = withDoubles([makeOpt(0, 300, [['B', 1]])], 60);
    expect(options.some(o => o.variant === 'event')).toBe(false);
    const result = solveWith(problemOf(options, { eventWindowSeconds: 60 }), solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([6, 3]);
  });

  it('normalizes a negative or non-finite window to none rather than unlimited', () => {
    expect(normalizeProblem(problemOf([], { eventWindowSeconds: -1 })).eventWindowSeconds).toBe(0);
    expect(normalizeProblem(problemOf([], { eventWindowSeconds: Infinity })).eventWindowSeconds).toBe(0);
    expect('eventWindowSeconds' in normalizeProblem(problemOf([]))).toBe(false);
  });
});

// Per option, how often the calendar flies it.
function flown(result: PlanResult): number[] {
  const out = new Array<number>(result.allocation.length).fill(0);
  for (const slot of result.calendar!) for (const l of slot) out[l.option]++;
  return out;
}

describe('every plan comes with its calendar', () => {
  it('without a sleep window: each slot back to back from t = 0, accounting for the allocation', async () => {
    const solve = await loadHighs();
    const problem = problemOf([makeOpt(1, 30, [['B', 1]]), makeOpt(2, 70, [['B', 3]])], { timeCapacityPerSlot: 100 });
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    expect(result.calendar).toHaveLength(3);
    expect(result.layoutStats).toBeUndefined();
    expect(flown(result)).toEqual(result.allocation);
    expect(result.allocation.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    for (const slot of result.calendar!) {
      let at = 0;
      for (const l of slot) {
        expect(l).toMatchObject({ launchAt: at, nights: 0, doubled: false });
        expect(l.optionId).toBe(problem.options[l.option].id);
        at += l.wakingSeconds;
      }
      expect(at).toBeLessThanOrEqual(100);
    }
  });

  // Review repro: fuel for three 10-hour launches on a 30-hour horizon came back as one slot of three.
  it('deals the launches out so the busiest slot is as light as it can be', async () => {
    const solve = await loadHighs();
    const problem = problemOf([makeOpt(1, 10 * 3600, [['B', 1]])], { timeCapacityPerSlot: 30 * 3600, fuelCapacity: 3 });
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([3]);
    expect(result.calendar!.map(slot => slot.map(l => l.launchAt))).toEqual([[0], [0], [0]]);
  });

  it('deals doubled launches with the window rows each slot has to keep', async () => {
    const solve = await loadHighs();
    // Six 1-hour launches against a 2-hour window: two doubled a slot at most (an event and the overhang).
    const options = withDoubles([makeOpt(1, 3600, [['B', 1]])], 7200);
    const problem = problemOf(options, { eventWindowSeconds: 7200, timeCapacityPerSlot: 10 * 3600, fuelCapacity: 6 });
    const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    expect(result.calendar!.map(slot => slot.length)).toEqual([2, 2, 2]);
    for (const slot of result.calendar!) {
      expect(slotFault(slot, { sleepSeconds: 0, horizonSeconds: 10 * 3600 }, 7200)).toBeNull();
      expect(slot.every(l => l.doubled)).toBe(true);
    }
  });

  it('the empty plan has an empty calendar, one slot per slot', async () => {
    const solve = await loadHighs();
    const result = solveWith(problemOf([makeOpt(1, 30, [['B', 1]])], { targets: [] }), solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([0]);
    expect(result.calendar).toEqual([[], [], []]);
  });
});

describe('planning through a 2x capacity window', () => {
  it('flies doubled launches first and inside the window, at most one overhang a slot', async () => {
    const solve = await loadHighs();
    const window = 100;
    const options = withDoubles(
      [makeOpt(1, 30, [['B', 1]]), makeOpt(1, 45, [['B', 2]]), makeOpt(1, 400, [['B', 9]])],
      window
    );
    const problem = problemOf(options, { eventWindowSeconds: window });
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    expect(flown(result)).toEqual(result.allocation);
    for (const slot of result.calendar!) {
      const variants = slot.map(l => options[l.option].variant);
      // Event, then overhang, then normal: the window closes at one cut in the list.
      const rank = { event: 0, overhang: 1, normal: 2 } as const;
      expect(variants.map(v => rank[v!])).toEqual(variants.map(v => rank[v!]).sort((a, b) => a - b));
      expect(variants.filter(v => v === 'overhang').length).toBeLessThanOrEqual(1);
      for (const l of slot) {
        expect(l.doubled).toBe(options[l.option].variant !== 'normal');
        if (l.doubled) expect(l.launchAt).toBeLessThanOrEqual(window);
      }
      expect(slotFault(slot, { sleepSeconds: 0, horizonSeconds: 1000 }, window)).toBeNull();
      // Doubling costs nothing, so every slot fills its window: doubled exactly when it goes up inside it, and the
      // slot's last doubled launch still in the air when the window closes.
      for (const l of slot) expect(l.doubled).toBe(l.launchAt <= window);
      const lastDoubled = slot.filter(l => l.doubled).at(-1)!;
      expect(lastDoubled.launchAt + lastDoubled.wakingSeconds).toBeGreaterThanOrEqual(window);
    }
  });

  it('is never worse off for a longer window', async () => {
    const solve = await loadHighs();
    const menu = [makeOpt(1, 30, [['B', 1]]), makeOpt(3, 200, [['B', 8]])];
    let previous = -1;
    for (const window of [0, 20, 30, 100, 400, 2000]) {
      const result = solveWith(
        problemOf(withDoubles(menu, window), { eventWindowSeconds: window, fuelCapacity: 40 }),
        solve,
        DEFAULT_TUNING,
        { report: true }
      );
      const joint = result.reported!.jointProbability;
      expect(joint).toBeGreaterThanOrEqual(previous);
      previous = joint;
    }
  });
});

describe('the verifier holds doubled launches to the window', () => {
  const day = { sleepSeconds: 0, horizonSeconds: 1000 };
  const launch = (launchAt: number, doubled: boolean) => ({ launchAt, wakingSeconds: 50, nights: 0, doubled });

  it('admits a doubled launch at or before the window, and at its very edge', () => {
    expect(slotFault([launch(0, true), launch(50, true), launch(100, false)], day, 50)).toBeNull();
  });

  it('rejects a doubled launch past the window, and any doubled launch without one', () => {
    expect(slotFault([launch(0, false), launch(50, true)], day, 49)).toMatch(/doubled, but the 2x window closes/);
    expect(slotFault([launch(0, true)], day)).toMatch(/doubled with no 2x window/);
    expect(slotFault([launch(0, true)], day, 0)).toMatch(/doubled with no 2x window/);
  });

  it('rejects a 1x launch inside the window that the menu could have doubled there, and nothing else', () => {
    const copies = { eventCopy: true, overhangCopy: true };
    const plain = (launchAt: number) => ({ ...launch(launchAt, false), ...copies });
    // Event at 0, then a 1x launch at 50 that is the last inside a window of 60: it could have been the overhang.
    expect(slotFault([launch(0, true), plain(50)], day, 60)).toMatch(/at 1x inside the 2x window/);
    // A 1x launch first, a doubled overhang after it: it could have been an event launch.
    expect(slotFault([plain(0), launch(50, true)], day, 60)).toMatch(/at 1x inside the 2x window/);
    // Held to its own copy for its place: an event copy alone does not make the last launch inside a fault.
    expect(slotFault([launch(0, true), { ...plain(50), overhangCopy: false }], day, 60)).toBeNull();
    expect(slotFault([{ ...plain(0), eventCopy: false }, launch(50, true)], day, 60)).toBeNull();
    // At the window's very end, or past it, a 1x launch is not held to it; with no copy on the menu, never.
    expect(slotFault([launch(0, true), plain(60)], day, 60)).toBeNull();
    expect(slotFault([launch(0, false), launch(50, false)], day, 60)).toBeNull();
  });

  it("reads a launch's doubled copies off the menu by its numbers", () => {
    const base = makeOpt(1, 30, [['B', 1]]);
    const options = [...withDoubles([base], 60), makeOpt(1, 30, [['B', 3]]), { ...makeOpt(1, 90, [['B', 1]]) }];
    expect(doubledCopiesOnMenu(options)).toEqual([
      { event: true, overhang: true },
      { event: false, overhang: false },
      { event: false, overhang: false },
      { event: false, overhang: false },
      { event: false, overhang: false },
    ]);
    expect(doubledCopiesOnMenu(withDoubles([makeOpt(1, 90, [['B', 1]])], 60))[0]).toEqual({
      event: false,
      overhang: true,
    });
  });

  it('the solver refuses a window plan whose calendar breaks it, whoever produced it', async () => {
    const solve = await loadHighs();
    const options = withDoubles([makeOpt(1, 30, [['B', 1]])], 60);
    const problem = problemOf(options, { eventWindowSeconds: 60, timeCapacityPerSlot: 300 });
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    const model = buildModel(problem);
    expect(() => assertVerified(problem, model, result.allocation, result.calendar!)).not.toThrow();
    // The same launches, the normal ones first: every doubled launch now goes up after the window, and a 1x launch
    // goes up inside it. The first fault in the slot is the 1x launch at t = 0.
    const late = result.calendar!.map(slot => {
      const reordered = [...slot.filter(l => !l.doubled), ...slot.filter(l => l.doubled)];
      let at = 0;
      return reordered.map(l => ({ ...l, launchAt: (at += l.wakingSeconds) - l.wakingSeconds }));
    });
    expect(() => assertVerified(problem, model, result.allocation, late)).toThrow(/at 1x inside the 2x window/);
    const relabelled = result.calendar!.map(slot => slot.map(l => ({ ...l, doubled: false })));
    expect(() => assertVerified(problem, model, result.allocation, relabelled)).toThrow(/as doubled=false/);
  });
});
