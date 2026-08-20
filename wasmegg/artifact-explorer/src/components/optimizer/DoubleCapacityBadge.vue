<template>
  <span
    v-tippy="'Double capacity: this launch flies inside the 2× mission capacity event and brings home twice the loot.'"
    class="inline-flex h-4 w-6 rounded-full bg-fuchsia-500 flex-shrink-0 cursor-help"
  >
    <img
      class="h-4 w-full object-contain"
      :src="iconURL(MISSION_CAPACITY_EVENT_ICON, 64)"
      alt="Flies at double capacity"
    />
  </span>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import { iconURL } from 'lib';

// The asset and the fuchsia are duplicated from the event calendar's (`wasmegg/events`) `mission-capacity`
// entry, which exposes them only through an `EventType` keyed by calendar entry. If the calendar recolours
// the event, match it here.
const MISSION_CAPACITY_EVENT_ICON = 'egginc/icon_afx_chest_2.png';

export default defineComponent({
  setup() {
    return { iconURL, MISSION_CAPACITY_EVENT_ICON };
  },
});
</script>
