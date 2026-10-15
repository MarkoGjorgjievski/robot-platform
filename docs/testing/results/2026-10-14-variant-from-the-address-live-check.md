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

## Part 2, 2026-10-15 — the Re-verifies Marko approved

Same setup as above: signed in as `credit-campaign@example.com` through `/login`, headless
Playwright 1440×1000, one Chromium at a time, against the already-running main servers (not
restarted). Marko approved exactly two clicks that show a dollar amount: Ruggable's
`Re-verify 1 field · up to $0.05` and Glossier's `Re-verify 2 fields · up to $0.10`. Each was
clicked only after the script confirmed the button text was exactly that. Database: SELECT only.
Screenshots: `part2-*.png` in the same folder (4 files).

**Summary.** **Neither Verify passed** (`all_passed = false` on both), so no Extract ran, and
**no `[page]` path certified on either website**. A Re-verify only re-checks the fields that
failed. On Ruggable that was Price, which failed again with nothing certified. On Glossier it was
Main image and SKU, which both failed again. The fields carrying the address warning (Ruggable
In stock and Main image, Glossier Price) had passed before, so neither Re-verify checked them
again. Their fixed-index paths are still certified and **the warnings are still there**.
**Both verifications cost more than their buttons said**: Ruggable $0.1152 against "up to
$0.05", and Glossier $0.2451 against "up to $0.10".

### Ruggable

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1a | Read the button, click | `Re-verify 1 field · up to $0.05` | **`Re-verify 1 field · up to $0.05`** (enabled), matched exactly; clicked 2026-10-15 09:15:56Z. The tab then showed `Verifying`, `asking AI for price` and `Locked while this verification runs` | `part2-ruggable-01-before.png` |
| 1b | Poll latest `source_verifications` | Completes | Row **`5c4129c1-218c-47fa-8bf1-34a17e944422`**: 09:15:56 → 09:16:08, **`all_passed = false`**, **`ai_calls = 1`**, **`cost_usd = 0.1152`** (the button said up to $0.05). `error_message` empty, `variant_results` null. Captures reused from 2026-10-14 15:37 | — |
| 1c | Price (`aiCalled = true`) | `[page]` path such as `hasVariant[page].offers.price` / `product.variants[page]…` | **`certified = []`**. Typed values 499.00 / 449.25 / 424.15. Cells: Sierra **`fail` / `different_value`, found `374.25`**, near misses `499.00`, `126.75`, `374.25`. Morris & Co. **`fail` / `ambiguous`**, near misses `1549.00`, `599.00`, `449.25`. Cyrus **`fail` / `ambiguous`**, near misses `499.00`, `143.65`, `424.15`. Here `ambiguous` (certify.ts) means some candidate path reads the typed value on this page, but no single path is right on all three. Every page's typed value appears among its near misses, yet no one path finds it across the three | — |
| 1d | Other variant fields (not re-checked, `aiCalled = false`) | — | **In stock**: `hasVariant[0].offers[0].availability` (json-ld), `data.product.variants.edges[0..3].node.availableForSale` (api); 3× `pass`, found `http://schema.org/InStock`. **SKU**: `[0].vendorCode`, `[0].productCode` (api); 3× `pass` (`RUG-CVR-IND-RCT-TMP-FO026-06x09` etc.). **Main image**: `hasVariant[0].image`; 3× `pass`. All unchanged from 2026-10-12 | — |
| 1e | Verification tab after | Warning gone if a `[page]` path certified | **The warning is still there**: `reads the first variant, not the one the address names on product 1` under **Main image** and **In stock**, as before. Price `fails on products 1, 2 and 3 0/3`; the other rows `verified 3/3`. Button again `Re-verify 1 field · up to $0.05`; `Go to Extract` disabled | `part2-ruggable-02-after.png` |
| 2 | Extract | — | **Not reached**: Verify did not pass | — |
| 3 | Why it stopped | — | Price: no path certifies (above). Not retyped (brief) | — |

### Glossier

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1a | Read the button, click | `Re-verify 2 fields · up to $0.10` | **`Re-verify 2 fields · up to $0.10`** (enabled), matched exactly; clicked 2026-10-15 09:17:01Z | `part2-glossier-01-before.png` |
| 1b | Poll latest `source_verifications` | Completes | Row **`f9f797aa-ee3c-4b8a-ae4c-ad67292a7287`**: 09:17:01 → 09:17:22, **`all_passed = false`**, **`ai_calls = 2`**, **`cost_usd = 0.2451`** (the button said up to $0.10). `variant_results` null | — |
| 1c | Re-checked fields (`aiCalled = true`) | — | **SKU**: `certified = []`; 3× **`fail` / `not_found`**, no near misses (typed `AFB-000-00-00`, `MJC-000-00-00`, `PMR-000-00-00`). **Main image**: `certified = []`; 3× **`fail` / `not_found`**. Near misses were the page's `…-carousel-04…png` / `…-carousel-03.png` and Shopify's `no-image-2048…gif`; the typed values are `glossier-prod.imgix.net/…carousel-02…` addresses | — |
| 1d | Variant fields not re-checked (`aiCalled = false`) | `[page]` path for Price | **Price**: still `product.variants[0].prices[0].unit_price`, `product.variants[0].prices[0].plans[5].discounted_price` (api) plus three `pv-price__original` XPaths; 3× `pass` (34.00 / 24.00 / 35.00). **In stock**: `offers.availability` (json-ld), `product:availability` (meta); 3× `pass` | — |
| 1e | Verification tab after | Warning gone if a `[page]` path certified | **The warning is still there**: `reads the first variant, not the one the address names on product 1` under **Price**. Main image and SKU `fails on products 1, 2 and 3`. Button again `Re-verify 2 fields · up to $0.10`; `Go to Extract` disabled | `part2-glossier-02-after.png` |
| 2 | Extract | — | **Not reached**: Verify did not pass | — |
| 3 | Why it stopped | — | SKU and Main image: the typed values are not on the page (SKU) or not the page's image address (Main image). Not retyped (brief) | — |

### What Part 2 proved / did not

- **A `[page]` path is still unproven live.** A Re-verify re-checks only the fields that failed, and the
  warned fields had passed. To certify a `[page]` path on Ruggable In stock / Main image or Glossier Price,
  something must make those fields re-verify: a changed value or address, or a full Verify. Neither
  click did that. Ruggable Price did go through AI matching, and the typed 6'×9' value was a near
  miss on every page, but no single path, `[page]` or fixed, read it on all three.
- **The button's estimate was low on both clicks**: 2.3× ($0.1152 against $0.05) and 2.5× ($0.2451 against
  $0.10), at $0.115 to $0.123 per AI call against the estimate's $0.05 per field.
- The address warning stays after a failed Re-verify, which is consistent: the paths it names are
  still certified.

**Cost, precisely (both parts).** **$0.3603**: verification `5c4129c1…` (Ruggable)
`cost_usd = 0.1152` + verification `f9f797aa…` (Glossier) `cost_usd = 0.2451`. Part 1's run
`a3d0ab4e…` `cost_usd = 0.0000`. No runs on Ruggable or Glossier since 2026-10-15 00:00 (SELECT
count = 0). Nothing else that showed a dollar amount was clicked.

**State left behind (Part 2, in addition to Part 1's).**
- Two new `source_verifications` rows: Ruggable `5c4129c1-218c-47fa-8bf1-34a17e944422` and
  Glossier `f9f797aa-ee3c-4b8a-ae4c-ad67292a7287`, both `all_passed = false`. They are now each
  website's latest verification. What is certified did not change on either website.
- No proof page address, typed value, run or other customer data was changed. No server was
  restarted.

## Diagnosis of Ruggable's Price (controller, 2026-10-15)

The Sierra proof page's stored capture (`9f123f6d….capture.json`) carries the page variant the
feature computes: `pairs [size=6x9, system=rug-cvr]`, `named: true`. Its JSON-LD `ProductGroup`
(`variesBy: size`) lists 16 `hasVariant` entries; the 6'x9' entry is index 9, sku
`…-06x09`, `offers.price` **374.25**. That is the value Verify reported (`different_value`, found
374.25). The typed expected value, 499.00, is the list price the page shows struck through beside
the sale price; the page data holds only the sale price. So the page variant matched the right
entry; the cell fails on list price vs sale price, not on the variant. The near misses on Morris
and Cyrus show the same pattern (typed 449.25 / 424.15 against their 6'x9' sale prices).

**What would prove `[page]` live:** type the sale prices the page data carries (374.25 on Sierra,
and the 6'x9' sale price on the other two), or mark the sale price on the screenshot, then
Re-verify Price. Not done here: the brief forbids retyping values.

**Two product defects this surfaced:**
1. The Verify buttons' estimates undercount: "up to $0.05" spent $0.1152, "up to $0.10" spent
   $0.2451 ($0.3603 against $0.15). Belongs with the money-label work in the handoff.
2. A Re-verify re-checks only failed fields, so a field that passed on a fixed index and carries
   the new address warning is never re-checked — the warning has no action that clears it.
