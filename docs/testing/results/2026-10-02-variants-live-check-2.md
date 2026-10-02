# Variants verification, live on real shops, second run — 2026-10-02

A re-run of the free live check in `2026-10-02-variants-live-check.md` after the fixes in
`docs/superpowers/plans/2026-10-02-variants-plan2b-live-check-fixes.md`, on branch
`fix/variants-live-check` at `8ed0b40`, on the same three shops and the same product pages. Script:
`docs/testing/ui-check-app-variants.mts` (unchanged). Screenshots:
`docs/testing/results/screens-2026-10-02-variants-2/`.

**Cost: $0.00.** Setup and answers in the app on :3000 (→ Marko's :4000). Verify never clicked in the
app; every `sources.verify` (four in all) was a tRPC call to a second api-server on :4100 started
from this branch with `ANTHROPIC_API_KEY=`. Before each one `sources.verifyEstimate` on :4100 answered
`aiAvailable: false, upperBoundUsd: 0`; every run ended `aiCalls: 0, costUsd: 0`. The :4100 server was
stopped by port afterwards (process confirmed as the `tsx src/index.ts` api-server, not :4000's
`tsx watch`) and the port is free. :4000 / :3000 / :3456 were not touched.

**:4000 was running the fixed code.** Its child process restarted at 13:50:14, the moment the last
api/scraper file of the plan was saved, and it reported Allbirds' new counts (13 / 14 / 14, not
52 / 124 / 207). The setup-side results below are therefore from the app as Marko runs it; the
detection details were also read from :4100 (`sources.detectVariants`) and agree.

Identity: one throwaway `check-1790942483940@example.com`; one project per site, all three deleted
(`projects.list` empty afterwards). Page loads: the three product pages per site, plus Nike's two
checked colourway pages (both reused fresh captures).

Product pages (the earlier run's, recovered from its captures; this time pasted for all three shops):
- Allbirds: `/products/mens-runner-nz-slip-on-mushroom`, `/products/mens-cruiser-medium-grey`,
  `/products/mens-tree-runner-nz-medium-grey` (fields Title, Price, SKU)
- Everlane: `/products/mens-organic-cotton-crew-tee-white`,
  `/products/mens-essential-organic-crew-uniform-white`, `/products/mens-surplus-tee-black` (Title
  dropped as before — it is the brand; fields Price, SKU)
- Nike: the three URLs in the first file's "How to rerun" (fields Title, Price); no redirect this time

## Results

| Site | Method | Variants (products 1/2/3) | Confirmed | Verify (:4100) | Row | Go to Extract |
|---|---|---|---|---|---|---|
| **Allbirds** | list (`json-ld hasVariant`), columns Size + Colour | **13 / 14 / 14 variants** | the counts; checked variant = size 8, a real entry, with suggestions for Price, SKU, Size, Colour | run 1 — the loophole attempt (below): fields 3/3 verified, **variants failed**, `problem: "Nothing is read from the variants — check at least one value of the checked variant"`. Run 2 (variants only) after accepting the four suggestions: **passed**, `entryPaths: { price: offers.price, sku: sku, size: axis size, colour: axis color }` | red, then green "verified" | locked, then **unlocked** |
| **Everlane** | list (`json-ld hasVariant`), no columns | 6 / 6 / 6 variants | the counts; accepted the checked variant's suggested Price and SKU (`M-T-CTN-ORGN-CR-WHT-XS`, not the barcode) | fields 2/2 + **variants passed**; `entryPaths: { sku: sku, price: offers.price }` | green "verified" | **unlocked** |
| **Nike** | links, one column "Option" | 3 / 17 / 17 options | the counts; checked pages Black/Black (p1), White/Marrakesh/… (p2, p3), both "ready" | fields 2/2 + **variants passed**; collector `//*[@id='colorway-picker-container']//a/@href`; each checked page "passed" | green "verified" | **unlocked** |

### The loophole attempt (Allbirds)

1. `saveVariantAnswer` on :4100 with Price, SKU, Size and Colour all `fromProduct` → refused:
   `400 "Size differs per variant — it must come from the list"`.
2. The app never offers it: Size and Colour have no "From the product page" option (screen
   `A-2b-expanded.png`).
3. `saveVariantAnswer` with only Price and SKU `fromProduct` and nothing read from the list → the app
   shows "Check one variant of product 1" and its Verify button reads "Verify variants · free"
   (disabled). Verify on :4100 anyway: variants **failed**, `problem: "Nothing is read from the
   variants — check at least one value of the checked variant"`, `entryPaths: {}`, row red, Extract
   locked (screen `A-4-after-verify-1-loophole.png`). The per-page message, though, is the wrong
   one — see new defect N1.

### What detection found

- **Allbirds** — "Listed in the page data: 13 variants on product 1, 14 on product 2, 14 on product 3 ·
  Linked as separate pages: 2 links per product · Only in a picker on the page: colours — not
  collected in this version". The stubs are gone; labels read "8/Men's Runner NZ Slip On - Mushroom
  (Mushroom Sole)". Axes Size and Colour; with two columns the row's noun is "variants". The "2
  links" are the product page itself and "Women's Sizes" (not chosen; see N2).
- **Everlane** — "Listed in the page data: 6 variants on every product · Linked as separate pages:
  none on product 1, none on product 2, 2 links on product 3 · Only in a picker on the page: sizes,
  styles — not collected in this version", then "These variants have no colour or size in the page
  data — they will be told apart by their SKU". Variant labels are now the SKUs (`…-WHT-XS`, `…-WHT-S`).
  The "2 links" on product 3 are "Archive Crew" (another product) and "View full details" (itself).
- **Nike** — "Listed in the page data: 18 / 17 / 17 variants · Linked as separate pages: 3 links on
  product 1, 17 on product 2, 17 on product 3". Choosing Linked offers one axis only, **Option** =
  the colourway picker (White/White, Black/Black, White/Black, …). No "Design your own" link, no help
  links, no "Colour" column.

### Time per step (wall clock, from the script)

| Step | Allbirds | Everlane | Nike |
|---|---|---|---|
| Project, fields, variants on, website | 4.5 s | 4.5 s | 4.4 s |
| Paste three product pages | 2.7 s | 2.7 s | 2.6 s |
| Three screenshots ready | 10.1 s | 30.3 s | 12.2 s |
| Variants step: choose + Confirm | 1.7 s | 1.8 s | 1.8 s |
| Confirm the three counts | 5.1 s | 5.1 s | 5.1 s |
| Spot-check (expand, accept / wait for checked pages) | 14.5 s | 10.6 s | 6.6 s |
| Verify on :4100 to completion | 1.1 s (fail), 1.1 s (pass) | 1.1 s | 3.2 s |

## The eight defects

| # | Defect (first run) | Verdict | Evidence |
|---|---|---|---|
| 1 | Allbirds stub entries counted; no real variant reachable | **fixed** | 13 / 14 / 14 (were 52 / 124 / 207); checked variant is size 8 with Price 105, SKU A12633M080, Size 8, Colour suggested; every "Check this one" is a real size. `A-2-step-list.png`, `A-2b-expanded.png` |
| 2 | Variants certify with no variant-level path | **fixed** | Size/Colour not offered "From the product page"; the API refuses them (400 "Size differs per variant — it must come from the list"); everything-else-from-product fails with "Nothing is read from the variants…"; passes only with `entryPaths` read from the list. `A-4-after-verify-1-loophole.png`, `A-4-after-verify.png` |
| 3 | Everlane entry SKU certified on `mpn` | **fixed** | suggestion is the entry `sku`; certified `entryPaths.sku = sku`; labels are SKUs, not barcodes. `A2-3-spot.png`, `A2-4-after-verify.png` |
| 4 | Non-variant link groups offered as axes | **fixed on Nike; residue elsewhere** | Nike: one group, one axis, no junk "Colour" column (`B-2-step-links.png`). The colourways are still named "Option", not "Colour". Allbirds' and Everlane's step still count a 2-link group (the page itself + one other product) under "Linked as separate pages" — not offered as an axis unless chosen (N2) |
| 5 | "Design your own" link counted and certified | **fixed** | counts 3 / 17 / 17 (were 4 / 18 / 18); `detectVariants` on :4100 lists no `/u/…` link; certified collector unchanged and passes. `B-3-spot.png`, `B-4-after-verify.png` |
| 6 | Picker names leak raw tokens | **fixed** | "colours" (Allbirds), "sizes, styles" (Everlane); Nike shows no picker line. `A-2-step-list.png`, `A2-2-step-list.png` |
| 7 | Contradictory "Nothing of this kind" on Everlane | **fixed** | "These variants have no colour or size in the page data — they will be told apart by their SKU". `A2-2-step-list.png` |
| 8 | Count's noun is the first axis | **fixed** | Allbirds (two columns): "13 variants"; Everlane (no columns): "6 variants"; Nike (one column): "3 options", as designed |

## New or remaining defects

- **N1. Wrong advice for an unanswered column (Allbirds).** When the checked variant's Size has no
  answer, each page fails with "Size on the checked variant of product n isn't in the list — check the
  value or mark it from the product page" — but Size can no longer be marked from the product page,
  and the value was never given, not wrong. Only reachable through the API here (the app blocks
  Verify until a value is read from the list), so low impact. Screen `A-4-after-verify-1-loophole.png`.
- **N2. Self-plus-one link groups still detected (Allbirds, Everlane).** "Linked as separate pages: 2
  links per product" on Allbirds is the product page itself and "Women's Sizes"; on Everlane product 3
  it is "View full details" (itself) and "Archive Crew". A group containing the page's own URL plus one
  other product is not a variant group. Harmless unless chosen; the breadcrumb part of defect 4 is gone.
- **N3. Nike's colourways land in a column named "Option".** The colourway picker is the right group,
  but its axis is named "Option" and the row says "options"; the earlier run's junk "Colour" column was
  what held the name. Cosmetic; the customer can rename the column.

Not variants defects: none seen this time (no listing used, no redirect).

## How to rerun

As in the first file, with `SHOTS_DIR=../../docs/testing/results/screens-2026-10-02-variants-2` and
the product pages above (`setup --products …` for all three shops; Everlane then
`delete-field --field Title`). The loophole attempt is two `sources.saveVariantAnswer` calls on :4100
(all four entry fields in `spot.fromProduct`, then only Price and SKU with `expected: {}`) followed by
`verify --tag A`; reset the answer (no `spot`) before the `spot` phase.
