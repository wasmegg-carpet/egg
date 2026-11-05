<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadLibraryPlans, type PlanData } from '@/lib/storage/db';
import { usePersistence } from '@/composables/usePersistence';
import { useActionsStore } from '@/stores/actions';
import PlanAlreadyOpenWarning from '@/components/PlanAlreadyOpenWarning.vue';

const actionsStore = useActionsStore();
const { partitionHash, broadcastPresence, busyPlanIds } = usePersistence();
const plans = ref<PlanData[]>([]);
const isLoading = ref(true);

const showAlreadyOpenWarning = ref(false);

function isPlanBusy(plan: PlanData): boolean {
  return busyPlanIds.value.has(plan.id) && actionsStore.activePlanId !== plan.id;
}

function selectPlan(plan: PlanData) {
  if (isPlanBusy(plan)) {
    showAlreadyOpenWarning.value = true;
    return;
  }
  broadcastPresence(plan.id);
  emit('select', plan);
}

onMounted(async () => {
  if (partitionHash.value) {
    plans.value = await loadLibraryPlans(partitionHash.value);
  }
  isLoading.value = false;
});

const emit = defineEmits(['select', 'cancel']);
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
      <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h3 class="text-base font-bold text-slate-800">Select Plan to Reconcile</h3>
        <button @click="emit('cancel')" class="text-slate-400 hover:text-slate-600 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div class="p-4 max-h-[60vh] overflow-y-auto">
        <div v-if="isLoading" class="flex justify-center py-8">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500"></div>
        </div>
        
        <div v-else-if="plans.length === 0" class="text-center py-8">
          <p class="text-slate-500 text-sm">No plans found in your library.</p>
          <p class="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tight">Save a plan first to use reconciliation</p>
        </div>

        <div v-else class="space-y-2">
          <button v-for="plan in plans" :key="plan.id"
                  @click="selectPlan(plan)"
                  class="w-full text-left p-4 rounded-xl border transition-all group"
                  :class="isPlanBusy(plan)
                    ? 'border-amber-200 bg-amber-50/50 opacity-60 cursor-not-allowed'
                    : 'border-slate-100 hover:border-emerald-200 hover:bg-emerald-50'">
            <div class="flex items-center justify-between">
              <div class="font-bold text-slate-800 group-hover:text-emerald-900">{{ plan.name }}</div>
              <span v-if="isPlanBusy(plan)" class="px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-700 rounded font-black uppercase tracking-wider">
                Open in another tab
              </span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tight">
              {{ new Date(plan.timestamp).toLocaleDateString() }} at {{ new Date(plan.timestamp).toLocaleTimeString() }}
            </div>
          </button>
        </div>
      </div>

      <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
        <!-- Incomplete Only Toggle -->
        <div class="flex items-center gap-2">
          <label class="relative inline-flex items-center cursor-pointer group/toggle">
            <input v-model="actionsStore.showIncompleteOnly" type="checkbox" class="sr-only peer" />
            <div
              class="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500 transition-colors"
            ></div>
            <span
              class="ml-2 text-[8px] font-black text-slate-400 uppercase tracking-widest group-hover/toggle:text-slate-600 transition-colors"
              >Incomplete Only</span
            >
          </label>
        </div>

        <button @click="emit('cancel')" class="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 uppercase tracking-wider">
          Cancel
        </button>
      </div>
    </div>
  </div>

  <PlanAlreadyOpenWarning v-if="showAlreadyOpenWarning" @dismiss="showAlreadyOpenWarning = false" />
</template>
