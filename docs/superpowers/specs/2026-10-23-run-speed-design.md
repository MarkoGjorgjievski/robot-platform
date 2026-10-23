# Run speed: lean captures on certified runs, several websites at once — design

**Status:** written 2026-10-23 under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue item 1,
approved by Marko 2026-10-23). Plan: `docs/superpowers/plans/2026-10-23-run-speed.md`. Branch
`feat/run-speed` from `main` @ `9b89b72d`, worktree `C:\Users\Marko\Documents\projects\robot-platform-speed`.
Builds on `2026-10-07-run-speed-and-language-note.md` (levers 1 and 2) and
`2026-09-11-lean-capture-for-certified-runs-design.md` (items 2–4), and on the capture worker
(`2026-10-23-capture-worker-design.md`): every run is a `run` job in the `runs` lane of `@robot/worker`.

**Done when** (queue): a measured 1,000-page-equivalent run is an order of magnitude faster with the same
values.

## 1. What a certified run does today

### 1.1 The path

`run` job (`packages/api/src/jobs/handlers/run.ts`, lane `runs`, `WORKER_RUNS` 1) → `startExecution`
(`crawl/start-execution.ts`: one `withBrowserSession` per run, i.e. one Chromium and one context for the
whole run) → `executeRun` (`crawl/execute-run.ts`: one item at a time) → `extractItem` (`crawl/extract-item.ts`,
certified branch) → `runVerifiedExtraction` (`scraper/src/verify/verified-extraction.ts`) →
`captureUnderLock`: `acquireDomainLock(host)` → `browser.capture(url, { waitUntil: 'load', interceptNetworkRequests,
ready: buildReadyCheck(...), selection })` → `reportVerdict` → release. Then, after the lock is released,
`setContentEvaluate(capture.html, xpathProbe)` (a second context, the saved HTML parsed again, every request
aborted), `evaluatePath` per field, `applyDefaults`, `shownOnPage` on `pageTextOf(capture.html)`; back in
`extractItem`: `recordVerifiedPathStats`, one `captures` row (metadata `{ capture: timings }`) and one
`extractions` row; `markItemDone`.

A new page per item, in the run's one context (cookies carry over between items); the browser is launched
once per run attempt.

### 1.2 What `capture()` does, and who needs it

| Step (in order) | Today on a certified run | Needed by a certified run? |
|---|---|---|
| New page, network interception set up | yes | **yes** — certified `api` paths read intercepted JSON |
| `goto(url, load)` | yes | **yes** |
| Ready poll (XPath probe + structured data + JSON so far, every 250 ms, 8 s, then ≤10 s networkidle) | yes, right after `load` | **yes** — it is what makes a late value an honest miss, not a race |
| `dismissPopups` (1.5 s fixed settle, ≤4 rounds, 800 ms per click, 500 ms per Escape/removal) | yes | **no** for values — a popup does not change JSON-LD, meta or API bodies, and its text stays in the HTML when dismissal hides it. Kept on the full capture |
| `expandHiddenContent` ("show more", accordions, `<details>`; 500 ms per round that expanded something) | yes | **yes for XPath fields**: certified XPaths were proven on the post-expand DOM. Measured: without it a "Read more" description reads the truncated text — a *different value*, which no miss rule can catch (§3.1) |
| `returnIfNavigatedAway` | yes | **yes** (expand clicks can navigate) |
| Final dismissal pass, mouse park, scroll to top, centre-overlay warning | yes | **no** (they exist for the screenshot) |
| `annotate` | not passed | no |
| `page.content()`, `title`, `extractStructuredData`, `selection` → `pageVariant` | yes | **yes** — JSON-LD/meta paths, the `[page]` variant, the verdict (`classifyVerdict` reads html + title), the shown-on-page text |
| Screenshot tiles (sequential full-page PNGs) | yes | **no** — taken *after* `page.content()`, so dropping them cannot change a value |
| Readable content + markdown | yes | **no** — for Claude, which never runs on a certified website |
| Second render (`setContentEvaluate`) for the XPaths | yes | **no** — the same probe can run in the live tab |

What the run's consumers read: drift (`flagDrift`) reads the extraction rows' null shares; the drift check and
the coverage check take their own captures; the run page reads rows, `validationResult` (shown flags,
paths, defaulted) and nothing of the capture; list-method variants read `structuredData`/API bodies off the
capture; links-method variants read `capture.html` (a second render of the collector — left as is, §3.9).
No run consumer reads a screenshot or markdown.

### 1.3 Where the time goes (measured 2026-10-23, read-only)

**Local fixture, 8 product pages** (HTML 400 ms, CSS 300 ms, images 900 ms, API 500 ms; cookie modal on
half the pages; a "Read more" description on a third): `runVerifiedExtraction` today 3.6–4.6 s (median
4.5 s: navigate 1.3 s, popup settle and rounds 1.5–2.3 s, expand 0.5 s, pictures and markdown ~0.15 s,
second render ~0.2 s). Lean (navigate, ready, expand, probe in the live tab, structured data, content):
1.9–2.0 s. Same values on 8 of 8 pages. **Without the expand pass** the description differed on 2 of 6
pages ("…cut…" vs the full text) — the reason lean keeps it.

**Three of Marko's certified websites, 9 product pages** (Ikea, Gymshark, Skullcandy; certifications and
URLs read from the DB, no run created, no row written, one browser, free): today's extraction 8.1–13.6 s,
median 10.5 s (navigate 2.6–6.1 s; the popup rounds, expand, pictures and markdown the rest of the capture;
second render ~0.5 s). Lean 2.3–5.7 s, median 4.7 s (navigate 1.6–3.4 s, expand 0.6–2.7 s). Same values and
same shown flags on 9 of 9. Caveat: lean ran second on each page, so its navigation had the product's own
assets cached; the benchmark (§5) alternates the order.

**The politeness gap is paid on every product.** `acquireDomainLock` measures the 2 s spacing from the
previous *release* to the next *acquire*, and the lock is held for the whole capture, so after every
product the next one waits ~1.5–1.8 s (2 s minus the second render and row writes). The 2026-10-07 note
says the spacing "adds nothing while a product takes longer than 2 s" — that is the intent, not the code.
Today's per-product cost in a run is therefore ~10.5 s of extraction + ~1.7 s of gap ≈ 12 s on these
sites (Ikea's 10.5 s per product of 2026-09-15 includes the gap; its capture is faster).

**Our own code:** under 0.1 s per product (evaluation, rows, stats).

### 1.4 Concurrency today

One page at a time per host (the lock, in-process — the worker is one process). One run at a time
(`WORKER_RUNS` 1). The browser gate (`jobs/browser-gate.ts`): at most `WORKER_BROWSERS` (3) Chromium,
background and runs together at most `max − 1`, so one is always free for interactive work; launches wait
while free memory is under `WORKER_MIN_FREE_MB` (1024). Runs share the `max − 1` with the background lane
(Verify, drift, coverage, website checks): with more parallel runs, a Verify could wait for hours behind
them.

## 2. The targets

- **Same values**: every row a run writes — data, `validationResult.shown`, `paths`, `defaulted` — equal to
  what today's capture writes for the same page, proven on every fixture page and on real pages (§5).
- **Faster per website**: lean capture plus a politeness spacing that is the floor it was meant to be.
- **Several websites at once**: politeness is per host, so different websites in parallel break no promise
  to any site; interactive work and Verify always keep a browser.
- **No customer-visible change**: no screen, no copy, no amount. Measurement lives in `captures.metadata`
  and logs (staff/bench only).

## 3. Design

### 3.1 Lean capture (`@robot/browser`)

`CaptureOptions` gains three options; `capture()` stays the one method (no `IBrowser` change, so no fake
browser in any test changes):

- `pictures?: boolean` (default `true`). `false`: no screenshot tiles, no readable content, no markdown;
  `screenshot` is an empty `Buffer`, `screenshotTiles` `[]`, `markdown` `''`. The "no usable screenshot"
  error is not raised. Values cannot change: the HTML, title and structured data are read before the tiles.
- `finalProbe?: string`: a self-invoking page script evaluated once in the live tab right before
  `page.content()` (after the expand pass and the navigated-away check; on a full capture after the final
  pass); its value is `PageCapture.probe`. A throw leaves `probe` undefined (the caller treats every XPath
  as a miss, which falls back — §3.3).
- `lean?: { expand: boolean }`: skip both dismissal passes, the mouse park, the scroll to top and the
  centre-overlay warning; run the expand pass only when `expand` is true; implies `pictures: false`.
  Everything else is today's code in today's order: interception, `goto(load)`, the ready poll, expand,
  `returnIfNavigatedAway`, `finalProbe`, `content`/`title`/structured data, `selection`, the verdict.
  `PageCapture.mode` is `'lean'` (else `'full'`).

`expand` is true when the website has at least one certified XPath path. A website whose every path is
API/JSON-LD/meta skips it: those values are not in the DOM's clickable state (an API a click would fire is
a miss, which falls back).

### 3.2 Lean readiness (`@robot/scraper`)

`buildReadyCheck(fields, pageUrl, pageVariant, { preferFirstPathMs })`. Today a field is ready when *any* of
its paths reads. Full captures then spend ≥1.5 s in dismissal, during which a late, higher-ranked API path
arrives and wins; lean reads at once and could take the second path's value. With `preferFirstPathMs`
(lean: 1,500): once the basic check passes, wait — up to that long — until every field with certified paths
(default-backed ones included) reads through its **first** path; then ready. A page where the first path
legitimately never reads pays at most 1.5 s. Full captures pass nothing and behave as today. (A field
without a default that is absent from a product keeps today's cost in both modes: the basic check never
passes, so the poll runs its 8 s and the settle wait; confirmed fields, §3.4, spare it the second capture.)

### 3.3 The fallback rule (exact)

`runVerifiedExtraction(req, { browser, lean })` with a per-run `LeanRunState` (§3.4) takes a lean capture
first (under the lock, as today), evaluates every field from `capture.probe` + structured data + intercepted
JSON (no second render), and then takes **today's full capture** of the same page (`pictures: false`; values
via `setContentEvaluate`, exactly today's evaluation) when any of these holds:

| Code | Condition | Why |
|---|---|---|
| `verdict` | the lean verdict is not `ok` and not a wall (`blank`, `not-found`, `redirected`, `wrong-variant`) | the full capture's longer settle may see the real page; its verdict decides, as today |
| — | the lean verdict is a wall (`challenge`, `refused`) | **no** second load: reported to the host's backoff and thrown with its sentence, as today |
| `miss` | a field with ≥1 certified path that no path read (before defaults), unless that field is *confirmed* (§3.4) | the value may need dismissal (a consent-gated widget) or more time |
| `unshown` | a written value is flagged not shown on the page (`shown === false`), unless that field is *confirmed* | the flag must not differ from today's |
| `check` | the run is still in its check items (§3.4) | proves lean = full on this website before trusting it |

A `CaptureError` (no document, crash, timeout) on the lean load is thrown as today (no second try). When a
full capture was taken, **everything written comes from it**: data, shown, defaulted, path stats, the capture
handed to variants. A lean read never writes a hit/miss stat that the full capture overrode (a rescued miss
must not count against a healthy path).

### 3.4 What a run learns (`LeanRunState`, one per run attempt)

- **Every lean+full item is compared**, field by field (values before defaults, and shown flags):
  - a **disagreement** is a field the lean read a value for that differs from the full capture's (the full
    one empty included), or a lean "shown" the full capture does not confirm;
  - a **rescue** is a field the lean missed and the full capture read, or a lean "not shown" the full capture
    shows;
  - a **confirmation** is a field both missed, or both flag not shown.
- **Check items:** the first 2 items of each run attempt take both captures whatever the lean read (reason
  `check`). Any disagreement on any lean+full item: the rest of this attempt goes full (`switched`), with one
  warning line naming the fields and the page. Cost: one extra full capture for each of two items per
  website run.
- **Rescues:** three items in a row with a rescue switch the rest of the attempt to full (the 2026-09-11
  rule; caps the penalty on a website whose value always needs dismissal). An item without a rescue resets
  the streak.
- **Confirmed fields:** a field with 3 confirmations and no rescue since is *confirmed*: its lean misses and
  not-shown flags are trusted for the rest of the attempt (a sparse field, such as a rating absent on some
  products, must not cost a full capture per page forever). A rescue on that field un-confirms it and resets
  its count.
- `RUN_CAPTURE=full` (worker env) starts every run in `mode: 'full'`: today's capture without pictures. The
  operational kill switch; no deploy needed to go back.

### 3.5 What a row records

`captures.metadata` = `{ capture: <timings of the capture the values came from>, lean: { mode: 'lean' |
'full' | 'lean+full', reason: null | 'check' | 'miss' | 'unshown' | 'verdict' | 'switched' | 'off',
fields: string[], leanMs: number | null } }`. `fields` names the fields that triggered the fallback or
disagreed. One log line per item (today's line plus the mode) and one per run at the end
(`[crawl] run <id>: lean <n>, lean+full <m> (check a, miss b, unshown c, verdict d), full <k> (<why>)`).
Nothing reaches a customer screen.

### 3.6 Politeness: start to start, one page at a time per host

`acquireDomainLock` records the request time at **acquire** (after any backoff and spacing wait), not at
release. The lock still admits one page per host at a time; consecutive page loads on one host start at
least 2 s apart, and a page that takes longer than 2 s is followed at once — what the 2026-10-07 note
describes. A fallback's second load of the same product starts ≥2 s after its lean load by the same rule.
Backoff after a wall is unchanged. No parallel tabs on one website (that would be a politeness change,
§8).

### 3.7 Pages and browsers

One browser per run (unchanged): a renderer crash or a stuck job's `closeJob` touches one website, and the
gate already counts browsers. A fresh page per item in the run's one context (unchanged): page creation is
tens of milliseconds, a reused tab would carry listeners, timers and interception handlers across products,
and the shared context already carries cookies — a consent accepted by a fallback's dismissal is remembered,
so the next lean capture usually needs no fallback. `setContentEvaluate`'s extra context per item goes away
on lean items.

### 3.8 Websites in parallel

- The `runs` lane runs `WORKER_RUNS` run jobs at once, each its own website, each still one item at a
  time (`execute-run.ts` unchanged). Two runs on one host share the lock and simply alternate.
- **The gate keeps two browsers back**: interactive keeps one (unchanged); runs may hold at most
  `max − 2` browsers when `max ≥ 3`, so the background lane (a customer's Verify) always has one. With
  `max` 1 or 2 the rule is today's.
- **Defaults** (this dev machine: 16 GB, ~3.5 GB free with Marko's usual load, 12 threads):
  `WORKER_BROWSERS` 3 → **6**, `WORKER_RUNS` 1 → **4**. Memory per run is one Chromium with one page
  (~250–400 MB on real product pages; measured in Task 7 and the benchmark); the gate still refuses a launch
  under `WORKER_MIN_FREE_MB` (1024) for up to 2 min. Task 8 lowers the defaults if the measured peak does not
  fit (rule: `WORKER_RUNS × per-run MB + 2 × 400 MB ≤ free MB at idle − 1024`).
- **A server** (documented, not a default): `WORKER_RUNS` = (RAM − 2 GB) / 0.5 GB, capped by CPU at about
  one run per core; e.g. 16 GB, 8 cores → `WORKER_RUNS=8`, `WORKER_BROWSERS=10`. The compose stack keeps
  `STACK_WORKER_BROWSERS` 2 (one run) unless set.
- The domain lock is per worker process. With one worker per queue (today) that is every page. Running two
  workers on one queue would let two runs of one host go in parallel — out of scope, noted in the handoff.

### 3.9 Not changed

Verify, proof-page captures, the drift check, the coverage check (it keeps today's capture: an independent
full-mode measurement of where paths come back empty), holds, refresh, planning, the analysis chain, the
links-method collector (it still reads `capture.html` with a second render: few websites, and its link list
is not a certified value). The tabs step stays off. `execute-run.ts` stays sequential per run.

## 4. Expected speed-up

Per page on real sites: today ≈ 10.5 s extraction + ~1.7 s gap ≈ **12 s**; after ≈ 4.7–5.5 s lean (bias
corrected) with no gap, plus two check items and the rare fallback per website (≈ +5 %) ≈ **5.3 s** → **2.3×**
per website. Websites in parallel multiply that until the per-host floor (50 pages × 2 s = 100 s per website)
or memory binds: `R` = 4 → ~9×, `R` = 6 → ~13×, `R` = 8 → ~17×.

The 2026-10-07 hypothetical (20 websites × 50 detail pages, all certified): today 1,000 × 12 s ≈ **3 h 20 min**;
after, `R` = 6: 1,000 × 5.3 s / 6 ≈ **15 min** (≈13×); `R` = 4 (dev default): ≈ 22 min (≈9×).

The fixture is built to the same profile (§5.1); expected there: today ≈ 7.3 s per page, lean ≈ 2.6 s
(politeness floor 2 s) → 1,000 pages ≈ 2 h 2 min → ≈ 8 min at `R` = 6 (≈15×), ≈ 11 min at `R` = 4 (≈11×).

The measured run for "done when" is the fixture's 1,000 pages at `WORKER_RUNS=6`, `WORKER_BROWSERS=8`
against the baseline (§5.3); `R` = 4 is reported beside it.

## 5. Measurement

Measurement never touches Marko's data and never pays.

### 5.1 The fixture shop (`packages/worker/src/bench/fixture-shop.ts`)

A deterministic local shop: website `s` (0-based) on its own loopback address `127.0.0.(11+s)` (a distinct
hostname, so the domain lock treats each website as its own host), product pages `/p/<id>`, ids from 1. Per
product, from a seeded hash of `(s, id)`:

- HTML after 600–900 ms; 5 % of products "slow": +2,500 ms. A render-blocking CSS file (300 ms), three
  images (1,200 ms) — `load` lands ~2 s after the request, like the real pages above.
- JSON-LD `Product` (`name`, `sku`, `offers.price`, `offers.priceCurrency`), `og:title` meta.
- `/api/product/<id>` (JSON, 300–900 ms) fetched by the page; it fills the stock line.
- XPath-only: brand, stock, rating (absent on products with `id % 10 === 7`), description (on `id % 3 === 0`
  truncated behind a "Read more" button that swaps in the full text), materials inside `<details>`.
- Popups: a cookie dialog (`role=dialog`, "Accept all") 400 ms after load on half the products; a newsletter
  box with a × on a fifth, at 1,200 ms. "Accept all" sets a `consent=1` cookie; with it, no cookie dialog.
- The last website (`s = sites − 1`, when `sites ≥ 4`) is consent-gated: its stock line is filled only when the
  `consent` cookie is set — the first item's lean miss is rescued by the full capture's dismissal, and the
  context remembers the cookie.
- Twelve paragraphs of product text, so no page reads as blank.
- `expectedRow(s, id)`: the raw truth per field, rendered by the bench with the scraper's own
  `normalize`/`renderValue` for comparison.

Eight contract fields: Title (text: `json-ld name`), SKU (text: `json-ld sku`), Price (money: `api price`, then
`json-ld offers.price`), Brand, Stock, Rating (number), Description, Materials (text, XPath).

### 5.2 The harness (`packages/worker/src/bench/run-speed.ts`)

1. A throwaway database `robot_bench_<stamp>` on the same Postgres server, created and migrated by the bench
   (`drizzle-orm` migrator, `packages/db/drizzle`), and dropped in `finally`. Any `robot_bench_*` left by a killed
   bench is dropped at the next start. `DATABASE_URL` points at it before anything imports `@robot/db`, so not one
   row lands in Marko's database. Its own `JOB_QUEUE` (`bench-<uuid>`), keyless (`ANTHROPIC_API_KEY=`,
   `JEV_SHADOW=`, `TYPESAFE_API_KEY=`), `WEBSITE_CHECKS` off.
2. Per website: a signed-in throwaway user (the real `auth.signIn`), `createProjectWithSource` (proof pages
   p/1–3 with their expected values), `seedPassingVerification` (the certified paths above), a run with `P`
   pending detail items, `startRunJob`.
3. An in-process worker (`startWorker`) with `WORKER_RUNS`/`WORKER_BROWSERS` from the command line,
   `setBrowserOwner(pid)` and `closeOrphanBrowsers()` first.
4. Wall time from the worker's start (every run job already queued) to the last run's end; per item the
   cycle time — consecutive `run_items.completed_at` within a run, the first from its run job's
   `jobs.started_at` (`run_items.started_at` is never set) — so politeness and row writes count; per capture `captures.metadata` (mode, reason, timings); peak memory of the bench's Chromium
   processes (by their `--robot-owner=<pid>` switch) and the node process, sampled every 5 s.
5. Values: every extraction row (data + `validationResult`) per `(website, id)`, compared with
   `expectedRow` and written to a JSON file for before/after comparison.
6. `worker.stop()`, assert no browser open, drop the database.

### 5.3 The runs

| Run | Code | Websites × pages | `WORKER_RUNS`/`BROWSERS` |
|---|---|---|---|
| before | `main` as of this branch's start (Task 1, before any change) | 2 × 50 = 100 | 1 / 3 (today's defaults) |
| after-1 | branch | 2 × 50 = 100 | 1 / 3 — isolates lean + politeness |
| after-4 | branch | 20 × 50 = 1,000 | 4 / 6 (new defaults) |
| after-6 | branch | 20 × 50 = 1,000 | 6 / 8 — the "done when" run |

"before" is linear in pages (one run at a time, same 50-page run shape), so 1,000 pages = 10 × before.
**Same values**: after-1 equals before on all 100 pages (data and shown), and every after-run equals
`expectedRow` on every page; any difference fails the gate.

### 5.4 Real pages, read only (`packages/worker/src/bench/real-sites.ts`)

For 3 of Marko's certified websites (default: Ikea `104e5e56…`, Gymshark `7f5cde3b…`, Skullcandy
`f210ced9…`), 5 product URLs each from their latest done run items: `loadCurrentCertification` and the URLs are
**read**; nothing is written (no run, no stats, no rows). Per page, `runVerifiedExtraction` once in full mode and
once with a fresh `LeanRunState` past its check items, in alternating order, one browser, the real domain lock.
Reports per page: both times, the lean mode it took, value and shown differences, Chromium memory. Free and
keyless.

## 6. Customer impact

None visible. Same rows. A run finishes sooner. No copy changes; no internals in customer copy.

## 7. Risks (and what covers them)

1. **A value lean reads differently but not empty** (DOM changed by dismissal; a positional XPath shifted by a
   removed popup) — the check items compare both ways on every run; the benchmark and the real-page check
   compare every page.
2. **A higher-ranked path arriving late** — the first-path wait (§3.2).
3. **A sparse field costing a fallback on every page** — confirmed fields (§3.4).
4. **A wall loaded twice** — a lean wall is never retried (§3.3).
5. **Memory with several runs** — one browser per run, the gate's memory wait, defaults tied to a measurement.
6. **Verify starved by long runs** — the gate's background reserve (§3.8).

## 8. For Marko (not blocking)

- **Politeness spacing is now start-to-start** (§3.6): one page at a time per host, page starts ≥2 s apart. This
  is what the 2026-10-07 note describes; the code measured from the end of the previous page and so added ~1.7 s
  per product. Say if you want the old, slower spacing back (one line).
- **More than one page at a time per website** (2 tabs per host under the same 2 s start spacing) would roughly
  halve a big website's run again — a politeness decision, not taken here.
- **Defaults** `WORKER_BROWSERS=6`, `WORKER_RUNS=4`: your worker can hold up to six Chromium during runs (the gate
  waits for 1 GB free before each launch). Set them lower in `.env` if the machine feels it.

## 9. Rollback

`RUN_CAPTURE=full` in the worker's environment: runs take today's capture (pictures off). Code rollback: revert the
merge; no migration, no data shape change (`captures.metadata.lean` is additive and read by nothing customer-facing).

## 10. Files

- `packages/browser/src/types.ts`, `playwright-browser.ts` (+ `capture-lean.test.ts`)
- `packages/scraper/src/domain-lock.ts` (+ `domain-lock-spacing.test.ts`)
- `packages/scraper/src/verify/verified-extraction.ts`, new `verify/lean-run.ts`, `index.ts` (+ `lean-run.test.ts`,
  `verified-extraction-lean.test.ts`, `verified-extraction-ready.test.ts`)
- `packages/api/src/crawl/extract-item.ts`, `start-execution.ts` (+ tests); `src/jobs/browser-gate.ts` (+ test);
  `src/jobs/index.ts` and `package.json` exports for the bench
- `packages/worker/src/config.ts` (+ test), `package.json` (`@robot/scraper`, `postgres`); new
  `src/bench/{fixture-shop,bench-db,seed,measure,run-speed,compare,real-sites}.ts` (+ `fixture-shop.test.ts`)
- `CLAUDE.md` (commands, environment, key decisions), `docs/handoff.md`, `docs/queue.md`,
  `docs/testing/results/2026-10-23-run-speed/`
