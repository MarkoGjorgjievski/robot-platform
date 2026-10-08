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

Running total of spend (from the Usage page): _$0.04_ (after row 2)

**Campaign hold (2026-10-08, after rows 1–2):** two listing defects block the Extract half on Shopify-style stores — the finder preferring menu links (row 2) and the Sample/probe walk finding 1 link where Find products finds 148 (row 1; the handoff's "listing check and probe walk count product links differently" follow-up, now blocking). Both are being fixed in isolated worktrees (`fix/listing-finder-products`, `fix/probe-walk-links`) while the Nike and Barnes & Noble workers finish; new sites start after the fixes land and the api-server is restarted.

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
