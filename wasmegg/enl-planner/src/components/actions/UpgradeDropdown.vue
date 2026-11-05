<template>
  <div class="relative w-full" ref="containerRef">
    <!-- Selected Button -->
    <button
      type="button"
      class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-left shadow-sm focus:outline-none hover:bg-slate-100 transition-all group"
      @click="toggleOpen"
    >
      <div v-if="selectedOption" class="flex gap-3 items-center">
        <div class="w-10 h-10 bg-white rounded-lg shadow-sm border border-slate-100 flex-shrink-0 p-1.5 group-hover:scale-105 transition-transform">
          <img :src="iconURL(selectedOption.iconPath, 64)" class="w-full h-full object-contain" />
        </div>
        <div class="flex flex-col flex-1 min-w-0 justify-center">
          <span class="text-sm font-bold text-slate-900 truncate">{{ selectedOption.name }}</span>
          <div class="text-[10px] text-slate-500 truncate flex items-center mt-0.5 font-medium leading-none">
            <span v-if="selectedOption.capacity">{{ selectedOption.capacity }}</span>
            <span v-if="selectedOption.capacity && selectedOption.price !== undefined" class="mx-1.5">•</span>
            
            <template v-if="selectedOption.price !== undefined">
              <span>{{ formatGemPrice(selectedOption.price) }}</span>
              <img :src="iconURL('egginc/icon_virtue_gem.png', 64)" class="w-2.5 h-2.5 ml-0.5 opacity-80" />
            </template>
            
            <span v-if="(selectedOption.capacity || selectedOption.price !== undefined) && selectedOption.time" class="mx-1.5">•</span>
            <span v-if="selectedOption.time">{{ selectedOption.time }}</span>
            
            <span v-if="selectedOption.subtext">{{ selectedOption.subtext }}</span>
          </div>
        </div>
        <svg
          class="w-5 h-5 text-slate-400 flex-shrink-0 transition-transform duration-300"
          :class="{ 'rotate-180': isOpen }"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      <div v-else class="flex justify-between items-center text-slate-400 p-2">
        <span class="text-sm font-bold uppercase tracking-widest text-[10px]">{{ placeholder || 'Select upgrade...' }}</span>
        <svg
          class="w-5 h-5 transition-transform duration-300"
          :class="{ 'rotate-180': isOpen }"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </button>

    <!-- Dropdown Modal Context -->
    <div
      v-if="isOpen"
      class="absolute z-50 w-full sm:w-[450px] right-0 sm:right-auto sm:left-0 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in"
      :class="openUpward ? 'bottom-full mb-2 slide-in-from-bottom-2' : 'mt-2 slide-in-from-top-2'"
    >
      <div class="max-h-[60vh] overflow-y-auto custom-scrollbar divide-y divide-slate-50">
        <button
          v-for="opt in options"
          :key="opt.id"
          class="w-full text-left p-3 hover:bg-slate-50 transition-colors flex gap-3 items-start"
          :class="modelValue === opt.id ? 'bg-blue-50/30' : ''"
          @click="selectOption(opt.id)"
        >
          <div class="w-10 h-10 bg-white rounded-lg shadow-sm border border-slate-100 flex-shrink-0 p-1.5 mt-0.5 relative">
            <img :src="iconURL(opt.iconPath, 64)" class="w-full h-full object-contain" />
          </div>
          <div class="flex-1 min-w-0 flex flex-col justify-center">
            <div class="text-sm font-bold truncate" :class="modelValue === opt.id ? 'text-blue-700' : 'text-slate-900'">
              {{ opt.name }}
            </div>
            <div class="text-[10px] sm:text-xs text-slate-500 whitespace-normal flex flex-wrap items-center leading-relaxed mt-0.5 font-medium">
              <span v-if="opt.capacity">{{ opt.capacity }}</span>
              <span v-if="opt.capacity && opt.price !== undefined" class="mx-1.5">•</span>
              
              <template v-if="opt.price !== undefined">
                <span>{{ formatGemPrice(opt.price) }}</span>
                <img :src="iconURL('egginc/icon_virtue_gem.png', 64)" class="w-2.5 h-2.5 ml-0.5 opacity-80" />
              </template>
              
              <span v-if="(opt.capacity || opt.price !== undefined) && opt.time" class="mx-1.5">•</span>
              <span v-if="opt.time">{{ opt.time }}</span>
              
              <span v-if="opt.subtext">{{ opt.subtext }}</span>
            </div>
          </div>
          <div v-if="modelValue === opt.id" class="text-blue-500 flex-shrink-0 mt-2">
             <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
             </svg>
          </div>
        </button>

        <div v-if="options.length === 0" class="p-6 text-center text-sm font-bold text-slate-400 uppercase tracking-widest text-[10px]">
          No upgrades available
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { iconURL } from 'lib';
import { formatGemPrice } from '@/lib/format';

export interface UpgradeDropdownOption {
  id: string;
  name: string;
  iconPath: string;
  capacity?: string;
  price?: number;
  time?: string;
  subtext?: string;
}

const props = defineProps<{
  modelValue?: string;
  options: UpgradeDropdownOption[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [id: string];
}>();

const isOpen = ref(false);
const openUpward = ref(false);
const containerRef = ref<HTMLElement | null>(null);

function toggleOpen() {
  if (!isOpen.value && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    // PlanFinalSummary is ~80px tall; leave extra breathing room
    const spaceBelow = window.innerHeight - rect.bottom - 100;
    openUpward.value = spaceBelow < 420;
  }
  isOpen.value = !isOpen.value;
}

const selectedOption = computed(() => props.options.find(o => o.id === props.modelValue));

function selectOption(id: string) {
  emit('update:modelValue', id);
  isOpen.value = false;
}

function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', handleClickOutside));
</script>
