// Exact 3-slot packing feasibility, owned by the harness and never shared with `lib/mission-optimizer/packing.ts`.
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

// Two-resource packing, for a problem with a sleep window: launch class `j` costs `seconds[j]` waking seconds
// and `nights[j]` sleep windows, and each slot holds at most `capacity` of the first and `nightCapacity` of
// the second. A launch costing no seconds but a night (a short ship launched at bedtime) still consumes that
// night; only launches costing neither are free. `packFeasible` above stays the one-dimensional rule.
export function packFeasibleNights(
  seconds: readonly number[],
  nights: readonly number[],
  counts: readonly number[],
  capacity: number,
  nightCapacity: number,
  slots: number,
  nodeBudget = DEFAULT_NODE_BUDGET
): PackVerdict {
  const cap = capacity > 0 ? capacity : 0;
  const nightCap = nightCapacity > 0 ? nightCapacity : 0;

  // Merge equal (seconds, nights) classes, so the search's branching does not depend on how the caller split them.
  const byClass = new Map<string, { s: number; n: number; c: number }>();
  let totalS = 0;
  let totalN = 0;
  for (let j = 0; j < seconds.length; j++) {
    const c = counts[j];
    if (!(c > 0)) continue;
    const s = seconds[j] > 0 ? seconds[j] : 0;
    const n = nights[j] > 0 ? nights[j] : 0;
    if (s === 0 && n === 0) continue;
    if (s > cap + EPS || n > nightCap + EPS) return 'infeasible';
    totalS += c * s;
    totalN += c * n;
    const key = `${s}|${n}`;
    const known = byClass.get(key);
    if (known) known.c += c;
    else byClass.set(key, { s, n, c });
  }
  const cls = [...byClass.values()];
  if (cls.length === 0) return 'packs';
  if (totalS > slots * cap + EPS || totalN > slots * nightCap + EPS) return 'infeasible';
  let oversizedS = 0;
  let oversizedN = 0;
  for (const k of cls) {
    if (k.s > cap / 2 + EPS) oversizedS += k.c;
    if (k.n > nightCap / 2 + EPS) oversizedN += k.c;
  }
  if (oversizedS > slots || oversizedN > slots) return 'infeasible';

  // Each resource as a share of a slot, so the greedy orders and fits can weigh the two against each other.
  const shareS = (s: number) => (cap > 0 ? s / cap : 0);
  const shareN = (n: number) => (nightCap > 0 ? n / nightCap : 0);

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

  const fitsIn = (k: number, ls: number, ln: number) => ls + cls[k].s <= cap + EPS && ln + cls[k].n <= nightCap + EPS;

  const greedyPack = (order: readonly number[], fit: 'first' | 'best'): boolean => {
    const ls = new Array<number>(slots).fill(0);
    const ln = new Array<number>(slots).fill(0);
    for (const k of order) {
      if (!chargeNode()) return false;
      let choice = -1;
      let choiceRoom = Infinity;
      for (let s = 0; s < slots; s++) {
        if (!fitsIn(k, ls[s], ln[s])) continue;
        if (fit === 'first') {
          choice = s;
          break;
        }
        const room = shareS(cap - ls[s]) + shareN(nightCap - ln[s]);
        if (room < choiceRoom) {
          choiceRoom = room;
          choice = s;
        }
      }
      if (choice < 0) return false;
      ls[choice] += cls[k].s;
      ln[choice] += cls[k].n;
    }
    return true;
  };

  const orders: ((a: number, b: number) => number)[] = [
    (a, b) => shareS(cls[b].s) + shareN(cls[b].n) - (shareS(cls[a].s) + shareN(cls[a].n)) || a - b,
    (a, b) => cls[b].s - cls[a].s || cls[b].n - cls[a].n || a - b,
    (a, b) => cls[b].n - cls[a].n || cls[b].s - cls[a].s || a - b,
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

  const remS = new Array<number>(active.length + 1).fill(0);
  const remN = new Array<number>(active.length + 1).fill(0);
  for (let t = active.length - 1; t >= 0; t--) {
    remS[t] = remS[t + 1] + cls[active[t]].c * cls[active[t]].s;
    remN[t] = remN[t + 1] + cls[active[t]].c * cls[active[t]].n;
  }

  // How many more of class `k` fit in a slot already holding (ls, ln).
  const room = (k: number, ls: number, ln: number): number => {
    const { s, n } = cls[k];
    const bySeconds = s > 0 ? Math.floor((cap - ls + EPS) / s) : Infinity;
    const byNights = n > 0 ? Math.floor((nightCap - ln + EPS) / n) : Infinity;
    return Math.max(0, Math.min(bySeconds, byNights));
  };

  const seenInfeasible = new Set<string>();

  // `loads` is a list of [seconds, nights] pairs kept in lexicographic order: the slot-permutation symmetry
  // break, and what makes the memo key canonical.
  const place = (t: number, loads: [number, number][]): boolean => {
    if (t === active.length) return true;
    if (!chargeNode()) return false;

    const k = active[t];
    let roomS = 0;
    let roomN = 0;
    for (const [ls, ln] of loads) {
      roomS += cap - ls;
      roomN += nightCap - ln;
    }
    if (remS[t] > roomS + EPS || remN[t] > roomN + EPS) return false;

    if (t === active.length - 1) {
      let fits = 0;
      for (const [ls, ln] of loads) fits += room(k, ls, ln);
      return fits >= cls[k].c;
    }

    const key = `${t}|${loads.map(l => `${l[0]}:${l[1]}`).join(',')}`;
    if (seenInfeasible.has(key)) return false;

    const perSlot = new Array<number>(loads.length).fill(0);
    const fill = (s: number, left: number): boolean => {
      if (!chargeNode()) return false;
      const limit = room(k, loads[s][0], loads[s][1]);
      if (s === loads.length - 1) {
        if (left > limit) return false;
        perSlot[s] = left;
        const next = loads
          .map((l, i): [number, number] => [l[0] + perSlot[i] * cls[k].s, l[1] + perSlot[i] * cls[k].n])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
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

  const start: [number, number][] = Array.from({ length: slots }, () => [0, 0]);
  const packs = place(0, start);
  if (exhausted) return 'undecided';
  return packs ? 'packs' : 'infeasible';
}
