# The "wide layout" was our stealth plugin — before/after, 2026-10-16

Ruggable, Ridge and Mejuri rendered 4,000 px wide at a 1,280 px viewport in our browser, so the product column fell outside every screenshot. A plain Playwright browser rendered them normally. Bisecting the stealth plugin's evasions on Ridge (deterministic) showed that removing either `iframe.contentWindow` or `user-agent-override` restores a 1,280 px layout: the pair makes the sites' layout scripts write `width: 4000px; text-size-adjust: none; zoom: 1` onto `<body>`. The fix leaves `iframe.contentWindow` off (`STEALTH_EVASIONS_OFF` in `packages/browser/src/playwright-browser.ts`); the UA override stays, since it hides "HeadlessChrome". Side finding: the UA override replaces the context's `userAgent`, so sites see the bundled Chromium's version, not `DEFAULT_USER_AGENT`.

## Before/after, our real browser class, a fresh browser per site, two proof pages each

| run | site | verdict | page width | heading x | page |
|---|---|---|---|---|---|
| before | thomann | ok | 1280 | 40 | thomann.de/de/taylor_814ce_n.htm?type=category |
| before | thomann | ok | 1280 | 40 | thomann.de/de/taylor_112ce_n.htm?type=category |
| before | kith | ok | 1280 | 692 | kith.com/collections/kith-women-sweatshirts/products/khwa030 |
| before | kith | ok | 1280 | 692 | kith.com/collections/kith-women-sweatshirts/products/khwa030 |
| before | bombas | ok | 1280 | 98 | bombas.com/products/mens-classic-marls-ankle?variant=slate-s |
| before | bombas | ok | 1280 | 83 | bombas.com/products/mens-merino-wool-socks?variant=rouge |
| before | skims | ok | 1280 | 664 | skims.com/en-my/products/fits-everybody-balconette-bra-onyx |
| before | skims | ok | 1280 | 664 | skims.com/en-my/products/skims-ultimate-balconette-push-up-b |
| before | ruggable | ok | 4000 | 2068 | ruggable.com/products/sierra-ivory-opal-tufted-rug?size=6x9& |
| before | ruggable | ok | 1280 | 708 | ruggable.com/products/morris-and-co-pimpernel-jade-tufted-ru |
| before | ridge | ok | 4000 | 2603 | ridge.com/products/aluminum-black |
| before | ridge | ok | 4000 | 2603 | ridge.com/products/carbon-fiber |
| before | mejuri | ok | 4000 | 3474 | mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+G |
| before | mejuri | ok | 4000 | 3474 | mejuri.com/my/en/products/duo-beaded-stacker-ring?Material=1 |
| before | gymshark | ok | 1280 | 755 | gymshark.com/products/gymshark-everyday-seamless-leggings-le |
| before | gymshark | ok | 1280 | 755 | gymshark.com/products/gymshark-everyday-seamless-flared-legg |
| after | thomann | ok | 1280 | 40 | thomann.de/de/taylor_814ce_n.htm?type=category |
| after | thomann | ok | 1280 | 40 | thomann.de/de/taylor_112ce_n.htm?type=category |
| after | kith | ok | 1280 | 692 | kith.com/collections/kith-women-sweatshirts/products/khwa030 |
| after | kith | ok | 1280 | 692 | kith.com/collections/kith-women-sweatshirts/products/khwa030 |
| after | bombas | ok | 1280 | 98 | bombas.com/products/mens-classic-marls-ankle?variant=slate-s |
| after | bombas | ok | 1280 | 83 | bombas.com/products/mens-merino-wool-socks?variant=rouge |
| after | skims | ok | 1280 | 664 | skims.com/en-my/products/fits-everybody-balconette-bra-onyx |
| after | skims | ok | 1280 | 664 | skims.com/en-my/products/skims-ultimate-balconette-push-up-b |
| after | ruggable | ok | 1280 | 708 | ruggable.com/products/sierra-ivory-opal-tufted-rug?size=6x9& |
| after | ruggable | ok | 1280 | 708 | ruggable.com/products/morris-and-co-pimpernel-jade-tufted-ru |
| after | ridge | ok | 1280 | 855 | ridge.com/products/aluminum-black |
| after | ridge | ok | 1280 | 855 | ridge.com/products/carbon-fiber |
| after | mejuri | ok | 1280 | 756 | mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+G |
| after | mejuri | ok | 1280 | 756 | mejuri.com/my/en/products/duo-beaded-stacker-ring?Material=1 |
| after | gymshark | ok | 1280 | 755 | gymshark.com/products/gymshark-everyday-seamless-leggings-le |
| after | gymshark | ok | 1280 | 755 | gymshark.com/products/gymshark-everyday-seamless-flared-legg |

No site that got through started getting walled (all 16 captures `ok` before and after; Thomann, Kith, Bombas and Skims are the campaign's walled or borderline sites). After the change every page is 1,280 px wide with its heading on screen.

## Through the product's own capture path

Re-capturing the proof pages of Ruggable, Ridge and Mejuri (`src/jev-live-check.ts`, Jev shadow on in that process, $0.004): Ruggable's Sierra page, which this morning sent Jev a nearly blank tile, now reads Price 374.25 (the 6'x9' sale price, p 0.88), Title "Sierra Persian Tufted Rug" (1.00), the 6x09 SKU and the selected variant 6'x9' (0.93). Ridge and Mejuri read Brand, Price, Title and Rating at 0.85–1.00; Mejuri's one price difference is the page now showing $620 where $615 was stored.
