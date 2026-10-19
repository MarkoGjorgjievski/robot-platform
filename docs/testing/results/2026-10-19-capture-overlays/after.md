# Capture overlays — after (live check)

Run on 2026-10-19 at `8b30c4d` with `docs/testing/capture-overlays-check.mts` (free, keyless, one browser; the browser is wherever this machine is).
Before: `<site>-<n>-A.png` (probe.mts mode A, 2026-10-19). After: `<site>-<n>-after.png`.
Expected per page (spec §6): no overlay at the window's centre, the §5.3 accordions still open (the tabs step is off by default), the variant as navigation found it (§5.1), and the title and price in the box map.
Captured as a proof page is (`captureProofPage`'s options). "Variant kept": the picker's selection at load equals the one after the capture. Title / price boxes: box-map entries holding the h1's text / the JSON-LD price's digits (rough).

| Page | Verdict | Problem | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Variant kept | Title boxes (h1 hidden?) | Price boxes | Overlay warnings | Before | After |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| colourpop-1 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 1 | 3 | 0 | [before](colourpop-1-A.png) | [after](colourpop-1-after.png) |
| colourpop-2 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 1 | 3 | 0 | [before](colourpop-2-A.png) | [after](colourpop-2-after.png) |
| mejuri-1 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 0 | 1 | 0 | [before](mejuri-1-A.png) | [after](mejuri-1-after.png) |
| mejuri-2 | ok | – | none | 0 | 0 | 1 / 0 / – | yes | 0 | 1 | 0 | [before](mejuri-2-A.png) | [after](mejuri-2-after.png) |
| kith-1 | ok | – | none | 0 | 0 | 0 / 0 / Womens, Loyalty, DESCRIPTION | yes | 1 | 2 | 0 | [before](kith-1-A.png) | [after](kith-1-after.png) |
| kith-2 | ok | – | none | 0 | 0 | 0 / 0 / Womens, Loyalty, DESCRIPTION | yes | 1 | 1 | 0 | [before](kith-2-A.png) | [after](kith-2-after.png) |
| skullcandy-1 | ok | – | none | 0 | 0 | 10 / 9 / – | yes | 3 (hidden!) | 6 | 0 | [before](skullcandy-1-A.png) | [after](skullcandy-1-after.png) |
| skullcandy-2 | ok | – | none | 0 | 0 | 5 / 4 / – | yes | 3 (hidden!) | 3 | 0 | [before](skullcandy-2-A.png) | [after](skullcandy-2-after.png) |
| lacoste-1 | ok | – | none | 0 | 0 | 5 / 0 / – | no: {"pairs":[{"name":"color","value":"Image 1 of 6"}],"labels":["Image 1 of 6"]} → null | 2 | 2 | 0 | [before](lacoste-1-A.png) | [after](lacoste-1-after.png) |
| lacoste-2 | ok | – | none | 0 | 0 | 5 / 0 / – | yes | 2 | 3 | 0 | [before](lacoste-2-A.png) | [after](lacoste-2-after.png) |
| pumade-1 | ok | – | none | 0 | 0 | 2 / 0 / – | no: null → {"pairs":[{"name":"styles","value":"PUMA Black-PUMA Black"}],"labels":["PUMA Black-PUMA Black"]} | 18 | 17 | 0 | [before](pumade-1-A.png) | [after](pumade-1-after.png) |
| pumade-2 | ok | – | none | 0 | 0 | 2 / 0 / – | yes | 14 | 21 | 0 | [before](pumade-2-A.png) | [after](pumade-2-after.png) |
| thomann-1 | ok | – | none | 0 | 0 | 0 / 0 / Alle | yes | 5 | – | 0 | [before](thomann-1-A.png) | [after](thomann-1-after.png) |
| thomann-2 | ok | – | none | 0 | 0 | 0 / 0 / Alle | yes | 4 | – | 0 | [before](thomann-2-A.png) | [after](thomann-2-after.png) |
| thomann-3 | ok | – | none | 0 | 0 | 0 / 0 / Alle | yes | 3 | – | 0 | [before](thomann-3-A.png) | [after](thomann-3-after.png) |
| ikea-1 | ok | – | none | 0 | 0 | 3 / 0 / Overview | yes | 1 | 2 | 0 | [before](ikea-1-A.png) | [after](ikea-1-after.png) |
| ikea-2 | failed (ikea.com did not answer in time.) | – | ? | -1 | -1 | ? | no: null → null | 0 | – | 0 | [before](ikea-2-A.png) | [after](ikea-2-after.png) |

## Reading

