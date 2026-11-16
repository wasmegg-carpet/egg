<!--
  Set a cloud library's PIN: creating the library, replacing it (a forgotten PIN), or changing the PIN.
  The PIN is typed twice, and the warnings say plainly what can't be undone.
-->
<template>
  <CloudDialog
    :title="titles[mode]"
    :confirm-label="confirmLabels[mode]"
    :variant="mode === 'replace' ? 'danger' : 'primary'"
    :disabled="!!problem"
    :busy="busy"
    :error="error"
    @confirm="submit"
    @cancel="$emit('close')"
  >
    <div class="space-y-4 text-sm text-slate-600">
      <p v-if="mode === 'create'">
        Your plans will be kept in the cloud and stay in sync on every device where you enter this EID.
      </p>

      <div v-if="mode === 'replace'" class="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 space-y-2">
        <p class="font-bold">This deletes your current cloud library.</p>
        <p>
          Every device where you've opened your cloud library keeps a backup copy of your plans, and each one
          uploads them to the new library the next time you open it there. A plan that's on none of your devices is
          lost. Anyone who knows your EID can do this, so if you didn't ask for it,
          don't continue.
        </p>
        <label class="flex items-start gap-2 font-medium">
          <input v-model="understood" type="checkbox" class="mt-0.5 rounded border-red-300 text-red-600" />
          I understand my current cloud library will be deleted.
        </label>
      </div>

      <div>
        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Protect it with</label>
        <select v-model="pinType" class="block w-full text-sm border-gray-300 rounded-md py-1.5">
          <option value="pin6">A 6-digit PIN (recommended)</option>
          <option value="pin4">A 4-digit PIN</option>
          <option value="password">A password</option>
          <option value="none">Nothing (not recommended)</option>
        </select>
      </div>

      <template v-if="pinType !== 'none'">
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{{ label }}</label>
          <input
            v-model="pin"
            type="password"
            :inputmode="digits ? 'numeric' : 'text'"
            :maxlength="digits ? length : undefined"
            autocomplete="new-password"
            class="block w-full text-sm border-gray-300 rounded-md py-1.5 tracking-widest"
          />
        </div>
        <div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{{ label }} again</label>
          <input
            v-model="pinAgain"
            type="password"
            :inputmode="digits ? 'numeric' : 'text'"
            :maxlength="digits ? length : undefined"
            autocomplete="new-password"
            class="block w-full text-sm border-gray-300 rounded-md py-1.5 tracking-widest"
            @keyup.enter="!problem && submit()"
          />
          <p v-if="hint" class="mt-1 text-[11px] text-slate-400">{{ hint }}</p>
        </div>
        <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span class="font-bold">Write your {{ digits ? 'PIN' : 'password' }} down.</span>
          It can't be recovered by anyone. If you forget it, you can reset your cloud library with a new
          {{ digits ? 'PIN' : 'password' }}. Every device where you've opened your cloud library keeps a backup copy
          of your plans, and each one uploads them to the new library the next time you open it there.
        </p>
      </template>
      <p v-else class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Without a PIN, anyone who knows your EID can open and change your cloud library.
      </p>

      <label v-if="mode !== 'change'" class="flex items-start gap-2 text-xs">
        <input v-model="remember" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600" />
        <span>Remember this device, so it opens without the PIN. <span class="text-slate-400">Don't tick this on a shared computer.</span></span>
      </label>
      <p v-else class="text-xs text-slate-400">Your other devices will ask for the new {{ digits ? 'PIN' : 'password' }} next time.</p>
    </div>
  </CloudDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { pinProblem, type PinType } from 'lib/cloud/crypto';
import { useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import CloudDialog from './CloudDialog.vue';

const props = defineProps<{ mode: 'create' | 'replace' | 'change' }>();
const emit = defineEmits<{ close: []; done: [] }>();

const cloud = useCloudLibrary();
const titles = { create: 'Set up your cloud library', replace: 'Replace your cloud library', change: 'Change your PIN' };
const confirmLabels = { create: 'Set up', replace: 'Replace', change: 'Change PIN' };

const pinType = ref<PinType>(props.mode === 'change' ? cloud.state.pinType : 'pin6');
const pin = ref('');
const pinAgain = ref('');
const remember = ref(false);
const understood = ref(false);
const busy = ref(false);
const error = ref('');

watch(pinType, () => {
  pin.value = '';
  pinAgain.value = '';
});

const digits = computed(() => pinType.value === 'pin6' || pinType.value === 'pin4');
const length = computed(() => (pinType.value === 'pin4' ? 4 : 6));
const label = computed(() => (digits.value ? `${length.value}-digit PIN` : 'Password'));
const hint = computed(() => (pin.value && pinType.value !== 'none' ? pinProblem(pinType.value, pin.value) : ''));
const problem = computed(() => {
  if (props.mode === 'replace' && !understood.value) return 'confirm';
  if (pinType.value === 'none') return '';
  return pinProblem(pinType.value, pin.value) ?? (pin.value !== pinAgain.value ? 'The two entries don’t match.' : '');
});

watch(pinAgain, value => {
  error.value = value && value.length >= pin.value.length && value !== pin.value ? 'The two entries don’t match.' : '';
});

async function submit() {
  if (problem.value) return;
  busy.value = true;
  error.value = '';
  try {
    const value = pinType.value === 'none' ? '' : pin.value;
    if (props.mode === 'change') await cloud.changePin(pinType.value, value);
    else await cloud.create(pinType.value, value, remember.value, props.mode === 'replace');
    emit('done');
    emit('close');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>
