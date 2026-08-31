import type { Action, CalculationsSnapshot, CurrentFarmState, VirtueEgg } from '@/types';

export interface ActionsState {
  actions: Action[];
  _initialSnapshot: CalculationsSnapshot | null;
  // ID of the group (header action) currently being edited, or null if editing current period
  editingGroupId: string | null;
  // IDs of groups that are currently expanded
  expandedGroupIds: Set<string>;
  isRecalculating: boolean;
  // True from the start of resetAllStores() through the end of setInitialSnapshot() — i.e. the
  // whole "switching to a new mode" window during which stores are mutated in several separate,
  // individually-observable steps and can briefly disagree with each other (e.g. virtueStore
  // already reset while actionsStore still holds the previous plan's snapshot). Reactive consumers
  // that derive absolute timestamps from multiple stores (like the milestone chain watchEffect in
  // useResearchViews.ts) must not compute against that transitional state — doing so has produced
  // nonsensical timestamps and hung the tab.
  isPlanInitializing: boolean;
  pendingRecalculate: boolean;
  recalculationProgress: { current: number; total: number };
  batchMode: boolean;
  minBatchIndex: number;
  isReconciling: boolean;
  reconciledBackupTime: number;
  reconcileFarmState: CurrentFarmState | null;
  reconcileEggsDelivered: Record<VirtueEgg, number> | null;
  reconcileTeEarned: Record<VirtueEgg, number> | null;
  showIncompleteOnly: boolean;
  // ID of the library plan currently being edited, or null if it's a new draft
  activePlanId: string | null;
  // JSON string of the actions when last saved/loaded to track "dirty" state
  lastSavedActionsJson: string;
  // Monotonically increasing counter to trigger refreshes of the plan library UI
  libraryUpdateTick: number;
  // Manual completion overrides for reconciliation, keyed by planId and actionId
  manualOverrides: Record<string, Record<string, boolean>>;
}
