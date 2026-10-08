# The Verification table behaves like a spreadsheet — design

**Status:** built 2026-10-08 on branch `feat/table-spreadsheet` (plan
`docs/superpowers/plans/2026-10-07-verification-table-spreadsheet.md`), from a
brief Marko brought on 2026-10-07 ("Replace the screenshot tabs with a review
table"), trimmed in discussion to what the brief adds over the table that
already exists. The second half of the original brief — streaming rows and a
silent pass rate over unverified pages — is deferred, see the next section.
Two things the build added to this design: the context menu's close must not
return focus to the cell after "Type it" (Radix `onCloseAutoFocus`, plus the
Type input focusing on the next frame), and the detail bar's empty state is a
`<section>` too, so it is one region in both states.
Builds on the table-first design
(`2026-09-28-table-first-and-drift-repair-design.md`, Part A), which this
does not change: one row per field, one column per product, the agreement
rule, Accept per row, Accept all agreed, Verify and certification all stay as
they are.

## Why

The Verification table is read far more than it is marked. The common actions
are reading a value, comparing it across products and copying it; the rare
one is re-pointing a field at a different element. Today the common gesture
(a click on a cell) does the rare thing: it opens the screenshot under the
table. Long values are truncated with no way to read them, there is no copy,
no keyboard and no right-click. This design gives the table spreadsheet
reading behaviour and makes fixing explicit.

## What the brief asked for that this design leaves out, and why

- **Products as rows, fields as columns.** Decision D1 of the table-first
  design chose fields as rows because the row is the unit of agreement and
  holds the row's one action. Nothing in this design needs the flip.
- **Streaming 5 then 10 rows and silently testing the rules on 20–30 more
  pages, showing a "28/30" pass rate and exception rows.** A different
  verification model (statistical, on pages with no expected values) and
  five to seven minutes of setup-time page loads. It is the subject of the
  second-layout proof-pages note (`2026-09-17-second-layout-proof-pages-design.md`)
  and of a future spec that must first define what "passed" means on an
  unverified page. Not here.
- **"Do not let users type over values."** Agreed for cells: a cell is never
  free text and double-click never edits. But typing an expected value is a
  verification signal (customer-schema verification spec §4), so **Type it**
  stays as an explicit action and joins the context menu.
- **A separate side panel for the preview.** The detail bar carries the
  preview, so the screenshot has one home.

## 1. Selection is separate from the screenshot

Today the selected cell and the open screenshot are one thing: the `?product`
and `?field` search params, with the panel open exactly while `?product` is
set (`routes/_app/projects/$project/sites/$site/index.tsx`, "Selection").

After this design:

- **The URL keeps its meaning:** `?product=n[&field=key]` is "the screenshot
  panel is open on product n, field highlighted". Deep links, `closePanel`
  and the Escape handler are unchanged.
- **Selection is route state, not URL state:** `selection: { product: number
  (0-based card index); key: string } | null`. The route owns it (the detail
  bar, Type it and the keyboard all need it) and hands it to the table.
  Reload clears it; that is fine.
- **A cell click selects that cell and does nothing else.** No navigation, no
  reveal, no popover.
- **A column head click still opens the screenshot** on that product with no
  field highlighted, as today. It is not a cell, and it is the way to mark a
  field on a brand-new website that has no suggestions yet.
- **Opening the screenshot from a cell** (section 4) also selects the cell.
  Closing the panel keeps the selection.
- **"Type it" and the expanded row's details follow the selected cell's
  product** (`productNumber`, `typed`, `onType`), not the open screenshot's.
  When nothing is selected they use product 1, as the code falls back today.

## 2. What the table gains

**The detail bar.** Directly above the table, below the Accept all / Verify
line, full width, stable height so the table never jumps:

```
Price · Pine stool (product 2)                suggested          [Copy] [Fix] [Type it]
219.99
┌────────────────────┐
│  (screenshot crop)  │   ← only while the screenshot panel is closed
└────────────────────┘
```

- Line 1: field name, product title or short URL, "(product n)"; the cell's
  state word: "nothing found" (grey), "suggested" (orange), "accepted"
  (green), "fails on this product" (red); the buttons.
- Line 2: the full value in mono, wrapping, up to about six lines then
  scrolling inside the bar. Ordinary text, so native selection and copy work.
- **Copy** writes the value with `navigator.clipboard.writeText`; the button
  reads "Copied" for 1.5 s. Disabled when the value is empty.
- **Fix** (reads **Mark** when the cell is empty) does section 4.
- **Type it** expands the field's row and focuses its Type input for the
  selected product.
- With nothing selected the bar shows one muted line: "Select a cell to see
  its full value." The crop area is not reserved.
- Fix and Type it are disabled while `locked` (a Verify is running), as every
  edit is today. Copy and selection are never disabled.
- Under 640 px the crop is hidden and the buttons wrap under the value.

**The Fix button in a cell.** A small ghost button at the right edge of a
cell, reading "Fix" ("Mark" on an empty cell), shown on hover and on the
selected cell, and **always shown on a red cell**. It does section 4. The
existing one-click tick for a single-place suggestion (`onAccept`, spec
2026-09-29 A7) stays where it is and keeps precedence for the hover slot on
an orange cell: tick first, then Fix.

**The header count.** After a Verify has produced a verdict for a field, its
status column shows, after the badge, "n/m" in muted text: m = the proof
pages the field was checked on (those with a result for it), n = those on which the field did
not fail (`failedCell` false). It restates the verdict as a count — "✓ 3/3",
"fails on product 2 · 2/3". Nothing is shown before a Verify, and nothing
here counts pages the customer has not verified.

## 3. Right-click and keyboard

**Context menu** on a cell (Radix `ContextMenu`, wrapped as
`components/ui/context-menu.tsx` in the shadcn style the dropdown menu uses).
Right-click also selects the cell. Items, in order:

1. **Copy value** — disabled when empty.
2. **Open product page** — the product's URL in a new tab.
3. **Fix on screenshot** / **Mark on screenshot** — section 4. Disabled while
   locked.
4. **Type it** — as the detail bar's button. Disabled while locked.

**Keyboard.** Each cell is a focusable button already; the table manages a
roving tabindex so Tab enters the table once, at the selected cell or the
first cell. Handled on the table container, never while focus is in an input,
textarea, select or contenteditable, and never while a popover is open:

| Key | Does |
|---|---|
| ← → ↑ ↓ | move the selection one cell; focus follows; clamps at the edges (no wrap) |
| Home / End | first / last product on the row |
| Ctrl+C / ⌘C | copy the selected cell's value (the detail bar's Copy) |
| Enter, F | Fix / Mark on the selected cell (section 4) |
| Escape | if the panel is open: close it (the existing handler); else clear the selection |

Arrow keys over the variants row and the drift lines are skipped: the
selection moves only among field cells. Keys do nothing when nothing is
selected except Tab, which focuses the first cell.

## 4. Fix mode and the passive preview

**Fix** does exactly what a cell click does today: `setPopover(null)`,
`select({ product: i + 1, field: key })`, bump `reveal`. The screenshot opens
under the table with the field's element outlined and scrolled into view;
marking there is unchanged (click an element, pick the field, tick). On an
empty cell the same action opens the screenshot with nothing highlighted,
ready to mark — hence the "Mark" label. After a mark, suggestions transfer
and cells, rails and badges update as they do today; nothing new is needed
for "after a fix, update the table".

**The passive preview.** While a cell is selected and the panel is closed,
the detail bar shows a crop of the product's screenshot around the field's
element, `components/verification/screenshot-crop.tsx`:

- Input: the capture's tiles (already-resolved URLs, as `PageViewer` gets
  them), `pageHeight`, `capturedHeight`, the element's box or `null`, the
  cell's state for the outline colour.
- Size: 240 × 160 px (CSS), `overflow: hidden`, read-only, `cursor: pointer`,
  `aria-label="Open the screenshot to fix {field}"`. Clicking it does Fix.
- Geometry is a pure function `cropFrame(box, crop, page)` in
  `lib/site/screenshot-crop-view.ts`: scale = clamp(cropWidth / (box.w +
  48), 0.25, 1); the box is centred, then the frame is clamped so it never
  shows beyond the page's edges; returns `{ scale, left, top }` for the tile
  stack. With no box: the top of the page at scale cropWidth / pageWidth.
  The page width is the capture viewport width the tiles were taken at (the
  same figure `PageViewer` derives its scale from).
- The box is outlined inside the crop in the cell's state colour, 2 px, as
  the viewer's overlays are.
- Before the screenshot has landed the crop shows "Taking screenshot…"; if it
  failed, the capture's error, both as the panel does, without the Retry
  button (that stays in the panel).

## 5. Files

- `components/verification/verification-table.tsx` — takes `selection` and
  reports `onSelect(product, key)`, `onFix(product, key)`, `onCopy`,
  `onTypeIt(key)`, `onOpenPage(product)`; renders the Fix button, the context
  menu and the header count; owns the roving tabindex and key handling.
  `TableCell.onClick` becomes `onSelect`; `selected` stays.
- `components/verification/cell-detail-bar.tsx` — new, presentational.
- `components/verification/screenshot-crop.tsx` — new, presentational.
- `components/ui/context-menu.tsx` — new, shadcn-style over Radix.
- `components/verification/field-details.tsx` — accepts a `focusTyped`
  counter and focuses the Type input when it changes.
- `lib/site/screenshot-crop-view.ts` (+ test) — `cropFrame`.
- `lib/site/table-selection.ts` (+ test) — `moveSelection(sel, key, rows,
  cols)`, `headerCount(results, key, cards)`, `stateWord(segment)`,
  `fixLabel(segment)`.
- `routes/_app/projects/$project/sites/$site/index.tsx` — `selection` state;
  cell wiring split into select and fix; detail bar mounted; Type it focus
  request; details follow the selection.
- `routes-smoke.test.ts` — new steps (section 6).

Not touched: `lib/site/verification-model.ts`, the engine, the API, the
database, certification, autosave, Verify.

## 6. Testing

- **Unit** (`vitest`, free): `cropFrame` (centred, clamped at each edge, no
  box, scale bounds); `moveSelection` (each key, clamping, skipping nothing
  but staying in bounds); `headerCount` (no verdict → null; all pass; one
  fail; a card with no URL not counted); `stateWord` and `fixLabel`.
- **Route smoke** (`pnpm test:ui:app`, free, against the isolated pair on
  :4100/:3100 as the handoff's free-live-checks rule says): on a website
  with captured proof pages — click a cell: the detail bar shows its value
  and the panel is **not** open; press ArrowRight: the selection moves; press
  Enter: the panel opens on that product with the field highlighted; Escape
  closes it and the selection remains; right-click a cell: the menu shows the
  four items; Copy value puts the value on the clipboard. Screenshots of the
  bar with and without a crop into `docs/testing/screens/app-*.png`, both
  themes.
- **Rendered check** by the controller before merge, in real Chromium, as
  every app change so far: the hover Fix button, the always-on Fix on a red
  cell, the crop on a long page, the bar under 640 px.

## 7. Acceptance

- Selecting, copying and reading a full value never open the screenshot.
- Only the Fix/Mark button, the context menu's Fix item, Enter/F and the crop
  open the screenshot from a cell; the column head still opens it.
- Arrow keys, Home/End, Ctrl/⌘+C, Enter/F and Escape behave as the table in
  section 3 says.
- The header count appears only after a Verify and matches the badge.
- `pnpm --filter @robot/app test`, `pnpm typecheck` and the route smoke pass.
- No model call, no engine change, no schema change.

## 8. Decisions taken in this design

1. Selection lives in route state, not the URL; the URL keeps meaning
   "screenshot open".
2. The column head still opens the screenshot (needed for a new website).
3. The header count only restates a Verify verdict over the proof pages.
4. "Type it" stays, as an explicit action in the bar and the menu.
5. No side panel; the preview lives in the detail bar.
