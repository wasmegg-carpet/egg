/**
 * Buying research the way the milestone view does: each level with a wait for every research sale
 * and 2x earnings start or end its saving crosses (and, with the ROI gate, held for the sale when it
 * no longer clears the 70% bar), and farm purchases step by step. Shared by the research views
 * (ResearchActions.vue) and the enlightenment planner's Smart Wait for Population.
 */
import { useActionsStore } from '@planner/stores/actions';
import { usePlanStore } from '@planner/stores/plan';
import { generateActionId } from '@planner/types';
import { getResearchById, type CommonResearch, type ResearchCostModifiers } from '@planner/calculations/commonResearch';
import { useCommonResearchStore } from '../stores/commonResearch';
import { computeDependencies } from '../actions/executor';
import { researchPurchaseAt } from '../engine/researchSale';
import { getSimulationContext } from '../engine/adapter';
import { boostTransitionsFrom } from '../engine/apply/math';
import { getSaleAwareTimeToSave, shouldDeferToNextSale, findEventCrossings } from '../calculations/researchROI';
import { getNextSaleStart } from '../events';
import { DEBUG_MILESTONE_EXECUTION } from '../debugFlags';
import type { FarmPurchaseStep } from '../calculations/farmPurchases';
import type { useEventCrossingWaits } from './usePlannerEventCrossingWaits';
import type { useFarmPurchaseActions } from './useFarmPurchaseActions';

/** A research level (anything with `research`) or a farm purchase's steps. */
export type ChainBuyItem = { research: CommonResearch } | { kind: 'farm'; steps: FarmPurchaseStep[] };

export interface ResearchPurchasesDeps {
  crossingWaits: ReturnType<typeof useEventCrossingWaits>;
  farmActions: Pick<ReturnType<typeof useFarmPurchaseActions>, 'buyHab' | 'buyVehicle' | 'buyTrainCar'>;
  /** Research price modifiers at the point being bought from. */
  costModifiers: () => ResearchCostModifiers;
  /** The research sale's end (absolute seconds) the 70% ROI gate looks to. */
  researchSaleDeadline: () => number;
  /** Runs after each research level bought. */
  afterBuy?: () => void;
}

export function useResearchPurchases(deps: ResearchPurchasesDeps) {
  const commonResearchStore = useCommonResearchStore();
  const actionsStore = useActionsStore();
  const planStore = usePlanStore();
  const { prepareExecution, completeExecution, insertWait, insertEventCrossingWaits, insertCrossingWaits } =
    deps.crossingWaits;
  const { buyHab, buyVehicle, buyTrainCar } = deps.farmActions;

  /**
   * Buy a single level of research and create the action.
   * Returns true if successful, false if already maxed.
   */
  function buyOneLevel(research: CommonResearch): boolean {
    const currentLevel = commonResearchStore.researchLevels[research.id] || 0;
    if (currentLevel >= research.levels) return false;

    insertCrossingWaits(research);

    // Prepare execution (restores stores if editing past group)
    const beforeSnapshot = prepareExecution();

    // Calculate cost based on current state (after restore if editing)
    const effectiveLevel = beforeSnapshot.researchLevels[research.id] || 0;
    const isSaleActive = beforeSnapshot.activeSales.research;
    const cost = researchPurchaseAt(research, effectiveLevel, beforeSnapshot, getSimulationContext()).price;

    // Build payload
    const payload = {
      researchId: research.id,
      fromLevel: effectiveLevel,
      toLevel: effectiveLevel + 1,
    };

    // Compute dependencies (level N depends on the action that bought level N-1)
    const dependencies = computeDependencies(
      'buy_research',
      payload,
      actionsStore.actionsBeforeInsertion,
      actionsStore.initialSnapshot.researchLevels
    );

    if (DEBUG_MILESTONE_EXECUTION) {
      console.log(
        `[useResearchPurchases] buyOneLevel: ${research.id} Lv${effectiveLevel}, now=${new Date(absoluteSimTimeAt(beforeSnapshot.lastStepTime) * 1000).toISOString()}, bank=${beforeSnapshot.bankValue}, isSaleActive=${isSaleActive} -> cost=${cost}`
      );
    }

    // Apply to store
    commonResearchStore.setResearchLevel(research.id, effectiveLevel + 1);

    // Complete execution (computes snapshot, inserts/pushes action, replays if needed)
    completeExecution(
      {
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'buy_research',
        payload,
        cost,
        dependsOn: dependencies,
      },
      beforeSnapshot
    );

    deps.afterBuy?.();

    return true;
  }

  /**
   * Absolute Unix timestamp (seconds) that `lastStepTime` (a snapshot's plan-relative clock reading)
   * corresponds to — same formula `WaitForEventActions.vue`/`useResearchViews.ts` use everywhere else.
   */
  function absoluteSimTimeAt(lastStepTime: number): number {
    const baseTimestamp = planStore.planStartTime.getTime() / 1000;
    return baseTimestamp + (lastStepTime - actionsStore.planStartOffset);
  }

  /**
   * Before buying `item.research`, bring `activeSales.research`/`earningsBoost.active` in line with
   * whether THIS SPECIFIC purchase — computed fresh from the live/current state — actually resolves
   * during each event or not. Deliberately does NOT trust a plan's precomputed `duringSale`/
   * `duringEarningsBoost` (as an earlier version of this function did): those are snapshotted at
   * planning time, and can drift from what's actually true by the time execution reaches this item
   * (e.g. because an earlier item in the same batch banked more, or less, than the plan assumed —
   * `syncEventStateForItem` itself, by inserting real actions, is one such source of drift). Recomputing
   * live here makes the sync self-correcting regardless of that drift's size or source, instead of
   * blindly forcing a wait for an event boundary the live state may already be past or short of.
   *
   * Sale and boost crossings are computed ONCE, over the SAME true wait window (`purchase.waitSeconds`
   * from `getSaleAwareTimeToSave`, which already accounts for whether waiting for the sale beats
   * buying now, and already prices in boost-accelerated earning during the wait via `transitions`),
   * then merged and walked in a single chronological pass — not two separate sequential blocks. An
   * earlier version handled sale and boost independently: a "sale" block computed both crossing types
   * from the true starting point but only ever inserted the sale ones, then a separate "boost" block
   * re-derived its OWN wait from whatever state the sale block had already advanced to. Any boost
   * window that fell entirely inside the *sale-waiting* period was computed correctly the first time
   * (it's right there in that first call's own `crossings.boost`) but silently discarded, and the
   * second block's from-scratch window started only AFTER that boundary had already passed, so it
   * never got a another chance to find it. Merging both lists chronologically here fixes that: every
   * crossing — sale or boost, in whatever order they actually occur — gets its own wait action.
   *
   * When a boundary genuinely is crossed, a `wait_for_research_sale`/`wait_for_earnings_boost`
   * (starting) or `wait_for_research_sale_end`/`wait_for_earnings_boost_end` (ending) action is inserted for exactly the calendar distance to that boundary. This
   * doesn't double-count time: the wait's duration is independent of price, and the purchase that
   * follows computes its own (correspondingly shorter) remaining wait from the bank/population the
   * wait action already advanced to. When no boundary is actually crossed, nothing is inserted at all.
   *
   * `checkRoiGate` (only passed `true` by `handleBuyMilestoneChain`, and only for a research-level
   * milestone target) additionally enforces the same "clears 70% ROI by the next research sale" bar
   * `computeResearchMilestoneChain`'s own detour/target steps now require before including a purchase
   * — see that function's doc comment (`milestoneChain.ts`) for why: without it, a purchase that only
   * becomes affordable a few minutes before a sale gets bought immediately at full price, when waiting
   * those few minutes would have meant 70% off. Recomputed fresh here (not trusted from the plan) for
   * the same self-correcting reason every other number in this function is. Deliberately NOT applied
   * for a TIER milestone target: most of that chain is `computeTierMilestoneChain`'s cheapest-first
   * tail, which buys by price/ROI-speed alone with no such gate (every purchase counts toward a tier
   * unlock regardless of ROI) — checking it live there would defer cheap filler purchases the plan
   * never screened for it, a real wait the preview never showed. Also not applied to
   * `runSaleAwareBuyFlow`'s or "Buy Until Sale Ends"'s own calls — their candidates are already
   * selected by rules (the 70% button literally, "Buy Until Sale Ends" by delivery impact rather than
   * earnings ROI) this gate would be redundant or actively wrong for.
   */
  function syncEventStateForItem(item: { research: CommonResearch }, checkRoiGate = false) {
    const beforeSnapshot = prepareExecution();
    const level = beforeSnapshot.researchLevels[item.research.id] || 0;
    if (level >= item.research.levels) return;

    const absoluteSimTime = absoluteSimTimeAt(beforeSnapshot.lastStepTime);
    const transitions = boostTransitionsFrom(beforeSnapshot, absoluteSimTime);
    const isSaleActive = beforeSnapshot.activeSales.research;
    const isBoostActive = beforeSnapshot.earningsBoost.active;
    const purchase = getSaleAwareTimeToSave(
      item.research,
      level,
      deps.costModifiers(),
      isSaleActive,
      absoluteSimTime,
      beforeSnapshot,
      transitions
    );

    // Already timed to buy during a real sale (or waiting for a later one) — `shouldDeferToNextSale`'s
    // own during-sale bypass would pass trivially, so skip the extra check entirely.
    if (checkRoiGate && !purchase.duringSale) {
      const nextSale = getNextSaleStart(absoluteSimTime);
      const defer = shouldDeferToNextSale(
        item.research,
        level,
        deps.costModifiers(),
        beforeSnapshot,
        getSimulationContext(),
        absoluteSimTime,
        nextSale,
        deps.researchSaleDeadline(),
        isSaleActive,
        transitions,
        purchase.duringSale
      );

      if (defer) {
        if (DEBUG_MILESTONE_EXECUTION) {
          console.log(
            `[useResearchPurchases] syncEventStateForItem: ${item.research.id} Lv${level} would not clear 70% ROI before nextSaleStart=${new Date(nextSale * 1000).toISOString()} at full price — waiting for the sale instead of buying now`
          );
        }
        advanceToDeadline(nextSale);
        return;
      }
    }

    const crossings = findEventCrossings(absoluteSimTime, purchase.waitSeconds, isSaleActive, isBoostActive);

    if (DEBUG_MILESTONE_EXECUTION) {
      const completesAt = absoluteSimTime + purchase.waitSeconds;
      console.log(
        `[useResearchPurchases] syncEventStateForItem: ${item.research.id} Lv${level}, now=${new Date(absoluteSimTime * 1000).toISOString()}, bank=${beforeSnapshot.bankValue}, offlineEarnings=${beforeSnapshot.offlineEarnings}, isSaleActive=${isSaleActive} -> price=${purchase.price}, waitSeconds=${purchase.waitSeconds}, duringSale=${purchase.duringSale}, completesAt=${new Date(completesAt * 1000).toISOString()}, saleCrossings=${crossings.sale.length}, boostCrossings=${crossings.boost.length}`
      );
    }

    insertEventCrossingWaits(absoluteSimTime, crossings, beforeSnapshot);
  }

  /**
   * Carries the plan's clock the rest of the way to `targetDeadline` on its own, inserting whatever
   * wait actions the remaining sale/boost crossings between "wherever the buy loop stopped"
   * and the deadline need. `runSaleAwareBuyFlow`'s buy loop only advances time as a side effect of
   * `syncEventStateForItem` calls made right before each purchase — so if it stops because
   * `getNextCandidate()` ran out of qualifying research (rather than because the deadline was
   * actually reached), nothing else ever carries the plan forward, and the promised "wait for the
   * sale to end, then the boost, then wait for the next sale" progression silently doesn't happen. A
   * no-op if `targetDeadline` has already been reached (e.g. the transitional bypass purchase already
   * carried the clock there).
   */
  function advanceToDeadline(targetDeadline: number) {
    if (!isFinite(targetDeadline)) return;
    const beforeSnapshot = prepareExecution();
    const absoluteSimTime = absoluteSimTimeAt(beforeSnapshot.lastStepTime);
    const waitSeconds = targetDeadline - absoluteSimTime;
    if (waitSeconds <= 0) return;

    const isSaleActive = beforeSnapshot.activeSales.research;
    const isBoostActive = beforeSnapshot.earningsBoost.active;
    const crossings = findEventCrossings(absoluteSimTime, waitSeconds, isSaleActive, isBoostActive);

    const { snapshot: afterSnapshot, cursor } = insertEventCrossingWaits(absoluteSimTime, crossings, beforeSnapshot);

    // Any stretch after the last crossing (or the whole window, if there were none at all — e.g. no
    // boost is due before the next sale) still needs a plain wait so the clock actually reaches
    // targetDeadline, not just its last crossing.
    const remaining = targetDeadline - cursor;
    if (remaining > 0) {
      insertWait('wait_for_time', remaining, afterSnapshot);
    }
  }

  /**
   * Buys one purchase of a research list or a milestone chain. A research level is bought the usual
   * way, with the research sale and boost synced to when it lands (and, with `checkRoiGate`, held for
   * the sale if it no longer clears the 70% bar). A farm purchase buys each of its steps: a fleet
   * research level first if it has one, then the vehicle, train car or hab. Must run inside `batch`.
   */
  function buyChainItem(item: ChainBuyItem, checkRoiGate: boolean): boolean {
    if (!('kind' in item && item.kind === 'farm')) {
      const research = (item as { research: CommonResearch }).research;
      syncEventStateForItem({ research }, checkRoiGate);
      return buyOneLevel(research);
    }
    return buyFarmSteps(item.steps, checkRoiGate);
  }

  /** Buys a farm purchase's steps in order. False if a step couldn't be bought. Must run inside `batch`. */
  function buyFarmSteps(steps: FarmPurchaseStep[], checkRoiGate: boolean): boolean {
    for (const step of steps) {
      const payload = step.payload as Record<string, number>;
      if (step.type === 'buy_research') {
        const research = getResearchById(String(step.payload.researchId));
        if (!research) return false;
        syncEventStateForItem({ research }, checkRoiGate);
        if (!buyOneLevel(research)) return false;
      } else if (step.type === 'buy_vehicle') {
        if (!buyVehicle(payload.slotIndex, payload.vehicleId)) return false;
      } else if (step.type === 'buy_train_car') {
        if (!buyTrainCar(payload.slotIndex, payload.fromLength)) return false;
      } else if (!buyHab(payload.slotIndex, payload.habId)) {
        return false;
      }
    }
    return true;
  }

  return { absoluteSimTimeAt, syncEventStateForItem, advanceToDeadline, buyOneLevel, buyChainItem, buyFarmSteps };
}
