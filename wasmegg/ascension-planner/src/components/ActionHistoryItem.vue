<template>
  <div
    :id="action.id"
    class="transition-colors"
    :class="[
      compact ? 'px-2 py-0.5 flex items-center' : 'px-3 sm:px-5 py-2 sm:py-3 flex flex-col gap-1',
      isStartAction
        ? compact
          ? 'bg-slate-50/80 border-l-2 border-brand-primary'
          : 'bg-slate-50/80 border-l-4 border-brand-primary'
        : 'hover:bg-slate-50/50',
    ]"
  >
    <!-- Top Row: Icon, Name, Time, Recon, Undo -->
    <div class="flex items-center w-full" :class="compact ? 'gap-1.5' : 'gap-2 sm:gap-3'">
      <!-- Action Icon (Small) -->
      <div
        v-if="actionIconPath"
        class="flex-shrink-0 border border-slate-100 shadow-inner overflow-hidden flex items-center justify-center"
        :class="[
          compact ? 'h-4 p-0' : 'h-6 p-0.5',
          isVehicleAction
            ? compact
              ? 'w-auto min-w-[1rem] rounded-lg'
              : 'w-auto min-w-[1.5rem] rounded-lg'
            : compact
              ? 'w-4 rounded-full'
              : 'w-6 rounded-full',
          isMissionAction || actionIconPath === 'egginc-extras/icon_research_sale.png'
            ? 'bg-slate-900 shadow-lg'
            : 'bg-white shadow-sm',
        ]"
      >
        <img
          :src="actionIconPath.startsWith('static/') ? `${baseUrl}${actionIconPath}` : iconURL(actionIconPath, 64)"
          :class="isVehicleAction ? 'h-[7px] w-auto min-w-[2rem] object-contain' : 'w-full h-full object-contain'"
          :alt="action.type"
        />
      </div>

      <!-- Name -->
      <div
        class="flex-1 min-w-0 font-bold truncate flex items-center gap-1.5"
        :class="[compact ? 'text-[10px]' : 'text-xs sm:text-sm', isStartAction ? 'text-slate-800' : 'text-slate-700']"
      >
        <span v-if="eggType" class="text-[9px] uppercase font-black text-slate-400 tracking-widest">
          {{ action.type === 'start_ascension' ? 'Start:' : 'Egg:' }}
        </span>
        <span :class="{ 'text-slate-900': eggType }">
          {{ eggName || displayName }}{{ isContinued ? ' (continued)' : '' }}
        </span>
      </div>

      <!-- Time Section -->
      <div v-if="!isStartAction" class="flex flex-col items-end shrink-0">
        <span
          v-if="savingDuration > 0 || (isPurchaseAction && action.cost > 0)"
          v-tippy="timeToSaveTitle"
          class="text-[8px] font-black text-rose-500 uppercase tracking-widest"
        >
          Save {{ savingDurationFormatted }}
        </span>
        <span
          v-if="waitDuration > 0"
          v-tippy="timeToSaveTitle"
          class="text-[8px] font-black text-slate-400 uppercase tracking-widest"
        >
          Wait {{ waitDurationFormatted }}
        </span>
        <span
          v-if="action.totalTimeSeconds < 1 && action.cost < 0.5 && Math.abs(action.bankDelta) < 0.5"
          class="text-[8px] font-black text-slate-300 uppercase tracking-widest"
        >
          0s
        </span>
      </div>

      <!-- Actions (Recon + Undo) -->
      <div class="flex items-center gap-1 shrink-0">
        <!-- Recon Status -->
        <div
          v-if="actionsStore.isReconciling"
          class="flex items-center justify-center"
          :class="compact ? 'w-4' : 'w-5 sm:w-6'"
        >
          <!-- Manual completion / Unaudiated -->
          <div
            v-if="isManuallyCompleted || reconciliationStatus === 'na' || reconciliationStatus === 'pending'"
            class="flex items-center justify-center"
          >
            <label
              v-tippy="
                isManuallyCompleted
                  ? 'Manually completed - Click to undo'
                  : reconciliationStatus === 'pending'
                    ? 'Pending in-game - Click to mark complete anyway'
                    : 'Not Audited - Click to mark complete'
              "
              class="cursor-pointer hover:bg-slate-100 p-0.5 rounded transition-colors"
            >
              <input
                type="checkbox"
                :checked="isManuallyCompleted"
                class="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400 cursor-pointer transition-all"
                @change="actionsStore.toggleManualOverride(action.id)"
              />
            </label>
          </div>

          <!-- System Audited Status -->
          <template v-else>
            <div
              v-if="reconciliationStatus === 'completed'"
              v-tippy="'Action completed in-game'"
              class="text-emerald-500"
            >
              <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <div
              v-else-if="reconciliationStatus === 'pending'"
              v-tippy="'Action pending in-game'"
              class="text-amber-500 animate-pulse"
            >
              <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </template>
        </div>

        <!-- Undo Button -->
        <button
          v-if="!isStartAction"
          v-tippy="'Undo this action'"
          class="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
          :class="compact ? 'p-0.5' : 'p-1 sm:p-1.5'"
          @click="handleUndo"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Bottom Row: Description & Cost -->
    <div v-if="!compact" class="flex items-start justify-between gap-2 ml-[2rem] sm:ml-[2.25rem]">
      <div class="flex-1 min-w-0">
        <!-- Description -->
        <div
          class="text-[9px] uppercase tracking-widest font-black opacity-60 text-slate-500 mt-0.5"
          v-html="effectDescription"
        ></div>

        <!-- Deltas -->
        <div
          v-if="!isStartAction || isContinued"
          class="text-[8px] mt-1 hidden sm:flex flex-wrap gap-x-3 gap-y-0.5 font-black tracking-wider"
        >
          <span v-if="action.eggValueDelta" :class="deltaClass(action.eggValueDelta)"
            >Val {{ formatDelta(action.eggValueDelta) }}</span
          >
          <span v-if="action.habCapacityDelta" :class="deltaClass(action.habCapacityDelta)"
            >Hab {{ formatDelta(action.habCapacityDelta) }}</span
          >
          <span v-if="action.ihrDelta" :class="deltaClass(action.ihrDelta)"
            >IHR {{ formatDelta(action.ihrDelta) }}</span
          >
          <span v-if="action.layRateDelta" :class="deltaClass(action.layRateDelta)"
            >Lay {{ formatDelta(action.layRateDelta) }}</span
          >
          <span v-if="action.shippingCapacityDelta" :class="deltaClass(action.shippingCapacityDelta)"
            >Ship {{ formatDelta(action.shippingCapacityDelta) }}</span
          >
          <span v-if="action.elrDelta" :class="deltaClass(action.elrDelta)"
            >Delivery {{ formatDelta(action.elrDelta) }}</span
          >
          <span v-if="action.offlineEarningsDelta" :class="deltaClass(action.offlineEarningsDelta)"
            >Earn {{ formatDelta(action.offlineEarningsDelta) }}</span
          >
          <span v-if="action.populationDelta" :class="deltaClass(action.populationDelta)"
            >Pop {{ formatDelta(action.populationDelta) }}</span
          >
          <span
            v-if="Math.abs(action.bankDelta) >= 0.5 && (!isPurchaseAction || action.type === 'launch_missions')"
            :class="action.bankDelta >= 0.5 ? 'text-emerald-600' : 'text-slate-400'"
          >
            Gems {{ action.bankDelta >= 0.5 ? '+' : '' }}{{ formatGemPrice(action.bankDelta) }}
          </span>
        </div>
      </div>

      <!-- Cost Section -->
      <div v-if="!isStartAction" class="shrink-0 text-right">
        <template v-if="action.type === 'shift'">
          <div class="flex items-center gap-1 justify-end mt-0.5">
            <span class="text-xs font-bold text-slate-700 font-mono-premium">{{ formatNumber(action.cost, 3) }}</span>
            <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-3 h-3" alt="SE" />
          </div>
        </template>
        <template v-else-if="action.type === 'modify_bank'">
          <div class="flex items-center gap-0.5 justify-end mt-0.5">
            <span
              class="text-xs font-bold font-mono-premium"
              :class="
                action.bankDelta >= 0.5
                  ? 'text-emerald-600 font-black'
                  : action.bankDelta <= -0.5
                    ? 'text-rose-500 font-black'
                    : 'text-slate-300'
              "
            >
              {{ action.bankDelta >= 0.5 ? '+' : action.bankDelta <= -0.5 ? '-' : ''
              }}{{ formatGemPrice(Math.abs(action.bankDelta)) }}
            </span>
            <img
              v-if="Math.abs(action.bankDelta) >= 0.5"
              :src="iconURL('egginc/icon_virtue_gem.png', 64)"
              class="w-2.5 h-2.5 opacity-60"
            />
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-0.5 justify-end mt-0.5">
            <span
              class="text-xs font-bold font-mono-premium"
              :class="[
                action.cost >= 0.5
                  ? 'text-slate-800'
                  : action.bankDelta >= 0.5
                    ? 'text-emerald-600 font-black'
                    : 'text-slate-300',
              ]"
            >
              {{ action.bankDelta >= 0.5 && action.cost < 0.5 ? '+' : ''
              }}{{ formatGemPrice(action.cost >= 0.5 ? action.cost : action.bankDelta >= 0.5 ? action.bankDelta : 0) }}
            </span>
            <img
              v-if="action.cost >= 0.5 || action.bankDelta >= 0.5"
              :src="iconURL('egginc/icon_virtue_gem.png', 64)"
              class="w-2.5 h-2.5 opacity-60"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import type {
  Action,
  StartAscensionPayload,
  ShiftPayload,
  BuyHabPayload,
  BuyVehiclePayload,
  StoreFuelPayload,
  WaitForTEPayload,
  BuyResearchPayload,
  ToggleSalePayload,
  EquipArtifactSetPayload,
  UpdateArtifactSetPayload,
  WaitForFullHabsPayload,
} from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';
import { getHabById, type HabId } from '@/lib/habs';
import { getVehicleType } from '@/lib/vehicles';
import { getExecutor } from '@/lib/actions';
import { formatNumber, formatGemPrice, formatDuration } from '@/lib/format';
import { getResearchIconPath } from '@/lib/assets';
import { getResearchById } from '@/calculations/commonResearch';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';

const props = defineProps<{
  action: Action;
  compact?: boolean;
}>();

const emit = defineEmits<{
  undo: [options: { skipConfirmation: boolean }];
}>();

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

const isStartAction = computed(() => props.action.type === 'start_ascension');
const isContinued = computed(() => {
  if (props.action.type !== 'start_ascension') return false;
  const payload = props.action.payload as StartAscensionPayload;
  return !!payload.initialFarmState;
});

const baseUrl = import.meta.env.BASE_URL;

const isVehicleAction = computed(() => props.action.type === 'buy_vehicle' || props.action.type === 'buy_train_car');

const isMissionAction = computed(
  () => props.action.type === 'wait_for_missions' || props.action.type === 'launch_missions'
);

const isPurchaseAction = computed(() =>
  ['buy_research', 'buy_hab', 'buy_vehicle', 'buy_train_car', 'buy_silo', 'launch_missions'].includes(props.action.type)
);

const eggType = computed(() => {
  if (props.action.type === 'start_ascension') {
    return (props.action.payload as StartAscensionPayload).initialEgg;
  }
  if (props.action.type === 'shift') {
    return (props.action.payload as ShiftPayload).toEgg;
  }
  return null;
});

const actionIconPath = computed(() => {
  if (eggType.value) {
    return `egginc/egg_${eggType.value}.png`;
  }
  if (props.action.type === 'buy_hab') {
    const payload = props.action.payload as BuyHabPayload;
    return getHabById(payload.habId as HabId)?.iconPath;
  }
  if (props.action.type === 'buy_vehicle') {
    const payload = props.action.payload as BuyVehiclePayload;
    return getVehicleType(payload.vehicleId)?.iconPath;
  }
  if (props.action.type === 'buy_research') {
    const payload = props.action.payload as BuyResearchPayload;
    return getResearchIconPath(payload.researchId);
  }
  if (props.action.type === 'buy_train_car') {
    return 'egginc/ei_vehicle_icon_hyperloop_engine.png';
  }
  if (props.action.type === 'buy_silo') {
    return 'egginc-extras/silo.png';
  }
  if (props.action.type === 'store_fuel') {
    const payload = props.action.payload as StoreFuelPayload;
    return `egginc/egg_${payload.egg}.png`;
  }
  if (props.action.type === 'wait_for_te') {
    // Show truth egg icon for wait_for_te actions
    return 'egginc/egg_truth.png';
  }
  if (props.action.type === 'toggle_sale') {
    const payload = props.action.payload as ToggleSalePayload;
    switch (payload.saleType) {
      case 'research':
        return 'egginc-extras/icon_research_sale.png';
      case 'hab':
        return 'egginc-extras/icon_hab_sale.png';
      case 'vehicle':
        return 'egginc-extras/icon_vehicle_sale.png';
    }
  }
  if (props.action.type === 'equip_artifact_set' || props.action.type === 'update_artifact_set') {
    const payload = props.action.payload as EquipArtifactSetPayload | UpdateArtifactSetPayload;
    return payload.setName === 'elr' ? 'egginc/afx_quantum_metronome_4.png' : 'egginc/afx_lunar_totem_4.png';
  }
  if (props.action.type === 'wait_for_time') {
    return props.action.totalTimeSeconds > 3600 ? 'egginc/egg_truth.png' : 'egginc/tiny_indicator_waiting.png';
  }
  if (props.action.type === 'wait_for_missions') {
    return 'egginc/icon_afx_mission.png';
  }
  if (props.action.type === 'wait_for_full_habs') {
    return 'egginc/ei_hab_icon_chicken_universe.png';
  }
  if (props.action.type === 'wait_for_research_sale') {
    return 'egginc-extras/icon_research_sale.png';
  }
  if (props.action.type === 'wait_for_earnings_boost') {
    return 'egginc/icon_bock.png';
  }
  if (props.action.type === 'toggle_earnings_boost') {
    return 'egginc/icon_bock.png';
  }
  if (props.action.type === 'wait_for_no_earnings') {
    return 'egginc-extras/silo.png';
  }
  if (props.action.type === 'notification') {
    return 'egginc/tiny_indicator_waiting.png';
  }
  if (props.action.type === 'modify_bank') {
    return 'egginc/icon_virtue_gem.png';
  }
  return null;
});

const eggName = computed(() => {
  if (eggType.value) {
    return VIRTUE_EGG_NAMES[eggType.value];
  }
  return null;
});

const displayName = computed(() => {
  if (props.action.type === 'wait_for_time' && props.action.totalTimeSeconds > 3600) {
    return 'Offline Accumulation';
  }
  const executor = getExecutor(props.action.type);
  const name = executor.getDisplayName(props.action.payload);

  if (props.action.type === 'modify_bank') {
    const rate = props.action.endState.offlineEarnings;
    if (rate > 0 && Math.abs(props.action.bankDelta) >= 0.5) {
      const seconds = Math.abs(props.action.bankDelta) / rate;
      const sign = props.action.bankDelta >= 0 ? '+' : '-';
      return `${name} (${sign}${formatDuration(seconds)})`;
    }
  }

  return name;
});

const effectDescription = computed(() => {
  if (props.action.type === 'buy_research') {
    const payload = props.action.payload as BuyResearchPayload;
    const research = getResearchById(payload.researchId);
    if (research) {
      return research.description;
    }
  }
  const executor = getExecutor(props.action.type);
  return executor.getEffectDescription(props.action.payload);
});

/**
 * Calculate save duration (time spent accumulating gems)
 */
const savingDuration = computed(() => {
  if (props.action.cost <= 0) return 0;
  const payloadTime = (props.action.payload as { totalTimeSeconds?: number }).totalTimeSeconds || 0;
  return Math.max(0, props.action.totalTimeSeconds - payloadTime);
});

/**
 * Calculate wait duration (inherent action time)
 */
const waitDuration = computed(() => {
  const payload = props.action.payload as { totalTimeSeconds?: number; isZeroTime?: boolean };
  if (props.action.type === 'launch_missions' && payload.isZeroTime) return 0;
  if (props.action.cost <= 0) return props.action.totalTimeSeconds || 0;
  return payload.totalTimeSeconds || 0;
});

const savingDurationFormatted = computed(() => formatDuration(savingDuration.value));
const waitDurationFormatted = computed(() => formatDuration(waitDuration.value));

/**
 * The absolute end time of this action, calculated from the ascension start time.
 */
const absoluteEndTime = computed(() => {
  const startTime = virtueStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  const simTime = props.action.endState.lastStepTime || 0;

  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment: `simTime` is the
  // sum of hundreds of accumulated purchase/wait durations and routinely lands a sub-microsecond
  // residue short of a whole second even when it's "really" exactly on a boundary; `new Date`
  // truncates rather than rounds, which was displaying e.g. an exact sale-start toggle as one minute
  // early.
  return new Date(Math.round(startTime + (simTime - offset) * 1000));
});

/**
 * Detailed title for hover tooltip.
 */
const timeToSaveTitle = computed(() => {
  const date = absoluteEndTime.value;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
});

const reconciliationStatus = computed(() => {
  return actionsStore.getActionReconciliationStatus(props.action);
});

const isManuallyCompleted = computed(() => {
  return !!(actionsStore.activePlanId && actionsStore.manualOverrides[actionsStore.activePlanId]?.[props.action.id]);
});

function deltaClass(delta: number): string {
  if (delta > 0) return 'text-slate-900';
  return 'text-slate-400';
}

function formatDelta(delta: number): string {
  if (delta === 0) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatNumber(delta, 2)}`;
}

function handleUndo(event: MouseEvent) {
  emit('undo', { skipConfirmation: event.shiftKey });
}
</script>
