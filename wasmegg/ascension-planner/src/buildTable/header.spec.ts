import { describe, expect, it } from 'vitest';
import { REFERENCE_WEEK } from './cell';
import { deliveryKey, tableGear, tableHeaderWarnings } from './header';
import { MAXED_DELIVERY, maxedContext } from './maxedAccount';

/** A header as the Table Builder writes it, less the cells' own fields. */
function header(gear = tableGear(maxedContext())): Record<string, unknown> {
  return {
    version: 1,
    referenceWeek: REFERENCE_WEEK,
    cteBonus: 1,
    doubleEarnings: true,
    ...gear,
    deliveryScore: 1,
    from: 120,
    to: 489,
    slots: 3,
    builtAt: '2026-10-20T12:00:00.000Z',
    simVersion: 'd019f9b7',
    k3: {},
  };
}

describe('tableGear', () => {
  it('records the maxed gear and leaves deferForEarnings out unless silo mode is on', () => {
    const gear = tableGear(maxedContext());
    expect(gear.delivery).toEqual(MAXED_DELIVERY);
    expect(gear.earnings).toEqual(['lunar-totem-4-3', 'puzzle-cube-4-3', 'demeters-necklace-4-3', 'tungsten-ankh-4-3']);
    expect(gear.stones).toEqual({ 'lunar-stone-4': 12, 'shell-stone-4': 12, 'quantum-stone-4': 12, 'tachyon-stone-4': 12 });
    expect('deferForEarnings' in gear).toBe(false);
    expect(tableGear(maxedContext(MAXED_DELIVERY, true)).deferForEarnings).toBe(true);
  });

  it('keys a delivery set the same in any order, and differently for another set', () => {
    expect(deliveryKey([...MAXED_DELIVERY].reverse())).toBe(deliveryKey(MAXED_DELIVERY));
    expect(deliveryKey(['quantum-metronome-4-2', ...MAXED_DELIVERY.slice(1)])).not.toBe(deliveryKey(MAXED_DELIVERY));
    expect(deliveryKey(MAXED_DELIVERY)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('tableHeaderWarnings', () => {
  it('has nothing to say about a header written today, silo or not, any delivery set', () => {
    expect(tableHeaderWarnings(header())).toEqual([]);
    expect(tableHeaderWarnings(header(tableGear(maxedContext(MAXED_DELIVERY, true))))).toEqual([]);
    const t4e = ['quantum-metronome-4-2', ...MAXED_DELIVERY.slice(1)];
    expect(tableHeaderWarnings(header(tableGear(maxedContext(t4e)))).length).toBe(0);
  });

  it('flags an old header: missing keys, 2x earnings off, deferForEarnings false', () => {
    const old = header();
    for (const k of ['earnings', 'delivery', 'deliveryKey', 'stones']) delete old[k];
    old.doubleEarnings = false;
    old.deferForEarnings = false;
    const w = tableHeaderWarnings(old);
    expect(w).toHaveLength(3);
    expect(w[0]).toContain('earnings, delivery, deliveryKey, stones');
  });

  it('flags other gear, a wrong key, unknown keys and a dirty simulator', () => {
    const h = { ...header(), earnings: ['puzzle-cube-4-2'], stones: {}, deliveryKey: '00000000', simVersion: 'abc-dirty', extra: 1 };
    expect(tableHeaderWarnings(h)).toHaveLength(5);
  });
});
