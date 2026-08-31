# Smart Buy: Dual ROI Gate (bypass-aware 70% + 100% by ride end)

Design/impact assessment for the "70% Return" Smart Buy mechanism, written before any code changes.
Scope: `wasmegg/ascension-planner` only.

**Status:** all decisions confirmed (§2). Ready to implement in the order given in §10. This is
revision 3 — revision 2's "one `targetSaleEnd`, both deadlines derived from it via `getSaleStartForEnd`"
mechanism (§4.1) turned out to be wrong; see §2.3 for why, this revision replaces it.

## 1. What's being asked for

Today, the "70% Return" card (`SmartBuyView.vue`) buys earnings research that clears **70% ROI
payback by the start of the next research sale**, uniformly, whether or not a sale happens to be
active right now (`calculateResearchROI`'s existing `showSaleWarning`).

The new rule replaces that with **two independent gates**, asymmetric in an important way:

- **Gate A (near-term sanity check)** — only matters when this purchase is *not* already landing in
  a live sale discount. In that case: does it clear 70% ROI by the **immediate** next sale? If it
  *is* landing in a live discount (right now, or because waiting a few minutes for an imminent one
  turned out faster — see §2.3), Gate A is **bypassed entirely** — there's no "would waiting have
  been better" question left to ask, you're already getting the discount.
- **Gate B (full-commitment floor)** — always active, sale or no sale: does it clear 100% ROI by the
  end of the **target/final sale** — the one the user (or C3) has committed to riding out to? This is
  the only place the "how many sales are in play" setting (manual stepper, or C3's `saleCount`)
  actually matters — Gate A never depends on it at all (§2.3).

A candidate must clear both to be bought. The concrete effect: buying something at full price, days
before any discount, is judged strictly against the *next* discount opportunity (don't overpay if
waiting a few days would beat it) — but once you're actually inside a sale (any sale, not just the
final one, when riding several), that "did I jump the gun" question no longer applies, and the only
remaining bar is the long-horizon "will this really pay for itself by the time the whole ride wraps
up."

## 2. Decisions from your last two messages, and what they change

1. **Scope: only the "70% Return" card.** ROI tab, "Buy Entire Chain"/milestone chain, and C3's
   Tier‑13/ML2 milestone step are all untouched.
2. **(superseded by §2.3 below — see there for the resolved rule.)** The original framing ("70% by
   start of last sale, not next") turned out to need one more refinement once the active/inactive
   split was worked out precisely.
3. Manual UI is a constrained "how many sales are in play" stepper, matching C3's own `saleCount`
   concept — confirmed, see §6.1.
4. **Remove the ROI-mode / delivery-impact-only controls from the Smart Buy card.** The "70% Return"
   card always computes with `roiMode: 'immediate'`, `deliveryImpactOnly: false` — hardcoded, not read
   from the shared `roiMode`/`deliveryImpactOnly` refs the ROI tab still owns. See §6.3.
5. **Store a pinned, captured deadline, not a live-recomputed count** — confirmed, see §6.1.

### 2.1 The picked sale stays pinned

Once you pick "2 sales out," that target stays pinned to that specific calendar sale (not re-derived
fresh each click) until it actually passes or you move the stepper again — exactly like C3's fixed
`buildPhaseEnd`. The state stored is a captured absolute timestamp, not a live-recomputed "N sales
from right now" count. See §6.1 for the concrete shape.

### 2.2 Persistence and a cap

- **Persists across reloads** (localStorage, same treatment as `roiMode`/`deliveryImpactOnly` today).
- **Capped at 3 sales out**, matching C3's own default max `saleCount`.

### 2.3 Resolved — the asymmetric Gate A/Gate B split, and why revision 2 was wrong

Your worked-through answer:

> No sale active → 70% by the **immediate** next sale (not the final one) — "there will be cases
> where you buy research at 100% cost right before the 1st or 2nd sale, rather than waiting a few
> minutes and buying it at a 70% discount" if it's judged against the far-off final sale instead.
> Sale active (any sale, not just the final one) → the 70% check is **bypassed**; only "100% by the
> end of the final sale" remains.

This is a real, better-thought-out design than revision 2's uniform rule, and it exposed a genuine bug
in that revision: judging 70% against `getSaleStartForEnd(targetSaleEnd)` unconditionally means that
whenever a sale is *already active* and only one sale is in play (the default case), that "deadline"
is the currently-running sale's own start — a timestamp in the *past*. `meetsROIByDeadline` returns
`false` for any deadline at-or-before purchase time, so revision 2 would have made Gate A fail
**unconditionally** any time a sale was live under the default settings. Your answer sidesteps this
entirely: Gate A simply doesn't apply while a sale is active, so it never needs to consider a deadline
that could be in the past.

The concrete case your reasoning describes, and this design fixes: `getSaleAwareTimeToSave` (the
existing price/wait picker, unchanged by this feature) optimizes for *speed*, not $-efficiency, once
money's already available — if you can already afford the full price *right now* and a sale starts in
3 minutes, it currently returns "buy now, full price, zero wait" (zero wait beats a positive wait, even
a 3-minute one) rather than the obviously-better "wait 3 minutes, pay 30%." Gate A is exactly what
catches that: 3 minutes is nowhere near enough time to earn back 70% of the full price before the
sale starts, so it correctly gets rejected — and once the outer loop's own time advance actually
reaches that sale start, `isActuallyDuringSale` flips true and the same candidate clears immediately
via the bypass.

**One refinement on top of your answer, not yet separately confirmed:** for "is this landing in a
sale," Gate A uses the existing `isActuallyDuringSale(purchase.duringSale, completesAt,
absoluteSimTime)` helper (already in `researchROI.ts`, already used for exactly this "is this
purchase's own resolved completion landing in the nearest real sale window" question elsewhere) rather
than the raw "is a sale live right now" flag. Reason: a purchase decided *right now*, while no sale is
active, can still resolve to `duringSale: true` if `getSaleAwareTimeToSave` finds that waiting a few
minutes for an imminent sale beats paying full price — that purchase should get the same bypass a
currently-live sale would, and `isActuallyDuringSale` already has the correct edge-case handling for
this (including *not* bypassing a purchase that's only discounted because it's waiting for some much
later sale several cycles out — see that function's own doc comment). If you meant something
narrower (literally just "is a sale live at the moment of ranking"), that's a smaller change from what's
below — flag it and I'll adjust.

**What this means for `targetSaleEnd` (the sale-count setting):** it now has exactly one job — Gate
B's deadline. Gate A no longer reads it at all. `getSaleStartForEnd` is no longer needed by this
feature anywhere (it's still used by C3's *untouched* milestone-chain step, unrelated).

## 3. Current architecture recap

```text
ResearchActions.vue (UI, execution)
  -> useResearchViews.ts (reactive plan: saleAwarePlan70, via worker)
    -> researchCalc.worker.ts / researchCalc.protocol.ts (postMessage plumbing)
      -> smartBuyPreview.ts: simulateSaleAwareBuy()  [what gets bought, in what order]
        -> researchRanking.ts: rankResearchByROI()   [ranks candidates, incl. bottleneck pairing]
          -> researchROI.ts: calculateResearchROI()  [prices one candidate, computes the gates]
```

`simulateSaleAwareBuy` is the single source of truth for both the live preview and the real purchase
loop — the new gates have to land here, not be special-cased in the UI. C3 (`auto/shifts/c3.ts`) calls
`simulateSaleAwareBuy` directly (off-main-thread already, no worker needed).

Worth flagging: **`simulateSaleAwareBuy`'s `targetPercent: number` parameter looks unused already**
today — its own doc comment says it's there so "other thresholds remain possible," but nothing in the
function body reads it; the actual 70% is hardcoded three layers down inside `calculateResearchROI`.
Recommend deleting it as part of this change; it's dead weight the new, always-70/100 pair doesn't
need.

## 4. Core calculation changes

### 4.1 The two new fields, and why they're additive rather than a rename

Unlike revision 2, this does **not** touch `rankResearchByROI`'s existing `roiDeadlineOverride`
parameter, `calculateResearchROI`'s existing `roiDeadline` input, or the existing `showSaleWarning`
output at all — those stay exactly as they are today, still backing the ROI tab and milestone chain
untouched (decision #1). Two brand-new, independent fields are added instead:

- **`showBuyNowRoiWarning`** (Gate A) — needs no new required input beyond what
  `calculateResearchROI` already receives (`eventTiming.isSaleActive`/`absoluteSimTime`, already used
  to compute `purchase.duringSale` via `getSaleAwareTimeToSave`). Computed unconditionally, for every
  caller, since it's free:

  ```ts
  // researchROI.ts, inside calculateResearchROI
  const showBuyNowRoiWarning = isActuallyDuringSale(purchase.duringSale, completesAt, absoluteSimTime)
    ? false // bypassed — already landing in the nearest real sale window
    : !meetsROIByDeadline(earningsDelta, price, completesAt, getNextSaleStart(absoluteSimTime), 70);
  ```

- **`showFullRoiWarning`** (Gate B) — needs a new optional `fullRoiDeadline?: number` on
  `ROICalculationInput.eventTiming`, same shape revision 2 already had:

  ```ts
  const showFullRoiWarning = fullRoiDeadline !== undefined
    ? !meetsROIByDeadline(earningsDelta, price, completesAt, fullRoiDeadline, 100)
    : false; // undefined => no 100% gate at all (every caller except the smart-buy path)
  ```

Since `roiDeadlineOverride` on `rankResearchByROI` is passed by exactly one caller today
(`simulateSaleAwareBuy`, for the smart-buy path — confirmed via grep) and that caller is about to stop
needing it (its candidate filter switches to the two new fields, §4.4), **`roiDeadlineOverride` becomes
fully dead once this lands** and should be deleted from `rankResearchByROI`'s signature as cleanup,
rather than kept alongside the two new params.

### 4.2 `calculations/researchROI.ts`

- `ROICalculationInput.eventTiming` gains optional `fullRoiDeadline?: number` (Gate B only — Gate A
  needs no new input, per §4.1).
- `ROICalculationResult` gains `showBuyNowRoiWarning: boolean` and `showFullRoiWarning: boolean`.
- `calculateResearchROI` computes both alongside the existing, untouched `showSaleWarning`.
- `shouldDeferToNextSale`/`meetsSaleAwareDeadline` (back "Buy Entire Chain"/ROI-view eligibility):
  untouched, per decision #1.

### 4.3 `calculations/researchRanking.ts`

- `rankResearchByROI(...)`: **delete** the now-dead `roiDeadlineOverride?: number` parameter (§4.1);
  add `fullRoiDeadline?: number`, threaded into every `calculateResearchROI(...)` call in the
  `basicCandidates` map. The `'maxed_vehicles'` branch has its own inline ROI computation, not routed
  through `calculateResearchROI` — needs the same two checks added directly (Gate A needs
  `isActuallyDuringSale`/`getNextSaleStart`, same shape as §4.1; Gate B needs
  `meetsROIByDeadline(..., fullRoiDeadline, 100)`), for consistency, even though the smart-buy path
  will only ever call this with `'immediate'` per decision #4.
- `ResearchRankingItem` gains `showBuyNowRoiWarning?: boolean` and `showFullRoiWarning?: boolean`.
- **Bottleneck-pairing branch**: today it overrides `showSaleWarning` using the *pair's* combined
  economics when pairing beats solo ROI. Both new gates need the same treatment — a bottlenecked
  candidate's solo `earningsDelta`/`price` are meaningless by definition, so both
  `showBuyNowRoiWarning` and `showFullRoiWarning` must be recomputed from `pairDelta`/`pairTotalCost`
  when a pairing is in play, mirroring the existing 70% pair override right next to it.

### 4.4 `calculations/smartBuyPreview.ts`

- `simulateSaleAwareBuy(...)`: `roiDeadlineOverride?: number` → `fullRoiDeadline: number` (**required**
  now — every caller has a concrete target: the UI's picker value, or C3's `buildPhaseEnd`). Delete
  the unused `targetPercent: number` parameter (§3).
- Candidate predicate: `ranked.find(item => item.canBuy && !item.showSaleWarning)` →
  `ranked.find(item => item.canBuy && !item.showBuyNowRoiWarning && !item.showFullRoiWarning)` — note
  this reads the two *new* fields, not the old `showSaleWarning` at all.
- `DEBUG_SALE_AWARE_BUY` logging: log `showBuyNowRoiWarning`/`showFullRoiWarning` instead of
  `showSaleWarning`.
- Doc comment rewrite: describe the asymmetric two-gate rule (§1/§2.3) instead of the old
  single-threshold framing.

### 4.5 Type ripple

- `ResearchRankingItem`/`ROICalculationResult` gain `showBuyNowRoiWarning`/`showFullRoiWarning` (new
  fields, additive).
- `milestoneChain.ts` needs no change — it calls `calculateResearchROI` directly with its own
  `roiDeadline`/`showSaleWarning` usage, untouched; never reads the two new fields.

## 5. Worker plumbing

- `workers/researchCalc.protocol.ts`: `SaleAwareBuyRequest` gains `fullRoiDeadline: number` (required);
  drop `targetPercent` (dead, §3).
- `workers/researchCalc.worker.ts`: the `'saleAwareBuy'` case forwards `fullRoiDeadline` into
  `simulateSaleAwareBuy(...)` and drops the now-removed `targetPercent` argument.
- `composables/useResearchCalcWorker.ts`: `computeSaleAwareBuy`'s signature is
  `Omit<SaleAwareBuyRequest, 'kind' | 'requestId'>`, so it picks up the field change automatically —
  no code change beyond what TypeScript already forces at call sites.

## 6. Manual planner (composable + UI)

### 6.1 State: `useResearchViews.ts`

Per §2.1/§2.2: `smartBuySaleTargetEnd: Ref<number | null>`, localStorage-backed (new key, same
`watch(...) => localStorage.setItem(...)` pattern every other Smart Buy pref here already uses).
`null` means "use the default" (next sale's end, recomputed live each render off the current plan
clock — same pattern `nextSaleStart`/`researchSaleDeadline` already use). Once the user touches
`+`/`-`, it's set to a concrete absolute timestamp (via `getBuildPhaseEndForSaleCount(currentNow,
currentOffset ± 1)`) and *stays* at that value across re-renders/clicks/reloads — a `watch` (or a
guard inside the computed below) resets it back to `null` (falls back to the live default) once it's
detected to be in the past (`smartBuySaleTargetEnd.value <= currentAbsoluteTime`), i.e. once the ride
it pointed at has actually finished. This same check is what makes persistence (§2.2) safe: a stale
timestamp from a session days ago just falls back to the live default the next time it's read, same
as if it had never been touched.

`getBuildPhaseEndForSaleCount` (`lib/events.ts`) is reused as-is for "end of the Nth sale from a given
time" — no new helper function needed. `getSaleStartForEnd` is **not** needed here (§2.3) — this
value only ever feeds Gate B directly, never a derived start.

- New computed `smartBuyFullRoiDeadline = computed(() => smartBuySaleTargetEnd.value ??
  getBuildPhaseEndForSaleCount(currentAbsoluteSimTime, 1))` — this is what feeds
  `simulateSaleAwareBuy`'s `fullRoiDeadline`.
- `+`/`-` handlers: need the *current effective offset* to compute `n ± 1`'s timestamp — derive it by
  counting sales between "now" and the current effective `smartBuyFullRoiDeadline` (`countSalesThrough`,
  already in `lib/events.ts`, looks like the right building block) rather than tracking count and
  timestamp as two separately-mutable pieces of state that could disagree. `-` disables at count `<=
  1`; `+` disables at count `>= 3` (§2.2's cap).
- `saleAwarePlan70`'s `watchEffect` reads `smartBuyFullRoiDeadline.value` and passes it as
  `fullRoiDeadline`; stops reading `roiMode`/`deliveryImpactOnly` refs entirely, passes the literals
  `'immediate'` / `false` instead (decision #4) — this also removes an existing, slightly surprising
  coupling where changing the ROI tab's mode silently changed the Smart Buy card's plan too.

### 6.2 `components/actions/ResearchActions.vue`

- Pull the new state/computed out of `useResearchViews()`.
- `runSaleAwareBuyFlow`: `targetDeadline` (the loop's stop condition + bypass-cleanup boundary) stays
  `nextSaleStart.value` — the **immediate** next sale, unchanged. This is deliberate, not an
  oversight: Gate B's deadline and this structural stop point are two different concepts — the 100%
  floor can look further out than the point where this click's execution actually stops advancing
  time, exactly mirroring how C3's own per-cycle `buyUntilSaleWarning(nextSaleStart)` call works
  inside its outer multi-sale loop (`c3.ts`, step 3). Riding multiple sales manually is "click once per
  week," not "one click that waits three weeks."
- Pass the new deadline value + `+`/`-` handlers down to `SmartBuyView.vue`.
- `canBuyUntilSaleWarning`: currently derived from a separate, simplified live re-check
  (`nextRoiCandidate` + `meetsSaleAwareDeadline`) that doesn't go through the actual plan and already
  has a known gap around bottleneck pairing. Adding a second gate makes that gap worse (the button
  could show "enabled" when the real plan — now gated on two conditions instead of one — is actually
  empty). Recommend replacing it outright with `saleAwarePlan70.value.entries.length > 0`, which is
  guaranteed consistent with what the button actually does, at the cost of one worker round-trip of
  latency (already covered by the existing `saleAwareLoading` spinner state).

### 6.3 `components/actions/SmartBuyView.vue`

- **Remove** the `<RoiViewControls>` block from the "Buy Earnings research" card, and the
  `deliveryImpactOnly`/`roiMode` props + their `update:*` emits (decision #4) — dead in this
  component once removed; the ROI tab's own instance in `ResearchActions.vue` is untouched.
- New props: the effective full-ROI-deadline timestamp (for display) and enough to compute the `+`/`-`
  disabled state; new emits for increment/decrement.
- New child component (new file, e.g. `SaleRideStepper.vue`) — shows the resolved deadline date/time
  with `+`/`-` buttons. Reuses whatever date-formatting helper `lib/format.ts` already exposes (e.g.
  what `milestoneSummary.finishAbsoluteTime` uses in `useResearchViews.ts`) rather than inventing new
  formatting. (Revision 2 planned to also show a derived "start" time for Gate A — no longer
  applicable, since Gate A no longer derives from this value at all; §2.3.)
- Card description copy update: describe the asymmetric rule in player-facing terms — something like
  "buys research that pays for itself before the next sale (or is already discounted), and will fully
  pay for itself by the end of [date]."

## 7. Notes (`lib/actions/notes.ts`)

`buildSaleAwareBuyNotePayload`'s submessage ("...before next sale") stays accurate. Optionally extend
it to name the target sale count/date when it's not the default (1). Cosmetic, can be deferred.

## 8. Auto planner: `auto/shifts/c3.ts`

Smaller change than either prior revision assumed — Gate A needs **no configuration from C3 at all**:

- **Step 3 (`buyUntilSaleWarning`)**: passes `buildPhaseEnd` as the new `fullRoiDeadline` parameter
  (Gate B only). Gate A is automatic — bypassed whenever a purchase lands in whichever sale is
  currently active (any sale in the ride, not just the final one), judged against the immediate next
  sale otherwise — identical behavior to manual mode, no override needed.
- The local `roiDeadline = getSaleStartForEnd(buildPhaseEnd)` variable at the top of `runC3` is no
  longer used by step 3. It's still used by step 2 (Tier‑13/ML2 milestone attempts, a separate
  untouched code path per decision #1) as `roiDeadlineOverride` there — keep it, just note in a
  comment that step 3 no longer shares this value.
- **Real behavior change from today, worth being explicit about**: today, C3 extends the 70%-style
  check across the whole ride via `roiDeadlineOverride` — a candidate could be bought at full price
  during an early gap between sales purely because it'd pay off by the *final* sale, even if waiting a
  few days for the *next* sale's discount would have been strictly better. Under the new rule, that no
  longer happens — full-price gap purchases are always judged against the immediate next sale, full
  stop, regardless of how many sales the ride covers (matches your reasoning in §2.3). This makes C3
  *more conservative* about full-price purchases between early sales in a multi-sale ride, and this is
  the intended fix, not a regression — but it's a genuine behavior change worth a before/after
  `runC3Variants` comparison per §9.
- Doc comment rewrite: the function-level comment, the `roiDeadline` variable's comment, and
  `buyUntilSaleWarning`'s own comment currently describe the old single-stretched-deadline design;
  update to describe the asymmetric Gate A/Gate B rule from §1/§2.3.
- **Other auto shifts**: confirmed via grep — only `c3.ts` calls the sale-aware-buy flow at all today.
  `c1.ts`'s "smart buy" references are `runSmartBuyForSeconds` (the unrelated threshold-based Auto Buy
  sweep); `k3.ts` only waits out time, it doesn't buy. So "and maybe others" is, as of today, just C3.
  `simulateSaleAwareBuy`'s new required `fullRoiDeadline` parameter means any future shift that starts
  calling it without supplying one gets a compile error, which is the right default-safe failure mode.

## 9. Tests

- `calculations/researchROI.spec.ts`:
  - `showBuyNowRoiWarning` cases: not during a sale and doesn't clear 70% by next sale start (warns);
    not during a sale and does clear it (doesn't warn); *during* a sale but wouldn't clear 70% by next
    sale start at full price (still doesn't warn — bypassed); the "3 minutes before a sale, already
    affordable at full price" scenario from §2.3, confirming it's rejected when not yet in the sale and
    accepted once it is.
  - `showFullRoiWarning` cases: clears 70%-equivalent Gate A but not Gate B (excluded), clears both,
    and `fullRoiDeadline: undefined` (no-op, matches today exactly — regression guard for every
    untouched caller).
- `researchRanking.ts`: bottleneck-pairing case where the *pair's* combined economics must be used for
  both new gates, mirroring whatever coverage the existing 70% pairing behavior has.
- `smartBuyPreview.ts`: a candidate excluded solely by Gate B (passes Gate A, fails Gate B); a sanity
  check that the default (`saleCount = 1`, no sale active) reproduces exactly today's calendar-only
  70%-by-next-sale behavior, plus gains the new 100% floor.
- `auto/buildLibraryPlans.spec.ts`: re-inspect after the C3 change for any duration/snapshot
  assertions that might shift (per §8's validation note) — this is the one place a real behavior
  change is expected, not just an additive one.

## 10. Suggested implementation order

1. `researchROI.ts` — add `showBuyNowRoiWarning`/`fullRoiDeadline`/`showFullRoiWarning`; no behavior
   change for existing callers/fields (the two new fields are additive, `showSaleWarning` untouched).
   Add tests. Mergeable alone.
2. `researchRanking.ts` — delete dead `roiDeadlineOverride`, add `fullRoiDeadline`, thread both new
   gates through both ranking branches incl. bottleneck pairing.
3. `smartBuyPreview.ts` — require `fullRoiDeadline` on `simulateSaleAwareBuy`, drop `targetPercent`,
   update candidate predicate to the two new fields. First point every caller must update (compiler
   forces it: worker request builder, `c3.ts`, the worker itself).
4. Worker plumbing (`protocol.ts`, `worker.ts`, `useResearchCalcWorker.ts`) — mechanical, forced by
   step 3.
5. `c3.ts` — pass `buildPhaseEnd` as `fullRoiDeadline`, update doc comments. Validate per §8/§9.
6. `useResearchViews.ts` — new pinned/persisted state per §2.1/§2.2, `smartBuyFullRoiDeadline`
   computed, wire into the `saleAwarePlan70` watchEffect, hardcode `roiMode`/`deliveryImpactOnly`.
7. New `SaleRideStepper.vue`, wire through `SmartBuyView.vue` → `ResearchActions.vue`, remove
   `RoiViewControls` from the card.
8. Copy/notes updates (§7), final doc-comment pass.

Steps 1–5 are independently testable/mergeable and settle the auto-planner side (where the one real
behavior change lives, §8) before the UI work (6–8) starts.
