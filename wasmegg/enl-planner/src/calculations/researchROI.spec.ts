import { describe, expect, test } from 'vitest';
import {
  getSaleAwareTimeToSave,
  computeShowBuyNowRoiWarning,
  computeShowFullRoiWarning,
  findEventCrossings,
} from './researchROI';
import { getNextSaleStart, getNextSaleEnd, isResearchSaleActive, BOUNDARY_EPSILON_SECONDS } from '@/lib/events';
import type { CommonResearch, ResearchCostModifiers } from './commonResearch';
import type { CalculationsSnapshot } from '@/types';

// A single research sale runs Friday 9 AM PT -> Saturday 9 AM PT (24h), weekly (see lib/events.ts).
const WEEK_SECONDS = 7 * 86400;
const SALE_DURATION_SECONDS = 86400;
const GAP_BETWEEN_SALES_SECONDS = WEEK_SECONDS - SALE_DURATION_SECONDS;

const mods: ResearchCostModifiers = { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 };

function fakeResearch(virtuePrice: number): CommonResearch {
  return {
    serial_id: 0,
    id: 'test_research',
    name: 'Test Research',
    type: 'common',
    tier: 1,
    categories: '',
    description: '',
    effect_type: '',
    levels: 5,
    per_level: 1,
    levels_compound: 'additive',
    prices: [0, 0, 0, 0, 0],
    virtue_prices: [virtuePrice],
  };
}

// Rigged so `getTimeToSave(price, snapshot, [])` returns exactly `price` seconds: population is
// already at habCapacity (no growth needed) and ratePerChickenPerSecond is large enough that the
// shipping cap (1 egg/sec) binds immediately, with elr/offlineEarnings chosen so each egg is worth
// exactly $1. That makes the test's expected wait times trivial to compute and verify by hand.
function fakeSnapshot(bankValue = 0): CalculationsSnapshot {
  return {
    eggValue: 1,
    habCapacity: 1e18,
    elr: 1,
    shippingCapacity: 1,
    layRate: 0,
    onlineEarnings: 0,
    offlineEarnings: 1,
    onlineIHR: 0,
    offlineIHR: 0,
    ratePerChickenPerSecond: 1e18,
    bankValue,
    currentEgg: 'edible' as CalculationsSnapshot['currentEgg'],
    shiftCount: 0,
    te: 0,
    soulEggs: 0,
    siloCount: 0,
    siloTimeMinutes: 0,
    tankLevel: 0,
    fuelTankAmounts: {} as CalculationsSnapshot['fuelTankAmounts'],
    eggsDelivered: {} as CalculationsSnapshot['eggsDelivered'],
    teEarned: {} as CalculationsSnapshot['teEarned'],
    population: 1e18,
    lastStepTime: 0,
    vehicles: [],
    habIds: [],
    researchLevels: {},
    artifactLoadout: [],
    activeArtifactSet: null,
    artifactSets: { earnings: null, elr: null },
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
  };
}

describe('getSaleAwareTimeToSave', () => {
  test('waits for a LATER sale (not just the immediate next one) when saving spans multiple weekly cycles', () => {
    // Anchor 1 hour after some sale ends, so we're definitely not in a sale and the immediate next
    // sale is ~6 days away.
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const currentAbsoluteTime = getNextSaleEnd(anchor) + 3600;
    expect(isResearchSaleActive(currentAbsoluteTime)).toBe(false);

    // Sale price needs 12 days of saving (~1,036,800s) — more than fits in the immediate next sale's
    // 24h window (it starts in ~6 days and ends ~7 days out), so this must skip that sale entirely
    // and land in the one after it.
    const research = fakeResearch(Math.ceil(1_036_800 / 0.3));
    const snapshot = fakeSnapshot();

    const result = getSaleAwareTimeToSave(research, 0, mods, false, currentAbsoluteTime, snapshot, []);

    expect(result.duringSale).toBe(true);
    // Cheaper than paying full, undiscounted price with no sale at all.
    const fullPriceWait = research.virtue_prices[0];
    expect(result.waitSeconds).toBeLessThan(fullPriceWait);
    // Actually completes during a real sale window...
    const completesAt = currentAbsoluteTime + result.waitSeconds;
    expect(isResearchSaleActive(completesAt)).toBe(true);
    // ...and specifically NOT the immediate next one — this is the multi-cycle case the fix covers.
    expect(completesAt).toBeGreaterThan(getNextSaleEnd(currentAbsoluteTime));
  });

  test('buys at full price now, without waiting, when no sale is worth it for a cheap item', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const currentAbsoluteTime = getNextSaleEnd(anchor) + 3600;

    // Cheap enough that full price is affordable almost immediately — far faster than waiting ~6
    // days for the next sale to even start.
    const research = fakeResearch(1000);
    const snapshot = fakeSnapshot();

    const result = getSaleAwareTimeToSave(research, 0, mods, false, currentAbsoluteTime, snapshot, []);

    expect(result.duringSale).toBe(false);
    expect(result.waitSeconds).toBeCloseTo(1000, 0);
  });

  test('still buys during the immediate next sale when saving finishes within its window (happy path unchanged)', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const currentAbsoluteTime = getNextSaleEnd(anchor) + 3600;

    // Sale price needs ~6.9 days of saving — lands inside the immediate next sale's 24h window.
    const research = fakeResearch(Math.ceil(600_000 / 0.3));
    const snapshot = fakeSnapshot();

    const result = getSaleAwareTimeToSave(research, 0, mods, false, currentAbsoluteTime, snapshot, []);

    expect(result.duringSale).toBe(true);
    const completesAt = currentAbsoluteTime + result.waitSeconds;
    expect(completesAt).toBeLessThanOrEqual(getNextSaleEnd(currentAbsoluteTime));
  });

  test('currently in a sale that will end too soon: waits for a LATER sale instead of giving up on the discount', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const saleStart = getNextSaleStart(anchor);
    const currentAbsoluteTime = saleStart + 1000; // 1000s into an active sale
    expect(isResearchSaleActive(currentAbsoluteTime)).toBe(true);

    // At 30% off, needs ~12 days to save — won't finish before THIS sale ends (in ~23h), nor before
    // the NEXT one starts/ends either (only ~6 days later) — has to skip two sales and land on the
    // third.
    const research = fakeResearch(Math.ceil(1_036_800 / 0.3));
    const snapshot = fakeSnapshot();

    const result = getSaleAwareTimeToSave(research, 0, mods, true, currentAbsoluteTime, snapshot, []);

    expect(result.duringSale).toBe(true);
    const fullPriceWait = research.virtue_prices[0];
    expect(result.waitSeconds).toBeLessThan(fullPriceWait);
    const completesAt = currentAbsoluteTime + result.waitSeconds;
    expect(isResearchSaleActive(completesAt)).toBe(true);
    // Confirms it's not just re-using the current sale's own (already-too-short) window.
    expect(completesAt).toBeGreaterThan(getNextSaleEnd(currentAbsoluteTime));
  });
});

// Smart Buy's two dual-ROI gates (SMART_BUY_DUAL_ROI_DESIGN.md §1/§2.3) — tested directly against
// these small pure functions rather than through `calculateResearchROI`'s full engine-state
// machinery, which is exactly why they're factored out on their own.
describe('computeShowBuyNowRoiWarning (Gate A)', () => {
  test('not during a sale: warns when 70% payback would not land before the next sale start', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const absoluteSimTime = getNextSaleEnd(anchor) + 3600; // 1h after a sale ended, not in a sale
    expect(isResearchSaleActive(absoluteSimTime)).toBe(false);

    // Zero earnings delta can never clear any payback percentage.
    const result = computeShowBuyNowRoiWarning(false, 0, 100, absoluteSimTime, absoluteSimTime);
    expect(result).toBe(true);
  });

  test('not during a sale: does not warn when 70% payback comfortably lands before the next sale start', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const absoluteSimTime = getNextSaleEnd(anchor) + 3600;
    expect(isResearchSaleActive(absoluteSimTime)).toBe(false);

    // $1/s earnings delta against a $100 price easily clears 70% well within the ~6 days until the
    // next sale starts.
    const result = computeShowBuyNowRoiWarning(false, 1, 100, absoluteSimTime, absoluteSimTime);
    expect(result).toBe(false);
  });

  test('actually landing in a live sale bypasses the check entirely, even with zero earnings delta', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const saleStart = getNextSaleStart(anchor);
    const absoluteSimTime = saleStart + 1000; // 1000s into an active sale
    expect(isResearchSaleActive(absoluteSimTime)).toBe(true);

    // Purchase completes instantly, right now, mid-sale — would fail the 70% check on its own
    // economics, but should be bypassed outright since it's already at the discount.
    const result = computeShowBuyNowRoiWarning(true, 0, 100, absoluteSimTime, absoluteSimTime);
    expect(result).toBe(false);
  });

  test('3 minutes before a sale: rejects buying at full price right now instead of waiting', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const saleStart = getNextSaleStart(anchor);
    const absoluteSimTime = saleStart - 180; // 3 minutes before the sale starts
    expect(isResearchSaleActive(absoluteSimTime)).toBe(false);

    // Already affordable right now (zero wait) at full price — but 3 minutes is nowhere near enough
    // to clear 70% payback before the sale that's about to start, so this should still warn.
    const completesAt = absoluteSimTime;
    const result = computeShowBuyNowRoiWarning(false, 0, 100, completesAt, absoluteSimTime);
    expect(result).toBe(true);
  });

  test('3 minutes before a sale: accepts waiting those 3 minutes to buy at the discount instead', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const saleStart = getNextSaleStart(anchor);
    const absoluteSimTime = saleStart - 180;
    expect(isResearchSaleActive(absoluteSimTime)).toBe(false);

    // Same zero-earnings-delta purchase as above, but this time it resolved to waiting the 3 minutes
    // for the sale (getSaleAwareTimeToSave's own job — not re-tested here) and completes just after
    // the sale starts. Should be bypassed exactly like the "already mid-sale" case above.
    const completesAt = saleStart + 1;
    const result = computeShowBuyNowRoiWarning(true, 0, 100, completesAt, absoluteSimTime);
    expect(result).toBe(false);
  });
});

describe('computeShowFullRoiWarning (Gate B)', () => {
  test('undefined fullRoiDeadline is a no-op, regardless of economics', () => {
    expect(computeShowFullRoiWarning(0, 100, 1000, undefined)).toBe(false);
  });

  test('warns when 100% payback would not land before fullRoiDeadline', () => {
    const completesAt = 1000;
    const fullRoiDeadline = completesAt + 50; // only 50s of runway
    // $1/s against a $100 price needs 100s to fully pay back — doesn't fit in 50s.
    expect(computeShowFullRoiWarning(1, 100, completesAt, fullRoiDeadline)).toBe(true);
  });

  test('does not warn when 100% payback lands before fullRoiDeadline', () => {
    const completesAt = 1000;
    const fullRoiDeadline = completesAt + 200; // plenty of runway
    expect(computeShowFullRoiWarning(1, 100, completesAt, fullRoiDeadline)).toBe(false);
  });

  test('never bypassed by being "during a sale" — unlike Gate A, there is no bypass parameter at all', () => {
    // Gate B's signature has no duringSale/isActuallyDuringSale concept — this test exists to
    // document that omission is deliberate (SMART_BUY_DUAL_ROI_DESIGN.md §2.3: "100% by the end of
    // the final sale" always applies, sale active or not), not an oversight.
    const completesAt = 1000;
    const fullRoiDeadline = completesAt + 50;
    expect(computeShowFullRoiWarning(0, 100, completesAt, fullRoiDeadline)).toBe(true);
  });
});

describe('findEventCrossings (boundary-landing tolerance)', () => {
  // Real exported plans have shown `lastStepTime` values like `1673837.899709117` — ordinary
  // sub-second float noise from accumulated addition across many purchases/waits, not a bug of its
  // own. A purchase timed to land EXACTLY on a sale boundary computes its own wait duration by
  // working backward from that boundary, then this function re-derives the SAME boundary via a
  // fresh, independent calendar lookup — the two must still agree despite that noise, or the
  // boundary is missed silently (see `BOUNDARY_EPSILON_SECONDS`'s doc comment).
  const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
  const saleStart = getNextSaleStart(anchor);

  test('a wait undershooting the true boundary by sub-second float noise still reports the crossing', () => {
    const secondsToBuy = saleStart - anchor - 0.0004; // a hair short, like real accumulated noise
    const crossings = findEventCrossings(anchor, secondsToBuy, false, false);
    expect(crossings.sale).toHaveLength(1);
    expect(crossings.sale[0].togglesTo).toBe(true);
  });

  test('a wait landing exactly on the boundary reports the crossing', () => {
    const secondsToBuy = saleStart - anchor;
    const crossings = findEventCrossings(anchor, secondsToBuy, false, false);
    expect(crossings.sale).toHaveLength(1);
    expect(crossings.sale[0].togglesTo).toBe(true);
  });

  test('a wait genuinely short of the boundary (beyond the tolerance) reports no crossing', () => {
    const secondsToBuy = saleStart - anchor - (BOUNDARY_EPSILON_SECONDS + 1);
    const crossings = findEventCrossings(anchor, secondsToBuy, false, false);
    expect(crossings.sale).toHaveLength(0);
  });
});

// Sanity check on the fixture's own assumed cadence, so the hand-computed expectations above stay
// honest if events.ts's schedule ever changes.
test('sale schedule fixture assumptions hold', () => {
  const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
  const start = getNextSaleStart(anchor);
  const end = getNextSaleEnd(anchor);
  expect(end - start).toBe(SALE_DURATION_SECONDS);
  const nextStart = getNextSaleStart(end);
  expect(nextStart - end).toBe(GAP_BETWEEN_SALES_SECONDS);
});
