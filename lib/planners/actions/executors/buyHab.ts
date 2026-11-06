/**
 * Buy Hab Action Executor
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { PlannerProfile } from '../../profile';
import type { BuyHabPayload } from '../../types/actions/infrastructure';
import { isHabId } from '../../../farm/hab_space';
import { getHabById, countHabsOfType } from '../../habs';
import { formatNumber } from '../../format';

export function createBuyHabExecutor(profile: PlannerProfile): PayloadExecutor<BuyHabPayload> {
  return {
    execute(payload: BuyHabPayload, context: BaseExecutorContext): number {
      const { slotIndex, habId } = payload;

      if (!isHabId(habId)) return 0;

      // Get current habs to determine purchase index
      const habIds = context.getHabIds();
      const habsBeforeSlot = habIds.slice(0, slotIndex);
      const purchaseIndex = countHabsOfType(habsBeforeSlot, habId);

      // Get hab type and calculate cost
      const hab = getHabById(habId);
      if (!hab) return 0;

      const modifiers = context.getHabCostModifiers();
      const cost = profile.pricing.hab(hab, purchaseIndex, modifiers);

      // Apply change to store
      context.setHab(slotIndex, habId);

      return cost;
    },

    getDisplayName(payload: BuyHabPayload): string {
      if (!isHabId(payload.habId)) return 'Unknown Hab';

      const hab = getHabById(payload.habId);
      const name = hab?.name ?? 'Unknown Hab';

      return `${name} → slot ${payload.slotIndex + 1}`;
    },

    getEffectDescription(payload: BuyHabPayload): string {
      if (!isHabId(payload.habId)) return '';

      const hab = getHabById(payload.habId);
      if (!hab) return '';

      return `+${formatNumber(hab.baseCapacity, 0)} base capacity`;
    },
  };
}
