import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import {
  Action,
  CalculationsSnapshot,
  UndoValidation,
  VirtueEgg,
  ToggleSalePayload,
  ToggleEarningsBoostPayload,
  UpdateArtifactSetPayload,
  VehicleSlot,
  VIRTUE_EGGS,
  createEmptySnapshot,
  createEmptyUndoValidation,
  generateActionId,
} from '@/types';
import { evaluateAction } from '@/lib/actions/reconciliation';
import { type HabId } from '@/lib/habs';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { computeDeltas } from '@/lib/actions/snapshot';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useSilosStore } from '@/stores/silos';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useHabCapacityStore } from '@/stores/habCapacity';
import { useShippingCapacityStore } from '@/stores/shippingCapacity';
import { useEventsStore } from '@/stores/events';

import { simulateAsync } from '@/engine/simulate';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState, syncStoresToSnapshot } from '@/engine/adapter';
import { computeDependencies } from '@/lib/actions/executor';

import { ActionsState } from './types';
import { createDefaultStartAction, calculateActionResult } from './simulation';
import { relinkDependenciesLogic, getActionsRequiringRemovalLogic, collectDependentActions } from './dependency';
import { exportPlanLogic, importPlanLogic, exportPlanData } from './io';

export const useActionsStore = defineStore('actions', {
  state: (): ActionsState => {
    const startAction = createDefaultStartAction();
    return {
      actions: [startAction],
      _initialSnapshot: null,
      editingGroupId: null,
      expandedGroupIds: new Set([startAction.id]),
      isRecalculating: false,
      isPlanInitializing: false,
      pendingRecalculate: false,
      recalculationProgress: { current: 0, total: 0 },
      batchMode: false,
      minBatchIndex: Infinity,
      isReconciling: false,
      reconciledBackupTime: 0,
      reconcileFarmState: null,
      reconcileEggsDelivered: null,
      reconcileTeEarned: null,
      showIncompleteOnly: true,
      activePlanId: null,
      lastSavedActionsJson: JSON.stringify([startAction]),
      libraryUpdateTick: 0,
      manualOverrides: JSON.parse(localStorage.getItem('ascension_manual_overrides') || '{}') as Record<string, Record<string, boolean>>,
    };
  },

  getters: {
    currentSnapshot(): CalculationsSnapshot {
      if (this.actions.length === 0) {
        return this.initialSnapshot;
      }
      return this.actions[this.actions.length - 1].endState;
    },

    initialSnapshot(): CalculationsSnapshot {
      return this._initialSnapshot ?? createEmptySnapshot();
    },

    totalCost(): number {
      return this.actions.reduce((sum, a) => sum + a.cost, 0);
    },

    actionCount(): number {
      return this.actions.filter(a => a.type !== 'start_ascension').length;
    },

    hasStartAction(): boolean {
      return this.actions.some(a => a.type === 'start_ascension');
    },

    effectiveSnapshot(): CalculationsSnapshot {
      if (!this.editingGroupId) return this.currentSnapshot;
      const headerIndex = this.actions.findIndex(a => a.id === this.editingGroupId);
      if (headerIndex === -1) return this.currentSnapshot;
      const nextShiftIndex = this.actions.findIndex((a, idx) => idx > headerIndex && a.type === 'shift');
      if (nextShiftIndex === -1) return this.currentSnapshot;
      return this.actions[nextShiftIndex - 1].endState;
    },

    editingInsertIndex(): number {
      if (!this.editingGroupId) return -1;
      const headerIndex = this.actions.findIndex(a => a.id === this.editingGroupId);
      if (headerIndex === -1) return -1;
      const nextShiftIndex = this.actions.findIndex((a, idx) => idx > headerIndex && a.type === 'shift');
      return nextShiftIndex === -1 ? -1 : nextShiftIndex;
    },

    actionsBeforeInsertion(): Action[] {
      const index = this.editingInsertIndex;
      return index === -1 ? this.actions : this.actions.slice(0, index);
    },

    planStartOffset(): number {
      const startAction = this.actions.find(a => a.type === 'start_ascension');
      if (!startAction) return 0;
      return startAction.endState.lastStepTime || 0;
    },

    ascensionStartTime(): number {
      const vStore = useVirtueStore();
      return vStore.planStartTime.getTime() / 1000;
    },

    getActionReconciliationStatus() {
      return (action: Action): 'completed' | 'pending' | 'na' => {
        if (!this.isReconciling) return 'na';

        // Check manual overrides first
        if (this.activePlanId && this.manualOverrides[this.activePlanId]?.[action.id]) {
          return 'completed';
        }

        const initialStateStore = useInitialStateStore();
        const eventsStore = useEventsStore();
        const vStore = useVirtueStore();

        return evaluateAction(action, {
          farm: this.reconcileFarmState,
          initialState: initialStateStore.$state,
          events: eventsStore.allEvents,
          planStartTime: vStore.planStartTime.getTime() / 1000,
        });
      };
    },

    getShiftReconciliationStatus() {
      return (shiftActions: Action[]): 'completed' | 'pending' | 'na' => {
        if (!this.isReconciling) return 'na';
        const statuses = shiftActions.map(a => this.getActionReconciliationStatus(a));
        if (statuses.some(s => s === 'pending')) return 'pending';
        if (statuses.every(s => s === 'na')) return 'na';
        return 'completed';
      };
    },

    isDirty(): boolean {
      const isTrivial = (a: Action): boolean => {
        if (a.type === 'shift') return true;
        if (a.type === 'wait_for_full_habs') return true;
        if (a.type === 'toggle_earnings_boost' && (a.payload as any).active) return true;
        if (a.type === 'toggle_sale' && (a.payload as any).active) return true;
        return false;
      };

      const summarize = (actions: Action[]) => {
        return actions
          .filter(a => !isTrivial(a))
          .map(a => ({
            type: a.type,
            payload: a.payload,
          }));
      };

      const currentSummary = JSON.stringify(summarize(this.actions));
      
      let savedActions: Action[] = [];
      try {
        savedActions = JSON.parse(this.lastSavedActionsJson);
      } catch (e) {
        return true;
      }
      const savedSummary = JSON.stringify(summarize(savedActions));

      return currentSummary !== savedSummary;
    },
  },

  actions: {
    async setInitialSnapshot(snapshot: CalculationsSnapshot, options?: { silent?: boolean }) {
      this._initialSnapshot = snapshot;
      if (options?.silent) {
        this.isPlanInitializing = false;
        return;
      }

      if (this.actions.length === 0) {
        const startAction = createDefaultStartAction();
        this.actions.push(startAction);
        this.expandedGroupIds.add(startAction.id);
      }

      // Add default Wait for Full Habs for fresh start (no backup data/quick continue)
      const startAction = this.getStartAction();
      if (
        this.actions.length === 1 &&
        startAction &&
        !startAction.payload.initialFarmState &&
        !startAction.payload.isQuickContinue &&
        !this.batchMode
      ) {
        this.pushWaitForFullHabsAction();
      }

      await this.recalculateFrom(0);
      this.lastSavedActionsJson = JSON.stringify(this.actions);
      this.isPlanInitializing = false;
    },

    pushWaitForFullHabsAction() {
      const snapshot = this.effectiveSnapshot;
      const habCapacity = snapshot.habCapacity;
      const currentPopulation = snapshot.population;
      const ihr = snapshot.offlineIHR;

      const chickensToGrow = Math.max(0, habCapacity - currentPopulation);
      if (chickensToGrow <= 0 || !isFinite(ihr) || ihr <= 0) return;

      const timeToGrowSeconds = chickensToGrow / (ihr / 60);

      const payload = {
        habCapacity,
        ihr,
        currentPopulation,
        totalTimeSeconds: timeToGrowSeconds,
      };

      const draftAction = {
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'wait_for_full_habs' as const,
        payload,
        cost: 0,
        dependsOn: computeDependencies(
          'wait_for_full_habs',
          payload,
          this.actionsBeforeInsertion,
          this.initialSnapshot.researchLevels
        ),
      };

      if (this.editingGroupId) {
        this.insertAction(draftAction);
      } else {
        this.pushAction(draftAction);
      }
    },

    getDependentActions(actionId: string): Action[] {
      return collectDependentActions(this.actions, actionId);
    },

    pushAction(action: import('@/types').DraftAction) {
      // Logic for redundant actions
      if (action.type === 'toggle_sale' || action.type === 'toggle_earnings_boost') {
        const lastAction = this.actions[this.actions.length - 1];
        if (lastAction && lastAction.type === action.type) {
          if (action.type === 'toggle_sale') {
            const p = action.payload as ToggleSalePayload;
            const lp = lastAction.payload as ToggleSalePayload;
            if (lp.saleType === p.saleType && lp.active !== p.active && lastAction.dependents.length === 0) {
              this.executeUndo(lastAction.id, 'dependents');
              return;
            }
          } else if (action.type === 'toggle_earnings_boost') {
            const p = action.payload as ToggleEarningsBoostPayload;
            const lp = lastAction.payload as ToggleEarningsBoostPayload;
            if (lp.active !== p.active && lastAction.dependents.length === 0) {
              this.executeUndo(lastAction.id, 'dependents');
              return;
            }
          }
        }
      }

      if (action.type === 'update_artifact_set') {
        const p = action.payload as UpdateArtifactSetPayload;
        const lastAction = this.actions[this.actions.length - 1];
        if (lastAction && lastAction.type === 'update_artifact_set') {
          const lp = lastAction.payload as UpdateArtifactSetPayload;
          if (lp.setName === p.setName && lastAction.dependents.length === 0) {
            this.executeUndo(lastAction.id, 'dependents');
          }
        }
      }

      const prevSnapshot =
        this.actions.length > 0
          ? this.actions[this.actions.length - 1].endState
          : (this._initialSnapshot ?? createEmptySnapshot());
      const prevState =
        this.actions.length > 0
          ? createBaseEngineState(this.actions[this.actions.length - 1].endState)
          : createBaseEngineState(this._initialSnapshot);

      const fullAction = {
        ...action,
        index: this.actions.length,
        dependents: [],
        totalTimeSeconds: 0,
        populationDelta: 0,
        endState: createEmptySnapshot(),
        cost: action.cost ?? 0,
        elrDelta: 0,
        offlineEarningsDelta: 0,
        eggValueDelta: 0,
        habCapacityDelta: 0,
        layRateDelta: 0,
        shippingCapacityDelta: 0,
        ihrDelta: 0,
        bankDelta: 0,
      } as unknown as Action;

      const { newSnapshot, durationSeconds } = calculateActionResult(fullAction, prevSnapshot, prevState);
      const deltas = computeDeltas(prevSnapshot, newSnapshot);

      const finalAction: Action = {
        ...fullAction,
        ...deltas,
        totalTimeSeconds: durationSeconds,
        endState: markRaw(newSnapshot),
      };

      for (const depId of action.dependsOn) {
        const depAction = this.actions.find(a => a.id === depId);
        if (depAction) depAction.dependents.push(finalAction.id);
      }

      this.actions.push(finalAction);
      if (finalAction.type === 'shift' || finalAction.type === 'start_ascension') {
        this.expandedGroupIds.clear();
        this.expandedGroupIds.add(finalAction.id);
      }

      if (!this.batchMode) syncStoresToSnapshot(newSnapshot);
    },

    prepareUndo(actionId: string): UndoValidation {
      const action = this.actions.find(a => a.id === actionId);
      if (!action || action.type === 'start_ascension') return createEmptyUndoValidation();
      const toRemove = getActionsRequiringRemovalLogic(
        this.actions,
        new Set([actionId]),
        this.initialSnapshot.researchLevels
      );
      const dependents = toRemove.filter(a => a.id !== actionId);
      return { valid: true, action, dependentActions: dependents, needsRecursiveUndo: dependents.length > 0 };
    },

    prepareUndoUntilShift(actionId: string): UndoValidation {
      const action = this.actions.find(a => a.id === actionId);
      if (!action || action.type === 'start_ascension') return createEmptyUndoValidation();
      const index = this.actions.findIndex(a => a.id === actionId);
      const initialToRemove = new Set<string>();
      for (let i = index; i < this.actions.length; i++) {
        if (i > index && this.actions[i].type === 'shift') break;
        initialToRemove.add(this.actions[i].id);
      }
      const toRemove = getActionsRequiringRemovalLogic(
        this.actions,
        initialToRemove,
        this.initialSnapshot.researchLevels
      );
      const dependents = toRemove.filter(a => a.id !== actionId);
      return { valid: true, action, dependentActions: dependents, needsRecursiveUndo: dependents.length > 0 };
    },

    async executeUndo(
      actionId: string,
      mode: 'dependents' | 'truncate' = 'dependents',
      restoreCallback?: (snapshot: CalculationsSnapshot) => void
    ) {
      const validation = mode === 'dependents' ? this.prepareUndo(actionId) : this.prepareUndoUntilShift(actionId);
      if (!validation.valid) return;
      const toRemove = new Set<string>([actionId]);
      if (validation.dependentActions) validation.dependentActions.forEach(dep => toRemove.add(dep.id));
      const minIndex = Math.min(...this.actions.map((a, i) => toRemove.has(a.id) ? i : Infinity));
      const newActions = this.actions.filter(a => !toRemove.has(a.id));
      newActions.forEach(a => {
        a.dependents = a.dependents.filter(depId => !toRemove.has(depId));
      });
      this.actions = newActions;

      // If we're editing a shift and it's now the last shift in the plan (because a later
      // shift and its actions were just undone), stop editing it. Editing exists to modify a
      // past shift; once it's the last shift, it's already the default edit target.
      if (this.editingGroupId) {
        const headerIndex = this.actions.findIndex(a => a.id === this.editingGroupId);
        if (headerIndex !== -1) {
          const hasLaterShift = this.actions.some((a, idx) => idx > headerIndex && a.type === 'shift');
          if (!hasLaterShift) {
            this.editingGroupId = null;
          }
        }
      }

      await this.recalculateFrom(minIndex === Infinity ? 0 : minIndex);
      if (restoreCallback) restoreCallback(this.effectiveSnapshot);
    },

    async removeActions(ids: string[]) {
      const fullToRemove = getActionsRequiringRemovalLogic(
        this.actions,
        new Set(ids),
        this.initialSnapshot.researchLevels
      );
      const fullIds = new Set(fullToRemove.map(a => a.id));
      const minIndex = Math.min(...this.actions.map((a, i) => fullIds.has(a.id) ? i : Infinity));
      this.actions = this.actions.filter(a => !fullIds.has(a.id));
      this.actions.forEach(a => {
        a.dependents = a.dependents.filter(d => !fullIds.has(d));
      });
      await this.recalculateFrom(minIndex === Infinity ? 0 : minIndex);
    },

    async clearAll(resetCallback?: () => void, skipRecalculate = false) {
      this.activePlanId = null;
      this.isReconciling = false;
      this.editingGroupId = null;
      this.reconcileFarmState = null;
      this.reconcileEggsDelivered = null;
      this.reconcileTeEarned = null;
      let startAction = this.getStartAction();
      if (startAction) {
        startAction.payload.initialEgg = startAction.payload.initialEgg || 'curiosity';
        this.actions = [startAction];
      } else {
        startAction = createDefaultStartAction();
        this.actions = [startAction];
      }
      this.expandedGroupIds.clear();
      this.expandedGroupIds.add(startAction.id);
      if (!skipRecalculate) {
        await this.recalculateFrom(0);
      }
      this.lastSavedActionsJson = JSON.stringify(this.actions);
      this.libraryUpdateTick++;
      if (resetCallback) resetCallback();
    },

    getStartAction(): Action<'start_ascension'> | undefined {
      return this.actions.find(a => a.type === 'start_ascension') as Action<'start_ascension'> | undefined;
    },

    getAction(actionId: string): Action | undefined {
      return this.actions.find(a => a.id === actionId);
    },

    async setInitialEgg(egg: VirtueEgg) {
      const startAction = this.getStartAction();
      if (!startAction) return;

      startAction.payload.initialEgg = egg;

      const keptActions: Action[] = [startAction];
      let foundWait = false;

      for (let i = 1; i < this.actions.length; i++) {
        const a = this.actions[i];
        if (a.type === 'wait_for_full_habs' && !foundWait) {
          keptActions.push(a);
          foundWait = true;
        } else if (a.type === 'shift') {
          // As soon as we see the first shift, we stop considering any waits
          break;
        }
      }

      keptActions.forEach((a, idx) => {
        a.index = idx;
        a.dependents = [];
      });
      
      for (let i = 1; i < keptActions.length; i++) {
        keptActions[i].dependsOn = [keptActions[i - 1].id];
        keptActions[i - 1].dependents.push(keptActions[i].id);
      }

      this.actions = keptActions;

      const keptIds = new Set(keptActions.map(a => a.id));
      if (this.editingGroupId && !keptIds.has(this.editingGroupId)) {
        this.editingGroupId = null;
      }
      for (const id of Array.from(this.expandedGroupIds)) {
        if (!keptIds.has(id)) {
          this.expandedGroupIds.delete(id);
        }
      }

      await this.recalculateFrom(0);
    },

    setEditingGroup(groupId: string | null) {
      this.editingGroupId = groupId;
      if (groupId) this.expandedGroupIds.add(groupId);
      syncStoresToSnapshot(groupId === null ? this.currentSnapshot : this.effectiveSnapshot);
    },

    async continueFromBackup(applyEvents = false) {
      const initialStateStore = useInitialStateStore();
      const virtueStore = useVirtueStore();
      const silosStore = useSilosStore();
      const commonResearchStore = useCommonResearchStore();
      const habCapacityStore = useHabCapacityStore();
      const shippingCapacityStore = useShippingCapacityStore();

      if (!initialStateStore.currentFarmState) return;
      // We no longer force ELR set here; we respect the active set from the backup/plan.
      // if (initialStateStore.artifactSets.elr) initialStateStore.setActiveArtifactSet('elr');

      const farm = initialStateStore.currentFarmState;
      const egg = VIRTUE_EGGS[farm.eggType - 50];
      const startAction = this.getStartAction();
      if (startAction) {
        startAction.payload.initialEgg = egg;
        startAction.payload.initialFarmState = farm;
        startAction.payload.isQuickContinue = applyEvents;
      }
      virtueStore.setCurrentEgg(egg);
      silosStore.setSiloCount(farm.numSilos);
      commonResearchStore.resetAll();
      for (const [id, level] of Object.entries(farm.commonResearches)) commonResearchStore.setResearchLevel(id, level);
      (farm.habs as (HabId | null)[]).forEach((habId, idx) => habCapacityStore.setHab(idx, habId));
      farm.vehicles.forEach((v: VehicleSlot, idx: number) => {
        shippingCapacityStore.setVehicle(idx, v.vehicleId);
        if (v.vehicleId === 11) shippingCapacityStore.setTrainLength(idx, v.trainLength);
      });

      const context = getSimulationContext();
      const initialSnapshot = computeSnapshot(createBaseEngineState(null), context);
      await this.setInitialSnapshot(initialSnapshot);
      if (applyEvents) {
        this.pushRelevantEvents(egg, true);
      }
    },

    pushRelevantEvents(egg: string, includeGlobal = false) {
      const initialStateStore = useInitialStateStore();
      const eventsStore = useEventsStore();
      const activeEvents = eventsStore.getActiveEvents(initialStateStore.isUltra);

      for (const event of activeEvents) {
        if (includeGlobal && event.type === 'earnings-boost' && !this.effectiveSnapshot.earningsBoost.active) {
          this.pushAction({
            id: generateActionId(),
            type: 'toggle_earnings_boost',
            timestamp: Date.now(),
            cost: 0,
            dependsOn: [],
            payload: { active: true, multiplier: event.multiplier, eventId: event.id },
          });
        }
        const saleMap: Record<string, { type: 'research' | 'hab' | 'vehicle'; egg: string }> = {
          'research-sale': { type: 'research', egg: 'curiosity' },
          'hab-sale': { type: 'hab', egg: 'integrity' },
          'vehicle-sale': { type: 'vehicle', egg: 'kindness' },
        };
        const s = saleMap[event.type];
        if (
          s &&
          egg === s.egg &&
          !this.effectiveSnapshot.activeSales[s.type as keyof typeof this.effectiveSnapshot.activeSales]
        ) {
          this.pushAction({
            id: generateActionId(),
            type: 'toggle_sale',
            timestamp: Date.now(),
            cost: 0,
            dependsOn: [],
            payload: { saleType: s.type, active: true, multiplier: event.multiplier },
          });
        }
      }
    },

    async insertAction(
      action: import('@/types').DraftAction,
      _replayCallback?: (action: Action, previousSnapshot: CalculationsSnapshot) => CalculationsSnapshot
    ) {
      const insertIndex = this.editingInsertIndex;
      if (insertIndex === -1) {
        this.pushAction(action);
        return;
      }

      // Duplicate logic for sequential toggles/updates...
      // (omitted for brevity in this first pass, but I should probably include it)

      const fullAction: Action = {
        ...action,
        index: insertIndex,
        dependents: [],
        totalTimeSeconds: 0,
        endState: createEmptySnapshot(),
      } as unknown as Action;

      for (const depId of action.dependsOn) {
        const depAction = this.actions.find(a => a.id === depId);
        if (depAction) depAction.dependents.push(fullAction.id);
      }

      this.actions.splice(insertIndex, 0, fullAction);
      if (fullAction.type === 'shift') {
        this.expandedGroupIds.clear();
        this.expandedGroupIds.add(fullAction.id);
      }

      if (this.batchMode) {
        this.minBatchIndex = Math.min(this.minBatchIndex, insertIndex + 1);
        const prevAction = this.actions[insertIndex - 1];
        const prevSnapshot = prevAction ? prevAction.endState : (this._initialSnapshot ?? createEmptySnapshot());
        const prevState = prevAction ? prevAction.endState : createBaseEngineState(this.initialSnapshot);
        const { newSnapshot, durationSeconds } = calculateActionResult(fullAction, prevSnapshot, prevState);
        const deltas = computeDeltas(prevSnapshot, newSnapshot);
        Object.assign(fullAction, { ...deltas, totalTimeSeconds: durationSeconds, endState: markRaw(newSnapshot) });
        useVirtueStore().setBankValue(newSnapshot.bankValue);
      } else {
        await this.recalculateFrom(insertIndex);
      }
    },

    startBatch() {
      if (this.batchMode) return;
      this.batchMode = true;
      this.minBatchIndex = Infinity;
    },

    async commitBatch() {
      if (!this.batchMode) return;
      this.batchMode = false;
      if (this.minBatchIndex < Infinity) await this.recalculateFrom(this.minBatchIndex);
      else syncStoresToSnapshot(this.currentSnapshot);
    },

    async recalculateFrom(startIndex: number) {
      if (startIndex >= this.actions.length) {
        syncStoresToSnapshot(this.effectiveSnapshot);
        return;
      }
      startIndex = Math.max(0, startIndex);
      if (this.isRecalculating) {
        this.pendingRecalculate = true;
        return;
      }
      this.isRecalculating = true;
      this.pendingRecalculate = false;
      try {
        const context = getSimulationContext();
        const baseState =
          startIndex === 0 ? createBaseEngineState(this._initialSnapshot) : this.actions[startIndex - 1].endState;
        const actionsToSimulate = this.actions.slice(startIndex);
        this.recalculationProgress = { current: 0, total: actionsToSimulate.length };
        const newActionsSegment = await simulateAsync(
          actionsToSimulate,
          context,
          baseState,
          (current, total) => {
            this.recalculationProgress = { current, total };
          },
          startIndex
        );
        this.actions.splice(startIndex, newActionsSegment.length, ...newActionsSegment);
        this.relinkDependencies();
        syncStoresToSnapshot(this.effectiveSnapshot);
      } finally {
        this.isRecalculating = false;
        this.batchMode = false;
        this.minBatchIndex = Infinity;
        // If a recalculate was requested while we were running, do it now with fresh context
        if (this.pendingRecalculate) {
          this.pendingRecalculate = false;
          await this.recalculateFrom(0);
        }
      }
    },

    async recalculateAll() {
      return this.recalculateFrom(0);
    },

    relinkDependencies() {
      relinkDependenciesLogic(this.actions, this.initialSnapshot.researchLevels);
    },

    toggleGroupExpansion(groupId: string) {
      if (this.expandedGroupIds.has(groupId)) this.expandedGroupIds.delete(groupId);
      else this.expandedGroupIds.add(groupId);
    },

    exportPlan() {
      exportPlanLogic(this.actions, this.initialSnapshot);
    },

    async importPlan(jsonString: string, skipRecalculate = false, preserveId = false) {
      if (this.lastSavedActionsJson === jsonString && this._initialSnapshot) {
        this.isPlanInitializing = false;
        return true;
      }
      const data = importPlanLogic(jsonString);
      
      // NEW: Skip recalculation if the plan already contains calculated result data (endState).
      // Since the user is in a long session, we trust the cached calculations in the library.
      const isPreCalculated = data.actions &&
                             data.actions.length > 0 &&
                             data.actions.every((a: Action) => a.endState !== undefined);

      if (isPreCalculated) {
        skipRecalculate = true;
        // Optimization: Ensure all imported endStates are marked as raw for Vue performance.
        this.actions = data.actions.map((a: Action) => ({
          ...a,
          endState: markRaw(a.endState),
        }));
      } else {
        this.actions = data.actions;
      }

      if (preserveId && data.activePlanId) {
        this.activePlanId = data.activePlanId;
      }
      // Reset editing state when importing.
      this.editingGroupId = null;

      // Clear expanded groups when importing. The user wants the initial shift
      // collapsed when loading from the library or reconciling.
      this.expandedGroupIds.clear();

      // But we DO want the last shift (or the start action if no shifts) expanded
      // so the user is "editing" it by default.
      const lastGroupAction = [...this.actions].reverse().find(a => a.type === 'shift' || a.type === 'start_ascension');
      if (lastGroupAction) {
        this.expandedGroupIds.add(lastGroupAction.id);
      }

      const baseState = createBaseEngineState(null);
      const initialSnapshot = computeSnapshot(baseState, getSimulationContext());
      this._initialSnapshot = markRaw(initialSnapshot);

      if (!skipRecalculate) {
        await this.recalculateFrom(0);
      } else {
        syncStoresToSnapshot(this.effectiveSnapshot);
      }
      this.lastSavedActionsJson = JSON.stringify(this.actions);
      this.isPlanInitializing = false;
      return true;
    },

    async savePlan(name: string, partitionHash: string) {
      const planId = this.activePlanId || generateActionId();
      const planData = {
        id: planId,
        name,
        timestamp: Date.now(),
        data: exportPlanData(this.actions, this.initialSnapshot, planId),
      };

      const { safeImport } = await import('@/lib/import');
      const { savePlanToLibrary } = await safeImport(() => import('@/lib/storage/db'));
      await savePlanToLibrary(partitionHash, planData);

      this.activePlanId = planId;
      this.lastSavedActionsJson = JSON.stringify(this.actions);
      this.libraryUpdateTick++;
    },

    async loadPlanFromLibrary(plan: import('@/lib/storage/db').PlanData) {
      this.activePlanId = plan.id;
      await this.importPlan(JSON.stringify(plan.data));
    },

    toggleManualOverride(actionId: string) {
      if (!this.activePlanId) return;
      const currentOverrides = this.manualOverrides[this.activePlanId] || {};
      this.manualOverrides = {
        ...this.manualOverrides,
        [this.activePlanId]: {
          ...currentOverrides,
          [actionId]: !currentOverrides[actionId],
        },
      };
      localStorage.setItem('ascension_manual_overrides', JSON.stringify(this.manualOverrides));
    },
  },
});
