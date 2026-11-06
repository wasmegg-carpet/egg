import { computed } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { useSalesStore } from 'lib/planners/stores/sales';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { generateActionId } from '@/types';
import { computeDependencies } from '@/lib/actions/executor';
import { getNextPacificTime, getNextSaleEnd, getNextSaleStart } from 'lib/planners/events';

/**
 * Advances the plan to the next research sale boundary. The sale itself follows sim time (see
 * engine/researchSale.ts), so these only need to move the clock. Shared by the Wait tab, the Smart
 * Buy view and the Research Sale toggle.
 */
export function useResearchSaleWaits() {
  const actionsStore = useActionsStore();
  const virtueStore = useVirtueStore();
  const salesStore = useSalesStore();
  const { prepareExecution, completeExecution, batch } = useActionExecutor();

  /**
   * Calculates the "Absolute Simulation Clock" in Unix seconds.
   * This is (Start Time) + (Current Simulation Seconds - Start Offset).
   * The offset ensures that T=0 in the plan maps to the date/time the user entered.
   */
  const absoluteSimTime = computed(() => {
    const startSeconds = virtueStore.planStartTime.getTime() / 1000;
    const elapsedSeconds = actionsStore.effectiveSnapshot.lastStepTime;
    const offsetSeconds = actionsStore.planStartOffset;
    return startSeconds + (elapsedSeconds - offsetSeconds);
  });

  const secondsUntilNextSale = computed(() => Math.max(0, getNextSaleStart(absoluteSimTime.value) - absoluteSimTime.value));
  const secondsUntilSaleEnd = computed(() => Math.max(0, getNextSaleEnd(absoluteSimTime.value) - absoluteSimTime.value));

  // Chains each new action off the previous one so ordering (and undo) stays correct.
  // The very first action instead depends on whatever preceded this batch.
  function createChain() {
    let lastId: string | null = null;

    async function addWait(
      type:
        | 'wait_for_research_sale'
        | 'wait_for_research_sale_end'
        | 'wait_for_earnings_boost'
        | 'wait_for_earnings_boost_end',
      totalTimeSeconds: number
    ) {
      const before = prepareExecution();
      const id = generateActionId();
      const payload = { totalTimeSeconds: Math.max(0, totalTimeSeconds) };

      await completeExecution(
        {
          id,
          timestamp: Date.now(),
          type,
          payload,
          cost: 0,
          dependsOn: lastId
            ? [lastId]
            : computeDependencies(
                type,
                payload,
                actionsStore.actionsBeforeInsertion,
                actionsStore.initialSnapshot.researchLevels
              ),
        },
        before
      );
      lastId = id;
    }

    async function addToggleEarningsBoost(active: boolean) {
      const before = prepareExecution();
      const id = generateActionId();
      const payload = { active, multiplier: 2 };

      salesStore.setEarningsBoost(active, active ? 2 : 1);

      await completeExecution(
        {
          id,
          timestamp: Date.now() + 1,
          type: 'toggle_earnings_boost',
          payload,
          cost: 0,
          dependsOn: lastId ? [lastId] : [],
        },
        before
      );
      lastId = id;
    }

    return { addWait, addToggleEarningsBoost };
  }

  /** Waits for the next sale to start (Friday 9 AM Pacific), handling any 2x Earnings on the way. */
  async function waitForNextSale() {
    await batch(async () => {
      const { addWait, addToggleEarningsBoost } = createChain();
      const startTime = absoluteSimTime.value;
      const researchSaleTarget = getNextSaleStart(startTime);
      const boostActive = actionsStore.effectiveSnapshot.earningsBoost.active;
      const boostEnd = getNextPacificTime(2, 9, startTime);

      if (boostActive && boostEnd < researchSaleTarget) {
        // 2x Earnings is already running: ride it out to 9AM the next morning, end it,
        // then keep waiting for the research sale.
        await addWait('wait_for_earnings_boost_end', boostEnd - startTime);
        await addToggleEarningsBoost(false);
        await addWait('wait_for_research_sale', researchSaleTarget - boostEnd);
        return;
      }

      const boostStart = getNextPacificTime(1, 9, startTime);
      if (!boostActive && boostStart < researchSaleTarget) {
        // 2x Earnings will start before the research sale does: wait for it, start it,
        // ride out the full 24h, end it, then keep waiting for the research sale.
        const nextBoostEnd = getNextPacificTime(2, 9, boostStart);
        await addWait('wait_for_earnings_boost', boostStart - startTime);
        await addToggleEarningsBoost(true);
        await addWait('wait_for_earnings_boost_end', nextBoostEnd - boostStart);
        await addToggleEarningsBoost(false);
        await addWait('wait_for_research_sale', researchSaleTarget - nextBoostEnd);
        return;
      }

      // No overlap with 2x Earnings — just wait for the research sale.
      await addWait('wait_for_research_sale', researchSaleTarget - startTime);
    });
  }

  /** Waits for the current sale to end (Saturday 9 AM Pacific). */
  async function waitForSaleEnd() {
    await batch(async () => {
      await createChain().addWait('wait_for_research_sale_end', secondsUntilSaleEnd.value);
    });
  }

  return { secondsUntilNextSale, secondsUntilSaleEnd, waitForNextSale, waitForSaleEnd };
}
