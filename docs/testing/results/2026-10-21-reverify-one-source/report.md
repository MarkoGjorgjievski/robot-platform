# Re-verifying the one-source websites: a free, live Verify (2026-10-21)

Queue item "Re-verify the one-source websites", approved by Marko on 2026-10-21. He accepted beforehand that
two fields would change their first path: Competitor prices / Ikea "In stock" and Lookfantastic SKU.
Branch `ops/reverify-one-source` (from main @ `a949e9b`, which has the per-source cap with XPath capped
and covers never capped). Script: `packages/api/src/scripts/reverify-one-source.ts`. Raw per-field data:
`results.json` beside this file.

Websites are named org/project/website, using the names stored in the database (Marko's own data).

## What was run

- **Backup first:** `C:\Users\Marko\Documents\projects\robot-platform-backups\backup-20261021-115643-pre-reverify-one-source.sql`
  (a full `pg_dump` of `robot_platform`, 541,574,017 bytes, taken before anything was written).
- **Selection:** the same rule as `one-source-recertify.ts`. A website qualifies when its latest completed,
  clean verification certified a field on two or more paths that all read API, or all read JSON-LD. The
  selection gave 20 websites, 41 fields and 66 proof pages, the same as `2026-10-20-one-source/recertify.md`.
- **Steps for each website, one website at a time and one browser at a time:**
  1. Every proof page is captured the way the Verification tab captures it, one page after another. Each
     captured page gets one Jev reading.
  2. The checks `sources.verify` runs: the binding problems and whether a verification is already in flight.
     No website was refused.
  3. A new `source_verifications` row, then `runSourceVerification` with `free: true`. No agent exists, so
     nothing reached the AI.
  4. The coverage check that a passing Verify starts.
- The run made no sign-in and created no user or org. It changed no binding, field, project or org. It
  wrote only what a normal Verify writes: verification rows, captures, the domain store on a pass, coverage
  checks, Jev readings and the `verify_agreement` column.
- **Environment:** `ANTHROPIC_API_KEY` empty (the script refuses to start otherwise), `JEV_SHADOW=1`, the
  TypeSafe key from `.env`, and `CAPTURES_DIR` set to the main checkout's api-server captures folder. Marko's
  dev servers on :3000 and :4000 were not touched.

**A fault in the run, and how it was handled.** `runSourceVerification` starts the coverage check without
awaiting it. The first version of the script only got hold of that check after an `await`, which was a race.
Only the Allbirds check was awaited. The checks for Nike, Sigmabeauty, Colourpop and Campaign 2 / Ikea ran
alongside the next websites, so for a few minutes more than one browser was open. The final `process.exit`
then cut off two of them, Colourpop and Campaign 2 / Ikea, and left them `running`. Both were finished
afterwards, one at a time, with `--coverage=<id>`. All five coverage checks now read `done`. The script is
fixed: it now takes the coverage promise synchronously. Because of the race, `results.json` shows no coverage
entry for those four websites. The database has all five.

## Summary

| | |
|---|---|
| Websites re-verified | 20 (none skipped, no binding refused) |
| Flagged fields re-verified | 41: **35 passed, 6 failed** |
| Verifications that passed every field | 5 of 20: Allbirds, Nike, Sigmabeauty, Colourpop, Campaign 2 / Ikea |
| Passing flagged fields whose first path changed | 4: Competitor prices / Ikea In stock, Lookfantastic SKU (both expected), Barnesandnoble Price, Mejuri In stock |
| Fields (any field, flagged or not) that passed in the previous verification and fail now | 27, on 15 websites (listed below) |
| Websites certified before and **no longer certified** | 10 (see "What this does to certification") |
| Jev readings added | 65 (61 done, 4 timed out at 10 s), on all 20 websites |
| Jev spend | **$0.019286** (projected $0.0198; the cap was $1) |
| Anthropic spend | $0: no agent, and `ai_calls` is 0 on every row |

## Before → after by website

| Website | Flagged fields | Sources before → after | First path changed (passing fields) | Outcome |
|---|---|---|---|---|
| Credit campaign 2026-10 / Barnesandnoble | Price, In stock, Description | json-ld → json-ld (Description: none) | Price: `@graph[1].offers.price` → `@graph[0].hasVariant[2].offers.price` | not passed: **Description**, Rating |
| Credit campaign 2026-10 / Allbirds | Main image, SKU | Main image json-ld → json-ld+meta+xpath; SKU json-ld | — | **passed** |
| Mar / Competitor prices / Ikea | Product URL, Price, In stock | Product URL api → api; In stock api → json-ld; Price api → none | **In stock: `api priority` → `json-ld offers.availability`** (expected) | not passed: **Price**, Main image |
| Credit campaign 2026-10 / Nike | Main image | json-ld → json-ld | — | **passed** |
| Markodjordjievski / Acne / Ikea | Price, Price currency, Product id | api → api; Product id json-ld → json-ld+xpath | — | not passed: Total reviews, Average rating |
| Campaign 2 / Bombas | Main image | json-ld → json-ld | — | not passed: Price, Rating |
| Credit campaign 2026-10 / Madeincookware | SKU | json-ld → none | — | not passed: **SKU**, Price |
| Campaign 2 / Ruggable | SKU, Description | SKU api → api+json-ld; Description json-ld → json-ld+xpath | — | not passed: Price, Rating |
| Credit campaign 2026-10 / Lookfantastic | SKU, Brand, In stock | SKU api → api (3 responses)+json-ld; Brand api → api (2 responses); In stock api → api | **SKU: `api response.Results[0].ProductId` → `api itemsData[0].sku @ st-eu.dynamicyield.com/spa/json`** (expected) | not passed: Price, Rating |
| Campaign 2 / Skims | Price, Main image, In stock | Price json-ld → json-ld+xpath; Main image → json-ld+meta; In stock json-ld | — | not passed: Description |
| Credit campaign 2026-10 / Everlane | Price, Main image | Main image json-ld → json-ld+meta+xpath; Price json-ld → none | — | not passed: **Price**, In stock |
| Campaign 2 / Mejuri | Title, Price, Main image, SKU, Brand, In stock | Title → json-ld+xpath; Main image, Brand → json-ld+meta; SKU, In stock json-ld; Price → none | In stock: `offers.availability` → `hasVariant[2].offers.availability` | not passed: **Price** |
| Campaign 2 / Sigmabeauty | SKU | json-ld → json-ld | — | **passed** |
| Campaign 2 / Gymshark | Title, Main image | Title → json-ld+api+xpath; Main image → json-ld+api+meta | — | not passed: Rating |
| Campaign 2 / Colourpop | Title | json-ld → json-ld | — | **passed** |
| Campaign 2 / Ridge | Brand | api → api+meta | — | not passed: In stock |
| Campaign 2 / Oliverbonas | Main image | json-ld → json-ld+meta | — | not passed: Rating |
| Campaign 2 / Ikea | Price | api → api | — | **passed** |
| Campaign 2 / Burrow | Brand, In stock, Description | json-ld → json-ld; Description → json-ld+meta | — | not passed: Price, Rating |
| Campaign 2 / Skullcandy | Description | json-ld → none | — | not passed: every field (one proof page returns 404) |

Fields in **bold** are flagged fields that failed. "Campaign 2" is the project "Campaign 2 2026-10-11" in the
org "Credit campaign 2026-10". The other Credit campaign websites are in the project of the same name.

## Fields that passed before and fail now

"Before" is the website's previous completed, clean verification. Nothing was retried with AI and no data was
edited to make a field pass. The reasons below are the cell results the verification stored.

| Website | Field | Previously | Now: why |
|---|---|---|---|
| Barnesandnoble | Description *(flagged)* | passed 2026-10-08 | Threshing Day page: `different_value`. The live description no longer matches the expected text |
| Barnesandnoble | Rating | passed | Theo of Golden: `different_value` (found 4.6) |
| Mar / Competitor prices / Ikea | Price *(flagged)* | passed 2026-09-25 | BILLY/OXBERG page: `different_value` (found RM259). The price changed |
| Acne / Ikea | Total reviews | passed 2026-09-21 | `not_found` on all 3 pages |
| Acne / Ikea | Average rating | passed | `different_value` (found 4.77) / `ambiguous` |
| Bombas | Price | passed 2026-10-12 | `ambiguous` ×2, `different_value` (found 91.0) |
| Madeincookware | SKU *(flagged)* | passed 2026-10-08 | 5-piece set: `different_value` (found KIT-5-FSS-ISS); `ambiguous` on the other two |
| Madeincookware | Price | passed | `ambiguous` / `different_value` (found 4050.00) |
| Ruggable | Rating | passed 2026-10-15 | `not_found` ×2, `ambiguous` |
| Lookfantastic | Price | passed 2026-10-10 | `not_found` on 2 of 4 pages |
| Everlane | Price *(flagged)* | passed 2026-10-08 | `not_found` on 2 of 3 pages |
| Everlane | In stock | passed | agave-green page: `elsewhere` |
| Mejuri | Price *(flagged)* | passed 2026-10-12 | `not_found` on all 3 pages |
| Gymshark | Rating | passed 2026-10-14 | Whitney legging: `different_value` (found 4.2) |
| Ridge | In stock | passed 2026-10-12 | `not_found` on all 4 pages |
| Oliverbonas | Rating | passed 2026-10-12 | `different_value` (found 4.5) / `ambiguous` |
| Burrow | Price | passed 2026-10-12 | `not_found` on all 3 pages |
| Burrow | Rating | passed | `not_found` on all 3 pages |
| Skullcandy | all 8 fields (Description *(flagged)*) | passed 2026-10-12 | the proof page `slyr-pro-multi-platform-wired-gaming-headset` now returns 404 ("That page doesn't exist on skullcandy.com (404). Check the address."), so every field is `not_captured` there |

These fields were already failing before this run and still fail: Bombas Rating, Mar / Competitor prices /
Ikea Main image, Lookfantastic Rating, Ruggable Price, Skims Description.

In short, the live pages have moved on since the verifications of 2026-09-21 to 2026-10-15. Expected values
are now out of date: prices and rating figures changed, descriptions changed, and one product page is gone.
Some review and price widgets also no longer show up in a free capture. Six flagged fields failed for those
same reasons, not because of the cap. Every flagged field that **passed** certified at least the sources it
had before, and 18 of them gained a second or third source.

## What this does to certification

Certification is read from the latest clean verification, and it needs every field to be current
(`loadCertificationState`). These 10 websites were fully certified before this run and are **not certified
now**, so a run on them will be refused until the failing fields are put right and verified again:

Barnesandnoble, Acne / Ikea, Madeincookware, Everlane, Mejuri, Gymshark, Ridge, Oliverbonas, Burrow, Skullcandy.

These 5 were not fully certified before and are still not: Mar / Competitor prices / Ikea, Bombas, Ruggable,
Lookfantastic, Skims.

These 5 passed and stay certified, now with the new paths: Allbirds, Nike, Sigmabeauty, Colourpop,
Campaign 2 / Ikea.

Nothing was edited to change this. There are two ways back to the earlier state if it is wanted: restore the
backup above, or delete the 20 verification rows listed in `results.json`. Neither was done.

## Jev readings added

65 readings, one for each captured proof page (66 pages, less the Skullcandy 404). 61 are `done` and 4 timed
out at 10 s (Barnesandnoble, Nike, Lookfantastic, Oliverbonas, one each). They are spread over all 20 websites:
Barnesandnoble 3, Allbirds 3, the three Ikea websites 9, Nike 4, Bombas 3, Madeincookware 3, Ruggable 3,
Lookfantastic 4, Skims 3, Everlane 3, Mejuri 3, Sigmabeauty 3, Gymshark 4, Colourpop 4, Ridge 4, Oliverbonas 4,
Burrow 3, Skullcandy 2. Spend: **$0.019286**.

The script's "Jev readings: n" log lines, and the `jev` arrays in `results.json`, undercount by about one per
website. They were read before the last page's reading row had been inserted. The counts above come from
`jev_readings`. That wait is fixed in the script as well. Each verification's `verify_agreement` was written
as usual, from the readings that were done when the Verify finished.

## Per-field detail (flagged fields)

"Changed" is decided on source + path + transform, so a path that only gained its container label does not
count. A failed field shows "(none)" after, which also counts as changed.

### Credit campaign 2026-10/Credit campaign 2026-10/Barnesandnoble

Verification `f02b3ec6-3bca-4658-a14c-94873172412f`: **not passed** — Rating, Description

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | json-ld → json-ld | 2 → 1 | `json-ld @graph[1].offers.price` | `json-ld @graph[0].hasVariant[2].offers.price` | **yes** | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld @graph[1].offers.availability` | `json-ld @graph[1].offers.availability` | no | passed |
| Description | json-ld → — | 5 → 0 | `json-ld @graph[0].description` | (none) | **yes** | **failed** |

### Credit campaign 2026-10/Credit campaign 2026-10/Allbirds

Verification `c20dece8-a5e9-4a40-b7f5-79d677bd072e`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld+meta+xpath | 5 → 5 | `json-ld image[0]` | `json-ld image[0]` | no | passed |
| SKU | json-ld → json-ld | 2 → 2 | `json-ld sku` | `json-ld sku` | no | passed |

### Mar/Competitor prices/Ikea

Verification `2e51ed79-d3c4-44de-96a5-d313ba299f2c`: **not passed** — Price, Main image

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Product URL | api → api | 5 → 1 | `api pipUrl` | `api pipUrl @ https://www.ikea.com/my/en/products/882/70483882.json` | no | passed |
| Price | api → — | 5 → 0 | `api price` | (none) | **yes** | **failed** |
| In stock | api → json-ld | 5 → 1 | `api priority` | `json-ld offers.availability` | **yes** | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Nike

Verification `6a24794a-c745-4146-bb3c-e7d369a627ea`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld | 5 → 2 | `json-ld hasVariant[0].image` | `json-ld hasVariant[0].image` | no | passed |

### Markodjordjievski/Acne/Ikea

Verification `fe7a78ad-3d6b-4db0-904d-169a654915c1`: **not passed** — Total reviews, Average rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | api → api | 5 → 2 | `api price` | `api price @ https://www.ikea.com/my/en/products/009/10489009.json` | no | passed |
| Price currency | api → api | 2 → 2 | `api revampPrice.currencyPrefix` | `api revampPrice.currencyPrefix @ https://www.ikea.com/my/en/products/009/10489009.json` | no | passed |
| Product id | json-ld → json-ld+xpath | 2 → 4 | `json-ld mpn` | `json-ld mpn` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Bombas

Verification `5070de0e-25ff-4ed9-91fb-4dd4a2ede5d1`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld | 2 → 2 | `json-ld image[0]` | `json-ld image[0]` | no | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Madeincookware

Verification `a69a5ede-386e-4f6e-8c88-492c4172e96c`: **not passed** — Price, SKU

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | json-ld → — | 2 → 0 | `json-ld @graph[2].sku` | (none) | **yes** | **failed** |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Ruggable

Verification `72f58487-1a6b-4177-97ed-e75cc694791e`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | api → api+json-ld | 2 → 3 | `api [0].vendorCode` | `api [0].vendorCode @ https://www.roomvo.com/services/product/product_mappings/` | no | passed |
| Description | json-ld → json-ld+xpath | 5 → 4 | `json-ld description` | `json-ld description` | no | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Lookfantastic

Verification `6456db4b-e9d8-4991-8e47-57614d7e453e`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | api → api+json-ld | 4 → 5 | `api response.Results[0].ProductId` | `api itemsData[0].sku @ https://st-eu.dynamicyield.com/spa/json` | **yes** | passed |
| Brand | api → api | 2 → 2 | `api feedProperties.brand` | `api feedProperties.brand @ https://st-eu.dynamicyield.com/spa/json` | no | passed |
| In stock | api → api | 2 → 2 | `api itemsData[0].in_stock` | `api itemsData[0].in_stock @ https://st-eu.dynamicyield.com/spa/json` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Skims

Verification `ec471ede-91b6-4f3c-9281-ec074281695c`: **not passed** — Description

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | json-ld → json-ld+xpath | 5 → 4 | `json-ld hasVariant[0].offers.price` | `json-ld hasVariant[0].offers.price` | no | passed |
| Main image | json-ld → json-ld+meta | 5 → 4 | `json-ld image[0]` | `json-ld image[0]` | no | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld hasVariant[1].offers.availability` | `json-ld hasVariant[1].offers.availability` | no | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Everlane

Verification `ebea036f-a4f8-486f-a989-bf5054adbf58`: **not passed** — Price, In stock

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | json-ld → — | 5 → 0 | `json-ld hasVariant[0].offers.price` | (none) | **yes** | **failed** |
| Main image | json-ld → json-ld+meta+xpath | 5 → 5 | `json-ld hasVariant[0].image` | `json-ld hasVariant[0].image` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri

Verification `4db28718-a6ae-4b09-bc7c-4f8e4661d71f`: **not passed** — Price

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Title | json-ld → json-ld+xpath | 5 → 4 | `json-ld isVariantOf.name` | `json-ld isVariantOf.name` | no | passed |
| Price | json-ld → — | 5 → 0 | `json-ld offers.price` | (none) | **yes** | **failed** |
| Main image | json-ld → json-ld+meta | 5 → 3 | `json-ld image` | `json-ld image` | no | passed |
| SKU | json-ld → json-ld | 2 → 2 | `json-ld sku` | `json-ld sku` | no | passed |
| Brand | json-ld → json-ld+meta | 5 → 3 | `json-ld brand.name` | `json-ld brand.name` | no | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld offers.availability` | `json-ld hasVariant[2].offers.availability` | **yes** | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Sigmabeauty

Verification `31b63e31-8631-471e-91cc-4dfef15de46f`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | json-ld → json-ld | 2 → 2 | `json-ld sku` | `json-ld sku` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Gymshark

Verification `1a220142-7e0b-4a00-87a4-5a027f7af4fd`: **not passed** — Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Title | json-ld → json-ld+api+xpath | 5 → 5 | `json-ld name` | `json-ld name` | no | passed |
| Main image | json-ld → json-ld+api+meta | 5 → 5 | `json-ld image[0]` | `json-ld image[0]` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Colourpop

Verification `e207e4d0-04a1-4ca8-bbe6-2c8337c2b611`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Title | json-ld → json-ld | 5 → 1 | `json-ld name` | `json-ld name` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Ridge

Verification `dc038f49-cd34-48fa-810a-2570dbd363f8`: **not passed** — In stock

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Brand | api → api+meta | 5 → 3 | `api products[0].vendor` | `api products[0].vendor @ https://ridge.com/collections/kintsugi-eligible-playing-cards-hide/products.json` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Oliverbonas

Verification `be178496-6038-4604-aecf-4906ffbb3cb4`: **not passed** — Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld+meta | 5 → 4 | `json-ld image[0]` | `json-ld image[0]` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Ikea

Verification `997daff2-75ed-4bc1-b0e3-c6769a01a1e3`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | api → api | 5 → 2 | `api price` | `api price @ https://www.ikea.com/my/en/products/009/10489009.json` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Burrow

Verification `a883cc30-ae25-4860-9238-8aec2e988fed`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Brand | json-ld → json-ld | 5 → 2 | `json-ld brand.name` | `json-ld brand.name` | no | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld hasVariant[0].offers.availability` | `json-ld hasVariant[0].offers.availability` | no | passed |
| Description | json-ld → json-ld+meta | 5 → 3 | `json-ld description` | `json-ld description` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Skullcandy

Verification `ce5c1657-2993-4d8b-b690-2917392db0ce`: **not passed** — Title, Price, Main image, SKU, Brand, In stock, Rating, Description

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Description | json-ld → — | 2 → 0 | `json-ld description` | (none) | **yes** | **failed** |
