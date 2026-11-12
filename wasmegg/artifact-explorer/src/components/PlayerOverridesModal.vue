<template>
  <TransitionRoot as="template" :show="playerOverridesModalOpen">
    <HeadlessDialog as="div" class="fixed z-10 inset-0 overflow-y-auto" @close="closePlayerOverridesModal">
      <div class="min-h-screen text-center px-4">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <DialogOverlay class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </TransitionChild>

        <span class="inline-block align-middle h-screen" aria-hidden="true">&#8203;</span>
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0 translate-y-0 scale-95"
          enter-to="opacity-100 translate-y-0 scale-100"
          leave="ease-in duration-200"
          leave-from="opacity-100 translate-y-0 scale-100"
          leave-to="opacity-0 translate-y-0 scale-95"
        >
          <div
            class="inline-block bg-white rounded-lg px-6 pt-4 pb-6 text-left overflow-y-auto shadow-xl transform transition-all my-8 align-middle max-w-2xl w-full p-6 space-y-3 relative max-h-[90vh]"
          >
            <DialogTitle as="h3" class="text-center text-base font-medium text-gray-900">Ships</DialogTitle>
            <p class="text-center text-xs text-gray-500 -mt-2">
              <template v-if="player">
                Availability and star levels were loaded from your save. Override a ship to set a custom value.
              </template>
              <template v-else>
                Tick the ships the optimizer may launch; click the stars to set each ship's level.
              </template>
            </p>

            <button
              class="absolute -top-3 right-0 inline-flex rounded-md p-2 focus:outline-none"
              @click="closePlayerOverridesModal"
            >
              <XIcon class="h-4 w-4 text-gray-500 hover:text-gray-600" aria-hidden="true" />
            </button>

            <template v-if="!player">
              <!-- No save loaded: edit the manual fleet directly. -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 pt-1">
                <div v-for="ship in spaceshipList" :key="ship" class="flex items-center gap-2 min-w-0">
                  <input
                    :id="`po_ship_visibility_${ship}`"
                    v-model="config.shipVisibility[ship]"
                    :name="`po_ship_visibility_${ship}`"
                    type="checkbox"
                    class="focus:ring-green-500 h-3.5 w-3.5 text-green-600 border-gray-300 rounded flex-shrink-0"
                    title="Ticked ships can be launched by the optimizer"
                  />
                  <label
                    :for="`po_ship_visibility_${ship}`"
                    class="text-sm truncate cursor-pointer"
                    :class="config.shipVisibility[ship] ? 'text-gray-700' : 'text-gray-400'"
                  >
                    {{ spaceshipName(ship) }}
                  </label>
                  <div v-if="shipMaxLevel(ship) > 0" class="flex-shrink-0">
                    <ShipStars
                      :label="spaceshipName(ship)"
                      :level="config.shipLevels[ship]"
                      :max="shipMaxLevel(ship)"
                      :interactive="true"
                      @set="(lvl: number) => setShipLevel(ship, lvl)"
                    />
                  </div>
                </div>
              </div>
              <div class="flex items-center space-x-2 mt-2 pt-2 border-t border-gray-200">
                <input
                  id="po_ship_visibility_all"
                  :checked="allShipsVisible"
                  :indeterminate="someShipsVisible && !allShipsVisible"
                  name="po_ship_visibility_all"
                  type="checkbox"
                  class="focus:ring-green-500 h-3.5 w-3.5 text-green-600 border-gray-300 rounded"
                  @change="toggleAllShips"
                />
                <label for="po_ship_visibility_all" class="text-sm text-gray-600 cursor-pointer">
                  Toggle all ships
                </label>
              </div>
            </template>

            <template v-else>
              <!-- Save loaded: per-ship choice between save values and manual values. -->
              <!-- Column headers (desktop only; mobile uses inline labels per card). -->
              <div
                class="hidden sm:grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 items-center px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400"
              >
                <span>Ship</span>
                <span class="w-40">From save</span>
                <span class="w-14 text-center">Override?</span>
                <span class="w-44">Custom value</span>
              </div>
              <p class="text-xs text-gray-400 px-1 sm:-mt-1">
                The checkbox marks a ship as launchable; the stars are its level. The optimizer uses whichever side
                isn't grayed out.
              </p>

              <div class="border-t border-gray-100 divide-y divide-gray-100 sm:divide-gray-50">
                <div
                  v-for="ship in spaceshipList"
                  :key="ship"
                  class="px-1 py-2 sm:py-1.5 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:gap-x-3 sm:items-center"
                >
                  <span class="block text-sm font-medium text-gray-700 truncate sm:font-normal">{{
                    spaceshipName(ship)
                  }}</span>

                  <!-- Save values (read-only) -->
                  <div
                    class="flex items-center gap-1.5 mt-2 sm:mt-0 sm:w-40"
                    :class="isManual(ship) ? 'opacity-40' : ''"
                    :title="isManual(ship) ? 'Ignored while manual is on' : 'Currently in use'"
                  >
                    <span class="sm:hidden w-20 flex-shrink-0 text-[11px] uppercase tracking-wide text-gray-400">
                      From save
                    </span>
                    <span
                      class="text-sm w-4 text-center flex-shrink-0"
                      :class="player.shipVisibility[ship] ? 'text-green-600' : 'text-gray-400'"
                    >
                      {{ player.shipVisibility[ship] ? '✓' : '—' }}
                    </span>
                    <ShipStars
                      v-if="shipMaxLevel(ship) > 0"
                      :label="spaceshipName(ship)"
                      :level="player.shipLevels[ship]"
                      :max="shipMaxLevel(ship)"
                    />
                  </div>

                  <!-- Manual toggle -->
                  <div class="flex items-center gap-1.5 mt-1 sm:mt-0 sm:justify-self-center">
                    <span class="sm:hidden w-20 flex-shrink-0 text-[11px] uppercase tracking-wide text-gray-400">
                      Override?
                    </span>
                    <input
                      type="checkbox"
                      class="h-3.5 w-3.5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                      :checked="isManual(ship)"
                      :title="
                        isManual(ship) ? 'Untick to go back to your save values' : 'Tick to set this ship manually'
                      "
                      @change="setManual(ship, ($event.target as HTMLInputElement).checked)"
                    />
                  </div>

                  <!-- Manual values (editable once manual is on) -->
                  <div
                    class="flex items-center gap-1.5 mt-1 sm:mt-0 sm:w-44"
                    :class="isManual(ship) ? '' : 'opacity-40'"
                    :title="isManual(ship) ? 'Currently in use' : 'Ignored until manual is on'"
                  >
                    <span class="sm:hidden w-20 flex-shrink-0 text-[11px] uppercase tracking-wide text-gray-400">
                      Custom
                    </span>
                    <input
                      type="checkbox"
                      class="h-3.5 w-3.5 text-green-600 border-gray-300 rounded focus:ring-green-500 flex-shrink-0 disabled:cursor-not-allowed"
                      :checked="config.shipVisibility[ship]"
                      :disabled="!isManual(ship)"
                      @change="setShipVisibility(ship, ($event.target as HTMLInputElement).checked)"
                    />
                    <ShipStars
                      v-if="shipMaxLevel(ship) > 0"
                      :label="spaceshipName(ship)"
                      :level="config.shipLevels[ship]"
                      :max="shipMaxLevel(ship)"
                      :interactive="isManual(ship)"
                      @set="(lvl: number) => setShipLevel(ship, lvl)"
                    />
                  </div>
                </div>
              </div>

              <div class="flex justify-between items-center text-xs pt-2 border-t border-gray-100">
                <button type="button" class="text-blue-600 hover:text-blue-800" @click="takeControlOfAllShips">
                  Use custom values for all ships
                </button>
                <button type="button" class="text-gray-500 hover:text-gray-700" @click="releaseControlOfAllShips">
                  Use save values for all ships
                </button>
              </div>
            </template>
          </div>
        </TransitionChild>
      </div>
    </HeadlessDialog>
  </TransitionRoot>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { Dialog as HeadlessDialog, DialogOverlay, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue';
import { XIcon } from '@heroicons/vue/solid';

import { ei, shipMaxLevel, spaceshipList, spaceshipName } from 'lib';
import ShipStars from './ShipStars';

import {
  closePlayerOverridesModal,
  config,
  overrides,
  playerOverridesModalOpen,
  playerShipsConfig,
  releaseControlOfAllShips,
  setOverrideShipLevel,
  setOverrideShipVisibility,
  setShipLevel,
  setShipVisibility,
  takeControlOfAllShips,
} from '@/store';

import Spaceship = ei.MissionInfo.Spaceship;

export default defineComponent({
  components: {
    HeadlessDialog,
    DialogOverlay,
    DialogTitle,
    TransitionChild,
    TransitionRoot,
    XIcon,
    ShipStars,
  },
  setup() {
    // Level and visibility overrides are stored as separate flags, but the UI
    // treats "manual" as one per-ship switch covering both.
    const isManual = (ship: Spaceship) => !!(overrides.value.shipLevels[ship] || overrides.value.shipVisibility[ship]);
    const setManual = (ship: Spaceship, b: boolean) => {
      setOverrideShipLevel(ship, b);
      setOverrideShipVisibility(ship, b);
    };

    const allShipsVisible = computed(() => spaceshipList.every(ship => config.value.shipVisibility[ship]));
    const someShipsVisible = computed(() => spaceshipList.some(ship => config.value.shipVisibility[ship]));
    const toggleAllShips = () => {
      const newValue = !allShipsVisible.value;
      spaceshipList.forEach(ship => setShipVisibility(ship, newValue));
    };

    return {
      playerOverridesModalOpen,
      closePlayerOverridesModal,
      player: playerShipsConfig,
      config,
      spaceshipList,
      spaceshipName,
      shipMaxLevel,
      isManual,
      setManual,
      setShipLevel,
      setShipVisibility,
      takeControlOfAllShips,
      releaseControlOfAllShips,
      allShipsVisible,
      someShipsVisible,
      toggleAllShips,
    };
  },
});
</script>
