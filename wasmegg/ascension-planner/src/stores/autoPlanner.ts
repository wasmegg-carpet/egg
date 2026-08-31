import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AscensionSummary } from '@/auto/types';
import type { Action } from '@/types/actions/meta';

export type SaleCount = 1 | 2 | 3;
export type BuildVariantKey = `${SaleCount}-sale` | `${SaleCount}-sale-tier13`;
/** Every possible variant slot an ascension step can produce. Presence in a `variants` map (not a
 * separate boolean) is what signals a variant was actually computed and survived pruning. */
export type VariantKey = BuildVariantKey | 'continue';
export interface VariantResult {
  summary: AscensionSummary;
  actions: Action[];
}

export interface ChainedAscension {
  index: number;
  /** Only keys that were actually computed/survived pruning are present. */
  variants: Partial<Record<VariantKey, VariantResult>>;
  /** Reason `variants.continue` is absent (e.g. no farm backup, start time too far out) — a reason,
   * not just a boolean, so kept as its own field rather than folded into variants' absence. */
  result3SkippedReason?: string;
  goal: {
    type: 'te' | 'date';
    te: number | null;
    date: string;
    time: string;
  };
  initialParams?: {
    startDate: string;
    startTime: string;
    teEarned: Record<string, number>;
  };
  /** True when this ascension was silently injected to reach 490 TE, not entered by the user. */
  forcedTarget490?: boolean;
}

/**
 * Picks the variant to use for an ascension step: the override if it names a present variant, else
 * whichever present variant is "best" by whatever `hasEndTimeOverride` says "best" means. The single
 * shared implementation of what used to be four independently-duplicated "if override use it, else
 * pick shortest" checks.
 *
 * @param hasEndTimeOverride - True when this ascension step has a user-set end-time override
 *   active. Every surviving variant in that case was already clipped to the exact same deadline (see
 *   `runAscension`'s own `targetEndTime` doc comment) — so comparing `totalDurationSeconds` compares
 *   equal, fixed values and picks arbitrarily. "Best" instead means whichever variant reached the
 *   highest TE by that shared deadline.
 */
export function pickVariant(
  variants: Partial<Record<VariantKey, VariantResult>>,
  override?: VariantKey,
  hasEndTimeOverride?: boolean
): VariantResult {
  if (override && variants[override]) return variants[override]!;
  const candidates = Object.values(variants).filter((v): v is VariantResult => !!v);
  if (hasEndTimeOverride) {
    return candidates.reduce((a, b) => (a.summary.endTE >= b.summary.endTE ? a : b));
  }
  return candidates.reduce((a, b) => (a.summary.totalDurationSeconds <= b.summary.totalDurationSeconds ? a : b));
}

export const useAutoPlannerStore = defineStore('autoPlanner', () => {
  const ascensionChain = ref<ChainedAscension[]>([]);
  const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const startDate = ref('');
  const startTime = ref('');
  const targetTE = ref<string>('');
  const targetEndDate = ref('');
  const targetEndTime = ref('');
  const nextGoals = ref<Record<number, { te: number | null, date: string, time: string }>>({
    0: { te: 490, date: '', time: '' }
  });

  const planVariantOverrides = ref<Record<number, VariantKey>>({});
  /** Per-ascension end-time overrides: index -> unix timestamp (seconds), user-edited via
   * AscensionOverview's editable end date/time. Distinct from the scalar `targetEndDate`/
   * `targetEndTime` above, which are a single continuation-goal pair (see their own doc context in
   * PlanLibrary.vue) rather than a per-ascension map — conflating the two would mean a saved plan's
   * continuation goal and an in-session override on some other ascension index could stomp on each
   * other. Setting an override for index `i` supersedes that step's Target TE goal (see
   * `useAscensionGenerator.ts`'s `generate()`) and forces every ascension after it to be
   * recomputed, mirroring `planVariantOverrides`' own dirty-invalidation treatment there.
   */
  const endTimeOverrides = ref<Record<number, number>>({});
  const deferForEarningsMode = ref(false);

  function setPlan(data: {
    ascensionChain: ChainedAscension[];
    timezone: string;
    startDate: string;
    startTime: string;
    targetTE: string;
    targetEndDate?: string;
    targetEndTime?: string;
    nextGoals: Record<number, { te: number | null, date: string, time: string }>;
    planVariantOverrides?: Record<number, VariantKey>;
    endTimeOverrides?: Record<number, number>;
    /** @deprecated use planVariantOverrides */
    a1ForceMode?: 'continue' | 'prestige' | null;
  }) {
    ascensionChain.value = data.ascensionChain;
    timezone.value = data.timezone;
    startDate.value = data.startDate;
    startTime.value = data.startTime;
    targetTE.value = data.targetTE || '';
    targetEndDate.value = data.targetEndDate || '';
    targetEndTime.value = data.targetEndTime || '';
    nextGoals.value = data.nextGoals;
    endTimeOverrides.value = data.endTimeOverrides || {};
    if (data.planVariantOverrides) {
      planVariantOverrides.value = data.planVariantOverrides;
    } else if (data.a1ForceMode === 'continue') {
      planVariantOverrides.value = { 0: 'continue' };
    } else {
      planVariantOverrides.value = {};
    }
  }

  function clear() {
    ascensionChain.value = [];
    targetTE.value = '';
    targetEndDate.value = '';
    targetEndTime.value = '';
    nextGoals.value = { 0: { te: 490, date: '', time: '' } };
    planVariantOverrides.value = {};
    endTimeOverrides.value = {};
  }

  return {
    ascensionChain,
    timezone,
    startDate,
    startTime,
    targetTE,
    targetEndDate,
    targetEndTime,
    nextGoals,
    planVariantOverrides,
    endTimeOverrides,
    deferForEarningsMode,
    setPlan,
    clear,
  };
});
