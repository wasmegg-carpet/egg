<template>
  <div class="card-premium p-4 mb-1 relative overflow-hidden">
    <div
      class="flex flex-col gap-3 transition-opacity duration-150"
      :class="{ 'opacity-30 pointer-events-none': loading }"
    >
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-slate-800">
          <div class="p-1 bg-brand-primary rounded shadow-sm text-white shrink-0">
            <slot name="icon" />
          </div>
          <span class="text-xs font-bold uppercase tracking-widest">{{ title }}</span>
        </div>
        <div
          v-if="badge"
          class="badge-premium transition-colors duration-300"
          :class="badgeActive ? 'badge-brand' : 'bg-slate-100 text-slate-500'"
        >
          {{ badge }}
        </div>
      </div>

      <!-- Description -->
      <p class="text-[11px] text-slate-700 leading-relaxed font-medium">
        <slot name="description" />
      </p>

      <!-- Body (input/buttons) -->
      <slot />

      <!-- Note -->
      <p v-if="note" class="text-[10px] text-slate-500 text-center px-2 leading-tight">
        {{ note }}
      </p>
    </div>

    <!-- Localized busy state: dims just this card (see `loading` prop doc comment) instead of the
         whole page locking up behind a full-screen overlay while its plan recomputes. -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
      <InlineSpinner class="w-5 h-5 text-blue-500" />
    </div>
  </div>
</template>

<script setup lang="ts">
import InlineSpinner from '@/components/InlineSpinner.vue';

defineProps<{
  title: string;
  badge?: string;
  badgeActive?: boolean;
  note?: string;
  /** Whether this card's own plan is currently (re)computing — dims its body and shows a small
   *  spinner confined to the card, rather than blocking the whole page. */
  loading?: boolean;
}>();
</script>
