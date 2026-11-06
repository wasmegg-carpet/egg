/**
 * Formatting utility functions.
 * Pure functions for converting values to display strings.
 */

import { formatNumber } from 'lib/planners/format';
export { secondsToDate, formatNumber, formatWithReference, formatFullNumber, formatMultiplier, formatDuration, formatAbsoluteTime, formatPercent, parseNumber, parseDuration, formatUnixToDateInput, formatUnixToTimeInput } from 'lib/planners/format';

/**
 * Format a bock price.
 * If the cost is under 1,000, don't show any decimals.
 * If the cost is 1,000 or more, show with 3 decimal places.
 */
export function formatBockPrice(price: number): string {
  return formatNumber(price, price < 1000 ? 0 : 3);
}
