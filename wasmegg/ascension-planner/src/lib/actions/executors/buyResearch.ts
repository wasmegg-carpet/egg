/**
 * Buy Research Action Executor
 */

import type { PayloadExecutor, BaseExecutorContext } from 'lib/planners/actions/executorTypes';
import type { BuyResearchPayload } from '@/types';
import { getResearchById, getDiscountedVirtuePrice } from '@/calculations/commonResearch';
import { formatNumber } from '@/lib/format';

export const buyResearchExecutor: PayloadExecutor<BuyResearchPayload> = {
  execute(payload: BuyResearchPayload, context: BaseExecutorContext): number {
    const { researchId, fromLevel, toLevel } = payload;

    // Get research definition
    const research = getResearchById(researchId);
    if (!research) return 0;

    // Get cost modifiers
    const modifiers = context.getResearchCostModifiers();

    // Calculate cost (price for buying level toLevel, which is at index fromLevel)
    const cost = getDiscountedVirtuePrice(research, fromLevel, modifiers);

    // Apply change to store
    context.setResearchLevel(researchId, toLevel);

    return cost;
  },

  getDisplayName(payload: BuyResearchPayload): string {
    const research = getResearchById(payload.researchId);
    const name = research?.name ?? 'Unknown Research';

    return `${name} → Lv${payload.toLevel}`;
  },

  getEffectDescription(payload: BuyResearchPayload): string {
    const research = getResearchById(payload.researchId);
    if (!research) return '';

    // Calculate the effect of this level
    const perLevel = research.per_level;
    const compound = research.levels_compound;

    if (compound === 'additive') {
      // e.g., +10% per level
      const effectPercent = perLevel * 100;
      return `+${effectPercent}% ${research.categories}`;
    } else {
      // Multiplicative: e.g., 2x per level
      return `×${perLevel} ${research.categories}`;
    }
  },
};
