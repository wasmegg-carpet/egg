import { describe, expect, it } from 'vitest';
import { readHandoff, routeToHandoff, searchWithoutHandoff } from './autoPlannerHandoff';
import type { Route, RouteLeg } from './routeFinder';
import type { InstantAnswer } from '@/stores/instantSearch';

const H = 3600;
const leg = (from: number, to: number, start: number, end: number, extra: Partial<RouteLeg> = {}): RouteLeg => ({
  from, to, endTE: to, start, end, sales: 2, tier13: false, rate: 1, exactFrom: from, exactEnd: to, ...extra,
});
const route = (legs: RouteLeg[]): Route => ({
  chain: legs.map(l => l.to), legs, end: legs[legs.length - 1].end, seconds: 0,
});
const answer = (extra: Partial<InstantAnswer> = {}): InstantAnswer => ({
  found: {} as InstantAnswer['found'], ms: 0, mode: 'te', startTE: 200, start: 1000 * H, final: 300,
  timezone: 'America/Chicago', hypothetical: true, inProgress: null,
  blocks: { dates: [], hours: [], timezone: 'America/Chicago' }, waitForEggs: true,
  startDelivered: [0, 0, 0, 0, 0], siloMode: false, earningsShift: 0,
  options: { startTE: 200, start: 1000 * H, final: 300, maxAscensions: 12 }, ...extra,
});

describe('routeToHandoff', () => {
  it('maps legs to targets and builds, and a waited prestige to the previous end', () => {
    const r = route([
      leg(200, 250, 1000 * H, 1100 * H, { sales: 3, tier13: true }),
      leg(252, 300, 1105 * H, 1200 * H, { waited: 5 * H }),
    ]);
    const h = routeToHandoff(answer({ siloMode: true }), r);
    expect(h.targets).toEqual([250, 300]);
    expect(h.start).toBe(1000 * H);
    expect(h.variantOverrides).toEqual({ 0: '3-sale-tier13', 1: '2-sale' });
    expect(h.endTimeOverrides).toEqual({ 0: 1105 * H });
    expect(h.siloMode).toBe(true);
  });

  it('continues the ascension in progress to a waited first prestige', () => {
    const r = route([leg(210, 250, 1010 * H, 1100 * H, { waited: 2 * H })]);
    const h = routeToHandoff(answer({ hypothetical: false, inProgress: { claimedTE: 200 } }), r, 1000 * H);
    expect(h.targets).toEqual([210, 250]);
    expect(h.start).toBe(1000 * H);
    expect(h.variantOverrides).toEqual({ 0: 'continue', 1: '2-sale' });
    expect(h.endTimeOverrides).toEqual({ 0: 1010 * H });
  });

  it('never starts a plan from the save before now', () => {
    const r = route([leg(200, 250, 1001 * H, 1100 * H)]);
    const h = routeToHandoff(answer({ hypothetical: false }), r, 1003 * H);
    expect(h.start).toBe(1003 * H);
  });

  it('starts a route from the save from the backup, a hypothetical one from its TE', () => {
    const r = route([leg(200, 250, 1000 * H, 1100 * H)]);
    expect(routeToHandoff(answer({ hypothetical: false }), r, 1000 * H).fromSave).toBe(true);
    expect(routeToHandoff(answer(), r).fromSave).toBe(false);
  });
});

describe('URL', () => {
  it('reads a handoff back and strips it', () => {
    const h = routeToHandoff(answer(), route([leg(200, 300, 1000 * H, 1100 * H)]));
    const search = `?playerId=EI1&tab=auto-planner&chain=${encodeURIComponent(JSON.stringify(h))}`;
    expect(readHandoff(search)).toEqual(h);
    expect(searchWithoutHandoff(search)).toBe('?playerId=EI1&tab=auto-planner');
    expect(readHandoff('?chain=nope')).toBeNull();
  });
});
