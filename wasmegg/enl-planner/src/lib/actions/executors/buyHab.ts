/**
 * Buy Hab Action Executor
 */

import type { PayloadExecutor, BaseExecutorContext } from 'lib/planners/actions/executorTypes';
import type { BuyHabPayload } from '@/types';
import { getHabById, getDiscountedHabPrice, countHabsOfType, isHabId } from '@/lib/habs';
import { formatNumber } from '@/lib/format';

export const buyHabExecutor: PayloadExecutor<BuyHabPayload> = {
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
    const cost = getDiscountedHabPrice(hab, purchaseIndex, modifiers);

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
