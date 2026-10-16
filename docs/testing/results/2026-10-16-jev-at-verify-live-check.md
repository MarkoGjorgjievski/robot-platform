# Jev at Verify, in shadow — live check, 2026-10-16

Run on `main` after the merge (`da2c0ce` plus the live-check script), from the controller session:
`JEV_SHADOW=1 npx tsx src/jev-live-check.ts <slugs>` in `packages/api`, shadow switched on **in that
process only** (the dev servers and `.env` keep it off). The script re-captures every proof page of
each website through the normal proof-page capture path, waits for the reading the capture starts,
and prints Jev's pick beside the stored expected value. Campaign project `campaign-2-2026-10-11`.

**Spend:** 14 readings, 108,977 input tokens, **$0.0046** (≈ $0.00033 per page). Every reading
`done`; no request failed; the stored 1280 × 1536 tiles were accepted (the size the review asked to
confirm live).

## What Jev read

| Website | Pages | Fields asked | Jev agreed with the stored value | Notes |
|---|---|---|---|---|
| Gymshark | 4 | SKU, Brand, Title, Rating | 15 of 16 (p 0.82–1.00) | the one "miss": Rating 3.6 vs stored 3.5 — the page now shows 3.6 |
| Kith | 3 | SKU, Brand, Title | Brand and Title 6 of 6 (p 0.90–1.00); SKU "none" 3 of 3 | Kith's SKU (2000369947…) is not printed on the page, so "none" is literally right |
| Colourpop | 4 | SKU, Title | Title 1 of 4 exact; SKU low confidence (0.35–0.54) | see below: two Titles chose the `og:title` long form, one was right that the page changed |
| Ruggable | 3 | SKU, Price, Title, Rating, Variant | Price, SKU, Variant all "none" (p 0.80–0.97) | **the screenshot is nearly blank**: see below |

### Ruggable — the capture, not Jev
The stored tile sent to Jev shows only the top bar and the logo's first letters at the right edge:
Ruggable lays the page out wider than our 1280 px capture, so the product column falls outside the
image (the campaign's known "wide layout" capture defect). Jev answered "none" for Price and the
selected variant at 0.82–0.97, which is the honest answer for that image. The experiment on
2026-10-15 got Ruggable right because it captured with its own viewport and hid the cart drawer.
**Fixing captures on wide layouts is a precondition for Jev on such sites.**

### Colourpop — Jev saw the page change
- *Bare Necessities:* Jev read the Title as **"Mega Palette"** at 0.99. The screenshot shows exactly
  that: Colourpop now sells it as "Mega Palette — Warm Eyeshadow Palette", with "bare necessities"
  as a shade in a dropdown. The stored expected Title is now the variant name. This is the kind of
  disagreement shadow mode exists to surface.
- *Fade Into Hue, Aurora Struck:* Jev chose the `og:title` form ("Fade Into Hue | 30-Pan Rainbow
  Eyeshadow Palette | ColourPop", 0.73–0.74) over the plain name; the plain heading was among the
  candidates only on some pages. A row note would appear here ("Jev reads Fade Into Hue | 30-Pan… as
  the Title"), which is noise; the candidate builder should drop a candidate that contains another
  candidate plus a "| Site" suffix, or prefer the visible heading.
- *SKU:* Colourpop's SKUs (EyePalette-…) are not printed on the page; Jev's picks are low confidence
  (0.35–0.54), under the 0.6 note threshold, so no note would show.

### Variant question
Asked on Gymshark (4) and Ruggable (3). Gymshark's variant labels came out as long product names
with marketing copy appended (the JSON-LD entries' `name` carries it), and no address names a
variant there; Jev mostly answered "none". The variant labels need trimming to option values
before this question is useful on such sites.

## What this proved / did not
- **Proved:** the pipeline end to end on real pages — capture, reading, storage, cost — with
  shadow switched on only where intended; the stored tiles are accepted; Jev's field reads on
  ordinary product pages (Gymshark, Kith) agree with the customer's verified values almost always,
  and where they disagree the page has usually changed.
- **Not proved:** the Verification tab's row notes on these live websites (not opened; the route
  smoke covers the rendering with a seeded reading); agreement recording (no Verify was clicked).
- **Follow-ups found:** (1) wide-layout captures blank the screenshot (blocks Ruggable);
  (2) `og:title` long forms as Title candidates cause noise notes; (3) variant labels need trimming;
  (4) the live-check script first wrote its screenshots under `packages/api/public/captures`
  because `CAPTURES_DIR` was unset — moved into the api-server's folder, the script now sets it.

**State left behind:** 14 new proof-page captures (and their readings) on the four websites; each
is now that page's newest capture. Nothing else changed.
