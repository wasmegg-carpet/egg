// Exact 3-slot packing feasibility, owned by the harness and never shared with production, which has no packer.
// `counts[j]` missions of length `durations[j]` are feasible iff they partition into `slots` groups summing to at most `capacity` each.

const EPS = 1e-9;

export type PackVerdict = 'packs' | 'infeasible' | 'undecided';

// How much search a verdict may cost. Raising it can only turn `undecided` into a decision; it never
// moves `packs` and `infeasible` between themselves, so the goalpost does not shift when it moves.
const DEFAULT_NODE_BUDGET = 50_000_000;

export function packFeasible(
  durations: readonly number[],
  counts: readonly number[],
  capacity: number,
  slots: number,
  nodeBudget = DEFAULT_NODE_BUDGET
): PackVerdict {
  if (!(capacity > 0)) {
    return durations.every((d, j) => !(counts[j] > 0) || d <= 0) ? 'packs' : 'infeasible';
  }

  const byDuration = new Map<number, number>();
  let totalLoad = 0;
  for (let j = 0; j < durations.length; j++) {
    const c = counts[j];
    if (!(c > 0)) continue;
    const d = durations[j];
    if (d <= 0) continue;
    if (d > capacity + EPS) return 'infeasible';
    totalLoad += c * d;
    byDuration.set(d, (byDuration.get(d) ?? 0) + c);
  }
  const active: number[] = [];
  const dur: number[] = [];
  const cnt: number[] = [];
  for (const [d, c] of byDuration) {
    active.push(dur.length);
    dur.push(d);
    cnt.push(c);
  }
  durations = dur;
  counts = cnt;

  if (totalLoad > slots * capacity + EPS) return 'infeasible';
  let oversized = 0;
  for (const j of active) {
    if (durations[j] > capacity / 2 + EPS) oversized += counts[j];
  }
  if (oversized > slots) return 'infeasible';
  if (active.length === 0) return 'packs';

  let nodes = 0;
  let exhausted = false;

  const items: number[] = [];
  for (const j of active) for (let k = 0; k < counts[j]; k++) items.push(durations[j]);

  const chargeNode = (): boolean => {
    if (exhausted) return false;
    if (++nodes > nodeBudget) {
      exhausted = true;
      return false;
    }
    return true;
  };

  // First-fit-decreasing and best-fit-decreasing over the same order.
  const greedyPack = (order: readonly number[], fit: 'first' | 'best'): boolean => {
    const loads = new Array<number>(slots).fill(0);
    for (const it of order) {
      if (!chargeNode()) return false;
      let choice = -1;
      let choiceRoom = Infinity;
      for (let s = 0; s < slots; s++) {
        const room = capacity - loads[s];
        if (room + EPS < it) continue;
        if (fit === 'first') {
          choice = s;
          break;
        }
        if (room < choiceRoom) {
          choiceRoom = room;
          choice = s;
        }
      }
      if (choice < 0) return false;
      loads[choice] += it;
    }
    return true;
  };

  const descending = items.slice().sort((a, b) => b - a);
  if (greedyPack(descending, 'best')) return 'packs';
  if (exhausted) return 'undecided';
  if (greedyPack(descending, 'first')) return 'packs';
  if (exhausted) return 'undecided';

  let seed = 0x2545f491;
  const nextRand = (): number => {
    // xorshift32; deterministic, no `Math.random`.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed |= 0;
    return ((seed >>> 0) % 0x100000000) / 0x100000000;
  };
  for (let restart = 0; restart < 3; restart++) {
    const shuffled = descending.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const k = Math.floor(nextRand() * (i + 1));
      [shuffled[i], shuffled[k]] = [shuffled[k], shuffled[i]];
    }
    if (greedyPack(shuffled, 'best')) return 'packs';
    if (exhausted) return 'undecided';
  }

  // Longest first, except that the largest count is pinned last: the final group is decided by
  // arithmetic in `place` rather than enumerated, so it is the one whose count would cost most.
  let last = 0;
  for (let j = 1; j < counts.length; j++) {
    if (counts[j] > counts[last] || (counts[j] === counts[last] && durations[j] < durations[last])) last = j;
  }
  active.sort((a, b) => (a === last ? 1 : b === last ? -1 : durations[b] - durations[a]));

  const remaining = new Array<number>(active.length + 1).fill(0);
  for (let t = active.length - 1; t >= 0; t--) {
    remaining[t] = remaining[t + 1] + counts[active[t]] * durations[active[t]];
  }

  const seenInfeasible = new Set<string>();

  // `loads` stays sorted ascending: it breaks the slot-permutation symmetry and makes the memo key canonical.
  const place = (t: number, loads: number[]): boolean => {
    if (t === active.length) return true;
    if (++nodes > nodeBudget) {
      exhausted = true;
      return false;
    }

    const j = active[t];
    const d = durations[j];

    let room = 0;
    for (const l of loads) room += capacity - l;
    if (remaining[t] > room + EPS) return false;

    if (t === active.length - 1) {
      let fits = 0;
      for (const l of loads) fits += Math.floor((capacity - l + EPS) / d);
      return fits >= counts[j];
    }

    // Exact loads, not rounded. The memo records infeasibility, so two distinct states sharing a key
    // would report a packable plan as infeasible; durations are mission seconds and routinely fractional.
    const key = `${t}|${loads.join(',')}`;
    if (seenInfeasible.has(key)) return false;

    const perSlot = new Array<number>(loads.length).fill(0);
    const fill = (s: number, left: number): boolean => {
      // Charged here too, not just in `place`, or `nodeBudget` does not bound the search.
      if (++nodes > nodeBudget) {
        exhausted = true;
        return false;
      }
      if (s === loads.length - 1) {
        if (loads[s] + left * d > capacity + EPS) return false;
        perSlot[s] = left;
        const next = loads.map((l, i) => l + perSlot[i] * d).sort((a, b) => a - b);
        const ok = place(t + 1, next);
        return exhausted ? false : ok;
      }
      const cap = Math.min(left, Math.floor((capacity - loads[s] + EPS) / d));
      for (let x = cap; x >= 0; x--) {
        perSlot[s] = x;
        if (fill(s + 1, left - x)) return true;
        if (exhausted) return false;
      }
      perSlot[s] = 0;
      return false;
    };

    if (fill(0, counts[j])) return true;
    if (exhausted) return false;

    seenInfeasible.add(key);
    return false;
  };

  const start = new Array<number>(slots).fill(0);
  const packs = place(0, start);
  if (exhausted) return 'undecided';
  return packs ? 'packs' : 'infeasible';
}

// Several budgets per slot at once: launch class `j` costs `costs[j][r]` of budget `r`, and each slot holds at most
// `capacities[r]` of each. The harness states a sleep window as two budgets (waking seconds, nights) and a 2x
// capacity window as two more (`event` seconds against the window, `overhang` launches against one), and asks
// this whether one arrangement satisfies them all; they interact, so they are decided in one search. A launch
// costing nothing of any budget is free; one costing anything is not (a short ship launched at bedtime costs no
// waking time and still a night; a zero-second `overhang` still takes the slot's one). `packFeasible` above
// stays the one-dimensional rule.
export function packFeasibleBudgets(
  costs: readonly (readonly number[])[],
  counts: readonly number[],
  capacities: readonly number[],
  slots: number,
  nodeBudget = DEFAULT_NODE_BUDGET
): PackVerdict {
  const R = capacities.length;
  const caps = capacities.map(c => (c > 0 ? c : 0));

  // Merge equal cost vectors, so the search's branching does not depend on how the caller split them.
  const byClass = new Map<string, { cost: number[]; c: number }>();
  const totals = new Array<number>(R).fill(0);
  for (let j = 0; j < costs.length; j++) {
    const c = counts[j];
    if (!(c > 0)) continue;
    const cost = caps.map((_, r) => (costs[j][r] > 0 ? costs[j][r] : 0));
    if (cost.every(v => v === 0)) continue;
    if (cost.some((v, r) => v > caps[r] + EPS)) return 'infeasible';
    cost.forEach((v, r) => (totals[r] += c * v));
    const key = cost.join('|');
    const known = byClass.get(key);
    if (known) known.c += c;
    else byClass.set(key, { cost, c });
  }
  const cls = [...byClass.values()];
  if (cls.length === 0) return 'packs';
  if (totals.some((t, r) => t > slots * caps[r] + EPS)) return 'infeasible';
  for (let r = 0; r < R; r++) {
    let oversized = 0;
    for (const k of cls) if (k.cost[r] > caps[r] / 2 + EPS) oversized += k.c;
    if (oversized > slots) return 'infeasible';
  }

  // Each budget as a share of a slot, so the greedy orders and fits can weigh them against each other.
  const share = (r: number, v: number) => (caps[r] > 0 ? v / caps[r] : 0);
  const shareOf = (k: number) => cls[k].cost.reduce((a, v, r) => a + share(r, v), 0);

  let nodes = 0;
  let exhausted = false;
  const chargeNode = (): boolean => {
    if (exhausted) return false;
    if (++nodes > nodeBudget) {
      exhausted = true;
      return false;
    }
    return true;
  };

  const items: number[] = [];
  for (let k = 0; k < cls.length; k++) for (let i = 0; i < cls[k].c; i++) items.push(k);

  const fitsIn = (k: number, load: readonly number[]) => cls[k].cost.every((v, r) => load[r] + v <= caps[r] + EPS);

  const greedyPack = (order: readonly number[], fit: 'first' | 'best'): boolean => {
    const loads = Array.from({ length: slots }, () => new Array<number>(R).fill(0));
    for (const k of order) {
      if (!chargeNode()) return false;
      let choice = -1;
      let choiceRoom = Infinity;
      for (let s = 0; s < slots; s++) {
        if (!fitsIn(k, loads[s])) continue;
        if (fit === 'first') {
          choice = s;
          break;
        }
        const room = loads[s].reduce((a, l, r) => a + share(r, caps[r] - l), 0);
        if (room < choiceRoom) {
          choiceRoom = room;
          choice = s;
        }
      }
      if (choice < 0) return false;
      cls[k].cost.forEach((v, r) => (loads[choice][r] += v));
    }
    return true;
  };

  // Largest combined share first; then, per budget, largest on that budget first, the others breaking ties in
  // budget order. With two budgets these are the combined, seconds-first and nights-first orders.
  const byBudget = (first: number) => (a: number, b: number) => {
    const d = cls[b].cost[first] - cls[a].cost[first];
    if (d !== 0) return d;
    for (let r = 0; r < R; r++) {
      if (r !== first && cls[b].cost[r] !== cls[a].cost[r]) return cls[b].cost[r] - cls[a].cost[r];
    }
    return a - b;
  };
  const orders: ((a: number, b: number) => number)[] = [
    (a, b) => shareOf(b) - shareOf(a) || a - b,
    ...caps.map((_, r) => byBudget(r)),
  ];
  for (const cmp of orders) {
    const order = items.slice().sort(cmp);
    if (greedyPack(order, 'best')) return 'packs';
    if (exhausted) return 'undecided';
    if (greedyPack(order, 'first')) return 'packs';
    if (exhausted) return 'undecided';
  }

  // The exact search, shaped like the one-dimensional one: class by class, largest share first, the
  // largest count pinned last and decided by arithmetic.
  const active = cls.map((_, k) => k);
  let last = 0;
  for (let k = 1; k < cls.length; k++) {
    if (cls[k].c > cls[last].c) last = k;
  }
  active.sort((a, b) => (a === last ? 1 : b === last ? -1 : orders[0](a, b)));

  const remaining = Array.from({ length: active.length + 1 }, () => new Array<number>(R).fill(0));
  for (let t = active.length - 1; t >= 0; t--) {
    const k = active[t];
    for (let r = 0; r < R; r++) remaining[t][r] = remaining[t + 1][r] + cls[k].c * cls[k].cost[r];
  }

  // How many more of class `k` fit in a slot already holding `load`.
  const room = (k: number, load: readonly number[]): number => {
    let n = Infinity;
    cls[k].cost.forEach((v, r) => {
      if (v > 0) n = Math.min(n, Math.floor((caps[r] - load[r] + EPS) / v));
    });
    return Math.max(0, n);
  };

  const lexicographic = (a: readonly number[], b: readonly number[]) => {
    for (let r = 0; r < R; r++) if (a[r] !== b[r]) return a[r] - b[r];
    return 0;
  };

  const seenInfeasible = new Set<string>();

  // `loads` is a list of per-slot budget vectors kept in lexicographic order: the slot-permutation symmetry break,
  // and what makes the memo key canonical.
  const place = (t: number, loads: number[][]): boolean => {
    if (t === active.length) return true;
    if (!chargeNode()) return false;

    const k = active[t];
    for (let r = 0; r < R; r++) {
      let free = 0;
      for (const load of loads) free += caps[r] - load[r];
      if (remaining[t][r] > free + EPS) return false;
    }

    if (t === active.length - 1) {
      let fits = 0;
      for (const load of loads) fits += room(k, load);
      return fits >= cls[k].c;
    }

    const key = `${t}|${loads.map(l => l.join(':')).join(',')}`;
    if (seenInfeasible.has(key)) return false;

    const perSlot = new Array<number>(loads.length).fill(0);
    const fill = (s: number, left: number): boolean => {
      if (!chargeNode()) return false;
      const limit = room(k, loads[s]);
      if (s === loads.length - 1) {
        if (left > limit) return false;
        perSlot[s] = left;
        const next = loads.map((l, i) => l.map((v, r) => v + perSlot[i] * cls[k].cost[r])).sort(lexicographic);
        const ok = place(t + 1, next);
        return exhausted ? false : ok;
      }
      for (let x = Math.min(left, limit); x >= 0; x--) {
        perSlot[s] = x;
        if (fill(s + 1, left - x)) return true;
        if (exhausted) return false;
      }
      perSlot[s] = 0;
      return false;
    };

    if (fill(0, cls[k].c)) return true;
    if (exhausted) return false;

    seenInfeasible.add(key);
    return false;
  };

  const start = Array.from({ length: slots }, () => new Array<number>(R).fill(0));
  const packs = place(0, start);
  if (exhausted) return 'undecided';
  return packs ? 'packs' : 'infeasible';
}
