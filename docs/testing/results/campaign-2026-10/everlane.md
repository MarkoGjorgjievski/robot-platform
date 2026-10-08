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
