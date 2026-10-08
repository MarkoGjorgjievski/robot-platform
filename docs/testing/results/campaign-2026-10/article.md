# article.com — credit campaign 2026-10-08

**Status: Verify DONE (8/8, $0.00); Extract BLOCKED.** The one Extract start ran into article.com's AWS WAF "Let's confirm you are human" CAPTCHA on the listing page and returned 0 rows. It was not re-run (one start per website).

- Website: `Article` (slug `article`, source `1e032e97-eb20-4f56-bf1a-e0d11b8f2dc1`). Added through the Add website dialog with `https://www.article.com`; the name prefilled as "Article".
- Listing chosen: **https://www.article.com/browse/224/living-furniture**.
  - The homepage nav has no sofas or chairs category of its own. Rooms → Living Room is `/browse/224/living-furniture`, which answers 200 with 103 `/product/…` links (sofas, sofa beds, lounge chairs). Guesses such as `/browse/3/sofas` and `/c/sofas` were tried only after the WAF had already started to block (below), so it is not known whether they exist.
- Proof pages (all three pasted by URL from the living-furniture grid):
  1. https://www.article.com/product/30333/timber-90-leather-sofa-charme-tan ($1799)
  2. https://www.article.com/product/19595/braam-75-sofa-bed-vintage-white ($1299)
  3. https://www.article.com/product/21475/gabriola-34-lounge-chair-ivory-boucle ($499)

## The site's bot wall (AWS WAF) — the main fact for this site

- article.com sits behind AWS WAF with a CAPTCHA challenge ("Let's confirm you are human … Begin", HTTP 405, title "Human Verification").
- The wall comes and goes by rate. In a plain headless Chromium the homepage and the living-furniture page loaded fine. After about 5 page loads in 3 minutes every URL got the challenge, and it lifted after about 7 minutes.
- In the app:
  - **Find products** worked (13:2x). The first attempt was worker error, see "Screen".
  - **Proof captures** first failed with "CAPTCHA detected — site requires human verification" on all three cards (`article-captcha-cards.png`). They were done after "Try again" at 13:51, following an 8-minute wait.
  - **Verify** ran clean at 11:53Z.
  - **Sample**: the first one (11:53:46Z, probe `05dd3186…`) failed with "listing capture failed: Page blocked or unusable: CAPTCHA detected". The second (12:00:13Z, probe `cc0a6cce…`) passed.
  - **Extract** (12:02:22Z, run `5ffecccb…`) was blocked again by the CAPTCHA on the listing page, about 2 minutes after the sample had walked the same page.
- The engine's 2 s per host is not enough to stay under this WAF's threshold. A Sample followed by an Extract alone is enough to trip it.

## Screen (free)

- **Worker error (mine):** my script's listing constant still held a Barnes & Noble path, so the first "Find products" ran on `https://www.article.com/b/books/_/N-1fZ29Z8q8`.
  - On article.com that is a 404 page carrying a product grid, the same thing the pre-screen saw. Find products reported **"66 products found"** from it without any hint that the page was a 404 (`article-screen.png`; finding 3).
  - The listing was corrected to living-furniture on the Extract tab (Edit pages) before Sample and Extract.
- The first three products it put on the board were **three colourways of the same Portima C Side Table**, all with the same price, rating and description. That is no use as a proof set, so I swapped them for the three models above.
- No consent wall. Once the WAF lifted, all three captures read `ready` and showed the real product page (checked in the screenshot panel: title, price, stars, Add to Cart).

## Per-field table

| Field | What it needed | Certified (first path) | Verdict | Extract hit rate |
|---|---|---|---|---|
| Title | agreed (row Accept) | json-ld `name` | verified 3/3 | n/a (0 rows) |
| Price | agreed (1799 / 1299 / 499, matching "$1799", "$1299" and "$499" on the pages) | json-ld `offers.price` (+ api `data.product.price[0].price`, regularPrice xpaths) | verified 3/3 | n/a |
| Main image | agreed (the CDN file sits under the page's own SKU folder) | json-ld | verified 3/3 | n/a |
| SKU | agreed (SKU2128 / SKU19595 / SKU12860, matching "SKU No." on each page) | json-ld `sku` (+ api `data.product.skuNo`, mpn, productID, specs xpath) | verified 3/3 | n/a |
| Brand | "same on every product — check it" → Accept anyway ("Article"; the site's own brand, from JSON-LD) | json-ld `brand.name` (weakEvidence) | verified 3/3 | n/a |
| Rating | agreed (4.6 / 4.6 / 4.8, matching the pages: 4.6 (2212), 4.6 (120), 4.8 (810)) | json-ld | verified 3/3 | n/a |
| In stock | agreed (Add to Cart and delivery dates on all three; no stock text is printed) | json-ld | verified 3/3 | n/a |
| Description | agreed (the overview paragraph, word for word on all three) | json-ld | verified 3/3 | n/a |

**Counts:** agreed 8 (Brand via "Accept anyway"), marked 0, typed 0, absent 0.

## Verify (paid, once)

- Label **"Verify 8 fields · up to $0.40"** (≤ $3). Clicked once at 11:53:05Z.
- Wall time **15.3 s** (server 11:53:05 → 11:53:18).
- **8/8 verified**, allPassed, **0 AI calls, actual $0.00** (`source_verifications` `861fd013…`, cost_usd 0.0000). Every field certified on JSON-LD, with API and XPath alternates.

## Sample (free step)

- Probe 1 (11:53:46Z) ran on the stale B&N-path listing and failed on the CAPTCHA (see above).
- Probe 2 (12:00:13Z, after fixing the listing): 95 s, **1 page walked, 30 product links**, "3 rows extracted", status `partial`. The panel again read "Sample rows complete 0 of 0" and "Pagination detected: not reported", as on B&N and Nike.
- Probe 2 recorded **$0.2000** although the button says "No AI. Free.". Lookfantastic's probe (12:00:45–12:02:00Z, overlapping) also recorded exactly **$0.2000**. This is the shared-counter caveat from the Nike note; reported as shown.

## Extract (once)

- Budget: custom **60 products × 3 pages**. The sentence read "1 listing · first 60 products from each · first 3 pages of each · safety stop at 5,000 products per listing".
- Clicked once at 12:02:22Z. Run `5ffecccb-411b-476c-949a-c8bf8fb88b75` was finished in **6 s**:
  - status `completed`, **0 rows, $0.00**;
  - error `input 0: listing capture failed: Page blocked or unusable: CAPTCHA detected — site requires human verification`.
- Items 0, hit rates n/a, s/item n/a.
- Org Usage page afterwards: **$1.15** for October (296 pages), all campaign workers combined.

## Findings in the product

1. **A run the bot wall blocked is shown as green "Done".** The run page shows "Extraction ● Done", 0 rows, and only "planning failed for all 1 input(s)". The DB error that names the CAPTCHA is not shown (`article-run.png`). The probe that failed on the same CAPTCHA was recorded as `failed`, but the real run as `completed`.
2. **The engine trips rate-based bot walls between its own steps.** Sample walked the listing at 12:00, and the Extract 2 minutes later was refused. There is no backoff or retry-later for "CAPTCHA detected" on a listing capture, and on a site like this a single run can never get going. The proof-page "Try again" button did work once the wall lifted.
3. **Find products accepts a 404 page as a listing.** On `/b/books/_/N-1fZ29Z8q8` (404 on article.com) it said "66 products found" with no warning, because article.com's 404 page carries a product grid.
4. **The finder's first three products were three colourways of one item** (Portima C Side Table walnut / oak / black). The same problem was seen on Nike. Their identical price, rating and description made the board useless for proof.
5. **"Accept all agreed (4)" + identical rows.** On that colourway board, 4 rows were offered as "agreed" and 4 as "same on every product". A customer who accepts them all certifies on three near-identical pages.
6. Sample still shows "0 of 0" and "Pagination detected: not reported", and the probe is charged $0.20 under "No AI. Free." (shared counter, overlapping Lookfantastic).
7. Minor: product cards added by URL show only the URL in the column head.

## Screenshots

- `article-screen.png`: Find products on the (wrong, 404) path. "66 products found", three Portima colourways on the board.
- `article-captcha-cards.png`: the three real proof pages, each "CAPTCHA detected — site requires human verification · Try again".
- `article-table-before.png`: every cell accepted, before Verify ("up to $0.40").
- `article-after-verify.png`: 8/8 verified.
- `article-sample.png`: the Extract tab after the second Sample (1 page, 30 links, "0 of 0").
- `article-run.png`: the run page, green "Done", 0 rows, "planning failed for all 1 input(s)".
