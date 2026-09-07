# 2026-09-07 — Customer schema verification: free live pre-check (Task 17, Step 1)

**Result after 3 attempts (2 live-only bugs found and fixed in between): SUCCESS.** Run 3 completed cleanly with real per-field mechanical certification — **5 of 8 fields certified**, 3 red on genuine mechanical mismatches (not crashes). No AI was called at any point across all three runs (`aiCalls: 0`, `costUsd: 0.0000` throughout).

## Setup (unchanged across all runs)

- Branch: `feat/schema-verification`
- Site: **currys.co.uk** (captured cleanly on 2026-09-02)
- Source: Scratch project, slug **`currys-co-uk-1dvdva`** (sourceId `f1e7ee0b-03cc-4f7f-90cf-1cc53140f5b5`) — grid and URLs saved from the first pass, reused as-is across all three runs
- Three product URLs, found by crawling the live `/computing/laptops/laptops` listing page and reading each rendered product page (no JSON-LD/API JSON used to fill the grid):
  1. `https://www.currys.co.uk/products/apple-macbook-pro-14-2025-m5-1-tb-ssd-silver-10292727.html`
  2. `https://www.currys.co.uk/products/hp-omnibook-3-oled-14-laptop-snapdragon-x-512-gb-ssd-silver-10303790.html`
  3. `https://www.currys.co.uk/products/dell-xps-13-dx13260-13.4-laptop-intel-core-5-512-gb-ssd-silver-10306179.html`
- `ANTHROPIC_API_KEY` confirmed blanked in the api-server's process environment before every `verify` call, via `sources.verifyEstimate` → `aiAvailable: false`.

### The field grid (typed by hand from the rendered pages, visible text only — unchanged across all runs)

| Field | Type | `.../apple-...-10292727.html` | `.../hp-...-10303790.html` | `.../dell-...-10306179.html` |
|---|---|---|---|---|
| Product name | text | `APPLE MacBook Pro 14" (2025) - M5, 1 TB SSD, Silver` | `HP OmniBook 3 OLED 14" Laptop - Snapdragon X, 512 GB SSD, Silver` | `DELL XPS 13 DX13260 13.4" Laptop - Intel® Core™ 5, 512 GB SSD, Silver` |
| Price | money | `£1,999.00` | `£599.00` | `£979.00` |
| Brand | text | `APPLE` | `HP` | `DELL` |
| In stock | boolean | `No` (page shows "Out of stock.") | `Yes` (page shows "Add to basket") | `Yes` (page shows "Add to basket") |
| Main image | image | `https://media.currys.biz/i/currysprod/10292727?$l-large$&fmt=auto` | `https://media.currys.biz/i/currysprod/10303790?$l-large$&fmt=auto` | `https://media.currys.biz/i/currysprod/10306179?$l-large$&fmt=auto` |
| Product code | text | `428352` | `610840` | `560608` |
| Rating | number | `4.6` (shown as "4.6/5 7 reviews") | `4.2` (shown as "4.2/5 26 reviews") | `0` — no rating shown on this page at all; typed as a required-field placeholder, deliberately kept to exercise a legitimately-missing value |
| Processor | text | `Apple M5 chip` | `Snapdragon X X1-26-100 Processor` | `Intel® Core™ 5 320 Processor` |

## Run 1 (crashed) — recap

`sources.verify` reached the `searching` stage in ~43s and threw `ReferenceError: __name is not defined at browserNormalize`. Root cause: `dom-scripts.ts`'s `buildDomSearchScript`/`buildXPathProbeScript` interpolate `Function.prototype.toString()` of hand-written page-side helpers into an injected `page.evaluate` script; under `tsx watch` (esbuild, `keepNames: true`), the transformed source of `browserNormalize`'s nested arrow (`num`) is wrapped in esbuild's `__name(fn, name)` helper, which the injected page script never defines. Confirmed independently (no source changes) by printing `buildDomSearchScript(...)`'s output under `tsx` and finding a live `__name(...)` call inside it.

**Fixed** in commit `e32825b` (`fix(scraper): page scripts define the esbuild __name helper; dev:all:noai`): both script builders now prepend `PAGE_SCRIPT_PRELUDE = 'var __name = (fn) => fn;'` as the first statement of their IIFEs. That commit also adds `pnpm dev:all:noai` (`cross-env ANTHROPIC_API_KEY= turbo dev --env-mode=loose`), fixing the separate `turbo --env-mode=strict` gotcha from Run 1 (an ad-hoc shell `ANTHROPIC_API_KEY=` override never reached the task's child process under turbo's default strict env mode).

## Run 2 (crashed differently) — recap

Restarted both servers with `pnpm dev:all:noai`, confirmed `aiAvailable: false`, called `sources.verify` against the same source. The `__name` bug was gone — the run advanced past `capturing 1/3 → 2/3 → 3/3` into `searching` without that error — but it failed with a **different** exception, identically on **two separate attempts**:

| Attempt | verificationId | started to completed | elapsed | error |
|---|---|---|---|---|
| A (primary) | `512cff32-17f3-4281-98ef-c03ed26b6a39` | 14:12:48.025Z to 14:15:37.250Z | 169.2s | `page.setContent: Timeout 30000ms exceeded... waiting until "load"` |
| B (repeat, to check reproducibility) | `864c90fd-6fb3-4faf-937f-c7cc98d129e1` | 14:16:41.056Z to 14:18:21.734Z | 100.7s | identical `page.setContent` timeout |

Both attempts: `allPassed: false`, `results: {}`, `captures: {}`, `stage: "searching"`, `aiCalls: 0`, `costUsd: "0.0000"`, `errorMessage: "page.setContent: Timeout 30000ms exceeded. Call log: setting frame content, waiting until \"load\""`.

Root cause: `packages/browser/src/playwright-browser.ts`'s `setContentEvaluate` called `page.setContent(html, { waitUntil: 'load' })` on a fresh context with no request blocking, despite a comment claiming this is "offline" and "does NOT trigger navigation or network fetches." That claim did not hold for a real captured commercial page: Chromium genuinely fetches every subresource referenced in the HTML (images, stylesheets, `<script src>`, iframes, trackers, ad tags) against their real absolute URLs, and `waitUntil: 'load'` waits for all of them to finish. A real currys.co.uk page carries dozens of third-party scripts; something in that set hung long enough to blow the 30s timeout, identically on two independent attempts.

**Fixed** in commit `6afcbfd` (`fix(browser): setContentEvaluate is offline by construction; verification errors stored without ANSI`): `setContentEvaluate` now registers `page.route('**/*', route => route.abort())` before calling `setContent`, and `waitUntil` moved to `'domcontentloaded'` (since `'load'` would otherwise wait forever on requests that are aborted rather than merely slow). That commit also strips ANSI escape codes from persisted verification `errorMessage`s.

## Run 3 (this session, both fixes applied) — SUCCESS

Restarted both servers with `pnpm dev:all:noai`, confirmed `aiAvailable: false` via `sources.verifyEstimate`, called `sources.verify` against the same source, polled `sources.verificationStatus` every 3s.

- verificationId: `877552ef-3d9b-48da-8c7c-8ba66c1159d8`
- `startedAt` 2026-09-07T14:29:38.218Z → `completedAt` 2026-09-07T14:30:39.661Z — **elapsed ≈ 61.4s**
- Progressed `capturing 1/3 → 2/3 → 3/3 → searching → (done)` with **no error** — `errorMessage: null`
- `allPassed: false` (expected — 3 of 8 fields are genuinely not mechanically certifiable without AI)
- `aiCalls: 0`, `costUsd: "0.0000"` (no AI available on this machine, exactly as intended)
- `stage: null` at completion (the `captures` column is wholesale-replaced with real capture refs on success, which naturally drops the `_stage` marker that was there mid-run — not a bug)

### Captures map

All three pages captured cleanly (no `blockedReason` on any of them):

| URL | captureId | capturedAt | screenshotUrl |
|---|---|---|---|
| `.../apple-...-10292727.html` | `a69c082d-f343-4a76-841a-283cca017593` | 2026-09-07T14:30:39.571Z | `/captures/e9ac4242-1949-415a-8f74-a21bd0bf4916.png` |
| `.../hp-...-10303790.html` | `42dafd7c-f843-446e-b500-d9e007e151ec` | 2026-09-07T14:30:39.620Z | `/captures/7a3116ff-d595-41e1-a62f-0278e178e4e9.png` |
| `.../dell-...-10306179.html` | `b2f65e4f-eaf9-4e9a-9a04-167506035eee` | 2026-09-07T14:30:39.661Z | `/captures/923dab98-e9c6-4594-a8e8-aaec96a686c1.png` |

### Per-field table — **5 of 8 certified**

| Field | Certified? | Primary certified path (source · path · transform) | Notes |
|---|---|---|---|
| Product name | **Yes** | json-ld · `name` · identity | 3 more xpath candidates also certified (page renders the title in several DOM locations); all 3 URLs `pass` |
| Price | **Yes** | json-ld · `offers.price` · identity | all 3 URLs `pass` (`found`: `1999.00` / `599.00` / `979.00`) |
| Brand | **Yes** | json-ld · `brand.name` · identity | a second json-ld candidate (`itemListElement[4].item.name`) also certified; all 3 URLs `pass` |
| Main image | **Yes** | json-ld · `image` · `first_of_list` | 4 more candidates also certified (`image[0]` identity, `og:image` meta, `twitter:image` meta, one xpath); all 3 URLs `pass`, `found` matches the typed URL exactly |
| Rating | **Yes** | json-ld · `aggregateRating.ratingValue` · identity | all 3 URLs `pass`, including the Dell page — its JSON-LD genuinely carries `ratingValue: 0` as a no-reviews default, which happened to match the typed placeholder `0` |
| In stock | **No** | — | apple: `different_value`, found `"1"`, nearMisses `["0","false","Out of stock"]`. hp: `ambiguous`, nearMisses `["0","false","Laptop"]`. dell: `ambiguous`, nearMisses `["0","false","Laptop"]`. The mechanical chain is finding *something* (likely a stock-count or unrelated "1"/type field) that doesn't line up cleanly with the typed Yes/No boolean on any of the 3 pages. |
| Product code | **No** | — | apple: `not_found`, nearMisses `["Currys00366"]`. hp: `ambiguous`, nearMisses `["Currys00366","610840"]`. dell: `ambiguous`, nearMisses `["Currys00366","560608"]`. Genuine mismatch: the mechanical layer's SKU-shaped candidate is `Currys00366`-style, distinct from the page's visible "Product code: 428352/610840/560608" — the same visible-vs-schema SKU divergence the 2026-09-02 dogfood already flagged for this site. |
| Processor | **No** | — | all 3 URLs `not_found`, no nearMisses. The mechanical/JSON-LD/meta/xpath chain has no candidate for this free-text spec line on any page — plausibly needs AI. |

`weakEvidence` and `incomplete` are `false` for every field, certified or not — no field was flagged as ambiguously-passing or partially-evaluated; the 3 red fields are clean, confident failures (`different_value` / `ambiguous` / `not_found`), not near-misses waiting on a tiebreaker.

**Paid upper bound**: **3 red fields × $0.05 = $0.15** (In stock, Product code, Processor — the only fields AI would actually be asked about on a paid re-verify, since `verify` only calls AI for fields with zero mechanical certifications and no `incomplete` flag).

### Raw status (trimmed — `results` cells shown as `found`/`status`/`reason` only, `certified` paths kept, HTML/screenshot bytes never present)

```json
{
  "id": "877552ef-3d9b-48da-8c7c-8ba66c1159d8",
  "startedAt": "2026-09-07T14:29:38.218Z",
  "completedAt": "2026-09-07T14:30:39.661Z",
  "allPassed": false,
  "stage": null,
  "aiCalls": 0,
  "costUsd": "0.0000",
  "errorMessage": null,
  "results": {
    "product_name": { "certified": [{ "path": "name", "source": "json-ld", "transform": "identity" }, "...3 more xpath candidates"], "incomplete": false, "weakEvidence": false, "cells": "all 3 URLs: status=pass" },
    "price": { "certified": [{ "path": "offers.price", "source": "json-ld", "transform": "identity" }], "incomplete": false, "weakEvidence": false, "cells": "all 3 URLs: status=pass, found=1999.00/599.00/979.00" },
    "brand": { "certified": [{ "path": "brand.name", "source": "json-ld", "transform": "identity" }, "...1 more"], "incomplete": false, "weakEvidence": false, "cells": "all 3 URLs: status=pass" },
    "main_image": { "certified": [{ "path": "image", "source": "json-ld", "transform": "first_of_list" }, "...4 more"], "incomplete": false, "weakEvidence": false, "cells": "all 3 URLs: status=pass" },
    "rating": { "certified": [{ "path": "aggregateRating.ratingValue", "source": "json-ld", "transform": "identity" }], "incomplete": false, "weakEvidence": false, "cells": "all 3 URLs: status=pass, found=4.6/4.2/0" },
    "in_stock": { "certified": [], "incomplete": false, "weakEvidence": false, "cells": {
      "apple": { "status": "fail", "reason": "different_value", "found": "1", "nearMisses": ["0", "false", "Out of stock"] },
      "hp": { "status": "fail", "reason": "ambiguous", "nearMisses": ["0", "false", "Laptop"] },
      "dell": { "status": "fail", "reason": "ambiguous", "nearMisses": ["0", "false", "Laptop"] }
    }},
    "product_code": { "certified": [], "incomplete": false, "weakEvidence": false, "cells": {
      "apple": { "status": "fail", "reason": "not_found", "nearMisses": ["Currys00366"] },
      "hp": { "status": "fail", "reason": "ambiguous", "nearMisses": ["Currys00366", "610840"] },
      "dell": { "status": "fail", "reason": "ambiguous", "nearMisses": ["Currys00366", "560608"] }
    }},
    "processor": { "certified": [], "incomplete": false, "weakEvidence": false, "cells": "all 3 URLs: status=fail, reason=not_found" }
  },
  "captures": {
    "apple": { "captureId": "a69c082d-f343-4a76-841a-283cca017593", "capturedAt": "2026-09-07T14:30:39.571Z", "screenshotUrl": "/captures/e9ac4242-1949-415a-8f74-a21bd0bf4916.png" },
    "hp": { "captureId": "42dafd7c-f843-446e-b500-d9e007e151ec", "capturedAt": "2026-09-07T14:30:39.620Z", "screenshotUrl": "/captures/7a3116ff-d595-41e1-a62f-0278e178e4e9.png" },
    "dell": { "captureId": "b2f65e4f-eaf9-4e9a-9a04-167506035eee", "capturedAt": "2026-09-07T14:30:39.661Z", "screenshotUrl": "/captures/923dab98-e9c6-4594-a8e8-aaec96a686c1.png" }
  }
}
```

## UI observations (dashboard Schema tab, Run 3 screenshot)

Screenshot (overwritten, now shows Run 3's successful mixed-result state): `docs/testing/screenshots/2026-09-07-schema-verification-precheck.png`

- Correct: header now reads **"5 of 8 fields verified"**, matching the per-field table above exactly.
- Correct: "Verify · mechanical only" button label still correctly reflects `aiAvailable: false`.
- Correct: certified cells (Product name, Price, Brand, Main image, Rating) render with a green border on all 3 URL columns; the 3 uncertified fields (In stock, Product code, Processor) render red.
- Correct and a real improvement: the price cells additionally show a small `found: 1999.00` / `found: 599.00` / `found: 979.00` sublabel under the green box — good, unobtrusive evidence surfacing.
- Big improvement over Runs 1–2: uncertified cells now show a friendly, specific, human-readable reason instead of a raw stack trace or ANSI-garbled call log — e.g. "We couldn't find this value on this page. Check the value, or open the page and copy it exactly. AI is unavailable on this machine, so only the mechanical search ran." and "Several places on the page match. Add to the description what distinguishes the one you want. AI is unavailable on this machine, so only the mechanical search ran." Both messages correctly self-disclose that AI was unavailable, which matches the intended mechanical-only precheck.
- No error banner at all this run (there is nothing to show — `errorMessage: null`), which is itself confirmation the two prior bugs are gone in this environment.

## What was NOT done (by design, Step 1 scope)

- No `crawl.*` call, no Extract, no Confirm, in any of the three sessions.
- No AI call of any kind across all four verify attempts total (Run 1 ×1, Run 2 ×2, Run 3 ×1) — `aiCalls: 0`, `costUsd: 0.0000` every time.
- No source code was modified by this pre-check to work around either bug — both the `__name` fix (`e32825b`) and the `setContentEvaluate` fix (`6afcbfd`) were landed by the coordinator/Marko between sessions.
- Dev servers (api-server:4000, dashboard:3456) were started and killed by this session only; nothing was committed.
