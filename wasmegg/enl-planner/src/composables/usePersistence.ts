import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { hashID, saveMetadata, loadMetadata } from '@/lib/storage/db';
import { exportPlanData } from '@/stores/actions/io';

const SYNC_CHANNEL_NAME = 'ascension_sync';
const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
const partitionHash = ref('');
const isSyncing = ref(false);

// Generate a unique session ID for this tab that persists through refreshes
const sessionId = sessionStorage.getItem('ascension_session_id') || Math.random().toString(36).substring(2, 15);
sessionStorage.setItem('ascension_session_id', sessionId);

let lastSyncedDataStr = '';
let channelListenerAttached = false;

// ── Heartbeat tracking (centralized, shared across all consumers) ──
const busyPlanLastSeen = ref<Record<string, number>>({});

/**
 * Reactive set of plan IDs that are currently open in OTHER tabs.
 * Consumers (PlanLibrary, PlanSelectionDialog) import this directly.
 */
const busyPlanIds = computed(() => {
  const now = Date.now();
  const active = new Set<string>();
  for (const [id, lastSeen] of Object.entries(busyPlanLastSeen.value)) {
    if (now - lastSeen < 2500) {
      active.add(id);
    }
  }
  return active;
});

/**
 * Broadcast presence of the currently active plan to other tabs.
 */
function broadcastPresence(planIdOverride?: string | null) {
  const actionsStore = useActionsStore();
  const planId = planIdOverride !== undefined ? planIdOverride : actionsStore.activePlanId;

  if (planId && partitionHash.value) {
    channel.postMessage({
      type: 'PLAN_HEARTBEAT',
      planId,
      partitionHash: partitionHash.value,
    });
  }
}

// ── Channel message handler (single, centralized) ──
const handleMessage = (event: MessageEvent) => {
  // 1. Library sync
  if (event.data.type === 'LIBRARY_UPDATED' && event.data.partitionHash === partitionHash.value) {
    const actionsStore = useActionsStore();
    actionsStore.libraryUpdateTick++;
  }

  // 2. Heartbeat from another tab — track it
  if (event.data.type === 'PLAN_HEARTBEAT' && event.data.partitionHash === partitionHash.value) {
    busyPlanLastSeen.value = {
      ...busyPlanLastSeen.value,
      [event.data.planId]: Date.now(),
    };
  }

  // 3. Query from another tab — respond with our presence
  if (event.data.type === 'PLAN_QUERY' && event.data.partitionHash === partitionHash.value) {
    broadcastPresence();
  }
};

// ── Draft persistence ──
async function loadActiveDraft() {
  if (!partitionHash.value) return;

  const draft = await loadMetadata(partitionHash.value, `active_draft_${sessionId}`);
  if (draft) {
    isSyncing.value = true;
    try {
      const actionsStore = useActionsStore();
      await actionsStore.importPlan(JSON.stringify(draft), true, true);

      const planData = exportPlanData(actionsStore.actions, actionsStore.initialSnapshot);
      const dataForComparison = { ...planData, timestamp: 0 };
      lastSyncedDataStr = JSON.stringify(dataForComparison);
    } finally {
      isSyncing.value = false;
    }
  }
}

export function usePersistence() {
  async function initPersistence(eid: string) {
    partitionHash.value = await hashID(eid);
    await loadActiveDraft();
  }

  function broadcastLibraryUpdate() {
    channel.postMessage({
      type: 'LIBRARY_UPDATED',
      partitionHash: partitionHash.value,
      timestamp: Date.now(),
    });
  }

  async function saveActiveDraft() {
    if (!partitionHash.value || isSyncing.value) return;

    const actionsStore = useActionsStore();
    if (actionsStore.isRecalculating) return;

    const planData = exportPlanData(actionsStore.actions, actionsStore.initialSnapshot, actionsStore.activePlanId);
    const dataForComparison = { ...planData, timestamp: 0 };
    const newDataStr = JSON.stringify(dataForComparison);
    if (newDataStr === lastSyncedDataStr) return;

    lastSyncedDataStr = newDataStr;
    await saveMetadata(partitionHash.value, `active_draft_${sessionId}`, planData);
  }

  /**
   * Ask other tabs to identify themselves immediately.
   */
  function queryOtherTabs() {
    if (partitionHash.value) {
      channel.postMessage({ type: 'PLAN_QUERY', partitionHash: partitionHash.value });
    }
  }

  onMounted(() => {
    // Attach the centralized message handler once
    if (!channelListenerAttached) {
      channel.addEventListener('message', handleMessage);
      channelListenerAttached = true;
    }

    // Heartbeat interval
    const interval = setInterval(() => broadcastPresence(), 1000);
    onUnmounted(() => clearInterval(interval));

    // Query other tabs on mount
    queryOtherTabs();
  });

  return {
    initPersistence,
    saveActiveDraft,
    broadcastLibraryUpdate,
    broadcastPresence,
    queryOtherTabs,
    busyPlanIds,
    partitionHash,
    sessionId,
  };
}
