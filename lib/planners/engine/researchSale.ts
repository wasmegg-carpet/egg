import type { Action, BuyResearchPayload, CalculationsSnapshot } from '@planner/types';
import { BOUNDARY_EPSILON_SECONDS, isEarningsBoostActive, isResearchSaleActive } from '../events';
import { activeSlots, calculateArtifactModifiers } from '@planner/lib/artifacts';
import {
  getDiscountedResearchPrice,
  getResearchById,
  type CommonResearch,
  type ResearchCostModifiers,
} from '@planner/calculations/commonResearch';
import {
  findEventCrossings,
  getSaleAwareTimeToSave,
  type PurchaseEventCrossings,
  type SaleAwarePurchase,
} from '../calculations/researchROI';
import { boostTransitionsFrom } from './apply/math';
import { isResearchSaleAtSimTime } from './calendarEvents';
import type { SimulationContext } from '@planner/engine/types';

export {
  isResearchSaleAtSimTime,
  withCalendarResearchSale,
  hasStaleResearchSaleFlags,
} from './calendarEvents';

/** The research cost modifiers in effect at `snapshot`, whose loadout may differ from the live stores'. */
export function researchCostModifiersAt(
  snapshot: CalculationsSnapshot,
  context: SimulationContext
): ResearchCostModifiers {
  return {
    labUpgradeLevel: context.epicResearchLevels['cheaper_research'] || 0,
    researchCostMultiplier: context.colleggtibleModifiers.researchCost || 1,
    puzzleCubeMultiplier:
      context.researchCubeMultiplier ??
      calculateArtifactModifiers(activeSlots(snapshot.artifactLoadout, snapshot.proPermit)).researchCost
        .totalMultiplier,
  };
}

/**
 * What buying `research` at `level` from `snapshot` actually costs and how long it waits, priced for
 * when the money is ready rather than when the action starts. The one source for the manual planner's
 * charge, duration and displayed price, so the three can't disagree.
 *
 * Within `BOUNDARY_EPSILON_SECONDS` before a boundary the calendar flag has already flipped while the
 * raw clock hasn't, and `getSaleAwareTimeToSave` would read the sale from the wrong side of it (a wait
 * landing just short of Saturday 9 AM would still find the sale running) — so it's given a clock on
 * the same side as the flag.
 */
export function researchPurchaseAt(
  research: CommonResearch,
  level: number,
  snapshot: CalculationsSnapshot,
  context: SimulationContext
): SaleAwarePurchase {
  const absoluteTime = context.ascensionStartTime + (snapshot.lastStepTime - context.planStartOffset);
  const isSale = isResearchSaleAtSimTime(snapshot.lastStepTime, context.ascensionStartTime, context.planStartOffset);
  return getSaleAwareTimeToSave(
    research,
    level,
    researchCostModifiersAt(snapshot, context),
    isSale,
    isResearchSaleActive(absoluteTime) === isSale ? absoluteTime : absoluteTime + BOUNDARY_EPSILON_SECONDS,
    snapshot,
    boostTransitionsFrom(snapshot, absoluteTime)
  );
}

/**
 * The sale and 2x earnings boundaries a purchase's saving crosses, or null if it crosses none. 2x
 * earnings is read from the calendar like the earnings math does (see `boostTransitionsFrom`), since a
 * stale snapshot flag would walk to the wrong week's boundaries.
 *
 * `findEventCrossings` counts a boundary up to `BOUNDARY_EPSILON_SECONDS` past the money being ready,
 * so a purchase ready just before a sale boundary would also wait for it and land on the wrong price;
 * a last sale crossing that disagrees with the price being paid is dropped.
 */
export function eventCrossingsForPurchase(
  research: CommonResearch,
  level: number,
  snapshot: CalculationsSnapshot,
  context: SimulationContext
): PurchaseEventCrossings | null {
  const absoluteTime = context.ascensionStartTime + (snapshot.lastStepTime - context.planStartOffset);
  const purchase = researchPurchaseAt(research, level, snapshot, context);
  const crossings = findEventCrossings(
    absoluteTime,
    purchase.waitSeconds,
    isResearchSaleAtSimTime(snapshot.lastStepTime, context.ascensionStartTime, context.planStartOffset),
    isEarningsBoostActive(absoluteTime + BOUNDARY_EPSILON_SECONDS)
  );
  const lastSale = crossings.sale[crossings.sale.length - 1];
  if (lastSale && lastSale.togglesTo !== purchase.duringSale) crossings.sale.pop();
  return crossings.sale.length > 0 || crossings.boost.length > 0 ? crossings : null;
}

/**
 * Whether any stored research purchase paid the wrong side of the sale for when it completed — true of
 * plans saved while purchases were priced at their start. Only a cost matching the opposite sale state
 * counts, so a plan built with different cost modifiers isn't mistaken for one of these.
 */
export function hasStaleResearchPurchasePrices(actions: Action[], context: SimulationContext): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(a, b);
  return actions.some((a, i) => {
    const prev = actions[i - 1]?.endState;
    if (a.type !== 'buy_research' || !a.endState || !prev) return false;
    const payload = a.payload as BuyResearchPayload;
    const research = getResearchById(payload.researchId);
    if (!research) return false;
    const mods = researchCostModifiersAt(prev, context);
    const onSale = a.endState.activeSales.research;
    return (
      close(a.cost, getDiscountedResearchPrice(research, payload.fromLevel, mods, !onSale)) &&
      !close(a.cost, getDiscountedResearchPrice(research, payload.fromLevel, mods, onSale))
    );
  });
}
