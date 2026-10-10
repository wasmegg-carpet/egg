<template>
  <the-nav-bar active-entry-id="artifact-explorer" width-classes="max-w-7xl px-4 xl:px-0" :show-theme-toggle="true" />

  <h1 class="mx-4 mt-4 text-center text-lg leading-6 font-medium text-gray-900 dark:text-gray-100">Artifact explorer</h1>

  <div class="max-w-7xl w-full px-4 pb-4 xl:px-0 mx-auto">
    <router-view />
  </div>

  <h2 class="mt-4 mb-2 text-center text-base leading-6 font-medium text-gray-900 dark:text-gray-100"><code>/ei_afx/config</code> data</h2>
  <eiafx-config-table />

  <config-modal />
</template>

<script lang="ts">
import { defineComponent, watch } from 'vue';

import TheNavBar from 'ui/components/NavBar.vue';
import EiafxConfigTable from '@/components/EiafxConfigTable.vue';
import ConfigModal from '@/components/ConfigModal.vue';
import { config, persistConfig } from '@/store';

export default defineComponent({
  components: {
    TheNavBar,
    EiafxConfigTable,
    ConfigModal,
  },
  setup() {
    watch(
      config,
      () => {
        persistConfig();
      },
      { deep: true }
    );
  },
});
</script>
