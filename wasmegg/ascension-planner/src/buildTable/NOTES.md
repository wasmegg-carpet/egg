# Build table: working notes

Last updated 2026-10-18. Context for picking this work back up without re-deriving it.

## What this is

`scripts/buildTable.ts` builds AutoAutoAP's precomputed "instant answer" table from **our** simulator, on a maxed
account, and packs it into the `table.bin` their site loads. One cell per (start TE, Pacific hour of week); each
cell holds the surviving C3 build variants as `BuildParams` `{sales, tier13, waitStart, saleEnd, peakELR,
delivered[5]}`. Durations to any target are arithmetic on a cell (`tailTo` in `cell.ts`), not stored.

- Plan doc (decisions, their format, sources): https://claude.ai/code/artifact/2aa201ca-5c72-4a43-b420-5d4cdd8d4dd0
- AutoAutoAP: github.com/william-egginc/AutoAutoAP, branch **`ascension-chain-search`** (not the default branch),
  read at `e894b7f` (17 Oct 2026). Key files: `PRECOMPUTE.md`, `src/search/precomputedLeg.ts`, `tableBuild.ts`,
  `precomputedTable.ts`, `scripts/precompute.ts`. Wiki page "Tables and the route finder". A scratch clone was at
  `/private/tmp/claude-501/.../scratchpad/ext/AutoAutoAP` (temporary; re-clone if gone).
- Our `k3.ts`, `te-wait.ts`, `te-thresholds.ts` were byte-identical to theirs, so their tail math holds for our cells.

## Files

| File | Role |
|---|---|
| `src/buildTable/cell.ts` | Canonical start state, C1–R1 prefix, C3 variants, H1 + K3 purchases → `BuildParams`; `tailTo` |
| `src/buildTable/prefixReuse.ts` | Which hours reuse a seed's C1–R1 prefix (rule below) |
| `src/buildTable/maxedAccount.ts` | Maxed gear, epic research, colleggtibles, base state |
| `src/buildTable/cell.spec.ts` | `tailTo` = `runAscensionFromC3Variant` for every variant, targets 151–490; reuse schedule |
| `scripts/buildTable.ts` | CLI: `--generate` (worker pool, resumable, `--verify`, `--tes`), `--pack` |
| `vite.buildTable.config.ts` | Bundles the CLI for Node (`pnpm table:build` → `dist-scripts/buildTable.js`) |

```
pnpm table:build
caffeinate -i node dist-scripts/buildTable.js --generate --out out/table-maxed --jobs 7   # default 120–339
node dist-scripts/buildTable.js --pack --table out/table-maxed                            # table.bin + .gz
node dist-scripts/buildTable.js --generate --out out/verify --tes 120,250,339 --verify     # reuse check
```

## Settled decisions

- Deliverable: `table.bin` (+ `.gz`) only. No CSVs.
- Range: 120–339 default (their newest rebuilds stop at 339; above is simulated live on their page). 340–489 is
  cheap if wanted (`--to 489`). Going down to 50 was considered and dropped for now.
- Reference week: Monday 2027-01-11 00:00 Pacific (theirs). Hour 0 = Monday 00:00 PT.
- Start state: TE shared like `distributeTargetTE` from zero, each egg exactly on threshold (theirs).
- Gear (maxed): 7 T4L artifacts. Earnings: lunar totem, puzzle cube, Demeter's necklace, tungsten ankh. Delivery
  (`fixed` mode): quantum metronome, interstellar compass, gusset, lunar totem. 12 of each T4 stone family.
  Max epic research, all colleggtibles at top tier, video doubler **on** (`assumeDoubleEarnings: true`
  since 2026-10-20; tables built before that, e.g. `31b596bb`, had it off), defer-for-earnings off. Recorded as
  `doubleEarnings` in `meta.json` and the packed header.
- `simVersion` stamp = short commit hash; `-dirty` if simulator paths (or `src/buildTable`) are uncommitted.
- Header gear (2026-10-20, `header.ts` `tableGear`): `earnings`, `delivery` (artifact ids), `deliveryKey` (FNV-1a
  of the sorted delivery ids, for file names / CloudFront paths), `stones` (`quantum-stone-4: 12`, …), and
  `deferForEarnings: true` only in silo mode (absent otherwise). Chain Finder warns on missing keys, unknown keys,
  doubler off, non-maxed earnings or stones, a bad `deliveryKey`, or a `-dirty` stamp (`tableHeaderWarnings`).

## C1–R1 prefix reuse across hours

Three seeds per start TE: Tue 9:00 PT (no event), Fri 9:00 (sale active), Mon 9:00 (boost active). Another hour
reuses its class's seed when no sale/boost start or end falls within **seed prefix length + 4 h**.

- The 4 h lookahead is required. C1–R1 defers a research buy to the sale when the sale starts within the shift's
  budget (`buyResearch` in `shifts/helpers/milestones.ts`); C2 and I1 budgets are 4 h. Without it, TE 150 starts at
  Fri 5:00–7:00 differed (fresh build waited into the sale: 3.5–4 h prefix vs 1.06 h).
- Verified with `--verify` at 29 start TEs from 120 to 489 (every 20th, plus 150, 250, 350, 450, 489), every hour
  built both ways: **zero mismatches**, tier-13 builds included. 141–149 of 168 hours reuse a seed.
- Saves 30–81% of the work depending on TE.

## Build speed work (2026-11-02)

Against a table built at `129f5daa`, three single-worker TEs ran concurrently:

| TE | Before | After | Saved |
|---|---|---|---|
| 150 | 106 s | 45 s | 58% |
| 250 | 129 s | 64 s | 51% |
| 320 | 92 s | 48 s | 48% |

- Kept (output identical): one full stone evaluation per solve, then multiply (`getOptimalELRSetFromPool`); walk
  boost transitions in order instead of filtering and sorting per call (`getTimeToSave`, `calculateEarningsForTime`);
  build the boost list once per `rankResearchByELRImpact`, not per candidate.
- Checked on 23 start TEs (3,864 cells and the K3 record, against `LLLL`), plus 150 cells across T4E metronome,
  T4E compass, T2E gusset, silo mode and a short mixed-tier stone pool (against the old code).
- Rejected: 30 ROI search iterations instead of 60. No measurable speedup, and every compared cell changed (`waitStart`
  up to 11%, `peakELR` up to 7%). The cause wasn't investigated, so don't assume the iteration count is only precision.
- Rejected: inferring cells across TEs. In the table, `waitStart` and `delivered` almost never match between adjacent
  TEs, and equal `peakELR` at both ends of a range doesn't guarantee it in between (up to 37% wrong).
- The "Measured" timings below predate this work. A CPU profile inflates runtimes about 3.5×: use it for shares only.

## Measured (M3, 4P + 4E cores, 7 workers)

| Range | Wall time | Source |
|---|---|---|
| 340–489 | 15.8 min | real run of all 150 TEs |
| 120–339 | ~1 h 52 min | real 10% sample (every 10th TE) took 11.2 min, × 10 |
| 120–489 | ~2 h 8 min | sum |

Per-TE cost (core-s): ~320 at 120 falling to ~170 at 180; jumps to ~270 at 190 (tier-13 attempts begin); ~150 by
330; 105–140 at 340–353; drops to ~65 at 354; 20–45 from 400.

Storage: every cell has exactly 3 builds → `table.bin` = 36,288 B per start TE: 8.0 MB (120–339), 13.4 MB
(120–489); gzip ≈ 21% (~3 MB full). jsonl ≈ 116 KB/TE, reports ≈ 29 KB/TE; full output dir ≈ 70 MB.

Their reader (`readTable`, `tailTo`, `sweepTails`, `pacificHourOfWeek`, copied unmodified into a temporary spec)
accepted our file: every cell decoded exactly; 171,360 (build, target) durations matched ours to the bit. Their page
flags any `simVersion` other than its own `SIM_VERSION` (`2026-10-13-lowte-gate`) — expected; they'd need to sync.
Note: `sweepTails(b, top)` starts above where the build's own eggs already are; pass `lowest` to cover every target.

## Status at end of 2026-10-18

- Nothing committed. Uncommitted: `src/buildTable/`, `scripts/buildTable.ts`, `vite.buildTable.config.ts`,
  `.gitignore` (dist-scripts/, out/), `package.json` (`table:build`). Commit before the real run so the stamp is clean.
- `out/timing-high` holds complete 340–489 cells stamped `2da01de4-dirty` (timing run). Other `out/` dirs are tests.
- Full clean run not started.

## Open topic: weaker artifacts and stones (continue here)

Goal: tables for imperfect gear without a ~2 h build per combination.

User's corrections and inputs (2026-10-18):
- **Delivery gear can't be applied after the fact.** C3 buys different research for a different delivery set
  (`simulateSaleEndsBuy` / `simulateFinalSaleGapBuy` take `contextDeliverySource(context)` in `shifts/c3.ts`), so a
  maxed-delivery build re-priced with another set is wrong. Each delivery set needs its own builds.
- **Earnings gear → CTE is fine.** The puzzle cube discounts research only, but habs and vehicles are trivially
  cheap by comparison: treat earnings sets with equal Clothed TE as equivalent. Don't split CTE into two keys.
- **Players run the same gear at different levels.** E.g. A: T4E puzzle cube, rest T4L. B: same with a T4E
  metronome. C: same with a T4E compass. So variants are levels of one fixed structure, not arbitrary sets.
- User's proposed record: "X CTE starting on hour {0–167} with {hashed delivery set} yielded {x} delivery rate at
  {timestamp}" — i.e. key cells by (start CTE, hour, delivery hash) and adjust earnings via CTE without rebuilding.

Design as discussed so far:
1. Key rows by start CTE (TE + earnings-set Clothed TE, `cteFromArtifacts` in `lib/virtue.ts`) instead of TE. A
   player with weaker earnings gear looks up the row at their CTE, rebased onto their egg counts. Player A = maxed
   table, no extra build.
2. Fractional CTE: the simulator rounds TE for the earnings multiplier, but `context.colleggtibleModifiers.earnings`
   is a continuous multiplier, so any CTE can be built exactly without simulator changes.
3. C1–R1 appears independent of the delivery set (delivery inventory is read only in C3 and H1; C1 uses
   lunar/shell, delivery uses quantum/tachyon). If verified, one prefix per (CTE, hour) serves every delivery set.
4. Delivery variants are the real cost: each ≈ a full 120–339 build (~1.5–2 h). Maxed + the three single T4E
   delivery downgrades (metronome, compass, gusset) ≈ 6–8 h.
5. Possibly share rows above ~TE 340 across delivery sets (full research reached; only peakELR differs), which would
   need research levels at K3 stored per build (~1–2 KB). Unverified — must measure.
6. Hash what the optimizer chooses (like AutoAutoAP's gear stamp), not the raw inventory, so equivalent inventories
   share a table.

Proposed experiments, not yet run (~20–30 min):
1. Build cells with a T4E-cube earnings set; compare durations to the CTE-shifted maxed row (via the earnings knob).
2. Confirm C1–R1 is identical for maxed vs downgraded delivery sets.
3. For one T4E delivery downgrade, find from which TE builds match maxed except peakELR.
