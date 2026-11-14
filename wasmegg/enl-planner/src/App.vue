<template>
  <the-nav-bar active-entry-id="enl-planner" />

  <div :class="['min-h-screen bg-gray-100 transition-all duration-300', isFooterCollapsed ? 'pb-8' : 'pb-24']">
    <div class="max-w-6xl mx-auto p-4">
      <CustomEggWatcher v-if="isDev" />

      <!-- Collapsible Header Region -->
      <div class="bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-100 shadow-sm">
        <div
          class="grid transition-all duration-500 ease-in-out"
          :class="isHeaderCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
        >
          <div class="overflow-hidden">
            <h1 class="mx-4 mt-8 mb-2 text-center heading-xl text-gradient">
              {{ pageTitle }}
            </h1>
            <div
              v-if="initialStateStore.hasData && lastBackupFormatted"
              class="text-center text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-4 -mt-1"
            >
              Player Backup From: {{ lastBackupFormatted }}
            </div>

            <the-player-id-form :player-id="playerId" @submit="submitPlayerId" />

            <!-- Plan Library Section -->
            <div v-if="playerId" class="max-w-6xl mx-auto mt-6">
              <PlanLibrary @plan-loaded="handlePlanLoaded" />
            </div>

            <!-- Mode Buttons -->
            <div class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-3 max-w-6xl mx-auto">
              <!-- Start from Scratch -->
              <div class="section-premium p-5 flex flex-col items-center text-center group relative overflow-hidden">
                <div
                  class="absolute -right-6 -top-6 w-20 h-20 bg-red-500/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"
                ></div>
                <div class="relative z-10 flex flex-col items-center gap-3 flex-1">
                  <div class="p-2.5 bg-red-50 rounded-xl">
                    <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </div>
                  <div>
                    <div class="text-sm font-bold text-slate-800">Start from Scratch</div>
                    <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1.5 leading-relaxed">
                      Clear your entire plan, reset all settings, and begin with a clean slate
                    </p>
                  </div>
                  <button
                    class="btn-premium btn-primary px-5 py-2 mt-auto w-full"
                    @click="confirmUnsavedChanges(startFromScratch)"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <!-- Plan New Farm -->
              <div
                class="section-premium p-5 flex flex-col items-center text-center group relative overflow-hidden border-brand-primary/30"
              >
                <div
                  class="absolute -right-6 -top-6 w-20 h-20 bg-brand-primary/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"
                ></div>
                <div class="relative z-10 flex flex-col items-center gap-3 flex-1">
                  <div class="p-2.5 bg-brand-primary/10 rounded-xl">
                    <svg class="w-6 h-6 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                      />
                    </svg>
                  </div>
                  <div>
                    <div class="text-sm font-bold text-slate-800">Plan New Enlightenment Farm</div>
                    <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1.5 leading-relaxed">
                      Load your latest backup, reset the clock, and plan a new enlightenment farm from nothing
                    </p>
                  </div>
                  <button
                    class="btn-premium btn-primary px-5 py-2 mt-auto w-full"
                    :disabled="loading || !playerId"
                    @click="confirmUnsavedChanges(planNewFarm)"
                  >
                    Plan
                  </button>
                </div>
              </div>

              <!-- Continue Enlightenment Farm -->
              <div class="section-premium p-5 flex flex-col items-center text-center group relative overflow-hidden">
                <div
                  class="absolute -right-6 -top-6 w-20 h-20 bg-blue-500/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"
                ></div>
                <div class="relative z-10 flex flex-col items-center gap-3 flex-1">
                  <div class="p-2.5 bg-blue-50 rounded-xl">
                    <svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 5l7 7-7 7M5 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                  <div>
                    <div class="text-sm font-bold text-slate-800">Continue Enlightenment Farm</div>
                    <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1.5 leading-relaxed">
                      Resume from your enlightenment farm in-game with all events applied
                    </p>
                  </div>
                  <button
                    class="btn-premium btn-primary px-5 py-2 mt-auto w-full"
                    :disabled="loading || !playerId"
                    @click="confirmUnsavedChanges(triggerQuickContinue)"
                  >
                    Continue
                  </button>
                </div>
              </div>

              <!-- Reconcile Plan -->
              <div class="section-premium p-5 flex flex-col items-center text-center group relative overflow-hidden">
                <div
                  class="absolute -right-6 -top-6 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"
                ></div>
                <div class="relative z-10 flex flex-col items-center gap-3 flex-1">
                  <div class="p-2.5 bg-emerald-50 rounded-xl">
                    <svg class="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                      />
                    </svg>
                  </div>
                  <div>
                    <div class="text-sm font-bold text-slate-800">Reconcile Plan</div>
                    <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1.5 leading-relaxed">
                      Load a plan and compare against your current farm to track progress
                    </p>
                  </div>

                  <button
                    class="btn-premium btn-primary px-5 py-2 mt-auto w-full"
                    :disabled="loading || !playerId"
                    @click="confirmUnsavedChanges(triggerReconcile)"
                  >
                    Reconcile
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Header Toggle Tab (PlanFinalSummary style) - normal flow, centered below card -->
      <div v-if="playerId" class="flex justify-center -mt-px mb-2">
        <button
          class="bg-white/95 backdrop-blur-xl border border-t-0 border-slate-100 px-4 py-1 rounded-b-lg shadow-sm text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider h-7 cursor-pointer"
          @click="isHeaderCollapsed = !isHeaderCollapsed"
        >
          <svg
            class="w-3.5 h-3.5 transition-transform duration-300"
            :class="{ 'rotate-180': isHeaderCollapsed }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      <!-- Current Mode Label -->
      <div v-if="plannerModeLabel" class="mt-4 flex justify-center">
        <span class="text-sm font-bold text-slate-700">{{ plannerModeLabel }}</span>
      </div>

      <!-- Reconciliation Status Banner -->
      <div v-if="actionsStore.isReconciling" class="mt-4 flex flex-col items-center gap-2">
        <div
          class="w-full max-w-sm bg-gradient-to-r from-emerald-50/80 via-white to-green-50/80 rounded-2xl p-4 border border-emerald-100/50 shadow-sm relative overflow-hidden flex items-center justify-between transition-all duration-300"
        >
          <div class="flex items-center gap-3 relative z-10">
            <!-- Icon/Status -->
            <div
              class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            <div class="flex flex-col gap-0 text-left">
              <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-0.5"
                >Reconciliation Mode</span
              >
              <span class="text-[10px] font-bold text-emerald-600 tracking-tight">
                Backup from {{ lastBackupFormatted }}
                <span class="text-emerald-400/80 font-medium">({{ lastBackupAge }})</span>
              </span>
            </div>
          </div>

          <div class="flex items-center gap-4 relative z-10">
            <!-- Incomplete Only Toggle -->
            <div class="flex items-center gap-2">
              <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Incomplete Only</span>
              <button
                class="relative inline-flex h-4 w-8 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
                :class="actionsStore.showIncompleteOnly ? 'bg-emerald-500' : 'bg-slate-200'"
                @click="actionsStore.showIncompleteOnly = !actionsStore.showIncompleteOnly"
              >
                <span
                  class="inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
                  :class="actionsStore.showIncompleteOnly ? 'translate-x-[13px]' : 'translate-x-1'"
                />
              </button>
            </div>

            <!-- Refresh Button -->
            <button
              class="h-8 w-8 rounded-lg bg-white border border-emerald-100 shadow-sm flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors"
              title="Reload backup"
              :disabled="loading"
              @click="handleRefreshReconcile"
            >
              <svg
                class="w-4 h-4"
                :class="{ 'animate-spin': loading }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 2x Earnings Event: status plus a wait for its next start or end -->
      <div class="mt-4 flex flex-col items-center gap-2">
        <EventEdgeWaitCard
          class="w-full max-w-sm"
          label="Monday 2x Earnings Event"
          event-name="2x Earnings"
          active-text="Active"
          tone="orange"
          :is-active="isEarningsBoostActive"
          :seconds-until-change="isEarningsBoostActive ? secondsUntilEarningsBoostEnd : secondsUntilNextEarningsBoost"
          :tooltip="earningsEventTooltip"
          @wait="handleEarningsEventWait"
        />
      </div>

      <div v-if="loading" class="text-center py-4 text-gray-600">Loading player data...</div>

      <div v-if="error" class="text-center py-4 text-red-600">
        {{ error }}
      </div>

      <!-- Goals -->
      <PlanGoals class="mt-6" />

      <div>
        <!-- Action History and Available Actions side-by-side -->
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Action History -->
          <div class="section-premium overflow-visible">
            <div class="px-4 py-3 flex justify-between items-center rounded-t-lg">
              <h2 class="text-lg font-semibold text-gray-800">Action History</h2>
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-1.5 cursor-pointer select-none">
                  <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Compact</span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="compactActionHistory"
                    class="relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none"
                    :class="compactActionHistory ? 'bg-brand-primary' : 'bg-gray-200'"
                    @click="compactActionHistory = !compactActionHistory"
                  >
                    <span
                      class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform shadow-sm"
                      :class="compactActionHistory ? 'translate-x-[18px]' : 'translate-x-0.5'"
                    />
                  </button>
                </label>
                <button
                  class="p-1 -mr-1 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors"
                  @click="expandedSections.actionHistory = !expandedSections.actionHistory"
                >
                  <ChevronIcon :expanded="expandedSections.actionHistory" />
                </button>
              </div>
            </div>
            <div v-if="expandedSections.actionHistory" class="border-t border-gray-200 p-4 bg-gray-50 rounded-b-lg">
              <ActionHistory @undo="showUndoConfirmation" @clear-all="handleClearAll" />
            </div>
          </div>

          <!-- Available Actions -->
          <div class="section-premium overflow-visible">
            <div class="px-4 py-3 flex justify-between items-center rounded-t-lg">
              <h2 class="text-lg font-semibold text-gray-800">Available Actions</h2>
              <button
                class="p-1 -mr-1 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors"
                @click="expandedSections.availableActions = !expandedSections.availableActions"
              >
                <ChevronIcon :expanded="expandedSections.availableActions" />
              </button>
            </div>
            <div v-if="expandedSections.availableActions" class="border-t border-gray-200 p-4 bg-gray-50 rounded-b-lg">
              <AvailableActions @refresh-backup="handleRefreshReconcile" />
            </div>
          </div>
        </div>
      </div>

      <PlannerDialogs :dialogs="dialogs" />

      <!-- Plan Selection Dialog (for Reconcile) -->
      <PlanSelectionDialog
        v-if="showReconcileLibraryModal"
        @select="handleLibraryReconcile"
        @cancel="showReconcileLibraryModal = false"
      />

      <WarningDialog />

      <RecalculationOverlay />

      <LoadingOverlay
        :show="loading"
        title="One Moment..."
        message="Fetching your data and crunching the numbers to set up your plan..."
      />

      <PlanFinalSummary
        @update:collapsed="isFooterCollapsed = $event"
        @save-plan="saveCurrentPlan"
        @save-plan-as="savePlanAs"
      />
      <FloatingStats />
      <FloatingNotes />
      <PlannerToast />
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePlannerPageStatus } from 'lib/planners/composables/usePlannerPageStatus';
import { usePlanDialogs } from 'lib/planners/composables/usePlanDialogs';
import { usePlanSaving } from 'lib/planners/composables/usePlanSaving';
import PlannerDialogs from 'ui/components/planners/PlannerDialogs.vue';
import { ref, computed, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import TheNavBar from 'ui/components/NavBar.vue';
import { getSavedPlayerID, savePlayerID, requestFirstContact, resolveColleggtibleContracts } from 'lib';
import ThePlayerIdForm from 'ui/components/PlayerIdForm.vue';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { usePlanStore } from '@/stores/plan';
import { useUIStore } from '@/stores/ui';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useEventsStore } from 'lib/planners/stores/events';

import { useNotesStore } from 'lib/planners/stores/notes';
import CustomEggWatcher from 'ui/components/planners/CustomEggWatcher.vue';
import ActionHistory from '@/components/ActionHistory.vue';
import AvailableActions from '@/components/AvailableActions.vue';
import PlanFinalSummary from 'ui/components/planners/PlanFinalSummary.vue';
import FloatingStats from 'ui/components/planners/FloatingStats.vue';
import FloatingNotes from 'ui/components/planners/FloatingNotes.vue';
import PlannerToast from 'ui/components/planners/PlannerToast.vue';
import WarningDialog from 'ui/components/planners/WarningDialog.vue';
import RecalculationOverlay from 'ui/components/planners/RecalculationOverlay.vue';
import LoadingOverlay from 'ui/components/planners/LoadingOverlay.vue';
import PlanGoals from '@/components/PlanGoals.vue';
import PlanLibrary from 'ui/components/planners/PlanLibrary.vue';
import PlanSelectionDialog from 'ui/components/planners/PlanSelectionDialog.vue';
import { hashID, saveMetadata, loadMetadata } from '@/lib/storage/db';
import { useEventWaits } from 'lib/planners/composables/usePlannerEventWaits';
import EventEdgeWaitCard from 'ui/components/planners/actions/EventEdgeWaitCard.vue';
import { formatDuration } from 'lib/planners/format';
import { usePersistence } from 'lib/planners/composables/usePersistence';
import { compactActionHistory } from 'lib/planners/composables/useCompactActionHistory';
import { computeSnapshot } from 'lib/planners/engine/compute';
import { getSimulationContext, createBaseEngineState } from 'lib/planners/engine/adapter';
import type { Action, FuelEgg } from '@/types';
import {
  initStartFromScratch,
  initPlanFuture,
  initContinueCurrent,
  initReconcile,
  refreshReconcile,
  loadAndSyncBackup,
  captureReconciliationTargets,
  catchUpFarmState,
} from '@/lib/modes';

// Dev server only (localhost or a LAN IP hitting the Vite dev server) - never in a production build.
const isDev = import.meta.env.DEV;

const playerId = ref(new URLSearchParams(window.location.search).get('playerId') || getSavedPlayerID() || '');
const initialStateStore = useInitialStateStore();
const actionsStore = useActionsStore();
const uiStore = useUIStore();
const { isHeaderCollapsed, isFooterCollapsed, loading, error } = storeToRefs(uiStore);
const planStore = usePlanStore();
const fuelTankStore = useFuelTankStore();
const eventsStore = useEventsStore();

const notesStore = useNotesStore();
const {
  toggleEarningsBoost: handleEarningsEventWait,
  secondsUntilNextEarningsBoost,
  secondsUntilEarningsBoostEnd,
} = useEventWaits();
const { partitionHash, saveActiveDraft, initPersistence, broadcastPresence } = usePersistence();

const isEarningsBoostActive = computed(() => actionsStore.effectiveSnapshot?.earningsBoost?.active ?? false);
const earningsEventTooltip = computed(() =>
  isEarningsBoostActive.value
    ? `2x Earnings ends Tuesday at +0. Click to wait ${formatDuration(secondsUntilEarningsBoostEnd.value)} until it ends.`
    : `Next 2x Earnings starts Monday at +0. Click to wait ${formatDuration(secondsUntilNextEarningsBoost.value)} until it starts.`
);

const { lastBackupFormatted, lastBackupAge, pageTitle } = usePlannerPageStatus();

onMounted(async () => {
  eventsStore.fetchEvents();

  if (playerId.value) {
    await initPersistence(playerId.value);

    try {
      const pHash = await hashID(playerId.value);
      const savedBackup = await loadMetadata(pHash, 'rawBackup');
      if (savedBackup) {
        initialStateStore.rawBackup = savedBackup;
      }
    } catch (e) {
      console.error('Failed to load raw backup from DB', e);
    }
  }

  if (!actionsStore._initialSnapshot) {
    await actionsStore.recalculateAll();
  }

  // Fresh start: if only start_ascension exists and no farm state is loaded, add initial Wait for Full Habs
  const startAction = actionsStore.getStartAction();
  if (
    actionsStore.actions.length === 1 &&
    startAction &&
    !startAction.payload.initialFarmState &&
    !startAction.payload.isQuickContinue
  ) {
    actionsStore.pushWaitForFullHabsAction();
  }
});

// Auto-save logic
let saveTimeout: ReturnType<typeof setTimeout>;
function triggerAutoSave() {
  if (!playerId.value) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveActiveDraft();
  }, 1000);
}

actionsStore.$subscribe(triggerAutoSave);
notesStore.$subscribe(triggerAutoSave);

// Re-init persistence when player ID changes
watch(playerId, async newId => {
  if (newId) {
    await initPersistence(newId);
  }
});

// Section expansion state
const expandedSections = ref({
  actionHistory: true,
  availableActions: true,
});

// isHeaderCollapsed moved to UI store

type PlannerMode = 'scratch' | 'future' | 'continue' | 'library' | 'reconcile' | null;
const plannerMode = ref<PlannerMode>(null);
const loadedPlanName = ref('');

const plannerModeLabel = computed(() => {
  if (plannerMode.value === 'scratch') return 'Start from Scratch';
  if (plannerMode.value === 'future') return 'Plan New Enlightenment Farm';
  if (plannerMode.value === 'continue') return 'Continue Enlightenment Farm';
  if (plannerMode.value === 'library') return loadedPlanName.value;
  if (plannerMode.value === 'reconcile') return `Reconciling ${loadedPlanName.value}`;
  return null;
});

function handlePlanLoaded(name: string) {
  plannerMode.value = 'library';
  loadedPlanName.value = name;
  isHeaderCollapsed.value = true;
  scrollToTop();
}

// Current state from actions store
const currentSnapshot = computed(() => actionsStore.currentSnapshot);
const totalCost = computed(() => actionsStore.totalCost);
const actionCount = computed(() => actionsStore.actionCount);

// Modal state

const showReconcileLibraryModal = ref(false);

const dialogs = usePlanDialogs();
const { confirmUnsavedChanges, showUndoConfirmation, handleClearAll } = dialogs;

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Start from Scratch: Full reset.
 * Delegates to initStartFromScratch mode initializer.
 */
async function startFromScratch() {
  error.value = '';
  try {
    plannerMode.value = 'scratch';
    await initStartFromScratch();
    isHeaderCollapsed.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Reset failed';
    console.error('Start from Scratch error:', e);
  }
}

/**
 * Reconcile Plan: Fetch latest backup AND load a plan from library.
 */
function triggerReconcile() {
  actionsStore.showIncompleteOnly = true;
  showReconcileLibraryModal.value = true;
}

async function handleLibraryReconcile(plan: import('@/lib/storage/db').PlanData) {
  showReconcileLibraryModal.value = false;
  loading.value = true;
  error.value = '';

  try {
    plannerMode.value = 'reconcile';
    loadedPlanName.value = plan.name;
    savePlayerID(playerId.value);
    await initReconcile(playerId.value, plan, broadcastPresence);
    isHeaderCollapsed.value = true;
  } catch (err) {
    console.error(err);
    alert('Failed to reconcile plan.');
  } finally {
    loading.value = false;
  }
}

async function handleRefreshReconcile() {
  if (!playerId.value || loading.value) return;

  loading.value = true;
  error.value = '';
  try {
    await refreshReconcile(playerId.value);
    // No full recalculateAll() needed here, as reconciliation statuses are reactive getters.
  } catch (err) {
    console.error(err);
    error.value = 'Failed to refresh backup.';
  } finally {
    loading.value = false;
  }
}

/**
 * Load player data from the server when the player ID form is submitted.
 * This is NOT a mode initializer — it just fetches player data so the
 * mode buttons become usable and player info is displayed.
 */
async function submitPlayerId(id: string) {
  playerId.value = id;
  savePlayerID(id);
  error.value = '';
  loading.value = true;
  notesStore.$reset();

  try {
    // Clear existing plan to ensure a fresh start with new player data
    // We skip recalculate because setInitialSnapshot will trigger it at the end of this function.
    await actionsStore.clearAll(undefined, true);

    const data = await requestFirstContact(id);
    const backup = data.backup!;
    resolveColleggtibleContracts(backup);

    try {
      const pHash = await hashID(id);
      await saveMetadata(pHash, 'rawBackup', backup);
    } catch (dbErr) {
      console.error('Failed to save raw backup to DB', dbErr);
    }

    // Load into state store and sync global stores
    loadAndSyncBackup(id, backup, 'default');

    // Catch-up calculations (eggs, earnings, population) are now handled
    // automatically by computeSnapshot in the engine.
    const context = getSimulationContext();
    const baseState = createBaseEngineState(null);
    const initialSnapshot = computeSnapshot(baseState, context);

    // Sync farm state with caught-up values
    catchUpFarmState(initialSnapshot, baseState.bankValue, context.ascensionStartTime);

    // Initialize initial state in actions store
    await actionsStore.setInitialSnapshot(initialSnapshot);

    loading.value = false;
  } catch (e) {
    loading.value = false;
    error.value = e instanceof Error ? e.message : 'Failed to load player data';
    console.error('Error fetching player data:', e);
  }
}

async function triggerQuickContinue() {
  if (!playerId.value) return;

  error.value = '';
  loading.value = true;

  try {
    plannerMode.value = 'continue';
    savePlayerID(playerId.value);
    await initContinueCurrent(playerId.value);
    isHeaderCollapsed.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Continue failed';
    console.error('Quick Continue error:', e);
  } finally {
    loading.value = false;
  }
}

/**
 * Plan a new enlightenment farm:
 * Delegates to initPlanFuture mode initializer.
 */
async function planNewFarm() {
  if (!playerId.value) return;

  error.value = '';
  loading.value = true;

  try {
    plannerMode.value = 'future';
    savePlayerID(playerId.value);
    await initPlanFuture(playerId.value);
    isHeaderCollapsed.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Plan new farm failed';
    console.error('Plan new farm error:', e);
  } finally {
    loading.value = false;
  }
}

const { saveCurrentPlan, savePlanAs } = usePlanSaving(partitionHash);

// Chevron icon component
const ChevronIcon = {
  props: { expanded: Boolean },
  template: `
    <svg
      class="w-5 h-5 text-gray-400 transition-transform"
      :class="{ 'rotate-180': expanded }"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  `,
};
</script>

<style scoped>
.heading-xl {
  @apply text-3xl md:text-4xl font-black uppercase tracking-tighter;
}
.text-gradient {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.section-premium {
  @apply bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500;
}
.btn-premium {
  @apply rounded-xl font-black uppercase tracking-widest text-[10px] transition-all duration-300 flex items-center justify-center gap-2;
}
.btn-primary {
  @apply bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95;
}
.btn-ghost {
  @apply bg-transparent hover:bg-slate-50 border border-slate-100;
}
</style>
