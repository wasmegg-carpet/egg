<template>
  <div class="space-y-4">
    <!-- First time on this plan: pick a target -->
    <div v-if="!target" class="space-y-2">
      <p class="text-xs font-bold text-slate-600">What are you aiming for?</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="option in TARGETS"
          :key="option.id"
          class="flex items-start gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors"
          :class="option.classes"
          @click="setTarget(option.id)"
        >
          <img :src="iconURL(option.icon, 64)" class="w-8 h-8 object-contain shrink-0" />
          <div>
            <div class="text-sm font-black tracking-wide">{{ option.label }}</div>
            <div class="text-[11px] font-medium opacity-80 leading-snug">
              {{ formatNumber(option.population, option.id === 'end' ? 3 : 4) }} chickens
            </div>
          </div>
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Target (changeable) -->
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Target</span>
        <div class="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          <button
            v-for="option in TARGETS"
            :key="option.id"
            v-tippy="`${formatNumber(option.population, option.id === 'end' ? 3 : 4)} chickens`"
            class="px-3 py-1 rounded-md text-[11px] font-black tracking-wide transition-colors"
            :class="target === option.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'"
            @click="setTarget(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="busy" class="flex items-center gap-2 text-xs text-slate-500">
        <svg class="w-4 h-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Working out the swaps and research…
      </div>

      <p v-else-if="plan && !plan.ok" class="text-xs text-amber-600">{{ plan.reason }}</p>

      <template v-else-if="plan && plan.ok">
        <ol class="space-y-2">
          <template v-for="(step, i) in plan.steps" :key="i">
            <!-- Equip / swap -->
            <li class="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span class="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {{ i === 0 ? (step.swaps ? 'Equip Max IHR set' : 'Max IHR set (equipped)') : 'Swap to' }}
                </span>
                <span
                  v-for="slotIndex in step.changedSlots"
                  :key="slotIndex"
                  class="inline-flex items-center gap-0.5 rounded-lg bg-white border border-slate-200/60 px-1 py-0.5"
                >
                  <img
                    v-if="artifactOf(step.loadout[slotIndex])"
                    :src="iconURL(artifactOf(step.loadout[slotIndex])!.iconPath, 64)"
                    :title="artifactOf(step.loadout[slotIndex])!.label"
                    class="w-6 h-6 object-contain"
                  />
                  <img
                    v-for="(stone, j) in stonesOf(step.loadout[slotIndex])"
                    :key="j"
                    :src="iconURL(stone.iconPath, 32)"
                    :title="stone.label"
                    class="w-4 h-4 object-contain"
                  />
                </span>
              </div>
              <ul v-if="i > 0" class="mt-1 text-[11px] text-slate-500 space-y-0.5">
                <li v-for="slotIndex in step.changedSlots" :key="slotIndex">
                  {{ describeSlotSwap(plan.steps[i - 1].loadout[slotIndex], step.loadout[slotIndex]) }}
                </li>
              </ul>
              <div class="mt-1 text-[10px] font-mono-premium text-slate-400">
                IHR {{ formatNumber(step.ihr, 3) }}/min · habs hold {{ formatNumber(step.habCapacity, 3) }}
              </div>
            </li>

            <template v-for="(event, j) in condensed(step.events, i)" :key="`${i}-${j}`">
              <!-- Research (each a Milestones-view chain) -->
              <li
                v-if="event.kind === 'purchase'"
                class="flex flex-wrap items-baseline gap-x-2 px-3 py-1 text-xs text-slate-700"
              >
                <span
                  class="rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                  :class="event.purchase.kind === 'wd' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'"
                >
                  {{ event.purchase.kind === 'wd' ? 'Hab space' : 'IHR' }}
                </span>
                <span>
                  Buy <span class="font-black">{{ event.purchase.name }}</span> {{ event.fromLevel }} →
                  {{ event.purchase.toLevel }}
                  <span v-if="event.earningsPurchases > 0" class="text-slate-500">
                    (after {{ event.earningsPurchases }} earnings
                    {{ event.earningsPurchases === 1 ? 'purchase' : 'purchases' }})
                  </span>
                </span>
                <span class="text-slate-400">
                  {{ purchaseWhen(event) }}
                </span>
              </li>

              <!-- EnD on the way to NAH -->
              <li
                v-else-if="event.kind === 'end'"
                class="flex items-center gap-3 rounded-xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-100 via-emerald-50 to-white px-3 py-2.5 text-emerald-900"
              >
                <img :src="iconURL('egginc/icon_trophy_diamond.png', 128)" class="w-9 h-9 object-contain shrink-0" />
                <div>
                  <div class="text-sm font-black tracking-wide">
                    EnD · {{ formatNumber(DIAMOND_POPULATION, 3) }} chickens
                  </div>
                  <div class="text-[11px] font-bold opacity-75">
                    {{ formatAbsoluteTime(event.seconds, baseTimestamp, timezone) }} ·
                    {{ formatDuration(event.seconds) }} from now
                  </div>
                </div>
              </li>

              <!-- Wait -->
              <li v-else class="px-3 py-1 text-xs text-slate-700">
                Wait <span class="font-mono-premium font-black">{{ formatDuration(event.wait.seconds) }}</span>
                {{ event.wait.toTarget ? 'until' : 'until habs max at' }}
                <span class="font-mono-premium font-black">{{ formatNumber(event.wait.population, 3) }}</span>
                chickens
                <span class="text-slate-400">
                  at {{ formatAbsoluteTime(event.wait.endSeconds, baseTimestamp, timezone) }}
                </span>
              </li>
            </template>
          </template>

          <!-- Final -->
          <li
            v-if="plan.reachesTarget"
            class="flex items-center gap-3 rounded-xl border-2 bg-gradient-to-r px-3 py-2.5"
            :class="
              plan.target === 'end'
                ? 'border-emerald-300 from-emerald-100 via-emerald-50 to-white text-emerald-900'
                : 'border-violet-300 from-violet-100 via-violet-50 to-white text-violet-900'
            "
          >
            <img
              :src="
                iconURL(
                  plan.target === 'end' ? 'egginc/icon_trophy_diamond.png' : 'egginc/ei_hab_icon_chicken_universe.png',
                  128
                )
              "
              class="w-9 h-9 object-contain shrink-0"
            />
            <div>
              <div class="text-sm font-black tracking-wide">
                {{ plan.target === 'end' ? 'EnD' : 'NAH' }} ·
                {{ formatNumber(plan.finalPopulation, plan.target === 'end' ? 3 : 4) }} chickens
              </div>
              <div class="text-[11px] font-bold opacity-75">
                <template v-if="plan.totalSeconds > 0">
                  {{ formatAbsoluteTime(plan.totalSeconds, baseTimestamp, timezone) }} ·
                  {{ formatDuration(plan.totalSeconds) }} from now
                </template>
                <template v-else>Already there.</template>
              </div>
            </div>
          </li>
          <li v-else class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Habs top out at
            <span class="font-mono-premium font-black">{{ formatNumber(plan.finalPopulation, 3) }}</span> chickens
            <template v-if="plan.totalSeconds > 0">
              after {{ formatDuration(plan.totalSeconds) }} ({{
                formatAbsoluteTime(plan.totalSeconds, baseTimestamp, timezone)
              }})</template
            >, short of {{ plan.target === 'end' ? 'EnD' : `NAH (${formatNumber(plan.nahPopulation, 4)})` }}.
          </li>
        </ol>

        <div
          v-if="plan.wormholeDampening"
          class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1"
        >
          <div>
            <template v-if="plan.wormholeDampening.levelsNeeded === null">
              Even max Wormhole Dampening ({{ plan.wormholeDampening.maxLevel }}) with all other hab research only
              reaches {{ formatNumber(plan.wormholeDampening.capacityAtMax, 3) }}.
            </template>
            <template v-else-if="plan.wormholeDampening.levelsNeeded === 0">
              The rest of the hab research gets to EnD with Wormhole Dampening where it is (level
              {{ plan.wormholeDampening.currentLevel }}).
            </template>
            <template v-else>
              With all other hab research bought, EnD takes
              <span class="font-black"
                >{{ plan.wormholeDampening.levelsNeeded }} more
                {{ plan.wormholeDampening.levelsNeeded === 1 ? 'level' : 'levels' }}</span
              >
              of Wormhole Dampening (to
              {{ plan.wormholeDampening.currentLevel + plan.wormholeDampening.levelsNeeded }} of
              {{ plan.wormholeDampening.maxLevel }}).
            </template>
          </div>
          <div v-if="!plan.wormholeDampening.allBestHabs" class="text-amber-700">
            This keeps your current habs; Chicken Universes in every slot would need fewer.
          </div>
        </div>

        <button
          v-tippy="plan.totalSeconds <= 0 ? 'Already there.' : ''"
          class="btn-premium btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-20"
          :disabled="plan.totalSeconds <= 0 || applying"
          @click="apply()"
        >
          <img
            :src="
              iconURL(
                plan.target === 'end' ? 'egginc/icon_trophy_diamond.png' : 'egginc/ei_hab_icon_chicken_universe.png',
                64
              )
            "
            class="w-5 h-5 object-contain"
          />
          <span>{{ applying ? 'Adding…' : buttonLabel }}</span>
        </button>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import { iconURL } from 'lib';
import { formatAbsoluteTime, formatDuration, formatNumber } from '@/lib/format';
import { getArtifact, getStone, type EquippedArtifact, type StoneOption } from '@/lib/artifacts';
import {
  describeSlotSwap,
  DIAMOND_POPULATION,
  type SmartWaitEvent,
  type SmartWaitHatch,
  type SmartWaitPurchase,
  type SmartWaitTarget,
} from '@/calculations/smartPopulationWait';
import { useSmartPopulationWait } from '@/composables/useSmartPopulationWait';

const props = defineProps<{ active: boolean }>();

const { target, setTarget, nahPopulation, plan, busy, applying, baseTimestamp, apply, timezone } =
  useSmartPopulationWait(toRef(props, 'active'));

const TARGETS = computed(() => [
  {
    id: 'end' as SmartWaitTarget,
    label: 'EnD',
    icon: 'egginc/icon_trophy_diamond.png',
    population: DIAMOND_POPULATION,
    classes: 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 text-emerald-900',
  },
  {
    id: 'nah' as SmartWaitTarget,
    label: 'NAH',
    icon: 'egginc/ei_hab_icon_chicken_universe.png',
    population: nahPopulation.value,
    classes: 'border-violet-200 bg-violet-50 hover:border-violet-400 text-violet-900',
  },
]);

type ShownEvent =
  | {
      kind: 'purchase';
      purchase: SmartWaitPurchase;
      fromLevel: number;
      firstSeconds: number;
      earningsPurchases: number;
    }
  | { kind: 'wait'; wait: SmartWaitHatch }
  | { kind: 'end'; seconds: number };

/**
 * Back-to-back buys of the same research as one line ("Neural Linking 0 → 20 between X and Y"),
 * including the waits between them when it just alternates (wait for full habs, buy the next
 * Wormhole Dampening level, …). Empty waits dropped.
 */
function condensed(events: SmartWaitEvent[], stepIndex: number): ShownEvent[] {
  const list = events.filter(e => e.kind === 'purchase' || e.wait.seconds > 0);
  const shown: ShownEvent[] = [];
  list.forEach((event, k) => {
    const last = shown[shown.length - 1];
    if (event.kind === 'wait') {
      const next = list[k + 1];
      const between =
        last?.kind === 'purchase' && next?.kind === 'purchase' && next.purchase.researchId === last.purchase.researchId;
      if (!between) shown.push(event);
      return;
    }
    const { purchase } = event;
    if (last?.kind === 'purchase' && last.purchase.researchId === purchase.researchId) {
      last.purchase = purchase;
      last.earningsPurchases += purchase.items.length - 1;
    } else {
      shown.push({
        kind: 'purchase',
        purchase,
        fromLevel: purchase.toLevel - 1,
        firstSeconds: purchase.endSeconds,
        earningsPurchases: purchase.items.length - 1,
      });
    }
  });
  return withEnd(shown, stepIndex);
}

/**
 * On the way to NAH, EnD goes where it is passed: a wait that passes it splits into "Wait … until
 * 10B", the EnD band, and the rest of the wait. Only a marker; nothing to do there.
 */
function withEnd(shown: ShownEvent[], stepIndex: number): ShownEvent[] {
  const end = plan.value?.ok && plan.value.target === 'nah' ? plan.value.end : null;
  if (!end || end.stepIndex !== stepIndex) return shown;
  const at = end.seconds;
  const out: ShownEvent[] = [];
  let placed = false;
  for (const event of shown) {
    if (
      !placed &&
      event.kind === 'wait' &&
      event.wait.endSeconds - event.wait.seconds < at &&
      at <= event.wait.endSeconds
    ) {
      const start = event.wait.endSeconds - event.wait.seconds;
      if (at - start >= 1) {
        out.push({
          kind: 'wait',
          wait: { ...event.wait, seconds: at - start, population: DIAMOND_POPULATION, toTarget: true, endSeconds: at },
        });
      }
      out.push({ kind: 'end', seconds: at });
      if (event.wait.endSeconds - at >= 1) {
        out.push({
          kind: 'wait',
          wait: { ...event.wait, seconds: event.wait.endSeconds - at, startPopulation: DIAMOND_POPULATION },
        });
      }
      placed = true;
      continue;
    }
    out.push(event);
    if (!placed && event.kind === 'purchase' && at <= event.purchase.endSeconds) {
      out.push({ kind: 'end', seconds: at });
      placed = true;
    }
  }
  if (!placed) out.push({ kind: 'end', seconds: at });
  return out;
}

/** "at X", or "between X and Y" for a line covering several buys. */
function purchaseWhen(event: Extract<ShownEvent, { kind: 'purchase' }>): string {
  const first = formatAbsoluteTime(event.firstSeconds, baseTimestamp.value, timezone.value);
  const last = formatAbsoluteTime(event.purchase.endSeconds, baseTimestamp.value, timezone.value);
  return first === last ? `at ${last}` : `between ${first} and ${last}`;
}

const buttonLabel = computed(() => {
  const p = plan.value;
  if (!p?.ok) return '';
  if (p.target === 'end') return p.reachesTarget ? 'Wait for EnD' : 'Wait for Max Habs';
  return p.reachesNah ? 'Wait for NAH' : 'Wait for Max Habs';
});

const artifactOf = (slot: EquippedArtifact | undefined) => getArtifact(slot?.artifactId ?? null);
const stonesOf = (slot: EquippedArtifact | undefined): StoneOption[] =>
  (slot?.stones ?? []).map(id => getStone(id)).filter((s): s is StoneOption => s !== null);
</script>
