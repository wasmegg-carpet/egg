import { describe, expect, it } from 'vitest';
import type { ColleggtibleDef } from 'lib/collegtibles';
import { colleggtibleChanges, currentColleggtibles, UNSTAMPED_COLLEGGTIBLES } from './colleggtibleChanges';
import { commonColleggtibles } from './simChanges';

function def(id: string, name: string, top: number): ColleggtibleDef {
  return { id, name, effect: 'Hab cost', dimension: 'habCost', tierValues: [1, 1, 1, top] };
}

const ids = (header: Parameters<typeof colleggtibleChanges>[0], defs: ColleggtibleDef[]) =>
  colleggtibleChanges(header, defs).map(c => c.id);

describe('colleggtibleChanges', () => {
  const defs = [def('a', 'AAA', 0.75), def('new', 'CARBON FIBER', 0.8)];

  it('names a colleggtible added since the table, with its effect at max', () => {
    expect(colleggtibleChanges({ colleggtibles: { a: 0.75 } }, defs)).toEqual([
      { id: 'new', note: "New colleggtible: Carbon Fiber (Hab cost -20% at max). This table doesn't include it." },
    ]);
  });

  it('has nothing to say about a table built with the same colleggtibles', () => {
    expect(colleggtibleChanges({ colleggtibles: currentColleggtibles(defs) }, defs)).toEqual([]);
  });

  it('notices a retuned top tier and a removed egg', () => {
    const changes = colleggtibleChanges({ colleggtibles: { a: 0.9, new: 0.8, gone: 2 } }, defs);
    expect(changes.map(c => c.id)).toEqual(['a', 'gone']);
    expect(changes[0].note).toContain('-10% is now -25%');
  });

  it('treats a table with no stamp as built before Copper', () => {
    expect(ids({}, [def('copper', 'COPPER', 0.8), def('ice', 'ICE', 0.95)])).toEqual([
      'copper',
      ...Object.keys(UNSTAMPED_COLLEGGTIBLES).filter(id => id !== 'ice'),
    ]);
  });

  it('names Copper on a table without a stamp, given the real list', () => {
    expect(colleggtibleChanges({}).map(c => c.id)).toContain('copper');
  });

  it('a table stamped now has nothing missing', () => {
    expect(colleggtibleChanges({ colleggtibles: currentColleggtibles() })).toEqual([]);
  });
});

describe('commonColleggtibles', () => {
  it('keeps what both halves agree on', () => {
    expect(commonColleggtibles({ a: 1, b: 2, c: 3 }, { a: 1, b: 9 })).toEqual({ a: 1 });
  });

  it('gives no stamp when either half has none', () => {
    expect(commonColleggtibles({ a: 1 }, undefined)).toBeUndefined();
    expect(commonColleggtibles(undefined, { a: 1 })).toBeUndefined();
  });
});
