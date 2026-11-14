<template>
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
  <!-- TE Modal -->
  <TeBreakdownModal :show="showTeModal" :stats="teStatsList" @close="showTeModal = false" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { type CalculationsSnapshot, type VirtueEgg } from '@/types';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { formatNumber } from '@/lib/format';
import TeBreakdownModal from '@/components/TeBreakdownModal.vue';

const actionsStore = useActionsStore();
const initialStateStore = useInitialStateStore();
const showTeModal = ref(false);

const calculateTotalPotentialTE = (snapshot: CalculationsSnapshot) => {
  if (!snapshot || !snapshot.eggsDelivered) return 0;
  return Object.values(snapshot.eggsDelivered).reduce((sum: number, delivered: number) => {
    return sum + countTEThresholdsPassed(delivered);
  }, 0);
};

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
</script>
