<template>
  <div class="space-y-6">
    <!-- Sale Protocol -->
    <div
      class="bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/80 rounded-2xl p-5 border border-indigo-100/50 shadow-sm relative overflow-hidden transition-all duration-300"
    >
      <div class="absolute -right-6 -top-6 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl"></div>

      <div class="flex items-center justify-between relative z-10">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></div>
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none"
              >Vehicle Sale</span
            >
          </div>
          <span class="text-[11px] font-black text-indigo-600 uppercase tracking-tighter">75% Discount Active</span>
        </div>
        <button
          class="relative inline-flex h-5 w-10 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
          :class="isVehicleSaleActive ? 'bg-indigo-500' : 'bg-slate-200'"
          @click="handleToggleSale"
        >
          <span
            class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
            :class="isVehicleSaleActive ? 'translate-x-[22px]' : 'translate-x-1'"
          />
        </button>
      </div>
    </div>

    <!-- Quick Upgrade Action -->
    <div v-if="canBuyMax" class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
      <button
        class="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm transition-all duration-300 hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] overflow-hidden"
        @click="handleBuyMax"
      >
        <div class="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/[0.02] transition-colors"></div>
        <div
          class="rounded-xl bg-indigo-50 border border-indigo-100 p-2 transition-colors group-hover:bg-white group-hover:scale-110 shadow-sm relative z-10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 text-indigo-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="13 17 18 12 13 7"></polyline>
            <polyline points="6 17 11 12 6 7"></polyline>
          </svg>
        </div>
        <div class="flex flex-col items-center relative z-10">
          <span class="text-[11px] font-black uppercase tracking-widest text-slate-900 group-hover:text-indigo-700"
            >Max Vehicles</span
          >
          <span v-if="maxVehiclesTime" class="text-[9px] font-mono-premium font-black text-indigo-500 mt-0.5">{{
            maxVehiclesTime
          }}</span>
        </div>
      </button>

      <button
        class="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm transition-all duration-300 hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] overflow-hidden"
        @click="handleBuy5MinCap"
      >
        <div class="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/[0.02] transition-colors"></div>
        <div
          class="rounded-xl bg-blue-50 border border-blue-100 p-2 transition-colors group-hover:bg-white group-hover:scale-110 shadow-sm relative z-10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
        <div class="flex flex-col items-center relative z-10">
          <span class="text-[11px] font-black uppercase tracking-widest text-slate-900 group-hover:text-blue-700"
            >5 Min Max Shipping</span
          >
        </div>
      </button>
    </div>

    <!-- Vehicle slots -->
    <div class="grid grid-cols-1 gap-4">
      <div
        v-for="(slot, index) in displaySlots"
        :key="index"
        class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 group hover:border-indigo-200 transition-all duration-300 hover:shadow-md"
      >
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Slot {{ index + 1 }}</span>
          <div v-if="slot.vehicleId !== null" class="flex flex-col items-end">
            <span class="text-sm font-mono-premium font-black text-slate-900">
              {{ formatNumber(getVehicleCapacity(slot, index) * 3600, 0) }}
            </span>
            <span class="text-[9px] text-slate-400 uppercase font-black tracking-widest opacity-60">Eggs/Hr</span>
          </div>
        </div>

        <UpgradeDropdown
          :model-value="slot.vehicleId !== null ? String(slot.vehicleId) : undefined"
          :options="getVehicleDropdownOptions(slot.vehicleId, index)"
          placeholder="Select vehicle..."
          @update:model-value="handleVehicleChange(index, $event ? parseInt($event) : undefined)"
        />

        <!-- Hyperloop train cars (only show for hyperloop trains) -->
        <div v-if="slot.vehicleId === 11" class="mt-2 pt-3 border-t border-slate-50">
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-[9px] text-slate-400 uppercase font-black tracking-widest">Train Length</span>
              <span class="text-xs font-mono-premium font-black text-indigo-600"
                >{{ slot.trainLength }} / {{ getMaxTrainLength() }}</span
              >
            </div>

            <div class="flex gap-2 items-end">
              <!-- Add car button -->
              <button
                v-if="canAddTrainCar(slot, index)"
                class="group flex flex-col items-center justify-center min-w-[80px] bg-white border border-blue-100 rounded-lg px-2 py-1.5 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 active:scale-95"
                @click="handleAddTrainCar(index)"
              >
                <span class="text-[10px] font-black text-blue-700 uppercase tracking-tight group-hover:text-blue-800"
                  >+1 Car ({{ formatGemPrice(getNextCarCost(slot)) }})</span
                >
                <span class="text-[9px] font-medium text-slate-400 opacity-80">{{ getCarTimeToBuy(slot) }}</span>
              </button>

              <!-- Max cars button -->
              <button
                v-if="canAddMultipleTrainCars(slot, index)"
                class="group flex flex-col items-center justify-center min-w-[80px] bg-white border border-indigo-100 rounded-lg px-2 py-1.5 shadow-sm transition-all hover:border-indigo-300 hover:bg-indigo-50 active:scale-95"
                @click="handleMaxTrainCars(index)"
              >
                <span
                  class="text-[10px] font-black text-indigo-700 uppercase tracking-tight group-hover:text-indigo-800"
                  >Max (+{{ getRemainingCars(slot, index) }}) ({{ formatGemPrice(getTotalCarsCost(slot)) }})</span
                >
                <span class="text-[9px] font-medium text-slate-400 opacity-80">{{ getMaxCarsTimeToBuy(slot) }}</span>
              </button>
            </div>
          </div>

          <!-- Capacity per car hints -->
          <div v-if="slot.trainLength < getMaxTrainLength()" class="mt-2 text-[9px] text-slate-400 italic font-medium">
            Each car adds +{{ formatNumber((getVehicleType(11)?.baseCapacityPerSecond ?? 0) * 3600, 0) }} eggs/hr
          </div>
        </div>
      </div>
    </div>

    <!-- Note about fleet size -->
    <div class="flex items-center justify-between px-2">
      <div class="flex flex-col gap-0.5">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Fleet Capacity: {{ activeVehicleCount }}/{{ maxVehicleSlots }} active
        </p>
        <p class="text-[10px] text-indigo-400 italic font-medium">(upgrade fleet size research to unlock more slots)</p>
      </div>
    </div>

    <EventExpiryDialog
      v-if="showExpiryDialog"
      :event-name="expiryData.eventName"
      :end-time="expiryData.endTime"
      :completion-time="expiryData.completionTime"
      @cancel="handleExpiryCancel"
      @deactivate-and-cancel="handleExpiryDeactivateAndCancel"
      @deactivate-and-continue="handleExpiryDeactivateAndContinue"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import UpgradeDropdown, { type UpgradeDropdownOption } from './UpgradeDropdown.vue';
import {
  vehicleTypes,
  getVehicleType,
  getDiscountedVehiclePrice,
  getDiscountedTrainCarPrice,
  countVehiclesOfType,
  BASE_TRAIN_LENGTH,
  MAX_TRAIN_LENGTH,
  type VehicleCostModifiers,
  type VehicleType,
} from '@/lib/vehicles';
import { formatNumber, formatGemPrice, formatDuration } from '@/lib/format';
import { useShippingCapacityStore } from '@/stores/shippingCapacity';
import { useShippingCapacity } from '@/composables/useShippingCapacity';
import { useInitialStateStore } from '@/stores/initialState';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useActionsStore } from '@/stores/actions';
import { useSalesStore } from '@/stores/sales';
import { computeDependencies } from '@/lib/actions/executor';
import { generateActionId } from '@/types';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { useEventExpiry } from '@/composables/useEventExpiry';
import EventExpiryDialog from '../EventExpiryDialog.vue';
import {
  calculateShippingMultipliers,
  calculateMaxVehicleSlots,
  calculateMaxTrainLength,
} from '@/calculations/shippingCapacity';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { getTimeToSave } from '@/engine/apply';
import { calculateVehicleCapacity, planMaxVehicles, planVehiclesForTimeLimit } from '@/calculations/vehiclePurchasePlan';

const shippingStore = useShippingCapacityStore();
const initialStateStore = useInitialStateStore();
const commonResearchStore = useCommonResearchStore();
const actionsStore = useActionsStore();
const salesStore = useSalesStore();
const { output } = useShippingCapacity();
const { prepareExecution, completeExecution, batch } = useActionExecutor();
const {
  showExpiryDialog,
  expiryData,
  withExpiryCheck,
  cancel: handleExpiryCancel,
  deactivateAndCancel: handleExpiryDeactivateAndCancel,
  deactivateAndContinue: handleExpiryDeactivateAndContinue,
} = useEventExpiry();

// Cost modifiers
const costModifiers = computed<VehicleCostModifiers>(() => ({
  bustUnionsLevel: initialStateStore.epicResearchLevels['bust_unions'] || 0,
  vehicleCostMultiplier: initialStateStore.colleggtibleModifiers.vehicleCost,
}));

const isVehicleSaleActive = computed(() => actionsStore.effectiveSnapshot.activeSales.vehicle);

// Compute effective state for accurate capacity and cost calculations
const effectiveSnapshot = computed(() => actionsStore.effectiveSnapshot);

// Compute multipliers based on effective state
const effectiveMultipliers = computed(() => {
  const researchLevels = effectiveSnapshot.value.researchLevels;
  const artifactLoadout = effectiveSnapshot.value.artifactLoadout;
  const transportationLobbyistLevel = initialStateStore.epicResearchLevels['transportation_lobbyist'] || 0;

  // Calculate artifact modifiers
  const artifactMods = calculateArtifactModifiers(artifactLoadout).shippingRate;

  // Calculate research multipliers
  const { universalMultiplier, hoverMultiplier, hyperloopMultiplier, epicMultiplier } = calculateShippingMultipliers(
    researchLevels,
    transportationLobbyistLevel
  );

  return {
    universalMultiplier,
    hoverMultiplier,
    hyperloopMultiplier,
    epicMultiplier,
    shippingCapMultiplier: initialStateStore.colleggtibleModifiers.shippingCap,
    artifactMultiplier: artifactMods.totalMultiplier,
  };
});

// Display only available slots, padding with empty slots if vehicles array is shorter than maxVehicleSlots
const displaySlots = computed(() => {
  const max = calculateMaxVehicleSlots(effectiveSnapshot.value.researchLevels);
  // Clone the effective vehicles to avoid mutation
  const slots = effectiveSnapshot.value.vehicles ? [...effectiveSnapshot.value.vehicles].slice(0, max) : [];

  // Pad with empty slots
  while (slots.length < max) {
    slots.push({ vehicleId: null, trainLength: 1 });
  }
  return slots;
});

const maxVehicleSlots = computed(() => calculateMaxVehicleSlots(effectiveSnapshot.value.researchLevels));

const activeVehicleCount = computed(() => displaySlots.value.filter(v => v.vehicleId !== null).length);

function getVehiclePrice(vehicleId: number, slotIndex: number): number {
  const currentSlot = displaySlots.value[slotIndex];
  if (currentSlot && currentSlot.vehicleId === vehicleId) {
    return 0;
  }

  const effectiveVehicles = effectiveSnapshot.value.vehicles || [];
  const existingCount = countVehiclesOfType(effectiveVehicles, vehicleId);
  return getDiscountedVehiclePrice(vehicleId, existingCount, costModifiers.value, isVehicleSaleActive.value);
}

function getTimeToBuyFromPrice(price: number): string {
  const seconds = getTimeToSave(price, actionsStore.effectiveSnapshot);
  if (seconds <= 0) return '0s';
  if (seconds === Infinity) return '∞';
  return formatDuration(seconds);
}

function getVehicleTimeToBuySeconds(vehicleId: number, slotIndex: number): number {
  const price = getVehiclePrice(vehicleId, slotIndex);
  return getTimeToSave(price, actionsStore.effectiveSnapshot);
}

function getVehicleDropdownOptions(currentVehicleId: number | null, slotIndex: number): UpgradeDropdownOption[] {
  const vehicles = getAvailableVehicles(currentVehicleId);
  return vehicles.map(vt => {
    const currentSlot = displaySlots.value[slotIndex];
    const isCurrent = currentSlot && currentSlot.vehicleId === vt.id;
    
    let option: UpgradeDropdownOption = {
      id: String(vt.id),
      name: vt.name,
      iconPath: vt.iconPath,
    };

    if (isCurrent) {
      option.subtext = 'Owned';
    } else {
      const price = getVehiclePrice(vt.id, slotIndex);
      const capacity = getVehicleCapacity({ vehicleId: vt.id, trainLength: 1 }, slotIndex);
      option.capacity = `${formatNumber(capacity * 3600, 0)}/hr`;
      option.price = price;
      option.time = getVehicleTimeToBuy(vt.id, slotIndex);
    }

    return option;
  });
}

function getVehicleTimeToBuy(vehicleId: number, slotIndex: number): string {
  const price = getVehiclePrice(vehicleId, slotIndex);
  return getTimeToBuyFromPrice(price);
}

function getCarTimeToBuy(slot: { vehicleId: number | null; trainLength: number }): string {
  const price = getNextCarCost(slot);
  return getTimeToBuyFromPrice(price);
}

function getMaxCarsTimeToBuy(slot: { vehicleId: number | null; trainLength: number }): string {
  const price = getTotalCarsCost(slot);
  return getTimeToBuyFromPrice(price);
}

function getVehicleCapacity(slot: { vehicleId: number | null; trainLength: number }, _index: number): number {
  const {
    universalMultiplier,
    hoverMultiplier,
    hyperloopMultiplier,
    epicMultiplier,
    shippingCapMultiplier,
    artifactMultiplier,
  } = effectiveMultipliers.value;

  return calculateVehicleCapacity(
    slot,
    universalMultiplier,
    hoverMultiplier,
    hyperloopMultiplier,
    epicMultiplier,
    shippingCapMultiplier,
    artifactMultiplier
  );
}

/**
 * Get available vehicles for a slot - only show upgrades (higher id than current).
 * If slot is empty (null), show all vehicles.
 */
function getAvailableVehicles(currentVehicleId: number | null) {
  if (currentVehicleId === null) {
    return vehicleTypes;
  }
  // Only show vehicles with higher id (upgrades only, no downgrades)
  return vehicleTypes.filter(vt => vt.id >= currentVehicleId);
}

function handleVehicleChange(slotIndex: number, vehicleId: number | undefined) {
  if (vehicleId === undefined) return;

  // Don't add if it's already the same (check array bounds for slots unlocked by fleet research)
  const currentSlot = displaySlots.value[slotIndex];
  if (currentSlot && currentSlot.vehicleId === vehicleId) return;

  // Build payload
  const payload = {
    slotIndex,
    vehicleId,
    trainLength: vehicleId === 11 ? 1 : undefined,
  };

  const duration = getVehicleTimeToBuySeconds(vehicleId, slotIndex);

  withExpiryCheck(duration, false, () => {
    // Prepare execution (restores stores if editing past group)
    const beforeSnapshot = prepareExecution();

    // Calculate cost based on effective state
    const effectiveVehicles = beforeSnapshot.vehicles;
    const existingCount = countVehiclesOfType(effectiveVehicles, vehicleId);
    const isSaleActive = beforeSnapshot.activeSales.vehicle;
    const cost = getDiscountedVehiclePrice(vehicleId, existingCount, costModifiers.value, isSaleActive);

    // Compute dependencies (hyperloop train cars depend on graviton coupling)
    const dependencies = computeDependencies(
      'buy_vehicle',
      payload,
      actionsStore.actionsBeforeInsertion,
      actionsStore.initialSnapshot.researchLevels
    );

    // Apply to store
    shippingStore.setVehicle(slotIndex, vehicleId);

    // Complete execution
    completeExecution(
      {
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'buy_vehicle',
        payload,
        cost,
        dependsOn: dependencies,
      },
      beforeSnapshot
    );
  });
}

// ============================================================================
// Train Car Functions
// ============================================================================

/**
 * Get the maximum train length based on graviton coupling research.
 */
function getMaxTrainLength(): number {
  return calculateMaxTrainLength(effectiveSnapshot.value.researchLevels);
}

/**
 * Check if we can add more train cars to this slot.
 */
function canAddTrainCar(slot: { vehicleId: number | null; trainLength: number }, _index: number): boolean {
  if (slot.vehicleId !== 11) return false;
  return slot.trainLength < getMaxTrainLength();
}

/**
 * Check if we can add multiple train cars (for Max button).
 */
function canAddMultipleTrainCars(slot: { vehicleId: number | null; trainLength: number }, index: number): boolean {
  if (!canAddTrainCar(slot, index)) return false;
  return getMaxTrainLength() - slot.trainLength > 1;
}

/**
 * Get the number of remaining cars that can be added.
 */
function getRemainingCars(slot: { vehicleId: number | null; trainLength: number }, _index: number): number {
  return getMaxTrainLength() - slot.trainLength;
}

/**
 * Get the cost for the next train car.
 */
function getNextCarCost(slot: { vehicleId: number | null; trainLength: number }): number {
  // trainLength is current, so next car index is trainLength (0-indexed would be trainLength)
  return getDiscountedTrainCarPrice(slot.trainLength, costModifiers.value, isVehicleSaleActive.value);
}

/**
 * Get the total cost for all remaining train cars.
 */
function getTotalCarsCost(slot: { vehicleId: number | null; trainLength: number }): number {
  if (slot.vehicleId !== 11) return 0;
  let total = 0;
  const currentLength = slot.trainLength;
  const maxLength = getMaxTrainLength();
  for (let i = currentLength; i < maxLength; i++) {
    total += getDiscountedTrainCarPrice(i, costModifiers.value, isVehicleSaleActive.value);
  }
  return total;
}

/**
 * Handle adding a single train car.
 */
function handleAddTrainCar(slotIndex: number) {
  const slot = displaySlots.value[slotIndex];
  if (!slot || slot.vehicleId !== 11) return;

  const fromLength = slot.trainLength;
  const toLength = fromLength + 1;

  if (toLength > getMaxTrainLength()) return;

  const cost = getDiscountedTrainCarPrice(toLength - 1, costModifiers.value, isVehicleSaleActive.value);
  const duration = getTimeToSave(cost, actionsStore.effectiveSnapshot);

  withExpiryCheck(duration, false, () => {
    addTrainCarAction(slotIndex, fromLength, toLength);
  });
}

/**
 * Handle adding all remaining train cars.
 */
function handleMaxTrainCars(slotIndex: number) {
  const slot = displaySlots.value[slotIndex];
  if (!slot || slot.vehicleId !== 11) return;

  const maxLength = getMaxTrainLength();
  let currentLength = slot.trainLength;
  let totalCost = 0;
  
  // Estimate total cost/duration
  for (let l = currentLength; l < maxLength; l++) {
      totalCost += getDiscountedTrainCarPrice(l, costModifiers.value, isVehicleSaleActive.value);
  }
  const duration = getTimeToSave(totalCost, actionsStore.effectiveSnapshot);

  withExpiryCheck(duration, false, () => {
    // Add each car as a separate action
    batch(() => {
      while (currentLength < maxLength) {
        const fromLength = currentLength;
        const toLength = currentLength + 1;
        addTrainCarAction(slotIndex, fromLength, toLength);
        currentLength = toLength;
      }
    });
  });
}

/**
 * Add a train car action.
 */
function addTrainCarAction(slotIndex: number, fromLength: number, toLength: number) {
  // Prepare execution (restores stores if editing past group)
  const beforeSnapshot = prepareExecution();

  // Calculate cost
  const isSaleActive = beforeSnapshot.activeSales.vehicle;
  const cost = getDiscountedTrainCarPrice(toLength - 1, costModifiers.value, isSaleActive);

  // Build payload
  const payload = {
    slotIndex,
    fromLength,
    toLength,
  };

  // Compute dependencies
  const dependencies = computeDependencies(
    'buy_train_car',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Apply to store
  shippingStore.setTrainLength(slotIndex, toLength);

  // Complete execution
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'buy_train_car',
      payload,
      cost,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
}

function handleToggleSale() {
  const beforeSnapshot = prepareExecution();
  const currentlyActive = beforeSnapshot.activeSales.vehicle;

  const payload = {
    saleType: 'vehicle' as const,
    active: !currentlyActive,
    multiplier: 0.25, // 75% off
  };

  // Update store state
  salesStore.setSaleActive('vehicle', !currentlyActive);

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'toggle_sale',
      payload,
      cost: 0,
      dependsOn: computeDependencies(
        'toggle_sale',
        payload,
        actionsStore.actionsBeforeInsertion,
        actionsStore.initialSnapshot.researchLevels
      ),
    },
    beforeSnapshot
  );
}

const maxVehiclesSim = computed(() => {
  const snapshot = actionsStore.effectiveSnapshot;
  return planMaxVehicles(
    snapshot.vehicles || [],
    maxVehicleSlots.value,
    getMaxTrainLength(),
    costModifiers.value,
    isVehicleSaleActive.value,
    effectiveMultipliers.value,
    snapshot
  );
});

const maxVehiclesSeconds = computed(() => maxVehiclesSim.value.totalSeconds);

const maxVehiclesTime = computed(() => {
  const seconds = maxVehiclesSeconds.value;
  if (seconds === Infinity) return '∞';
  if (seconds < 1) return 'Instant';
  return formatDuration(seconds);
});

const canBuyMax = computed(() => !maxVehiclesSim.value.allMaxed);

function handleBuyMax() {
  const HYPERLOOP_ID = 11;
  const sim = maxVehiclesSim.value;
  if (sim.steps.length === 0) return;

  withExpiryCheck(sim.totalSeconds, false, () => {
    batch(() => {
      const trainLengths: Record<number, number> = {};
      for (const step of sim.steps) {
        if (step.type === 'upgrade_hyperloop') {
          handleVehicleChange(step.slotIndex, HYPERLOOP_ID);
          trainLengths[step.slotIndex] = 1;
        } else {
          const fromLength = trainLengths[step.slotIndex] ?? displaySlots.value[step.slotIndex].trainLength;
          addTrainCarAction(step.slotIndex, fromLength, fromLength + 1);
          trainLengths[step.slotIndex] = fromLength + 1;
        }
      }
    });
  });
}

function handleBuy5MinCap() {
  const snapshot = actionsStore.effectiveSnapshot;
  if (snapshot.offlineEarnings <= 0) return;

  // Same purchase-picking logic K1 uses for its (much longer) shift budget, just with a
  // 5-minute allowance — see planVehiclesForTimeLimit's doc comment.
  const plan = planVehiclesForTimeLimit(
    snapshot.vehicles || [],
    maxVehicleSlots.value,
    getMaxTrainLength(),
    costModifiers.value,
    isVehicleSaleActive.value,
    effectiveMultipliers.value,
    5 * 60,
    snapshot
  );

  if (plan.steps.length === 0) return;

  batch(() => {
    const trainLengths: Record<number, number> = {};
    for (const step of plan.steps) {
      if (step.type === 'vehicle') {
        handleVehicleChange(step.slotIndex, step.vehicleId);
        trainLengths[step.slotIndex] = 1;
      } else {
        const fromLength = trainLengths[step.slotIndex] ?? displaySlots.value[step.slotIndex].trainLength;
        addTrainCarAction(step.slotIndex, fromLength, fromLength + 1);
        trainLengths[step.slotIndex] = fromLength + 1;
      }
    }
  });
}
</script>
