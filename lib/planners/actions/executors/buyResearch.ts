/**
 * Buy Research Action Executor
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { PlannerProfile } from '../../profile';
import type { BuyResearchPayload } from '../../types/actions/research';
import { getResearchById } from '../../calculations/commonResearch';
import { formatNumber } from '../../format';

export function createBuyResearchExecutor(profile: PlannerProfile): PayloadExecutor<BuyResearchPayload> {
  return {
    execute(payload: BuyResearchPayload, context: BaseExecutorContext): number {
      const { researchId, fromLevel, toLevel } = payload;

      // Get research definition
      const research = getResearchById(researchId);
      if (!research) return 0;

      // Get cost modifiers
      const modifiers = context.getResearchCostModifiers();

      // Calculate cost (price for buying level toLevel, which is at index fromLevel)
      const cost = profile.pricing.research(research, fromLevel, modifiers);

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
}
