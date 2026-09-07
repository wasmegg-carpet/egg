<template>
  <the-nav-bar active-entry-id="ascension-planner" />

  <div
    :class="[
      'min-h-screen bg-gray-100 transition-all duration-300',
      plannerTab === 'automatic' || isFooterCollapsed ? 'pb-8' : 'pb-24',
    ]"
  >
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

            <!-- Mode Tabs -->
            <div
              v-if="playerId && !loading"
              class="mt-6 flex justify-center animate-in fade-in slide-in-from-top-4 duration-500"
              :class="plannerTab === 'automatic' ? 'pb-8' : ''"
            >
              <div class="bg-slate-50 p-1.5 rounded-2xl border border-slate-200/50 shadow-sm flex gap-1">
                <button
                  class="px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center gap-2"
                  :class="
                    plannerTab === 'manual'
                      ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                  "
                  @click="plannerTab = 'manual'"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  Manual Planner
                </button>
                <button
                  class="px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center gap-2"
                  :class="
                    plannerTab === 'automatic'
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                  "
                  @click="handleAutoPlannerTabClick"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Auto Planner
                  <span class="bg-indigo-500 text-[8px] px-1.5 py-0.5 rounded-md ml-1 border border-indigo-400/30"
                    >BETA</span
                  >
                </button>
              </div>
            </div>

            <!-- Plan Library Section -->
            <div v-if="playerId && plannerTab === 'manual'" class="max-w-6xl mx-auto mt-6">
              <PlanLibrary @plan-loaded="handlePlanLoaded" />
            </div>

            <!-- Ascension Action Buttons -->
            <div
              v-if="plannerTab === 'manual'"
              class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-3 max-w-6xl mx-auto"
            >
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

              <!-- Plan Next Ascension -->
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
                    <div class="text-sm font-bold text-slate-800">Plan Future Ascension</div>
                    <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1.5 leading-relaxed">
                      Load your latest backup, include pending TE, reset the clock, and start planning fresh
                    </p>
                  </div>
                  <button
                    class="btn-premium btn-primary px-5 py-2 mt-auto w-full"
                    :disabled="loading || !playerId"
                    @click="confirmUnsavedChanges(planNextAscension)"
                  >
                    Plan
                  </button>
                </div>
              </div>

              <!-- Continue Current Ascension -->
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
                    <div class="text-sm font-bold text-slate-800">Continue Current Ascension</div>
                    <p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1.5 leading-relaxed">
                      Resume from your current in-game farm with all events applied
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
      <div v-if="plannerTab === 'manual' && plannerModeLabel" class="mt-4 flex justify-center">
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

      <!-- Active Event Slide Toggle (Earnings Boost) -->
      <div v-if="plannerTab === 'manual'" class="mt-4 flex flex-col items-center gap-2">
        <div
          class="w-full max-w-sm bg-gradient-to-r from-orange-50/80 via-white to-amber-50/80 rounded-2xl p-4 border border-orange-100/50 shadow-sm relative overflow-hidden flex items-center justify-between transition-all duration-300"
        >
          <div class="flex items-center gap-2 relative z-10">
            <div class="flex flex-col gap-0.5 text-left">
              <div class="flex items-center gap-2">
                <div class="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></div>
                <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none"
                  >Monday 2x Earnings Event</span
                >
              </div>
              <span class="text-[11px] font-black text-orange-600 uppercase tracking-tighter">
                {{ isEarningsBoostActive ? 'Active' : 'Inactive' }}
              </span>
            </div>
          </div>

          <button
            class="relative inline-flex h-5 w-10 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
            :class="isEarningsBoostActive ? 'bg-orange-500' : 'bg-slate-200'"
            @click="handleToggleEarningsEvent"
          >
            <span
              class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
              :class="isEarningsBoostActive ? 'translate-x-[22px]' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>

      <div v-if="loading" class="text-center py-4 text-gray-600">Loading player data...</div>

      <div v-if="error" class="text-center py-4 text-red-600">
        {{ error }}
      </div>

      <div v-if="plannerTab === 'manual'">
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

      <div v-else-if="plannerTab === 'automatic' && playerId && !loading">
        <AutomaticPlanner />
      </div>

      <!-- Undo Confirmation Dialog -->
      <UndoConfirmationDialog
        v-if="undoAction"
        :action="undoAction"
        :dependents-a="undoDependentsA"
        :dependents-b="undoDependentsB"
        @confirm="executeUndo"
        @cancel="cancelUndo"
      />

      <!-- Clear All Confirmation Dialog -->
      <ConfirmationDialog
        v-if="showClearAllConfirmation"
        title="Clear All Actions"
        message="Are you sure you want to clear all actions? This cannot be undone."
        confirm-label="Clear All"
        @confirm="executeClearAll"
        @cancel="showClearAllConfirmation = false"
      />

      <!-- Unsaved Changes Protection Dialog -->
      <ConfirmationDialog
        v-if="showUnsavedConfirm"
        title="Unsaved Changes"
        message="You have unsaved changes in your current plan. If you continue, these changes will be lost. Would you like to save before proceeding?"
        confirm-label="Continue Without Saving"
        variant="danger"
        @confirm="
          showUnsavedConfirm = false;
          pendingAction?.();
        "
        @cancel="
          showUnsavedConfirm = false;
          pendingAction = null;
        "
      />

      <!-- Plan Selection Dialog (for Reconcile) -->
      <PlanSelectionDialog
        v-if="showReconcileLibraryModal"
        @select="handleLibraryReconcile"
        @cancel="showReconcileLibraryModal = false"
      />

      <!-- Artifact Set Selection Dialog -->
      <div v-if="showArtifactSetConfirm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div
          class="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        >
          <div class="px-6 py-5 border-b border-slate-100">
            <h3 class="text-lg font-bold text-slate-800">Current Artifact Set</h3>
            <p class="mt-2 text-sm text-slate-500">Which artifact set do you currently have equipped in game?</p>
          </div>
          <div class="px-6 py-4 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
            <button
              class="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              @click="handleArtifactSetSelection('elr')"
            >
              Delivery Rate Set
            </button>
            <button
              class="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              @click="handleArtifactSetSelection('earnings')"
            >
              Earnings Set
            </button>
          </div>
        </div>
      </div>

      <!-- Continuity Check Dialog -->
      <ContinuityDialog />

      <WarningDialog />

      <RecalculationOverlay />

      <LoadingOverlay
        :show="loading"
        title="One Moment..."
        message="Fetching your data and crunching the numbers to set up your plan..."
      />

      <PlanFinalSummary
        v-if="plannerTab === 'manual'"
        @update:collapsed="isFooterCollapsed = $event"
        @save-plan="saveCurrentPlan"
        @save-plan-as="savePlanAs"
      />
      <FloatingStats v-if="plannerTab === 'manual'" />
      <FloatingNotes v-if="plannerTab === 'manual'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import TheNavBar from 'ui/components/NavBar.vue';
import { getSavedPlayerID, savePlayerID, requestFirstContact, resolveColleggtibleContracts } from 'lib';
import ThePlayerIdForm from 'ui/components/PlayerIdForm.vue';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { useUIStore } from '@/stores/ui';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useEventsStore } from '@/stores/events';

import { useNotesStore } from '@/stores/notes';
import CustomEggWatcher from '@/components/CustomEggWatcher.vue';
import ActionHistory from '@/components/ActionHistory.vue';
import AvailableActions from '@/components/AvailableActions.vue';
import UndoConfirmationDialog from '@/components/UndoConfirmationDialog.vue';
import PlanFinalSummary from '@/components/PlanFinalSummary.vue';
import ContinuityDialog from '@/components/ContinuityDialog.vue';
import ConfirmationDialog from '@/components/ConfirmationDialog.vue';
import FloatingStats from '@/components/FloatingStats.vue';
import FloatingNotes from '@/components/FloatingNotes.vue';
import WarningDialog from '@/components/WarningDialog.vue';
import RecalculationOverlay from '@/components/RecalculationOverlay.vue';
import LoadingOverlay from '@/components/LoadingOverlay.vue';
import PlanLibrary from '@/components/PlanLibrary.vue';
import PlanSelectionDialog from '@/components/PlanSelectionDialog.vue';
import AutomaticPlanner from '@/components/auto/AutomaticPlanner.vue';
import { useSalesStore } from '@/stores/sales';
import { hashID, saveMetadata, loadMetadata } from '@/lib/storage/db';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { usePersistence } from '@/composables/usePersistence';
import { compactActionHistory } from '@/composables/useCompactActionHistory';
import { generateActionId } from '@/types';
import { computeDependencies } from '@/lib/actions/executor';
import { restoreFromSnapshot } from '@/lib/actions/snapshot';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import type { Action, VirtueEgg } from '@/types';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { getArtifact, getArtifactLoadoutFromBackup } from '@/lib/artifacts';
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
const { plannerTab, isHeaderCollapsed, isFooterCollapsed, loading, error } = storeToRefs(uiStore);
const virtueStore = useVirtueStore();
const fuelTankStore = useFuelTankStore();
const truthEggsStore = useTruthEggsStore();
const eventsStore = useEventsStore();
const salesStore = useSalesStore();

const notesStore = useNotesStore();
const { prepareExecution, completeExecution } = useActionExecutor();
const { partitionHash, saveActiveDraft, initPersistence, broadcastPresence } = usePersistence();

const isEarningsBoostActive = computed(() => actionsStore.effectiveSnapshot?.earningsBoost?.active ?? false);

const lastBackupFormatted = computed(() => {
  const approxTime = initialStateStore.rawBackup?.approxTime;
  if (approxTime == null) return 'Unknown';
  const date = new Date(approxTime * 1000);

  return date.toLocaleTimeString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
});

const lastBackupAge = computed(() => {
  const approxTime = initialStateStore.rawBackup?.approxTime;
  if (approxTime == null) return '';
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - approxTime);

  if (diff < 60) return 'Just now';

  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h${remainingMinutes}m ago`;
});

const pageTitle = computed(() => {
  const name = initialStateStore.rawBackup?.userName;
  return name ? `Ascension Planner ${name}` : 'Ascension Planner';
});

watch(
  pageTitle,
  newTitle => {
    document.title = newTitle;
  },
  { immediate: true }
);

function handleToggleEarningsEvent() {
  const beforeSnapshot = prepareExecution();
  const currentlyActive = beforeSnapshot.earningsBoost.active;

  // Find the multiplier from the event store if turning ON
  let multiplier = 2;
  if (!currentlyActive) {
    const event = eventsStore.getActiveEvents(initialStateStore.isUltra).find(e => e.type === 'earnings-boost');
    if (event) multiplier = event.multiplier;
  } else {
    multiplier = 1;
  }

  const payload = {
    active: !currentlyActive,
    multiplier,
  };

  // Update store state
  salesStore.setEarningsBoost(payload.active, payload.multiplier);

  completeExecution(
    {
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
    },
    beforeSnapshot
  );
}

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
  if (plannerMode.value === 'future') return 'Plan Future Ascension';
  if (plannerMode.value === 'continue') return 'Continue Current Ascension';
  if (plannerMode.value === 'library') return loadedPlanName.value;
  if (plannerMode.value === 'reconcile') return `Reconciling ${loadedPlanName.value}`;
  return null;
});

function handlePlanLoaded(name: string) {
  plannerMode.value = 'library';
  loadedPlanName.value = name;
  plannerTab.value = 'manual';
  isHeaderCollapsed.value = true;
  scrollToTop();
}

// Current state from actions store
const currentSnapshot = computed(() => actionsStore.currentSnapshot);
const totalCost = computed(() => actionsStore.totalCost);
const actionCount = computed(() => actionsStore.actionCount);

// Modal state
const undoAction = ref<Action | null>(null);
const undoDependentsA = ref<Action[]>([]);
const undoDependentsB = ref<Action[]>([]);
const showClearAllConfirmation = ref(false);

const showReconcileLibraryModal = ref(false);
const showUnsavedConfirm = ref(false);
const showArtifactSetConfirm = ref(false);
const pendingAction = ref<(() => void) | null>(null);

/**
 * Confirm unsaved changes before potentially destructive actions.
 */
function confirmUnsavedChanges(action: () => void) {
  if (actionsStore.isDirty) {
    pendingAction.value = action;
    showUnsavedConfirm.value = true;
  } else {
    action();
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showUndoConfirmation(action: Action, options?: { skipConfirmation: boolean }) {
  const validationA = actionsStore.prepareUndo(action.id);
  const validationB = actionsStore.prepareUndoUntilShift(action.id);

  undoAction.value = action;
  undoDependentsA.value = validationA.dependentActions;
  undoDependentsB.value = validationB.dependentActions;

  if (options?.skipConfirmation) {
    executeUndo('truncate');
  }
}

function cancelUndo() {
  undoAction.value = null;
  undoDependentsA.value = [];
  undoDependentsB.value = [];
}

function executeUndo(mode: 'dependents' | 'truncate' = 'dependents') {
  if (!undoAction.value) return;

  actionsStore.executeUndo(undoAction.value.id, mode, snapshot => {
    // Restore stores to the snapshot of the last remaining action
    restoreFromSnapshot(snapshot);
  });

  cancelUndo();
}

function handleClearAll(options?: { skipConfirmation: boolean }) {
  if (options?.skipConfirmation) {
    executeClearAll();
  } else {
    showClearAllConfirmation.value = true;
  }
}

function executeClearAll() {
  actionsStore.clearAll();
  showClearAllConfirmation.value = false;
}

/**
 * Start from Scratch: Full reset.
 * Delegates to initStartFromScratch mode initializer.
 */
async function startFromScratch() {
  error.value = '';
  try {
    plannerMode.value = 'scratch';
    plannerTab.value = 'manual';
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
    plannerTab.value = 'manual';
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

async function handleAutoPlannerTabClick() {
  plannerTab.value = 'automatic';
  isHeaderCollapsed.value = true;

  if (playerId.value && !loading.value) {
    loading.value = true;
    try {
      // Fetch fresh backup and initialize for "Plan Future" mode (zeroed farm)
      await initPlanFuture(playerId.value);
    } catch (e) {
      console.error('Failed to auto-init Auto Planner:', e);
      error.value = 'Failed to load fresh backup for Auto Planner.';
    } finally {
      loading.value = false;
    }
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
    const { teEarnedPerEgg } = loadAndSyncBackup(id, backup, 'default');

    // Catch-up calculations (eggs, earnings, population) are now handled
    // automatically by computeSnapshot in the engine.
    const context = getSimulationContext();
    const baseState = createBaseEngineState(null);
    const initialSnapshot = computeSnapshot(baseState, context);

    // Sync farm state and Truth Eggs with caught-up values
    catchUpFarmState(initialSnapshot, baseState.bankValue, context.ascensionStartTime, teEarnedPerEgg);

    // Initialize initial state in actions store
    await actionsStore.setInitialSnapshot(initialSnapshot);

    loading.value = false;
  } catch (e) {
    loading.value = false;
    error.value = e instanceof Error ? e.message : 'Failed to load player data';
    console.error('Error fetching player data:', e);
  }
}

/**
 * Try to determine which artifact set they have on based on stones.
 */
function detectArtifactSet(loadout: import('@/lib/artifacts').EquippedArtifact[]): 'earnings' | 'elr' | null {
  let totalSlots = 0;
  const allStones: string[] = [];

  for (const slot of loadout) {
    if (slot.artifactId) {
      const artifact = getArtifact(slot.artifactId);
      if (artifact) {
        totalSlots += artifact.slots;
      }
    }
    for (const stoneId of slot.stones) {
      if (stoneId) {
        allStones.push(stoneId);
      }
    }
  }

  // 1. If their artifact set has at least 3 stone slots, we can try to determine which set it is
  if (totalSlots < 3) {
    return null;
  }

  // If no stones are equipped, we can't reliably determine the set
  if (allStones.length === 0) {
    return null;
  }

  const isLunar = (id: string) => id.startsWith('lunar-stone-');
  const isELR = (id: string) => id.startsWith('quantum-stone-') || id.startsWith('tachyon-stone-');

  // 2. If all the stones are lunar stones, it's the earnings set
  if (allStones.every(isLunar)) {
    return 'earnings';
  }

  // 3. If all the stones are either quantum or tachyon, it's the elr set
  if (allStones.every(isELR)) {
    return 'elr';
  }

  return null;
}

async function triggerQuickContinue() {
  if (!playerId.value) return;
  loading.value = true;
  error.value = '';

  try {
    const data = await requestFirstContact(playerId.value);
    if (!data.backup) throw new Error('Could not fetch player backup');
    const backup = data.backup;
    resolveColleggtibleContracts(backup);

    const loadout = getArtifactLoadoutFromBackup(backup);
    const detectedSet = detectArtifactSet(loadout);

    if (detectedSet) {
      handleArtifactSetSelection(detectedSet);
    } else {
      loading.value = false;
      showArtifactSetConfirm.value = true;
    }
  } catch (e) {
    loading.value = false;
    error.value = e instanceof Error ? e.message : 'Quick Continue failed';
    console.error('Quick Continue error:', e);
  }
}

function handleArtifactSetSelection(selection: 'earnings' | 'elr') {
  showArtifactSetConfirm.value = false;
  quickContinueAscension(selection);
}

async function quickContinueAscension(selection: 'earnings' | 'elr') {
  if (!playerId.value) return;

  error.value = '';
  loading.value = true;

  try {
    plannerMode.value = 'continue';
    plannerTab.value = 'manual';
    savePlayerID(playerId.value);
    await initContinueCurrent(playerId.value, selection);
    isHeaderCollapsed.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Quick Continue failed';
    console.error('Quick Continue error:', e);
  } finally {
    loading.value = false;
  }
}

/**
 * Plan Next Ascension:
 * Delegates to initPlanFuture mode initializer.
 */
async function planNextAscension() {
  if (!playerId.value) return;

  error.value = '';
  loading.value = true;

  try {
    plannerMode.value = 'future';
    plannerTab.value = 'manual';
    savePlayerID(playerId.value);
    await initPlanFuture(playerId.value);
    isHeaderCollapsed.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Plan Next failed';
    console.error('Plan Next Ascension error:', e);
  } finally {
    loading.value = false;
  }
}

async function saveCurrentPlan() {
  if (!partitionHash.value) return;

  if (actionsStore.activePlanId) {
    const { safeImport } = await import('@/lib/import');
    const plans = await (await safeImport(() => import('@/lib/storage/db'))).loadLibraryPlans(partitionHash.value!);
    const current = plans.find(p => p.id === actionsStore.activePlanId);
    if (current) {
      await actionsStore.savePlan(current.name, partitionHash.value);
      return;
    }
  }

  // Prompt for name if no active plan
  const name = prompt('Enter a name for this plan:');
  if (name) {
    await actionsStore.savePlan(name, partitionHash.value);
  }
}

async function savePlanAs() {
  if (!partitionHash.value) return;
  const name = prompt('Enter a new name for this plan:');
  if (name) {
    // Reset ID to trigger a new save
    const tempId = actionsStore.activePlanId;
    actionsStore.activePlanId = null;
    try {
      await actionsStore.savePlan(name, partitionHash.value);
    } catch (err) {
      actionsStore.activePlanId = tempId;
      alert('Save failed: ' + err);
    }
  }
}

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
