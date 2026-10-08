# decathlon.co.uk — credit campaign 2026-10-08

**Status: STOPPED (servers down), then RESUMED and DONE — see the last section.** The coordinator stopped the round partway through step 3, because the owner had shut down the dev servers. I had found the listing and screened it, and three proof pages were ready. No expected values were accepted. **Verify was not clicked and no Extract was started**, so nothing was spent on this website.

**Website**
- Name `Decathlon`, slug `decathlon`, source `c38b5cc1-1a09-4611-a90b-0a4635419ea1`.
- Added through the Add website dialog with the address `https://www.decathlon.co.uk`.

## Finding the listing (free)

- **Plain headless Playwright is walled.** I opened `https://www.decathlon.co.uk/` with the default user agent and waited 6 s, then 25 s. Both times it answered **403, "Just a moment…"**, and the page showed a Cloudflare "Verify you are human" checkbox (`decathlon-plain-headless-cloudflare.png`). The pre-screen's "site open" did not hold today.
- **The app's own launcher gets through.** That launcher is playwright-extra + stealth, Chrome 139 UA, en-US. With it, the homepage answered 200 and showed the full navigation.
- **Listing chosen:** https://www.decathlon.co.uk/sports/running/mens-running-shoes
  - I took it from the nav: Sports → Running → `/sports/running/mens-running-shoes`.
  - It answered 200, "Men's Running Shoes | Men's Running Trainers | Decathlon UK".
  - It holds about 38 `/p/…` product links and a pager `?from=40&size=40`.
- Two kinds of product pages appear on it:
  - Decathlon's own `/p/<slug>/<model>/<c…m<ID>>` pages. These show an **"ID 9001574"**-style model code under the description, plus a rating.
  - Marketplace `/p/mp/…` pages, such as Inov-8 sold by "Sport It First". These show no ID and no rating.
- JSON-LD on both kinds is a `ProductGroup` + `Product`, with the price under `offers.priceSpecification.price`. **I saw no `sku` in it.**

## Screen (free)

- "Find products" returned **"26 products found"**. The three cards it put on the board were **sub-category links, not products** (`decathlon-screen.png`):
  - "Road Running Shoes & Trainers": `ready`. Its suggestions were Title "Men's Road Running Shoes" and a meta description.
  - "Men's Road Racing Shoes": **"Bot detection (cloudflare) — site blocked automated access"**.
  - "Men's Trail Running Shoes": also blocked by Cloudflare.

  This is the known old-finder defect, so I added products by URL.
- **First swap**, after waiting about 2.5 min:
  - I added the Kiprun Kipstorm Tempo, which went `ready`.
  - I added the Asics Gel-Windhawk. The app reported **"redirected to https://www.decathlon.co.uk/r/men-s-running-shoe-asics-gel-windhawk-black-blue/…"**, although the same URL loads normally (200) in a stealth browser.
  - The script then timed out waiting for "+ Add product" to reappear.
- **Second swap**, about 1 min later:
  - I dropped the three category cards and clicked "Try again" on the Asics card, which then went `ready`.
  - I added the Jogflow 100.1, which went `ready`.
  - The 4th add (the marketplace Inov-8) again timed out on "+ Add product".
- **Third attempt** (Inov-8 only): the servers went down during it. The DB shows 3 cards, so the Inov-8 was never added.

**Proof pages on the board** (all `ready`, all multi-size shoes; colours are separate URLs):
1. https://www.decathlon.co.uk/p/men-s-road-running-shoes-kiprun-kipstorm-tempo-green-yellow/362245/c266c132m9001574
   - KIPRUN, £99.99 (was £119.99), 4.4 (603 reviews), ID 9001574.
2. https://www.decathlon.co.uk/p/men-s-running-shoe-asics-gel-windhawk-black-blue/361394/c1c5m9001312
   - ASICS, £79.99, 4.6 (1,770 reviews), ID 9001312.
3. https://www.decathlon.co.uk/p/men-s-jogflow-100-1-running-shoes-black-grey/337693/c382c227m8733464
   - Decathlon own brand, £14.99, ID 8733464.

**Planned 4th, never added:** https://www.decathlon.co.uk/p/mp/inov-8-trailfly-mens-running-shoes-black/20ff885a-192b-48ab-b859-bf8c2aa7918d/c251c1c24
- It is a marketplace page: INOV-8, £63.00, with no rating and no ID. It was meant to cover the marketplace layout.

## Expected values: suggestions seen, none accepted

After the swap, all 8 rows read "agreed · Accept" (`decathlon-inspect.png`). Nothing was accepted. I had not yet checked every value against the captures when the round stopped.

| Field | Suggested (1 / 2 / 3) | Against the live page |
|---|---|---|
| Title | Men's road running… / Men's running sh… / MEN'S JOGFLOW 10… | plausible |
| Price | 99.99 / 79.99 / 14.99 | matches £99.99 / £79.99; 3 was not checked |
| Main image | contents.mediadecathlon.com URLs | plausible |
| **SKU** | **5 / 2 / 5** | **wrong.** The pages show ID 9001574 / 9001312 / 8733464. "Agreed" here would certify a nonsense value. |
| Brand | KIPRUN / ASICS / DECATHLON | matches the brand line on 1 and 2 |
| Rating | 4.39 / 4.6 / 4.54 | unrounded JSON-LD values; the page prints 4.4 / 4.6 |
| In stock | In stock ×3 | matches "Add to basket" |
| Description | The Kipstorm Tem… / Equipped with GE… / With their soft … | matches the summary paragraph on 1 and 2 |

- **Verify:** not clicked. The label read **"Verify 8 fields · up to $0.40"**. Actual $0.
- **Extract:** not started. There are 0 runs on this source.

## Findings in the product

1. **The SKU suggestion is "agreed" and wrong**: 5 / 2 / 5 against the visible "ID 9001574 / 9001312 / 8733464". "Accept all agreed (8)" would have accepted it. This is the same risk class as B&N's positional ISBNs.
2. **Find products offered sub-category links as products** ("26 products found"; the three cards were category pages). This is the known old-finder defect, not yet live.
3. **Captures hit Cloudflare intermittently.** Two of the three first captures were "Bot detection (cloudflare)", while a later "Try again" passed. One product capture was rejected as "redirected to …/r/…" though the URL is a normal 200 product page in a stealth browser; "Try again" cleared it.
4. **"+ Add product" was not found right after "Use this page"** on two occasions. The second URL in a batch, or the next one, timed out after 30 s. This may be a timing gap in my script rather than a product defect; it was not investigated before the stop.
5. Minor, as on Ulta: products added by URL show only a truncated URL in the column head.

## Screenshots

- `decathlon-plain-headless-cloudflare.png`: plain headless Playwright on the homepage hits a Cloudflare checkbox (403).
- `decathlon-screen.png`: after Find products. Three category cards, two of them blocked by Cloudflare.
- `decathlon-inspect.png`: the three real proof pages `ready`, with all 8 rows "agreed", including SKU 5 / 2 / 5.

## Resumed after the server restart (2026-10-08)

**Status: DONE.** The board was intact after the restart: the three proof pages were still `ready`, with all 8 rows "agreed", SKU still 5 / 2 / 5. Nothing had been accepted and there were no runs.

**Total spent on this website: $0.1586.** Verify cost $0. Sample cost $0.0908 and Extract cost $0.0678.

### Proof pages

- I added the planned 4th page, the marketplace Inov-8 Trailfly, by URL. It went `ready` in 9 s, with no Cloudflare page this time.
- So the board covers both layouts:
  - three Decathlon `/p/…/m<ID>` pages;
  - one `/p/mp/…` marketplace page, which has no ID and no rating.

### Expected values

I checked every value against the capture's box text, not only the suggestion.

| Field | What it needed | Values (1 / 2 / 3 / 4) | Verdict |
|---|---|---|---|
| Title | agreed (row Accept) | the h1 on each page | verified 4/4 (json-ld) |
| Price | agreed | 99.99 / 79.99 / 14.99 / 63. The pages show "£99.99 Current price" (was £119.99), "£79.99", "£14.99" (was £19.99), "£63.00" | verified 4/4 (json-ld) |
| Main image | agreed | the `p3159779…`, `p3079849…`, `p3239545…`, `m16047959…` URLs. Each is an `<img>` in its capture | verified 4/4 (json-ld) |
| **SKU** | **marked** on 1–3; **absent** on 4 | `ID 9001574` / `ID 9001312` / `ID 8733464` / —. The mark takes the whole visible span, "ID" prefix included | verified 3/3 (xpath `product_productinfo_id`), no AI |
| Brand | agreed | KIPRUN / ASICS / DECATHLON / INOV-8. Each is the brand line above the h1 | verified 4/4 (json-ld) |
| Rating | agreed on 1–3; **absent** on 4 | 4.39 / 4.6 / 4.54 / —. The page prints 4.4 / 4.6 / 4.5, and the exact values are in the page's "Rating of 4.39 out of 5" text. I accepted them as the site's own data, as on Made In and Lookfantastic | verified 3/3 (json-ld) |
| In stock | agreed | In stock ×4 ("Add to basket" on every page) | verified 4/4, `weakEvidence: true` |
| Description | agreed | the summary paragraph under the h1 on each page | verified 4/4 (json-ld) |

Totals across the 8 fields: 7 agreed rows, SKU marked (3 cells), 0 typed. Two cells are absent, both on product 4: SKU and Rating.

**SKU on product 4 blocked Verify.**
- After I marked SKU on 1–3, product 4 still carried the suggestion "5" ("page data: 5"). The page has no ID.
- Verify was disabled with **"SKU has a suggestion to confirm on product 4"**.
- The field details offer **"Reject the SKU suggestion"**, which cleared the cell and enabled Verify.
- **The rejection is not saved.** After a reload, "5" is back and Verify is blocked again (`decathlon-resume-after-verify.png` shows it again after Verify).
- So the reject and the Verify click had to happen in the same page visit.

### Verify (one click)

- **Label:** "Verify 8 fields · up to $0.40".
- **Clicked once** at 13:40:47 UTC. It took 20.6 s.
- **Result:** `allPassed: true`, 0 AI calls, **actual $0.0000**. All 8 fields were verified.
- Screenshots: `decathlon-resume-before-verify.png` (product 4's SKU rejected, Verify enabled) and `decathlon-resume-after-verify.png`.

### Sample (about 2 min after Verify)

- Pages walked 1. **Product links found: 30.** Pagination: "not reported".
- The probe run cost **$0.0908**. It ended `partial` with "budget reached: 30 items", and its 3 rows were the three Decathlon proof pages.
- Right after the sample the card read **"Sample rows complete 0 of 0"** while the step header said "3 rows extracted" (`decathlon-resume-sample.png`). After a reload it read "3 of 3".

### Extract (one start, about 2 min after the Sample)

- **Settings:** 55 products, 2 pages, which the page summarised as "first 55 products from each · first 2 pages of each".
- **Result:** completed, **40 rows**, **$0.0678**, 513.9 s, which is **12.8 s per item**.
- **The item budget did not bind.** The run walked only listing page 1: "no pagination detected … planned page 1 only", and "api-param pagination not applied". Decathlon's pager is `?from=40&size=40`.

| Field | Filled | Notes |
|---|---|---|
| Title | 39/40 | |
| Price | 39/40 | |
| Main image | 39/40 | |
| SKU | 35/40 | 4 marketplace `/p/mp/` pages have no ID (correctly empty) + Ekiden One |
| Brand | 39/40 | |
| Rating | 40/40 | **but 5 are `0`**: three Inov-8 marketplace pages and two Adidas Galaxy 8 pages. These pages show no rating; the 0 comes from the certified fallback `stats.averageRating` (api) |
| In stock | 40/40 | all `true` |
| Description | 39/40 | |

- **The 1-in-40 miss is the Ekiden One** (`/p/ekiden-one-men-s-shoes-grey/9713/c248c227m8351755`). It came back with only rating 4.53 and in_stock. The live page in a stealth browser is a normal page: 200, JSON-LD with name, brand DECATHLON, price 11.99, and ID 8351755 visible. The run stored no HTML for it, so the cause is unknown.
- Spot check: SKUs, prices, brands and titles on the other rows look right.
- Description on product 2 came out with "GELTM" for "GEL™". This is normalisation; it still verified.
- The run page is in `decathlon-resume-run.png`.

### Findings in the product (this round)

1. **A wrong suggestion on a 4th product blocks Verify, and its rejection is not saved.** The bad SKU "5" on product 4 returns after a reload, so Verify is disabled again until it is rejected again in the same visit.
2. **The SKU suggestion was "agreed" and wrong** on products 1–3 (5 / 2 / 5), and product 4 was offered "5" as well. The real value had to be marked. This repeats the first round's finding #1.
3. **A certified Rating path writes `0` for products with no rating.** This is the api `stats.averageRating` fallback, and it gave 5 of 40 rows a value the page does not show. Verify could not catch it, because product 4's Rating was absent and so was never checked.
4. **No pagination was detected on Decathlon's listing.** The run stopped at 40 of the 55 budgeted, and the run page does not say that the budget went unspent.
5. **The Sample card said "0 of 0" sample rows right after sampling**, while the header said "3 rows extracted". It was correct after a reload.
6. **The Sample cost $0.09 after a free Verify**, more than the Extract itself ($0.068).

Screenshots: `decathlon-resume-before-verify.png`, `decathlon-resume-after-verify.png`, `decathlon-resume-sample.png`, `decathlon-resume-run.png`.
