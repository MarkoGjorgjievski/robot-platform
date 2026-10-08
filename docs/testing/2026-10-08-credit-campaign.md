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

| 1 | allbirds.com (`/collections/mens`, 148 products) | ok | 3 | 6 / 2 / 0 / 0 (Brand "Accept anyway"; Description marked on 2 pages, Main image on 1) | up to $0.40 / **$0.00** (0 AI calls, 5 s) | 8/8 verified | **not started** — Sample found 1 product link on the 148-product listing ("0 of 0"), so an Extract would have returned ~1 item | Sample $0.0376 | Findings: (a) the Sample/Extract crawler finds 1 link where Find products finds 148 — the known "listing check vs probe walk count differently" gap, now blocking; (b) a run's cost is the delta of a counter shared by the whole api-server, so parallel workers' AI calls land on whichever run finishes ("No AI. Free." Sample charged $0.0376); (c) Main image on a colour-variant page is the default colour's 100 px thumbnail and still verified 3/3; (d) Description "agreed" on structured text two pages don't show. `results/campaign-2026-10/allbirds.md` |

| 2 | everlane.com (`/collections/mens-tshirts`, 68 products) | ok (no wall) | **none** | — | up to $0.40 / not clicked | — | not started | $0 | **Blocked by the product:** Find products reported "94 products found" but every card was a `/collections/…` page — `largestProductGroup` in `packages/api/src/verify/find-product-pages.ts` keeps the biggest URL-pattern group, and ~137 menu/promo collection links outnumber ~52 `/products/…` links. The table then showed "agreed" for In stock and Description on category pages. Find products took 2.5 min with three workers running. `results/campaign-2026-10/everlane.md` |

| 3 | nike.com (`/w/mens-shoes-nik1zy7ok`) | ok | 4 (Metcon 10, Air Force 1 '07, Air Max 270, Vomero 18) | 5 / 1 / 1 / 1 (Description marked; Title typed — hidden menu elements cover the heading; Rating absent on the Vomero) | up to $0.40 / **$0.00** (0 AI calls, ~20 s) | 8/8 verified | **60/60** in 12 min 5 s → **12 s/item**; 60/60 on every field except Rating 55/60 (no-review products); every SKU matches its URL | Sample $0.09, run $0.16 (both suspect: shared counter — a B&N Sample inside this run recorded the identical $0.1611) | Findings: Find products found 13 links where the walk found 60; first three "products" were colours of one shoe; "agreed" rows carried another colour's Title/Description (Accept all would have saved bad values); hidden review-panel elements catch marking clicks; a field missing on one of the first three products blocks Verify with no hint that moving it to 4th place unblocks; Sample "0 of 0" vs "3 rows extracted"; URL-added products show no title/image; Status column cut off at 1440 px with 4 products. `results/campaign-2026-10/nike.md` |

| 4 | barnesandnoble.com (bestselling books, `/b/books/_/N-1fZ29Z8q8`) | ok (no wall, "33 products found") | 3 books (the finder's first three were two NOOK tablets and a promo banner from the menu) | 6 / 2 / 0 / 0 (SKU and Brand marked on all 3 — the agreed SKUs and the suggested publisher were wrong) | up to $0.40 / **$0.00** (0 AI calls, 20.5 s) | 8/8 verified | **60/60** (3 listing pages) in 885 s → **14.8 s/item**; Title, Main image 60/60; Price, SKU, Brand, In stock, Description 59/60; Rating 54/60 | $0.00 (Sample showed $0.1611 — shared counter) | **Hit rate ≠ correctness:** Price and SKU certified on *positional* JSON-LD paths (one offer among several formats), so most rows carry another format's price/ISBN — 3 of 3 live price checks wrong (Project Hail Mary $22.00 on the page, 14.99 extracted), SKU equals the URL's EAN on 24/60, the run page says "100% confidence"; In stock certified one alternate path per format. Also: 60 items are 57 books (format links → duplicate rows); menu/banner links first in Find products; URL-added cards show the URL as title; Sample panel contradictions; default name "Barnesandnoble". `results/campaign-2026-10/bn.md` |

| 5 | otto.de (sneakers `/herren/schuhe/sneaker/`, then coffee machines) | **blocked** — product pages (`/p/…`) answer HTTP 400 with an empty body to headless Chromium; listings load | 6 tried, all blank | none ("missing on product 1" on every row) | up to $0.40 / not clicked | — | not started | $0 | Findings: a blank, refused page is shown as **`ready`** with no hint it was blocked (page health should catch an empty capture); Find products' first three cards were a category page and two of its filter variants, on which 7 of 8 rows read "agreed" with the category's SEO text — Accept all would have certified a listing page as a product; the listing bar forgets "N products found" after a reload. `results/campaign-2026-10/otto.md` |

Running total of spend (from the Usage page): **$0.45** for October, all workers (after row 5; the Nike judge run, ~$4, is in progress and is recorded in its own report, not on the Usage page)

**What the known-site batch says (rows 0–4, 2026-10-08):** every site verified with **zero model calls** — JSON-LD and APIs cover these brands — so the credit is untouched; extraction at scale works end to end on Ikea, Nike and B&N (10–15 s/item); two listing defects blocked Everlane and Allbirds (fixes A and B, see the hold note); and B&N shows the bigger risk: certified paths that *fill* every cell with a *wrong* value. The campaign therefore (1) judges extracted rows for correctness with the LLM judge — the one paid step that measures the right thing — and (2) biases the fresh list toward sites without structured data, where Verify must reach for the model.

**Campaign hold (2026-10-08, after rows 1–2):** two listing defects block the Extract half on Shopify-style stores — the finder preferring menu links (row 2) and the Sample/probe walk finding 1 link where Find products finds 148 (row 1; the handoff's "listing check and probe walk count product links differently" follow-up, now blocking). Both were fixed in isolated worktrees and are **merged into `main` on 2026-10-08** (`6b41779`+`9ab1fc8`: the finder leaves out links inside page-level navigation before grouping, and falls back to all links when fewer than 3 remain — Everlane 93 collections → 52 products, Allbirds 148, Ikea unchanged; `b418875`+`8b28758`: the grouping lives in `packages/scraper/src/crawl/product-link-group.ts`, shared by the finder and the listing walk, and after page 1 the walk plans from the page's product links when its row selector missed them and the group is confirmed by an extracted row or, on a direct listing, by a proof page — Allbirds Sample 1 → 40 of 40 with no AI). **The running api-server has the old code until it is restarted**; Everlane and Allbirds are re-run after that. Follow-ups recorded in the handoff: the 1-row selector is still cached as verified and pages 2+ reuse it; with an AI key the Sample still pays for a new selector before the free check runs.

**Measurement caveat (from row 1, finding b):** per-run `cost_usd` is unreliable while several workers run at once; the org total on the Usage page is the number to trust, and per-site cost is read from `source_verifications.cost_usd` only when no other worker was verifying at the same minute.

## What the campaign should answer, written up at the end

- How many real websites verify fully, partially, or not at all, and why (field by field).
- The actual AI cost per verified website vs the "up to" estimate, and the per-item cost of
  uncertified extraction.
- Which fields the model is needed for (expected: Brand, In stock, Rating, Description) and
  which the mechanical chain already gets right.
- Where the product itself got in the way (bugs, confusing states, missing affordances) —
  each one a finding for the handoff.
- Whether the throughput work (lean capture, parallel websites — see
  `docs/superpowers/specs/2026-10-07-run-speed-and-language-note.md`) is now urgent, with
  measured per-item times.
