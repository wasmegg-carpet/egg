// Exact 3-slot packing feasibility, owned by the harness and never shared with production.
// `counts[j]` missions of length `durations[j]` are feasible iff they partition into `slots` groups summing
// to at most `capacity` each.
//
// Under a 2x mission capacity event there are two more per-slot budgets, decided in the same search
// because they interact with the first:
//
//   * a slot's `event` launches must total at most the seconds of window remaining;
//   * a slot may hold at most one `overhang`, the launch that starts at the window boundary.
//
// This decides whether a legal order exists, which is what the improvement searches (D1, D2, M3) ask of a
// synthesised allocation, and what C1 must not ask. It imports nothing, including the production
// capacity-variant type, and no candidate may import it.

const EPS = 1e-9;

export type PackVerdict = 'packs' | 'infeasible' | 'undecided';

export type PackVariant = 'normal' | 'event' | 'overhang';

export interface EventWindow {
  // Seconds of 2x mission capacity remaining, shared by every slot.
  seconds: number;
  // Parallel to `durations`: what each entry flies as.
  variants: readonly PackVariant[];
}

// How much search a verdict may cost. Raising it can only turn `undecided` into a decision; it never
// moves `packs` and `infeasible` between themselves, so the goalpost does not shift when it moves.
const DEFAULT_NODE_BUDGET = 50_000_000;

// A slot's three budgets, in seconds of flight except for the count of boundary launches.
interface Bin {
  load: number;
  eventLoad: number;
  overhangs: number;
}

const emptyBins = (slots: number): Bin[] =>
  Array.from({ length: slots }, () => ({ load: 0, eventLoad: 0, overhangs: 0 }));

// Slots are interchangeable under all three budgets, so ordering them makes the memo key canonical and
// breaks the permutation symmetry. Exact values, never rounded: the memo records infeasibility, so two
// distinct states sharing a key would report a packable plan as infeasible; durations are mission
// seconds and routinely fractional.
const canonical = (bins: readonly Bin[]): Bin[] =>
  bins.map(b => ({ ...b })).sort((a, b) => a.load - b.load || a.eventLoad - b.eventLoad || a.overhangs - b.overhangs);

const keyOf = (t: number, bins: readonly Bin[]): string =>
  `${t}|${bins.map(b => `${b.load},${b.eventLoad},${b.overhangs}`).join(';')}`;

export function packFeasible(
  durations: readonly number[],
  counts: readonly number[],
  capacity: number,
  slots: number,
  nodeBudget = DEFAULT_NODE_BUDGET,
  window?: EventWindow
): PackVerdict {
  const windowSeconds = window && window.seconds > 0 ? window.seconds : 0;
  const variantAt = (j: number): PackVariant => (windowSeconds > 0 ? (window!.variants[j] ?? 'normal') : 'normal');

  // How many more of duration `d` at `variant` this bin can take, across all three budgets at once.
  const room = (bin: Bin, d: number, variant: PackVariant): number => {
    let n = d > 0 ? Math.floor((capacity - bin.load + EPS) / d) : Infinity;
    if (variant === 'event' && d > 0) n = Math.min(n, Math.floor((windowSeconds - bin.eventLoad + EPS) / d));
    if (variant === 'overhang') n = Math.min(n, 1 - bin.overhangs);
    return Math.max(0, n);
  };

  const put = (bin: Bin, d: number, variant: PackVariant, x: number): Bin => ({
    load: bin.load + x * d,
    eventLoad: bin.eventLoad + (variant === 'event' ? x * d : 0),
    overhangs: bin.overhangs + (variant === 'overhang' ? x : 0),
  });

  if (!(capacity > 0)) {
    // An overhang is still a launch, so it is infeasible here even at zero duration.
    const idle = durations.every((d, j) => !(counts[j] > 0) || (d <= 0 && variantAt(j) !== 'overhang'));
    return idle ? 'packs' : 'infeasible';
  }

  // Duration alone does not distinguish a mission: an `event` and an `overhang` of the same length are
  // the same flight against different budgets.
  const byClass = new Map<string, number>();
  let totalLoad = 0;
  let totalEventLoad = 0;
  let totalOverhangs = 0;
  for (let j = 0; j < durations.length; j++) {
    const c = counts[j];
    if (!(c > 0)) continue;
    const d = durations[j];
    const variant = variantAt(j);
    if (d > capacity + EPS) return 'infeasible';
    // An `event` launch longer than the whole window cannot start inside it under any arrangement.
    if (variant === 'event' && d > windowSeconds + EPS) return 'infeasible';
    if (variant === 'overhang') totalOverhangs += c;
    if (d <= 0 && variant !== 'overhang') continue;
    totalLoad += c * d;
    if (variant === 'event') totalEventLoad += c * d;
    const key = `${d}|${variant}`;
    byClass.set(key, (byClass.get(key) ?? 0) + c);
  }

  const dur: number[] = [];
  const cnt: number[] = [];
  const vnt: PackVariant[] = [];
  const active: number[] = [];
  for (const [key, c] of byClass) {
    const cut = key.lastIndexOf('|');
    active.push(dur.length);
    dur.push(Number(key.slice(0, cut)));
    cnt.push(c);
    vnt.push(key.slice(cut + 1) as PackVariant);
  }

  if (totalLoad > slots * capacity + EPS) return 'infeasible';
  if (windowSeconds > 0 && totalEventLoad > slots * windowSeconds + EPS) return 'infeasible';
  if (totalOverhangs > slots) return 'infeasible';
  let oversized = 0;
  for (const j of active) {
    if (dur[j] > capacity / 2 + EPS) oversized += cnt[j];
  }
  if (oversized > slots) return 'infeasible';
  if (active.length === 0) return 'packs';

  let nodes = 0;
  let exhausted = false;

  const items: { d: number; variant: PackVariant }[] = [];
  for (const j of active) for (let k = 0; k < cnt[j]; k++) items.push({ d: dur[j], variant: vnt[j] });

  const chargeNode = (): boolean => {
    if (exhausted) return false;
    if (++nodes > nodeBudget) {
      exhausted = true;
      return false;
    }
    return true;
  };

  // First-fit-decreasing and best-fit-decreasing over the same order.
  const greedyPack = (order: readonly { d: number; variant: PackVariant }[], fit: 'first' | 'best'): boolean => {
    const bins = emptyBins(slots);
    for (const it of order) {
      if (!chargeNode()) return false;
      let choice = -1;
      let choiceRoom = Infinity;
      for (let s = 0; s < slots; s++) {
        if (room(bins[s], it.d, it.variant) < 1) continue;
        if (fit === 'first') {
          choice = s;
          break;
        }
        const slack = capacity - bins[s].load;
        if (slack < choiceRoom) {
          choiceRoom = slack;
          choice = s;
        }
      }
      if (choice < 0) return false;
      bins[choice] = put(bins[choice], it.d, it.variant, 1);
    }
    return true;
  };

  // Doubled launches first, then longest: they have two budgets to satisfy rather than one.
  const rank = (v: PackVariant) => (v === 'overhang' ? 0 : v === 'event' ? 1 : 2);
  const descending = items.slice().sort((a, b) => rank(a.variant) - rank(b.variant) || b.d - a.d);
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
  for (let j = 1; j < cnt.length; j++) {
    if (cnt[j] > cnt[last] || (cnt[j] === cnt[last] && dur[j] < dur[last])) last = j;
  }
  active.sort((a, b) => (a === last ? 1 : b === last ? -1 : dur[b] - dur[a]));

  const remaining = new Array<number>(active.length + 1).fill(0);
  for (let t = active.length - 1; t >= 0; t--) {
    remaining[t] = remaining[t + 1] + cnt[active[t]] * dur[active[t]];
  }

  const seenInfeasible = new Set<string>();

  const place = (t: number, bins: Bin[]): boolean => {
    if (t === active.length) return true;
    if (++nodes > nodeBudget) {
      exhausted = true;
      return false;
    }

    const j = active[t];
    const d = dur[j];
    const variant = vnt[j];

    let slack = 0;
    for (const b of bins) slack += capacity - b.load;
    if (remaining[t] > slack + EPS) return false;

    if (t === active.length - 1) {
      let fits = 0;
      for (const b of bins) fits += room(b, d, variant);
      return fits >= cnt[j];
    }

    const key = keyOf(t, bins);
    if (seenInfeasible.has(key)) return false;

    const perBin = new Array<number>(bins.length).fill(0);
    const fill = (s: number, left: number): boolean => {
      // Charged here too, not just in `place`, or `nodeBudget` does not bound the search.
      if (++nodes > nodeBudget) {
        exhausted = true;
        return false;
      }
      if (s === bins.length - 1) {
        if (room(bins[s], d, variant) < left) return false;
        perBin[s] = left;
        const next = canonical(bins.map((b, i) => put(b, d, variant, perBin[i])));
        const ok = place(t + 1, next);
        return exhausted ? false : ok;
      }
      const cap = Math.min(left, room(bins[s], d, variant));
      for (let x = cap; x >= 0; x--) {
        perBin[s] = x;
        if (fill(s + 1, left - x)) return true;
        if (exhausted) return false;
      }
      perBin[s] = 0;
      return false;
    };

    if (fill(0, cnt[j])) return true;
    if (exhausted) return false;

    seenInfeasible.add(key);
    return false;
  };

  const packs = place(0, emptyBins(slots));
  if (exhausted) return 'undecided';
  return packs ? 'packs' : 'infeasible';
}
