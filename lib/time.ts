export type DurationUnit = 'y' | 'd' | 'h' | 'm' | 's';

const UNIT_ORDER: readonly DurationUnit[] = ['y', 'd', 'h', 'm', 's'];
const UNIT_SECONDS: Readonly<Record<DurationUnit, number>> = {
  y: 31_536_000,
  d: 86_400,
  h: 3_600,
  m: 60,
  s: 1,
};

export interface DurationUnits {
  /** Largest unit used; anything above it accumulates into it rather than rolling up. Defaults to 'y'. */
  max?: DurationUnit;
  /** Smallest unit used; the remainder below it is discarded. Defaults to 'm'. */
  min?: DurationUnit;
}

/**
 * Format duration in the form of XdXhXm.
 * @param seconds - Duration to be formatted, in seconds.
 * @param trim - Whether to trim zero components (e.g. 1d0h5m to 1d5m).
 * @param units - Which units to spell it in; defaults to years through minutes.
 * @returns
 */
export function formatDuration(seconds: number, trim = false, units: DurationUnits = {}): string {
  if (seconds < 0) {
    // Dropping `trim` and `units` here is load-bearing: `TrophyForecast.vue` spells a lapsed forecast
    // as a trimmed negative and its output changes if they are passed on.
    return '-' + formatDuration(-seconds);
  }
  if (!isFinite(seconds)) {
    return 'Forever';
  }
  if (seconds > 3_153_600_000) {
    return '>100yr';
  }
  const first = UNIT_ORDER.indexOf(units.max ?? 'y');
  const last = UNIT_ORDER.indexOf(units.min ?? 'm');
  let rest = Math.floor(seconds);
  let out = '';
  for (let i = first; i <= last; i++) {
    const unit = UNIT_ORDER[i];
    const n = Math.floor(rest / UNIT_SECONDS[unit]);
    rest -= n * UNIT_SECONDS[unit];
    if (trim) {
      if (n === 0) continue;
      if (i > UNIT_ORDER.indexOf('d') && seconds >= UNIT_SECONDS.y) continue;
    } else if (unit === 'y' && n === 0) {
      continue;
    }
    out += `${n}${unit}`;
  }
  return out === '' ? `0${UNIT_ORDER[last]}` : out;
}

/**
 * Parse a duration string into seconds. Accepts a bare float/int interpreted
 * as days (e.g. "1.5"), or compressed unit notation (e.g. "12d12h", any
 * subset of y/d/h/m/s); whitespace is stripped.
 * @param str - The duration string to parse.
 * @returns Duration in seconds, or NaN if invalid/empty.
 */
export function parseDurationDays(str: string): number {
  if (!str) return NaN;
  const cleaned = str.replace(/\s+/g, '').toLowerCase();
  if (!cleaned) return NaN;

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned) * 86400;
  }

  if (!/^(?:\d+[ydhms])+$/.test(cleaned)) {
    return NaN;
  }

  const factors: Record<string, number> = { y: 31_536_000, d: 86400, h: 3600, m: 60, s: 1 };
  let totalSeconds = 0;
  const tokenRegex = /(\d+)([ydhms])/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(cleaned)) !== null) {
    totalSeconds += parseInt(match[1], 10) * factors[match[2]];
  }
  return totalSeconds;
}

/**
 * True if `input` parses to a finite, positive duration whose normalized form
 * (via formatDuration) reparses to a finite number. Remainders dropped by
 * formatDuration are fine to lose; the real failure mode is its `>100yr`
 * cutoff, which reparses to NaN.
 * @param input - The raw duration string as typed by the user.
 * @returns Whether it is safe to replace `input` with its normalized form.
 */
export function isDurationNormalizable(input: string): boolean {
  const seconds = parseDurationDays(input);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return false;
  }
  return Number.isFinite(parseDurationDays(formatDuration(seconds, true)));
}
