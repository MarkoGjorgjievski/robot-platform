# Capture overlays — after (live check)

Run on 2026-10-19 at `8b30c4d` with `docs/testing/capture-overlays-check.mts` (free, keyless, one browser; the browser is wherever this machine is).
Before: `<site>-<n>-A.png` (probe.mts mode A, 2026-10-19). After: `<site>-<n>-after.png`.
Expected per page (spec §6): no overlay at the window's centre, the §5.3 accordions still open (the tabs step is off by default), the variant as navigation found it (§5.1), and the title and price in the box map.
Captured as a proof page is (`captureProofPage`'s options). "Variant kept": the picker's selection at load equals the one after the capture. Title / price boxes: box-map entries holding the h1's text / the JSON-LD price's digits (rough).

| Page | Verdict | Problem | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Variant kept | Title boxes (h1 hidden?) | Price boxes | Overlay warnings | Before | After |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ikea-1 | ok | – | none | 0 | 0 | 3 / 0 / Overview | yes | 1 | 2 | 0 | [before](ikea-1-A.png) | [after](ikea-1-after.png) |
| ikea-2 | ok | – | none | 0 | 0 | 3 / 0 / Overview | yes | 0 | 2 | 0 | [before](ikea-2-A.png) | [after](ikea-2-after.png) |

## Reading

