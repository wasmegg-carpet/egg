import { describe, it, expect } from 'vitest';
import { packWitness } from '@/lib/packing';

const NUM_SLOTS = 3;
const TOL = 1e-9;

// Independent oracle: expand the multiset into individual missions and try every mission in every slot.
// Nothing is shared with `packWitness`, so agreement is real evidence.
function bruteForcePacks(durations: number[], counts: number[], capacity: number): boolean {
  const items: number[] = [];
  for (let j = 0; j < durations.length; j++) {
    if (durations[j] <= 0) continue; // no slot load
    for (let k = 0; k < counts[j]; k++) items.push(durations[j]);
  }
  const loads = [0, 0, 0];
  const place = (i: number): boolean => {
    if (i === items.length) return true;
    for (let s = 0; s < NUM_SLOTS; s++) {
      if (loads[s] + items[i] <= capacity + TOL) {
        loads[s] += items[i];
        if (place(i + 1)) return true;
        loads[s] -= items[i];
      }
    }
    return false;
  };
  return place(0);
}

// Same shape as the oracle generator's PRNG, so a failing case reproduces from
// its index alone.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns a description of the first defect, or null. Plain code rather than
// `expect` so the 20k-case loop stays cheap; callers assert on the result.
function witnessDefect(witness: number[][], durations: number[], counts: number[], capacity: number): string | null {
  if (witness.length !== durations.length) {
    return `witness has ${witness.length} groups, expected ${durations.length}`;
  }
  const loads = [0, 0, 0];
  for (let j = 0; j < durations.length; j++) {
    const want = Math.max(0, counts[j]);
    if (witness[j].length !== want) {
      return `witness[${j}] has ${witness[j].length} missions, expected ${want}`;
    }
    for (const s of witness[j]) {
      if (!Number.isInteger(s) || s < 0 || s >= NUM_SLOTS) {
        return `witness[${j}] contains invalid slot index ${s}`;
      }
      if (durations[j] > 0) loads[s] += durations[j];
    }
  }
  for (let s = 0; s < NUM_SLOTS; s++) {
    if (loads[s] > capacity + TOL) return `slot ${s} load ${loads[s]} exceeds capacity ${capacity}`;
  }
  return null;
}

function expectValidWitness(witness: number[][], durations: number[], counts: number[], capacity: number): void {
  expect(witnessDefect(witness, durations, counts, capacity)).toBeNull();
}

describe('packWitness', () => {
  it('agrees with brute force on 20k random multisets and always returns a valid witness', () => {
    const CASES = 50_000;
    const rng = mulberry32(0x5eed);
    let mismatches = 0;
    let packed = 0;
    let rejected = 0;
    const failures: string[] = [];

    for (let c = 0; c < CASES; c++) {
      const m = 2 + Math.floor(rng() * 3); // 2-4 distinct durations
      const durations: number[] = [];
      const counts: number[] = [];
      let remaining = 8; // <= 8 missions keeps brute force cheap
      for (let j = 0; j < m; j++) {
        // ~5% zero-length durations, which must consume no slot load.
        durations.push(rng() < 0.05 ? 0 : 1 + Math.floor(rng() * 12));
        const k = Math.min(remaining, Math.floor(rng() * 4));
        counts.push(k);
        remaining -= k;
      }
      const capacity = 5 + Math.floor(rng() * 21);

      const shape = () =>
        `case ${c}: durations=${JSON.stringify(durations)} counts=${JSON.stringify(counts)} capacity=${capacity}`;

      const expected = bruteForcePacks(durations, counts, capacity);
      const actual = packWitness(durations, counts, capacity);
      if (actual === undefined) {
        // These instances are far too small to exhaust the default node budget.
        if (failures.length < 3) failures.push(`${shape()}: unexpected budget exhaustion`);
        continue;
      }

      if ((actual !== null) !== expected) {
        mismatches++;
        if (failures.length < 3) {
          failures.push(`${shape()}: brute=${expected} packWitness=${actual !== null}`);
        }
        continue;
      }
      if (actual === null) {
        rejected++;
      } else {
        packed++;
        const defect = witnessDefect(actual, durations, counts, capacity);
        if (defect !== null && failures.length < 3) failures.push(`${shape()}: ${defect}`);
      }
    }

    expect(failures.join('\n')).toBe('');
    expect(mismatches).toBe(0);
    // Sanity: the generator must produce both verdicts, or agreement is vacuous.
    expect(packed).toBeGreaterThan(1000);
    expect(rejected).toBeGreaterThan(1000);
  }, 60_000);

  it('rejects a duration exceeding capacity', () => {
    expect(packWitness([50, 3], [1, 2], 40)).toBeNull();
  });

  it('rejects a total exceeding 3 * capacity', () => {
    expect(packWitness([10], [31], 100)).toBeNull();
  });

  it('rejects four missions each longer than half capacity', () => {
    expect(packWitness([60], [4], 100)).toBeNull();
    const w = packWitness([60], [3], 100);
    expect(w).not.toBeNull();
    expectValidWitness(w!, [60], [3], 100);
    expect([...w![0]].sort()).toEqual([0, 1, 2]);
  });

  it('handles zero counts', () => {
    const w = packWitness([10, 25, 7], [2, 0, 1], 30);
    expect(w).not.toBeNull();
    expect(w![1]).toEqual([]);
    expectValidWitness(w!, [10, 25, 7], [2, 0, 1], 30);
  });

  it('gives zero-length durations a slot without consuming capacity', () => {
    const durations = [0, -5, 100];
    const counts = [4, 2, 3];
    const w = packWitness(durations, counts, 100);
    expect(w).not.toBeNull();
    expect(w![0]).toEqual([0, 0, 0, 0]);
    expect(w![1]).toEqual([0, 0]);
    expectValidWitness(w!, durations, counts, 100);
  });

  it('handles empty input and all-zero counts', () => {
    expect(packWitness([], [], 100)).toEqual([]);
    expect(packWitness([10, 20], [0, 0], 100)).toEqual([[], []]);
  });

  it('packs an exact-fit multiset', () => {
    const durations = [7, 5, 3];
    const counts = [3, 3, 3];
    const w = packWitness(durations, counts, 15);
    expect(w).not.toBeNull();
    expectValidWitness(w!, durations, counts, 15);
  });

  it('returns undefined without throwing when the node budget is exhausted', () => {
    // A hard instance the prefilters cannot decide, with a budget of one node.
    const durations = [7, 5, 3, 2];
    const counts = [3, 3, 3, 3];
    let result: number[][] | null | undefined;
    expect(() => {
      result = packWitness(durations, counts, 17, 1);
    }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it('still answers from the prefilters when the budget is tiny', () => {
    expect(packWitness([500], [1], 100, 1)).toBeNull();
  });
});
