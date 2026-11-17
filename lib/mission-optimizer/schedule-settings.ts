// The player's schedule, as both apps ask for it: hours a day they sleep, and whether a 2x mission capacity
// event is running and how much of it is left. The artifact explorer's sidebar and the ascension planner's
// inline panel edit the same three fields through the same component (`ui/components/mission-optimizer/
// OptimizerScheduleSettings.vue`), and every rule about what a stored or typed value means lives here, so
// neither app can clamp, default or reject one differently from the other.
//
// The bounds themselves are the solver side's (`sleep.ts`, `capacity.ts`): what is offered here is exactly
// what `optimizeFull` will plan around, never a second limit to keep in step with it. Kept free of the loot
// dataset, so a store or a light module can import it.

import { formatDuration, parseDurationDays } from '../time';
import { MAX_DOUBLE_CAPACITY_SECONDS } from './capacity';
import { MAX_SLEEP_SECONDS } from './sleep';

const HOUR = 3600;

// The longest sleep window the controls offer, in hours a day.
export const MAX_SLEEP_HOURS = MAX_SLEEP_SECONDS / HOUR;

// What the event's "time left" starts at: the whole of a 48-hour event, which is also the most it can be.
export const DEFAULT_DOUBLE_CAPACITY_REMAINING = formatDuration(MAX_DOUBLE_CAPACITY_SECONDS, true, { max: 'h' });

export interface ScheduleSettings {
  // Hours a day the player sleeps and cannot launch; ships still fly and land. 0 plans around the clock.
  sleepHours: number;
  // A 2x mission capacity event in progress, and how much of it is left, as typed (e.g. '48h', '3h30m'). The
  // window always starts when the plan does. Kept as typed, like the time budget, and read at use.
  doubleCapacityEnabled: boolean;
  doubleCapacityRemaining: string;
}

export function newScheduleSettings(): ScheduleSettings {
  return { sleepHours: 0, doubleCapacityEnabled: false, doubleCapacityRemaining: DEFAULT_DOUBLE_CAPACITY_REMAINING };
}

// A stored or typed sleep setting as hours the planner can use: 0 (around the clock) for anything that is not a
// number, and otherwise held to the range the controls offer.
export function clampSleepHours(hours: unknown): number {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return 0;
  return Math.min(MAX_SLEEP_HOURS, Math.max(0, hours));
}

// The event's "time left" as seconds, read the way the field explains it: a bare number is hours, since no
// event has more than 48 of them left, and otherwise any of the duration notations the time budget takes.
// NaN for anything that is not a positive duration. Not clamped: `eventWindowInput` says when it would be.
export function parseEventRemaining(input: string): number {
  const trimmed = input.trim();
  const seconds = /^\d+(\.\d+)?$/.test(trimmed) ? parseFloat(trimmed) * HOUR : parseDurationDays(trimmed);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : NaN;
}

export interface EventWindowInput {
  // What the planner is handed: the typed window held to `MAX_DOUBLE_CAPACITY_SECONDS`, or NaN when it is not a
  // positive duration.
  seconds: number;
  invalid: boolean;
  // Typed longer than an event can have left, so it is planned as the cap.
  truncated: boolean;
}

export function eventWindowInput(input: string): EventWindowInput {
  const typed = parseEventRemaining(input);
  if (Number.isNaN(typed)) return { seconds: NaN, invalid: true, truncated: false };
  return {
    seconds: Math.min(typed, MAX_DOUBLE_CAPACITY_SECONDS),
    invalid: false,
    truncated: typed > MAX_DOUBLE_CAPACITY_SECONDS,
  };
}

// The tidy spelling a valid entry is rewritten to once the player leaves the field: hours and minutes, the cap
// for anything over it. Null when there is nothing valid to rewrite it to, so what was typed stays on screen.
export function normalizeEventRemaining(input: string): string | null {
  const { seconds, invalid } = eventWindowInput(input);
  if (invalid) return null;
  return formatDuration(seconds, true, { max: 'h', min: seconds < 60 ? 's' : 'm' });
}

// What the optimizer is asked to plan around, as `OptimizeArgs` fields. Each is absent rather than 0 when off,
// so a request without it carries no field for it at all. Null when the event is on but its "time left" is not
// a duration: there is no window to hand the solver, and solving without one would answer a question the
// player did not ask.
export interface ScheduleArgs {
  sleepSeconds?: number;
  eventWindowSeconds?: number;
}

export function scheduleArgsOf(settings: ScheduleSettings): ScheduleArgs | null {
  const sleepSeconds = Math.round(clampSleepHours(settings.sleepHours) * HOUR);
  let eventWindowSeconds = 0;
  if (settings.doubleCapacityEnabled) {
    const window = eventWindowInput(settings.doubleCapacityRemaining);
    if (window.invalid) return null;
    eventWindowSeconds = window.seconds;
  }
  return {
    ...(sleepSeconds > 0 && { sleepSeconds }),
    ...(eventWindowSeconds > 0 && { eventWindowSeconds }),
  };
}

// True when the fields a stored record has are of the right type. Absent fields pass, so a record written before
// one of them existed still loads; `normalizeScheduleSettings` fills them in.
export function scheduleSettingsFieldsValid(x: Partial<Record<keyof ScheduleSettings, unknown>>): boolean {
  return (
    (x.sleepHours === undefined || typeof x.sleepHours === 'number') &&
    (x.doubleCapacityEnabled === undefined || typeof x.doubleCapacityEnabled === 'boolean') &&
    (x.doubleCapacityRemaining === undefined || typeof x.doubleCapacityRemaining === 'string')
  );
}

// A stored record's three fields as the controls may show them: missing or mistyped ones take their defaults,
// and sleep is held to its range. A "time left" that does not parse is kept as typed, as the time budget is,
// for the field to flag rather than silently replace.
export function normalizeScheduleSettings(stored: Partial<Record<keyof ScheduleSettings, unknown>>): ScheduleSettings {
  const base = newScheduleSettings();
  return {
    sleepHours: clampSleepHours(stored.sleepHours),
    doubleCapacityEnabled: stored.doubleCapacityEnabled === true,
    doubleCapacityRemaining:
      typeof stored.doubleCapacityRemaining === 'string'
        ? stored.doubleCapacityRemaining
        : base.doubleCapacityRemaining,
  };
}
