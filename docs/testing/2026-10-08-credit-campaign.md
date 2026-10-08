# Credit campaign, 2026-10-08 → 2026-10-16: many real websites through Verify and Extract

**Why.** $100 of Anthropic API credit arrived 2026-10-08 and expires in eight days; another
$100 follows later. Unspent credit is wasted, so the usual frugality is inverted for this
window — but the standing rule holds: never re-run a paid proof for a better-looking result.
Spend on *new* evidence.

**The key fact that shapes the plan.** A verified website extracts for ~$0 in AI (certified
paths only, no model call). The model is paid during Verify (~$0.05 per AI field per step,
shown as "up to $x" before the click) and during uncertified extraction (~$0.03–0.05 per field
per item). $100 is therefore ~2,000 AI field-calls: it cannot be spent on one or two websites.
Spending it means **breadth** — 20 to 30 new real websites, each through Verify and then an
Extract of 50–100 items — which is also what "test the product properly" needs. Today the
owner's org has one real website (Ikea, verified 8/8 for $0.00, mechanical paths) and it has
never had an extraction run.

Decision (Marko, 2026-10-08): a fresh list of websites across categories, chosen for fields that
genuinely need AI and for no anti-bot wall; the known-reachable sites go first so the campaign
starts fast.

## Where the campaign lives

- **Organisation:** a dedicated org, created by signing in as `credit-campaign@example.com`
  through `/login` (the way the route smoke makes its throwaway), named "Credit campaign
  2026-10". Marko's own user is added as an **owner** of that org by one SQL insert into
  `memberships` (after the `pg_dump` taken 2026-10-08 11:58, kept outside the repo), so he sees
  every website and run in his org switcher. Nothing is created in his personal org
  "Markodjordjievski" (the 27 leftover test projects there are a separate cleanup item).
- **One project:** "Credit campaign 2026-10", whose field list (the contract) is the same for
  every website: Title, Price, Image, SKU, Brand, Rating, In stock (availability), Description —
  taken from the catalogue where it has them. Title/Price/Image are usually mechanical (JSON-LD);
  Brand, Rating, In stock and Description are the ones that make Verify reach for the model.
- **Servers:** Marko's `pnpm dev:all` (app :3000, api :4000) with `ANTHROPIC_API_KEY` loaded
  (the Verify button already shows "up to $…", so AI is available). Nothing is restarted.

## Budget rules

| Rule | Value |
|---|---|
| Campaign ceiling | $90 of the $100 (the last $10 is headroom for the judge and re-checks) |
| Per-website Verify cap | whatever the button shows, at most $3; above that, skip the site and record why |
| Per-website Extract | 50–100 items, `max_pages` sized so the budget binds; never the 5,000 ceiling |
| Re-runs | none for a better number; a failed site is recorded and left |
| Politeness | the engine's 2 s per host; at most 3 websites worked at once, each on a different host |
| Stop line | when the Usage page shows ≥ $90 spent in this org, stop and report |

Spend is read from the app's Usage page (`source_verifications.cost_usd`, `runs.cost_usd`), not
estimated by hand.

## Protocol per website (one agent, one site, all free until the Verify click)

1. **Screen (free).** Open the listing URL in the Verification tab's listing bar → "Find
   products". If the listing yields fewer than 3 product links, the pages fail to capture, or the
   screenshots show a bot wall / consent wall the dismisser cannot pass, record `blocked` and stop.
2. **Proof pages (free).** Take 3 products from the listing (4–6 when the site has visibly
   different layouts, e.g. a sale item and a regular one). Wait for the three screenshots.
3. **Expected values (free).** Read each product page in the screenshot panel and, for every
   field: accept an agreed suggestion when it is right; otherwise mark the element on the
   screenshot or type the value shown on the page. Never type a value that is not on the page.
   Record what each field needed (agreed / marked / typed / absent).
4. **Verify (paid).** Read the button's price. If ≤ $3, click Verify once. Record the amount
   shown, the time the strip ran, and the verdict per field (verified / fails on product n). Do
   not re-verify to improve a verdict; a field that fails is evidence.
5. **Extract (paid or free).** On the Extract tab set the listing and a budget of 50–100 items
   (fewer if the listing is small). Start it once. Record items extracted, per-field hit rates
   from the run page, cost from the run, time per item.
6. **Record** one row in the table below and a short per-site note under
   `docs/testing/results/campaign-2026-10/<site>.md` (what was blocked or odd, screenshots of
   anything surprising). Report defects in the product as findings, not as things to fix.

## Websites

Known reachable first (used in live checks since September), then the fresh list by category.
Each entry: listing URL to paste. A site that screens `blocked` is struck through with the reason.

**Known:** everlane.com (men's tees listing), nike.com (men's shoes listing), allbirds.com
(men's shoes), barnesandnoble.com (a bestsellers list), target.com (a category page),
bhphotovideo.com (a lens category), zalando.co.uk (a category), currys.co.uk (a category).

**Fresh — fashion:** cos.com, arket.com, patagonia.com, uniqlo.com (expected blocked: Akamai),
weekday.com. **Electronics:** crutchfield.com, adorama.com, scan.co.uk, box.co.uk.
**Home:** article.com, crateandbarrel.com, westelm.com, made-in-cookware.com.
**Books/media:** bookshop.org, thriftbooks.com, blackwells.co.uk. **Sports/outdoor:** rei.com,
decathlon.co.uk, backcountry.com. **Beauty:** lookfantastic.com, ulta.com. **Toys/other:**
lego.com, hobbycraft.co.uk. **EU marketplaces (JSON-LD-light):** bol.com, otto.de,
mediamarkt.de.

Expected to be walled (try once, record, move on): asos, wayfair, bestbuy, sephora, homedepot,
etsy.

## Tracking

| # | Website | Screen | Proof pages | Fields agreed / marked / typed / absent | Verify $ shown / actual | Verdict | Extract items / hit rate | Extract $ | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 0 | ikea.com (owner's org, already verified 2026-09-21) | ok | 3 (existing) | — | free / $0.00 | 8/8 verified (mechanical) | 40/40 · 100% on all 8 fields | $0.00 | First extraction run ever on this website, via the CLIs; run `01af1eb0…`; plan 27.9 s, execute 403.6 s → **10.1 s/item** (7–10 s capture + politeness); no bot-wall degradation. `results/campaign-2026-10/ikea-free-extract.md` |

| 1 | allbirds.com (`/collections/mens`, 148 products) | ok | 3 | 6 / 2 / 0 / 0 (Brand "Accept anyway"; Description marked on 2 pages, Main image on 1) | up to $0.40 / **$0.00** (0 AI calls, 5 s) | 8/8 verified | first try: **not started** — Sample found 1 product link on the 148-product listing. **Re-run after fix B (servers restarted): Sample 30 links, Extract 60/60** distinct products in 637 s → **10.6 s/item**; Title, Price, Main image, SKU, Brand, In stock 60/60; Rating 55; Description 52; 5 rows spot-checked live, all match | Sample $0.0376; re-run Sample $0.03, run $0.15 shown (shared counter) | Findings: (a) the Sample/Extract crawler finds 1 link where Find products finds 148 — the known "listing check vs probe walk count differently" gap, now blocking; (b) a run's cost is the delta of a counter shared by the whole api-server, so parallel workers' AI calls land on whichever run finishes ("No AI. Free." Sample charged $0.0376); (c) Main image on a colour-variant page is the default colour's 100 px thumbnail and still verified 3/3; (d) Description "agreed" on structured text two pages don't show. `results/campaign-2026-10/allbirds.md` |

| 2 | everlane.com (`/collections/mens-tshirts`, 68 products) | ok (no wall) | first try **none**; **re-run after fix A (servers restarted): "52 products found · a pager too", the first three real `/products/…` pages** → 3 different tees, each in 6 sizes and 2–15 colours | re-run: 5 / 2 / 0 / 0 (Title marked — "Everlane" suggested on all three; Rating marked; Brand "Accept anyway"); every agreed value checked and correct | up to $0.40 / **$0.00** (10 s) | 8/8 verified | re-run: **41 of 52**, `partial`, 24 min → 35.4 s/row; every field 41/41 except Rating 35 (sold-out products); the 11 failures were one browser crash ("Target crashed") during the host's memory crisis, after which the rest of the queue failed within 42 s with **no retry or browser restart** | $0.07 run, $0.08 Sample shown (shared counter) | First try — **blocked by the product:** Find products reported "94 products found" but every card was a `/collections/…` page — `largestProductGroup` in `packages/api/src/verify/find-product-pages.ts` keeps the biggest URL-pattern group, and ~137 menu/promo collection links outnumber ~52 `/products/…` links. The table then showed "agreed" for In stock and Description on category pages. Find products took 2.5 min with three workers running. `results/campaign-2026-10/everlane.md` |

| 3 | nike.com (`/w/mens-shoes-nik1zy7ok`) | ok | 4 (Metcon 10, Air Force 1 '07, Air Max 270, Vomero 18) | 5 / 1 / 1 / 1 (Description marked; Title typed — hidden menu elements cover the heading; Rating absent on the Vomero) | up to $0.40 / **$0.00** (0 AI calls, ~20 s) | 8/8 verified | **60/60** in 12 min 5 s → **12 s/item**; 60/60 on every field except Rating 55/60 (no-review products); every SKU matches its URL | Sample $0.09, run $0.16 (both suspect: shared counter — a B&N Sample inside this run recorded the identical $0.1611) | Findings: Find products found 13 links where the walk found 60; first three "products" were colours of one shoe; "agreed" rows carried another colour's Title/Description (Accept all would have saved bad values); hidden review-panel elements catch marking clicks; a field missing on one of the first three products blocks Verify with no hint that moving it to 4th place unblocks; Sample "0 of 0" vs "3 rows extracted"; URL-added products show no title/image; Status column cut off at 1440 px with 4 products. `results/campaign-2026-10/nike.md` |

| 4 | barnesandnoble.com (bestselling books, `/b/books/_/N-1fZ29Z8q8`) | ok (no wall, "33 products found") | 3 books (the finder's first three were two NOOK tablets and a promo banner from the menu) | 6 / 2 / 0 / 0 (SKU and Brand marked on all 3 — the agreed SKUs and the suggested publisher were wrong) | up to $0.40 / **$0.00** (0 AI calls, 20.5 s) | 8/8 verified | **60/60** (3 listing pages) in 885 s → **14.8 s/item**; Title, Main image 60/60; Price, SKU, Brand, In stock, Description 59/60; Rating 54/60 | $0.00 (Sample showed $0.1611 — shared counter) | **Hit rate ≠ correctness:** Price and SKU certified on *positional* JSON-LD paths (one offer among several formats), so most rows carry another format's price/ISBN — 3 of 3 live price checks wrong (Project Hail Mary $22.00 on the page, 14.99 extracted), SKU equals the URL's EAN on 24/60, the run page says "100% confidence"; In stock certified one alternate path per format. Also: 60 items are 57 books (format links → duplicate rows); menu/banner links first in Find products; URL-added cards show the URL as title; Sample panel contradictions; default name "Barnesandnoble". `results/campaign-2026-10/bn.md` |

| 5 | otto.de (sneakers `/herren/schuhe/sneaker/`, then coffee machines) | **blocked** — product pages (`/p/…`) answer HTTP 400 with an empty body to headless Chromium; listings load | 6 tried, all blank | none ("missing on product 1" on every row) | up to $0.40 / not clicked | — | not started | $0 | Findings: a blank, refused page is shown as **`ready`** with no hint it was blocked (page health should catch an empty capture); Find products' first three cards were a category page and two of its filter variants, on which 7 of 8 rows read "agreed" with the category's SEO text — Accept all would have certified a listing page as a product; the listing bar forgets "N products found" after a reload. `results/campaign-2026-10/otto.md` |

| 6 | scan.co.uk (SSDs, then RAM) | **blocked** — Cloudflare 403 ("Sorry, you have been blocked") to headless Chromium on the listings themselves | none | — | disabled / not clicked | — | not started | $0 | Findings: a 403 on the listing is shown as "No product links found… Paste product pages below." — nothing says the site refused the browser, and pasting cannot work when the whole host is blocked; after a 0-link find the board shows three empty columns with `https://shop.example…` placeholders and "Not saved" until a reload. Anti-bot is the handoff's open "Proxy budget" decision. `results/campaign-2026-10/scan.md` |

| 7 | hobbycraft.co.uk (acrylic paint, then yarn) | **blocked** — Cloudflare "Verify you are human" (403) on the listings | none | — | not clicked | — | not started | $0 | Same symptom as row 6: the challenge is reported as "No product links found… Paste product pages below", and Find products takes 60–70 s to come back empty although the 403 and the "Just a moment…" title are in the very first response. `results/campaign-2026-10/hobbycraft.md` |

| 8 | crutchfield.com (bookshelf speakers, then headphones) | **blocked** — Cloudflare challenge (403) on every page including the home page | none | — | disabled / not clicked | — | not started | $0 | Same class as rows 6–7: ~65 s to "No product links found", then a suggestion to paste pages that sit behind the same challenge. `results/campaign-2026-10/crutchfield.md` |

| 9 | bookshop.org (bestsellers list, then fiction) | **blocked** — Cloudflare "Verify you are human" (403); the capture cards do say "Bot detection (cloudflare)" | 3 non-book `/info/…` pages the finder offered; all captures failed | — | disabled / not clicked | — | not started | $0 | Find products said "16 products found" on a site the browser cannot load — the same 16 menu/footer pages for two different listings (Scan showed the opposite, "No product links found", for the same wall); the field rows say only "screenshot failed on product 1" and never name the wall. `results/campaign-2026-10/bookshop.md` |

| 10 | madeincookware.com (`/collections/cookware`, 35 products; Shopify) | ok (35 real `/products/…` pages, no wall; prices shown in MYR by geo) | 3 | 5 / 1 / 0 / 0 — SKU accepted from page data on all 3 (not visible on the page; ruling above), Title marked (its suggestion was the site name) | up to $0.40 / **$0.00** (20 s) | 8/8 verified | **35/35**, every field 35/35, 512 s → **14.6 s/item**; 7 rows hand-checked against live pages, all match | $0.00 (Sample showed $0.1030 — shared counter) | Findings: a field missing on every proof page blocks Verify with no "not on this website" answer; hidden search-menu areas over the title catch marks ("Popular Categories" saved as Title twice); re-marking a Title cell opened the popup with SKU pre-selected; cards named with the whole listing tile incl. rating text; Price stores a bare number while the currency follows the visitor's geo; Sample 30 links vs Extract 35 on the same page. `results/campaign-2026-10/madein.md` |

| 11 | ulta.com (moisturizers, 2,075 products) | ok (no wall; "140 products found · a pager too", but the first three cards were sidebar brand-filter links) | 3 moisturizers added by URL | 8 / 0 / 0 / 0 (every agreed value checked against the screenshots) | up to $0.40 / **$0.00** (20.4 s) | 8/8 verified | **60/60** over 3 pages, every field 60/60, 1,114 s → **18.6 s/item**; SKU = the `?sku=` in the URL on all 60; 4 rows checked live, all match | $0.00 (Sample $0.09, run $0.1030 shown — shared counter) | Findings: brand-filter links offered as the first three "products"; Sample panel "0 of 0" + "Pagination detected: not reported"; URL-added cards show only their URL. `results/campaign-2026-10/ulta.md` |
| 12 | article.com (`/browse/224/living-furniture`, 103 product links) | **rate-limited** — an AWS WAF "confirm you are human" CAPTCHA switches on after a few quick loads and lifts after ~8 min | 3 (a sofa, a sofa bed, a lounge chair, pasted — the finder's first three were colourways of one side table); captures passed on "Try again" after the wait | 8 / 0 / 0 / 0 (Brand "Accept anyway") | up to $0.40 / **$0.00** (15 s, all JSON-LD) | 8/8 verified | **0 rows** — the one Extract start hit the CAPTCHA on the listing page and finished in 6 s as green **"Done"** with "planning failed"; not re-run | $0.00 (Sample $0.20 shown — shared counter) | Findings: a blocked run is shown as completed; nothing slows down or retries on a CAPTCHA — the 2 s per-host gap is under this site's limit, so Sample + Extract back to back trips it; Find products accepted a 404 page as a listing ("66 products found"). `results/campaign-2026-10/article.md` |
| 13 | lookfantastic.com (`/c/health-beauty/face/skincare-products/moisturisers/`, ~70 links; the pre-screen URL was dead — the site moved to `/c/…/`) | ok (no wall; "39 products found · a pager too"; the first three cards were a sponsored one-brand strip) | 3 grid products added by URL, **each sold in one size** | 7 / 1 / 0 / 0 (SKU = JSON-LD `sku`, not visible on the page) | up to $0.40 / **$0.00** (15.4 s) | 8/8 verified | **50/50** in 1,154 s → **23.1 s/item**; Title, Main image, Description 50/50; Rating 45; Brand 43; SKU 42; **Price 21/50; In stock 21/50** | $0.00 (probe $0.20 shown — shared counter) | **Finding of the day:** every multi-size product publishes its offers differently (no top-level price), so the certified `offers[0]…` paths miss on all 29 of them — and nothing at setup hinted that a multi-size product belongs among the proof pages (the second-layout proof-pages note, now with a live case). Also: Extract walked 1 of 2 budgeted pages; a sponsored-ad URL was queued; the mark popover pre-selected another field (as on Made In); `&nbsp;` kept in Description; Brand and SKU certified through a reviews-API path with positional entries. `results/campaign-2026-10/lookfantastic.md` |

| 14 | target.com (over-ear headphones, `/c/…/-/N-ddjii`) | **blocked** — a "Quick verification — Press & hold" wall (PerimeterX/HUMAN) covers the listing once it scrolls; 4 `/p/` links appear before it; same after an 8-minute wait | none — Find products (67 s) said "2 products found": two footer pages (`/gift-registry` "page.goto: Page crashed", `/guest-privacy` shown `ready`) | — | disabled / not clicked | — | not started | $0 | The wall is not named anywhere; a footer page reads `ready` with "DSD Reporting Satisfaction Survey" suggested as its Title; a raw Chromium "Page crashed" log is shown on a card. Target is in the live corpus, so this is new since September. `results/campaign-2026-10/target.md` |

| 15 | decathlon.co.uk (`/sports/running/mens-running-shoes`, ~38 links) | partly — plain headless gets Cloudflare 403, but the app's stealth browser loads it; some captures still hit the wall and pass on "Try again" | 3 added by URL, all ready (Kiprun, Asics, Jogflow) | all 8 "agreed", none accepted before the stop; **SKU "agreed" as 5 / 2 / 5 where the pages show 9001574 / 9001312 / 8733464** | up to $0.40 / **$0.00** (20.6 s, after the resume) | 8/8 verified (4 proof pages: a marketplace Inov-8 added as product 4, no ID/rating) | **40 rows** at 513.9 s → **12.8 s/item**; Title, Price, Image, Brand, Description 39/40; SKU 35/40; In stock 40/40; Rating "40/40" but **5 are a false `0`** | $0.07 run, $0.09 Sample shown (shared counter) | Stopped when the dev servers were killed, resumed after the restart. Findings: SKU "agreed" wrong (5/2/5) — marked instead; a certified Rating fallback (`stats.averageRating` from an intercepted API) writes `0` for products with no rating, which Verify could not catch because Rating was absent on the only proof page without one; Decathlon's `?from=40&size=40` pager was not detected, so the run stopped at 40 of 55 without saying the budget went unspent; rejecting a wrong suggestion is not saved across a reload, so Verify is blocked again after one; one product (Ekiden One) came back almost empty though its page is a normal 200 with JSON-LD — cause unknown because the run stores no HTML. `results/campaign-2026-10/decathlon.md` |

**Servers restarted 2026-10-08 ~13:30 on the merged code** (Marko killed the terminals; the controller started `pnpm dev:all` from the session). Everlane and Allbirds re-run from here with fixes A and B live; Decathlon resumes from Verify.

**Pre-screen of the remaining fresh list (2026-10-08, free, headless Chromium with Playwright's default user agent, one GET per listing):** of 28 candidates, **2 open** (madeincookware.com, ulta.com), **12 walls** (Cloudflare / Akamai / "Just a moment…" — cos, arket, weekday, box, crateandbarrel, blackwells, backcountry, lego, bol, currys, bhphoto, asos), **11 errors** (403: adorama, westelm, mediamarkt, zalando, etsy; 406: thriftbooks; 429: wayfair; HTTP/2 error: rei; 404 on the chosen URL but the site itself open with a product grid on the landing page: article, decathlon, lookfantastic), **3 no-grid** (patagonia redirected to a checkout holding page; target's chosen URL landed on "Hardware"; bestbuy's country selector). Table and screenshots in the session scratchpad. Workers from row 10 on: madeincookware, ulta, article (real listing to be found), then lookfantastic, decathlon, target with corrected URLs.

**Anti-bot is the dominant blocker on the fresh list (rows 5–9).** Five of the first six fresh-list sites (Otto, Scan, Hobbycraft, Crutchfield, Bookshop) refuse headless Chromium outright; from row 9 on, every candidate is pre-screened with a free headless probe (status, title, product links) before a worker is dispatched; the known US brand sites did not. Two product gaps follow: (1) a refused page must be reported as refused, fast — the first response already says 403 / "Just a moment…" — not as "no product links"/"ready"; (2) the "Proxy budget" open decision in the handoff is now the gate to a large share of real customer targets.

Running total of spend (from the Usage page): **$0.45** for October, all workers (after row 7; the Nike judge run, ~$4, is in progress and is recorded in its own report, not on the Usage page)

**What the known-site batch says (rows 0–4, 2026-10-08):** every site verified with **zero model calls** — JSON-LD and APIs cover these brands — so the credit is untouched; extraction at scale works end to end on Ikea, Nike and B&N (10–15 s/item); two listing defects blocked Everlane and Allbirds (fixes A and B, see the hold note); and B&N shows the bigger risk: certified paths that *fill* every cell with a *wrong* value. The campaign therefore (1) judges extracted rows for correctness with the LLM judge — the one paid step that measures the right thing — and (2) biases the fresh list toward sites without structured data, where Verify must reach for the model.

**Campaign hold (2026-10-08, after rows 1–2):** two listing defects block the Extract half on Shopify-style stores — the finder preferring menu links (row 2) and the Sample/probe walk finding 1 link where Find products finds 148 (row 1; the handoff's "listing check and probe walk count product links differently" follow-up, now blocking). Both were fixed in isolated worktrees and are **merged into `main` on 2026-10-08** (`6b41779`+`9ab1fc8`: the finder leaves out links inside page-level navigation before grouping, and falls back to all links when fewer than 3 remain — Everlane 93 collections → 52 products, Allbirds 148, Ikea unchanged; `b418875`+`8b28758`: the grouping lives in `packages/scraper/src/crawl/product-link-group.ts`, shared by the finder and the listing walk, and after page 1 the walk plans from the page's product links when its row selector missed them and the group is confirmed by an extracted row or, on a direct listing, by a proof page — Allbirds Sample 1 → 40 of 40 with no AI). **The running api-server has the old code until it is restarted**; Everlane and Allbirds are re-run after that. Follow-ups recorded in the handoff: the 1-row selector is still cached as verified and pages 2+ reuse it; with an AI key the Sample still pays for a new selector before the free check runs.

**Measurement caveat (from row 1, finding b):** per-run `cost_usd` is unreliable while several workers run at once; the org total on the Usage page is the number to trust, and per-site cost is read from `source_verifications.cost_usd` only when no other worker was verifying at the same minute.

## Judge runs (correctness, not hit rate)

`pnpm --filter @robot/api exec tsx src/judge-run.ts <runId> [--tiles N] [--max-usd X]` — built 2026-10-08 for this campaign (merged, `92653f1`…`78a50a9`): re-visits each item's page, screenshots it, and asks the calibrated LLM judge per non-empty value; the report is the record (no DB writes), so these costs do **not** appear on the Usage page.

| Run | Items | Judged values | Correct | Wrong | Uncertain | Cost | Report |
|---|---|---|---|---|---|---|---|
| Nike (row 3), first CLI version: **tile 1 only** | 60 | 475 (60 image URLs counted unverifiable) | Title 50, Price 50, Brand 52, Rating 39, In stock 46, SKU 2, Description 5 | 9 in all: In stock 6, SKU 1, Brand 1, Rating 1 | 222, almost all "not on page": SKU 57 and Description 55 sit below the first tile; 10 items came back not-on-page on *every* field (a blank or challenged capture — the later CLI version stops on that) | **$4.07** (484 calls, 1.34 M input tokens) | `results/2026-10-08T10-58-judge-run-nike.md` |

| Barnes & Noble (row 4), **three tiles** | 57 of 60 (stopped at the $5 cap) | 445 + 57 image URLs unverifiable | Title 56, Price 55, Description 55, Rating 40, In stock 34, Brand 24, SKU 4 | 59 in all: Brand 27, SKU 19, Rating 11, Price 1, Description 1 | SKU 30 not on page (ISBN below tile 3 or in a tab), In stock 9 not on page + 13 unverifiable | **$4.98** | `results/2026-10-08T11-10-judge-run-barnesandnoble.md` |

| Ikea (row 0, owner's org), three tiles | 40 | 320 | Price 38, Price currency 40, Title 39, Subtitle 40, Total reviews 32, Product details 11, Product id 9, Average rating 16 | 25: Average rating 15, Product details 6, Product id 3, Title 1 | Product id 21 and Product details 15 not on page (below the tiles / in a panel) | **$3.88** | `results/2026-10-08T11-41-judge-run-ikea.md` |
| Made In Cookware (row 10), three tiles | 33 of 35 (stopped at the $3 cap) | 231 + 33 image URLs | Price 33, Brand 33, Description 31, Title 30, Rating 28 | 6: Title 3, Rating 2, Description 1 | SKU 32 not on page (accepted from page data, never visible), In stock 19 not on page + 14 unverifiable | **$2.97** | `results/2026-10-08T11-53-judge-run-madeincookware.md` |

| Lookfantastic (row 13), three tiles | 50 | 272 + 50 image URLs | Title 49, Price 21 (of 21 extracted), Brand 43, Description 49, In stock 17, Rating 24 | 21: all Rating | SKU 30 not on page + 12 unverifiable (never visible; from page data) | **$3.46** | `results/2026-10-08T13-13-judge-run-lookfantastic.md` |

| Ulta (row 11), three tiles | 60 | 420 + 60 image URLs | Title 59, Price 60, SKU 55, Brand 60, Rating 60, In stock 60, Description 58 | 3: SKU 1, Description 2 | SKU 4 unverifiable | **$4.12** | `results/2026-10-08T13-13-judge-run-ulta.md` — Rating 60/60 because Ulta prints the number beside the stars, which confirms the Rating "wrongs" elsewhere are the judge reading glyphs |

| Allbirds (row 1 re-run), three tiles, re-run alone after the memory kill | 36 of 60 (stopped at the $4 cap) | 244 + 36 image URLs | Title 36, Price 36, Brand 36, In stock 10, Description 2 | 10: **Description 8**, In stock 2 | SKU 35 not on page (style code, never visible), Rating 33 not on page (stars only), In stock 18 unverifiable | **$3.95** (+ ~$1.20 lost in the killed first attempt) | `results/2026-10-08T14-30-judge-run-allbirds.md` — the 8 Description wrongs are the JSON-LD description the pages do not show (the day-1 worker flagged exactly this "agreed" row); In stock wrongs are size-level sell-outs again |

| Decathlon (row 15), three tiles, re-run alone after the memory kill | 40 | 310 + 39 image URLs | Title 37, Price 31, SKU 26, Brand 39, Description 37, In stock 13, Rating 9 | 33: **Rating 28** (includes the five false `0`s — the judge reads 4.8 where `0` was extracted — plus star-glyph reads), Title 2 (a model-year suffix the page no longer shows), In stock 2, Description 1 | Price 8 and SKU 9 not on page; In stock 22 unverifiable | **$2.99** (+ ~$1.10 lost in the killed first attempt) | `results/2026-10-08T14-50-judge-run-decathlon.md` — the false-`0` ratings from the API fallback are caught as wrong, which is the one case so far where the judge found an error a hit rate hid completely |

**Eight judge runs, ~$30.40 (+ $3.26 in the two interrupted attempts, whose reports were written on the kill — `2026-10-08T14-02-judge-run-*.md`), ~2,850 values judged.** Where a value was visible, Title, Price, Brand, Description and In stock were right on every site but Barnes & Noble (multi-format positional paths) and Nike's one "Coming Soon" stock status. The judge's own limits are now known: star-glyph ratings, "appears anywhere on the page" on multi-offer pages, field-name vocabulary (Brand vs Publisher, SKU vs ISBN), and values below three tiles.

**Reading Ikea and Made In:** Price is right everywhere the judge could see it (38 of 38 and 33 of 33). Ikea's 15 "wrong" Average ratings are the judge reading star glyphs against a numeric value from the page data, as on B&N; Made In's 3 Title wrongs are worth a look in the report (a site-name or set-name mismatch). Across four judged runs (Nike, B&N, Ikea, Made In; ~$16): **Price and Title are correct on every page where the judge sees them, except B&N's multi-format pages**; the real wrongs are stock status on a "Coming Soon" shoe, B&N's positional ISBNs, and ratings the judge cannot read precisely from stars.

**Reading Barnes & Noble's wrongs — the judge catches the positional-path error, and shows two limits of its own.** (1) **SKU:** of the 19 wrongs, at least 4 are *value* mismatches — the extracted ISBN differs by a few digits from the one the page shows (…573788 vs …577788, …108354 vs …391000, …820254 vs …820247): another format's ISBN, exactly what row 4 found by hand; the other 15 are "the page labels it ISBN-13, not SKU" — a naming objection, not a value error. (2) **Price:** judged 55 of 56 correct, yet row 4's hand checks found 3 of 3 wrong (Project Hail Mary: page $22.00, extracted 14.99 — judged `C1`). The judge accepts a value that appears *anywhere* on the page, and on a multi-format page the eBook price is on screen in the format selector; the one Price "wrong" ($14.99 eBook vs $26.99 B&N Exclusive) is the same pattern caught once. (3) **Brand:** 27 "wrongs" are all "the page calls it Publisher" — the judge is given the field *name*, not the customer's descriptor ("the publisher"), so a correct value fails on vocabulary. (4) **Rating:** 11 wrongs are the judge reading star glyphs (~4.5) against a numeric 4.9 in the page data — mostly judge imprecision, a few possibly another format's rating. Two improvements to the judge follow: pass the field's descriptor and type with the name, and ask for the *primary displayed* value on pages with several offers, not "appears anywhere".

**Reading Nike's wrongs:** of the 9, one is a real extraction error (In stock `true` on a "Coming Soon" shoe); five In stock "wrongs" are the judge reading size-level sell-outs against a product-level value (a definition question for the In stock field, not an extraction error); the SKU, Brand and Rating wrongs are "the page does not display it" — values the page carries in data but not in the viewport. So where the judge could see the value, Nike's certified paths were right on every Title, Price and Brand it checked, and the one real error is a stock status. The Barnes & Noble run (three tiles) is the test of whether the judge catches the positional-path errors row 4 found by hand.

## What the campaign answered (written 2026-10-08, after rows 0–15 and the judge runs)

**Scope reached.** 16 websites touched in one day (rows 0–15). Marko's decision at the end of
the day: stop adding sites, finish the two interrupted judge runs one at a time, write up.
**Final spend 2026-10-08: ~$30.40 in eight judge runs (+ $3.26 in the two interrupted attempts, whose reports were written on the kill — `2026-10-08T14-02-judge-run-*.md`) and
~$1.30 of mis-attributed Sample/Extract charges on the org's Usage page; Verify and Extract
themselves cost $0.00 everywhere. About $65 of the $100 remains for the week.** Two more
findings from the re-runs: a browser crash mid-run fails the rest of the queue with no retry
or browser restart (Everlane, 11 items), and Find products leaves the old cards on the board
so the new products are only reachable by dropping cards in the same page session.

**1. How many real websites verify, and why.** Of the 16: **9 verified 8 of 8** (Ikea, Allbirds,
Nike, B&N, Made In, Ulta, Lookfantastic, Decathlon, Everlane after fix A) — every one with
**zero model calls**, because JSON-LD, meta tags or an intercepted API carried the fields, and
marking an element on the screenshot gives an XPath directly. **Article verified too** but
could not extract (CAPTCHA). **6 never got a value in** (Otto, Scan, Hobbycraft, Crutchfield,
Bookshop, Target): all anti-bot walls, not product failures. The pre-screen of 28 further
candidates found 2 open. Field by field, nothing needed the model; the fields that needed a
*person* were SKU (not visible on 3 sites; wrong "agreed" suggestion on 2), Title (site name
suggested on Made In; hidden overlays over the heading on Nike and Made In) and Brand ("same on
every product" on 4 sites).

**2. Cost.** Verify: estimated "up to $0.40" everywhere, actual **$0.00** everywhere. Extraction:
**$0.00 in AI per item** on every verified site. The campaign's AI spend went entirely to the
judge — **$23.48 for six runs** before the interruption, $3.26 spent in the two interrupted attempts (reports kept), plus
the two re-runs. Per-run `cost_usd` figures in the app are unreliable under concurrency (shared
process counter); only the org total on the Usage page is right.

**3. Which fields need the model.** None, on these sites, at Verify time. The model would be
reached only where no structured path exists *and* the customer cannot mark the value — a case
the campaign did not meet. The judge is where the model earns its keep: correctness, which no
hit rate shows.

**4. Where the product got in the way** (each a finding for the handoff, grouped):
- *Anti-bot* is the gate: 11 of 16 sites refused or rate-limited headless Chromium at some
  point; the app reports a wall as "No product links found", "N products found" (menu pages),
  `ready` (blank capture) or a green "Done" run with 0 rows — never as "the site refused us".
- *Listing finder* (fixed 2026-10-08): menu links beat products; the walk accepted a 1-row
  selector. Still open: colourways of one product offered as the first three; sponsored
  strips, filters and 404 pages accepted as listings; Sample counts differ from Extract (30 vs
  35, 13 vs 60).
- *"Agreed" is not "right"*: Title/Description from another colour (Nike), SKU 5/2/5
  (Decathlon), the site name as Title (Made In), category SEO text as Description (Everlane,
  Otto), positional offers (B&N). Accept all agreed would have certified each.
- *Proof pages must cover the site's variations*: Lookfantastic lost Price and In stock on all
  29 multi-size products; Decathlon's Rating fallback writes a false `0` on no-rating products
  that no proof page had. This is the second-layout proof-pages design, with live cases.
- *Verify's gate*: a field absent on every proof page blocks Verify with no "not on this
  website"; a rejected wrong suggestion is not saved across a reload.
- *Marking*: hidden overlays catch clicks (Nike reviews panel, Made In search menu); the popover
  pre-selects the wrong field (Made In, Lookfantastic).
- *Run reporting*: Sample "0 of 0" vs "3 rows extracted"; "Pagination detected: not reported";
  pagination missed on Decathlon (run stopped at 40 of 55 silently) and Lookfantastic (1 of 2
  pages); a product that came back empty with no stored HTML to explain why.
- *Money*: Price stored without currency while the shown currency follows the visitor's geo
  (Made In in MYR); per-run cost mis-attribution.

**5. Throughput.** Measured 10.1–23.1 s per item across eight sites (median ~13 s), all of it
capture time; the lean-capture second increment and parallel websites
(`docs/superpowers/specs/2026-10-07-run-speed-and-language-note.md`) are confirmed as the
levers, and the machine's memory (three Chromiums + the dev servers tipped 16 GB) caps how
parallel a single box can go.

**What the judge taught about itself.** It judges "appears on the page", not "is the displayed
value" (B&N's eBook price passes); it reads star glyphs, so numeric ratings fail unless the
number is printed (Ulta 60/60 vs B&N/Ikea/Lookfantastic ~50%); it is given the field *name*,
so Brand fails as "Publisher" and SKU as "ISBN"; three tiles cover most pages but not tabs.
Two changes would make it a QA tool: pass the field's descriptor and type, and ask for the
primary displayed value on multi-offer pages.

**Next work this suggests, in order:** (1) report a refused page as refused, fast, everywhere
it can appear; (2) proof pages that cover variations — the second-layout design, now with
cases; (3) the "agreed" rule must not agree on values the page does not show for *that*
product; (4) a run's cost per process, not per counter; (5) the judge changes above, then judge
every extraction as a matter of course.
