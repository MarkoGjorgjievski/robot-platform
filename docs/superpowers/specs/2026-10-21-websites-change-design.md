# Websites change: keep running, re-check, tell the customer — design

**Status:** written 2026-10-21 under the standing approval (`CLAUDE.md`, "Autonomous runs"); queue item 1
"Websites change: keep running, re-check, tell the customer", approved by Marko 2026-10-21 ("yes,
start"). Plan: `docs/superpowers/plans/2026-10-21-websites-change.md`. Every behaviour below was read in
the code on `feat/websites-change` @ `c3249bb`; line numbers are approximate — find the code by the quoted
text. The numbers in §1 and §8 come from the re-verify report
(`docs/testing/results/2026-10-21-reverify-one-source/report.md`) and from a read-only probe of the ten
websites' stored 2026-10-21 captures, run while writing this spec (no writes, no AI).

## 1. Why

On 2026-10-21 twenty websites were re-verified, free and keyless. Ten of them had been fully certified and
**lost their certification**: Barnesandnoble, Acne / Ikea, Madeincookware, Everlane, Mejuri, Gymshark, Ridge,
Oliverbonas, Burrow, Skullcandy. Since then a run on any of them is refused ("Verify the schema before
extracting"). 27 fields that had passed failed this time, on 15 websites. Nothing about our paths broke:

- **The values moved on.** Prices (Mejuri 615 → 625, 435 → 440, 3250 → 3300; Everlane 125 → 180; Burrow
  1301 → 1859), ratings (Gymshark 4 → 4.2; Oliverbonas 4 → 4.5; Burrow 4.78 → 4.74; Barnesandnoble 4.5 → 4.6),
  review counts (Acne / Ikea 149 → 150, 45 → 46, 62 → 64), stock (Ridge, Everlane), one SKU
  (Madeincookware) and one description (Barnesandnoble). The expected values the customer typed weeks ago are
  simply out of date.
- **One proof page is gone:** Skullcandy's `slyr-pro-multi-platform-wired-gaming-headset` returns 404, so all
  eight of its fields failed on that page while reading every value on the other two.
- The probe of the stored captures says the rest: **every one of the failing fields' last good paths still
  reads a value, in the same place, on every captured proof page.** Not one field is lost. The certification
  still extracts; only Verify's comparison with stale expected values fails.

Today one failed re-verify revokes the whole website, the customer has to retype every moved price by hand
("Accept new values" exists only after a run flags drift), nothing re-checks a website between runs, and
nothing tells the customer anything until they open the Verification tab. Websites change all the time; this
spec makes that ordinary: keep running on what was verified, refresh the values that change by nature, check
on a schedule, and say in one plain notice what needs the customer.

## 2. What exists today

| What | Where | What it does |
|---|---|---|
| Field currency | `packages/api/src/verify/current-certification.ts:109-133` (`currencyOf`) | A field is current when the latest completed, error-free Verify holds a passing result for it (`certified`, `defaultOnly` or `notOnWebsite`, every cell `pass`, l.128) whose `fieldHash` equals today's hash. |
| Certification | same file `:223-263` (`loadCertificationState`) | `cert` is null unless **every** contract field is current on that one run (l.233). Paths come from that run's results (l.255). |
| The hash | `packages/scraper/src/verify/run-verification.ts:88-112` (`fieldHash`) | Covers the field's type, concept, pages, marks, confirmed paths, absent marks, default **and its expected values** (l.104). Changing an expected value changes the hash, so the field stops being current on every earlier run. |
| The gate | `packages/api/src/crawl/require-certification.ts:19-31` | Every plan/probe/execute throws `PRECONDITION_FAILED` "Verify the schema before extracting" (l.23) when `cert` is null. The app's Extract tab locks on `status.current && status.allPassed` (`packages/app/src/routes/_app/projects/$project/sites/$site/extract.tsx:185`; `lib/site/variants-row-view.ts:343-346` for the verify bar). |
| A failed Verify | `packages/api/src/verify/run-source-verification.ts:171-186`; `routers/sources.ts:1177-1238` | Writes its results as the newest clean run; a failing field is no longer current, so the whole certification is gone. Since 2026-10-20 `verificationStatus` keeps the last good results on screen only when the run *errored* (`failedRun`, l.1225) — a run that completed with failing fields replaces them. |
| Drift at run time | `packages/api/src/crawl/drift.ts:67-73` (`flagDrift`); `crawl/start-execution.ts:98-136` (`buildFinalise`) | After a certified run, fields empty on ≥ `DRIFT_MISS_SHARE` of rows are flagged on the run and on `sources.driftedFields`, and a drift check starts (l.126-128). Drift never revokes a certification. |
| The drift check | `packages/api/src/verify/run-drift-check.ts:107-216` | Re-captures the proof pages (three browsers shared with the Verification tab, never a Jev reading, l.80-81), classifies only `sources.driftedFields` (l.153-160) with the current certification's paths (l.155), writes its own `drift_checks` row and nothing else. With no certification every field is `lost` with no work (l.160-161). |
| Classification | `packages/scraper/src/verify/drift-classify.ts:228-257` | `other-layout` (certified paths still read every expected value, l.101-120) → `moved` (a mechanically found path certifies the old values, ≥ 2 pages, l.128-158) → `changed` (an old certified path **or a concept-search structured path** reads a valid value of the type on every page and a different one somewhere, l.177-226) → `lost` (every deciding page `value: null`, even where a path still reads, l.255). Never a model call. |
| Repair actions | `packages/app/src/lib/site/drift-view.ts:169-263` | Under a drifted row: "Moved on the page — Accept new location", "Page now shows X (was Y) — Accept new values", "Not found on the page — Mark it again", "Product n no longer loads — Replace product n". `acceptChanged` (l.258-263) writes the new value and the page's mark (or none) into the board; nothing is auto-accepted and a Verify is still needed. |
| Notices | `drift-view.ts:23-27` (`driftBadge`), `:55-84` (`driftBanner`); `components/project/websites-table.tsx:92`; `components/site/site-header.tsx:30`; `components/verification/drift-banner.tsx` | "n fields stopped extracting" on the websites table and the website header; "{Fields} stopped extracting in the run of {date} …" on the Verification tab. Only when a run flagged drift. |
| The coverage check | `packages/api/src/verify/run-coverage-check.ts:108-217`, `coverage-summary.ts` | After a **passing** Verify only (`run-source-verification.ts:180-186`): samples twenty listing products with the current certification's paths (l.147-152: no certification, no sampling), groups the empty ones by page shape and offers "Use as proof page". |
| Shown on the page | `packages/scraper/src/verify/shown-on-page.ts:80-91` | Is a value in the page's visible text? `true`/`false`, or `null` for url/image/boolean/date/text_list (l.11); an XPath read is always `true`. |
| What a run writes | `packages/scraper/src/verify/verified-extraction.ts:133-162` (`runVerifiedExtraction`) | With a capture supplied: the certified paths in order, the first that reads a valid value wins, plus `shown` per field. No page load. |
| A fixed variant | `packages/scraper/src/verify/page-variant-match.ts:21-27` (`readsFixedVariant`) | True for a structured path with a numeric index directly on a variant-list key (`offers[0]`, `hasVariant[2]`, `variants[1]`, `products[0]` …), never `@graph[n]`. |
| Concepts | `packages/scraper/src/verify/derive-concept.ts:9-20` | `price`, `product_name`, `description`, `image_url`, `brand`, `sku`, `availability`, `rating`, `review_count`, `currency`, else a slug. "Price currency" derives `price` (the first alias wins) with type `text`. |
| Staff log | `packages/api/src/auth/staff-actions.ts:21-23`, `packages/db/src/schema.ts:633-647` | `staff_actions`: one row per staff-mode mutation, with a person's `actor_email`; the customer reads it as "Robot staff activity". |
| A scheduler | — | None. `packages/api-server/src/index.ts` only serves. No `setInterval`, cron or job table anywhere in `packages/api*` (checked). No email sending exists (the only "email" code is sign-in addresses). |

## 3. The rules

### 3.1 Keep the last good certification — holds

**A field's certifying result** is the result runs read for it: its current result (today's rule), or, when
it is not current, its **hold**.

**A hold** keeps a field's last passing result after a Verify that did not pass it. It is one row per website
and field (`field_holds`), and carries:
- the last passing result itself (`FieldVerification`: its `certified` paths and its cells' `path`s),
- when and by which Verify it passed (`verified_at`, `verification_id`),
- which Verify did not pass it (`failed_verification_id`; null when an automatic refresh made the hold),
- `field_hashes`: the field hashes it stands for — the hash it passed at, plus every hash an automatic
  refresh (§3.2) moved it to.

**A hold counts** while the field is not current and today's `fieldHash` is one of its `field_hashes`. So:
- the customer's own edit of the field (an expected value, a mark, a proof page, the type …) moves the hash
  outside the list and ends the hold — exactly as such an edit ends a current certification today;
- an automatic refresh moves the hash and adds the new one to the list, so the hold survives it;
- a stale autosave that writes the pre-refresh value back lands on a listed hash too (Review Focus).

**When a Verify completes**, for each field it verified (all fields, or `onlyKeys`):
1. it passes → its hold (if any) is deleted;
2. it does not pass, and it had a certifying result before this Verify whose hashes include today's hash →
   the Verify's own captures are read with that result's paths, exactly as a run would read them
   (`runVerifiedExtraction` with the capture supplied, no page load). If the paths **still extract** — a value
   on at least one captured proof page, or no page could be captured (nothing learned), or the result has no
   paths (`defaultOnly` / `notOnWebsite`) — the hold is written (kept, or created from the certifying
   result). If they read nothing on every captured page, there is no hold: the field is not certified and the
   website needs the customer for it;
3. otherwise (it never passed, or the customer changed it since) → no hold.

The verification row, the hold writes and deletes, and `sources.next_check_at` are written in one
transaction, so no reader ever sees the field uncertified in between.

**The certification** (`loadCertificationState`) is non-null when every contract field is current **or
held**; a held field's paths are its hold's `certified`. Everything that reads the certification — the gate,
`startExecution`, `flagDrift`, the drift check, the coverage check, the variant run plan — therefore keeps
working on the last good paths. Variants are unchanged: still read from the latest clean run (none of the ten
websites has variants; §10).

**Checks never revoke; only the customer does.** A scheduled check, a run's drift check and a failed re-verify
inform and refresh; none of them takes a certification away from a field whose paths still extract. The
customer's own edits move the certification exactly as today.

### 3.2 Fields that change by nature refresh their expected values

**By nature** — a field changes by nature when its concept and type are one of:

| Concept | Type | Fields it covers |
|---|---|---|
| `price` | `money` | Price, Sale price, RRP, Cost … (not "Price currency": `price` concept but `text`) |
| `rating` | `number` | Rating, Average rating, Stars |
| `review_count` | `number` | Review count, Reviews, Total reviews |
| `availability` | `boolean` or `text` | In stock, Availability, Stock |

Every other field — Title, Brand, SKU, Description, images, URLs, custom fields — stays manual: a changed value
there is shown with "Accept new values" as today.

**A refresh** happens when a check (the scheduled check, a run's drift check, or the check that follows a
Verify that left a hold, §3.3) reads the field's certifying paths on fresh captures and **all** of these hold
(`planRefresh`, pure, in `@robot/scraper`):
1. the field changes by nature (above);
2. on at least one proof page with an expected value, what a run writes differs from it (`valuesEqual`);
3. at least two proof pages with an expected value were read, and every one of them reads a value (a page that
   reads nothing is a shape problem, not a price change — §3.4);
4. on every differing page, the value comes from **the same certified path that passed there** (the certifying
   result's cell `path` for that page — "the same place");
5. that path does not read a fixed variant (`readsFixedVariant`): a fixed index into a variant list may now
   point at another variant (this refuses Madeincookware, Everlane, Burrow and Ridge's paths, §8);
6. the page shows the new value (`shownOnPage` is not `false`; `null` — booleans — passes);
7. the new value is in range: a price or rating above 0; a rating within the old value's scale (≤ 5 when the
   old value was ≤ 5, else ≤ 10, else ≤ 100); a review count a whole number ≥ 0; and any number within a
   factor of 5 of the old value either way (`REFRESH_MAX_FACTOR = 5`) — a cents/units change or another element
   is not a price change.

If one differing page fails a condition, nothing is refreshed for that field (all or nothing per field); the
check records why (staff only, §6) and the field shows "Page now shows X (was Y) — Accept new values" as today.

**What a refresh writes**, in one transaction, under the source row lock `updateBinding` already takes:
- nothing, if a Verify is in flight for the website, or any refreshed cell's stored expected value is no longer
  the one the check compared against, or the field's hash is no longer one the check read under (the customer
  changed something meanwhile) — the next check tries again;
- each differing page's expected value becomes the new one — for an availability field `In stock` / `Out of
  stock`, for another boolean `Yes` / `No`, otherwise the value as a run writes it. **Marks and confirmed paths
  are kept** (the path is the same; dropping a mark could weaken a field whose certification needs it) — the one
  difference from the customer's "Accept new values";
- the field's hold gets the new hash in `field_hashes`; a field that was current gets a hold made from its
  current result, with both hashes — so it stays certified through the change;
- one `value_refreshes` row: website, field, the check, each page's `was` / `now` / path, the old and new hash
  (and, once it starts, the re-verify below).

Then a **free re-verify of the refreshed fields** starts (`onlyKeys`, `free: true`, origin `refresh`, on the
check's own captures — no page load, no Jev reading, no AI). If it passes, the fields are current again and
their holds go; if not, the holds stay and the website keeps running. A refresh-started Verify never starts
another check, so a refresh can never loop.

Never AI; never a value from another element, of the wrong type, not shown on the page, or out of range; never
a field outside the by-nature list; never a field the customer has changed since its last pass (the hash rule).

### 3.3 The checks, and the schedule

There is one check, the drift check, with four triggers (`drift_checks.trigger`):

| Trigger | Started by | Fields it reads | Pages |
|---|---|---|---|
| `run` | a run that flagged drift (today) | the drifted fields (today) | fresh proof-page captures |
| `manual` | `sources.checkDrift` (today) | the drifted fields (today) | fresh proof-page captures |
| `verify` | a Verify that left a field held (§3.1), unless it was refresh-started | the held fields | that Verify's own captures — no page load |
| `schedule` | the scheduler (below) | every field with certified paths | fresh proof-page captures |

Every trigger classifies as today and, in addition, stores per field what a run would write on each page
(`reads`) and the refresh decision (`refresh: { applied, reason? }`), then applies the refreshes (§3.2). The
check's results keep the captures it read (`captures`, url → capture ref), which the re-verify reuses.

**The schedule.** A website is checked **every 3 days** (`WEBSITE_CHECK_DAYS`, default 3) — "a few days":
often enough that a moved price is caught before most customers' next run, rare enough that a website's proof
pages are loaded about ten times a month. There is no scheduler, job table or queue today, so this adds the
smallest one: an in-process timer in the api-server (`startWebsiteChecks`, `packages/api-server/src/index.ts`),
which every hour (first sweep 10 minutes after start) claims up to six due websites, one at a time:
- a website is due when `sources.next_check_at` is null or past and it has a completed clean Verify. The claim
  is one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING id` that moves `next_check_at`
  three days on — so two api-servers on one database (Marko's :4000 and an isolated :4100) never check the same
  website twice;
- every completed Verify and every finished check also moves `next_check_at` three days on (the pages were
  just read);
- skipped (and retried an hour later) while a Verify is in flight, a run is extracting or a check is running;
  skipped for three days when the website is not certified (nothing to keep running);
- the check runs, awaited, then — when the website has a listing page — the coverage check (§3.4), awaited;
- `WEBSITE_CHECKS=off` turns the timer off (the isolated smoke pair sets it; tests never start it).

All of it is free: page loads in the three proof-page slots the Verification tab already uses, code only, no
Jev reading (`jev: false` as today), no AI.

### 3.4 A new page shape

A partly rolled-out redesign shows up in two places, and both already have an answer:
- **On sampled listing products** — the coverage check groups the products where a field came back empty by
  page shape and offers "Use as proof page" (`coverage-summary.ts`). Today it only runs after a passing Verify
  and only with a current certification; now it also runs after every scheduled check, and reads with the held
  certification too (it calls `loadCurrentCertification`, which now includes holds). Nothing else changes in it.
- **On a proof page itself** — the field's paths read on some proof pages and nothing on another. The
  classification says `lost`, and its row today says "Not found on the page — Mark it again" with every page's
  value `null`. Now the row names the products where nothing was read: "Not found on product 2 — Mark it
  again" (from `reads`), and the field stays held because it still extracts elsewhere (§3.1). Such a field is
  never refreshed (§3.2 condition 3).

### 3.5 What needs the customer

A website **needs attention** when any of these is true (`websiteAttention`, server side):
- a field is held;
- the newest finished check found, for a field, `moved`, `lost`, or `changed` that was not refreshed — counted
  for a held field whatever the check's age, for a current field only when the check is newer than the latest
  Verify;
- the newest finished check found a proof page gone.

`fields` lists those fields in contract order; `goneProducts` the gone pages' product numbers; `heldSince` the
oldest held field's `verified_at`; `findings` each listed field's check result (the drift rows read it).

## 4. Changes

**`@robot/db`** — migration `0019_websites_change`:
- `field_holds` (id, source_id → sources cascade, field_key, result jsonb, verification_id →
  source_verifications set null, verified_at, failed_verification_id → source_verifications set null,
  field_hashes jsonb default `[]`, created_at, updated_at; unique (source_id, field_key));
- `value_refreshes` (id, source_id → sources cascade, field_key, at, drift_check_id → drift_checks set null,
  verification_id → source_verifications set null — the re-verify it started, pages jsonb — url → `was`,
  `now`, `path`, from_hash, to_hash; index (source_id, at));
- `drift_checks.trigger` varchar(12) not null default `'run'`;
- `sources.next_check_at` timestamptz.

**`@robot/scraper`** — `verify/refresh.ts`: `CHANGES_BY_NATURE`, `changesByNature`, `REFRESH_MAX_FACTOR`,
`planRefresh`, `refreshedText`. `drift-classify.ts`'s types gain `DriftFieldResult.reads` and `.refresh`, and
`DriftCheckResults.trigger`, `.keys`, `.captures`. `classifyDrift` itself is unchanged.

**`@robot/api`**:
- `verify/holds.ts` (new): loading holds (one website, a batch), `readingsOf` (what a run writes, per page,
  from given paths on given captures), `stillExtracts`, `decideHolds`, `writeHolds`, `backfillHolds` (the same
  rule applied to a website's latest completed Verify after the fact — used once, for the ten websites, §8);
- `verify/current-certification.ts`: `resultPasses`, `FieldCurrency.heldKeys` / `.held`, `certifyingResult`;
  `loadCertificationState` and the batch read count holds; `Certification.held`;
- `verify/run-source-verification.ts`: the hold rule in one transaction (§3.1); options `captureRefs`
  (captures to use first) and `origin` (`'customer' | 'refresh'`); sets `next_check_at`; starts the `verify`
  check;
- `verify/check-schedule.ts` (new): `websiteCheckDays`, `nextCheckAt`;
- `verify/run-drift-check.ts`: `trigger` and `keys`; `reads`, `captures`, refreshes; `storedCaptures` (a
  capture function over capture refs, no page load); sets `next_check_at`;
- `verify/refresh-values.ts` (new): `applyRefreshes`, `startRefreshVerify`;
- `verify/website-checks.ts` (new): `claimDueWebsite`, `checkWebsite`, `runDueWebsiteChecks`,
  `startWebsiteChecks`; exported as `@robot/api/website-checks`;
- `verify/attention.ts` (new): `websiteAttention`, `latestRefreshes`;
- routers: `sources.attention` (new query), `sources.get.needsAttention`, `projects.get` websites'
  `needsAttention`, `sources.verificationStatus.heldKeys` / `.held` / `.runnable`, `ops.websites[].held`,
  `ops.website` field state `'held'` (paths from the hold) with `heldSince`, and `ops.website.refreshes`;
- `test-helpers/seed-attention.ts` (new, for the route smoke).

**`@robot/api-server`** — `src/index.ts` starts `startWebsiteChecks()` after `serve`.

**`@robot/app`**:
- `lib/site/attention-view.ts` (new): `websiteBadge`, `attentionBanner`, `heldWord`, `refreshLine`,
  `extractHeldLine`;
- `lib/site/drift-view.ts`: `formatDMMM` exported; a `lost` row names the products that read nothing;
- `lib/websites-view.ts`, `components/site/site-header.tsx`, the site layout: the badge from `websiteBadge`;
- the Verification route: the banner falls back to `attentionBanner`; the drift rows read `attention.findings`
  when nothing is drifted; a `refreshed` line under a refreshed row; the held row word;
- `components/verification/verification-table.tsx`: the `refreshed` line kind;
- the Extract tab and the verify bar: unlocked on `runnable` (not `current && allPassed`), the held line;
- ops: `lib/ops-view.ts` (`heldFlag`, `refreshOpsLines`, `refreshRefusalText`, `verifiedText` with held), the ops
  website page and overview.

## 5. What the customer sees (exact copy)

Dates are `d MMM` ("12 Oct"), as everywhere in the app. Products are numbered as their cards are.

| Where | When | Copy |
|---|---|---|
| Websites table row, website header | drifted fields (today) | `1 field stopped extracting` / `{n} fields stopped extracting` (unchanged) |
| same | otherwise, the website needs attention (§3.5) | `Needs attention` (warn colour) |
| Verification tab banner (`role="status"`) | drifted fields (today) | the drift banner, unchanged |
| same | otherwise, attention | `{Subject} — {tail}` (below) |
| A held field's Status cell, beside its badge | the field is held | `runs use what you verified on {d MMM}` |
| Under a refreshed field's row | its newest refresh still describes the field (`to_hash` = today's hash) | `Updated automatically on {d MMM}: {now} on product {n} (was {was})`, several pages joined with `; ` |
| Under a lost field's row | some proof pages read it, some do not | `Not found on product {n} — Mark it again` / `Not found on products {list} — Mark it again` |
| Extract tab, above the controls | the website runs with held fields | `{Fields} needs you on the Verification tab — runs go on with what you verified on {d MMM}.` (`need` for several) |

The banner: **Subject** joins, with "and", `{Fields} needs you` (`need` for more than one field; fields joined
"a, b and c") and `product {n} no longer loads` / `products {list} no longer load`, first letter capitalised.
**Tail**: `runs go on with what you verified on {d MMM}.` when the website is runnable and has a held field
(the oldest held field's date); `runs go on as before.` when it is runnable with no held field; `extraction
waits for you.` when it is not runnable. Examples: "Rating and Description need you — runs go on with what you
verified on 8 Oct." · "Product 2 no longer loads — runs go on with what you verified on 12 Oct." · "Price
needs you — extraction waits for you."

The existing rows stay as they are ("Page now shows X (was Y) — Accept new values", "Moved on the page — Accept
new location", "Product n no longer loads — Replace product n", "Product n could not be checked — …"). A
`changed` field that was refreshed shows no "Page now shows" row — the refreshed line replaces it. An
`other-layout` result from a check a run did not trigger shows no row (nothing to do). The Extract tab is
unlocked when the website is runnable (`verificationStatus.runnable`: every field current or held, and the
variants as today); its locked strip counts current and held fields as verified.

No customer copy names a path, a source, JSON, a check, a hold, a model, a schedule or money. No email: none
exists (§10).

## 6. What staff see

Automatic changes are not written to `staff_actions`: that log is "a person did this in staff mode", and the
customer reads it as "Robot staff activity" — an automatic refresh there would read as staff touching their
data. They are written to `value_refreshes`, which the customer sees as the refreshed line (§5) and staff see in
full on the ops website page:
- a held field's flag: `Held — runs use the paths verified {d MMM}`; its paths are the hold's (the ones runs
  use), with their real hit rates as today;
- an **Automatic updates** section, newest first, at most 50: `{d MMM} · {Field} · product {n}: {was} → {now}
  · {path kind} {path}`;
- per field a check did not refresh although its value changed (by-nature fields only):
  `Not updated automatically: {reason}`, reason words `a page reads nothing`, `fewer than two pages read`,
  `read from another place than verified`, `reads a fixed variant`, `the page does not show the new value`,
  `the new value is out of range`, and — when the refresh was planned but not written — `a Verify was
  running`, `the value was edited meanwhile`, `it could not be saved`;
- the overview's Verified cell: `{c} of {n} fields · {h} held` when some are held.

## 7. Safety properties

1. A check, a schedule, a refresh or a failed Verify never removes a certification from a field whose last good
   paths still read a value on a proof page; only the customer's own edits move a certification.
2. A field whose last good paths read nothing on every captured proof page is not held: runs wait for the
   customer (the Extract tab says which field).
3. A refresh changes only expected values of by-nature fields (§3.2 table), only on pages where the same
   certified path that passed there now reads a different, valid, in-range value the page shows, never through
   a fixed variant index, and only when every page with an expected value reads one.
4. A refresh never touches a field the customer changed since its last pass, never a cell whose stored value
   moved since the check read it, and never while a Verify is in flight.
5. No AI anywhere in this spec: refresh-started Verifies are `free`, checks construct no agent, and no Jev
   reading is taken (the check's captures use `jev: false`; re-verifies reuse captures).
6. A refresh-started Verify never starts a check, so refreshes cannot loop.
7. Two api-servers on one database never check the same website at once (`SKIP LOCKED` claim).
8. Every automatic change is recorded (`value_refreshes`) and visible to the customer (the refreshed line) and
   to staff (ops); customer copy names no internals and no money.

## 8. The ten websites

The read-only probe (2026-10-21) read each failing field's last good paths on the stored captures of its
2026-10-21 Verify. Applying §3.1–§3.2 to what it found (the replay task re-measures this, the apply task does
it on fresh pages):

| Website | Held (runs again) | Refreshed automatically | Needs the customer |
|---|---|---|---|
| Barnesandnoble | Rating, Description | — (Rating 4.5 → 4.6 is not shown on the page) | Rating, Description: "Accept new values" |
| Acne / Ikea | Total reviews, Average rating | Total reviews 149 → 150, 45 → 46, 62 → 64; Average rating 4.8 → 4.7 | Average rating if product 1 still reads "Several places match" |
| Madeincookware | Price, SKU | — (Price reads `offers[0]`, a fixed variant) | Price, SKU |
| Everlane | Price, In stock | — (`hasVariant[0]`) | Price, In stock |
| Mejuri | Price | Price 615 → 625, 435 → 440, 3250 → 3300 | — (current again if the re-verify passes) |
| Gymshark | Rating | Rating 4 → 4.2 on product 3 | — |
| Ridge | In stock | — (`hasVariant[0]`: every product reads out of stock, likely another variant) | In stock |
| Oliverbonas | Rating | — (not shown on the page) | Rating |
| Burrow | Price, Rating | — (Price `hasVariant[0]`; Rating not shown on product 1) | Price, Rating |
| Skullcandy | all 8 fields | — | product 2 (404): "Replace product 2" |

So all ten run again; two (Mejuri, Gymshark) and possibly Acne / Ikea become fully current; the rest say
exactly which field or product needs the customer. A fresh scheduled check may of course find the pages moved
again; the apply task records what it actually found.

## 9. Testing

- **Unit, `@robot/scraper`:** `planRefresh` — every condition of §3.2 alone (by nature / not; one page differs;
  all differ; a page reads nothing; one page read; another path than the one that passed; a `hasVariant[0]`
  path; `shown: false`; rating above scale; price ×6; review count fractional; boolean availability text);
  `refreshedText`.
- **DB-backed, `@robot/api`:** holds in currency (a held field counts, a changed hash ends it, a refresh hash
  keeps it, the batch read agrees); Verify keeps, creates, ends and refuses holds in one transaction, and starts
  the `verify` check (not for a refresh-origin Verify); `backfillHolds`; the check stores `reads`/`captures`,
  refreshes a by-nature field and starts a free re-verify, refuses each unsafe case, never touches a
  non-by-nature field, skips while a Verify is in flight or the stored value moved; `storedCaptures` loads no
  page; the scheduler claims once across two concurrent claimers, skips in-flight websites, runs check then
  coverage, honours `WEBSITE_CHECKS=off`; `websiteAttention` and `latestRefreshes`; the routers' new fields.
  Captures are injected (the shop-example pages); a spy agent proves no model is constructed.
- **Unit, `@robot/app`:** every copy function in §5 and §6, the `lost` row's product list, the badge order.
- **Route smoke** (isolated pair, `WEBSITE_CHECKS=off`): a seeded hold, refresh and scheduled check on the
  smoke's website show "Needs attention" on the project home, the banner, the held row word, the refreshed
  line, and `verificationStatus.runnable` true; one screenshot, `docs/testing/screens/app-site-verification-attention.png`.
- **Replay of the ten websites, read-only:** a script reads each website's latest Verify's stored captures and
  its fields' last good results, runs `decideHolds`' reading and `planRefresh` in memory and writes
  `docs/testing/results/2026-10-21-websites-change/replay.md` (+ `.json`): before (runnable: no) and after
  (held, refreshed, needs the customer) per website. No database write, no page load, no AI.
- **Applying it to the ten websites** (the last task; approved as part of this item): `pg_dump` first; then
  `backfillHolds` and one scheduled check each (fresh pages, keyless, `JEV_SHADOW` empty), one at a time;
  before/after recorded in `docs/testing/results/2026-10-21-websites-change/apply.md`. Done when each of the
  ten is runnable or its attention lists exactly what the customer must do.

## 10. Not in this spec

- **Email or any notice outside the app** — no email system exists; the notice is the badge and the banner.
- **Holds for variants** — variants still certify from the latest clean run; none of the ten has variants.
- **Backfilling holds on other websites** — only the ten (Marko's approval covers them); others (e.g. Decathlon,
  Lookfantastic, left failing on 2026-10-10) get holds at their next failed Verify, or by Marko's decision.
- **Undoing a refresh** — the customer can type the old value back; there is no undo button.
- **Turning automatic updates off per website** — not offered.
- **A project-list or org-level count** of websites needing attention.
- **Copy of the existing drift rows** (e.g. a boolean shown as `http://schema.org/OutOfStock`) — unchanged.
- **Run speed / a real job queue** — the timer is in-process, per api-server, as small as possible.

## 11. Open for Marko

1. The schedule is on by default (`WEBSITE_CHECKS` unset = on). Marko's own api-server starts checking every
   certified website every three days the next time he restarts it (free: proof pages and twenty listing
   products each, no Jev, no AI). `WEBSITE_CHECKS=off` in `.env` keeps it off.
2. Whether holds should be backfilled for the other websites whose last Verify failed on stale values.
3. Whether a field the customer names (a custom field) can be marked "changes by nature" too.
