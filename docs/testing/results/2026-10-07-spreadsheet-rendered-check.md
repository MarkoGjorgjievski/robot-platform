# Verification table spreadsheet behaviour — rendered check (2026-10-07)

Task 10, step 1: a rendered check in real Chromium of the Verification table's spreadsheet
behaviour (hover affordances, drag-copy, narrow viewport, long values, table stability).

- **Commit checked:** `d240dd2`
- **Against:** the already-running dev servers — app `http://localhost:3000`, api-server
  `http://localhost:4000`, Postgres up (not started/stopped/restarted by this check).
- **How:** a throwaway Playwright script (`rendered-check.mts`, not committed), modeled on
  `packages/app/src/routes-smoke.test.ts` — a local `node:http` shop serving three product pages
  with JSON-LD (Title/Price named, nothing names Rating), a throwaway
  `rendered-<timestamp>@example.com` user signed in through `/login`, a project with Title
  (Text) / Price (Money) / Rating (Number) fields, one website on the local shop, the listing
  pasted and "Find products" run, waiting for all three captures to read "ready". Verify, Sample,
  Extract and Check were never clicked. The throwaway project was deleted at the end over tRPC,
  the same way the smoke's `afterAll` does.
- Screenshots: `docs/testing/results/screens-2026-10-07-spreadsheet/`.

## 1. Hover a cell: Fix at the right edge, the one-click tick further right, not overlapping

**PASS.**

Hovered Title on product 1 (a suggestion found in one place, so it carries both the Fix button
and the one-click accept tick). Measured the rendered "Fix" text glyphs and the tick's check-icon
directly (not just the buttons' full hit-areas, which include padding and touch by a few px without
any visual overlap):

- Fix "Fix" text box: `x=591.0, width=15.3`
- Tick check-icon box: `x=619.1, width=9.75`
- Content (glyph-level) overlap: **0px**; Fix sits entirely left of the tick.
- The buttons' hit-areas (including padding) touch by ~0.5–3.7px across runs — that's button
  padding, not a visual overlap; the screenshot below shows a clean gap.

Screenshot: `hover-fix-with-tick.png`.

## 2. A red (failed) cell's Fix button is visible without hover

**SKIPPED.** Needs a failed Verify, which calls the model and can spend money. Per the brief,
this was skipped rather than triggering a real Verify.

## 3. Drag-select part of a cell's value, Ctrl+C, paste: the fragment arrives, not the whole cell

**FAIL** — and not a test-script fluke; this is a structural property of the markup.

Dragged the mouse across roughly the left half of "219.99" in the Price cell on product 2 (mouse
down at the text's left edge, move to ~55% of its width, mouse up), the same gesture a real user
would make. Result:

- `window.getSelection()?.toString()` after the drag: `""` (empty — no native text selection was
  created at all).
- `navigator.clipboard.readText()` after Ctrl+C: `"219.99"` (the full cell value).
- Pasted into the detail bar's "Type it" input (via the cell's right-click menu): `"219.99"` (the
  full cell value, not a fragment).

Root cause, confirmed with an isolated two-line repro outside the app (a bare `<button>text</button>`
vs a bare `<div>text</div>` in a blank page, same Playwright drag): a mouse drag inside a native
`<button>` element never produces a text selection in Chromium — the identical drag over a `<div>`
with the same text selects it normally. The Verification table's cells are rendered as
`<button type="button" data-cell=...>` (`packages/app/src/components/verification/verification-table.tsx`,
the cell button around line 364), so `window.getSelection()` is always empty after a drag inside
one. The table's own `onKeyDown` explicitly defers to native copy when a selection exists
("A dragged text selection inside the cell keeps native copy (Review Focus 4)" —
`packages/app/src/components/verification/verification-table.tsx` line ~295) — but since no
selection can ever exist inside a `<button>`, that branch is unreachable via mouse drag, and
Ctrl+C always falls through to the app's own `onCopy`, which copies the whole cell. Item 3's
expected behaviour ("the dragged fragment arrives, not the whole cell") cannot happen via a plain
mouse drag as implemented.

Screenshot: `drag-copy.png` (shows "219.99", the full value, in the Type input after paste).

## 4. Viewport narrower than 640px

**PASS**, at 375px width (iPhone-SE-class), with a cell already selected (Title on product 1):

- Crop hidden: the bar's screenshot-crop wrapper (`hidden sm:block`) is not visible (`isVisible()`
  → `false`).
- Buttons wrap under the value: the field-name/state line ("Title · Widget A (product 1)
  suggested") sits at `y=448.0`; the Copy button sits at `y=470.8` — a new line below it, 22.75px
  lower (one line height).
- No horizontal page scroll: `document.documentElement.scrollWidth` (375) ≤ `window.innerWidth`
  (375).

(At 480px the same bar did **not** wrap — the header line is short enough to fit on one row at
that width — so 375px was used to exercise the wrap case the brief describes; no-scroll and
crop-hidden both held at 480px too.)

Screenshot: `narrow-640.png`.

## 5. A long value: wraps/scrolls past ~6 lines; the table doesn't move — except it does, on clear

Used "Type it" on Title · product 3 (a Text field, so the typed value is always valid and never
trips an autosave-error banner that would confound the table-position measurement) and typed a
974-character sentence.

**5a — PASS.** The value box is capped at `max-h-[8.5rem]` (110.5px at this app's 13px root
font-size) and scrolls internally: rendered box height = 110.5px, `scrollHeight` = 176px (i.e. it
really does overflow and scroll, not just visually truncate), and the wrapped text is present in
the DOM.

**5b — FAIL.** Table top (the `<div class="overflow-x-auto ...">` wrapping the table) measured at
four points:

| state | table top (y) |
|---|---|
| nothing selected (before any selection) | 586.30 |
| the long-value cell selected | 586.30 |
| a different (short-value) cell selected | 586.30 |
| selection cleared again | 487.30 |

Selecting one cell and then another never moves the table (all three "something selected" rows
agree exactly). But clearing the selection moves the table **up by 99px** — it does not return to
the position it held before the first selection was made, which is what a reader would expect from
the cell-detail-bar comment "Stable height, so selecting a cell never moves the table."
(`packages/app/src/components/verification/cell-detail-bar.tsx` line ~31).

Cause: the detail bar's own measured height is 175px while any cell is selected (short value or
long), but only 76px (its `min-h-[76px]` floor) once nothing is selected — because the
screenshot-crop preview (`ScreenshotCrop`, the `hidden sm:block` column) renders whenever a cell is
selected, regardless of how short the value is, and disappears entirely when the selection is
cleared. So "selecting a cell never moves the table" holds between two selections, but not for the
transition to/from no selection — deselecting shifts the table up by the preview's height.

Screenshot: `long-value.png` (shows the wrapped/scrolled value box next to the screenshot-crop
preview that is the actual cause of 5b's movement).

## Screenshot: detail bar with crop, dark theme, 1440×900

**PASS.** Title on product 1 selected, screenshot panel closed, dark theme, 1440×900 viewport. The
crop button ("Open the screenshot to fix Title") is present and visible.

Screenshot: `bar-with-crop-dark.png`.

## Summary

| # | Item | Result |
|---|---|---|
| 1 | Hover: Fix + tick, no overlap | PASS |
| 2 | Red cell's Fix visible without hover | SKIPPED (would spend money) |
| 3 | Drag-select + Ctrl+C copies the fragment | **FAIL** (native `<button>` blocks drag-selection; whole cell is copied instead) |
| 4 | Narrow viewport (<640px) | PASS |
| 5a | Long value wraps/scrolls past ~6 lines | PASS |
| 5b | Table top stable across selection changes | **FAIL** (stable between two selections; moves ~99px when the selection is cleared, because the screenshot-crop preview disappears) |
| — | Detail bar + crop screenshot, dark, 1440×900 | PASS |

Two mismatches with the stated expected behaviour were found (items 3 and 5b), both reproducible
and explained above with root causes in the current code. No app code was changed by this check.
