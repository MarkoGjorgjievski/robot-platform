# Certification picks the right path, live on Ikea — 2026-09-29

The free live run of spec `docs/superpowers/specs/2026-09-29-certification-picks-the-right-path-design.md`
(§5; plan `docs/superpowers/plans/2026-09-29-certification-picks-the-right-path.md`, Task 6), and
the read-only audit of already-certified websites (§4). Script:
`docs/testing/ui-check-app-verification.mts`, updated for the new rows. The previous run on the same
listing: `docs/testing/2026-09-28-table-first-live.md` (24 clicks); plan 5's, before the table:
`docs/testing/2026-09-25-verification-live.md` (43).

**Cost: $0.00.** A second api-server on :4100 with `ANTHROPIC_API_KEY` empty (`verifyEstimate`
answered `aiAvailable: false`, `upperBoundUsd: 0`, checked before anything else), the app on :3100
pointed at it, and the Verify label asserted to end "· free" with no dollar amount before each
click. Verify was clicked three times in all (three Ikea Cabinets runs), all on :4100. Marko's
`pnpm dev:all` (:4000 / :3000 / :3456) was not touched; both extra servers were stopped by port.

Identity: a throwaway `check-<timestamp>@example.com` per run, its own project, deleted at the end
of every run. The fields and listing are plan 5's: Ikea's six stored fields plus SKU and Brand, and
Ikea Malaysia's Cabinets category (`https://www.ikea.com/my/en/cat/cabinets-10409/`).

**The three products are not quite the same three.** The listing's first three are now BAGGEBO,
"Option: BILLY / OXBERG, Bookcase with doors, white" and "… brown walnut effect" (37 products,
was 35); SÅGMÄSTARE is gone from the top. So two of the three are combinations (an AggregateOffer,
`offers.offers[0].…`) and the single-offer product is the odd one — the same shape as before,
mirrored: the odd product is now product 1, not product 3.

## The final run (after the fix below)

| What | Measured |
|---|---|
| Find products → answer | **15.4 s**; "37 products found · a pager too" |
| Screenshots | all three ready together, **11.9 s** after the listing answered |
| Page data | 8 of 8 fields suggested on every product before any click |
| Rows before any click | **5 agreed** (Title, Product URL, Description, Main image, SKU) · **2 agreed but for one product**: Price and In stock, "different place on product 1 — check it · Accept" · **1 same everywhere** (Brand, "IKEA") · **0 need you** |
| The bar | "Accept all agreed (7)" — the two majority rows count |
| **Clicks to an enabled Verify** | **7** (2026-09-28: **24**; plan 5: **43**), Find products included |
| Verify | `Verify 8 fields · free`, enabled; **6.2 s** |
| Verdict | **8 of 8 verified**, no red cell, Go to Extract live |
| Errors in the page | none |

### Where the 7 clicks went

| Clicks | What |
|---|---|
| 1 | Find products |
| 1 | **Accept all agreed (7)** — five agreed rows on all three products, and Price and In stock on products 2 and 3 (their majority; product 1 left for a person) |
| 1 | **Accept Brand anyway** — "same on every product — check it" |
| 1 | Price on product 1: the cell's own **✓** ("Accept Price on product 1"; the row read "check product 1") |
| 3 | In stock on product 1: open the cell, expand the row, "Confirm In stock from the page data" — its value (`https://schema.org/InStock`) has no element on the screenshot, so the cell offers no ✓ |

SKU, which cost 7 clicks on 2026-09-28 ("found in 2 places"), is now agreed: A5 counts one
structured value shown in several places as one place.

### Which path each field certified

From `sources.verificationStatus` after the Verify (primary first; the per-product path is the one
that passed on products 1, 2, 3):

| Field | Certified | Passed on 1 / 2 / 3 |
|---|---|---|
| Title | json-ld name | json-ld name ×3 |
| Product URL | json-ld url, api pipUrl | json-ld url ×3 |
| Price | api price, api priceExclTax, api priceNumeral, api priceExclTaxNumeral, api revampPrice.integer | api price ×3 |
| **In stock** | **json-ld offers.offers[0].availability, json-ld offers.availability** | offers.availability / offers.offers[0].availability / offers.offers[0].availability |
| Description | json-ld description | json-ld description ×3 |
| **Main image** | **meta og:image, api mainImage.url, json-ld image[0].contentUrl** | meta og:image ×3 — **verified on all three** |
| SKU | json-ld sku, json-ld mpn, three XPaths to the product-identifier span | json-ld sku ×3 |
| Brand | json-ld brand.name | json-ld brand.name ×3 |

**In stock stands on `offers.availability` and nothing else** — no `api priority`, no
`[n].cashAndCarry` (Marko's 2026-09-28 run certified those). The combination's path comes first
because the customer confirmed it on two products (C1: a confirmed path goes first).

## Found by the run, and fixed

**`473e7e2` — a bare fragment or a lone dot counted as the page's own URL.** The first two runs
certified Product URL on `json-ld url | api pipUrl | api revampPrice.separator |
api otherConfigs.theme.tokens.--d-1 | api otherConfigs.theme.colors.primary`. A price separator
(`.`) and a theme colour (`#0058a3`) both resolve, against the page, to the page itself (the
fragment is dropped) — which is exactly a Product URL's expected value. `normalize('url' | 'image')`
now refuses a value that is a bare fragment or a lone `.` / `..` segment; one unit test. The third
run certified `json-ld url | api pipUrl` only. The audit below shows the same three junk paths on
Marko's Ikea website: they stay stored, but can no longer read as a URL.

## Seen, not fixed (for the handoff)

- **A value with no element on the screenshot gets no ✓** (A7 needs exactly one place), so In stock
  on the odd product took three clicks, not one. Offering the ✓ for a page-data value with no place
  would make this run 5 clicks.
- **The expanded In stock row's "Type it" box reads `https://schema.org/InStock`** on product 1
  after "Confirm from the page data": that answer is stored without a mark, so the box shows it as
  typed, raw. The cells read "In stock" (A6).
- **The ruling to hide the ✓ on a majority row's odd product was not in the code at this run**
  (fixed in the final fix wave: `cellAcceptable`). This run used that ✓ for Price on product 1; hidden, the
  run is 9 clicks (open the cell, tick the rectangle, confirm).
- Verify on a throwaway Ikea website again enriched the shared domain cache (plan 5's open
  decision stands).

## The audit (read-only)

`pnpm --filter @robot/api exec tsx src/scripts/audit-certified-paths.ts` against the local
database, 2026-09-29, re-run after the final fix wave widened the concept vocabulary (`:` now
separates meta-key segments; wider currency / availability / brand tails) (select queries only; it covers every organisation,
Marko's included, and writes nothing). A row is **NO** when the field is weak (yes/no, or one value
on every proof page) and a certified path is neither confirmed, nor a marked element, nor named
for the field.

```
website                     field            certified paths                                                         ok  why
--------------------------  ---------------  ----------------------------------------------------------------------  --  ----------------------------------------------------------------------
mar/competitor-prices/Ikea  Title            json-ld name                                                            ok
mar/competitor-prices/Ikea  Product URL      api pipUrl | api revampPrice.separator | api otherConfigs.theme.tokens.--d-1 | api otherConfigs.theme.colors.primary | api otherConfigs.theme.styles.link.color  ok
mar/competitor-prices/Ikea  Price            api price | api priceExclTax | api priceNumeral | api priceExclTaxNumeral | api revampPrice.integer  ok
mar/competitor-prices/Ikea  In stock         api priority | api [0].cashAndCarry | api [1].cashAndCarry | api [2].cashAndCarry | api [3].cashAndCarry  NO  yes/no field certified on paths that do not name it: api priority, api [0].cashAndCarry, api [1].cashAndCarry, api [2].cashAndCarry, api [3].cashAndCarry
mar/competitor-prices/Ikea  Description      json-ld description                                                     ok
default/acne/Ikea           Price            api price | api priceExclTax | api priceNumeral | api priceExclTaxNumeral | api revampPrice.integer  ok
default/acne/Ikea           Price currency   api revampPrice.currencyPrefix | api revampPrice.currencySymbol         ok
default/acne/Ikea           Title            api name | xpath //*[@id="overview"]/…/div[@class="pipf-text pipf-typography-heading-s"]  ok
default/acne/Ikea           Subtitle         xpath //*[@id="content"]/…/span[@class="… pipcom-price-module__description"] | xpath //body/div[2]/main/…/span[@class="… pipcom-price-module__description"]  ok
default/acne/Ikea           Product id       json-ld mpn | json-ld sku                                               ok
default/acne/Ikea           Product details  xpath //*[@id="product-details"]/…/p[@class="pipf-product-details-tab__paragraph"]  ok
default/acne/Ikea           Total reviews    api experimental.rating.count | json-ld aggregateRating.reviewCount     ok
default/acne/Ikea           Average rating   api experimental.rating.value | json-ld aggregateRating.ratingValue     ok

2 websites with a verification set, 0 never verified; 13 certified fields audited, 1 on paths that no longer qualify (1 websites).
```

The first run, before that fix, also flagged **Acne / Ikea — Price currency** on
`revampPrice.currencyPrefix` / `currencySymbol`: the vocabulary knew only `priceCurrency`-style
tails. `currencyPrefix` and `currencySymbol` do name a currency, so the field now qualifies.

(The four long XPaths are shortened with `…` here; the script prints them whole.)

**One website to re-verify, one field:**

- **Competitor prices / Ikea — In stock** on `api priority` and `[n].cashAndCarry`: the case the
  spec was written for. On the same website a fresh verification (this run's throwaway) certifies
  `json-ld offers.availability`.

Nothing was re-certified; the customer re-verifies it from the tab (free: the paths are
mechanical).

## How to run it again

```
cd packages/api-server && ANTHROPIC_API_KEY= PORT=4100 pnpm exec tsx src/index.ts      # keyless api-server
cd packages/app && VITE_API_URL=http://localhost:4100 pnpm exec vite dev --port 3100 --strictPort
cp docs/testing/ui-check-app-verification.mts packages/browser/src/__ui-check.mts \
  && cd packages/browser && pnpm exec tsx src/__ui-check.mts ; rm src/__ui-check.mts
pnpm --filter @robot/api exec tsx src/scripts/audit-certified-paths.ts                # the audit, read-only
```

Then stop both servers by port (`Get-NetTCPConnection -LocalPort 4100`, then 3100; check the
command line is yours before `Stop-Process`). The script now also prints each field's certified
paths and the path that passed on each product.

Screenshots: `docs/testing/screens/app-site-verification-ikea-{agreed,verified}-{dark,light}.png`.
