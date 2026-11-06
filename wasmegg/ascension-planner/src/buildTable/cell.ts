/**
 * One cell of the precomputed build table: what a fresh ascension's expensive build leaves behind,
 * kept as a few numbers per C3 variant, and the arithmetic that turns those numbers into the time
 * to any target TE.
 *
 * The cell format, start state and reference week match AutoAutoAP's instant-answer table
 * (github.com/william-egginc/AutoAutoAP, branch ascension-chain-search: src/search/precomputedLeg.ts
 * and src/search/tableBuild.ts), so a directory written by scripts/buildTable.ts packs with their
 * `precompute.ts --pack` unchanged.
 *
 * THE SPLIT. A fresh ascension is a build (C1..R1, a C3 sale variant, H1, then K3's vehicle
 * purchases), then waiting at the build's peak delivery rate: K3 on kindness until the later of the
 * sale ending and kindness's share of the goal, then C4/I2/R2/H2 each until its share, re-sharing
 * the goal before each wait among the eggs not yet visited (`runAscension`). Nothing after the build
 * depends on the calendar, so `tailTo` replays it with the simulator's own helpers.
 *
 * Pinia-free: runs in Node (scripts/buildTable.ts) and in vitest.
 */
import { deriveNextStartState, runUntilShift } from '@/auto/ascension';
import { runC3Variants, type C3Variant } from '@/auto/shifts/c3';
import { runH1 } from '@/auto/shifts/h1';
import { distributeTargetTE } from '@/auto/shifts/te-wait';
import { computeTEEarned, timeToEarnTE } from '@/auto/te-thresholds';
import { applyShiftAction } from '@/auto/shifts/helpers/actionHelpers';
import { runMaxVehiclesPlan } from '@/auto/shifts/helpers/vehicles';
import { computeRealisticELR } from '@/calculations/realisticELR';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { getLocalTimestampInTimezone, PACIFIC_TIMEZONE } from 'lib/planners/events';
import { countTEThresholdsPassed, TE_BREAKPOINTS } from '@/lib/truthEggs';
import type { AscensionSummary, EngineState, SimulationContext } from '@/auto/types';
import type { VirtueEgg } from '@/types';

/** Matches `TIER_13_MIN_STARTING_TE` in useAscensionGenerator.ts (not exported there). */
export const TIER_13_MIN_STARTING_TE = 190;

/** Hours in a week: the table's second key. Hour 0 = Monday 00:00 Pacific. */
export const WEEK_HOURS = 168;

/**
 * The week every cell is simulated in: Monday 11 January 2027, 00:00 Pacific — AutoAutoAP's
 * `REFERENCE_WEEK`. Clear of daylight saving changes for the three weeks a 3-sale build can take
 * from its last hour.
 */
export const REFERENCE_WEEK = getLocalTimestampInTimezone('2027-01-11', '00:00', PACIFIC_TIMEZONE);

/** The five eggs in table order; also the order `delivered` is stored in. */
export const EGG_ORDER: VirtueEgg[] = ['curiosity', 'kindness', 'integrity', 'resilience', 'humility'];
/** The waits after the build, in `allShifts` order (K3, C4, I2, R2, H2). */
const WAIT_ORDER: VirtueEgg[] = ['kindness', 'curiosity', 'integrity', 'resilience', 'humility'];

/** One C3 variant's build, as the tail needs it. Times are seconds from the ascension's start. */
export interface BuildParams {
  /** Sales the build waits through (1-3). */
  sales: number;
  /** Whether the build also reaches for the tier-13 unlock. */
  tier13: boolean;
  /** When K3's wait begins: the build and K3's purchases done. */
  waitStart: number;
  /** When the build's last sale ends (`buildPhaseEnd`): K3 waits at least this long. */
  saleEnd: number;
  /** The peak delivery rate every wait runs at, eggs per second. */
  peakELR: number;
  /** Eggs delivered on each egg when K3's wait begins, in `EGG_ORDER`. */
  delivered: number[];
}

/** The C1..R1 run every C3 variant of a cell starts from. */
export interface Prefix {
  state: EngineState;
  elapsedSeconds: number;
}

/**
 * Eggs delivered per egg (EGG_ORDER) at TE `te`, shared the way the simulator shares a goal
 * (cheapest next TE first, from nothing), each egg exactly on its threshold.
 */
export function canonicalDelivered(te: number): number[] {
  const zero = Object.fromEntries(EGG_ORDER.map(e => [e, 0])) as Record<VirtueEgg, number>;
  const perEgg = distributeTargetTE(zero, te);
  return EGG_ORDER.map(e => (perEgg[e] > 0 ? TE_BREAKPOINTS[perEgg[e] - 1] : 0));
}

/**
 * The state a fresh ascension starts from at TE `te`, as if the last one had just ended there:
 * `base`'s permanent progress, a reset farm, and the canonical egg counts.
 */
export function startStateAt(base: EngineState, te: number): EngineState {
  const delivered = canonicalDelivered(te);
  return deriveNextStartState(
    {
      finalTE: Object.fromEntries(EGG_ORDER.map((e, i) => [e, countTEThresholdsPassed(delivered[i])])),
      endSoulEggs: base.soulEggs,
      endShiftCount: base.shiftCount,
      eggsDelivered: Object.fromEntries(EGG_ORDER.map((e, i) => [e, delivered[i]])),
    } as unknown as AscensionSummary,
    base
  );
}

/** `context` with this cell's start time, the way useAscensionGenerator.ts sets it per ascension. */
export function contextAt(context: SimulationContext, start: number): SimulationContext {
  return { ...context, ascensionStartTime: start, planStartOffset: 0 };
}

/** The C1..R1 run, exactly as useAscensionGenerator.ts precomputes it for every variant. */
export function prefixAt(state: EngineState, context: SimulationContext): Prefix {
  const pre = runUntilShift(state, context, 'C3');
  return { state: pre.state, elapsedSeconds: pre.elapsedSeconds };
}

/** Every C3 variant still possible from `prefix`, with `context`'s start time. */
export function variantsFrom(prefix: Prefix, context: SimulationContext, te: number): C3Variant[] {
  return runC3Variants(prefix.state, context, 3, te < TIER_13_MIN_STARTING_TE).filter(v => !v.impossible);
}

/**
 * H1 and K3's purchases replayed exactly as `runAscension` runs them when it resumes a C3 variant
 * at H1, stopping where K3's wait would begin: the state that wait begins in, and when.
 */
export function k3StateOf(
  prefix: Prefix,
  v: C3Variant,
  context: SimulationContext
): { k3: EngineState; waitStart: number } {
  let state = JSON.parse(JSON.stringify(v.result.endState)) as EngineState;
  let elapsed = prefix.elapsedSeconds + v.result.elapsedSeconds;
  state.lastStepTime = elapsed;
  const h1 = runH1(state, context);
  state = h1.endState;
  elapsed += h1.elapsedSeconds;
  state.lastStepTime = elapsed;
  const shifted = applyShiftAction(state, context, 'kindness');
  const vehicles = runMaxVehiclesPlan(shifted.state, context, Infinity);
  return { k3: vehicles.endState, waitStart: elapsed + vehicles.elapsedSeconds };
}

export function paramsOf(prefix: Prefix, v: C3Variant, context: SimulationContext): BuildParams {
  const { k3, waitStart } = k3StateOf(prefix, v, context);
  const peakELR = computeRealisticELR(
    k3.researchLevels,
    calculateArtifactModifiers(k3.artifactLoadout),
    context.epicResearchLevels,
    context.colleggtibleModifiers
  ).effectiveRate;
  return {
    sales: v.saleCount,
    tier13: !!v.attemptTier13Unlock,
    waitStart,
    saleEnd: v.buildPhaseEnd - context.ascensionStartTime,
    peakELR,
    delivered: EGG_ORDER.map(e => k3.eggsDelivered[e] || 0),
  };
}

/** A cell's builds from a C1..R1 prefix (fresh or reused) at `context`'s start time. */
export function buildsFrom(prefix: Prefix, context: SimulationContext, te: number): BuildParams[] {
  return variantsFrom(prefix, context, te).map(v => paramsOf(prefix, v, context));
}

export interface Tail {
  /** Seconds from the ascension's start to its end. */
  seconds: number;
  /** TE when it ends. Usually the target; more when K3's wait for the sale overshoots it. */
  endTE: number;
}

/**
 * The time from the ascension's start to `target` total TE with this build (`runAscension`'s K3..H2
 * for a whole-TE goal), or null when the eggs cannot carry that much TE.
 */
export function tailTo(p: BuildParams, target: number): Tail | null {
  const delivered = Object.fromEntries(EGG_ORDER.map((e, i) => [e, p.delivered[i]])) as Record<VirtueEgg, number>;
  const locked: VirtueEgg[] = [];
  let t = p.waitStart;
  for (const egg of WAIT_ORDER) {
    const targets = distributeTargetTE(delivered, target, locked);
    const have = countTEThresholdsPassed(delivered[egg] || 0);
    const need = Math.max(0, targets[egg] - have);
    // K3 waits for the sale to end whatever the goal; the others only for their share.
    let wait = egg === 'kindness' ? Math.max(0, p.saleEnd - t) : 0;
    if (need > 0) {
      const teWait = timeToEarnTE(delivered[egg] || 0, p.peakELR, need);
      if (!Number.isFinite(teWait)) return null;
      wait = Math.max(wait, teWait);
    }
    if (wait > 0) {
      delivered[egg] = computeTEEarned(delivered[egg] || 0, p.peakELR, wait).finalEggsDelivered;
      t += wait;
    }
    locked.push(egg);
  }
  const endTE = EGG_ORDER.reduce((n, e) => n + countTEThresholdsPassed(delivered[e] || 0), 0);
  return endTE >= target ? { seconds: t, endTE } : null;
}
