import { describe, expect, it } from 'vitest';
import {
  deliveryTables,
  fetchCatalog,
  findDeliveryTable,
  findTable,
  maxedTable,
  tableUrl,
  TABLE_STORE,
  type IndexEntry,
} from './tableCatalog';

const line = (name: string): IndexEntry => ({
  name,
  kind: 'maxed',
  bytes: 1,
  sha256: '0'.repeat(64),
  deliveryKey: null,
  delivery: null,
  from: 120,
  to: 489,
  simVersion: null,
  builtWith: null,
  doubleEarnings: null,
  builtAt: null,
});

describe('fetchCatalog', () => {
  const json = (body: string) => new Response(body, { headers: { 'content-type': 'application/json' } });

  it('reads the store index, revalidated', async () => {
    const calls: string[] = [];
    const entries = await fetchCatalog((url, init) => {
      calls.push(`${url} ${init?.cache}`);
      return Promise.resolve(json(JSON.stringify({ tables: [line('maxed.bin.gz')] })));
    });
    expect(entries?.map(e => e.name)).toEqual(['maxed.bin.gz']);
    expect(calls).toEqual([`${TABLE_STORE}/tables/index.json no-cache`]);
  });

  it('null on a bad status, a web page in its place, bad JSON, or no connection', async () => {
    expect(await fetchCatalog(() => Promise.resolve(new Response('no', { status: 404 })))).toBeNull();
    expect(
      await fetchCatalog(() => Promise.resolve(new Response('<html>', { headers: { 'content-type': 'text/html' } })))
    ).toBeNull();
    expect(await fetchCatalog(() => Promise.resolve(json('{')))).toBeNull();
    expect(await fetchCatalog(() => Promise.resolve(json('{"tables": "no"}')))).toBeNull();
    expect(await fetchCatalog(() => Promise.reject(new Error('offline')))).toBeNull();
  });
});

const delivery = (name: string, ids: string[], kind: IndexEntry['kind'] = 'delivery'): IndexEntry => ({
  ...line(name),
  kind,
  delivery: ids,
  deliveryKey: name.startsWith('delivery-') ? name.slice(9, 17) : null,
});

const MAXED_SET = ['quantum-metronome-4-3', 'interstellar-compass-4-3', 'gusset-4-3', 'lunar-totem-4-3'];
const OTHER_SET = ['quantum-metronome-3-2', 'interstellar-compass-4-0', 'gusset-2-2', 'lunar-totem-4-3'];

describe('delivery tables', () => {
  const entries = [
    line('maxed.bin.gz'),
    delivery('table-metronome-T4L_compass-T4L_gusset-T4L-te120-489.bin.gz', MAXED_SET),
    delivery('delivery-0b85c7a1.bin.gz', MAXED_SET),
    delivery('table-metronome-T3E_compass-T4C_gusset-T2E-te120-489.bin.gz', OTHER_SET),
  ];

  it('lists only the delivery-combination tables', () => {
    expect(deliveryTables(entries).map(e => e.name)).toEqual([
      'table-metronome-T4L_compass-T4L_gusset-T4L-te120-489.bin.gz',
      'delivery-0b85c7a1.bin.gz',
      'table-metronome-T3E_compass-T4C_gusset-T2E-te120-489.bin.gz',
    ]);
  });

  it('finds the table built for a delivery set, whichever order the sets come in', () => {
    expect(findDeliveryTable(entries, [...MAXED_SET].reverse())?.name).toBe(
      'table-metronome-T4L_compass-T4L_gusset-T4L-te120-489.bin.gz'
    );
    expect(findDeliveryTable(entries, OTHER_SET)?.name).toBe(
      'table-metronome-T3E_compass-T4C_gusset-T2E-te120-489.bin.gz'
    );
  });

  it('has no table for a set the store never built, or for something that is not a set of four', () => {
    expect(findDeliveryTable(entries, ['a', 'b', 'c', 'd'])).toBeNull();
    expect(findDeliveryTable(entries, MAXED_SET.slice(0, 3))).toBeNull();
  });

  it('does not count a gear table as a delivery table even when it names its set', () => {
    const gear = delivery('gear-859e797bf59a848dc75d4cbf.bin.gz', MAXED_SET, 'gear');
    expect(findDeliveryTable([gear], MAXED_SET)).toBeNull();
  });
});

describe('lookups', () => {
  const entries = [line('table.bin.gz'), line('maxed.bin.gz'), line('acct-abc.bin.gz')];

  it('findTable matches a name exactly', () => {
    expect(findTable(entries, 'acct-abc.bin.gz')?.name).toBe('acct-abc.bin.gz');
    expect(findTable(entries, 'acct-nope.bin.gz')).toBeNull();
  });

  it("maxedTable answers under either of the maxed table's names", () => {
    expect(maxedTable(entries)?.name).toBe('maxed.bin.gz');
    expect(maxedTable([line('table.bin.gz')])?.name).toBe('table.bin.gz');
    expect(maxedTable([line('acct-abc.bin.gz')])).toBeNull();
  });

  it('tableUrl is the plain name the fetch tries the .gz of', () => {
    expect(tableUrl('acct-abc.bin.gz')).toBe(`${TABLE_STORE}/tables/acct-abc.bin`);
    expect(tableUrl('table.bin')).toBe(`${TABLE_STORE}/tables/table.bin`);
  });
});
