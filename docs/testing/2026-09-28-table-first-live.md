# The table-first Verification tab, live on Ikea — 2026-09-28

Table-first verification's free live run (spec
`docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md` Part A, §A5; plan
`docs/superpowers/plans/2026-09-28-table-first-verification.md`, Task 4). Script:
`docs/testing/ui-check-app-verification.mts`, rewritten for the table. Plan 5's run on the same
listing, before the table: `docs/testing/2026-09-25-verification-live.md`.

**Cost: $0.00.** A second api-server on :4100 with `ANTHROPIC_API_KEY` empty (`verifyEstimate`
answered `aiAvailable: false` and `upperBoundUsd: 0`, checked before anything else), the app on
:3100 pointed at it, and the Verify label asserted to end "· free" with no dollar amount before
each click. Verify was clicked four times in all (three Ikea Cabinets runs, one Ikea "chairs"
run), all on :4100. Marko's `pnpm dev:all` (:4000 / :3000 / :3456) was not touched; both
extra servers were stopped by port afterwards.

Identity: a throwaway `check-<timestamp>@example.com` per run, its own project, deleted at the end
of every run. No real account, organisation or project was read. The fields and the listing are
plan 5's: Ikea's six stored fields plus SKU and Brand, and Ikea Malaysia's Cabinets category
(`https://www.ikea.com/my/en/cat/cabinets-10409/`). The three products are the same three as
plan 5's (BAGGEBO, SÅGMÄSTARE, "Option: BILLY / OXBERG, Bookcase with doors…").

## The final run (after the three fixes below)

| What | Measured |
|---|---|
| Find products → answer | **12.4 s**; "35 products found · a pager too" |
| Screenshots | all three ready together, **12.3 s** after the listing answered (the capture poll is one batched request every 2 s, so that is the resolution) |
| Page data | 8 of 8 fields suggested on every product before any click |
| Rows before any click | **4 agreed** (Title, Product URL, Description, Main image) · **1 same everywhere** (Brand, "IKEA") · **3 need you**: Price and In stock ("comes from different places"), SKU ("found in 2 places on product 1") |
| The bar | "Accept all agreed (4)"; no screenshot open until a cell is clicked |
| **Clicks to an enabled Verify** | **24** (plan 5: **43**), Find products included — see the breakdown |
| Verify | `Verify 8 fields · free`, enabled; **6.2 s** |
| Verdict | **8 of 8 verified**, no red cell, Go to Extract live, the button then reads "Everything is verified" |
| Errors in the page | none |

### Where the 24 clicks went

| Clicks | What |
|---|---|
| 1 | Find products |
| 1 | **Accept all agreed (4)** — Title, Product URL, Description, Main image on all three products |
| 1 | **Accept Brand anyway** — "same on every product — check it": IKEA is the brand, so a person accepts it |
| 3 + 3 | Price: open product 1's cell, click its rectangle, ✓; the same on product 2 |
| 1 | Accept all agreed (1) — Price on product 3, agreed once 1 and 2 were answered |
| 3 + 3 | In stock: the same two ticks |
| 1 | Accept In stock anyway — product 3's value, alike on every product |
| 3 + 3 | SKU: the first of the rectangles on product 1 ("found in 2 places"), then on product 2 ("found in 3 places") |
| 1 | Accept all agreed (1) — SKU on product 3 |

**Three clicks cover five of the eight rows.** The other 21 go on the three rows the agreement
rule sends to a person, and on this listing those are real:

- **Price and In stock come from two different places in the page data.** Products 1 and 2 carry
  a single offer (`json-ld offers.price`, `offers.availability`); product 3, a BILLY / OXBERG
  combination, carries an AggregateOffer (`offers.offers[0].price`,
  `offers.offers[0].availability`). The rule (spec A2: the same source path on every product)
  is doing its job. What costs clicks is that the reason names no product: the check, like a
  person, ticks product 1 first, which leaves 2 and 3 still disagreeing, and then product 2.
  Had it said "comes from a different place on product 3", one tick per row would have done it
  (18 clicks, not 24) — an open item below.
- **SKU is shown in two or three places** on products 1 and 2 (the article number appears
  twice or three times on an Ikea page), so a person has to pick one.

The ≤ 5 target (spec A5) is met for the rows the rule calls agreed — one click for four rows —
and would be met on this website if every product shared one JSON-LD shape and showed its
article number once. The script now records the target as a measurement (met / missed), not a
pass mark.

### A second listing, for comparison (not a record run)

`--listing https://www.ikea.com/my/en/cat/chairs-fu002/`, after the fixes: 25 products found in
**41.8 s**, but the listing's first three are a table, a pendant lamp and a vase, named by the
listing's whole card text ("Even more affordablePINNTORP TableRM399Price RM 399Previous price:
RM499") and with **no photo** on any card — listing quality, not this tab. The same 4 agreed /
1 same everywhere / 3 need you; Price and In stock were offered on the row (their elements sat
off the screenshot, see fix 3); **15 clicks**, Verify in 6.2 s, **8 of 8 verified**.

## Found by the check, and fixed (one commit each)

1. **`8816244` — a cell click opened a screenshot nobody could see.** The panel opens under the
   table; with eight rows it starts below the fold (y = 1006 of a 900 px viewport), and the
   viewer frame starts at the top of the product page, so the outlined element (SKU: 881 px
   down a 638 px frame) was out of sight too. The first live run's rectangle clicks landed
   outside the window ("under the pointer: nothing"). A cell or column-head click now asks the
   viewer to reveal, matched to the product and field in the address, and the viewer scrolls
   the outlined element (else the frame) into view once. Clicks inside the viewer never ask,
   so an open popover stays put. The smoke asserts the frame is on screen after a cell click;
   it fails without the change.
2. **`1c4d7af` — on a product switch the reveal fired against the old screenshot.** The new
   tiles render once with the old width before the viewer resets it, and the scroll happened
   then: every tick after the first found its rectangle off screen (y 1278–1782). The viewer
   now records which tiles its width was measured for and reveals only for the current set. The
   next run had no rectangle off screen on any of six switches.
3. **`e526d4b` — Accept all agreed made every save fail.** On the "chairs" listing Product URL's
   one link was measured at **y = −1066** (Ikea's price module; the box map's, not this tab's).
   Accept all agreed took it as the answer's mark, the server refuses a mark with a negative
   rect ("Not saved: Number must be greater than or equal to 0"), and every autosave after it
   was refused. `pointable` now leaves out an element that starts above or left of the
   screenshot (its value is offered and accepted as page data, as for a 1×1 anchor), and
   `valueFromBox` keeps no mark for one. The same fix put the Price and In stock rectangles that
   were drawn above the frame, over the table, back on the row. Two unit tests.

## Seen, not fixed (for the handoff)

- **"comes from different places" names no product** (above): 6 of the 24 clicks.
- **Yes/no values show raw.** In stock reads `https://schema.org/InStock` in its cells; after the
  run product 3's cell read `1` (the value accepted there) while 1 and 2 kept the URL. It
  verified; it reads oddly. Related to Task 3's note that a carried Price reads "RM399" where the
  tick read "99".
- **The box map measures some Ikea elements at negative y** (the price module): a capture
  question for `@robot/browser` / the box map, now harmless on this tab.
- **Verify on a throwaway website enriches the shared domain cache**, as in plan 5: the
  api-server logged `[cache] verified paths for www.ikea.com/detail: 8 concept(s)` four times.
- The `chairs-fu002` listing's quality (wrong products, whole-card titles, no photos, 42 s).

## How to run it again

```
cd packages/api-server && ANTHROPIC_API_KEY= PORT=4100 pnpm exec tsx src/index.ts      # keyless api-server
cd packages/app && VITE_API_URL=http://localhost:4100 pnpm exec vite dev --port 3100 --strictPort
cp docs/testing/ui-check-app-verification.mts packages/browser/src/__ui-check.mts \
  && cd packages/browser && pnpm exec tsx src/__ui-check.mts ; rm src/__ui-check.mts
```

Then stop both servers by port (`Get-NetTCPConnection -LocalPort 4100`, then 3100; check the
command line is yours before `Stop-Process`). The script prints, before any click, where page
data found each field on each product (source and path), which is what explains a
"comes from different places" row.

Screenshots: `docs/testing/screens/app-site-verification-ikea-{agreed,verified}-{dark,light}.png`.
