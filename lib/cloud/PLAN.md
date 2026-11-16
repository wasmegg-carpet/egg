# Cloud plan library — plan and status

The planners' plan library synced to Cloudflare (R2) per EID and protected by a PIN, plus share links. Work is
spread over several sessions. **This file is the source of truth for where things stand. Read it first, and
update the Status and checklist before ending a session.**

## Status

- **Last updated:** 2026-11-15
- **Phase:** 1–4 done, 5 partly. Everything works end to end, including in a real browser (headless Chromium
  against `wrangler dev`: set up, remembered device, sync, second device with PIN, wrong PIN, share link import,
  replace via "Forgot PIN?").
- **Test deployment (user's account):** `https://joo-cloudflare.joo-cloudflare.workers.dev`, bucket
  `planner-cloud`, lifecycle rules, `SESSION_SECRET` set. `CLOUD_API_URL` in `api.ts` points at it.
- **Commits:** worker all committed locally in `joo-cloudflare` (not pushed). Egg changes are **uncommitted**
  (`lib/cloud/`, `lib/planners/composables/useCloudLibrary.ts`, `ui/components/planners/cloud/`,
  `PlanLibrary.vue`, the two planner vitest configs, `lib/jest.config.js`).
- **Next:** the user tries it on their own devices (phone + computer) and reviews the UI; then commit egg; then
  production with Carpet (5.3, 5.4).
- **Not yet checked in a browser:** the enlightenment planner (same components; it type-checks and its tests
  pass), the "⋯" menu items (change PIN, forget device, delete library, share links list) beyond unit tests.

### How to resume

1. Read this file, then `git status` / `git log --oneline -15` in both repos to see what changed since the last
   update.
2. Continue from the first unchecked item. Tick items as they're finished (`[x]`) and add a line to the Session log.
3. If a decision below turns out wrong, change it here first, with the reason, and then change the code.
4. Commits: in `joo-cloudflare`, commit locally after each finished step; **never push** unless the user asks.
   In the egg monorepo, don't commit unless the user asks (it's their main branch).

## Decisions (settled with the user, 2026-11-14 and 15)

- **Storage:** a new Worker and a private R2 bucket, separate from `ap-table-store` (that one is KV, repo
  `wasmegg-carpet/ap-tables`, read-only from the app). The worker lives in **its own repo**, made by the user
  (not in the monorepo). The user develops and test-deploys on their own Cloudflare account; Carpet (carpetsage)
  forks or copies it for production and changes the config.
- **Workers Free plan (both accounts).** About 10 ms of CPU per request (time spent waiting on R2 or fetch doesn't
  count), 100k requests a day. The worker's heaviest work is one ~1 ms hash at library creation; bodies are
  streamed or copied, never parsed. Encryption and the PIN's slow hash happen in the browser.
- **Scope:** shared code in `lib/` and `ui/`, wired into **both** the ascension planner and the enlightenment
  planner (`wasmegg/enl-planner`) from the start, so other wasmegg apps can reuse it. This is an explicit exception
  to the ascension-planner-only scope in `.claude/CLAUDE.md`.
- **Identity:** one cloud library per EID, shared by all planners (each entry is tagged with its planner). Alts are
  separate libraries with separate PINs.
- **PIN types:** 6-digit (default), 4-digit, password, or none (`pin6`, `pin4`, `password`, `none`). The type is
  stored in the marker so the unlock screen shows the right input. "None" means anyone who has the EID can read
  and write the library, and the setup screen says so.
- **Wrong PIN vs. no library:** a marker exists for every created library. Marker present but no main file at the
  derived id means a wrong PIN; no marker means no library.
- **Wrong-PIN protection:** per library, 5 free wrong PINs, then 1 s, 2 s, 4 s … up to 15 minutes between attempts.
  No hard lockout (a griefer who knows the EID could trigger one); the 15-minute cap bounds how long a griefer can
  hold the owner off. Each attempt is recorded before it's checked, so parallel guesses can't skip the delay.
- **Sessions (added 2026-11-15):** unlock is the only route that checks a PIN-derived id. It returns a signed
  24-hour session token, and every other library route needs it. Without this, routes taking the main id would
  be unthrottled PIN oracles. The client remembers the main id on the device and re-unlocks silently when the
  token expires.
- **Master key:** a random key encrypts plans. A key derived from the PIN encrypts only the master key, which is
  stored in the main file. Changing the PIN rewrites only the main file. Recovery codes come later.
- **No list endpoint.** Objects can be fetched only by exact name. No per-file write tokens.
- **Sync:** Save writes locally and to the cloud in one step. The newest save wins (one plan isn't edited on two
  devices at once). Changes are downloaded on unlock. A failed cloud save still saves locally, marks the plan
  "not synced" and retries.
- **Delete** a cloud plan = delete everywhere.
- ~~Upload all button~~ (replaced 2026-11-15): every local plan uploads automatically, including after a
  replace and when another device connects.
- **Remember this device:** store the unlocked keys (never the PIN) in IndexedDB, with a "don't use this on a
  shared device" warning and a "forget this device" button.
- **Shares:** one-time and multi-use links. The decrypt key goes after `#` in the link (never sent to the server).
  A link is consumed only when the user clicks Import. Importing needs no PIN and no cloud library. Unclaimed
  shares expire after **30 days**. The sender sees pending shares and can revoke them.
- **Orphans (revised 2026-11-15):** R2 lifecycle rules delete objects **1 year** after they were last written.
  After unlocking, the client calls `POST /v1/touch` with its plan ids, and the worker rewrites, unchanged, any
  of the library's objects last written over 180 days ago. Libraries in use never expire; no cron job needed.
- **Abuse limits:** 5 MB per plan, 1 MB per main file (gzip, then encrypt). Per library: 500 plans and 50 MB
  (vars `MAX_FILES`, `MAX_LIBRARY_BYTES`). Per-IP rate-limit bindings (create 5/min, unlock 20/min, writes
  120/min, reads 1200/min). CORS for the production origin, Netlify previews, and local/LAN origins. At library
  creation the worker checks the marker is the EID's own and the EID is a real player (Egg Inc API); it doesn't
  store the EID.

## Design

The worker's README (`../joo-cloudflare/README.md`) documents the API route by route. This section is what the
client side needs on top of it.

### Object layout (R2)

| Key | Contents |
| --- | --- |
| `marker/<M>` | JSON `{settings, meta, rev}`. `settings` = `{v: 1, pinType, salt (base64), kdf: {alg: 'PBKDF2-SHA256', iterations}}`, public via `GET /v1/marker/:M`. `meta` = worker bookkeeping (files, bytes, fails, failAt) |
| `lib/<M>/<P>` | main file: the encrypted library index |
| `plan/<id>` | one plan: gzip, then AES-GCM with the master key |
| `share/<id>` | a shared plan: gzip, then AES-GCM with the link key (phase 4) |

R2's etag is an MD5 of the body alone. Rewriting identical content keeps the etag (so touch doesn't break the
client's `If-Match`), and metadata-only changes are invisible to conditional writes (so the marker keeps its
bookkeeping in the body, with a revision number).

### Derivations (the client must match these exactly)

- **Marker id `M`** = hex(PBKDF2-SHA256(password = normalized EID, salt = `wasmegg-cloud:marker:v1`, 10,000
  iterations, 128 bits)). Normalized EID = trimmed, uppercased, `EI` + 16 digits. Test vector:
  `EI0000000000000000` → `1ca62b75ebb07f985eaf1289c4664bcf` (pinned in the worker's `test/eid.spec.ts`). Not
  the local `hashID` (plain SHA-256).
- **PIN key** = PBKDF2-SHA256(password = PIN (empty string for `none`), salt = settings.salt bytes ‖ normalized
  EID, settings.kdf.iterations, 256 bits). Default 600,000 iterations (~50 ms on a Mac; aim for about 0.5 s on a
  phone, measure in 2.1). HKDF-SHA256 from the PIN key with info `wasmegg-cloud:main-id:v1` → 128 bits → hex = `P`,
  and info `wasmegg-cloud:kek:v1` → 256 bits = the KEK (AES-GCM key-wrapping key).
- **Master key** = random AES-GCM 256, wrapped with the KEK and stored in the main file.
- **Envelope** for every encrypted object: `version byte (1) | 12-byte IV | AES-GCM ciphertext`, plaintext gzipped
  first.
- **Main file** = `{v: 1, wrappedKey (base64), body (base64 envelope under the master key)}` as JSON. Decrypted
  body (`LibraryIndex`): `{v: 1, plans: [{id, planner, name, timestamp, deletedAt?}], shares: [], prefs: {}}`.
  Deleted plans keep a tombstone (`deletedAt`) for 180 days so every device drops its copy.
- **Plan object** (`StoredPlan`) = envelope of `{v: 1, planner, name, timestamp, localId, data}`. Cloud plan ids
  are the worker's random ids; `localId` is the uploading device's local id, reused on other devices when free
  (planners embed the plan id in the plan data).
- **Sync links** (per planner DB and EID partition, metadata key `cloudLinks`): local id → `{cloudId,
  syncedTimestamp, localOnly}`. Kept outside the plan records because every local writer builds fresh records.
  **Every local plan syncs automatically** (user decision, 2026-11-15): plans already in a browser upload on its
  first pass, whether that's setting up, signing in on another device, or after a replace. No local-only state,
  no upload buttons. Newest timestamp wins. See `sync.ts`.

### Code layout

- **Worker repo** (`joobrainie/joo-cloudflare`, see 0.2): TypeScript, wrangler, vitest in the Workers runtime with
  local R2, modelled on `wasmegg-carpet/ap-tables`.
- `lib/cloud/` (built): `crypto.ts` (derivations, envelopes, main file), `api.ts` (`CloudApi`, `CloudError`
  by worker code; base URL from `VITE_CLOUD_API_URL`), `library.ts` (`CloudLibrary`: create / unlock / resume,
  index read-modify-write, plans, PIN change, delete), `sync.ts` (`syncPlanner`, `planState`),
  `device.ts` (remember / forget, IndexedDB `wasmegg-cloud`, shared by every app on the origin),
  `plannerStores.ts` (sync adapters over a planner's `createPlannerDb`), `testing/fakeWorker.ts` (in-memory
  worker for specs). Specs run under both planners' vitest (`lib/cloud/**` is in their `include`, and excluded
  from lib's jest). `e2e.spec.ts` runs against a real worker when `CLOUD_E2E_URL` is set.
- `lib/planners/storage/db.ts`: unchanged (links live in its metadata store).
- `ui/components/cloud/`: the create/unlock dialog, the PIN type picker, remember/forget device, the share dialog
  and the pending-shares list.
- `ui/components/planners/PlanLibrary.vue`: the cloud badge, send to cloud, upload all, share, delete everywhere.

## Checklist

### Phase 0 — setup

- [x] 0.1 Design agreed and recorded here
- [x] 0.2 Worker repo: https://github.com/joobrainie/joo-cloudflare, cloned at `../joo-cloudflare` (next to the
      egg checkout). Remote uses the `github-joobrainie` SSH alias; repo-local git user is joobrainie (the global
      identity is a work account, so never rely on it)
- [x] 0.3 Workers plan: **Free** on both accounts (see Decisions)
- [x] 0.4 R2 enabled on the user's Cloudflare account
- [x] 0.5 Rate-limit bindings deploy and run on Free

### Phase 1 — worker (local, `wrangler dev`)

- [x] 1.1 Skeleton: router, CORS allowlist, JSON errors, tests in workerd with a real local R2.
      `src/worker.ts` may export only `default` (the runtime rejects other named exports)
- [x] 1.2 Markers and unlock: `GET marker`, `POST unlock` with the reserve-then-check failure counter and delay,
      session tokens
- [x] 1.3 Main file: `PUT` with If-Match, `rekey` (PIN change), `DELETE` library
- [x] 1.4 `POST /v1/library`: marker-matches-EID check (10,000-iteration PBKDF2, ~1 ms) and the Egg Inc API check
      (hand-encoded `bot_first_contact`; a real player's answer has field 1, an unknown EID gets an empty body)
- [x] 1.5 Plans: create/get/put/delete, 5 MB cap, per-library quotas in the marker, `POST /v1/touch`
- [x] 1.6 Per-IP rate-limit bindings
- 82 tests passing; end-to-end run through `wrangler dev` against the real Egg Inc API with the public donated
  EID (create, wrong PIN, unlock, main-file save, plan lifecycle, touch, delete; a fake EID is refused)

### Phase 2 — shared client code (`lib/cloud/`)

- [x] 2.1 Crypto: marker id matches the worker's vector; main-id vector pinned (computed independently);
      PIN-format errors (`pin_format`); NFC passwords; gzip + AES-GCM envelopes
- [x] 2.2 API client for every route, typed `CloudError` codes, `network` / `unexpected` for non-worker failures
- [x] 2.3 `CloudLibrary`: create, unlock, resume, refresh (cheap session-gated read; re-unlock only when the
      session expires), index updates with conflict retry, PIN change, delete library
- [x] 2.4 Sync (`syncPlanner`): both directions, deletions both ways, newest wins, one index write per pass,
      partial passes recorded, one pass at a time
- [x] 2.5 Remember / forget device (`device.ts`)
- [x] 2.6 Links in the planner metadata store instead of new plan fields (no migration needed)
- 39 client specs passing under both planners (plus the e2e, passing against `wrangler dev`); both planners'
  full suites still pass (443 and 207)

### Phase 3 — interface (both planners)

- [x] 3.1 `useCloudLibrary` (lib/planners/composables): opens by itself on a remembered device, else the PIN
      prompt appears right away; sync after opening, local changes, libraryUpdateTick, and tab focus
- [x] 3.2 `CloudBar` in PlanLibrary: one-line offer (hideable; then a link in the footnote), inline PIN prompt
      with "Remember this device" and "Forgot PIN?", collapses to "Synced ⋯" when done; per plan: "send to cloud"
      for local-only plans, a pulse while pending, share button; delete dialogs say it deletes everywhere
- [x] 3.3 `CloudPinDialog` (create / replace / change; PIN twice; warnings), menu: share links, change PIN,
      forget device, delete cloud library
- [x] 3.4 / 3.5 Both planners (shared PlanLibrary); planner id = `PROFILE.storagePrefix` (`ascension`, `enl`)

### Phase 4 — sharing

- [x] 4.1 Worker: `POST /v1/shares` (session), preview, claim (once = deleted), revoke by token; nothing stored
      links a share to its library (marker keeps only share *times*, cap 100 per 30 days)
- [x] 4.2 Client (`share.ts`): link `#share=<id>.<key>`; plan scrubbed of EIDs and identity fields before
      upload; PlanLibrary offers Import when opened with a share link (after the EID is entered); no PIN needed
- [x] 4.3 `CloudSharesDialog`: list (live / used / expired), copy, revoke, clear used

### Phase 5 — deploy

- [x] 5.1 Lifecycle rules on the test bucket; `npm run setup` adds them (and bucket, deploy, secret) anywhere
- [x] 5.2 Test deploy on the user's account; e2e spec passes against it
- [ ] 5.2b The user tries it on real devices
- [ ] 5.3 Production (Carpet): fork or copy the repo, bucket, worker, secret, lifecycle rules, production CORS
      origin
- [ ] 5.4 Point the client at the production URL

### Phase 6 — custom Chain Finder table (built 2026-11-15)

Decisions (user): only for players with a cloud library; one table per library (a new one replaces the old);
shareable like plans; expires like everything else (a year untouched, kept alive by touch and by use).

- Facts: tables are gzipped, ~3.1–3.5 MB (the 26 on ap-table-store), under the 5 MB object cap and the 50 MB
  library quota. No worker change: a table is an opaque encrypted object like a plan.
- [x] 6.1 Client: `customTable` entry in the encrypted index (`{id, name, from, to, delivery, savedAt}`), outside
      plan sync; `saveTable` (create or replace the object, then the entry), `loadTable`, `deleteTable`; touch
      includes it; a local IndexedDB copy re-downloaded only when `savedAt` changes. Tests
- [x] 6.2 Move the cloud connection to the app level (not PlanLibrary), with a compact PIN prompt usable on any
      tab. Fixes sync not starting on the Auto Planner / Chain Finder tabs
- [x] 6.3 Chain Finder UI (`CustomTablePanel`, `useCustomTable`): after "Load a table file" (already validated by `readTableFile`), offer "Save to your
      cloud library" (confirm replacing, naming the current one); "Your table (name, TE x–y)" beside the default;
      also offer saving a table Chain Finder built; **download** the custom table (the same `.bin.gz` file;
      user request)
- [x] 6.4 Sharing: share a table like a plan (`StoredPlan`-style payload with a `kind: 'table'`); importing it
      with a library offers to make it your custom table (replace confirm); without a library, use it for this
      visit and offer to set one up. Browser-test the whole flow

### Later

- [ ] Recovery codes (a second wrapped copy of the master key)
- [ ] Preferences in the main file

## Decisions, 2026-11-15 (user answers)

- **Controls:** the proposal is fine. Once everything is uploaded and synced, the cloud controls shrink to
  almost nothing (a small "synced" indicator and a menu), so they don't clutter the library.
- **No "unlock" step in the user's mind:** when an EID with a cloud library is entered, it opens automatically
  on a remembered device, or asks for the PIN right away. Not set up → a quiet offer to set it up.
- **Shares:** only cloud-library users create them (session required); anyone imports. A share must **never be
  traceable to an EID**: nothing stored links a share to a library or marker, and the shared plan's contents are
  stripped of the sender's EID (and any player identifiers) before upload.
- **Forgotten PIN:** option (b), "replace my library" with the EID alone. A clear warning when setting the PIN
  (it can't be recovered; replacing loses the cloud copies), and another when replacing. **PIN is entered twice**
  when set (create, change PIN, replace).
- **Caps:** 500 plans and 50 MB per library are fine.
- The user ran `npx wrangler login`; test deploys to their account (5.2) are OK.

## Open questions (for the user)

- None right now.

## Session log

- 2026-11-14: design discussed and agreed (see Decisions).
- 2026-11-15: wrote this plan and checklist. The worker goes in its own repo (made by the user); both Cloudflare
  accounts are on Workers Free; R2 enabled. Built phase 1 in `joo-cloudflare` (toolchain pinned: wrangler
  4.156.1, @cloudflare/vitest-plugin 1.4.12, vitest 4.1.12, typescript 6.0.3, workers-types 5.20261102.1).
  Found along the way: R2's etag ignores metadata (marker bookkeeping moved into the body); plan routes would have
  been PIN oracles (added session tokens); the marker hash is cheap enough for the worker to verify; lifecycle
  rules + touch replace the orphan cron.
- 2026-11-15 (late): built phase 6. Cloud connects from `initPersistence` (any tab); `CloudPinPrompt` shared;
  `useIncomingShare` routes share links (plan → Plan Library, table → Chain Finder, which needs no EID);
  envelope v2 (no gzip) for tables; local IndexedDB copy. Browser-tested: save a loaded file, byte-identical
  download, default/custom switch, auto-load after reload (fixed a race with the Chain Finder's own pick:
  wait for it to finish), share → import on a fresh browser, PIN prompt in the Chain Finder, remove.
  Download / share / remove are icon buttons (user request).
- 2026-11-15 (night): designed phase 6 (custom Chain Finder table) with the user.
- 2026-11-15 (night): while a cloud library is locked (or still being checked), the Plan Library and the plan
  picker hide the browser's copies and ask for the PIN (`libraryLocked`), so nobody mistakes them for a synced
  library. They still show when the cloud is unreachable.
- 2026-11-15 (night): user decided everything syncs automatically: no local-only plans, no upload buttons;
  existing plans upload on a browser's first sync (setup, another device, after a replace).
- 2026-11-15 (night): user testing found the cloud read the EID from `initialStateStore.playerId`, which loading
  a saved plan/draft overwrites with the redacted `EIxxxxxxxxxx`. Now `usePersistence` keeps the EID the app
  passed to `initPersistence` (`persistenceEid`) and the cloud uses that. **Never take the EID from plan data.**
- 2026-11-15 (evening): user decisions recorded; worker gained replace + shares and `npm run setup`; deployed to
  the user's account; client shares/replace; phase 3 UI built and driven in headless Chromium. Fixed: unusable
  remembered keys now fall back to the PIN prompt.
- 2026-11-15 (later): built phase 2 (`lib/cloud/`), and added `GET /v1/lib/:M/:P` to the worker so refreshes
  don't unlock again. Worker 83 tests; client 39 + e2e.
