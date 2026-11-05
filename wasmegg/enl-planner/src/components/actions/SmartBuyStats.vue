<template>
  <div class="mt-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center gap-3">
    <span class="text-[10px] font-mono font-bold text-gray-600">
      {{ purchaseCount }} {{ purchaseCount === 1 ? 'purchase' : 'purchases' }}
    </span>
    <span class="text-gray-300">·</span>
    <span class="text-[10px] font-mono font-bold text-gray-600">{{ formatDuration(seconds) }}</span>
    <span class="text-gray-300">·</span>
    <span class="flex items-center gap-0.5">
      <span class="text-[10px] font-mono font-bold text-gray-600">{{ formatGemPrice(gems) }}</span>
      <img :src="iconURL('egginc/icon_virtue_gem.png', 64)" class="w-2.5 h-2.5 opacity-60" alt="gems" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import { formatDuration, formatGemPrice } from '@/lib/format';

// Purchase count / time / gems spent — the same three figures the note each Smart Buy button
// inserts into action history reports (`src/lib/actions/notes.ts`'s `build*NotePayload` functions),
// just shown live in the card itself before the button is ever clicked.
defineProps<{
  purchaseCount: number;
  seconds: number;
  gems: number;
}>();
</script>
