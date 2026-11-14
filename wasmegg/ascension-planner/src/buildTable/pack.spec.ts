import { describe, expect, it } from 'vitest';
import { checkPacked, packTable, unpackTable, type Cell } from './pack';

const build = (n: number) => ({
  sales: 1 + (n % 3),
  tier13: n % 2 === 0,
  waitStart: 1000 + n,
  saleEnd: 2000 + n,
  peakELR: 3.5 + n,
  delivered: [1, 2, 3, 4, 5].map(e => e * 1e9 + n),
});

describe('unpackTable', () => {
  it('reads back every cell packTable was given, empty ones included', () => {
    const cells: Cell[] = [];
    for (let te = 50; te <= 52; te++)
      for (let h = 0; h < 168; h++) cells.push({ te, h, builds: h === 5 ? [] : [build(te + h), build(te * h)] });
    const bytes = packTable({ version: 1, from: 50, to: 52 }, cells);
    const back = unpackTable(bytes);
    expect(back.header).toMatchObject({ version: 1, from: 50, to: 52, slots: 2 });
    expect(back.cells).toEqual(cells);
    expect(() => checkPacked(bytes, cells)).not.toThrow();
  });

  it('refuses a file cut short or not a table', () => {
    const bytes = packTable({ version: 1, from: 120, to: 120 }, [{ te: 120, h: 0, builds: [build(1)] }]);
    expect(() => unpackTable(bytes.subarray(0, bytes.length - 8))).toThrow(/incomplete/);
    expect(() => unpackTable(new TextEncoder().encode('<html>not a table</html>'))).toThrow(/not a precomputed table/);
  });
});
