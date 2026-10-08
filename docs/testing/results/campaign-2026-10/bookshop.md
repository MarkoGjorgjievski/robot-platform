# bookshop.org — credit campaign 2026-10-08

**Status: BLOCKED (Cloudflare).** It stopped at the screen step. Nothing was spent: there was no Verify click and no Extract.

**Website**
- Name `Bookshop` (the prefilled default), slug `bookshop`, source `0ba189f3-3558-43bb-8084-9a60dae6ad5a`.
- Added through the Add website dialog with the address `https://bookshop.org`.

## Screen (free)

| Listing pasted | Find products said | What went on the board | Captures |
|---|---|---|---|
| https://bookshop.org/lists/bestsellers-this-week (suggested) | "16 products found" after 70 s | `/info/privacy-notice` ("Privacy Policy"), `/info/banned-books` (a Banned Books Week promo), `/info/new-from-prh?…` (a Penguin Random House promo) | all 3: "Bot detection (cloudflare) — site blocked automated access" |
| https://bookshop.org/categories/fiction (alternative) | "16 products found" | the same three `/info/…` pages | all 3: the same Cloudflare message |

- **No book was offered as a product.** Every field row reads "screenshot failed on product 1".
- **The site blocks a plain browser.** Loaded directly in headless Chromium (Playwright, free), both listings answer **HTTP 403** with "Just a moment…", Cloudflare's "Performing security verification / Verify you are human" page (`bookshop-cloudflare.png`).
- Because both listings are walled, I did not paste book URLs by hand: every product page is on the same Cloudflare host.
- The Verify button read "Verify 8 fields · up to $0.40" and was disabled. It was not clicked.

## Per-field table

Not reached. No capture succeeded, so no field could be agreed, marked or typed.

## Findings in the product

1. **"16 products found" from a walled site.** Find products reports 16 links for each of the two listings, but neither can be loaded by a browser. The links it returns are site-chrome `/info/` pages (privacy notice, promos), not books.
   - The count is identical for two different listings, which suggests it comes from the shared chrome or the block page, not from either product grid.
   - The customer is told products were found, and only afterwards sees three captures fail. The scan.co.uk run showed the opposite failure: the same wall read as "No product links found".
2. **The capture failure is reported clearly.** "Bot detection (cloudflare) — site blocked automated access" on each card is the right message. The listing step should say the same thing up front instead of "16 products found".
3. **The field rows don't name the cause.** They all read "screenshot failed on product 1", which says nothing about the wall, and products 2 and 3 failed the same way.
4. **A wrong thumbnail on product 1.** The "Privacy Policy" card shows a large blue check/cross image, apparently the page's social-share image, even though its capture was blocked.
5. **Unclear whether the board was replaced.** Running "Find products" again on the alternative listing left the same three cards. From the screen it is impossible to tell whether the board was replaced with identical picks or left untouched.

## Screenshots

- `bookshop-screen.png`: Find products on the suggested bestsellers listing. "16 products found", three `/info/` pages, all three Cloudflare-blocked.
- `bookshop-screen-alt.png`: the same after Find products on `/categories/fiction`.
- `bookshop-cloudflare.png`: the bestsellers listing loaded directly in headless Chromium, the Cloudflare 403 verification page.
