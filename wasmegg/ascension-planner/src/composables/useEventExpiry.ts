import { ref } from 'vue';
import { checkEventCrossing, EventType } from '@/lib/actions/eventThresholds';
import { useActionsStore } from '@/stores/actions';
import { useSalesStore } from '@/stores/sales';
import { generateActionId } from '@/types';
import { computeDependencies } from '@/lib/actions/executor';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { useResearchSaleWaits } from '@/composables/useResearchSaleWaits';

export function useEventExpiry() {
    const actionsStore = useActionsStore();
    const salesStore = useSalesStore();
    const { prepareExecution, completeExecution } = useActionExecutor();
    const { waitForSaleEnd } = useResearchSaleWaits();

    const showExpiryDialog = ref(false);
    const expiryData = ref({
        eventName: '',
        endTime: 0,
        completionTime: 0,
        type: EventType.RESEARCH_SALE,
    });

    let pendingAction: (() => void) | null = null;

    /**
     * Checks if the action(s) cross an active event boundary and shows a warning if so.
     * 
     * @param duration Estimated duration of the action(s)
     * @param isResearch Whether this action involves research (checks Research Sale)
     * @param action Function to execute if confirmed
     */
    function withExpiryCheck(duration: number, isResearch: boolean, action: () => void) {
        const snapshot = actionsStore.effectiveSnapshot;

        // 1. Check Earnings Boost (affects everything)
        const earningsCrossing = checkEventCrossing(snapshot, duration, EventType.EARNINGS_BOOST);
        if (earningsCrossing.isCrossed) {
            expiryData.value = {
                ...earningsCrossing,
                eventName: '2x Earnings Boost',
                type: EventType.EARNINGS_BOOST,
            };
            showExpiryDialog.value = true;
            pendingAction = action;
            return;
        }

        // 2. Check Research Sale
        if (isResearch) {
            const researchCrossing = checkEventCrossing(snapshot, duration, EventType.RESEARCH_SALE);
            if (researchCrossing.isCrossed) {
                expiryData.value = {
                    ...researchCrossing,
                    eventName: 'Research Sale',
                    type: EventType.RESEARCH_SALE,
                };
                showExpiryDialog.value = true;
                pendingAction = action;
                return;
            }
        }

        // 3. No crossing or no active event
        action();
    }

    function cancel() {
        pendingAction = null;
        showExpiryDialog.value = false;
    }

    /**
     * Ends the currently expiring event: waits out a research sale, or adds an action turning off a boost.
     */
    async function deactivateEvent() {
        if (expiryData.value.type === EventType.RESEARCH_SALE) {
            // The sale follows sim time, so ending it means reaching the end of the sale.
            await waitForSaleEnd();
        } else {
            const beforeSnapshot = prepareExecution();
            const payload = {
                active: false,
                multiplier: 2,
            };
            salesStore.setEarningsBoost(false, 1);
            await completeExecution({
                id: generateActionId(),
                timestamp: Date.now(),
                type: 'toggle_earnings_boost',
                payload,
                cost: 0,
                dependsOn: computeDependencies(
                    'toggle_earnings_boost',
                    payload,
                    actionsStore.actionsBeforeInsertion,
                    actionsStore.initialSnapshot.researchLevels
                ),
            }, beforeSnapshot);
        }
    }

    /**
     * Deactivate the event and discard the original pending action.
     */
    async function deactivateAndCancel() {
        pendingAction = null;
        showExpiryDialog.value = false;
        await deactivateEvent();
    }

    /**
     * Deactivate the event, then run the original pending action.
     */
    async function deactivateAndContinue() {
        const actionToRun = pendingAction;
        pendingAction = null;
        showExpiryDialog.value = false;

        await deactivateEvent();

        if (actionToRun) {
            actionToRun();
        }
    }

    return {
        showExpiryDialog,
        expiryData,
        withExpiryCheck,
        cancel,
        deactivateAndCancel,
        deactivateAndContinue,
    };
}
