/**
 * Formatting utility functions.
 * Pure functions for converting values to display strings.
 */

/**
 * Converts an absolute Unix timestamp in SECONDS into a `Date`, rounding to the nearest millisecond
 * first instead of handing the raw product straight to `new Date()`.
 *
 * Every one of these timestamps is, in practice, the sum of a base start time plus a chain of
 * accumulated purchase/wait durations — ordinary floating-point addition across hundreds of steps
 * routinely leaves a sub-microsecond residue even when the "true" value is exactly a whole second
 * (see `BOUNDARY_EPSILON_SECONDS` in `lib/events.ts` for why that's expected and harmless to
 * price/timing decisions). The problem is specifically `new Date(ms)`: per spec it TRUNCATES a
 * fractional millisecond value toward zero rather than rounding, so a timestamp landing at, say,
 * `X.9999998601` seconds — 140 nanoseconds short of an exact sale boundary — displays as `X:59.999`,
 * a full second early, which any HH:MM-only view then renders as a full minute early. Rounding here
 * makes the display match the value's actual (sub-microsecond) precision instead of its worst case.
 *
 * Use this instead of a bare `new Date(seconds * 1000)` for any user-facing display of a COMPUTED
 * timestamp (anything derived from `lastStepTime`, action durations, etc.) — not needed for genuinely
 * literal/already-integer timestamps (e.g. `Date.now()`, a stored millisecond field).
 */
export function secondsToDate(seconds: number): Date {
  return new Date(Math.round(seconds * 1000));
}

/**
 * Format a large number with suffixes (K, M, B, T, etc.) or scientific notation.
 *
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 3)
 * @returns Formatted string
 *
 * @example
 * formatNumber(1234) // "1.234K"
 * formatNumber(1234567890) // "1.235B"
 * formatNumber(1e20) // "1.000e+20"
 */
const SUFFIXES = [
  '',
  'K',
  'M',
  'B',
  'T',
  'q',
  'Q',
  's',
  'S',
  'o',
  'N',
  'd',
  'U',
  'D',
  'Td',
  'qd',
  'Qd',
  'sd',
  'Sd',
  'Od',
  'Nd',
  'V',
  'uV',
  'dV',
  'tV',
  'qV',
  'QV',
  'sV',
  'Sv',
  'OV',
  'NV',
  'tT',
];

/**
 * Format a large number with suffixes (K, M, B, T, etc.) or scientific notation.
 *
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 3)
 * @returns Formatted string
 *
 * @example
 * formatNumber(1234) // "1.234K"
 * formatNumber(1234567890) // "1.235B"
 * formatNumber(1e20) // "1.000e+20"
 */
export function formatNumber(value: number, decimals: number = 3): string {
  if (value === 0) return '0';
  if (!isFinite(value)) return '∞';

  let result: string;
  if (Math.abs(value) < 1000) {
    result = value.toFixed(decimals);
  } else {
    const magnitude = Math.floor(Math.log10(Math.abs(value)) / 3);

    if (magnitude >= SUFFIXES.length) {
      result = value.toExponential(decimals);
    } else {
      const scaled = value / Math.pow(1000, magnitude);
      result = scaled.toFixed(decimals) + SUFFIXES[magnitude];
    }
  }

  // Handle -0.000 case: if the result starts with a minus but evaluates to zero
  if (result.startsWith('-')) {
    // Strip everything except numbers, decimal point, and minus
    const numPart = result.replace(/[^-0-9.]/g, '');
    if (parseFloat(numPart) === 0) {
      return result.substring(1); // Return the positive version (e.g. "0.000")
    }
  }

  return result;
}

/**
 * Format a value using the same magnitude/suffix as a reference value.
 * Useful for showing deltas next to a total (e.g. "1.234q (+0.001q)").
 */
export function formatWithReference(value: number, reference: number, decimals: number = 3): string {
  if (value === 0) return '0';
  if (!isFinite(value)) return '∞';

  // If reference is small or exponential, just use standard formatting
  if (Math.abs(reference) < 1000) return value.toFixed(decimals);
  const magnitude = Math.floor(Math.log10(Math.abs(reference)) / 3);
  if (magnitude >= SUFFIXES.length) return value.toExponential(decimals);

  const scaled = value / Math.pow(1000, magnitude);
  return scaled.toFixed(decimals) + SUFFIXES[magnitude];
}

/**
 * Format a gem price.
 * If the cost is under 1,000, don't show any decimals.
 * If the cost is 1,000 or more, show with 3 decimal places.
 */
export function formatGemPrice(price: number): string {
  return formatNumber(price, price < 1000 ? 0 : 3);
}

/**
 * Format a number with thousands separators, showing the full value without suffixes or rounding.
 *
 * @param value - The number to format
 * @returns Formatted string (e.g., "1,234,567")
 */
export function formatFullNumber(value: number): string {
  if (value === 0) return '0';
  if (!isFinite(value)) return '∞';
  return Math.round(value).toLocaleString();
}

/**
 * Format a multiplier for display.
 *
 * @param value - The multiplier value (1.0 = no change)
 * @param asPercent - If true, show as percentage change (e.g., "+50%")
 * @returns Formatted string
 *
 * @example
 * formatMultiplier(2.5) // "2.50x"
 * formatMultiplier(1.5, true) // "+50.0%"
 * formatMultiplier(0.8, true) // "-20.0%"
 */
export function formatMultiplier(value: number, asPercent: boolean = false): string {
  if (asPercent) {
    const percent = (value - 1) * 100;
    return (percent >= 0 ? '+' : '') + percent.toFixed(1) + '%';
  }
  return value.toFixed(2) + 'x';
}

/**
 * Format a duration in seconds to human-readable form.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "5.2h", "3.5d")
 *
 * @example
 * formatDuration(45) // "45s"
 * formatDuration(3600) // "1.0h"
 * formatDuration(86400) // "1.0d"
 */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '∞';

  // Round to the nearest whole second up front — every branch below floors seconds into minutes,
  // then minutes into hours, then hours into days, and this function never shows sub-second
  // precision anyway. Without this, a value that's THEORETICALLY exact (e.g. a duration
  // back-derived as `gems / gemsPerSecond` from a delta that was itself `gemsPerSecond * exactSeconds`)
  // but lands a sub-microsecond epsilon under a whole unit due to the two floating-point ops not
  // perfectly inverting each other gets floored down a full unit at every level it cascades through
  // — confirmed in the wild: a 27h-exact silo credit displaying as "1d 2h" (26h) instead of "1d 3h"
  // (27h) because 27h's worth of seconds landed at 97199.99999999999, not 97200.
  seconds = Math.round(seconds);

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days > 999) {
    return '>999d';
  }

  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Format an absolute completion time based on a duration in seconds.
 *
 * @param seconds - Duration in seconds from the base timestamp
 * @param baseTimestamp - Base Unix timestamp in milliseconds (defaults to Date.now())
 * @param timeZone - Optional IANA timezone identifier
 * @returns Formatted absolute time string
 *
 * @example
 * formatAbsoluteTime(3600) // e.g., "Tue, Feb 24, 5:43 PM"
 */
export function formatAbsoluteTime(seconds: number, baseTimestamp?: number, timeZone?: string): string {
  if (!isFinite(seconds)) return '∞';
  const start = baseTimestamp ?? Date.now();
  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment for why a
  // sub-millisecond float residue (routine after accumulating many purchases/waits) needs rounding
  // rather than truncation here, or a value a fraction of a second short of a whole second displays
  // as a full second (and, in an HH:MM-only view, a full minute) early.
  const date = new Date(Math.round(start + seconds * 1000));
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
}

/**
 * Format a percentage value.
 *
 * @param value - The decimal value (0.5 = 50%)
 * @param decimals - Number of decimal places
 * @returns Formatted percentage string
 *
 * @example
 * formatPercent(0.5) // "50%"
 * formatPercent(0.333, 1) // "33.3%"
 */
export function formatPercent(value: number, decimals: number = 0): string {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Parse a number from a string, handling scientific notation and suffixes.
 *
 * @param str - The string to parse
 * @returns Parsed number, or NaN if invalid
 *
 * @example
 * parseNumber("1.5K") // 1500
 * parseNumber("2.5e6") // 2500000
 */
export function parseNumber(str: string): number {
  // Case-sensitive suffix multipliers matching Egg Inc standard units
  const suffixMultipliers: Record<string, number> = {
    'K': 1e3,
    'M': 1e6,
    'B': 1e9,
    'T': 1e12,
    'q': 1e15,
    'Q': 1e18,
    's': 1e21,
    'S': 1e24,
    'o': 1e27,
    'N': 1e30,
    'd': 1e33,
    'U': 1e36,
    'D': 1e39,
    'Td': 1e42,
    'qd': 1e45,
    'Qd': 1e48,
    'sd': 1e51,
    'Sd': 1e54,
    'Od': 1e57,
    'Nd': 1e60,
    'V': 1e63,
    'uV': 1e66,
    'dV': 1e69,
    'tV': 1e72,
    'qV': 1e75,
    'QV': 1e78,
    'sV': 1e81,
    'Sv': 1e84,
    'OV': 1e87,
    'NV': 1e90,
    'tT': 1e93,
  };

  const trimmed = str.trim();
  if (!trimmed) return NaN;

  // Find suffix (one or two letters at the end)
  let numPartStr = trimmed;
  let multiplier = 1;

  // Check for multi-character suffixes first (e.g., Td, qd, Qd, sd, Sd, Od, Nd, uV, dV, tV, qV, QV, sV, Sv, OV, NV, tT)
  // Actually, suffixMultipliers only has single char ones currently. 
  // Let's check for the ones in suffixMultipliers.

  // Heuristic for suffix: check last 2 chars, then last 1 char.
  const last2 = trimmed.slice(-2);
  const last1 = trimmed.slice(-1);

  if (suffixMultipliers[last2] !== undefined) {
    numPartStr = trimmed.slice(0, -2);
    multiplier = suffixMultipliers[last2];
  } else if (suffixMultipliers[last1] !== undefined) {
    numPartStr = trimmed.slice(0, -1);
    multiplier = suffixMultipliers[last1];
  }

  // Clean numeric part: handle commas and multiple dots
  numPartStr = numPartStr.trim().replace(/\s/g, '');

  const lastDot = numPartStr.lastIndexOf('.');
  const lastComma = numPartStr.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastDot > lastComma) {
      // US style: 1,234.56
      numPartStr = numPartStr.replace(/,/g, '');
    } else {
      // European style: 1.234,56
      numPartStr = numPartStr.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma !== -1) {
    // Only comma present: is it thousands or decimal?
    // In "Ascension Planner", if they say "9,123d", it's likely decimal.
    // If they say "123,456", it's likely thousands.
    // Heuristic: if comma is followed by exactly 3 digits and it's NOT the last char before suffix, it's likely thousands.
    // Actually, "handle commas or decimals as a separator" suggests treating comma as decimal.
    // Let's see if there's more than one comma.
    const commaCount = (numPartStr.match(/,/g) || []).length;
    if (commaCount > 1) {
      numPartStr = numPartStr.replace(/,/g, '');
    } else {
      // Single comma. If it's 123,456 it's thousands. If it's 1,23 it's decimal.
      // But if there's a suffix, it's almost always a decimal.
      if (multiplier !== 1) {
        numPartStr = numPartStr.replace(',', '.');
      } else {
        // No suffix. Compare with typical thousands vs decimal.
        const parts = numPartStr.split(',');
        if (parts[1].length === 3) {
          numPartStr = numPartStr.replace(',', '');
        } else {
          numPartStr = numPartStr.replace(',', '.');
        }
      }
    }
  } else {
    // Only dots or nothing. Just use standard float parsing.
    // But remove multiple dots if they exist (though invalid).
    const dotCount = (numPartStr.match(/\./g) || []).length;
    if (dotCount > 1) {
      // Keep only last dot
      const parts = numPartStr.split('.');
      const decimal = parts.pop();
      numPartStr = parts.join('') + '.' + decimal;
    }
  }

  return parseFloat(numPartStr) * multiplier;
}
/**
 * Parse a duration string into seconds.
 * Supports:
 * - Float numbers (interpreted as hours)
 * - Compressed format: 1d2h3m4s
 *
 * @param str - The duration string to parse
 * @returns Duration in seconds, or NaN if invalid
 *
 * @example
 * parseDuration("1.5") // 5400 (1.5 hours)
 * parseDuration("1d2h") // 93600 (26 hours)
 */
export function parseDuration(str: string): number {
  if (!str) return NaN;
  const trimmed = str.trim().toLowerCase();

  // Try parsing as simple float (hours)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed) * 3600;
  }

  // Try parsing as duration string (e.g., 1d2h3m4s)
  let totalSeconds = 0;
  let hasMatch = false;

  const patterns = [
    { regex: /(\d+)d/, factor: 86400 },
    { regex: /(\d+)h/, factor: 3600 },
    { regex: /(\d+)m/, factor: 60 },
    { regex: /(\d+)s/, factor: 1 },
  ];

  for (const { regex, factor } of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      totalSeconds += parseInt(match[1]) * factor;
      hasMatch = true;
    }
  }

  return hasMatch ? totalSeconds : NaN;
}

/**
 * Format a Unix timestamp to a date string (YYYY-MM-DD) in a specific timezone.
 */
export function formatUnixToDateInput(timestamp: number, tz: string): string {
  const d = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

/**
 * Format a Unix timestamp to a 24-hour time string (HH:MM) in a specific timezone.
 */
export function formatUnixToTimeInput(timestamp: number, tz: string): string {
  const d = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat('en-GB', { 
    timeZone: tz, 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  }).format(d);
}
