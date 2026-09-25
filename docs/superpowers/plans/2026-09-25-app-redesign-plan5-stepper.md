# App redesign plan 5 — the stepper's Pages and Mark steps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Schema tab's typed grid with the approved three-step flow in `@robot/app` — 1 · Fields, 2 · Pages (a listing URL fills three proof-page slots, each captured in the background), 3 · Mark (click each field on the page's screenshot) — ending on the grid as a read-only proof sheet.

**Architecture:** The engine already exists (`sources.captureProofPage`, `proofPageCapture`, `suggestMarks`, `transferMarks`, `updateBinding` with `marks`; handoff "Schema stepper, engine"). This plan adds three small API changes the screens need (a capture → org guard, a per-URL capture lookup so a reload resumes, and page-1 values supplied by the client to `transferMarks`), teaches the app's `GridState` to carry marks so every save round-trips them, and builds steps 2 and 3 as components over pure, unit-tested view logic in `src/lib/site/`. The Schema route keeps one `GridState` for all four views, so an unsaved draft survives moving between steps; a per-website draft in `localStorage` survives a reload.

**Tech Stack:** TanStack Start + Router, tRPC v11 react-query, Tailwind v4 tokens, shadcn/ui, vitest; Drizzle + Postgres for the API tests; Playwright for the smoke and the look-only check.

**Spec:** `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md` §2.2–§2.5, §4, §5, §6 (the flow), and `docs/superpowers/specs/2026-09-21-app-redesign-design.md` §4 (visual system), §7 item 5. Read both before starting. Handoff sections "Schema stepper, engine", "Schema stepper, step 1" and "App redesign, plan 3" record what already exists.

## Global Constraints

- Customer wording only: "website", "field", "page", "run", "organisation". Never "source", "binding", "dataset", "capture id", "box" on screen.
- Sentence case everywhere; no uppercase labels. Body 13 px (`text-base`), secondary 12 px (`text-sm`), Geist Mono (`font-mono`) for URLs, values, counts.
- State colour only as a dot, a 2 px rail or a badge — never a background wash. Tokens: `text-pass`/`bg-pass`, `text-fail`, `text-warn`, `text-link`, `border-line`, `bg-panel`, `bg-raised`, `text-muted-foreground`, `text-faint`. Panels: `rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]`, class `rise` for the load fade.
- Every disabled control shows its reason within one line of it.
- No model anywhere in the stepper (spec 2026-09-18 §1). The Pages and Mark steps spend nothing; only Verify can spend.
- **Budget rule:** no implementer or test clicks Verify, Re-verify, Finish-and-verify, Sample, Extract or Check against a website with an Anthropic key present. Tests save with the free "Save without verifying" path.
- **No implementer signs in as `markodjordjievski@gmail.com`**, or reads or writes org `default`, org `mar` or the projects Acne / Scratch / Competitor prices. Browser checks use throwaway `smoke-*@example.com` / `check-*@example.com` identities.
- Commits by explicit path only (`git add <paths>`; never `git add -A` / `.`) — shared checkout.
- Test gate per package: `pnpm --filter <pkg> test -- --maxWorkers=2` (`pnpm -r test` is killed for memory on this machine). Postgres must be up.
- After any `shadcn add`: check the diff for a literal `packages/app/~/` directory and a bogus `cn` dependency, and remove both.
- `updateBinding` is a whole-binding save: every caller must send `marks`, or the marks are erased.

## Review Focus

1. **Reload in the middle of step 3** — the customer has clicked five fields on page 1 and reloads. Expected: the marks and values are still there (the `localStorage` draft), and the slots find their existing captures rather than re-capturing. Tests: Task 3 `schema-draft` round-trip; Task 1 `proofPageCaptures` returns the newest row per URL.
2. **A box map that is newer than the suggestion** — a slot re-captured (Try again / Swap) while `suggestMarks` or `transferMarks` for the old capture was in flight. Expected: the stale answer is ignored, never drawn as outlines on the new screenshot. Test: Task 3 `answerIsCurrent`.
3. **Import values rewriting a marked cell** on the proof sheet. Expected: the cell's mark is dropped client-side (and the server drops it too), so a stale XPath never joins certification. Test: Task 2 `applyImportToRows clears the mark of a changed cell`.
4. **An image or URL field clicked on the wrong kind of element** (a text span for an image field, a heading for a URL field). Expected: an inline reason ("this element is not an image"), the cell unchanged. Test: Task 3 `valueFromBox`.
5. **A website whose binding was never saved** (the normal first pass) — `transferMarks` must work from the values on screen, not from the database. Test: Task 1 `carries page 1 from the values the client sends`.

---

## File map

**API (`packages/api`)**
- Modify `src/auth/scope.ts` — add `captureInOrg`.
- Modify `src/verify/proof-page-capture.ts` — add `latestProofPageCaptures`.
- Modify `src/routers/sources.ts` — guard `proofPageCapture` and `suggestMarks`; add `proofPageCaptures`; `transferMarks` takes an optional `from`.
- Test `src/routers/sources-marks.test.ts`, `src/routers/site-scope.test.ts`.

**App (`packages/app`)**
- Modify `src/lib/site/schema-grid.ts` (+ test) — rows carry `marks`.
- Modify `src/lib/site/schema-stepper-view.ts` (+ test) — four views, slot states, row labels.
- Create `src/lib/site/mark-view.ts` (+ test) — value-from-element, seeding from suggestions and transfers, next unfilled row, stale-answer check.
- Create `src/lib/site/page-viewer-view.ts` (+ test) — hit-testing and scaling for the screenshot.
- Create `src/lib/site/schema-draft.ts` (+ test) — the per-website draft in `localStorage`.
- Create `src/lib/site/use-proof-captures.ts` — the hook that starts, finds and polls captures.
- Create `src/components/schema/pages-step.tsx`, `src/components/schema/page-slot.tsx`.
- Create `src/components/schema/page-viewer.tsx`.
- Create `src/components/schema/mark-step.tsx`, `src/components/schema/mark-rows.tsx`.
- Modify `src/components/schema/stepper-strip.tsx` — four cells.
- Modify `src/components/schema/page-header-cell.tsx` — pencil popover replaced by "Mark again".
- Modify `src/components/schema/schema-grid.tsx` — `onMarkAgain`.
- Modify `src/routes/_app/projects/$project/sites/$site/index.tsx` — the four views.
- Modify `src/components/project/add-website-dialog.tsx` — arrival step.
- Modify `src/components/runs/run-misses.tsx` — the arrival link sends the field **key**.
- Modify `src/routes-smoke.test.ts`; create `docs/testing/ui-check-app-stepper.mts`, `docs/testing/2026-09-2x-stepper-live.md`.

---

### Task 1: API — the capture guard, a per-URL capture lookup, and page 1 from the client

**Files:**
- Modify: `packages/api/src/auth/scope.ts`
- Modify: `packages/api/src/verify/proof-page-capture.ts`
- Modify: `packages/api/src/routers/sources.ts` (procedures `proofPageCapture`, `suggestMarks`, `transferMarks`; new `proofPageCaptures` beside them)
- Test: `packages/api/src/routers/sources-marks.test.ts`, `packages/api/src/routers/site-scope.test.ts`

**Interfaces:**
- Produces:
  - `captureInOrg(ctx: Pick<Context,'db'|'session'>, captureId: string): Promise<{ id: string; sourceId: string } | null>` — `null` without a session (the shim rule of `sourceInOrg`); NOT_FOUND for an unknown capture or one whose website is in another org.
  - `sources.proofPageCaptures({ sourceId: uuid, urls: httpUrl[] (1..6) })` → `Record<string, { captureId: string; status: 'capturing' | 'captured' | 'failed'; error?: string } | null>` — the newest proof-page capture per URL; `null` when there is none or the captured one is older than `CAPTURE_REUSE_MAX_AGE_MS` (the client re-captures).
  - `sources.transferMarks` input gains `from?: Record<fieldKey, { value: string; mark?: MarkInput }>`; when present it replaces the saved binding's page-1 values and marks.

- [ ] **Step 1: Write the failing tests** — append to `sources-marks.test.ts`:

```ts
describe('sources.proofPageCaptures', () => {
  it('answers the newest capture per url and null for a url never captured', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-list', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const newer = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const { captureId: capturing } = await caller.sources.captureProofPage({ sourceId: f.sourceId, url: f.urls[1]! });
      const r = await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [f.urls[0]!, f.urls[1]!, f.urls[2]!] });
      expect(r[f.urls[0]!]).toEqual({ captureId: newer, status: 'captured' });
      expect(r[f.urls[1]!]).toEqual({ captureId: capturing, status: 'capturing' });
      expect(r[f.urls[2]!]).toBeNull();
    } finally { await f.cleanup(); }
  });

  it('treats a captured page older than the reuse window as missing', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-old', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const row = await db.query.captures.findFirst({ where: eq(captures.id, id) });
      await db.update(captures).set({ metadata: { ...(row!.metadata as object), capturedAt: old } }).where(eq(captures.id, id));
      const r = await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [f.urls[0]!] });
      expect(r[f.urls[0]!]).toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('sources.transferMarks with the values on screen', () => {
  it('carries page 1 from the values the client sends, not the saved ones', async () => {
    // The saved page-1 price is a value page 1 does not show; only the override can find anything.
    const f = await createProjectWithSource(caller, { tag: 'marks-from', fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-marks-from.example.com/p/1': '999.00', 'https://test-marks-from.example.com/p/2': '219.99', 'https://test-marks-from.example.com/p/3': '149.00' } } });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); await seedProofPage(f.sourceId, f.urls[1]!, 'p2'); await seedProofPage(f.sourceId, f.urls[2]!, 'p3');
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], from: { [f.keys.Price!]: { value: '129.99' } } });
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]!.value).toMatch(/219\.99/);
      const saved = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!] });
      expect(saved[f.urls[1]!]!.fields[f.keys.Price!]).toBeNull();
    } finally { await f.cleanup(); }
  });
});
```

Add `import { eq } from 'drizzle-orm';` at the top if absent. In `site-scope.test.ts`, in the other-org test's `calls` list, add (the capture is created by org A's caller before `bc` runs):

```ts
const { captureId } = await a.caller.sources.captureProofPage({ sourceId, url: `${HOST}/p/1` });
// … inside `calls`:
['sources.proofPageCapture', () => bc.sources.proofPageCapture({ captureId })],
['sources.suggestMarks', () => bc.sources.suggestMarks({ captureId })],
['sources.proofPageCaptures', () => bc.sources.proofPageCaptures({ sourceId, urls: [`${HOST}/p/1`] })],
```

`site-scope.test.ts` does not stub the capture job; `captureProofPage` fires a real browser at `a.example.com` which fails harmlessly. If that shows up as noise or a hang, add the same `vi.mock('../verify/proof-page-capture.js', …)` block `sources-marks.test.ts` uses.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @robot/api exec vitest run src/routers/sources-marks.test.ts src/routers/site-scope.test.ts`
Expected: FAIL — `proofPageCaptures` is not a procedure; the scope test's three new calls resolve instead of NOT_FOUND; the `from` test's first expectation fails (value from the saved 999.00 resolves nothing).

- [ ] **Step 3: Implement**

`scope.ts`, beside `runInOrg`:

```ts
/**
 * A proof-page capture is reached through its website. Addressed by id alone,
 * so — like `sourceInOrg` — a session-less caller (the old dashboard) is let
 * through until cut-over.
 */
export async function captureInOrg(ctx: Pick<Context, 'db' | 'session'>, captureId: string) {
  if (!ctx.session) return null;
  const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, captureId), columns: { id: true, sourceId: true } });
  if (!row || !row.sourceId) throw notFound('Page capture', captureId);
  await sourceInOrg(ctx, row.sourceId);
  return { id: row.id, sourceId: row.sourceId };
}
```

(import `captures` from `@robot/db`). Call `await captureInOrg(ctx, input.captureId);` as the first statement of `proofPageCapture` and `suggestMarks`.

`proof-page-capture.ts`:

```ts
export type ProofPageCaptureState = { captureId: string; status: 'capturing' | 'captured' | 'failed'; error?: string };

/**
 * The newest proof-page capture per URL, in whatever state it is in — what a
 * reloaded stepper resumes from. A stalled `capturing` row is closed on the
 * way (`resolveStalledProofPage`); a captured one past the reuse window is
 * reported as missing, so the screen re-captures instead of marking an old page.
 */
export async function latestProofPageCaptures(sourceId: string, urls: string[]): Promise<Record<string, ProofPageCaptureState | null>> {
  const out: Record<string, ProofPageCaptureState | null> = Object.fromEntries(urls.map((u) => [u, null]));
  const rows = await db.query.captures.findMany({
    where: and(eq(captures.sourceId, sourceId), inArray(captures.url, urls)),
    orderBy: [desc(captures.createdAt)],
    columns: { id: true, url: true, metadata: true },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const m = r.metadata as ProofPageMeta | null;
    if (!m || m.kind !== 'proof-page' || seen.has(r.url)) continue;
    seen.add(r.url);
    const meta = await resolveStalledProofPage(r.id, m);
    if (meta.status === 'captured' && Date.now() - Date.parse(meta.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) continue;
    out[r.url] = { captureId: r.id, status: meta.status, ...(meta.status === 'failed' ? { error: meta.error } : {}) };
  }
  return out;
}
```

`sources.ts`, after `proofPageCapture`:

```ts
  /** Where each proof page's capture stands, newest per URL: how a reloaded stepper finds the captures it already started. */
  proofPageCaptures: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), urls: z.array(httpUrl).min(1).max(VERIFY_URL_MAX) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return latestProofPageCaptures(input.sourceId, input.urls);
    }),
```

`transferMarks`: extend the input with `from: z.record(z.string(), z.object({ value: z.string(), mark: markInput.optional() })).optional()` (import `markInput` from `../verify/binding-input.js`). Replace the two reads of page 1:

```ts
      // The stepper cannot save a binding until every page has its values, so
      // while marking it sends page 1 as it stands on screen (plan 5, Task 1).
      const pageOne = (key: string) => input.from
        ? { value: input.from[key]?.value ?? '', mark: input.from[key]?.mark }
        : { value: set.expected[key]?.[input.fromUrl] ?? '', mark: set.marks?.[key]?.[input.fromUrl] };
      const carried = fields.filter((f) => pageOne(f.key).value.trim() !== '');
      // … and inside the loop:
      const { value: expected, mark } = pageOne(field.key);
      const r = await transferMarks({ field, from: { url: input.fromUrl, capture: from.capture, expected, mark }, to }, deps);
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @robot/api exec vitest run src/routers/sources-marks.test.ts src/routers/site-scope.test.ts`
Expected: PASS. Then `pnpm --filter @robot/api test -- --maxWorkers=2` — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/scope.ts packages/api/src/verify/proof-page-capture.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-marks.test.ts packages/api/src/routers/site-scope.test.ts
git commit -m "feat(api): proof-page captures scoped to the org, found per url, and transferred from the values on screen"
```

---

### Task 2: App — the grid carries marks

**Files:**
- Modify: `packages/app/src/lib/site/schema-grid.ts`
- Test: `packages/app/src/lib/site/schema-grid.test.ts`

**Interfaces:**
- Produces:
  - `export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } }`
  - `GridRow` gains `marks: (Mark | null)[]`, always `marks.length === expected.length`.
  - `setCellValue(row: GridRow, pageIndex: number, value: string, mark?: Mark | null): GridRow` — writes a value; the mark is replaced by `mark` (default `null`, i.e. typing clears it).
  - `toBindingInput(state)` now also returns `marks?: Record<key, Record<url, Mark>>` (omitted when there are none).
  - `fromSource` reads `verificationSet.marks`.

- [ ] **Step 1: Write the failing tests** — append to `schema-grid.test.ts`:

```ts
const MARK = { xpaths: ['//h1'], text: 'Widget A', rect: { x: 0, y: 0, w: 10, h: 10 } };

describe('marks on the grid', () => {
  it('a new row has one empty mark per page, and addPage/removePage keep them in step', () => {
    let s: GridState = { urls: ['a', 'b', 'c'], listingUrl: '', rows: [{ ...emptyRow(3), key: 'k', name: 'T' }] };
    expect(s.rows[0]!.marks).toEqual([null, null, null]);
    s = addPage(s, 'https://x/4');
    expect(s.rows[0]!.marks).toHaveLength(4);
    s = removePage(s, 3);
    expect(s.rows[0]!.marks).toHaveLength(3);
  });

  it('setCellValue stores a mark with its value, and a typed value clears it', () => {
    const row = { ...emptyRow(3), key: 'k', name: 'T' };
    const marked = setCellValue(row, 0, 'Widget A', MARK);
    expect(marked.expected[0]).toBe('Widget A');
    expect(marked.marks[0]).toEqual(MARK);
    const typed = setCellValue(marked, 0, 'Widget B');
    expect(typed.marks[0]).toBeNull();
  });

  it('round-trips marks through toBindingInput and fromSource', () => {
    const urls = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
    const row = setCellValue({ ...emptyRow(3), key: 'title', name: 'Title', description: 'h1' }, 0, 'Widget A', MARK);
    const input = toBindingInput({ urls, listingUrl: '', rows: [row] });
    expect(input.marks).toEqual({ title: { [urls[0]!]: MARK } });
    const back = fromSource({
      schemaDefinition: [{ key: 'title', name: 'Title', type: 'text', description: 'h1' }],
      verificationSet: { urls, expected: input.expected, marks: input.marks },
    })!;
    expect(back.rows[0]!.marks).toEqual([MARK, null, null]);
  });

  it('omits marks from the binding input when there are none', () => {
    const s: GridState = { urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '', rows: [{ ...emptyRow(3), key: 'k', name: 'T' }] };
    expect('marks' in toBindingInput(s)).toBe(false);
  });

  it('applyImportToRows clears the mark of a changed cell and keeps an unchanged one', () => {
    const row = setCellValue(setCellValue({ ...emptyRow(3), key: 'k', name: 'Title' }, 0, 'Widget A', MARK), 1, 'Widget B', MARK);
    const imported = [{ ...emptyRow(3), name: 'Title', description: 'h1', expected: ['Widget A', 'Widget Z', ''] }];
    const { rows } = applyImportToRows([row], imported);
    expect(rows[0]!.marks[0]).toEqual(MARK);
    expect(rows[0]!.marks[1]).toBeNull();
  });

  it('a pasted value clears the mark under it', () => {
    const row = setCellValue({ ...emptyRow(3), key: 'k', name: 'Title' }, 0, 'Widget A', MARK);
    const s = applyPaste({ urls: ['a', 'b', 'c'], listingUrl: '', rows: [row] }, { row: 0, col: 3 }, [['Other']]);
    expect(s.rows[0]!.marks[0]).toBeNull();
  });
});
```

Add `setCellValue` to the file's import list.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/schema-grid.test.ts`
Expected: FAIL — `marks` undefined, `setCellValue` not exported.

- [ ] **Step 3: Implement** in `schema-grid.ts`:

```ts
/** The element a customer clicked for one cell (spec 2026-09-18 §3.5). Mirrors `@robot/scraper`'s `Mark`. */
export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };
export type GridRow = { id: string; key?: string; name: string; type: GridFieldType; description: string; expected: string[]; marks: (Mark | null)[] };

export function emptyRow(width = URL_COUNT): GridRow {
  return { id: `r${Date.now().toString(36)}${(seq++).toString(36)}`, name: '', type: 'text', description: '', expected: Array(width).fill(''), marks: Array(width).fill(null) };
}

/** Write one cell. A value arrives with the element it came from, or with none — typing, pasting and importing all clear the mark. */
export function setCellValue(row: GridRow, pageIndex: number, value: string, mark: Mark | null = null): GridRow {
  if (pageIndex < 0 || pageIndex >= row.expected.length) return row;
  const expected = [...row.expected]; expected[pageIndex] = value;
  const marks = [...row.marks]; marks[pageIndex] = mark;
  return { ...row, expected, marks };
}
```

Then:
- `setCell`'s value branch calls `setCellValue(row, i, value)` (so paste clears the mark).
- `addPage`: `rows.map((r) => ({ ...r, expected: [...r.expected, ''], marks: [...r.marks, null] }))`; `removePage` filters `marks` by the same index.
- `applyImportToRows`: build `expected` as now, then `marks: r.marks.map((m, k) => (expected[k] === r.expected[k] ? m : null))`.
- `reconcileRows` needs no change (new rows come from `emptyRow(cells)`).
- `toBindingInput`: collect `marks[key][url] = mark` for every non-null mark whose url is non-blank; spread `...(Object.keys(marks).length ? { marks } : {})`.
- `fromSource`: read `set.marks?.[f.key]?.[u] ?? null` into `marks` per url.
- `SchemaGrid` (`components/schema/schema-grid.tsx`) writes cells through whatever helper it uses today; if it builds `{ ...row, expected }` by hand anywhere, route it through `setCellValue` so a typed cell clears its mark. Grep it: `rg -n "expected" packages/app/src/components/schema/schema-grid.tsx`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/` then `pnpm --filter @robot/app exec tsc --noEmit`
Expected: PASS; no type errors (every `GridRow` literal in the app now needs `marks` — `emptyRow()` spreads cover most; fix the rest).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/site/schema-grid.ts packages/app/src/lib/site/schema-grid.test.ts packages/app/src/components/schema/schema-grid.tsx
git commit -m "feat(app): the schema grid carries each cell's mark and every save round-trips it"
```

---

### Task 3: App — the stepper's decisions, the mark screen's decisions, and the draft

**Files:**
- Modify: `packages/app/src/lib/site/schema-stepper-view.ts` (+ `.test.ts`)
- Create: `packages/app/src/lib/site/mark-view.ts` (+ `.test.ts`)
- Create: `packages/app/src/lib/site/schema-draft.ts` (+ `.test.ts`)

**Interfaces:**
- Consumes: `GridState`, `GridRow`, `Mark`, `setCellValue`, `validateExpectedClient`, `URL_MIN` (Task 2).
- Produces (`schema-stepper-view.ts`):
  - `type SchemaStep = 'fields' | 'pages' | 'mark' | 'sheet'`
  - `type PagesReady = 'yes' | 'no' | 'loading'`
  - `stepOf(search: { step?: string }, s: { fieldCount: number; hasBinding: boolean; pagesReady: PagesReady }): SchemaStep`
  - `stepStates(step: SchemaStep, s: { fieldCount: number; hasBinding: boolean; pagesReady: PagesReady }): [StepState, StepState, StepState, StepState]`
  - `type SlotState = 'empty' | 'starting' | 'capturing' | 'captured' | 'failed'`
  - `slotState(url: string, capture: { status: 'capturing' | 'captured' | 'failed' } | null | undefined): SlotState` (`undefined` = not asked yet → `'starting'` when the url is set)
  - `pagesReadyOf(urls: string[], slots: SlotState[], loading: boolean): PagesReady`
  - `sharedNote`, `addNote` unchanged.
- Produces (`mark-view.ts`):
  - `type Box = { xpaths: string[]; text: string; rect: Mark['rect']; tag: string; kind: 'text' | 'image' | 'link'; src?: string; href?: string }`
  - `type CellSource = { kind: 'clicked' } | { kind: 'typed' } | { kind: 'suggested'; via: 'api' | 'json-ld' | 'meta' } | { kind: 'several'; count: number } | { kind: 'page-data'; via: 'api' | 'json-ld' | 'meta' } | { kind: 'from-page-1' } | { kind: 'saved' }`
  - `sourceLabel(s: CellSource | undefined, hasValue: boolean): string`
  - `valueFromBox(box: Box, type: GridFieldType): { value: string; mark: Mark | null } | { error: string }`
  - `type Seed = { value: string; via: { source: string; path: string }; boxes: number[] }` (the shape of both `Suggestion` and `Transferred`)
  - `seedPage(grid: GridState, pageIndex: number, seeds: Record<string, Seed | null>, boxes: Box[], origin: 'suggested' | 'from-page-1'): { grid: GridState; sources: Record<string, CellSource>; outlines: Record<string, number[]> }` — fills only empty cells.
  - `nextUnfilled(grid: GridState, pageIndex: number, afterRow: number): number | null`
  - `pageProblems(grid: GridState, pageIndex: number): string[]`
  - `answerIsCurrent(answer: { captureId: string } | null | undefined, slotCaptureId: string | null | undefined): boolean`
- Produces (`schema-draft.ts`):
  - `saveDraft(sourceId: string, grid: GridState, storage?: Storage): void`
  - `loadDraft(sourceId: string, storage?: Storage): GridState | null`
  - `clearDraft(sourceId: string, storage?: Storage): void`

- [ ] **Step 1: Write the failing tests**

Replace `schema-stepper-view.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { pagesReadyOf, slotState, stepOf, stepStates } from './schema-stepper-view';

const ready = { fieldCount: 3, hasBinding: true, pagesReady: 'yes' as const };

describe('stepOf', () => {
  it('is fields while the project has none, whatever the url says', () => {
    expect(stepOf({ step: 'mark' }, { ...ready, fieldCount: 0 })).toBe('fields');
  });
  it('lands a website with a saved binding on the proof sheet, and a new one on pages', () => {
    expect(stepOf({}, ready)).toBe('sheet');
    expect(stepOf({}, { ...ready, hasBinding: false })).toBe('pages');
  });
  it('sends mark back to pages until every page has its screenshot, but not while that is still loading', () => {
    expect(stepOf({ step: 'mark' }, { ...ready, pagesReady: 'no' })).toBe('pages');
    expect(stepOf({ step: 'mark' }, { ...ready, pagesReady: 'loading' })).toBe('mark');
  });
  it('sends sheet back to pages when nothing was ever saved', () => {
    expect(stepOf({ step: 'sheet' }, { ...ready, hasBinding: false })).toBe('pages');
  });
});

describe('stepStates', () => {
  it('marks the steps before the open one done and says which later ones are out of reach', () => {
    expect(stepStates('pages', { ...ready, hasBinding: false, pagesReady: 'no' })).toEqual(['done', 'current', 'later', 'later']);
    expect(stepStates('mark', { ...ready, hasBinding: false })).toEqual(['done', 'done', 'current', 'later']);
    expect(stepStates('sheet', ready)).toEqual(['done', 'done', 'done', 'current']);
    expect(stepStates('fields', ready)).toEqual(['current', 'locked', 'locked', 'locked']);
    expect(stepStates('fields', { fieldCount: 0, hasBinding: false, pagesReady: 'no' })).toEqual(['current', 'later', 'later', 'later']);
  });
});

describe('slots', () => {
  it('reads a slot from its url and its capture', () => {
    expect(slotState('', undefined)).toBe('empty');
    expect(slotState('https://s/1', undefined)).toBe('starting');
    expect(slotState('https://s/1', null)).toBe('starting');
    expect(slotState('https://s/1', { status: 'capturing' })).toBe('capturing');
    expect(slotState('https://s/1', { status: 'failed' })).toBe('failed');
  });
  it('is ready only when every page is captured', () => {
    expect(pagesReadyOf(['a', 'b', 'c'], ['captured', 'captured', 'captured'], false)).toBe('yes');
    expect(pagesReadyOf(['a', 'b', 'c'], ['captured', 'failed', 'captured'], false)).toBe('no');
    expect(pagesReadyOf(['a', 'b', 'c'], ['captured', 'starting', 'captured'], true)).toBe('loading');
  });
});
```

Create `mark-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emptyRow, setCellValue, type GridState } from './schema-grid';
import { answerIsCurrent, nextUnfilled, pageProblems, seedPage, sourceLabel, valueFromBox, type Box } from './mark-view';

const box = (over: Partial<Box>): Box => ({ xpaths: ['//x'], text: '', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'span', kind: 'text', ...over });
const grid = (): GridState => ({
  urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'],
  listingUrl: '',
  rows: [
    { ...emptyRow(3), key: 'title', name: 'Title', type: 'text', description: 'h1' },
    { ...emptyRow(3), key: 'price', name: 'Price', type: 'money', description: 'price' },
    { ...emptyRow(3), key: 'image', name: 'Image', type: 'image', description: 'hero' },
  ],
});

describe('valueFromBox', () => {
  it('takes the text of a text element and marks it', () => {
    const r = valueFromBox(box({ text: 'Widget A' }), 'text');
    expect(r).toEqual({ value: 'Widget A', mark: { xpaths: ['//x'], text: 'Widget A', rect: { x: 0, y: 0, w: 10, h: 10 } } });
  });
  it("takes an image's src for an image field, and its mark carries no text", () => {
    const r = valueFromBox(box({ kind: 'image', tag: 'img', src: 'https://s.example/a.jpg' }), 'image');
    expect(r).toMatchObject({ value: 'https://s.example/a.jpg', mark: { text: '' } });
  });
  it("takes a link's href for a url field", () => {
    expect(valueFromBox(box({ kind: 'link', tag: 'a', text: 'Buy', href: 'https://s.example/buy' }), 'url')).toMatchObject({ value: 'https://s.example/buy', mark: { text: '' } });
  });
  it('refuses the wrong kind of element with a reason', () => {
    expect(valueFromBox(box({ text: 'Widget A' }), 'image')).toEqual({ error: 'This element is not an image' });
    expect(valueFromBox(box({ text: 'Widget A' }), 'url')).toEqual({ error: 'This element is not a link' });
    expect(valueFromBox(box({ kind: 'image', tag: 'img', src: 'x' }), 'text')).toEqual({ error: 'This element has no text' });
  });
  it('keeps the value but no mark when the element has no XPath', () => {
    expect(valueFromBox(box({ text: 'Widget A', xpaths: [] }), 'text')).toEqual({ value: 'Widget A', mark: null });
  });
});

describe('seedPage', () => {
  const boxes = [box({ text: 'Widget A' }), box({ text: '$129.99' }), box({ text: '$129.99' })];
  it('marks a single match, outlines several without marking, and fills page data without an outline', () => {
    const r = seedPage(grid(), 0, {
      title: { value: 'Widget A', via: { source: 'json-ld', path: 'name' }, boxes: [0] },
      price: { value: '129.99', via: { source: 'json-ld', path: 'offers.price' }, boxes: [1, 2] },
      image: { value: 'https://s.example/a.jpg', via: { source: 'meta', path: 'og:image' }, boxes: [] },
    }, boxes, 'suggested');
    expect(r.grid.rows[0]!.expected[0]).toBe('Widget A');
    expect(r.grid.rows[0]!.marks[0]?.xpaths).toEqual(['//x']);
    expect(r.sources.title).toEqual({ kind: 'suggested', via: 'json-ld' });
    expect(r.grid.rows[1]!.marks[0]).toBeNull();
    expect(r.sources.price).toEqual({ kind: 'several', count: 2 });
    expect(r.outlines.price).toEqual([1, 2]);
    expect(r.sources.image).toEqual({ kind: 'page-data', via: 'meta' });
    expect(r.outlines.image ?? []).toEqual([]);
  });
  it('never overwrites a cell that already has a value', () => {
    const g = grid();
    g.rows[0] = setCellValue(g.rows[0]!, 0, 'Typed title');
    const r = seedPage(g, 0, { title: { value: 'Widget A', via: { source: 'json-ld', path: 'name' }, boxes: [0] } }, boxes, 'suggested');
    expect(r.grid.rows[0]!.expected[0]).toBe('Typed title');
    expect(r.sources.title).toBeUndefined();
  });
  it('labels a transferred value as from page 1', () => {
    const r = seedPage(grid(), 1, { title: { value: 'Widget B', via: { source: 'xpath', path: '//h1' }, boxes: [0] } }, boxes, 'from-page-1');
    expect(r.sources.title).toEqual({ kind: 'from-page-1' });
    expect(r.grid.rows[0]!.expected[1]).toBe('Widget B');
  });
});

describe('the rest of the mark screen', () => {
  it('labels each source the way the spec words it', () => {
    expect(sourceLabel({ kind: 'suggested', via: 'json-ld' }, true)).toBe('suggested · from JSON-LD');
    expect(sourceLabel({ kind: 'suggested', via: 'meta' }, true)).toBe('suggested · from meta tags');
    expect(sourceLabel({ kind: 'suggested', via: 'api' }, true)).toBe("suggested · from the page's data");
    expect(sourceLabel({ kind: 'several', count: 3 }, true)).toBe('found in 3 places, click the right one');
    expect(sourceLabel({ kind: 'page-data', via: 'json-ld' }, true)).toBe('page data');
    expect(sourceLabel({ kind: 'from-page-1' }, true)).toBe('from page 1');
    expect(sourceLabel({ kind: 'clicked' }, true)).toBe('clicked');
    expect(sourceLabel({ kind: 'typed' }, true)).toBe('typed');
    expect(sourceLabel(undefined, false)).toBe('click it on the page, or type it');
    expect(sourceLabel(undefined, true)).toBe('saved');
  });
  it('finds the next empty row after the one just filled, wrapping round', () => {
    const g = grid();
    g.rows[1] = setCellValue(g.rows[1]!, 0, '129.99');
    expect(nextUnfilled(g, 0, 0)).toBe(2);
    expect(nextUnfilled(g, 0, 2)).toBe(0);
    g.rows[0] = setCellValue(g.rows[0]!, 0, 'A'); g.rows[2] = setCellValue(g.rows[2]!, 0, 'https://s.example/a.jpg');
    expect(nextUnfilled(g, 0, 0)).toBeNull();
  });
  it('lists what stops a page being finished', () => {
    const g = grid();
    g.rows[1] = setCellValue(g.rows[1]!, 0, 'free');
    expect(pageProblems(g, 0)).toEqual(['Title: Expected value is required', 'Price: Not a money amount', 'Image: Expected value is required']);
  });
  it('lets a page past the third leave fields blank, but not all of them', () => {
    const g = { ...grid(), urls: [...grid().urls, 'https://s.example/4'], rows: grid().rows.map((r) => ({ ...r, expected: [...r.expected, ''], marks: [...r.marks, null] })) };
    expect(pageProblems(g, 3)).toEqual(['Mark at least one field on this page, or remove it']);
    g.rows[0] = setCellValue(g.rows[0]!, 3, 'Widget D');
    expect(pageProblems(g, 3)).toEqual([]);
  });
  it('draws an answer only over the capture it was computed from', () => {
    expect(answerIsCurrent({ captureId: 'a' }, 'a')).toBe(true);
    expect(answerIsCurrent({ captureId: 'a' }, 'b')).toBe(false);
    expect(answerIsCurrent(undefined, 'a')).toBe(false);
  });
});
```

Create `schema-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './schema-draft';
import { emptyRow } from './schema-grid';

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}

describe('the draft', () => {
  it('round-trips a grid per website and clears it', () => {
    const s = memory();
    const grid = { urls: ['https://s/1', '', ''], listingUrl: 'https://s/l', rows: [{ ...emptyRow(3), key: 'k', name: 'T' }] };
    saveDraft('site-1', grid, s);
    expect(loadDraft('site-1', s)).toEqual(grid);
    expect(loadDraft('site-2', s)).toBeNull();
    clearDraft('site-1', s);
    expect(loadDraft('site-1', s)).toBeNull();
  });
  it('answers null for a corrupt or wrongly shaped entry, and never throws on a storage that does', () => {
    const s = memory();
    s.setItem('robot.schema-draft.site-1', '{not json');
    expect(loadDraft('site-1', s)).toBeNull();
    s.setItem('robot.schema-draft.site-1', JSON.stringify({ urls: 'nope' }));
    expect(loadDraft('site-1', s)).toBeNull();
    const broken = { ...memory(), getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as Storage;
    expect(loadDraft('site-1', broken)).toBeNull();
    expect(() => saveDraft('site-1', { urls: [], listingUrl: '', rows: [] }, broken)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/schema-stepper-view.test.ts src/lib/site/mark-view.test.ts src/lib/site/schema-draft.test.ts`
Expected: FAIL — modules and exports missing.

- [ ] **Step 3: Implement**

`schema-stepper-view.ts` (keep `sharedNote`, `addNote`):

```ts
// The Schema tab's stepper as pure decisions (spec 2026-09-18 §2): 1 · Fields,
// 2 · Pages, 3 · Mark, then the proof sheet.
import type { StepState } from './extract-view';

export type SchemaStep = 'fields' | 'pages' | 'mark' | 'sheet';
export type PagesReady = 'yes' | 'no' | 'loading';
type Facts = { fieldCount: number; hasBinding: boolean; pagesReady: PagesReady };
const ORDER: SchemaStep[] = ['fields', 'pages', 'mark', 'sheet'];

export function stepOf(search: { step?: string }, f: Facts): SchemaStep {
  if (f.fieldCount === 0) return 'fields';
  switch (search.step) {
    case 'fields': return 'fields';
    case 'pages': return 'pages';
    // 'loading' keeps the mark screen: a reload on step 3 must not bounce to step 2 while the slots are still being asked about.
    case 'mark': return f.pagesReady === 'no' ? 'pages' : 'mark';
    case 'sheet': return f.hasBinding ? 'sheet' : 'pages';
    default: return f.hasBinding ? 'sheet' : 'pages';
  }
}

/** Can the customer open this step from the strip right now? */
function reachable(step: SchemaStep, f: Facts): boolean {
  if (step === 'fields') return true;
  if (f.fieldCount === 0) return false;
  if (step === 'pages') return true;
  if (step === 'mark') return f.pagesReady !== 'no';
  return f.hasBinding;
}

export function stepStates(step: SchemaStep, f: Facts): [StepState, StepState, StepState, StepState] {
  const at = ORDER.indexOf(step);
  return ORDER.map((s, i): StepState => {
    if (i === at) return 'current';
    if (!reachable(s, f)) return 'later';
    // Step 1 open: everything after it is a place you can go, not a place you have been.
    if (step === 'fields') return 'locked';
    return i < at ? 'done' : 'locked';
  }) as [StepState, StepState, StepState, StepState];
}

export type SlotState = 'empty' | 'starting' | 'capturing' | 'captured' | 'failed';

export function slotState(url: string, capture: { status: 'capturing' | 'captured' | 'failed' } | null | undefined): SlotState {
  if (!url.trim()) return 'empty';
  if (!capture) return 'starting';
  return capture.status;
}

export function pagesReadyOf(urls: string[], slots: SlotState[], loading: boolean): PagesReady {
  if (urls.length > 0 && slots.length === urls.length && slots.every((s) => s === 'captured')) return 'yes';
  if (loading || slots.some((s) => s === 'starting' || s === 'capturing')) return 'loading';
  return 'no';
}
```

Note on the `stepStates` test `['done','current','later','later']` for pages with `pagesReady: 'no'`: `'no'` makes mark unreachable (`later`), and no binding makes sheet `later` — as the code above does. For `('mark', hasBinding false)` the sheet is `later` and fields/pages are `done`.

`mark-view.ts`:

```ts
// The mark screen's decisions (spec 2026-09-18 §2.3, §3.3, §3.4), pure so they
// are testable without a browser. The screen itself is `components/schema/mark-step.tsx`.
import { URL_MIN, setCellValue, validateExpectedClient, type GridFieldType, type GridState, type Mark } from './schema-grid';

/** One entry of a proof page's box map — mirrors `@robot/scraper`'s `Box`. */
export type Box = { xpaths: string[]; text: string; rect: Mark['rect']; tag: string; kind: 'text' | 'image' | 'link'; src?: string; href?: string };

type Via = 'api' | 'json-ld' | 'meta';
export type CellSource =
  | { kind: 'clicked' } | { kind: 'typed' } | { kind: 'saved' } | { kind: 'from-page-1' }
  | { kind: 'suggested'; via: Via } | { kind: 'page-data'; via: Via } | { kind: 'several'; count: number };

const VIA_LABEL: Record<Via, string> = { 'json-ld': 'from JSON-LD', meta: 'from meta tags', api: "from the page's data" };

export function sourceLabel(s: CellSource | undefined, hasValue: boolean): string {
  if (!s) return hasValue ? 'saved' : 'click it on the page, or type it';
  switch (s.kind) {
    case 'clicked': return 'clicked';
    case 'typed': return 'typed';
    case 'saved': return 'saved';
    case 'from-page-1': return 'from page 1';
    case 'suggested': return `suggested · ${VIA_LABEL[s.via]}`;
    case 'page-data': return 'page data';
    case 'several': return `found in ${s.count} places, click the right one`;
  }
}

/**
 * What a click on `box` writes into a field of `type`. Image fields take the
 * element's `src`, URL fields its `href`, everything else its own text. A mark
 * for an image or link carries no text: its value lives in `src`/`href`, and
 * the API keeps such a mark without comparing text (binding-input.ts).
 */
export function valueFromBox(box: Box, type: GridFieldType): { value: string; mark: Mark | null } | { error: string } {
  const mark = (text: string): Mark | null => (box.xpaths.length ? { xpaths: box.xpaths.slice(0, 3), text, rect: box.rect } : null);
  if (type === 'image') return box.kind === 'image' && box.src ? { value: box.src, mark: mark('') } : { error: 'This element is not an image' };
  if (type === 'url') return box.kind === 'link' && box.href ? { value: box.href, mark: mark('') } : { error: 'This element is not a link' };
  const text = box.text.trim();
  return text ? { value: text, mark: mark(box.text) } : { error: 'This element has no text' };
}

export type Seed = { value: string; via: { source: string; path: string }; boxes: number[] };

/**
 * Fill a page's empty cells from `suggestMarks` (page 1) or `transferMarks`
 * (pages 2+). One box: the value with that element as its mark. Several: the
 * value, every box outlined, no mark — the customer clicks the right one.
 * None: the value alone ("page data"). A cell that already has a value is the
 * customer's and is left alone.
 */
export function seedPage(grid: GridState, pageIndex: number, seeds: Record<string, Seed | null>, boxes: Box[], origin: 'suggested' | 'from-page-1') {
  const sources: Record<string, CellSource> = {};
  const outlines: Record<string, number[]> = {};
  const rows = grid.rows.map((row) => {
    const seed = row.key ? seeds[row.key] : null;
    if (!seed || !row.key || (row.expected[pageIndex] ?? '').trim() !== '') return row;
    const via = (['api', 'json-ld', 'meta'].includes(seed.via.source) ? seed.via.source : 'json-ld') as Via;
    const drawable = seed.boxes.filter((i) => boxes[i]);
    if (drawable.length === 1) {
      const picked = valueFromBox(boxes[drawable[0]!]!, row.type);
      sources[row.key] = origin === 'from-page-1' ? { kind: 'from-page-1' } : { kind: 'suggested', via };
      outlines[row.key] = drawable;
      return setCellValue(row, pageIndex, seed.value, 'mark' in picked ? picked.mark : null);
    }
    if (drawable.length > 1) {
      sources[row.key] = { kind: 'several', count: drawable.length };
      outlines[row.key] = drawable;
      return setCellValue(row, pageIndex, seed.value);
    }
    sources[row.key] = origin === 'from-page-1' ? { kind: 'from-page-1' } : { kind: 'page-data', via };
    return setCellValue(row, pageIndex, seed.value);
  });
  return { grid: { ...grid, rows }, sources, outlines };
}

export function nextUnfilled(grid: GridState, pageIndex: number, afterRow: number): number | null {
  const n = grid.rows.length;
  for (let step = 1; step <= n; step++) {
    const i = (afterRow + step) % n;
    if ((grid.rows[i]!.expected[pageIndex] ?? '').trim() === '') return i;
  }
  return null;
}

/** The first-line reasons Next/Finish is off for this page, in row order. */
export function pageProblems(grid: GridState, pageIndex: number): string[] {
  const optional = pageIndex >= URL_MIN;
  if (optional && grid.rows.every((r) => (r.expected[pageIndex] ?? '').trim() === '')) return ['Mark at least one field on this page, or remove it'];
  const out: string[] = [];
  for (const r of grid.rows) {
    const v = r.expected[pageIndex] ?? '';
    if (optional && v.trim() === '') continue;
    const err = validateExpectedClient(r.type, v);
    if (err) out.push(`${r.name}: ${err}`);
  }
  return out;
}

/** An answer's box indices point into the capture it names; drawn over any other capture they outline the wrong elements. */
export function answerIsCurrent(answer: { captureId: string } | null | undefined, slotCaptureId: string | null | undefined): boolean {
  return !!answer && !!slotCaptureId && answer.captureId === slotCaptureId;
}
```

`schema-draft.ts`:

```ts
// The Schema tab's unsaved pages and marks, per website, in this browser only.
// A binding cannot be saved until every page has its values (the API refuses
// a partial one), so without this a reload in the middle of marking would lose
// every click. Wrapped in try/catch throughout: storage can be absent or deny.
import type { GridState } from './schema-grid';

const key = (sourceId: string) => `robot.schema-draft.${sourceId}`;
const store = (s?: Storage) => s ?? (typeof window === 'undefined' ? undefined : window.localStorage);

export function saveDraft(sourceId: string, grid: GridState, storage?: Storage): void {
  try { store(storage)?.setItem(key(sourceId), JSON.stringify(grid)); } catch { /* a draft is a convenience */ }
}

export function loadDraft(sourceId: string, storage?: Storage): GridState | null {
  try {
    const raw = store(storage)?.getItem(key(sourceId));
    if (!raw) return null;
    const g = JSON.parse(raw) as GridState;
    const ok = Array.isArray(g?.urls) && typeof g.listingUrl === 'string' && Array.isArray(g.rows)
      && g.rows.every((r) => Array.isArray(r.expected) && Array.isArray(r.marks) && r.expected.length === g.urls.length && r.marks.length === g.urls.length);
    return ok ? g : null;
  } catch { return null; }
}

export function clearDraft(sourceId: string, storage?: Storage): void {
  try { store(storage)?.removeItem(key(sourceId)); } catch { /* nothing to do */ }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/` and `pnpm --filter @robot/app exec tsc --noEmit`
Expected: PASS. `tsc` will now fail in `sites/$site/index.tsx` (old `stepOf`/`stepStates` signatures, two-cell strip). Keep the route compiling with the smallest bridge: pass `{ fieldCount, hasBinding: !!savedGrid, pagesReady: 'yes' }` and take the first two states. Task 7 replaces it.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/site/schema-stepper-view.ts packages/app/src/lib/site/schema-stepper-view.test.ts packages/app/src/lib/site/mark-view.ts packages/app/src/lib/site/mark-view.test.ts packages/app/src/lib/site/schema-draft.ts packages/app/src/lib/site/schema-draft.test.ts "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
git commit -m "feat(app): the stepper's four views, the mark screen's decisions, and a per-website draft"
```

---

### Task 4: App — step 2, Pages, with background captures

**Files:**
- Create: `packages/app/src/lib/site/use-proof-captures.ts`
- Create: `packages/app/src/components/schema/page-slot.tsx`
- Create: `packages/app/src/components/schema/pages-step.tsx`

**Interfaces:**
- Consumes: `sources.proofPageCaptures`, `sources.captureProofPage`, `sources.proofPageCapture`, `sources.checkListingPage` (tRPC); `slotState`, `pagesReadyOf`, `SlotState`, `PagesReady` (Task 3); `GridState`, `addPage`, `removePage`, `canAddPage`, `URL_MIN`, `shortUrl` (Task 2 / existing).
- Produces:
  - `useProofCaptures(sourceId: string | undefined, urls: string[]): { slots: SlotState[]; captures: Array<ProofCapture | null>; captureIds: Array<string | null>; pagesReady: PagesReady; retry(index: number): void }` where `ProofCapture` is `proofPageCapture`'s output (`{ url, status, tiles, boxes, pageHeight, capturedHeight, contentHeight, error?, capturedAt? }`).
  - `<PagesStep grid onGrid captures={ReturnType<typeof useProofCaptures>} extractOwnsInput onNext />` — `onNext()` is called by the Next button; the route navigates.

**Behaviour** (spec §2.2; the listing check is `checkListingPage` alone — its `sample` is the same ranked list `findProductPages` returns, so one page load instead of two):

- `useProofCaptures`:
  1. `trpc.sources.proofPageCaptures.useQuery({ sourceId, urls: nonEmptyUrls }, { enabled: !!sourceId && nonEmptyUrls.length > 0 })` → the newest known capture per URL.
  2. Local `started: Record<url, captureId>` state. An effect: for each non-empty URL whose lookup answered `null` and that is not in `started`, call `captureProofPage.mutateAsync({ sourceId, url })` once and record the id. A mutation error records `{ status: 'failed', error: message }` for that URL locally.
  3. The id per URL is `started[url] ?? lookup[url]?.captureId ?? null`. Poll each with `trpc.useQueries((t) => ids.map((id) => t.sources.proofPageCapture({ captureId: id! }, { enabled: !!id, refetchInterval: (q) => (q.state.data?.status === 'capturing' ? 2000 : false) })))`.
  4. `retry(i)`: `captureProofPage` again for `urls[i]`, replace `started[urls[i]]`.
  5. `slots[i] = slotState(urls[i], capture ?? lookupState)`; `pagesReady = pagesReadyOf(urls, slots, lookup.isPending)`.
- `PageSlot` (one per URL, in a responsive grid — `grid gap-3 sm:grid-cols-3`): a panel with a 2 px top rail (`bg-line` empty/starting, `bg-text` capturing, `bg-pass` captured, `bg-warn` failed); the thumbnail (`tiles[0]` via the existing `screenshotHref` idiom, `API_URL` prefix; `object-cover object-top`, fixed `h-[180px]`) once captured, a skeleton while capturing with "Taking a screenshot…", the reason in `text-warn` plus **Try again** when failed; the short URL in mono with its full URL as `title`; **Swap** opens an inline URL input (Enter or "Use this page" commits, Escape cancels). An empty slot is the URL input itself with placeholder `https://shop.example/p/…`. Slots 4–6 carry **Remove**.
- `PagesStep`, top to bottom:
  1. "Listing page" input (mono) + **Find product pages** (spinner while running). On success: `productLinks === 0` → note "No product links found on this page. Paste three product pages below." and the slots become plain inputs; otherwise the first `URL_MIN` of `sample` fill the empty slots (never overwrite a filled slot), and a line reads "{productLinks} product links found{pagerSeen ? ' · a pager too' : ''}". The listing URL goes into `grid.listingUrl` either way (spec: kept).
  2. A **No listing page** link-button that hides the listing input and clears `grid.listingUrl`.
  3. When `extractOwnsInput` (`source.parameters.inputMode` is `'listing'` or `'detail'`): a muted line "The Extract tab already has its own pages; this listing only finds proof pages here." (spec §2.2: the stepper leaves the tab's pages alone — `updateBinding` already skips the input-set sync in that case, so nothing else is needed.) Otherwise the listing URL reaches the Extract tab through `updateBinding`'s existing sync when the binding is saved; `setListingPages` is **not** called (it would set `inputMode` and take the input away from the proof pages for good).
  4. The slots. **Add page** (disabled past six, reason "Six pages is the most a website can be checked on").
  5. Footer: **Next: mark** — enabled when `pagesReady === 'yes'`; otherwise the reason: "Every page needs a URL" / "Waiting for screenshots ({n} of {m})" / "A page could not be captured: try again or swap it".
- Every URL change goes through `onGrid` with `addPage`/`removePage`/a `urls` map so each row's `expected` and `marks` stay the same width. Swapping a URL clears that page's column (values and marks) — they described the old page.
- A URL off the website's host shows "All pages must be on the same website" under its slot (reuse `bindingProblems`' host rule: compare `new URL(u).hostname.toLowerCase()` to the first filled slot's).

- [ ] **Step 1: Write the component and hook** as described, following `components/extract/extract-pages.tsx` for the listing input and `components/schema/page-header-cell.tsx` for URL-input idioms (`h-8 font-mono text-[16px] md:text-sm`).

- [ ] **Step 2: Add a pure helper test for the column clear on swap** — put `replacePageUrl(state: GridState, index: number, url: string): GridState` in `schema-grid.ts` (blank the column's `expected` and `marks` when the URL actually changed) and test it in `schema-grid.test.ts`:

```ts
it('replacing a page url clears that page column and nothing else', () => {
  const row = setCellValue(setCellValue({ ...emptyRow(3), key: 'k', name: 'T' }, 0, 'A', MARK), 1, 'B', MARK);
  const s = replacePageUrl({ urls: ['https://s/1', 'https://s/2', 'https://s/3'], listingUrl: '', rows: [row] }, 1, 'https://s/9');
  expect(s.urls[1]).toBe('https://s/9');
  expect(s.rows[0]!.expected).toEqual(['A', '', '']);
  expect(s.rows[0]!.marks).toEqual([MARK, null, null]);
  expect(replacePageUrl(s, 1, 'https://s/9')).toBe(s);
});
```

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/schema-grid.test.ts` — FAIL, then implement:

```ts
export function replacePageUrl(state: GridState, index: number, url: string): GridState {
  const u = url.trim();
  if (index < 0 || index >= state.urls.length || state.urls[index] === u) return state;
  const urls = state.urls.map((x, i) => (i === index ? u : x));
  return { ...state, urls, rows: state.rows.map((r) => setCellValue(r, index, '')) };
}
```

— PASS.

- [ ] **Step 3: Typecheck** — `pnpm --filter @robot/app exec tsc --noEmit`. Expected: clean. (The step is mounted in Task 7; this task's browser proof is the smoke in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/lib/site/use-proof-captures.ts packages/app/src/components/schema/page-slot.tsx packages/app/src/components/schema/pages-step.tsx packages/app/src/lib/site/schema-grid.ts packages/app/src/lib/site/schema-grid.test.ts
git commit -m "feat(app): the Pages step — a listing fills three slots, each captured in the background"
```

---

### Task 5: App — the page viewer

**Files:**
- Create: `packages/app/src/lib/site/page-viewer-view.ts` (+ `.test.ts`)
- Create: `packages/app/src/components/schema/page-viewer.tsx`

**Interfaces:**
- Consumes: `Box` (Task 3).
- Produces:
  - `boxAt(boxes: Box[], x: number, y: number): number | null` — the smallest-area box containing the page-pixel point (the innermost element).
  - `enclosing(boxes: Box[], index: number): number | null` — the smallest box strictly larger than `index` that contains its rect (Alt: "widen to its parent").
  - `toPage(clientX: number, clientY: number, frame: { left: number; top: number; scale: number }): { x: number; y: number }`
  - `<PageViewer tiles: string[] boxes: Box[] capturedHeight pageHeight outlines: number[] active: number | null onPick(index: number): void />`

- [ ] **Step 1: Write the failing test** `page-viewer-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boxAt, enclosing, toPage } from './page-viewer-view';
import type { Box } from './mark-view';

const b = (x: number, y: number, w: number, h: number): Box => ({ xpaths: ['//x'], text: 't', rect: { x, y, w, h }, tag: 'div', kind: 'text' });
const boxes = [b(0, 0, 1000, 1000), b(100, 100, 300, 100), b(120, 120, 50, 20)];

describe('the viewer geometry', () => {
  it('picks the innermost box under the point', () => {
    expect(boxAt(boxes, 130, 125)).toBe(2);
    expect(boxAt(boxes, 300, 150)).toBe(1);
    expect(boxAt(boxes, 900, 900)).toBe(0);
    expect(boxAt(boxes, 2000, 10)).toBeNull();
  });
  it('widens to the enclosing box', () => {
    expect(enclosing(boxes, 2)).toBe(1);
    expect(enclosing(boxes, 1)).toBe(0);
    expect(enclosing(boxes, 0)).toBeNull();
  });
  it('maps a pointer to page pixels through the scale', () => {
    expect(toPage(150, 60, { left: 50, top: 10, scale: 0.5 })).toEqual({ x: 200, y: 100 });
  });
});
```

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/page-viewer-view.test.ts` — FAIL.

- [ ] **Step 2: Implement** `page-viewer-view.ts`:

```ts
// Hit-testing for the mark screen's screenshot. Rects are page pixels (the
// box map's own coordinates); the viewer scales the tiles to fit its column.
import type { Box } from './mark-view';

const area = (bx: Box) => bx.rect.w * bx.rect.h;
const contains = (o: Box['rect'], x: number, y: number) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
const inside = (inner: Box['rect'], outer: Box['rect']) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export function boxAt(boxes: Box[], x: number, y: number): number | null {
  let best: number | null = null;
  boxes.forEach((bx, i) => {
    if (bx.rect.w <= 0 || bx.rect.h <= 0 || !contains(bx.rect, x, y)) return;
    if (best === null || area(bx) < area(boxes[best]!)) best = i;
  });
  return best;
}

export function enclosing(boxes: Box[], index: number): number | null {
  const self = boxes[index];
  if (!self) return null;
  let best: number | null = null;
  boxes.forEach((bx, i) => {
    if (i === index || area(bx) <= area(self) || !inside(self.rect, bx.rect)) return;
    if (best === null || area(bx) < area(boxes[best]!)) best = i;
  });
  return best;
}

export function toPage(clientX: number, clientY: number, frame: { left: number; top: number; scale: number }) {
  return { x: (clientX - frame.left) / frame.scale, y: (clientY - frame.top) / frame.scale };
}
```

Run the test — PASS.

- [ ] **Step 3: Write `page-viewer.tsx`**:
  - A scrollable column (`max-h-[calc(100vh-220px)] overflow-auto rounded-[6px] border border-line bg-raised`). Inside, a `relative` stack of the tile `<img>`s (`block w-full`, `draggable={false}`, `alt=""` except the first: `alt="Screenshot of this page"`). Scale = rendered width ÷ the first tile's `naturalWidth` (read on its `onLoad`; recompute with a `ResizeObserver` on the stack).
  - An absolutely positioned overlay the size of the stack. Outlines are `div`s at `rect × scale`: the hovered box `outline outline-1 outline-text`, each `outlines[]` box `outline outline-2 outline-link`, the `active` row's marked box `outline outline-2 outline-pass`. No fills (spec §4: no washes).
  - `onPointerMove`: `toPage` from `getBoundingClientRect()` of the stack, `boxAt`, then `enclosing` repeatedly while `event.altKey` is held (one level per Alt press is enough: widen once when `altKey`). `onPointerLeave` clears hover. `onClick`: `onPick(hovered)` when a box is hovered.
  - Keyboard: the overlay is not focusable; the rows' text inputs are the keyboard path (spec §2.3: every value is also typed).
  - Below the stack, when `pageHeight > capturedHeight` (and `pageHeight > 0`): a muted line "Page cut at {capturedHeight} px".
  - `prefers-reduced-motion`: nothing here animates.

- [ ] **Step 4: Typecheck** — `pnpm --filter @robot/app exec tsc --noEmit`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/site/page-viewer-view.ts packages/app/src/lib/site/page-viewer-view.test.ts packages/app/src/components/schema/page-viewer.tsx
git commit -m "feat(app): the page viewer — the screenshot with the element under the pointer outlined"
```

---

### Task 6: App — step 3, Mark

**Files:**
- Create: `packages/app/src/components/schema/mark-rows.tsx`
- Create: `packages/app/src/components/schema/mark-step.tsx`

**Interfaces:**
- Consumes: `PageViewer` (Task 5); `useProofCaptures` output (Task 4); `valueFromBox`, `seedPage`, `nextUnfilled`, `pageProblems`, `answerIsCurrent`, `sourceLabel`, `CellSource`, `Box` (Task 3); `setCellValue`, `GridState` (Task 2); `sources.suggestMarks` (query), `sources.transferMarks` (mutation, with `from`, Task 1); `cellStatusFor`, `VerificationResults` (`lib/site/verification-view.ts`).
- Produces: `<MarkStep grid onGrid sourceId captures pageIndex onPage(i: number) initialField?: string results: VerificationResults | null finish={{ label, disabled, reason?, busy, onClick }} saveOnly={{ disabled, reason?, busy, onClick }} />`

**Behaviour** (spec §2.3):

- Layout: `grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]` — the viewer left, the rows right (`sticky top-4`). Above both: "Page {i+1} of {n}" in mono, the short URL, and page tabs (`1 2 3 …`, each a button; a page with `pageProblems` empty carries a small check).
- `MarkRows`: one row per field — name, type label, a text input with the value (`aria-label="{name} on page {i+1}"`, the same name the smoke already uses), the source line (`sourceLabel`), and the `validateExpectedClient` message in `text-fail` when the value is not blank and fails. The selected row wears a `border-l-2 border-text` rail. Clicking a row selects it. After a verification exists (`results?.[key]`), a second line shows that page's cell result from `cellStatusFor` as a 2 px rail colour (pass/fail) and its hint.
- Selection starts on `initialField` (a key) when given, else the first empty row, else row 0.
- A pick from the viewer: `valueFromBox(boxes[i], row.type)`; an `error` shows under the selected row for 4 s and changes nothing; otherwise `onGrid(setCellValue(row, pageIndex, value, mark))`, source `{ kind: 'clicked' }`, outline that box, and select `nextUnfilled(…)` (stay put when it is `null`).
- Typing: `setCellValue(row, pageIndex, text)` (clears the mark), source `{ kind: 'typed' }`.
- **Page 1, on open**: `trpc.sources.suggestMarks.useQuery({ captureId }, { enabled: !!captureId && pageIndex === 0 })`. When it lands and `answerIsCurrent(data, captureId)`, apply `seedPage(grid, 0, data.fields, boxes, 'suggested')` once per captureId (a ref of seeded capture ids), merge its `sources` and `outlines` into local state.
- **Pages 2+, on first open**: `transferMarks.mutateAsync({ sourceId, fromUrl: urls[0], toUrls: urls.slice(1).filter(captured), from })` where `from` is built from the grid's page-1 column (`{ [key]: { value: expected[0], ...(marks[0] ? { mark: marks[0] } : {}) } }`). Do it once when the customer first leaves page 1 (the spec's "on leaving page 1"), store the per-URL answers, and seed each page with `seedPage(grid, i, answer.fields, boxes, 'from-page-1')` when that page opens, only if `answerIsCurrent(answer, captureIds[i])`. A `null` answer (no fresh capture) seeds nothing. Show "Carrying page 1 across…" while in flight; an error shows its message with **Try again** and leaves the rows empty for typing/clicking.
- Footer: **Next page** (enabled when `pageProblems(grid, pageIndex)` is empty; else its first entry as the reason) → `onPage(pageIndex + 1)`. On the last page, two buttons: **Save without verifying** (`saveOnly`) and `finish.label` (the route passes the existing `verifyButton` label — "Verify 8 fields · free" / "… · up to $0.12" — so the price is on the button before the click; spec §2.3 says Verify runs automatically after the last page, and this plan makes it the explicit click instead because of the budget rule).
- Keep the component's per-page `sources`/`outlines` state keyed by `captureId`, so a re-capture forgets the old outlines.

- [ ] **Step 1: Write `mark-rows.tsx` and `mark-step.tsx`** as described.
- [ ] **Step 2: Typecheck and run the app's unit tests** — `pnpm --filter @robot/app exec tsc --noEmit && pnpm --filter @robot/app test -- --maxWorkers=2`. Expected: clean and green.
- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/schema/mark-rows.tsx packages/app/src/components/schema/mark-step.tsx
git commit -m "feat(app): the Mark step — click each field on the screenshot, pages 2 and 3 carried from page 1"
```

---

### Task 7: App — the Schema route wired: four views, the proof sheet, arrivals

**Files:**
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`
- Modify: `packages/app/src/components/schema/stepper-strip.tsx`
- Modify: `packages/app/src/components/schema/page-header-cell.tsx`, `packages/app/src/components/schema/schema-grid.tsx`
- Modify: `packages/app/src/components/project/add-website-dialog.tsx`, `packages/app/src/components/runs/run-misses.tsx`
- Modify: `packages/app/src/lib/site/schema-grid.ts` (+ test) — `planArrival` wording

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `SchemaSearch = { step?: 'fields' | 'pages' | 'mark' | 'sheet'; page?: number; field?: string; addPage?: string }` (all optional — see the existing comment on why).

**Changes:**

1. **Search.** `validateSearch` accepts the four steps, `page` as a positive integer (1-based in the URL, 0-based in code), `field`, `addPage`.
2. **One grid, one draft.** Seed as today, then: `const draft = loadDraft(source.id)`; when a draft exists and differs from `fromSource(source)` (compare `toBindingInput`), seed from the draft and show a muted line on every step, "Unsaved pages and marks from earlier are restored · **Discard**" (Discard → `clearDraft`, reseed from the server). An effect saves the draft whenever `dirty`; `handleSave` and `handleVerify` call `clearDraft(source.id)` after a successful `updateBinding`. `toBindingInput(grid)` now carries marks, so both saves round-trip them.
3. **Captures.** `const proof = useProofCaptures(source?.id, grid.urls)` at the route level — shared by Pages, Mark and the sheet's column heads.
4. **Stepper strip.** `StepperStrip` takes four cells (type `steps: StepCell[]`): `1 · Fields` (detail: n fields · shared note), `2 · Pages` (detail: "{n} pages"; reason "Add a field first"), `3 · Mark` (detail: "{marked} of {fields × pages} values"; reason "Every page needs its screenshot first"), and the proof sheet, rendered with no number, title "Proof sheet" (detail: the existing `stripSummary` line; reason "Mark every page first"). `n` becomes optional on `StepCell`. States from `stepStates(step, { fieldCount, hasBinding: !!savedGrid, pagesReady: proof.pagesReady })`. Every cell links with `search={(s) => ({ ...s, step: cell.step })}` as today.
5. **Views.** `step === 'fields'` → the existing `FieldsPanel` (its Next reads "Next: pages"); `'pages'` → `PagesStep` (Next → `?step=mark&page=1`); `'mark'` → `MarkStep` with `pageIndex = (search.page ?? 1) - 1` clamped to the pages, `onPage` navigating `?page=`, `initialField = search.field`, `finish` = the existing `verify` object's label/disabled/reason with `onClick: async () => { await handleVerify(); navigate step 'sheet' }`, `saveOnly` = `saveButton(…)` with `onClick: async () => { await handleSave(); navigate step 'sheet' }`; `'sheet'` → the existing `StatusStrip` + `SchemaGrid`, **read-only** (`readOnly` always true), with the controls row: **Edit fields** (link to `?step=fields`), **Edit pages** (`?step=pages`), **Import values** (the existing `SchemaImport`), and the existing Save / Verify / Go to Extract in the strip. The "Add page" button leaves the sheet (step 2 owns pages). The problems list, arrival note and error line stay where they are.
6. **Mark again.** `PageHeaderCell` loses its pencil popover (step 2 owns the URLs); in its place a small ghost button "Mark again" (`aria-label="Mark page {n} again"`) calling `onMarkAgain(index)`. `SchemaGrid` takes `onMarkAgain(pageIndex: number, fieldKey?: string)`; a cell whose status is `fail` gets a "Mark again" link in its second line calling `onMarkAgain(pageIndex, row.key)`. The route navigates to `?step=mark&page={pageIndex+1}&field={key}`. Delete the popover's now-unused listing finder (the `onFindPages` prop and the `findPages` mutation in the route).
7. **Arrivals** (spec §2.5). `planArrival` stays the decision; after an `add`, navigate to `?step=pages` (replace) keeping `field`, and set a pending focus `{ page: col, field }`. When `PagesStep`'s Next is clicked with a pending focus, go to `?step=mark&page={col+1}&field={key}` instead of page 1. Update `planArrival`'s notes (and their tests in `schema-grid.test.ts`) to "Added from a run: its screenshot is being taken, then mark {name} on it." / "Added from a run: its screenshot is being taken, then mark the fields on it."
8. **Add website dialog.** On success navigate to the new website's Schema tab with `search: { step: fieldCount === 0 ? 'fields' : 'pages' }` (`fieldCount` from the project query the dialog's parent already has; pass it in as a prop if the dialog does not have it).
9. **The run page's arrival link.** `run-misses.tsx` line ~112 sends `field: field.name`; `planArrival` matches `row.key`. Change it to the field's key (check what `field` holds there; the misses view lists fields by key — `lib/site/run-misses-view.ts`). Add a test in `run-misses-view.test.ts` if the link is built there; otherwise note it in the report.
10. Remove the bridge left by Task 3.

- [ ] **Step 1: Update `planArrival`'s tests** for the new notes, run them (FAIL), change the notes (PASS): `pnpm --filter @robot/app exec vitest run src/lib/site/schema-grid.test.ts`.
- [ ] **Step 2: Make the changes above.**
- [ ] **Step 3: Typecheck, unit tests, and a manual look** — `pnpm --filter @robot/app exec tsc --noEmit && pnpm --filter @robot/app test -- --maxWorkers=2`; then with `pnpm dev:all` running, sign in as a throwaway `check-<ts>@example.com`, create a project + website + one catalogue field, and walk Fields → Pages (paste three URLs of any public product site) → Mark → Save without verifying → sheet. Do not click Verify.
- [ ] **Step 4: Commit**

```bash
git add "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/components/schema/stepper-strip.tsx packages/app/src/components/schema/page-header-cell.tsx packages/app/src/components/schema/schema-grid.tsx packages/app/src/components/project/add-website-dialog.tsx packages/app/src/components/runs/run-misses.tsx packages/app/src/lib/site/schema-grid.ts packages/app/src/lib/site/schema-grid.test.ts
git commit -m "feat(app): the Schema tab is the full stepper — fields, pages, mark, then the proof sheet"
```

(Add `run-misses-view.ts`/its test to the list if they changed.)

---

### Task 8: Smoke, look-only check, a free live run, and the docs

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts`
- Create: `docs/testing/ui-check-app-stepper.mts`
- Create: `docs/testing/2026-09-25-stepper-live.md` (use the actual date)
- Modify: `docs/handoff.md`, `docs/testing/screens/README.md`, `CLAUDE.md` (the `@robot/app` row: the Schema tab is the stepper)

**Smoke** (`pnpm test:ui:app`, needs `pnpm dev:all`): replace "three pages and their values save from the Schema tab" with a walk that needs no outside network:

- In `beforeAll`, start a `node:http` server on `127.0.0.1` (port 0) serving `/l` (a listing page linking `/p/1`, `/p/2`, `/p/3`) and the three product pages. Build the product pages from `SHOP_EXAMPLE` (`../../api/src/test-helpers/shop-example.ts`): its `html`, with the `ldJson` block inserted as `<script type="application/ld+json">…</script>` in a `<head>`, so the real capture finds JSON-LD. Close it in `afterAll`.
- The run's field becomes **Title** (catalogue chip; `SHOP_EXAMPLE` p1's `<h1>` is "Widget A") in addition to **Price**, so one row is suggested and one is clicked.
- Walk: `?step=pages` → fill the listing input with `http://127.0.0.1:<port>/l` → Find product pages → three slots fill → wait (poll, ≤ 90 s) for three thumbnails → Next: mark → page 1: assert the Title row reads "Widget A" with "suggested · from JSON-LD", and that at least one outline element is on screen → click the price element on the screenshot (locate its box by reading `proofPageCapture`'s boxes over tRPC with the smoke's cookie, find the box whose text is `$129.99`, and click the viewer at `rect × scale`) → Next page ×2 (assert page 2's rows arrive "from page 1") → **Save without verifying** → lands on the proof sheet → reload → the sheet shows the three values per field → read the binding over tRPC and assert `verificationSet.marks` has an entry for the clicked price on page 1.
- If the api-server refuses the proof pages because the website was added as `www.example.com` (a host check this plan did not find), add the smoke's website with the local server's URL instead and adjust `WEBSITE_HOST`/`WEBSITE_NAME`.
- Screenshots: `app-site-schema-{pages,mark,sheet}-{dark,light}.png`.
- Never click Verify or the Finish button.

**Look-only check** (`docs/testing/ui-check-app-stepper.mts`, modelled on `ui-check-app-site.mts`): as a throwaway `check-*@example.com`, against the **keyless second api-server on :4100** (memory "Free live checks"): create a project with Ikea's eight catalogue fields, add a website on Ikea (read Ikea's listing URL from the existing Ikea website's `verification_set.listing_url` with a read-only SQL query — do not sign in as Marko, do not write to that website), walk the stepper end to end, and on the last page click **Finish** (keyless, so verification is mechanical-only and free — assert the button reads "· free" before clicking, and abort if it shows a dollar amount). Record per page: capture time, rows pre-filled on page 1 and their sources, rows carried to pages 2 and 3, and the sheet's verified count (the spec's expectation: all eight pre-filled from JSON-LD, 8 of 8 on the sheet). Screenshots `app-site-schema-{pages,mark,sheet}-ikea-{dark,light}.png`. Delete the throwaway project at the end. Write the numbers into `docs/testing/2026-09-2x-stepper-live.md`.

**Docs:** a handoff section "App redesign, plan 5: the stepper (2026-09-2x)" in the house style (what landed per commit, rulings, deviations from the spec — the three below — what the checks found, how to run, open decisions), and a "Read this first" pointer. Deviations to record: (1) `transferMarks` takes page 1 from the client (`from`), because a partial binding cannot be saved; (2) Verify runs on the explicit Finish click that shows its price, not automatically; (3) the listing check is `checkListingPage` alone, and the listing URL reaches the Extract tab through `updateBinding`'s existing input-set sync rather than `setListingPages`.

- [ ] **Step 1: Write the smoke changes; run** `pnpm test:ui:app` with `pnpm dev:all` up. Expected: all green, both themes.
- [ ] **Step 2: Write and run the look-only check** against :4100 as described. Expected: every assertion green; numbers recorded.
- [ ] **Step 3: Full gate** — per package, `pnpm --filter <pkg> test -- --maxWorkers=2` for db, browser, agent, scraper, api, dashboard, api-server, app. Expected: all green.
- [ ] **Step 4: Docs** as above.
- [ ] **Step 5: Commit** (explicit paths: the smoke, the check, the live note, the screenshots you took, handoff, screens README, CLAUDE.md).

```bash
git commit -m "test(app): the stepper in the smoke and a free live run on Ikea; plan 5 recorded"
```
