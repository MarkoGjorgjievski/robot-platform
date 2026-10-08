# otto.de — credit campaign 2026-10

**Status: BLOCKED.** otto.de's product pages (`/p/…`) come back blank: HTTP 400 with an empty body to headless Chromium. Listing pages load normally. Nothing was spent: no Verify click, no Sample and no Extract.

- Website: `Otto` (slug `otto`, source `19f47ba9-d6c3-4772-a241-833965a91f3d`), project `credit-campaign-2026-10`. Added through the Add website dialog with `https://www.otto.de`.
- Listings tried:
  1. https://www.otto.de/herren/schuhe/sneaker/ (the suggested one)
  2. https://www.otto.de/kueche/kaffeemaschinen/ (the one alternative)

## Screen

**Sneaker listing**
- "Find products" reported **337 products found** in about 30 s.
- The three cards it put on the board were not products. They were category and filter pages: "Sneaker" `/schuhe/sneaker/`, "Keilabsatz Sneaker" `/schuhe/sneaker/?…` and "Plateau Sneaker" `/schuhe/sneaker/?…` (`otto-screen.png`). These pages are not even the men's listing that was pasted.
- All three read `ready`, and every row except SKU read **"agreed · Accept"** (7 rows). The values came from the category pages, not from products:
  - Title, Price, Image, Brand and Rating belonged to whatever product the category page features ("PUMA Cassia 2.0 Sneakers Damen Sneaker", 69.95 …).
  - Description was the category's SEO meta text ("Bis zu 20% reduziert ❗ Sneaker online kaufen bei OTTO …").
- I accepted nothing.

**Real products from the sneaker listing**
- A plain browser sees 115 `/p/` product links on that listing (HTTP 200, no wall).
- I swapped three of them in through "+ Add product" and dropped the category cards:
  - `…/p/puma-tazon-6-fm-…-C1422748642/`
  - `…/p/vans-old-skool-…-C1965915680/`
  - `…/p/new-balance-ml574-core-…-C1439179933/`
- All three captures read **`ready`**, but each one is a blank white 1280×800 image with **0 element boxes**.
- Every cell is empty, and every row says "missing on product 1".

**Coffee-machine listing (the alternative)**
- "Find products" reported 136 products found.
- I swapped in three of its product pages:
  - `…/p/philips-kaffeevollautomat-ep2225-10-…-C858943813/`
  - `…/p/siemens-kaffeevollautomat-eq500-classic-tp513d09-…-1826681508/`
  - `…/p/nescafe-dolce-gusto-kapselmaschine-kp1238-…-C1785304122/`
- I got the same result: `ready`, blank, 0 boxes (`otto-blocked-table.png`, `otto-capture-1.png`).

**Why the product pages are blank**
- I loaded the product pages directly in plain headless Playwright (de-DE locale), without the app.
- `/p/…` returns **HTTP 400 with an empty body** (sneaker and coffee products alike).
- The listing pages return 200 and full content.
- This is bot protection that applies to product pages only. The app's capture does not get past it.

Fields: none filled. Agreed 0 / marked 0 / typed 0 / absent 0. Verify: the label read "Verify 8 fields · up to $0.40", but there was nothing to verify, so I did not click it. Extract: not started.

## Findings (product, not fixed)

1. **A blank, blocked capture reads `ready`.** The page answered HTTP 400 with an empty body, and the capture has 0 boxes and a white screenshot. The board still shows `ready` with no hint that the page was refused. A customer sees only empty rows saying "missing on product 1". The app should say the page was blocked or empty.
2. **The product finder picks category and filter pages as products.** This happened on otto as it did on B&N and Everlane. The first three cards were the `/schuhe/sneaker/` category plus two of its filter variants. They are not even under the pasted `/herren/` path. The 337/136 counts are probably inflated in the same way.
3. **"Agreed" over category pages looks convincing and is wrong.** Seven rows offered "agreed · Accept" with values taken from a category page, including its SEO meta description as "Description". "Accept all agreed (7)" would have certified a listing page as a product.
4. Minor: after a reload, the listing bar no longer shows the "N products found" line. Products added by URL show only their URL in the column head.

## Screenshots

- `otto-screen.png`: Find products on the sneaker listing. The three category pages as "products", and 7 rows "agreed".
- `otto-blocked-table.png`: the board with three real coffee-machine product pages, all `ready`, all cells empty.
- `otto-capture-1.png`: the screenshot panel for a product page, blank white.
