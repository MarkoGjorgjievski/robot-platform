# crutchfield.com — credit campaign 2026-10

**Status: BLOCKED.** Cloudflare shows headless Chromium a managed challenge on every crutchfield.com page I tried, including the home page. The page answers HTTP 403, titled "Just a moment...", and reads "Performing security verification … Verify you are human". Neither listing gave the app a single product link. Nothing was spent: no Verify click, no Sample and no Extract.

- Website: `Crutchfield` (slug `crutchfield`, source `a723cca5-cded-486e-8c6c-d103c639f465`), project `credit-campaign-2026-10`. I added it through the Add website dialog with `https://www.crutchfield.com`; the name prefilled as "Crutchfield".
- Listings tried:
  1. https://www.crutchfield.com/g_18200/Bookshelf-Speakers.html (the suggested one)
  2. https://www.crutchfield.com/g_11800/Headphones.html (the one alternative)
- Proof pages: none. Product pages are on the same host behind the same challenge, so there was nothing to take.

## Screen

- **App.** "Find products" took **about 65 s** on the bookshelf listing and **about 70 s** on the headphones listing. On scan.co.uk's hard 403 block it took about 5 s, so the extra time is presumably the capture waiting for the challenge to clear. It never cleared. Both runs ended with "No product links found on this page. Paste product pages below." and "Not saved: Every product needs a page", with three empty placeholder product columns (`crutchfield-screen.png`, the headphones attempt).
- **Direct check.** I loaded both listings and `https://www.crutchfield.com/` in plain headless Playwright (1440×900), without the app. All three returned **HTTP 403** with the Cloudflare "Performing security verification / Verify you are human" interstitial (`crutchfield-cloudflare.png`), and none had any `/p_…` product links.
- **Paste-product route.** I did not try it. The challenge covers the whole host, and the brief says a bot wall the app cannot pass means `blocked`.

## Per-field table

Not reached. No values were checked or marked, and nothing was extracted. The Verify button read "Verify 8 fields · up to $0.40" and was disabled ("Every product needs a page"), so I did not click it.

## Findings (product)

1. **A Cloudflare challenge reads as "No product links found".** This is the same as scan.co.uk's finding 1, but here it is a JS/turnstile *challenge*, not a hard block. The customer waits about a minute and then gets the same message as a real listing with no products. It says nothing about a bot check, and the app suggests pasting product pages, which are behind the same challenge.
2. **A failed Find leaves placeholder product columns on the board** (`https://shop.example…` inputs, "Use this page", "Not saved: Every product needs a page"). This was also seen on scan.co.uk.

## Screenshots

- `crutchfield-screen.png`: the Verification tab after "Find products" on the headphones listing (0 links, placeholder columns).
- `crutchfield-cloudflare.png`: the bookshelf-speakers listing loaded directly in headless Chromium (Cloudflare challenge, HTTP 403).
