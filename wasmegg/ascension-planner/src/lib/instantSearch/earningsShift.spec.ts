/** The earnings shift from a save's artifacts, and the table read with it (table.ts `shiftedLookup`). */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AfxName, AfxRarity, invArtifact, invStone, syntheticBackup } from '@/auto/loadout/testBackup';
import { MAXED_DELIVERY, maxedLoadoutInputs } from '@/buildTable/maxedAccount';
import { chainFinderLoadoutFromBackup, deliveryMatchesTable, earningsShift } from './earningsShift';
import { canonicalDelivered, rebase, tailTo } from './precomputedLeg';
import { readTable, shiftedLookup } from './table';

const gz = readFileSync(new URL('../../../public/instant/table.bin.gz', import.meta.url));
const bytes = gunzipSync(gz);
const table = readTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** A pro-permit save with the four earnings artifacts at `tiers` (T4L unless named) and 12 T4 lunar stones. */
function save(downgrade: Partial<Record<'ankh' | 'necklace' | 'totem' | 'cube', [number, number]>> = {}) {
  const at = (k: keyof typeof downgrade): [number, number] => downgrade[k] ?? [4, AfxRarity.LEGENDARY];
  const backup = syntheticBackup([
    invArtifact(AfxName.TUNGSTEN_ANKH, ...at('ankh')),
    invArtifact(AfxName.DEMETERS_NECKLACE, ...at('necklace')),
    invArtifact(AfxName.LUNAR_TOTEM, ...at('totem')),
    invArtifact(AfxName.PUZZLE_CUBE, ...at('cube')),
    invStone(AfxName.LUNAR_STONE, 4, 12),
  ]);
  backup.game = { ...backup.game, permitLevel: 1 };
  return chainFinderLoadoutFromBackup(backup);
}

describe('earningsShift', () => {
  it('is 0 for the artifacts the table was built with, and without a save', () => {
    expect(earningsShift(save(), table.header)).toBe(0);
    expect(earningsShift(null, table.header)).toBe(0);
  });

  it('is the Clothed TE a weaker artifact gives up', () => {
    expect(earningsShift(save({ ankh: [3, AfxRarity.LEGENDARY] }), table.header)).toBeCloseTo(2.34, 2);
    expect(earningsShift(save({ cube: [4, AfxRarity.EPIC] }), table.header)).toBeCloseTo(4.77, 2);
  });

  it('follows edits: an artifact swapped by hand, or fewer stones', () => {
    const inputs = maxedLoadoutInputs();
    expect(earningsShift(inputs, table.header)).toBe(0);
    const ankh = inputs.earnings.findIndex(s => s.artifactId === 'tungsten-ankh-4-3');
    inputs.earnings[ankh] = { artifactId: 'tungsten-ankh-3-3', stones: [null, null, null] };
    expect(earningsShift(inputs, table.header)).toBeCloseTo(2.34, 2);
    const noStones = maxedLoadoutInputs();
    noStones.stones.lunar[4] = 0;
    noStones.stones.shell[4] = 0;
    expect(earningsShift(noStones, table.header)).toBeCloseTo(42.36, 1);
  });
});

describe('deliveryMatchesTable', () => {
  it("matches the table's delivery set in any order, and not another; anything, for a table that doesn't say", () => {
    const header = { delivery: [...MAXED_DELIVERY] };
    const inputs = maxedLoadoutInputs();
    expect(deliveryMatchesTable(inputs, header)).toBe(true);
    if (inputs.delivery.mode !== 'fixed') throw new Error('maxed delivery is fixed');
    inputs.delivery.artifactIds.reverse();
    expect(deliveryMatchesTable(inputs, header)).toBe(true);
    // reversed: [totem, gusset, compass, metronome]
    inputs.delivery.artifactIds[0] = 'puzzle-cube-4-3';
    expect(deliveryMatchesTable(inputs, header)).toBe(true);
    inputs.delivery.artifactIds[3] = 'quantum-metronome-4-2';
    expect(deliveryMatchesTable(inputs, header)).toBe(false);
    expect(deliveryMatchesTable(inputs, {})).toBe(true);
  });
});

describe('shiftedLookup', () => {
  it('is the table itself with no shift', () => {
    expect(shiftedLookup(table, 0)).toBe(table.lookup);
  });

  it("reads the row the shift lower, rounded down, from the real TE's counts", () => {
    const lookup = shiftedLookup(table, 2.34);
    expect(lookup.shift).toBe(2.34);
    for (const h of [0, 57, 130]) {
      const raw = table.lookup(197, h)!;
      const builds = lookup(200, h)!;
      expect(builds).toHaveLength(raw.length);
      for (const [j, b] of builds.entries()) {
        // The same build, with the eggs it delivers itself on top of TE 200's counts.
        expect({ ...b, delivered: undefined }).toEqual({ ...raw[j], delivered: undefined });
        const canon = canonicalDelivered(200);
        b.delivered.forEach((d, e) =>
          expect(d - canon[e]).toBeCloseTo(raw[j].delivered[e] - canonicalDelivered(197)[e], 0)
        );
        // Rebased onto real counts and priced, it stops at real TEs.
        const real = [...canon];
        real[j % 5] += 1e15;
        const tail = tailTo(rebase(b, 200, real), 260);
        if (tail) expect(tail.endTE).toBeGreaterThanOrEqual(260);
      }
    }
  });

  it('rounds a whole shift to that row exactly, and has no row below the table', () => {
    expect(shiftedLookup(table, 3)(200, 10)!.map(b => b.peakELR)).toEqual(table.lookup(197, 10)!.map(b => b.peakELR));
    expect(shiftedLookup(table, 2.34)(table.header.from + 2, 10)).toBeNull();
  });
});
