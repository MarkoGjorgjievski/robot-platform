# MVP Flow Phase 3: Schema Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Schema tab into the screen the customer approved: the table is the page, the three proof pages are its column headers (edited in a popover that can also find pages from a listing), a fixed-height status strip carries the state and the two buttons, every cell reserves a second line so results never shift the layout, the verifying state locks the table with per-column capture progress, red cells say what to do and offer the type fix, and a re-verify says "free" when it is.

**Architecture:** Presentation-only phase on top of the phase 2 contract/binding split. One new pure view module (`schema-tab-view.ts`) computes the strip state, the per-column capture state, the re-verify count and cost label, the cell second line, and the per-field "needs attention / changed" counts from the data the existing procedures already return. Two new components (`StatusStrip`, `PageHeaderCell`) and a rewritten `SchemaGrid` render it. The route file shrinks to wiring. The API gains one small extension to `verifyEstimate` (per-key re-verify cost, and whether captures are fresh) and reuses everything else. The listing URL leaves this tab; it is not shown or edited here any more (phase 4 gives it a home), and the binding keeps whatever `listing_url` it already has.

**Tech Stack:** React 19, TanStack Router/Query, tRPC 11, Tailwind v4, lucide-react, Vitest. Drizzle + Zod on the API side for the one procedure change.

**Spec:** `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`, section 5.6 in full, 5.5 (already done, header untouched), 6 (copy), 10 (tests), 12 (phase 3). The mockups approved in the brainstorm are `.superpowers/brainstorm/1289-1788861057/content/states.html` and `project-model.html` (the second screen).

## Global Constraints

- The table is the page. Above it only the status strip and, when needed, the problems and capture banners. The listing URL, "Find product pages" button and the standalone URL block are removed from this tab; `SchemaUrls` is deleted.
- Column headers: shortened path, page number, pencil. The pencil opens a popover with the full URL input and "Don't have product pages yet? Find some from a listing page" (a listing URL input, a "Find pages" button, up to ten candidates each with "Use as page n"). Editing a URL marks that column's cells stale and never deletes results.
- Status strip: fixed height 38px, always present, summary left, stage next to it, Verify and Extract on the right. States and copy exactly as spec 5.6's table. Nothing renders below the table that was not there before the verify started.
- Verifying: inputs read-only (not greyed; values legible), import faded, each column header shows captured / capturing / queued / not captured, expected cells shimmer, lock note in the strip, both buttons off.
- Every expected cell reserves a second line (min-height) at all times. Green: "from json-ld / api / meta / page"; when the found value differs from the typed one: "page shows X". Red: reason + fix per spec 5.6's five sentences. Grey: "changed since verified". Amber: "page not captured".
- Type-fix chip: on a `not_found` red cell whose expected value parses as an http(s) URL while the field type is `text`, the row shows a chip "Set type to url" that calls `datasets.retypeField`; on `PRECONDITION_FAILED` the chip's error says which website has verified the field.
- Re-verify label: "Re-verify n fields · free" when the estimate says captures are fresh and no field in the re-verify set needs AI; else "Re-verify n fields · up to $x". First verify keeps "Verify · up to $x" / "Verify · mechanical only".
- Extract button: label and behaviour unchanged from today (Probe & sample / Extract / Extract everything); off with tooltip "Unlocks when every cell is green" until `status.current && status.allPassed`.
- Copy: sentence case; every button says what happens; every disabled control has a reason within one line; customer-facing text never says "source", "dataset", "input set".
- No new dependencies; the popover is a positioned `<div>` closed by Escape and outside-click.
- Visual tokens stay the current ones (IBM Plex, teal, the existing `card`/`btn-*` utilities); phase 5 restyles. Status colours: emerald / red / amber / gray as today, but as a 3px left border plus faint tint, not a filled cell (this matches the approved rail treatment and needs no new tokens).
- Tests: pure view logic under `packages/dashboard/src/lib/*.test.ts`; `pnpm test:ui` covers the tab; `pnpm -r --workspace-concurrency=1 test` is the gate.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AZ6EysmV6fcq3FxP33KFsw`. Windows, Git Bash; `npx pnpm` if the launcher fails.

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `packages/api/src/routers/sources.ts` | `verifyEstimate` gains `capturesFresh`, `perFieldUsd`, and accepts `onlyKeys?` to price a re-verify | Modify |
| `packages/api/src/routers/sources-verify.test.ts` | tests for the estimate extension | Modify |
| `packages/dashboard/src/lib/schema-tab-view.ts` | pure: `stripState`, `columnStates`, `cellLine`, `verifyButton`, `typeFixSuggestion`, `stripSummary` | Create |
| `packages/dashboard/src/lib/schema-tab-view.test.ts` | tests | Create |
| `packages/dashboard/src/lib/verification-view.ts` | `hintFor` copy updated to spec 5.6 sentences; `summaryLine` replaced by `stripSummary` (deleted) | Modify |
| `packages/dashboard/src/lib/verification-view.test.ts` | copy tests updated | Modify |
| `packages/dashboard/src/components/status-strip.tsx` | the 38px strip | Create |
| `packages/dashboard/src/components/page-header-cell.tsx` | column header with pencil popover + find-from-listing | Create |
| `packages/dashboard/src/components/schema-grid.tsx` | rewritten: header cells, reserved second line, rail+tint, read-only mode, shimmer, type-fix chip | Rewrite |
| `packages/dashboard/src/components/schema-urls.tsx` | | Delete |
| `packages/dashboard/src/routes/source-schema.tsx` | wiring only | Rewrite |
| `packages/dashboard/src/routes-smoke.test.ts` | asserts the strip and a header cell | Modify |
| `packages/dashboard/src/styles.css` | `.cell-rail-*` and `.shimmer` utilities, `prefers-reduced-motion` guard | Modify |
| `docs/handoff.md`, `CLAUDE.md` | phase note | Modify |

---

### Task 1: `verifyEstimate` prices a re-verify and reports capture freshness

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (`verifyEstimate`)
- Modify: `packages/api/src/routers/sources-verify.test.ts`

**Interfaces:**
- Produces: `sources.verifyEstimate({ sourceId, onlyKeys?: string[] }) → { fields, upperBoundUsd, aiAvailable, stallMs, capturesFresh: boolean, perFieldUsd: number }` where `fields` is the count of keys that would run (`onlyKeys?.length ?? all`), `upperBoundUsd = aiAvailable ? fields * perFieldUsd : 0`, and `capturesFresh` is true when the latest completed error-free verification has a capture ref for every current URL younger than `CAPTURE_REUSE_MAX_AGE_MS` with a non-empty `captureId`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/routers/sources-verify.test.ts` (it already has `caller`, a helper that builds a project+website through `createProjectWithSource`, and cleanup; reuse them):

```ts
describe('sources.verifyEstimate re-verify pricing', () => {
  it('prices only the keys asked for and reports fresh captures from the latest clean run', async () => {
    const f = await createProjectWithSource(caller, {
      tag: `est-${Date.now()}`,
      fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
      expected: { Price: { [u(0)]: '1', [u(1)]: '2', [u(2)]: '3' }, Title: { [u(0)]: 'a', [u(1)]: 'b', [u(2)]: 'c' } },
    });
    cleanups.push(f.cleanup);
    const all = await caller.sources.verifyEstimate({ sourceId: f.sourceId });
    expect(all.fields).toBe(2);
    expect(all.capturesFresh).toBe(false);
    expect(all.perFieldUsd).toBeGreaterThan(0);

    const now = new Date().toISOString();
    await db.insert(sourceVerifications).values({
      sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), results: {},
      captures: Object.fromEntries(f.urls.map((url) => [url, { captureId: 'c', capturedAt: now }])),
    });
    const one = await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [f.keys.Price!] });
    expect(one.fields).toBe(1);
    expect(one.capturesFresh).toBe(true);
    expect(one.upperBoundUsd).toBe(one.aiAvailable ? one.perFieldUsd : 0);
  });
  it('captures are not fresh when one url is missing or blocked', async () => {
    const f = await createProjectWithSource(caller, { tag: `est2-${Date.now()}`, fields: [{ name: 'Price', type: 'money' }], expected: { Price: { [u(0)]: '1', [u(1)]: '2', [u(2)]: '3' } } });
    cleanups.push(f.cleanup);
    const now = new Date().toISOString();
    await db.insert(sourceVerifications).values({
      sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), results: {},
      captures: { [f.urls[0]!]: { captureId: 'c', capturedAt: now }, [f.urls[1]!]: { captureId: '', capturedAt: now, blockedReason: 'blocked' } },
    });
    expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId })).capturesFresh).toBe(false);
  });
});
```

`u(i)` is the helper's URL builder; if the file has none, define `const u = (i: number) => f.urls[i]!` inside each test after `f` exists (adjust the object literals accordingly). `cleanups` is whatever array the file's `afterEach` drains; match its name.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @robot/api exec vitest run src/routers/sources-verify.test.ts -t "re-verify pricing"`
Expected: FAIL: `capturesFresh` undefined; `onlyKeys` rejected by Zod.

- [ ] **Step 3: Implement**

Replace `verifyEstimate` in `sources.ts` with:

```ts
  verifyEstimate: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), onlyKeys: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { schemaDefinition: true, verificationSet: true },
      });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      const allKeys = Array.isArray(source.schemaDefinition) ? (source.schemaDefinition as SchemaDefinitionField[]).map((f) => f.key) : [];
      const fields = input.onlyKeys ? input.onlyKeys.filter((k) => allKeys.includes(k)).length : allKeys.length;
      const aiAvailable = !!process.env.ANTHROPIC_API_KEY;

      // Fresh captures make a re-verify free of browser time and, when no
      // field needs AI, free of money too (spec 5.6 re-verify label).
      const urls = (source.verificationSet as VerificationSet | null)?.urls ?? [];
      const last = await ctx.db.query.sourceVerifications.findFirst({
        where: and(eq(sourceVerifications.sourceId, input.sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
        orderBy: [desc(sourceVerifications.completedAt)],
        columns: { captures: true },
      });
      const refs = (last?.captures ?? {}) as Record<string, { captureId?: string; capturedAt?: string }>;
      const capturesFresh = urls.length > 0 && urls.every((url) => {
        const ref = refs[url];
        return !!ref?.captureId && !!ref.capturedAt && Date.now() - Date.parse(ref.capturedAt) < CAPTURE_REUSE_MAX_AGE_MS;
      });

      return {
        fields,
        perFieldUsd: EST_AI_COST_PER_FIELD_USD,
        upperBoundUsd: aiAvailable ? fields * EST_AI_COST_PER_FIELD_USD : 0,
        aiAvailable,
        capturesFresh,
        stallMs: VERIFY_STALL_MS,
      };
    }),
```

Add `isNotNull`, `isNull` to the `drizzle-orm` import and `CAPTURE_REUSE_MAX_AGE_MS` to the `@robot/scraper` import if missing. Keep the existing comment about `stallMs`.

- [ ] **Step 4: Run and typecheck**

Run: `pnpm --filter @robot/api exec vitest run src/routers/sources-verify.test.ts && pnpm --filter @robot/api typecheck`
Expected: PASS. The dashboard still compiles (it reads `upperBoundUsd`, `aiAvailable`, `stallMs`, all still present).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/sources.ts packages/api/src/routers/sources-verify.test.ts
git commit -m "feat(api): verifyEstimate prices a scoped re-verify and reports capture freshness"
```

---

### Task 2: Pure view module for the Schema tab

**Files:**
- Create: `packages/dashboard/src/lib/schema-tab-view.ts`, `packages/dashboard/src/lib/schema-tab-view.test.ts`
- Modify: `packages/dashboard/src/lib/verification-view.ts` (`hintFor` copy; delete `summaryLine`), `verification-view.test.ts`

**Interfaces (all pure, no React):**

```ts
export type StripState = 'none' | 'editing' | 'active' | 'stalled' | 'failed' | 'results';
export type ColumnState = 'idle' | 'queued' | 'capturing' | 'captured' | 'not_captured';
export type CellLine = { tone: 'pass' | 'fail' | 'stale' | 'not_captured' | 'none'; text: string };

/** Which strip to show. `results` needs a completed clean run whose `results` are non-empty; `editing` is a never-verified or dirty-with-no-results source. */
export function stripState(args: { verification: VerificationState; results: VerificationResults | null; dirty: boolean }): StripState;

/** Per proof page, during and after a run. During `active`, uses the stage text ("capturing 2/3") and the captures map; after, `captured` or `not_captured`. */
export function columnStates(args: { urls: string[]; state: StripState; stage: string | null; captures: Record<string, { captureId?: string; blockedReason?: string }> }): ColumnState[];

/** "Not verified yet · n fields · 3 pages" | "Verifying" | "n of m fields verified · k need attention · j changed since" | ... per spec 5.6. */
export function stripSummary(args: { state: StripState; fieldCount: number; pageCount: number; currentKeys: string[]; failingKeys: string[]; staleKeys: string[] }): string;

/** The reserved second line of an expected cell. */
export function cellLine(status: CellStatus | null, typed: string): CellLine;

/** Verify/Re-verify button label + enabled flag. */
export function verifyButton(args: { state: StripState; firstRun: boolean; reverifyCount: number; capturesFresh: boolean; aiAvailable: boolean; upperBoundUsd: number; complete: boolean; busy: boolean }): { label: string; disabled: boolean; reason?: string };

/** Spec 5.6's type-fix chip: a not_found cell whose typed value is an http(s) URL on a text field. */
export function typeFixSuggestion(row: { type: string; expected: string[] }, cells: Array<CellStatus | null>): 'url' | null;
```

`hintFor` in `verification-view.ts` changes to the spec 5.6 sentences: `not_found` → "Not found on this page. Check the value, or say where it is."; `different_value` → "This page shows X. Is your value right, or does the page show it differently?"; `ambiguous` → "Several places match. Add what makes yours different to the description."; `type_mismatch` unchanged. `summaryLine` is deleted (its tests too; `stripSummary` replaces it).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/dashboard/src/lib/schema-tab-view.test.ts
import { describe, it, expect } from 'vitest';
import { stripState, columnStates, stripSummary, cellLine, verifyButton, typeFixSuggestion } from './schema-tab-view';

describe('stripState', () => {
  it('maps verification state and results', () => {
    expect(stripState({ verification: 'none', results: null, dirty: false })).toBe('editing');
    expect(stripState({ verification: 'active', results: null, dirty: false })).toBe('active');
    expect(stripState({ verification: 'stalled', results: null, dirty: false })).toBe('stalled');
    expect(stripState({ verification: 'failed', results: null, dirty: false })).toBe('failed');
    expect(stripState({ verification: 'done', results: {}, dirty: false })).toBe('editing');
    expect(stripState({ verification: 'done', results: { price: fv(true) }, dirty: true })).toBe('results');
  });
});

describe('columnStates', () => {
  const urls = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
  it('is idle before any run', () => expect(columnStates({ urls, state: 'editing', stage: null, captures: {} })).toEqual(['idle', 'idle', 'idle']));
  it('follows the capture stage while active', () => {
    expect(columnStates({ urls, state: 'active', stage: 'capturing 2/3', captures: {} })).toEqual(['captured', 'capturing', 'queued']);
    expect(columnStates({ urls, state: 'active', stage: 'searching', captures: {} })).toEqual(['captured', 'captured', 'captured']);
  });
  it('reads the captures map after a run', () => {
    expect(columnStates({ urls, state: 'results', stage: null, captures: { [urls[0]!]: { captureId: 'a' }, [urls[1]!]: { captureId: '', blockedReason: 'blocked' } } })).toEqual(['captured', 'not_captured', 'idle']);
  });
});

describe('stripSummary', () => {
  it('editing counts fields and pages', () => expect(stripSummary({ state: 'editing', fieldCount: 5, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('Not verified yet · 5 fields · 3 pages'));
  it('results counts verified, attention and changed', () => {
    expect(stripSummary({ state: 'results', fieldCount: 5, pageCount: 3, currentKeys: ['a', 'b', 'c', 'd'], failingKeys: ['e'], staleKeys: [] })).toBe('4 of 5 fields verified · 1 needs attention');
    expect(stripSummary({ state: 'results', fieldCount: 5, pageCount: 3, currentKeys: ['a', 'b', 'c'], failingKeys: ['d'], staleKeys: ['e'] })).toBe('3 of 5 fields verified · 1 needs attention · 1 changed since');
    expect(stripSummary({ state: 'results', fieldCount: 2, pageCount: 3, currentKeys: ['a', 'b'], failingKeys: [], staleKeys: [] })).toBe('2 of 2 fields verified');
    expect(stripSummary({ state: 'results', fieldCount: 1, pageCount: 3, currentKeys: ['a'], failingKeys: [], staleKeys: [] })).toBe('1 of 1 field verified');
  });
  it('other states', () => {
    expect(stripSummary({ state: 'active', fieldCount: 1, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('Verifying');
    expect(stripSummary({ state: 'stalled', fieldCount: 1, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('This verification stalled. Run it again.');
    expect(stripSummary({ state: 'failed', fieldCount: 1, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('The last verification failed');
  });
});

describe('cellLine', () => {
  it('green says where it came from, and what the page shows when it differs', () => {
    expect(cellLine({ status: 'pass', found: '1,000', pathSource: 'json-ld' }, '1,000')).toEqual({ tone: 'pass', text: 'from json-ld' });
    expect(cellLine({ status: 'pass', found: 'US$ 1,000', pathSource: 'page' }, '1,000')).toEqual({ tone: 'pass', text: 'page shows US$ 1,000' });
    expect(cellLine({ status: 'pass', found: '1,000' }, '1,000')).toEqual({ tone: 'pass', text: 'verified' });
  });
  it('red carries the hint, grey and amber their fixed copy, none is blank', () => {
    expect(cellLine({ status: 'fail', reason: 'ambiguous', hint: 'Several places match. Add what makes yours different to the description.' }, 'x')).toEqual({ tone: 'fail', text: 'Several places match. Add what makes yours different to the description.' });
    expect(cellLine({ status: 'stale' }, 'x')).toEqual({ tone: 'stale', text: 'changed since verified' });
    expect(cellLine({ status: 'not_captured' }, 'x')).toEqual({ tone: 'not_captured', text: 'page not captured' });
    expect(cellLine(null, 'x')).toEqual({ tone: 'none', text: '' });
  });
});

describe('verifyButton', () => {
  const base = { state: 'editing' as const, firstRun: true, reverifyCount: 0, capturesFresh: false, aiAvailable: true, upperBoundUsd: 0.25, complete: true, busy: false };
  it('first run shows the upper bound or mechanical only', () => {
    expect(verifyButton(base)).toEqual({ label: 'Verify · up to $0.25', disabled: false });
    expect(verifyButton({ ...base, aiAvailable: false })).toEqual({ label: 'Verify · mechanical only', disabled: false });
  });
  it('re-verify is free with fresh captures and no AI need, else priced', () => {
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 2, capturesFresh: true, upperBoundUsd: 0 })).toEqual({ label: 'Re-verify 2 fields · free', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 1, capturesFresh: true, upperBoundUsd: 0.05 })).toEqual({ label: 'Re-verify 1 field · up to $0.05', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 0, capturesFresh: true, upperBoundUsd: 0 })).toEqual({ label: 'Everything is verified', disabled: true, reason: 'Nothing has changed since the last verification' });
  });
  it('is off while active or busy or incomplete, with a reason', () => {
    expect(verifyButton({ ...base, state: 'active' })).toMatchObject({ disabled: true, reason: 'Verifying' });
    expect(verifyButton({ ...base, busy: true })).toMatchObject({ disabled: true });
    expect(verifyButton({ ...base, complete: false })).toMatchObject({ disabled: true, reason: 'Fill in every page and every cell first' });
  });
});

describe('typeFixSuggestion', () => {
  it('suggests url for a not_found text field whose values are links', () => {
    const cells = [{ status: 'fail' as const, reason: 'not_found' }, { status: 'fail' as const, reason: 'not_found' }, null];
    expect(typeFixSuggestion({ type: 'text', expected: ['https://a.example/x', 'https://a.example/y', 'https://a.example/z'] }, cells)).toBe('url');
    expect(typeFixSuggestion({ type: 'url', expected: ['https://a.example/x', 'https://a.example/y', 'https://a.example/z'] }, cells)).toBeNull();
    expect(typeFixSuggestion({ type: 'text', expected: ['South Col', 'x', 'y'] }, cells)).toBeNull();
    expect(typeFixSuggestion({ type: 'text', expected: ['https://a.example/x', 'https://a.example/y', 'https://a.example/z'] }, [{ status: 'pass' as const, found: 'x' }, null, null])).toBeNull();
  });
});

function fv(passed: boolean) {
  return { key: 'k', cells: {}, certified: passed ? [{}] : [], weakEvidence: false, aiCalled: false, incomplete: false };
}
```

And in `verification-view.test.ts`: update the `hintFor` expectations to the new sentences and delete the `summaryLine` describe.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/schema-tab-view.test.ts src/lib/verification-view.test.ts`
Expected: FAIL: module not found; old hint copy.

- [ ] **Step 3: Implement**

```ts
// packages/dashboard/src/lib/schema-tab-view.ts
// Pure view logic for the Schema tab (spec 5.6). No React, no tRPC.
import type { CellStatus } from '../components/schema-grid';
import type { VerificationResults, VerificationState } from './verification-view';

export type StripState = 'none' | 'editing' | 'active' | 'stalled' | 'failed' | 'results';
export type ColumnState = 'idle' | 'queued' | 'capturing' | 'captured' | 'not_captured';
export type CellLine = { tone: 'pass' | 'fail' | 'stale' | 'not_captured' | 'none'; text: string };

export function stripState(args: { verification: VerificationState; results: VerificationResults | null; dirty: boolean }): StripState {
  switch (args.verification) {
    case 'active': return 'active';
    case 'stalled': return 'stalled';
    case 'failed': return 'failed';
    case 'done': return args.results && Object.keys(args.results).length > 0 ? 'results' : 'editing';
    case 'none': return 'editing';
  }
}

export function columnStates(args: { urls: string[]; state: StripState; stage: string | null; captures: Record<string, { captureId?: string; blockedReason?: string }> }): ColumnState[] {
  const { urls, state, stage, captures } = args;
  if (state === 'active') {
    const m = /^capturing (\d+)\/(\d+)/.exec(stage ?? '');
    if (m) {
      const current = Number(m[1]);
      return urls.map((_, i) => (i + 1 < current ? 'captured' : i + 1 === current ? 'capturing' : 'queued'));
    }
    return urls.map(() => (stage ? 'captured' : 'queued'));
  }
  return urls.map((u) => {
    const ref = captures[u];
    if (!ref) return 'idle';
    return ref.captureId ? 'captured' : 'not_captured';
  });
}

export function stripSummary(args: { state: StripState; fieldCount: number; pageCount: number; currentKeys: string[]; failingKeys: string[]; staleKeys: string[] }): string {
  const { state, fieldCount, pageCount, currentKeys, failingKeys, staleKeys } = args;
  const fields = (n: number) => `${n} field${n === 1 ? '' : 's'}`;
  switch (state) {
    case 'none':
    case 'editing': return `Not verified yet · ${fields(fieldCount)} · ${pageCount} page${pageCount === 1 ? '' : 's'}`;
    case 'active': return 'Verifying';
    case 'stalled': return 'This verification stalled. Run it again.';
    case 'failed': return 'The last verification failed';
    case 'results': {
      const parts = [`${currentKeys.length} of ${fields(fieldCount)} verified`];
      if (failingKeys.length > 0) parts.push(`${failingKeys.length} need${failingKeys.length === 1 ? 's' : ''} attention`);
      if (staleKeys.length > 0) parts.push(`${staleKeys.length} changed since`);
      return parts.join(' · ');
    }
  }
}

export function cellLine(status: CellStatus | null, typed: string): CellLine {
  if (!status) return { tone: 'none', text: '' };
  switch (status.status) {
    case 'pass':
      if (status.found !== undefined && status.found !== typed) return { tone: 'pass', text: `page shows ${status.found}` };
      return { tone: 'pass', text: status.pathSource ? `from ${status.pathSource}` : 'verified' };
    case 'fail': return { tone: 'fail', text: status.hint ?? 'Not found on this page.' };
    case 'stale': return { tone: 'stale', text: 'changed since verified' };
    case 'not_captured': return { tone: 'not_captured', text: 'page not captured' };
  }
}

export function verifyButton(args: { state: StripState; firstRun: boolean; reverifyCount: number; capturesFresh: boolean; aiAvailable: boolean; upperBoundUsd: number; complete: boolean; busy: boolean }): { label: string; disabled: boolean; reason?: string } {
  const { state, firstRun, reverifyCount, capturesFresh, aiAvailable, upperBoundUsd, complete, busy } = args;
  const cost = aiAvailable ? `up to $${upperBoundUsd.toFixed(2)}` : 'mechanical only';
  if (state === 'active') return { label: firstRun ? 'Verify' : 'Re-verify', disabled: true, reason: 'Verifying' };
  if (!complete) return { label: firstRun ? `Verify · ${cost}` : 'Re-verify', disabled: true, reason: 'Fill in every page and every cell first' };
  if (firstRun) return { label: `Verify · ${cost}`, disabled: busy };
  if (reverifyCount === 0) return { label: 'Everything is verified', disabled: true, reason: 'Nothing has changed since the last verification' };
  const n = `${reverifyCount} field${reverifyCount === 1 ? '' : 's'}`;
  const free = capturesFresh && (!aiAvailable || upperBoundUsd === 0);
  return { label: `Re-verify ${n} · ${free ? 'free' : cost}`, disabled: busy };
}

const isHttpUrl = (s: string) => { try { return /^https?:$/.test(new URL(s.trim()).protocol); } catch { return false; } };

export function typeFixSuggestion(row: { type: string; expected: string[] }, cells: Array<CellStatus | null>): 'url' | null {
  if (row.type !== 'text') return null;
  const anyNotFound = cells.some((c) => c?.status === 'fail' && c.reason === 'not_found');
  const anyPass = cells.some((c) => c?.status === 'pass');
  if (!anyNotFound || anyPass) return null;
  return row.expected.every((v) => v.trim() === '' || isHttpUrl(v)) && row.expected.some((v) => isHttpUrl(v)) ? 'url' : null;
}
```

Note on `verifyButton` when `firstRun` and the re-verify would be free: spec says the first run keeps its upper bound; the "free" wording is for re-verifies only. Note on `stripState('done', results: {})`: a completed run with empty results (a crash leftover closed out cleanly) reads as `editing`.

Update `hintFor` in `verification-view.ts` and delete `summaryLine`.

- [ ] **Step 4: Run and typecheck**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/ && pnpm --filter @robot/dashboard typecheck`
Expected: lib tests pass; typecheck fails only in `source-schema.tsx` on `summaryLine` (fixed in Task 5).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/schema-tab-view.ts packages/dashboard/src/lib/schema-tab-view.test.ts packages/dashboard/src/lib/verification-view.ts packages/dashboard/src/lib/verification-view.test.ts
git commit -m "feat(dashboard): pure view logic for the Schema tab strip, columns, cells, buttons"
```

---

### Task 3: Status strip and page header cell components; styles

**Files:**
- Create: `packages/dashboard/src/components/status-strip.tsx`, `packages/dashboard/src/components/page-header-cell.tsx`
- Modify: `packages/dashboard/src/styles.css`

**Interfaces:**

```tsx
export function StatusStrip(props: {
  summary: string;
  stage?: string | null;           // right of the summary, muted
  progress?: number | null;        // 0..1 while active, renders a bar
  lockNote?: string | null;        // "table locked while verifying"
  tone?: 'neutral' | 'warn' | 'error';
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void; onDisabledClick?: () => void };
  extract: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void };
}): JSX.Element;

export function PageHeaderCell(props: {
  index: number;                   // 0-based
  url: string;
  state: ColumnState;
  blockedReason?: string;
  screenshotUrl?: string | null;
  disabled: boolean;               // during a run
  onChange: (url: string) => void;
  onFindPages: (listingUrl: string) => Promise<string[]>;
}): JSX.Element;                   // renders inside a <th>
```

- [ ] **Step 1: Styles**

Append to `styles.css`:

```css
/* Schema tab: status rail on expected cells (3px left border + faint tint), never a filled cell. */
@utility cell-rail-pass { @apply border-l-[3px] border-l-emerald-600 bg-emerald-50/60; }
@utility cell-rail-fail { @apply border-l-[3px] border-l-red-600 bg-red-50/60; }
@utility cell-rail-stale { @apply border-l-[3px] border-l-gray-400 bg-gray-100/70; }
@utility cell-rail-not-captured { @apply border-l-[3px] border-l-amber-500 bg-amber-50/60; }
@utility cell-rail-none { @apply border-l-[3px] border-l-transparent; }

/* Shimmer for cells whose result is pending. Still under prefers-reduced-motion. */
@utility shimmer {
  background: linear-gradient(90deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.09) 50%, rgba(0,0,0,0.04) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .shimmer { animation: none; } }
```

- [ ] **Step 2: `status-strip.tsx`**

```tsx
// packages/dashboard/src/components/status-strip.tsx
import { Loader2, ArrowRight, Lock } from 'lucide-react';

/** The Schema tab's fixed-height status strip (spec 5.6): summary, stage, progress, lock note, and the two buttons. Never changes height. */
export function StatusStrip({ summary, stage, progress, lockNote, tone = 'neutral', verify, extract }: {
  summary: string; stage?: string | null; progress?: number | null; lockNote?: string | null; tone?: 'neutral' | 'warn' | 'error';
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void; onDisabledClick?: () => void };
  extract: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void };
}) {
  const toneClass = tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-gray-200 bg-white text-gray-900';
  return (
    <div className={`flex h-[38px] items-center gap-3 rounded-lg border px-3 text-sm ${toneClass}`} role="status" aria-live="polite">
      <span className="font-medium">{summary}</span>
      {progress !== null && progress !== undefined && (
        <span className="relative inline-block h-1.5 w-28 overflow-hidden rounded bg-gray-200" aria-hidden>
          <span className="absolute inset-y-0 left-0 bg-accent-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      {stage && <span className="truncate text-xs text-gray-500">{stage}</span>}
      <span className="ml-auto flex flex-shrink-0 items-center gap-2">
        {lockNote && <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Lock className="h-3 w-3" />{lockNote}</span>}
        <span onClick={() => { if (verify.disabled) verify.onDisabledClick?.(); }} title={verify.disabled ? verify.reason : undefined}>
          <button type="button" className="btn-quiet h-7" disabled={verify.disabled} onClick={verify.onClick}>
            {verify.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{verify.label}
          </button>
        </span>
        <span title={extract.disabled ? extract.reason : undefined}>
          <button type="button" className="btn-primary h-7 text-xs" disabled={extract.disabled} onClick={extract.onClick}>
            {extract.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}{extract.label}
          </button>
        </span>
      </span>
    </div>
  );
}
```

- [ ] **Step 3: `page-header-cell.tsx`**

```tsx
// packages/dashboard/src/components/page-header-cell.tsx
import { useEffect, useRef, useState } from 'react';
import { Pencil, Loader2, Check, AlertTriangle, Clock } from 'lucide-react';
import { shortUrl, URL_COUNT } from '../lib/schema-grid';
import { screenshotUrl } from '../lib/screenshot-url';
import type { ColumnState } from '../lib/schema-tab-view';

const STATE_LABEL: Record<ColumnState, string> = { idle: '', queued: 'queued', capturing: 'capturing…', captured: 'captured', not_captured: 'not captured' };

/** A proof-page column header (spec 5.6): shortened path, page number, capture state, and a pencil that opens the URL popover with "find pages from a listing". */
export function PageHeaderCell({ index, url, state, blockedReason, screenshotUrl: shot, disabled, onChange, onFindPages }: {
  index: number; url: string; state: ColumnState; blockedReason?: string; screenshotUrl?: string | null; disabled: boolean;
  onChange: (url: string) => void; onFindPages: (listingUrl: string) => Promise<string[]>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [listing, setListing] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!open) setDraft(url); }, [url, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) commit(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft(url); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  });

  function commit() {
    const next = draft.trim();
    if (next !== url) onChange(next);
    setOpen(false);
  }

  async function find() {
    setFindError(null); setCandidates([]); setFinding(true);
    try { setCandidates(await onFindPages(listing.trim())); } catch (err) { setFindError(err instanceof Error ? err.message : String(err)); } finally { setFinding(false); }
  }

  const icon = state === 'captured' ? <Check className="h-3 w-3 text-emerald-600" /> : state === 'capturing' ? <Loader2 className="h-3 w-3 animate-spin text-gray-500" /> : state === 'queued' ? <Clock className="h-3 w-3 text-gray-400" /> : state === 'not_captured' ? <AlertTriangle className="h-3 w-3 text-amber-600" /> : null;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1 font-mono text-xs font-medium text-gray-700" title={url || undefined}>
        <span className="truncate">{url ? shortUrl(url) : `Page ${index + 1}`}</span>
        {!disabled && <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Edit page ${index + 1}`} title="Edit this page" className="text-gray-300 hover:text-gray-600"><Pencil className="h-3 w-3" /></button>}
      </div>
      <div className="mt-0.5 flex h-4 items-center gap-1 font-sans text-[11px] font-normal text-gray-500" title={blockedReason}>
        {icon}<span>{state === 'not_captured' && blockedReason ? `not captured: ${blockedReason}` : STATE_LABEL[state] || `page ${index + 1}`}</span>
        {state === 'not_captured' && shot && <a href={screenshotUrl(shot) ?? '#'} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">screenshot</a>}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg" role="dialog" aria-label={`Page ${index + 1}`}>
          <label className="block text-xs text-gray-600">Page {index + 1}
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs focus:border-accent-500 focus:outline-none" placeholder="https://shop.example/p/…" />
          </label>
          <p className="mt-3 text-xs text-gray-600">Don't have product pages yet? Find some from a listing page.</p>
          <div className="mt-1 flex gap-1">
            <input value={listing} onChange={(e) => setListing(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs focus:border-accent-500 focus:outline-none" placeholder="https://shop.example/category" />
            <button type="button" className="btn-quiet h-7 flex-shrink-0" disabled={finding || !listing.trim()} onClick={find}>{finding ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Find pages</button>
          </div>
          {findError && <p className="mt-1 text-xs text-red-700">{findError}</p>}
          {candidates.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
              {candidates.map((c) => (
                <li key={c} className="flex items-center gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-gray-600" title={c}>{c}</span>
                  <button type="button" className="btn-quiet px-1.5 py-0 text-[10px]" onClick={() => { setDraft(c); onChange(c); setOpen(false); }}>Use as page {index + 1}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-quiet h-7" onClick={() => { setDraft(url); setOpen(false); }}>Cancel</button>
            <button type="button" className="btn-primary h-7 text-xs" onClick={commit}>Use this page</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

`URL_COUNT` import is unused if not referenced; drop it. The candidate list only offers "Use as page n" for THIS column (the popover is per column), which is simpler than the old three-button row and matches the mockup.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @robot/dashboard typecheck` (the two components are not yet imported; they must compile on their own).

```bash
git add packages/dashboard/src/components/status-strip.tsx packages/dashboard/src/components/page-header-cell.tsx packages/dashboard/src/styles.css
git commit -m "feat(dashboard): status strip and page header cell for the Schema tab; cell rail and shimmer utilities"
```

---

### Task 4: `SchemaGrid` rewrite

**Files:**
- Rewrite: `packages/dashboard/src/components/schema-grid.tsx`
- Delete: `packages/dashboard/src/components/schema-urls.tsx`

**Interfaces:**

```tsx
export type CellStatus = { status: 'pass' | 'fail' | 'not_captured' | 'stale'; found?: string; reason?: string; hint?: string; weak?: boolean; pathSource?: string };
export function SchemaGrid(props: {
  state: GridState;
  onChange: (next: GridState) => void;
  cellStatus?: (rowId: string, urlIndex: number) => CellStatus | null;
  columnStates: ColumnState[];
  captures: Record<string, { blockedReason?: string; screenshotUrl?: string }>;
  readOnly: boolean;                // verifying: inputs readOnly, values legible
  pending: boolean;                 // verifying: expected cells shimmer
  onFindPages: (listingUrl: string) => Promise<string[]>;
  typeFix?: (rowId: string) => { suggested: 'url'; onApply: () => void; pending: boolean; error?: string } | null;
}): JSX.Element;
```

Behaviour: columns Field (read-only, mono), Type (read-only), "Where it is on this website" (editable), then `URL_COUNT` page columns whose `<th>` renders `PageHeaderCell`. No delete column, no Add row, no name/type editing at all (the contract owns them; the `locked` prop is gone because it is always true here). Keyboard: Tab/Enter/arrows move across description and expected cells only (columns 2..2+URL_COUNT); Enter on the last row does nothing (no ghost rows). Paste of a block still fills description/expected cells starting at the focused cell but never creates rows (clip to existing rows). Each expected cell: `<input readOnly={readOnly}>` with the rail class from `cellLine(...).tone`, then `<p className="min-h-[14px] text-[11px] …">{line.text}</p>` always rendered. The `weak` note ("weak evidence: same value on every page") goes into the second line after the main text when present, separated by " · ". When `pending`, the expected input gets `shimmer` and its second line is blank. The type-fix chip renders under the Field cell when `typeFix(rowId)` returns a suggestion: `<button className="btn-quiet …">Set type to url</button>` with a spinner while pending and the error text under it.

- [ ] **Step 1: Rewrite the file**

Write the component per the interface above. Reuse `applyPaste` and `parseBlock` from `lib/schema-grid.ts` but clip rows: after `applyPaste`, `rows: next.rows.slice(0, state.rows.length)`. Reuse `validateExpectedClient` for the inline red border on a typed-but-invalid cell (that message goes into the second line with tone `fail` only when there is no verification status for the cell; a verification result wins). Header `<th>` for page columns: `<th className="px-2 py-1 text-left align-top"><PageHeaderCell index={i} url={u} state={columnStates[i] ?? 'idle'} blockedReason={captures[u]?.blockedReason} screenshotUrl={captures[u]?.screenshotUrl} disabled={readOnly} onChange={(url) => onChange({ ...state, urls: state.urls.map((x, j) => (j === i ? url : x)) })} onFindPages={onFindPages} /></th>`.

- [ ] **Step 2: Delete `schema-urls.tsx`**

```bash
git rm packages/dashboard/src/components/schema-urls.tsx
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @robot/dashboard typecheck`
Expected: errors only in `source-schema.tsx` (it still imports `SchemaUrls`, `summaryLine`, and passes `locked`/`disabled`); Task 5 fixes it.

- [ ] **Step 4: Commit**

```bash
git add -A packages/dashboard/src/components
git commit -m "feat(dashboard): SchemaGrid with page header cells, reserved second line, status rail, read-only and pending modes"
```

---

### Task 5: The route: wiring only

**Files:**
- Rewrite: `packages/dashboard/src/routes/source-schema.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4; `sources.verifyEstimate({ sourceId, onlyKeys? })`; `datasets.retypeField`; `sources.listByProject` rows carry `datasetId`.

- [ ] **Step 1: Rewrite**

Keep from the current file: the queries (`listQuery`, `statusQuery` with its poll), the seeding effect (all three branches), `isDirty`, `problems`, `contractEmpty`, `cellStatus` (add the AI-unavailable suffix as today), `handleVerify` (unchanged logic), `handleExtract` (unchanged), the early returns, the empty-contract `EmptyState`, the problems box, the stalled/failed banners are REMOVED (their content moves into the strip's `tone` and summary), the capture-failed banners are REMOVED (their content moves into the header cells). Remove `SchemaUrls`, `SchemaImport` stays (faded while active: wrap in `<div className={active ? 'pointer-events-none opacity-40' : ''}>`), the project-link sentence stays above the table.

New wiring:

```tsx
const results = (status?.results ?? null) as VerificationResults | null;
const vState = verificationState(status, { stallMs });
const strip = stripState({ verification: vState, results, dirty: isDirty });
const active = strip === 'active';
const currentKeys = status?.currentKeys ?? [];
const keyed = grid.rows.filter((r) => r.key);
const staleKeys = keyed.filter((r) => isRowStale(r, savedGrid)).map((r) => r.key!);
const failingKeys = keyed.filter((r) => !staleKeys.includes(r.key!) && results?.[r.key!] && results[r.key!]!.certified.length === 0).map((r) => r.key!);
const reverify = reverifyKeys(results, grid, savedGrid);            // undefined = everything
const reverifyCount = reverify === undefined ? keyed.length : reverify.length;
const firstRun = strip === 'editing' || strip === 'none';
const estimateQuery = trpc.sources.verifyEstimate.useQuery({ sourceId: source?.id ?? '', ...(firstRun ? {} : { onlyKeys: reverify ?? undefined }) }, { enabled: !!source });
const estimate = estimateQuery.data;
const verify = verifyButton({ state: strip, firstRun, reverifyCount, capturesFresh: !!estimate?.capturesFresh, aiAvailable: !!estimate?.aiAvailable, upperBoundUsd: estimate?.upperBoundUsd ?? 0, complete: isComplete(grid) && !contractEmpty, busy: verifyBusy });
const columns = columnStates({ urls: grid.urls, state: strip, stage: status?.stage ?? null, captures });
const progress = active ? (() => { const m = /^capturing (\d+)\/(\d+)/.exec(status?.stage ?? ''); return m ? (Number(m[1]) - 1) / Number(m[2]) : status?.stage ? 0.9 : 0.05; })() : null;
const summary = stripSummary({ state: strip, fieldCount: keyed.length, pageCount: URL_COUNT, currentKeys, failingKeys, staleKeys });
const stage = active ? (status?.stage ?? 'starting') : strip === 'failed' ? (status?.errorMessage ?? null) : null;
const tone = strip === 'stalled' ? 'warn' : strip === 'failed' ? 'error' : 'neutral';
```

Note the estimate query must be declared before `statusQuery` uses `stallMs` today; keep `stallMs` on a separate, unscoped `verifyEstimate` call (`{ sourceId }` only) declared first, as the file does now, and add the second scoped query for pricing. Two queries are fine.

The type-fix chip:

```tsx
const retype = trpc.datasets.retypeField.useMutation({ onSuccess: () => { utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }); utils.datasets.invalidate(); } });
function typeFix(rowId: string) {
  const row = grid.rows.find((r) => r.id === rowId);
  if (!row?.key || !source?.datasetId) return null;
  const cells = grid.urls.map((_, i) => cellStatus(rowId, i));
  const suggested = typeFixSuggestion(row, cells);
  if (!suggested) return null;
  return { suggested, pending: retype.isPending && retype.variables?.key === row.key, error: retype.error && retype.variables?.key === row.key ? retype.error.message : undefined, onApply: () => retype.mutate({ datasetId: source.datasetId!, key: row.key!, type: 'url' }) };
}
```

After a successful retype the seeding effect will not re-run (initialized); update the grid row's type locally in `onSuccess` as well: `setGrid((g) => ({ ...g, rows: g.rows.map((r) => (r.key === vars.key ? { ...r, type: 'url' } : r)) }))` using the mutation's variables.

Render:

```tsx
<div className="mt-6 space-y-4">
  {showProblems && <div className="rounded border border-red-200 bg-red-50 p-3 text-xs"><ul className="list-inside list-disc text-red-700">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
  {contractEmpty ? (<EmptyState … as today />) : (
    <>
      <StatusStrip summary={summary} stage={stage} progress={progress} lockNote={active ? 'table locked while verifying' : null} tone={tone}
        verify={{ label: verify.label, disabled: verify.disabled, reason: verify.reason, busy: verifyBusy, onClick: handleVerify, onDisabledClick: () => setTouched(true) }}
        extract={{ label: extractLabel, disabled: !extractEnabled || extractPending, reason: 'Unlocks when every cell is green', busy: extractPending, onClick: handleExtract }} />
      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}
      <div className={active ? 'pointer-events-none opacity-40' : ''}>
        <SchemaImport … as today />
        {importIgnored.length > 0 && …}
      </div>
      <p className="text-xs text-gray-500">Field names and types come from the project. <Link …>Edit fields on the project page.</Link></p>
      <div className="card p-4">
        <SchemaGrid state={grid} onChange={updateGrid} cellStatus={cellStatus} columnStates={columns} captures={captures} readOnly={active} pending={active} onFindPages={async (u) => (await findMutation.mutateAsync({ listingUrl: u })).urls} typeFix={typeFix} />
      </div>
    </>
  )}
</div>
```

Copy check: the grid's Field column header says "Field", Type says "Type", the description column says "Where it is on this website". Nothing says "source".

- [ ] **Step 2: Typecheck, unit tests, browser**

Run: `pnpm --filter @robot/dashboard typecheck && pnpm --filter @robot/dashboard test`. With both servers up open `http://localhost:3456/projects/acne/sources/ikea`: the strip reads "0 of 8 fields verified …" or "Not verified yet …" depending on the lifted state; the three page headers show the shortened Ikea paths with pencils; clicking a pencil opens the popover; Escape closes it; the Re-verify button shows a count and "free" if captures are fresh, else a cost. Do not click Verify if it shows a cost.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/routes/source-schema.tsx
git commit -m "feat(dashboard): Schema tab is the table: status strip, page header cells, reserved cell lines, type-fix chip"
```

---

### Task 6: Free re-verify on Ikea, smoke, docs

**Files:**
- Modify: `packages/dashboard/src/routes-smoke.test.ts`, `docs/handoff.md`, `CLAUDE.md`

- [ ] **Step 1: Prove the verifying state live, for free**

With both servers up, on the Ikea Schema tab: if the button reads "Re-verify … · free", click it and watch: the strip shows "Verifying" with the progress bar and stage, the three headers move through captured / capturing / queued or all "captured" at "searching", cells shimmer, import fades; on completion the strip shows "8 of 8 fields verified" and every cell has a rail and a second line. Take one screenshot per state with the smoke test's Playwright (`page.screenshot({ path: 'docs/testing/screens/schema-tab-<state>.png' })` from a small ad-hoc script, or the agent-browser CLI) and save them under `docs/testing/screens/`. If the button shows a cost instead of "free" (captures older than a day), skip the click, say so in the report, and take the editing-state screenshot only. Never click a paid Verify.

- [ ] **Step 2: Smoke**

In the create-flow test, after the existing assertions add: `expect(await page.getByRole('status').count(), 'the status strip is missing').toBeGreaterThan(0);` and `expect(await page.getByLabel('Edit page 1').count(), 'page 1 header has no pencil').toBeGreaterThan(0);`. Run `pnpm test:ui`.

- [ ] **Step 3: Docs and gate**

`docs/handoff.md`: add "MVP flow phase 3 (2026-09-10)" under phase 2: the Schema tab is the table; page URLs are column headers with a popover that also finds pages from a listing; the listing URL is no longer edited on this tab (phase 4 gives it a home on Extract; the binding's `listing_url` is preserved untouched by `updateBinding` only if the grid still carries it, so state explicitly whether `toBindingInput` drops it: it does not, `listingUrl` is still in `GridState` and round-trips); the strip states; the reserved second line; the type-fix chip; `verifyEstimate` re-verify pricing; screenshots location; the Ikea re-verify result. `CLAUDE.md`: no change unless a command changed (none).

Run: `pnpm -r --workspace-concurrency=1 test`. Commit:

```bash
git add packages/dashboard/src/routes-smoke.test.ts docs/handoff.md docs/testing/screens
git commit -m "test,docs: Schema tab smoke assertions, phase 3 screenshots and handoff"
```

---

## Self-review

**Spec 5.6 coverage:** table is the page (Task 5); Field/Type read-only with the project note (Tasks 4, 5); column headers with path, page number, pencil, popover with find-from-listing and "Use as page n", URL edit marks the column stale via existing `isRowStale`/`reverifyKeys` (Task 3, 4; staleness of a URL change is already `undefined` re-verify = everything, which is stricter than "that column" and accepted); status strip fixed height with the five states and copy (Tasks 2, 3, 5); verifying-state locks, per-column capture state, shimmer, lock note (Tasks 3, 4, 5); reserved second line with the pass/fail/stale/not-captured copy (Tasks 2, 4); the five red sentences (Task 2 `hintFor`); type-fix chip via `retypeField` with the "which website" error (Tasks 2, 5); re-verify label rule with "free" (Tasks 1, 2, 5); ghost row gone, paste/import by name only (Task 4; import was already by name in phase 2). Spec 6 copy rules (all tasks). Spec 10 tests: pure view tests (Task 2), api test (Task 1), smoke (Task 6), screenshots (Task 6).

**Deviations, deliberate:** a URL change re-verifies everything rather than only that column (existing, safer behaviour, kept); the listing URL disappears from this tab before phase 4 gives it a home (the value is preserved in the binding; only the input is gone); the popover offers "Use as page n" for its own column only.

**Placeholder scan:** none.

**Type consistency:** `ColumnState`, `StripState`, `CellLine` (Task 2) used by Tasks 3, 4, 5; `CellStatus` stays exported from `schema-grid.tsx` and imported by `schema-tab-view.ts` and `verification-view.ts`; `verifyEstimate`'s new fields (Task 1) read in Task 5; `PageHeaderCell`/`StatusStrip` props (Task 3) match their use in Tasks 4 and 5.
