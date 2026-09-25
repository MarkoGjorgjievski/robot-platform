# App redesign plan 5 — the Verification tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the website's Schema tab in `@robot/app` with the Verification tab: a listing input that fills a grid of product cards, the selected product's screenshot where a click marks an element and names its field, suggestions carried across products, a fields sidebar with a per-product battery and the Verify verdict, and autosave from the first tick.

**Architecture:** The engine exists (proof-page captures with a box map, `suggestMarks`, `transferMarks`, marks in the binding and in certification). The API gains a few additive pieces: draft saves, stored cards, a Verify completeness check, listing products with title and image, a per-URL capture lookup, a capture→org guard, a concurrency cap on captures, and `transferMarks` answering from the values on screen. The screen is built on a new pure model, `lib/site/verification-model.ts` (a `Board` of cards, answers and descriptors; derived segments, badges and the Verify gate), with thin components over it. The old grid, stepper and import code are deleted.

**Tech Stack:** TanStack Start + Router, tRPC v11 react-query, Tailwind v4 tokens, shadcn/ui (popover, select), vitest; Drizzle + Postgres for API tests; Playwright (real Chromium) for the listing script test, the smoke and the live check.

**Spec:** `docs/superpowers/specs/2026-09-25-verification-tab-design.md` (read it whole). Engine background: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md` §3. Visual system: `docs/superpowers/specs/2026-09-21-app-redesign-design.md` §4. Handoff sections "Schema stepper, engine" and "App redesign, plan 3" say what exists.

## Global Constraints

- Customer wording only: "website", "field", "product", "page", "run", "organisation". Never "source", "binding", "dataset", "capture", "box", "draft" on screen.
- Sentence case; no uppercase labels. Body 13 px (`text-base`), secondary 12 px (`text-sm`); `font-mono` for URLs, values and counts.
- State colour only as a dot, a 2 px rail, a battery segment, an outline or a badge — never a background wash. Tokens: `pass`, `fail`, `warn`, `link`, `text`, `line`, `line-hover`, `panel`, `raised`, `muted-foreground`, `faint`. Orange = the `warn` token. Panels: `rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]`; `rise` for the load fade.
- Every disabled control shows its reason within one line of it.
- No model on this screen. Captures, suggestions and transfers are free; only Verify can spend, and its button shows the price before the click.
- **Budget rule:** no implementer or test clicks Verify, Sample, Extract or Check with an Anthropic key present. The live check clicks Verify only against the keyless api-server on :4100, after asserting the button says "free".
- **No implementer signs in as `markodjordjievski@gmail.com`** or reads or writes org `default`, org `mar`, or the projects Acne / Scratch / Competitor prices, except the one read-only SQL query in Task 10. Browser checks use throwaway `smoke-*@example.com` / `check-*@example.com` identities.
- Commits by explicit path only (`git add <paths>`, never `-A` or `.`); shared checkout.
- Test gate per package: `pnpm --filter <pkg> test -- --maxWorkers=2` (`pnpm -r test` is killed for memory here). Postgres must be up.
- After any `shadcn add`: remove a literal `packages/app/~/` directory and a bogus `cn` dependency if they appear.
- `updateBinding` is a whole-record save: every call sends `marks`, `cards` and `descriptions`, or they are erased.

## Review Focus

1. **A tick while a save is in flight, then a reload.** Expected: the last state the customer made is what the server holds; no older save lands after a newer one. Test: Task 4 `createSaver` ordering tests.
2. **A suggestion for a capture that has since been replaced** (Try again, or a card swapped while `suggestMarks`/`transferMarks` was running). Expected: never drawn and never offered. Test: Task 4 `mergeSuggestions` drops answers for a stale `captureId`.
3. **Dropping a card that holds answers.** Expected: its answers go with it, the other cards' answers stay, and the saved record no longer names the URL (marks included). Test: Task 4 `dropCard` + `toBindingInput`.
4. **Verify clicked on a record an older client saved incompletely** (draft saves make this possible). Expected: the server refuses with the missing values named, and nothing runs or spends. Test: Task 2 `verify refuses an incomplete draft`.
5. **A listing whose product links carry no image or only a lazy `data-src`, and a relative `src`.** Expected: the card still shows a title, and the image resolves against the listing URL or is absent. Test: Task 3 `listingProducts` cases.

---

## File map

**API (`packages/api`)**
- `src/auth/scope.ts` — `captureInOrg`.
- `src/verify/limiter.ts` (+ test) — a tiny concurrency limiter.
- `src/verify/proof-page-capture.ts` — `latestProofPageCaptures`; captures go through the limiter.
- `src/verify/binding-input.ts` — `draft`, `cards`.
- `src/verify/find-product-pages.ts` (+ test) — `LISTING_ANCHORS_SCRIPT`, `listingProducts`, `products` on `describeListingPage`.
- `src/routers/sources.ts` — guards; `proofPageCaptures`; `transferMarks` `from`/`fieldKeys`; `updateBinding` `draft`/`cards`; `verify` completeness; `checkListingPage` products.
- `packages/scraper/src/verify/types.ts` — `VerificationSet.cards?`.

**App (`packages/app`)**
- `src/lib/site/verification-model.ts` (+ test) — the Board and everything derived from it.
- `src/lib/site/saver.ts` (+ test) — debounced, ordered autosave.
- `src/lib/site/page-viewer-view.ts` (+ test) — hit-testing and scale.
- `src/lib/site/use-proof-captures.ts` — start / find / poll captures per card.
- `src/components/verification/listing-bar.tsx`, `product-grid.tsx`, `product-card.tsx`
- `src/components/verification/page-viewer.tsx`, `mark-popover.tsx`
- `src/components/verification/fields-sidebar.tsx`, `field-row.tsx`, `battery.tsx`
- `src/routes/_app/projects/$project/sites/$site/index.tsx` — rewritten.
- `src/lib/site-nav-view.ts` (+ test) — tab label "Verification".
- Delete: `src/components/schema/*`, `src/lib/site/schema-grid.ts`, `schema-tab-view.ts`, `schema-screen-view.ts`, `schema-stepper-view.ts` and their tests; trim `verification-view.ts`.
- `src/components/runs/run-misses.tsx`, `src/components/project/add-website-dialog.tsx` — arrivals.
- `src/routes-smoke.test.ts`; `docs/testing/ui-check-app-verification.mts`; `docs/testing/2026-09-2x-verification-live.md`.

---

### Task 1: API — capture guard, per-URL lookup, a concurrency cap, and transfers from the screen

**Files:**
- Modify: `packages/api/src/auth/scope.ts`, `packages/api/src/verify/proof-page-capture.ts`, `packages/api/src/routers/sources.ts`
- Create: `packages/api/src/verify/limiter.ts`, `packages/api/src/verify/limiter.test.ts`
- Test: `packages/api/src/routers/sources-marks.test.ts`, `packages/api/src/routers/site-scope.test.ts`

**Interfaces — Produces:**
- `captureInOrg(ctx, captureId): Promise<{ id: string; sourceId: string } | null>` — `null` without a session (the `sourceInOrg` shim rule); NOT_FOUND for an unknown capture or another org's.
- `createLimiter(max: number): <T>(job: () => Promise<T>) => Promise<T>`
- `sources.proofPageCaptures({ sourceId, urls: httpUrl[1..6] })` → `Record<url, { captureId: string; status: 'capturing' | 'captured' | 'failed'; error?: string } | null>`
- `sources.transferMarks` input adds `from?: Record<key, { value: string; mark?: MarkInput }>` and `fieldKeys?: string[]`.

- [ ] **Step 1: Write the failing tests.**

`limiter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createLimiter } from './limiter.js';

describe('createLimiter', () => {
  it('never runs more than max jobs at once, and runs them all', async () => {
    const limit = createLimiter(3);
    let running = 0, peak = 0;
    const job = () => limit(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running--; return 1; });
    const out = await Promise.all(Array.from({ length: 7 }, job));
    expect(out).toHaveLength(7);
    expect(peak).toBe(3);
  });
  it('frees a slot when a job throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(limit(async () => 2)).resolves.toBe(2);
  });
});
```

Append to `sources-marks.test.ts` (it already has `seedProofPage`, `caller`, and the capture-job mock; add `import { eq } from 'drizzle-orm';` if absent):

```ts
describe('sources.proofPageCaptures', () => {
  it('answers the newest capture per url and null for one never captured', async () => {
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
      const row = await db.query.captures.findFirst({ where: eq(captures.id, id) });
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await db.update(captures).set({ metadata: { ...(row!.metadata as object), capturedAt: old } }).where(eq(captures.id, id));
      expect((await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [f.urls[0]!] }))[f.urls[0]!]).toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('sources.transferMarks from the values on screen', () => {
  it('carries the value the client sends, not the saved one, and only the fields asked for', async () => {
    // Page 1's saved price is a value page 1 does not show: only the override can find anything.
    const f = await createProjectWithSource(caller, { tag: 'marks-from', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
      expected: {
        Price: { 'https://test-marks-from.example.com/p/1': '999.00', 'https://test-marks-from.example.com/p/2': '219.99', 'https://test-marks-from.example.com/p/3': '149.00' },
        Title: { 'https://test-marks-from.example.com/p/1': 'Widget A', 'https://test-marks-from.example.com/p/2': 'Widget B', 'https://test-marks-from.example.com/p/3': 'Widget C' },
      } });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); await seedProofPage(f.sourceId, f.urls[1]!, 'p2'); await seedProofPage(f.sourceId, f.urls[2]!, 'p3');
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], from: { [f.keys.Price!]: { value: '129.99' } }, fieldKeys: [f.keys.Price!] });
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]!.value).toMatch(/219\.99/);
      expect(r[f.urls[1]!]!.fields).not.toHaveProperty(f.keys.Title!);
      const saved = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], fieldKeys: [f.keys.Price!] });
      expect(saved[f.urls[1]!]!.fields[f.keys.Price!]).toBeNull();
    } finally { await f.cleanup(); }
  });
});
```

In `site-scope.test.ts`, inside the other-org test, after the website is created:

```ts
const { captureId } = await a.caller.sources.captureProofPage({ sourceId, url: `${HOST}/p/1` });
// … and in `calls`:
['sources.proofPageCapture', () => bc.sources.proofPageCapture({ captureId })],
['sources.suggestMarks', () => bc.sources.suggestMarks({ captureId })],
['sources.proofPageCaptures', () => bc.sources.proofPageCaptures({ sourceId, urls: [`${HOST}/p/1`] })],
```

If `captureProofPage` there launches a real browser, add the same `vi.mock('../verify/proof-page-capture.js', …)` block `sources-marks.test.ts` uses.

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/api exec vitest run src/verify/limiter.test.ts src/routers/sources-marks.test.ts src/routers/site-scope.test.ts` (missing module, missing procedure, unscoped calls resolve, override ignored).

- [ ] **Step 3: Implement.**

`limiter.ts`:

```ts
/** At most `max` jobs at once; the rest wait in order. A throwing job frees its slot. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => { if (active < max) queue.shift()?.(); };
  return function limit<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        job().then(resolve, reject).finally(() => { active--; next(); });
      });
      next();
    });
  };
}
```

`proof-page-capture.ts`: a module-level `const captureSlots = createLimiter(3);` and in `startProofPageCapture`, `if (opts.fire ?? true) void captureSlots(() => runProofPageCapture(row!.id, opts.session));`. A capture waiting for a slot stays `capturing`; the stall window (3 min) is measured from `startedAt`, so a queued fourth capture still finishes well inside it (three ~15 s captures ahead of it). Then add:

```ts
export type ProofPageCaptureState = { captureId: string; status: 'capturing' | 'captured' | 'failed'; error?: string };

/** The newest proof-page capture per URL in whatever state — what a reloaded screen resumes from. Stalled rows are closed on the way; a captured one past the reuse window reads as missing, so the screen re-captures. */
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

`scope.ts` (import `captures` from `@robot/db`):

```ts
/** A proof-page capture is reached through its website. Addressed by id alone, so a session-less caller passes until cut-over, as with `sourceInOrg`. */
export async function captureInOrg(ctx: Pick<Context, 'db' | 'session'>, captureId: string) {
  if (!ctx.session) return null;
  const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, captureId), columns: { id: true, sourceId: true } });
  if (!row || !row.sourceId) throw notFound('Page capture', captureId);
  await sourceInOrg(ctx, row.sourceId);
  return { id: row.id, sourceId: row.sourceId };
}
```

`sources.ts`: `await captureInOrg(ctx, input.captureId);` first in `proofPageCapture` and `suggestMarks`. New procedure after `proofPageCapture`:

```ts
  /** Where each product's capture stands, newest per URL: how a reloaded Verification tab finds the captures it already started. */
  proofPageCaptures: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), urls: z.array(httpUrl).min(1).max(VERIFY_URL_MAX) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return latestProofPageCaptures(input.sourceId, input.urls);
    }),
```

`transferMarks`: input gains `from: z.record(z.string(), z.object({ value: z.string(), mark: markInput.optional() })).optional()` and `fieldKeys: z.array(z.string()).optional()` (import `markInput` from `../verify/binding-input.js`). Filter `fields` by `fieldKeys` when given, and read page 1 through one helper:

```ts
      // The Verification tab saves drafts, but a tick transfers before its save lands, so it sends the answer on screen.
      const pageOne = (key: string) => input.from
        ? { value: input.from[key]?.value ?? '', mark: input.from[key]?.mark }
        : { value: set.expected[key]?.[input.fromUrl] ?? '', mark: set.marks?.[key]?.[input.fromUrl] };
```

Use `pageOne(f.key).value` for `carried`, and `const { value: expected, mark } = pageOne(field.key)` in the loop.

- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter @robot/api test -- --maxWorkers=2`.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/auth/scope.ts packages/api/src/verify/limiter.ts packages/api/src/verify/limiter.test.ts packages/api/src/verify/proof-page-capture.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-marks.test.ts packages/api/src/routers/site-scope.test.ts
git commit -m "feat(api): product captures scoped to the org, found per url, three at a time; transfers from the answer on screen"
```

---

### Task 2: API — draft saves, stored cards, and Verify's own completeness check

**Files:**
- Modify: `packages/scraper/src/verify/types.ts`, `packages/api/src/verify/binding-input.ts`, `packages/api/src/routers/sources.ts` (`updateBinding`, `verify`)
- Test: `packages/api/src/routers/sources-binding.test.ts`, `packages/api/src/routers/sources-verify.test.ts`

**Interfaces — Produces:**
- `VerificationSet.cards?: Array<{ url: string; title: string; image?: string }>` (scraper type; not read by `fieldHash`/`definitionHash`, which list their inputs by name).
- `bindingInput` adds `draft?: boolean`, `cards?: Array<{ url: httpUrl; title: string (≤300); image?: httpUrl }>` (≤ 6).
- `bindingProblems(input, contract, opts?: { draft?: boolean })` — draft skips: a blank description, a blank cell on any page, the "at least one value on pages four to six" rule. Draft keeps: same website, different pages, 3–6 URLs (the zod schema), a non-blank value must pass its type, a mark needs its value.
- `verify` refuses `PRECONDITION_FAILED` with `bindingProblems(stored, contract)` joined by newlines when the stored record is incomplete.

- [ ] **Step 1: Write the failing tests.** In `sources-binding.test.ts` (it has helpers for a project with fields and a source; follow its setup — read its top first):

```ts
describe('updateBinding draft', () => {
  it('saves a record with blank cells and keeps the cards', async () => {
    const f = await createProjectWithSource(caller, { tag: 'bind-draft', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
    try {
      const cards = f.urls.map((url, i) => ({ url, title: `Widget ${i + 1}` }));
      const saved = await caller.sources.updateBinding({
        sourceId: f.sourceId, urls: f.urls, draft: true, cards,
        descriptions: { [f.keys.Price!]: 'price', [f.keys.Title!]: '' },
        expected: { [f.keys.Price!]: { [f.urls[0]!]: '129.99' } },
      });
      const set = saved!.verificationSet as { cards: unknown; expected: Record<string, Record<string, string>> };
      expect(set.cards).toEqual(cards);
      expect(set.expected[f.keys.Price!]![f.urls[1]!]).toBe('');
    } finally { await f.cleanup(); }
  });

  it('still refuses a wrong-typed value, another website, and a mark without a value', async () => {
    const f = await createProjectWithSource(caller, { tag: 'bind-draft-no', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const base = { sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: { [f.keys.Price!]: 'price' } };
      await expect(caller.sources.updateBinding({ ...base, expected: { [f.keys.Price!]: { [f.urls[0]!]: 'free' } } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(caller.sources.updateBinding({ ...base, urls: [f.urls[0]!, f.urls[1]!, 'https://elsewhere.example.org/p/3'], expected: {} })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const mark = { xpaths: ['//h1'], text: 'x', rect: { x: 0, y: 0, w: 1, h: 1 } };
      await expect(caller.sources.updateBinding({ ...base, expected: {}, marks: { [f.keys.Price!]: { [f.urls[0]!]: mark } } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally { await f.cleanup(); }
  });

  it('drops a card whose url is not one of the pages', async () => {
    const f = await createProjectWithSource(caller, { tag: 'bind-draft-cards', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const saved = await caller.sources.updateBinding({ sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: {}, expected: {},
        cards: [{ url: f.urls[0]!, title: 'A' }, { url: 'https://test-bind-draft-cards.example.com/gone', title: 'Gone' }] });
      expect((saved!.verificationSet as { cards: Array<{ url: string }> }).cards.map((c) => c.url)).toEqual([f.urls[0]]);
    } finally { await f.cleanup(); }
  });
});
```

In `sources-verify.test.ts` (read how it stubs the verification job first; this test must fail before anything is started):

```ts
it('verify refuses an incomplete draft and names what is missing', async () => {
  const f = await createProjectWithSource(caller, { tag: 'verify-draft', fields: [{ name: 'Price', type: 'money' }] });
  try {
    await caller.sources.updateBinding({ sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: { [f.keys.Price!]: 'price' }, expected: { [f.keys.Price!]: { [f.urls[0]!]: '129.99' } } });
    await expect(caller.sources.verify({ sourceId: f.sourceId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining('Price @') });
    const rows = await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, f.sourceId) });
    expect(rows).toHaveLength(0);
  } finally { await f.cleanup(); }
});
```

(If `createProjectWithSource` names its test URLs or keys differently, adapt the literals — the assertions are what matter.)

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/api exec vitest run src/routers/sources-binding.test.ts src/routers/sources-verify.test.ts`.

- [ ] **Step 3: Implement.**

`types.ts`: add to `VerificationSet`:

```ts
  /** What the Verification tab shows for each product page: its title and image from the listing. Display only — no hash reads it. */
  cards?: Array<{ url: string; title: string; image?: string }>;
```

`binding-input.ts`:

```ts
const card = z.object({ url: httpUrl, title: z.string().max(300), image: httpUrl.optional() });
// in bindingInput:
  /** Autosave from the Verification tab: the per-cell completeness rules wait for Verify (spec 2026-09-25 §3). */
  draft: z.boolean().optional(),
  cards: z.array(card).max(VERIFY_URL_MAX).optional(),
```

`bindingProblems(input, contract, opts: { draft?: boolean } = {})`: pass `const draft = opts.draft ?? input.draft ?? false;` and inside the field loop:

```ts
    if (!draft && !(input.descriptions[f.key] ?? '').trim()) problems.push(`${f.name}: say where it is on this website`);
    const cells = input.expected[f.key] ?? {};
    input.urls.forEach((url, i) => {
      const value = cells[url] ?? '';
      if ((draft || i >= VERIFY_URL_MIN) && value.trim() === '') return;
      const err = validateExpected(f.type, value);
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    });
```

and guard the pages-four-to-six rule with `if (!draft)`. `prepareBinding` adds `...(input.cards?.length ? { cards: input.cards.filter((c) => input.urls.includes(c.url)) } : {})` to the returned set (only when non-empty after the filter). Its `prepareBinding → bindingProblems` call passes the input through unchanged, so `draft` flows.

`updateBinding` in `sources.ts`: leave `const { sourceId, ...binding } = input;` as it is — `draft` and `cards` must stay in `binding`, because `prepareBinding` reads both; `inputRowsFor(binding.urls, binding.listingUrl)` ignores them.

`verify` in `sources.ts`: load `with: { dataset: { columns: { schema: true } } }` and, before `resolveInFlightVerification`:

```ts
      // Draft saves (the Verification tab's autosave) can leave cells blank, so Verify checks the record itself.
      const set = source.verificationSet as VerificationSet | null;
      const defs = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
      if (set) {
        const problems = bindingProblems({
          urls: set.urls, ...(set.listing_url ? { listingUrl: set.listing_url } : {}),
          descriptions: Object.fromEntries(defs.map((d) => [d.key, d.description])),
          expected: set.expected, ...(set.marks ? { marks: set.marks } : {}),
        }, contractFields(source.dataset?.schema));
        if (problems.length) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: problems.join('\n') });
      }
```

- [ ] **Step 4: Run — expect PASS**; then the api and scraper gates (`pnpm --filter @robot/api test -- --maxWorkers=2`, `pnpm --filter @robot/scraper test -- --maxWorkers=2`). Existing verify tests must stay green: every one of them saves a complete binding first.

- [ ] **Step 5: Commit.**

```bash
git add packages/scraper/src/verify/types.ts packages/api/src/verify/binding-input.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-binding.test.ts packages/api/src/routers/sources-verify.test.ts
git commit -m "feat(api): draft saves with product cards; Verify checks the record is complete before it runs"
```

---

### Task 3: API — listing products with a title and an image

**Files:**
- Modify: `packages/api/src/verify/find-product-pages.ts`, `packages/api/src/routers/sources.ts` (`findProductPages`, `checkListingPage`)
- Test: `packages/api/src/verify/find-product-pages.test.ts` (create if absent; a real-Chromium case goes in the same file with `PlaywrightBrowser` from `@robot/browser`, as `sources-marks.test.ts` launches it)

**Interfaces — Produces:**
- `type ListingAnchor = { href: string; text: string; title?: string; image?: string }`
- `LISTING_ANCHORS_SCRIPT: string` — the in-page script both procedures run via `setContentEvaluate`.
- `listingProducts(anchors: ListingAnchor[], listingUrl: string, urls: string[]): Array<{ url: string; title: string; image?: string }>`
- `describeListingPage(...)` returns `{ productLinks, pagerSeen, sample, products }` where `products = listingProducts(anchors, listingUrl, sample)`.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { LISTING_ANCHORS_SCRIPT, listingProducts, type ListingAnchor } from './find-product-pages.js';

const L = 'https://shop.example/c/chairs';

describe('listingProducts', () => {
  it('merges the several links to one product: the longest text wins, the first image wins', () => {
    const anchors: ListingAnchor[] = [
      { href: '/p/1', text: '', image: '/img/1.jpg' },
      { href: '/p/1', text: 'Chair' },
      { href: 'https://shop.example/p/1', text: 'Oak chair, natural' },
    ];
    expect(listingProducts(anchors, L, ['https://shop.example/p/1'])).toEqual([{ url: 'https://shop.example/p/1', title: 'Oak chair, natural', image: 'https://shop.example/img/1.jpg' }]);
  });
  it('falls back to the title attribute, then to the path, and leaves out a missing image', () => {
    expect(listingProducts([{ href: '/p/2', text: '', title: 'Pine stool' }], L, ['https://shop.example/p/2'])).toEqual([{ url: 'https://shop.example/p/2', title: 'Pine stool' }]);
    expect(listingProducts([{ href: '/p/3', text: '  ' }], L, ['https://shop.example/p/3'])).toEqual([{ url: 'https://shop.example/p/3', title: '/p/3' }]);
  });
  it('drops an image that is not http(s) and keeps the order of the urls asked for', () => {
    const anchors: ListingAnchor[] = [{ href: '/p/b', text: 'B', image: 'data:image/png;base64,xx' }, { href: '/p/a', text: 'A' }];
    expect(listingProducts(anchors, L, ['https://shop.example/p/a', 'https://shop.example/p/b']).map((p) => [p.title, p.image])).toEqual([['A', undefined], ['B', undefined]]);
  });
});

describe('LISTING_ANCHORS_SCRIPT in Chromium', () => {
  let browser: PlaywrightBrowser;
  beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it('reads an image inside the link, a lazy one, and one beside the link in the same card', async () => {
    const html = `<html><body>
      <a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a>
      <a href="/p/2" aria-label="Pine stool"><img data-src="/i/2.jpg"></a>
      <div class="card"><img src="/i/3.jpg"><a href="/p/3">Birch table</a></div>
    </body></html>`;
    const anchors = await browser.setContentEvaluate<ListingAnchor[]>(html, LISTING_ANCHORS_SCRIPT);
    const byHref = Object.fromEntries(anchors.map((a) => [a.href, a]));
    expect(byHref['/p/1']).toMatchObject({ text: 'Oak chair', image: '/i/1.jpg' });
    expect(byHref['/p/2']).toMatchObject({ title: 'Pine stool', image: '/i/2.jpg' });
    expect(byHref['/p/3']).toMatchObject({ text: 'Birch table', image: '/i/3.jpg' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/api exec vitest run src/verify/find-product-pages.test.ts`.

- [ ] **Step 3: Implement** in `find-product-pages.ts`:

```ts
export type ListingAnchor = { href: string; text: string; title?: string; image?: string };

/**
 * Runs inside the listing page (`setContentEvaluate`). Per link: its href as
 * written, its text, a title from `title`/`aria-label`/an inner img's `alt`,
 * and an image — one inside the link, else the first in the nearest ancestor
 * (up to three levels) that holds no other product link. Lazy images keep
 * their URL in `data-src`/`srcset`. Relative URLs are resolved later, against
 * the listing URL, because `setContent` pages have no base URL.
 */
export const LISTING_ANCHORS_SCRIPT = `(() => {
  const imgUrl = (img) => img ? (img.getAttribute('src') || img.getAttribute('data-src') || (img.getAttribute('srcset') || '').split(/[ ,]/)[0] || '') : '';
  const near = (a) => {
    let el = a.parentElement;
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      if (el.querySelectorAll('a[href]').length > 3) break;
      const img = el.querySelector('img');
      if (img) return img;
    }
    return null;
  };
  return Array.from(document.querySelectorAll('a[href]')).map((a) => {
    const inner = a.querySelector('img');
    return {
      href: a.getAttribute('href') || '',
      text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      title: a.getAttribute('title') || a.getAttribute('aria-label') || (inner && inner.getAttribute('alt')) || undefined,
      image: imgUrl(inner || near(a)) || undefined,
    };
  });
})()`;

const absolute = (u: string, base: string): string | undefined => {
  try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; }
};

export function listingProducts(anchors: ListingAnchor[], listingUrl: string, urls: string[]) {
  return urls.map((url) => {
    const mine = anchors.filter((a) => absolute(a.href, listingUrl)?.replace(/#.*$/, '') === url);
    const text = mine.map((a) => a.text.trim()).sort((x, y) => y.length - x.length)[0] || mine.find((a) => a.title?.trim())?.title?.trim() || '';
    const image = mine.map((a) => (a.image ? absolute(a.image, listingUrl) : undefined)).find(Boolean);
    return { url, title: (text || new URL(url).pathname).slice(0, 120), ...(image ? { image } : {}) };
  });
}
```

Check how `largestProductGroup` normalises hrefs (it uses `u.href` after `new URL(href, listingUrl)`; if it also strips the hash, match that in `listingProducts` — the `.replace(/#.*$/, '')` above assumes it does; align with what the code actually does). `describeListingPage`'s anchor parameter type becomes `ListingAnchor[]` and it returns `products: listingProducts(anchors, listingUrl, sample)`. In `sources.ts`, both `findProductPages` and `checkListingPage` evaluate `LISTING_ANCHORS_SCRIPT` instead of their inline script.

- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter @robot/api test -- --maxWorkers=2`.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/verify/find-product-pages.ts packages/api/src/verify/find-product-pages.test.ts packages/api/src/routers/sources.ts
git commit -m "feat(api): the listing check names each product with a title and an image"
```

---

### Task 4: App — the Verification model and the autosave

**Files:**
- Create: `packages/app/src/lib/site/verification-model.ts` (+ `.test.ts`)
- Create: `packages/app/src/lib/site/saver.ts` (+ `.test.ts`)

**Interfaces — Produces** (`verification-model.ts`):

```ts
export const PRODUCTS_MIN = 3, PRODUCTS_MAX = 6;
export type FieldType = 'text' | 'number' | 'money' | 'boolean' | 'date' | 'url' | 'image' | 'text_list';
export type Field = { key: string; name: string; type: FieldType; description: string };
export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };
export type Card = { url: string; title: string; image?: string };
/** A customer's answer for one field on one product: `mark` null means typed. */
export type Answer = { value: string; mark: Mark | null };
export type Board = { listingUrl: string; cards: Card[]; descriptions: Record<string, string>; answers: Record<string, Record<string, Answer>> };
export type Box = { xpaths: string[]; text: string; rect: Mark['rect']; tag: string; kind: 'text' | 'image' | 'link'; src?: string; href?: string };
export type Suggestion = { captureId: string; value: string; boxes: number[]; origin: 'page-data' | 'from-product' };
/** key → url → suggestion (client-side only; never saved). */
export type Suggestions = Record<string, Record<string, Suggestion>>;
export type Segment = 'empty' | 'suggested' | 'answered' | 'failed';
export type Badge = { kind: 'verified' } | { kind: 'fails'; product: number } | { kind: 'changed' } | { kind: 'checking' } | null;

export function emptyBoard(): Board;
export function boardFrom(source: { schemaDefinition: unknown; verificationSet: unknown }): Board;
export function toBindingInput(board: Board, fields: Field[]): { urls: string[]; listingUrl?: string; descriptions: Record<string, string>; expected: Record<string, Record<string, string>>; marks?: Record<string, Record<string, Mark>>; cards: Card[]; draft: true };
export function canSave(board: Board): boolean;               // ≥ 3 cards, every url non-blank, distinct, one host
export function setCards(board: Board, cards: Card[]): Board;  // drops answers for urls no longer present
export function dropCard(board: Board, index: number): Board;
export function answer(board: Board, key: string, url: string, a: Answer | null): Board; // null clears
export function setDescription(board: Board, key: string, text: string): Board;
export function valueFromBox(box: Box, type: FieldType): { value: string; mark: Mark | null } | { error: string };
export function fieldsFor(box: Box, fields: Field[], board: Board, url: string): Array<{ field: Field; fits: boolean; answered: boolean }>;
export function mergeSuggestions(prev: Suggestions, incoming: Record<string, { value: string; boxes: number[] } | null>, url: string, captureId: string, origin: Suggestion['origin'], board: Board): Suggestions;
export function liveSuggestions(s: Suggestions, board: Board, captureIds: Record<string, string | null>): Suggestions; // drops answered cells and stale capture ids
export function segment(board: Board, s: Suggestions, key: string, url: string, verdict: { failed: boolean }): Segment;
export function badge(args: { key: string; results: VerificationResultsLike | null; currentKeys: string[]; running: boolean; cards: Card[] }): Badge;
export function verifyGate(board: Board, fields: Field[], s: Suggestions): { ok: true } | { ok: false; reason: string };
export function reverifyScope(fields: Field[], results: VerificationResultsLike | null, currentKeys: string[]): string[] | undefined;
export function validateValue(type: FieldType, text: string): string | null;
export function shortUrl(url: string): string;
type VerificationResultsLike = Record<string, { certified: unknown[]; cells: Record<string, { status: 'pass' | 'fail' | 'not_captured' }> }>;
```

**Interfaces — Produces** (`saver.ts`): `createSaver<T>(opts: { delay: number; save: (value: T) => Promise<void>; onState?: (s: 'idle' | 'pending' | 'saving' | 'error') => void }): { push(value: T): void; flush(): Promise<void>; dispose(): void }`.

- [ ] **Step 1: Write the failing tests.** `verification-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  answer, badge, boardFrom, canSave, dropCard, emptyBoard, fieldsFor, liveSuggestions, mergeSuggestions, reverifyScope,
  segment, setCards, shortUrl, toBindingInput, validateValue, valueFromBox, verifyGate, type Board, type Box, type Field,
} from './verification-model';

const U = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const FIELDS: Field[] = [
  { key: 'title', name: 'Title', type: 'text', description: 'heading' },
  { key: 'price', name: 'Price', type: 'money', description: 'price' },
];
const MARK = { xpaths: ['//h1'], text: 'Widget A', rect: { x: 0, y: 0, w: 10, h: 10 } };
const board = (): Board => ({ ...emptyBoard(), cards: U.map((url, i) => ({ url, title: `W${i + 1}` })), descriptions: { title: 'heading', price: 'price' } });
const box = (o: Partial<Box>): Box => ({ xpaths: ['//x'], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, tag: 'span', kind: 'text', ...o });
const full = () => {
  let b = board();
  for (const u of U) { b = answer(b, 'title', u, { value: 'W', mark: MARK }); b = answer(b, 'price', u, { value: '1.00', mark: null }); }
  return b;
};

describe('the board and its save', () => {
  it('saves cards, descriptions, values and marks as a draft', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'Widget A', mark: MARK });
    const input = toBindingInput(b, FIELDS);
    expect(input).toMatchObject({ urls: U, draft: true, descriptions: { title: 'heading', price: 'price' }, marks: { title: { [U[0]!]: MARK } } });
    expect(input.expected.title).toEqual({ [U[0]!]: 'Widget A', [U[1]!]: '', [U[2]!]: '' });
    expect(input.cards).toHaveLength(3);
  });
  it('reads a saved record back, cards included, and falls back to a card per url without them', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'Widget A', mark: MARK });
    const i = toBindingInput(b, FIELDS);
    const back = boardFrom({ schemaDefinition: FIELDS, verificationSet: { urls: i.urls, expected: i.expected, marks: i.marks, cards: i.cards } });
    expect(back.answers.title![U[0]!]).toEqual({ value: 'Widget A', mark: MARK });
    expect(back.answers.title![U[1]!]).toBeUndefined();
    expect(boardFrom({ schemaDefinition: FIELDS, verificationSet: { urls: U, expected: {} } }).cards.map((c) => c.title)).toEqual(['/p/1', '/p/2', '/p/3']);
    expect(boardFrom({ schemaDefinition: FIELDS, verificationSet: null })).toEqual({ ...emptyBoard(), descriptions: { title: 'heading', price: 'price' } });
  });
  it('dropping a card takes its answers with it and nothing else', () => {
    let b = answer(answer(board(), 'title', U[0]!, { value: 'A', mark: MARK }), 'title', U[1]!, { value: 'B', mark: MARK });
    b = dropCard(b, 1);
    expect(b.cards.map((c) => c.url)).toEqual([U[0], U[2]]);
    expect(b.answers.title).toEqual({ [U[0]!]: { value: 'A', mark: MARK } });
    expect(JSON.stringify(toBindingInput(b, FIELDS))).not.toContain(U[1]!);
  });
  it('setCards keeps answers for urls still present', () => {
    const b = setCards(answer(board(), 'title', U[0]!, { value: 'A', mark: MARK }), [{ url: U[0]!, title: 'x' }, { url: 'https://s.example/p/9', title: 'y' }]);
    expect(b.answers.title![U[0]!]!.value).toBe('A');
  });
  it('only saves three or more distinct pages on one website', () => {
    expect(canSave(board())).toBe(true);
    expect(canSave({ ...board(), cards: board().cards.slice(0, 2) })).toBe(false);
    expect(canSave({ ...board(), cards: [...board().cards.slice(0, 2), { url: 'https://other.example/p', title: '' }] })).toBe(false);
    expect(canSave({ ...board(), cards: [...board().cards.slice(0, 2), { url: U[0]!, title: '' }] })).toBe(false);
  });
});

describe('a click', () => {
  it('reads text, an image src or a link href by the field type, and says why when it cannot', () => {
    expect(valueFromBox(box({ text: 'Widget A' }), 'text')).toEqual({ value: 'Widget A', mark: { xpaths: ['//x'], text: 'Widget A', rect: { x: 0, y: 0, w: 1, h: 1 } } });
    expect(valueFromBox(box({ kind: 'image', src: 'https://s.example/a.jpg' }), 'image')).toMatchObject({ value: 'https://s.example/a.jpg', mark: { text: '' } });
    expect(valueFromBox(box({ kind: 'link', text: 'Buy', href: 'https://s.example/b' }), 'url')).toMatchObject({ value: 'https://s.example/b', mark: { text: '' } });
    expect(valueFromBox(box({ text: 'x' }), 'image')).toEqual({ error: 'This element is not an image' });
    expect(valueFromBox(box({ text: 'x' }), 'url')).toEqual({ error: 'This element is not a link' });
    expect(valueFromBox(box({ kind: 'image', src: 'x' }), 'text')).toEqual({ error: 'This element has no text' });
    expect(valueFromBox(box({ text: 'x', xpaths: [] }), 'text')).toEqual({ value: 'x', mark: null });
  });
  it('lists fields that fit the element first, and marks the ones already answered here', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    const list = fieldsFor(box({ text: '$129.99' }), FIELDS, b, U[0]!);
    expect(list.map((l) => [l.field.key, l.fits, l.answered])).toEqual([['price', true, false], ['title', true, true]]);
    const img = fieldsFor(box({ kind: 'image', src: 'https://s.example/a.jpg' }), [...FIELDS, { key: 'img', name: 'Image', type: 'image', description: '' }], board(), U[0]!);
    expect(img[0]!.field.key).toBe('img');
  });
});

describe('suggestions', () => {
  it('never offers over an answer, and forgets suggestions from a replaced capture', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    let s = mergeSuggestions({}, { title: { value: 'Widget A', boxes: [0] }, price: { value: '129.99', boxes: [1] } }, U[0]!, 'cap-1', 'page-data', b);
    expect(s.title).toBeUndefined();
    expect(s.price![U[0]!]).toEqual({ captureId: 'cap-1', value: '129.99', boxes: [1], origin: 'page-data' });
    expect(liveSuggestions(s, b, { [U[0]!]: 'cap-1' }).price![U[0]!]).toBeDefined();
    expect(liveSuggestions(s, b, { [U[0]!]: 'cap-2' }).price?.[U[0]!]).toBeUndefined();
    s = mergeSuggestions(s, { price: null }, U[0]!, 'cap-1', 'page-data', b);
    expect(s.price![U[0]!]).toBeDefined(); // a null answer adds nothing and removes nothing
  });
});

describe('the battery and the badge', () => {
  it('reads each segment', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    const s = mergeSuggestions({}, { title: { value: 'B', boxes: [0] } }, U[1]!, 'c', 'from-product', b);
    expect(segment(b, s, 'title', U[0]!, { failed: false })).toBe('answered');
    expect(segment(b, s, 'title', U[1]!, { failed: false })).toBe('suggested');
    expect(segment(b, s, 'title', U[2]!, { failed: false })).toBe('empty');
    expect(segment(b, s, 'title', U[0]!, { failed: true })).toBe('failed');
  });
  it('says verified, fails on product n, changed, or checking', () => {
    const results = { title: { certified: [{}], cells: { [U[0]!]: { status: 'pass' as const } } }, price: { certified: [], cells: { [U[0]!]: { status: 'pass' as const }, [U[1]!]: { status: 'fail' as const } } } };
    const cards = board().cards;
    expect(badge({ key: 'title', results, currentKeys: ['title', 'price'], running: false, cards })).toEqual({ kind: 'verified' });
    expect(badge({ key: 'price', results, currentKeys: ['title', 'price'], running: false, cards })).toEqual({ kind: 'fails', product: 2 });
    expect(badge({ key: 'title', results, currentKeys: [], running: false, cards })).toEqual({ kind: 'changed' });
    expect(badge({ key: 'title', results, currentKeys: [], running: true, cards })).toEqual({ kind: 'checking' });
    expect(badge({ key: 'title', results: null, currentKeys: [], running: false, cards })).toBeNull();
  });
});

describe('the Verify gate', () => {
  it('names the first gap on products 1 to 3', () => {
    expect(verifyGate(board(), FIELDS, {})).toEqual({ ok: false, reason: 'Title still needs product 1' });
    expect(verifyGate(full(), FIELDS, {})).toEqual({ ok: true });
  });
  it('refuses a value of the wrong type', () => {
    const b = answer(full(), 'price', U[1]!, { value: 'free', mark: null });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Price on product 2: Not a money amount' });
  });
  it('lets products 4 to 6 stay empty but not suggested, and not wholly empty', () => {
    let b = setCards(full(), [...full().cards, { url: 'https://s.example/p/4', title: 'W4' }]);
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Product 4 needs at least one field, or drop it' });
    b = answer(b, 'title', 'https://s.example/p/4', { value: 'W', mark: MARK });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: true });
    const s = mergeSuggestions({}, { price: { value: '2.00', boxes: [0] } }, 'https://s.example/p/4', 'c', 'from-product', b);
    expect(verifyGate(b, FIELDS, s)).toEqual({ ok: false, reason: 'Price has a suggestion to confirm on product 4' });
  });
  it('needs three products', () => {
    expect(verifyGate({ ...full(), cards: full().cards.slice(0, 2) }, FIELDS, {})).toEqual({ ok: false, reason: 'Add at least three products' });
  });
});

describe('small things', () => {
  it('scopes a re-verify to fields not current, and to everything on a first run', () => {
    expect(reverifyScope(FIELDS, null, [])).toBeUndefined();
    expect(reverifyScope(FIELDS, { title: { certified: [{}], cells: {} } }, ['title'])).toEqual(['price']);
  });
  it('validates by type and shortens urls', () => {
    expect(validateValue('money', '$1,299.00')).toBeNull();
    expect(validateValue('money', 'free')).toBe('Not a money amount');
    expect(validateValue('text', '')).toBe('Expected value is required');
    expect(shortUrl('https://s.example/p/1')).toBe('/p/1');
  });
});
```

`saver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaver } from './saver';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSaver', () => {
  it('waits for a quiet moment and saves only the latest value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 600, save });
    s.push(1); s.push(2); s.push(3);
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
  });
  it('never runs two saves at once, and saves what arrived meanwhile after the first lands', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r; })).mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 10, save });
    s.push(1);
    await vi.advanceTimersByTimeAsync(10);
    s.push(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenLastCalledWith(2);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('flush saves now and resolves when it has landed; an error is reported and the next push retries', async () => {
    const states: string[] = [];
    const save = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 600, save, onState: (x) => states.push(x) });
    s.push(1);
    await s.flush().catch(() => {});
    expect(states).toContain('error');
    s.push(2);
    await s.flush();
    expect(save).toHaveBeenLastCalledWith(2);
    expect(states.at(-1)).toBe('idle');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts src/lib/site/saver.test.ts`.

- [ ] **Step 3: Implement.**

`verification-model.ts` — rules the tests pin, spelled out:

- `emptyBoard()` → `{ listingUrl: '', cards: [], descriptions: {}, answers: {} }`.
- `boardFrom`: `descriptions` from the definition (`key → description`); with no verification set, that and `emptyBoard()`'s rest. Otherwise `cards` = for each `set.urls[i]`, the stored card with that URL or `{ url, title: pathname }`; `answers[key][url]` for every non-blank `expected` cell, with `mark: set.marks?.[key]?.[url] ?? null`; `listingUrl = set.listing_url ?? ''`.
- `toBindingInput`: `urls = cards.map(c => c.url.trim())`; `expected[key]` has every url (blank when unanswered); `marks` only non-null, omitted when empty; `descriptions[key] = board.descriptions[key] ?? field.description`; `listingUrl` only when non-blank; `cards`; `draft: true`.
- `canSave`: `cards.length >= PRODUCTS_MIN`, every url parses as http(s), distinct (hash stripped), a single lower-cased hostname.
- `setCards`: replace cards; prune `answers[key]` to present urls. `dropCard(b, i)` = `setCards` without index `i`.
- `answer(b, key, url, a)`: set or (null) delete `answers[key][url]`, immutably.
- `valueFromBox`: image → `box.kind === 'image' && box.src`; url → `box.kind === 'link' && box.href`; else `box.text.trim()` non-empty. Mark = `box.xpaths.length ? { xpaths: box.xpaths.slice(0, 3), text: type is image|url ? '' : box.text, rect: box.rect } : null`. Error strings exactly as the test.
- `fieldsFor`: `fits` = `valueFromBox(box, f.type)` is not an error **and** `validateValue(f.type, value) === null`; `answered` = `!!board.answers[f.key]?.[url]`; sort: fits && !answered, then fits && answered, then the rest; stable within groups by field order. (The test's `$129.99`: price fits, title fits — text fits anything — so price comes first only because of field order? No: title is answered, so `price` (fits, unanswered) precedes `title` (fits, answered).)
- `mergeSuggestions(prev, incoming, url, captureId, origin, board)`: for each key with a non-null incoming value and no answer on that url, set `prev[key][url] = { captureId, value, boxes, origin }`; null entries leave `prev` alone. Never create an empty `prev[key]` object for a key that got nothing (the test asserts `s.title` is `undefined`).
- `liveSuggestions`: keep only entries with no answer on that url and `captureId === captureIds[url]`.
- `segment`: `failed` → `'failed'` (only when the caller passes it; the route passes `failed` only for a current key whose cell failed); answered → `'answered'`; a live suggestion → `'suggested'`; else `'empty'`.
- `badge`: `running` → checking; no results for the key → null; key not in `currentKeys` → changed; `certified.length > 0` → verified; else the first card (1-based) whose cell `status === 'fail'` → fails; else null.
- `verifyGate`: `s` is taken as already live (the route passes `liveSuggestions(...)`); the gate does not look at capture ids, only skips entries whose cell has an answer. Cards < 3 → "Add at least three products". Then for i in 0..cards−1, for each field in order: `a = answers[key][url]`; on i < 3, missing → `${name} still needs product ${i+1}`; present and `validateValue` fails → `${name} on product ${i+1}: ${err}`. On i ≥ 3: no field answered → `Product ${i+1} needs at least one field, or drop it`; a live suggestion with no answer → `${name} has a suggestion to confirm on product ${i+1}`; a present wrong-typed value → the type message. Order: walk products first, then fields, so the reason names the earliest product's first gap. (Suggestions on products 1–3 need no rule: an unanswered cell there is already "still needs".)
- `reverifyScope`: no results (null or empty) → `undefined`; else fields whose key is not current or whose `certified` is empty.
- `validateValue`: move `validateExpectedClient` from `schema-grid.ts` here unchanged (same messages); `shortUrl` moved unchanged.

`saver.ts`:

```ts
// The Verification tab's autosave: a quiet moment after the last change, one
// save in flight, the newest value wins. `flush` saves now (Verify calls it so
// the server has the record it is about to check).
export function createSaver<T>(opts: { delay: number; save: (value: T) => Promise<void>; onState?: (s: 'idle' | 'pending' | 'saving' | 'error') => void }) {
  let latest: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const state = (s: 'idle' | 'pending' | 'saving' | 'error') => opts.onState?.(s);

  async function run(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (inFlight) { await inFlight.catch(() => {}); }
    if (!latest) return;
    const { value } = latest; latest = null;
    state('saving');
    inFlight = opts.save(value);
    try { await inFlight; state(latest ? 'pending' : 'idle'); }
    catch (e) { state('error'); throw e; }
    finally { inFlight = null; }
    if (latest) schedule();
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void run().catch(() => {}); }, opts.delay);
  }
  return {
    push(value: T) { latest = { value }; state('pending'); if (!inFlight) schedule(); },
    flush: run,
    dispose() { if (timer) clearTimeout(timer); timer = null; latest = null; },
  };
}
```

(If the second test shows the value pushed during a save waiting a full extra `delay`, that is intended: `if (latest) schedule()` after the save lands.)

- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter @robot/app exec tsc --noEmit`.
- [ ] **Step 5: Commit.**

```bash
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/saver.ts packages/app/src/lib/site/saver.test.ts
git commit -m "feat(app): the Verification tab's model — products, answers, suggestions, battery, badge, Verify gate — and its autosave"
```

---

### Task 5: App — the listing bar, the product grid, and background captures

**Files:**
- Create: `packages/app/src/lib/site/use-proof-captures.ts`
- Create: `packages/app/src/components/verification/listing-bar.tsx`, `product-grid.tsx`, `product-card.tsx`

**Interfaces:**
- Consumes: `Board`, `Card`, `setCards`, `dropCard`, `shortUrl`, `PRODUCTS_MIN`, `PRODUCTS_MAX` (Task 4); `sources.checkListingPage` (products, Task 3); `sources.proofPageCaptures`, `captureProofPage`, `proofPageCapture` (Task 1).
- Produces:
  - `type ProofCapture = { captureId: string; status: 'starting' | 'capturing' | 'captured' | 'failed'; error?: string; tiles: string[]; boxes: Box[]; pageHeight: number; capturedHeight: number }`
  - `useProofCaptures(sourceId: string | undefined, urls: string[]): { byUrl: Record<string, ProofCapture | undefined>; captureIds: Record<string, string | null>; retry(url: string): void }`
  - `<ListingBar listingUrl disabled onFound(listingUrl: string, products: Card[], found: { productLinks: number; pagerSeen: boolean }) onNoListing() extractOwnsInput />`
  - `<ProductGrid cards captures={byUrl} selected: number disabled onSelect(i) onDrop(i) onAdd(url?: string) onReplace(i, url) canAddFromQueue: boolean onRetry(url) hostProblem: (url: string) => string | null />`

**Behaviour** (spec §2.1, §2.2):
- `useProofCaptures`: `trpc.sources.proofPageCaptures.useQuery({ sourceId, urls })` (enabled with ≥ 1 url). Local `started: Record<url, captureId>`. An effect starts `captureProofPage` once for each url whose lookup answered `null` and that is not started (record a failed mutation as `{ status: 'failed', error }`). `captureIds[url] = started[url] ?? lookup[url]?.captureId ?? null`. Poll each id with `trpc.useQueries((t) => ids.map((id) => t.sources.proofPageCapture({ captureId: id }, { refetchInterval: (q) => (q.state.data?.status === 'capturing' ? 2000 : false) })))`. `retry(url)` starts a new capture and replaces `started[url]`. A url with no id yet reads `status: 'starting'`.
- `ListingBar`: a wide `Input` (placeholder "Paste a listing page — a category or search results", `font-mono`), **Find products** (spinner while running) calling `checkListingPage`; on success `onFound(url, products, { productLinks, pagerSeen })`; `productLinks === 0` → the line "No product links found on this page. Paste product pages below." and `onNoListing()`. Beneath, the link-button "No listing? Paste product pages instead" (`onNoListing`). Found: a muted line "{productLinks} products found{pagerSeen ? ' · a pager too' : ''}". When `extractOwnsInput`: the muted line "The Extract tab has its own pages; this listing only finds products to verify on." Errors from the call show in `text-fail` under the input.
- `ProductCard`: `rounded-[6px] border` (selected: `border-text`; else `border-line hover:border-line-hover`), a `h-[120px]` image area (`card.image`, `object-cover`, `alt=""`; a `bg-raised` block when absent), the title (two lines, clamp), `shortUrl` in mono (`title` = full url), and the state line: "taking screenshot…" (starting/capturing, with a 2 px `bg-text` rail at the top), "ready" (`bg-pass` rail), or the error in `text-warn` with **Try again** (`bg-warn` rail). A **×** (`aria-label="Drop product {n}"`) in the corner. A blank card is an inline URL input with "Use this page" (Enter commits); a host problem shows under it.
- `ProductGrid`: `grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6`; the cards, then **+ Add product** as a dashed card while `cards.length < PRODUCTS_MAX` (from the queue when `canAddFromQueue`, else it adds a blank URL card); at six, disabled with "Six products is the most a website is checked on". Clicking a card selects it.
- Nothing here saves; the route owns the board and the saver.

- [ ] **Step 1: Write the four files.** Idioms: `components/extract/extract-pages.tsx` (URL inputs, `h-8 font-mono text-[16px] md:text-sm`), `screenshotHref` in the old `page-header-cell.tsx` for tile URLs (`API_URL` prefix) — copy that helper into `use-proof-captures.ts` as `tileHref`, since the old file is deleted in Task 9.
- [ ] **Step 2: Typecheck** — `pnpm --filter @robot/app exec tsc --noEmit`. Mounted in Task 9; proven in the browser by Task 10's smoke.
- [ ] **Step 3: Commit.**

```bash
git add packages/app/src/lib/site/use-proof-captures.ts packages/app/src/components/verification/listing-bar.tsx packages/app/src/components/verification/product-grid.tsx packages/app/src/components/verification/product-card.tsx
git commit -m "feat(app): the listing bar and the product grid, each product captured in the background"
```

---

### Task 6: App — the page viewer and the mark popover

**Files:**
- Create: `packages/app/src/lib/site/page-viewer-view.ts` (+ `.test.ts`)
- Create: `packages/app/src/components/verification/page-viewer.tsx`, `mark-popover.tsx`
- If absent, `pnpm dlx shadcn@latest add select` in `packages/app` (then the shadcn cleanup in Global Constraints).

**Interfaces:**
- Consumes: `Box`, `Field`, `valueFromBox`, `fieldsFor`, `Board` (Task 4).
- Produces:
  - `boxAt(boxes: Box[], x: number, y: number): number | null`; `enclosing(boxes: Box[], i: number): number | null`; `toPage(clientX, clientY, frame: { left: number; top: number; scale: number }): { x: number; y: number }`
  - `type Overlay = { box: number; label: string; tone: 'answered' | 'suggested' | 'failed'; key: string }`
  - `<PageViewer tiles boxes pageHeight capturedHeight overlays: Overlay[] highlight: number | null locked onPick(box: number, at: { x: number; y: number }) onOverlay(o: Overlay, at) />`
  - `<MarkPopover open at box value fields={ReturnType<typeof fieldsFor>} initialKey? error? onTick(key: string) onRemove?() onReject?() onClose() />`

- [ ] **Step 1: Write the failing test** `page-viewer-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boxAt, enclosing, toPage } from './page-viewer-view';
import type { Box } from './verification-model';

const b = (x: number, y: number, w: number, h: number): Box => ({ xpaths: ['//x'], text: 't', rect: { x, y, w, h }, tag: 'div', kind: 'text' });
const boxes = [b(0, 0, 1000, 1000), b(100, 100, 300, 100), b(120, 120, 50, 20), b(500, 500, 0, 0)];

describe('the viewer geometry', () => {
  it('picks the innermost box under the point, never an empty one', () => {
    expect(boxAt(boxes, 130, 125)).toBe(2);
    expect(boxAt(boxes, 300, 150)).toBe(1);
    expect(boxAt(boxes, 500, 500)).toBe(0);
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

Run `pnpm --filter @robot/app exec vitest run src/lib/site/page-viewer-view.test.ts` — FAIL.

- [ ] **Step 2: Implement** `page-viewer-view.ts`:

```ts
// Hit-testing for the Verification tab's screenshot. Rects are page pixels (the box map's own); the viewer scales tiles to its column.
import type { Box } from './verification-model';

const area = (x: Box) => x.rect.w * x.rect.h;
const holds = (r: Box['rect'], x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const within = (a: Box['rect'], o: Box['rect']) => a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;

export function boxAt(boxes: Box[], x: number, y: number): number | null {
  let best: number | null = null;
  boxes.forEach((bx, i) => {
    if (area(bx) <= 0 || !holds(bx.rect, x, y)) return;
    if (best === null || area(bx) < area(boxes[best]!)) best = i;
  });
  return best;
}

export function enclosing(boxes: Box[], i: number): number | null {
  const self = boxes[i];
  if (!self) return null;
  let best: number | null = null;
  boxes.forEach((bx, j) => {
    if (j === i || area(bx) <= area(self) || !within(self.rect, bx.rect)) return;
    if (best === null || area(bx) < area(boxes[best]!)) best = j;
  });
  return best;
}

export function toPage(clientX: number, clientY: number, f: { left: number; top: number; scale: number }) {
  return { x: (clientX - f.left) / f.scale, y: (clientY - f.top) / f.scale };
}
```

Run — PASS.

- [ ] **Step 3: Write `page-viewer.tsx`.** A scrolling frame (`max-h-[calc(100vh-260px)] overflow-auto rounded-[6px] border border-line bg-raised`) holding a `relative` stack of tile `<img>`s (`block w-full select-none`, `draggable={false}`; first `alt="Screenshot of this product"`, the rest `alt=""`). Scale = rendered width ÷ first tile's `naturalWidth` (on load, and on a `ResizeObserver` of the stack). An overlay layer the stack's size:
  - hover outline (`outline outline-1 outline-text`) on `boxAt(...)`, widened once by `enclosing` while `event.altKey`;
  - each `Overlay` drawn as an outline — `answered` `outline-2 outline-pass`, `suggested` `outline-2 outline-warn`, `failed` `outline-2 outline-fail` — with a label chip at its top-left (`text-sm`, `bg-panel border border-current`, the field name; suggested chips read "{name}?");
  - `highlight` (a box index) gets `outline-2 outline-text`;
  - click on an overlay → `onOverlay(o, at)`; click elsewhere on a box → `onPick(box, at)` (`at` = client coords for the popover anchor); nothing when `locked`.
  - Below the frame when `pageHeight > capturedHeight && pageHeight > 0`: "Page cut at {capturedHeight} px".
- [ ] **Step 4: Write `mark-popover.tsx`** with the shadcn `Popover` (a virtual anchor at `at`): the element's value (`font-mono`, clamp two lines) or, for an error, the error in `text-fail`; a `Select` of fields (fits-and-unanswered first; answered ones show "· already on this product" in muted); **✓** (`aria-label="Confirm {field}"`) calls `onTick(key)`; for an existing answer a **Remove**; for a suggestion a **×** (`aria-label="Reject suggestion"`) calling `onReject`. Escape/outside click → `onClose`.
- [ ] **Step 5: Typecheck, commit.**

```bash
git add packages/app/src/lib/site/page-viewer-view.ts packages/app/src/lib/site/page-viewer-view.test.ts packages/app/src/components/verification/page-viewer.tsx packages/app/src/components/verification/mark-popover.tsx
git commit -m "feat(app): the product screenshot — hover, click to mark, labelled rectangles, and the field popover"
```

(Add `packages/app/src/components/ui/select.tsx`, `packages/app/package.json` and the lockfile if shadcn added them.)

---

### Task 7: App — the fields sidebar

**Files:**
- Create: `packages/app/src/components/verification/battery.tsx`, `field-row.tsx`, `fields-sidebar.tsx`

**Interfaces:**
- Consumes: `Field`, `Segment`, `Badge`, `Card`, `validateValue` (Task 4).
- Produces:
  - `<Battery segments: Segment[] onSegment(i: number) label: string />` — `role="img"` with `aria-label` like "Price: 2 of 3 confirmed, 1 suggested"; each segment a `button` (`aria-label="Price on product {n}: confirmed"`), `h-2 w-5 rounded-[2px]`: empty `border border-line`, suggested `bg-warn`, answered `bg-pass`, failed `bg-fail`.
  - `<FieldRow field segments badge selected expanded description typed: string typedError?: string locked onSegment(i) onToggle() onType(value) onDescription(text) />`
  - `<FieldsSidebar rows: … verify={{ label, disabled, reason?, busy, onClick }} saveState: 'idle' | 'pending' | 'saving' | 'error' extract={{ enabled, href }} stage: string | null />`

**Behaviour** (spec §2.4, §2.5):
- Row: name (`text-base`), type label muted, the battery, then the badge — `verified`: a `ShieldCheck` icon + "verified" in `text-text`; `fails`: "fails on product {n}" `text-fail`; `changed`: "changed since verified" muted; `checking`: "checking…" muted with the pulsing dot idiom from `run-dot.tsx`. Selected row: `border-l-2 border-text` rail. Expanded: **Type it** — an `Input` (`aria-label="{name} on product {n}"`) for the selected product, its type error in `text-fail`, "typed" under it once saved; **Descriptor** — a `Textarea` (`aria-label="Where {name} is on this website"`), 2 rows.
- Footer: the Verify `Button` with `verify.label`, its reason within one line; the save state line ("saved", "saving…", "not saved — retrying on your next change" in `text-warn`); the stage line while running; **Go to Extract** as a link button when enabled, else disabled with "Unlocks when every field is verified".
- `locked` disables every input and segment click.

- [ ] **Step 1: Write the three components.** Mirror `components/runs/run-facts.tsx` for label/value rows and `components/extract/section.tsx` for the panel.
- [ ] **Step 2: Typecheck, commit.**

```bash
git add packages/app/src/components/verification/battery.tsx packages/app/src/components/verification/field-row.tsx packages/app/src/components/verification/fields-sidebar.tsx
git commit -m "feat(app): the fields sidebar — a battery per field, the Verify verdict, type it and the descriptor"
```

---

### Task 8: App — the Verification tab assembled

**Files:**
- Rewrite: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`
- Modify: `packages/app/src/lib/site-nav-view.ts` (+ `.test.ts`), any other "Schema" label the app shows (`rg -n "'Schema'|>Schema<|Schema tab" packages/app/src`)

**Interfaces:**
- Consumes: everything from Tasks 4–7; `sources.get`, `projects.get`, `sources.verificationStatus`, `sources.verifyEstimate`, `sources.updateBinding`, `sources.verify`, `sources.suggestMarks`, `sources.transferMarks`; `verificationState` (`lib/site/verification-view.ts`); the `verifyButton` rules (Task 9 moves them; import from `schema-tab-view.ts` for now).
- Produces: `VerificationSearch = { product?: number; field?: string; addPage?: string }` (all optional; `product` 1-based).

**What the route does:**
1. **Board.** Seed once from `boardFrom(source)`; afterwards local state is the truth. `fields` from `source.schemaDefinition`. No fields → the panel "This project has no fields yet" + link to `/projects/$project/fields`, and nothing else.
2. **Autosave.** `const saver = useMemo(() => createSaver({ delay: 600, save: (b) => updateBinding.mutateAsync({ sourceId, ...toBindingInput(b, fields) }).then(invalidate) , onState: setSaveState }), [...])`; every board change → `if (canSave(board)) saver.push(board)`. `invalidate` refreshes `sources.get`, `projects.get`, `sources.verifyEstimate`, `sources.verificationStatus` (plan 3's reason: a save moves which fields are current). Dispose on unmount; `flush` on `beforeunload` is not needed (the debounce is short).
3. **Captures.** `useProofCaptures(source.id, board.cards.map(c => c.url).filter(Boolean))`.
4. **Suggestions.** State `suggestions: Suggestions`. For each card whose capture is `captured`: `trpc.useQueries` over `sources.suggestMarks({ captureId })` (one per captured card); when an answer lands, `mergeSuggestions(prev, fieldsOf(answer), url, answer.captureId, 'page-data', board)` — `fieldsOf` maps `Suggestion` → `{ value, boxes }`. On a tick of field `key` on `url` with value/mark: `transferMarks.mutateAsync({ sourceId, fromUrl: url, toUrls: otherCapturedUrls, fieldKeys: [key], from: { [key]: { value, ...(mark ? { mark } : {}) } } })` and merge each non-null per-url result with origin `'from-product'` and that result's `captureId`. What is drawn and counted is always `liveSuggestions(suggestions, board, captureIds)`.
5. **The screen.** `grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]`. Left: `ListingBar`, `ProductGrid`, then for the selected card either its state (not captured) or `PageViewer` with overlays built from the board (answered, with the field name), live suggestions (`suggested`, one overlay per box), and failed cells (`failed`). Right: `FieldsSidebar`.
6. **Marking.** `onPick(box)` → open `MarkPopover` with `valueFromBox` per candidate field (`fieldsFor`). `onTick(key)` → `valueFromBox(box, field.type)`; on value: `setBoard(answer(board, key, url, { value, mark }))`, then the transfer (4). On an existing answer's overlay: popover with **Remove** (`answer(..., null)`) or a different field. On a suggestion overlay: ✓ → answer with the suggestion's value and `valueFromBox(boxes[i])`'s mark; × → delete that suggestion from state.
7. **Type it / descriptor.** Type → `answer(board, key, url, text.trim() ? { value: text, mark: null } : null)`; descriptor → `setDescription`.
8. **Selection.** `?product` (default 1); a battery segment click sets `product` and highlights that field's answered box; `?field` highlights the row.
9. **Verify.** `gate = verifyGate(board, fields, live)`. Button label/disabled from `verifyButton({ state, firstRun, reverifyCount: reverifyScope(...)?.length ?? fields.length, capturesFresh, aiAvailable, upperBoundUsd, complete: gate.ok, busy })`, with `reason` = `gate.reason` when `!gate.ok`. Click: `await saver.flush()`, then `verify.mutateAsync({ sourceId, onlyKeys: reverifyScope(...) })`, invalidate as today. While `verificationState(...) === 'active'`, poll `verificationStatus` every 3 s (plan 3's rule), lock the grid, viewer and sidebar, badges read checking. Segments: `failed` when the key is in `currentKeys` and `results[key].cells[url].status === 'fail'`. **Go to Extract** enabled when `status.current && status.allPassed`.
10. **Arrival** `?addPage=<url>&field=<key>`: once the board is seeded and no verification is active — if the url is a card, select it; else if `cards.length < PRODUCTS_MAX`, append `{ url, title: shortUrl(url) }` and select it; else show "This website already checks six products — drop one to add this page". Highlight the field's row with "Mark {name} on this product". Consume once (a ref), then strip `addPage` from the URL (replace).
11. **Tab label.** `SITE_TABS[0].label = 'Verification'`, `SiteTabLabel` updated, its test updated; the crumb/command palette text if any says Schema.

- [ ] **Step 1: Update `site-nav-view.test.ts`** to expect `['Verification', true]` and `activeTab(base, base) === 'Verification'`; run — FAIL; change `site-nav-view.ts` — PASS.
- [ ] **Step 2: Rewrite the route** as above.
- [ ] **Step 3: Typecheck and unit tests** — `pnpm --filter @robot/app exec tsc --noEmit && pnpm --filter @robot/app test -- --maxWorkers=2`.
- [ ] **Step 4: Manual look** with `pnpm dev:all` up, as a throwaway `check-<ts>@example.com`: new project, one catalogue field, add a website, paste a listing of any public shop, watch three cards and their screenshots, mark a field, see it go orange on the others, tick them, reload, still green. Do not click Verify.
- [ ] **Step 5: Commit.**

```bash
git add "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/lib/site-nav-view.ts packages/app/src/lib/site-nav-view.test.ts
git commit -m "feat(app): the Verification tab — find products, mark them, carry answers across, verify"
```

(Add any other file whose "Schema" label changed.)

---

### Task 9: App — remove what the tab replaced; arrivals from a run and from Add website

**Files:**
- Delete: `packages/app/src/components/schema/` (all), `packages/app/src/lib/site/schema-grid.ts`, `schema-screen-view.ts`, `schema-stepper-view.ts` and their tests.
- Modify: `packages/app/src/lib/site/schema-tab-view.ts` → rename to `verify-button.ts` keeping only `verifyButton`, `stripState`, `StripState`, `TimeEstimate`, `roughTime` and their tests (`git mv` the test to `verify-button.test.ts`, delete the tests of removed functions); `packages/app/src/lib/site/verification-view.ts` (+ test) — delete `isRowStale`, `reverifyKeys` and anything else importing `schema-grid`.
- Modify: `packages/app/src/components/runs/run-misses.tsx`, `packages/app/src/components/project/add-website-dialog.tsx`, the route (imports).

**Changes:**
- `rg -n "components/schema|schema-grid|schema-screen-view|schema-stepper-view|schema-tab-view" packages/app/src` must come back empty after this task (`lib/site/csv.ts` stays — the Extract tab imports it).
- `run-misses.tsx`: the "Use as proof page" link's `search` becomes `{ addPage: url, field: field.name }` (drop `step`). `field.name` there already holds the engine key (see `nameOf` in the same file) — keep it, and add a one-line comment saying so.
- `add-website-dialog.tsx`: after `createInProject` it lands on the website's root (the Verification tab) with no `step` in the search; drop any `step` it passes.
- Grep the smoke and the `docs/testing/ui-check-*.mts` scripts for `?step=` and old labels; they are updated in Task 10, not here.

- [ ] **Step 1: Make the deletions and moves.**
- [ ] **Step 2: Typecheck and the full app gate** — `pnpm --filter @robot/app exec tsc --noEmit && pnpm --filter @robot/app test -- --maxWorkers=2`. Expected: clean, green, fewer tests than before (the deleted modules' tests went with them).
- [ ] **Step 3: Commit** (the deletions via `git rm`, the rest by path).

```bash
git rm -r packages/app/src/components/schema packages/app/src/lib/site/schema-grid.ts packages/app/src/lib/site/schema-grid.test.ts packages/app/src/lib/site/schema-screen-view.ts packages/app/src/lib/site/schema-screen-view.test.ts packages/app/src/lib/site/schema-stepper-view.ts packages/app/src/lib/site/schema-stepper-view.test.ts
git add packages/app/src/lib/site/verify-button.ts packages/app/src/lib/site/verify-button.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/lib/site/verification-view.test.ts packages/app/src/components/runs/run-misses.tsx packages/app/src/components/project/add-website-dialog.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
git commit -m "refactor(app): the proof-sheet grid, the stepper and import are gone; runs and Add website land on Verification"
```

(`git mv` of `schema-tab-view.ts` → `verify-button.ts` records the rename; include both paths.)

---

### Task 10: Smoke, the free live run on Ikea, and the docs

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts`
- Create: `docs/testing/ui-check-app-verification.mts`, `docs/testing/2026-09-2x-verification-live.md` (actual date)
- Modify: `docs/handoff.md`, `docs/testing/screens/README.md`, `CLAUDE.md` (the `@robot/app` row and the extraction-chain line 0 say "the Verification tab")

**Smoke** (`pnpm test:ui:app`, needs `pnpm dev:all`):
- `beforeAll`: a `node:http` server on `127.0.0.1:0` serving `/l` (a listing: three `<a href="/p/n"><img src="/i/n.png"><span>Widget N</span></a>` cards and one `<a href="/about">`) and `/p/1..3` built from `SHOP_EXAMPLE` (`packages/api/src/test-helpers/shop-example.ts`, imported by relative path): its `html` with the `ldJson` block inserted as `<script type="application/ld+json">…</script>` in a `<head>`. `/i/n.png` serves a 1×1 PNG. Closed in `afterAll`.
- The website is added with the local server's URL (`http://127.0.0.1:<port>/`), so the same-website rule holds; update `WEBSITE_URL`/`WEBSITE_HOST`/`WEBSITE_NAME` to what `siteNameFromUrl` derives. Fields: **Title** and **Price** from the catalogue.
- Replace "three pages and their values save from the Schema tab" with "a website is verified-ready from its Verification tab", which walks:
  1. paste `/l`, **Find products** → three cards whose titles read "Widget A/B/C" (`SHOP_EXAMPLE` headings, or whatever the listing's spans say — assert the listing's own text);
  2. poll (≤ 90 s) for three "ready" cards;
  3. product 1: a Title suggestion overlay is on screen ("Title?"); click it, ✓ → Title's first segment is `answered`;
  4. click the `$129.99` element on the screenshot (find its box by calling `sources.proofPageCapture` over tRPC with the smoke's cookie, then click the viewer at `rect × scale` + the frame's offset), pick **Price** in the popover, ✓;
  5. the Price battery reads 1 confirmed and 2 suggested within 20 s; open products 2 and 3 and ✓ both suggestions, and Title's;
  6. the sidebar's save line reads "saved"; reload; every segment still `answered`; the Verify button is enabled and reads "· free" or "· up to $…" — **not clicked**;
  7. over tRPC, `sources.get` shows `verificationSet.marks` for Price on product 1 and `cards` with three titles.
- Screenshots: `app-site-verification-{empty,marking,ready}-{dark,light}.png`. The "every website screen renders" walk lists "Verification" for the first tab.
- Never click Verify.

**Live check** (`docs/testing/ui-check-app-verification.mts`, modelled on `ui-check-app-site.mts`), against the **keyless api-server on :4100** (memory "Free live checks") with the app pointed at it, as a throwaway `check-*@example.com`:
- Read Ikea's listing URL with one read-only query (`select verification_set->>'listing_url' from sources where name ilike 'ikea%' limit 1`) — nothing else from Marko's data.
- Create a project with Ikea's eight catalogue fields (the ones the existing Ikea website verifies: read their names from the same row's `schema_definition` in that query), add a website on Ikea's host, paste the listing, wait for three cards, confirm every suggestion, mark what is left by clicking, and — **after asserting the Verify label contains "free"** (abort otherwise) — click Verify and wait for the badges.
- Record: listing time; capture time per product; fields suggested from page data on each product; fields carried by transfer; clicks needed; the verified count and any "fails on product n". Screenshots `app-site-verification-ikea-{marking,verified}-{dark,light}.png`. Delete the throwaway project at the end.
- Write the numbers into the live note.

**Docs:** a handoff section "App redesign, plan 5: the Verification tab (2026-09-2x)" in the house style (what landed per commit, rulings, deviations from the spec, what the checks found, how to run, open decisions), a "Read this first" pointer, and the screens README entries.

- [ ] **Step 1: Smoke** — write, run with `pnpm dev:all` up; all green in both themes.
- [ ] **Step 2: Live check** — write, run against :4100; numbers recorded.
- [ ] **Step 3: Full gate** — db, browser, agent, scraper, api, dashboard, api-server, app, each `pnpm --filter <pkg> test -- --maxWorkers=2`; all green.
- [ ] **Step 4: Docs.**
- [ ] **Step 5: Commit** by explicit paths (smoke, check, live note, screenshots taken, handoff, screens README, CLAUDE.md).

```bash
git commit -m "test(app): the Verification tab in the smoke and a free live run on Ikea; plan 5 recorded"
```
