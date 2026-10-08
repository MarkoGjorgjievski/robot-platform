# Listing-page anchors

Every `<a href>` on a real listing page, as `sources.checkListingPage` sees it: `PlaywrightBrowser.capture`
(networkidle, falling back to domcontentloaded) then `LISTING_ANCHORS_SCRIPT` through `setContentEvaluate`.
Per anchor: `href` as written, `text` (cut to 60 chars), `chrome` (inside page navigation — `nav`,
`[role=navigation]`, `aside`, a page-level `header`/`footer` — the same rule `LISTING_ANCHORS_SCRIPT` applies),
`container` (which one) and `y` (top of the anchor in the `setContent` render, px; informational only).

- `everlane-mens-tshirts.json` — https://www.everlane.com/collections/mens-tshirts, captured 2026-10-08 (no AI).
  836 anchors; the page shows 68 products, 52 unique `/products/*` links in the grid, ~94 unique `/collections/*`
  links from the mega-menu and footer. Evidence: `docs/testing/results/campaign-2026-10/everlane.md`.
