import type { ActionExecutor, ExecutorContext } from '../executor';
import type { ToggleSalePayload } from '@/types/actions';
import { useSalesStore } from '@/stores/sales';

export const toggleSaleExecutor: ActionExecutor<'toggle_sale'> = {
  execute(payload: ToggleSalePayload, context: ExecutorContext): number {
    const salesStore = useSalesStore();
    salesStore.setSaleActive(payload.saleType, payload.active);
    return 0; // No cost
  },

  getDisplayName(payload: ToggleSalePayload): string {
    const type = payload.saleType.charAt(0).toUpperCase() + payload.saleType.slice(1);
    return `${type} Sale ${payload.active ? 'Starts' : 'Ends'}`;
  },

  getEffectDescription(payload: ToggleSalePayload): string {
    if (!payload.active) return 'Normal prices restored';
    const discount = payload.saleType === 'research' ? '70%' : payload.saleType === 'hab' ? '80%' : '75%';
    return `${discount} discount applied to all ${payload.saleType} purchases`;
  },
};
