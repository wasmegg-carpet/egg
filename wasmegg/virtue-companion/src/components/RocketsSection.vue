<template>
  <div class="mx-4 xl:mx-0">
    <template v-if="missions.length > 0">
      <div v-if="missions.some(mission => mission.hasReturnedBy(now))" class="text-center text-xs -mt-2">
        You should press <span class="text-blue-500">"Load Player Data"</span> again to refresh your mission list once
        you have collected your finished missions and sent out new ones.
      </div>
      <ul
        class="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 my-4"
        :class="[missions.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3']"
      >
        <li
          v-for="(mission, index) in missions"
          :key="index"
          class="col-span-1 flex flex-col text-center bg-gray-50 rounded-2xl shadow-lg divide-y divide-gray-200"
        >
          <div class="flex-1 flex flex-col p-6 relative">
            <div class="w-36 h-36 flex-shrink-0 mx-auto relative" :class="missionDurationTypeFgClass(mission)">
              <img
                class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full"
                :src="iconURL(mission.shipIconPath, 256)"
              />
              <countdown-timer-progress-ring
                v-if="mission.durationSeconds && mission.returnTimestamp"
                :radius="72"
                :stroke-width="2"
                :duration-seconds="mission.durationSeconds"
                :deadline="mission.returnTimestamp"
              />
              <progress-ring v-else :radius="72" :stroke-width="2" :filled-fraction="0" />
            </div>
            <h3 class="mt-4 text-gray-900 text-sm font-medium">{{ mission.shipName }}</h3>
            <mission-star-levels :mission="mission" class="justify-center my-1" />
            <div class="mt-1 flex-grow flex flex-col">
              <div>
                <span
                  class="px-2 py-1 text-white text-xs font-medium rounded-full"
                  :class="missionDurationTypeBgClass(mission)"
                >
                  {{ mission.durationTypeName }}
                </span>
              </div>
              <div class="mt-1 text-gray-500 text-xs">Capacity: {{ mission.capacity }}</div>
              <div class="mt-1 text-gray-500 text-xs">
                Duration:
                <template v-if="mission.durationSeconds !== null">
                  {{ mission.durationDisplay }}
                </template>
                <template v-else> &ndash; </template>
              </div>
              <div class="mt-1 mb-1 text-gray-500 text-xs">Sensor target:</div>
              <div
                class="text-center text-xs text-white rounded-full w-max px-1.5 py-0.5 mx-auto bg-gray-400 font-semibold"
              >
                {{ mission.sensorTarget || 'None' }}
              </div>
              <div class="mt-2 text-gray-700 text-sm font-medium">{{ mission.statusName }}</div>
              <div
                v-if="mission.returnTimestamp !== null"
                v-tippy="{
                  content: mission.hasReturnedBy(now)
                    ? 'Mission has returned.'
                    : `Mission is scheduled to return at ${mission.returnTime?.format('LLL')}.`,
                }"
                class="mt-1 text-gray-700 text-sm font-medium tabular-nums"
              >
                <countdown-timer :deadline="mission.returnTimestamp" />
              </div>
              <div v-else-if="mission.statusIsFueling && mission.fuels.length > 0" class="mt-1">
                <img
                  v-for="fuel in mission.fuels"
                  :key="fuel.egg"
                  v-tippy="{
                    content: getFuelDisplay(fuel, mission),
                  }"
                  class="inline h-4 w-4 align-text-top"
                  :src="iconURL(fuel.eggIconPath, 64)"
                />
              </div>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <div v-else class="text-center text-sm">No active virtue mission. You should start one!</div>

    <div class="flex justify-center my-1">
      <div class="relative flex items-start">
        <div class="flex items-center h-4">
          <input
            id="show-exact-fuel-amounts"
            v-model="showExactFuelAmounts"
            name="show-exact-fuel-amounts"
            type="checkbox"
            class="h-4 w-4 text-green-600 border-gray-300 rounded focus:outline-none focus:ring-0 focus:ring-offset-0"
          />
        </div>
        <div class="ml-1.5 text-xs">
          <label for="show-exact-fuel-amounts" class="text-gray-600">Show &ldquo;exact&rdquo; amounts</label>
        </div>
      </div>
    </div>

    <div class="flex justify-center">
      <!-- Virtue Fuel Tank Card -->
      <div class="px-4 py-2 bg-gray-50 rounded-lg shadow">
        <div class="text-sm text-center">
          Virtue tank usage:
          <span class="text-gray-700 whitespace-nowrap">
            {{ formatEIValue(virtueFuelTankUsage, { trim: true }) }}
          </span>
        </div>

        <div>
          <template v-if="virtueFuels.length > 0">
            <div v-if="!showExactFuelAmounts" class="flex flex-wrap justify-center mt-1">
              <div v-for="fuel in virtueFuels" :key="fuel.egg" class="flex flex-shrink-0 items-center px-1 my-0.5">
                <img
                  v-tippy="{ content: fuel.eggName }"
                  class="inline h-4 w-4 align-text-top"
                  :src="iconURL(fuel.eggIconPath, 64)"
                />
                <span class="text-xs text-gray-700 tabular-nums">{{ fuel.amountDisplay }}</span>
              </div>
            </div>

            <div v-else class="grid grid-cols-max-3 items-center text-xs text-gray-700 tabular-nums">
              <template v-for="fuel in virtueFuels" :key="fuel.egg">
                <img
                  v-tippy="{ content: fuel.eggName }"
                  class="inline h-4 w-4 align-text-top"
                  :src="iconURL(fuel.eggIconPath, 64)"
                />
                <span class="text-right ml-1">{{ formatEIValue(fuel.amount) }}</span>
                <span class="text-right ml-2"
                  >({{
                    fuel.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 3,
                    })
                  }})</span
                >
              </template>
            </div>
          </template>
          <template v-else>
            <div class="text-center text-xs text-gray-700">No fuel stored in virtue tank.</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, PropType, ref, toRefs, watch } from 'vue';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { ei, formatEIValue, getLocalStorage, iconURL, Mission, MissionFuel, setLocalStorage } from 'lib';
import { missionDurationTypeFgClass, missionDurationTypeBgClass } from '@/utils';
import CountdownTimer from '@/components/CountdownTimer.vue';
import MissionStarLevels from '@/components/MissionStarLevels.vue';
import CountdownTimerProgressRing from '@/components/CountdownTimerProgressRing.vue';
import ProgressRing from '@/components/ProgressRing.vue';

dayjs.extend(advancedFormat);
dayjs.extend(localizedFormat);

const SHOW_EXACT_FUEL_AMOUNTS_LOCALSTORAGE_KEY = 'showExactFuelAmounts';

export default defineComponent({
  components: {
    CountdownTimer,
    MissionStarLevels,
    CountdownTimerProgressRing,
    ProgressRing,
  },
  props: {
    backup: {
      type: Object as PropType<ei.IBackup>,
      required: true,
    },
  },
  setup(props) {
    const { backup } = toRefs(props);
    const activeMissions = computed(() => {
      const artifactsDb = backup.value.artifactsDb;
      return (artifactsDb?.missionInfos ?? [])
        .filter(mission => (mission.type || ei.MissionInfo.MissionType.STANDARD) === ei.MissionInfo.MissionType.VIRTUE)
        .concat(artifactsDb?.virtueAfxDb?.fuelingMission ?? []);
    });
    const missions = computed(() => activeMissions.value.map(m => new Mission(m)));
    const now = ref(dayjs());
    const refreshIntervalId = setInterval(() => {
      now.value = dayjs();
    }, 10000);
    onBeforeUnmount(() => {
      clearInterval(refreshIntervalId);
    });

    const getFuelDisplay = (fuel: MissionFuel, mission: Mission) => {
      const requiredFuel = mission.fuelMap(mission.isVirtue).get(fuel.egg);
      if (requiredFuel !== undefined) {
        return `${fuel.amountDisplay} / ${formatEIValue(requiredFuel, { trim: true })}`;
      }
      return `${fuel.amountDisplay}`;
    };

    const virtueFuels = computed(() => {
      const tankFuels = backup.value.virtue?.afx?.tankFuels || [];
      return tankFuels
        .slice(19)
        .map((amount, index) => new MissionFuel(ei.Egg.EDIBLE + index + 48, amount))
        .filter(fuel => fuel.amount > 0);
    });
    const virtueFuelTankUsage = computed(() => virtueFuels.value.reduce((total, fuel) => total + fuel.amount, 0));
    const showExactFuelAmounts = ref(getLocalStorage(SHOW_EXACT_FUEL_AMOUNTS_LOCALSTORAGE_KEY) === 'true');
    watch(showExactFuelAmounts, () => {
      setLocalStorage(SHOW_EXACT_FUEL_AMOUNTS_LOCALSTORAGE_KEY, showExactFuelAmounts.value);
    });

    return {
      missions,
      now,
      missionDurationTypeFgClass,
      missionDurationTypeBgClass,
      iconURL,
      formatEIValue,
      getFuelDisplay,
      virtueFuels,
      virtueFuelTankUsage,
      showExactFuelAmounts,
    };
  },
});
</script>
