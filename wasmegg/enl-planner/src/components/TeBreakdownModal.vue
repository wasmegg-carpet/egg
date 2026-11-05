<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="$emit('close')" />

      <!-- Dialog -->
      <div class="card-glass relative w-full max-w-sm overflow-hidden shadow-2xl rounded-2xl border border-white/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95">
        <div class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div class="p-1.5 bg-slate-100 rounded-lg text-slate-600">
            <img :src="iconURL('egginc/egg_truth.png', 64)" class="w-5 h-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" alt="Truth" />
          </div>
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">TE Breakdown</h3>
        </div>

        <div class="p-4 flex flex-col gap-2">
          <div
            v-for="stat in stats"
            :key="stat.id"
            class="flex items-center justify-between p-3 rounded-xl border transition-all"
            :class="{
              'bg-indigo-50/50 border-indigo-100 shadow-sm': stat.id === 'truth',
              'bg-white border-slate-100': stat.id !== 'truth'
            }"
          >
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm border border-slate-50 drop-shadow-sm">
                <img :src="stat.icon" class="w-6 h-6 object-contain" :alt="stat.name" />
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-black" :class="{ 'text-indigo-700': stat.id === 'truth', 'text-slate-700': stat.id !== 'truth' }">
                  {{ stat.name }}
                </span>
                <span class="text-[10px] text-slate-400 font-medium leading-tight">
                  {{ formatNumber(stat.delivered) }} delivered
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 font-mono-premium text-sm">
              <span class="text-slate-400">{{ stat.start }}</span>
              <span class="text-slate-300">→</span>
              <span class="font-bold" :class="{ 'text-indigo-900': stat.id === 'truth', 'text-slate-700': stat.id !== 'truth' }">
                {{ stat.end }}
              </span>
              <span
                class="ml-1 w-10 text-right font-black text-[10px]"
                :class="{
                  'text-indigo-600': stat.id === 'truth' && stat.delta > 0,
                  'text-emerald-500': stat.id !== 'truth' && stat.delta > 0,
                  'text-slate-300': stat.delta === 0
                }"
              >
                <template v-if="stat.delta > 0">+</template>{{ stat.delta }}
              </span>
            </div>
          </div>
        </div>

        <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            class="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all rounded-xl hover:shadow-sm"
            @click="$emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { formatNumber } from '@/lib/format';
import { iconURL } from 'lib';

export interface TeStat {
  id: string;
  name: string;
  start: number;
  end: number;
  delta: number;
  icon: string;
  delivered: number;
}

defineProps<{
  show: boolean;
  stats: TeStat[];
}>();

defineEmits<{ close: [] }>();
</script>

<style scoped>
.font-mono-premium { font-family: 'JetBrains Mono', 'Roboto Mono', monospace; }

.animate-in {
  animation-duration: 200ms;
}
</style>
