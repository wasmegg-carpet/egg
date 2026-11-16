<!--
  The cloud library's line in the Plan Library. Stays small: a one-line offer when there's no library, the PIN
  prompt straight away when there is one, and once everything is synced just "Synced" and a menu.
-->
<template>
  <div v-if="visible" class="border-b border-gray-100 px-4 py-1.5 text-[11px] text-slate-500">
    <!-- No library yet -->
    <div v-if="status === 'none'" class="flex items-center gap-2">
      <CloudIcon />
      <span class="flex-1">Keep your plans in sync on every device.</span>
      <button class="font-semibold text-indigo-600 hover:underline" @click="dialog = 'create'">Set up cloud library</button>
      <button class="text-slate-300 hover:text-slate-500" aria-label="Hide" v-tippy="'Hide this'" @click="dismissOffer">×</button>
    </div>

    <!-- Library exists: ask for the PIN right away -->
    <form v-else-if="status === 'locked' || (status === 'opening' && !cloud.library.value)" class="flex flex-wrap items-center gap-x-2 gap-y-1" @submit.prevent="open">
      <CloudIcon />
      <span>Your cloud library</span>
      <template v-if="cloud.state.pinType !== 'none'">
        <input
          v-model="pin"
          type="password"
          :inputmode="digits ? 'numeric' : 'text'"
          :maxlength="digits ? (cloud.state.pinType === 'pin4' ? 4 : 6) : undefined"
          :placeholder="digits ? 'PIN' : 'Password'"
          autocomplete="current-password"
          class="w-28 text-xs border-gray-300 rounded py-0.5 px-1.5 tracking-widest"
          :disabled="status === 'opening'"
        />
      </template>
      <button type="submit" class="font-semibold text-indigo-600 hover:underline disabled:opacity-40" :disabled="status === 'opening' || (!pin && cloud.state.pinType !== 'none')">
        {{ status === 'opening' ? 'Opening…' : 'Open' }}
      </button>
      <label class="flex items-center gap-1 text-slate-400" v-tippy="'Opens without the PIN next time. Don’t tick this on a shared computer.'">
        <input v-model="remember" type="checkbox" class="h-3 w-3 rounded border-gray-300 text-indigo-600" />
        Remember this device
      </label>
      <button type="button" class="ml-auto text-slate-400 hover:text-slate-600 hover:underline" @click="dialog = 'replace'">Forgot PIN?</button>
      <p v-if="error" class="basis-full text-red-600">{{ error }}</p>
    </form>

    <!-- Open -->
    <div v-else-if="status === 'ready'" class="flex items-center gap-2">
      <CloudIcon :class="cloud.state.error ? 'text-amber-500' : 'text-indigo-400'" />
      <span v-if="cloud.state.syncing">Syncing…</span>
      <span v-else-if="cloud.state.error" class="text-amber-700">{{ cloud.state.error }}</span>
      <span v-else-if="pending">{{ pending }} {{ pending === 1 ? 'change' : 'changes' }} waiting to sync</span>
      <span v-else>Synced</span>
      <button v-if="cloud.state.error" class="font-semibold text-indigo-600 hover:underline" @click="cloud.syncNow()">Retry</button>
      <div class="relative ml-auto">
        <button class="px-1 text-slate-400 hover:text-slate-600" aria-label="Cloud library menu" v-tippy="'Cloud library'" @click="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="absolute right-0 z-20 mt-1 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg text-xs text-slate-700" @click="menuOpen = false">
          <button class="block w-full px-3 py-1.5 text-left hover:bg-gray-50" @click="dialog = 'shares'">Share links</button>
          <button class="block w-full px-3 py-1.5 text-left hover:bg-gray-50" @click="dialog = 'change'">Change PIN</button>
          <button v-if="cloud.state.remembered" class="block w-full px-3 py-1.5 text-left hover:bg-gray-50" @click="cloud.forget()">Forget this device</button>
          <button class="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50" @click="dialog = 'delete'">Delete cloud library…</button>
        </div>
      </div>
    </div>

    <!-- Connecting / unreachable -->
    <div v-else-if="status === 'checking' || status === 'opening'" class="flex items-center gap-2 text-slate-400"><CloudIcon /> Connecting to your cloud library…</div>
    <div v-else-if="status === 'unavailable'" class="flex items-center gap-2 text-slate-400">
      <CloudIcon /> <span class="flex-1">{{ cloud.state.error || 'The cloud library is unavailable.' }}</span>
      <button class="font-semibold text-indigo-600 hover:underline" @click="$emit('retry')">Retry</button>
    </div>
  </div>

  <CloudPinDialog v-if="dialog === 'create' || dialog === 'replace' || dialog === 'change'" :mode="dialog" @close="dialog = null" />
  <CloudSharesDialog v-if="dialog === 'shares'" @close="dialog = null" />
  <CloudDialog
    v-if="dialog === 'delete'"
    title="Delete cloud library"
    confirm-label="Delete"
    variant="danger"
    :busy="busy"
    :error="error"
    @confirm="deleteLibrary"
    @cancel="dialog = null"
  >
    <p class="text-sm text-slate-600">
      This deletes your cloud library and every plan in it, on all your devices, and stops your share links from
      working. Plans saved in this browser stay here.
    </p>
  </CloudDialog>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref } from 'vue';
import type { LocalPlan } from 'lib/cloud/sync';
import { useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import CloudDialog from './CloudDialog.vue';
import CloudPinDialog from './CloudPinDialog.vue';
import CloudSharesDialog from './CloudSharesDialog.vue';

const props = defineProps<{ plans: LocalPlan[] }>();
defineEmits<{ retry: [] }>();

const CloudIcon = defineComponent({
  setup: () => () =>
    h('svg', { class: 'w-3.5 h-3.5 shrink-0', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
      h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' }),
    ]),
});

const cloud = useCloudLibrary();
const status = computed(() => cloud.state.status);
const pin = ref('');
const remember = ref(false);
const error = ref('');
const busy = ref(false);
const menuOpen = ref(false);
const dialog = ref<null | 'create' | 'replace' | 'change' | 'shares' | 'delete'>(null);

const DISMISS_KEY = 'wasmegg-cloud-offer-dismissed';
const offerDismissed = ref(readDismissed());

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissOffer() {
  offerDismissed.value = true;
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // storage blocked: hidden for this visit only
  }
}

const digits = computed(() => cloud.state.pinType === 'pin6' || cloud.state.pinType === 'pin4');
const pending = computed(() => props.plans.filter(p => cloud.planState(p) === 'pending').length);
const visible = computed(() => status.value !== 'off' && !(status.value === 'none' && offerDismissed.value));

async function open() {
  error.value = '';
  try {
    await cloud.unlock(cloud.state.pinType === 'none' ? '' : pin.value, remember.value);
    pin.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function deleteLibrary() {
  busy.value = true;
  error.value = '';
  try {
    await cloud.deleteLibrary();
    dialog.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>
