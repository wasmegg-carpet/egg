<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Earnings -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1 h-7">
          <h4 class="text-[10px] font-black text-slate-500 uppercase tracking-widest">Earnings Set</h4>
        </div>
        <ArtifactSelector
          :model-value="modelValue.earnings"
          :families="earningsFamilies"
          :slot-count="slotCount"
          stones="hidden"
          @update:model-value="onEarningsChange"
        />
      </div>

      <!-- Delivery -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1 h-7">
          <h4 class="text-[10px] font-black text-slate-500 uppercase tracking-widest">Delivery Set</h4>
          <div v-if="modelValue.delivery.mode === 'auto'" class="flex items-center gap-1.5">
            <button
              v-tippy="'Change which artifacts H1 can choose from'"
              class="px-2.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg border transition-all"
              :class="
                isEditingCandidates
                  ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
              "
              :aria-pressed="isEditingCandidates"
              @click="isEditingCandidates = !isEditingCandidates"
            >
              {{ isEditingCandidates ? 'Done' : 'Choose manually' }}
            </button>
          </div>
          <button
            v-else-if="inventoryDelivery?.mode === 'auto'"
            v-tippy="'Let H1 pick from your inventory again'"
            class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-lg border border-slate-200 transition-all"
            @click="useInventoryDelivery"
          >
            Pick from inventory
          </button>
        </div>

        <template v-if="modelValue.delivery.mode === 'auto'">
          <div
            v-for="(view, idx) in deliveryViews"
            :key="idx"
            class="section-premium p-3 flex items-center gap-3 min-h-[3.25rem]"
            :class="{ 'bg-slate-50 border-dashed opacity-70': idx >= slotCount }"
            :style="idx < slotCount ? { backgroundColor: view.kind === 'artifact' ? slotTint(view.artifactId) : 'white' } : {}"
          >
            <span
              class="text-[10px] font-black text-slate-400 w-5 h-5 flex items-center justify-center bg-white/50 rounded-full shadow-inner flex-shrink-0"
              >{{ idx + 1 }}</span
            >
            <template v-if="idx >= slotCount">
              <span class="text-[10px] text-gray-400 italic">Empty slot</span>
              <span
                class="ml-auto flex-shrink-0 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700"
              >
                Pro Permit only — ignored
              </span>
            </template>
            <template v-else-if="view.kind === 'artifact'">
              <img :src="iconURL(getArtifact(view.artifactId)!.iconPath, 64)" class="w-7 h-7" />
              <div class="min-w-0">
                <div class="text-[11px] font-black text-slate-800 truncate">{{ getArtifact(view.artifactId)!.label }}</div>
                <div class="text-[9px] text-slate-500">{{ getArtifact(view.artifactId)!.effect }}</div>
              </div>
            </template>
            <template v-else-if="view.kind === 'choice'">
              <div class="flex -space-x-2 flex-shrink-0">
                <img
                  v-for="id in view.artifactIds"
                  :key="id"
                  :src="iconURL(getArtifact(id)!.iconPath, 64)"
                  class="w-7 h-7 rounded-full ring-2 ring-white"
                  :style="{ backgroundColor: slotTint(id) }"
                />
              </div>
              <div class="min-w-0">
                <div class="text-[11px] font-black text-slate-800 truncate">{{ choiceLabel(view.artifactIds) }}</div>
                <div class="text-[9px] font-bold text-amber-600">H1 picks based on research and stones</div>
              </div>
            </template>
            <template v-else-if="view.kind === 'holder'">
              <div class="flex -space-x-2 flex-shrink-0">
                <img
                  v-for="id in view.artifactIds"
                  :key="id"
                  :src="iconURL(getArtifact(id)!.iconPath, 64)"
                  class="w-7 h-7 rounded-full ring-2 ring-white bg-slate-50"
                />
              </div>
              <div class="min-w-0">
                <div class="text-[11px] font-black text-slate-800">Stone holder</div>
                <div class="text-[9px] font-bold text-amber-600 truncate">
                  H1 picks {{ view.pick === 1 ? 'one' : view.pick }} of: {{ view.artifactIds.map(id => getArtifact(id)!.label).join(', ') }}
                </div>
              </div>
            </template>
            <template v-else-if="view.kind === 'any'">
              <div class="min-w-0">
                <div class="text-[11px] font-black text-slate-800">Any delivery artifact</div>
                <div class="text-[9px] font-bold text-amber-600 truncate">
                  H1 picks {{ view.pick }} of: {{ view.artifactIds.map(id => getArtifact(id)!.label).join(', ') }}
                </div>
              </div>
            </template>
            <span v-else class="text-[10px] text-gray-400 italic">Empty slot</span>
          </div>

          <!-- What H1 may choose from. Edited by hand to try out an inventory you don't have. -->
          <div v-if="isEditingCandidates" class="section-premium p-3 space-y-3">
            <div>
              <div class="text-[10px] font-black text-slate-700">Which artifacts can H1 choose from?</div>
              <div class="text-[9px] text-slate-500">
                Click to add or remove. Pick two of a family (e.g. T4R and T3E metronome) to see H1 choose between them.
              </div>
            </div>

            <div v-for="family in targetFamilies" :key="family.afxId" class="space-y-1">
              <div class="flex items-center gap-1.5">
                <img :src="iconURL(family.iconPath, 64)" class="w-4 h-4" />
                <span class="text-[9px] font-black text-slate-500 uppercase tracking-widest">{{ family.name }}</span>
              </div>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="option in family.options"
                  :key="option.id"
                  v-tippy="`${option.label}: ${option.effect}, ${option.slots} stone slot${option.slots === 1 ? '' : 's'}`"
                  class="px-1.5 py-0.5 rounded-md border text-[10px] font-black transition-all"
                  :class="
                    hasCandidate(option.id)
                      ? 'border-indigo-500 ring-1 ring-indigo-500 text-slate-900'
                      : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 bg-white'
                  "
                  :style="hasCandidate(option.id) ? { backgroundColor: slotTint(option.id) } : {}"
                  :aria-pressed="hasCandidate(option.id)"
                  @click="toggleCandidate(option.id)"
                >
                  T{{ option.tier }}{{ option.rarityCode }}
                </button>
              </div>
            </div>

            <div class="space-y-1">
              <div class="text-[9px] font-black text-slate-500 uppercase tracking-widest">Stone holders</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="candidate in holderCandidates"
                  :key="candidate.artifactId"
                  class="flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700"
                  :style="{ backgroundColor: slotTint(candidate.artifactId) }"
                >
                  <img :src="iconURL(getArtifact(candidate.artifactId)!.iconPath, 64)" class="w-4 h-4" />
                  {{ getArtifact(candidate.artifactId)!.label }}
                  <button
                    class="w-4 h-4 rounded text-slate-400 hover:text-rose-600 hover:bg-white/60 leading-none"
                    :aria-label="`Remove ${getArtifact(candidate.artifactId)!.label}`"
                    @click="toggleCandidate(candidate.artifactId)"
                  >
                    ×
                  </button>
                </span>
                <span v-if="holderCandidates.length === 0" class="text-[10px] text-gray-400 italic">None</span>
              </div>
              <ArtifactSelect
                :model-value="null"
                placeholder="+ Add a stone holder (search by name)..."
                :items="holderOptions"
                :get-item-id="item => item.id"
                :get-item-display="item => item.label"
                :get-item-icon-path="item => item.iconPath"
                :item-from-id="id => getArtifact(id)!"
                :search-items="searchHolders"
                @update:model-value="addCandidate($event)"
              />
            </div>
          </div>
        </template>
        <template v-else>
          <ArtifactSelector
            :model-value="stoneHolders ? fixedDeliveryDisplay.slice(0, -1) : fixedDeliveryDisplay"
            :families="deliveryFamilies"
            :slot-count="slotCount"
            stones="hidden"
            @update:model-value="onFixedDeliveryChange"
          />
          <!-- The last slot as a stone holder: only its stone slots count. -->
          <div v-if="stoneHolders" class="section-premium p-3 flex items-center gap-3">
            <span
              class="text-[10px] font-black text-slate-400 w-5 h-5 flex items-center justify-center bg-white/50 rounded-full shadow-inner flex-shrink-0"
              >{{ fixedDeliveryDisplay.length }}</span
            >
            <span class="text-[11px] font-black text-slate-800">Stone holder</span>
            <div class="flex gap-1">
              <button
                v-for="holder in stoneHolders"
                :key="holder.id"
                class="px-2 py-0.5 rounded-md border text-[10px] font-black transition-all"
                :class="
                  fixedHolder === holder.id
                    ? 'border-indigo-500 ring-1 ring-indigo-500 text-slate-900 bg-indigo-50'
                    : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 bg-white'
                "
                :aria-pressed="fixedHolder === holder.id"
                @click="setFixedHolder(holder.id)"
              >
                {{ holder.label }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Stones -->
    <div class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <h4 class="text-[10px] font-black text-slate-500 uppercase tracking-widest">Stones Available</h4>
        <span class="text-[9px] font-bold text-slate-400">Lunar &amp; shell → earnings · Quantum &amp; tachyon → delivery</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-[10px]">
          <thead>
            <tr class="text-slate-400 font-black uppercase tracking-widest">
              <th class="text-left font-black px-1 py-1"></th>
              <th v-for="tier in STONE_TIERS" :key="tier" class="font-black px-1 py-1">T{{ tier }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="family in STONE_FAMILIES" :key="family" class="border-t border-slate-100">
              <td class="px-1 py-1.5">
                <div class="flex items-center gap-1.5">
                  <img :src="iconURL(getStone(stoneId(family, 4))!.iconPath, 64)" class="w-4 h-4" />
                  <span class="font-black text-slate-600 capitalize">{{ family }}</span>
                </div>
              </td>
              <td v-for="tier in STONE_TIERS" :key="tier" class="px-1 py-1.5">
                <div class="flex items-center justify-center gap-1">
                  <button
                    class="w-5 h-5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 font-black disabled:opacity-30"
                    :disabled="modelValue.stones[family][tier] <= 0"
                    :aria-label="`Fewer T${tier} ${family} stones`"
                    @click="setStone(family, tier, modelValue.stones[family][tier] - 1)"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    :value="modelValue.stones[family][tier]"
                    class="w-14 bg-white border border-slate-100 rounded-md px-1 py-0.5 text-center font-mono-premium font-black text-slate-900 outline-none focus:border-indigo-500/50"
                    @change="setStone(family, tier, Number(($event.target as HTMLInputElement).value))"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                  <button
                    class="w-5 h-5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 font-black"
                    :aria-label="`More T${tier} ${family} stones`"
                    @click="setStone(family, tier, modelValue.stones[family][tier] + 1)"
                  >
                    +
                  </button>
                </div>
                <div
                  v-if="defaultValue && defaultValue.stones[family][tier] !== modelValue.stones[family][tier]"
                  class="text-center text-[8px] text-slate-400"
                >
                  {{ defaultLabel }} {{ defaultValue.stones[family][tier] }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="defaultValue && differsFromDefault" class="flex justify-end">
      <button
        class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all border border-slate-200 flex items-center gap-2 active:scale-95"
        @click="emit('update:modelValue', cloneLoadoutInputs(defaultValue))"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {{ resetLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Editor for the auto planner's artifact/stone inputs (earnings set, delivery set, stone pool).
 * Presentational only — the setup form (VirtueProgressSection) and each ascension's Show Details
 * (AscensionOverview) both host it and decide what Reset returns to and what an edit does.
 */
import { computed, ref } from 'vue';
import { iconURL } from 'lib';
import { ei } from 'lib/proto';
import { GenericBaseSelectFilterable } from 'ui/components/BaseSelectFilterable.vue';
import { isDeliveryTargetArtifact } from '@/lib/artifacts/virtue';
import ArtifactSelector from '@/components/ArtifactSelector.vue';
import { artifactOptions, getArtifact, getStone } from '@/lib/artifacts/data';
import type { ArtifactOption } from '@/lib/artifacts/types';
import { rarityTint } from 'lib/planners/artifacts/display';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import {
  STONE_FAMILIES,
  STONE_TIERS,
  cloneLoadoutInputs,
  deliveryCandidatesBySlot,
  loadoutInputsEqual,
  stoneId,
  toDeliveryCandidate,
  withEmptyStones,
  type AutoLoadoutInputs,
  type DeliveryInputs,
  type StoneFamily,
  type StoneTier,
} from '@/auto/loadout';

const props = withDefaults(
  defineProps<{
    modelValue: AutoLoadoutInputs;
    /** What Reset returns to. No Reset button without one. */
    defaultValue?: AutoLoadoutInputs | null;
    resetLabel?: string;
    /** Prefix for the faint "differs from default" stone count, e.g. "Inventory" or "Used". */
    defaultLabel?: string;
    /** The inventory's own `auto` delivery inputs, so a fixed set can switch back to them. */
    inventoryDelivery?: DeliveryInputs | null;
    /** The artifact family each earnings slot may hold (ArtifactSelector `families`). */
    earningsFamilies?: (string | null)[];
    /** The artifact family each fixed delivery slot may hold, before any stone holder. */
    deliveryFamilies?: (string | null)[];
    /** When given, a fixed delivery set's last slot is a choice of these stand-in holders. */
    stoneHolders?: { id: string; label: string }[] | null;
    /** How many artifact slots count: 4 with Pro permit, 2 with Standard. Later slots show as ignored. */
    slotCount?: number;
  }>(),
  {
    defaultValue: null,
    resetLabel: 'Reset',
    defaultLabel: 'Default',
    inventoryDelivery: null,
    earningsFamilies: () => [],
    deliveryFamilies: () => [],
    stoneHolders: null,
    slotCount: 4,
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: AutoLoadoutInputs];
}>();

const differsFromDefault = computed(() => !loadoutInputsEqual(props.modelValue, props.defaultValue));

function update(mutate: (next: AutoLoadoutInputs) => void) {
  const next = cloneLoadoutInputs(props.modelValue);
  mutate(next);
  emit('update:modelValue', next);
}

function onEarningsChange(value: EquippedArtifact[]) {
  update(next => {
    next.earnings = withEmptyStones(value);
  });
}

const deliveryViews = computed(() => deliveryCandidatesBySlot(props.modelValue, props.slotCount));

const fixedDeliveryDisplay = computed<EquippedArtifact[]>(() =>
  props.modelValue.delivery.mode === 'fixed'
    ? props.modelValue.delivery.artifactIds.map(artifactId => ({ artifactId, stones: [] }))
    : []
);

const fixedHolder = computed(() =>
  props.modelValue.delivery.mode === 'fixed' ? (props.modelValue.delivery.artifactIds.at(-1) ?? null) : null
);

function onFixedDeliveryChange(value: EquippedArtifact[]) {
  update(next => {
    const ids = value.map(s => s.artifactId ?? null);
    next.delivery = { mode: 'fixed', artifactIds: props.stoneHolders ? [...ids, fixedHolder.value] : ids };
  });
}

function setFixedHolder(id: string) {
  update(next => {
    if (next.delivery.mode === 'fixed') next.delivery.artifactIds[next.delivery.artifactIds.length - 1] = id;
  });
}

const ArtifactSelect = GenericBaseSelectFilterable<ArtifactOption>();
const isEditingCandidates = ref(false);

const autoCandidates = computed(() =>
  props.modelValue.delivery.mode === 'auto' ? props.modelValue.delivery.candidates : []
);

// One row of tier/rarity toggles per delivery target family; everything else is a stone holder.
const targetFamilies = computed(() =>
  [
    ei.ArtifactSpec.Name.QUANTUM_METRONOME,
    ei.ArtifactSpec.Name.INTERSTELLAR_COMPASS,
    ei.ArtifactSpec.Name.ORNATE_GUSSET,
  ].map(afxId => {
    const options = artifactOptions
      .filter(a => a.afxId === afxId)
      .sort((a, b) => b.tier - a.tier || b.rarity - a.rarity);
    return { afxId, name: options[0]?.familyName ?? '', iconPath: options[0]?.iconPath ?? '', options };
  })
);
const holderOptions = artifactOptions.filter(a => !isDeliveryTargetArtifact(a.id) && a.slots > 0);
const holderCandidates = computed(() => autoCandidates.value.filter(c => !c.isTarget));

const hasCandidate = (artifactId: string) => autoCandidates.value.some(c => c.artifactId === artifactId);

const toggleCandidate = (artifactId: string) =>
  hasCandidate(artifactId) ? removeCandidate(artifactId) : addCandidate(artifactId);

const searchHolders = (query: string) => {
  const q = query.toLowerCase();
  return holderOptions.filter(a => a.label.toLowerCase().includes(q) || a.familyName.toLowerCase().includes(q));
};

function addCandidate(artifactId: string | null) {
  if (!artifactId || autoCandidates.value.some(c => c.artifactId === artifactId)) return;
  update(next => {
    if (next.delivery.mode !== 'auto') return;
    // Target artifacts (metronome/compass/gusset) ahead of stone holders, as the backup builder orders them.
    const candidate = toDeliveryCandidate(artifactId);
    const firstHolder = next.delivery.candidates.findIndex(c => !c.isTarget);
    const at = candidate.isTarget && firstHolder >= 0 ? firstHolder : next.delivery.candidates.length;
    next.delivery.candidates.splice(at, 0, candidate);
  });
}

function removeCandidate(artifactId: string) {
  update(next => {
    if (next.delivery.mode !== 'auto') return;
    next.delivery.candidates = next.delivery.candidates.filter(c => c.artifactId !== artifactId);
  });
}

function useInventoryDelivery() {
  if (!props.inventoryDelivery) return;
  update(next => {
    next.delivery = JSON.parse(JSON.stringify(props.inventoryDelivery));
  });
}

function setStone(family: StoneFamily, tier: StoneTier, value: number) {
  const count = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  update(next => {
    next.stones[family][tier] = count;
  });
}

function slotTint(artifactId: string): string {
  const artifact = getArtifact(artifactId);
  return artifact ? rarityTint(artifact.rarity) : 'white';
}

function choiceLabel(ids: string[]): string {
  const options = ids.map(id => getArtifact(id)!);
  return `${options.map(a => `T${a.tier}${a.rarityCode}`).join(' or ')} ${options[0].familyName}`;
}
</script>

<style scoped>
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}
</style>
