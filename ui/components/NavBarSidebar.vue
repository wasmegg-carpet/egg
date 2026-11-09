<template>
  <TransitionRoot as="template" :show="open">
    <Dialog as="div" class="fixed inset-0 flex z-40" @close="$emit('update:open', false)">
      <TransitionChild
        as="template"
        enter="transition-opacity ease-linear duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity ease-linear duration-300"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <DialogOverlay class="fixed inset-0 bg-opacity-75" :class="useCoolGray ? 'bg-cool-gray-600' : 'bg-gray-600'" />
      </TransitionChild>
      <TransitionChild
        as="template"
        enter="transition ease-in-out duration-300 transform"
        enter-from="-translate-x-full"
        enter-to="translate-x-0"
        leave="transition ease-in-out duration-300 transform"
        leave-from="translate-x-0"
        leave-to="-translate-x-full"
      >
        <div
          id="sitewide-nav"
          class="relative flex-1 flex flex-col max-w-xs w-full pt-5 pb-4"
          :class="useCoolGray ? 'bg-cool-gray-800' : 'bg-gray-800'"
        >
          <TransitionChild
            as="template"
            enter="ease-in-out duration-300"
            enter-from="opacity-0"
            enter-to="opacity-100"
            leave="ease-in-out duration-300"
            leave-from="opacity-100"
            leave-to="opacity-0"
          >
            <div class="absolute top-0 right-0 -mr-10 pt-2">
              <button
                type="button"
                class="ml-1 flex items-center justify-center h-8 w-8 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                @click="$emit('update:open', false)"
              >
                <span class="sr-only">Close sidebar</span>
                <XIcon class="h-5 w-5 text-white" aria-hidden="true" />
              </button>
            </div>
          </TransitionChild>
          <div class="flex-1 h-0 overflow-y-auto">
            <nav class="px-2">
              <template v-for="(item, index) in entries">
                <a
                  v-if="item !== null"
                  :key="item.id"
                  v-tippy="{ content: item.description ?? '' }"
                  :href="item.id === activeEntryId ? '' : useAbsoluteUrls ? toAbsoluteUrl(item.url) : item.url"
                  class="group flex items-center px-2 py-1.5 text-sm rounded-md"
                  :class="
                    item.id === activeEntryId
                      ? ['text-white cursor-default', useCoolGray ? 'bg-cool-gray-900' : 'bg-gray-900']
                      : useCoolGray
                        ? 'text-cool-gray-100 hover:bg-cool-gray-600'
                        : 'text-gray-100 hover:bg-gray-600'
                  "
                  target="_blank"
                >
                  <component
                    :is="item.iconUrl ? 'img' : item.icon ? item.icon : CollectionIcon"
                    :src="item.iconUrl"
                    class="flex-shrink-0"
                    :class="[
                      item.id === 'eicoop' ? 'h-5 w-5 -ml-0.5 mr-1.5' : 'h-4 w-4 mr-2',
                      useCoolGray ? 'text-cool-gray-300' : 'text-gray-300',
                    ]"
                  />
                  <span :class="item.id === 'eicoop' ? 'text-yellow-300 font-medium small-caps' : undefined">{{
                    item.title
                  }}</span>
                  <span
                    v-if="item.id === 'contact'"
                    class="flex items-center text-xs ml-2"
                    :class="useCoolGray ? 'text-cool-gray-500' : 'text-gray-500'"
                  >
                    <arrow-left-icon class="inline h-3 w-3 mr-1" />Issues & suggestions
                  </span>
                </a>
                <hr
                  v-else
                  :key="index"
                  class="my-2 mx-2"
                  :class="useCoolGray ? 'border-cool-gray-600' : 'border-gray-600'"
                />
              </template>
              <div
                class="flex items-center px-2 py-1.5 text-sm rounded-md"
                :class="useCoolGray ? 'text-cool-gray-100' : 'text-gray-100'"
              >
                <identification-icon
                  class="flex-shrink-0 h-4 w-4 mr-2"
                  :class="useCoolGray ? 'text-cool-gray-300' : 'text-gray-300'"
                />
                Copyright &copy; 2021&nbsp;<a
                  href="https://wasmegg-carpet.netlify.app/"
                  class="text-blue-400 hover:text-blue-500"
                  target="_blank"
                  >@mk2</a
                >
              </div>
            </nav>
          </div>
        </div>
      </TransitionChild>
      <div class="flex-shrink-0 w-14" aria-hidden="true">
        <!-- Dummy element to force sidebar to shrink to fit close icon -->
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script lang="ts">
import { defineComponent, FunctionalComponent, HTMLAttributes, VNodeProps, DefineComponent } from 'vue';
import { Dialog, DialogOverlay, TransitionChild, TransitionRoot } from '@headlessui/vue';
import {
  ArrowLeftIcon,
  ChatAlt2Icon,
  CollectionIcon,
  EmojiHappyIcon,
  HomeIcon,
  IdentificationIcon,
  ViewGridIcon,
  XIcon,
} from '@heroicons/vue/solid';

import { iconURL } from 'lib';
import { idToTool } from 'lib/tools';

// True on localhost or a Netlify branch deploy (https://<branch>--wasmegg-carpet.netlify.app),
// false on the main site (https://wasmegg-carpet.netlify.app).
function isLocalOrBranchDeploy(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('--wasmegg-carpet.netlify.app')
  );
}

// null for group separator.
const entries: ({
  id: string;
  title: string;
  url: string;
  description?: string;
  icon?: FunctionalComponent<HTMLAttributes & VNodeProps> | DefineComponent;
  iconUrl?: string;
} | null)[] = [
  {
    id: 'home',
    title: 'Home',
    url: '/',
    icon: HomeIcon,
  },
  {
    id: 'contact',
    title: 'Contact',
    url: '/#/contact',
    icon: ChatAlt2Icon,
  },
  {
    id: 'donate',
    title: 'Donate',
    url: '/#/donate',
    icon: EmojiHappyIcon,
  },

  null,

  {
    ...idToTool.get('eicoop')!,
    title: 'coopTracker',
    iconUrl: iconURL('egginc/egg_of_prophecy.png', 64),
  },

  null,

  idToTool.get('artifact-explorer')!,
  idToTool.get('artifact-sandbox')!,
  idToTool.get('rockets-tracker')!,
  idToTool.get('virtue-companion')!,
  idToTool.get('ascension-planner')!,
  ...(isLocalOrBranchDeploy() ? [idToTool.get('enl-planner')!] : []),
  idToTool.get('past-contracts')!,
  idToTool.get('inventory-visualizer')!,
  idToTool.get('enlightenment')!,
  idToTool.get('smart-assistant')!,
  idToTool.get('shell-company')!,
  idToTool.get('eggs-laid')!,
  idToTool.get('mission-planner')!,

  null,

  idToTool.get('mission-list')!,
  idToTool.get('consumption-sheet')!,
  idToTool.get('events')!,

  null,

  {
    id: 'misc',
    title: 'Miscellaneous tools',
    url: 'https://eiadhoc.netlify.app/',
    icon: ViewGridIcon,
  },

  null,

  idToTool.get('EggLedger')!,

  null,
];

export default defineComponent({
  components: {
    // eslint-disable-next-line vue/no-reserved-component-names
    Dialog,
    DialogOverlay,
    TransitionChild,
    TransitionRoot,
    ArrowLeftIcon,
    IdentificationIcon,
    XIcon,
  },
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    activeEntryId: {
      type: String,
      default: '',
    },
    useAbsoluteUrls: {
      type: Boolean,
      default: false,
    },
    // By default coolGray is used for Tailwind's gray, but in certain apps we
    // override the default gray, and for sitewide consistency we need to use
    // cool-gray here instead.
    useCoolGray: {
      type: Boolean,
      default: false,
    },
  },
  emits: {
    'update:open': (_payload: boolean) => true,
  },
  setup() {
    return {
      entries,
      CollectionIcon,
      toAbsoluteUrl,
    };
  },
});

function toAbsoluteUrl(url: string): string {
  return new URL(url, 'https://wasmegg-carpet.netlify.app/').toString();
}
</script>

<style scoped>
.small-caps {
  font-variant-caps: small-caps;
}
</style>
