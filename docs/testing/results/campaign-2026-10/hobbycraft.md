# hobbycraft.co.uk — credit campaign 2026-10-08

**Status: BLOCKED (site).** Cloudflare's bot challenge stops every page, so Find products gets no product links. Nothing was spent: there was no Verify and no Extract.

**Website**
- Name `Hobbycraft` (the name prefill), slug `hobbycraft`. It was added through the Add website dialog with the address `https://www.hobbycraft.co.uk`.

## Screen (free)

| Listing | Find products result | Time |
|---|---|---|
| https://www.hobbycraft.co.uk/art-supplies/paint/acrylic-paint (suggested) | "No product links found on this page. Paste product pages below." | about 65 s |
| https://www.hobbycraft.co.uk/knitting-and-crochet/yarn (the one alternative) | the same message | 70 s |

- The suggested listing got three clicks of Find products. The first two script runs mis-detected the result message, so they clicked again. The yarn listing got one click. All four clicks are free.
- A plain headless Chromium (Playwright, 1440×900) gets **HTTP 403** from both URLs. The page is titled "Just a moment..." and reads "Performing security verification … Verify you are human", from Cloudflare (Ray ID a474b883b91c6b5d). See `hobbycraft-cloudflare.png`.
- So the listing is a Cloudflare managed challenge. The app's capture and popup dismisser cannot get past it. Product pages are on the same host, so pasting them would hit the same wall. Per the protocol I stopped at step 1: no proof pages, no expected values, no Verify, no Extract.

## Findings in the product

1. **The bot wall is reported as "No product links found on this page."** The app does not tell the customer that the site served a Cloudflare challenge (403, "Just a moment..."), so the customer is invited to paste product pages, which will fail the same way. A distinct "this site blocked our browser (Cloudflare challenge)" message would save that detour.
2. **Find products takes 60–70 s to come back empty on a challenge page.** The challenge is visible on the very first response (a 403 status and the "Just a moment..." title), so it could fail fast.
3. **After the failure, the table shows three blank product cards with a `https://shop.example…` placeholder** and the line "Not saved: Every product needs a page". The website is left in that state, with nothing saved (`hobbycraft-screen.png`).

## Screenshots

- `hobbycraft-screen.png`: the Verification tab after Find products on the suggested acrylic-paint listing, reading "No product links found".
- `hobbycraft-screen-yarn.png`: the same result on the yarn listing.
- `hobbycraft-cloudflare.png`: what a plain browser gets from hobbycraft.co.uk, Cloudflare's "Performing security verification" page (HTTP 403).

## Spend

- $0. Verify was not clicked and Extract was not started.
