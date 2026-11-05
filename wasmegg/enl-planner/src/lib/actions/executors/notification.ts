import type { ActionExecutor, ExecutorContext } from '../executor';
import type { NotificationPayload } from '@/types';

/**
 * Executor for notifications.
 */
export const notificationExecutor: ActionExecutor<'notification'> = {
  execute(payload: NotificationPayload, context: ExecutorContext): number {
    return 0; // Notifications don't change state or cost
  },

  getDisplayName(payload: NotificationPayload): string {
    return payload.message;
  },

  getEffectDescription(payload: NotificationPayload): string {
    return payload.submessage || '';
  },
};
