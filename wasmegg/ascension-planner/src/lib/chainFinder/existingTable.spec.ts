import { describe, expect, it } from 'vitest';
import { deliveryKey } from '@/buildTable/header';
import { allDeliverySelections, changesBehind, existingFor, pickExistingTable, tablesForDelivery } from './existingTable';
import { CHAIN_FINDER_DELIVERY_FAMILIES, defaultDeliverySelection, deliveryOptions } from './deliveryArtifacts';
import { LATEST_SIM_CHANGE, SIM_CHANGES } from '@/lib/instantSearch/simChanges';
import { currentColleggtibles } from '@/lib/instantSearch/colleggtibleChanges';
import type { IndexEntry } from '@/lib/instantSearch/tableCatalog';
import type { TableHeader } from '@/lib/instantSearch/table';

const ids = ['quantum-metronome-4-2', 'interstellar-compass-4-3', 'gusset-4-3', 'lunar-totem-4-3'];
const key = deliveryKey(ids);

const line = (name: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  name,
  kind: 'delivery',
  bytes: 1,
  sha256: name,
  deliveryKey: key,
  delivery: ids,
  from: 120,
  to: 489,
  simVersion: null,
  builtWith: null,
  doubleEarnings: true,
  builtAt: null,
  ...over,
});

const header = (over: Partial<TableHeader> = {}): TableHeader => ({
  version: 1,
  referenceWeek: 0,
  cteBonus: 0,
  deliveryScore: 0,
  from: 120,
  to: 489,
  slots: 3,
  builtAt: '2026-11-09T00:00:00Z',
  simChange: LATEST_SIM_CHANGE,
  colleggtibles: currentColleggtibles(),
  ...over,
});

describe('tablesForDelivery', () => {
  it('keeps one entry per file, a built name over its alias, for the exact set only', () => {
    const entries = [
      line('delivery-x.bin.gz', { sha256: 'a' }),
      line('table-named.bin.gz', { sha256: 'a' }),
      line('other.bin.gz', { deliveryKey: '00000000' }),
      line('acct.bin.gz', { kind: 'account' }),
      line('maxed.bin.gz', { kind: 'maxed', sha256: 'm' }),
    ];
    expect(tablesForDelivery(entries, [...ids].reverse()).map(e => e.name)).toEqual([
      'table-named.bin.gz',
      'maxed.bin.gz',
    ]);
  });
});

describe('pickExistingTable', () => {
  it('takes the newest table built with the same silo setting', () => {
    const read = [
      { entry: line('old'), header: header({ builtAt: '2026-10-01T00:00:00Z' }) },
      { entry: line('new'), header: header({ builtAt: '2026-11-01T00:00:00Z' }) },
      { entry: line('silo'), header: header({ builtAt: '2026-11-05T00:00:00Z', deferForEarnings: true }) },
    ];
    expect(pickExistingTable(read, false)?.entry.name).toBe('new');
    expect(pickExistingTable(read, true)?.entry.name).toBe('silo');
    expect(pickExistingTable(read.slice(0, 2), true)).toBeNull();
  });

  it('lists what changed since the table', () => {
    const current = pickExistingTable([{ entry: line('t'), header: header() }], false)!;
    expect(current.simChanges).toEqual([]);
    expect(current.colleggtibleChanges).toEqual([]);

    const { id } = Object.entries(currentColleggtibles()).map(([id]) => ({ id }))[0];
    const { [id]: _dropped, ...fewer } = currentColleggtibles();
    const old = pickExistingTable(
      [{ entry: line('t'), header: header({ simChange: SIM_CHANGES[0].commit, colleggtibles: fewer }) }],
      false
    )!;
    expect(old.simChanges).toEqual(SIM_CHANGES.slice(1));
    expect(old.colleggtibleChanges.map(c => c.id)).toEqual([id]);
  });
});

describe('allDeliverySelections', () => {
  it('is every pick once, the maxed set first', () => {
    const all = allDeliverySelections();
    const expected = CHAIN_FINDER_DELIVERY_FAMILIES.reduce((n, f) => n * deliveryOptions(f).length, 1);
    expect(all).toHaveLength(expected);
    expect(new Set(all.map(s => JSON.stringify(s))).size).toBe(expected);
    expect(all[0]).toEqual(defaultDeliverySelection());
  });
});

describe('existingFor', () => {
  it('finds the table for exactly the set and counts what it is behind', () => {
    const read = [
      { entry: line('mine'), header: header({ simChange: SIM_CHANGES[0].commit }) },
      { entry: line('other', { deliveryKey: '00000000' }), header: header() },
    ];
    const found = existingFor(read, ids, false)!;
    expect(found.entry.name).toBe('mine');
    expect(changesBehind(found)).toBe(SIM_CHANGES.length - 1);
    expect(existingFor(read, ['gusset-4-0'], false)).toBeNull();
  });
});
