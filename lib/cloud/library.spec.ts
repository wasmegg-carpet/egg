import { describe, expect, it } from 'vitest';
import { CloudApi, CloudError } from './api';
import { CloudLibrary } from './library';
import { fakeWorker } from './testing/fakeWorker';

const EID = 'EI0000000000000001';
/** Few KDF iterations so the suite stays fast. */
const ITER = 1000;

function setup() {
  const worker = fakeWorker();
  const api = new CloudApi('https://cloud.test', worker.fetch);
  return { worker, api };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CloudError) return err.code;
    throw err;
  }
  return 'no error';
}

describe('CloudLibrary', () => {
  it('tells no library, wrong PIN and right PIN apart', async () => {
    const { api } = setup();
    expect(await CloudLibrary.lookup(api, EID)).toBeNull();
    expect(await code(CloudLibrary.unlock(api, EID, '123456'))).toBe('no_library');

    await CloudLibrary.create(api, EID, 'pin6', '123456', ITER);
    expect((await CloudLibrary.lookup(api, ` ${EID.toLowerCase()} `))?.pinType).toBe('pin6');
    expect(await code(CloudLibrary.unlock(api, EID, '654321'))).toBe('wrong_pin');
    const lib = await CloudLibrary.unlock(api, EID, '123456');
    expect(lib.plans()).toEqual([]);
  });

  it('refuses a malformed EID before calling the worker', async () => {
    const { api, worker } = setup();
    expect(await code(CloudLibrary.lookup(api, 'EI12'))).toBe('invalid_eid');
    expect(worker.calls.size).toBe(0);
  });

  it('saves, lists, loads, replaces and deletes plans, and other devices see it', async () => {
    const { api } = setup();
    const phone = await CloudLibrary.create(api, EID, 'pin4', '1234', ITER);
    const id = await phone.savePlan({ planner: 'ascension', name: 'Run 1', timestamp: 1, data: { steps: [1, 2] } });
    expect(phone.plans('ascension').map(p => p.name)).toEqual(['Run 1']);
    expect(phone.plans('enlightenment')).toEqual([]);

    const laptop = await CloudLibrary.unlock(api, EID, '1234');
    expect(laptop.plans().map(p => p.id)).toEqual([id]);
    expect((await laptop.loadPlan(id))?.data).toEqual({ steps: [1, 2] });

    const same = await laptop.savePlan({ id, planner: 'ascension', name: 'Run 1 (edited)', timestamp: 2, data: { steps: [3] } });
    expect(same).toBe(id);
    await phone.refresh();
    expect(phone.plans()).toEqual([{ id, planner: 'ascension', name: 'Run 1 (edited)', timestamp: 2 }]);

    await phone.deletePlan(id);
    expect(await laptop.loadPlan(id)).toBeNull();
    await laptop.refresh();
    expect(laptop.plans()).toEqual([]);
    expect(laptop.index.plans[0]?.deletedAt).toBeGreaterThan(0); // tombstone, so other devices drop their copy
  });

  it('merges index changes from two devices instead of losing one (conflict, re-read, reapply)', async () => {
    const { api } = setup();
    const a = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    const b = await CloudLibrary.unlock(api, EID, '111111');
    await a.savePlan({ planner: 'ascension', name: 'from A', timestamp: 1, data: 1 });
    // b's copy of the index is now stale; its save must not wipe A's plan.
    await b.savePlan({ planner: 'enlightenment', name: 'from B', timestamp: 2, data: 2 });
    await a.refresh();
    expect(a.plans().map(p => p.name).sort()).toEqual(['from A', 'from B']);
  });

  it('re-saves a plan whose object vanished as a new object', async () => {
    const { api, worker } = setup();
    const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    const id = await lib.savePlan({ planner: 'ascension', name: 'p', timestamp: 1, data: 1 });
    worker.store.delete(`plan/${id}`);
    const again = await lib.savePlan({ id, planner: 'ascension', name: 'p', timestamp: 2, data: 2 });
    expect(again).not.toBe(id);
    expect(lib.plans().map(p => p.id)).toEqual([again]);
  });

  it('refreshes with the cheap read while the session is live', async () => {
    const { api, worker } = setup();
    const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    await lib.refresh();
    await lib.refresh();
    expect(worker.calls.get('GET /lib/:id/:id')).toBe(2);
    expect(worker.calls.get('POST /unlock')).toBeUndefined();
  });

  it('renews an expired session by unlocking again, without the PIN', async () => {
    const { api, worker } = setup();
    const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    worker.expireSessions();
    await lib.savePlan({ planner: 'ascension', name: 'after expiry', timestamp: 1, data: 1 });
    expect(lib.plans()).toHaveLength(1);
    expect(worker.calls.get('POST /unlock')).toBe(1);
  });

  it('resumes on a remembered device, and notices a PIN change made elsewhere', async () => {
    const { api } = setup();
    const phone = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    await phone.savePlan({ planner: 'ascension', name: 'p', timestamp: 1, data: 'x' });
    const remembered = phone.remember();

    const resumed = await CloudLibrary.resume(api, remembered);
    expect(resumed.plans().map(p => p.name)).toEqual(['p']);

    await phone.changePin('password', 'a long passphrase');
    expect(await code(CloudLibrary.resume(api, remembered))).toBe('wrong_pin');
    // The old 6-digit PIN doesn't even fit the new type: caught before any network call.
    expect(await code(CloudLibrary.unlock(api, EID, '111111'))).toBe('pin_format');
    const reopened = await CloudLibrary.unlock(api, EID, 'a long passphrase');
    expect(reopened.settings.pinType).toBe('password');
    // Same master key: the plans still open.
    expect((await reopened.loadPlan(reopened.plans()[0]!.id))?.data).toBe('x');
  });

  it('drops index entries whose objects are gone, on touch', async () => {
    const { api, worker } = setup();
    const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    const keep = await lib.savePlan({ planner: 'ascension', name: 'keep', timestamp: 1, data: 1 });
    const lose = await lib.savePlan({ planner: 'ascension', name: 'lose', timestamp: 1, data: 1 });
    worker.store.delete(`plan/${lose}`);
    expect(await lib.touch()).toEqual({ missing: [lose] });
    expect(lib.plans().map(p => p.id)).toEqual([keep]);
  });

  it('deletes the whole library, after which the EID can start again', async () => {
    const { api, worker } = setup();
    const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    await lib.savePlan({ planner: 'ascension', name: 'p', timestamp: 1, data: 1 });
    await lib.deleteLibrary();
    expect(worker.store.size).toBe(0);
    expect(await CloudLibrary.lookup(api, EID)).toBeNull();
    await CloudLibrary.create(api, EID, 'none', '', ITER);
    expect((await CloudLibrary.unlock(api, EID, '')).plans()).toEqual([]);
  });

  it('stores nothing readable: plan names and contents are encrypted', async () => {
    const { api, worker } = setup();
    const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
    await lib.savePlan({ planner: 'ascension', name: 'SECRET-NAME', timestamp: 1, data: { note: 'SECRET-DATA' } });
    for (const [key, obj] of worker.store) {
      if (key.startsWith('marker/')) continue;
      const text = new TextDecoder('latin1').decode(obj.body);
      expect(text).not.toContain('SECRET');
      expect(text).not.toContain(EID);
    }
  });
});
