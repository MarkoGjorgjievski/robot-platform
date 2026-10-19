# Capture overlays — after (live check)

Run on 2026-10-19 at `2cd1d42` with `docs/testing/capture-overlays-check.mts` (free, keyless, one browser; the browser is wherever this machine is).
Before: `<site>-<n>-A.png` (probe.mts mode A, 2026-10-19). After: `<site>-<n>-after2.png`.
Expected per page (spec §6): no overlay at the window's centre, the §5.3 accordions still open (the tabs step is off by default), the variant as navigation found it (§5.1), and the title and price in the box map.
Layers: visible fixed layers of 5 % or more of the window (absolute ones at z-index 10 or above), outermost only, not the header, nav, footer or the page itself. Scrims: translucent layers over half the window, pointer-events:none included, and html/body ::before/::after.
Captured as a proof page is (`captureProofPage`'s options). "Variant kept": the picker's selection at load equals the one after the capture. Title / price boxes: box-map entries holding the h1's text / the JSON-LD price's digits (rough).

| Page | Verdict | Problem | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Variant kept | Title boxes (h1 hidden?) | Price boxes | Overlay warnings | Layers ≥ 5 % | Scrims | Before | After |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| colourpop-1 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 1 | 3 | 0 | div fixed 20% «20% off Halloween. Applied in cart. 👻 s» | – | [before](colourpop-1-A.png) | [after](colourpop-1-after2.png) |
| colourpop-2 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 1 | 3 | 0 | div fixed 20% «20% off Halloween. Applied in cart. 👻 s» | – | [before](colourpop-2-A.png) | [after](colourpop-2-after2.png) |
| mejuri-1 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 0 | 1 | 0 | – | – | [before](mejuri-1-A.png) | [after](mejuri-1-after2.png) |
| mejuri-2 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 0 | 1 | 0 | – | – | [before](mejuri-2-A.png) | [after](mejuri-2-after2.png) |
| kith-1 | ok | – | none | 0 | 0 | 0 / 0 / Womens, Loyalty, DESCRIPTION | yes | 1 | 2 | 0 | – | – | [before](kith-1-A.png) | [after](kith-1-after2.png) |
| kith-2 | ok | – | none | 0 | 0 | 0 / 0 / Womens, Loyalty, DESCRIPTION | yes | 1 | 1 | 0 | – | – | [before](kith-2-A.png) | [after](kith-2-after2.png) |
| skullcandy-1 | ok | – | none | 0 | 0 | 10 / 9 / – | yes | 3 (hidden!) | 6 | 0 | – | – | [before](skullcandy-1-A.png) | [after](skullcandy-1-after2.png) |
| skullcandy-2 | ok | – | none | 0 | 0 | 5 / 4 / – | yes | 3 (hidden!) | 3 | 0 | – | – | [before](skullcandy-2-A.png) | [after](skullcandy-2-after2.png) |
| lacoste-1 | ok | – | none | 0 | 0 | 5 / 0 / – | yes | 2 | 2 | 0 | div fixed 5% «Information Banners Become a Lacoste Mem» | – | [before](lacoste-1-A.png) | [after](lacoste-1-after2.png) |
| lacoste-2 | ok | – | none | 0 | 0 | 5 / 0 / – | yes | 2 | 3 | 0 | div fixed 5% «Information Banners Become a Lacoste Mem» | – | [before](lacoste-2-A.png) | [after](lacoste-2-after2.png) |
| pumade-1 | ok | – | none | 0 | 0 | 3 / 0 / – | no: null → {"pairs":[{"name":"styles","value":"PUMA Black-PUMA Black"}],"labels":["PUMA Black-PUMA Black"]} | 18 | 17 | 0 | – | – | [before](pumade-1-A.png) | [after](pumade-1-after2.png) |
| pumade-2 | ok | – | none | 0 | 0 | 2 / 0 / – | yes | 14 | 21 | 0 | – | – | [before](pumade-2-A.png) | [after](pumade-2-after2.png) |
| thomann-1 | ok | – | none | 0 | 0 | 0 / 0 / Alle | yes | 5 | – | 0 | div absolute 36% «» | – | [before](thomann-1-A.png) | [after](thomann-1-after2.png) |
| thomann-2 | ok | – | none | 0 | 0 | 0 / 0 / Alle | yes | 4 | – | 0 | div absolute 36% «» | – | [before](thomann-2-A.png) | [after](thomann-2-after2.png) |
| thomann-3 | ok | – | none | 0 | 0 | 0 / 0 / Alle | yes | 3 | – | 0 | div absolute 36% «» | – | [before](thomann-3-A.png) | [after](thomann-3-after2.png) |
| ikea-1 | ok | – | none | 0 | 0 | 3 / 0 / Overview | yes | 1 | 2 | 0 | – | – | [before](ikea-1-A.png) | [after](ikea-1-after2.png) |
| ikea-2 | ok | – | none | 0 | 0 | 3 / 0 / Overview | yes | 0 | 2 | 0 | – | – | [before](ikea-2-A.png) | [after](ikea-2-after2.png) |

## Reading

Every after2 screenshot was looked at (first tile, 1280 wide), not only the numbers.

- **pumade-1 (defect 1): fixed.** The "Standort wählen" popup is gone; colour swatches and sizes 35.5–48 are visible. It is now an overlay (smaller-popup rule); on this run it was taken off by the removal pass in the round that accepted OneTrust (hidden, text kept in the HTML), not by its own ×. Size 41 shows a hover outline where the mouse rested after the OneTrust click; nothing in the sizes was clicked. "Variant kept: no" is the load-time read returning null, as in the first run; after the capture the page shows PUMA Black, which is what ?swatch=07 names.
- **colourpop-1/-2 (defect 2): fixed.** No cookie banner; the product, swatches, add to bag and details are clear. "Preferences" was never clicked. The layers column names a fixed 20 % "20% off Halloween" box that does not show on the screenshot (nothing visible in the first tile) — a transparent wrapper, listed honestly by the wider probe.
- **kith-1/-2 (defect 3): fixed.** No grey scrim: Escape closes the welcome mat the page's way and the page removes body.modal-background with it. No scrim column entries.
- **mejuri-1/-2:** clean, as before. The open accordion is "Shipping, Returns & Warranty", not "Materials & Specifications" — the same as the first run (unchanged by this branch, still open from §5.3). Chat bubble at the right edge, small, not covering the product.
- **skullcandy-1/-2:** no modal. A small "GET 15% OFF ×" teaser (about 180×50 px, under 1 % of the window) sits at the bottom of the gallery's second image on -1 and beside the thumbnails on -2; under the 8 % floor, left alone. The probe's first h1 is display:none, as in the first run (not investigated here; the visible title CRUSHER EVO / GROM WIRELESS is on the screenshot).
- **lacoste-1/-2:** no consent modal. The page's own sticky "add to bag" bar (product name, price, bag button) is drawn across y≈810–895 of the full-page tile — a fixed bar at the window's bottom edge, which the spec leaves alone (§7). It covers the gallery's second row, not the buy box.
- **pumade-2:** clean product column. A small "NEU HIER? HOL DIR -15% ×" teaser (about 260×40 px) sits over the third gallery image; under the 8 % floor, left alone.
- **thomann-1/-2/-3:** clean. The layers column's "div absolute 36 % «»" is an empty, unpainted box (nothing visible). A chat button at the right on -2/-3.
- **ikea-1/-2:** clean, scrolled to the top, Overview tab and Materials accordion open. (ikea-2 answered this time.)

Left over, not fixed here: small promo teasers under 8 % of the window (skullcandy, puma), and sticky add-to-bag bars at the window's edge (lacoste).
