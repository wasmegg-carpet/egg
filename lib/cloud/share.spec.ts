import { describe, expect, it } from 'vitest';
import { CloudApi } from './api';
import { CloudLibrary } from './library';
import { claimShare, createShare, forgetUsedShares, listShares, parseShareLink, previewShare, revokeShare, scrubPlayer } from './share';
import { fakeWorker } from './testing/fakeWorker';

const EID = 'EI0000000000000003';
const PAGE = 'https://wasmegg-carpet.netlify.app/ascension-planner/';

async function setup() {
  const worker = fakeWorker();
  const api = new CloudApi('https://cloud.test', worker.fetch);
  const lib = await CloudLibrary.create(api, EID, 'pin6', '111111', 1000);
  return { worker, api, lib };
}

const planWithIdentity = {
  initialState: { playerId: EID, nickname: 'RealName', rawBackup: { eiUserId: EID, userName: 'RealName', game: { permitLevel: 1 } } },
  notes: `my EID is ${EID.toLowerCase()} and ${EID}`,
  actions: [{ type: 'x', meta: { userId: 'EI1111111111111111' } }],
};

describe('scrubPlayer', () => {
  it('removes identity fields and every EID-shaped string', () => {
    const out = scrubPlayer(planWithIdentity, EID);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/EI\d{16}/i);
    expect(text).not.toContain('RealName');
    expect(out.initialState.playerId).toBe('EIxxxxxxxxxx');
    expect(out.initialState.rawBackup.game.permitLevel).toBe(1); // everything else stays
    expect(planWithIdentity.initialState.playerId).toBe(EID); // a copy, not in place
  });
});

describe('share links', () => {
  it('puts the id and key only in the fragment, and parses them back', async () => {
    const { lib } = await setup();
    const record = await createShare(lib, { planner: 'ascension', name: 'My run', timestamp: 1, data: {} }, 'once', `${PAGE}#old`);
    expect(record.link.startsWith(`${PAGE}#share=`)).toBe(true);
    const parsed = parseShareLink(record.link)!;
    expect(parsed.id).toBe(record.id);
    expect(parsed.key).toHaveLength(43);
    expect(parseShareLink(`${PAGE}#share=nope`)).toBeNull();
    expect(parseShareLink(PAGE)).toBeNull();
  });

  it('previews without using up, imports once, needs no library, and carries no EID', async () => {
    const { api, lib, worker } = await setup();
    const record = await createShare(lib, { planner: 'ascension', name: 'My run', timestamp: 5, data: planWithIdentity }, 'once', PAGE);

    const stranger = new CloudApi('https://cloud.test', worker.fetch);
    expect(await previewShare(stranger, record.link)).toMatchObject({ kind: 'once', name: 'My run' });
    expect(await previewShare(stranger, record.link)).not.toBeNull();
    const plan = await claimShare<typeof planWithIdentity>(stranger, record.link);
    expect(plan?.name).toBe('My run');
    expect(JSON.stringify(plan)).not.toMatch(/EI\d{16}/i);
    expect(JSON.stringify(plan)).not.toContain('RealName');
    expect(await claimShare(stranger, record.link)).toBeNull();
    expect(await previewShare(api, record.link)).toBeNull();
  });

  it('multi-use links import many times', async () => {
    const { lib, api } = await setup();
    const record = await createShare(lib, { planner: 'enlightenment', name: 'E', timestamp: 1, data: { n: 1 } }, 'multi', PAGE);
    for (let i = 0; i < 3; i++) expect((await claimShare(api, record.link))?.data).toEqual({ n: 1 });
  });

  it('stores nothing that leads back to the sender', async () => {
    const { lib, worker } = await setup();
    await createShare(lib, { planner: 'ascension', name: 'SECRET-NAME', timestamp: 1, data: planWithIdentity }, 'once', PAGE);
    for (const share of worker.shares.values()) {
      const text = new TextDecoder('latin1').decode(share.body) + share.title;
      expect(text).not.toContain(lib.marker);
      expect(text).not.toContain(EID);
      expect(text).not.toContain('SECRET-NAME');
    }
  });

  it('lists, revokes and forgets used shares', async () => {
    const { lib, api } = await setup();
    const a = await createShare(lib, { planner: 'ascension', name: 'A', timestamp: 1, data: 1 }, 'once', PAGE);
    const b = await createShare(lib, { planner: 'ascension', name: 'B', timestamp: 1, data: 2 }, 'multi', PAGE);
    const c = await createShare(lib, { planner: 'ascension', name: 'C', timestamp: 1, data: 3 }, 'once', PAGE);
    await claimShare(api, a.link);
    expect((await listShares(lib)).map(s => [s.name, s.live])).toEqual([['A', false], ['B', true], ['C', true]]);
    await revokeShare(lib, b.id);
    expect(await claimShare(api, b.link)).toBeNull();
    expect(await forgetUsedShares(lib)).toBe(1);
    expect(lib.index.shares.map(s => s.id)).toEqual([c.id]);

    // Another device sees the same list (it's in the synced index).
    const other = await CloudLibrary.unlock(api, EID, '111111');
    expect(other.index.shares.map(s => s.name)).toEqual(['C']);
  });
});

describe('replace', () => {
  it('replaces a library whose PIN was forgotten', async () => {
    const { api, lib } = await setup();
    await lib.savePlan({ planner: 'ascension', name: 'lost', timestamp: 1, data: 1 });
    const fresh = await CloudLibrary.create(api, EID, 'pin4', '4321', 1000, true);
    expect(fresh.plans()).toEqual([]);
    expect((await CloudLibrary.lookup(api, EID))?.pinType).toBe('pin4');
    await expect(CloudLibrary.unlock(api, EID, '111111')).rejects.toMatchObject({ code: 'pin_format' });
    expect((await CloudLibrary.unlock(api, EID, '4321')).plans()).toEqual([]);
  });
});
