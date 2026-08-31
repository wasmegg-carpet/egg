import type { DraftAction, NotificationPayload } from '@/types';
import { generateActionId } from '@/types';
import { formatDuration, formatGemPrice } from '@/lib/format';

/**
 * Builds a ready-to-push `DraftAction` for an inline note — the 'notification' action type. A note
 * is zero-cost and zero-time: it never touches any store, it just displays `payload.message`/
 * `payload.submessage` in the action history, for annotating a plan without changing any numbers.
 *
 * This is the one general-purpose entry point for creating a note in the manual planner (push the
 * result through `useActionExecutor`'s `prepareExecution`/`completeExecution`, same as any other
 * action). Every feature that wants to drop a note into history — Quick Buy's purchase summary,
 * other Smart Buy variants, the Milestone view, a free-form user-typed note — builds its own
 * `NotificationPayload` and calls this rather than hand-rolling the action shape. The auto-ascension
 * engine has its own equivalent for simulated actions: `createMilestoneShiftHelpers`'s
 * `addNotification` in `src/auto/shifts/helpers/milestones.ts`.
 */
export function createNoteAction(payload: NotificationPayload, dependsOn: string[] = []): DraftAction {
  return {
    id: generateActionId(),
    timestamp: Date.now(),
    type: 'notification',
    payload,
    cost: 0,
    dependsOn,
  };
}

/** Shared "N purchase(s) over <duration>, <gems> gems spent" phrasing every Smart Buy note's
 *  submessage builds on. */
function formatPurchasesOverDuration(purchaseCount: number, seconds: number, totalGemsSpent: number): string {
  return `${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'} over ${formatDuration(
    seconds
  )}, ${formatGemPrice(totalGemsSpent)} gems spent`;
}

/**
 * Builds the inline-note payload a Quick Buy sweep inserts ahead of the purchases it makes, so a
 * plan reads "why did these show up" at a glance. Shared by the manual planner's Quick Buy
 * button/Auto Buy sweep (`ResearchActions.vue`'s `handleThresholdBuy`) and the auto-ascension
 * engine's smart-buy sweep (`runSmartBuyForSeconds`, used by C1 and friends) — written once here so
 * every caller of either annotates its sweep the same way.
 *
 * Returns null when the sweep bought nothing — an empty note would just be noise in the history.
 */
export function buildQuickBuyNotePayload(
  thresholdSeconds: number,
  purchaseCount: number,
  totalSecondsToSave: number,
  totalGemsSpent: number
): NotificationPayload | null {
  if (purchaseCount <= 0) return null;

  return {
    message: `${formatDuration(thresholdSeconds)} Quick Buy`,
    submessage: formatPurchasesOverDuration(purchaseCount, totalSecondsToSave, totalGemsSpent),
  };
}

/**
 * Builds the inline-note payload the "Buy Earnings Research" (70% Return) sweep inserts ahead of
 * its purchases — `ResearchActions.vue`'s `runSaleAwareBuyFlow` (the manual planner's "70% Return"
 * button) and `auto/shifts/c3.ts`'s `buyUntilSaleWarning` (its automated equivalent) both build this
 * same note, so it reads consistently regardless of which one produced it. Same shape as
 * `buildQuickBuyNotePayload`'s note, but calls out what actually gates this sweep: every earnings
 * research that clears both of Smart Buy's ROI gates — see `showBuyNowRoiWarning`/
 * `showFullRoiWarning`'s doc comments in researchROI.ts — not a fixed time-to-save threshold.
 *
 * `saleCount` is "how many sales are in play" for the ride this sweep's 100%-ROI gate is judged
 * against (the manual planner's sale-count stepper, or C3's own `saleCount` — see each caller's own
 * `countSalesThrough`/`smartBuySaleCount` usage), surfaced directly in the message so a "1-sale" buy
 * reads differently from a deliberate multi-sale ride.
 *
 * Returns null when the sweep bought nothing.
 */
export function buildSaleAwareBuyNotePayload(
  purchaseCount: number,
  saleCount: number,
  secondsUntilNextSale: number,
  totalGemsSpent: number
): NotificationPayload | null {
  if (purchaseCount <= 0) return null;

  return {
    message: `${saleCount}-sale Earnings Buy`,
    submessage: `${formatPurchasesOverDuration(purchaseCount, secondsUntilNextSale, totalGemsSpent)}, before next sale`,
  };
}

/**
 * Builds the inline-note payload the "Buy Delivery Research" (Buy Until Sale Ends) sweep inserts
 * ahead of its purchases — `ResearchActions.vue`'s `handleBuyUntilSaleDeadline`. Same shape as the
 * other Smart Buy notes, but calls out that this one is scoped to the *current* sale: it only ever
 * runs while a sale is active, buying earnings then delivery research up to that sale's own end.
 *
 * Returns null when the sweep bought nothing.
 */
export function buildSaleEndsBuyNotePayload(
  purchaseCount: number,
  secondsUntilSaleEnd: number,
  totalGemsSpent: number
): NotificationPayload | null {
  if (purchaseCount <= 0) return null;

  return {
    message: 'Buy Until Sale Ends',
    submessage: `${formatPurchasesOverDuration(purchaseCount, secondsUntilSaleEnd, totalGemsSpent)}, until sale ends`,
  };
}

/**
 * Builds the inline-note payload `auto/shifts/c3.ts`'s final-sale gap fill inserts ahead of its
 * purchases — see `simulateFinalSaleGapBuy`'s own doc comment (smartBuyPreview.ts) for what this
 * sweep actually buys and why. Manual-planner-only counterpart: none — this is auto-engine-only,
 * since it only makes sense against a ride's own known `buildPhaseEnd`.
 *
 * Returns null when the sweep bought nothing.
 */
export function buildFinalSaleGapBuyNotePayload(
  purchaseCount: number,
  elapsedSeconds: number,
  totalGemsSpent: number
): NotificationPayload | null {
  if (purchaseCount <= 0) return null;

  return {
    message: 'Final Sale Gap Buy',
    submessage: `${formatPurchasesOverDuration(purchaseCount, elapsedSeconds, totalGemsSpent)}, before final sale`,
  };
}

/**
 * Builds the inline-note payload the Milestone view's "Buy Entire Chain" button inserts ahead of
 * its purchases — `ResearchActions.vue`'s `handleBuyMilestoneChain`. `targetLabel` is a caller-built
 * description of what was targeted (e.g. "Unlock Tier 8" or "Graviton Coupling (Lv 5/20)") —
 * building that string requires the milestone-target/research domain types this generic `notes.ts`
 * module otherwise stays free of, so it's the caller's job, same division as every other
 * `build*NotePayload` here (this file formats, the feature supplies its own numbers).
 *
 * `timeSavedSeconds` is optional: the Milestone Summary panel itself only shows a baseline
 * comparison when the chain wasn't truncated (see `milestoneSummary`'s `truncated` case in
 * `useResearchViews.ts`) — pass it only when that same comparison is available, omit it otherwise.
 *
 * Returns null when the chain bought nothing.
 */
export function buildMilestoneNotePayload(
  targetLabel: string,
  purchaseCount: number,
  totalSeconds: number,
  totalGemsSpent: number,
  timeSavedSeconds?: number
): NotificationPayload | null {
  if (purchaseCount <= 0) return null;

  const savedPart =
    timeSavedSeconds !== undefined && timeSavedSeconds > 0 ? `, saved ${formatDuration(timeSavedSeconds)}` : '';

  return {
    message: `Milestone: ${targetLabel}`,
    submessage: `${formatPurchasesOverDuration(purchaseCount, totalSeconds, totalGemsSpent)}${savedPart}`,
  };
}
