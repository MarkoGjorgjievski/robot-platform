# The Verification table behaves like a spreadsheet — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A click on a Verification-table cell selects it (full value in a detail bar, copy, keyboard, right-click) and only an explicit Fix opens the screenshot.

**Architecture:** Selection becomes route state separate from the URL (which keeps meaning "screenshot open"). The table gets a selection, a per-cell Fix button, a Radix context menu, roving-tabindex keyboard handling and a header count; a new detail bar above it shows the selected value and a read-only screenshot crop. Pure logic (moving the selection, the crop geometry, the header count, the state words) lives in `lib/site` with unit tests. Nothing in the engine, API, model or certification changes.

**Tech Stack:** React 19, TanStack Router (the route), Tailwind v4, shadcn-style components over `radix-ui` (`ContextMenu`), Vitest (node env for `lib/`), Playwright (route smoke).

**Spec:** `docs/superpowers/specs/2026-10-07-verification-table-spreadsheet-design.md` — read it first; this plan argues from it.

## Global Constraints

- All packages are ESM (`"type": "module"`); imports of local files end in `.js` only in `@robot/api`/`@robot/scraper`; `@robot/app` imports without an extension (follow the files you edit).
- `@robot/app` unit tests run in Vitest's **node** environment (`packages/app/vitest.config.ts`): test only pure modules under `src/lib`, never components.
- Copy and labels are exact as the spec gives them: state words "nothing found" / "suggested" / "accepted" / "fails on this product"; buttons "Copy", "Copied", "Fix", "Mark", "Type it"; menu items "Copy value", "Open product page", "Fix on screenshot" / "Mark on screenshot", "Type it"; empty bar line "Select a cell to see its full value."
- Design system rules (spec 2026-09-21 §4, §6, §7): no uppercase tracked labels, no cards outside dialogs and the websites list, state colours are rails/outlines never background washes (`border-pass`/`border-warn`/`border-fail`, `outline-pass`/`outline-warn`/`outline-fail`, `text-fail`/`text-warn`), secondary text `text-sm text-muted-foreground`, mono values `font-mono`.
- Shared checkout: commit with `git commit -m "…" -- <explicit paths>` only (never a bare `git add -A`/`git commit -a`); stage a **new** file with `git add -- <path>` first.
- Every commit message ends with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Verify locally with `pnpm --filter @robot/app test -- --run` and `pnpm --filter @robot/app typecheck`; never run `pnpm -r test` (killed for memory on this machine).
- Nothing here may spend on AI or call Verify/Extract/Sample; the smoke never clicks a button that can spend.

## Review Focus

1. **Arrow Right past the last product with the "+ Add product" column present** — the selection must clamp at the last real product, never land on the add column. Pinned in Task 1 (`moveSelection` clamps at `products - 1`).
2. **A field removed on the Fields page (or a product dropped) while its cell is selected** — the stale selection must be dropped silently, not crash the detail bar. Pinned in Task 1 (`clampSelection`) and used in Task 8.
3. **A field's element below the captured height, or a page narrower than the crop** — the crop must stay inside the page, never show blank space beyond an edge. Pinned in Task 2 (`cropFrame` clamping tests).
4. **Ctrl/⌘+C while the person has dragged a text selection inside a cell** — native copy must win; the table only copies the cell when no text is selected. Pinned in Task 7's handler (`window.getSelection()` check) and the rendered check in Task 10.
5. **Arrow keys while the mark popover is open** — the popover owns the keyboard; the selection must not move. Pinned in Task 9's smoke step (ArrowRight with the popover open leaves the selection where it is).

---

### Task 1: Pure selection helpers

**Files:**
- Create: `packages/app/src/lib/site/table-selection.ts`
- Test: `packages/app/src/lib/site/table-selection.test.ts`

**Interfaces:**
- Consumes: `Segment`, `Card` from `./verification-model`.
- Produces:
  - `type CellSelection = { product: number; key: string }` (product is the 0-based card index)
  - `type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'`
  - `moveSelection(sel: CellSelection, key: MoveKey, fieldKeys: string[], products: number): CellSelection`
  - `clampSelection(sel: CellSelection | null, fieldKeys: string[], products: number): CellSelection | null`
  - `headerCount(results, key, unchangedKeys, cards): { passed: number; checked: number } | null`
  - `stateWord(s: Segment): string`, `fixLabel(s: Segment): 'Fix' | 'Mark'`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/lib/site/table-selection.test.ts
import { describe, expect, test } from 'vitest';
import { clampSelection, fixLabel, headerCount, moveSelection, stateWord } from './table-selection';

const KEYS = ['title', 'price', 'rating'];

describe('moveSelection', () => {
  test('ArrowRight moves one product, ArrowLeft back', () => {
    expect(moveSelection({ product: 0, key: 'price' }, 'ArrowRight', KEYS, 3)).toEqual({ product: 1, key: 'price' });
    expect(moveSelection({ product: 1, key: 'price' }, 'ArrowLeft', KEYS, 3)).toEqual({ product: 0, key: 'price' });
  });
  test('ArrowDown moves one field, ArrowUp back', () => {
    expect(moveSelection({ product: 0, key: 'title' }, 'ArrowDown', KEYS, 3)).toEqual({ product: 0, key: 'price' });
    expect(moveSelection({ product: 0, key: 'price' }, 'ArrowUp', KEYS, 3)).toEqual({ product: 0, key: 'title' });
  });
  test('clamps at the edges, never wraps — Right at the last product stays put even with an add column after it', () => {
    expect(moveSelection({ product: 2, key: 'price' }, 'ArrowRight', KEYS, 3)).toEqual({ product: 2, key: 'price' });
    expect(moveSelection({ product: 0, key: 'price' }, 'ArrowLeft', KEYS, 3)).toEqual({ product: 0, key: 'price' });
    expect(moveSelection({ product: 0, key: 'title' }, 'ArrowUp', KEYS, 3)).toEqual({ product: 0, key: 'title' });
    expect(moveSelection({ product: 0, key: 'rating' }, 'ArrowDown', KEYS, 3)).toEqual({ product: 0, key: 'rating' });
  });
  test('Home and End go to the first and last product on the row', () => {
    expect(moveSelection({ product: 1, key: 'price' }, 'Home', KEYS, 3)).toEqual({ product: 0, key: 'price' });
    expect(moveSelection({ product: 1, key: 'price' }, 'End', KEYS, 3)).toEqual({ product: 2, key: 'price' });
  });
  test('a key not in the field list leaves the selection unchanged', () => {
    expect(moveSelection({ product: 0, key: 'gone' }, 'ArrowDown', KEYS, 3)).toEqual({ product: 0, key: 'gone' });
  });
});

describe('clampSelection', () => {
  test('keeps a selection that still exists', () => {
    expect(clampSelection({ product: 2, key: 'rating' }, KEYS, 3)).toEqual({ product: 2, key: 'rating' });
  });
  test('drops a selection whose field or product is gone, and passes null through', () => {
    expect(clampSelection({ product: 0, key: 'gone' }, KEYS, 3)).toBeNull();
    expect(clampSelection({ product: 3, key: 'title' }, KEYS, 3)).toBeNull();
    expect(clampSelection(null, KEYS, 3)).toBeNull();
  });
});

describe('headerCount', () => {
  const cards = [{ url: 'https://s/1', title: '1' }, { url: 'https://s/2', title: '2' }, { url: '', title: '' }];
  test('null before any verdict, and once the field has changed since', () => {
    expect(headerCount(null, 'price', ['price'], cards)).toBeNull();
    expect(headerCount({}, 'price', ['price'], cards)).toBeNull();
    const r = { price: { cells: { 'https://s/1': { status: 'pass' }, 'https://s/2': { status: 'pass' } } } };
    expect(headerCount(r, 'price', [], cards)).toBeNull();
  });
  test('counts cards with a URL; a fail lowers passed', () => {
    const r = { price: { cells: { 'https://s/1': { status: 'pass' }, 'https://s/2': { status: 'fail' } } } };
    expect(headerCount(r, 'price', ['price'], cards)).toEqual({ passed: 1, checked: 2 });
  });
  test('all pass', () => {
    const r = { price: { cells: { 'https://s/1': { status: 'pass' }, 'https://s/2': { status: 'pass' } } } };
    expect(headerCount(r, 'price', ['price'], cards)).toEqual({ passed: 2, checked: 2 });
  });
});

describe('words', () => {
  test('stateWord', () => {
    expect(stateWord('empty')).toBe('nothing found');
    expect(stateWord('suggested')).toBe('suggested');
    expect(stateWord('answered')).toBe('accepted');
    expect(stateWord('failed')).toBe('fails on this product');
  });
  test('fixLabel reads Mark only on an empty cell', () => {
    expect(fixLabel('empty')).toBe('Mark');
    expect(fixLabel('suggested')).toBe('Fix');
    expect(fixLabel('answered')).toBe('Fix');
    expect(fixLabel('failed')).toBe('Fix');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/table-selection.test.ts`
Expected: FAIL — cannot resolve `./table-selection`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/lib/site/table-selection.ts
// Pure helpers for the Verification table's spreadsheet behaviour (spec
// 2026-10-07 §1, §2, §3): where the selection goes on a key, whether a stored
// selection still points at a cell, the "n/m" after a Verify badge, and the
// words the detail bar and the Fix button use for a cell's state.
import type { Card, Segment } from './verification-model';

/** One selected cell: the 0-based card index and the field key. */
export type CellSelection = { product: number; key: string };

export type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** The selection after `key`: one cell at a time, clamped at the table's edges, never wrapping. */
export function moveSelection(sel: CellSelection, key: MoveKey, fieldKeys: string[], products: number): CellSelection {
  const row = fieldKeys.indexOf(sel.key);
  if (row < 0 || products <= 0) return sel;
  const lastProduct = products - 1;
  switch (key) {
    case 'ArrowLeft':
      return { ...sel, product: clamp(sel.product - 1, 0, lastProduct) };
    case 'ArrowRight':
      return { ...sel, product: clamp(sel.product + 1, 0, lastProduct) };
    case 'Home':
      return { ...sel, product: 0 };
    case 'End':
      return { ...sel, product: lastProduct };
    case 'ArrowUp':
      return { ...sel, key: fieldKeys[clamp(row - 1, 0, fieldKeys.length - 1)]! };
    case 'ArrowDown':
      return { ...sel, key: fieldKeys[clamp(row + 1, 0, fieldKeys.length - 1)]! };
  }
}

/** A selection survives only while its field and product are still on the table. */
export function clampSelection(sel: CellSelection | null, fieldKeys: string[], products: number): CellSelection | null {
  if (!sel) return null;
  return fieldKeys.includes(sel.key) && sel.product >= 0 && sel.product < products ? sel : null;
}

/** The slice of a Verify result this needs; the route's `results` satisfies it. */
export type ResultsLike = Record<string, { cells: Record<string, { status: string }> }>;

/**
 * "n/m" after a Verify badge (spec §2): m = proof pages checked (cards with a
 * URL), n = those on which the field did not fail. Null before a verdict, and
 * once the field has changed since it (the badge then reads "changed since
 * verified" and a count would contradict it).
 */
export function headerCount(results: ResultsLike | null | undefined, key: string, unchangedKeys: string[], cards: Card[]): { passed: number; checked: number } | null {
  const fv = results?.[key];
  if (!fv || !unchangedKeys.includes(key)) return null;
  const urls = cards.map((c) => c.url.trim()).filter(Boolean);
  const failed = urls.filter((u) => fv.cells[u]?.status === 'fail').length;
  return { passed: urls.length - failed, checked: urls.length };
}

const STATE_WORD: Record<Segment, string> = {
  empty: 'nothing found',
  suggested: 'suggested',
  answered: 'accepted',
  failed: 'fails on this product',
};

/** The detail bar's state word for a cell (spec §2). */
export function stateWord(s: Segment): string {
  return STATE_WORD[s];
}

/** The Fix button reads Mark on an empty cell: there is nothing to fix yet, only something to point at. */
export function fixLabel(s: Segment): 'Fix' | 'Mark' {
  return s === 'empty' ? 'Mark' : 'Fix';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/table-selection.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -- packages/app/src/lib/site/table-selection.ts packages/app/src/lib/site/table-selection.test.ts
git commit -m "feat(app): pure helpers for the verification table's selection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/lib/site/table-selection.ts packages/app/src/lib/site/table-selection.test.ts
```

---

### Task 2: Crop geometry

**Files:**
- Create: `packages/app/src/lib/site/screenshot-crop-view.ts`
- Test: `packages/app/src/lib/site/screenshot-crop-view.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { x: number; y: number; w: number; h: number }`
  - `type CropFrame = { scale: number; left: number; top: number }` — `scale` for the tile stack, `left`/`top` the stack's CSS offsets inside the crop (≤ 0)
  - `cropFrame(box: Rect | null, crop: { w: number; h: number }, page: { w: number; h: number }): CropFrame`
  - `CROP_W = 240`, `CROP_H = 160`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/lib/site/screenshot-crop-view.test.ts
import { describe, expect, test } from 'vitest';
import { CROP_H, CROP_W, cropFrame } from './screenshot-crop-view';

const crop = { w: CROP_W, h: CROP_H };
const page = { w: 1280, h: 4000 };

describe('cropFrame', () => {
  test('a page with no measured width draws nothing', () => {
    expect(cropFrame({ x: 10, y: 10, w: 50, h: 20 }, crop, { w: 0, h: 0 })).toEqual({ scale: 0, left: 0, top: 0 });
  });

  test('no box: the top of the page, fitted to the crop width', () => {
    expect(cropFrame(null, crop, page)).toEqual({ scale: CROP_W / 1280, left: 0, top: 0 });
  });

  test('a small box in the middle of a long page is centred at scale 1', () => {
    const box = { x: 600, y: 2000, w: 100, h: 20 };
    const f = cropFrame(box, crop, page);
    expect(f.scale).toBe(1);
    // The box centre (650, 2010) lands on the crop centre (120, 80).
    expect(f.left).toBe(-(650 - CROP_W / 2));
    expect(f.top).toBe(-(2010 - CROP_H / 2));
  });

  test('the scale shrinks for a wide box and never below 0.25', () => {
    expect(cropFrame({ x: 100, y: 100, w: 432, h: 40 }, crop, page).scale).toBeCloseTo(CROP_W / 480, 6);
    expect(cropFrame({ x: 0, y: 100, w: 5000, h: 40 }, crop, page).scale).toBe(0.25);
  });

  test('a box at the top-left corner is clamped so the page edge meets the crop edge', () => {
    const f = cropFrame({ x: 5, y: 5, w: 40, h: 10 }, crop, page);
    expect(f.left).toBe(0);
    expect(f.top).toBe(0);
  });

  test('a box at the bottom-right corner is clamped so no blank space shows past the page', () => {
    const f = cropFrame({ x: 1230, y: 3980, w: 40, h: 10 }, crop, page);
    expect(f.scale).toBe(1);
    expect(f.left).toBe(CROP_W - 1280);
    expect(f.top).toBe(CROP_H - 4000);
  });

  test('a box below the captured height (page cut) clamps to the bottom of what was captured', () => {
    const f = cropFrame({ x: 600, y: 5000, w: 100, h: 20 }, crop, { w: 1280, h: 4000 });
    expect(f.top).toBe(CROP_H - 4000);
  });

  test('a page shorter than the crop is pinned to the top', () => {
    const f = cropFrame({ x: 600, y: 50, w: 100, h: 20 }, crop, { w: 1280, h: 100 });
    expect(f.top).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/screenshot-crop-view.test.ts`
Expected: FAIL — cannot resolve `./screenshot-crop-view`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/lib/site/screenshot-crop-view.ts
// Geometry for the detail bar's screenshot crop (spec 2026-10-07 §4): where
// to put the tile stack, at what scale, so the field's element sits in the
// middle of a fixed-size window without the window ever showing past the
// page's edges. Rects are page pixels, as the capture's box map gives them.

export type Rect = { x: number; y: number; w: number; h: number };
export type CropFrame = { scale: number; left: number; top: number };

export const CROP_W = 240;
export const CROP_H = 160;

/** Breathing room around the element when the scale is chosen to fit it. */
const PAD = 48;
const MIN_SCALE = 0.25;
const MAX_SCALE = 1;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function cropFrame(box: Rect | null, crop: { w: number; h: number }, page: { w: number; h: number }): CropFrame {
  if (page.w <= 0) return { scale: 0, left: 0, top: 0 };
  if (!box) return { scale: crop.w / page.w, left: 0, top: 0 };

  const scale = clamp(crop.w / (box.w + PAD), MIN_SCALE, MAX_SCALE);
  const cx = (box.x + box.w / 2) * scale;
  const cy = (box.y + box.h / 2) * scale;
  // Centre the element, then keep the window inside the scaled page: the
  // offset can go no further left/up than "right/bottom edge meets the
  // window's", and never past 0 (which would show blank space on the left/top).
  const minLeft = Math.min(0, crop.w - page.w * scale);
  const minTop = Math.min(0, crop.h - page.h * scale);
  return {
    scale,
    left: clamp(crop.w / 2 - cx, minLeft, 0),
    top: clamp(crop.h / 2 - cy, minTop, 0),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/screenshot-crop-view.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -- packages/app/src/lib/site/screenshot-crop-view.ts packages/app/src/lib/site/screenshot-crop-view.test.ts
git commit -m "feat(app): crop geometry for the detail bar's screenshot preview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/lib/site/screenshot-crop-view.ts packages/app/src/lib/site/screenshot-crop-view.test.ts
```

---

### Task 3: The context-menu primitive

**Files:**
- Create: `packages/app/src/components/ui/context-menu.tsx`

**Interfaces:**
- Consumes: `ContextMenu` from `radix-ui` (already a dependency; `dropdown-menu.tsx` imports `DropdownMenu` from the same package).
- Produces: `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator` — the same shadcn shapes as `dropdown-menu.tsx`, with `data-slot="context-menu-*"`.

No unit test (presentational, node env); `pnpm --filter @robot/app typecheck` is the gate.

- [ ] **Step 1: Write the component**

```tsx
// packages/app/src/components/ui/context-menu.tsx
"use client"

import * as React from "react"
import { cn } from "../../lib/utils"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

// The dropdown menu's twin for a right-click (spec 2026-10-07 §3). Same
// classes as dropdown-menu.tsx so the two menus look identical; only the
// primitive differs. Generated shapes kept; `shadow-xs` dropped as everywhere.

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-line-hover bg-popover p-1 text-popover-foreground [box-shadow:var(--shadow)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { inset?: boolean; variant?: "default" | "destructive" }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @robot/app typecheck`
Expected: no errors. If `ContextMenu` is not exported from `radix-ui`, check `node_modules/radix-ui/dist/index.d.ts` for the export name; the umbrella package re-exports every primitive under its PascalCase name.

- [ ] **Step 3: Commit**

```bash
git add -- packages/app/src/components/ui/context-menu.tsx
git commit -m "feat(app): context-menu primitive over Radix, shadcn style

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/ui/context-menu.tsx
```

---

### Task 4: The screenshot crop component

**Files:**
- Create: `packages/app/src/components/verification/screenshot-crop.tsx`

**Interfaces:**
- Consumes: `cropFrame`, `CROP_W`, `CROP_H`, `Rect` from `../../lib/site/screenshot-crop-view`; `Segment` from `../../lib/site/verification-model`.
- Produces:
  ```ts
  export function ScreenshotCrop(props: {
    tiles: string[];            // already-resolved URLs (the route calls tileHref)
    capturedHeight: number;     // page px the tiles cover
    status: 'pending' | 'failed' | 'ready';
    error?: string;
    box: Rect | null;           // the field's element on this product, if any
    tone: Segment;              // outline colour
    fieldName: string;
    disabled: boolean;          // locked: still shows, but does not open
    onOpen: () => void;         // Fix (spec §4: clicking the crop enters fix mode)
  }): JSX.Element
  ```

- [ ] **Step 1: Write the component**

```tsx
// packages/app/src/components/verification/screenshot-crop.tsx
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import { CROP_H, CROP_W, cropFrame, type Rect } from '../../lib/site/screenshot-crop-view';
import type { Segment } from '../../lib/site/verification-model';

const TONE_OUTLINE: Record<Segment, string> = {
  empty: 'outline-text',
  suggested: 'outline-warn',
  answered: 'outline-pass',
  failed: 'outline-fail',
};

/**
 * The detail bar's read-only crop of a product's screenshot around the
 * selected field's element (spec 2026-10-07 §4). A fixed 240×160 window over
 * the capture's tile stack, placed by `cropFrame`; the element outlined in
 * the cell's state colour. Clicking it is Fix — the only thing it does.
 * Presentational: tiles are resolved URLs, the box is resolved by the route.
 *
 * The page width is the first tile's natural width, measured the way
 * `PageViewer` measures it (a cached, already-complete image never fires
 * `onLoad`, so a ref callback catches that case).
 */
export function ScreenshotCrop({
  tiles,
  capturedHeight,
  status,
  error,
  box,
  tone,
  fieldName,
  disabled,
  onOpen,
}: {
  tiles: string[];
  capturedHeight: number;
  status: 'pending' | 'failed' | 'ready';
  error?: string;
  box: Rect | null;
  tone: Segment;
  fieldName: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const [pageWidth, setPageWidth] = useState(0);

  useEffect(() => {
    setPageWidth(0);
  }, [tiles]);

  const firstTileRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) setPageWidth(img.naturalWidth);
  }, []);

  const frame = cropFrame(box, { w: CROP_W, h: CROP_H }, { w: pageWidth, h: capturedHeight });
  const stackStyle: CSSProperties = { left: frame.left, top: frame.top, width: pageWidth * frame.scale };
  const boxStyle = (r: Rect): CSSProperties => ({ left: r.x * frame.scale, top: r.y * frame.scale, width: r.w * frame.scale, height: r.h * frame.scale });

  const shell = 'relative shrink-0 overflow-hidden rounded-[6px] border border-line bg-raised';
  const size: CSSProperties = { width: CROP_W, height: CROP_H };

  if (status === 'pending') {
    return (
      <div className={cn(shell, 'flex items-center justify-center')} style={size}>
        <span className="text-sm text-muted-foreground">Taking screenshot…</span>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className={cn(shell, 'flex items-center justify-center px-3 text-center')} style={size}>
        <span className="text-sm text-warn">{error ?? 'The screenshot could not be taken'}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Open the screenshot to fix ${fieldName}`}
      title={disabled ? undefined : `Open the screenshot to fix ${fieldName}`}
      onClick={onOpen}
      className={cn(shell, 'block cursor-pointer text-left disabled:cursor-not-allowed')}
      style={size}
    >
      <div className="absolute" style={stackStyle}>
        {tiles.map((src, i) => (
          <img
            key={i}
            ref={i === 0 ? firstTileRef : undefined}
            src={src}
            alt={i === 0 ? `Screenshot around ${fieldName}` : ''}
            draggable={false}
            className="block w-full select-none"
            onLoad={i === 0 ? (e) => setPageWidth(e.currentTarget.naturalWidth) : undefined}
          />
        ))}
        {box && frame.scale > 0 ? <div className={cn('pointer-events-none absolute outline-2', TONE_OUTLINE[tone])} style={boxStyle(box)} /> : null}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @robot/app typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -- packages/app/src/components/verification/screenshot-crop.tsx
git commit -m "feat(app): read-only screenshot crop for the detail bar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/verification/screenshot-crop.tsx
```

---

### Task 5: The detail bar

**Files:**
- Create: `packages/app/src/components/verification/cell-detail-bar.tsx`

**Interfaces:**
- Consumes: `Button` from `../ui/button`; `stateWord`, `fixLabel` from `../../lib/site/table-selection`; `Segment` from `../../lib/site/verification-model`.
- Produces:
  ```ts
  export type DetailBarSelection = {
    fieldName: string;
    productLabel: string;   // the card's title or short URL, resolved by the route
    productNumber: number;  // 1-based
    value: string;          // the cell's display value ('' when none)
    state: Segment;
    onCopy: () => void | Promise<void>;
    onFix: () => void;
    onTypeIt: () => void;
    preview: ReactNode | null; // a <ScreenshotCrop> while the panel is closed; null while it is open
  };
  export function CellDetailBar(props: { selection: DetailBarSelection | null; locked: boolean }): JSX.Element
  ```

- [ ] **Step 1: Write the component**

```tsx
// packages/app/src/components/verification/cell-detail-bar.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { fixLabel, stateWord } from '../../lib/site/table-selection';
import type { Segment } from '../../lib/site/verification-model';

export type DetailBarSelection = {
  fieldName: string;
  productLabel: string;
  productNumber: number;
  value: string;
  state: Segment;
  onCopy: () => void | Promise<void>;
  onFix: () => void;
  onTypeIt: () => void;
  preview: ReactNode | null;
};

const STATE_TEXT: Record<Segment, string> = {
  empty: 'text-muted-foreground',
  suggested: 'text-warn',
  answered: 'text-text',
  failed: 'text-fail',
};

/**
 * The line above the Verification table that says what the selected cell
 * holds (spec 2026-10-07 §2): field, product, state word, the full value in
 * mono (wrapping, scrolling past ~6 lines), Copy / Fix / Type it, and the
 * screenshot crop while the panel is closed. Stable height, so selecting a
 * cell never moves the table. Presentational — the route resolves everything.
 */
export function CellDetailBar({ selection, locked }: { selection: DetailBarSelection | null; locked: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // A new cell forgets the last "Copied".
  useEffect(() => {
    setCopied(false);
  }, [selection?.fieldName, selection?.productNumber]);

  const shell = 'min-h-[76px] rounded-[6px] border border-line bg-panel px-3 py-2';

  if (!selection) {
    return (
      <div className={`${shell} flex items-center`} aria-label="Selected cell">
        <p className="text-sm text-muted-foreground">Select a cell to see its full value.</p>
      </div>
    );
  }

  const s = selection;
  const empty = s.value.trim() === '';
  const label = fixLabel(s.state);

  async function copy() {
    await s.onCopy();
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section aria-label="Selected cell" className={`${shell} flex flex-wrap items-start gap-3 sm:flex-nowrap`}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-base">
            {s.fieldName} · {s.productLabel} <span className="text-muted-foreground">(product {s.productNumber})</span>
          </span>
          <span className={`text-sm ${STATE_TEXT[s.state]}`}>{stateWord(s.state)}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="xs" disabled={empty} aria-label={`Copy ${s.fieldName} on product ${s.productNumber}`} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="outline" size="xs" disabled={locked} aria-label={`${label} ${s.fieldName} on the screenshot`} onClick={s.onFix}>
              {label}
            </Button>
            <Button variant="ghost" size="xs" disabled={locked} aria-label={`Type ${s.fieldName} on product ${s.productNumber}`} onClick={s.onTypeIt}>
              Type it
            </Button>
          </div>
        </div>
        <div className="max-h-[8.5rem] overflow-auto font-mono text-base break-words whitespace-pre-wrap" data-testid="selected-value">
          {empty ? <span className="text-muted-foreground">—</span> : s.value}
        </div>
      </div>
      {s.preview ? <div className="hidden sm:block">{s.preview}</div> : null}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @robot/app typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -- packages/app/src/components/verification/cell-detail-bar.tsx
git commit -m "feat(app): the detail bar above the verification table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/verification/cell-detail-bar.tsx
```

---

### Task 6: Focus the Type input on request

**Files:**
- Modify: `packages/app/src/components/verification/field-details.tsx` (the `FieldDetails` props and the `<Input>` at the "Type it" block)

**Interfaces:**
- Produces: `FieldDetails` gains `focusTyped?: number` — a counter; each new non-zero value focuses the Type input (and selects its text).

- [ ] **Step 1: Add the prop and the effect**

In `field-details.tsx`:

1. Change the first import line to `import { useEffect, useRef } from 'react';` (add it above the `lucide-react` import).
2. In `FieldDetails`' destructured props add `focusTyped = 0,` after `onDescription,`, and in the type add:
   ```ts
   /** Bumped by the caller when "Type it" is chosen for this field (spec 2026-10-07 §2); each new value focuses the input. */
   focusTyped?: number;
   ```
3. Inside the component, before `const saved = …`, add:
   ```tsx
   const typedRef = useRef<HTMLInputElement>(null);
   useEffect(() => {
     if (focusTyped > 0) {
       typedRef.current?.focus();
       typedRef.current?.select();
     }
   }, [focusTyped]);
   ```
4. On the Type input add `ref={typedRef}` (first attribute after `<Input`). React 19 passes `ref` through `React.ComponentProps<'input'>`, which `Input` spreads onto the element.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @robot/app typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(app): FieldDetails focuses its Type input on request

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/verification/field-details.tsx
```

---

### Task 7: The table — selection, Fix, context menu, keyboard, header count

**Files:**
- Modify: `packages/app/src/components/verification/verification-table.tsx`

**Interfaces:**
- Consumes: `CellSelection`, `MoveKey`, `moveSelection`, `fixLabel` from `../../lib/site/table-selection`; the context-menu primitives from `../ui/context-menu`.
- Produces (the new `VerificationTable` contract; Task 8 wires it):
  ```ts
  export type TableCell = { value: string; state: Segment; url: string; onAccept?: () => void };
  export type TableRow = {
    field: Field; cells: TableCell[]; status: RowStatus; badge: Badge;
    /** "n/m" after the badge, from `headerCount`; null hides it. */
    count: { passed: number; checked: number } | null;
    expanded: boolean; details: Omit<Parameters<typeof FieldDetails>[0], 'field' | 'locked'>;
    onAccept: () => void; onToggle: () => void; drift?: DriftLine[];
  };
  export function VerificationTable(props: {
    heads: ReactNode[]; addHead?: ReactNode; rows: TableRow[]; locked: boolean; variants?: VariantsRowProps | null;
    selection: CellSelection | null;
    /** False while a popover or the variants mark mode owns the keyboard. */
    keyboard: boolean;
    onSelect: (sel: CellSelection) => void;
    onFix: (sel: CellSelection) => void;
    onCopy: (sel: CellSelection) => void;
    onTypeIt: (key: string) => void;
    onEscape: () => void;
  }): JSX.Element
  ```
  `TableCell.onClick` and `TableCell.selected` are **removed**; `selected` is derived from `selection`.

- [ ] **Step 1: Change the imports and types**

Replace the first ten lines of the file (through the `cellLabel` import) with:

```tsx
import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../ui/context-menu';
import { cn } from '../../lib/utils';
import { TYPE_LABELS } from '../../lib/fields-view';
import { BadgeView, FieldDetails } from './field-details';
import { LOCKED_REASON } from './verify-bar';
import { VariantsRow, type VariantsRowProps } from './variants-row';
import { cellLabel, type Badge, type Field, type RowStatus, type Segment } from '../../lib/site/verification-model';
import { fixLabel, moveSelection, type CellSelection, type MoveKey } from '../../lib/site/table-selection';
```

Replace the `TableCell` type and its comment with:

```tsx
/**
 * One cell: its display value, state, the product's URL (for "Open product
 * page"), and — only for a suggestion found in one place — the one-click
 * accept a tick would do (spec 2026-09-29 A7). Clicking the cell selects it
 * (spec 2026-10-07 §1); the table reports that through `onSelect`.
 */
export type TableCell = { value: string; state: Segment; url: string; onAccept?: () => void };
```

In `TableRow`, after `badge: Badge;` add:

```tsx
  /** "n/m" shown after a Verify badge (spec 2026-10-07 §2, `headerCount`); null hides it. */
  count: { passed: number; checked: number } | null;
```

- [ ] **Step 2: Show the count beside the badge**

In `StatusCell`, change the signature to take `count` and show it in the `accepted` case:

```tsx
function StatusCell({ field, status, badge, count, locked, onAccept }: { field: Field; status: RowStatus; badge: Badge; count: { passed: number; checked: number } | null; locked: boolean; onAccept: () => void }) {
```

and replace `case 'accepted': return <BadgeView badge={badge} />;` with:

```tsx
    case 'accepted':
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <BadgeView badge={badge} />
          {count && badge && (badge.kind === 'verified' || badge.kind === 'fails') ? (
            <span className="text-sm text-muted-foreground" aria-label={`${count.passed} of ${count.checked} products`}>
              {count.passed}/{count.checked}
            </span>
          ) : null}
        </span>
      );
```

- [ ] **Step 3: Rewrite `VerificationTable`'s props and add the keyboard handler**

Replace the component's signature block (from `export function VerificationTable({` through `const totalCols = …;`) with:

```tsx
const MOVE_KEYS: ReadonlySet<string> = new Set<MoveKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

function inTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function VerificationTable({
  heads,
  addHead,
  rows,
  locked,
  variants,
  selection,
  keyboard,
  onSelect,
  onFix,
  onCopy,
  onTypeIt,
  onEscape,
}: {
  /** One per product column, rendered by the route (`ProductCard` compact, or a blank slot). */
  heads: ReactNode[];
  /** `AddProductCard` compact, while there are fewer than six products. */
  addHead?: ReactNode;
  rows: TableRow[];
  locked: boolean;
  /**
   * The Variants row (spec 2026-10-01 §4.1), after the fields: drawn only
   * while this website needs variant certification — a need other than
   * `none` and a method of `list` or `links`. Never in `ignore` mode.
   */
  variants?: VariantsRowProps | null;
  /** The selected cell (spec 2026-10-07 §1), owned by the route. */
  selection: CellSelection | null;
  /** False while the mark popover or the variants mark mode owns the keyboard. */
  keyboard: boolean;
  onSelect: (sel: CellSelection) => void;
  /** Fix / Mark: open the screenshot on this cell (spec §4). */
  onFix: (sel: CellSelection) => void;
  onCopy: (sel: CellSelection) => void;
  onTypeIt: (key: string) => void;
  /** Escape with nothing else to close: the route clears the selection or closes the panel. */
  onEscape: () => void;
}) {
  const totalCols = 1 + heads.length + (addHead ? 1 : 0) + 1;
  const fieldKeys = rows.map((r) => r.field.key);
  const products = heads.length;

  // Roving tabindex: after a key moved the selection, focus follows it — but
  // only then. A click already focused its own cell, and a selection made by
  // the route (Fix from the bar, a reload) must not steal focus from an input.
  const wrapRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!focusNext.current || !selection) return;
    focusNext.current = false;
    wrapRef.current?.querySelector<HTMLButtonElement>(`button[data-cell="${selection.product}:${selection.key}"]`)?.focus();
  }, [selection]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!keyboard || e.defaultPrevented || inTextField(e.target)) return;
    // Only keys aimed at a cell: the status column's buttons keep their own Enter.
    const onCell = (e.target as HTMLElement | null)?.closest?.('button[data-cell]');
    if (e.key === 'Escape') {
      if (!onCell) return;
      e.preventDefault();
      onEscape();
      return;
    }
    if (!selection || !onCell) return;
    if (MOVE_KEYS.has(e.key)) {
      e.preventDefault();
      focusNext.current = true;
      onSelect(moveSelection(selection, e.key as MoveKey, fieldKeys, products));
      return;
    }
    if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
      if (locked) return;
      e.preventDefault();
      onFix(selection);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      // A dragged text selection inside the cell keeps native copy (Review Focus 4).
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      onCopy(selection);
    }
  }
```

Then change the outer `<div className="overflow-x-auto …">` to:

```tsx
    <div ref={wrapRef} onKeyDown={onKeyDown} className="overflow-x-auto rounded-[6px] border border-line bg-panel">
```

- [ ] **Step 4: Rewrite the cell**

Replace the whole `{row.cells.map((cell, i) => ( <td …> … </td> ))}` block with:

```tsx
                {row.cells.map((cell, i) => {
                  const sel: CellSelection = { product: i, key: row.field.key };
                  const isSelected = selection?.product === i && selection.key === row.field.key;
                  // Tab enters the table once: at the selected cell, else the first cell.
                  const tabbable = isSelected || (!selection && fi === 0 && i === 0);
                  const label = fixLabel(cell.state);
                  const value = cell.value.trim();
                  return (
                    <td key={i} className="group relative w-[190px] border-t border-line p-0 align-top">
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            data-cell={`${i}:${row.field.key}`}
                            data-selected={isSelected ? 'true' : undefined}
                            tabIndex={tabbable ? 0 : -1}
                            aria-label={cellLabel(row.field.name, i + 1, cell.state, cell.value)}
                            onClick={() => onSelect(sel)}
                            onContextMenu={() => onSelect(sel)}
                            className={cn(
                              'flex h-full w-full items-center border-l-2 px-2 py-2 text-left',
                              CELL_BORDER[cell.state],
                              isSelected && 'outline outline-1 outline-text',
                              cell.onAccept ? 'pr-14' : 'pr-9',
                            )}
                          >
                            <span className="min-w-0 truncate font-mono text-base" title={cell.value || undefined}>
                              {cell.value || '—'}
                            </span>
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem disabled={!value} onSelect={() => onCopy(sel)}>
                            Copy value
                          </ContextMenuItem>
                          <ContextMenuItem disabled={!cell.url.trim()} onSelect={() => window.open(cell.url, '_blank', 'noopener,noreferrer')}>
                            Open product page
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem disabled={locked} onSelect={() => onFix(sel)}>
                            {label} on screenshot
                          </ContextMenuItem>
                          <ContextMenuItem disabled={locked} onSelect={() => onTypeIt(row.field.key)}>
                            Type it
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>

                      {/* Fix / Mark (spec 2026-10-07 §2): on hover and on the selected cell; always on a red cell. */}
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={locked}
                        aria-label={`${label} ${row.field.name} on product ${i + 1} on the screenshot`}
                        title={locked ? LOCKED_REASON : `${label} on the screenshot`}
                        onClick={() => onFix(sel)}
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 bg-panel text-muted-foreground hover:text-text focus-visible:opacity-100',
                          cell.onAccept ? 'right-8' : 'right-1',
                          cell.state === 'failed' || isSelected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                        )}
                      >
                        {label}
                      </Button>
                      {cell.onAccept ? (
                        <Button
                          variant="outline"
                          size="icon-xs"
                          disabled={locked}
                          aria-label={`Accept ${row.field.name} on product ${i + 1}`}
                          title={`Accept ${row.field.name} on product ${i + 1}`}
                          onClick={cell.onAccept}
                          className="absolute top-1/2 right-1 -translate-y-1/2 bg-panel opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Check aria-hidden className="size-3" />
                        </Button>
                      ) : null}
                    </td>
                  );
                })}
```

Note the cell button is **no longer `disabled={locked}`**: selecting and copying work during a Verify (spec §2); only Fix, Type it and Accept are locked. The `rows.map((row) => (` callback needs the row index: change it to `rows.map((row, fi) => (`.

Pass the count to the status cell:

```tsx
                  <StatusCell field={row.field} status={row.status} badge={row.badge} count={row.count} locked={locked} onAccept={row.onAccept} />
```

- [ ] **Step 5: Typecheck (expect the route to break)**

Run: `pnpm --filter @robot/app typecheck`
Expected: errors **only** in `routes/_app/projects/$project/sites/$site/index.tsx` (missing `count`, `url`, the removed `onClick`/`selected`, the new required props). Task 8 fixes them. No error inside `verification-table.tsx` itself.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(app): verification table selects, fixes explicitly, right-clicks and takes the keyboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/verification/verification-table.tsx
```

---

### Task 8: Wire the route

**Files:**
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` — imports (lines 1–70), state (~line 221), `rowHint` (~983), the `rows` mapping (~1095), the table render (~1245), and a new detail-bar block above the table.

**Interfaces:**
- Consumes everything Tasks 1, 2, 4, 5, 6, 7 produce.
- Produces nothing new; the route is the leaf.

- [ ] **Step 1: Imports**

Add after the `VerificationTable` import:

```tsx
import { CellDetailBar, type DetailBarSelection } from '../../../../../../components/verification/cell-detail-bar';
import { ScreenshotCrop } from '../../../../../../components/verification/screenshot-crop';
import { clampSelection, headerCount, type CellSelection } from '../../../../../../lib/site/table-selection';
```

Add `boxOfMark` to the list imported from `verification-model` **only if it is not already imported** — the route calls `boxOfMark(boxes, a.mark)` today, so check where it comes from (`grep -n "boxOfMark" index.tsx`) and leave that import as it is.

- [ ] **Step 2: State**

After `const [expanded, setExpanded] = useState<Record<string, boolean>>({});` add:

```tsx
  /** The selected cell (spec 2026-10-07 §1) — route state, not the address; the address keeps meaning "screenshot open". */
  const [rawSelection, setRawSelection] = useState<CellSelection | null>(null);
  /** "Type it" for a field: bumps a counter the row's details use to focus its input. */
  const [typeFocus, setTypeFocus] = useState<{ key: string; n: number }>({ key: '', n: 0 });
```

- [ ] **Step 3: Resolve the selection and the product the details follow**

Directly after the `// --- Selection.` block (after `const fieldKey = …;`), add:

```tsx
  // A field deleted on the Fields page or a dropped product takes its selection with it (Review Focus 2).
  const selection = clampSelection(rawSelection, fields.map((f) => f.key), board.cards.length);
  /** The product the expanded row's details ("Type it", the hint) are about: the selected cell's, else the open screenshot's (spec §1). */
  const detailIndex = selection ? selection.product : selected;
  const detailUrl = board.cards[detailIndex]?.url ?? '';
```

- [ ] **Step 4: `rowHint` follows the selected cell**

In `rowHint(f)`, replace every `selectedUrl` with `detailUrl`, and the two uses of the open panel's `boxes` with the boxes for that product. The function becomes:

```tsx
  function rowHint(f: Field): FieldHint | undefined {
    // A failed cell says why on its row, "Mark it on the screenshot" included (spec C2's no_fitting_path).
    if (detailUrl && failedCell(f.key, detailUrl)) {
      const hint = cellStatusFor(results, f.key, detailUrl, false, f.type, f.name)?.hint;
      if (hint) return { text: hint };
    }
    const s = detailUrl ? live[f.key]?.[detailUrl] : undefined;
    if (!s) return undefined;
    const url = detailUrl;
    const urlBoxes = boxesByUrl[url] ?? NO_BOXES;
    // Only elements big enough to click count: a suggestion on nothing but a
    // 1×1 anchor is offered here, like a value no element shows. Counted as the
    // row's status counts them (A5): one structured value in several elements is one place.
    const places = placesOf(urlBoxes, s, f, url);
    if (places === 0) {
      return {
        text: s.origin === 'page-data' ? 'page data' : 'from another product',
        value: displayValue(f, s.value),
        onAccept: () => {
          const given = suggestionAnswer(urlBoxes, f, s, url);
          setBoard((b) => answer(b, f.key, url, given));
          select({ field: f.key });
          carry(f.key, url, given);
        },
        onReject: () => rejectSuggestion(f.key, url),
      };
    }
    if (places > 1) {
      return { text: `found in ${places} places — click the right one`, onReject: () => rejectSuggestion(f.key, url) };
    }
    return undefined;
  }
```

Check `boxesByUrl`'s type where it is defined (`grep -n "boxesByUrl" index.tsx`): it is the `Record<string, Box[]>` that `rowStatus`/`acceptRow` already take. If its values can be `undefined` for a product whose capture has not landed, the `?? NO_BOXES` covers it.

- [ ] **Step 5: The cell actions**

Before `const rows: TableRow[] = …` add:

```tsx
  /** What a cell shows: the answer, else the live suggestion, displayed for the field's type. */
  function cellValue(f: Field, url: string): string {
    return displayValue(f, board.answers[f.key]?.[url]?.value ?? live[f.key]?.[url]?.value ?? '');
  }

  /** Fix / Mark (spec 2026-10-07 §4): exactly what a cell click did before — open the screenshot on this cell. */
  function fixCell(sel: CellSelection) {
    const f = fields.find((x) => x.key === sel.key);
    if (!f || !board.cards[sel.product]) return;
    setPopover(null);
    setRawSelection(sel);
    select({ product: sel.product + 1, field: f.key });
    setReveal((r) => ({ n: r.n + 1, product: sel.product + 1, field: f.key }));
  }

  function copyCell(sel: CellSelection) {
    const f = fields.find((x) => x.key === sel.key);
    const url = board.cards[sel.product]?.url;
    if (!f || !url) return Promise.resolve();
    const v = cellValue(f, url);
    if (!v.trim()) return Promise.resolve();
    return navigator.clipboard.writeText(v).catch(() => undefined);
  }

  function typeIt(key: string) {
    setExpanded((e) => ({ ...e, [key]: true }));
    setTypeFocus((t) => ({ key, n: t.n + 1 }));
  }

  /** The field's element on a product, for the crop: its answer's mark, else its suggestion's first clickable place. */
  function elementFor(key: string, url: string): Box['rect'] | null {
    const urlBoxes = boxesByUrl[url] ?? NO_BOXES;
    const a = board.answers[key]?.[url];
    if (a) {
      const i = boxOfMark(urlBoxes, a.mark);
      return i === null ? null : (urlBoxes[i]?.rect ?? null);
    }
    const s = live[key]?.[url];
    if (!s) return null;
    const i = pointable(urlBoxes, s.boxes)[0];
    return i === undefined ? null : (urlBoxes[i]?.rect ?? null);
  }
```

- [ ] **Step 6: The rows**

In the `rows` mapping:

- Replace `const a = selectedUrl ? board.answers[f.key]?.[selectedUrl] : undefined;` with `const a = detailUrl ? board.answers[f.key]?.[detailUrl] : undefined;`.
- Replace the whole `cells: board.cards.map((c, i) => ({ … }))` with:
  ```tsx
      cells: board.cards.map((c) => ({
        value: cellValue(f, c.url),
        state: segment(board, live, f.key, c.url, { failed: c.url !== '' && failedCell(f.key, c.url) }),
        url: c.url,
        onAccept: c.url.trim() ? cellAccept(f, c.url) : undefined,
      })),
  ```
- After `badge: badge({ … }),` add:
  ```tsx
      count: headerCount(results, f.key, unchangedKeys, board.cards),
  ```
- In `details`, replace `productNumber: selected + 1,` with `productNumber: detailIndex + 1,`, and the `onType` body's `selectedUrl` with `detailUrl`:
  ```tsx
        onType: (text: string) => {
          if (!detailUrl) return;
          setBoard((b) => answer(b, f.key, detailUrl, text.trim() ? { value: text, mark: null } : null));
        },
  ```
  and add `focusTyped: typeFocus.key === f.key ? typeFocus.n : 0,` inside `details`.

If `results` is typed as `VerificationResults | null | undefined` and `headerCount` complains, pass `results as ResultsLike | null` — `ResultsLike` is exported from `table-selection.ts` and `FieldVerification.cells` satisfies it structurally (`CellResult.status` is a string literal union).

- [ ] **Step 7: The detail bar**

Before `const heads = board.cards.map(…)` add:

```tsx
  // --- The detail bar (spec 2026-10-07 §2, §4).
  const detailField = selection ? fields.find((f) => f.key === selection.key) : undefined;
  const detailCard = selection ? board.cards[selection.product] : undefined;
  const detailCapture = detailCard?.url ? captures.byUrl[detailCard.url] : undefined;
  const detailRawTiles = detailCapture?.tiles;
  const detailTiles = useMemo(() => (detailRawTiles ?? NO_TILES).map((t) => tileHref(t)).filter((t): t is string => !!t), [detailRawTiles]);
  const detailBar: DetailBarSelection | null =
    selection && detailField && detailCard
      ? (() => {
          const url = detailCard.url;
          const state = segment(board, live, detailField.key, url, { failed: url !== '' && failedCell(detailField.key, url) });
          const status = !url || !detailCapture || detailCapture.status === 'starting' || detailCapture.status === 'capturing' ? 'pending' : detailCapture.status === 'failed' ? 'failed' : 'ready';
          return {
            fieldName: detailField.name,
            productLabel: detailCard.title || (url ? shortUrl(url) : `Product ${selection.product + 1}`),
            productNumber: selection.product + 1,
            value: url ? cellValue(detailField, url) : '',
            state,
            onCopy: () => copyCell(selection),
            onFix: () => fixCell(selection),
            onTypeIt: () => typeIt(detailField.key),
            preview: panelOpen ? null : (
              <ScreenshotCrop
                tiles={detailTiles}
                capturedHeight={detailCapture?.capturedHeight ?? 0}
                status={status}
                error={detailCapture?.status === 'failed' ? detailCapture.error : undefined}
                box={url ? elementFor(detailField.key, url) : null}
                tone={state}
                fieldName={detailField.name}
                disabled={locked}
                onOpen={() => fixCell(selection)}
              />
            ),
          };
        })()
      : null;
```

`useMemo` must not be inside a conditional: `detailTiles` above is at the component's top level, fine. If the hooks-order lint complains about its position, move the `useMemo` line up next to the other `useMemo`s (it only depends on `detailRawTiles`).

- [ ] **Step 8: Render**

Inside `{board.cards.length > 0 ? ( <div className="space-y-2"> …`, put the bar first and pass the new props:

```tsx
        <div className="space-y-2">
          <CellDetailBar selection={detailBar} locked={locked} />
          <VerificationTable
            heads={heads}
            addHead={
              board.cards.length < PRODUCTS_MAX ? (
                <AddProductCard compact disabled={locked} canAddFromQueue={queue.length > 0} onAdd={onAdd} hostProblem={hostProblem} />
              ) : undefined
            }
            rows={rows}
            locked={locked}
            variants={variantsRow}
            selection={selection}
            keyboard={!popover && !variantMark}
            onSelect={setRawSelection}
            onFix={fixCell}
            onCopy={(sel) => void copyCell(sel)}
            onTypeIt={typeIt}
            onEscape={() => {
              if (panelOpen) closePanel();
              else setRawSelection(null);
            }}
          />
```

- [ ] **Step 9: Typecheck and unit tests**

Run: `pnpm --filter @robot/app typecheck && pnpm --filter @robot/app test -- --run`
Expected: no type errors; all unit tests pass (the route has none; the lib tests from Tasks 1–2 and the existing ones).

- [ ] **Step 10: Look at it once in a real browser**

With `pnpm dev:all` running (or the isolated pair: keyless api-server on :4100 and the app on :3100 with `VITE_API_URL=http://localhost:4100`, as `docs/handoff.md`'s free-live-checks note describes), open a website that has captured proof pages (any existing one in Marko's org; **do not** create users or orgs, see the dev-DB incident in the handoff). Check, without clicking Verify:

- a cell click outlines the cell and fills the bar; no screenshot opens; the address has no `?product`;
- the bar's crop shows the element outlined; clicking the crop opens the screenshot on it;
- arrow keys move the outline; Enter opens the screenshot; Escape closes it, a second Escape clears the selection;
- right-click shows the four items; Copy value then paste somewhere gives the value;
- Type it expands the row with the Type input focused;
- a column head still opens the screenshot.

Fix anything wrong before committing.

- [ ] **Step 11: Commit**

```bash
git commit -m "feat(app): the Verification tab selects cells, shows them in a detail bar and fixes explicitly

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
```

---

### Task 9: The route smoke follows the new gestures

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts` — the test `'the Verification table accepts what agrees and opens the screenshot for what needs you'` (step 5 and the re-open after the two Escapes), plus a new block after step 4.

**Interfaces:**
- Consumes the labels Tasks 5 and 7 render: cell `data-selected="true"`; the bar `section[aria-label="Selected cell"]` with `[data-testid="selected-value"]`; cell Fix button `Mark Rating on product 1 on the screenshot`; menu items `Copy value`, `Open product page`, `Mark on screenshot`, `Type it`.

- [ ] **Step 1: Insert the selection steps after step 4 (before the `// 5.` comment)**

```ts
    // 4b. Spreadsheet behaviour (spec 2026-10-07). A click on a cell selects
    // it and nothing else: the bar above the table shows the value, no
    // screenshot opens, and the address stays clean.
    const bar = page.getByRole('region', { name: 'Selected cell' });
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain('Select a cell to see its full value.');
    await page.getByRole('button', { name: `Title on product 1: accepted, ${PRODUCTS[0].title}`, exact: true }).click();
    await expect.poll(() => bar.locator('[data-testid="selected-value"]').innerText(), { timeout: 5_000 }).toBe(PRODUCTS[0].title);
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain(`Title · ${PRODUCTS[0].title} (product 1)`);
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain('accepted');
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'a cell click opened the screenshot').toBe(0);
    expect(new URL(page.url()).searchParams.get('product'), 'a cell click put the product in the address').toBeNull();
    const selectedLabel = () => page.locator('button[data-cell][data-selected="true"]').getAttribute('aria-label');
    expect(await selectedLabel()).toMatch(/^Title on product 1: /);
    // The crop of the screenshot around the element is in the bar, read-only.
    expect(await bar.getByRole('button', { name: 'Open the screenshot to fix Title' }).count(), 'the bar has no screenshot crop').toBe(1);
    await shootBothThemes(page, 'selected');

    // Arrow keys move the selection; Home/End jump; nothing opens.
    await page.locator('button[data-cell][data-selected="true"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Title on product 2: /);
    await page.keyboard.press('ArrowDown');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 2: /);
    await page.keyboard.press('End');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 3: /);
    await page.keyboard.press('ArrowRight'); // clamps: there is an add column after product 3, and it is not a cell
    expect(await selectedLabel()).toMatch(/^Price on product 3: /);
    await page.keyboard.press('Home');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 1: /);
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'a key opened the screenshot').toBe(0);

    // Ctrl+C copies the selected cell; the context menu's Copy value does the same.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
    await page.keyboard.press('Control+C');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 }).toBe(PRODUCTS[0].price);
    await page.locator('button[data-cell][data-selected="true"]').click({ button: 'right' });
    const menu = page.getByRole('menu');
    await menu.waitFor({ timeout: 5_000 });
    expect((await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim())).toEqual(['Copy value', 'Open product page', 'Fix on screenshot', 'Type it']);
    await page.keyboard.press('Escape');
    await expect.poll(() => menu.count(), { timeout: 5_000 }).toBe(0);

    // Type it expands the row and focuses its Type input for the selected product.
    await page.locator('button[data-cell][data-selected="true"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Type it' }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), { timeout: 5_000 }).toBe('Price on product 1');
    await page.keyboard.press('Escape'); // leaves the input alone (Escape is ignored in a text field)
    await page.getByRole('button', { name: /^Price/, expanded: true }).click(); // collapse the row again

    // Escape on a cell with the screenshot closed clears the selection.
    await page.locator('button[data-cell][data-selected="true"]').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('button[data-cell][data-selected="true"]').count(), { timeout: 5_000 }).toBe(0);
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain('Select a cell to see its full value.');
```

`PRODUCTS[0].price` must be the display value the Price cell shows; check the `PRODUCTS` fixture at the top of the file and, if the cell shows a normalised form, compare against `cellState`'s sibling: read the cell's `aria-label` value part instead (`(await page.locator('button[aria-label^="Price on product 1: "]').getAttribute('aria-label'))!.split(', ').slice(1).join(', ')`).

- [ ] **Step 2: Step 5 opens the screenshot through Enter, not a click**

Replace the first line of step 5,

```ts
    await page.getByRole('button', { name: 'Rating on product 1: empty', exact: true }).click();
```

with:

```ts
    // The row that needs you: a click selects its cell; Enter is what opens
    // product 1's screenshot (spec 2026-10-07 §4), with the product named over
    // it and the cell outlined as the one on screen.
    await page.getByRole('button', { name: 'Rating on product 1: empty', exact: true }).click();
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'selecting the empty Rating cell opened the screenshot').toBe(0);
    await page.keyboard.press('Enter');
```

- [ ] **Step 3: While the popover is open the keyboard belongs to it (Review Focus 5)**

Right after the first `await popover.waitFor({ timeout: 10_000 });` and its `expect(... toContain(PRODUCTS[0].rating))`, add:

```ts
    // The mark popover owns the keyboard: an arrow does not move the selection behind it.
    await page.keyboard.press('ArrowRight');
    expect(await selectedLabel()).toMatch(/^Rating on product 1: /);
```

- [ ] **Step 4: The re-open after the two Escapes uses the cell's Fix button**

Replace

```ts
    await page.getByRole('button', { name: 'Rating on product 1: empty', exact: true }).click();
    await panel.waitFor({ timeout: 10_000 });
```

(the one after the second Escape) with:

```ts
    // The selection survives the closed screenshot, so its Mark button is on
    // show; that is the other explicit way back in.
    expect(await selectedLabel()).toMatch(/^Rating on product 1: /);
    await page.getByRole('button', { name: 'Mark Rating on product 1 on the screenshot', exact: true }).click();
    await panel.waitFor({ timeout: 10_000 });
```

- [ ] **Step 5: Run the smoke**

Start the servers in another terminal: `pnpm dev:all` (or the isolated pair, then `APP_URL=http://localhost:3100 API_URL=http://localhost:4100 pnpm test:ui:app`). Then:

Run: `pnpm test:ui:app`
Expected: PASS. Look at `docs/testing/screens/app-site-verification-selected-dark.png` and `-light.png`: the bar above the table with the Title value, the crop with its outlined element, the selected cell outlined.

If the clipboard read is refused in headless Chromium, replace the `readText` assertion with the bar's "Copied" state: `await expect.poll(() => bar.getByRole('button', { name: /^Copy Price/ }).innerText(), { timeout: 3_000 }).toBe('Copied');` — and note the substitution in the commit message.

- [ ] **Step 6: Commit**

```bash
git commit -m "test(app): route smoke follows the spreadsheet gestures on the Verification table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/routes-smoke.test.ts docs/testing/screens/app-site-verification-selected-dark.png docs/testing/screens/app-site-verification-selected-light.png
```

(Add any other `app-site-verification-*.png` the run refreshed, by explicit path.)

---

### Task 10: Rendered check and handoff

**Files:**
- Modify: `docs/handoff.md` (a new section at the top, and the "Newest" pointer)
- Modify: `docs/superpowers/specs/2026-10-07-verification-table-spreadsheet-design.md` (status line)
- Modify: `docs/testing/screens/README.md` if it lists the verification screenshots by name (check with `grep -n "verification" docs/testing/screens/README.md`)

- [ ] **Step 1: Rendered check in real Chromium (controller, free)**

With the app running, on a website with captured proof pages, check and screenshot into `docs/testing/results/screens-2026-10-07-spreadsheet/`:

1. Hover a cell: the Fix button appears at the right edge; on a cell with a one-click tick, the tick is at the far right and Fix left of it, not overlapping.
2. A red cell (if any website has a failed Verify; otherwise skip and say so): its Fix button is visible without hover.
3. Drag-select part of a value inside a cell, press Ctrl+C, paste: the dragged text arrives, not the whole cell (Review Focus 4).
4. Narrow the window under 640 px: the crop is hidden, the buttons wrap under the value, no horizontal page scroll.
5. A long description value: the bar wraps it and scrolls past six lines; the table does not move when a cell is selected or cleared.

Record what was seen, including anything skipped, in `docs/testing/results/2026-10-07-spreadsheet-rendered-check.md`.

- [ ] **Step 2: Handoff**

At the top of `docs/handoff.md`, under "The next work, in order", nothing changes (this work is now done). Add, above the current "**Newest:**" paragraph, a new "Newest" paragraph and demote the previous to "Before it":

```markdown
**Newest: [Verification table, spreadsheet behaviour (2026-10-07)](#verification-table-spreadsheet-behaviour-2026-10-07).** A click on a cell selects it; a detail bar above the table shows the full value, Copy, Fix / Mark, Type it and a read-only crop of the screenshot around the element; arrow keys, Home/End, Ctrl/⌘+C, Enter/F and Escape work; right-click gives Copy value / Open product page / Fix on screenshot / Type it; after a Verify each row shows "n/m" after its badge. Only Fix (the button, the menu item, Enter/F, the crop) or a column head opens the screenshot. Spec `docs/superpowers/specs/2026-10-07-verification-table-spreadsheet-design.md`; the streaming-rows / silent pass-rate half of the original brief is deferred (see the spec's second section).
```

Then add a section `## Verification table, spreadsheet behaviour (2026-10-07)` after the "Read this first" section and before "Staff access", with: what was built (one paragraph), the files (the list from the spec's §5), how it was proven (unit tests, the smoke's new steps, the rendered check and its results file), and one "What NOT to redo" line: "Don't put the selection back in the URL — `?product`/`?field` mean the screenshot is open; a selected cell is route state on purpose (spec §1, decision 1)."

- [ ] **Step 3: Spec status**

Change the spec's **Status** line to: `**Status:** built 2026-10-07 (plan \`docs/superpowers/plans/2026-10-07-verification-table-spreadsheet.md\`); the second half of the original brief — streaming rows and a silent pass rate over unverified pages — is deferred, see below.`

- [ ] **Step 4: Commit**

```bash
git add -- docs/testing/results/2026-10-07-spreadsheet-rendered-check.md docs/testing/results/screens-2026-10-07-spreadsheet
git commit -m "docs: handoff and rendered check for the spreadsheet verification table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- docs/handoff.md docs/superpowers/specs/2026-10-07-verification-table-spreadsheet-design.md docs/testing/results/2026-10-07-spreadsheet-rendered-check.md docs/testing/results/screens-2026-10-07-spreadsheet
```

---

## Self-review

**Spec coverage.** §1 selection separate from URL → Task 8 steps 2–3, 8 (and Task 7's `onSelect`); column head still opens → untouched `ProductCard.onSelect` (Task 8 leaves it). §2 detail bar → Task 5 + Task 8 step 7; Fix button in a cell with the tick's precedence → Task 7 step 4; header count → Task 1 `headerCount` + Task 7 step 2 + Task 8 step 6. §3 context menu → Tasks 3, 7; keyboard table → Task 7 step 3 (Home/End, Ctrl/⌘+C, Enter/F, Escape via `onEscape`); "keys do nothing when nothing is selected except Tab" → `tabbable` on the first cell. §4 Fix = old click → Task 8 `fixCell`; passive preview → Tasks 2, 4, 8 step 7 (null while the panel is open). §5 files → each has a task; `field-details.tsx` → Task 6. §6 testing → Tasks 1, 2 (unit), 9 (smoke), 10 (rendered). §7 acceptance → Task 9 asserts the first four lines; Task 8 step 9 the fifth; nothing calls a model.

**Placeholders.** None; every code step has its code.

**Type consistency.** `CellSelection { product; key }` used identically in Tasks 1, 7, 8, 9 (`data-cell="${product}:${key}"`). `TableCell` = `{ value, state, url, onAccept? }` in Task 7 and Task 8 step 6. `TableRow.count` named the same in Task 7 steps 1–2 and Task 8 step 6. `ScreenshotCrop` props in Task 4 match Task 8 step 7. `DetailBarSelection` in Task 5 matches Task 8 step 7. `FieldDetails.focusTyped` in Task 6 matches Task 8 step 6. `headerCount(results, key, unchangedKeys, cards)` argument order the same in Task 1 and Task 8.

**Review Focus.** 1 → Task 1 clamp test and Task 9's ArrowRight-at-the-end step. 2 → Task 1 `clampSelection` tests, applied in Task 8 step 3. 3 → Task 2's bottom-right, page-cut and short-page tests. 4 → Task 7 step 3's `getSelection` check, Task 10 step 1 item 3. 5 → Task 9 step 3.
