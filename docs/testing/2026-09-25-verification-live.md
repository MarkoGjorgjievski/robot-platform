# The Verification tab, live on Ikea — 2026-09-25

Plan 5's free live run (spec `docs/superpowers/specs/2026-09-25-verification-tab-design.md` §6).
Script: `docs/testing/ui-check-app-verification.mts`. **Cost: $0.00** — a second api-server on
:4100 with `ANTHROPIC_API_KEY` empty (`verifyEstimate` answered `aiAvailable: false`, checked
before anything else), the app on :3100 pointed at it, and the Verify button asserted to read
`Verify · mechanical only` (no dollar amount) before it was clicked. Marko's `pnpm dev:all`
(:4000 / :3000 / :3456) was not touched; both extra servers were stopped afterwards.

Identity: a throwaway `check-<timestamp>@example.com`, its own project, deleted at the end.
Marko's data was read once, with one read-only query, for Ikea's field names and listing URL:
the stored Ikea website has **six** fields (Title, Product URL, Price, In stock, Description,
Main image) and **no listing URL**, so the listing used is Ikea Malaysia's Cabinets category
(`https://www.ikea.com/my/en/cat/cabinets-10409/`, a breadcrumb link on the stored proof page), and
two catalogue fields Ikea keeps in its JSON-LD were added — **SKU** and **Brand** — to exercise the
row path for page data (the brief's "eight fields").

## The final run (after the three fixes below)

| What | Measured |
|---|---|
| Find products → answer | **12–16 s** over four runs; "35 products found · a pager too" |
| Cards | 3 of 3 with a photo: BAGGEBO, SÅGMÄSTARE, "Option: BILLY / OXBERG, Bookcase with doors, white, 80x30x106 cm" (the listing's link text, variant prefix and all) |
| Screenshots | all three ready together, **11.8 s** after the listing answered (22.2 s on the last run); the three capture polls are one batched request every 2 s, so that is the resolution, and the three ran concurrently |
| Page data, per product | **8 of 8 fields suggested on every product** before any tick |
| …on the screenshot, one element | In stock, Price and Product URL on all three; SKU on product 3 |
| …on the screenshot, several places | SKU in 2 places on product 1 and 3 on product 2 ("found in n places — click the right one" on the row). Before fix 2, Price read 2 places and Product URL 4–5: the others were elements too small to click |
| …on the row, no element ("page data: …") | **Title, Description, Main image, Brand on all three products** — see below |
| Transfers | 16 `transferMarks` calls (one per tick), carrying 24 field-product suggestions: Title / Description / Main image / Brand as "a value, no element"; Price 2 elements; In stock 1; Product URL 4–5; SKU 1–3. Every one landed on a cell page data had already suggested, so no battery segment changed colour because of a transfer |
| Clicks | **43** in all: Find products, card switches, rectangle clicks, ticks (the check opens every product once before ticking, to count page data; a person needs fewer) |
| Left to mark by hand | **nothing** — every field on every product was a suggestion to tick |
| Verify | `Verify · mechanical only`, enabled; **21.4 s**, mechanical only |
| Verdict | **8 of 8 verified**, no red segment, no "fails on product n", Go to Extract live |
| Errors in the page | none |

### What the page-data row showed

The path had never been seen live. On Ikea it is the commonest one: **four of the eight fields**
came only as a row line with ✓ and ×:

- Title — `page data: BAGGEBO Cabinet with door - white 50x30x80 cm`. Ikea's JSON-LD `name` joins the
  product name and its description line; the page shows them as two elements, so no single
  element equals it.
- Description — the JSON-LD description, which repeats the title before the text; not on the page
  as one element.
- Main image — `page data: https://www.ikea.com/my/en/images/products/…_s5.jpg`; the page's own
  `<img>` uses another size of the same picture.
- Brand — `page data: IKEA` (the logo is an image).

Ticked from the row, each is stored as a typed answer (the value, no mark) and carried to the other
products; the mechanical Verify certified all four from the JSON-LD.

## Found by the check, and fixed (one commit each, with a test)

1. **`caf7d70` — a rectangle at the top of the screenshot lost its label.** Seen in the smoke's
   screenshots: a page's heading sits at y = 0 of its capture, and its label, drawn above the
   rectangle, was cut off by the scrolling frame. `labelBelow()` in `page-viewer-view.ts` puts it
   under the top edge instead.
2. **`c7831ac` — Product URL was suggested on a 1×1 anchor.** An orange "Product URL?" label with
   nothing under it to click; Verify stayed off ("Product URL still needs product 1") with no way to
   answer on the screenshot. `pointable()` in `verification-model.ts` keeps only elements at least
   4 px on each side; a suggestion with none goes to the row. After the fix, Product URL was
   ticked on the screenshot on all three products (the "50x30x80 cm" variant link, whose `href` is
   the product's own address).
3. **`5803280` — In stock ticked, then refused by the Verify gate.** Page data suggested it as
   `https://schema.org/InStock`; the popover let it be ticked (the element's own text "Available"
   fits), and the gate then said "In stock on product 1: Not yes/no". The engine's `normalize`
   reads schema.org availability; the app's copy of the yes/no words did not. Now it does.

## Seen, not fixed (for the handoff)

- **The capture paints Ikea's cookie banner and its sticky header into later tiles.** On product 1
  the first of SKU's two places sits under the cookie banner in the second tile — the check
  picked it ("1 of 2") and it verified, but a person could not have seen what they were clicking.
  Popup dismissal and sticky elements across tiles are the capture's (`@robot/browser`), not this
  tab's.
- **Verify on a throwaway website enriches the shared domain cache.** The run logged
  `[cache] verified paths for www.ikea.com/detail: 8 concept(s)`. The cache is keyed by domain,
  not organisation, and is enriched, never overwritten; the paths are Ikea's real ones. Worth
  knowing before a live check verifies a website Marko also has.
- **Several places happen.** SKU (the article number is shown twice on the page): the first place
  is usually the right one, but the tab offers no hint which.
- The first listing card's title is the listing's link text, which on Ikea can carry an "Option:"
  prefix and the full variant line.

## How to run it again

```
cd packages/api-server && ANTHROPIC_API_KEY= PORT=4100 pnpm exec tsx src/index.ts      # keyless api-server
cd packages/app && VITE_API_URL=http://localhost:4100 pnpm exec vite dev --port 3100 --strictPort
cp docs/testing/ui-check-app-verification.mts packages/browser/src/__ui-check.mts \
  && cd packages/browser && pnpm exec tsx src/__ui-check.mts ; rm src/__ui-check.mts
```

Then stop both servers by port (`Get-NetTCPConnection -LocalPort 4100`, then 3100; check the
command line is yours before `Stop-Process`). The browser is launched with
`--disable-web-security` because the api-server's CORS list names :3000 and :3456 only. The
second vite shares `packages/app/node_modules/.vite` with the :3000 one and re-optimised its
dependencies on start (the lockfile had changed) — harmless here, but it can reload an open tab
on :3000.

After the run the badge classifier in the script was corrected ("changed since verified" is now
asked before "verified"); the numbers above come from the run just before that one-line change,
and "Go to Extract: live" — which needs every field current and passing — agrees with them.

Screenshots: `docs/testing/screens/app-site-verification-ikea-{marking,verified}-{dark,light}.png`. (Since 2026-09-28 the marking pair is deleted with the sidebar it showed, and the verified pair shows the table: `docs/testing/2026-09-28-table-first-live.md`.)
