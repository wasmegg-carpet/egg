<template>
  <component
    :is="noLink ? 'div' : 'router-link'"
    :to="noLink ? undefined : { name: 'mission', params: { missionId: mission.missionTypeId } }"
  >
    <div class="flex">
      <div
        v-tippy="{
          content: `<img data-src='${iconURL(
            mission.shipIconPath,
            256
          )}' class='h-36 w-36 p-1.5 rounded-full border-2 ${durationBorderClass(mission.durationType)}'>`,
          allowHTML: true,
        }"
        class="flex items-center"
      >
        <div class="flex-shrink-0 h-5 w-5">
          <img
            class="h-5 w-5 p-px rounded-full border"
            :class="durationBorderClass(mission.durationType)"
            :src="iconURL(mission.shipIconPath, 32)"
          />
        </div>
        <span class="ml-1 text-sm"
          >{{ mission.name }}
          <span v-if="target !== undefined" class="font-bold">
            <template v-if="target !== 10000">
              <img class="inline-flex h-6 w-6" :src="id2url(target, 32)" :alt="ei.ArtifactSpec.Name[target]" />
              {{
                getTargetName(target)
                  .split(' ')
                  .map(x => x[0].toUpperCase() + x.substring(1).toLowerCase())
                  .join(' ')
              }}
              Target
            </template>
            <template v-else> &nbsp;No Target </template>
          </span>
        </span>
      </div>
    </div>
  </component>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import { ei, getTargetName, iconURL, MissionType, getImageUrlFromId as id2url } from 'lib';

// Kept in this file rather than a shared module: Tailwind only scans `ui/**/*.vue` in the apps that
// render this component, so the class names have to be spelled out where it can see them.
function durationBorderClass(durationType: ei.MissionInfo.DurationType) {
  switch (durationType) {
    case ei.MissionInfo.DurationType.SHORT:
      return 'border-blue-500';
    case ei.MissionInfo.DurationType.LONG:
      return 'border-purple-500';
    case ei.MissionInfo.DurationType.EPIC:
      return 'border-yellow-500';
    default:
      return '';
  }
}

export default defineComponent({
  props: {
    mission: {
      type: Object as PropType<MissionType>,
      required: true,
    },
    target: {
      type: Number as PropType<ei.ArtifactSpec.Name>,
      required: false,
      default: undefined,
    },
    noLink: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    return {
      ei,
      getTargetName,
      iconURL,
      id2url,
      durationBorderClass,
    };
  },
});
</script>
