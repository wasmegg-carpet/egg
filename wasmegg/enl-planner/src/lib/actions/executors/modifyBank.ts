/**
 * Modify Bank Value Action Executor
 *
 * Manually overrides the bank value, either by setting it to a fixed
 * amount or by adding/subtracting a delta. The bank value itself is
 * updated directly on the virtue store by the calling component; this
 * executor only supplies display metadata.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { ModifyBankPayload } from '@/types';
import { formatBockPrice } from '@/lib/format';

export const modifyBankExecutor: ActionExecutor<'modify_bank'> = {
  execute(payload: ModifyBankPayload, context: ExecutorContext): number {
    return 0; // No time or bock cost; the bank delta itself is reflected in bankDelta.
  },

  getDisplayName(): string {
    return 'Modify Bank Value';
  },

  getEffectDescription(payload: ModifyBankPayload): string {
    const sign = payload.delta >= 0 ? '+' : '-';
    return `${sign}${formatBockPrice(Math.abs(payload.delta))} bocks`;
  },
};
