import { describe, expect, it } from 'vitest';
import { CloudApi } from './api';
import { generateMasterKey, open, seal, sealJson, toBase64 } from './crypto';
import { CloudLibrary } from './library';
import { claimShare, claimTableShare, createShare, createTableShare, previewShare } from './share';
import { fakeWorker } from './testing/fakeWorker';

const EID = 'EI0000000000000004';
const META = { name: 'table-mine-te120-489.bin.gz', from: 120, to: 489, delivery: ['quantum-metronome-3-2'], silo: false };
/** Stand-in for a gzipped table file (random bytes: incompressible, like the real thing). */
const tableBytes = (n = 50_000) => crypto.getRandomValues(new Uint8Array(n));

async function setup() {
  const worker = fakeWorker();
  const api = new CloudApi('https://cloud.test', worker.fetch);
  const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', 1000);
  return { worker, api, lib };
}

describe('raw envelopes', () => {
  it('seals already-compressed data without gzipping it again, and opens both kinds', async () => {
    const key = await generateMasterKey();
    const bytes = tableBytes(10_000);
    const raw = await seal(key, bytes, false);
    expect(raw[0]).toBe(2);
    expect(raw.length).toBe(bytes.length + 1 + 12 + 16); // version + IV + GCM tag, nothing else
    expect(await open(key, raw)).toEqual(bytes);
    const gz = await seal(key, new TextEncoder().encode('x'.repeat(1000)));
    expect(gz[0]).toBe(1);
    expect(new TextDecoder().decode(await open(key, gz))).toBe('x'.repeat(1000));
  });
});

describe('custom table', () => {
  it('saves, loads on another device, replaces in place, and deletes', async () => {
    const { api, lib, worker } = await setup();
    expect(lib.customTable).toBeNull();
    const first = tableBytes();
    const saved = await lib.saveTable(first, META);
    expect(saved).toMatchObject({ ...META, size: first.length });

    const laptop = await CloudLibrary.unlock(api, EID, '111111');
    expect(laptop.customTable).toEqual(saved);
    expect(await laptop.loadTable()).toEqual(first);

    const second = tableBytes(60_000);
    const replaced = await laptop.saveTable(second, { ...META, name: 'newer.bin.gz', to: 300 });
    expect(replaced.id).toBe(saved.id); // the same object, overwritten
    expect(worker.store.size).toBe(3); // marker, main file, one table: never two
    await lib.refresh();
    expect(lib.customTable).toMatchObject({ name: 'newer.bin.gz', to: 300 });
    expect(await lib.loadTable()).toEqual(second);

    await lib.deleteTable();
    expect(lib.customTable).toBeNull();
    expect(worker.store.size).toBe(2);
    expect(await lib.loadTable()).toBeNull();
  });

  it('is not a plan: plan lists and sync never see it', async () => {
    const { lib } = await setup();
    await lib.saveTable(tableBytes(), META);
    expect(lib.plans()).toEqual([]);
  });

  it('is kept alive by touch, and dropped when its object has gone', async () => {
    const { lib, worker } = await setup();
    const { id } = await lib.saveTable(tableBytes(), META);
    expect(await lib.touch()).toEqual({ missing: [] });
    worker.store.delete(`plan/${id}`);
    expect(await lib.touch()).toEqual({ missing: [id] });
    expect(lib.customTable).toBeNull();
  });

  it('goes with the library when the library is deleted', async () => {
    const { lib, worker } = await setup();
    await lib.saveTable(tableBytes(), META);
    await lib.deleteLibrary();
    expect(worker.store.size).toBe(0);
  });

  it('is stored encrypted', async () => {
    const { lib, worker } = await setup();
    const marker = new TextEncoder().encode('PLAINTEXT-TABLE-MARKER');
    const bytes = new Uint8Array(1000);
    bytes.set(marker, 100);
    await lib.saveTable(bytes, META);
    for (const [key, obj] of worker.store) {
      if (key.startsWith('plan/')) expect(new TextDecoder('latin1').decode(obj.body)).not.toContain('PLAINTEXT-TABLE-MARKER');
    }
  });
});

describe('table share links', () => {
  const PAGE = 'https://wasmegg-carpet.netlify.app/ascension-planner/';

  it('previews as a table with its header facts, then imports the exact file', async () => {
    const { api, lib } = await setup();
    const bytes = tableBytes();
    const record = await createTableShare(lib, { ...META, bytes }, 'once', PAGE);
    expect(record.content).toBe('table');
    const info = await previewShare(api, record.link);
    expect(info).toMatchObject({ kind: 'once', name: META.name, content: 'table', table: { from: 120, to: 489, silo: false } });
    expect(await claimTableShare(api, record.link)).toEqual(bytes);
    expect(await claimTableShare(api, record.link)).toBeNull();
  });

  it('previews plan links as plans', async () => {
    const { api, lib } = await setup();
    const record = await createShare(lib, { planner: 'ascension', name: 'P', timestamp: 1, data: {} }, 'multi', PAGE);
    expect((await previewShare(api, record.link))?.content).toBe('plan');
    expect((await claimShare(api, record.link))?.name).toBe('P');
  });

  it('still reads links made before tables were shareable (a bare name as the title)', async () => {
    const { api, lib } = await setup();
    // Make an old-style share by hand: title = the plan name alone.
    const key = await generateMasterKey();
    const body = await sealJson(key, { v: 1, planner: 'ascension', name: 'Old', timestamp: 1, data: {} });
    const title = toBase64(await sealJson(key, 'Old'));
    const created = await lib.sessionForApi((a, s) => a.createShare(s, { kind: 'multi', title, body }));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    const k = toBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const link = `${PAGE}#share=${created.id}.${k}`;
    expect(await previewShare(api, link)).toMatchObject({ name: 'Old', content: 'plan' });
  });
});
