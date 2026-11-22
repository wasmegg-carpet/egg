import { describe, expect, it } from 'vitest';
import { CloudApi, CloudError } from './api';
import { CloudLibrary } from './library';
import { planState, syncPlanner, type LinkStore, type Links, type LocalPlan, type LocalStore } from './sync';
import { fakeWorker } from './testing/fakeWorker';

const EID = 'EI0000000000000002';
const ITER = 1000;

/** One device's planner: an in-memory local library and link store. */
function device() {
  const plans = new Map<string, LocalPlan>();
  let links: Links | null = null;
  const local: LocalStore = {
    list: async () => [...plans.values()].map(p => ({ ...p })),
    save: async p => void plans.set(p.id, { ...p }),
    remove: async id => void plans.delete(id),
  };
  const linkStore: LinkStore = {
    load: async () => (links ? structuredClone(links) : null),
    save: async l => void (links = structuredClone(l)),
  };
  return { plans, local, linkStore, links: () => links ?? {} };
}

async function setup() {
  const worker = fakeWorker();
  const api = new CloudApi('https://cloud.test', worker.fetch);
  const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', ITER);
  return { worker, api, lib };
}

const plan = (id: string, name: string, timestamp: number, data: unknown = { id }): LocalPlan => ({ id, name, timestamp, data });

describe('syncPlanner', () => {
  it('uploads every plan already in this browser on the first pass, and new ones after', async () => {
    const { lib } = await setup();
    const phone = device();
    phone.plans.set('old1', plan('old1', 'Old plan 1', 1));
    phone.plans.set('old2', plan('old2', 'Old plan 2', 2));
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ uploaded: 2, pending: 0 });
    expect(planState(phone.plans.get('old1')!, phone.links())).toBe('synced');

    phone.plans.set('new', plan('new', 'New plan', 3));
    expect(planState(phone.plans.get('new')!, phone.links())).toBe('pending');
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ uploaded: 1, pending: 0 });
    expect(lib.plans('ascension').map(p => p.name).sort()).toEqual(['New plan', 'Old plan 1', 'Old plan 2']);
  });

  it('merges a second device’s own plans into the library when it connects', async () => {
    const { api, lib } = await setup();
    const phone = device();
    phone.plans.set('p', plan('p', 'From phone', 1));
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });

    const laptopLib = await CloudLibrary.unlock(api, EID, '111111');
    const laptop = device();
    laptop.plans.set('l', plan('l', 'From laptop', 2));
    expect(await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore })).toMatchObject({ uploaded: 1, downloaded: 1 });
    expect([...laptop.plans.values()].map(p => p.name).sort()).toEqual(['From laptop', 'From phone']);
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ downloaded: 1 });
    expect([...phone.plans.values()].map(p => p.name).sort()).toEqual(['From laptop', 'From phone']);
  });

  it('ignores the localOnly flag earlier builds wrote, and uploads those plans', async () => {
    const { lib } = await setup();
    const phone = device();
    phone.plans.set('x', plan('x', 'X', 1));
    await phone.linkStore.save({ x: { localOnly: true } as never });
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ uploaded: 1 });
  });

  it('brings plans to a second device under their original ids, then syncs edits and deletions both ways', async () => {
    const { api, lib } = await setup();
    const phone = device();
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    phone.plans.set('p1', plan('p1', 'Plan', 10, { embeddedId: 'p1' }));
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });

    const laptopLib = await CloudLibrary.unlock(api, EID, '111111');
    const laptop = device();
    expect(await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore })).toMatchObject({ downloaded: 1 });
    expect(laptop.plans.get('p1')).toEqual(plan('p1', 'Plan', 10, { embeddedId: 'p1' }));

    // Edit on the laptop → the phone picks it up.
    laptop.plans.set('p1', plan('p1', 'Plan (renamed)', 20, { embeddedId: 'p1', v: 2 }));
    expect(await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore })).toMatchObject({ uploaded: 1 });
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ downloaded: 1, uploaded: 0 });
    expect(phone.plans.get('p1')?.name).toBe('Plan (renamed)');

    // Delete on the phone → gone from the cloud and the laptop.
    phone.plans.delete('p1');
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ deletedInCloud: 1 });
    expect(await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore })).toMatchObject({ deletedHere: 1 });
    expect(laptop.plans.size).toBe(0);
    expect(laptopLib.plans()).toEqual([]);
  });

  it('lets the newer save win when both devices changed a plan', async () => {
    const { api, lib } = await setup();
    const phone = device();
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    phone.plans.set('p', plan('p', 'base', 1));
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    const laptopLib = await CloudLibrary.unlock(api, EID, '111111');
    const laptop = device();
    await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore });

    laptop.plans.set('p', plan('p', 'laptop edit', 5));
    phone.plans.set('p', plan('p', 'phone edit (later)', 9));
    await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore });
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore }); // phone's is newer: uploads
    await syncPlanner({ library: laptopLib, planner: 'ascension', local: laptop.local, links: laptop.linkStore });
    expect(laptop.plans.get('p')?.name).toBe('phone edit (later)');
    expect(phone.plans.get('p')?.name).toBe('phone edit (later)');
  });

  it('keeps planners apart within one library', async () => {
    const { lib } = await setup();
    const ap = device();
    const enl = device();
    await syncPlanner({ library: lib, planner: 'ascension', local: ap.local, links: ap.linkStore });
    await syncPlanner({ library: lib, planner: 'enlightenment', local: enl.local, links: enl.linkStore });
    ap.plans.set('a', plan('a', 'AP plan', 1));
    enl.plans.set('e', plan('e', 'Enl plan', 1));
    await syncPlanner({ library: lib, planner: 'ascension', local: ap.local, links: ap.linkStore });
    await syncPlanner({ library: lib, planner: 'enlightenment', local: enl.local, links: enl.linkStore });
    expect(ap.plans.size).toBe(1);
    expect(enl.plans.size).toBe(1);
    expect(lib.plans().map(p => `${p.planner}:${p.name}`).sort()).toEqual(['ascension:AP plan', 'enlightenment:Enl plan']);
  });

  it('writes the index once per pass, however many plans changed', async () => {
    const { lib, worker } = await setup();
    const phone = device();
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    for (let i = 0; i < 5; i++) phone.plans.set(`p${i}`, plan(`p${i}`, `P${i}`, i + 1));
    const before = worker.calls.get('PUT /lib/:id/:id') ?? 0;
    expect(await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore })).toMatchObject({ uploaded: 5 });
    expect((worker.calls.get('PUT /lib/:id/:id') ?? 0) - before).toBe(1);
  });

  it('stops on an error, still records what it finished, and the next pass completes', async () => {
    const { lib, worker } = await setup();
    const phone = device();
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    for (let i = 0; i < 3; i++) phone.plans.set(`p${i}`, plan(`p${i}`, `P${i}`, i + 1));

    // Let one plan upload succeed, then the worker starts refusing (as under a rate limit).
    const realFetch = worker.fetch;
    let creates = 0;
    const flaky = new CloudApi('https://cloud.test', async (input, init) => {
      const req = new Request(input, init);
      if (req.method === 'POST' && req.url.endsWith('/v1/plans') && creates++ >= 1)
        return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), { status: 429, headers: { 'Retry-After': '60' } });
      return realFetch(req);
    });
    const flakyLib = await CloudLibrary.unlock(flaky, EID, '111111');
    const partial = await syncPlanner({ library: flakyLib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    expect(partial.uploaded).toBe(1);
    expect(partial.pending).toBe(2);
    expect(partial.error).toBeInstanceOf(CloudError);
    expect((partial.error as CloudError).code).toBe('rate_limited');
    expect(flakyLib.plans()).toHaveLength(1); // the finished upload made it into the index

    const rest = await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    expect(rest).toMatchObject({ uploaded: 2, pending: 0 });
    expect(lib.plans()).toHaveLength(3);
  });

  it('runs passes for the same library and planner one at a time', async () => {
    const { lib } = await setup();
    const phone = device();
    await syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore });
    phone.plans.set('p', plan('p', 'P', 1));
    const [a, b] = await Promise.all([
      syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore }),
      syncPlanner({ library: lib, planner: 'ascension', local: phone.local, links: phone.linkStore }),
    ]);
    expect(a.uploaded + b.uploaded).toBe(1);
    expect(lib.plans()).toHaveLength(1);
  });
});
