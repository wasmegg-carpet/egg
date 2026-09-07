// Exact 3-bin packing feasibility, returning a witness assignment. Deliberately standalone and imports
// nothing: the arena re-checks every plan against its own packer (invariant C1), which is only meaningful
// while the two implementations stay separate.

// Three mission slots, as the game gives. Exported because it is a property of the game rather than of this packer.
export const NUM_SLOTS = 3;
const EPS = 1e-9;

/**
 * Can `counts[j]` missions of duration `durations[j]` be partitioned into
 * NUM_SLOTS slots of `capacity`?
 *
 * Returns a slot index per mission, grouped by duration index (so
 * `witness[j].length === counts[j]`), or `null` when the multiset provably
 * does not pack, or `undefined` when `nodeBudget` was exhausted — callers fall
 * back to a heuristic packer, so unlike the oracle's version this must never
 * throw.
 */
export function packWitness(
  durations: number[],
  counts: number[],
  capacity: number,
  nodeBudget = 500_000
): number[][] | null | undefined {
  const m = durations.length;
  const witness: number[][] = [];
  for (let j = 0; j < m; j++) witness.push([]);

  // Cheap prefilters, plus the list of duration indices that actually consume
  // slot load. Everything else is decided here and never enters the search.
  const active: number[] = [];
  let total = 0;
  let big = 0;
  for (let j = 0; j < m; j++) {
    const c = counts[j];
    if (!(c > 0)) continue;
    const d = durations[j];
    if (d <= 0) {
      // Zero-length missions occupy no slot load; park them in slot 0.
      for (let k = 0; k < c; k++) witness[j].push(0);
      continue;
    }
    if (d > capacity + EPS) return null;
    total += c * d;
    if (d > capacity / 2 + EPS) big += c;
    active.push(j);
  }
  if (total > NUM_SLOTS * capacity + EPS) return null;
  if (big > NUM_SLOTS) return null;
  if (active.length === 0) return witness;

  // Longest duration first: the hardest missions get placed while the slots are
  // still empty, which is where the search prunes hardest.
  active.sort((a, b) => durations[b] - durations[a]);

  // Only infeasible states are worth memoising: the first `true` propagates straight to the root and ends the
  // search, so a feasible state is never re-queried.
  const infeasible = new Set<string>();
  let nodes = 0;
  let exhausted = false;

  // `loads` is always sorted ascending so the memo key is canonical; `slots`
  // carries the real slot index of each position so the witness can be
  // recorded in caller terms.
  const search = (t: number, loads: number[], slots: number[]): boolean => {
    if (t === active.length) return true;
    if (++nodes > nodeBudget) {
      exhausted = true;
      return false;
    }
    const key = `${t}#${Math.round(loads[0])},${Math.round(loads[1])},${Math.round(loads[2])}`;
    if (infeasible.has(key)) return false;

    const j = active[t];
    const c = counts[j];
    const d = durations[j];
    const room = (l: number) => Math.max(0, Math.floor((capacity - l + EPS) / d));

    const r0 = Math.min(c, room(loads[0]));
    for (let x0 = 0; x0 <= r0; x0++) {
      const rem = c - x0;
      const r1 = Math.min(rem, room(loads[1]));
      for (let x1 = 0; x1 <= r1; x1++) {
        const x2 = rem - x1;
        const l2 = loads[2] + x2 * d;
        if (l2 > capacity + EPS) continue;

        const next = [loads[0] + x0 * d, loads[1] + x1 * d, l2];
        const order = [0, 1, 2].sort((a, b) => next[a] - next[b]);
        const ok = search(
          t + 1,
          [next[order[0]], next[order[1]], next[order[2]]],
          [slots[order[0]], slots[order[1]], slots[order[2]]]
        );
        if (exhausted) return false;
        if (ok) {
          // Only the surviving path ever reaches here, so a plain write is safe.
          const w: number[] = [];
          for (let k = 0; k < x0; k++) w.push(slots[0]);
          for (let k = 0; k < x1; k++) w.push(slots[1]);
          for (let k = 0; k < x2; k++) w.push(slots[2]);
          witness[j] = w;
          return true;
        }
      }
    }

    infeasible.add(key);
    return false;
  };

  const packs = search(0, [0, 0, 0], [0, 1, 2]);
  if (exhausted) return undefined;
  return packs ? witness : null;
}
