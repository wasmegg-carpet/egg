/**
 * A Chain Finder route handed to the Auto Planner in a new browser tab: the page URL carries it
 * (`?tab=auto-planner&chain=…`), App.vue reads it on load and AutomaticPlanner.vue applies it once its
 * backup is in, then generates.
 *
 * MAPPING. Each leg is one Auto Planner ascension, its stop the target TE and its build pinned as the
 * variant (`N-sale`, `-tier13`). A prestige that waits (for eggs, or for blocked dates or hours) is
 * the previous ascension's end-time override at that prestige: the farm lays on until then. Ending
 * the ascension in progress later than now (a first prestige that waits) is an extra first ascension,
 * the farm in progress continued to that moment.
 */
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { searchWithTab } from '@/stores/ui';
import type { Route } from './routeFinder';
import { EGG_ORDER } from './precomputedLeg';
import type { InstantAnswer } from '@/stores/instantSearch';
import type { VariantKey } from '@/stores/autoPlanner';
import type { VirtueEgg } from '@/types';

export interface ChainHandoff {
  /** Target TE of each ascension. */
  targets: number[];
  /** Unix second the first ascension starts, and the zone the planner shows times in. */
  start: number;
  timezone: string;
  /** TE per egg the plan starts from (pending TE claimed). Only for a hypothetical start. */
  teEarned: Partial<Record<VirtueEgg, number>>;
  /** The route starts from the save as it is: the planner starts from the backup (claimed and
   *  pending TE, eggs laid since the last sync) instead of `teEarned`, and from now unless `start`
   *  is later. */
  fromSave: boolean;
  /** Ascension index -> unix second it ends at instead of at its target. */
  endTimeOverrides: Record<number, number>;
  /** Ascension index -> the build the route used. */
  variantOverrides: Record<number, VariantKey>;
  /** The table was built in silo mode (defer for earnings). */
  siloMode: boolean;
}

const PARAM = 'chain';

function buildVariant(leg: Route['legs'][number]): VariantKey | null {
  if (leg.continued) return 'continue';
  if (leg.sales < 1 || leg.sales > 3) return null;
  return `${leg.sales as 1 | 2 | 3}-sale${leg.tier13 ? '-tier13' : ''}` as VariantKey;
}

/** The Auto Planner inputs that reproduce `route`, as of `now` (unix seconds). */
export function routeToHandoff(answer: InstantAnswer, route: Route, now = Date.now() / 1000): ChainHandoff {
  const legs = route.legs;
  const first = legs[0];
  // Ending the ascension in progress at a later prestige than now: continue it until then first.
  const endsLater = !!answer.inProgress && !first.continued && (!!first.waited || !!first.held);

  const targets: number[] = [];
  const endTimeOverrides: Record<number, number> = {};
  const variantOverrides: Record<number, VariantKey> = {};
  if (endsLater) {
    targets.push(first.from);
    endTimeOverrides[0] = first.start;
    variantOverrides[0] = 'continue';
  }
  const offset = targets.length;
  legs.forEach((leg, i) => {
    const k = offset + i;
    targets.push(leg.to);
    const variant = buildVariant(leg);
    if (variant) variantOverrides[k] = variant;
    const next = legs[i + 1];
    if (next && (next.waited || next.held)) endTimeOverrides[k] = next.start;
  });

  // Continuing starts now; a prestige at its whole hour, but never before now when it is the save's.
  const prestigeStart = endsLater || first.continued ? answer.start : first.start;
  const start = Math.floor(answer.hypothetical ? prestigeStart : Math.max(prestigeStart, now));

  const teEarned: Partial<Record<VirtueEgg, number>> = {};
  EGG_ORDER.forEach((egg, i) => (teEarned[egg] = countTEThresholdsPassed(answer.startDelivered[i])));

  return {
    targets,
    start,
    timezone: answer.timezone,
    teEarned,
    fromSave: !answer.hypothetical,
    endTimeOverrides,
    variantOverrides,
    siloMode: answer.siloMode,
  };
}

/** The page URL that opens the Auto Planner with `handoff`, other parameters (playerId) kept. */
export function handoffUrl(handoff: ChainHandoff, location: Location = window.location): string {
  const params = new URLSearchParams(searchWithTab(location.search, 'automatic'));
  params.set(PARAM, JSON.stringify(handoff));
  return `${location.pathname}?${params.toString()}${location.hash}`;
}

/** The handoff a query string carries, or null (none, or not readable). */
export function readHandoff(search: string): ChainHandoff | null {
  const raw = new URLSearchParams(search).get(PARAM);
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as ChainHandoff;
    if (!Array.isArray(h.targets) || !h.targets.length || !Number.isFinite(h.start)) return null;
    return {
      targets: h.targets.map(Number),
      start: h.start,
      timezone: h.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      teEarned: h.teEarned ?? {},
      fromSave: !!h.fromSave,
      endTimeOverrides: h.endTimeOverrides ?? {},
      variantOverrides: h.variantOverrides ?? {},
      siloMode: !!h.siloMode,
    };
  } catch {
    return null;
  }
}

/** `search` without the handoff, so a refresh doesn't load it over the user's changes again. */
export function searchWithoutHandoff(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PARAM);
  const out = params.toString();
  return out ? `?${out}` : '';
}
