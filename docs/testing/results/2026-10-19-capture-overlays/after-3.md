# Capture overlays — after (live check)

Run on 2026-10-19 at `1b13599` with `docs/testing/capture-overlays-check.mts` (free, keyless, one browser; the browser is wherever this machine is).
Before: `<site>-<n>-A.png` (probe.mts mode A, 2026-10-19). After: `<site>-<n>-after3.png`.
Expected per page (spec §6): no overlay at the window's centre, the §5.3 accordions still open (the tabs step is off by default), the variant as navigation found it (§5.1), and the title and price in the box map.
Layers: visible fixed layers of 5 % or more of the window (absolute ones at z-index 10 or above), outermost only, not the header, nav, footer or the page itself. Scrims: translucent layers over half the window, pointer-events:none included, and html/body ::before/::after.
Captured as a proof page is (`captureProofPage`'s options). "Variant kept": the picker's selection at load equals the one after the capture. Title / price boxes: box-map entries holding the h1's text / the JSON-LD price's digits (rough).

| Page | Verdict | Problem | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Variant kept | Title boxes (h1 hidden?) | Price boxes | Overlay warnings | Layers ≥ 5 % | Scrims | Before | After |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| colourpop-1 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 1 | 3 | 0 | div fixed 20% «20% off Halloween. Applied in cart. 👻 s» | – | [before](colourpop-1-A.png) | [after](colourpop-1-after3.png) |
| colourpop-2 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 1 | 3 | 0 | div fixed 20% «20% off Halloween. Applied in cart. 👻 s» | – | [before](colourpop-2-A.png) | [after](colourpop-2-after3.png) |
| kith-1 | ok | – | none | 0 | 0 | 0 / 0 / Womens, Loyalty, DESCRIPTION | yes | 1 | 2 | 0 | – | – | [before](kith-1-A.png) | [after](kith-1-after3.png) |
| kith-2 | ok | – | none | 0 | 0 | 0 / 0 / Womens, Loyalty, DESCRIPTION | yes | 1 | 1 | 0 | – | – | [before](kith-2-A.png) | [after](kith-2-after3.png) |
| skullcandy-1 | ok | – | none | 0 | 0 | 10 / 9 / – | yes | 3 (hidden!) | 6 | 0 | – | – | [before](skullcandy-1-A.png) | [after](skullcandy-1-after3.png) |
| skullcandy-2 | ok | – | none | 0 | 0 | 5 / 4 / – | yes | 3 (hidden!) | 3 | 0 | – | – | [before](skullcandy-2-A.png) | [after](skullcandy-2-after3.png) |
| lacoste-1 | ok | – | none | 0 | 0 | 5 / 0 / – | yes | 2 | 2 | 0 | div fixed 5% «Information Banners Become a Lacoste Mem» | – | [before](lacoste-1-A.png) | [after](lacoste-1-after3.png) |
| lacoste-2 | ok | – | none | 0 | 0 | 5 / 0 / – | yes | 2 | 3 | 0 | div fixed 5% «Information Banners Become a Lacoste Mem» | – | [before](lacoste-2-A.png) | [after](lacoste-2-after3.png) |
| pumade-1 | ok | – | none | 0 | 0 | 2 / 0 / – | no: null → {"pairs":[{"name":"styles","value":"PUMA Black-PUMA Black"}],"labels":["PUMA Black-PUMA Black"]} | 18 | 17 | 0 | – | – | [before](pumade-1-A.png) | [after](pumade-1-after3.png) |
| pumade-2 | ok | – | none | 0 | 0 | 2 / 0 / – | yes | 14 | 21 | 0 | – | – | [before](pumade-2-A.png) | [after](pumade-2-after3.png) |

## Reading

Re-checked after review round 1 (60e3140) on the five sites that had or could have consent/popup/scrim behaviour. Every after3 screenshot was looked at.

- **pumade-1:** clean, location popup gone; **the size 41 hover border is gone** (mouse parked at the corner). Swatches and sizes 35.5-48 visible.
- **pumade-2:** clean product column; the small NEU HIER? HOL DIR -15% teaser over the third gallery image remains (under the 8 % floor).
- **colourpop-1/-2:** clean, no cookie banner (its Accept sits in a consent host, so the scoped name still counts); Preferences not clicked.
- **kith-1/-2:** clean, no scrim.
- **skullcandy-1/-2:** no modal; the small GET 15% OFF teaser remains, as before.
- **lacoste-1/-2:** no consent modal; the page sticky add-to-bag bar at the window bottom edge still draws across the gallery second row (spec section 7).

Variant kept: pumade-1 reads "no" as in every run (the load-time read is null); the page shows PUMA Black, what swatch=07 names. All others: kept.
