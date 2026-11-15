<template>
  <div class="-mx-4 sm:mx-0 bg-gray-50 overflow-hidden sm:rounded-lg sm:shadow-md">
    <div class="bg-gray-100 px-4 py-4 border-b border-gray-200 sm:px-6">
      <div class="-ml-4 -mt-2 flex items-center justify-between flex-wrap sm:flex-nowrap">
        <div class="ml-4 mt-2 flex flex-wrap items-center space-x-1">
          <mission-name :mission="mission" :no-link="true" />
          <div
            v-tippy="{
              content:
                `FTL Drive Upgrades: <span class='text-green-200'>${config.epicResearchFTLLevel}/60</span><br>` +
                `Zero-g Quantum Containment: <span class='text-green-200'>${config.epicResearchZerogLevel}/10</span>`,
              allowHTML: true,
            }"
            class="inline-flex items-center text-sm"
          >
            ({{ selectedLevel }}<star-icon class="h-4 w-4 text-yellow-400" />,
            {{ mission.boostedCapacity(configWithSelectedLevel) }} capacity,
            {{ mission.boostedDurationDisplay(configWithSelectedLevel) }})
          </div>
        </div>
        <div class="ml-4 mt-2 flex-shrink-0">
          <share :id="mission.missionTypeId" :page="'mission'" />
        </div>
      </div>
    </div>

    <div class="px-4 py-4 sm:px-6 space-y-2">
      <config-prompt />
      <loot-data-credit />

      <div>
        <div class="flex sm:hidden items-center space-x-1.5">
          <select
            class="block focus:ring-green-500 focus:border-green-500 border-gray-300 rounded-md py-0.5 text-sm"
            :value="selectedLevel"
            @input="selectLevel"
          >
            <option v-for="levelLoot in loot.levels" :key="levelLoot.level">
              {{ levelLoot.level }}
            </option>
          </select>
          <star-icon class="h-5 w-5 text-yellow-400" />
        </div>
        <div class="hidden sm:block">
          <div class="border-b border-gray-200">
            <nav class="-mb-px flex space-x-2">
              <div
                v-for="levelLoot in loot.levels"
                :key="levelLoot.level"
                :class="[
                  levelLoot.level === selectedLevel
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 cursor-pointer',
                  'group inline-flex items-center py-1 px-1 border-b-2 font-medium text-sm',
                ]"
                @click="forceLevel(levelLoot.level)"
              >
                {{ levelLoot.level }}<star-icon class="h-4 w-4 text-yellow-400" />
              </div>
            </nav>
          </div>
        </div>
        <div v-if="mission.isFTL" class="flex lg:hidden items-center space-x-1.5">
          <select
            class="block focus:ring-green-500 focus:border-green-500 border-gray-300 rounded-md py-0.5 text-sm"
            :value="titleCase(getTargetName(selectedTarget))"
            @input="selectTarget"
          >
            <option v-for="(arti, index) in targets" :key="index">
              {{ titleCase(getTargetName(arti)) }}
            </option>
          </select>
        </div>
        <div v-if="mission.isFTL" class="hidden lg:block">
          <div class="border-b border-gray-200">
            <nav class="-mb-px flex">
              <div
                v-for="arti in targets"
                :key="arti"
                :class="[
                  arti === selectedTarget
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 cursor-pointer',
                  'group inline-flex items-center py-1 px-0.5 border-b-2 font-medium text-sm',
                ]"
                @click="selectedTarget = arti"
              >
                <img
                  v-if="arti != 10000"
                  class="h-6 w-6 min-w-full"
                  :src="id2url(arti, 32)"
                  :alt="getTargetName(arti)"
                />
                <template v-else> Untargeted </template>
              </div>
            </nav>
          </div>
        </div>
      </div>

      <div class="flex rounded-md">
        <span
          class="inline-flex items-center text-xs px-2 rounded-l-md border border-r-0 border-gray-300 bg-gray-100 text-gray-500"
        >
          Sort by
        </span>
        <select
          v-model="sortBy"
          class="text-xs pr-8 py-1 rounded-none rounded-r-md text-gray-500 bg-white border-gray-300 focus:outline-none focus:ring-0 focus:ring-gray-300 focus:border-gray-300"
        >
          <option :value="ItemsSortBy.Family">Family</option>
          <option :value="ItemsSortBy.Quality">Quality</option>
          <option :value="ItemsSortBy.DropRate">Drop rate</option>
        </select>
      </div>

      <p v-if="tooLittleDataForSelectedLevel" class="text-xs text-gray-500">
        Too little data has been collected for this level/target combo; highly inaccurate drop rate estimates are not
        shown. Please consider opting in to contribute yours on rockets tracker
      </p>

      <ul class="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="itemLoot in sortedItemsLoot" :key="itemLoot.itemId" class="flex flex-wrap items-start text-sm">
          <artifact-name
            class="w-full xs:w-auto xs:mr-1.5"
            :artifact="getArtifactTierPropsFromId(itemLoot.itemId)"
            :show-tier="true"
            :limit-width="true"
          />
          <drop-rate
            class="text-green-700 ml-5 xs:ml-auto"
            :mission="mission"
            :level="selectedLevel + 1"
            :total-drops="selectedLevelTargetLoot?.totalDrops ?? 0"
            :item-drops="itemLoot.counts"
            :is-artifact="artifactItemIds.includes(itemLoot.itemId)"
            :hide-when-not-enough="true"
          />
        </li>
      </ul>

      <template v-if="!tooLittleDataForSelectedLevel">
        <hr />

        <p class="text-sm">
          Expected full consumption value from mission loot:
          <base-info
            v-tippy="{
              content: `<span class='text-blue-300'>Full consumption value</span> is the number of golden eggs / piggy fill obtained from recursively consuming all loot items, that is, for artifacts yielding stones and fragments, the resulting items are further broken down into GE/Piggy Fill. Uncommon items are demoted first before consumption.`,
              allowHTML: true,
            }"
            class="inline"
          />
          <br />
          <!-- Raw GE per ship -->
          <span class="inline-flex items-center text-yellow-500 whitespace-nowrap">
            {{ formatToPrecision(selectedLevelExpectedFullConsumptionValuePerShip[0], precision[0]) }}
            <img class="h-4 w-4 ml-px" :src="iconURL('egginc-extras/icon_golden_egg.png', 64)" />
            /<img class="h-4 w-4 ml-px" :src="iconURL(mission.shipIconPath, 32)" /> </span
          >,
          <span class="whitespace-nowrap">
            <span class="text-yellow-500">
              {{ formatToPrecision(selectedLevelExpectedFullConsumptionValuePerDay[0], precision[0]) }}/d
            </span>
            (1 mission slot)</span
          >,
          <span class="whitespace-nowrap">
            <span class="text-yellow-500">
              {{ formatToPrecision(selectedLevelExpectedFullConsumptionValuePerDay[0] * 3, precision[0]) }}/d
            </span>
            (3 mission slots)</span
          >.
          <br />
          <!-- Piggy fill per ship-->
          <span class="inline-flex items-center text-yellow-500 whitespace-nowrap">
            {{ formatToPrecision(selectedLevelExpectedFullConsumptionValuePerShip[1], precision[1]) }}
            <img class="h-4 w-4 ml-px" :src="iconURL('egginc-extras/icon_piggy_golden_egg.png', 64)" />
            /<img class="h-4 w-4 ml-px" :src="iconURL(mission.shipIconPath, 32)" /></span
          >,
          <span class="whitespace-nowrap">
            <span class="text-yellow-500">
              {{ formatToPrecision(selectedLevelExpectedFullConsumptionValuePerDay[1], precision[1]) }}/d
            </span>
            (1 mission slot)</span
          >,
          <span class="whitespace-nowrap">
            <span class="text-yellow-500">
              {{ formatToPrecision(selectedLevelExpectedFullConsumptionValuePerDay[1] * 3, precision[0]) }}/d
            </span>
            (3 mission slots)</span
          >.
          <br />
          <a
            href="https://wasmegg-carpet.netlify.app/consumption-sheet/"
            target="_blank"
            class="inline-flex items-center border-dashed border-b border-gray-700 text-sm whitespace-nowrap leading-tight space-x-0.5"
          >
            <span>Detailed consumption data</span>
            <svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </p>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, toRefs, watch } from 'vue';
import { StarIcon } from '@heroicons/vue/solid';

import {
  allPossibleTiers,
  noFragTargets as allTargets,
  ei,
  getArtifactTierPropsFromId,
  getLocalStorage,
  getMissionTypeFromId,
  iconURL,
  setLocalStorage,
  getTargetName,
  getImageUrlFromId as id2url,
  getTargetId,
  titleCase,
} from 'lib';
import {
  cmpArtifactTiers,
  getMissionLevelLootAverageConsumptionValue,
  getMissionLootData,
  missionDataNotEnough,
} from '@/lib';
import { config, configWithCustomShipLevel } from '@/store';
import { formatToPrecision, sum } from '@/utils';
import BaseInfo from 'ui/components/BaseInfo.vue';
import ArtifactName from '@/components/ArtifactName.vue';
import ConfigPrompt from '@/components/ConfigPrompt.vue';
import DropRate from '@/components/DropRate.vue';
import LootDataCredit from '@/components/LootDataCredit.vue';
import MissionName from 'ui/components/mission-optimizer/MissionName.vue';
import Share from '@/components/Share.vue';

enum ItemsSortBy {
  Family = 'family',
  Quality = 'quality',
  DropRate = 'dropRate',
}

const MISSION_ITEMS_SORT_BY_LOCALSTORAGE_KEY = 'missionItemsSortBy';

function isItemsSortyBy(s: string): s is ItemsSortBy {
  return Object.values(ItemsSortBy).includes(s as ItemsSortBy);
}

function loadItemsSortBy(): ItemsSortBy {
  const s = getLocalStorage(MISSION_ITEMS_SORT_BY_LOCALSTORAGE_KEY);
  if (!s || !isItemsSortyBy(s)) {
    return ItemsSortBy.Family;
  }
  return s;
}

// List of item ids of artifacts only, excluding stones and ingredients.
const artifactItemIds = allPossibleTiers.filter(t => t.afx_type === ei.ArtifactSpec.Type.ARTIFACT).map(t => t.id);

export default defineComponent({
  components: {
    ArtifactName,
    BaseInfo,
    ConfigPrompt,
    DropRate,
    LootDataCredit,
    MissionName,
    Share,
    StarIcon,
  },
  props: {
    missionId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { missionId } = toRefs(props);
    const mission = computed(() => getMissionTypeFromId(missionId.value));

    const configuredLevel = computed(() => config.value.shipLevels[mission.value.shipType]);
    const selectedLevel = ref(configuredLevel.value);
    const forceLevel = (level: number) => {
      selectedLevel.value = level;
    };
    const selectLevel = (event: Event) => {
      forceLevel(parseInt((event.target! as HTMLSelectElement).value));
    };
    watch(configuredLevel, (current, prev) => {
      if (selectedLevel.value === prev) {
        selectedLevel.value = current;
      }
    });
    const defaultTarget = ei.ArtifactSpec.Name.UNKNOWN;
    const selectedTarget = ref(defaultTarget);
    const getSelectedTarget = computed(() => {
      return mission.value.isFTL ? selectedTarget.value : defaultTarget;
    });
    const selectTarget = (event: Event) => {
      const x = getTargetId((event.target! as HTMLSelectElement).value);
      selectedTarget.value = x;
    };

    const sortBy = ref(loadItemsSortBy());
    watch(sortBy, () => {
      setLocalStorage(MISSION_ITEMS_SORT_BY_LOCALSTORAGE_KEY, sortBy.value);
    });

    const loot = computed(() => getMissionLootData(missionId.value));
    const selectedLevelLoot = computed(() => loot.value.levels.at(selectedLevel.value) ?? loot.value.levels[0]);
    if (loot.value.levels.at(selectedLevel.value) === undefined) {
      forceLevel(0);
    }

    const selectedLevelTargetLoot = computed(() =>
      selectedLevelLoot.value.targets.find(x => x.targetAfxId === getSelectedTarget.value)
    );

    const targets = computed(() =>
      config.value.showNodata
        ? allTargets
        : allTargets.filter(
            target =>
              target == ei.ArtifactSpec.Name.UNKNOWN ||
              !missionDataNotEnough(
                mission.value,
                selectedLevelLoot.value.targets.find(loot => loot.targetAfxId === target)?.totalDrops ?? 0
              )
          )
    );

    const tooLittleDataForSelectedLevel = computed(() =>
      selectedLevelTargetLoot.value
        ? missionDataNotEnough(mission.value, selectedLevelTargetLoot.value.totalDrops)
        : true
    );

    const sortedItemsLoot = computed(() =>
      selectedLevelTargetLoot.value
        ? [...selectedLevelTargetLoot.value.items].sort((i1, i2) => {
            const item1 = getArtifactTierPropsFromId(i1.itemId);
            const item2 = getArtifactTierPropsFromId(i2.itemId);
            let cmp = 0;
            switch (sortBy.value) {
              case ItemsSortBy.Quality:
                cmp = item1.quality - item2.quality;
                break;
              case ItemsSortBy.DropRate:
                // Higher drop rates first.
                cmp = sum(i2.counts) - sum(i1.counts);
                break;
            }
            if (cmp !== 0) {
              return cmp;
            }
            return cmpArtifactTiers(item1, item2);
          })
        : []
    );

    const configWithSelectedLevel = computed(() =>
      configWithCustomShipLevel(mission.value.shipType, selectedLevel.value)
    );
    const selectedLevelCapacity = computed(() => mission.value.boostedCapacity(configWithSelectedLevel.value));
    const selectedLevelDurationDays = computed(
      () => mission.value.boostedDurationSeconds(configWithSelectedLevel.value) / 86400
    );
    const selectedLevelExpectedFullConsumptionValuePerShip = computed(() => {
      const consumationValue = computed(() =>
        getMissionLevelLootAverageConsumptionValue(selectedLevelLoot.value, getSelectedTarget.value)
      );
      return [
        consumationValue.value[0] * selectedLevelCapacity.value,
        consumationValue.value[1] * selectedLevelCapacity.value,
      ];
    });
    const selectedLevelExpectedFullConsumptionValuePerDay = computed(() => [
      selectedLevelExpectedFullConsumptionValuePerShip.value[0] / selectedLevelDurationDays.value,
      selectedLevelExpectedFullConsumptionValuePerShip.value[1] / selectedLevelDurationDays.value,
    ]);
    // It's hard to decide the precision here. We have the sum of a (for
    // simplicity, let's assume) normally distributed sample and we want to know
    // the error of the mean... Maybe it's possible to determine, but I'm pretty
    // bad at statistics so I don't know. So instead I use a random heuristics:
    // 2-19 samples, 2 significant figures; 20-199 samples, 3 siginificant
    // figures; etc. The number of samples is the number of base-capacity
    // shiploads.
    //
    // We also limit the precision to integer for the per-ship value.
    const precision = computed(() => {
      const perShipGe = Math.round(selectedLevelExpectedFullConsumptionValuePerShip.value[0]);
      const perShipPiggy = Math.round(selectedLevelExpectedFullConsumptionValuePerShip.value[1]);
      const nSamples = Math.round((selectedLevelTargetLoot.value?.totalDrops ?? 0) / mission.value.defaultCapacity);
      return [
        Math.min(`${perShipGe}`.length, `${nSamples * 5}`.length),
        Math.min(`${perShipPiggy}`.length, `${nSamples * 5}`.length),
      ];
    });

    return {
      mission,
      selectedLevel,
      configWithSelectedLevel,
      ItemsSortBy,
      sortBy,
      loot,
      selectedLevelLoot,
      selectTarget,
      selectedTarget,
      selectedLevelTargetLoot,
      tooLittleDataForSelectedLevel,
      selectedLevelExpectedFullConsumptionValuePerShip,
      selectedLevelExpectedFullConsumptionValuePerDay,
      precision,
      selectLevel,
      forceLevel,
      getTargetName,
      sortedItemsLoot,
      config,
      getArtifactTierPropsFromId,
      artifactItemIds,
      formatToPrecision,
      titleCase,
      iconURL,
      id2url,
      missionDataNotEnough,
      targets,
    };
  },
});
</script>
