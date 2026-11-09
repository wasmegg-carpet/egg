import { describe, expect, it } from 'vitest';
import { LATEST_SIM_CHANGE, olderSimChange, SIM_CHANGES, simChangesSince, type SimChange } from './simChanges';
import { compositeTable, type Table } from './table';

const a: SimChange = { commit: 'aaaaaaaa', date: '2026-10-25T12:00:00-05:00', note: 'a' };
const b: SimChange = { commit: 'bbbbbbbb', date: '2026-11-01T12:00:00-06:00', note: 'b' };
const changes = [a, b];

describe('simChangesSince', () => {
  it('lists what came after the table when its commit is not listed, oldest first', () => {
    expect(simChangesSince({ simVersion: '0214e968', builtAt: '2026-10-21T05:00:00.000Z' }, changes)).toEqual([a, b]);
    expect(simChangesSince({ simVersion: '0214e968', builtAt: '2026-10-28T05:00:00.000Z' }, changes)).toEqual([b]);
    expect(simChangesSince({ simVersion: '0214e968', builtAt: '2026-11-02T05:00:00.000Z' }, changes)).toEqual([]);
  });

  it('goes by the commit when it is listed, whenever the table was built', () => {
    expect(simChangesSince({ simVersion: 'aaaaaaaa', builtAt: '2026-12-01T00:00:00.000Z' }, changes)).toEqual([b]);
    expect(simChangesSince({ simVersion: 'bbbbbbbb', builtAt: '2026-10-01T00:00:00.000Z' }, changes)).toEqual([]);
    expect(simChangesSince({ simVersion: 'aaaaaaaa-dirty', builtAt: '2026-12-01T00:00:00.000Z' }, changes)).toEqual([b]);
  });

  it('lists everything for a table with no usable build time', () => {
    expect(simChangesSince({ builtAt: '' }, changes)).toEqual([a, b]);
  });

  it('goes by the stamp first: built after a change was dated, but without it', () => {
    const after = '2026-12-01T00:00:00.000Z';
    expect(simChangesSince({ simChange: 'aaaaaaaa', simVersion: 'cccccccc', builtAt: after }, changes)).toEqual([b]);
    expect(simChangesSince({ simChange: 'bbbbbbbb', simVersion: 'aaaaaaaa', builtAt: '' }, changes)).toEqual([]);
  });

  it('falls back when the stamp is from a list this page does not have yet', () => {
    expect(simChangesSince({ simChange: 'zzzzzzzz', simVersion: 'aaaaaaaa', builtAt: '' }, changes)).toEqual([b]);
    expect(simChangesSince({ simChange: 'zzzzzzzz', builtAt: '2026-10-28T05:00:00.000Z' }, changes)).toEqual([b]);
  });
});

describe('olderSimChange', () => {
  it('takes the older stamp, in either order', () => {
    expect(olderSimChange('aaaaaaaa', 'bbbbbbbb', changes)).toBe('aaaaaaaa');
    expect(olderSimChange('bbbbbbbb', 'aaaaaaaa', changes)).toBe('aaaaaaaa');
  });

  it('gives no stamp when either side has none or an unlisted one', () => {
    expect(olderSimChange('aaaaaaaa', undefined, changes)).toBeUndefined();
    expect(olderSimChange('zzzzzzzz', 'aaaaaaaa', changes)).toBeUndefined();
  });
});

describe('the real list', () => {
  it('stamps new tables with its newest entry, and ids are unique', () => {
    expect(LATEST_SIM_CHANGE).toBe(SIM_CHANGES[SIM_CHANGES.length - 1].commit);
    expect(new Set(SIM_CHANGES.map(c => c.commit)).size).toBe(SIM_CHANGES.length);
    expect(simChangesSince({ simChange: LATEST_SIM_CHANGE, builtAt: '' })).toEqual([]);
  });

  it('a composite table keeps the older half of its stamps', () => {
    const half = (simChange: string | undefined, builtAt: string) =>
      ({ header: { simChange, builtAt, simVersion: 'x', from: 120, to: 339 }, lookup: () => null }) as unknown as Table;
    const low = half(SIM_CHANGES[0].commit, '2026-11-05T00:00:00.000Z');
    const high = half(SIM_CHANGES[1].commit, '2026-11-06T00:00:00.000Z');
    expect(compositeTable(low, high, 340, 1).header.simChange).toBe(SIM_CHANGES[0].commit);
    expect(compositeTable(high, low, 340, 1).header.simChange).toBe(SIM_CHANGES[0].commit);
    expect(compositeTable(low, half(undefined, low.header.builtAt), 340, 1).header.simChange).toBeUndefined();
  });

  it('keeps the real list oldest first with dates it can read', () => {
    const dates = SIM_CHANGES.map(c => Date.parse(c.date));
    expect(dates.every(d => !Number.isNaN(d))).toBe(true);
    expect(dates).toEqual([...dates].sort((x, y) => x - y));
  });

  it('shows the vehicle fix on the tables in the store', () => {
    const fix = SIM_CHANGES.find(c => c.commit === 'b694b2d0');
    expect(simChangesSince({ simVersion: '0214e968', builtAt: '2026-10-21T04:22:00.000Z' })).toContain(fix);
    expect(simChangesSince({ simVersion: '7ed11988', builtAt: '2026-10-23T21:43:00.000Z' })).toContain(fix);
  });
});
