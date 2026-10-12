# skullcandy.com — campaign 2, 2026-10-12 (phase 2, batch B, site 11)

**Status: DONE, with Brand verified on the store's vendor name.** Verified 8/8 on 3 proof pages. A coverage proof page (a bundle) broke Brand and Main image on the other three and had to be dropped. Verifies cost **$0.6841**. Extract returned 60 of 60 (34 distinct products) for $0.00. The judge stopped at its $5 cap after 49 of 60 ($4.9775). It found real errors in In stock (7 variant pages shown "OUT OF STOCK" were stored `true`) and in bundle descriptions, and called the store-name Brand 49/49 correct.

- Website `skullcandy` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://www.skullcandy.com/collections/shop-all
- The candidate list calls it BigCommerce, but the URLs and page data are Shopify (`/products/`, `cdn/shop/files`, `products[0].vendor`).
- The api-server's browser is in **Malaysia**: every capture carries a **"We don't ship to Malaysia / Choose another shipping country available."** modal over the title, price and buy box. Prices are still in $ (US store).

## Findings in the product (most important first)

1. **A coverage proof page can un-verify fields that were already verified.** Products 1–3 had Brand certified 3/3 (as "Skullcandy US", see 2). The coverage line's "Use as proof page" for SKU added product 4, the "Crusher® & Speaker Set". This is a mix-and-match bundle builder, whose only brand candidate is "Skullcandy".
   - "Re-verify 8 fields · up to $0.40" first ended in a stored **"Request timed out."** (`all_passed` false, $0). The screen showed **nothing**: blank Status cells, no error, and the button back at "Re-verify 8 fields · up to $0.40".
   - Clicked again, it cost **$0.3317** (2 AI calls) and gave "Brand **fails on products 2, 3 and 4 1/4**" and "Main image fails on product 4 3/4". Brand on 2 and 3 went from pass to `ambiguous` (`["Skullcandy US", "Skullcandy"]`).
   - The only way back was to drop product 4. "Re-verify 8 fields · up to $0.40" then cost $0.00 and gave 8/8 3/3. Batch A met the same dead end on mejuri.
2. **The real brand cannot be certified, because identical candidates count as "ambiguous".** The pages hold "Skullcandy" in JSON-LD `brand.name` and in `og:site_name` (2 and 3), and "Skullcandy US" as the Shopify vendor.
   - Typing "Skullcandy" gave `ambiguous` on products 2–3 (near misses `["Skullcandy"]`, the same value from several places) and `different_value: Skullcandy US` on product 1, whose page lacks the JSON-LD brand.
   - The row read "This page shows Skullcandy US. Is your value right, or does the page show it differently?"
   - A descriptor ("The maker's brand name as written on the product, Skullcandy (not the store name 'Skullcandy US')") changed nothing.
   - I typed **"Skullcandy US"** so that the site could be extracted and judged, as batch A did with gymshark's tagline. **Every extracted Brand is the store name, not the brand.**
3. **The suggested Main image is a dead link.** On SLYR® Pro and Grom® Wireless the page data's image is `…_large.png%3Fv=1709650221`, with the `?` encoded. That URL returns **HTTP 404**; with `?v=` it returns 200.
   - On product 1 the product's own suggestion, accepted as is, failed **`ambiguous`**.
   - The image the gallery actually shows also differs from the page data: SLYR® Pro's selected colour is "Blue DigiHype", the gallery shows `slyr_pro_buy_box_blue_digi_hype_2.png`, and the page data has the black file.
   - Typing the gallery URLs (`…&width=2000` / `&width=1080`) verified 3/3 for $0.1115 ("Re-verify 2 fields · up to $0.10").
4. **Out of stock would have been certified as "In stock".** SLYR® Pro and Grom® Wireless show "Out of Stock" and "NOTIFY ME WHEN AVAILABLE", but the page data said "In stock" (not "agreed", "only in the page data"). I typed "Out of stock", and it verified, so a path reading the shown state exists.
5. **The finder and the run treat `?variant=` links as separate products.**
   - "40 products found": the first 7 were the Crusher® Evo, with and without `?variant=`. The first three products as found were all Crusher Evo.
   - The 60-URL run planned **34 distinct products**: Smokin' Buds ×9, Crusher Evo ×7, the travel bag ×4, and so on.
   - Its coverage sample of "20 products" covered only about 9 distinct ones.
6. **Verify labels understate the cost.**
   - "Verify 8 fields · up to $0.40" cost $0.2409.
   - "Re-verify 2 fields · up to $0.10" cost $0.1115.
   - The timed-out "Re-verify 8 fields · up to $0.40" was retried once and cost $0.3317. That is within its label, but one click paid for nothing, because of the time-out.
7. **Suggestions:** Rating on the bundle was suggested 4.3, while the page shows "4.2 · Based on 771 reviews". The bundle's SKU was suggested as its URL handle, "crusher-and-speaker-set", and its Price as "0".
8. Sample is labelled "No AI. Free." and recorded **$0.0971** (probe `edf93251`, `partial`). The panel read "Sampling · 0 of 30 rows extracted" while it ran.

## Proof pages

1. https://www.skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-personal-sound (kept)
2. https://www.skullcandy.com/products/slyr-pro-multi-platform-wired-gaming-headset (replaced `…crusher-evo…?variant=45061353865273`)
3. https://www.skullcandy.com/products/grom-wireless-headphones-for-kids (replaced `…crusher-evo…?variant=45242474037305`)
4. ~~https://www.skullcandy.com/products/crusher-and-speaker-set~~ (added by "Use a sampled product as proof page for SKU", then dropped: finding 1)

| Field | What it needed | Verdict (final) |
|---|---|---|
| Title | **typed** "Crusher® Evo" on 1 (the suggestion carried "- True Black"); page data confirmed on 2–3 ("SLYR® Pro", "Grom® Wireless") | verified 3/3 |
| Price | agreed (209.99 / 104.99 / 36.99) | verified 3/3 |
| Main image | p1 suggestion accepted (fails `ambiguous`), then **typed** the gallery URLs on all three | verified 3/3 |
| SKU | page data, confirmed (S6EVW-N740 / S6SPY-Q766 / S6KBW-R740) | verified 3/3 |
| Brand | **typed** "Skullcandy" (fails), then **typed** "Skullcandy US" (the vendor; not the brand) | verified 3/3 |
| In stock | p1 page data confirmed; **typed** "Out of stock" on 2–3 (the page data said In stock) | verified 3/3 |
| Rating | agreed (4.6 / 4.3 / 4.3) | verified 3/3 |
| Description | page data, confirmed (the visible "CRUSH THE ORDINARY…" copy) | verified 3/3 |

Counts on the first three: agreed 2, page data confirmed 3, marked 0, typed 4, absent 0. Product 4 (dropped): typed 3, absent 3 (Price, SKU, In stock).

## Verify

| When (UTC) | Label | Result | AI calls / cost |
|---|---|---|---|
| 14:24:32 | "Verify 8 fields · up to $0.40" | 6/8: Main image and Brand "fails on products 1, 2 and 3 0/3" | 2 / $0.2409 |
| 14:26:27 | "Re-verify 2 fields · up to $0.10" (gallery image URLs; Brand descriptor) | 7/8: Brand 0/3 | 1 / $0.1115 |
| 14:28:14 | "Re-verify 1 field · up to $0.05" (Brand "Skullcandy US") | 8/8 3/3 | 0 / $0.00 |
| 14:37:21 | "Re-verify 8 fields · up to $0.40" (with product 4) | stored "Request timed out."; nothing on screen | 0 / $0.00 |
| 14:43:11 | the same, clicked again | Brand "fails on products 2, 3 and 4 1/4", Main image "fails on product 4 3/4" | 2 / **$0.3317** |
| 14:44:44 | "Re-verify 8 fields · up to $0.40" (product 4 dropped) | 8/8 3/3 | 0 / $0.00 |

## Coverage check

- **First** (stage line 14:29:40 → 14:35:36, 5 min 56 s): "2 fields were empty on some of the 20 sampled products — see the rows."
  - `sku`: "Empty on 2 of 20 sampled products" + "Use as proof page"
  - `in_stock`: "Empty on 2 of 20 sampled products" + "Use as proof page"
  - The empty two were both bundles: `crusher-and-speaker-set` and `crusher-evo-bundle`.
- "Use a sampled product as proof page for SKU" → product 4 the bundle, ready in 21 s (finding 1).
- **Second**, after dropping product 4 (14:44:48 → 14:51:36, 6 min 48 s): identical, sku and in_stock "Empty on 2 of 20 sampled products", the same two bundles.

## Sample and Extract

- **Sample**: 14:52:01 → 14:54:37 (155 s). Pages walked 1, Product links found 30, "Sample rows complete 3 of 3". Probe `edf93251-3459-4ba7-a179-0056e9aaefc4`, `partial`, $0.0971.
- **Extract**, budget "custom 60 products across custom 2 pages". Clicked 14:54:59; "Open the run" at 14:56:22 (planning 83 s).

  - Run `860cacc7-de2d-47ad-8719-799e5ae90f14`: completed at about 15:12 ("Duration 17 min"), "Done", "60 of 60 extracted", "60 URLs to extract · 1 listing page walked". `cost_usd` **$0.0000**.
  - The 60 URLs are **34 distinct products** (finding 5).
  - Empty cells: "SKU is empty on 4 of 60 products · all from /collections/shop-all", "In stock is empty on 4 of 60 products · all from /collections/shop-all" (the four bundles) and "Rating is empty on 2 of 60 products · all from /collections/shop-all".

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 34 |
| Price | 60/60 | 30 |
| Main image | 60/60 | 50 |
| SKU | 56/60 | 30 |
| Brand | 60/60 | 2 ("Skullcandy US" ×59, "Skullcandy" ×1) |
| In stock | 56/60 | 2 (true 45, false 11) |
| Rating | 58/60 | 10 |
| Description | 60/60 | 34 |

## Judge

`docs/testing/results/2026-10-12T15-39-judge-run-skullcandy.md`. It estimated "~$3.53 … ~$3.88 with the 10% retry/explain allowance; cap $5.00".
- It was **"STOPPED at the $5.00 cap after 49/60 items"**, in 33 min 51 s, and cost **$4.9775**. That is 28% over its own estimate, and it still did not finish.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 49 | 44 | 3 | 0 | 0 | 2 | 0 | 94% |
| Price | 49 | 1 | 10 | 37 | 1 | 0 | 0 | 9% |
| Main image | 49 | 0 | 0 | 0 | 49 | 0 | 0 | — |
| SKU | 45 | 1 | 0 | 40 | 4 | 0 | 4 | 100% |
| Brand | 49 | 49 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 45 | 24 | 7 | 5 | 9 | 0 | 4 | 77% |
| Rating | 47 | 24 | 7 | 14 | 2 | 0 | 2 | 77% |
| Description | 49 | 46 | 3 | 0 | 0 | 0 | 0 | 94% |

What the wrong verdicts are:

- **In stock ×7: real.** Five Smokin' Buds and two Crusher Evo `?variant=` pages show "OUT OF STOCK" for the colour in the URL, and the run stored `true`. The stock path reads the product, not the variant the URL selects. These are exactly the duplicate URLs of finding 5.
- **Description ×3: two real.** The two bundles (`premium-anc-bundle`, `daily-drive-bundle`) stored their **name** as the description ("Premium ANC Bundle"), while the page shows "THE ULTIMATE ANC TAG TEAM — Crusher ANC 2 and Method 360 ANC are better together…". The third is the judge: Grom Wired's description includes its "KID-FRIENDLY SOUND AND COMFORT." heading.
- **Rating ×7: mostly the judge.** Five times it read a cross-sold accessory's rating ("The page shows a rating of 4.3 (for the Cross Body Headphone Carry Bag)") or saw no number ("only a "See Reviews" link"). One is real: the Crusher® & Speaker Set stored **4.3** while the page shows **4.2**, the same mismatch I saw on its proof page.
- **Price ×10: mostly the judge and the capture.**
  - Five read "hidden behind the shipping country popup" or "no visible price", because the "We don't ship to Malaysia" modal covers the buy box.
  - Four read accessory prices ($19.99, $29.99) from a cross-sell row.
  - Grom Wired (26.99 vs "$29.99") may be real.
- **Title ×3: the judge.** It read obscured headings: "ROLL TOP HEADPHONE BAG (partially obscured by the dialog overlay)" and "Crusher® 540 without Active".
- **Brand 49/49 "correct" for "Skullcandy US"**: the judge accepted the store name as the brand (finding 2). It is too lenient here, the opposite of gymshark's 24 wrong.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify ×6 | $0.6841 |
| Sample probe | $0.0971 (recorded; labelled free) |
| Extract run | $0.0000 |
| Judge | $4.9775 (cap $5.00; stopped at 49/60) |

## Screenshots

`skullcandy-00-cards-as-found`, `-01-cards`, `-02-table-before`, `-03-before-verify`, `-04-after-verify`, `-04-vclick`, `-05-after-verify`, `-06-after-verify` (8/8), `-06-coverage`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify` (blank statuses after the time-out), `-10-after-verify` (Brand fails 1/4), `-11-after-drop-p4`, `-12-coverage`, `-12-sample`, `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
