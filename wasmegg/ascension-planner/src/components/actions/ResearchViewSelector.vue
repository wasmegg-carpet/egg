<template>
  <div class="flex flex-col gap-2 mb-4" ref="containerRef">
    <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Sort Research By</div>
    <div class="relative">
      <button
        @click="open = !open"
        class="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-bold text-gray-800 bg-white border-2 rounded-lg shadow-sm transition-colors"
        :class="open ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-indigo-300 hover:border-indigo-400'"
      >
        <span>{{ selectedLabel }}</span>
        <ChevronDownIcon class="w-5 h-5 text-indigo-500 transition-transform" :class="{ 'rotate-180': open }" />
      </button>

      <div
        v-if="open"
        class="absolute z-10 mt-1 w-full py-1 bg-white rounded-lg shadow-lg border border-gray-100 overflow-hidden"
      >
        <button
          v-for="v in views"
          :key="v.id"
          @click="select(v.id)"
          class="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors"
          :class="modelValue === v.id ? 'bg-blue-50' : 'hover:bg-gray-50'"
        >
          <span class="text-sm font-medium" :class="modelValue === v.id ? 'text-blue-600' : 'text-gray-700'">
            {{ v.label }}
          </span>
          <span v-if="v.description" class="text-xs text-gray-400">{{ v.description }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ChevronDownIcon } from '@heroicons/vue/solid';
import { type ViewType } from '@/composables/useResearchViews';

const props = defineProps<{
  modelValue: ViewType;
  views: readonly { id: ViewType; label: string; description?: string }[];
}>();
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const containerRef = ref<HTMLElement | null>(null);

const selectedLabel = computed(() => props.views.find(v => v.id === props.modelValue)?.label ?? '');

function select(id: ViewType) {
  emit('update:modelValue', id);
  open.value = false;
}

function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
});
</script>
