import { describe, expect, it } from 'vitest';
import { gearCoverage, prefetchAllowed, prefetchFiles, prefetchPlan } from './tablePrefetch';
import type { IndexEntry } from './tableCatalog';

const entry = (name: string, from: number): IndexEntry => ({
  name,
  kind: /acct-/.test(name) ? 'account' : /gear-/.test(name) ? 'gear' : 'maxed',
  bytes: 3_200_000,
  sha256: '0'.repeat(64),
  deliveryKey: null,
  delivery: null,
  from,
  to: 489,
  simVersion: null,
  builtWith: null,
  doubleEarnings: null,
  builtAt: null,
});

const entries: IndexEntry[] = [
  entry('maxed.bin.gz', 120),
  entry('acct-own.bin.gz', 138),
  entry('gear-mine.bin.gz', 120),
];

describe('prefetchPlan', () => {
  it('the own table alone when the store has it', () => {
    expect(prefetchPlan({ entries, own: 'acct-own.bin.gz', gear: 'gear-mine.bin.gz', te: 150 })).toEqual([
      'acct-own.bin.gz',
    ]);
  });
  it('else the gear table and the maxed one', () => {
    expect(prefetchPlan({ entries, own: 'acct-x.bin.gz', gear: 'gear-mine.bin.gz', te: 150 })).toEqual([
      'gear-mine.bin.gz',
      'maxed.bin.gz',
    ]);
    // An own table that starts above the player's TE is no use to them.
    expect(prefetchPlan({ entries, own: 'acct-own.bin.gz', gear: 'gear-mine.bin.gz', te: 130 })).toEqual([
      'gear-mine.bin.gz',
      'maxed.bin.gz',
    ]);
    // A gear table under the first name tried that is listed.
    expect(prefetchPlan({ entries, own: null, gear: ['gear-canon.bin.gz', 'gear-mine.bin.gz'], te: 150 })).toEqual([
      'gear-mine.bin.gz',
      'maxed.bin.gz',
    ]);
  });
  it('else the maxed table alone', () => {
    expect(prefetchPlan({ entries, own: null, gear: 'gear-none.bin.gz', te: 150 })).toEqual(['maxed.bin.gz']);
    expect(prefetchPlan({ entries, own: null, gear: null, te: 150 })).toEqual(['maxed.bin.gz']);
  });
});

describe('prefetchAllowed', () => {
  const desktop = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/129', hardwareConcurrency: 8, deviceMemory: 8 };
  it('on a desktop with a decent connection', () => {
    expect(prefetchAllowed({ ...desktop, connection: { effectiveType: '4g' } })).toBe(true);
    expect(prefetchAllowed(desktop)).toBe(true);
  });
  it('not with Save-Data, on 2G, or on a small device', () => {
    expect(prefetchAllowed({ ...desktop, connection: { saveData: true, effectiveType: '4g' } })).toBe(false);
    expect(prefetchAllowed({ ...desktop, connection: { effectiveType: '2g' } })).toBe(false);
    expect(prefetchAllowed({ ...desktop, connection: { effectiveType: 'slow-2g' } })).toBe(false);
    expect(prefetchAllowed({ ...desktop, hardwareConcurrency: 2 })).toBe(false);
    expect(prefetchAllowed({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })).toBe(false);
  });
});

describe('prefetchFiles', () => {
  it('fetches each file in turn at low priority, skips what is missing, and never throws', async () => {
    const calls: string[] = [];
    let open = 0;
    const fetchFn = async (url: string, init: RequestInit & { priority?: string }) => {
      calls.push(`${url} ${init.priority}`);
      expect(open).toBe(0); // one at a time
      open++;
      await new Promise(r => setTimeout(r, 5));
      open--;
      if (url.includes('boom')) throw new Error('network');
      if (url.includes('missing')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
      return new Response(new Uint8Array(1000) as unknown as BodyInit);
    };
    const got = await prefetchFiles('/p/', ['a.bin.gz', 'missing.bin.gz', 'boom.bin.gz', 'b.bin.gz'], fetchFn);
    expect(got).toEqual(['a.bin.gz', 'b.bin.gz']);
    expect(calls).toEqual(['/p/a.bin.gz low', '/p/missing.bin.gz low', '/p/boom.bin.gz low', '/p/b.bin.gz low']);
  });
});

describe('gearCoverage', () => {
  it('own table first, then a gear table, else none', () => {
    expect(gearCoverage(entries, 'acct-own.bin.gz', ['gear-x.bin.gz'])).toBe('own');
    expect(gearCoverage(entries, 'acct-bbb.bin.gz', ['gear-mine.bin.gz', 'gear-zzz.bin.gz'])).toBe('gear');
    expect(gearCoverage(entries, null, ['gear-zzz.bin.gz'])).toBe('none');
    expect(gearCoverage(entries, 'acct-bbb.bin.gz', [])).toBe('none');
  });
});
