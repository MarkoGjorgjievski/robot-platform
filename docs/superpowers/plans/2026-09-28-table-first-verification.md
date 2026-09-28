# Table-first verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Verification tab into one table — a row per field, a column per product — where rows the page data already agrees on are accepted with one click, and only the rest need the screenshot.

**Architecture:** A pure `rowStatus` in the existing model decides, per field, whether its row is `accepted`, `agreed`, `same-everywhere` or `needs-you` (with the first reason), from the answers, the live suggestions (now carrying their source path `via`) and each product's box map. `acceptRow` / `acceptAllAgreed` write the answers exactly as a tick on a suggestion does today. A new table component replaces the fields sidebar and the card grid (the cards become column heads); the screenshot opens under the table when a cell is clicked. Gate, autosave, Verify and certification are unchanged.

**Tech Stack:** TanStack Start + Router, tRPC v11 react-query, Tailwind v4 tokens, shadcn/ui, vitest, Playwright (smoke + live check).

**Spec:** `docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md`, **Part A** (A1–A5) and §D decisions 1–2. Background: `docs/superpowers/specs/2026-09-25-verification-tab-design.md` (the tab this changes) and the handoff section "App redesign, plan 5: the Verification tab".

## Global Constraints

- Customer wording only: "website", "field", "product", "page". Never "source", "binding", "capture", "box", "via", "draft" on screen.
- Sentence case; no uppercase labels. Body 13 px (`text-base`), secondary 12 px (`text-sm`); `font-mono` for values, URLs and counts.
- State colour only as a 2 px rail, a dot, an outline or a badge — never a background wash. Cell states: empty `border-line`, suggested `border-warn`, accepted `border-pass`, failed `border-fail`.
- Every disabled control shows its reason within one line of it.
- Nothing is accepted without a click; nothing certifies without a Verify. No model is added.
- **Budget rule:** no implementer or test clicks Verify, Sample, Extract or Check with an Anthropic key present. The live check clicks Verify only on the keyless :4100 stack after asserting the label ends "· free".
- **No implementer signs in as `markodjordjievski@gmail.com`** or reads/writes org `default`, org `mar`, or the projects Acne / Scratch / Competitor prices, except one read-only SQL query in Task 4. Browser checks use throwaway `smoke-*@example.com` / `check-*@example.com` identities.
- Commits by explicit path only; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test gate per package: `pnpm --filter <pkg> test -- --maxWorkers=2`. Postgres (`robot-platform-db` container) must be up.
- After any `shadcn add`: remove a literal `packages/app/~/` directory and a bogus `cn` dependency if they appear.

## Review Focus

1. **Accept all, then a transfer lands for a cell just accepted.** Expected: the accepted answer stays; the late suggestion is ignored. Test: Task 1 `acceptAllAgreed then a late merge does not overwrite`.
2. **A suggestion from a replaced screenshot** (Try again / × then re-add). Expected: its row is not "agreed" on stale data; the reason names the product whose screenshot is not ready. Test: Task 1 `rowStatus ignores stale capture ids` (through `liveSuggestions`).
3. **"IKEA" on one product and "Ikea " on another.** Expected: treated as the same value → `same-everywhere`, not `agreed`. Test: Task 1 `same-everywhere ignores case and spaces`.
4. **Products 4–6 with an invalid or several-place suggestion.** Expected: the row is `needs-you` naming that product; Accept never writes an invalid value. Test: Task 1 products 4–6 cases.
5. **Accept all never touches an answered cell, a `same-everywhere` row or a `needs-you` row.** Test: Task 1 `acceptAllAgreed only fills agreed rows' empty cells`.

---

## File map

- Modify `packages/app/src/lib/site/verification-model.ts` (+ `.test.ts`) — `Suggestion.via`, `mergeSuggestions` carries it, `sameValue`, `RowStatus`, `rowStatus`, `acceptRow`, `acceptAllAgreed`.
- Create `packages/app/src/components/verification/verification-table.tsx` — the table (column heads, rows, cells, row status, expanded details).
- Create `packages/app/src/components/verification/field-details.tsx` — the expanded row's Type it, descriptor and hint (moved out of `field-row.tsx`).
- Create `packages/app/src/components/verification/verify-bar.tsx` — Accept all agreed, Verify, save line, stage, Go to Extract (moved out of `fields-sidebar.tsx`).
- Modify `packages/app/src/components/verification/product-card.tsx` — `compact` variant for a column head.
- Modify `packages/app/src/components/verification/product-grid.tsx` — export `AddProductCard` (with `compact`).
- Modify `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` — the new layout and wiring.
- Delete `packages/app/src/components/verification/fields-sidebar.tsx`, `field-row.tsx`, `battery.tsx` once unused (Task 3).
- Modify `packages/app/src/routes-smoke.test.ts`, `docs/testing/ui-check-app-verification.mts`; create `docs/testing/2026-09-2x-table-first-live.md`; update `docs/handoff.md`, `docs/testing/screens/README.md`.

---

### Task 1: The model — suggestions carry their path; row status; accepting

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts`
- Test: `packages/app/src/lib/site/verification-model.test.ts`

**Interfaces — Produces:**

```ts
export type Via = { source: string; path: string };
export type Suggestion = { captureId: string; value: string; boxes: number[]; origin: 'page-data' | 'from-product'; via?: Via };
// mergeSuggestions' `incoming` values become { value: string; boxes: number[]; via?: Via } | null (via is stored as given)
export type RowStatus =
  | { kind: 'accepted' }
  | { kind: 'agreed' }
  | { kind: 'same-everywhere' }
  | { kind: 'needs-you'; reason: string; product?: number };
export function sameValue(a: string, b: string): boolean;
export function rowStatus(field: Field, board: Board, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): RowStatus;
export function acceptRow(board: Board, field: Field, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): Board;
export function acceptAllAgreed(board: Board, fields: Field[], live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): { board: Board; accepted: string[] };
```

`boxesByUrl[url]` is that product's box map when its screenshot has landed, `undefined` when it has not. `live` is always `liveSuggestions(...)` output.

**The rule, exactly** (spec A2). Look only at cards whose `url.trim()` is non-empty; `i` is the card index, products are numbered `i + 1`; "required" means `i < PRODUCTS_MIN`.
1. Walk the cards in order. For card `i` with url `u`: if `board.answers[key][u]` exists, it counts as a value and has no suggestion. Otherwise:
   - no screenshot (`boxesByUrl[u] === undefined`): required → `needs-you` "screenshot not ready on product n"; optional → skip.
   - no live suggestion `live[key]?.[u]`: required → `needs-you` "missing on product n"; optional → skip.
   - `pointable(boxesByUrl[u], s.boxes).length > 1` → `needs-you` "found in {k} places on product n".
   - `validateValue(field.type, s.value)` non-null → `needs-you` "{message} on product n" (e.g. "Not a money amount on product 2").
2. If no card had a suggestion (every counted card answered, and every required card present) → `accepted`.
3. If the suggestions do not all carry a `via` with the same `source` and `path` → `needs-you` "comes from different places".
4. If every value (answers and suggestions, over the counted cards) is `sameValue` to the first, and there are at least two → `same-everywhere`.
5. Otherwise → `agreed`.

`sameValue(a, b)` = `a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()`.

`acceptRow` writes, for each card with a live suggestion and no answer: `answerFromSuggestion(boxes[i], field, s.value, url)` when `pointable(...)` gives exactly one box `i`, else `{ value: s.value, mark: null }`. It skips any suggestion whose value fails `validateValue`. It is used for `agreed` and `same-everywhere` rows (the latter only on the customer's second click).

`acceptAllAgreed` applies `acceptRow` to every field whose `rowStatus` is `agreed` (never `same-everywhere`) and returns the keys it accepted.

- [ ] **Step 1: Write the failing tests** — append to `verification-model.test.ts` (reuse the file's existing `U`, `FIELDS`, `MARK`, `box`, `board()` helpers; add what is missing):

```ts
import { acceptAllAgreed, acceptRow, rowStatus, sameValue, type RowStatus } from './verification-model';

const JL = { source: 'json-ld', path: 'offers.price' };
const TL = { source: 'json-ld', path: 'name' };
const boxesOf = (texts: string[]): Box[] => texts.map((t, i) => box({ text: t, rect: { x: 0, y: i * 20, w: 100, h: 16 }, xpaths: [`//x${i}`] }));
const maps = (): Record<string, Box[]> => ({ [U[0]!]: boxesOf(['Widget A', '$129.99']), [U[1]!]: boxesOf(['Widget B', '$219.99']), [U[2]!]: boxesOf(['Widget C', '$149.00']) });
const sug = (value: string, boxes: number[], via?: { source: string; path: string }) => ({ value, boxes, ...(via ? { via } : {}) });
function liveFor(b: Board, key: string, per: Array<ReturnType<typeof sug> | null>) {
  let s = {};
  per.forEach((p, i) => { if (p) s = mergeSuggestions(s, { [key]: p }, U[i]!, `cap-${i}`, 'page-data', b); });
  return liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' });
}
const price = FIELDS.find((f) => f.key === 'price')!;
const title = FIELDS.find((f) => f.key === 'title')!;

describe('suggestions keep their path', () => {
  it('mergeSuggestions stores via', () => {
    const s = mergeSuggestions({}, { price: sug('129.99', [1], JL) }, U[0]!, 'c', 'page-data', board());
    expect(s.price![U[0]!]!.via).toEqual(JL);
  });
});

describe('rowStatus', () => {
  it('agreed: one place each, valid, same path, different values', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], JL), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual<RowStatus>({ kind: 'agreed' });
  });
  it('page data with no element counts as one place', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [], JL), sug('219.99', [1], JL), sug('149.00', [], JL)]);
    expect(rowStatus(price, b, live, maps()).kind).toBe('agreed');
  });
  it('an answered product plus suggestions on the rest is still agreed', () => {
    const b = answer(board(), 'price', U[0]!, { value: '129.99', mark: null });
    const live = liveFor(b, 'price', [null, sug('219.99', [1], JL), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps()).kind).toBe('agreed');
  });
  it('accepted when every product has an answer', () => {
    let b = board();
    for (const u of U) b = answer(b, 'price', u, { value: '1.00', mark: null });
    expect(rowStatus(price, b, {}, maps())).toEqual({ kind: 'accepted' });
  });
  it('names the first gap, product by product', () => {
    const b = board();
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [1], JL), null, sug('149.00', [1], JL)]), maps()))
      .toEqual({ kind: 'needs-you', reason: 'missing on product 2', product: 2 });
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [0, 1], JL), sug('219.99', [1], JL), sug('149.00', [1], JL)]), maps()))
      .toEqual({ kind: 'needs-you', reason: 'found in 2 places on product 1', product: 1 });
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [1], JL), sug('free', [1], JL), sug('149.00', [1], JL)]), maps()))
      .toEqual({ kind: 'needs-you', reason: 'Not a money amount on product 2', product: 2 });
    const noShot = { ...maps(), [U[2]!]: undefined };
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], JL), null]), noShot))
      .toEqual({ kind: 'needs-you', reason: 'screenshot not ready on product 3', product: 3 });
  });
  it('different paths, or a missing path, are not agreement', () => {
    const b = board();
    const mixed = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], { source: 'meta', path: 'product:price:amount' }), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, mixed, maps())).toEqual({ kind: 'needs-you', reason: 'comes from different places' });
    const noVia = liveFor(b, 'price', [sug('129.99', [1]), sug('219.99', [1]), sug('149.00', [1])]);
    expect(rowStatus(price, b, noVia, maps())).toEqual({ kind: 'needs-you', reason: 'comes from different places' });
  });
  it('same-everywhere ignores case and spaces', () => {
    const b = board();
    const live = liveFor(b, 'title', [sug('IKEA', [0], TL), sug('Ikea ', [0], TL), sug('ikea', [0], TL)]);
    expect(rowStatus(title, b, live, maps())).toEqual({ kind: 'same-everywhere' });
    expect(sameValue(' IKEA  AB', 'ikea ab')).toBe(true);
  });
  it('rowStatus ignores stale capture ids (through liveSuggestions)', () => {
    const b = board();
    let s = {};
    U.forEach((u, i) => { s = mergeSuggestions(s, { price: sug(['129.99', '219.99', '149.00'][i]!, [1], JL) }, u, `cap-${i}`, 'page-data', b); });
    const live = liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-NEW', [U[2]!]: 'cap-2' });
    expect(rowStatus(price, b, live, maps())).toEqual({ kind: 'needs-you', reason: 'missing on product 2', product: 2 });
  });
  it('products 4 to 6: blank is fine, an invalid or several-place suggestion is not', () => {
    const U4 = 'https://s.example/p/4';
    const b = setCards(board(), [...board().cards, { url: U4, title: 'W4' }]);
    const m = { ...maps(), [U4]: boxesOf(['Widget D', '$1']) };
    const base = [sug('129.99', [1], JL), sug('219.99', [1], JL), sug('149.00', [1], JL)];
    let s = {};
    base.forEach((p, i) => { s = mergeSuggestions(s, { price: p }, U[i]!, `cap-${i}`, 'page-data', b); });
    const ids = { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2', [U4]: 'cap-3' };
    expect(rowStatus(price, b, liveSuggestions(s, b, ids), m).kind).toBe('agreed');
    const bad = mergeSuggestions(s, { price: sug('ask', [1], JL) }, U4, 'cap-3', 'page-data', b);
    expect(rowStatus(price, b, liveSuggestions(bad, b, ids), m)).toEqual({ kind: 'needs-you', reason: 'Not a money amount on product 4', product: 4 });
  });
});

describe('accepting', () => {
  it('acceptRow marks a one-place suggestion by its element and a page-data value as typed', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('$129.99', [1], JL), sug('219.99', [], JL), sug('149.00', [1], JL)]);
    const next = acceptRow(b, price, live, maps());
    expect(next.answers.price![U[0]!]!.mark?.xpaths).toEqual(['//x1']);
    expect(next.answers.price![U[1]!]).toEqual({ value: '219.99', mark: null });
  });
  it('acceptAllAgreed only fills agreed rows\' empty cells', () => {
    let b = answer(board(), 'title', U[0]!, { value: 'SAME', mark: null }); // with 'Same' and 'same' below: same-everywhere, so not accepted
    let s = {};
    const add = (key: string, i: number, p: ReturnType<typeof sug>) => { s = mergeSuggestions(s, { [key]: p }, U[i]!, `cap-${i}`, 'page-data', b); };
    add('price', 0, sug('129.99', [1], JL)); add('price', 1, sug('219.99', [1], JL)); add('price', 2, sug('149.00', [1], JL));
    add('title', 1, sug('Same', [0], TL)); add('title', 2, sug('same', [0], TL));
    const live = liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' });
    const r = acceptAllAgreed(b, FIELDS, live, maps());
    expect(r.accepted).toEqual(['price']);
    expect(r.board.answers.title![U[0]!]).toEqual({ value: 'SAME', mark: null });
    expect(r.board.answers.title![U[1]!]).toBeUndefined();
    b = r.board;
    // A late transfer for an accepted cell is ignored.
    const late = mergeSuggestions(s, { price: sug('999.00', [1], JL) }, U[1]!, 'cap-1', 'from-product', b);
    expect(liveSuggestions(late, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' }).price).toBeUndefined();
    expect(b.answers.price![U[1]!]!.value).toBe('219.99');
  });
  it('after accepting every agreed row the Verify gate can open', () => {
    let b = board();
    let s = {};
    const add = (key: string, i: number, p: ReturnType<typeof sug>) => { s = mergeSuggestions(s, { [key]: p }, U[i]!, `cap-${i}`, 'page-data', b); };
    ['129.99', '219.99', '149.00'].forEach((v, i) => add('price', i, sug(v, [1], JL)));
    ['Widget A', 'Widget B', 'Widget C'].forEach((v, i) => add('title', i, sug(v, [0], TL)));
    const live = liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' });
    b = acceptAllAgreed(b, FIELDS, live, maps()).board;
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: true });
  });
});
```

(If `FIELDS` in the test file has more than Title and Price, the last test's expectation still holds only when every field is accepted — restrict it with `FIELDS.filter((f) => f.key === 'title' || f.key === 'price')` if needed.)

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts` (missing exports; `via` not stored).

- [ ] **Step 3: Implement** in `verification-model.ts`:

```ts
export type Via = { source: string; path: string };
export type Suggestion = { captureId: string; value: string; boxes: number[]; origin: 'page-data' | 'from-product'; via?: Via };

// mergeSuggestions: `incoming` is Record<string, { value: string; boxes: number[]; via?: Via } | null>;
// store `...(val.via ? { via: val.via } : {})` on the suggestion.

export type RowStatus =
  | { kind: 'accepted' }
  | { kind: 'agreed' }
  | { kind: 'same-everywhere' }
  | { kind: 'needs-you'; reason: string; product?: number };

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
export function sameValue(a: string, b: string): boolean { return norm(a) === norm(b); }

/**
 * What a field's row needs (spec 2026-09-28 A2). `live` must already be
 * `liveSuggestions(...)`; `boxesByUrl[url]` is undefined until that product's
 * screenshot lands. The same source path on every product is the confidence
 * signal — it is what certification looks for — and a value that is the same
 * on every product is never agreement (a shop name offered as Brand).
 */
export function rowStatus(field: Field, board: Board, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): RowStatus {
  const values: string[] = [];
  const vias: Array<Via | undefined> = [];
  let required = true;
  for (const [i, card] of board.cards.entries()) {
    const url = card.url.trim();
    if (!url) continue;
    required = i < PRODUCTS_MIN;
    const n = i + 1;
    const a = board.answers[field.key]?.[card.url];
    if (a) { values.push(a.value); continue; }
    const boxes = boxesByUrl[card.url];
    if (!boxes) { if (required) return { kind: 'needs-you', reason: `screenshot not ready on product ${n}`, product: n }; continue; }
    const s = live[field.key]?.[card.url];
    if (!s) { if (required) return { kind: 'needs-you', reason: `missing on product ${n}`, product: n }; continue; }
    const places = pointable(boxes, s.boxes).length;
    if (places > 1) return { kind: 'needs-you', reason: `found in ${places} places on product ${n}`, product: n };
    const err = validateValue(field.type, s.value);
    if (err) return { kind: 'needs-you', reason: `${err} on product ${n}`, product: n };
    values.push(s.value);
    vias.push(s.via);
  }
  if (vias.length === 0) return { kind: 'accepted' };
  const first = vias[0];
  if (!first || vias.some((v) => !v || v.source !== first.source || v.path !== first.path)) return { kind: 'needs-you', reason: 'comes from different places' };
  if (values.length > 1 && values.every((v) => sameValue(v, values[0]!))) return { kind: 'same-everywhere' };
  return { kind: 'agreed' };
}

/** Accept a row's suggestions as a tick on each would (spec A3). Never overwrites an answer or writes an invalid value. */
export function acceptRow(board: Board, field: Field, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): Board {
  let next = board;
  for (const card of board.cards) {
    if (!card.url.trim() || next.answers[field.key]?.[card.url]) continue;
    const s = live[field.key]?.[card.url];
    const boxes = boxesByUrl[card.url];
    if (!s || !boxes || validateValue(field.type, s.value)) continue;
    const one = pointable(boxes, s.boxes);
    const given = one.length === 1 ? answerFromSuggestion(boxes[one[0]!]!, field, s.value, card.url) : { value: s.value, mark: null };
    next = answer(next, field.key, card.url, given);
  }
  return next;
}

export function acceptAllAgreed(board: Board, fields: Field[], live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): { board: Board; accepted: string[] } {
  let next = board;
  const accepted: string[] = [];
  for (const f of fields) {
    if (rowStatus(f, next, live, boxesByUrl).kind !== 'agreed') continue;
    next = acceptRow(next, f, live, boxesByUrl);
    accepted.push(f.key);
  }
  return { board: next, accepted };
}
```

Note `acceptAllAgreed` reads `rowStatus` on the board as it goes; `live` is the caller's snapshot — the route recomputes `live` after the board changes, so answered cells drop out of it on the next render.

- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter @robot/app exec tsc --noEmit` and `pnpm --filter @robot/app test -- --maxWorkers=2`.

- [ ] **Step 5: Commit.**

```bash
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts
git commit -m "feat(app): a field's row knows whether the page data agrees, and can be accepted in one go"
```

---

### Task 2: The table, its column heads, and the bar above it

**Files:**
- Create: `packages/app/src/components/verification/verification-table.tsx`, `field-details.tsx`, `verify-bar.tsx`
- Modify: `packages/app/src/components/verification/product-card.tsx` (a `compact` prop), `product-grid.tsx` (export `AddProductCard`, with `compact`)

**Interfaces:**
- Consumes: `Card`, `Field`, `Segment`, `Badge`, `RowStatus`, `shortUrl` (model); `ProofCapture` (`lib/site/use-proof-captures.ts`); `TYPE_LABELS` (`lib/fields-view.ts`); `RunDot` (`components/run-dot.tsx`); the badge view and the expanded-row markup currently inside `field-row.tsx`, and the footer currently inside `fields-sidebar.tsx` (move them, don't copy).
- Produces:

```ts
// field-details.tsx
export type FieldHint = { text: string; value?: string; onAccept?: () => void; onReject?: () => void };
export function FieldDetails(props: {
  field: Field; productNumber: number; description: string; typed: string; typedError?: string;
  hint?: FieldHint; locked: boolean; onType(value: string): void; onDescription(text: string): void;
}): JSX.Element;
export function BadgeView(props: { badge: Badge }): JSX.Element | null;

// verify-bar.tsx
export function VerifyBar(props: {
  acceptAll: { count: number; disabled: boolean; onClick(): void };
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick(): void };
  saveState: 'idle' | 'pending' | 'saving' | 'error'; saveError?: string | null;
  extract: { enabled: boolean; project: string; site: string };
  stage: string | null;
}): JSX.Element;

// verification-table.tsx
export type TableCell = { value: string; state: Segment; selected: boolean; onClick(): void };
export type TableRow = {
  field: Field; cells: TableCell[]; status: RowStatus; badge: Badge; expanded: boolean;
  details: Omit<Parameters<typeof FieldDetails>[0], 'field' | 'locked'>;
  onAccept(): void;          // agreed or same-everywhere ("Accept anyway")
  onToggle(): void;
};
export function VerificationTable(props: {
  heads: React.ReactNode[];  // one per product column, rendered by the route (ProductCard compact / blank)
  addHead?: React.ReactNode; // AddProductCard compact, while there are fewer than six
  rows: TableRow[];
  locked: boolean;
}): JSX.Element;
```

**Behaviour (spec A1, A2):**
- A `<table>` inside `overflow-x-auto rounded-[6px] border border-line bg-panel`; `table-fixed`, first column 180 px and `sticky left-0 bg-panel`, product columns 190 px, the status column 220 px. `thead` holds the heads in `<th scope="col">`.
- Field cell: the name as a button (`aria-expanded`, toggles details), type label muted under it.
- Value cell: a `<button>` (`aria-label="{field} on product {n}: {state word}"`, state words: empty → "empty", suggested → "suggested", answered → "accepted", failed → "failed") with `border-l-2` in the state colour, the value in `font-mono text-base` truncated with `title` = full value, "—" when empty; `selected` adds `outline outline-1 outline-text`.
- Status cell by `status.kind`: `agreed` → "agreed" muted + **Accept** (`aria-label="Accept {field}"`); `same-everywhere` → "same on every product — check it" in `text-warn` + **Accept anyway**; `needs-you` → the reason; `accepted` → the `BadgeView` (verified / fails on product n / changed since verified / checking…) or nothing before a Verify. Buttons disabled while `locked`.
- An expanded row renders a second `<tr>` with one cell spanning all columns holding `FieldDetails`.
- `ProductCard` `compact`: image `h-[56px]`, title one line; everything else (state line, ×, Try again, blank URL input) as now. `AddProductCard` gains the same `compact` prop and is exported.
- `VerifyBar`: a row of **Accept all agreed ({count})** (disabled with "Nothing agreed to accept" when 0), the Verify button with its reason under it, the save line (exact strings from `fields-sidebar.tsx`), the stage line, **Go to Extract** (typed `<Link>` as in `fields-sidebar.tsx`, disabled with "Unlocks when every field is verified").

- [ ] **Step 1: Move** `BadgeView` and the expanded-details markup from `field-row.tsx` into `field-details.tsx`, and the footer from `fields-sidebar.tsx` into `verify-bar.tsx`; point `field-row.tsx`/`fields-sidebar.tsx` at the moved pieces so the current route still compiles.
- [ ] **Step 2: Write** `verification-table.tsx` and the `compact` variants.
- [ ] **Step 3: Verify** — `pnpm --filter @robot/app exec tsc --noEmit` and `pnpm --filter @robot/app test -- --maxWorkers=2` (nothing regresses; the table is mounted in Task 3).
- [ ] **Step 4: Commit.**

```bash
git add packages/app/src/components/verification/verification-table.tsx packages/app/src/components/verification/field-details.tsx packages/app/src/components/verification/verify-bar.tsx packages/app/src/components/verification/product-card.tsx packages/app/src/components/verification/product-grid.tsx packages/app/src/components/verification/field-row.tsx packages/app/src/components/verification/fields-sidebar.tsx
git commit -m "feat(app): the verification table — a row per field, a column per product — and the bar above it"
```

---

### Task 3: The tab becomes the table

**Files:**
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`
- Delete: `packages/app/src/components/verification/fields-sidebar.tsx`, `field-row.tsx`, `battery.tsx` (when nothing imports them)

**Interfaces:**
- Consumes: Task 1 (`rowStatus`, `acceptRow`, `acceptAllAgreed`, `Via`), Task 2 (`VerificationTable`, `TableRow`, `VerifyBar`, `FieldDetails`, `ProductCard compact`, `AddProductCard`).
- Produces: `VerificationSearch` gains nothing new: the screenshot panel is open exactly when `search.product` is set.

**Changes:**
1. **Suggestions carry `via`.** In the `suggestMarks` merge, pass `{ value: s.value, boxes: s.boxes, via: s.via }`; in `carry`'s transfer merge pass `via: t.via`. (Both API answers already include `via`.)
2. **`boxesByUrl`** — `useMemo` over the cards: `captures.byUrl[url]?.status === 'captured' ? captures.byUrl[url].boxes : undefined`, memoised per capture id so identities are stable.
3. **Layout** (replacing the two-column grid and the sidebar): listing panel (`ListingBar` as now) → `VerifyBar` → `VerificationTable` → notes (run note, error, arrival, transfer, notice) → the screenshot panel. The screenshot panel (`ProductView` + `PageViewer` + popover, as now) renders only when `search.product` is set, with a header "{product title} — screenshot" and a × (`aria-label="Close screenshot"`) that removes `product` (and `field`) from the search; Escape does the same when focus is not in an input.
4. **Rows.** For each field: `status = rowStatus(f, board, live, boxesByUrl)`; cells from the cards: `value` = the answer's value, else the live suggestion's value, else ''; `state` = the existing `segment(...)` (failed via `failedCell`); `selected` = this field and product are the ones in the search; `onClick` = `select({ product: i + 1, field: f.key })` (opens the panel on that product with the field's answer or suggestion highlighted — reuse the existing `highlight` and `overlays` logic). `onAccept` = `setBoard((b) => acceptRow(b, f, live, boxesByUrl))`. `details` = what the sidebar row passed (typed, description, hint via the existing `rowHint`, …) with `productNumber` = the selected product, or 1 when none is selected.
5. **Accept all agreed.** `count` = fields whose status is `agreed`; `onClick` = `setBoard((b) => acceptAllAgreed(b, fields, live, boxesByUrl).board)`; disabled while `locked`.
6. **Column heads.** For each card: `ProductCard compact` with the same handlers the grid passed (select opens the panel on that product, drop, replace, retry, hostProblem); `addHead` = `AddProductCard compact` while `cards.length < PRODUCTS_MAX`. `ProductGrid` is no longer rendered.
7. **No cards yet:** the table is replaced by the existing "Find products from a listing page…" panel.
8. Remove the sidebar imports; delete `fields-sidebar.tsx`, `field-row.tsx`, `battery.tsx` if nothing else imports them (`rg -n "fields-sidebar|field-row|battery" packages/app/src`).
9. The Verify gate, autosave, board store, arrivals and `handleVerify` are untouched. After an arrival (`?addPage`), the panel opens on the new product, as `product` is set.

- [ ] **Step 1: Make the changes above.**
- [ ] **Step 2: Verify** — `pnpm --filter @robot/app exec tsc --noEmit`; `pnpm --filter @robot/app test -- --maxWorkers=2`.
- [ ] **Step 3: Browser look** — with `pnpm dev:all` up (check :3000 and :4000; start in the background if not), sign in as a throwaway `check-<ts>@example.com`, create a project with Title and Price from the catalogue, add a website, paste a listing from a public shop (scrapingcourse.com worked in plan 5), wait for the three screenshots, and confirm: rows read agreed/needs you, **Accept all agreed** turns agreed rows green in one click, a needs-you cell opens the screenshot under the table, × closes it, reload keeps everything. **Never click Verify.** Record what you saw, with a screenshot path, in the report.
- [ ] **Step 4: Commit** (the route and the deletions via `git rm`).

```bash
git rm packages/app/src/components/verification/fields-sidebar.tsx packages/app/src/components/verification/field-row.tsx packages/app/src/components/verification/battery.tsx
git add "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
git commit -m "feat(app): the Verification tab is one table — accept what agrees, look at the rest"
```

---

### Task 4: Smoke, the free live run, and the docs

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts`, `docs/testing/ui-check-app-verification.mts`
- Create: `docs/testing/2026-09-2x-table-first-live.md` (the actual date)
- Modify: `docs/handoff.md`, `docs/testing/screens/README.md`

**Smoke** (`pnpm test:ui:app`, needs `pnpm dev:all`; it already serves its own fixture listing and three product pages): after the three screenshots are ready, assert the Title and Price rows' status texts; click **Accept all agreed** and assert every agreed row's cells read "accepted" (by `aria-label`); for a row that needs you, click its cell, assert the screenshot panel opens, mark the element there as the smoke does today, close the panel with ×; reload and assert every cell is still accepted; assert the Verify label matches `/^Verify \d+ fields? · (free|up to \$\d)/` and **do not click it**. Screenshots `app-site-verification-table-{dark,light}.png` (replace the plan 5 state shots that no longer exist: the sidebar ones).

**Live check** (`docs/testing/ui-check-app-verification.mts`, keyless api-server on :4100 and a second app on another port pointed at it — see the script's own header and the handoff's plan 5 "How to run"; never touch :4000/:3000; stop both processes by port when done): Ikea as in plan 5, now through the table. Record: listing time, screenshot time per product, rows agreed / same-everywhere / needs-you before any click, **clicks to reach an enabled Verify** (plan 5 took 43; the target is ≤ 5), Verify time and the verified count. Assert the Verify label ends "· free" before clicking it; abort otherwise. Delete the throwaway project at the end.

**Docs:** a handoff section "Table-first verification (2026-09-2x)" — what landed per commit, rulings, what the checks found, the live numbers, open items — and a line in "Read this first". Screens README entries for the new shots.

- [ ] **Step 1: Smoke** — write, run, green in both themes; restore screenshots you did not mean to change (`git checkout -- <path>`).
- [ ] **Step 2: Live check** — run on the keyless stack; numbers into the live note.
- [ ] **Step 3: Full gate** — db, browser, agent, scraper, api, dashboard, api-server, app, each `pnpm --filter @robot/<pkg> test -- --maxWorkers=2`.
- [ ] **Step 4: Docs.**
- [ ] **Step 5: Commit** by explicit paths.

```bash
git commit -m "test(app): the table-first tab in the smoke and a free live run on Ikea; recorded"
```
