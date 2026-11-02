import { formatEIValue, parseValueWithUnit } from 'lib';

/** Invalid drafts never stand in for the last valid solver budget. Zero is a valid cap. */
export function parseBudgetInput(raw: string): number {
  if (!raw.trim()) return NaN;
  const text = raw.trim();
  const value = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : parseValueWithUnit(text, false);
  return value !== null && Number.isFinite(value) && value >= 0 ? value : NaN;
}

export function normalizeBudgetInput(raw: string): string {
  const value = parseBudgetInput(raw);
  if (!Number.isFinite(value)) return raw;
  const formatted = formatEIValue(value, { trim: true });
  // Formatting large numbers can round them. Normalizing must not change the budget.
  return parseBudgetInput(formatted) === value ? formatted : raw.trim();
}

/** A stored budget rendered for its field. Round-tripping is the draft's job, not the display's. */
export function formatBudgetValue(value: number): string {
  return formatEIValue(value, { trim: true });
}
