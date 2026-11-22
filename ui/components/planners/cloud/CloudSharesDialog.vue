<!-- The player's share links: which still work, copy again, revoke, clear out the used ones. -->
<template>
  <CloudDialog title="Your share links" cancel-label="Close" :error="error" @cancel="$emit('close')">
    <div class="text-sm text-slate-600">
      <div v-if="loading" class="flex justify-center py-4">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500"></div>
      </div>
      <p v-else-if="shares.length === 0" class="text-slate-400">You haven't shared any plans.</p>
      <ul v-else class="divide-y divide-slate-100 max-h-72 overflow-y-auto -mx-2">
        <li v-for="s in shares" :key="s.id" class="flex items-center gap-2 px-2 py-2">
          <div class="flex-1 min-w-0">
            <p class="truncate font-medium text-slate-800" :title="s.name">{{ s.name }}</p>
            <p class="text-[11px] text-slate-400">
              {{ s.kind === 'once' ? 'One-time' : 'Reusable' }} ·
              <span :class="s.live ? 'text-green-600' : ''">{{ s.live ? `works until ${new Date(s.expires).toLocaleDateString()}` : s.kind === 'once' && s.expires > Date.now() ? 'used' : 'expired' }}</span>
            </p>
          </div>
          <button v-if="s.live" class="text-xs text-indigo-600 hover:underline" @click="copy(s.link)">Copy</button>
          <button v-if="s.live" class="text-xs text-red-600 hover:underline" @click="revoke(s.id)">Revoke</button>
        </li>
      </ul>
      <button v-if="shares.some(s => !s.live)" class="mt-3 text-xs text-slate-500 hover:text-slate-700 underline" @click="clearUsed">
        Clear used and expired links
      </button>
    </div>
  </CloudDialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ShareRecord } from 'lib/cloud/library';
import { cloudMessage, useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import CloudDialog from './CloudDialog.vue';

defineEmits<{ close: [] }>();

const cloud = useCloudLibrary();
const shares = ref<(ShareRecord & { live: boolean })[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  try {
    shares.value = (await cloud.listShares()).sort((a, b) => b.created - a.created);
  } catch (err) {
    error.value = cloudMessage(err);
  } finally {
    loading.value = false;
  }
}

async function revoke(id: string) {
  try {
    await cloud.revokeShare(id);
    await load();
  } catch (err) {
    error.value = cloudMessage(err);
  }
}

async function clearUsed() {
  try {
    await cloud.forgetUsedShares();
    await load();
  } catch (err) {
    error.value = cloudMessage(err);
  }
}

async function copy(link: string) {
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    error.value = 'Couldn’t copy the link.';
  }
}

onMounted(load);
</script>
