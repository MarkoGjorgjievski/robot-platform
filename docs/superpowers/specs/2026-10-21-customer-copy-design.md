# Customer copy: capture failures and the page limit — design

**Status:** written 2026-10-21 under the standing approval (CLAUDE.md "Autonomous runs"; queue items 1
and 2, Marko: yes, 2026-10-21). Not yet implemented. Plan:
`docs/superpowers/plans/2026-10-21-customer-copy.md`.

## 1. Why

Two wording defects a customer reads today:

1. **Capture failures name the host and an HTTP code.** Since the honest verdicts (2026-10-09) every
   failed page capture is shown as `verdictSentence(verdict, url)` from
   `packages/browser/src/verdict-copy.ts`: "scan.co.uk refused the browser (HTTP 403, Cloudflare).
   We can't read this website from here yet." That names a host, a status code, a vendor and "the
   browser" — detail for staff, noise (and an internal look) for a customer. Even a success reads
   "Reached example.com (HTTP 200)." under a new website's Verification tab.
2. **"Budget" means a page limit.** Settings has a "Budget" row with "Save budget"; a run page says
   "4 variant pages skipped for the budget"; a staff-activity line in the customer's Settings says
   "(budget 50 products)". "Budget" reads as money, and customer copy never talks money.

## 2. Decision: map at display time, never rewrite the stored text

The verdict sentence is stored in many places (a run's `errorMessage`, a run item's `error`
including "Not tried: {sentence}", a proof-page capture's `error`, a verification's
`captures[url].blockedReason`, a drift check's `not-checked` reason, a coverage check's error) and
**read by logic**:

- `run-drift-check.ts` `outcomeOfFailedCapture` reads the `redirected to ` prefix;
- the app's `diagnose-run.ts` matches `refused the browser` / `captcha` to diagnose a blocked run;
- ops reads the stored text as staff detail;
- every row already in the database holds the old sentence, so a writer-side change would leave
  them showing hosts forever.

So the stored text stays exactly as it is, and `verdict-copy.ts` is unchanged (it gains a comment
naming the mapper). One pure function in the app, `captureWords(text, staff)` in
`packages/app/src/lib/capture-words.ts`, turns a stored capture text into its customer sentence, and
every customer screen that shows a capture text runs it through that function.

**Who sees the detail.** The same people who see money: `showsMoney(session)`
(`packages/app/src/lib/money-visibility.ts` — an operator, or a staff session inside the org).
`captureWords(text, true)` returns the text unchanged; ops screens never call it.

## 3. Inventory — capture texts

Every customer-visible capture text, old → new. `{host}` is the requested URL's host without
`www.`; the rules below match the stored sentences by shape, so the host can be anything.

| Kind (source) | Old (stored, staff still read it) | New (customer) |
|---|---|---|
| `ok` (reachability line) | Reached {host} (HTTP {status}). | This website opens normally. |
| `refused` | {host} refused the browser (HTTP {status}[, {vendor}]). We can't read this website from here yet. | This website turned us away, so we can't read it yet. (Ruling 2026-10-21: no contact line — there is no contact route.) |
| `challenge` | {host} asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check. | This website asked for a human check. Wait a few minutes and try again; its other pages are behind the same check. |
| `not-found` | That page doesn't exist on {host} (404). Check the address. | That page doesn't exist. Check the address. |
| `redirected` (off-site) | That address led to {to}. Paste a page on {host}. | That address opened a page on another website. Paste a page from this website. |
| `blank` | {host} sent an empty page. Try again. | The page came back empty. Try again. |
| `wrong-variant` | The page did not show the variant the address names ({named}). | The page did not show the variant its address names. Check the address, or use another product. |
| `crashed` | The browser crashed on this page. Try again. | The page stopped loading before we could read it. Try again. |
| `unreachable` | {host} could not be reached (no response). | This website did not respond. Check the address, or try again later. |
| `timeout` | {host} did not answer in time. | This website took too long to answer. Try again. |
| same-site redirect (`capture-check.ts`) | redirected to {url} | That address opened a different page. Check the link, or use another product. |
| backoff answer (domain-lock, reachability) | {sentence} Waiting {n} min before trying again. | {new sentence} Waiting {n} min before trying again. |
| run item not tried (record-outcome) | Not tried: {sentence} | Not tried: {new sentence} |
| execute refused after a failed plan (`crawl/execute-guard.ts`, Extract tab) | This run failed while planning: {sentence} | This run failed while planning: {new sentence} |
| orchestrator wrapper (`extraction-orchestrator.ts`) | Page blocked or unusable: {sentence} | {new sentence} (the wrapper is dropped; an inner text that is not a verdict takes the generic sentence) |
| `BROWSER_UNAVAILABLE` | We couldn't open a browser to read this page. Try again in a minute. | unchanged |
| any other capture text holding a host, an address, an IP address, an HTTP code, a vendor, a system error code (ECONNREFUSED…), "browser" or library text (Playwright's `page.x:` / `browserType` / "Target closed" / "crashed!") | as stored | We couldn't read this page. Try again. |
| a failed mutation on a customer screen (`lib/mutation-error.ts`: execute, cancel, backfill, confirm) | as sent | the api's own sentence for PRECONDITION_FAILED / BAD_REQUEST / FORBIDDEN (through the mapper); anything else, or one holding library text or an id: Something went wrong. Try again. |
| blocked-run diagnosis (`diagnose-run.ts`, run page) | {reason} — wait and retry; long-term this needs the proxy line item. | {new sentence} (no tail: the sentence already says what to do) |
| dead-link diagnosis | The link appears dead ({message}). | The link appears dead. Check the address. |
| failed-item diagnosis rows | {item error} | {new sentence} |

Texts that are not capture verdicts and hold none of those things (an extraction error in our own
words, "stalled", the Verify sentences of 2026-10-20) pass through unchanged.

### Where they are shown (each passes `showsMoney(session)` as `staff`)

- Verification tab: the listing bar (`found.message`, `check.error.message`), the reachability
  line, proof-page cards and the screenshot panel (`proofCaptureState` → `captureErrorText`), the
  "Not checked on product n — …" badge and cell hint (the route maps `blockedReasons(...)` once),
  the drift "Product n could not be checked — …" line (`driftRows`).
- Extract tab: the listing-check chip (`listingCheckLabel`), the sample's `errorMessage`.
- Runs: the run page's `errorMessage`, the Pages table's item errors (`work-list.tsx`), the
  website's and the organisation's runs tables (`runs-table.tsx`, `org-runs-table.tsx`), the
  diagnosis panel (`diagnoseRun`).

Ops (`/ops/…`, `ops-view.ts`) is unchanged: staff detail.

## 4. Inventory — "budget"

| Where | Old | New |
|---|---|---|
| Website Settings row label (it holds a products count and a pages count) | Budget | Run limits |
| Website Settings button | Save budget | Save limits |
| Website Settings save error | That budget could not be saved. | Those limits could not be saved. |
| Run page variant line | {n} variant pages skipped for the budget | {n} variant pages skipped for the page limit |
| Staff activity (customer Settings + ops), new rows (`staff-actions.ts`) | Planned an extraction on {site} (budget {n} products) | Planned an extraction on {site} (up to {n} products); `all` → (all products); unknown → no bracket |
| Staff activity, rows already stored | (budget {n} products) | mapped the same way at display (`staff-activity-list.tsx`) |

Code identifiers (`budget`, `budgetSummary`, `variantsSkippedForBudget`, `saveBudget`, the `budget`
column) stay. Comments stay. Scraper log warnings ("budget reached: …") are not customer copy
(they feed `diagnoseRun` only, which never prints a warning) and stay.

## 5. Rules

1. A customer never reads a host, a URL, an HTTP status, a wall vendor's name, "CAPTCHA", "the
   browser", "proxy" or "budget" in a capture or limit sentence.
2. Each sentence says what happened and what to do, in the customer's words.
3. Stored text never changes; drift, the diagnosis and ops read it as before.
4. The mapper is total: a text it does not recognise passes through only if it holds none of the
   forbidden things; otherwise it becomes "We couldn't read this page. Try again."
5. The backoff wait ("Waiting n min before trying again.") and "Not tried: " survive the mapping.

## 6. Safety

- **The sweep (capture).** `capture-words.test.ts` imports `verdictSentence` from
  `packages/browser/src/verdict-copy.ts` by relative path (test only; the shipped app still imports
  nothing from `@robot/browser`), renders every verdict kind for several hosts (`www.` hosts, a
  `.co.uk` host, a `localhost:port` host, every wall vendor), with and without "Not tried: " and the
  backoff suffix, and asserts each customer sentence equals the table above and holds no host, no
  `http`, no `HTTP`, no three-digit status, no vendor name and no "CAPTCHA". A change to
  `verdict-copy.ts` that the mapper no longer recognises fails the test instead of leaking.
- **The sweep (copy).** `customer-copy-sweep.test.ts` parses every non-test `.ts`/`.tsx` under
  `packages/app/src` with the TypeScript compiler, collects string literals, template text and JSX
  text, and fails on `budget`, `HTTP \d`, `refused the browser` or `CAPTCHA` outside
  `routes/_app/ops/`, `components/ops/` and `lib/ops-view.ts` (staff screens) and
  `lib/capture-words.ts` (the mapper's rules match the stored sentences).
- **Staff unchanged.** `captureWords(text, true) === text` for every case in the table; ops is not
  touched.
- **Smoke.** The route smoke's three verdict assertions change to the new sentences (it signs in as
  a customer), and its run-page assertion reads "skipped for the page limit".
