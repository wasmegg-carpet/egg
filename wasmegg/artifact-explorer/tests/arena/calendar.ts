// The arena's calendar verifier: C1 for a problem with a sleep window. A sleep-aware candidate returns, per
// slot, the launches it would fly and when; this checks them against the sleep rule and against the plan's own
// allocation. Owned by the harness and never shared with `src/lib`, for the reason the packer and the sleep
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
}

// The day the instance was stated with, as the harness built it, not as the candidate read it.
export interface CalendarDay {
  sleepSeconds: number;
  horizonSeconds: number;
  slots: number;
}

// Every way the calendar breaks the rule or misstates the plan; empty when it verifies. Each launch is timed
// with the menu's `actualTime` and `nights` for the option it names, never with figures the candidate wrote
// beside it: a launch occupies its slot for `actualTime + nights * S`, must start while the player is awake
// (time of day at most `W`), may not start before the previous launch in its slot has finished, and must
// finish by the horizon. The calendar's launches per option must equal `allocation` exactly.
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
  const flown = new Array<number>(menu.length).fill(0);
  calendar.forEach((slot: unknown, k: number) => {
    if (!Array.isArray(slot)) {
      faults.push(`slot ${k} is not an array`);
      return;
    }
    let free = 0;
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
      const dayIndex = Math.floor((at + TIME_TOL) / DAY_SECONDS);
      const timeOfDay = at - dayIndex * DAY_SECONDS;
      if (timeOfDay > waking + TIME_TOL) {
        faults.push(
          `${where} (${entry.id}) at ${at}s launches ${timeOfDay}s into day ${dayIndex}, asleep after ${waking}s`
        );
      }
      free = Math.max(free, at) + entry.actualTime + (entry.nights ?? 0) * day.sleepSeconds;
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
