import { downloadFile } from '@/utils/export';
import type { Action } from '@/types/actions/meta';
import type { AscensionSummary } from './types';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';

interface ExportedPlanGoal {
  type: 'te' | 'date';
  te: number | null;
  date: string;
  time: string;
}

interface ExportedInitialState {
  epicResearchLevels: Record<string, number>;
  colleggtibleTiers: Record<string, number>;
  artifactLoadout: any[];
  soulEggs: number;
  isUltra: boolean;
  initialTankLevel: number;
  initialFuelAmounts: Record<string, number>;
  initialEggsDelivered: Record<string, number>;
  initialTeEarned: Record<string, number>;
}

export interface ExportedPlan {
  version: 2;
  exportedAt: string;        // ISO timestamp
  startTime: number;
  timezone: string;
  initialState: ExportedInitialState;
  planVariantOverrides?: Record<number, VariantKey>;
  /** Per-ascension end-time overrides (index -> unix timestamp), same shape as the store's own
   * `endTimeOverrides` — see its doc comment in `stores/autoPlanner.ts`. Absent on exports made
   * before this field existed; treated as `{}` on import. */
  endTimeOverrides?: Record<number, number>;
  /** @deprecated use planVariantOverrides */
  a1ForceMode?: 'continue' | 'prestige' | null;
  ascensions: {
    index: number;
    targetTE: number;
    variants: Partial<Record<VariantKey, VariantResult>>;
    result3SkippedReason?: string;
    goal: ExportedPlanGoal;
  }[];
}

/** The pre-variant-matrix export format (`result1`/`result2`/`result3?` per ascension). */
export interface ExportedPlanV1 {
  version: 1;
  exportedAt: string;
  startTime: number;
  timezone: string;
  initialState: ExportedInitialState;
  planVariantOverrides?: Record<number, 'continue' | '1-sale' | '2-sale'>;
  /** @deprecated use planVariantOverrides */
  a1ForceMode?: 'continue' | 'prestige' | null;
  ascensions: {
    index: number;
    targetTE: number;
    result1: { summary: AscensionSummary; actions: Action[] };
    result2: { summary: AscensionSummary; actions: Action[] };
    result3?: { summary: AscensionSummary; actions: Action[] };
    result3SkippedReason?: string;
    goal: ExportedPlanGoal;
  }[];
}

/**
 * Migrates a `version: 1` export (`result1`/`result2`/`result3?`) into the current `variants`-map
 * shape: `result1 → variants['1-sale']`, `result2 → variants['2-sale']`, `result3 → variants.continue`.
 * `planVariantOverrides`' old values (`'1-sale' | '2-sale' | 'continue'`) are already a subset of the
 * current `VariantKey` union, so they carry over unchanged.
 */
export function migrateExportedPlanV1(old: ExportedPlanV1): ExportedPlan {
  return {
    ...old,
    version: 2,
    ascensions: old.ascensions.map(a => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': a.result1,
        '2-sale': a.result2,
      };
      if (a.result3) variants.continue = a.result3;
      return {
        index: a.index,
        targetTE: a.targetTE,
        variants,
        result3SkippedReason: a.result3SkippedReason,
        goal: a.goal,
      };
    }),
  };
}

/**
 * Triggers a browser download of the ascension plan as a JSON file.
 */
export function triggerPlanExport(plan: ExportedPlan) {
  const dateStr = new Date().toISOString().split('T')[0];
  const x = plan.ascensions.length;
  const firstVariant = Object.values(plan.ascensions[0]?.variants ?? {})[0];
  const lastVariant = Object.values(plan.ascensions[x - 1]?.variants ?? {})[0];
  const startTE = firstVariant?.summary.startTE ?? 0;
  const endTE = lastVariant?.summary.endTE ?? 0;

  const filename = `Auto_AP_${dateStr}_${x}-ascensions_${startTE}_to_${endTE}.json`;
  const content = JSON.stringify(plan);
  downloadFile(filename, content, 'application/json');
}
