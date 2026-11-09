<template>
  <div
    v-if="loading || error || remoteEggs.length"
    class="mb-4 rounded-2xl border border-slate-100 bg-white/95 backdrop-blur-xl shadow-sm overflow-hidden"
  >
    <button
      class="w-full flex items-center justify-between px-4 py-2.5 text-left"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
        Custom Egg Watch (GitHub)
        <span
          v-if="newEggs.length"
          class="px-1.5 py-0.5 rounded-md bg-emerald-500 text-white text-[9px] tracking-wider"
        >
          {{ newEggs.length }} new
        </span>
      </span>
      <svg
        class="w-3.5 h-3.5 text-slate-400 transition-transform duration-300"
        :class="{ 'rotate-180': expanded }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div v-if="expanded" class="px-4 pb-3 border-t border-slate-100">
      <div v-if="loading" class="text-xs text-slate-400 py-2">Checking GitHub for custom egg updates…</div>
      <div v-else-if="error" class="text-xs text-red-500 py-2">{{ error }}</div>
      <template v-else>
        <!-- Mobile: stacked cards, no horizontal scroll -->
        <div class="sm:hidden divide-y divide-slate-100 mt-1">
          <div
            v-for="egg in remoteEggs"
            :key="egg.identifier"
            class="py-2 px-1.5 rounded-md"
            :class="isNew(egg.identifier) ? 'bg-emerald-50' : ''"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium text-slate-700 text-xs truncate">
                  {{ egg.name }}
                  <span v-if="isNew(egg.identifier)" class="ml-1 text-[9px] font-black uppercase text-emerald-600"
                    >New</span
                  >
                </div>
                <div class="text-[9px] text-slate-400 font-mono truncate">{{ egg.identifier }}</div>
              </div>
              <div class="text-[9px] font-black uppercase tracking-widest text-slate-400 text-right shrink-0">
                {{ effectName(egg) }}
              </div>
            </div>
            <div class="grid grid-cols-4 gap-1 mt-1.5">
              <div
                v-for="i in 4"
                :key="i"
                class="bg-slate-50 rounded-md py-1 text-center"
                :class="egg.buffs[i - 1] ? '' : 'opacity-40'"
              >
                <div class="text-[8px] text-slate-400 font-black">L{{ i }}</div>
                <div class="text-[10px] font-mono font-semibold text-slate-700">
                  {{ egg.buffs[i - 1] ? formatMultiplier(egg.buffs[i - 1].value) : '—' }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Desktop / tablet: table -->
        <div class="hidden sm:block overflow-x-auto">
          <table class="w-full mt-1 text-xs border-collapse">
            <thead>
              <tr class="text-[9px] font-black uppercase tracking-widest text-slate-400">
                <th class="text-left py-1.5 px-2">Egg</th>
                <th class="text-left py-1.5 px-2">Effect</th>
                <th class="text-right py-1.5 px-2">L1</th>
                <th class="text-right py-1.5 px-2">L2</th>
                <th class="text-right py-1.5 px-2">L3</th>
                <th class="text-right py-1.5 px-2">L4</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="egg in remoteEggs"
                :key="egg.identifier"
                :class="isNew(egg.identifier) ? 'bg-emerald-50' : ''"
              >
                <td class="py-1.5 px-2 font-medium text-slate-700 whitespace-nowrap">
                  {{ egg.name }}
                  <span v-if="isNew(egg.identifier)" class="ml-1 text-[9px] font-black uppercase text-emerald-600"
                    >New</span
                  >
                  <div class="text-[9px] text-slate-400 font-mono font-normal">{{ egg.identifier }}</div>
                </td>
                <td class="py-1.5 px-2 text-slate-500 whitespace-nowrap">{{ effectName(egg) }}</td>
                <td
                  v-for="i in 4"
                  :key="i"
                  class="py-1.5 px-2 text-right font-mono whitespace-nowrap"
                  :class="egg.buffs[i - 1] ? 'text-slate-700' : 'text-slate-300'"
                >
                  {{ egg.buffs[i - 1] ? formatMultiplier(egg.buffs[i - 1].value) : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ei, decodeMessage, customEggs } from 'lib';

interface RemoteCustomEggBuff {
  dimension: number;
  value: number;
}

interface RemoteCustomEgg {
  identifier: string;
  name: string;
  buffs: RemoteCustomEggBuff[];
}

const REMOTE_URL = 'https://raw.githubusercontent.com/carpetsage/egg/refs/heads/main/periodicals/data/customeggs.json';

const remoteEggs = ref<RemoteCustomEgg[]>([]);
const loading = ref(true);
const error = ref('');
const expanded = ref(false);

const localIdentifiers = new Set(customEggs.map(egg => egg.identifier));

function isNew(identifier: string): boolean {
  return !localIdentifiers.has(identifier);
}

function effectName(egg: RemoteCustomEgg): string {
  if (egg.buffs.length === 0) return 'Unknown';
  const name = ei.GameModifier.GameDimension[egg.buffs[0].dimension];
  return name ? name.replace(/_/g, ' ') : 'Unknown';
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}

const newEggs = computed(() => remoteEggs.value.filter(egg => isNew(egg.identifier)));

onMounted(async () => {
  try {
    const response = await fetch(REMOTE_URL);
    if (!response.ok) throw new Error(`Failed to fetch customeggs.json (${response.status})`);
    const raw: string[] = await response.json();

    const decoded: RemoteCustomEgg[] = [];
    for (const entry of raw) {
      try {
        const ce = decodeMessage(ei.CustomEgg, entry, false) as ei.ICustomEgg;
        if (ce.identifier && ce.name) {
          decoded.push({
            identifier: ce.identifier,
            name: ce.name,
            buffs: (ce.buffs ?? []).map(b => ({ dimension: b.dimension ?? 0, value: b.value ?? 1 })),
          });
        }
      } catch (e) {
        console.error('Failed to decode a custom egg entry from GitHub', e);
      }
    }

    remoteEggs.value = decoded;
    expanded.value = decoded.some(egg => isNew(egg.identifier));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to fetch custom eggs from GitHub';
    console.error('Error fetching remote custom eggs:', e);
  } finally {
    loading.value = false;
  }
});
</script>
