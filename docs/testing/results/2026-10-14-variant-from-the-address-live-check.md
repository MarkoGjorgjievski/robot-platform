# The variant the address names — live check, 2026-10-14

Signed in as `credit-campaign@example.com` through the app's `/login` form (headless Playwright,
1440×1000, one Chromium at a time, scripted from the scratchpad, against the already-running
main servers: api-server :4000, app :3000, on `main` at commit `902a53e`). Database read with
SELECT only. Spec: `docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md` §13
"Live, free". Project `campaign-2-2026-10-11`. Screenshots:
`docs/testing/results/screens-2026-10-14-variant/` (8 files).

**Summary.** No Verify was clicked on any of the four websites: Ruggable's and Glossier's buttons
showed a dollar amount, Kith's showed one and was disabled, and Skullcandy's read
`Everything is verified` (disabled, nothing changed). So **no `[page]` path was certified
anywhere** and Verify's new behaviour was not exercised live. The Verification tab's new row
warning was seen, on exactly the rows the spec predicts. One Extract ran (Skullcandy, 10 rows,
$0), with no wrong-variant failures; its planned addresses named no variant.

## Ruggable

Proof addresses all name a size: `…/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr`,
`…/morris-and-co-pimpernel-jade-tufted-rug?size=6x9&system=rug-cvr`,
`…/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-cvr`.

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1 | Site note; SELECT latest `source_verifications` | — | Note: blocked at Verify 7/8, Price `0/3` on the 6'x9' price. Latest row `151d9713…`: started 2026-10-12 14:07:24, completed 14:07:35, **`all_passed = false`**. Certified: **price `[]`** (cells `ambiguous` / `different_value 1161.75` / `ambiguous`); **in_stock `hasVariant[0].offers[0].availability`** (json-ld) + `data.product.variants.edges[0..3].node.availableForSale` (api); **sku `[0].vendorCode`**, `[0].productCode` (api). Main image `hasVariant[0].image` | — |
| 2 | Open Verification | Warning where a proof address names a variant and the path is a fixed index | **`reads the first variant, not the one the address names on product 1`** under two rows: **Main image** (`hasVariant[0].image`) and **In stock** (`hasVariant[0].offers[0].availability`). None under SKU (`[0].vendorCode` is not on a variant-list key — consistent with the spec's rule). Price `fails on products 1, 2 and 3 0/3`; SKU cells read `…-06x09not on this page` ×3 | `ruggable-01-verification-before.png` |
| 3 | Read the Verify button | No `$` → click | **`Re-verify 1 field · up to $0.05`** — a dollar amount, **not clicked**; step stopped | same |
| 4 | What certified after Verify | `offers[page].price` or similar | **Not reached** — no Verify ran | — |
| 5 | Extract | — | **Not reached**: `Go to Extract` disabled, `Unlocks when every field is verified` | — |

## Skullcandy

Proof addresses name **no variant** (`/products/crusher-evo-sensory-bass-headphones-with-personal-sound`,
`/products/slyr-pro-multi-platform-wired-gaming-headset`, `/products/grom-wireless-headphones-for-kids`;
the `?variant=` ones were replaced during campaign 2).

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1 | Site note; SELECT latest `source_verifications` | — | Note: done, 8/8, run 60/60, judge found In stock wrong on 7 `?variant=` pages. Latest row `3ee29a5f…`: 2026-10-12 14:44:44 → 14:44:48, **`all_passed = true`**. Certified: **price** `offers.price` (json-ld), `data.offers.price`, `product.variants[0].price`, `hasVariant[0].offers.price`, `og:price:amount`; **in_stock `hasVariant[0].offers.availability`**; **sku `hasVariant[0].sku`**, `product.variants[0].sku` | — |
| 2 | Open Verification | No warning (no proof address names a variant) | `Everything is verified` / `Nothing has changed since the last verification`; every row `verified`; **no address warning**. New: proof page 2's card reads **`That page doesn't exist on skullcandy.com (404). Check the address.`** (SLYR Pro has gone) | `skullcandy-01-verification-before.png` |
| 3 | Read the Verify button | No `$` → click | **`Everything is verified`** [disabled] — nothing to click | same |
| 4 | What certified | `[page]` path where addresses name variants | Unchanged from row `3ee29a5f…` above: fixed-index paths, no `[page]` path. Expected, since no proof address names a variant | — |
| 5a | Extract tab, custom 10 × custom 1 | No `$` → click | Budget line **`1 listing · first 10 products from each · first 1 page of each · safety stop at 5,000 products per listing`**; button **`Extract`** (no amount). Clicked 15:39:22Z; `Open the run` appeared | `skullcandy-02-extract-before.png` |
| 5b | Poll `runs` | Completes | Run **`a3d0ab4e-1daa-48d6-a2ac-2e00e83afccd`**: 15:39:22 → 15:42:56, **`status = completed`**, **`result_count = 10`**, **`cost_usd = 0.0000`**. 11 run items (1 listing + 10 detail), all `done` | — |
| 5c | Wrong-variant failures | Any `The page did not show the variant the address names (…)` | **0** run items with that error. **None of the 10 planned addresses carries `?variant=`** (e.g. `/products/hesh-540-anc-noise-canceling-headphones`, `/products/crusher-540-active`), unlike campaign 2's run, which had `?variant=` duplicates (34 distinct of 60). So the wrong-variant verdict had nothing to fire on | — |
| 5d | 5 rows' variant fields (price / in_stock / sku) | — | `hesh-540-anc…` 159.99 / `false` / S6HAW-T001; `crusher-540-active` 229.99 / `true` / S6EVW-U054; `dime-360` 59.99 / `true` / S2DPW-U054; `crusher-anc-2…` 169.99 / `true` / S6CAW-S801; `crusher-720-headphones` 139.99 / `true` / S6CEW-T740 | — |
| 5e | Run page | — | `Done`, `10 of 10 extracted`, summary **`10 rows · 100% confidence · 20 values not shown on their page`**; column heads `Title`, `Price`, `Main imagenot checked`, `SKU10 not shown`, `Brand10 not shown`, `In stocknot checked`, `Rating`, `Description`; panel **`SKU: 10 of 10 values are not on the product's page · from json-ld (hasVariant[0].sku)`** and **`Brand: 10 of 10 values are not on the product's page · from api (product.vendor)`** | `skullcandy-03-run.png` |
| 5f | Open 2 product pages, compare | Values match the shown variant | **Hesh® 540 ANC**: page `$159.99`, `Color: Bone`, `OUT OF STOCK` / `NOTIFY ME WHEN AVAILABLE` — stored 159.99 / `false`: **match**. **Crusher® 540 Active**: page `$229.99`, `Color: Skullcandy X Baker Skateboards`, `ADD TO CART` — stored 229.99 / `true`: **match**. (Neither address names a variant; this is the preselected one) | `skullcandy-04-pdp-hesh540.png`, `skullcandy-05-pdp-crusher540.png` |

## Kith

Proof addresses name no variant (the picker's preselected size decides).

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1 | Site note; SELECT latest `source_verifications` | — | Note: blocked before Verify, Rating absent on every product. **No `source_verifications` row exists** for kith. `verification_set.absent.rating` = all three URLs. Typed In stock `In stock` ×3, SKU `2000369947` / `2000372393` / `2000372078`, Price 810 / 975 / 810 | — |
| 2 | Open Verification | — | No status on any row (never verified); **no address warning**; `Rating needs a value on at least two products` | `kith-01-verification-before.png` |
| 3 | Read the Verify button | No `$` → click | **`Verify 8 fields · up to $0.40`** [disabled] — a dollar amount and disabled; **not clicked**. Getting past it would need Rating values Kith does not have; not retyped (brief) | same |
| 4–5 | Certify, Extract | — | **Not reached**; `Go to Extract` disabled | — |

## Glossier

Proof addresses all name a variant: `…/milky-jelly-cleanser?variant=44415832752373`,
`…/priming-moisturizer-rich?variant=43781983076597`, `…/glossier-after-baume?variant=44416231604469`.

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1 | Site note; SELECT latest `source_verifications` | — | Note: stopped at Verify 6/8 (Main image, SKU). Latest row `66146249…`: 2026-10-12 10:25:51 → 10:26:13, **`all_passed = false`**. Certified: **price `product.variants[0].prices[0].unit_price`** (api; the proving path on all three cells), `product.variants[0].prices[0].plans[5].discounted_price`, three XPaths; **in_stock `offers.availability`** (json-ld), `product:availability` (meta); **sku `[]`** (fails 0/3) | — |
| 2 | Open Verification | Warning on a fixed-index row | **`reads the first variant, not the one the address names on product 1`** under **Price** (`product.variants[0]…`). None under In stock (`offers.availability`, no index). Main image and SKU `fails on products 1, 2 and 3 0/3` | `glossier-01-verification-before.png` |
| 3 | Read the Verify button | No `$` → click | **`Re-verify 2 fields · up to $0.10`** — **not clicked**; step stopped. SKU would also need retyping (not on the page); not done | same |
| 4–5 | Certify, Extract | — | **Not reached**; `Go to Extract` disabled | — |

**Cost, precisely.** $0. One run: `a3d0ab4e-1daa-48d6-a2ac-2e00e83afccd`, `cost_usd = 0.0000`
(database). No `source_verifications` row was created on any of the four websites since
2026-10-14 00:00 (SELECT count = 0 each). Nothing showing a dollar amount was clicked.

## What this proved / did not

Proved:
- The Verification tab's address warning appears live, on exactly the rows the spec §6 rule
  predicts: Ruggable Main image (`hasVariant[0].image`) and In stock
  (`hasVariant[0].offers[0].availability`), Glossier Price (`product.variants[0]…`), all on
  proof pages whose address names a variant. It does not appear on `[0].vendorCode` (Ruggable
  SKU), on non-indexed paths, or on websites whose proof addresses name no variant (Skullcandy,
  Kith). It leaves the badge alone (`verified 3/3` beside it).
- A small Extract on Skullcandy still runs at $0 with 10/10 rows, no wrong-variant failure, and
  the two spot-checked rows match their pages' shown price and stock.

Did not prove:
- **No `[page]` path certified anywhere** — Verify's new matching (`offers[page].price`,
  `hasVariant[page]…`) was not exercised live. Every Verify button that could change something
  showed a dollar amount (Ruggable `up to $0.05`, Glossier `up to $0.10`, Kith `up to $0.40` and
  disabled).
- **The wrong-variant run verdict was not exercised**: the only run's planned addresses carried
  no `?variant=` (campaign 2's Skullcandy run had them), so no address named a variant.
  Skullcandy still certifies `hasVariant[0]…` paths, which would read the first variant on a
  `?variant=` address; that was not reached.
- Kith and Glossier remain blocked by project fields they lack (Rating; SKU), independently of
  this feature.
- Seen in passing: Skullcandy proof page 2 (SLYR Pro) now 404s; Skullcandy SKU and Brand are
  `not shown` on 10 of 10 rows.

## State left behind

- One new run on Skullcandy: `a3d0ab4e-1daa-48d6-a2ac-2e00e83afccd` (completed, 10 rows, $0)
  with its 11 run items and 10 extractions.
- Skullcandy's stored budget is now `{"mode": "first_n", "max_items": 10, "max_pages": 1}`
  (campaign 2 had used custom 60 products × 2 pages).
- No proof page address, typed value, verification or other customer data was changed on any
  of the four websites.
