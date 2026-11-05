<template>
  <h1 class="mb-4 text-center text-h1 leading-6 font-medium text-gray-900">
    <span class="whitespace-nowrap">@CarpetSage's fork of @mk2's public utilities</span>{{ ' ' }}
    <span class="whitespace-nowrap">for Egg, Inc.</span>
  </h1>

  <div v-if="daysVisitedStreak >= EASTER_EGG_DAY" class="my-2 text-center">
    <div class="w-max mx-auto bg-yellow-500 text-sm text-white px-2 py-1 rounded-md">
      <svg class="inline h-4 w-4 text-red-500 relative -top-px -left-px" viewBox="0 0 20 20" fill="currentColor">
        <path
          fill-rule="evenodd"
          d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
          clip-rule="evenodd"
        />
      </svg>
      You've been visiting for {{ daysVisitedStreak }} days straight!
      <template v-if="showEasterEgg">
        <br />
        <span class="cursor-pointer underline" @click="triggerEasterEggAndDisableInTheFuture">
          Here's an Easter egg for you!
        </span>
      </template>
    </div>
  </div>

  <p>
    I am <span class="font-medium">carpetsage</span> on the
    <base-link href="https://discord.gg/egginc">Egg, Inc. Discord server</base-link>. This is the index of my fork of
    <span class="font-medium">mk2#4590's</span> public tools for Egg, Inc.
  </p>

  <whats-new class="my-4" />

  <h2>Tools hosted at independent domains</h2>
  <ul>
    <li><tool-description id="eicoop" @visit="onvisit" /></li>
  </ul>

  <h2>Tools hosted at this domain</h2>
  <h3>Interactive apps</h3>
  <ul>
    <li><tool-description id="artifact-explorer" @visit="onvisit" /></li>
    <li><tool-description id="artifact-sandbox" @visit="onvisit" /></li>
    <li><tool-description id="rockets-tracker" @visit="onvisit" /></li>
    <li><tool-description id="virtue-companion" @visit="onvisit" /></li>
    <li><tool-description id="ascension-planner" @visit="onvisit" /></li>
    <li><tool-description id="enl-planner" @visit="onvisit" /></li>
    <li><tool-description id="past-contracts" @visit="onvisit" /></li>
    <li><tool-description id="inventory-visualizer" @visit="onvisit" /></li>
    <li><tool-description id="enlightenment" @visit="onvisit" /></li>
    <li><tool-description id="smart-assistant" @visit="onvisit" /></li>
    <li><tool-description id="shell-company" @visit="onvisit" /></li>
    <li><tool-description id="eggs-laid" @visit="onvisit" /></li>
    <li><tool-description id="mission-planner" @visit="onvisit" /></li>
  </ul>

  <h3>Data sheets</h3>
  <ul>
    <li><tool-description id="mission-list" @visit="onvisit" /></li>
    <li><tool-description id="consumption-sheet" @visit="onvisit" /></li>
    <li><tool-description id="events" @visit="onvisit" /></li>
    <li><tool-description id="legendary-study" @visit="onvisit" /></li>
  </ul>

  <h3>Developer tools</h3>
  <ul>
    <li><tool-description id="researches" @visit="onvisit" /></li>
  </ul>
  <p>
    Certain tools are not advertised here due to concerns. If you are interested, poke around the source repo to find
    them.
  </p>

  <h2>Miscellaneous small tools</h2>
  <p>
    You can find more small tools at
    <base-link href="https://eiadhoc.netlify.app/">eiadhoc.netlify.app</base-link>.
  </p>

  <h2>Desktop applications</h2>
  <ul>
    <li><tool-description id="EggLedger" @visit="onvisit" /></li>
  </ul>

  <!-- <h2>Guides</h2> -->

  <h2>Advanced</h2>
  <ul>
    <li><tool-description id="ebeb" @visit="onvisit" /></li>
    <li><tool-description id="fuckify" @visit="onvisit" /></li>
    <li>
      <span class="bg-green-100">
        <base-link href="https://ei.tcl.sh/tips" :everfresh="true" @click="onrick"
          >Advanced strategies for seasoned players</base-link
        >
        <sup class="text-xs font-medium uppercase text-green-600 ml-1">Secret</sup>
      </span>
      &mdash; Strategies so next-level, they will blow your effing mind. You're advised to stay away. Not for the
      faint-hearted.
    </li>
  </ul>

  <h2>Other Links</h2>
  <ul>
    <li>
      <base-router-link
        :to="{ name: 'donate' }"
        class="relative text-green-500 hover:text-green-600 visited:text-green-500 hover:visited:text-green-600"
        :class="{ 'bg-green-50': !donationPageVisited }"
      >
        Donate to help cover hosting costs
        <span v-if="!donationPageVisited" class="absolute top-0.5 -right-3 flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      </base-router-link>
    </li>
    <li>
      <base-router-link :to="{ name: 'privacy' }">Privacy policy</base-router-link>
    </li>
    <li><base-router-link :to="{ name: 'contact' }">Contact</base-router-link></li>
    <li><base-link href="https://github.com/carpetsage/egg">Source code</base-link></li>
  </ul>

  <h2>Supporters</h2>
  <p>
    Hosting costs come from donations of the awesome individuals listed below. Find out how you can support my tools by
    visiting the
    <base-router-link
      :to="{ name: 'donate' }"
      class="relative text-green-500 hover:text-green-600 visited:text-green-500 hover:visited:text-green-600"
      >Donate</base-router-link
    >
    page.
  </p>
  <donor-list />

  <easter-egg v-if="showEasterEgg" :refresh-key="easterEggRefreshKey" />
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';

import {
  getDonationPageVisited,
  getLocalStorageNoPrefix,
  goatcounter,
  recordVisit,
  setLocalStorageNoPrefix,
} from 'lib';
import BaseLink from '@/components/BaseLink.vue';
import BaseRouterLink from '@/components/BaseRouterLink.vue';
import DonorList from '@/components/DonorList.vue';
import EasterEgg from '@/components/EasterEgg.vue';
import ToolDescription from '@/components/ToolDescription.vue';
import V120Badge from '@/components/V120Badge.vue';
import WhatsNew from '@/components/WhatsNew.vue';

const EASTER_EGG_DAY = 7;
const EASTER_EGG_SHOWN_AT_LOCALSTORAGE_KEY = 'c_easterEggShownAt';

export default defineComponent({
  components: {
    BaseLink,
    BaseRouterLink,
    DonorList,
    EasterEgg,
    ToolDescription,
    V120Badge,
    WhatsNew,
  },
  setup() {
    const donationPageVisited = getDonationPageVisited();

    const daysVisitedStreak = ref(0);
    const showEasterEgg = ref(false);
    const easterEggRefreshKey = ref(0);
    const { daysVisitedStreak: currentDaysVisitedStreak } = recordVisit();
    daysVisitedStreak.value = currentDaysVisitedStreak;
    const triggerEasterEgg = () => {
      showEasterEgg.value = true;
      easterEggRefreshKey.value = Date.now();
    };
    const triggerEasterEggAndDisableInTheFuture = () => {
      triggerEasterEgg();
      const easterEggShownForTheFirstTime = getLocalStorageNoPrefix(EASTER_EGG_SHOWN_AT_LOCALSTORAGE_KEY) === undefined;
      setLocalStorageNoPrefix(EASTER_EGG_SHOWN_AT_LOCALSTORAGE_KEY, Date.now());
      if (easterEggShownForTheFirstTime) {
        goatcounter?.count({
          path: 'https://wasmegg-carpet.netlify.app/#/',
          title: 'Easter egg (visit streak)',
          event: true,
        });
      }
    };

    if (
      currentDaysVisitedStreak === EASTER_EGG_DAY &&
      getLocalStorageNoPrefix(EASTER_EGG_SHOWN_AT_LOCALSTORAGE_KEY) === undefined
    ) {
      triggerEasterEggAndDisableInTheFuture();
    } else {
      showEasterEgg.value = false;
    }

    // Record visit on clicking a tool link, because some users may leave the
    // page open for a long time without a refresh.
    const onvisit = () => {
      const { daysVisitedStreak: currentDaysVisitedStreak } = recordVisit();
      daysVisitedStreak.value = currentDaysVisitedStreak;
      if (
        currentDaysVisitedStreak === EASTER_EGG_DAY &&
        getLocalStorageNoPrefix(EASTER_EGG_SHOWN_AT_LOCALSTORAGE_KEY) === undefined
      ) {
        // Do not call the DisableInTheFuture version here because the user may
        // miss it as the new tool is opened.
        triggerEasterEgg();
      } else {
        showEasterEgg.value = false;
      }
    };

    const onrick = () => {
      goatcounter?.count({
        path: 'ei.tcl.sh/tips',
        title: 'Rickrolled',
        event: true,
      });
    };

    return {
      donationPageVisited,
      daysVisitedStreak,
      EASTER_EGG_DAY,
      showEasterEgg,
      easterEggRefreshKey,
      triggerEasterEggAndDisableInTheFuture,
      onvisit,
      onrick,
    };
  },
});
</script>

<style lang="postcss" scoped>
h2 {
  @apply font-medium text-h2 my-2;
}

h3 {
  @apply font-medium text-h3 my-2;
}
</style>
