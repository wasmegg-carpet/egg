<template>
  <div
    class="fixed bottom-0 left-0 right-0 z-[1000] bg-white/95 backdrop-blur-xl border-t border-slate-100 shadow-[0_-8px_32px_rgba(0,0,0,0.06)] transition-transform duration-500"
    :class="[isCollapsed ? 'translate-y-full' : 'translate-y-0']"
  >
    <button
      @click="toggleCollapse"
      class="absolute -top-8 right-6 bg-white/95 backdrop-blur-xl border border-b-0 border-slate-100 px-3 py-1 rounded-t-lg shadow-sm text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1 text-[10px] font-black uppercase tracking-wider h-8"
    >
      <svg
        class="w-4 h-4 transition-transform duration-300"
        :class="{ 'rotate-180': !isCollapsed }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
      </svg>
    </button>

    <div class="max-w-7xl mx-auto px-6 py-4 flex flex-wrap justify-between items-center gap-6">
      <!-- Start Date -->
      <div class="summary-item">
        <span class="summary-label">Start Date</span>
        <span class="summary-value text-slate-900">{{ formatDateTime(startDate) }}</span>
      </div>

      <!-- Duration -->
      <div class="summary-item">
        <span class="summary-label">Duration</span>
        <span class="summary-value font-mono-premium font-black text-slate-600">{{ formattedDuration }}</span>
      </div>

      <!-- End Date -->
      <div class="summary-item">
        <span class="summary-label">End Date</span>
        <span class="summary-value text-slate-900">{{ formatDateTime(endDate) }}</span>
      </div>

      <!-- Shifts -->
      <div class="summary-item">
        <span class="summary-label">Shifts</span>
        <div class="flex items-center gap-2">
          <span class="summary-value font-mono-premium font-black text-slate-600">{{ shiftCount }}</span>
          <div
            v-if="totalShiftCost > 0"
            class="flex flex-col justify-center border-l border-slate-100 pl-2 h-7 opacity-80"
            v-tippy="{ content: 'Spent • Remaining', placement: 'top' }"
          >
            <div class="text-[8px] font-black leading-none text-slate-400 mb-1">
              -{{ formatNumber(totalShiftCost, 1) }}
            </div>
            <div class="text-[9px] font-black leading-none text-slate-600 flex items-center gap-0.5">
              {{ formatNumber(finalSE, 1) }}
              <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-2.5 h-2.5" alt="SE" />
            </div>
          </div>
        </div>
      </div>

      <!-- TE Gained -->
      <div 
        class="summary-item cursor-pointer hover:bg-slate-50 p-2 -mx-2 -my-2 rounded-xl transition-colors duration-200 group"
        @click="showTeModal = true"
      >
        <span class="summary-label group-hover:text-indigo-400 transition-colors">TE Gained</span>
        <div class="flex items-center gap-2">
          <span class="summary-value font-mono-premium font-black text-slate-600 group-hover:text-indigo-600 transition-colors">+{{ teGained }}</span>
          <span
            class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 group-hover:bg-indigo-50 px-2 py-0.5 rounded-full border border-slate-100 group-hover:border-indigo-100 transition-colors"
          >
            (Total: {{ currentTE }})
          </span>
        </div>
      </div>

      <!-- Actions Group -->
      <div class="flex items-center gap-2">
        <div class="flex items-center rounded-2xl bg-slate-50 border border-slate-100 p-1 shadow-inner">
           <button class="btn-icon-premium" v-tippy="'Save Plan'" @click="emit('save-plan')">
             <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
               <polyline points="17 21 17 13 7 13 7 21" />
               <polyline points="7 3 7 8 15 8" />
             </svg>
           </button>
           <button class="btn-icon-premium" v-tippy="'Save Plan As...'" @click="emit('save-plan-as')">
             <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
               <polyline points="17 21 17 13 7 13 7 21" />
               <polyline points="7 3 7 8 15 8" />
               <path d="M12 17h4" />
               <path d="M14 15v4" />
             </svg>
           </button>
         </div>

        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleImport" />

        <div class="w-px h-8 bg-slate-100 mx-1"></div>

        <!-- Donate Button -->
        <button
          class="btn-icon-premium bg-slate-900 border-slate-800 text-white hover:bg-slate-800 hover:scale-110 shadow-lg shadow-slate-200"
          v-tippy="'Donate to joobrainie'"
          @click="showDonateModal = true"
        >
          <img :src="iconURL('egginc/icon_gift.png', 64)" class="w-5 h-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" alt="Donate" />
        </button>

        <!-- Force Refresh Button: only on localhost / the staging deploy, for testers who need the
             latest build (clears any service worker + Cache Storage entries, then reloads with a
             cache-busting URL). Doesn't touch localStorage/IndexedDB, so saved plans are untouched. -->
        <button
          v-if="showTestingTools"
          class="btn-icon-premium"
          v-tippy="'Force Refresh (clear cache & reload)'"
          @click="handleHardReload"
        >
          <svg
            class="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>

        <span class="ml-4 text-[10px] text-slate-400 italic font-medium"
          >Developed by
          <span @click="triggerCat" class="cursor-pointer select-none hover:text-slate-600 transition-colors"
            >joobrainie</span
          ></span
        >
      </div>
    </div>

    <!-- Cat Gif Popup -->
    <div
      v-if="showCat"
      class="fixed inset-x-0 bottom-24 z-[100] flex justify-center pointer-events-none transition-opacity duration-1000 ease-out"
      :class="{ 'opacity-0': isFadingOut, 'opacity-100': !isFadingOut }"
    >
      <div class="bg-white p-2 rounded-2xl shadow-2xl border border-slate-100 transform rotate-2">
        <img
          :src="catGifUrl"
          class="max-w-[200px] max-h-[200px] rounded-xl object-cover block"
          alt="Random Cat"
          @error="showCat = false"
        />
      </div>
    </div>

    <!-- Donate Modal -->
    <Teleport to="body">
      <div v-if="showDonateModal" class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="showDonateModal = false" />

        <!-- Dialog -->
        <div class="card-glass relative w-full max-w-md overflow-hidden shadow-2xl rounded-2xl border border-white/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95">
          <div class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div class="p-1.5 bg-slate-100 rounded-lg text-slate-600">
              <img :src="iconURL('egginc/icon_gift.png', 64)" class="w-5 h-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" alt="Gift" />
            </div>
            <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">Support the Developer</h3>
          </div>

          <div class="p-6">
            <p class="text-sm font-medium text-slate-600 leading-relaxed mb-6">
              If you find this tool helpful, you're welcome to buy me a coffee! No obligation at all, but it is deeply appreciated.
            </p>
            
            <div class="flex flex-col gap-4">
              <a href="https://ko-fi.com/joobrainie" target="_blank" rel="noopener noreferrer" class="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:border-slate-300 hover:shadow-md transition-all bg-white group hover:-translate-y-0.5">
                <img src="/static/kofi_logo.png" class="w-8 h-8 group-hover:scale-110 transition-transform" alt="Ko-fi" />
                <div class="flex flex-col">
                  <span class="text-sm font-black text-slate-800">Support on Ko-fi</span>
                  <span class="text-xs font-medium text-slate-500">ko-fi.com/joobrainie</span>
                </div>
              </a>

              <a href="https://paypal.me/joobrainie" target="_blank" rel="noopener noreferrer" class="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:border-slate-300 hover:shadow-md transition-all bg-white group hover:-translate-y-0.5">
                <img src="/static/paypal_logo.svg" class="w-8 h-8 group-hover:scale-110 transition-transform" alt="PayPal" />
                <div class="flex flex-col">
                  <span class="text-sm font-black text-slate-800">Support via PayPal</span>
                  <span class="text-xs font-medium text-slate-500">paypal.me/joobrainie</span>
                </div>
              </a>
            </div>

            <div class="mt-8 flex justify-end">
              <button
                class="px-8 py-2 text-xs font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors rounded-xl font-mono-premium"
                @click="showDonateModal = false"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- TE Modal -->
    <TeBreakdownModal :show="showTeModal" :stats="teStatsList" @close="showTeModal = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';

import { type CalculationsSnapshot, type VirtueEgg } from '@/types';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { formatNumber } from '@/lib/format';
import { isTestingEnvironment } from '@/lib/isTestingEnvironment';
import { iconURL } from 'lib';
import TeBreakdownModal from '@/components/TeBreakdownModal.vue';

const actionsStore = useActionsStore();
const initialStateStore = useInitialStateStore();
const virtueStore = useVirtueStore();

const emit = defineEmits<{
  'update:collapsed': [value: boolean];
  'save-plan': [];
  'save-plan-as': [];
}>();

const isCollapsed = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
const showDonateModal = ref(false);
const showTeModal = ref(false);

// Only surfaced on localhost and the staging deploy — these are testing/bug-reporting tools, not
// something regular production users should see or need.
const showTestingTools = isTestingEnvironment;

/**
 * Clears any service worker registrations and Cache Storage entries, then reloads with a
 * cache-busting query param so the browser can't serve a stale index.html/JS chunk from its own
 * HTTP cache either. Deliberately does NOT touch localStorage/IndexedDB — that's where saved plans
 * and preferences live, and this is meant to fix "I'm not seeing the latest build," not wipe data.
 */
async function handleHardReload() {
  if (!confirm('This clears cached app files and reloads the page. Your saved plans are not affected. Continue?')) {
    return;
  }
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.error('Failed to clear service worker/cache storage before hard reload', e);
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.set('_hardReload', Date.now().toString());
    window.location.href = url.toString();
  }
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  emit('update:collapsed', isCollapsed.value);
}

const calculateTotalPotentialTE = (snapshot: CalculationsSnapshot) => {
  if (!snapshot || !snapshot.eggsDelivered) return 0;
  return Object.values(snapshot.eggsDelivered).reduce((sum: number, delivered: number) => {
    return sum + countTEThresholdsPassed(delivered);
  }, 0);
};

const startDate = computed(() => virtueStore.planStartTime);

const totalDurationSeconds = computed(() => {
  const currentSimTime = actionsStore.currentSnapshot.lastStepTime || 0;
  const offset = actionsStore.planStartOffset;
  return Math.max(0, currentSimTime - offset);
});

const formattedDuration = computed(() => {
  const seconds = totalDurationSeconds.value;
  if (seconds === 0) return '0s';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m${secs}s`;
  }

  return `${secs}s`;
});

const endDate = computed(() => {
  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
  // `totalDurationSeconds` routinely lands a sub-microsecond residue short of a whole second.
  return new Date(Math.round(startDate.value.getTime() + totalDurationSeconds.value * 1000));
});

const shiftCount = computed(() => {
  return actionsStore.actions.filter(a => a.type === 'shift').length;
});

const totalShiftCost = computed(() => {
  return actionsStore.actions.filter(a => a.type === 'shift').reduce((sum, a) => sum + a.cost, 0);
});

const finalSE = computed(() => actionsStore.currentSnapshot.soulEggs);

const currentTE = computed(() => calculateTotalPotentialTE(actionsStore.currentSnapshot));
const initialClaimedTE = computed(() => Object.values(initialStateStore.initialTeEarned).reduce((sum, val) => sum + val, 0));
const teGained = computed(() => currentTE.value - initialClaimedTE.value);

const teStatsList = computed(() => {
  const stats: { id: string; name: string; start: number; end: number; delta: number; icon: string; delivered: number }[] = [];

  const virtueEggs: VirtueEgg[] = ['curiosity', 'integrity', 'humility', 'resilience', 'kindness'];

  const totalDelivered = virtueEggs.reduce((sum, egg) => {
    return sum + (actionsStore.currentSnapshot.eggsDelivered?.[egg] || 0);
  }, 0);

  stats.push({
    id: 'truth',
    name: 'Total TE',
    start: initialClaimedTE.value,
    end: currentTE.value,
    delta: teGained.value,
    icon: iconURL('egginc/egg_truth.png', 64),
    delivered: totalDelivered,
  });

  for (const egg of virtueEggs) {
    const start = initialStateStore.initialTeEarned[egg] || 0;
    const delivered = actionsStore.currentSnapshot.eggsDelivered?.[egg] || 0;
    const thresholdsPassed = countTEThresholdsPassed(delivered);
    const claimed = actionsStore.currentSnapshot.teEarned?.[egg] || 0;
    const end = Math.max(claimed, thresholdsPassed);

    stats.push({
      id: egg,
      name: egg.charAt(0).toUpperCase() + egg.slice(1),
      start,
      end,
      delta: end - start,
      icon: iconURL(`egginc/egg_${egg}.png`, 64),
      delivered,
    });
  }
  return stats;
});

function formatDateTime(date: Date): string {
  if (isNaN(date.getTime())) return 'N/A';
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleString('en-US', options);
}

// Import/Export Logic
const fileInput = ref<HTMLInputElement | null>(null);



function triggerImport() {
  fileInput.value?.click();
}

function handleImport(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  const reader = new FileReader();

  reader.onload = async e => {
    try {
      const jsonString = e.target?.result as string;

      if (actionsStore.actionCount > 0) {
        if (!confirm('Importing a plan will overwrite your current actions. Continue?')) {
          input.value = ''; // Reset input
          return;
        }
      }

      await actionsStore.importPlan(jsonString);
    } catch (error) {
      console.error(error);
      alert('Failed to import plan: Invalid file format.');
    } finally {
      input.value = ''; // Reset for next use
    }
  };

  reader.readAsText(file);
}

// Cat Gif Logic
const showCat = ref(false);
const isFadingOut = ref(false);
const catGifUrl = ref('');
let fadeTimer: ReturnType<typeof setTimeout>;
let removeTimer: ReturnType<typeof setTimeout>;

function triggerCat() {
  clearTimeout(fadeTimer);
  clearTimeout(removeTimer);

  showCat.value = false;

  // Small delay to ensure DOM update if re-clicking
  setTimeout(() => {
    catGifUrl.value = `https://cataas.com/cat/gif?t=${Date.now()}`;
    showCat.value = true;
    isFadingOut.value = false;

    fadeTimer = setTimeout(() => {
      isFadingOut.value = true;
    }, 5000);

    removeTimer = setTimeout(() => {
      showCat.value = false;
    }, 6000); // 5s display + 1s fade
  }, 10);
}
</script>

<style scoped>
.summary-item {
  @apply flex flex-col gap-1;
}

.summary-label {
  @apply text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none;
}

.summary-value {
  @apply text-[13px] font-bold tracking-tight whitespace-nowrap;
}

.btn-icon-premium {
  @apply p-2 rounded-xl transition-all duration-300 flex items-center justify-center border border-transparent;
}

.btn-icon-premium:not(.text-white) {
  @apply text-slate-400 hover:text-indigo-600 hover:bg-white hover:border-indigo-100 hover:shadow-sm;
}

.animate-in {
  animation-duration: 200ms;
}
</style>
