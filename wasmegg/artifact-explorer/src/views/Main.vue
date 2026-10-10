<template>
  <spoiler-alert class="my-4" />
  <mission-selector :key="route.path" v-model="selectedMissionId" class="my-4" />
  <artifact-selector :key="route.path" v-model="selectedArtifactId" class="my-4" />
  <tank-artifact-selector v-model="selectedTankArtifactIds" class="my-4" />
  <p class="my-4 text-sm text-gray-500">For a Humility cycle, select targets and load an ascension plan.</p>
  <router-view name="mission" />
  <div class="my-4 text-xs text-red-900">
    <p class="font-medium">Artifact notes:</p>
    <p>
      * Certain effect values shown may be 1% higher than the corresponding in-game values; those are caused by
      erroneous floating point handling in the game, i.e. values here are correct.
    </p>
    <p>&dagger; Artifacts marked with &dagger; are not available from missions.</p>
  </div>
  <router-view name="artifact" />
  <fuel-tank-planner v-if="selectedTankArtifactIds.length > 0" :artifact-ids="selectedTankArtifactIds" />
  <artifact-grid />
</template>

<script lang="ts">
import { computed, defineComponent, PropType, ref, toRefs, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { parseKnownTankIds } from '@/lib/filter';
import { offPlanTankTargets } from '@/store';
import { activePlanVisit, activeVisitSettings, setVisitTargets } from '@/store/plan';
import SpoilerAlert from '@/components/SpoilerAlert.vue';
import ArtifactGrid from '@/components/ArtifactGrid.vue';
import ArtifactSelector from '@/components/ArtifactSelector.vue';
import TankArtifactSelector from '@/components/TankArtifactSelector.vue';
import MissionSelector from '@/components/MissionSelector.vue';
import FuelTankPlanner from '@/views/FuelTankPlanner.vue';

export default defineComponent({
  components: {
    SpoilerAlert,
    ArtifactGrid,
    ArtifactSelector,
    TankArtifactSelector,
    MissionSelector,
    FuelTankPlanner,
  },
  props: {
    missionId: {
      type: String as PropType<string | null>,
      default: null,
    },
    artifactId: {
      type: String as PropType<string | null>,
      default: null,
    },
    tankPlannerArtifactId: {
      type: String as PropType<string | null>,
      default: null,
    },
  },
  setup(props) {
    const router = useRouter();
    const route = useRoute();
    const { missionId, artifactId, tankPlannerArtifactId } = toRefs(props);

    const selectedMissionId = ref(missionId.value);
    watch(missionId, current => {
      selectedMissionId.value = current;
    });
    watch(selectedMissionId, current => {
      if (current !== null) {
        router.push({
          name: 'mission',
          params: { missionId: current },
        });
      }
    });

    const selectedArtifactId = ref(artifactId.value);
    watch(artifactId, current => {
      selectedArtifactId.value = current;
    });
    watch(selectedArtifactId, current => {
      if (current !== null) {
        router.push({
          name: 'artifact',
          params: { artifactId: current },
        });
      }
    });

    // Edit the active visit's targets, or the standalone selection. Changes do not navigate.
    const selectedTankArtifactIds = computed<string[]>({
      get: () => activeVisitSettings.value?.targetIds ?? offPlanTankTargets.value,
      set: ids => {
        const visit = activePlanVisit.value;
        if (visit) setVisitTargets(visit.visitId, ids);
        else offPlanTankTargets.value = [...ids];
      },
    });

    // Import targets from legacy links on arrival, then return to the home route.
    watch(
      tankPlannerArtifactId,
      current => {
        if (current === null) return;
        const ids = parseKnownTankIds(current);
        if (ids.length > 0) selectedTankArtifactIds.value = ids;
        router.replace({ name: 'home' });
      },
      { immediate: true }
    );

    return {
      route,
      selectedMissionId,
      selectedArtifactId,
      selectedTankArtifactIds,
    };
  },
});
</script>
