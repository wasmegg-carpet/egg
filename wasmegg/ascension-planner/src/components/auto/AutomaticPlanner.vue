<template>
  <div class="space-y-6">
    <!-- Form Card -->
    <div class="section-premium p-4 sm:p-8 max-w-4xl mx-auto mt-4 relative overflow-hidden">
      <div class="absolute -right-20 -top-20 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl"></div>

      <div class="relative z-10">
        <div class="flex items-center gap-4 mb-8">
          <div class="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 class="text-xl font-black text-slate-900 uppercase tracking-tight">Auto-AP</h2>
        </div>

        <div class="space-y-8 relative">
          <!-- Generating overlay -->
          <div
            v-if="isGenerating"
            class="absolute -inset-4 bg-white/60 backdrop-blur-[1px] z-50 flex items-center justify-center rounded-3xl transition-all duration-300"
          >
            <div class="flex items-center gap-3 bg-white px-6 py-3 rounded-2xl border border-indigo-100 shadow-xl shadow-indigo-500/10">
              <div class="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              <span class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Form locked while calculating...</span>
            </div>
          </div>

          <div class="space-y-8">
            <SchedulingInputs />
            <ProPermitToggle :model-value="initialStateStore.proPermit" @update:model-value="setProPermit" />
            <VirtueProgressSection />

            <!-- Ascension Targets -->
            <div>
              <div class="flex items-center gap-3 mb-4 px-1">
                <div class="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h3 class="text-xs font-black text-slate-700 uppercase tracking-wider">Ascension Targets</h3>
              </div>
              <div class="space-y-1.5">
                <label class="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1">Target TE(s)</label>
                <div class="flex items-center gap-3">
                  <div class="relative flex-1">
                    <input
                      ref="targetInput"
                      v-model="targetTE"
                      @input="handleTargetTEInput"
                      @keydown.enter="runGenerate()"
                      type="text"
                      class="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-500/50 transition-all pr-10"
                      placeholder="e.g. 300 400 490"
                    />
                    <div class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 font-black text-[10px]">TE</div>
                  </div>
                  <button
                    v-if="deferForEarningsMode"
                    type="button"
                    title="Defer for earnings mode is on — click to turn it off"
                    class="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center hover:bg-indigo-100 transition-colors"
                    @click="deferForEarningsMode = false"
                  >
                    <img :src="iconURL('egginc-extras/silo.png', 64)" class="w-5 h-5 object-contain" alt="silo" />
                  </button>
                </div>
                <p class="text-[10px] font-bold text-slate-400 leading-relaxed px-1 mt-2">
                  Enter a sequence of target TEs separated by spaces to generate an entire multi-ascension chain at once.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="showLowClothedTEWarning"
          class="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex gap-3"
        >
          <svg class="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p class="leading-relaxed">
            Auto-AP is really built for players farther along — below 200 Clothed TE, its assumptions (like habs
            staying full throughout) don't hold up well, so the plan it generates may be pretty suboptimal for
            you right now. You're welcome to generate one anyway just to see what it does, but for a plan you can
            actually rely on, raise your Clothed TE in the Virtue Progress section above first.
          </p>
        </div>

        <button
          class="btn-premium btn-primary w-full py-4 mt-8 text-sm shadow-xl shadow-indigo-500/20 active:scale-[0.98]"
          :disabled="isGenerating"
          @click="runGenerate()"
        >
          <span v-if="isGenerating">{{ generateProgress || 'Generating Plan...' }}</span>
          <span v-else>{{ ascensionChain.length > 0 ? 'Update Plan' : 'Generate Plan' }}</span>
        </button>

        <div v-if="ascensionChain.length === 0" class="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-2">
          <p class="font-bold uppercase tracking-wide text-amber-700">Before you generate — a few assumptions to know about</p>
          <ul class="space-y-1.5 list-disc list-inside leading-relaxed">
            <li><span class="font-semibold">Habs are always full.</span> Most reliable from around 100 TE, once filling habs takes no real time.</li>
            <li><span class="font-semibold">Artifacts and stones come from Artifacts &amp; Stones.</span> It starts from your inventory, and you can change it there or per ascension.</li>
            <li><span class="font-semibold">No downtime between ascensions</span>, and <span class="font-semibold">you never sleep</span>.</li>
          </ul>
          <p class="text-amber-600 leading-relaxed">Use this as a starting point, not a final word. Your actual results may vary.</p>

          <div class="border-t border-amber-200 pt-3 mt-1">
            <p class="font-bold uppercase tracking-wide text-amber-700 mb-2">How each ascension runs</p>
            <ul class="space-y-1.5 list-disc list-inside leading-relaxed">
              <li><span class="font-semibold">Opening (C1, K1, I1)</span> — Builds the best habs and vehicles it can, trying a few shift orders and keeping whichever does best.</li>
              <li><span class="font-semibold">C2 / K2 / R1</span> — Finishes fleet size and Graviton Coupling, maxes Hyperloops and train cars, then buys silos.</li>
              <li><span class="font-semibold">C3</span> — Rides one to three weekly research sales, buying earnings research first and Delivery Rate research in the final sale.</li>
              <li><span class="font-semibold">H1</span> — Equips the best delivery set for your research at that point.</li>
              <li><span class="font-semibold">K3 → C4 / I2 / R2 / H2</span> — Waits on each virtue egg until the TE goal is reached.</li>
            </ul>
            <p class="mt-2 text-amber-600 leading-relaxed">Auto-AP tries several build lengths and keeps the fastest; you can switch to another on each ascension's card.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Results Section -->
    <div v-if="ascensionChain.length > 0" class="max-w-4xl mx-auto space-y-6 pb-24 relative px-4 sm:px-0">
      <div class="flex flex-col sm:flex-row justify-between items-center gap-4 px-4">
        <h2 class="text-lg font-black text-slate-800 uppercase tracking-tight">Generated Roadmap</h2>
        <div class="flex flex-wrap justify-center items-center gap-3">
          <button
            @click="copySummary"
            :disabled="isGenerating"
            class="flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-600"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            {{ copySuccess ? 'Copied!' : 'Copy Summary' }}
          </button>
          <button
            @click="saveToLibrary"
            :disabled="isGenerating || isSavingToLibrary"
            class="flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-600"
          >
            <svg v-if="isSavingToLibrary" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <svg v-else-if="saveToLibrarySuccess" class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            {{ isSavingToLibrary ? 'Saving...' : saveToLibrarySuccess ? 'Saved!' : 'Save to Library' }}
          </button>
          <button
            @click="exportCurrentPlan"
            :disabled="isGenerating || isExporting"
            class="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
          >
            <svg v-if="isExporting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {{ isExporting ? 'Exporting...' : 'Export Plan' }}
          </button>
        </div>
      </div>

      <div class="space-y-4">
        <template v-for="(result, idx) in bestResults" :key="idx">
          <ForcedAscensionPreview
            v-if="ascensionChain[idx]?.forcedTarget490"
            :variants="ascensionChain[idx].variants"
            :index="idx"
            :total="visibleTotal"
          />
          <AscensionOverview
            v-else
            :summary="result.summary"
            :actions="result.actions"
            :index="idx"
            :total="visibleTotal"
            :target-t-e="result.targetTE"
            :variants="result.variants"
            :active-variant-key="result.variantKey"
            :result3-skipped-reason="result.result3SkippedReason"
            :is-saving-single="savingIndex === idx"
            :save-single-success="savedIndex === idx"
            :timezone="timezone"
            :has-end-time-override="autoPlannerStore.endTimeOverrides[idx] !== undefined"
            @set-plan-variant="(variant: VariantKey) => handleSetPlanVariant(idx, variant)"
            @save-single-to-library="saveSingleAscensionToLibrary(idx)"
            @override-end-time="(endTime: number | null) => handleSetEndTimeOverride(idx, endTime)"
            :loadout-inputs="resolveLoadoutInputs(idx)"
            :has-loadout-override="autoPlannerStore.loadoutOverrides[idx] !== undefined"
            :inventory-delivery="autoPlannerStore.defaultLoadoutInputs?.delivery ?? null"
            @override-loadout="(inputs: AutoLoadoutInputs | null) => requestLoadoutOverride(idx, inputs)"
          />
        </template>
      </div>

      <SimulationErrorAlert v-if="simulationError" :message="simulationError" />
    </div>

    <ChainSummaryBar :is-collapsed="isCollapsed" @toggle="isCollapsed = !isCollapsed" />

    <!-- Floating Progress Indicator -->
    <div
      v-if="isGenerating"
      class="fixed right-8 z-[200] bg-slate-900/90 text-white backdrop-blur-md border border-slate-700/50 px-6 py-4 rounded-2xl shadow-2xl shadow-indigo-500/20 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-6 duration-300 transition-[bottom] duration-500"
      :class="[ascensionChain.length >= 1 && !isCollapsed ? 'bottom-32' : 'bottom-8']"
    >
      <div class="w-6 h-6 border-3 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin"></div>
      <div class="space-y-0.5 pr-2">
        <div class="text-[10px] font-black uppercase tracking-widest text-indigo-400">Updating Roadmap</div>
        <div class="text-xs font-bold text-slate-200 font-mono-premium">{{ generateProgress || 'Calculating...' }}</div>
      </div>
    </div>

    <ValidationDialog
      :is-open="isValidationErrorOpen"
      :message="validationErrorMessage"
      @close="isValidationErrorOpen = false"
    />

    <LoadoutOverrideScopeDialog
      v-if="pendingLoadoutOverride"
      :mode="pendingLoadoutOverride.inputs ? 'set' : 'remove'"
      :current-index="pendingLoadoutOverride.idx"
      :total="visibleTotal"
      :overridden-indices="Object.keys(autoPlannerStore.loadoutOverrides).map(Number)"
      @confirm="confirmLoadoutOverride"
      @cancel="pendingLoadoutOverride = null"
    />

    <!-- Cancel (and the backdrop) keeps the overrides: the safe choice if dismissed by accident. -->
    <ConfirmationDialog
      v-if="isKeepOverridesPromptOpen"
      title="Artifact Overrides"
      :message="`You have artifact overrides on ${overriddenAscensionLabels}. Keep them or use the defaults?`"
      confirm-label="Use defaults"
      cancel-label="Keep them"
      @confirm="finishGenerate(true)"
      @cancel="finishGenerate(false)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAutoPlannerStore, type VariantKey } from '@/stores/autoPlanner';
import { useVirtueStore } from '@/stores/virtue';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import { useAscensionGenerator } from '@/auto/useAscensionGenerator';
import { useEarningsClothedTE } from '@/composables/useEarningsClothedTE';
import { loadAutoPlannerSchedule, saveAutoPlannerSchedule, saveAutoPlannerTEInputs } from '@/lib/autoPlannerFormCache';
import { isTestingEnvironment } from '@/lib/isTestingEnvironment';
import { iconURL } from 'lib';
import SchedulingInputs from './SchedulingInputs.vue';
import ProPermitToggle from 'ui/components/planners/ProPermitToggle.vue';
import VirtueProgressSection from './VirtueProgressSection.vue';
import ChainSummaryBar from './ChainSummaryBar.vue';
import SimulationErrorAlert from './SimulationErrorAlert.vue';
import AscensionOverview from './AscensionOverview.vue';
import ForcedAscensionPreview from './ForcedAscensionPreview.vue';
import ValidationDialog from './ValidationDialog.vue';
import LoadoutOverrideScopeDialog from './LoadoutOverrideScopeDialog.vue';
import ConfirmationDialog from 'ui/components/planners/ConfirmationDialog.vue';
import type { AutoLoadoutInputs } from '@/auto/loadout';
import { applyAutoStartingTE } from '@/auto/startingTE';
import { formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import type { VirtueEgg } from '@/types';

const autoPlannerStore = useAutoPlannerStore();
const virtueStore = useVirtueStore();
const truthEggsStore = useTruthEggsStore();
const initialStateStore = useInitialStateStore();
const actionsStore = useActionsStore();

/** Same switch as the manual planner's Initial State: also re-runs the manual plan on the new permit. */
function setProPermit(enabled: boolean) {
  initialStateStore.setProPermit(enabled);
  actionsStore.setInitialSnapshot(computeSnapshot(createBaseEngineState(null), getSimulationContext()));
}

const { ascensionChain, timezone, startDate, startTime, startTimeOverride, targetTE, deferForEarningsMode } =
  storeToRefs(autoPlannerStore);

// The forced-490 ascension is a silent bonus card — don't count it in the "A1 of N" denominator.
const visibleTotal = computed(() => {
  const chain = ascensionChain.value;
  const lastIsForced = chain.length > 0 && !!chain[chain.length - 1].forcedTarget490;
  return chain.length - (lastIsForced ? 1 : 0);
});
const { clothedTE: earningsClothedTe } = useEarningsClothedTE();
const showLowClothedTEWarning = computed(() => earningsClothedTe.value !== null && earningsClothedTe.value < 200);

const targetInput = ref<HTMLInputElement | null>(null);
const isCollapsed = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

// Restore a cached form (start-time override, target TE) from a previous visit, if any, so a page
// reload doesn't wipe out what the user had entered. The start date/time/timezone only come back
// with an override — otherwise the plan starts now. This runs before the defaulting logic below,
// which only fills in fields that are still empty. Skipped when a plan is already loaded (setPlan
// set its own start).
const cachedSchedule = loadAutoPlannerSchedule();
if (cachedSchedule) {
  if (cachedSchedule.startTimeOverride && !startTimeOverride.value) {
    startTimeOverride.value = true;
    if (cachedSchedule.timezone) timezone.value = cachedSchedule.timezone;
    if (cachedSchedule.startDate) startDate.value = cachedSchedule.startDate;
    if (cachedSchedule.startTime) startTime.value = cachedSchedule.startTime;
  }
  if (cachedSchedule.targetTE) targetTE.value = cachedSchedule.targetTE;
  if (cachedSchedule.deferForEarningsMode && isTestingEnvironment) deferForEarningsMode.value = true;
}

// Initialize timezone default
if (!timezone.value) {
  timezone.value = virtueStore.ascensionTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Initialize start date/time defaults
const now = new Date();
if (!startDate.value) {
  startDate.value = new Intl.DateTimeFormat('en-CA', { timeZone: timezone.value }).format(now);
}
if (!startTime.value) {
  startTime.value = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone.value,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

// Initialize Target TE to current + 30 once store data loads
let targetTEInitialized = false;
watch(
  () => truthEggsStore.totalTE,
  newVal => {
    if (newVal > 0 && !targetTEInitialized) {
      if (!targetTE.value) targetTE.value = String(Math.min(490, newVal + 30));
      targetTEInitialized = true;
    }
  },
  { immediate: true }
);

// Persist the form (start-time override, target TE, defer for earnings mode) so it survives a page reload.
watch([timezone, startDate, startTime, startTimeOverride, targetTE, deferForEarningsMode], () => {
  saveAutoPlannerSchedule({
    timezone: timezone.value,
    startDate: startDate.value,
    startTime: startTime.value,
    startTimeOverride: startTimeOverride.value,
    targetTE: targetTE.value,
    deferForEarningsMode: deferForEarningsMode.value,
  });
});

const {
  isGenerating,
  isExporting,
  isSavingToLibrary,
  saveToLibrarySuccess,
  generateProgress,
  simulationError,
  isValidationErrorOpen,
  validationErrorMessage,
  copySuccess,
  bestResults,
  generate,
  regeneratePlan,
  copySummary,
  exportCurrentPlan,
  saveToLibrary,
  savingIndex,
  savedIndex,
  saveSingleAscensionToLibrary,
  handleSetPlanVariant,
  handleSetEndTimeOverride,
  handleSetLoadoutOverride,
  resolveLoadoutInputs,
} = useAscensionGenerator();

// The main Generate/Update Plan button (and Enter in the Target TE field) always starts fresh —
// see `regeneratePlan`'s own doc comment for why it clears both override maps rather than trying to
// detect what actually changed. Per-ascension overrides (variant dropdown, end-time editor) still
// regenerate surgically via their own handlers, which call `generate()` directly.
//
// Loadout overrides are the exception: if any exist, ask first whether to keep them.
const isKeepOverridesPromptOpen = ref(false);
const overriddenAscensionLabels = computed(() =>
  Object.keys(autoPlannerStore.loadoutOverrides)
    .map(Number)
    .sort((a, b) => a - b)
    .map(i => `A${i + 1}`)
    .join(', ')
);

const finishGenerate = (clearLoadoutOverrides: boolean) => {
  isKeepOverridesPromptOpen.value = false;
  console.clear();
  regeneratePlan(() => nextTick(() => targetInput.value?.focus()), { clearLoadoutOverrides });
};

const runGenerate = () => {
  if (Object.keys(autoPlannerStore.loadoutOverrides).length > 0) {
    isKeepOverridesPromptOpen.value = true;
    return;
  }
  finishGenerate(true);
};

// Setting or removing a per-ascension artifact override first asks which other ascensions it
// applies to (a single-ascension chain skips the question).
const pendingLoadoutOverride = ref<{ idx: number; inputs: AutoLoadoutInputs | null } | null>(null);

const requestLoadoutOverride = (idx: number, inputs: AutoLoadoutInputs | null) => {
  if (visibleTotal.value <= 1) {
    handleSetLoadoutOverride([idx], inputs);
    return;
  }
  pendingLoadoutOverride.value = { idx, inputs };
};

const confirmLoadoutOverride = (indices: number[]) => {
  const pending = pendingLoadoutOverride.value;
  pendingLoadoutOverride.value = null;
  if (pending) handleSetLoadoutOverride(indices, pending.inputs);
};

// A Chain Finder route this tab was opened with (App.vue): load its start, starting TE, targets,
// silo mode, end-time overrides (the prestiges that wait) and builds, then generate. On mount, so it
// lands after VirtueProgressSection restores its cached TE inputs. `generate`, not `regeneratePlan`:
// that would clear the overrides.
//
// A route from the save starts from the backup, not a TE override: its pending TE and the eggs laid
// since the last sync count. It starts now, unless its first prestige is later (a whole hour, or
// blocked dates and hours).
onMounted(async () => {
  const chain = autoPlannerStore.pendingChain;
  if (!chain) return;
  autoPlannerStore.pendingChain = null;
  const nowUnix = Date.now() / 1000;
  const start = chain.fromSave ? Math.max(chain.start, nowUnix) : chain.start;
  startTimeOverride.value = !chain.fromSave || chain.start > nowUnix;
  timezone.value = chain.timezone;
  startDate.value = formatUnixToDateInput(start, chain.timezone);
  startTime.value = formatUnixToTimeInput(start, chain.timezone);
  targetTE.value = chain.targets.join(' ');
  deferForEarningsMode.value = chain.siloMode;
  if (chain.fromSave) {
    autoPlannerStore.teOverride = null;
    saveAutoPlannerTEInputs(initialStateStore.playerId, null);
  } else {
    autoPlannerStore.teOverride = { ...truthEggsStore.teEarned, ...chain.teEarned };
  }
  await applyAutoStartingTE();
  autoPlannerStore.ascensionChain = [];
  autoPlannerStore.planVariantOverrides = { ...chain.variantOverrides };
  autoPlannerStore.endTimeOverrides = { ...chain.endTimeOverrides };
  autoPlannerStore.loadoutOverrides = {};
  console.clear();
  generate(() => nextTick(() => targetInput.value?.focus()));
});

const handleTargetTEInput = (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (isTestingEnvironment && /g/i.test(input.value)) {
    deferForEarningsMode.value = true;
  }
  const formatted = input.value.replace(/\D+/g, ' ');
  targetTE.value = formatted.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
};
</script>

<style scoped>
.btn-premium {
  @apply rounded-2xl font-black uppercase tracking-[0.2em] transition-all duration-300 flex items-center justify-center gap-3;
}
.btn-primary {
  @apply bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed;
}
.section-premium {
  @apply bg-white rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-slate-200/50 transition-all duration-700;
}
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}
</style>
