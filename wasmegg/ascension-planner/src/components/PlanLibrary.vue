<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { usePersistence } from '@/composables/usePersistence';
import { loadLibraryPlans, deletePlanFromLibrary, savePlanToLibrary, type PlanData } from '@/lib/storage/db';
import { downloadFile } from '@/utils/export';
import { formatNumber, formatDuration, formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import { initLoadPlan, initPlanFuture } from '@/lib/modes';
import { useAutoPlannerStore, pickVariant, type ChainedAscension, type VariantKey } from '@/stores/autoPlanner';
import { useInitialStateStore } from '@/stores/initialState';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useUIStore } from '@/stores/ui';
import ConfirmationDialog from '@/components/ConfirmationDialog.vue';
import ImportCollisionDialog from '@/components/ImportCollisionDialog.vue';
import AutoPlanImportDialog from '@/components/AutoPlanImportDialog.vue';
import PlanAlreadyOpenWarning from '@/components/PlanAlreadyOpenWarning.vue';
import { createEmptySnapshot } from '@/types';
import { buildLibraryPlansFromExport } from '@/auto/buildLibraryPlans';
import { migrateExportedPlanV1, type ExportedPlan } from '@/auto/export';

const actionsStore = useActionsStore();
const autoPlannerStore = useAutoPlannerStore();
const initialStateStore = useInitialStateStore();
const truthEggsStore = useTruthEggsStore();
const uiStore = useUIStore();
const { partitionHash, broadcastLibraryUpdate, broadcastPresence, busyPlanIds } = usePersistence();

const plans = ref<PlanData[]>([]);
const isLoading = ref(true);
const showDeleteConfirm = ref(false);
const planToDelete = ref<PlanData | null>(null);

// Bulk select state
const bulkSelectMode = ref(false);
const selectedPlanIds = ref<Set<string>>(new Set());
const showBulkDeleteConfirm = ref(false);
const editingPlanId = ref<string | null>(null);
const newName = ref('');
const showCopyPrompt = ref(false);
const planToCopy = ref<PlanData | null>(null);
const copyName = ref('');
const showAlreadyOpenWarning = ref(false);
const openPlanName = ref('');

// Import collision state
const showCollisionDialog = ref(false);
const collisionPlanName = ref('');
const collisionRenamedName = ref('');
const collisionRemainingCount = ref(0);
const collisionDialogRef = ref<InstanceType<typeof ImportCollisionDialog> | null>(null);
let collisionResolver: ((resolution: 'overwrite' | 'keep-both' | 'skip' | 'cancel') => void) | null = null;

// Import progress
const importProgress = ref<{ current: number; total: number } | null>(null);

// Auto-plan import state
const showAutoPlanDialog = ref(false);
const autoPlanToImport = ref<any>(null);
const autoPlanName = ref('');
const autoPlanAscensionCount = ref(0);
let autoPlanResolver: ((resolution: 'restore' | 'individual' | 'cancel') => void) | null = null;

async function refreshPlans() {
  if (!partitionHash.value) return;
  isLoading.value = true;
  try {
    plans.value = await loadLibraryPlans(partitionHash.value);
  } finally {
    isLoading.value = false;
  }
}

onMounted(refreshPlans);
watch(partitionHash, refreshPlans);
watch(() => actionsStore.libraryUpdateTick, refreshPlans);

async function loadPlan(plan: PlanData) {
  // Check if plan is already open in another tab
  if (busyPlanIds.value.has(plan.id) && actionsStore.activePlanId !== plan.id) {
    openPlanName.value = plan.name;
    showAlreadyOpenWarning.value = true;
    return;
  }

  try {
    broadcastPresence(plan.id); // Immediate heartbeat to block other tabs
    await initLoadPlan(plan);
    emit('plan-loaded', plan.name);
  } catch (err) {
    console.error('[PlanLibrary] Error loading plan:', err);
    alert('Failed to load plan: ' + err);
  }
}

function promptCopy(plan: PlanData) {
  planToCopy.value = plan;
  copyName.value = generateUniqueName(plan.name, plans.value.map(p => p.name));
  showCopyPrompt.value = true;
}

async function executeCopy() {
  if (!planToCopy.value || !copyName.value.trim() || !partitionHash.value) return;
  
  const newPlan: PlanData = {
    id: Math.random().toString(36).substring(2, 15),
    name: copyName.value.trim(),
    timestamp: Date.now(),
    data: JSON.parse(JSON.stringify(planToCopy.value.data)),
  };
  
  await savePlanToLibrary(partitionHash.value, newPlan);
  broadcastLibraryUpdate();
  await refreshPlans();
  showCopyPrompt.value = false;
  planToCopy.value = null;
}

async function confirmDelete(plan: PlanData, event?: MouseEvent) {
  planToDelete.value = plan;
  if (event?.shiftKey) {
    await executeDelete();
    return;
  }
  showDeleteConfirm.value = true;
}

async function executeDelete() {
  if (planToDelete.value && partitionHash.value) {
    await deletePlanFromLibrary(partitionHash.value, planToDelete.value.id);
    if (actionsStore.activePlanId === planToDelete.value.id) {
      actionsStore.activePlanId = null;
    }
    broadcastLibraryUpdate();
    await refreshPlans();
  }
  showDeleteConfirm.value = false;
  planToDelete.value = null;
}

function toggleBulkSelectMode() {
  bulkSelectMode.value = !bulkSelectMode.value;
  selectedPlanIds.value = new Set();
}

function togglePlanSelection(id: string) {
  const next = new Set(selectedPlanIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedPlanIds.value = next;
}

async function executeBulkDelete() {
  if (!partitionHash.value) return;
  for (const id of selectedPlanIds.value) {
    await deletePlanFromLibrary(partitionHash.value, id);
    if (actionsStore.activePlanId === id) {
      actionsStore.activePlanId = null;
    }
  }
  broadcastLibraryUpdate();
  await refreshPlans();
  selectedPlanIds.value = new Set();
  bulkSelectMode.value = false;
  showBulkDeleteConfirm.value = false;
}

function startRename(plan: PlanData) {
  editingPlanId.value = plan.id;
  newName.value = plan.name;
}

async function saveRename() {
  if (!editingPlanId.value || !newName.value.trim() || !partitionHash.value) return;
  const plan = plans.value.find(p => p.id === editingPlanId.value);
  if (plan) {
    const updatedPlan = { ...plan, name: newName.value.trim(), timestamp: Date.now() };
    await savePlanToLibrary(partitionHash.value, updatedPlan);
    broadcastLibraryUpdate();
    await refreshPlans();
  }
  editingPlanId.value = null;
}

/**
 * Export a single plan. Sanitized — no hashed IDs or storage keys.
 */
function exportPlan(plan: PlanData) {
  const exportData = {
    version: 1,
    type: 'plan',
    name: plan.name,
    timestamp: plan.timestamp,
    data: plan.data,
  };
  const jsonString = JSON.stringify(exportData, null, 2);
  downloadFile(`${plan.name.replace(/\s+/g, '_')}.json`, jsonString, 'application/json');
}

/**
 * Export entire library. Sanitized — no hashed IDs or storage keys.
 */
function exportAll() {
  const exportData = {
    version: 1,
    type: 'library',
    timestamp: Date.now(),
    plans: plans.value.map(p => ({
      name: p.name,
      timestamp: p.timestamp,
      data: p.data,
    })),
  };
  const jsonString = JSON.stringify(exportData, null, 2);
  downloadFile(`ascension-library-${new Date().toISOString().split('T')[0]}.json`, jsonString, 'application/json');
}

/**
 * Generate a collision-free name by appending (Copy N).
 */
function generateUniqueName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;
  let counter = 1;
  let candidate = `${baseName} (Copy ${counter})`;
  while (existingNames.includes(candidate)) {
    counter++;
    candidate = `${baseName} (Copy ${counter})`;
  }
  return candidate;
}

/**
 * Prompt the user for collision resolution. Returns a Promise that resolves
 * when the user picks an option in the dialog.
 */
function promptCollisionResolution(
  planName: string,
  renamedName: string,
  remaining: number
): Promise<'overwrite' | 'keep-both' | 'skip' | 'cancel'> {
  collisionPlanName.value = planName;
  collisionRenamedName.value = renamedName;
  collisionRemainingCount.value = remaining;
  showCollisionDialog.value = true;

  return new Promise(resolve => {
    collisionResolver = resolve;
  });
}

function handleCollisionResolve(resolution: 'overwrite' | 'keep-both' | 'skip') {
  showCollisionDialog.value = false;
  if (collisionResolver) {
    collisionResolver(resolution);
    collisionResolver = null;
  }
}

function handleCollisionCancel() {
  showCollisionDialog.value = false;
  if (collisionResolver) {
    collisionResolver('cancel');
    collisionResolver = null;
  }
}

/**
 * Import plans from a JSON file. Handles single plans, library exports, and raw plan data.
 * For each name collision, prompts the user for resolution.
 */
async function handleImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !partitionHash.value) return;

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const content = e.target?.result as string;
      const imported = JSON.parse(content);

      // Normalize imported data into a uniform array
      let plansToImport: { name: string; data: Record<string, unknown> }[] = [];

      if (imported.type === 'library' && Array.isArray(imported.plans)) {
        // Full library export
        plansToImport = imported.plans.map((p: { name: string; data: Record<string, unknown> }) => ({
          name: p.name,
          data: p.data,
        }));
      } else if (imported.type === 'plan' && imported.data) {
        // Single plan export (from our new format)
        plansToImport = [{ name: imported.name || file.name.replace('.json', ''), data: imported.data }];
      } else if (imported.version && imported.ascensions && imported.initialState) {
        // Sequential Roadmap (Auto-Plan). Migrate version-1 exports (result1/result2/result3?) to
        // the current variants-map shape up front so everything below only ever deals with one shape.
        const plan: ExportedPlan =
          imported.version === 1 ? migrateExportedPlanV1(imported) : (imported as ExportedPlan);

        showAutoPlanDialog.value = true;
        autoPlanToImport.value = plan;
        autoPlanName.value = file.name.replace('.json', '');
        autoPlanAscensionCount.value = plan.ascensions.length;

        const resolution = await new Promise<'restore' | 'individual' | 'cancel'>(resolve => {
          autoPlanResolver = resolve;
        });

        if (resolution === 'cancel') return;

        if (resolution === 'restore') {
          // 1. Switch tab
          uiStore.plannerTab = 'automatic';
          uiStore.isHeaderCollapsed = true;

          // 2. Load fresh backup first (ensures we have latest epic research/artifacts as a baseline)
          //    We do this because switching to the Auto Planner tab normally triggers a backup fetch.
          uiStore.loading = true;
          try {
            if (initialStateStore.playerId) {
              await initPlanFuture(initialStateStore.playerId);
            }

            // 3. Restore to Auto Planner (now overwriting the fresh backup state)
            const importedOverrides: Record<number, VariantKey> =
              plan.planVariantOverrides ?? (plan.a1ForceMode === 'continue' ? { 0: 'continue' } : {});
            const importedEndTimeOverrides: Record<number, number> = plan.endTimeOverrides ?? {};

            const chain: ChainedAscension[] = plan.ascensions.map(a => {
              const item: ChainedAscension = {
                index: a.index,
                variants: a.variants,
                goal: a.goal,
              };
              if (a.result3SkippedReason) item.result3SkippedReason = a.result3SkippedReason;
              return item;
            });

            const nextGoalsMap: Record<number, { te: number | null, date: string, time: string }> = {};
            plan.ascensions.forEach((a, idx) => {
              // Populate with the original goal
              nextGoalsMap[idx] = { ...a.goal };

              // If it was a TE goal, pre-fill the date/time fields with the actual result for better UX
              if (a.goal.type === 'te' || !a.goal.date) {
                const bestResult = pickVariant(a.variants, importedOverrides[idx], !!importedEndTimeOverrides[idx]);
                nextGoalsMap[idx].date = formatUnixToDateInput(bestResult.summary.endTime, plan.timezone);
                nextGoalsMap[idx].time = formatUnixToTimeInput(bestResult.summary.endTime, plan.timezone);
              }
            });
            // Add the next step goal (empty placeholder for new ascension)
            const lastImportedA = plan.ascensions[plan.ascensions.length - 1];
            const lastIdx = plan.ascensions.length - 1;
            const lastBestResult = pickVariant(
              lastImportedA.variants, importedOverrides[lastIdx], !!importedEndTimeOverrides[lastIdx]
            );
            nextGoalsMap[chain.length] = {
              te: Math.min(490, lastBestResult.summary.endTE + 30),
              date: '',
              time: ''
            };

            const firstA = plan.ascensions[0];
            const bestFirstA = pickVariant(firstA.variants, importedOverrides[0], !!importedEndTimeOverrides[0]);
            const a1EndTime = bestFirstA.summary.endTime;

            autoPlannerStore.setPlan({
              ascensionChain: chain,
              timezone: plan.timezone,
              startDate: formatUnixToDateInput(plan.startTime, plan.timezone),
              startTime: formatUnixToTimeInput(plan.startTime, plan.timezone),
              targetTE: plan.ascensions.map(a => a.goal.te || pickVariant(a.variants).summary.endTE).join(' '),
              // Always populate date/time fields with results for visibility
              targetEndDate: formatUnixToDateInput(a1EndTime, plan.timezone),
              targetEndTime: formatUnixToTimeInput(a1EndTime, plan.timezone),
              nextGoals: nextGoalsMap,
              planVariantOverrides: importedOverrides,
              endTimeOverrides: plan.endTimeOverrides ?? {},
            });

            // Hydrate stores so the form shows the correct numbers from the plan
            initialStateStore.hydrate(plan.initialState);
            truthEggsStore.hydrate(plan.initialState);
          } catch (e) {
            console.error('Failed to restore roadmap:', e);
            alert('Failed to restore roadmap simulation state.');
          } finally {
            uiStore.loading = false;
          }
        }

        if (resolution === 'individual') {
          // 2. Import Individual Ascensions into Library
          const exportDate = new Date(plan.exportedAt).toISOString().split('T')[0];

          plansToImport = buildLibraryPlansFromExport(plan, exportDate);
        } else {
          // Restore only — we're done
          return;
        }
      } else if (imported.version && imported.actions && imported.initialState) {
        // Raw plan data (old format — the plan data itself, not wrapped)
        plansToImport = [{ name: file.name.replace('.json', ''), data: imported }];
      } else {
        throw new Error('Unrecognized file format');
      }

      // Track the current library names (live, updated as we add)
      const existingNames = plans.value.map(p => p.name);
      let bulkResolution: 'overwrite' | 'keep-both' | 'skip' | null = null;
      let importedCount = 0;
      let skippedCount = 0;

      importProgress.value = { current: 0, total: plansToImport.length };

      for (let i = 0; i < plansToImport.length; i++) {
        const p = plansToImport[i];
        importProgress.value = { current: i + 1, total: plansToImport.length };

        const hasCollision = existingNames.includes(p.name);

        if (hasCollision) {
          const renamedName = generateUniqueName(p.name, existingNames);
          let resolution: 'overwrite' | 'keep-both' | 'skip' | 'cancel';

          if (bulkResolution) {
            resolution = bulkResolution;
          } else {
            const remaining = plansToImport.length - i - 1;
            resolution = await promptCollisionResolution(p.name, renamedName, remaining);

            // Check if "Apply to all" was selected
            await nextTick();
            if (collisionDialogRef.value?.applyToAll && resolution !== 'cancel') {
              bulkResolution = resolution;
            }
          }

          if (resolution === 'cancel') {
            break;
          } else if (resolution === 'skip') {
            skippedCount++;
            continue;
          } else if (resolution === 'overwrite') {
            // Find the existing plan and replace its data
            const existing = plans.value.find(ep => ep.name === p.name);
            if (existing) {
              const updatedPlan: PlanData = {
                ...existing,
                timestamp: Date.now(),
                data: p.data,
              };
              await savePlanToLibrary(partitionHash.value, updatedPlan);
              importedCount++;
            }
          } else if (resolution === 'keep-both') {
            const newPlan: PlanData = {
              id: Math.random().toString(36).substring(2, 15),
              name: renamedName,
              timestamp: Date.now(),
              data: p.data,
            };
            await savePlanToLibrary(partitionHash.value, newPlan);
            existingNames.push(renamedName);
            importedCount++;
          }
        } else {
          // No collision — just add
          const newPlan: PlanData = {
            id: Math.random().toString(36).substring(2, 15),
            name: p.name,
            timestamp: Date.now(),
            data: p.data,
          };
          await savePlanToLibrary(partitionHash.value, newPlan);
          existingNames.push(p.name);
          importedCount++;
        }
      }
      
      broadcastLibraryUpdate();
      await refreshPlans();
      importProgress.value = null;

      if (importedCount > 0 || skippedCount > 0) {
        const parts = [];
        if (importedCount > 0) parts.push(`${importedCount} plan${importedCount > 1 ? 's' : ''} imported`);
        if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
        // Could show a toast here; for now it's silent success
      }
    } catch (err) {
      importProgress.value = null;
      alert('Failed to import plans: ' + err);
    }
  };
  reader.readAsText(file);

  // Reset the file input so the same file can be imported again
  if (event.target) {
    (event.target as HTMLInputElement).value = '';
  }
}

function handleAutoPlanResolve(resolution: 'restore' | 'individual') {
  showAutoPlanDialog.value = false;
  if (autoPlanResolver) {
    autoPlanResolver(resolution);
    autoPlanResolver = null;
  }
}

function handleAutoPlanCancel() {
  showAutoPlanDialog.value = false;
  if (autoPlanResolver) {
    autoPlanResolver('cancel');
    autoPlanResolver = null;
  }
}

const emit = defineEmits<{ 'plan-loaded': [name: string] }>();
</script>

<template>
  <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
    <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
      <h3 class="text-sm font-semibold text-gray-900 flex items-center">
        <svg class="w-4 h-4 mr-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        Plan Library
        <span
          v-if="plans.length > 0"
          class="ml-2 px-1.5 py-0.5 text-[10px] bg-slate-200 text-slate-600 rounded-full font-bold"
        >
          {{ plans.length }}
        </span>
      </h3>
      <div class="flex items-center space-x-2">
        <button
          v-if="bulkSelectMode && selectedPlanIds.size > 0"
          class="px-2.5 py-1 text-xs font-medium rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
          @click="$event.shiftKey ? executeBulkDelete() : (showBulkDeleteConfirm = true)"
        >
          Delete ({{ selectedPlanIds.size }})
        </button>
        <button
          v-if="plans.length > 0"
          class="px-2.5 py-1 text-xs font-medium rounded border transition-colors"
          :class="bulkSelectMode
            ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
            : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50'"
          @click="toggleBulkSelectMode"
        >
          {{ bulkSelectMode ? 'Cancel' : 'Multi-Select' }}
        </button>
        <button
          class="px-2.5 py-1 text-xs font-medium rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="plans.length === 0"
          @click="exportAll"
        >
          Export All
        </button>
        <label class="px-2.5 py-1 text-xs font-medium rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer">
          Import
          <input type="file" class="hidden" accept=".json" @change="handleImport" />
        </label>
      </div>
    </div>

    <div class="p-2 sm:p-4">
      <!-- Import progress bar -->
      <div v-if="importProgress" class="mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
        <div class="flex justify-between items-center mb-2">
          <span class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Importing Plans</span>
          <span class="text-xs font-mono font-bold text-indigo-600">
            {{ importProgress.current }} / {{ importProgress.total }}
          </span>
        </div>
        <div class="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
          <div
            class="h-full bg-indigo-500 transition-all duration-300 rounded-full"
            :style="{ width: `${(importProgress.current / importProgress.total) * 100}%` }"
          />
        </div>
      </div>

      <div v-if="isLoading" class="flex justify-center py-4">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500"></div>
      </div>

      <div v-else-if="plans.length === 0" class="text-center py-6">
        <p class="text-gray-500 text-sm">Your library is empty. Save your current plan to see it here.</p>
      </div>

      <div v-else class="space-y-0.5 max-h-64 overflow-y-auto pr-2">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="group flex items-center justify-between py-1 px-1 sm:py-1.5 sm:px-3 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-all"
          :class="{
            'bg-indigo-50 border-indigo-100': actionsStore.activePlanId === plan.id,
            'bg-amber-50/50 border-amber-200 opacity-60': busyPlanIds.has(plan.id) && actionsStore.activePlanId !== plan.id,
          }"
        >
          <div class="flex-1 min-w-0 mr-2 sm:mr-4">
            <div v-if="editingPlanId === plan.id" class="flex items-center">
              <input
                v-model="newName"
                class="block w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-1"
                @keyup.enter="saveRename"
              />
              <button class="ml-2 text-green-600 hover:text-green-800" @click="saveRename">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
            <div v-else class="flex items-center cursor-pointer" @click="bulkSelectMode ? togglePlanSelection(plan.id) : loadPlan(plan)">
              <input
                v-if="bulkSelectMode"
                type="checkbox"
                class="mr-2 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 cursor-pointer"
                :checked="selectedPlanIds.has(plan.id)"
                @click.stop
                @change="togglePlanSelection(plan.id)"
              />
              <span class="text-sm font-medium text-gray-900 truncate" :title="plan.name">{{ plan.name }}</span>
              <span
                v-if="actionsStore.activePlanId === plan.id"
                class="ml-2 px-1 text-[10px] bg-indigo-100 text-indigo-700 rounded font-bold uppercase tracking-wider"
                >Active</span
              >
              <span
                v-else-if="busyPlanIds.has(plan.id)"
                class="ml-2 px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-700 rounded font-black uppercase tracking-wider"
                >Open in another tab</span
              >
            </div>
          </div>

          <div class="flex items-center space-x-0 sm:space-x-2">
            <span class="hidden sm:inline text-[10px] text-gray-400 whitespace-nowrap mr-1">
              Updated {{ new Date(plan.timestamp).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }}
            </span>
            <button class="p-0.5 sm:p-1 text-gray-400 hover:text-indigo-600" v-tippy="'Export this plan (JSON)'" @click="exportPlan(plan)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </button>
            <button class="p-0.5 sm:p-1 text-gray-400 hover:text-indigo-600" v-tippy="'Rename this plan'" @click="startRename(plan)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
            <button class="p-0.5 sm:p-1 text-gray-400 hover:text-indigo-600" v-tippy="'Copy this plan'" @click="promptCopy(plan)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
            </button>
            <button class="p-0.5 sm:p-1 text-gray-400 hover:text-red-600" v-tippy="'Delete this plan'" @click="confirmDelete(plan, $event)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="bg-amber-50 px-4 py-3 border-t border-amber-100 flex items-start">
      <svg class="w-4 h-4 text-amber-500 mr-2 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <p class="text-[11px] text-amber-700 leading-relaxed uppercase tracking-tight font-medium">
        Plans are stored locally in this browser. Clearing site data will delete your library. Use "Export All" to
        create external backups.
      </p>
    </div>
  </div>

  <ConfirmationDialog
    v-if="showDeleteConfirm"
    title="Delete Plan"
    :message="`Are you sure you want to delete '${planToDelete?.name}'? This cannot be undone.`"
    confirm-label="Delete"
    variant="danger"
    @confirm="executeDelete"
    @cancel="
      showDeleteConfirm = false;
      planToDelete = null;
    "
  />

  <ConfirmationDialog
    v-if="showBulkDeleteConfirm"
    title="Delete Plans"
    :message="`Are you sure you want to delete ${selectedPlanIds.size} plan${selectedPlanIds.size > 1 ? 's' : ''}? This cannot be undone.`"
    confirm-label="Delete"
    variant="danger"
    @confirm="executeBulkDelete"
    @cancel="showBulkDeleteConfirm = false"
  />

  <ImportCollisionDialog
    v-if="showCollisionDialog"
    ref="collisionDialogRef"
    :plan-name="collisionPlanName"
    :renamed-name="collisionRenamedName"
    :remaining-count="collisionRemainingCount"
    @resolve="handleCollisionResolve"
    @cancel="handleCollisionCancel"
  />

  <!-- Copy Plan Dialog -->
  <ConfirmationDialog
    v-if="showCopyPrompt"
    title="Copy Plan"
    confirm-label="Create Copy"
    @confirm="executeCopy"
    @cancel="showCopyPrompt = false"
  >
    <div class="mt-3">
      <label class="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">New Plan Name</label>
      <input
        v-model="copyName"
        class="block w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-2 px-3 shadow-sm"
        @keyup.enter="executeCopy"
        placeholder="Enter name for copy..."
      />
    </div>
  </ConfirmationDialog>

  <PlanAlreadyOpenWarning v-if="showAlreadyOpenWarning" @dismiss="showAlreadyOpenWarning = false" />

  <AutoPlanImportDialog
    v-if="showAutoPlanDialog"
    :plan-name="autoPlanName"
    :ascension-count="autoPlanAscensionCount"
    @resolve="handleAutoPlanResolve"
    @cancel="handleAutoPlanCancel"
  />
</template>
