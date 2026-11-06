/**
 * Core action payloads shared by the planners.
 */

/**
 * Payload for generic notifications or markers in history.
 */
export interface NotificationPayload {
  message: string;
  submessage?: string;
  icon?: string;
}

/**
 * Payload for manually overriding the bank value.
 * `mode: 'set'` replaces the bank value outright (amount is the new total);
 * `mode: 'delta'` adds/subtracts a fixed amount (amount is the +/- adjustment).
 */
export interface ModifyBankPayload {
  mode: 'set' | 'delta';
  amount: number;
  previousValue: number;
  delta: number;
}
