// The arena's calendar verifier: C1 for a problem with a sleep window or a 2x capacity window, and for any plan a
// candidate returns a calendar with. A candidate returns, per slot, the launches it would fly and when; this
// checks them against the sleep rule, the event window and the plan's own allocation. Owned by the harness and never shared with `lib/mission-optimizer`, for the reason the packer and the sleep
// model are not: a verifier the planner also ran would agree with it whatever either computed. Imports
// nothing. See ARENA.md, "Sleep".

const DAY_SECONDS = 86400;

// Slack on every time comparison, in seconds. A microsecond: far below any launch a player could act on, far
// above the float drift of summing a few hundred durations on a horizon of a few million seconds.
const TIME_TOL = 1e-6;

// What the verifier reads off the harness's own menu. Generic so this file needs no import, not even a type one.
export interface CalendarMenuEntry {
  id: string;
  actualTime: number;
  nights?: number;
  variant?: string;
  // A launch at T+0 in the night the plan starts in (`startVariants`): its charge from T+0.
  atStartSeconds?: number;
}

// The day the instance was stated with, as the harness built it, not as the candidate read it. Without a sleep
// window `sleepSeconds` is 0 and the horizon is the slot; without an event, `eventWindowSeconds` is 0.
export interface CalendarDay {
  sleepSeconds: number;
  horizonSeconds: number;
  slots: number;
  eventWindowSeconds?: number;
  // Seconds since the player woke up, at the plan's start: the player's day runs that far ahead of the plan's clock.
  // Absent or 0 starts the plan at wake-up.
  wakeOffsetSeconds?: number;
}

// Every way the calendar breaks the rule or misstates the plan; empty when it verifies. Each launch is timed
// with the menu's `actualTime` and `nights` for the option it names, never with figures the candidate wrote
// beside it: a launch occupies its slot for `actualTime + nights * S`, must start while the player is awake
// (time of day at most `W`, the day counted from the player's last wake-up, `wakeOffsetSeconds` before the plan's
// start), may not start before the plan does or before the previous launch in its slot has finished, and must
// finish by the horizon. A launch of a doubled option (`event` or `overhang` on the menu, whatever the candidate
// says) must start at or before `eventWindowSeconds`, and there is none without a window. Conversely, the game
// doubles whatever goes up inside the window, so a launch of a `normal` option strictly inside it (by more than the
// tolerance) is a fault when the menu could have flown it doubled there: its `overhang` copy for the slot's last
// launch at or before the window's end, its `event` copy for an earlier one, found by the ids this harness's
// `capacity.ts` gives them (`<id>::event`, `<id>::overhang`). The calendar's launches per option must equal
// `allocation` exactly.
export function calendarFaults(
  calendar: unknown,
  menu: readonly CalendarMenuEntry[],
  allocation: readonly number[],
  day: CalendarDay
): string[] {
  const faults: string[] = [];
  if (!Array.isArray(calendar)) return ['calendar is not an array'];
  if (calendar.length !== day.slots) return [`calendar has ${calendar.length} slot(s), the problem has ${day.slots}`];
  const waking = DAY_SECONDS - day.sleepSeconds;
  const awakeFor = day.wakeOffsetSeconds ?? 0;
  const flown = new Array<number>(menu.length).fill(0);
  const window = day.eventWindowSeconds ?? 0;
  const ids = new Set(menu.map(entry => entry.id));
  calendar.forEach((slot: unknown, k: number) => {
    if (!Array.isArray(slot)) {
      faults.push(`slot ${k} is not an array`);
      return;
    }
    let free = 0;
    // The last launch that may go up doubled, which is the one that could be the slot's overhang.
    let lastInside = -1;
    slot.forEach((launch: { launchAt?: unknown }, i: number) => {
      if (window > 0 && typeof launch?.launchAt === 'number' && launch.launchAt <= window + TIME_TOL) lastInside = i;
    });
    slot.forEach((launch: { option?: unknown; optionId?: unknown; launchAt?: unknown }, i: number) => {
      const where = `slot ${k} launch ${i}`;
      const index = launch?.option;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= menu.length) {
        faults.push(`${where} names option ${String(index)}, not on the menu`);
        return;
      }
      const entry = menu[index];
      if (launch.optionId !== entry.id) {
        faults.push(`${where} names option ${index} as ${String(launch.optionId)}, but its id is ${entry.id}`);
        return;
      }
      const at = launch.launchAt;
      if (typeof at !== 'number' || !Number.isFinite(at)) {
        faults.push(`${where} has launch time ${String(at)}`);
        return;
      }
      flown[index]++;
      if (at < free - TIME_TOL) {
        faults.push(`${where} (${entry.id}) at ${at}s starts before the slot is free at ${free}s`);
      }
      // On the player's own day, which started `awakeFor` before the plan did. A plan starting in the night has the
      // player up at T+0 to launch, at that instant only.
      const sinceWake = awakeFor + at;
      const dayIndex = Math.floor((sinceWake + TIME_TOL) / DAY_SECONDS);
      const timeOfDay = sinceWake - dayIndex * DAY_SECONDS;
      const upToLaunch = awakeFor > waking && Math.abs(at) <= TIME_TOL;
      if (entry.atStartSeconds !== undefined && !upToLaunch) {
        faults.push(`${where} (${entry.id}) at ${at}s is a T+0 launch, flown elsewhere`);
      }
      if (timeOfDay > waking + TIME_TOL && !upToLaunch) {
        faults.push(
          `${where} (${entry.id}) at ${at}s launches ${timeOfDay}s into day ${dayIndex}, asleep after ${waking}s`
        );
      }
      const doubled = entry.variant === 'event' || entry.variant === 'overhang';
      if (doubled && !(window > 0)) faults.push(`${where} (${entry.id}) flies doubled with no 2x window`);
      else if (doubled && at > window + TIME_TOL) {
        faults.push(`${where} (${entry.id}) at ${at}s flies doubled, past the 2x window at ${window}s`);
      } else if (!doubled && window > 0 && at < window - TIME_TOL) {
        const copy = `${entry.id}::${i === lastInside ? 'overhang' : 'event'}`;
        if (ids.has(copy))
          faults.push(`${where} (${entry.id}) at ${at}s flies 1x inside the 2x window, as ${copy} could`);
      }
      // A launch at T+0 holds its slot to its landing; every other launch for its waking seconds and its nights.
      free = Math.max(free, at) + (entry.atStartSeconds ?? entry.actualTime + (entry.nights ?? 0) * day.sleepSeconds);
    });
    if (free > day.horizonSeconds + TIME_TOL) {
      faults.push(`slot ${k} is busy until ${free}s, past the ${day.horizonSeconds}s horizon`);
    }
  });
  for (let i = 0; i < menu.length; i++) {
    const allocated = allocation[i] ?? 0;
    if (flown[i] !== allocated)
      faults.push(`option ${i} (${menu[i].id}) is allocated ${allocated} but flown ${flown[i]} time(s)`);
  }
  return faults;
}
