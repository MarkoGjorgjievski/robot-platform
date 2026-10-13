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
