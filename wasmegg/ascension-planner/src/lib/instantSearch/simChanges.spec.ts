import { describe, expect, it } from 'vitest';
import { SIM_CHANGES, simChangesSince, type SimChange } from './simChanges';

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
