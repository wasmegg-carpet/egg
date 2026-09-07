/**
 * Data prep for the two comparison charts in `VariantComparisonModal.vue`:
 *
 * 1. A C3-only earnings-rate chart (see `getC3Actions`/`buildC3EarningsSeries`/`buildC3Markers`).
 * 2. A K3-onward "TE-wait race" chart comparing total eggs delivered over time (see
 *    `buildVariantRay`/`computeCrossings`).
 *
 * Kept out of the .vue files so the (non-trivial) math — phase segmentation, TE-threshold
 * subdivision, ray/crossing algebra — is unit-testable and readable without template noise.
 */
import type { Action } from '@/types/actions/meta';
import type { VirtueEgg } from '@/types/actions/virtue';
import { VIRTUE_EGGS, VIRTUE_EGG_NAMES } from '@/types/actions/virtue';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';
import { isTierUnlocked } from '@/calculations/commonResearch';
import { getThresholdForTE } from '@/lib/truthEggs';
import { getTimezoneOffsetAt } from '@/lib/events';
import { allResearches } from 'lib';
import type { Research } from '@/types';

/** Minimal shape of an echarts tooltip-formatter callback param — just the fields these charts'
 * `tooltip.formatter`s actually read, for both line-point hovers (`value`) and markPoint/markLine
 * hovers (`data`, carrying whatever these charts stash on each marker). */
export interface ChartTooltipParams {
  componentType?: string;
  seriesName?: string;
  value?: [number, number];
  data?: {
    coord?: [number, number];
    xAxis?: number;
    markerLabel: string;
    kind?: 'te' | 'crossing';
    egg?: string;
    perEggTE?: number;
    grandTotalTE?: number;
  };
}

// ---------------------------------------------------------------------------------------------
// Variant identity: fixed color/label assignment
// ---------------------------------------------------------------------------------------------

/** Fixed display/color order for every variant slot — colors are assigned by this order, never
 * by sorted position (e.g. duration), so a given variant keeps the same color across renders and
 * across both charts. */
export const VARIANT_KEY_ORDER: VariantKey[] = [
  '1-sale',
  '1-sale-tier13',
  '2-sale',
  '2-sale-tier13',
  '3-sale',
  '3-sale-tier13',
  'continue',
];

// dataviz skill's validated categorical palette (light mode only — this app has no dark theme),
// slots 1-7 in their documented fixed order.
const CATEGORICAL_COLORS = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
];

const VARIANT_COLORS: Partial<Record<VariantKey, string>> = Object.fromEntries(
  VARIANT_KEY_ORDER.map((key, i) => [key, CATEGORICAL_COLORS[i]])
);

export function variantColor(key: VariantKey): string {
  return VARIANT_COLORS[key] ?? '#898781';
}

/** Same label logic `VariantComparisonModal.vue`'s summary table already used inline — centralized
 * here so the charts and the table stay in sync. */
export function variantLabel(key: VariantKey): string {
  return key === 'continue' ? 'Continue Asc.' : key.replace('-tier13', ' + T13').replace('-', ' ');
}

function totalEggsDelivered(record: Record<VirtueEgg, number>): number {
  return VIRTUE_EGGS.reduce((sum, egg) => sum + (record[egg] || 0), 0);
}

export interface TimedAction {
  action: Action;
  time: number; // absolute Unix epoch seconds
}

/**
 * Pairs every action with its absolute Unix-epoch-seconds timestamp, computed by summing each
 * action's own `totalTimeSeconds` from the ascension's start.
 *
 * Deliberately NOT derived from `endState.lastStepTime`: `engine/compute.ts`'s population
 * catch-up step snaps `lastStepTime` straight to `context.ascensionStartTime` — discarding
 * whatever relative offset it was tracking — the first time a snapshot is computed without
 * `skipEpochConversion` while still in a small relative frame. Several shift helpers hit that
 * path mid-simulation, which produces one action per hit whose `endState.lastStepTime` jumps
 * backward to the ascension's start instead of holding its real moment — exactly the "line jumps
 * back then snaps forward again" artifact this timeline sidesteps entirely. `totalTimeSeconds` is
 * the same per-action duration the engine sums to produce `summary.totalDurationSeconds`
 * (purchases contribute 0, waits contribute their real length), so this timeline is guaranteed
 * consistent with every duration already shown elsewhere in this app.
 */
function buildTimeline(actions: Action[], startTime: number): TimedAction[] {
  let t = startTime;
  return actions.map(action => {
    t += action.totalTimeSeconds || 0;
    return { action, time: t };
  });
}

function researchName(id: string): string {
  return (allResearches as Research[]).find(r => r.id === id)?.name ?? id;
}

export function formatChartTick(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(epochMs));
}

/** Date-only tick label ("Fri, Nov 14") — for a chart whose ticks land on day boundaries (the
 * TE-wait race spans weeks), showing a time component that's always midnight is just noise. */
export function formatChartTickDate(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(epochMs));
}

/**
 * Shifts an epoch-ms timestamp by its timezone offset so that formatting the *shifted* value with
 * `timeZone: 'UTC'` produces the exact wall-clock date/time a viewer in `timeZone` would see for
 * the *original* instant.
 *
 * echarts' time axis only knows how to compute its own "nice" day/week/month tick boundaries in
 * either the browser's local zone or UTC (the `useUTC` option) — it has no way to target an
 * arbitrary IANA zone. Feeding it pre-shifted values with `useUTC: true` set makes its internal
 * calendar math land on real day boundaries in `timeZone` instead of silently following whichever
 * zone the browser happens to be in. Every x-value handed to this chart (data points, markPoint/
 * markLine coordinates, axis min/max) needs this same shift for the axis to stay consistent — and
 * every formatter reading a value back out of it must format with `'UTC'`, not the real zone,
 * since the shift already did that conversion.
 */
export function shiftForChartTimezone(epochMs: number, timeZone: string): number {
  const offsetSeconds = getTimezoneOffsetAt(timeZone, Math.floor(epochMs / 1000));
  return epochMs + offsetSeconds * 1000;
}

// ---------------------------------------------------------------------------------------------
// Shift-phase segmentation (shared C3/K3 boundary finder)
// ---------------------------------------------------------------------------------------------

/** The 13-phase build+wait sequence every freshly-generated variant follows, in order (see
 * `src/auto/PLAN.md` §8). `continue` has no build phase at all and never matches this. */
const CANONICAL_PHASES = ['C1', 'K1', 'I1', 'C2', 'K2', 'R1', 'C3', 'H1', 'K3', 'C4', 'I2', 'R2', 'H2'] as const;
const C3_PHASE_INDEX = CANONICAL_PHASES.indexOf('C3');
const K3_PHASE_INDEX = CANONICAL_PHASES.indexOf('K3');

function shiftIndices(timeline: TimedAction[]): number[] {
  const indices: number[] = [];
  timeline.forEach((t, i) => {
    if (t.action.type === 'shift') indices.push(i);
  });
  return indices;
}

/**
 * `[startIndex, endIndex]` (inclusive) into `timeline` for the given canonical phase, identified
 * by counting `shift` actions rather than by egg — a plan can start on curiosity with no leading
 * `shift` at all, which would throw off any "Nth shift into curiosity" count. Segment 0 (C1) runs
 * from the very start to the first shift; segment N starts at the Nth shift. Returns `null` if the
 * plan never reaches that phase (`continue`, which skips the build phase entirely, or any variant
 * whose plan was cut short by a date goal before reaching it).
 */
function phaseWindow(timeline: TimedAction[], phaseIndex: number): [number, number] | null {
  const shifts = shiftIndices(timeline);
  const start = phaseIndex === 0 ? 0 : shifts[phaseIndex - 1];
  if (start === undefined || timeline.length === 0) return null;
  const end = shifts[phaseIndex] ?? timeline.length - 1;
  return [start, end];
}

// ---------------------------------------------------------------------------------------------
// Chart 1 — C3-only earnings-rate comparison
// ---------------------------------------------------------------------------------------------

export interface TimeSeriesPoint {
  time: number; // epoch ms
  value: number;
}

export type C3MarkerKind =
  | 'graviton_coupling'
  | 'multi_layering'
  | 'tier13_unlocked'
  | 'research_sale_start'
  | 'research_sale_end'
  | 'earnings_boost_start'
  | 'earnings_boost_end';

export interface ChartMarker {
  time: number; // epoch ms
  value: number;
  kind: C3MarkerKind | 'te_earned';
  label: string;
  egg?: VirtueEgg; // only set for `te_earned`
  perEggTE?: number; // only set for `te_earned` — this egg's own TE count at this marker (1-98)
}

/** The slice of `actions` covering this variant's C3 shift, paired with the timeline built off
 * `startTime`, or `null` if it doesn't have one (`continue`, or a plan cut short before reaching
 * C3). */
export function getC3Actions(actions: Action[], startTime: number): TimedAction[] | null {
  const timeline = buildTimeline(actions, startTime);
  const window = phaseWindow(timeline, C3_PHASE_INDEX);
  if (!window) return null;
  const [start, end] = window;
  return timeline.slice(start, end + 1);
}

/** $/hr earnings-rate series across the C3 window — matches the "Peak Earnings" column elsewhere
 * in this modal, which is also `onlineEarnings * 3600`. */
export function buildC3EarningsSeries(c3: TimedAction[]): TimeSeriesPoint[] {
  return c3.map(({ action, time }) => ({
    time: time * 1000,
    value: action.endState.onlineEarnings * 3600,
  }));
}

const TIER13 = 13;

export function buildC3Markers(c3: TimedAction[]): ChartMarker[] {
  const markers: ChartMarker[] = [];
  let tier13Seen = false;

  for (const { action, time: timeSeconds } of c3) {
    const time = timeSeconds * 1000;
    const value = action.endState.onlineEarnings * 3600;

    if (action.type === 'buy_research') {
      const payload = action.payload;
      if (payload.researchId === 'micro_coupling') {
        markers.push({
          time,
          value,
          kind: 'graviton_coupling',
          label: `${researchName('micro_coupling')} → Lv ${payload.toLevel}`,
        });
      } else if (payload.researchId === 'multi_layering') {
        markers.push({
          time,
          value,
          kind: 'multi_layering',
          label: `${researchName('multi_layering')} → Lv ${payload.toLevel}`,
        });
      }
      if (!tier13Seen && isTierUnlocked(action.endState.researchLevels, TIER13)) {
        tier13Seen = true;
        markers.push({ time, value, kind: 'tier13_unlocked', label: 'Tier 13 unlocked' });
      }
    } else if (action.type === 'toggle_sale') {
      const payload = action.payload;
      if (payload.saleType === 'research') {
        markers.push({
          time,
          value,
          kind: payload.active ? 'research_sale_start' : 'research_sale_end',
          label: payload.active ? 'Research sale started' : 'Research sale ended',
        });
      }
    } else if (action.type === 'toggle_earnings_boost') {
      const payload = action.payload;
      markers.push({
        time,
        value,
        kind: payload.active ? 'earnings_boost_start' : 'earnings_boost_end',
        label: payload.active ? '2× earnings started' : '2× earnings ended',
      });
    }
  }

  return markers;
}

// ---------------------------------------------------------------------------------------------
// Chart 2 — K3-onward TE-wait race
// ---------------------------------------------------------------------------------------------

export interface VariantRay {
  key: VariantKey;
  anchorTime: number; // epoch seconds — where ELR settles at its final (max) value
  anchorEggs: number;
  slope: number; // eggs/second — `summary.maxELR`, constant for the rest of the ascension
  realPoints: TimeSeriesPoint[]; // actual simulated points from the anchor to the last action
  lastRealTime: number; // epoch seconds
  lastRealEggs: number;
  startTE: number; // total TE (all eggs) at the start of the ascension, before any of this plan's TE is earned
  teMarkers: ChartMarker[]; // chronological — teMarkers[i] is the (startTE + i + 1)-th TE earned
}

/** Last index at/after `minIndex` where ELR changed — i.e. where the constant-ELR tail begins.
 * Falls back to `minIndex` itself if ELR never changes in range (e.g. the `continue` variant,
 * which does no further purchasing and is already at max ELR from its very first action). */
function findRampAnchorIndex(timeline: TimedAction[], minIndex: number): number {
  for (let i = timeline.length - 1; i >= minIndex; i--) {
    if (timeline[i].action.elrDelta !== 0) return i;
  }
  return Math.min(minIndex, timeline.length - 1);
}

function buildTEMarkers(timelineFromAnchor: TimedAction[], maxELR: number): ChartMarker[] {
  const markers: ChartMarker[] = [];

  timelineFromAnchor.forEach(({ action, time }, i) => {
    if (action.type !== 'wait_for_te') return;
    const payload = action.payload;
    const rate = maxELR;
    if (rate <= 0) return;

    // `startTime`/`startTotalEggs` anchor this wait's own elapsed-time math — the action right
    // before it is where the wait actually began (this action's own endState is where it ends).
    const prev = i > 0 ? timelineFromAnchor[i - 1] : null;
    const startTime = prev ? prev.time : time;
    const startTotalEggs = prev
      ? totalEggsDelivered(prev.action.endState.eggsDelivered)
      : totalEggsDelivered(action.endState.eggsDelivered);

    // A single `wait_for_te` action can cross more than one TE threshold at once (its egg may
    // have needed several more TE to hit its assigned target) — subdivide it so each threshold
    // gets its own, correctly-timed marker instead of clumping them all at the action's end.
    for (let te = payload.startTE + 1; te <= payload.targetTE; te++) {
      const thresholdEggs = getThresholdForTE(te);
      const eggsNeeded = thresholdEggs - payload.startEggsDelivered;
      if (eggsNeeded < 0) continue;
      const crossingTime = startTime + eggsNeeded / rate;
      const crossingTotalEggs = startTotalEggs + eggsNeeded; // only this egg accrues during the wait
      markers.push({
        time: crossingTime * 1000,
        value: crossingTotalEggs,
        kind: 'te_earned',
        label: `+1 TE (${VIRTUE_EGG_NAMES[payload.egg]}) — ${te} total`,
        egg: payload.egg,
        perEggTE: te,
      });
    }
  });

  return markers;
}

// Points to spread a variant's real (solid) segment across — dense enough that at least a couple
// of vertices always fall inside any zoomed-in view, however far a viewer scrubs in.
const REAL_SEGMENT_SAMPLES = 60;

function sampleRay(
  anchorTime: number,
  anchorEggs: number,
  slope: number,
  endTime: number,
  samples: number
): TimeSeriesPoint[] {
  if (endTime <= anchorTime) return [{ time: anchorTime * 1000, value: anchorEggs }];
  const points: TimeSeriesPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = anchorTime + ((endTime - anchorTime) * i) / samples;
    points.push({ time: t * 1000, value: anchorEggs + slope * (t - anchorTime) });
  }
  return points;
}

/** Builds this variant's constant-ELR "ray" — everything from the moment K3 finishes its last
 * purchase onward is a single straight line (see `src/auto/PLAN.md`: "After the build phase, ELR
 * is constant", and shifting between eggs costs zero simulated time), so extrapolating past the
 * plan's last action is just extending that same line. Returns `null` for an empty action list. */
export function buildVariantRay(key: VariantKey, result: VariantResult): VariantRay | null {
  const { actions, summary } = result;
  if (actions.length === 0) return null;

  const timeline = buildTimeline(actions, summary.startTime);

  // `continue` has no build phase (`phaseWindow` returns null for it) — search its whole action
  // list instead; it does no purchasing, so the anchor naturally falls at/near its first action.
  const k3Window = phaseWindow(timeline, K3_PHASE_INDEX);
  const minIndex = k3Window ? k3Window[0] : 0;
  const anchorIndex = findRampAnchorIndex(timeline, minIndex);
  const anchor = timeline[anchorIndex];

  const anchorTime = anchor.time;
  const anchorEggs = totalEggsDelivered(anchor.action.endState.eggsDelivered);
  const slope = summary.maxELR;

  const timelineFromAnchor = timeline.slice(anchorIndex);
  const last = timeline[timeline.length - 1];
  const lastRealTime = last.time;

  // Densely resample the straight ray itself rather than plotting the raw (often very sparse)
  // action-boundary points: two variants can go dozens of actions between real vertices near
  // their anchor (a burst of instant vehicle purchases) while another has a single ~4-day gap
  // with nothing in between (straight to its first TE-wait) — and when both endpoints of that
  // one long segment fall outside a zoomed-in view, the line doesn't reliably get drawn at all.
  // This costs nothing in accuracy — the whole stretch from the anchor onward is mathematically
  // exactly this straight line — it just guarantees plenty of real vertices at any zoom level.
  const realPoints = sampleRay(anchorTime, anchorEggs, slope, lastRealTime, REAL_SEGMENT_SAMPLES);

  return {
    key,
    anchorTime,
    anchorEggs,
    slope,
    realPoints,
    lastRealTime,
    lastRealEggs: totalEggsDelivered(last.action.endState.eggsDelivered),
    startTE: summary.startTE,
    teMarkers: buildTEMarkers(timelineFromAnchor, summary.maxELR),
  };
}

/** The dashed continuation of a ray from its last real data point out to `horizonMs` — empty if
 * the horizon doesn't extend past the real data. */
export function projectedSegment(ray: VariantRay, horizonMs: number): TimeSeriesPoint[] {
  const horizonSeconds = horizonMs / 1000;
  if (horizonSeconds <= ray.lastRealTime) return [];
  return [
    { time: ray.lastRealTime * 1000, value: ray.lastRealEggs },
    { time: horizonMs, value: ray.anchorEggs + ray.slope * (horizonSeconds - ray.anchorTime) },
  ];
}

export interface Crossing {
  a: VariantKey;
  b: VariantKey;
  time: number; // epoch ms
  eggs: number;
  overtaker: VariantKey; // whichever has the steeper ray — the one that takes the lead here and keeps it
  overtaken: VariantKey;
}

export interface NeverCrossing {
  a: VariantKey;
  b: VariantKey;
  reason: 'parallel' | 'before-both-valid';
  leader: VariantKey; // whichever is ahead once both rays are valid — stays ahead forever
}

// Rays closer than this (eggs/second) are treated as parallel rather than solved for an
// effectively-infinite crossing time.
const SLOPE_EPSILON = 1e-9;

function rayValueAt(ray: VariantRay, time: number): number {
  return ray.anchorEggs + ray.slope * (time - ray.anchorTime);
}

/**
 * Every pairwise crossing between variants' rays, plus a note for every pair that never crosses
 * (identical peak ELR, or an algebraic crossing that falls before both variants are even on their
 * constant-ELR ray — not something this chart has real data to back up). Since each ray is a
 * straight line, this is exact closed-form line/line intersection, not curve sampling.
 */
export function computeCrossings(rays: VariantRay[]): { crossings: Crossing[]; neverCrossing: NeverCrossing[] } {
  const crossings: Crossing[] = [];
  const neverCrossing: NeverCrossing[] = [];

  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const ra = rays[i];
      const rb = rays[j];
      const domainStart = Math.max(ra.anchorTime, rb.anchorTime);
      const leaderAtStart = rayValueAt(ra, domainStart) >= rayValueAt(rb, domainStart) ? ra.key : rb.key;

      const slopeDiff = ra.slope - rb.slope;
      if (Math.abs(slopeDiff) < SLOPE_EPSILON) {
        neverCrossing.push({ a: ra.key, b: rb.key, reason: 'parallel', leader: leaderAtStart });
        continue;
      }

      // Solve ra.anchorEggs + ra.slope*(t - ra.anchorTime) === rb.anchorEggs + rb.slope*(t - rb.anchorTime)
      const t = (rb.anchorEggs - rb.slope * rb.anchorTime - ra.anchorEggs + ra.slope * ra.anchorTime) / slopeDiff;

      if (t < domainStart) {
        neverCrossing.push({ a: ra.key, b: rb.key, reason: 'before-both-valid', leader: leaderAtStart });
        continue;
      }

      crossings.push({
        a: ra.key,
        b: rb.key,
        time: t * 1000,
        eggs: rayValueAt(ra, t),
        overtaker: ra.slope > rb.slope ? ra.key : rb.key,
        overtaken: ra.slope > rb.slope ? rb.key : ra.key,
      });
    }
  }

  crossings.sort((x, y) => x.time - y.time);
  return { crossings, neverCrossing };
}

/** X-axis horizon (epoch ms): far enough to show every crossing plus a little breathing room.
 * `extraTimesMs` folds in other moments the chart needs visible (e.g. the target-TE crossing —
 * see `findTargetTECrossing`) that might otherwise fall past the last real/crossing point. */
export function computeHorizon(rays: VariantRay[], crossings: Crossing[], extraTimesMs: number[] = []): number {
  const lastReal = Math.max(...rays.map(r => r.lastRealTime));
  const lastCrossing = crossings.length ? crossings[crossings.length - 1].time / 1000 : lastReal;
  const lastExtra = extraTimesMs.length ? Math.max(...extraTimesMs) / 1000 : lastReal;
  const earliestAnchor = Math.min(...rays.map(r => r.anchorTime));
  const horizon = Math.max(lastReal, lastCrossing, lastExtra);
  const span = Math.max(horizon - earliestAnchor, 1);
  return (horizon + span * 0.0) * 1000;
}

export interface TargetTECrossing {
  variant: VariantKey;
  time: number; // epoch ms
  totalTE: number; // >= targetTE
}

/**
 * When the given (chosen/active) variant's ray reaches `targetTE` total TE. Reuses its
 * `teMarkers` — already one entry per whole TE earned, in chronological order — so "reaches N
 * total TE" is just "the (N - startTE)-th marker", no new math needed. Returns `null` if this
 * variant's plan never actually earns enough TE to reach the target (e.g. it's cut short by a
 * date goal rather than a TE goal).
 */
export function findTargetTECrossing(ray: VariantRay, targetTE: number): TargetTECrossing | null {
  if (ray.startTE >= targetTE) {
    // Goal was already met before this ascension's TE-wait phase even begins.
    return { variant: ray.key, time: ray.anchorTime * 1000, totalTE: ray.startTE };
  }
  const markerIndex = targetTE - ray.startTE - 1;
  const marker = ray.teMarkers[markerIndex];
  if (!marker) return null;
  return { variant: ray.key, time: marker.time, totalTE: targetTE };
}
