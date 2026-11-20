// The player's schedule, as both apps ask for it: whether they sleep and for how many hours a day, and whether a
// 2x mission capacity event is running and how much of it is left. The artifact explorer's sidebar and the
// ascension planner's inline panel edit the same five fields through the same component (`ui/components/mission-optimizer/
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

const DAY_HOURS = 24;

// The most "since you woke" the control accepts, in hours, whatever the sleep: anything short of a whole day. Up
// to `24 - sleepHours` the player is awake at T+0; past it they are up past their usual bedtime just to launch, and
// sleep the rest of that night (`solver/SPEC.md` section 17). Held to the control's step below 24, because the
// solver reads a whole day as no offset at all.
export const MAX_HOURS_SINCE_WAKE = 23.5;

// A typed or stored "since you woke" held to what the control accepts: 0 for anything that is not a number. It
// does not depend on the sleep hours, so changing those never changes it.
export function clampHoursSinceWake(hours: unknown): number {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return 0;
  return Math.min(MAX_HOURS_SINCE_WAKE, Math.max(0, hours));
}

// What the event's "time left" starts at: the whole of a 48-hour event, which is also the most it can be.
export const DEFAULT_DOUBLE_CAPACITY_REMAINING = formatDuration(MAX_DOUBLE_CAPACITY_SECONDS, true, { max: 'h' });

export interface ScheduleSettings {
  // Whether the plan is made around a sleep window. Off, `sleepHours` is kept but not planned around, so
  // switching sleep back on finds the hours as they were left.
  sleepEnabled: boolean;
  // Hours a day the player sleeps and cannot launch; ships still fly and land. At least `MIN_SLEEP_HOURS` while
  // `sleepEnabled`.
  sleepHours: number;
  // Hours since the player last woke, at the plan's start (now), while `sleepEnabled`; 0 is just woken up. Kept as
  // entered when `sleepHours` changes, so it can outrun the range the control then offers: the solver reads it
  // against the sleep it is handed. Ignored with sleep off.
  hoursSinceWake: number;
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
    hoursSinceWake: 0,
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
// so a request without it carries no field for it at all. Sleep off asks for none whatever `sleepHours` holds.
// Null when the event is on but its "time left" is not a duration: there is no window to hand the solver, and
// solving without one would answer a question the player did not ask.
export interface ScheduleArgs {
  sleepSeconds?: number;
  // Only with sleep on, and only above 0: how long ago the player woke, at the plan's start.
  wakeOffsetSeconds?: number;
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
  // Anywhere short of a day: awake at T+0 up to the waking window's length, past it up in the night to launch.
  const wakeOffsetSeconds = sleepSeconds > 0 ? Math.round(clampHoursSinceWake(settings.hoursSinceWake) * HOUR) : 0;
  return {
    ...(sleepSeconds > 0 && { sleepSeconds }),
    ...(wakeOffsetSeconds > 0 && { wakeOffsetSeconds }),
    ...(eventWindowSeconds > 0 && { eventWindowSeconds }),
  };
}

// True when the fields a stored record has are of the right type. Absent fields pass, so a record written before
// one of them existed still loads; `normalizeScheduleSettings` fills them in.
export function scheduleSettingsFieldsValid(x: Partial<Record<keyof ScheduleSettings, unknown>>): boolean {
  return (
    (x.sleepEnabled === undefined || typeof x.sleepEnabled === 'boolean') &&
    (x.sleepHours === undefined || typeof x.sleepHours === 'number') &&
    (x.hoursSinceWake === undefined || typeof x.hoursSinceWake === 'number') &&
    (x.doubleCapacityEnabled === undefined || typeof x.doubleCapacityEnabled === 'boolean') &&
    (x.doubleCapacityRemaining === undefined || typeof x.doubleCapacityRemaining === 'string')
  );
}

// A stored record's five fields as the controls may show them: missing or mistyped ones take their defaults,
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
    hoursSinceWake: clampHoursSinceWake(stored.hoursSinceWake),
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

// T+0 is always now: the moment the settings are entered, which with the event on is the moment the event shows
// the time left that was entered. With sleep on the plan also has to say where in the player's day now is, which
// is "since you woke": `W = 24 - sleep hours` is the waking window, and `x` hours into it the player is awake and
// goes to sleep at T+(W - x), wakes at T+(24 - x) and keeps those hours. Past it (`x > W`) they are up past their
// usual bedtime just to launch at T+0 and sleep until T+(24 - x), their usual wake-up. These functions are the
// words for it; the settings' note and tooltip and the timeline's footnote all read them, so a change to what T+0
// means is made here and nowhere else.

export interface Timing {
  // Hours a day of sleep the plan is made around; 0 for none.
  sleepHours: number;
  // Hours since the player woke, at T+0 (`ScheduleSettings.hoursSinceWake`); read only with sleep on.
  hoursSinceWake: number;
  // Whether a 2x capacity event runs, the plan's window starting at T+0.
  event: boolean;
}

// A time on the plan's clock as the timeline prints it, floored to the minute so a time read off the card is never
// later than the one the plan was verified at: a doubled launch shown at T+47h59m still goes up inside a 48h window.
export const formatPlanClock = (seconds: number): string =>
  seconds >= 60 ? `T+${formatDuration(seconds, true)}` : 'T+0';

const clockOfHours = (hours: number): string => formatPlanClock(Math.round(hours * HOUR));

// The plan's sleep as the copy reads it: the clock times of the player's next bedtime and wake-up, and whether
// they are already past it.
function sleepTimes({ sleepHours, hoursSinceWake }: Timing) {
  const waking = DAY_HOURS - sleepHours;
  const x = Math.max(0, hoursSinceWake);
  return { bedtime: waking - x, wakeUp: DAY_HOURS - x, pastBedtime: x > waking };
}

const eventClause = 'the moment the event shows the time left you entered';

// The line under the settings that opens the explanation below, or '' when neither setting has a start to
// explain.
export function timingNote(timing: Timing): string {
  const running = timing.event ? ', with the event already running' : '';
  if (timing.sleepHours > 0) {
    const x = Math.max(0, timing.hoursSinceWake);
    const since =
      Math.round(x * HOUR) >= 60 ? `${formatDuration(Math.round(x * HOUR), true)} after you woke` : 'as you wake up';
    return `The plan starts now, ${since}${running}.`;
  }
  return timing.event ? 'The plan starts now.' : '';
}

// The explanation behind the note: what T+0 is, where the day goes from there, then how to read the rest of the
// plan. Plain text, as the tooltips here are.
export function timingTooltip(timing: Timing): string {
  const sleeping = timing.sleepHours > 0;
  if (!sleeping && !timing.event) return '';
  const parts = [`T+0 on the plan is now${timing.event ? `, ${eventClause}` : ''}.`];
  if (sleeping) {
    const { bedtime, wakeUp, pastBedtime } = sleepTimes(timing);
    parts.push(
      pastBedtime
        ? `You're up past your usual bedtime: launch the first ships from T+0 as each finishes fueling, then sleep until ${clockOfHours(wakeUp)}, your usual wake-up.`
        : `You go to sleep at ${clockOfHours(bedtime)} and wake at ${clockOfHours(wakeUp)}, then keep the same hours.`,
      'No launches during your sleep hours, but ships still fly and land. A ship that lands while you sleep ' +
        'waits until you wake. The green dot is a launch while you are awake, the indigo dot a launch that is in ' +
        'the air when you go to sleep.'
    );
  }
  if (timing.event) parts.push('Launches with the 2× badge go up inside the event.');
  // The pad: nothing is fueled at T+0, and launches due together go up one fueling apart.
  parts.push('One ship fuels at a time, starting now, so launches due together go up a few minutes apart.');
  return parts.join(' ');
}
