<!-- Make a share link for one plan, or for a Chain Finder table. -->
<template>
  <CloudDialog
    :title="table ? 'Share a table' : 'Share a plan'"
    :confirm-label="record ? '' : 'Create link'"
    :cancel-label="record ? 'Done' : 'Cancel'"
    :busy="busy"
    :error="error"
    @confirm="create"
    @cancel="$emit('close')"
  >
    <div class="space-y-4 text-sm text-slate-600">
      <p>
        <template v-if="table">
          Anyone with the link can use a copy of your Chain Finder table
          <span class="font-semibold text-slate-800">{{ table.name }}</span>, and keep it as their own. The link doesn't
          reveal your EID.
        </template>
        <template v-else>
          Anyone with the link can import a copy of <span class="font-semibold text-slate-800">{{ plan?.name }}</span>
          into their own library. The link doesn't reveal your EID.
        </template>
      </p>

      <fieldset v-if="!record" class="space-y-2">
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="kind" type="radio" value="once" class="mt-1 text-indigo-600" />
          <span><span class="font-medium text-slate-800">One-time link</span><br /><span class="text-xs text-slate-400">Works once, for one person, then stops.</span></span>
        </label>
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="kind" type="radio" value="multi" class="mt-1 text-indigo-600" />
          <span><span class="font-medium text-slate-800">Reusable link</span><br /><span class="text-xs text-slate-400">Anyone with it can import it, until it expires.</span></span>
        </label>
      </fieldset>

      <div v-else class="space-y-2">
        <div class="flex gap-2">
          <input :value="record.link" readonly class="block w-full text-xs border-gray-300 rounded-md py-1.5 font-mono" @focus="($event.target as HTMLInputElement).select()" />
          <button class="px-3 py-1.5 text-xs font-bold rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50 whitespace-nowrap" @click="copy">
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <p class="text-xs text-slate-400">
          {{ record.kind === 'once' ? 'One-time link' : 'Reusable link' }}, expires {{ new Date(record.expires).toLocaleDateString() }}.
          You can revoke it from the cloud menu (Share links).
        </p>
      </div>
    </div>
  </CloudDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ShareKind } from 'lib/cloud/api';
import type { ShareRecord } from 'lib/cloud/library';
import type { LocalPlan } from 'lib/cloud/sync';
import type { SharedTableMeta } from 'lib/cloud/share';
import { useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import CloudDialog from './CloudDialog.vue';

const props = defineProps<{ plan?: LocalPlan; table?: { name: string; bytes: Uint8Array } & SharedTableMeta }>();
defineEmits<{ close: [] }>();

const cloud = useCloudLibrary();
const kind = ref<ShareKind>('once');
const record = ref<ShareRecord | null>(null);
const busy = ref(false);
const error = ref('');
const copied = ref(false);

async function create() {
  busy.value = true;
  error.value = '';
  try {
    if (props.table) record.value = await cloud.shareTable(props.table, kind.value);
    else if (props.plan) record.value = await cloud.share(props.plan, kind.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function copy() {
  if (!record.value) return;
  try {
    await navigator.clipboard.writeText(record.value.link);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    error.value = 'Couldn’t copy; select the link and copy it.';
  }
}
</script>
