# A website's default values — live check, 2026-10-13

Signed in as `credit-campaign@example.com` through the app's `/login` form (headless Playwright,
1440×1000, one Chromium at a time, scripted from the scratchpad, against the already-running
main servers: api-server :4000, app :3000, on `main` at commit `90ca60b`). Database read with
SELECT only. Nothing was created or deleted; no Verify and no Extract was clicked, so no run and
no verification was started. Screenshots: `docs/testing/results/screens-2026-10-13-defaults/`
(10 files). The check stopped at step 4 because the Verify button showed a dollar amount (the
brief's rule); steps 5–6 could not be reached, step 7 found no qualifying website.

**State left behind on gymshark** (customer data changed by this check, as the brief asked):
`verification_set.defaults = {"brand": "Gymshark"}`, and the four Brand cells in
`verification_set.expected.brand` are now `""` (they were `Gymshark | We Do Gym`). Brand is
therefore unverified on Gymshark and its Extract is locked until someone re-verifies.

## Gymshark — Verification tab, Brand's default

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 0 | Open Verification (before any change) | Brand typed tagline, verified | Every field `verified 4/4`; Brand cells `Gymshark \| We Do Gym` on all four products; top reads `Everything is verified` / `Nothing has changed since the last verification`. No `not on this page` flag on any Brand cell this time (on 2026-10-12 cards 1–3 carried it) | `gymshark-verification-before.png` |
| 1 | Click the Brand row's name to expand it; read the new input | Input `Default Brand for this website` | Expanded row shows `Type it`, then **`Default for this website`** (input `aria-label="Default Brand for this website"`, empty), then `Descriptor` | `gymshark-brand-expanded.png` |
| 2a | Type `Gymshark` into it | `Fills every product the paths leave empty.`, no warning | **`Fills every product the paths leave empty.`**; `not on any proof page` count **0**. Saved: `verification_set->'defaults' = {"brand": "Gymshark"}` | `gymshark-default-gymshark.png` |
| 2b | Type `Gymshark \| We Do Gym` | Warning appears (or record why not) | **`Fills every product the paths leave empty.not on any proof page`** — the warning appears, title `No proof page shows this value; it will still fill every product the paths leave empty.` So the §3 page-text check finds the tagline on none of the four pages (consistent with yesterday's run flagging all ten Brand values "not shown") | `gymshark-default-tagline.png` |
| 2c | Set it back to `Gymshark` | Warning gone | `Fills every product the paths leave empty.`; warning count 0 | — |
| 3 | Select each Brand cell, empty its `Type it` input (`Brand on product n`) | Each cell reads `Gymshark` muted, title `This website's default; a path that reads a value here wins` | All four cells, same session: text **`Gymshark`**, class `… text-muted-foreground`, inner title **`This website's default; a path that reads a value here wins`**, aria-label `Brand on product n: empty, Gymshark`. Detail bar for product 4: `Brand · Gymshark Adapt Solid Sports Bra - Black \| Gymshark (product 4) nothing found`. Status column: `changed since verified` | `gymshark-brand-default-cells.png` |
| 3-db | SELECT `sources.verification_set` | Default saved, expected blank | `->'defaults'` = **`{"brand": "Gymshark"}`**; `->'expected'->'brand'` = all four proof-page URLs mapped to **`""`**; `->'absent'->'brand'` null | — |
| 3-reload | Reload the Verification tab (fresh sign-in) | (not in the brief — recorded because it differs) | **The default cells did not survive a reload as default cells.** After reload all four Brand cells read `Gymshark \| We Do Gym` with a warn rail, aria-label `Brand on product n: suggested, Gymshark \| We Do Gym`; Status `only in the page data on product 1`; expanded row: `page data: Gymshark \| We Do Gym ✓ ×`, Default still `Gymshark`. The JSON-LD `brand.name` on these pages *is* the tagline (latest verification `7b01e1be…` found `Gymshark \| We Do Gym` via `json-ld brand.name` on all four), so once the captures load, the blank cells fill with that page-data suggestion. In the first session the captures were still loading (`taking screenshot…`), which is why the cells showed the default there | `gymshark-brand-after-reload.png` |

## Gymshark — Verify (step 4) — stopped

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 4 | Read the Verify button text | No `$` → click | In the session that made the edits: **`Re-verify 1 field · up to $0.05`** — a dollar amount, **not clicked**, step stopped per the brief. After reload the button reads `Re-verify` (disabled) with **`Brand has a suggestion to confirm on product 4`** beside it, so it could not have been clicked either. No `source_verifications` row was created (0 in the last two hours); the latest stays `7b01e1be…` (2026-10-12: certified `json-ld brand.name`, value `Gymshark \| We Do Gym`, `weakEvidence: true`) | `gymshark-brand-default-cells.png` (button top right), `gymshark-verify-button-after-reload.png` |

What certified for Brand under the default: **not tested** — no Verify ran.

## Gymshark — Extract and run page (steps 5–6) — not reachable

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 5 | Open Extract, read the Extract button | Set 10 × 1, click if no `$` | Locked: **`Extraction is locked · 7 of 8 fields verified · fix Brand on the Verification tab`**; the budget is already `custom` / `custom` (`first 10 products from each · first 1 page of each`); button **`Extract` [disabled]** with `Verify every field on the Verification tab first`. Nothing clicked; no run created (0 runs in the last two hours) | `gymshark-extract-locked.png` |
| 6 | Run page badges, `defaulted` | — | Not reached: no run. `default on n` / `n not shown` not observed | — |

## Default only (step 7) — none qualified in two tries

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 7a | Colourpop: Brand row (read only, no edit) | No page-data brand | Brand `ColourPop` accepted on 4/4, `verified 4/4`; latest verification certified `json-ld brand.name` — a path reads the brand, so it does not qualify | `colourpop-brand-row.png` |
| 7b | Oliver Bonas: Brand row (read only, no edit) | No page-data brand | Brand `Oliver Bonas` accepted on 4/4, `verified 4/4`; latest verification certified `json-ld brand.name` — does not qualify | `oliverbonas-brand-row.png` |

No edits were made on either site: neither qualified, and once a field changed Verify there would
show the same kind of `up to $…` estimate, which the brief forbids clicking.

## Ops

Skipped: `credit-campaign@example.com` is not an operator.

**Cost, precisely.** $0. No Verify and no Extract was started: `source_verifications` and `runs`
for gymshark have no rows in the last two hours (SELECT count = 0 each), so there is no run
`cost_usd` to record. The only server work was the app's own page captures for the Verification
tab's screenshots and the §3 default check, which are free.

## What this proved / did not

Proved:
- The `Default for this website` input exists on an expanded row, saves to
  `verification_set.defaults` (`{"brand": "Gymshark"}`), and shows
  `Fills every product the paths leave empty.` when non-empty.
- The §3 warn-never-block check works against live page text: `Gymshark` → no warning;
  `Gymshark | We Do Gym` → `not on any proof page` with the spec's title.
- Emptying a typed cell under a default stores `""` and, while no page data has loaded, draws
  the cell as `Gymshark` muted with title `This website's default; a path that reads a value here wins`.

Did not prove / found:
- **Verify, certification, Extract, the run page's `default on n` / `not shown` badges and
  `validation_result.defaulted`: not exercised.** The Verify button showed
  `Re-verify 1 field · up to $0.05`, so it was not clicked.
- **On reload the blank Brand cells on Gymshark are page-data suggestions, not default cells**
  (`suggested, Gymshark | We Do Gym`, `only in the page data on product 1`), and Verify is blocked
  until a person confirms or rejects them. The JSON-LD `brand.name` on Gymshark *is* the tagline,
  so even after a Verify the "path wins" rule would certify and extract `Gymshark | We Do Gym`,
  not `Gymshark`: the default cannot fix this site's Brand while that path reads a value. The
  brief's expectation (the real brand wins, `not shown` goes away) does not hold here.
- Default-only (`default only · no path reads it on this website`, `defaultOnly = true`) not
  reached: Colourpop and Oliver Bonas both have a certified `json-ld brand.name`.
- Gymshark is left with Brand unverified and Extract locked. Restoring it needs either the typed
  tagline back on the four cells, or confirming the page-data suggestions and a Re-verify (whose
  button shows a cost estimate).

## Second half, 2026-10-14 — the Re-verify and the Extract

Signed in as `credit-campaign@example.com` through the app's `/login` form (headless Playwright,
1440×1000, one Chromium at a time, scripted from the scratchpad, against the already-running
main servers: api-server :4000, app :3000, on `main` at commit `ed3d89b`). Database read with
SELECT only. One run was created on gymshark (`2a5f215d-e824-4b40-bdf4-699e54417ae0`); nothing
else was created or deleted. Screenshots: `docs/testing/results/screens-2026-10-13-defaults/`
(5 files, `second-` prefix).

**The Re-verify, from the database (not reproduced live — already done this morning).** Marko
rejected the page-data suggestion on product 4 (the thing the Verify gate was holding on) and
then clicked Re-verify himself. `source_verifications` row `9fd53ef4-eebe-4eb9-8144-40b23d2f088c`:
started `2026-10-14 07:21:59.04Z`, completed `07:22:03.17Z` (4s), **`all_passed = true`**,
**`ai_calls = 0`**, **`cost_usd = 0.0000`**, `results->'brand'->>'defaultOnly' = true`, Brand's
`paths` array length `0` — certified by the website's default alone, no path, no AI, $0. This is
the state the run page should now reflect.

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1 | Open the Extract tab, set custom 10 products across custom 1 page, read the Extract button | No `$` → click | Budget line after setting: **`1 listing · first 10 products from each · first 1 page of each · safety stop at 5,000 products per listing`**; button read only **`Extract`** (no amount). Clicked 08:28:48.344Z | `second-extract-budget-set.png` |
| 1-hiccup | Wait for the "Open the run" link (the UI shows it as soon as a run is active) | Link appears within seconds | **Did not appear within 30s** — the script's own wait timed out and the script exited before the click's `planMutation` had resolved client-side, so the page's own follow-up `executeMutation` call (the thing that actually starts extraction — `handleExtract` awaits plan, then always calls `crawl.execute`) was never sent. The run the click *did* create (`2a5f215d-e824-4b40-bdf4-699e54417ae0`, found via the database) sat at `status = planned`, `completed_at` set (planning itself finished server-side at 08:30:05), all 10 detail items `pending`, 0 attempts — stalled, not extracting. No `$` was ever shown; this was a script timing mistake, not a product defect | `second-extract-started.png` (shows the plain `Extract` button again on reload, budget unchanged) |
| 1-resume | Open the run page for that run id; use its documented crash-resume control (`run-progress.ts`: "Fetch and extract every pending URL — also the resume path for a stalled run"; `crawl.execute` is explicitly re-entrant for this) | A button naming the pending count, no `$` → click | Run page read **`10 URLs planned, not yet extracted`** with button **`Extract 10 pending`**, title `Fetch and extract every pending URL in the work list.` — no dollar amount. Clicked 08:35:56.824Z; the header immediately read `Running` and a `Stop` button appeared. Same run id throughout — nothing new was created | `second-run-before-resume.png`, `second-run-after-resume-click.png` |
| 2 | Poll `runs` for gymshark's `source_id` created after 2026-10-14 07:00, up to 8 minutes | Completes | `runs` row `2a5f215d-e824-4b40-bdf4-699e54417ae0`: `started_at` 08:28:48.392Z (the original click), status moved `planned` → (resume) → `extracting` at 08:35:56 → **`completed`** at **08:37:52.697Z**. **`status = completed`**, **`result_count = 10`**, **`cost_usd = 0.0000`** | — |
| 3 | Open the run page; read the Brand column head's badges, a Brand cell's title, the summary line, the facts area | `default on 10`, no `not shown`; title `this website's default`; summary `10 rows · 100% confidence · 10 values from the website's defaults` | Column heads verbatim: **`Title`**, **`Price`**, **`Main imagenot checked`**, **`SKU`**, **`Brandnot checkeddefault on 10`** (read: Brand carries only the **`default on 10`** badge — the `not checked` text belongs to the *previous* `<th>`, Main image, not Brand; Brand has no `not shown`/`not checked` badge of its own), **`In stocknot checked`**, **`Rating`**, **`Description`**. "Values not shown on their page" panel: **absent** (heading count 0). 10 of 10 `<td>`s carry `title="this website's default"`, text **`Gymshark`**; 0 `<td>`s carry `title="not shown on the page"`. Summary line, exact: **`10 rows · 100% confidence · 10 values from the website's defaults`**. Facts area (the Started/Completed/Duration/Rows strip): `Started 9 min ago · Completed just now · Duration 9 min · Rows 10` | `second-run-completed.png` |
| 3-db | SELECT `extractions.validation_result->'defaulted'`, `->'shown'->'brand'`, and `data->0->>'brand'` for the run's 10 items | `defaulted` names brand; `shown.brand` not flagged; brand value `Gymshark` | All 10 rows, identically: `validation_result->'defaulted'` = **`["brand"]`**; `validation_result->'shown'->'brand'` = **`null`** (never flagged, since a defaulted value is not checked against the page); `data->0->>'brand'` = **`Gymshark`** on every row (the typed tagline `Gymshark \| We Do Gym` is gone — the default, not a path, is what extracted) | — |

**Cost, precisely.** `runs.cost_usd = 0.0000` for `2a5f215d-e824-4b40-bdf4-699e54417ae0` (database,
authoritative). The Re-verify this morning was also `$0.0000` (`ai_calls = 0`). Total for this
half: **$0**.

## What this proved

- The default now does what the first half's step 4 could not reach: Brand certifies
  `defaultOnly = true` with zero paths, zero AI calls, zero cost, and an Extract run actually
  produces `Gymshark` (not the tagline `Gymshark | We Do Gym`) on every one of 10 rows.
- The run page's default-aware badges and cell rail are real and match the committed strings
  exactly: column head `default on {n}`, cell title `this website's default`, summary suffix
  `{n} values from the website's defaults`. None of the ten defaulted Brand values is flagged
  `not shown` — a defaulted cell is correctly exempted from the shown-on-the-page check.
- `extractions.validation_result` records which fields were defaulted per row (`"defaulted":
  ["brand"]`), independent of the `shown` map, which stays `null` for a defaulted field.
- Caveat on this check's own conduct, not the product: the first Extract click did fire — the
  stall came from the checking script giving up on a 30-second UI wait before the server-side
  plan phase (which took ~77s) had returned to the browser tab, so the client never sent the
  follow-up `crawl.execute` call. The run was recovered, not restarted, through the run page's own
  documented stalled-run control (`Extract {n} pending`, no new run, no `$`) — exactly the
  crash-resume path the codebase comments describe `crawl.execute` as existing for.
