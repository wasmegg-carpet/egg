import { describe, expect, it } from 'vitest';
import { REFERENCE_WEEK } from '@/buildTable/cell';
import { tableGear } from '@/buildTable/header';
import { MAXED_DELIVERY, maxedContext } from '@/buildTable/maxedAccount';
import { packTable } from '@/buildTable/pack';
import { cteBonusOf } from '@/buildTable/task';
import { currentColleggtibles } from '@/lib/instantSearch/colleggtibleChanges';
import { LATEST_SIM_CHANGE } from '@/lib/instantSearch/simChanges';
import type { TableHeader } from '@/lib/instantSearch/table';
import { gzipBytes } from 'lib/planners/utils/gzip';
import { buildOrder, extendProblems, partialTEs, readTableFile, tesToBuild } from './extendTable';

/** a..b inclusive. */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const COMMON = ['quantum-metronome-4-0', 'interstellar-compass-4-0', 'gusset-4-0', 'lunar-totem-4-3'];

/** A header as the Table Builder writes one today. */
function header(delivery = MAXED_DELIVERY, silo = false): TableHeader {
  const context = maxedContext(delivery, silo);
  return {
    version: 1,
    referenceWeek: REFERENCE_WEEK,
    cteBonus: cteBonusOf(context),
    doubleEarnings: true,
    ...tableGear(context),
    deliveryScore: 1,
    from: 120,
    to: 489,
    slots: 3,
    builtAt: '2026-11-13T12:00:00.000Z',
    simVersion: 'abc12345',
    simChange: LATEST_SIM_CHANGE,
    colleggtibles: currentColleggtibles(),
  } as TableHeader;
}

describe('extendProblems', () => {
  it('accepts a table built now for the same delivery set and silo setting', () => {
    expect(extendProblems(header(), MAXED_DELIVERY, false)).toEqual([]);
    expect(extendProblems(header(COMMON, true), COMMON, true)).toEqual([]);
  });

  it('refuses another delivery set, silo setting, or doubler', () => {
    expect(extendProblems(header(COMMON), MAXED_DELIVERY, false)).toEqual([
      expect.stringMatching(/^It's for Quantum metronome T4C/),
    ]);
    expect(extendProblems(header(), MAXED_DELIVERY, true)).toEqual(['It was built with silo mode off.']);
    expect(extendProblems({ ...header(), doubleEarnings: false }, MAXED_DELIVERY, false)).toEqual([
      'It was built with 2x earnings off.',
    ]);
  });

  it('refuses a table the simulator has changed since', () => {
    const old = { ...header(), simChange: undefined, colleggtibles: undefined };
    expect(extendProblems(old, MAXED_DELIVERY, false)).toEqual([expect.stringMatching(/simulator has \d+ changes? since/)]);
  });

  it('refuses other earnings, stones, or filled-in rows', () => {
    expect(extendProblems({ ...header(), cteBonus: 1 }, MAXED_DELIVERY, false)).toEqual([
      "Its earnings artifacts aren't the maxed set.",
    ]);
    expect(extendProblems({ ...header(), stones: {} }, MAXED_DELIVERY, false)).toEqual(["Its stones aren't the maxed pool."]);
    expect(extendProblems({ ...header(), fake: true }, MAXED_DELIVERY, false)).toEqual([
      'Some of its rows are filled in from others, not simulated.',
    ]);
  });
});

describe('tesToBuild', () => {
  it('builds only what the base lacks', () => {
    expect(tesToBuild(100, 489, { from: 120, to: 489 })).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(tesToBuild(120, 489, { from: 120, to: 487 })).toEqual([488, 489]);
    expect(tesToBuild(120, 489, { from: 120, to: 489 })).toEqual([]);
  });

  it("keeps the base's TEs below the lowest asked for", () => {
    expect(tesToBuild(120, 489, { from: 60, to: 489 })).toEqual([]);
  });

  it('builds everything without a base', () => {
    expect(tesToBuild(50, 489)).toHaveLength(440);
    expect(tesToBuild(200, 350)).toHaveLength(151);
  });

  it("extends upward, keeping the base's TEs above the highest asked for", () => {
    expect(tesToBuild(200, 360, { from: 200, to: 350 })).toEqual(range(351, 360));
    expect(tesToBuild(200, 300, { from: 200, to: 350 })).toEqual([]);
  });

  it('extends both ways at once', () => {
    expect(tesToBuild(195, 352, { from: 200, to: 350 })).toEqual([...range(195, 199), 351, 352]);
  });

  it('fills a gap between the base and the range asked for', () => {
    expect(tesToBuild(400, 410, { from: 200, to: 350 })).toEqual(range(351, 410));
    expect(tesToBuild(120, 130, { from: 200, to: 350 })).toEqual(range(120, 199));
  });
});

describe('buildOrder', () => {
  it('runs top down without a kept table', () => {
    expect(buildOrder([3, 1, 2, 2])).toEqual([3, 2, 1]);
  });

  it('runs outward from a kept table: above bottom up, then below top down', () => {
    expect(buildOrder([195, 196, 351, 352, 353], { from: 200, to: 350 })).toEqual([351, 352, 353, 196, 195]);
  });

  it('leaves an unbroken run joined to the kept table whenever it stops', () => {
    const order = buildOrder(tesToBuild(190, 360, { from: 200, to: 350 }), { from: 200, to: 350 });
    for (let n = 1; n <= order.length; n++)
      expect(partialTEs(order.slice(0, n), range(200, 350))).not.toBeNull();
    expect(partialTEs(range(351, 355), range(200, 350))).toEqual({ from: 200, to: 355 });
  });
});

describe('readTableFile', () => {
  it('reads a gzipped table as downloaded', async () => {
    const cells = Array.from({ length: 168 }, (_, h) => ({
      te: 120,
      h,
      builds: [{ sales: 3, tier13: false, waitStart: 1, saleEnd: 2, peakELR: 3, delivered: [1, 2, 3, 4, 5] }],
    }));
    const bytes = packTable({ ...header(), from: 120, to: 120 }, cells);
    const read = await readTableFile((await gzipBytes(bytes)).buffer);
    expect(read.header.deliveryKey).toBe(header().deliveryKey);
    expect(read.cells).toEqual(cells);
  });
});

describe('partialTEs', () => {

  it('keeps the unbroken run down from the top, leaving out TEs finished below a gap', () => {
    // 489..470 done, 469 still running, 468 finished early.
    expect(partialTEs([...range(470, 489), 468], [])).toEqual({ from: 470, to: 489 });
  });

  it('joins finished TEs to the table being extended', () => {
    expect(partialTEs(range(110, 119), range(120, 489))).toEqual({ from: 110, to: 489 });
    // 115..119 not done: 110..114 can't join without a gap.
    expect(partialTEs(range(110, 114), range(120, 489))).toBeNull();
  });

  it('is null when nothing finished', () => {
    expect(partialTEs([], [])).toBeNull();
    expect(partialTEs([], range(120, 489))).toBeNull();
  });
});
