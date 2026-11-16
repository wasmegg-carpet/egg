<!--
  The player's custom table in the Chain Finder: pick it or the default, download / share / remove it, save a
  table loaded by hand as it, and import one from a share link. Shows nothing for players without a cloud
  library, except a pointer to set one up after loading a table by hand.
-->
<template>
  <div v-if="visible" class="mt-2 space-y-1.5 text-[11px] text-slate-500">
    <!-- Locked: the saved table is behind the PIN -->
    <CloudPinPrompt v-if="cloud.libraryLocked.value && cloud.state.status !== 'checking'">
      <span class="font-bold text-slate-600">Cloud library:</span>
      <span>enter your PIN to use your saved table</span>
    </CloudPinPrompt>

    <!-- Open, with a saved table: choose, and manage it -->
    <div v-if="ready && custom.entry.value" class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="font-bold text-slate-600">Search with</span>
      <div class="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
        <button
          class="px-2 py-0.5 rounded font-bold"
          :class="!custom.usingCustom.value && !custom.state.handPicked ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'"
          :disabled="!!custom.state.busy"
          @click="custom.useDefault()"
        >
          Default table
        </button>
        <button
          class="px-2 py-0.5 rounded font-bold"
          :class="custom.usingCustom.value ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'"
          :disabled="!!custom.state.busy"
          :title="custom.entry.value.name"
          @click="custom.useCustom()"
        >
          Your table · TE {{ custom.entry.value.from }}–{{ custom.entry.value.to }}{{ custom.entry.value.silo ? ' · silo' : '' }}
        </button>
      </div>
      <button class="font-bold text-emerald-700 hover:underline disabled:opacity-40" :disabled="!!custom.state.busy" @click="custom.download()">Download</button>
      <button class="font-bold text-emerald-700 hover:underline disabled:opacity-40" :disabled="!!custom.state.busy" @click="openShare">Share</button>
      <button class="font-bold text-red-600 hover:underline disabled:opacity-40" :disabled="!!custom.state.busy" @click="confirm = 'remove'">Remove</button>
    </div>

    <!-- A table put in by hand: offer to keep it -->
    <div v-if="custom.canSavePicked.value" class="flex flex-wrap items-center gap-2">
      <template v-if="ready">
        <button class="font-bold text-emerald-700 hover:underline disabled:opacity-40" :disabled="!!custom.state.busy" @click="custom.entry.value ? (confirm = 'replace') : custom.savePicked()">
          {{ custom.entry.value ? 'Replace your saved table with this one' : 'Save this table to your cloud library' }}
        </button>
        <span class="text-slate-400">so it's here on every device</span>
      </template>
      <span v-else-if="cloud.state.status === 'none'" class="text-slate-400">
        To keep this table on every device, set up a cloud library in the Manual Planner's Plan Library.
      </span>
    </div>

    <p v-if="custom.state.busy === 'saving'" class="text-slate-400">Saving your table…</p>
    <p v-else-if="custom.state.busy === 'loading' && !custom.usingCustom.value && custom.entry.value" class="text-slate-400">Loading your table…</p>
    <p v-if="custom.state.error" class="text-red-600">{{ custom.state.error }}</p>
  </div>

  <CloudDialog
    v-if="confirm === 'replace'"
    title="Replace your saved table"
    confirm-label="Replace"
    variant="danger"
    :busy="custom.state.busy === 'saving'"
    @confirm="replaceConfirmed"
    @cancel="confirm = null"
  >
    <p class="text-sm text-slate-600">
      Your cloud library keeps one table. This replaces
      <span class="font-semibold text-slate-800">{{ custom.entry.value?.name }}</span>
      (TE {{ custom.entry.value?.from }}–{{ custom.entry.value?.to }}) with
      <span class="font-semibold text-slate-800">{{ custom.state.picked?.name }}</span>, on all your devices.
    </p>
  </CloudDialog>

  <CloudDialog
    v-if="confirm === 'remove'"
    title="Remove your saved table"
    confirm-label="Remove"
    variant="danger"
    :busy="custom.state.busy === 'deleting'"
    @confirm="removeConfirmed"
    @cancel="confirm = null"
  >
    <p class="text-sm text-slate-600">
      This removes <span class="font-semibold text-slate-800">{{ custom.entry.value?.name }}</span> from your cloud
      library, on all your devices. Download it first if you want to keep a copy.
    </p>
  </CloudDialog>

  <CloudShareDialog v-if="sharing" :table="sharing" @close="sharing = null" />

  <!-- Opened with a share link to a table -->
  <CloudDialog
    v-if="incomingTable"
    title="Shared table"
    :confirm-label="incomingTable.info ? 'Use it' : ''"
    :cancel-label="incomingTable.info ? 'Not now' : 'Close'"
    :busy="importing"
    :error="importError"
    @confirm="importShared"
    @cancel="incoming.clear()"
  >
    <div v-if="incomingTable.info" class="space-y-3 text-sm text-slate-600">
      <p>
        Someone shared a Chain Finder table with you:
        <span class="font-semibold text-slate-800">{{ incomingTable.info.name }}</span>
        <template v-if="incomingTable.info.table">
          (start TEs {{ incomingTable.info.table.from }}–{{ incomingTable.info.table.to }}{{ incomingTable.info.table.silo ? ', silo mode' : '' }})</template
        >.
        <template v-if="incomingTable.info.kind === 'once'"> This is a one-time link: once used, it stops working.</template>
      </p>
      <label v-if="ready" class="flex items-start gap-2 text-xs">
        <input v-model="saveImported" type="checkbox" class="mt-0.5 rounded border-gray-300 text-emerald-600" />
        <span>
          Also save it as your table{{ custom.entry.value ? `, replacing ${custom.entry.value.name}` : '' }}.
        </span>
      </label>
      <p v-else class="text-xs text-slate-400">
        You can search with it now. To keep it, set up a cloud library in the Manual Planner's Plan Library
        {{ cloud.libraryLocked.value ? '(or open yours with your PIN)' : '' }} first.
      </p>
    </div>
    <p v-else-if="!incoming.state.error" class="text-sm text-slate-600">This share link has expired, was revoked, or was already used.</p>
  </CloudDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { claimTableShare, type SharedTableMeta } from 'lib/cloud/share';
import { useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import { useIncomingShare } from 'lib/planners/composables/useIncomingShare';
import CloudDialog from 'ui/components/planners/cloud/CloudDialog.vue';
import CloudPinPrompt from 'ui/components/planners/cloud/CloudPinPrompt.vue';
import CloudShareDialog from 'ui/components/planners/cloud/CloudShareDialog.vue';
import { useCustomTable } from '@/composables/useCustomTable';

const cloud = useCloudLibrary();
const custom = useCustomTable();
custom.autoLoad();

const ready = computed(() => cloud.state.status === 'ready');
const visible = computed(
  () => cloud.libraryLocked.value || ready.value || (custom.canSavePicked.value && cloud.state.status === 'none') || !!custom.state.error
);

const confirm = ref<null | 'replace' | 'remove'>(null);
const sharing = ref<({ name: string; bytes: Uint8Array } & SharedTableMeta) | null>(null);

async function replaceConfirmed() {
  await custom.savePicked();
  confirm.value = null;
}

async function removeConfirmed() {
  await custom.remove();
  confirm.value = null;
}

async function openShare() {
  const entry = custom.entry.value;
  if (!entry) return;
  const bytes = await custom.customBytes();
  if (bytes) sharing.value = { name: entry.name, bytes, from: entry.from, to: entry.to, delivery: entry.delivery, silo: entry.silo };
}

// ---- A table share link ----
const incoming = useIncomingShare(cloud.api);
const incomingTable = computed(() => {
  const s = incoming.state;
  if (!s.link || !s.checked) return null;
  if (s.info && s.info.content !== 'table') return null;
  return { info: s.info };
});
const saveImported = ref(true);
const importing = ref(false);
const importError = ref('');

async function importShared() {
  const info = incomingTable.value?.info;
  if (!info) return;
  importing.value = true;
  importError.value = '';
  try {
    const bytes = await claimTableShare(cloud.api, incoming.state.link);
    if (!bytes) {
      importError.value = 'This share link has expired, was revoked, or was already used.';
      return;
    }
    await custom.pickShared(info.name, bytes);
    if (ready.value && saveImported.value) await custom.savePicked();
    incoming.clear();
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
  }
}
</script>
