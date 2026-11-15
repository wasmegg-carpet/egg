<template>
  <template v-if="sortedMissions.length > 0">
    <div class="text-sm font-medium text-gray-500">
      <span class="mr-1.5">Available from the following missions:</span>
      <button class="font-normal underline" @click="expand = !expand">
        <template v-if="expand">Collapse</template><template v-else>Expand</template>
      </button>
    </div>

    <template v-if="expand">
      <config-prompt />
      <loot-data-credit />

      <div v-for="m in sortedMissions" :key="m.missionId + m.loot.targetAfxId">
        <!-- Show target drop rate if user selected it or if target matches artifact -->
        <div>
          <mission-name :mission="m.mission" :target="m.loot.targetAfxId" />
        </div>
        <ul class="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-3 mt-1">
          <li v-for="level in m.mission.maxLevel + 1" :key="level" class="text-sm">
            <span
              class="inline-flex items-center tabular-nums"
              :class="levelIsSelected(m.mission, level - 1) ? 'text-green-700' : null"
              >{{ level - 1 }}<star-icon class="h-4 w-4 text-yellow-400" />:</span
            >&nbsp;

            <template v-if="m.loot.levels.find(x => x.level === level - 1)">
              <drop-rate
                :mission="m.mission"
                :level="level"
                :total-drops="m.loot.levels.find(x => x.level === level - 1)!.totalDrops"
                :item-drops="m.loot.levels.find(x => x.level === level - 1)!.counts"
                :is-artifact="isArtifact"
                :highlight="levelIsSelected(m.mission, level - 1)"
              />
            </template>
            <template v-else>
              <span :class="levelIsSelected(m.mission, level - 1) ? 'text-green-700' : 'text-gray-500'"
                >Not enough data</span
              >
            </template>
          </li>
        </ul>
      </div>
    </template>
  </template>
  <div v-else class="text-sm font-medium text-gray-500">
    <template v-if="getArtifactTierPropsFromId(artifactId).available_from_missions">
      No drops recorded in selected ships :(
      <config-prompt />
    </template>
    <template v-else> Not available from missions :( </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, toRefs } from 'vue';
import { StarIcon } from '@heroicons/vue/solid';

import {
  ei,
  getArtifactTierPropsFromId,
  getLocalStorage,
  getMissionTypeFromId,
  MissionType,
  getImageUrlFromId as id2url,
  afxMatchesTarget,
} from 'lib';
import { ItemMissionLootStore, getTierLootData, missionDataNotEnough } from '@/lib';
import { config } from '@/store';
import { sum } from '@/utils';
import ConfigPrompt from '@/components/ConfigPrompt.vue';
import DropRate from '@/components/DropRate.vue';
import LootDataCredit from '@/components/LootDataCredit.vue';
import MissionName from 'ui/components/mission-optimizer/MissionName.vue';

const COLLAPSE_ARTIFACT_DROP_RATES_LOCALSTORAGE_KEY = 'expandArtifactDropRates';

export default defineComponent({
  components: {
    MissionName,
    ConfigPrompt,
    DropRate,
    LootDataCredit,
    StarIcon,
  },
  props: {
    artifactId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { artifactId } = toRefs(props);
    const isArtifact = computed(
      () => getArtifactTierPropsFromId(artifactId.value).afx_type === ei.ArtifactSpec.Type.ARTIFACT
    );
    const afxId = computed(() => getArtifactTierPropsFromId(artifactId.value).afx_id);
    const expand = ref(getLocalStorage(COLLAPSE_ARTIFACT_DROP_RATES_LOCALSTORAGE_KEY) !== 'true');
    const loot = computed(() => getTierLootData(artifactId.value, config.value.targets));
    const filteredMissions = computed(() => {
      let filtered: ItemMissionLootStore[] = [];
      if (config.value.onlyHenners) {
        if (config.value.onlyLiners) {
          filtered = loot.value.missions.filter(x => x.afxShip >= ei.MissionInfo.Spaceship.HENERPRISE);
        } else {
          filtered = loot.value.missions.filter(x => x.afxShip === ei.MissionInfo.Spaceship.HENERPRISE);
        }
      } else if (config.value.onlyLiners) {
        filtered = loot.value.missions.filter(x => x.afxShip === ei.MissionInfo.Spaceship.ATREGGIES);
      }

      const baseMissions = filtered.length > 0 ? filtered : loot.value.missions;

      // Filter by ship visibility
      return baseMissions.filter(x => config.value.shipVisibility[x.afxShip]);
    });
    const missions = computed(() =>
      filteredMissions.value.map(missionLoot => {
        const missionId = missionLoot.missionId;
        const mission = getMissionTypeFromId(missionId);
        let maxExpectedDropsPerDay = 0;
        let selectedExpectedDropsPerDay = 0;
        for (const levelLoot of missionLoot.levels) {
          const totalDrops = levelLoot.totalDrops;
          if (
            missionDataNotEnough(mission, totalDrops) ||
            mission.durationTypeName == 'Tutorial' ||
            !(targetIsSelected(missionLoot.targetAfxId) || afxMatchesTarget(afxId.value, missionLoot.targetAfxId))
          ) {
            continue;
          }
          const shipLevels = { ...config.value.shipLevels };
          shipLevels[mission.shipType] = levelLoot.level;
          const customConfig = {
            ...config.value,
            shipLevels,
          };
          const missionCapacity = mission.boostedCapacity(customConfig);
          const missionDurationDays = mission.boostedDurationSeconds(customConfig) / 86400;
          const itemTotalDrops = sum(levelLoot.counts);
          const expectedDropsPerMission = totalDrops > 0 ? (itemTotalDrops / totalDrops) * missionCapacity : 0;
          const expectedDropsPerDay = expectedDropsPerMission / missionDurationDays;
          if (expectedDropsPerDay > maxExpectedDropsPerDay) {
            maxExpectedDropsPerDay = expectedDropsPerDay;
          }
          if (levelIsSelected(mission, levelLoot.level)) {
            selectedExpectedDropsPerDay = expectedDropsPerDay;
          }
        }
        return {
          missionId,
          mission,
          loot: missionLoot,
          maxExpectedDropsPerDay,
          selectedExpectedDropsPerDay,
        };
      })
    );
    const sortedMissions = computed(() =>
      [...missions.value]
        .filter(m => showShip(m.mission, afxId.value, m.loot))
        .sort((m1, m2) => {
          // Missions with better expected drops per day come first.
          // Sort by drop rate of selected star levels if there is data, else use max expected drops
          const m2expected =
            m2.selectedExpectedDropsPerDay > 0 ? m2.selectedExpectedDropsPerDay : m2.maxExpectedDropsPerDay;
          const m1expected =
            m1.selectedExpectedDropsPerDay > 0 ? m1.selectedExpectedDropsPerDay : m1.maxExpectedDropsPerDay;
          let cmp = m2expected - m1expected;
          if (cmp !== 0) {
            return cmp;
          }
          cmp = m1.mission.shipType - m2.mission.shipType;
          if (cmp !== 0) {
            return cmp;
          }
          return m1.mission.durationType - m2.mission.durationType;
        })
    );
    const targetIsSelected = (artifact: ei.ArtifactSpec.Name) => config.value.targets[artifact];
    const levelIsSelected = (mission: MissionType, level: number) =>
      config.value.shipLevels[mission.shipType] === level;
    // show if not tutorial ship and (user selected the target or target matches selected arti) and there are any drops of it
    const showShip = (mission: MissionType, afxId: ei.ArtifactSpec.Name, missionLoot: ItemMissionLootStore) =>
      mission.durationTypeName != 'Tutorial' &&
      (targetIsSelected(missionLoot.targetAfxId) || afxMatchesTarget(afxId, missionLoot.targetAfxId)) &&
      missionLoot.levels.some(x => x.totalDrops > 0);
    return {
      ei,
      config,
      isArtifact,
      afxMatchesTarget,
      afxId,
      expand,
      loot,
      id2url,
      getMissionTypeFromId,
      sortedMissions,
      getArtifactTierPropsFromId,
      levelIsSelected,
      targetIsSelected,
    };
  },
});
</script>
