// How often the player is willing to relaunch. Shared so the artifact explorer and the ascension
// planner offer the same levels, mean the same thing by each, and describe them in the same words.

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Launch period per effort level: a floor on each mission's effective
// duration, so a slot runs at most one launch per period.
export const EFFORT_LAUNCH_PERIOD_SECONDS: Record<EffortLevel, number> = {
  low: 86400, // 1 launch / slot / day
  medium: 43200, // 2 launches / slot / day
  high: 3600, // 1 launch / slot / hour
  max: 0, // as often as the optimizer wants (raw durations)
};

export function isEffortLevel(x: unknown): x is EffortLevel {
  return (EFFORT_LEVELS as readonly unknown[]).includes(x);
}

export const EFFORT_META: Record<EffortLevel, { short: string; label: string; hint: string }> = {
  low: {
    short: 'Low',
    label: 'Low',
    hint: 'One launch per slot per day — favors long, low-maintenance missions.',
  },
  medium: {
    short: 'Med',
    label: 'Medium',
    hint: 'Two launches per slot per day.',
  },
  high: {
    short: 'High',
    label: 'High',
    hint: 'One launch per slot per hour.',
  },
  max: {
    short: 'Max',
    label: 'Max',
    hint: 'No launch limit — relaunch the instant a mission lands.',
  },
};
