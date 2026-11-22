import { describe, expect, it } from 'vitest';
import type { PlanData } from '../planners/storage/db';
import { LINKS_KEY, plannerStores } from './plannerStores';

/** A stand-in for createPlannerDb's functions, keyed the same way (partition + id). */
function fakeDb() {
  const plans = new Map<string, PlanData>();
  const metadata = new Map<string, unknown>();
  return {
    plans,
    metadata,
    loadLibraryPlans: async (partition: string) => [...plans.entries()].filter(([k]) => k.startsWith(`${partition}_`)).map(([, p]) => p),
    savePlanToLibrary: async (partition: string, plan: PlanData) => void plans.set(`${partition}_${plan.id}`, plan),
    deletePlanFromLibrary: async (partition: string, id: string) => void plans.delete(`${partition}_${id}`),
    saveMetadata: async (partition: string, key: string, value: unknown) => void metadata.set(`${partition}_${key}`, value),
    loadMetadata: async <T,>(partition: string, key: string) => (metadata.get(`${partition}_${key}`) as T | undefined) ?? null,
  };
}

describe('plannerStores', () => {
  it('reads and writes one partition’s plans and links', async () => {
    const db = fakeDb();
    db.plans.set('other_x', { id: 'x', name: 'someone else', timestamp: 1, data: null });
    const { local, links } = plannerStores(db, 'mine');

    expect(await links.load()).toBeNull();
    await local.save({ id: 'a', name: 'A', timestamp: 1, data: { n: 1 } });
    expect((await local.list()).map(p => p.id)).toEqual(['a']);
    await links.save({ a: { cloudId: 'c', syncedTimestamp: 1 } });
    expect(db.metadata.get(`mine_${LINKS_KEY}`)).toEqual({ a: { cloudId: 'c', syncedTimestamp: 1 } });
    expect(await links.load()).toEqual({ a: { cloudId: 'c', syncedTimestamp: 1 } });

    await local.remove('a');
    expect(await local.list()).toEqual([]);
    expect(db.plans.has('other_x')).toBe(true);
  });
});
