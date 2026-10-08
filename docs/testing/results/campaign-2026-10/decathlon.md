# decathlon.co.uk — credit campaign 2026-10-08

**Status: STOPPED (servers down).** The coordinator stopped the round partway through step 3, because the owner had shut down the dev servers. I had found the listing and screened it, and three proof pages were ready. No expected values were accepted. **Verify was not clicked and no Extract was started**, so nothing was spent on this website.

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
