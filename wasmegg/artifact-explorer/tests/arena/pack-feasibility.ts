// Exact 3-slot packing feasibility, owned by the harness and never shared with `src/lib/packing.ts`.
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
