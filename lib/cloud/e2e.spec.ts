/**
 * The client against a real worker. Skipped unless CLOUD_E2E_URL is set, e.g.:
 *
 *   (cd ../joo-cloudflare && npm run dev)            # http://localhost:8787
 *   CLOUD_E2E_URL=http://localhost:8787 npx vitest run ../../lib/cloud/e2e.spec.ts   (from a planner)
 *
 * Library creation checks the EID with the real Egg Inc API, so it needs a real player's EID:
 * CLOUD_E2E_EID, defaulting to lib/api's `defaultUserId` (the volunteer-donated one; referenced, never copied,
 * so the ID stays out of plain text). The test deletes the library it
 * makes; run it against `wrangler dev` or a test deployment, not production.
 */
import { describe, expect, it } from 'vitest';
import { defaultUserId } from '../api';
import { CloudApi, CloudError } from './api';
import { CloudLibrary } from './library';
import { claimShare, createShare, previewShare } from './share';

const url = process.env.CLOUD_E2E_URL;
const eid = process.env.CLOUD_E2E_EID ?? defaultUserId;
const PIN = '246810';

describe.skipIf(!url)('cloud library against a real worker', () => {
  it('runs the whole lifecycle', { timeout: 60_000 }, async () => {
    const api = new CloudApi(url);

    // Clear a library left by an earlier run.
    if (await CloudLibrary.lookup(api, eid)) await (await CloudLibrary.unlock(api, eid, PIN)).deleteLibrary();

    const phone = await CloudLibrary.create(api, eid, 'pin6', PIN, 1000);
    const id = await phone.savePlan({ planner: 'ascension', name: 'e2e', timestamp: 1, data: { big: 'x'.repeat(100_000) } });

    const wrong = await CloudLibrary.unlock(api, eid, '000000').catch(e => e);
    expect(wrong).toBeInstanceOf(CloudError);
    expect((wrong as CloudError).code).toBe('wrong_pin');

    const laptop = await CloudLibrary.unlock(api, eid, PIN);
    expect(laptop.plans().map(p => p.id)).toEqual([id]);
    expect((await laptop.loadPlan<{ big: string }>(id))?.data.big).toHaveLength(100_000);

    // Two devices editing the index: the second save merges after a real 412 from R2.
    await laptop.savePlan({ planner: 'enlightenment', name: 'from laptop', timestamp: 2, data: 1 });
    await phone.savePlan({ planner: 'ascension', name: 'from phone', timestamp: 3, data: 2 });
    await laptop.refresh();
    expect(laptop.plans().map(p => p.name).sort()).toEqual(['e2e', 'from laptop', 'from phone']);

    expect(await laptop.touch()).toEqual({ missing: [] });

    const remembered = phone.remember();
    await phone.changePin('password', 'correct horse battery');
    const stale = await CloudLibrary.resume(api, remembered).catch(e => e);
    expect((stale as CloudError).code).toBe('wrong_pin');
    const reopened = await CloudLibrary.unlock(api, eid, 'correct horse battery');
    expect(reopened.plans()).toHaveLength(3);

    // Shares: preview doesn't use up a one-time link; importing does; a stranger needs no library.
    const shared = await createShare(reopened, { planner: 'ascension', name: 'shared', timestamp: 4, data: { eid } }, 'once', 'https://example.test/ap/');
    const stranger = new CloudApi(url);
    expect((await previewShare(stranger, shared.link))?.name).toBe('shared');
    const imported = await claimShare<{ eid: string }>(stranger, shared.link);
    expect(imported?.data.eid).toBe('EIxxxxxxxxxx');
    expect(await claimShare(stranger, shared.link)).toBeNull();

    // Replace (forgotten PIN), then clean up.
    const replaced = await CloudLibrary.create(api, eid, 'pin4', '1357', 1000, true);
    expect(replaced.plans()).toEqual([]);
    await replaced.deleteLibrary();
    expect(await CloudLibrary.lookup(api, eid)).toBeNull();
  });
});
