# The finder reads product links — design

**Status:** written 2026-10-20 under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue
item "The product finder and the coverage check read the right links"), together with its plan
(`docs/superpowers/plans/2026-10-20-finder-links.md`). The problem is campaign 2's group 4
(`docs/testing/2026-10-11-campaign-2.md`). Every cause was measured on 13 live listing pages on
2026-10-20, free and keyless (`docs/testing/results/2026-10-20-finder-links/`: the probe scripts,
the per-link harvests and `rule.mjs`, the proposed rule run offline on them), and read in the code
on `main` @ `f78d817`.

## 1. Why

A customer gives a listing page; "Find products" offers product pages from it, the coverage check
samples twenty of them after Verify, and the listing walk cross-checks its rows against the same
grouping. On campaign 2's sites the finder offered menus, category tiles, a language link, policy
pages and one product in several colours instead of products; the coverage check then checked
twenty category pages and reported every field empty, and kept offering "Use as proof page" for
shapes already answered.

## 2. What happens today

One rule decides what a product link is, for the finder, the coverage check and the walk's
cross-check: `packages/scraper/src/crawl/product-link-group.ts`.

- `productPathTemplate` (`:25`) blanks only digits and runs of 12+ characters, so ordinary slug
  words stay literal and one product shape splits into many small groups (burrow
  `/products/range-plus-**` vs `/products/union-*-seat-sofa`; lacoste `…/PH*-*.html` vs
  `…/L*-*.html`). It also loses the difference between `.htm` and `.html`.
- `largestProductGroup` (`:40`, `:58`) takes the biggest group by raw link count, so a menu or a
  set of category tiles wins.
- Deduping uses the whole address with its query (`:69`), so `?color=`, `?variant=`, `?swatch=`,
  `?Fabric=` each count as a product.
- The anchor script (`:99`) drops links inside `nav/aside/header/footer` only; menus built from
  plain `div`s get through.
- Nothing says "no products": a page with no product grid returns its biggest group anyway.

| Site | Finder today | Products on the page |
|---|---|---|
| bombas | 112 `/collections/*` menu links | 27 `/products/*` |
| burrow | 5 `/products/range-plus-*?Fabric=` | 25 |
| thomann category | 8 menu links | 51 (`/de/*.htm`) |
| lacoste polos | 20 links = 4 products × `?color=` | 13 |
| ikea sofas | 29 `/cat/` chips | 52 priced cards |
| notonthehighstreet | 34 `/christmas/*/*` menu links | 60 `/{seller}/product/*` (ItemList: 60) |
| ruggable | 63, half "+2/+3" swatches | 47 |
| skullcandy | 39 links = 13 products | 41 |
| puma | 19 links = 10 products | 14 |
| ridge, lacoste `/polos/`, ikea blog | policy pages / a language link / 2 links | 0 |

The finder captures once without scrolling (`sources.ts:708`); "lazy grids missed" was mostly the
grouping, not loading: burrow's 25, thomann's 51 and lacoste's 13 were all on the page.

The coverage check (`run-coverage-check.ts:44-55`) samples the finder's group; it skips proof
pages by the address minus `#…` (`coverage-sampler.ts:7`), and "Use as proof page" is suppressed
only when the offered page itself is a proof page (`proof-coverage-view.ts:27-33`).

## 3. The rule

**A product link is a link on a product card, and one product is one path.**

### 3.1 Shape per path segment
`productPathTemplate` works per whole path segment: a segment containing a digit, `-` or `_`, or
of 12+ characters, becomes `*`; a file extension is kept (`*.htm` and `*.html` differ). The host
is kept; the query and fragment are dropped from the shape.

### 3.2 On a card
A link is on a card when an ancestor at most 6 levels up holds at most 3 distinct link paths,
under 800 characters of text, an image, and a price. A price is a number with a currency symbol or
code next to it, in any common locale format (`$1,234.50`, `1.234,50 €`, `RM810.00`, `MYR 620`,
`£25`, `₹`, `¥`, `kr`, `CHF`…). A group is ranked by its number of **distinct product keys
(§3.4) on cards**, not by its raw link count. An image alone is not a card (category tiles have
images).

### 3.3 Shapes that differ in one segment
Two shapes that differ in exactly one literal segment merge when each has at least 3 carded
product keys (notonthehighstreet's `/{seller}/product/*`: 31 → 60). Shapes without carded keys
never merge (bombas' `/collections/*` stays apart from `/products/*`).

### 3.4 One product is one path
A product's key is host + path with the query and fragment dropped; the first address seen is the
one kept and offered. Links inside `[role=radio]`, `[aria-checked]`, an element whose class word
contains `swatch`, or whose own text is only `+N`, are not product links.

### 3.5 JSON-LD ItemList
When the page carries an `ItemList` with 3 or more same-site item URLs, its distinct product keys
are a group of their own, ranked like any carded group, and they confirm the card group when they
overlap it.

### 3.6 Zero is an answer
A page with no carded group and no ItemList group has **no products**: the finder says "No
products found on this page." and offers nothing; the coverage check samples nothing and says so.
It never offers policy pages, a language link or a menu.

### 3.7 Loading more, bounded
The finder's capture scrolls the listing and clicks "load more" the way the walk already does
(`scrollPages`, the up-then-down step scroll), bounded: at most 3 rounds, stopping early at 60
distinct product keys or 2 rounds with no new ones. The capture's HTML is read after loading.

### 3.8 The coverage check
It samples only product links that pass §3.1–3.6, dedupes and skips proof pages by the §3.4 key,
and does not offer "Use as proof page" for a field on a page whose shape (§3.1) already has a
proof page whose cell for that field says "Not on this product".

### 3.9 The walk
The walk keeps its own row selector. The new grouping is its cross-check (as today) and its rescue
when the walk finds zero rows.

## 4. What a customer sees

"Find products" offers products: no menus, tiles, policy pages, language links or colour copies.
A page with no product grid says "No products found on this page." The coverage check's numbers
are about products, and it stops re-offering a shape already answered.

## 5. Safety properties

1. No rule names a site, a domain or a platform.
2. A listing whose products the finder found correctly before still finds them (gymshark's colour
   pages stay separate products; that is out of scope).
3. The bounded loading never runs more than 3 rounds and never navigates away (the walk's guards).
4. Nothing changes for an existing website's certified paths or its stored proof pages.
5. The coverage check never samples a proof page, under any query.

## 6. Testing

- Unit (pure): the per-segment template (each site's shapes from the harvests); the price pattern
  across locales; the product key and variant folding; the one-segment merge; ItemList parsing.
- Chromium fixtures (served pages, as the browser package's capture tests do), one per mechanism:
  a menu of `div` links beside a priced product grid; category tiles with images and no prices;
  slug-fragmented products; `?color=` copies; swatch links and "+2"; a seller-segment shape; an
  ItemList-only page; a page with no grid (policy links only); a lazy grid that grows on scroll and
  a "load more" button.
- Coverage: sampling skips a proof page reached with a query; no re-offer after "Not on this
  product" on a same-shape proof page.
- Live check, free: the finder over the 13 listing pages of the harvests, before and after, counts
  and examples in a results file; screenshots looked at for the zero cases.

## 7. Not in this spec

- Colours that are separate product pages (gymshark): no URL rule can fold them.
- Sitemap-first or product-feed discovery (queue item "Sitemap-first product discovery", handoff
  list item 4).
- Products that are not links (click handlers): §3.6 says "no products"; the walk's selector still
  works for runs.
- Geo (MYR prices, country redirects).
- Category hubs that show product carousels (thomann's hub finds 99 products; acceptable).
