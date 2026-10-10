<template>
  <main>
    <p>{{ nickname }}</p>
    <p class="text-sm">
      Last synced to server:
      <span v-tippy="{ content: lastRefreshed.format('LLL') }" class="whitespace-nowrap">
        {{ lastRefreshedRelative }}
      </span>
    </p>
    <p class="text-sm">
      Total Shifts:
      {{ totalShifts }}
    </p>
    <p class="text-sm">Total Resets: {{ totalResets }}</p>
    <p class="text-sm">
      Next Shift Cost:
      {{ nextShiftSE }} <img :src="iconURL('egginc/egg_soul.png', 64)" class="inline h-4 w-4 mb-1" />
    </p>
    <p>
      <span
        v-tippy="{
          content: `
          <p>The game, while active, saves to Egg, Inc.&rsquo;s server every couple of minutes if network condition allows.
          Other than soon after a fresh launch of the game, such server syncs are unpredictable from the user&rsquo;s point of view.
          <span class='text-blue-300'>You can force close then reopen the app to reasonably reliably trigger a sync</span>
          (search for &ldquo;iOS force close app&rdquo; or &ldquo;Android force close app&rdquo; if you need help).</p>

          <p>However, even after an app-initiated sync, it may take an unpredicatible amount of time
          (usually within a minute or so) for the game&rsquo;s server to serve the updated save through its API,
          which is then picked up by this tool. There is no solution other than clicking &ldquo;Load Player Data&rdquo;
          periodically until the fresh save shows up. Please do not refresh too fast, which is not helpful.</p>`,
          allowHTML: true,
        }"
        class="inline-flex items-center space-x-1"
      >
        <base-info />
        <span class="text-xs text-gray-500">Why is my save out of date?</span>
      </span>
    </p>

    <div class="flex my-2">
      <label class="flex items-center">
        <input v-model="showThresholdSpoilers" type="checkbox" class="mr-2" />
        <span class="text-sm"
          >Show All Truth Egg <img :src="iconURL('egginc/egg_truth.png', 64)" class="inline h-4 w-4 mb-1" /> Thresholds
          (SPOILERS)</span
        >
      </label>
    </div>
    <hr class="mt-2" />
    <collapsible-section
      section-title="Truth Egg Progress"
      :visible="isVisibleSection('truth_eggs')"
      class="my-2 text-sm"
      @toggle="toggleSectionVisibility('truth_eggs')"
    >
      <truth-egg-progress
        v-model:target-t-e="targetTE"
        :show-threshold-spoilers="showThresholdSpoilers"
        :egg="egg"
        :backup="backup"
        :truth-eggs="truthEggs"
        :truth-eggs-pending-adjusted="truthEggsPendingAdjusted"
        :active-e-o-v-delivered="activeEOVDelivered"
        :active-e-o-v-delivered-adjusted="activeEOVDeliveredAdjusted"
        :current-e-l-r="currentELR"
        :eov-delivered="eovDelivered"
        :truth-eggs-pending="truthEggsPending"
        :total-truth-eggs="totalTruthEggs"
        :total-truth-eggs-pending="totalTruthEggsPending"
        :totaleov-delivered="totaleovDelivered"
        :discovered-thresholds="discoveredThresholds"
      />
    </collapsible-section>
    <template v-if="virtueEggs.includes(egg)">
      <hr class="mt-2" />
      <collapsible-section
        section-title="Summary"
        :visible="isVisibleSection('summary')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('summary')"
      >
        <farm-summary
          :backup="backup"
          :current-population="currentPopulation"
          :clothed-t-e="clothedTE"
          :max-clothed-t-e="maxClothedTE"
          :always-count-video-doubler="earningsSectionRef?.alwaysCountVideoDoubler || false"
        />
      </collapsible-section>
      <hr class="mt-2" />

      <hr class="mt-2" />

      <collapsible-section
        section-title="Habs & Vehicles"
        :visible="isVisibleSection('habs_vehicles')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('habs_vehicles')"
      >
        <div class="mb-2 flex items-center">
          <input
            id="show-hab-vehicle-icons"
            v-model="showHabVehicleIcons"
            type="checkbox"
            class="h-4 w-4 text-green-600 border-gray-300 rounded focus:outline-none focus:ring-0 focus:ring-offset-0"
          />
          <label for="show-hab-vehicle-icons" class="ml-2 text-sm text-gray-600">Icons</label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <vehicles-section :backup="backup" :show-icons="showHabVehicleIcons" />
          <habs-section :backup="backup" :current-timestamp="currentTimestamp" :show-icons="showHabVehicleIcons" />
        </div>
      </collapsible-section>

      <hr class="mt-2" />

      <collapsible-section
        section-title="Silos & Internal Hatchery"
        :visible="isVisibleSection('silos_ihr')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('silos_ihr')"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <internal-hatchery-info
            :online-i-h-r="onlineIHR"
            :online-i-h-r-per-hab="onlineIHRPerHab"
            :offline-i-h-r="offlineIHR"
            :internal-hatchery-researches="internalHatcheryResearches"
          />
          <silos-section :backup="backup" :set-cash-target="setCashTarget" :add-cash-target="addCashTarget" />
        </div>
      </collapsible-section>

      <hr class="mt-2" />

      <collapsible-section
        section-title="Earnings"
        :visible="isVisibleSection('earnings')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('earnings')"
      >
        <earnings-section
          ref="earningsSectionRef"
          :backup="backup"
          :optimal-artifacts="cteArtiSet.artifacts"
          :target-t-e="targetTE"
          :current-population="currentPopulation"
          :total-truth-eggs-pending="totalTruthEggsPending"
        />
      </collapsible-section>

      <hr class="mt-2" />
      <collapsible-section
        section-title="Research"
        :visible="isVisibleSection('research')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('research')"
      >
        <research-progress
          :backup="backup"
          :set-cash-target="setCashTarget"
          :add-cash-target="addCashTarget"
          :earnings-set="cteArtiSet.artifacts"
        />
      </collapsible-section>

      <hr class="mt-2" />

      <collapsible-section
        section-title="Rockets"
        :visible="isVisibleSection('rockets')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('rockets')"
      >
        <rockets-section :backup="backup" />
      </collapsible-section>

      <hr />

      <collapsible-section
        :section-title="`Currently Equipped Artifacts (Clothed TE: ${formatWithThousandSeparators(Math.round(clothedTE))})`"
        :visible="isVisibleSection('artifacts')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('artifacts')"
      >
        <artifacts-gallery :artifact-set="equippedArtiSet" :farm="homeFarm" />
      </collapsible-section>
      <collapsible-section
        :section-title="`Optimal Artifacts for Earnings (Clothed TE: ${formatWithThousandSeparators(Math.round(maxClothedTE))})`"
        :visible="isVisibleSection('artifacts-cte')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('artifacts-cte')"
      >
        <artifacts-gallery
          :artifact-set="cteArtiSet"
          :reference-set="equippedArtiSet"
          :artifact-assembly-statuses="cteAssemblyStatuses"
          :farm="homeFarm"
        />
      </collapsible-section>
      <collapsible-section
        section-title="Optimal Artifacts for Delivery Rate"
        :visible="isVisibleSection('artifacts-elr')"
        class="my-2 text-sm"
        @toggle="toggleSectionVisibility('artifacts-elr')"
      >
        <div v-if="currentPopulation < totalHabSpace" class="mb-2 flex items-center">
          <input
            id="elr-assume-max-pop"
            v-model="assumeMaxPopulation"
            type="checkbox"
            class="h-4 w-4 text-green-600 border-gray-300 rounded focus:outline-none focus:ring-0 focus:ring-offset-0"
          />
          <label for="elr-assume-max-pop" class="ml-2 text-sm text-gray-600">Assume max population</label>
        </div>
        <artifacts-gallery
          :artifact-set="elrArtiSet"
          :reference-set="equippedArtiSet"
          :artifact-assembly-statuses="elrAssemblyStatuses"
          :farm="homeFarm"
        />
      </collapsible-section>
    </template>
  </main>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, shallowRef, watch, provide } from 'vue';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import {
  ei,
  iconURL,
  ArtifactSet,
  UserBackupEmptyError,
  getLocalStorage,
  setLocalStorage,
  virtueEggs,
  fmtApprox,
  nextShiftCost,
  getNumTruthEggs,
  Inventory,
  Farm,
  defaultModifiers,
  type Modifiers,
} from 'lib';
import {
  allModifiersFromColleggtibles,
  calculateClothedTE,
  calculateMaxClothedTE,
  farmHabs,
  farmHabSpaceResearches,
  farmHabSpaces,
  farmShippingCapacity,
  farmInternalHatcheryRates,
  farmInternalHatcheryResearches,
  homeFarmArtifacts,
  requestFirstContact,
  resolveColleggtibleContracts,
  farmEggLayingRate,
  pendingTruthEggs,
  getOptimalELRSet,
} from '@/lib';
import { TE_BREAKPOINTS } from '@/lib/virtue';
import { useSectionVisibility } from 'ui/composables/section_visibility';
import { formatWithThousandSeparators } from '@/utils';
import CollapsibleSection from '@/components/CollapsibleSection.vue';
import ArtifactsGallery from '@/components/ArtifactsGallery.vue';
import BaseInfo from 'ui/components/BaseInfo.vue';
import ResearchProgress from '@/components/ResearchProgress.vue';
import TruthEggProgress from '@/components/TruthEggProgress.vue';
import FarmSummary from '@/components/FarmSummary.vue';
import HabsSection from '@/components/HabsSection.vue';
import VehiclesSection from '@/components/VehiclesSection.vue';
import SilosSection from '@/components/SilosSection.vue';
import InternalHatcheryInfo from '@/components/InternalHatcheryInfo.vue';
import EarningsSection from '@/components/EarningsSection.vue';
import RocketsSection from '@/components/RocketsSection.vue';

// Note that timezone abbreviation may not work due to
// https://github.com/iamkun/dayjs/issues/1154, in which case the GMT offset is
// shown.
dayjs.extend(advancedFormat);
dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);
dayjs.extend(timezone);
dayjs.extend(utc);

export default defineComponent({
  components: {
    CollapsibleSection,
    ArtifactsGallery,
    BaseInfo,
    ResearchProgress,
    TruthEggProgress,
    FarmSummary,
    HabsSection,
    VehiclesSection,
    SilosSection,
    InternalHatcheryInfo,
    EarningsSection,
    RocketsSection,
  },
  props: {
    playerId: {
      type: String,
      required: true,
    },
  },
  // This async component does not respond to playerId changes.

  async setup({ playerId }) {
    // Validate and sanitize player ID.
    if (!playerId.match(/^EI\d+$/i)) {
      throw new Error(`ID ${playerId} is not in the form EI1234567890123456; please consult "Where do I find my ID?"`);
    }
    playerId = playerId.toUpperCase();

    // Create reactive state before await so provide/inject works across async boundary.
    // Vue's provide() silently fails after await because getCurrentInstance() returns null.
    const backupRef = shallowRef<ei.IBackup>();
    const modifiers = computed<Modifiers>(() => {
      if (!backupRef.value) return { ...defaultModifiers };
      return allModifiersFromColleggtibles(backupRef.value);
    });
    provide('colleggtibleModifiers', modifiers);

    // Interval id used for refreshing lastRefreshedRelative.
    // Must be declared before the await below so onBeforeUnmount is registered synchronously.
    // eslint-disable-next-line prefer-const
    let refreshIntervalId: number | undefined;
    onBeforeUnmount(() => {
      clearInterval(refreshIntervalId);
    });

    const data = await requestFirstContact(playerId);
    if (!data.backup || !data.backup.game) {
      throw new UserBackupEmptyError(playerId);
    }
    const backup = data.backup;
    resolveColleggtibleContracts(backup);
    backupRef.value = backup;
    const nickname = backup.userName;
    const progress = backup.game;
    if (!progress) {
      throw new Error(`${playerId}: no game progress in backup`);
    }
    if (!backup.farms || backup.farms.length === 0) {
      throw new Error(`${playerId}: no farm info in backup`);
    }

    const farm = backup.farms[0]; // Home farm
    const homeFarm = new Farm(backup, backup.farms[0]);
    const egg = farm.eggType!;
    const lastRefreshedTimestamp = farm.lastStepTime! * 1000;
    const lastRefreshed = dayjs(Math.min(lastRefreshedTimestamp, Date.now()));
    const currentTimestamp = ref(Date.now());
    const lastRefreshedRelative = ref(lastRefreshed.fromNow());
    const lastRefreshedPopulation = farm.numChickens! as number;
    // Cap projected population at hab capacity
    const currentPopulation = computed(() =>
      Math.min(
        lastRefreshedPopulation + (offlineIHR.value / 60_000) * (currentTimestamp.value - lastRefreshedTimestamp),
        Math.max(lastRefreshedPopulation, totalHabSpace.value)
      )
    );

    const artifacts = homeFarmArtifacts(backup, true);
    const equippedArtiSet = new ArtifactSet(artifacts, false);

    // Create inventory and convert contender to artifact set with assembly statuses
    const inventory = new Inventory(backup.artifactsDb!, { virtue: true });
    // Calculate max clothed TE and optimal artifacts
    const maxClothedTEResult = computed(() =>
      calculateMaxClothedTE(backup, inventory, equippedArtiSet, modifiers.value)
    );
    const maxClothedTE = computed(() => maxClothedTEResult.value.clothedTE);
    const cteArtiSet = computed(() => maxClothedTEResult.value.recommendedArtifacts.artifactSet);
    const cteAssemblyStatuses = computed(() => maxClothedTEResult.value.recommendedArtifacts.assemblyStatuses);

    const assumeMaxPopulation = ref(true);
    const elrResult = computed(() =>
      getOptimalELRSet(backup, {
        modifiers: modifiers.value,
        assumeMaxPopulation: assumeMaxPopulation.value,
        currentPopulation: currentPopulation.value,
        equipped: equippedArtiSet,
      })
    );
    const elrArtiSet = computed(() => elrResult.value.artifactSet);
    const elrAssemblyStatuses = computed(() => elrResult.value.assemblyStatuses);

    refreshIntervalId = window.setInterval(() => {
      currentTimestamp.value = Date.now();
      lastRefreshedRelative.value = lastRefreshed.fromNow();
    }, 200);

    const totalShifts = computed(() => backup.virtue?.shiftCount || 0);
    const totalResets = computed(() => backup.virtue?.resets || 0);
    const nextShiftSE = computed(() => fmtApprox(nextShiftCost(backup)));
    const totalTruthEggs = computed(() => getNumTruthEggs(backup));
    const truthEggs = computed(() => backup.virtue?.eovEarned || [0, 0, 0, 0, 0]);
    const eovDelivered = computed(() => backup.virtue?.eggsDelivered || [0, 0, 0, 0, 0]);
    const totaleovDelivered = computed(() => eovDelivered.value.reduce((a, b) => a + b, 0));
    const truthEggsPending = computed(() => {
      return truthEggs.value.map((earned, index) => pendingTruthEggs(eovDelivered.value[index], earned) || 0);
    });
    const totalTruthEggsPending = computed(() => truthEggsPending.value.reduce((a, b) => a + b, 0));
    const activeEOVDelivered = eovDelivered.value[egg - 50];

    // Determine which truth egg thresholds have been discovered (reached by any virtue egg)
    const discoveredThresholds = computed(() => {
      const maxDelivered = Math.max(...eovDelivered.value);
      return TE_BREAKPOINTS.filter(threshold => maxDelivered >= threshold);
    });

    const habs = farmHabs(farm);
    const habSpaceResearches = farmHabSpaceResearches(farm);
    const habSpaces = computed(() => farmHabSpaces(habs, habSpaceResearches, artifacts, modifiers.value.habCap));
    const totalHabSpace = computed(() => Math.round(habSpaces.value.reduce((total, s) => total + s)));

    const totalVehicleSpace = computed(() =>
      farmShippingCapacity(farm, backup.game!, artifacts, modifiers.value.shippingCap)
    );
    const eggLayingRate = computed(() => farmEggLayingRate(farm, progress, artifacts) * modifiers.value.elr);
    const effectiveELR = computed(() => Math.min(eggLayingRate.value, totalVehicleSpace.value));
    // Adjust egg laying rate for current population
    const currentELR = computed(() =>
      Math.min((currentPopulation.value / lastRefreshedPopulation) * effectiveELR.value, totalVehicleSpace.value)
    );

    const clothedTE = computed(() => calculateClothedTE(backup, artifacts, modifiers.value));

    const internalHatcheryResearches = farmInternalHatcheryResearches(farm, progress);
    const ihrRates = computed(() =>
      farmInternalHatcheryRates(internalHatcheryResearches, artifacts, modifiers.value.ihr, totalTruthEggs.value)
    );
    const onlineIHRPerHab = computed(() => ihrRates.value.onlineRatePerHab);
    const onlineIHR = computed(() => ihrRates.value.onlineRate);
    const offlineIHR = computed(() => ihrRates.value.offlineRate);

    // Calculate eggs delivered using integration - handles hab capacity and shipping capacity scenarios
    const calculateEOVDelivered = (ihr: number) => {
      const timeElapsed = (currentTimestamp.value - lastRefreshedTimestamp) / 1000;
      const ihrPerSecond = ihr / 60;

      const maxEffectivePopulation = (totalVehicleSpace.value / eggLayingRate.value) * lastRefreshedPopulation;

      const effectiveCapacity = Math.min(totalHabSpace.value, maxEffectivePopulation);

      // If we're already at or above effective capacity, ELR is static
      if (lastRefreshedPopulation >= effectiveCapacity) {
        const staticELR = Math.min(eggLayingRate.value, totalVehicleSpace.value);
        const eggsDeliveredWhileOffline = staticELR * timeElapsed;
        return eovDelivered.value[egg - 50] + eggsDeliveredWhileOffline;
      }

      // If we reach effective capacity during this period
      if (currentPopulation.value >= effectiveCapacity) {
        // Calculate time to reach effective capacity
        const timeToCapacity = (effectiveCapacity - lastRefreshedPopulation) / ihrPerSecond;

        // Phase 1: Growing population until effective capacity is reached (use growth formula)
        const initialELR = eggLayingRate.value;
        const linearTerm1 = initialELR * timeToCapacity;
        const quadraticTerm1 =
          (initialELR * ihrPerSecond * timeToCapacity * timeToCapacity) / (2 * lastRefreshedPopulation);
        const eggsPhase1 = linearTerm1 + quadraticTerm1;

        // Phase 2: Static ELR after effective capacity is reached
        const timeAfterCapacity = timeElapsed - timeToCapacity;
        const staticELR = Math.min(
          eggLayingRate.value * (effectiveCapacity / lastRefreshedPopulation),
          totalVehicleSpace.value
        );
        const eggsPhase2 = staticELR * timeAfterCapacity;

        return eovDelivered.value[egg - 50] + eggsPhase1 + eggsPhase2;
      }

      // Population stays below effective capacity - use standard growth formula
      const linearTerm = eggLayingRate.value * timeElapsed;
      const quadraticTerm =
        (eggLayingRate.value * ihrPerSecond * timeElapsed * timeElapsed) / (2 * lastRefreshedPopulation);
      const eggsDeliveredWhileOffline = linearTerm + quadraticTerm;

      return eovDelivered.value[egg - 50] + eggsDeliveredWhileOffline;
    };
    const activeEOVDeliveredAdjusted = computed(() => ({
      offline: calculateEOVDelivered(offlineIHR.value),
      online: calculateEOVDelivered(onlineIHR.value),
    }));
    const truthEggsPendingAdjusted = computed(() => ({
      offline: pendingTruthEggs(activeEOVDeliveredAdjusted.value.offline, truthEggs.value[egg - 50]) || 0,
      online: pendingTruthEggs(activeEOVDeliveredAdjusted.value.online, truthEggs.value[egg - 50]) || 0,
    }));

    const { isVisibleSection, toggleSectionVisibility } = useSectionVisibility();

    const TARGET_TE_LOCALSTORAGE_KEY = 'targetTE';
    const THRESHOLD_SPOILERS_LOCALSTORAGE_KEY = 'showThresholdSpoilers';
    const SHOW_HAB_VEHICLE_ICONS_KEY = 'showHabVehicleIcons';

    const truthEggsWithPending = computed(() =>
      truthEggs.value.map((earned, index) => earned + truthEggsPending.value[index])
    );
    const defaultTargetTE = computed(() =>
      Math.max(Math.min(...truthEggsWithPending.value) + 5, Math.max(...truthEggsWithPending.value))
    );

    const savedTargetTE = ref(parseInt(getLocalStorage(TARGET_TE_LOCALSTORAGE_KEY) || '') || defaultTargetTE.value);
    const targetTE = ref(
      Math.min(98, savedTargetTE.value < defaultTargetTE.value ? defaultTargetTE.value : savedTargetTE.value)
    );
    const showThresholdSpoilers = ref(getLocalStorage(THRESHOLD_SPOILERS_LOCALSTORAGE_KEY) === 'true'); // Default to false
    const showHabVehicleIcons = ref(getLocalStorage(SHOW_HAB_VEHICLE_ICONS_KEY) !== 'false'); // Default to true

    // eslint-disable-next-line vue/no-watch-after-await
    watch(targetTE, () => {
      // Clamp to max of 98
      if (targetTE.value > 98) {
        targetTE.value = 98;
      }
      setLocalStorage(TARGET_TE_LOCALSTORAGE_KEY, targetTE.value.toString());
    });

    // eslint-disable-next-line vue/no-watch-after-await
    watch(showThresholdSpoilers, () => {
      setLocalStorage(THRESHOLD_SPOILERS_LOCALSTORAGE_KEY, showThresholdSpoilers.value);
    });

    // eslint-disable-next-line vue/no-watch-after-await
    watch(showHabVehicleIcons, () => {
      setLocalStorage(SHOW_HAB_VEHICLE_ICONS_KEY, showHabVehicleIcons.value.toString());
    });

    const earningsSectionRef = ref<InstanceType<typeof EarningsSection>>();

    const setCashTarget = (amount: number) => {
      earningsSectionRef.value?.setCashTarget(amount);
    };

    const addCashTarget = (amount: number) => {
      earningsSectionRef.value?.addCashTarget(amount);
    };

    return {
      // Basic farm info
      nickname,
      lastRefreshed,
      lastRefreshedRelative,
      egg,
      virtueEggs,
      artifacts,
      backup,
      homeFarm,

      // Artifact Sets
      equippedArtiSet,
      cteArtiSet,
      cteAssemblyStatuses,
      elrArtiSet,
      elrAssemblyStatuses,
      assumeMaxPopulation,

      // Population & timing
      currentPopulation,
      totalHabSpace,
      currentTimestamp,

      // Earnings data
      clothedTE,
      maxClothedTE,

      // Internal hatchery
      internalHatcheryResearches,
      onlineIHR,
      onlineIHRPerHab,
      offlineIHR,

      // Truth eggs
      truthEggs,
      totalTruthEggs,
      truthEggsPending,
      totalTruthEggsPending,
      eovDelivered,
      totaleovDelivered,
      currentELR,
      activeEOVDelivered,
      activeEOVDeliveredAdjusted,
      truthEggsPendingAdjusted,
      discoveredThresholds,

      // Virtue tracking
      totalShifts,
      totalResets,
      nextShiftSE,
      targetTE,
      showThresholdSpoilers,
      showHabVehicleIcons,

      // UI helpers
      isVisibleSection,
      toggleSectionVisibility,
      formatWithThousandSeparators,
      iconURL,
      earningsSectionRef,
      setCashTarget,
      addCashTarget,
    };
  },
});
</script>
