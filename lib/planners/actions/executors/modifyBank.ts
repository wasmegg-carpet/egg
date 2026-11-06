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

export function createModifyBankExecutor(profile: PlannerProfile): PayloadExecutor<ModifyBankPayload> {
  return {
    execute(payload: ModifyBankPayload, context: BaseExecutorContext): number {
      return 0; // No time or currency cost; the bank delta itself is reflected in bankDelta.
    },

    getDisplayName(): string {
      return 'Modify Bank Value';
    },

    getEffectDescription(payload: ModifyBankPayload): string {
      const sign = payload.delta >= 0 ? '+' : '-';
      return `${sign}${profile.currency.formatPrice(Math.abs(payload.delta))} ${profile.currency.name}`;
    },
  };
}
