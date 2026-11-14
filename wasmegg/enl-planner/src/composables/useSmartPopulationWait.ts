/**
 * Smart Wait for Population (Wait tab): works out the timeline from the current point in the plan
 * and adds it to the plan. Swaps and waits go in as Update Artifact Set and Wait for Full Habs (or,
 * stopping at EnD, Wait for Population); research goes in the way the Research tab's Milestones view
 * buys a chain: a note, then every purchase with the research sale and 2x earnings waits it crosses.
 */
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { createBaseEngineState, getSimulationContext } from 'lib/planners/engine/adapter';
import { computeDependencies } from 'lib/planners/actions/executor';
import { createNoteAction, buildMilestoneNotePayload } from 'lib/planners/actions/notes';
import { researchCostModifiersAt } from 'lib/planners/engine/researchSale';
import { getNextPacificTime } from 'lib/planners/events';
import { useEventCrossingWaits } from 'lib/planners/composables/usePlannerEventCrossingWaits';
import { useFarmPurchaseActions } from 'lib/planners/composables/useFarmPurchaseActions';
import { useResearchPurchases } from 'lib/planners/composables/useResearchPurchases';
import { yieldForOverlayPaint } from 'lib/planners/yieldForOverlayPaint';
import { generateActionId, type CalculationsSnapshot, type DraftAction } from '@/types';
import {
  planSmartPopulationWait,
  playerNahPopulation,
  smartWaitOps,
  type SmartWaitPlan,
  type SmartWaitPurchase,
  type SmartWaitTarget,
} from '@/calculations/smartPopulationWait';

/** How long the planner runs before letting the page paint. */
const SLICE_MS = 30;

/** Thrown out of the planner when a newer run has started. */
class Superseded extends Error {}

/** `active`: whether the section is open. The plan is only worked out while it is. */
export function useSmartPopulationWait(active: Ref<boolean>) {
  const actionsStore = useActionsStore();
  const initialStateStore = useInitialStateStore();
  const planStore = usePlanStore();
  const crossingWaits = useEventCrossingWaits();
  const { prepareExecution, completeExecution, batch, isEditingPastGroup, settled } = crossingWaits;
  const { buyHab, buyVehicle, buyTrainCar } = useFarmPurchaseActions(crossingWaits);
  // Priced from the point being bought from, since the smart wait changes sets as it goes.
  const { absoluteSimTimeAt, buyChainItem } = useResearchPurchases({
    crossingWaits,
    farmActions: { buyHab, buyVehicle, buyTrainCar },
    costModifiers: () => researchCostModifiersAt(actionsStore.effectiveSnapshot, getSimulationContext()),
    researchSaleDeadline: () =>
      getNextPacificTime(6, 9, absoluteSimTimeAt(actionsStore.effectiveSnapshot.lastStepTime)),
  });

  /** What the player aims for, saved with the plan; null until they pick. */
  const target = computed(() => initialStateStore.smartWaitTarget);
  const setTarget = (value: SmartWaitTarget) => initialStateStore.setSmartWaitTarget(value);

  /** NAH for this player, live: a new hab size colleggtible moves it. */
  const nahPopulation = computed(() => playerNahPopulation(getSimulationContext()));

  const plan = shallowRef<SmartWaitPlan | null>(null);
  const planFor = shallowRef<{ snapshot: CalculationsSnapshot; target: SmartWaitTarget } | null>(null);
  const isCurrent = () =>
    planFor.value?.snapshot === actionsStore.effectiveSnapshot && planFor.value.target === target.value;
  const busy = ref(false);
  const applying = ref(false);
  let generation = 0;

  /** Wall-clock milliseconds at the point in the plan the smart wait starts from. */
  const baseTimestamp = computed(
    () =>
      planStore.planStartTime.getTime() +
      (actionsStore.effectiveSnapshot.lastStepTime - actionsStore.planStartOffset) * 1000
  );

  async function calculate(): Promise<SmartWaitPlan | null> {
    const run = ++generation;
    const aim = target.value;
    if (!aim) {
      busy.value = false;
      plan.value = null;
      return null;
    }
    busy.value = true;
    await yieldForOverlayPaint();
    if (run !== generation) return null;
    const snapshot = actionsStore.effectiveSnapshot;
    let sliceStart = performance.now();
    try {
      const result = await planSmartPopulationWait(createBaseEngineState(snapshot), getSimulationContext(), {
        inventory: initialStateStore.inventory,
        target: aim,
        absoluteStartTime: absoluteSimTimeAt(snapshot.lastStepTime),
        onProgress: async () => {
          if (run !== generation) throw new Superseded();
          if (performance.now() - sliceStart < SLICE_MS) return;
          await new Promise(resolve => setTimeout(resolve));
          sliceStart = performance.now();
        },
      });
      if (run !== generation) return null;
      plan.value = result;
      planFor.value = { snapshot, target: aim };
      return result;
    } catch (e) {
      if (e instanceof Superseded) return null;
      throw e;
    } finally {
      if (run === generation) busy.value = false;
    }
  }

  watch(
    [active, target, () => actionsStore.effectiveSnapshot, () => initialStateStore.inventory],
    () => {
      if (!active.value || actionsStore.batchMode || actionsStore.isRecalculating) return;
      if (plan.value && isCurrent()) return;
      void calculate();
    },
    { immediate: true }
  );

  const dependsOn = (type: DraftAction['type'], payload: unknown) =>
    computeDependencies(
      type,
      payload as never,
      actionsStore.actionsBeforeInsertion,
      actionsStore.initialSnapshot.researchLevels
    );

  function push(type: DraftAction['type'], payload: unknown) {
    const before = prepareExecution();
    const draft = {
      id: generateActionId(),
      timestamp: Date.now(),
      type,
      payload,
      cost: 0,
      dependsOn: dependsOn(type, payload),
    };
    return completeExecution(draft as DraftAction, before);
  }

  /** A research purchase the Milestones view's way: its note, then each purchase in the chain. */
  async function buyPurchase(purchase: SmartWaitPurchase) {
    const note = buildMilestoneNotePayload(
      `${purchase.name} (Lv ${purchase.toLevel}/${purchase.maxLevel})`,
      purchase.items.length,
      purchase.endSeconds - purchase.startSeconds,
      purchase.spent
    );
    if (note) await completeExecution(createNoteAction(note, dependsOn('notification', note)), prepareExecution());
    for (const item of purchase.items) {
      if (!buyChainItem(item, true)) break;
      if (isEditingPastGroup.value) await settled();
    }
  }

  /** Adds the smart wait to the plan, up to its target. */
  async function apply() {
    if (busy.value || applying.value) return;
    const current = plan.value && isCurrent() ? plan.value : await calculate();
    if (!current?.ok) return;

    applying.value = true;
    await yieldForOverlayPaint();
    try {
      const start = actionsStore.effectiveSnapshot;
      await batch(async () => {
        for (const op of smartWaitOps(current, start)) {
          if (op.kind === 'purchase') await buyPurchase(op.purchase);
          else await push(op.action.type, op.action.payload);
          if (isEditingPastGroup.value) await settled();
        }
      });
    } finally {
      applying.value = false;
    }
  }

  return {
    target,
    setTarget,
    nahPopulation,
    plan,
    busy,
    applying,
    baseTimestamp,
    apply,
    timezone: computed(() => planStore.ascensionTimezone),
  };
}
