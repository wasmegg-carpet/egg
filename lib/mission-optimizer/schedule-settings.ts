// The player's schedule, as both apps ask for it: whether they sleep and for how many hours a day, and whether a
// 2x mission capacity event is running and how much of it is left. The artifact explorer's sidebar and the
// ascension planner's inline panel edit the same four fields through the same component (`ui/components/mission-optimizer/
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

// The shortest one while sleep is on: the control's step. Anything below it would read as "off" to the solver
// (`sleepSecondsOf`) while the box says on, so it is held here instead.
export const MIN_SLEEP_HOURS = 0.5;

// What switching sleep on starts from when no hours are kept.
export const DEFAULT_SLEEP_HOURS = 8;

// What the event's "time left" starts at: the whole of a 48-hour event, which is also the most it can be.
export const DEFAULT_DOUBLE_CAPACITY_REMAINING = formatDuration(MAX_DOUBLE_CAPACITY_SECONDS, true, { max: 'h' });

export interface ScheduleSettings {
  // Whether the plan is made around a sleep window. Off, `sleepHours` is kept but not planned around, so
  // switching sleep back on finds the hours as they were left.
  sleepEnabled: boolean;
  // Hours a day the player sleeps and cannot launch; ships still fly and land. At least `MIN_SLEEP_HOURS` while
  // `sleepEnabled`.
  sleepHours: number;
  // A 2x mission capacity event in progress, and how much of it is left, as typed (e.g. '48h', '3h30m'). The
  // window always starts when the plan does. Kept as typed, like the time budget, and read at use. Saved as typed
  // too: the time left does not count down, so '48h' entered today still reads '48h' on a later visit, until the
  // player changes it. The ascension planner also copies these settings into every visit not yet set up.
  doubleCapacityEnabled: boolean;
  doubleCapacityRemaining: string;
}

export function newScheduleSettings(): ScheduleSettings {
  return {
    sleepEnabled: false,
    sleepHours: 0,
    doubleCapacityEnabled: false,
    doubleCapacityRemaining: DEFAULT_DOUBLE_CAPACITY_REMAINING,
  };
}

// A stored or typed sleep setting as hours the planner can use: 0 for anything that is not a number, and
// otherwise held to the range the controls offer. With sleep on, `normalizeScheduleSettings` raises that 0 to
// `MIN_SLEEP_HOURS`.
export function clampSleepHours(hours: unknown): number {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return 0;
  return Math.min(MAX_SLEEP_HOURS, Math.max(0, hours));
}

// The settings with sleep switched on or off. Switching on with no hours kept starts at `DEFAULT_SLEEP_HOURS`
// rather than at the minimum; hours that were kept stay as they were.
export function withSleepEnabled(settings: ScheduleSettings, enabled: boolean): ScheduleSettings {
  const hours = clampSleepHours(settings.sleepHours);
  return normalizeScheduleSettings({
    ...settings,
    sleepEnabled: enabled,
    sleepHours: enabled && !(hours > 0) ? DEFAULT_SLEEP_HOURS : hours,
  });
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
// so a request without it carries no field for it at all. Sleep off asks for none whatever `sleepHours` holds. Null when the event is on but its "time left" is not
// a duration: there is no window to hand the solver, and solving without one would answer a question the
// player did not ask.
export interface ScheduleArgs {
  sleepSeconds?: number;
  eventWindowSeconds?: number;
}

export function scheduleArgsOf(settings: ScheduleSettings): ScheduleArgs | null {
  const sleepSeconds = settings.sleepEnabled ? Math.round(clampSleepHours(settings.sleepHours) * HOUR) : 0;
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
    (x.sleepEnabled === undefined || typeof x.sleepEnabled === 'boolean') &&
    (x.sleepHours === undefined || typeof x.sleepHours === 'number') &&
    (x.doubleCapacityEnabled === undefined || typeof x.doubleCapacityEnabled === 'boolean') &&
    (x.doubleCapacityRemaining === undefined || typeof x.doubleCapacityRemaining === 'string')
  );
}

// A stored record's four fields as the controls may show them: missing or mistyped ones take their defaults,
// and sleep is held to its range. A record from before sleep could be switched off has no `sleepEnabled`: it is on
// exactly when its stored hours were above 0, which is what those hours meant. While on, the hours are at least
// `MIN_SLEEP_HOURS`. A "time left" that does not parse is kept as typed, as the time budget is, for the field to
// flag rather than silently replace.
export function normalizeScheduleSettings(stored: Partial<Record<keyof ScheduleSettings, unknown>>): ScheduleSettings {
  const base = newScheduleSettings();
  const hours = clampSleepHours(stored.sleepHours);
  const sleepEnabled = typeof stored.sleepEnabled === 'boolean' ? stored.sleepEnabled : hours > 0;
  return {
    sleepEnabled,
    sleepHours: sleepEnabled ? Math.max(MIN_SLEEP_HOURS, hours) : hours,
    doubleCapacityEnabled: stored.doubleCapacityEnabled === true,
    doubleCapacityRemaining:
      typeof stored.doubleCapacityRemaining === 'string'
        ? stored.doubleCapacityRemaining
        : base.doubleCapacityRemaining,
  };
}

// ---------------------------------------------------------------------------
// What T+0 on the plan is
// ---------------------------------------------------------------------------

// The plan starts at the one moment the planner can know, now, and with sleep on it also has to say where in the
// day that is. These are the words for it, as the planner works today; the settings' tooltip and the timeline's
// footnote both read them, so a change to what T+0 means (an input for how long ago the player woke, say) is
// made here and nowhere else.

// Where the plan's clock starts, to finish "T+ counts from ...".
export function timingZero({ sleeping, event }: { sleeping: boolean; event: boolean }): string {
  if (sleeping && event) return 'now, the moment the event shows the time left you entered, with you just woken up';
  if (sleeping) return 'when you wake up';
  if (event) return 'now, the moment the event shows the time left you entered';
  return 'when you start launching';
}

// The line under the settings that opens the explanation below, or '' when neither setting has a start to
// explain.
export function timingNote({ sleeping, event }: { sleeping: boolean; event: boolean }): string {
  if (sleeping && event) return 'The plan starts now, as you wake up, with the event already running.';
  if (sleeping) return 'The plan starts now, as you wake up.';
  if (event) return 'The plan starts now.';
  return '';
}

// The explanation behind the note: what T+0 is, then how to read the rest of the plan. Plain text, as the
// tooltips here are.
export function timingTooltip({ sleeping, event }: { sleeping: boolean; event: boolean }): string {
  const parts: string[] = [];
  if (sleeping && event)
    parts.push(
      'T+0 on the plan is now, the moment the event shows the time left you entered, and the plan assumes you have just woken up.'
    );
  else if (sleeping) parts.push('T+0 on the plan is when you wake up. Start launching then.');
  else if (event) parts.push('T+0 on the plan is now, the moment the event shows the time left you entered.');
  if (sleeping)
    parts.push(
      'No launches during your sleep hours, but ships still fly and land. A ship that lands while you sleep ' +
        'waits until you wake. The green dot is a launch while you are awake, the indigo dot a launch that is in ' +
        'the air when you go to sleep.'
    );
  if (event) parts.push('Launches with the 2× badge go up inside the event.');
  return parts.join(' ');
}
