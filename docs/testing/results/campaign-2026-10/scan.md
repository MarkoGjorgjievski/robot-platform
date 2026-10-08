# scan.co.uk — credit campaign 2026-10

**Status: BLOCKED.** Cloudflare refuses scan.co.uk to headless Chromium. The block page is HTTP 403 "Attention Required! | Cloudflare — Sorry, you have been blocked". Neither listing gave the app a single product link. Nothing was spent: no Verify click, no Sample and no Extract.

- Website: `Scan` (slug `scan`, source `b99961e7-547f-4016-b6c3-e2712963cb5e`), project `credit-campaign-2026-10`. I added it through the Add website dialog with `https://www.scan.co.uk`; the name prefilled as "Scan".
- Listings tried:
  1. https://www.scan.co.uk/shop/computer-hardware/ssd-drives/all (the suggested one)
  2. https://www.scan.co.uk/shop/computer-hardware/memory-ram/all (the one alternative)
- Proof pages: none. No product URL was ever reachable, so there was nothing to take.

## Screen

- **App.** "Find products" answered in about 5 s on both listings. `sources.checkListingPage` returned `{"productLinks":0,"pagerSeen":false,"sample":[],"products":[]}`. The page said "No product links found on this page. Paste product pages below." and "Not saved: Every product needs a page" (`scan-screen.png`, the memory-ram attempt).
- **Direct check.** I loaded both listings in plain headless Playwright (1440×900), without the app. Both return **HTTP 403**, title "Attention Required! | Cloudflare", body "Sorry, you have been blocked. You are unable to access scan.co.uk" (`scan-cloudflare.png`). The page has no product links.
- **Paste-product route.** I did not try pasting product pages. Cloudflare blocks the whole host, and the brief says a bot wall the app cannot pass means `blocked`.

The SSD listing was run through "Find products" three times. The first two runs were spent working out why my script's wait condition never matched. Every run was free and got the same answer, 0 links.

## Per-field table

None of it was reached. No values were checked or marked, no Verify label was acted on (the button read "Verify 8 fields · up to $0.40", disabled), and nothing was extracted.

## Findings (product)

1. **A Cloudflare 403 reads as "No product links found".** The listing check gets a block page and reports 0 links, the same message as a real listing with no products. It says nothing about HTTP 403 or a bot wall. The next thing the app suggests is "Paste product pages below", which cannot work on a host that blocks everything. A customer would be better served by "This site refused our browser (HTTP 403, Cloudflare)".
2. **A failed Find still changes the board.** After the 0-link result, the board showed three empty product columns with `https://shop.example…` placeholder inputs and "Use this page" buttons, plus "Not saved: Every product needs a page". After a reload the board was back to "Find products from a listing page…", so nothing was persisted. Before the reload, though, it looks like a half-started setup.

## Screenshots

- `scan-screen.png`: the Verification tab after "Find products" on the memory-ram listing (0 links, placeholder columns).
- `scan-cloudflare.png`: the same listing loaded directly in headless Chromium (Cloudflare 403 block page).
