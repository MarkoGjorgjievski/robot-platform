# Honest page verdicts, and "agreed" means "shown on the page" — design

**Status:** designed 2026-10-09 from the credit campaign's findings
(`docs/testing/2026-10-08-credit-campaign.md`, "What the campaign answered", items 1 and 3
of the next work). Code mapping behind it: every claim below about today's code was read in
the files named. Plan follows.

## Why

On 2026-10-08, eleven of sixteen real websites refused or limited the browser at some point,
and the product reported none of it as what it was. A Cloudflare 403 read "No product links
found on this page. Paste product pages below." A blank refused page read `ready` with a green
rail. A run whose listing hit a CAPTCHA ended as a green "Done" with 0 rows. "Find products"
counted 16 menu pages on a site the browser could not load, and 66 "products" on a 404 page.
A customer seeing any of these concludes the product is broken, when the site refused us.

Separately, six websites offered "agreed" suggestions that were wrong, and "Accept all agreed"
would have certified them: Allbirds' JSON-LD description no page shows, Nike's other-colour
Title from an API, Decathlon's SKU "5 / 2 / 5", the site name as Title on Made In. All of them
went through one hole: the agreement rule counts a structured value that **no element on the
page shows** as "one place", on purpose (spec 2026-09-28 §A2: "a single box, *or page data with
no box*"), while the single-cell tick already refuses the same case.

Two rules fix both: **a page capture carries one honest verdict, and every consumer shows it**;
and **a suggestion agrees only when some element on the product's page shows its value**.

## What exists today (so the design can be checked against it)

- `capture()` (`packages/browser/src/playwright-browser.ts:192-316`) returns a `PageCapture`
  (`types.ts:40-60`) with html, tiles, title, structured data, intercepted requests, timings,
  and the **final** url. It never reads the main response: `navigateWithFallback` (466-492)
  discards `page.goto`'s `Response`, so no HTTP status or headers exist anywhere. Any `goto`
  throw other than a networkidle timeout propagates raw; "Target crashed" is not handled.
- `checkPageHealth` (`page-health.ts`) recognises 403/401/404/429/503/502 **strings** in the
  title or first 2,000 characters, CAPTCHA and bot-wall phrases (Cloudflare, PerimeterX,
  DataDome, "verify you are human", "access denied"), soft 404s, and near-empty pages. It is
  **not** called by `capture()`; five consumers call it themselves, and `sources.checkListingPage`
  (`routers/sources.ts:652-662`, the finder) does not call it at all. No AWS WAF or Akamai pattern.
- Proof pages (`api/verify/proof-page-capture.ts`) go `capturing | captured | failed`; the
  card (`product-card.tsx:45,76`) prints `ready` with a green rail on `captured`. A capture that
  passed the health check but has no boxes and white tiles is `captured`.
- Runs: when every input fails to plan, `plan-source.ts:181-206` sets `status = failed` with
  `errorMessage = "planning failed for all N input(s)"`; the real reason lives only in
  `runs.logs`. Then `crawl.execute` calls `markRunExtracting` (`mark-extracting.ts:44`), which
  flips **any** non-cancelling status to `extracting`, `executeRun` finds no items, and
  `rollUpStatus` (`roll-up-run.ts:48`) returns `completed` for zero items. That is the green
  "Done" with 0 rows, live in `docs/testing/results/campaign-2026-10/article.md`.
- `domain-lock.ts` spaces requests to one host by a flat 2 s. Nothing reacts to a block;
  there is no backoff anywhere.
- `rowStatus` (`verification-model.ts:424-480`) calls `placesOf` per product and guards only
  `places > 1`; `places === 0` falls through to "offered" and the row becomes `agreed`.
  `cellAcceptable` (531) refuses `places !== 1`. The server (`suggest-marks.ts:80-81`) already
  reports `boxes: []` when no element shows the value, so the client has the signal.
- Add website (`createInProject`, `sources.ts:360-403`) is pure database work; the first
  network request to a new website happens on Find products.

## Part A — one verdict per capture

### A1. The verdict

`PageCapture` gains a required `verdict`:

```ts
type CaptureVerdict =
  | { kind: 'ok'; status: number }
  | { kind: 'refused'; status: number; vendor?: WallVendor }          // 401/403/405/429/5xx, or a wall page served with 200
  | { kind: 'challenge'; status: number; vendor?: WallVendor }        // CAPTCHA / "Just a moment" / "Press & hold" / "Verify you are human"
  | { kind: 'not-found'; status: number }                             // 404, or a soft 404 by title/body
  | { kind: 'redirected'; status: number; to: string }                // final host differs from the requested host
  | { kind: 'blank'; status: number }                                 // a document arrived but it shows nothing: under the content threshold and no clickable boxes
  ;
type WallVendor = 'cloudflare' | 'akamai' | 'perimeterx' | 'datadome' | 'aws-waf' | 'unknown';
```

Decided **once, inside `capture()`**, from three inputs in this order: the main response
(`page.goto`'s `Response`: status, `server`/`cf-ray`/`x-amzn-waf-action`/`akamai-*` headers),
the final URL against the requested one, and `checkPageHealth` over title and HTML (extended
with AWS WAF — "Let's confirm you are human", title "Human Verification" — and Akamai —
"Access Denied" with `AkamaiGHost`/`Reference #`). `blank` is decided last, only for a 200
with neither wall text nor substantial content: visible text under the existing
`SUBSTANTIAL_CONTENT_CHARS` and, when the capture was annotated, zero pointable boxes.

`capture()` **resolves** whenever a document was received, wall or not, with the verdict set
and the html/tiles it got; callers no longer have to call the health check. It **rejects**
only when no document arrived, with a `CaptureError` carrying
`{ kind: 'crashed' | 'unreachable' | 'timeout'; message }`: `crashed` for
"Target crashed"/"Page crashed", `unreachable` for DNS and connection errors, `timeout` for a
navigation that never got a response. `checkPageHealth` stays as the classifier `capture()`
calls; its string table grows; its own callers switch to `capture.verdict` (five sites, listed
in the plan) so there is one truth.

Each verdict has one customer sentence, in one module (`packages/browser/src/verdict-copy.ts`,
pure, tested), so every surface says the same thing:

| kind | sentence (host filled in) |
|---|---|
| refused | "{host} refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet." |
| challenge | "{host} asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check." |
| not-found | "That page doesn't exist on {host} (404). Check the address." |
| redirected | "That address led to {to}. Paste a page on {host}." |
| blank | "{host} sent an empty page. Try again." |
| crashed | "The browser crashed on this page. It will be retried." |
| unreachable | "{host} could not be reached (no response)." |
| timeout | "{host} did not answer in time." |

### A2. Consumers

**The finder** (`checkListingPage` → `describeListingPage`). A capture whose verdict is not
`ok` returns `{ verdict, productLinks: 0, pagerSeen: false, products: [] }` and the listing
bar shows the verdict's sentence instead of "No product links found…". Only an `ok` capture
with zero links keeps today's "No product links found on this page. Paste product pages
below." The reported count can therefore never come from a wall or a 404 page.

**Proof pages.** `ProofPageMeta` keeps `captured | failed`; `failed` gains `verdict?` beside
`error`, and `captured` is only ever an `ok` capture. A `blank` capture is `failed` with the
blank sentence. The card's footer shows the verdict's sentence (amber rail, Try again), and
the field rows say "screenshot refused on product n" / "human check on product n" instead of
"screenshot failed on product n" where the verdict is known.

**Runs.** Three changes, each small:

1. `plan-source.ts`: when every input fails, `errorMessage` is the first input's verdict
   sentence (or its error message), not "planning failed for all N input(s)"; the count moves
   to the log line.
2. `mark-extracting.ts`: a run moves to `extracting` only from `planned`, `partial` or
   `paused`-like states that have items to run. A `failed` run with no items is refused by
   `crawl.execute` with the run's `errorMessage` as the error ("This run failed while
   planning: …"), so a click on Extract cannot turn a failure green.
3. `roll-up-run.ts`: zero items and a non-null `errorMessage` roll up to `failed`, never
   `completed`.

The run page shows a 0-row run's `errorMessage` as the headline under the status, whatever the
status. The Sample panel stops saying "Sample rows complete 0 of 0" when rows were extracted
(it shows the extracted count) and omits "Pagination detected: not reported" when the walk did
not look.

**Reachability on Add website.** A new free query `sources.reachability({ url })`: one
capture of the given page with the app's own browser (stealth profile, `waitUntil: 'load'`,
no annotation, no storage), returning `{ verdict, finalUrl, status, ms }`. The Add website
dialog fires it after `createInProject` resolves and shows one line on the landing
Verification tab, under the listing bar, until Find products runs: "Reached {host} (HTTP 200)"
in muted text, or the verdict's sentence in warning text with the same Try again. Nothing is
stored; the campaign's pre-screen used bare Playwright and undercounted, so this check is also
how the real wall rate gets measured from now on (ops can read it off the verification notes
later; storing it is a follow-up).

### A3. Per-host backoff

`domain-lock.ts` gains host state: `reportVerdict(host, kind)`. A `challenge` or `refused`
verdict puts the host into backoff: the next request to it waits 2 minutes, doubling on each
further challenge to a cap of 8 minutes; an `ok` verdict clears it. A request that arrives
during backoff **waits** (the lock already queues); it does not fail. `capture()` callers in
the finder, proof-page capture and the run planner/executor report their verdicts. The waiting
is visible: the proof card says "waiting for {host} after a human check (n min)", the run log
gets one line per wait.

## Part B — agreed means shown

### B1. The rule

In `rowStatus`, a product whose suggestion has **zero pointable boxes** (`placesOf === 0`) is
no longer "offered". It becomes the row's reason, with this precedence after "missing on
product n" and before "found in n places": **"only in the page data on product n"**. The row
is `needs-you`; the expanded row's existing hint ("page data: ‹value› ✓ ×") is how the
customer accepts it, one cell at a time, after looking. `Accept` and `Accept all agreed` never
touch such a row, as they never touch `needs-you` today. `same-everywhere` and `majority` keep
their rules, applied after this one.

A suggestion carried from another product (`origin: 'from-product'`) with no box on this
product is the same case: it is a transferred path whose value this page does not show.

### B2. Why this is the right cut

The design says the customer verifies values the *page shows*; certification corroborates
against the rendered page (`corroborate-value.ts`). A value present only in the page's data
can be correct (Allbirds' real SKUs) or wrong (Allbirds' description), and nothing in the row
can tell which. So it needs a person, which is what `needs-you` means. The single-cell tick
already behaves this way (`cellAcceptable`); the row now agrees with it.

### B3. Proof-page coverage (not in this spec)

Lookfantastic's and Decathlon's misses (multi-size offers, no-rating products) need proof
pages that cover the site's variations: a check after the three captures that compares offer
counts and variant selectors and offers "add a product with several sizes as product 4". That
is the second-layout proof-pages design with live cases, and gets its own spec next.

## Files

- `packages/browser/src/types.ts`, `playwright-browser.ts`, `page-health.ts`, new
  `verdict-copy.ts` (+ tests for the classifier and the copy)
- `packages/scraper/src/verify/capture-check.ts` (reads `verdict`), `domain-lock.ts` (backoff
  + tests), `crawl/plan-run.ts` (reports verdicts; carries the listing verdict into the input
  error), `analysis-orchestrator.ts`, `extraction-orchestrator.ts`, `pipeline.ts` (switch from
  `checkPageHealth` to `capture.verdict`)
- `packages/api/src/routers/sources.ts` (`checkListingPage` returns the verdict; new
  `reachability`), `verify/find-product-pages.ts`, `verify/proof-page-capture.ts`,
  `crawl/plan-source.ts`, `crawl/mark-extracting.ts`, `crawl/roll-up-run.ts`,
  `routers/crawl.ts` (`execute` refuses a failed run)
- `packages/app/src/components/verification/listing-bar.tsx`, `product-card.tsx`,
  `components/project/add-website-dialog.tsx`, `lib/site/use-proof-captures.ts`,
  `lib/site/verification-view.ts` (the "screenshot refused" row words),
  `lib/site/extract-view.ts`, `routes/…/runs/$run.tsx`, the site route (reachability line)
- `packages/app/src/lib/site/verification-model.ts` + test (B1)
- Specs amended: `2026-09-28-table-first-and-drift-repair-design.md` §A2 (drop "or page data
  with no box"); `2026-09-29-certification-picks-the-right-path-design.md` §A5 (the zero-box
  case named)

Not touched: certification, autosave, the extraction chain's path logic, the database schema.

## Testing

- **Unit, free:** the classifier (`page-health` + headers → verdict) on a fixture set: real
  Cloudflare 403 and challenge pages, an AWS WAF "Let's confirm you are human" page, an Akamai
  "Access Denied", a 404, a soft 404, a blank 200, a cross-host redirect, a healthy page;
  `verdict-copy` sentences; `domain-lock` backoff timing with a fake clock (2 → 4 → 8 min cap,
  clear on ok, waits not failures); `rowStatus` with boxless suggestions (one product boxless →
  needs-you with the new reason; all boxless → needs-you; mixed with a majority → the boxless
  reason wins over "comes from different places"); the existing `'page data with no element
  counts as one place'` test asserts the opposite; `rollUpStatus` zero-items-with-error →
  failed; `markRunExtracting` refuses a failed run.
- **Route smoke, free:** the local shop gains a `/blocked` listing that answers 403 with a
  Cloudflare-shaped body and a `/captcha` page with "Verify you are human": Find products on
  each shows the exact sentence; a proof page on `/captcha` shows the amber card with the
  sentence; Add website on `http://127.0.0.1:…/blocked` shows the refused line.
- **Live, free, after merge:** Find products on scan.co.uk, hobbycraft.co.uk and otto.de
  (the campaign's walls) says refused/challenge in under 10 s; article.com's Sample followed
  by Extract either succeeds or ends `failed` with the challenge sentence, never "Done" with
  0 rows; Allbirds' Verification tab shows Description as "only in the page data on product
  2" and not agreed.

## Acceptance

- No surface can report a count, `ready`, or `completed` from a page the site refused,
  challenged, 404'd, redirected off-host or sent blank.
- The same event reads the same sentence in the listing bar, the proof card, the run page and
  the Add website line.
- A second request to a host that just challenged us waits at least 2 minutes.
- A row with a structured suggestion no element shows is never `agreed`; the customer can
  still accept it from the page-data hint, cell by cell.
- `pnpm --filter @robot/browser test`, `@robot/scraper`, `@robot/api`, `@robot/app` unit
  gates and the route smoke pass; no model call anywhere.

## Decisions taken

1. The verdict is decided inside `capture()`, once; consumers read it. (Alternative rejected:
   keep per-consumer health checks and add the finder's — leaves the next consumer free to
   forget again.)
2. A wall page is a resolved capture with a verdict, not an exception; only "no document"
   rejects.
3. Backoff waits rather than fails, and is per host, in the existing lock.
4. Reachability is checked on Add website and shown, not stored (storing is a follow-up).
5. A boxless suggestion makes the row `needs-you`, accepted cell by cell from the page-data
   hint; no new "Accept from page data" row action.
6. Proof-page coverage is a separate spec.
