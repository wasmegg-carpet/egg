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
  // Eggs the launch burns, all types together: what the fueling pad has to move into it before it goes up.
  actualFuel?: number;
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
  // Eggs a second the one fueling pad moves, for every slot; absent is instant fueling, no pad rule at all.
  fuelingRate?: number;
}

// The fueling pad, as this harness states it (ARENA.md, "The fueling pad"). One pad for all the slots, empty at the
// plan's start; it fuels one ship at a time, for the ship's fuel over the rate, and starts on the next ship only once
// the one on it has gone up. So, taking every launch of the plan in launch order, the first goes up no sooner than its
// own fueling after t = 0, and every other one no sooner than its own fueling after the launch before it. Ties at one
// instant are read longest fueling first, the only order the pad could have served them in if any. Returns the faults,
// and which launches make up the start chain: the launches from the start that the pad served back to back, the
// first at its fueling after t = 0 and each next one at the fuelings so far summed, which the player stays up for,
// asleep or not. Without a rate every fueling is instant and the chain is the launches at t = 0 itself.
function padRule(
  calendar: readonly unknown[],
  menu: readonly CalendarMenuEntry[],
  rate: number | undefined
): { faults: string[]; upFor: Set<string> } {
  const timed: { k: number; i: number; at: number; fuel: number }[] = [];
  calendar.forEach((slot: unknown, k: number) => {
    if (!Array.isArray(slot)) return;
    slot.forEach((launch: { option?: unknown; launchAt?: unknown }, i: number) => {
      const index = launch?.option;
      const at = launch?.launchAt;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= menu.length) return;
      if (typeof at !== 'number' || !Number.isFinite(at)) return;
      const eggs = menu[index].actualFuel ?? 0;
      timed.push({ k, i, at, fuel: rate !== undefined && rate > 0 ? eggs / rate : 0 });
    });
  });
  timed.sort((a, b) => a.at - b.at || b.fuel - a.fuel || a.k - b.k || a.i - b.i);
  const faults: string[] = [];
  const upFor = new Set<string>();
  let last = 0;
  // The chain's own clock: its fuelings summed from t = 0, so that without a rate it is t = 0 exactly.
  let chained = 0;
  let unbroken = true;
  for (const t of timed) {
    if (rate !== undefined && t.at < last + t.fuel - TIME_TOL) {
      faults.push(
        `slot ${t.k} launch ${t.i} at ${t.at}s goes up before the fueling pad could fuel it: ${t.fuel}s after the ` +
          `launch before it at ${last}s`
      );
    }
    chained += t.fuel;
    unbroken = unbroken && Math.abs(t.at - chained) <= TIME_TOL;
    if (unbroken) upFor.add(`${t.k}/${t.i}`);
    last = t.at;
  }
  return { faults, upFor };
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
  const pad = padRule(calendar, menu, day.fuelingRate);
  faults.push(...pad.faults);
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
      // On the player's own day, which started `awakeFor` before the plan did. The player is up for the start chain
      // (`padRule`), and a launch in it may go up in the night: a plan starting in the night has nothing else to
      // launch before the wake-up, and the pad can carry the chain past a bedtime. A T+0 launch goes up in that chain,
      // in the night the plan starts in, and nowhere else.
      const sinceWake = awakeFor + at;
      const dayIndex = Math.floor((sinceWake + TIME_TOL) / DAY_SECONDS);
      const timeOfDay = sinceWake - dayIndex * DAY_SECONDS;
      const upFor = pad.upFor.has(`${k}/${i}`);
      const upToLaunch = awakeFor > waking && upFor;
      if (entry.atStartSeconds !== undefined && !upToLaunch) {
        faults.push(`${where} (${entry.id}) at ${at}s is a T+0 launch, flown elsewhere`);
      }
      if (timeOfDay > waking + TIME_TOL && !upFor) {
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
