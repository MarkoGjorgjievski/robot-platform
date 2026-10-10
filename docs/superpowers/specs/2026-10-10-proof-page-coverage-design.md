# Proof-page coverage of a site's variations, and "not on this product" — design

**Status:** implemented on `feat/proof-page-coverage`, 2026-10-10; live check in
`docs/testing/results/2026-10-10-proof-page-coverage-live-check.md`.

**Deviations:**
- Singular copy forms for one empty or one sampled product ("it lists its sizes as variants…",
  "1 field was empty on some of the 1 sampled product"), beside the plural forms this spec gives.
- `planned` on the `coverage_checks.results` row, so the running stage line can count the sample
  before the first page is read, instead of showing nothing until the first result lands.
- A stalled check (`running` for more than ten minutes) shows no stage line at all, rather than
  a stage line describing a dead run.
- The table's `started_at` is `coverage_checks.created_at` — no separate column.
- The brief's explanation sentences ("all n list their sizes as variants in the page data", "n of
  n have no offer in the page data", "none of the n shows a rating in the page data", "none of the
  n describes itself as a product in the page data") replace this spec's §A5 table's "none of the
  n has an offer…" forms — the brief's wording is what shipped.
- The spec's separate row word "not on product n" (§5's copy table) was not built as a distinct
  label — an absent cell's own text ("not on this product") already says it; no extra row-level
  word was added.
- The route smoke seeds the verified baseline and runs the coverage-check job directly
  (`test-helpers/seed-coverage-check.ts`) instead of clicking Verify, so the smoke never spends
  and never depends on a live capture; the live check in this document is what actually clicked
  Verify against real sites.

Builds on `2026-09-17-second-layout-proof-pages-design.md` (three to six proof
pages, the cover rule, "Use as proof page" on the run page) and follows
`2026-10-09-honest-page-verdicts-design.md` (one verdict per capture, per-host backoff).

## 1. The problem

The campaign of 2026-10-08 (`docs/testing/2026-10-08-credit-campaign.md`) verified nine
websites 8 of 8 with no model call, then extracted at scale. Two of them were wrong in a way
Verify could not see:

- **Lookfantastic.** All three proof pages were single-size products, so `offers[0].price` and
  `offers[0].availability` read "verified 3/3". 58% of the listing is multi-size products whose
  page data is a `ProductGroup` with `hasVariant` and no top-level `offers`. Price and In stock
  came back empty on 29 of 50 rows. The run page's "Use as proof page" is the right repair, but
  it came after a 24-minute run, and nothing at setup said the proof pages covered one shape.
- **Decathlon.** The certified Rating paths were the JSON-LD rating first and an api fallback
  `stats.averageRating` second. Products with no rating have no JSON-LD rating, so the fallback
  won and wrote `0` on five of forty rows. Proof page 4 was such a product, but a field with no
  expected value on a page is simply not checked there, so the fallback was never seen to be wrong.

Two gaps, then: the customer learns about a variation only after a run, and a proof page where a
field is absent proves nothing.

## 2. What changes, in one paragraph

After every passing Verify, the api-server runs a free background **coverage check**: it samples
twenty products from the website's listing page, runs the certified paths on each, and records per
field the sampled pages where every certified path came back empty, with a small shape signature
per page. The Verification tab shows the result under each affected row — "Empty on 11 of 20
sampled products · all 11 list their sizes as variants in the page data" — with "Use as proof
page", the gesture the run page already offers. It informs; it never blocks Extract. Separately,
a cell can now be marked **"Not on this product"**: that page joins the field's checked pages, a
path that produces any value there is unsafe, and the Decathlon fallback can no longer certify.

## 3. Part A — the coverage check

### A1. When it runs

At the end of a passing Verify (`run-source-verification.ts`, where the drift flags are cleared),
fire-and-forget, the way `runDriftCheck` is started: the caller never awaits it, it never rejects,
and it always leaves its row terminal. One check per website at a time; a `running` row older
than ten minutes is a crash leftover and is closed `failed` / `stalled` (the drift check's stall
rule). A new passing Verify starts a new check and the tab shows the newest. The check does not
run on a listing change, on Extract, or on a schedule (D4).

A website with no listing page (`verificationSet.listing_url` unset — product pages pasted by
hand) gets no check; the tab says nothing.

### A2. The sample

The listing page is captured once with the finder's options (`checkListingPage`'s capture) and
its product links grouped with `largestProductGroup` (the same grouping the finder and the listing
walk use). From that group, in listing order, the proof pages are dropped and **twenty** URLs are
taken spread evenly (every k-th link, k = floor(n / 20), first link first), so colourways and
sponsored strips at the top of a listing do not fill the sample (D1). Fewer than twenty links
means all of them. A listing whose capture verdict is not `ok` ends the check `failed` with the
verdict sentence as its error (the listing bar already shows the same sentence).

### A3. What is read per page

Each sampled page is captured under the domain lock in the proof-page captures' shared three
slots (`runProofPageCaptureInSlot`'s limiter, so the tab's captures and the check together never
exceed three browsers), with `runVerifiedExtraction` and the website's current certification —
certified paths only, no model, no cache write. Recorded per page:

- `url`
- `empty: string[]` — the field keys whose every certified path resolved to nothing
- `shape` — read from the capture's structured data, not from the DOM:
  - `jsonLdTypes: string[]` (the `@type`s of the page's Product-like JSON-LD blocks)
  - `offers: 'top-level' | 'in-variants' | 'none'`
  - `rating: boolean` (an aggregate rating is present in JSON-LD or an intercepted API)
  - `address: string` (the URL's path with digit runs replaced by `n`, plus its query keys)
- a page the site refused, challenged, 404'd, redirected off-host or sent blank is recorded as
  `unread` with its verdict sentence and takes no part in the counts; three walls in a row stop
  the check (the run breaker's rule) and the row ends `done` with the pages it has

The proof pages' own shapes are computed the same way from their latest proof-page captures, so
the explanation in A5 can say what the sample has that the proof pages lack.

`runVerifiedExtraction` already reports each verdict to the host's backoff and throws
`CaptureProblemError` on a non-ok verdict (fix wave C1, 2026-10-09); the check catches that per
page. Path hit/miss stats are **not** recorded from the check: it is a reading, not a run.

### A4. Storage

New table `coverage_checks` (migration `0017_coverage_checks.sql`), one row per check:

| column | type | meaning |
|---|---|---|
| `id` | uuid | |
| `source_id` | uuid → sources, cascade | the website |
| `verification_id` | uuid → source_verifications, set null | the Verify it followed |
| `started_at`, `completed_at` | timestamptz | |
| `status` | text | `running` / `done` / `failed` |
| `results` | jsonb | `{ sampled: SampledPage[]; proofShapes: Record<url, Shape>; listingUrl: string }` |
| `error` | text | the verdict sentence or `stalled` |

The check writes this row and nothing else: no `captures` rows (the sampled captures are not
kept), no `verificationSet`, no `sources` column, no domain cache, no path stats. "Use as proof
page" (A5) goes through the Verification tab's existing add-card path and writes what that writes.

### A5. What the Verification tab shows

Query `sources.coverage({ sourceId })` returns the newest check: status, and per field
`{ empty: url[]; sampled: number; unread: number; explanation: string | null; representative: url | null }`,
derived in a pure module (`packages/api/src/verify/coverage-summary.ts`) from the row.

- **Running:** the verify bar's stage line reads "Checking 20 more products from the listing…"
  (the number is the sample size actually taken).
- **Done, nothing empty:** the stage line reads "Checked 20 more products from the listing:
  every field was found on all of them." Unread pages add "(3 could not be read)".
- **Done, a field has empties:** a line under that field's row, in the slot the drift repair line
  uses (`verification-table.tsx`): "Empty on 11 of 20 sampled products · all 11 list their sizes
  as variants in the page data" and the action **Use as proof page**. The stage line reads "2
  fields were empty on some of the 20 sampled products — see the rows."
- **Failed:** the stage line reads the error sentence (a wall on the listing reads exactly what
  the listing bar reads) with no further action; the next Verify tries again.

**The explanation** is one of a fixed vocabulary, chosen when at least four of five of a field's
empty pages share a shape feature that none of the proof pages has (so the sentence is about the
difference, not a coincidence); otherwise the count stands alone:

| feature | sentence |
|---|---|
| `offers === 'in-variants'` | "all n list their sizes as variants in the page data" |
| `offers === 'none'` | "none of the n has an offer in the page data" |
| `rating === false` | "none of the n shows a rating in the page data" |
| `jsonLdTypes` lacks `Product` | "none of the n describes itself as a product in the page data" |
| same `address` pattern | "all n have addresses like /p/n/variation" |

With "all n" when every empty page shares it and "n of m" otherwise (at least 80%).

**Use as proof page** takes the first empty page of the largest shape group (the
`representative`) and adds it as the next card, exactly as the run page's action does today
(the same route and the same add-card flow; a website at six proof pages shows "This website has
its six proof pages" instead of the action). The customer types the value — or marks the cell
"Not on this product" (Part B) — and verifies; the passing Verify runs a fresh check.

Go to Extract is never gated on coverage (D2). The Extract tab is unchanged.

## 4. Part B — "Not on this product"

### B1. The verification set

`VerificationSet` gains `absent?: Record<fieldKey, Record<url, true>>` beside `expected`. A cell
is one of: expected value, absent, or blank. `bindingProblems` enforces: a field may be absent on
any proof page, including the first three (D3), **as long as it has an expected value on at
least two pages** (the cover rule's own minimum: one path must be proven on two pages). A cell
cannot be both expected and absent; marking absent clears the expected value and any mark or
confirmed path on that cell, and typing a value clears absent. Blank keeps today's meaning, "not
checked here", and stays allowed only on pages four to six. Sets written before this change have
no `absent` and behave exactly as today.

### B2. Certification (`certify.ts`)

`checkedPages(urls, expected, absent)` returns the pages with an expected value **or** absent.
Evaluation on an absent page: a candidate is **correct** iff it resolves to nothing; a candidate
that resolves to any value there is **wrong**, so it is not safe and can never be certified,
whatever it gets right elsewhere. Cover and ranking are unchanged. A path correct on an absent
page counts that page as proven (it is proof the path knows when to say nothing).

`CellResult` on an absent page: `pass` with `found: ''` when nothing resolved; `fail` with a new
reason `found_unexpected` and `found: <value>` when the chosen paths produced a value. The Verify
count "n/m" counts absent pages as checked pages.

On Decathlon: Rating absent on the marketplace page → `stats.averageRating` yields `0` there →
wrong → unsafe → gone; the JSON-LD rating path yields nothing there → safe, proven on four pages
→ certifies alone. The five `0`s do not happen.

### B3. The Verification tab

- The cell detail bar and the cell context menu gain **Not on this product**; the cell then reads
  "not on this product" in muted text and its row word is "not on product n".
- The row status: a required field with no suggestion on product n today reads needs-you
  "missing on product n"; the action resolves it. A row with an absent cell and agreed values on
  the other pages is `agreed`.
- After Verify, a `found_unexpected` cell reads "found 0 on product 4, but you said it isn't
  there", and the row fails like any `different_value` row.
- Import values / the marks round-trip carry `absent` like `expected`.

### B4. Extraction

Unchanged. A field absent on a page extracts as empty, which is what the row already is.

## 5. Copy table

| where | reads |
|---|---|
| stage line, running | Checking 20 more products from the listing… |
| stage line, clean | Checked 20 more products from the listing: every field was found on all of them. |
| stage line, empties | 2 fields were empty on some of the 20 sampled products — see the rows. |
| stage line, failed | the verdict sentence (as the listing bar) |
| row line | Empty on 11 of 20 sampled products · all 11 list their sizes as variants in the page data |
| row line, no explanation | Empty on 3 of 20 sampled products |
| row line, at six pages | … · This website has its six proof pages |
| action | Use as proof page |
| cell action | Not on this product |
| cell | not on this product |
| row word | not on product 4 |
| verify fail | found 0 on product 4, but you said it isn't there |

## 6. Safety properties the tests must pin

1. The coverage check writes only its own `coverage_checks` row: no captures, no verification
   set, no path stats, no domain cache, no sources column (assert on a recording fake db).
2. The sampler never includes a proof page, spreads over the listing (first, every k-th), and
   takes at most twenty.
3. A sampled page with a non-ok verdict is `unread`, never `empty`; three walls in a row end the
   check `done` with what it has; a walled listing ends it `failed` with the verdict sentence.
4. The explanation appears only when ≥ 80% of a field's empties share a feature no proof page
   has; the representative is the first empty page of the largest group.
5. A candidate that yields any value on an absent page is never certified (Decathlon fixture:
   api `stats.averageRating = 0` vs JSON-LD rating absent → only the JSON-LD path certifies).
6. A field absent on all but one page cannot be saved (`bindingProblems`), and a one-layout
   website with no `absent` certifies byte-for-byte as today.
7. A stalled `running` check (> 10 min) is closed `failed` / `stalled` and a new check may start.

## 7. Testing

- **Unit, free:** `coverage-sampler` (property 2), `coverage-check` with a fake capture function
  (properties 1, 3, 7), `coverage-summary` (property 4, the copy), `certify` with absent pages
  (properties 5, 6), `bindingProblems`, the app's row-line and stage-line copy as pure functions,
  the cell state transitions in `verification-model.ts`.
- **Route smoke (`pnpm test:ui:app`):** the fixture shop gets one product of a second shape
  (`/p/9`: a `ProductGroup` with `hasVariant` and no top-level `offers`) in its listing. After
  Verify the Price row shows "Empty on 1 of n sampled products · …" and "Use as proof page" adds
  card 4; a cell marked "Not on this product" on card 4 reads so, saves, and the re-Verify passes.
- **Live, free:** a fresh Verify on Lookfantastic (open host) shows the multi-size line within
  about four minutes; on Decathlon, marking Rating absent on the marketplace proof page and
  verifying drops the api fallback from the certified paths (ops shows the paths).

## 8. Files

- `packages/db/src/schema.ts` (`coverageChecks`), `packages/db/drizzle/0017_coverage_checks.sql`
- `packages/scraper/src/verify/types.ts` (`VerificationSet.absent`, `FailReason` +
  `found_unexpected`), `verify/certify.ts` (`checkedPages` with absent; the absent evaluation),
  `verify/shape.ts` (new: the shape signature from a capture)
- `packages/api/src/verify/coverage-sampler.ts` (new), `verify/run-coverage-check.ts` (new,
  modelled on `run-drift-check.ts`), `verify/coverage-summary.ts` (new), `verify/binding-input.ts`
  (absent rules), `verify/run-source-verification.ts` (starts the check), `routers/sources.ts`
  (`coverage` query; `absent` on the binding input)
- `packages/app/src/lib/site/verification-model.ts` (absent cell state, row words),
  `lib/site/coverage-view.ts` (new: the copy), `components/verification/verification-table.tsx`
  (the row line), `verify-bar.tsx` (the stage line), `cell-detail-bar.tsx` and the cell context
  menu (the action), the site route (`coverage` query, the add-card flow reused), the smoke and
  its fixture shop

## 9. Not in this spec

- AI discovery of a second-layout path (the 2026-09-11 note's steps 2 and 3).
- Adding a proof page automatically, or blocking Extract on coverage.
- Running the check on a listing change, on Extract, or on a schedule.
- Storing the sampled captures, or using them as proof-page captures.
- Shape-based proof-page suggestions at setup (before the first Verify).

## 10. Decisions (taken as recommended, 2026-10-10)

- **D1** Sample size twenty, spread evenly over the listing; the proof pages excluded.
- **D2** The check informs; Go to Extract is never gated on it.
- **D3** A field may be absent on any proof page, including the first three, as long as it has
  an expected value on two pages.
- **D4** The check runs only after a passing Verify.
