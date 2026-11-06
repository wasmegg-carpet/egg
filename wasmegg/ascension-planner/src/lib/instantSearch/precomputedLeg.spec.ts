/** `tailTo` (one target) against `sweepTails` (every target at once) on the deployed table. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { canonicalDelivered, rebase, sweepTails, tailTo } from './precomputedLeg';
import { readTable } from './table';

const gz = readFileSync(new URL('../../../public/instant/table.bin.gz', import.meta.url));
const bytes = gunzipSync(gz);
const table = readTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('tailTo', () => {
  it("gives sweepTails' numbers to the bit, for every target", () => {
    let compared = 0;
    for (const te of [120, 150, 199, 250, 300, 341, 400, 489]) {
      for (let h = 0; h < 168; h += 13) {
        for (const [j, raw] of (table.lookup(te, h) ?? []).entries()) {
          // The canonical counts, and counts with spare eggs on one egg (a held prestige's).
          const spare = [...canonicalDelivered(te)];
          spare[(h + j) % 5] += 3e17;
          for (const b of [raw, rebase(raw, te, spare)]) {
            for (const lateBy of [0, 1800]) {
              const sweep = sweepTails(b, 490, lateBy, te + 1);
              for (let target = te + 1; target <= 490; target++) {
                const i = target - sweep.from;
                const one = tailTo(b, target, lateBy);
                if (Number.isNaN(sweep.seconds[i])) {
                  expect(one).toBeNull();
                  continue;
                }
                const delivered = [0, 0, 0, 0, 0];
                sweep.deliveredInto(i, delivered);
                expect(one).toEqual({ seconds: sweep.seconds[i], endTE: sweep.endTE[i], delivered });
                compared++;
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  }, 120_000);
});
