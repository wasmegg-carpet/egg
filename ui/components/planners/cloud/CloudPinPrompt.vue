<!--
  The PIN box for a locked cloud library, on one line: PIN, Open, "Remember this device", "Forgot PIN?" (which
  opens the replace dialog itself). Used by the Plan Library's cloud line and by the Chain Finder.
-->
<template>
  <form class="flex flex-wrap items-center gap-x-2 gap-y-1" @submit.prevent="open">
    <slot />
    <input
      v-if="cloud.state.pinType !== 'none'"
      v-model="pin"
      type="password"
      :inputmode="digits ? 'numeric' : 'text'"
      :maxlength="digits ? (cloud.state.pinType === 'pin4' ? 4 : 6) : undefined"
      :placeholder="digits ? 'PIN' : 'Password'"
      autocomplete="current-password"
      class="w-28 text-xs border-gray-300 rounded py-0.5 px-1.5 tracking-widest"
      :disabled="opening"
    />
    <button type="submit" class="font-semibold text-indigo-600 hover:underline disabled:opacity-40" :disabled="opening || (!pin && cloud.state.pinType !== 'none')">
      {{ opening ? 'Opening…' : 'Open' }}
    </button>
    <label class="flex items-center gap-1 text-slate-400" v-tippy="'Opens without the PIN next time. Don’t tick this on a shared computer.'">
      <input v-model="remember" type="checkbox" class="h-3 w-3 rounded border-gray-300 text-indigo-600" />
      Remember this device
    </label>
    <button type="button" class="ml-auto text-slate-400 hover:text-slate-600 hover:underline" @click="replacing = true">Forgot PIN?</button>
    <p v-if="error" class="basis-full text-red-600">{{ error }}</p>
  </form>
  <CloudPinDialog v-if="replacing" mode="replace" @close="replacing = false" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import CloudPinDialog from './CloudPinDialog.vue';

const cloud = useCloudLibrary();
const pin = ref('');
const remember = ref(false);
const error = ref('');
const replacing = ref(false);

const opening = computed(() => cloud.state.status === 'opening');
const digits = computed(() => cloud.state.pinType === 'pin6' || cloud.state.pinType === 'pin4');

async function open() {
  error.value = '';
  try {
    await cloud.unlock(cloud.state.pinType === 'none' ? '' : pin.value, remember.value);
    pin.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>
