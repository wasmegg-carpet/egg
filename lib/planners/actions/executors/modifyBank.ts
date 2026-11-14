/**
 * Modify Bank Value Action Executor
 *
 * Manually overrides the bank value, either by setting it to a fixed
 * amount or by adding/subtracting a delta. The bank value itself is
 * updated directly on the planner's store by the calling component; this
 * executor only supplies display metadata.
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { ModifyBankPayload } from '../../types/actions/core';
import type { PlannerProfile } from '../../profile';
import { formatDuration } from '../../format';

export function createModifyBankExecutor(profile: PlannerProfile): PayloadExecutor<ModifyBankPayload> {
  return {
    execute(payload: ModifyBankPayload, context: BaseExecutorContext): number {
      return 0; // No time or currency cost; the bank delta itself is reflected in bankDelta.
    },

    getDisplayName(payload?: ModifyBankPayload): string {
      const credit = payload?.earningsBoostCredit;
      if (credit) {
        return `Silo Credit: last ${formatDuration(credit.seconds)} counted at ${credit.multiplier}x`;
      }
      return 'Modify Bank Value';
    },

    getEffectDescription(payload: ModifyBankPayload): string {
      const sign = payload.delta >= 0 ? '+' : '-';
      const amount = `${sign}${profile.currency.formatPrice(Math.abs(payload.delta))} ${profile.currency.name}`;
      const credit = payload.earningsBoostCredit;
      if (credit) {
        return `${amount}: logging in during the ${credit.multiplier}x boost pays the last ${formatDuration(credit.seconds)} offline (silo-capped) at ${credit.multiplier}x; the wait already paid it at 1x`;
      }
      return amount;
    },
  };
}
