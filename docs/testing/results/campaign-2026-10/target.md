# target.com — credit campaign 2026-10-08

**Status: STOPPED (servers down).** The owner stopped the dev servers (app :3000, api :4000) after the screen step. Nothing was spent: no Verify, no Sample, no Extract.

The screen had already gone badly. Target puts a PerimeterX-style **"Quick verification — Press & hold to confirm you're a human"** wall in front of headless Chromium, and the app's Find products returned 2 footer links instead of products. If the servers come back, this site will most likely be recorded as `blocked`.

**Website**
- Name `Target` (the default the dialog fills in from the host), slug `target`.
- Added through the Add website dialog with `https://www.target.com`.
- The verification set is not saved ("Not saved until every product has a page"), because only 2 cards exist.

## Finding a listing (free, plain headless Playwright)

- **Home page:** `https://www.target.com/` answered 200 with 35 `/c/…/-/N-…` links in the navigation.
- **Path I followed:** Electronics `/c/electronics/-/N-5xtg6` (8 `/p/` links), then Headphones `/c/headphones-electronics-tech/-/N-5xteg` (a landing page: 10 `/p/` links in carousels, and sub-categories), then **Over-Ear Headphones `https://www.target.com/c/over-ear-headphones-electronics-tech/-/N-ddjii`**. That is the listing I chose and pasted.
- **It never showed a full grid.** The page answers 200, and the title and h1 render ("Over-Ear Headphones : Target"). Only 4 `/p/` links appear before the overlay takes over: once scrolling starts, the page is replaced by the "Quick verification / Press & hold" overlay (`target-peek-pressandhold.png`).
- **Waiting did not help.** This was my 5th Target load in about 4 minutes. I waited 8 minutes once and loaded it a single time again in a fresh context. The same wall came back (`target-peek-pressandhold-2.png`, 13:24Z). So the wall does not look purely rate-based; it seems to fingerprint headless Chromium.
- I could not confirm "many `/p/…` links" on any Target category with a plain headless page. So I did not choose a TCIN/DPCI source for SKU and did not check the Brand line.

## Screen in the app (free)

I waited about 2 minutes, then pasted the over-ear listing and clicked Find products at 13:27Z.
- **Find products** took **67 s** and reported **"2 products found"**. Neither was a product (`target-screen.png`):
  1. "Registry & Wish List" `/gift-registry`: the capture failed with **`page.goto: Page crashed`** (navigating to `https://www.target.com/gift-registry`), with a "Try again" button. I did not click it.
  2. "Your Privacy Choices" `/guest-privacy`: the capture reads **`ready`**. Title is suggested as "DSD Reporting Satisfaction Survey", and every other field is empty.
- Every field row reads "screenshot failed on product 1". Verify shows "Verify 8 fields · up to $0.40", disabled with "Add at least three products".
- By the brief (fewer than 3 products), the screen result is `blocked`. I would have stopped here even without the server shutdown. I did not add products by URL: the same wall almost certainly sits in front of `/p/…` pages.

## Findings in the product (not fixed)

1. **A bot wall is reported as "2 products found".** These are the footer/legal links on the challenge or shell page. The wall is not named anywhere, which matches Scan, Hobbycraft and Bookshop. "Press & hold" (PerimeterX/HUMAN) is a new wall type for this campaign.
2. **A non-product footer page is shown as `ready`, with a suggested Title** ("Your Privacy Choices" → "DSD Reporting Satisfaction Survey"). This is the same class as Otto's category pages reading `ready`/"agreed".
3. **A Chromium "Page crashed" on `/gift-registry` is shown raw** on the card ("page.goto: Page crashed Call log: …"). This is the only capture error so far that is not a bot-wall message.

## Spend
$0.00. Verify was not clicked, no Sample was run, and no Extract was started.

## Screenshots
- `target-peek-pressandhold.png`: the "Quick verification / Press & hold" wall in plain headless Playwright on the over-ear listing (first time).
- `target-peek-pressandhold-2.png`: the same wall after the 8-minute wait.
- `target-screen.png`: the Verification tab after Find products: "2 products found", gift-registry "Page crashed", guest-privacy `ready`.
