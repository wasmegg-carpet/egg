import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { NotificationPayload } from '../../types/actions/core';

/**
 * Executor for notifications.
 */
export const notificationExecutor: PayloadExecutor<NotificationPayload> = {
  execute(payload: NotificationPayload, context: BaseExecutorContext): number {
    return 0; // Notifications don't change state or cost
  },

  getDisplayName(payload: NotificationPayload): string {
    return payload.message;
  },

  getEffectDescription(payload: NotificationPayload): string {
    return payload.submessage || '';
  },
};
