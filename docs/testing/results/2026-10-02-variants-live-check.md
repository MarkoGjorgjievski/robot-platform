# Variants verification, live on real shops — 2026-10-02

The free live check of variants plans 1–2 (spec `docs/superpowers/specs/2026-10-01-variants-design.md`
§3–§4) on `main` at `f102e78`: set a website up in the app, confirm and spot-check its variants on
the Verification tab, Verify for free, and see whether the Variants row turns green and Go to Extract
unlocks. Script: `docs/testing/ui-check-app-variants.mts` (phases; run from `packages/browser`).
Screenshots: `docs/testing/results/screens-2026-10-02-variants/`.

**Cost: $0.00.** All setup and answers were done in the everyday app on :3000 (→ :4000): captures,
detection, suggestions and answers use no model. Verify was never clicked in the app. Every Verify
was a tRPC call to a second api-server on :4100 started with `ANTHROPIC_API_KEY=` and the browser's
own `robot_session` cookie (it carries over: cookies are per host, not per port). Before each of the
four `sources.verify` calls, `sources.verifyEstimate` on :4100 answered `aiAvailable: false,
upperBoundUsd: 0`; every run finished with `aiCalls: 0, costUsd: 0`. The :4100 server was stopped by
port afterwards and the port is free; Marko's :4000 / :3000 / :3456 were not touched.

Identity: one throwaway `check-1790929693717@example.com`, signed up through `/login`; one project per
site, all three deleted at the end. Page loads on the real shops: three products plus a few checked
variant pages each, plus a handful of headless probes to choose the sites.

## Results

| Site | Method | Variants found (products 1/2/3) | Confirmed | Verify | Row | Go to Extract |
|---|---|---|---|---|---|---|
| **A1 Allbirds** (Shopify, JSON-LD `ProductGroup.hasVariant`) | list | 52 / 124 / 207 ("sizes") | the three counts; first variant checked — no suggestion on it | run 1 (fields + variants): fields 3/3 verified, **variants failed** on all three ("Price on the checked variant of product n isn't in the list — check the value or mark it from the product page") | red | locked |
| | | | then every checked-variant field set "From the product page" (Price, SKU, Size, Colour) | run 2 (variants only, `onlyKeys: []`): **passed**, `entryPaths: {}` | green, verified | **unlocked** — but see defect 2 |
| **A2 Everlane** (Shopify, JSON-LD `ProductGroup.hasVariant`) | list | 6 / 6 / 6 | the three counts; accepted the checked variant's suggested Price and SKU on each | fields 2/2 + **variants passed**; `entryPaths: { price: offers.price, sku: mpn }` | green, verified | **unlocked** |
| **B Nike** (colourway swatches are links to separate pages) | links | 4 / 18 / 18 ("options") | the three counts; checked pages Black/Black (p1) and White/Marrakesh/… (p2, p3) captured "ready" | fields 2/2 + **variants passed**; collector `//*[@id='colorway-picker-container']//a/@href`; each checked page "passed" | green, verified | **unlocked** |

### What detection found

- **Allbirds** — "Listed in the page data: 52 variants on product 1, 124 on product 2, 207 on product 3 ·
  Linked as separate pages: 4 links per product · Only in a picker on the page: colours, swatchs,
  defaultcolornames". Axes Size (8, 8.5, 9…) and Colour (values like "Men's Runner NZ Slip On -
  Mushroom (Mushroom Sole)"); both minted as new columns. The "4 links" group is breadcrumbs and
  "Women's sizes", not variants (not chosen).
- **Everlane** — "Listed in the page data: 6 variants on every product · Linked as separate pages: 3
  links on product 1, 4 on product 2, 4 on product 3 · Only in a picker on the page: unstyleds,
  swatches, sizes, styles". No axis (the size is only inside each entry's `name`), so the step adds
  "Nothing of this kind on these products yet. Add a product with variants to check it."
- **Nike** — "Listed in the page data: 20 / 33 / 33 variants" (sizes across colourways) and "Linked as
  separate pages: 4 links on product 1, 18 on product 2, 18 on product 3". Choosing Linked offered two
  axes: **Option** = the colourway picker (White/White, Black/Black, White/Black, Design your own
  Nike By You product…) and **Colour** = "Learn more, Return policy exclusions apply, Pick-up available
  at select Nike Stores." Both were minted with the defaults.

### Time per step (wall clock, from the script)

| Step | Allbirds | Everlane | Nike |
|---|---|---|---|
| Project, fields, variants on, website | 4.3 s | 4.4 s | 4.3 s |
| Products | Find products 35.4 s (161 found) | listing 76.8 s, wrong links (below); pasted 3 pages 2.7 s | pasted 3 pages; p1 failed (redirect), re-pasted canonical 31.3 s |
| Three screenshots ready | 18.2 s | 27.3 s | (incl. above) |
| Variants step: choose + Confirm | 1.8 s | 1.8 s | 1.8 s |
| Confirm the three counts | 5.1 s | 5.1 s | 5.1 s |
| Spot-check (expand, accept / wait for checked pages) | 6.6 s, then 14.5 s ("From the product page" ×12) | 10.5 s | 29.8 s (three variant pages captured) |
| Verify on :4100 to completion | 4.7 s (fail), 1.1 s (pass) | 4.3 s | 6.4 s |

## Defects

1. **Stub entries counted as variants; the customer cannot reach a real one (Allbirds).** Allbirds'
   `hasVariant` holds 39 URL-only entries (`{"@type":"Product","url":".../mens-runner-nz-slip-on?size=8"}`
   — the other colourways' sizes) before the 13 real entries of the page's own colour. Detection and
   the row count all 52 (124, 207); the stubs are labelled "Variant 1…39"; the checked variant
   defaults to Variant 1, which has no value to suggest; and "Check this one" is offered only for the
   first 8 labels — all stubs — so a customer cannot pick an entry with data. Verify then fails with
   "Price on the checked variant of product n isn't in the list — check the value or mark it from the
   product page", which reads as a wrong value although nothing was answered.
   Screens: `A-3-spot.png`, `A-4-after-verify-1-stubs.png`.
2. **Variants certify with no variant-level path at all.** On the same Allbirds website, setting every
   checked-variant field "From the product page" — including the axis columns **Size** and **Colour**,
   which cannot be the same for every variant — makes the variants-only Verify pass (`entryPaths: {}`,
   `fromProduct: [price, sku, size, colour]`), turns the row green and unlocks Go to Extract on counts
   that are three-quarters stubs. "From the product page" should not be offered for an axis column, and
   a list with no entry path should not certify. Screen: `A-4-after-verify-2-from-product.png`.
3. **The entry SKU path is `mpn`, not `sku` (Everlane).** The checked variant's SKU suggestion is the
   entry's `mpn` (a barcode, "0-00000-52277-9"), and it certified as `entryPaths.sku = mpn`, while the
   entries also carry `sku` — the product-level SKU certified on `hasVariant[0].sku`
   ("M-T-CTN-ORGN-CR-WHT-XS"). Variant rows would carry a different identifier from the product row.
   On products 2 and 3 the `mpn` reads as a comma-joined pair ("0-00001-06712-5,0-00001-67193-3"), and
   the variant labels are these barcodes, not the size. Screens: `A2-3-spot.png`, `A2-4-after-verify.png`.
4. **Non-variant link groups are offered as variant axes (Nike, Allbirds).** On Nike, Linked as separate
   pages proposes the colourway picker as "Option" and a group of help links ("Learn more, Return
   policy exclusions apply, Pick-up available at select Nike Stores.") as "Colour", and Confirm with
   the defaults mints both as project columns — the real colours land in "Option", a junk "Colour"
   column is created. On Allbirds the "4 links per product" are breadcrumbs and "Women's sizes".
   Screen: `B-2-step-links.png`.
5. **A customise link is counted and certified as a colour (Nike).** The colourway group includes
   "Design your own Nike By You product" (`/u/custom-nike-air-force-1-low-by-you-shoes-…`), so the
   counts are 4 / 18 / 18 with it inside, and the certified collector picks it up; plan 3 would load it
   as a variant page. There is no way to drop one entry from a confirmed group. Screens:
   `B-2b-links-expanded.png`, `B-4-after-verify.png`.
6. **Wording: picker names leak raw tokens.** "Only in a picker on the page: colours, swatchs,
   defaultcolornames" (Allbirds), "unstyleds, swatches, sizes, styles" (Everlane). Screens:
   `A-2-step-list.png`, `A2-2-step-list.png`.
7. **Wording: contradictory step (Everlane).** "Listed in the page data: 6 variants on every product"
   followed, with that method selected, by "Nothing of this kind on these products yet. Add a product
   with variants to check it." — it means no axis was found, not no variants. Screen: `A2-2-step-list.png`.
8. **Wording: the count's noun is the first axis.** The Allbirds row says "52 sizes" for entries that
   are colour × size (the step says "52 variants"); Nike's says "4 options".

Not variants defects, seen on the way: Everlane's listing (`/collections/mens-tshirts`) gave "93
products found" that were collection links (screen `A2-0-listing-picked-collections.png`; worked
around by pasting product pages); a Nike product URL that redirects to its canonical slug failed its
screenshot ("redirected to …") until the canonical URL was pasted; `verificationStatus.allPassed` is
`true` on a run whose variants failed (it covers fields only — Extract stayed locked, so nothing leaks).

## How to rerun

```
cd packages/api-server && ANTHROPIC_API_KEY= PORT=4100 pnpm exec tsx src/index.ts   # background
cp docs/testing/ui-check-app-variants.mts packages/browser/src/__variants-check.mts
cd packages/browser
pnpm exec tsx src/__variants-check.mts signin
pnpm exec tsx src/__variants-check.mts setup --tag B --site https://www.nike.com/ --fields "Title Text,Price Money" \
  --products "https://www.nike.com/t/air-force-1-07-mens-shoes-DZejrQoC/CW2288-111,https://www.nike.com/t/air-force-1-07-lv8-mens-shoes-5PBzpHVE/IM5752-300,https://www.nike.com/t/air-force-1-07-lv8-denim-mens-shoes-5PBzpHVE/IR0951-400"
pnpm exec tsx src/__variants-check.mts accept-cell --tag B --row 'all agreed \(2\)'
pnpm exec tsx src/__variants-check.mts step --tag B --method links
pnpm exec tsx src/__variants-check.mts counts --tag B
pnpm exec tsx src/__variants-check.mts spot --tag B
pnpm exec tsx src/__variants-check.mts verify --tag B      # :4100 only; stops unless aiAvailable is false
pnpm exec tsx src/__variants-check.mts after --tag B
pnpm exec tsx src/__variants-check.mts cleanup --tag B
rm src/__variants-check.mts
```

Then stop the :4100 server by port (`Get-NetTCPConnection -LocalPort 4100`, check the command line is
the tsx api-server, `Stop-Process`).
