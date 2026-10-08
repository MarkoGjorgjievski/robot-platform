# everlane.com — credit campaign 2026-10

**Status: STOPPED at step 1 (Screen), because of a problem in the app, not the site.** Nothing was spent: no Verify, no Extract.

| | |
|---|---|
| Website | Everlane (`everlane`, source `b571fbfb-92e0-40af-bd87-e8b3f2d88a8a`), added through Add website as `https://www.everlane.com` |
| Listing tried | `https://www.everlane.com/collections/mens-tees` (the site redirects it to `/collections/mens-tshirts`), then `https://www.everlane.com/collections/mens-tshirts` itself |
| Screen result | The app reported "94 products found · a pager too" (93 the second time), but every product it offered was a **collection** page, not a product |
| Proof pages | none usable. On screen: a blank card and 2 collection cards. Saved: 3 collection cards (`womens-jeans`, `womens-best-sellers`, `shop-all-mens-clothing`) |
| Fields | not reached (agreed 0 / marked 0 / typed 0 / absent 0) |
| Verify | label read "Verify 8 fields · up to $0.40", disabled ("Add at least three products"). Not clicked, $0 |
| Extract | not started, $0 |

## What happened

1. Find products on `/collections/mens-tees` took about 2.5 min. It came back with "94 products found · a pager too". The three cards were *SHOP NEW ARRIVALS* (`/collections/womens-new-arrivals`), *Shop Cult Favorites* (`/collections/womens-best-sellers`) and *Shop 30% Off Sitewide\** (`/collections/shop-all-mens-clothing`). These are the promo tiles in the site's menu (`everlane-screen.png`).
2. Dropping card 1 again and again (×, which pulls the next listing product) went through the whole queue: `mens-chinos-khakis`, `collegium-x-everlane-shoes`, `womens-better-prices-shop`, `womens-sweaters`, `everlane-shop-natural-fibers`, `womens-jeans`, `womens-pants-trousers`. All of them were `/collections/…` pages. Once the queue was empty, a drop left a blank card next to the two collection cards (`everlane-cards.png`).
3. Pasting the canonical `/collections/mens-tshirts` gave the same result: 93 "products", all collections.
4. The real page has no wall. Plain Playwright (`everlane-real-listing.png`) shows "68 PRODUCTS". The DOM holds **52 unique `/products/…` links**, along with **~137 unique `/collections/…` links** from the mega-menu, the "Shop by Fabric" tiles and the promos. `/collections/shop-all-mens-clothing` gave 53 vs 135 and `/collections/mens-sweaters` gave 54 vs 137, so every Everlane listing looks like this.

I did not paste product URLs by hand ("No listing? Paste product pages instead" / "+ Add product" → URL). The brief says to stop at an app problem rather than work around it. Extract would also take its input from the same listing finder, so it would crawl collection pages.

## Finding (product defect)

**The listing finder picks the site's navigation over its products when the menu has more links than the grid.** `largestProductGroup` in `packages/api/src/verify/find-product-pages.ts` groups links by path template (12+-char slugs collapse to `*`) and returns the largest group. On Everlane, `/collections/*` (~93–137 menu and promo links) beats `/products/*` (~52 grid links). The "N products found" count therefore counts menu links, and the 10-item sample (`describeListingPage`) the cards come from contains only collections. A customer on any Shopify-style shop with a big mega-menu would hit this. Possible fixes include preferring links inside the main content area or links with images, preferring `/products/` or `/p/` shapes, or excluding `<nav>`/`<header>` anchors. These are notes only; nothing was changed.

Smaller observations:
- Find products took 2.5 min the first time and 1.3 min the second, with three workers running. The button only shows a spinner while it works.
- The queue held only 8 entries, the sample of 10 minus what was on the board, even though the header said 94 were found. So "+ Add product" or × cannot reach the other found links.
- On the two collection pages the table shows **"agreed · Accept"** for In stock ("In stock") and Description (the collection blurb). Title also reads "Everlane" on both ("same on every product — check it"). The suggestions treat a category page as a product without any warning. A customer who trusts "agreed" could accept them. I did not accept any.
- With a blank card on the board the bar says "Not saved: Every product needs a page". What stayed saved is the last full board: listing `mens-tshirts` and cards `/collections/womens-jeans`, `/collections/womens-best-sellers`, `/collections/shop-all-mens-clothing`. So the screen shows a different board from the one stored.

## Screenshots

- `everlane-screen.png` — the table right after Find products: three collection pages as "products", "94 products found".
- `everlane-cards.png` — after dropping through the whole queue: two collection cards and a blank one left, Verify disabled.
- `everlane-real-listing.png` — the real listing in plain Playwright: no wall, "68 PRODUCTS", product grid below the menu and the "Shop by Fabric" tiles.

## Re-run after fix A (2026-10-08, servers restarted)

**Status: DONE, Extract partial.** Fix A works live: Find products now offers real `/products/…` pages. Verify passed 8/8 with no AI calls and cost $0.00. The Sample got 3/3 complete rows. Extract gave 41 of 52 rows for $0.0678; the last 11 pages failed when the engine's browser crashed.

| | |
|---|---|
| Listing | `https://www.everlane.com/collections/mens-tshirts` (same as before) |
| Find products, before | "94 products found · a pager too" (93 on the second try), every one a `/collections/…` menu page |
| Find products, now | **"52 products found · a pager too"** in ~80 s. The first three from the queue were real products: *The Essential Organic Crew*, *The Essential Organic Garment-Dyed Crew*, *Archive Relaxed-Fit Cotton Crew* |
| Proof pages | `/products/mens-essential-organic-crew-uniform-white`, `/products/mens-essential-organic-dyed-crew-agave-green`, `/products/mens-archive-cotton-relaxed-fit-crew-heathered-oatmeal`. These are three different products, each sold in 6 sizes (XS–XXL) and several colours (15 / 2 / 9). Product 2 is fully sold out in Agave Green, and the page shows a "…is sold out. Our recs for you:" strip of 4 other tees above the product |
| Prices | The site serves Malaysian ringgit to this machine ("RM125 MYR", struck-through "RM180 MYR"). The values are the sale prices 125 / 125 / 140 |

### Board

Find products did **not** replace the three stale collection cards. It reported "52 products found", but the board stayed *All Denim / Shop Cult Favorites / Shop 30% Off Sitewide\** (`everlane-rerun-find.png`). Each card had to be dropped (×), and each drop pulled the next found product. The queue lives only in the open page. In a later session (fresh page load) a drop gave a blank "Product 1 · Use this page" card, because the queue was empty. So Find products and the drops have to happen in one sitting. After the drops all three screenshots read "ready" in ~2 min.

### Expected values

| Field | Suggested | What it needed | Verify | Certified path |
|---|---|---|---|---|
| Title | "Everlane" on all 3 ("same on every product — check it"), **wrong** | marked the `h1` on all 3 | verified 3/3 | XPath to `div.product__title/h1` |
| Price | 125.00 / 125.00 / 140.00, agreed | agreed (checked: sale price on each screenshot) | verified 3/3 | JSON-LD `hasVariant[0].offers.price` (+ variants 1–4) |
| Main image | first gallery image, agreed | agreed (checked: same file as the first gallery image on each capture; product 2's is below the recs strip) | verified 3/3 | JSON-LD `hasVariant[0].image` (+4) |
| SKU | `M-T-CTN-ORGN-CR.2-WHT-XS`, `M-T-CTN.DYE-SS-CR-AGRN-XS`, `M-T-FVJ-RLX-TEE-HOAT-XS`, agreed | not visible on any page, so accepted from page data per the campaign rule. These are the **XS** variant's SKUs | verified 3/3 | JSON-LD `hasVariant[0].sku` |
| Brand | "Everlane" ×3, "same on every product" | "Accept anyway" (true; shown only in the footer, otherwise in page data) | verified 3/3, weak evidence | JSON-LD `brand.name` |
| Rating | empty | marked 3.9 / 4.6 / 3.5 (stars line). On product 1 the mark popover first proposed **Price** for "3.9"; picked Rating | verified 3/3 | XPath to the Yotpo `…bottom-line-score` span |
| In stock | In stock / **Out of stock** / In stock, agreed | agreed (checked: ADD TO BAG / SOLD OUT / ADD TO BAG) | verified 3/3 | JSON-LD `hasVariant[0].offers.availability` (+4), one of them `api:data.products.edges[1].node.availableForSale` |
| Description | product blurbs, agreed | agreed (checked against the visible Description text) | verified 3/3 | JSON-LD `description` |

Counts: agreed 5 (Price, Main image, SKU, In stock, Description, each checked against the captures), marked 2 (Title, Rating), accepted-anyway 1 (Brand), typed 0, absent 0. This time the "agreed" In stock and Description were right. Last time they were wrong because the cards were category pages.

### Verify

- Label "Verify 8 fields · up to $0.40" → clicked once at 13:43:22Z. Done in **10 s**, `allPassed`, **0 AI calls, $0.0000** (`source_verifications.cost_usd`).
- All 8 verified 3/3. Page shows "Everything is verified" (`everlane-rerun-after-verify.png`).

### Sample

- I started it at 13:44:15Z, ~45 s after Verify finished rather than the ~2 min asked. It took 2 min 40 s.
- Result: "Pages walked 1 · Product links found 30 · Pagination detected not reported". 3 rows, which were the three proof products, all fields filled and correct (In stock false on the sold-out tee).
- The probe run cost **$0.0834** (`runs.cost_usd`, status `partial`, log "budget reached: 30 items"), although every field was certified and Verify spent nothing. I don't know where the spend went; likely link discovery on the listing.
- Display glitch: right after the Sample finished, the card said "Sample rows complete **0 of 0**" while the stepper above said "3 rows extracted". After a reload it read "3 of 3" with the rows (`everlane-rerun-sample.png` shows the 0 of 0 state, `everlane-rerun-extract-before.png` the reloaded one).

### Extract

- Settings: custom **60 products × 3 pages** (the app line read "first 60 products from each · first 3 pages of each"). I clicked Extract once at 13:48:43Z, ~1 min 50 s after the Sample finished.
- Run `f203bd44-ef19-4411-9c15-31f830ba20f6`: **status `partial`, 41 rows**. The run page says "41 of 52 extracted · 11 failed". It finished at 14:12:56Z after **24 min 13 s**. That is **35.4 s per extracted row** (27.9 s per planned page). Most of it went on detail pages, 13:51:18 → 14:12:14 for the 41 good rows. It sat in "planning" for 2 min 35 s first.
- Planning: 1 listing page walked, 52 product URLs (log: "listing extraction found 51 product link(s) but the page has 52 … planned from the page's product links"). Pagination: "next-button produced no new items". So the item budget of 60 never bound; the listing yielded 52 of the 68 the site claims.
- Cost: **$0.0678** (`runs.cost_usd`). The re-run spent $0.151 in total: Verify $0.00 + Sample $0.0834 + Extract $0.0678.
- Per-field hit rate over the 41 rows: Title 41/41, Price 41/41, Main image 41/41, SKU 41/41, Brand 41/41, **Rating 35/41**, In stock 41/41 (17 false), Description 41/41. The 6 missing ratings are all sold-out products (`m-t-fvj-prm-ls-*` ×4, `mens-waffle-knit-crew-*` ×2). The run page offers "Rating is empty on 6 of 41 products". I did not check whether those pages show a rating at all.
- Rows are one per colour URL (Everlane gives each colour its own `/products/…` page). SKU and Price are those of the first (XS) variant. No per-size rows were produced.
- The run page's "Retry 11 failed" button was not clicked (one Extract per website).

**Why the run is partial (finding).** All 11 failures have the same error, `browserContext.newPage: Target crashed`, with 1 attempt each. All of them happened in the last 42 s (14:12:14 → 14:12:56Z). It was not a CAPTCHA, a 404 or a timeout. The engine's Chromium died, and every remaining queued page then failed instantly on `newPage` without relaunching the browser or retrying. At the same moment the dev machine was critically low on memory (my own background watcher shells were killed for low memory). So the cause is likely the host, not Everlane. The product defect: one browser crash fails the whole rest of the queue in seconds instead of relaunching the browser and retrying those pages. Failed pages: `m-swts-frc-ctn-rag-nvy`, `mens-classic-pique-polo-{heathered-graphite,black,navy}`, `mens-archive-cotton-relaxed-fit-crew-midnight-navy` and 6 more from the same tail of the queue.

**Run page deep link (finding).** Loading `/projects/credit-campaign-2026-10/sites/everlane/runs` or `/runs/f203bd44…` directly showed "This website does not exist in Credit campaign 2026-10", three times in a row. The same pages opened fine by clicking the Runs tab and then the run (`everlane-rerun-run.png`). The site's root URL loaded directly without trouble. (`packages/app/src/routeTree.gen.ts` is modified and uncommitted in the shared checkout at the moment, which may be related.)


### Screenshots (re-run)

- `everlane-rerun-find.png`: right after Find products. "52 products found · a pager too", the stale collection cards still on the board.
- `everlane-rerun-cards.png`: a fresh page load after the find. Dropping a card gave a blank card, because the queue was gone.
- `everlane-rerun-table-before.png`: the board with the three real products before filling.
- `everlane-rerun-table-filled.png` / `everlane-rerun-before-verify.png`: every cell accepted, the Verify label.
- `everlane-rerun-after-verify.png`: all 8 fields "verified 3/3".
- `everlane-rerun-sample.png`, `everlane-rerun-extract-before.png`: Sample result and the Run settings (custom 60 products × 3 pages).
- `everlane-rerun-run.png`: the run page.
