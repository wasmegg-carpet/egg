<template>
  <div class="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 flex flex-wrap items-center gap-x-2 gap-y-1">
    <span>
      <span class="font-semibold text-gray-900">{{ note.earningsLevelsLeft }}</span>
      earnings research {{ note.earningsLevelsLeft === 1 ? 'level' : 'levels' }} left in
      {{ note.highestUnlockedTier === 1 ? 'tier 1' : `tiers 1–${note.highestUnlockedTier}` }}.
    </span>
    <template v-if="note.nextTier !== null">
      <span>
        Tier {{ note.nextTier }} needs
        <span class="font-semibold text-gray-900">{{ note.purchasesNeeded }}</span>
        more {{ note.purchasesNeeded === 1 ? 'purchase' : 'purchases' }}<template v-if="!computing && note.pathSeconds !== null"
          >: about
          <span
            v-tippy="'Time to unlock it on the Milestones path, buying whatever pays for itself fastest along the way.'"
            class="font-mono font-semibold text-gray-900 cursor-help"
            >{{ formatDuration(note.pathSeconds) }}</span
          ></template
        ><template v-else-if="!computing && note.pathTruncated">, too far off to time</template>.
      </span>
      <svg
        v-if="computing"
        class="animate-spin h-3 w-3 text-gray-400"
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Working out the time to unlock"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <button
        v-if="showPathButton"
        type="button"
        class="ml-auto text-indigo-600 hover:text-indigo-800 font-semibold"
        @click="$emit('showPath')"
      >
        Show path
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { formatDuration } from '@planner/lib/format';
import type { useResearchViews } from 'lib/planners/composables/useResearchViews';

type TierUnlockNote = NonNullable<ReturnType<typeof useResearchViews>['tierUnlockNote']['value']>;

defineProps<{ note: TierUnlockNote; computing: boolean; showPathButton: boolean }>();
defineEmits<{ showPath: [] }>();
</script>
