# Verify never fails silently — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Verify, re-verify and proof-page capture that does not succeed ends with one sentence, in view, in customer words, with a next step — and a failed run never wipes the results a customer already has.

**Architecture:** `@robot/scraper` stops one field's AI throw from failing the run (`ai_unavailable` on that field), names a value found in another place on a product (`elsewhere`), and stores capture failures as customer sentences. `@robot/api` refuses Verify with structured problems (a `VerifyRefusal` cause, surfaced by an `errorFormatter` as `error.data.verifyProblems`), and `verificationStatus` hands back the newest *completed* run plus a `failedRun` marker instead of the failed row. `@robot/app` writes every sentence in one pure module (`lib/site/verify-messages.ts`), shows the Verify message in the Verify bar, puts the cell hint in the detail bar, and never shows "stalled", "superseded", a raw start error or an internal stage word. No migration: every new value is optional JSON on existing jsonb columns or a new field on a query's answer.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres; tRPC v11 (11.11) with superjson; TanStack Start + React 19 + Tailwind v4; Playwright for the scraper's Chromium tests and the route smoke.

**Spec:** `docs/superpowers/specs/2026-10-20-verify-silent-failures-design.md`

**Planner's notes:** eight tasks. Engine first (Tasks 1–2, independent of each other), then the API (Tasks 3–4), then the app's copy (Task 5) and capture states (Task 6), then the tab's wiring with the route smoke (Task 7), then the merge gate and docs (Task 8). Tasks 1, 2 and 3 touch disjoint files and may run in parallel; Task 4 edits `routers/sources.ts` after Task 3, and one line of the app route; Tasks 5 and 6 are disjoint; Task 7 needs 3–6. The spec names code by line on `main` @ `7971bf8`; the lines below were re-read on `feat/verify-silent-failures` @ `382b1f5` and are approximate — find the code by the quoted text.

## Global Constraints

- Customer copy is exact. From the spec (§3):
  - refusal, blank cell: `{Field} on product {n} needs a value, or "Not on this product". Nothing was checked.`
  - refusal, too few values: `{Field} needs a value on at least two products, or "not on this product" on every one.`
  - refusal, no schema: `This website has no fields yet. Add fields to the project, then verify.`
  - refusal, variants: the existing sentence `Confirm the variants of every product first`
  - refusal, anything else (and any Verify error without structured problems): `Verify could not start. Try again; if it keeps happening, contact us.`
  - failed or stalled run: `Verify stopped before it finished. Your last results are kept — try again.`
  - `ai_unavailable` row hint: `We couldn't finish checking {Field} this time. Verify again — nothing else changed.`
  - `elsewhere` hint: `Found on this product, but not where your other products show it. If this product really has no {Field} of its own, choose "Not on this product".`
  - `found_unexpected` hint: `Found {value} on product {n}, but you said it isn't there. Is it there after all?`
  - a field left incomplete by a failed capture: `Not checked on product {n} — {reason}.`
  - stalled proof-page capture: `The screenshot took too long. Take it again.`; failed capture start or failed poll: `The screenshot could not start. Take it again.`
  - superseded coverage check: no stage line; stalled coverage check: `The check took too long and stopped. Run it again.`
- Planner's copy where the spec is silent (listed so a reviewer can object; Task 8 records them in the handoff): a failed run with no completed run before it: `Verify stopped before it finished. Try again.`; a failed field with no fail cell after an AI failure: badge `not finished — verify again`; a failed field with no fail cell, every page captured: badge `not verified — mark it on the screenshot`; an unknown or unreadable capture reason: `the page could not be read`; Verify's stage line: `Starting…`, `Taking screenshot {i} of {n}…`, `Looking for your values on the pages…`, `Taking a closer look at {Field}…`, `Checking the variants…`, `Verifying…` (today it shows the raw stage, e.g. `asking AI for price_eur`, which breaks §5.4).
- No customer-visible string contains an address, a field key, an HTTP status, "@", a library's error text, "stalled", "superseded", or names Jev, AI or a model; no new money amount anywhere (memory `customer-copy-no-internals`). Staff see the same as customers; ops keeps the raw error on the row.
- Spec §5.6: a set, result or status with none of the new fields behaves as today. `failReason` is omitted unless it is `'ai_unavailable'`; `elsewhere` appears only on new results.
- Spec §5.5: `elsewhere` changes a cell's reason only, never what certifies.
- ESM throughout. Relative imports carry `.js` in `@robot/scraper` and `@robot/api`; none in `@robot/app`. `@robot/app` imports nothing from `@robot/scraper` except `@robot/scraper/normalize`, and nothing from `@robot/api` (the existing `import type { AppRouter }` in `lib/trpc.ts` and the route smoke's test-helper imports stay as they are).
- Tests per package, one file at a time while working: `cd packages/<pkg> && npx vitest run <file>`. Never `pnpm -r test`. The api tests need Postgres running (Docker container, `127.0.0.1:5432`).
- The worktree has no `.env`. Before the first api test, copy the main checkout's: `cp /c/Users/Marko/Documents/projects/robot-platform/.env /c/Users/Marko/Documents/projects/robot-platform-silent/.env`. It is gitignored; never stage it.
- Commits by explicit path. Never `git add -A` / `git add .`. Never stage `packages/app/src/routeTree.gen.ts`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work only in `C:\Users\Marko\Documents\projects\robot-platform-silent` on `feat/verify-silent-failures`. Never start, stop or restart Marko's dev servers (:3000, :4000). The only servers this plan starts are the isolated pair on :4100/:3100 (Tasks 7 and 8), stopped by port afterwards.
- Files in this repo are CRLF. Edit with tools that keep line endings; new files may be LF (git normalises).
- No paid AI: nothing here clicks a real Verify or Extract against a keyed server. The route smoke's one Verify click is answered inside the browser (Task 7).

## Review Focus

1. A Verify error that carries no `verifyProblems` (a network failure, NOT_FOUND, an older api-server, the autosave flush throwing) must show `Verify could not start. Try again; if it keeps happening, contact us.`, never `err.message`. → Task 5 test "a Verify error without problems says could-not-start, never its message".
2. A capture reason stored before this change (`blockedReason` holding raw Playwright text such as `page.goto: Timeout 60000ms exceeded.`) must read `the page could not be read`, never the raw text. → Task 5 test "notCheckedText never repeats raw library text".
3. A Verify started after a failed run must clear the failure: while it is in flight the status is the in-flight row with `failedRun: null`. → Task 4 test "a young in-flight run after a failed one carries no failedRun".
4. A field that ended `ai_unavailable` must be in the next Re-verify's scope and must never read verified. → Task 5 test "an ai_unavailable field is re-verified next time and never reads verified".
5. A proof-page poll that errors after its screenshot landed must keep the screenshot, not flip the card to failed. → Task 6 test "a poll error after the capture landed keeps the capture".

---

### Task 1: "Found here, in another place" is not "not found" (`@robot/scraper`) — spec §3.4

**Files:**
- Modify: `packages/scraper/src/verify/types.ts:58` (`FailReason`)
- Modify: `packages/scraper/src/verify/certify.ts:~392-404` (the `twoOfThree` branch in `certifyCandidates`)
- Test: `packages/scraper/src/verify/certify.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `FailReason` gains `'elsewhere'` (exported from `@robot/scraper` as today). A fail cell may read `{ status: 'fail', reason: 'elsewhere', nearMisses? }`. Task 5 mirrors the reason in the app.

- [ ] **Step 1: Write the failing test**

Append to `packages/scraper/src/verify/certify.test.ts` (it already imports `certify`, `CaptureLike`, `describe/it/expect`, and defines `xpathDeps`):

```ts
describe('certify — found here, in another place (spec 2026-10-20 §3.4, the ridge shape)', () => {
  const desc = { key: 'description', name: 'Description', type: 'text' as const, description: 'under the photos', concept: 'description' };
  const R = ['https://ridge.example/p/1', 'https://ridge.example/p/2', 'https://ridge.example/p/3', 'https://ridge.example/p/4'];
  const D = ['Slim aluminium wallet, holds twelve cards.', 'Carbon fibre wallet with a cash strap.', 'Titanium wallet with an RFID shield.', 'Leather card case for six cards.'];
  const TAGLINE = 'Ridge — wallets for life';
  const page = (url: string, ld: Record<string, unknown>, og: string): CaptureLike => ({
    url, html: '<html></html>',
    structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: { 'og:description': og } },
    interceptedRequests: [],
  });
  // Products 1–3 carry the description in JSON-LD and the shop's tagline in og:description;
  // product 4 has no JSON-LD description and carries its description in og:description.
  const ridge: Record<string, CaptureLike> = {
    [R[0]!]: page(R[0]!, { description: D[0] }, TAGLINE),
    [R[1]!]: page(R[1]!, { description: D[1] }, TAGLINE),
    [R[2]!]: page(R[2]!, { description: D[2] }, TAGLINE),
    [R[3]!]: page(R[3]!, { name: 'Card case' }, D[3]!),
  };
  const expected = Object.fromEntries(R.map((u, i) => [u, D[i]!]));
  const jsonLd = { source: 'json-ld' as const, path: 'description', transform: 'identity' as const };
  const og = { source: 'meta' as const, path: 'og:description', transform: 'identity' as const };

  it('fails product 4 with elsewhere when another candidate reads the right value there', async () => {
    const r = await certify({ field: desc, expected, captures: ridge, candidates: [jsonLd, og] }, xpathDeps);
    expect(r.cells[R[3]!]).toMatchObject({ status: 'fail', reason: 'elsewhere' });
    for (const u of R.slice(0, 3)) expect(r.cells[u]).toMatchObject({ status: 'pass' });
  });

  it('never certifies on that evidence (spec §5.5): nothing certifies, as before', async () => {
    const r = await certify({ field: desc, expected, captures: ridge, candidates: [jsonLd, og] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.incomplete).toBe(false);
  });

  it('stays not_found when no candidate reads the value on that page', async () => {
    const r = await certify({ field: desc, expected, captures: ridge, candidates: [jsonLd] }, xpathDeps);
    expect(r.cells[R[3]!]).toMatchObject({ status: 'fail', reason: 'not_found' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/scraper && npx vitest run src/verify/certify.test.ts -t "another place"`
Expected: the first test FAILS (`reason: 'not_found'` where `'elsewhere'` was expected); the other two pass.

- [ ] **Step 3: Implement**

In `packages/scraper/src/verify/types.ts`, replace the `FailReason` line:

```ts
/** `elsewhere` (spec 2026-10-20 §3.4): the path right on every other page reads nothing here, but another candidate reads the right value on this page — the value is on this product, in another place. */
export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch' | 'no_fitting_path' | 'found_unexpected' | 'elsewhere';
```

In `packages/scraper/src/verify/certify.ts`, inside `if (twoOfThree) { … }`, replace

```ts
      if (empty) cells[url] = { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
```

with

```ts
      if (empty) {
        // Spec 2026-10-20 §3.4 (ridge, product 4): the majority path reads nothing here, but another
        // candidate reads the right value on this very page. Only the cell's reason changes; what
        // certifies is decided above and does not move (§5.5).
        const elsewhere = candidates.some((c) => c !== twoOfThree && isProven(c, url));
        cells[url] = { status: 'fail', reason: elsewhere ? 'elsewhere' : 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
      }
```

The `else if` / `else` lines for `type_mismatch` and `different_value` stay attached to this `if`, unchanged.

- [ ] **Step 4: Run the file**

Run: `cd packages/scraper && npx vitest run src/verify/certify.test.ts`
Expected: PASS, every test (the existing `not_found` tests keep passing: in them no other candidate is right on the page).

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/scraper && npx tsc --noEmit` — expected: no errors.

```bash
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts
git commit -m "feat(scraper): a value found in another place on a product reads elsewhere, not not_found

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One field's AI failure is that field's result; capture failures are sentences (`@robot/scraper`) — spec §3.3, §3.5.2

**Files:**
- Modify: `packages/scraper/src/verify/types.ts:65-80` (`FieldVerification`)
- Modify: `packages/scraper/src/verify/run-verification.ts:1-11` (imports), `:141-151` (capture loop), `:196-210` (AI fallback)
- Test: `packages/scraper/src/verify/run-verification.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `FieldVerification.failReason?: 'ai_unavailable'` (set only when the field's AI proposal threw; the field's `certified` is `[]`, `aiCalled` is `true`, its cells are the mechanical result). `VerificationRun.captureErrors[url]` is always a customer sentence: a `CaptureError`'s or `CaptureProblemError`'s message, else `BROWSER_UNAVAILABLE` from `@robot/browser`. Task 4 stores both unchanged; Task 5 reads `failReason`.

- [ ] **Step 1: Write the failing tests**

In `packages/scraper/src/verify/run-verification.test.ts`, change the import on line 3 to

```ts
import { PlaywrightBrowser, verdictSentence, pageVariantFrom, CaptureError, BROWSER_UNAVAILABLE } from '@robot/browser';
```

Replace the expectation in the existing test "a failing capture marks the column not_captured and records the error" (around line 126):

```ts
    // Spec 2026-10-20 §3.5.2: a throw that is not a capture verdict is library text; the customer reads the browser sentence.
    expect(run.captureErrors[U[2]!]).toBe(BROWSER_UNAVAILABLE);
```

Append:

```ts
describe('runVerification — capture failures are customer sentences (spec 2026-10-20 §3.5.2)', () => {
  it("a CaptureError stores its verdict sentence, never Playwright's text", async () => {
    const caps = loadShopExample();
    delete caps[U[2]!];
    const run = await runVerification({ fields: [fields[0]!], verificationSet: set }, {
      browser, agent: null, captures: caps,
      captureOne: async (_b, url) => { throw new CaptureError('timeout', url, 'page.goto: Timeout 60000ms exceeded.'); },
    });
    expect(run.captureErrors[U[2]!]).toBe(verdictSentence({ kind: 'timeout' }, U[2]!));
    expect(run.captureErrors[U[2]!]).not.toContain('page.goto');
  }, 60_000);
});

describe("runVerification — one field's AI failure is that field's result (spec 2026-10-20 §3.3)", () => {
  const sku = { key: 'sku', name: 'SKU', type: 'text' as const, description: 'item number', concept: 'sku' };
  const code = { key: 'code', name: 'Code', type: 'text' as const, description: 'item number again', concept: 'sku' };
  const typed = { [U[0]!]: 'A1', [U[1]!]: 'B2', [U[2]!]: 'C3' };
  const skuSet: VerificationSet = { urls: U, expected: { product_name: set.expected.product_name, sku: typed, code: typed } };
  const GOOD = { source: 'xpath' as const, path: '//*[@id="main"]/span[@class="sku"]/@data-sku', transform: 'identity' as const };

  it('a throw for one field fails that field with ai_unavailable; every other result stands and both calls count', async () => {
    const agent = { proposePaths: vi.fn(async (prompt: string) => {
      if (prompt.includes('(key sku,')) throw new Error('Request timed out.');
      return [GOOD];
    }) };
    const run = await runVerification({ fields: [fields[0]!, sku, code], verificationSet: skuSet }, { browser, agent, captures: loadShopExample() });

    expect(agent.proposePaths).toHaveBeenCalledTimes(2);
    expect(run.outcome.aiCalls).toBe(2);
    expect(run.outcome.fields.sku).toMatchObject({ certified: [], aiCalled: true, failReason: 'ai_unavailable' });
    for (const url of U) expect(run.outcome.fields.sku!.cells[url]).toMatchObject({ status: 'fail', reason: 'not_found' });
    expect(run.outcome.fields.code!.certified).toEqual([GOOD]);
    expect('failReason' in run.outcome.fields.code!).toBe(false);
    expect(run.outcome.fields.product_name!.certified.length).toBeGreaterThan(0);
    expect('failReason' in run.outcome.fields.product_name!).toBe(false);
    expect(run.outcome.allPassed).toBe(false);
    // The captures the run took are all there.
    for (const url of U) expect(run.captures[url]).not.toBeNull();
  }, 60_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/scraper && npx vitest run src/verify/run-verification.test.ts`
Expected: FAIL — the changed "failing capture" test (`'blocked'` received) and the AI test (the run rejects with `Request timed out.`). The CaptureError test may already pass; that is fine.

- [ ] **Step 3: Implement**

`packages/scraper/src/verify/types.ts`, inside `FieldVerification`, after `notOnWebsite?: true;`:

```ts
  /** Set only when this field's AI proposal threw (spec 2026-10-20 §3.3: a time-out, a malformed answer, no credit, the provider down). The field failed this run; `cells` are its result without the AI, every other field's result stands, and the next Verify is the retry. Absent otherwise. */
  failReason?: 'ai_unavailable';
```

`packages/scraper/src/verify/run-verification.ts`, imports — replace line 2 and line 6:

```ts
import { BROWSER_UNAVAILABLE, CaptureError, type IBrowser, type PageCapture, type ReadyCheck } from '@robot/browser';
```
```ts
import { captureProblem, CaptureProblemError } from './capture-check.js';
```

The capture loop's catch (around line 150) becomes:

```ts
    } catch (err) {
      captures[url] = null;
      // Spec 2026-10-20 §3.5.2: what is stored is what the customer reads. A CaptureError or a
      // CaptureProblemError already carries the verdict's sentence; anything else is library text,
      // which goes to the log only.
      const sentence = err instanceof CaptureError || err instanceof CaptureProblemError;
      if (!sentence) console.error(`[verify] capturing ${url} failed:`, err);
      captureErrors[url] = sentence ? err.message : BROWSER_UNAVAILABLE;
    }
```

The AI fallback (around lines 196–210) becomes:

```ts
    if (result.certified.length === 0 && !result.defaultOnly && !result.notOnWebsite && !result.incomplete && agent && !everyCellNoFittingPath(result)) {
      deps.onProgress?.(`asking AI for ${field.key}`);
      const nearMisses = Object.fromEntries(Object.entries(result.cells).map(([u, c]) => [u, c.status === 'fail' ? c.nearMisses ?? [] : []]));
      // I1: only the pages this field is actually checked on go to the model
      // — a page blank for this field (allowed on pages four to six) is not
      // this field's business, costs nothing to search, and just inflates
      // the prompt and its cost.
      const pages = checkedPages(req.verificationSet.urls, expected);
      const checkedExpected = Object.fromEntries(pages.map((u) => [u, expected[u]!]));
      const checkedCaps: Record<string, CaptureLike | null> = Object.fromEntries(pages.map((u) => [u, caps[u] ?? null]));
      let proposals: CandidatePath[];
      try {
        proposals = await proposeWithAi({ field, expected: checkedExpected, captures: checkedCaps, nearMisses }, agent);
      } catch (err) {
        // Spec 2026-10-20 §3.3: one field's AI failure is that field's result, never the run's. Its
        // result without the AI stands, the call is counted (it may have been billed), and every
        // other field, every capture and the cost record are kept.
        console.error(`[verify] the AI proposal for ${field.key} failed:`, err);
        aiCalls++;
        fields[field.key] = { ...result, aiCalled: true, failReason: 'ai_unavailable', fieldHash: fh };
        continue;
      }
      aiCalls++;
      result = await certify({ field, expected, captures: caps, candidates: [...candidates, ...proposals], confirmed, markXPaths, absent, defaultValue }, { evalXPaths });
      result.aiCalled = true;
    }
```

- [ ] **Step 4: Run the file**

Run: `cd packages/scraper && npx vitest run src/verify/run-verification.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/scraper && npx tsc --noEmit` — expected: no errors.

```bash
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts
git commit -m "feat(scraper): one field's AI failure fails that field only; capture failures are stored as sentences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The server's refusals, structured (`@robot/api`) — spec §3.2

**Files:**
- Modify: `packages/api/src/verify/binding-input.ts:38-87` (`bindingProblems` → `bindingProblemList` + wrapper)
- Create: `packages/api/src/verify/verify-refusal.ts`
- Modify: `packages/api/src/trpc.ts:1-28` (error formatter)
- Modify: `packages/api/src/routers/sources.ts:22` (import), `:~1097-1140` (`verify`)
- Test: `packages/api/src/verify/binding-input.test.ts`, `packages/api/src/verify/verify-refusal.test.ts` (create), `packages/api/src/trpc-error-shape.test.ts` (create), `packages/api/src/routers/sources-verify.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export type BindingProblem = { text: string; reason: 'blank' | 'too_few_values' | 'other'; field?: string; product?: number }` and `bindingProblemList(input, contract, opts?): BindingProblem[]` in `binding-input.ts`; `bindingProblems(...)` keeps its signature and returns exactly today's strings.
  - `verify-refusal.ts`: `export type VerifyProblem = { reason: 'blank'; field: string; product: number } | { reason: 'too_few_values'; field: string } | { reason: 'no_fields' } | { reason: 'variants' } | { reason: 'other' }`; `export class VerifyRefusal extends Error { readonly problems: VerifyProblem[] }`; `export const VERIFY_REFUSED = 'Verify could not start'`; `export function refusalProblems(list: BindingProblem[]): VerifyProblem[]`; `export function refuseVerify(problems: VerifyProblem[], log: string[], message?: string): TRPCError`.
  - `trpc.ts`: `export function errorFormatter(...)`; every error shape's `data` gains `verifyProblems: VerifyProblem[] | null`. The app reads it in Task 5 as `err.data.verifyProblems`.
  - `sources.verify` throws `PRECONDITION_FAILED` with `cause: VerifyRefusal`; the message is `Verify could not start` (binding problems, no schema) or `Confirm the variants of every product first` (variants); the raw problem text is `console.warn`ed only.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/verify/binding-input.test.ts` — add `bindingProblemList` to the import from `./binding-input.js`, and append:

```ts
describe('bindingProblemList (spec 2026-10-20 §3.2)', () => {
  it('names a blank required cell by field name and product number, and its text is unchanged', () => {
    const list = bindingProblemList({ ...ok, expected: { ...ok.expected, title: { [U[0]!]: 'a', [U[1]!]: 'b', [U[2]!]: '' } } }, contract);
    expect(list).toEqual([{ text: 'Title @ https://shop.example/p/3: Expected value is required', reason: 'blank', field: 'Title', product: 3 }]);
  });
  it('an invalid value is "other", with its field and product', () => {
    const list = bindingProblemList({ ...ok, expected: { ...ok.expected, price: { [U[0]!]: 'call us', [U[1]!]: '2', [U[2]!]: '3' } } }, contract);
    expect(list).toEqual([{ text: 'Price @ https://shop.example/p/1: Not a money amount', reason: 'other', field: 'Price', product: 1 }]);
  });
  it('too few values is its own reason', () => {
    const list = bindingProblemList({ ...ok, expected: { ...ok.expected, price: { [U[0]!]: '1' } }, absent: { price: { [U[1]!]: true, [U[2]!]: true } } }, contract);
    expect(list).toEqual([{ text: 'Price: needs a value on at least two products, or "not on this product" on every one', reason: 'too_few_values', field: 'Price' }]);
  });
  it('bindingProblems is the list of texts', () => {
    const input = { ...ok, descriptions: { price: 'green' }, expected: { ...ok.expected, title: { [U[0]!]: '', [U[1]!]: 'b', [U[2]!]: 'c' } } };
    expect(bindingProblems(input, contract)).toEqual(bindingProblemList(input, contract).map((p) => p.text));
  });
});
```

Create `packages/api/src/verify/verify-refusal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { refusalProblems, refuseVerify, VerifyRefusal, VERIFY_REFUSED } from './verify-refusal.js';

describe('refusalProblems (spec 2026-10-20 §3.2)', () => {
  it('keeps blank and too-few problems, folds the rest into one "other", and puts "other" last', () => {
    expect(refusalProblems([
      { text: 'All URLs must be on the same website', reason: 'other' },
      { text: 'Rating @ https://s.example/p/3: Expected value is required', reason: 'blank', field: 'Rating', product: 3 },
      { text: 'Price @ https://s.example/p/1: Not a money amount', reason: 'other', field: 'Price', product: 1 },
      { text: 'Brand: needs a value on at least two products, or "not on this product" on every one', reason: 'too_few_values', field: 'Brand' },
    ])).toEqual([
      { reason: 'blank', field: 'Rating', product: 3 },
      { reason: 'too_few_values', field: 'Brand' },
      { reason: 'other' },
    ]);
  });
  it('carries no address and no "@"', () => {
    const json = JSON.stringify(refusalProblems([{ text: 'Rating @ https://s.example/p/3: Expected value is required', reason: 'blank', field: 'Rating', product: 3 }]));
    expect(json).not.toMatch(/https?:|@/);
  });
});

describe('refuseVerify', () => {
  it('is a PRECONDITION_FAILED whose cause holds the problems and whose message holds none of the raw text', () => {
    const err = refuseVerify([{ reason: 'blank', field: 'Rating', product: 3 }], ['Rating @ https://s.example/p/3: Expected value is required']);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe('PRECONDITION_FAILED');
    expect(err.message).toBe(VERIFY_REFUSED);
    expect(err.cause).toBeInstanceOf(VerifyRefusal);
    expect((err.cause as VerifyRefusal).problems).toEqual([{ reason: 'blank', field: 'Rating', product: 3 }]);
  });
});
```

Create `packages/api/src/trpc-error-shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TRPCError, getTRPCErrorShape } from '@trpc/server';
import { appRouter } from './routers/index.js';
import { VerifyRefusal } from './verify/verify-refusal.js';

// The shape the api-server sends for an error, built from the app router's own config — the
// formatter in trpc.ts included (a createCaller test never runs the formatter).
const shapeOf = (error: TRPCError) =>
  getTRPCErrorShape({ config: appRouter._def._config, error, type: 'mutation', path: 'sources.verify', input: undefined, ctx: undefined });

describe('the error shape (spec 2026-10-20 §3.2)', () => {
  it("carries a refused Verify's problems on data.verifyProblems", () => {
    const problems = [{ reason: 'blank' as const, field: 'Rating', product: 3 }];
    const shape = shapeOf(new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify could not start', cause: new VerifyRefusal(problems) }));
    expect(shape.data.verifyProblems).toEqual(problems);
    expect(shape.data.httpStatus).toBe(412);
  });
  it('is null on every other error', () => {
    expect(shapeOf(new TRPCError({ code: 'NOT_FOUND', message: 'x' })).data.verifyProblems).toBeNull();
  });
});
```

(If `getTRPCErrorShape`'s options differ in 11.11, read its declaration via `packages/api/node_modules/@trpc/server/dist/index.d.mts` → `unstable-core-do-not-import.d-*.d.mts` and adapt the call, not the assertions.)

`packages/api/src/routers/sources-verify.test.ts` — add `import { VerifyRefusal } from '../verify/verify-refusal.js';` and, after `makeSchemaSource`, a helper:

```ts
/** The rejection of a call, or null when it resolved. */
const rejectionOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error & { code?: string; cause?: unknown });
```

In "refuses a Source without a schema definition (PRECONDITION_FAILED)", after the `rejects` line add:

```ts
      const err = await rejectionOf(caller.sources.verify({ sourceId: f.sourceId }));
      expect((err!.cause as VerifyRefusal).problems).toEqual([{ reason: 'no_fields' }]);
```

In "verify refuses an incomplete draft and names what is missing", replace the `rejects` assertion with:

```ts
      const err = await rejectionOf(caller.sources.verify({ sourceId: f.sourceId }));
      expect(err).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Verify could not start' });
      expect(err!.cause).toBeInstanceOf(VerifyRefusal);
      expect((err!.cause as VerifyRefusal).problems).toEqual([
        { reason: 'blank', field: 'Price', product: 2 },
        { reason: 'blank', field: 'Price', product: 3 },
      ]);
```

In "a variants-only verify is refused with …", after the existing `rejects` line add:

```ts
      const err = await rejectionOf(caller.sources.verify({ sourceId, onlyKeys: [] }));
      expect((err!.cause as VerifyRefusal).problems).toEqual([{ reason: 'variants' }]);
```

And append inside `describe('sources.verify', …)`:

```ts
  it("refuses a blank required cell with the field's name and the product number, never an address (spec 2026-10-20 §3.2)", async () => {
    const f = await createProjectWithSource(caller, { tag: 'verify-blank', fields: [{ name: 'Price', type: 'money' }, { name: 'Rating', type: 'number' }] });
    try {
      const [p, r] = [f.keys.Price!, f.keys.Rating!];
      await caller.sources.updateBinding({
        sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: { [p]: 'price', [r]: 'stars' },
        expected: { [p]: { [f.urls[0]!]: '1.00', [f.urls[1]!]: '2.00', [f.urls[2]!]: '3.00' }, [r]: { [f.urls[0]!]: '4.5', [f.urls[1]!]: '3.8' } },
      });
      const err = await rejectionOf(caller.sources.verify({ sourceId: f.sourceId }));
      expect(err).toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect((err!.cause as VerifyRefusal).problems).toEqual([{ reason: 'blank', field: 'Rating', product: 3 }]);
      expect(err!.message).not.toMatch(/https?:|@/);
      expect(runSourceVerificationMock).not.toHaveBeenCalled();
      expect(await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, f.sourceId) })).toHaveLength(0);
    } finally { await f.cleanup(); }
  });

  it('refuses too few values with the field name only', async () => {
    const f = await createProjectWithSource(caller, { tag: 'verify-toofew', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const k = f.keys.Price!;
      await caller.sources.updateBinding({
        sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: { [k]: 'price' },
        expected: { [k]: { [f.urls[0]!]: '1.00' } }, absent: { [k]: { [f.urls[1]!]: true, [f.urls[2]!]: true } },
      });
      const err = await rejectionOf(caller.sources.verify({ sourceId: f.sourceId }));
      expect((err!.cause as VerifyRefusal).problems).toEqual([{ reason: 'too_few_values', field: 'Price' }]);
    } finally { await f.cleanup(); }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run (Postgres up, `.env` copied — see Global Constraints):
`cd packages/api && npx vitest run src/verify/binding-input.test.ts src/verify/verify-refusal.test.ts src/trpc-error-shape.test.ts src/routers/sources-verify.test.ts`
Expected: FAIL — `bindingProblemList` and `./verify-refusal.js` do not exist; `verifyProblems` is undefined; `cause` is undefined.

- [ ] **Step 3: Implement**

`packages/api/src/verify/binding-input.ts` — replace the whole `bindingProblems` function (lines 38–87) with:

```ts
/**
 * One binding problem: the sentence saves return and the server logs (`text`, unchanged), and what a
 * refused Verify needs to write it in customer words (spec 2026-10-20 §3.2): `field` is the field's
 * name, never its key; `product` is the page's 1-based position among the proof pages.
 */
export type BindingProblem = { text: string; reason: 'blank' | 'too_few_values' | 'other'; field?: string; product?: number };

export function bindingProblemList(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[], opts: { draft?: boolean } = {}): BindingProblem[] {
  const draft = opts.draft ?? input.draft ?? false;
  const problems: BindingProblem[] = [];
  const other = (text: string): void => { problems.push({ text, reason: 'other' }); };
  const hosts = new Set(input.urls.map(host));
  if (input.listingUrl) hosts.add(host(input.listingUrl));
  if (hosts.size > 1) other('All URLs must be on the same website');
  if (new Set(input.urls.map((u) => normalize('url', u))).size !== input.urls.length) other('URLs must be different pages');
  for (const f of contract) {
    if (!draft && !(input.descriptions[f.key] ?? '').trim()) other(`${f.name}: say where it is on this website`);
    const cells = input.expected[f.key] ?? {};
    const absent = input.absent?.[f.key] ?? {};
    const def = (input.defaults?.[f.key] ?? '').trim();
    if (def) {
      const err = validateExpected(f.type, def);
      if (err) other(`${f.name}: default — ${err}`);
      // A default would fill the very cell the customer said is empty (spec 2026-10-13 §3).
      if (Object.keys(absent).length > 0) other(`${f.name}: a default and "not on this product" cannot both be set`);
    }
    input.urls.forEach((url, i) => {
      const value = cells[url] ?? '';
      if (absent[url] && value.trim() !== '') { other(`${f.name} @ ${url}: a value and "not on this product" cannot both be set`); return; }
      if (absent[url]) return;                                         // a checked page where the answer is nothing
      // Pages four to six: a blank cell means "not checked here" (spec 2026-09-17 §4).
      // A draft save (Verification tab autosave) can leave any cell blank — Verify checks completeness itself.
      // A field with a default: a blank cell on any page is a default cell (spec 2026-10-13 §3).
      if ((draft || i >= VERIFY_URL_MIN || def) && value.trim() === '') return;
      const err = validateExpected(f.type, value);
      if (err) problems.push({ text: `${f.name} @ ${url}: ${err}`, reason: value.trim() === '' ? 'blank' : 'other', field: f.name, product: i + 1 });
    });
    for (const url of input.urls) {
      // A mark on a checked-absent page isn't a problem — "not on this product" drops the mark (spec 2026-10-10 §B1), it doesn't need one.
      if (input.marks?.[f.key]?.[url] && !absent[url] && (cells[url] ?? '').trim() === '') other(`${f.name} @ ${url}: a marked element needs its value`);
    }
    if (!draft) {
      // A field marked "not on this product" anywhere must still have a value on at least two
      // products (spec 2026-10-10 §B1) — otherwise there is nothing to cross-validate against.
      const withValue = input.urls.filter((url) => (cells[url] ?? '').trim() !== '').length;
      const absentCount = input.urls.filter((url) => absent[url]).length;
      // Spec 2026-10-17 §2: absent on products one to three with no value anywhere is "not on this website".
      const notOnWebsite = withValue === 0 && input.urls.slice(0, VERIFY_URL_MIN).every((url) => absent[url]);
      if (absentCount > 0 && withValue < 2 && !notOnWebsite) problems.push({ text: `${f.name}: needs a value on at least two products, or "not on this product" on every one`, reason: 'too_few_values', field: f.name });
    }
  }
  if (!draft) {
    input.urls.slice(VERIFY_URL_MIN).forEach((url) => {
      if (contract.every((f) => (input.expected[f.key]?.[url] ?? '').trim() === '' && !input.absent?.[f.key]?.[url])) other(`${url}: type at least one expected value on this page, or remove it`);
    });
  }
  return problems;
}

/** The problems' texts, exactly as before (saves return them joined; spec 2026-10-20 leaves saves as they are). */
export function bindingProblems(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[], opts: { draft?: boolean } = {}): string[] {
  return bindingProblemList(input, contract, opts).map((p) => p.text);
}
```

Create `packages/api/src/verify/verify-refusal.ts`:

```ts
// Spec 2026-10-20 §3.2: `sources.verify` refuses with structured problems — the field's name, the
// product number (the proof page's position) and a reason — and the app writes the sentence. The
// raw problem text (field keys, full addresses, "@") stays in the server log.
import { TRPCError } from '@trpc/server';
import type { BindingProblem } from './binding-input.js';

export type VerifyProblem =
  | { reason: 'blank'; field: string; product: number }
  | { reason: 'too_few_values'; field: string }
  | { reason: 'no_fields' }
  | { reason: 'variants' }
  | { reason: 'other' };

/** A refused Verify's cause: the formatter in trpc.ts copies `problems` onto `error.data.verifyProblems`. */
export class VerifyRefusal extends Error {
  constructor(public readonly problems: VerifyProblem[]) {
    super('Verify refused');
    this.name = 'VerifyRefusal';
  }
}

/** The message of a refusal whose problems the app writes itself: neutral, no field key, no address. */
export const VERIFY_REFUSED = 'Verify could not start';

/** Binding problems as the app needs them: blank and too-few problems by name and product, everything else one `other`, last. */
export function refusalProblems(list: BindingProblem[]): VerifyProblem[] {
  const named: VerifyProblem[] = [];
  let other = false;
  for (const p of list) {
    if (p.reason === 'blank' && p.field && p.product) named.push({ reason: 'blank', field: p.field, product: p.product });
    else if (p.reason === 'too_few_values' && p.field) named.push({ reason: 'too_few_values', field: p.field });
    else other = true;
  }
  return other ? [...named, { reason: 'other' }] : named;
}

/** The PRECONDITION_FAILED a refused Verify throws; `log` (the raw problem text) goes to the server log only. */
export function refuseVerify(problems: VerifyProblem[], log: string[], message: string = VERIFY_REFUSED): TRPCError {
  if (log.length) console.warn(`[sources.verify] refused:\n  ${log.join('\n  ')}`);
  return new TRPCError({ code: 'PRECONDITION_FAILED', message, cause: new VerifyRefusal(problems) });
}
```

`packages/api/src/trpc.ts` — change the import on line 1, add one import, and pass a formatter to `create`:

```ts
import { initTRPC, TRPCError, type TRPCDefaultErrorShape } from '@trpc/server';
```
```ts
import { VerifyRefusal } from './verify/verify-refusal.js';
```
```ts
/**
 * Every error's shape is tRPC's default plus `data.verifyProblems`: a refused Verify's structured
 * problems (spec 2026-10-20 §3.2), null on every other error. The app writes the sentence from it.
 */
export function errorFormatter({ shape, error }: { shape: TRPCDefaultErrorShape; error: TRPCError }) {
  return { ...shape, data: { ...shape.data, verifyProblems: error.cause instanceof VerifyRefusal ? error.cause.problems : null } };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter,
});
```

`packages/api/src/routers/sources.ts`:
- line 22: import `bindingProblemList` (keep `bindingProblems` only if something else in the file still uses it — grep), and add `import { refuseVerify, refusalProblems } from '../verify/verify-refusal.js';`.
- in `verify`, replace the no-schema throw:

```ts
      if (!hash) {
        throw refuseVerify([{ reason: 'no_fields' }], [`Source ${input.sourceId} has no schema definition to verify`]);
      }
```

- replace the binding check:

```ts
        const problems = bindingProblemList({
          urls: set.urls, ...(set.listing_url ? { listingUrl: set.listing_url } : {}),
          descriptions: Object.fromEntries(defs.map((d) => [d.key, d.description])),
          expected: set.expected, ...(set.marks ? { marks: set.marks } : {}),
          ...(set.absent ? { absent: set.absent } : {}), ...(set.defaults ? { defaults: set.defaults } : {}),
        }, contractFields(source.dataset?.schema));
        if (problems.length) throw refuseVerify(refusalProblems(problems), problems.map((p) => p.text));
```

- replace the variants throw:

```ts
          throw refuseVerify([{ reason: 'variants' }], [], 'Confirm the variants of every product first');
```

- [ ] **Step 4: Run the files**

Run: `cd packages/api && npx vitest run src/verify/binding-input.test.ts src/verify/verify-refusal.test.ts src/trpc-error-shape.test.ts src/routers/sources-verify.test.ts src/routers/sources-marks.test.ts src/routers/site-scope.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/api && npx tsc --noEmit` and `cd packages/app && npx tsc --noEmit` — expected: no errors (the app infers the new error shape and does not read it yet).

```bash
git add packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts packages/api/src/verify/verify-refusal.ts packages/api/src/verify/verify-refusal.test.ts packages/api/src/trpc.ts packages/api/src/trpc-error-shape.test.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-verify.test.ts
git commit -m "feat(api): Verify refuses with structured problems, never raw text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A failed run never replaces the last results; stalled checks say so (`@robot/api`) — spec §3.3, §3.5.5

**Files:**
- Create: `packages/api/src/verify/run-failure.ts`, `packages/api/src/verify/run-failure.test.ts`
- Modify: `packages/api/src/routers/sources.ts:~1160-1225` (`verificationStatus`)
- Modify: `packages/api/src/verify/run-source-verification.ts:167` (blocked-reason fallback)
- Modify: `packages/api/src/verify/coverage-summary.ts` (new constant), `packages/api/src/verify/run-coverage-check.ts:~249` (stage of a stalled check)
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx:~1481` (one line: stop reading the dropped `errorMessage`)
- Test: `packages/api/src/routers/sources-verify.test.ts`, `packages/api/src/verify/run-source-verification.test.ts`, `packages/api/src/verify/run-coverage-check.test.ts`, `packages/api/src/verify/coverage-summary.test.ts`

**Interfaces:**
- Consumes: Task 2's `FieldVerification.failReason` (stored as is, nothing to change); `BROWSER_UNAVAILABLE` from `@robot/browser`.
- Produces:
  - `run-failure.ts`: `export type RunFailure = 'stopped' | 'stalled'`; `export function runFailure(row: { startedAt: Date; completedAt: Date | null; errorMessage: string | null }, now?: number): RunFailure | null`.
  - `sources.verificationStatus` answer: no `errorMessage` field any more; new `failedRun: { id: string; startedAt: Date; stalled: boolean } | null`. When the newest row failed (completed with an error) or stalled (in flight longer than `VERIFY_STALL_MS`), every other field (`id`, `startedAt`, `completedAt`, `allPassed`, `results`, `captures`, `stage`, `aiCalls`, `costUsd`) is the newest completed error-free row's; with no such row, the newest row's. Task 7 reads `failedRun`.
  - `coverage-summary.ts`: `export const COVERAGE_STALLED = 'The check took too long and stopped. Run it again.'`.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/verify/run-failure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { runFailure } from './run-failure.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo);

describe('runFailure (spec 2026-10-20 §3.3)', () => {
  it('a clean completed row did not fail', () => expect(runFailure({ startedAt: at(60_000), completedAt: at(1000), errorMessage: null }, NOW)).toBeNull());
  it('a completed row with an error stopped', () => expect(runFailure({ startedAt: at(60_000), completedAt: at(1000), errorMessage: 'Request timed out.' }, NOW)).toBe('stopped'));
  it("a row closed as 'stalled' stalled", () => expect(runFailure({ startedAt: at(60_000), completedAt: at(1000), errorMessage: 'stalled' }, NOW)).toBe('stalled'));
  it('an in-flight row inside the window is still running', () => expect(runFailure({ startedAt: at(VERIFY_STALL_MS - 1000), completedAt: null, errorMessage: null }, NOW)).toBeNull());
  it('an in-flight row past the window stalled', () => expect(runFailure({ startedAt: at(VERIFY_STALL_MS + 1000), completedAt: null, errorMessage: null }, NOW)).toBe('stalled'));
});
```

`packages/api/src/routers/sources-verify.test.ts` — append:

```ts
describe('sources.verificationStatus — a run that failed never replaces the last results (spec 2026-10-20 §3.3)', () => {
  const RAW = 'page.goto: Timeout 60000ms exceeded. Request timed out.';
  const results = { price: { key: 'price', cells: {}, certified: [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }], weakEvidence: false, aiCalled: false, incomplete: false } };
  const insert = async (values: Partial<typeof sourceVerifications.$inferInsert> & { sourceId: string }) =>
    (await db.insert(sourceVerifications).values({ definitionHash: 'x', ...values }).returning({ id: sourceVerifications.id }))[0]!.id;

  it('a failed newest run: the last completed result, the failure beside it, no raw text', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('failedkeeps');
    try {
      const now = Date.now();
      const done = await insert({ sourceId, startedAt: new Date(now - 120_000), completedAt: new Date(now - 110_000), allPassed: true, results });
      const failed = await insert({ sourceId, startedAt: new Date(now - 60_000), completedAt: new Date(now - 50_000), errorMessage: RAW });
      const status = (await caller.sources.verificationStatus({ sourceId }))!;
      expect(status.id).toBe(done);
      expect(status.results).toEqual(results);
      expect(status.allPassed).toBe(true);
      expect(status.failedRun).toMatchObject({ id: failed, stalled: false });
      expect('errorMessage' in status).toBe(false);
      expect(JSON.stringify(status)).not.toContain('Timeout');
    } finally { await cleanup(); }
  });

  it('a stalled in-flight newest run is a failure too', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('stalledkeeps');
    try {
      const now = Date.now();
      const done = await insert({ sourceId, startedAt: new Date(now - VERIFY_STALL_MS - 120_000), completedAt: new Date(now - VERIFY_STALL_MS - 110_000), allPassed: true, results });
      const stalled = await insert({ sourceId, startedAt: new Date(now - VERIFY_STALL_MS - 1000), captures: { _stage: 'searching' } });
      const status = (await caller.sources.verificationStatus({ sourceId }))!;
      expect(status.id).toBe(done);
      expect(status.stage).toBeNull();
      expect(status.failedRun).toMatchObject({ id: stalled, stalled: true });
    } finally { await cleanup(); }
  });

  it('a failed run with nothing completed before it: no results, the failure, no raw text', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('failedalone');
    try {
      const failed = await insert({ sourceId, completedAt: new Date(), errorMessage: RAW });
      const status = (await caller.sources.verificationStatus({ sourceId }))!;
      expect(status.id).toBe(failed);
      expect(status.results).toEqual({});
      expect(status.failedRun).toMatchObject({ id: failed, stalled: false });
      expect(JSON.stringify(status)).not.toContain('Timeout');
    } finally { await cleanup(); }
  });

  it('a young in-flight run after a failed one carries no failedRun', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('retryafterfail');
    try {
      const now = Date.now();
      await insert({ sourceId, startedAt: new Date(now - 120_000), completedAt: new Date(now - 110_000), allPassed: true, results });
      await insert({ sourceId, startedAt: new Date(now - 60_000), completedAt: new Date(now - 50_000), errorMessage: RAW });
      const running = await insert({ sourceId, startedAt: new Date(now - 1000), captures: { _stage: 'searching' } });
      const status = (await caller.sources.verificationStatus({ sourceId }))!;
      expect(status.id).toBe(running);
      expect(status.completedAt).toBeNull();
      expect(status.stage).toBe('searching');
      expect(status.failedRun).toBeNull();
    } finally { await cleanup(); }
  });
});
```

`packages/api/src/verify/run-source-verification.test.ts` — add `import { BROWSER_UNAVAILABLE } from '@robot/browser';` (beside the `PageCapture` type import) and append inside `describe('runSourceVerification', …)`:

```ts
  it("one field's AI failure completes the run: its ai_unavailable result and the calls are stored, and a page with no reason reads the browser sentence (spec 2026-10-20 §3.3, §3.5.2)", async () => {
    const { sourceId, urls, cleanup } = await makeSchemaSource('aiunavailable');
    try {
      const verificationId = await startVerificationRow(sourceId);
      const price = { key: 'price', cells: { [urls[0]!]: { status: 'fail', reason: 'not_found' } }, certified: [], weakEvidence: false, aiCalled: true, incomplete: true, failReason: 'ai_unavailable' };
      runVerificationMock.mockResolvedValue({
        outcome: { fields: { price }, allPassed: false, aiCalls: 1 },
        captures: { [urls[0]!]: fakeCapture(urls[0]!, '<html>1</html>'), [urls[1]!]: fakeCapture(urls[1]!, '<html>2</html>'), [urls[2]!]: null },
        captureErrors: {},
      });
      await runSourceVerification(sourceId, verificationId, { startCoverage });
      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.completedAt).not.toBeNull();
      expect(row!.errorMessage).toBeNull();
      expect(row!.aiCalls).toBe(1);
      expect(row!.results).toEqual({ price });
      expect((row!.captures as Record<string, { blockedReason?: string }>)[urls[2]!]!.blockedReason).toBe(BROWSER_UNAVAILABLE);
    } finally { await cleanup(); }
  });
```

`packages/api/src/verify/coverage-summary.test.ts` — import `COVERAGE_STALLED` and append:

```ts
describe('COVERAGE_STALLED (spec 2026-10-20 §3.5.5)', () => {
  it('names no internal word', () => {
    expect(COVERAGE_STALLED).toBe('The check took too long and stopped. Run it again.');
    expect(COVERAGE_STALLED).not.toMatch(/stalled|superseded/i);
  });
});
```

`packages/api/src/verify/run-coverage-check.test.ts` — import `COVERAGE_STALLED` from `./coverage-summary.js`; in "one running check per website; a stalled one is closed failed/stalled and a new one may start" change the comment and expectation (around lines 355–357) to:

```ts
      // Read on its own, a stalled row is closed on the way and says so in customer words (spec 2026-10-20 §3.5.5).
      expect(await latestCoverageCheck(f.sourceId)).toMatchObject({ id: second.checkId, status: 'failed', error: 'stalled', stage: COVERAGE_STALLED, fields: [] });
```

and add:

```ts
  it('a superseded check has no stage line (spec 2026-10-20 §3.5.5)', async () => {
    const f = await certifiedWebsite('cov-superseded');
    try {
      const first = await startCoverageCheck(f.sourceId, null, { fire: false });
      await db.update(coverageChecks).set({ status: 'failed', error: 'superseded', completedAt: new Date() }).where(eq(coverageChecks.id, first.checkId));
      expect(await latestCoverageCheck(f.sourceId)).toMatchObject({ id: first.checkId, status: 'failed', stage: null });
    } finally { await f.cleanup(); }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/api && npx vitest run src/verify/run-failure.test.ts src/routers/sources-verify.test.ts src/verify/run-source-verification.test.ts src/verify/coverage-summary.test.ts src/verify/run-coverage-check.test.ts`
Expected: FAIL — `run-failure.js` and `COVERAGE_STALLED` do not exist; the status tests read the failed row; `blockedReason` reads `'not captured'`; the stalled coverage stage is `null`.

- [ ] **Step 3: Implement**

Create `packages/api/src/verify/run-failure.ts`:

```ts
// Spec 2026-10-20 §3.3: did a verification row end without finishing? A row closed with an error
// stopped (its raw error stays on the row, for ops); a row closed as 'stalled', or still in flight
// past the stall window (`resolveInFlightVerification`'s rule, in-flight.ts), stalled.
import { VERIFY_STALL_MS } from '@robot/scraper';

export type RunFailure = 'stopped' | 'stalled';

export function runFailure(row: { startedAt: Date; completedAt: Date | null; errorMessage: string | null }, now: number = Date.now()): RunFailure | null {
  if (row.completedAt !== null) return row.errorMessage === null ? null : row.errorMessage === 'stalled' ? 'stalled' : 'stopped';
  return now - row.startedAt.getTime() > VERIFY_STALL_MS ? 'stalled' : null;
}
```

`packages/api/src/routers/sources.ts` — add `import { runFailure } from '../verify/run-failure.js';`. In `verificationStatus`, replace the first query (`const row = await ctx.db.query.sourceVerifications.findFirst(…)` and `if (!row) return null;`) with:

```ts
      const newest = await ctx.db.query.sourceVerifications.findFirst({
        where: eq(sourceVerifications.sourceId, input.sourceId),
        orderBy: [desc(sourceVerifications.startedAt)],
      });
      if (!newest) return null;
      // Spec 2026-10-20 §3.3, §5.3: a run that failed or stalled never replaces the last completed
      // results on screen. The tab gets the newest completed, error-free run and, beside it, the
      // failure; the raw error stays on the row, for ops, and is never in this answer.
      const failure = runFailure(newest);
      const lastGood = failure
        ? await ctx.db.query.sourceVerifications.findFirst({
            where: and(eq(sourceVerifications.sourceId, input.sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
            orderBy: [desc(sourceVerifications.startedAt)],
          })
        : undefined;
      const row = lastGood ?? newest;
```

(the `source`, `currency`, `fieldCount` and `v` lines in between stay), and replace the `return { … }` object with:

```ts
      return {
        id: row.id,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        allPassed: row.allPassed,
        results: row.results,
        captures,
        stage,
        aiCalls: row.aiCalls,
        costUsd: row.costUsd,
        // The newest run, when it failed or stalled (spec 2026-10-20 §3.3): the app says so in the Verify bar.
        failedRun: failure ? { id: newest.id, startedAt: newest.startedAt, stalled: failure === 'stalled' } : null,
        currentKeys,
        // Fields whose latest result still matches them, passed or failed: a failure there is real, not stale.
        unchangedKeys,
        // Spec 2026-10-17 §2: fields currently passed as not on this website — the Extract sample's empty-cell note leaves them out.
        notOnWebsiteKeys: notOnWebsiteKeys(currency),
        current: fieldCount > 0 && currentKeys.length === fieldCount,
        // Variants (spec 2026-10-01): null when this website needs none; `current`/`passed` as `loadVariantCurrency` decides them.
        variants,
      };
```

Add to the procedure's doc comment: "A newest run that failed or stalled (spec 2026-10-20 §3.3) is not handed back: the newest completed, error-free run is, with `failedRun` naming the failure. `errorMessage` is never in this answer; ops reads it from the row."

`packages/api/src/verify/run-source-verification.ts` — add `import { BROWSER_UNAVAILABLE } from '@robot/browser';` (beside the `PageCapture` type import) and on line 167 replace `?? 'not captured'` with `?? BROWSER_UNAVAILABLE`.

`packages/api/src/verify/coverage-summary.ts` — add above `stageLine`:

```ts
/** A coverage check that ran past its window (spec 2026-10-20 §3.5.5); a superseded one says nothing (a newer check replaced it). */
export const COVERAGE_STALLED = 'The check took too long and stopped. Run it again.';
```

`packages/api/src/verify/run-coverage-check.ts` — import `COVERAGE_STALLED` from `./coverage-summary.js` (the file already imports from it) and change the stage in `latestCoverageCheck`:

```ts
    stage: stageLine(status, results, fields.length, row.error === 'superseded' ? null : row.error === 'stalled' ? COVERAGE_STALLED : row.error),
```

and in the doc comment above `latestCoverageCheck` say "a stalled check's stage is `COVERAGE_STALLED`; a superseded one's is null".

`packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` — the `runNote` line (around 1481) stops reading the dropped field (Task 7 removes the line):

```ts
    strip === 'stalled' ? 'The last verification stalled. Run it again.' : strip === 'failed' ? 'The last verification failed.' : null;
```

- [ ] **Step 4: Run the files**

Run: `cd packages/api && npx vitest run src/verify/run-failure.test.ts src/routers/sources-verify.test.ts src/verify/run-source-verification.test.ts src/verify/coverage-summary.test.ts src/verify/run-coverage-check.test.ts src/verify/current-certification.test.ts src/routers/sources-binding.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/api && npx tsc --noEmit` and `cd packages/app && npx tsc --noEmit` — expected: no errors. (`extract.tsx` reads `status.current`, `allPassed` and `notOnWebsiteKeys`, all still there; grep `packages/app/src` for `errorMessage` read off a `verificationStatus` answer — the `runNote` line was the only one.)

```bash
git add packages/api/src/verify/run-failure.ts packages/api/src/verify/run-failure.test.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-verify.test.ts packages/api/src/verify/run-source-verification.ts packages/api/src/verify/run-source-verification.test.ts packages/api/src/verify/coverage-summary.ts packages/api/src/verify/coverage-summary.test.ts packages/api/src/verify/run-coverage-check.ts packages/api/src/verify/run-coverage-check.test.ts "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
git commit -m "feat(api): a failed or stalled Verify keeps the last completed results; stalled checks say so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Every sentence, in one place (`@robot/app`) — spec §3.1–§3.5, §5.4

**Files:**
- Create: `packages/app/src/lib/site/verify-messages.ts`, `packages/app/src/lib/site/verify-messages.test.ts`
- Modify: `packages/app/src/lib/site/verification-view.ts` (`FailReason`, `FieldVerification`, `hintFor`, new `cellHint`, new `blockedReasons`)
- Modify: `packages/app/src/lib/site/verification-model.ts:34` (`Badge`), `:48` (`VerificationResultsLike`), `:~772-779` (`badge`)
- Modify: `packages/app/src/components/verification/field-details.tsx:~22-43` (`BadgeView`)
- Test: `packages/app/src/lib/site/verification-view.test.ts`, `packages/app/src/lib/site/verification-model.test.ts`

**Interfaces:**
- Consumes: the wire shapes from Tasks 1–4, mirrored, never imported: `FailReason` `'elsewhere'`, `failReason?: 'ai_unavailable'`, `error.data.verifyProblems`, `captures[url].blockedReason`, `failedRun`.
- Produces (all in `lib/site/verify-messages.ts` unless noted):
  - constants `VERIFY_COULD_NOT_START`, `NO_FIELDS`, `CONFIRM_VARIANTS`, `FAILED_RUN_KEPT`, `FAILED_RUN_NOTHING_KEPT`, `SCREENSHOT_TOO_LONG`, `SCREENSHOT_COULD_NOT_START`, `AI_UNAVAILABLE_BADGE`, `NOT_VERIFIED_BADGE`, `PAGE_NOT_READ`;
  - `type VerifyProblemLike`; `problemSentence(p: VerifyProblemLike): string`; `refusalSentence(problems: readonly unknown[] | null | undefined): string`; `refusalFromError(err: unknown): string`;
  - `failedRunSentence(hasResults: boolean): string`; `verifyMessage(args: { refusal: string | null; failedRun: { id: string } | null; hasResults: boolean; running: boolean }): string | null`;
  - `aiUnavailableHint(field: string): string`; `notCheckedText(product: number, reason: string | undefined): string`; `captureErrorText(error: string | undefined): string | undefined`; `stageText(stage: string | null, fieldNames: Record<string, string>): string | null`;
  - `verification-view.ts`: `cellHint(args: { results: VerificationResults | null | undefined; key: string; url: string; unchanged: boolean; fieldType?: string; fieldName: string; product: number; blockedReason?: string }): string | undefined`; `blockedReasons(captures: unknown): Record<string, string>`;
  - `verification-model.ts`: `Badge` gains `{ kind: 'unverified'; text: string }`; `badge(args)` takes an optional `blocked?: Record<string, string>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/lib/site/verify-messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AI_UNAVAILABLE_BADGE, CONFIRM_VARIANTS, FAILED_RUN_KEPT, FAILED_RUN_NOTHING_KEPT, NO_FIELDS, NOT_VERIFIED_BADGE, PAGE_NOT_READ,
  SCREENSHOT_COULD_NOT_START, SCREENSHOT_TOO_LONG, VERIFY_COULD_NOT_START,
  aiUnavailableHint, captureErrorText, failedRunSentence, notCheckedText, problemSentence, refusalFromError, refusalSentence, stageText, verifyMessage,
  type VerifyProblemLike,
} from './verify-messages';
import { hintFor, type FailReason } from './verification-view';

describe('a refused Verify in customer words (spec 2026-10-20 §3.2)', () => {
  it('a blank required cell', () => {
    expect(problemSentence({ reason: 'blank', field: 'Rating', product: 3 })).toBe('Rating on product 3 needs a value, or "Not on this product". Nothing was checked.');
  });
  it('too few values', () => {
    expect(problemSentence({ reason: 'too_few_values', field: 'Brand' })).toBe('Brand needs a value on at least two products, or "not on this product" on every one.');
  });
  it('no fields, variants, anything else', () => {
    expect(problemSentence({ reason: 'no_fields' })).toBe('This website has no fields yet. Add fields to the project, then verify.');
    expect(problemSentence({ reason: 'variants' })).toBe('Confirm the variants of every product first');
    expect(problemSentence({ reason: 'other' })).toBe('Verify could not start. Try again; if it keeps happening, contact us.');
  });
  it('says the first problem it can name', () => {
    expect(refusalSentence([{ reason: 'bogus' }, { reason: 'blank', field: 'Rating', product: 3 }, { reason: 'other' }])).toBe(problemSentence({ reason: 'blank', field: 'Rating', product: 3 }));
    expect(refusalSentence([])).toBe(VERIFY_COULD_NOT_START);
    expect(refusalSentence([{ reason: 'blank', field: '', product: 3 }])).toBe(VERIFY_COULD_NOT_START);
  });
  it("reads the server's problems off a tRPC error", () => {
    expect(refusalFromError({ message: 'Verify could not start', data: { verifyProblems: [{ reason: 'too_few_values', field: 'Brand' }] } })).toBe(problemSentence({ reason: 'too_few_values', field: 'Brand' }));
  });
  it('a Verify error without problems says could-not-start, never its message', () => {
    expect(refusalFromError(new Error('Price @ https://shop.example/p/1: Expected value is required'))).toBe(VERIFY_COULD_NOT_START);
    expect(refusalFromError({ message: 'Failed to fetch', data: { verifyProblems: null } })).toBe(VERIFY_COULD_NOT_START);
    expect(refusalFromError(null)).toBe(VERIFY_COULD_NOT_START);
    expect(refusalFromError('boom')).toBe(VERIFY_COULD_NOT_START);
  });
});

describe('the Verify bar message (spec 2026-10-20 §3.1, §3.3)', () => {
  it('a failed run keeps the results it had', () => {
    expect(failedRunSentence(true)).toBe('Verify stopped before it finished. Your last results are kept — try again.');
    expect(failedRunSentence(false)).toBe(FAILED_RUN_NOTHING_KEPT);
  });
  it('shows the newest message, and nothing while a Verify runs', () => {
    expect(verifyMessage({ refusal: null, failedRun: null, hasResults: true, running: false })).toBeNull();
    expect(verifyMessage({ refusal: null, failedRun: { id: 'r' }, hasResults: true, running: false })).toBe(FAILED_RUN_KEPT);
    expect(verifyMessage({ refusal: 'R', failedRun: { id: 'r' }, hasResults: true, running: false })).toBe('R');
    expect(verifyMessage({ refusal: 'R', failedRun: { id: 'r' }, hasResults: true, running: true })).toBeNull();
  });
});

describe('hints, badges and captures (spec 2026-10-20 §3.3, §3.5)', () => {
  it('the ai_unavailable hint', () => {
    expect(aiUnavailableHint('Description')).toBe("We couldn't finish checking Description this time. Verify again — nothing else changed.");
  });
  it('not checked on a product, with its reason', () => {
    expect(notCheckedText(2, 'shop.example did not answer in time.')).toBe('Not checked on product 2 — shop.example did not answer in time.');
    expect(notCheckedText(2, undefined)).toBe(`Not checked on product 2 — ${PAGE_NOT_READ}.`);
    expect(notCheckedText(2, 'not captured')).toBe(`Not checked on product 2 — ${PAGE_NOT_READ}.`);
  });
  it('notCheckedText never repeats raw library text', () => {
    for (const raw of ['page.goto: Timeout 60000ms exceeded.', 'Error: net::ERR_CONNECTION_RESET at https://x', 'browserType.launch: Target closed\n    at Object.launch', 'stalled', 'x'.repeat(300)]) {
      expect(notCheckedText(4, raw)).toBe(`Not checked on product 4 — ${PAGE_NOT_READ}.`);
    }
  });
  it('a capture error: stalled in words; a verdict sentence as it is', () => {
    expect(captureErrorText('stalled')).toBe(SCREENSHOT_TOO_LONG);
    expect(captureErrorText(undefined)).toBeUndefined();
    expect(captureErrorText('shop.example did not answer in time.')).toBe('shop.example did not answer in time.');
    expect(SCREENSHOT_COULD_NOT_START).toBe('The screenshot could not start. Take it again.');
  });
  it('the stage line never shows a stage word, a key or "AI"', () => {
    const names = { price_eur: 'Price' };
    expect(stageText(null, names)).toBeNull();
    expect(stageText('starting', names)).toBe('Starting…');
    expect(stageText('capturing 2/3', names)).toBe('Taking screenshot 2 of 3…');
    expect(stageText('searching', names)).toBe('Looking for your values on the pages…');
    expect(stageText('asking AI for price_eur', names)).toBe('Taking a closer look at Price…');
    expect(stageText('asking AI for gone_key', names)).toBe('Taking a closer look at a field…');
    expect(stageText('checking variants', names)).toBe('Checking the variants…');
    expect(stageText('something new', names)).toBe('Verifying…');
  });
});

describe('no customer sentence names an internal (spec 2026-10-20 §5.4)', () => {
  const INTERNAL = [/https?:\/\//i, /@/, /\bHTTP\b/i, /\b[1-5]\d\d\b/, /price_eur/, /\bstalled\b/i, /\bsuperseded\b/i, /\bJev\b/, /\bAI\b/, /\bmodel\b/i, /\bError\b/, /\$\s?\d/, /\bundefined\b|\bnull\b/];
  const names = { price_eur: 'Price' };
  const problems: VerifyProblemLike[] = [{ reason: 'blank', field: 'Price', product: 2 }, { reason: 'too_few_values', field: 'Price' }, { reason: 'no_fields' }, { reason: 'variants' }, { reason: 'other' }];
  const reasons: FailReason[] = ['not_found', 'different_value', 'ambiguous', 'type_mismatch', 'no_fitting_path', 'found_unexpected', 'elsewhere'];
  const sentences: string[] = [
    VERIFY_COULD_NOT_START, NO_FIELDS, CONFIRM_VARIANTS, FAILED_RUN_KEPT, FAILED_RUN_NOTHING_KEPT, SCREENSHOT_TOO_LONG, SCREENSHOT_COULD_NOT_START, AI_UNAVAILABLE_BADGE, NOT_VERIFIED_BADGE,
    ...problems.map(problemSentence),
    refusalFromError(new Error('PRECONDITION_FAILED: price_eur @ https://shop.example/p/1: Expected value is required')),
    failedRunSentence(true), failedRunSentence(false),
    aiUnavailableHint('Price'),
    notCheckedText(2, 'page.goto: Timeout 60000ms exceeded.\n    at Page.goto'), notCheckedText(2, undefined),
    captureErrorText('stalled')!,
    ...['starting', 'capturing 2/3', 'searching', 'asking AI for price_eur', 'checking variants', 'something new'].map((s) => stageText(s, names)!),
    ...reasons.map((r) => hintFor(r, '12.50', 'a money amount', 'Price', 2)),
    hintFor('found_unexpected', undefined, undefined, 'Price', 2),
  ];
  it.each(sentences)('%s', (s) => {
    for (const re of INTERNAL) expect(s).not.toMatch(re);
  });
});
```

`packages/app/src/lib/site/verification-view.test.ts` — add `cellHint, blockedReasons` to the import; inside `describe('hintFor', …)` replace the old `found_unexpected` test with these two:

```ts
  test('found_unexpected is a sentence and a question (spec 2026-10-20 §3.5.4)', () => {
    expect(hintFor('found_unexpected', '0', undefined, undefined, 4)).toBe("Found 0 on product 4, but you said it isn't there. Is it there after all?");
    expect(hintFor('found_unexpected', undefined, undefined, undefined, 4)).toBe("Found a value on product 4, but you said it isn't there. Is it there after all?");
  });

  test('elsewhere names the field and the way out (spec 2026-10-20 §3.4)', () => {
    expect(hintFor('elsewhere', undefined, 'text', 'Description', 4)).toBe('Found on this product, but not where your other products show it. If this product really has no Description of its own, choose "Not on this product".');
  });
```

and append at the end of the file:

```ts
describe('cellHint (spec 2026-10-20 §3.3, §3.5.1, §3.5.2)', () => {
  const U1 = 'https://x/1', U2 = 'https://x/2';
  const results: VerificationResults = {
    desc: { key: 'desc', cells: { [U1]: { status: 'pass', found: 'a' }, [U2]: { status: 'fail', reason: 'elsewhere' } }, certified: [], weakEvidence: false, aiCalled: false, incomplete: false },
    sku: { key: 'sku', cells: { [U1]: { status: 'fail', reason: 'not_found' } }, certified: [], weakEvidence: false, aiCalled: true, incomplete: false, failReason: 'ai_unavailable' },
    price: { key: 'price', cells: { [U1]: { status: 'pass', found: '1' }, [U2]: { status: 'not_captured' } }, certified: [], weakEvidence: false, aiCalled: false, incomplete: true },
  };
  const base = { results, unchanged: true, fieldType: 'text', product: 2 };
  it("a fail cell's hint", () => {
    expect(cellHint({ ...base, key: 'desc', url: U2, fieldName: 'Description' })).toBe(hintFor('elsewhere', undefined, 'text', 'Description', 2));
  });
  it('an ai_unavailable field says so on any of its cells', () => {
    expect(cellHint({ ...base, key: 'sku', url: U1, fieldName: 'SKU', product: 1 })).toBe("We couldn't finish checking SKU this time. Verify again — nothing else changed.");
  });
  it('a page the run could not capture says why', () => {
    expect(cellHint({ ...base, key: 'price', url: U2, fieldName: 'Price', blockedReason: 'x.example did not answer in time.' })).toBe('Not checked on product 2 — x.example did not answer in time.');
  });
  it('nothing for a pass, a changed field, or no result', () => {
    expect(cellHint({ ...base, key: 'desc', url: U1, fieldName: 'Description', product: 1 })).toBeUndefined();
    expect(cellHint({ ...base, key: 'desc', url: U2, fieldName: 'Description', unchanged: false })).toBeUndefined();
    expect(cellHint({ ...base, results: null, key: 'desc', url: U2, fieldName: 'Description' })).toBeUndefined();
  });
});

describe('blockedReasons', () => {
  it('reads the reason of each page the run could not capture, and nothing else', () => {
    expect(blockedReasons({
      'https://x/1': { captureId: 'c1', capturedAt: 't' },
      'https://x/2': { captureId: '', capturedAt: 't', blockedReason: 'x.example did not answer in time.' },
      _stage: 'searching',
    })).toEqual({ 'https://x/2': 'x.example did not answer in time.' });
    expect(blockedReasons(null)).toEqual({});
  });
});
```

`packages/app/src/lib/site/verification-model.test.ts` — add `import { AI_UNAVAILABLE_BADGE, NOT_VERIFIED_BADGE } from './verify-messages';` and append inside `describe('the battery and the badge', …)`:

```ts
  it('a failed field never shows a blank status (spec 2026-10-20 §3.5.3)', () => {
    const cards = board().cards;
    const run = (price: Record<string, unknown>) => badge({ key: 'price', results: { price } as never, unchangedKeys: ['price'], running: false, cards, blocked: { [U[1]!]: 'shop.example did not answer in time.' } });
    expect(run({ certified: [], failReason: 'ai_unavailable', cells: { [U[0]!]: { status: 'pass' } } })).toEqual({ kind: 'unverified', text: AI_UNAVAILABLE_BADGE });
    expect(run({ certified: [], cells: { [U[0]!]: { status: 'pass' }, [U[1]!]: { status: 'not_captured' } } })).toEqual({ kind: 'unverified', text: 'Not checked on product 2 — shop.example did not answer in time.' });
    expect(run({ certified: [], cells: { [U[0]!]: { status: 'pass' } } })).toEqual({ kind: 'unverified', text: NOT_VERIFIED_BADGE });
    // With a fail cell, an AI failure names its products like any failure.
    expect(run({ certified: [], failReason: 'ai_unavailable', cells: { [U[1]!]: { status: 'fail' } } })).toEqual({ kind: 'fails', products: [2] });
  });

  it('an ai_unavailable field is re-verified next time and never reads verified', () => {
    const results = { title: { certified: [{}], cells: {} }, price: { certified: [], failReason: 'ai_unavailable' as const, cells: { [U[0]!]: { status: 'fail' as const } } } };
    expect(reverifyScope(FIELDS, results, ['title'])).toEqual(['price']);
    expect(badge({ key: 'price', results, unchangedKeys: ['title', 'price'], running: false, cards: board().cards })).toEqual({ kind: 'fails', products: [1] });
  });
```

If an existing badge test expects `null` for a failed field with no fail cell, it encodes the blank Status this spec removes: change it to the `unverified` badge and say so in the commit message.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/app && npx vitest run src/lib/site/verify-messages.test.ts src/lib/site/verification-view.test.ts src/lib/site/verification-model.test.ts`
Expected: FAIL — `./verify-messages` does not exist; `cellHint`/`blockedReasons` are not exported; `badge` returns `null`.

- [ ] **Step 3: Implement**

Create `packages/app/src/lib/site/verify-messages.ts`:

```ts
// Verify never fails silently (spec 2026-10-20): every sentence a customer reads when Verify, a
// re-verify or a proof-page capture does not succeed, and the Verify stage line. Pure. No sentence
// names a field key, an address, an HTTP status, "@", a library's error text or an internal word
// (§2, §5.4); field names and product numbers are the customer's own.

/** Mirrors `@robot/api`'s `VerifyProblem` (verify/verify-refusal.ts); never imported. */
export type VerifyProblemLike =
  | { reason: 'blank'; field: string; product: number }
  | { reason: 'too_few_values'; field: string }
  | { reason: 'no_fields' }
  | { reason: 'variants' }
  | { reason: 'other' };

export const VERIFY_COULD_NOT_START = 'Verify could not start. Try again; if it keeps happening, contact us.';
export const NO_FIELDS = 'This website has no fields yet. Add fields to the project, then verify.';
export const CONFIRM_VARIANTS = 'Confirm the variants of every product first';
export const FAILED_RUN_KEPT = 'Verify stopped before it finished. Your last results are kept — try again.';
/** Planner's copy: a run that failed with no completed run before it has nothing to keep. */
export const FAILED_RUN_NOTHING_KEPT = 'Verify stopped before it finished. Try again.';
export const SCREENSHOT_TOO_LONG = 'The screenshot took too long. Take it again.';
export const SCREENSHOT_COULD_NOT_START = 'The screenshot could not start. Take it again.';
/** Planner's copy: the badge of a field whose AI step failed and that has no failing product to name. */
export const AI_UNAVAILABLE_BADGE = 'not finished — verify again';
/** Planner's copy: the badge of a failed field with no failing product and every page captured. */
export const NOT_VERIFIED_BADGE = 'not verified — mark it on the screenshot';
/** Planner's copy: a capture reason that is missing or not fit to show. */
export const PAGE_NOT_READ = 'the page could not be read';

export function problemSentence(p: VerifyProblemLike): string {
  switch (p.reason) {
    case 'blank':
      return `${p.field} on product ${p.product} needs a value, or "Not on this product". Nothing was checked.`;
    case 'too_few_values':
      return `${p.field} needs a value on at least two products, or "not on this product" on every one.`;
    case 'no_fields':
      return NO_FIELDS;
    case 'variants':
      return CONFIRM_VARIANTS;
    case 'other':
      return VERIFY_COULD_NOT_START;
  }
}

const named = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

function isProblem(x: unknown): x is VerifyProblemLike {
  if (!x || typeof x !== 'object') return false;
  const p = x as { reason?: unknown; field?: unknown; product?: unknown };
  switch (p.reason) {
    case 'blank':
      return named(p.field) && typeof p.product === 'number' && Number.isInteger(p.product) && p.product >= 1;
    case 'too_few_values':
      return named(p.field);
    case 'no_fields':
    case 'variants':
    case 'other':
      return true;
    default:
      return false;
  }
}

/** One sentence for a refused Verify: the first problem it can name, else "could not start". */
export function refusalSentence(problems: readonly unknown[] | null | undefined): string {
  const first = (problems ?? []).find(isProblem);
  return first ? problemSentence(first) : VERIFY_COULD_NOT_START;
}

/** What a failed `sources.verify` call says (spec §3.2): the server's structured problems, never the error's message. */
export function refusalFromError(err: unknown): string {
  const problems = err && typeof err === 'object' ? (err as { data?: { verifyProblems?: unknown } }).data?.verifyProblems : undefined;
  return refusalSentence(Array.isArray(problems) ? problems : null);
}

export function failedRunSentence(hasResults: boolean): string {
  return hasResults ? FAILED_RUN_KEPT : FAILED_RUN_NOTHING_KEPT;
}

/** The Verify bar's one message (spec §3.1): nothing while a Verify runs; else the refusal (newest), else the failed run. */
export function verifyMessage(args: { refusal: string | null; failedRun: { id: string } | null; hasResults: boolean; running: boolean }): string | null {
  if (args.running) return null;
  if (args.refusal) return args.refusal;
  return args.failedRun ? failedRunSentence(args.hasResults) : null;
}

export function aiUnavailableHint(field: string): string {
  return `We couldn't finish checking ${field} this time. Verify again — nothing else changed.`;
}

/** Library text, a stack, an internal word, or something too long to be a sentence of ours. */
const RAW = /\b(?:Error|Exception)\b|Timeout \d+ms|\bpage\.\w+|net::ERR_|browserType|Target (?:page|closed)|\n|\s at /;

function readableReason(reason: string | undefined): string {
  const r = (reason ?? '').trim().replace(/\.+$/, '');
  if (!r || r === 'not captured' || r === 'stalled' || r.length > 240 || RAW.test(r)) return PAGE_NOT_READ;
  return r;
}

/** A field a failed capture left unchecked on a product (spec §3.5.2): the stored verdict sentence, never raw text. */
export function notCheckedText(product: number, reason: string | undefined): string {
  return `Not checked on product ${product} — ${readableReason(reason)}.`;
}

/** A proof-page capture's stored error as a card shows it (spec §3.5.5): "stalled" in words; a verdict sentence as it is. */
export function captureErrorText(error: string | undefined): string | undefined {
  if (error === undefined) return undefined;
  return error === 'stalled' ? SCREENSHOT_TOO_LONG : error;
}

/** Verify's stage line (`runVerification`'s onProgress stages) in customer words; the raw stage names a key and "AI". */
export function stageText(stage: string | null, fieldNames: Record<string, string>): string | null {
  if (stage === null) return null;
  if (stage === 'starting') return 'Starting…';
  const capturing = /^capturing (\d+)\/(\d+)$/.exec(stage);
  if (capturing) return `Taking screenshot ${capturing[1]} of ${capturing[2]}…`;
  if (stage === 'searching') return 'Looking for your values on the pages…';
  const asking = /^asking AI for (.+)$/.exec(stage);
  if (asking) return `Taking a closer look at ${fieldNames[asking[1]!] ?? 'a field'}…`;
  if (stage === 'checking variants') return 'Checking the variants…';
  return 'Verifying…';
}
```

`packages/app/src/lib/site/verification-view.ts`:
- after the header comment: `import { aiUnavailableHint, notCheckedText } from './verify-messages';`
- `FailReason` gains `| 'elsewhere'`;
- in `FieldVerification`, after `notOnWebsite?: true;`:

```ts
  /** The field's AI step failed this run (spec 2026-10-20 §3.3); its other results stand. Absent otherwise. */
  failReason?: 'ai_unavailable';
```

- in `hintFor`, replace the `found_unexpected` case and add `elsewhere`:

```ts
    case 'found_unexpected':
      return `Found ${found ?? 'a value'}${product !== undefined ? ` on product ${product}` : ''}, but you said it isn't there. Is it there after all?`;
    case 'elsewhere':
      return `Found on this product, but not where your other products show it. If this product really has no ${field || 'value'} of its own, choose "Not on this product".`;
```

- append:

```ts
/**
 * What a cell says under its state (spec 2026-10-20 §3.3, §3.5.1, §3.5.2): the field's AI failure on
 * any of its cells, a fail cell's hint, or why a page was not checked. Undefined for a pass, for a
 * field that changed since its result, and before any result.
 */
export function cellHint(args: {
  results: VerificationResults | null | undefined;
  key: string;
  url: string;
  unchanged: boolean;
  fieldType?: string;
  fieldName: string;
  product: number;
  blockedReason?: string;
}): string | undefined {
  if (!args.unchanged) return undefined;
  const fv = args.results?.[args.key];
  if (!fv) return undefined;
  if (fv.failReason === 'ai_unavailable' && fv.certified.length === 0) return aiUnavailableHint(args.fieldName);
  const cell = fv.cells[args.url];
  if (!cell) return undefined;
  if (cell.status === 'fail') return hintFor(cell.reason, cell.found, args.fieldType, args.fieldName, args.product);
  if (cell.status === 'not_captured') return notCheckedText(args.product, args.blockedReason);
  return undefined;
}

/** url → the reason the run could not capture that page, from a status answer's `captures` (a ref with no capture id). */
export function blockedReasons(captures: unknown): Record<string, string> {
  if (!captures || typeof captures !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [url, ref] of Object.entries(captures as Record<string, unknown>)) {
    const r = ref && typeof ref === 'object' ? (ref as { captureId?: unknown; blockedReason?: unknown }) : null;
    if (r && !r.captureId && typeof r.blockedReason === 'string') out[url] = r.blockedReason;
  }
  return out;
}
```

`packages/app/src/lib/site/verification-model.ts`:
- add `import { AI_UNAVAILABLE_BADGE, NOT_VERIFIED_BADGE, notCheckedText } from './verify-messages';` with the other imports;
- line 34:

```ts
/** `unverified` (spec 2026-10-20 §3.5.3): a failed field with no failing product to name says why, instead of a blank Status. */
export type Badge = { kind: 'verified' } | { kind: 'fails'; products: number[] } | { kind: 'unverified'; text: string } | { kind: 'changed' } | { kind: 'checking' } | null;
```

- line 48: add `failReason?: 'ai_unavailable';` to the per-field object type of `VerificationResultsLike`;
- `badge`:

```ts
export function badge(args: { key: string; results: VerificationResultsLike | null; unchangedKeys: string[]; running: boolean; cards: Card[]; blocked?: Record<string, string> }): Badge {
  if (args.running) return { kind: 'checking' };
  const fv = args.results?.[args.key];
  if (!fv) return null;
  if (!args.unchangedKeys.includes(args.key)) return { kind: 'changed' };
  if (fv.certified.length > 0 || fv.defaultOnly === true || passedNotOnWebsite(fv)) return { kind: 'verified' };
  const products = args.cards.flatMap((c, i) => (fv.cells[c.url]?.status === 'fail' ? [i + 1] : []));
  if (products.length > 0) return { kind: 'fails', products };
  // Spec 2026-10-20 §3.5.3: a failed field never shows a blank Status.
  if (fv.failReason === 'ai_unavailable') return { kind: 'unverified', text: AI_UNAVAILABLE_BADGE };
  const i = args.cards.findIndex((c) => fv.cells[c.url]?.status === 'not_captured');
  if (i >= 0) return { kind: 'unverified', text: notCheckedText(i + 1, args.blocked?.[args.cards[i]!.url]) };
  return { kind: 'unverified', text: NOT_VERIFIED_BADGE };
}
```

`packages/app/src/components/verification/field-details.tsx` — `BadgeView` gets the new case, so the app still type-checks:

```tsx
    case 'unverified':
      return <span className="shrink-0 text-sm text-fail">{badge.text}</span>;
```

- [ ] **Step 4: Run the files**

Run: `cd packages/app && npx vitest run src/lib/site/verify-messages.test.ts src/lib/site/verification-view.test.ts src/lib/site/verification-model.test.ts src/lib/site/verify-button.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/app && npx tsc --noEmit` — expected: no errors.

```bash
git add packages/app/src/lib/site/verify-messages.ts packages/app/src/lib/site/verify-messages.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/lib/site/verification-view.test.ts packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/components/verification/field-details.tsx
git commit -m "feat(app): every Verify failure sentence in one place, and no blank Status for a failed field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Proof-page capture states in words (`@robot/app`) — spec §3.5.5

**Files:**
- Create: `packages/app/src/lib/site/proof-capture-state.ts`, `packages/app/src/lib/site/proof-capture-state.test.ts`
- Modify: `packages/app/src/lib/site/use-proof-captures.ts:9-30` (type moves out), `:139-167` (per-url state)

**Interfaces:**
- Consumes: Task 5's `SCREENSHOT_COULD_NOT_START`, `captureErrorText` from `./verify-messages`.
- Produces: `proof-capture-state.ts` exports `type ProofCapture` (moved unchanged from `use-proof-captures.ts`, which re-exports it so `product-card.tsx` and the route keep their imports), `type ProofPoll`, `EMPTY_CAPTURE`, and `proofCaptureState(args: { startError?: string; captureId: string | null; poll?: { data?: ProofPoll; isError: boolean } }): ProofCapture`.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/lib/site/proof-capture-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { proofCaptureState, type ProofPoll } from './proof-capture-state';
import { SCREENSHOT_COULD_NOT_START, SCREENSHOT_TOO_LONG } from './verify-messages';

const landed: ProofPoll = { status: 'captured', tiles: ['/captures/a.png'], boxes: [], pageHeight: 900, capturedHeight: 900, title: 'Widget A' };
const failed = (error: string, verdict?: { kind: string }): ProofPoll => ({ status: 'failed', error, ...(verdict ? { verdict } : {}), tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 });

describe('proofCaptureState (spec 2026-10-20 §3.5.5)', () => {
  it('a failed start says the start sentence, never the error text', () => {
    expect(proofCaptureState({ startError: 'TRPCClientError: Failed to fetch', captureId: null })).toMatchObject({ status: 'failed', error: SCREENSHOT_COULD_NOT_START });
  });
  it('a stalled capture says it took too long', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: failed('stalled'), isError: false } })).toMatchObject({ status: 'failed', error: SCREENSHOT_TOO_LONG });
  });
  it('a verdict sentence and its kind pass through', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: failed('shop.example did not answer in time.', { kind: 'timeout' }), isError: false } }))
      .toMatchObject({ status: 'failed', error: 'shop.example did not answer in time.', verdict: { kind: 'timeout' } });
  });
  it('a poll that errors before any answer stops "taking screenshot…" and says the start sentence', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { isError: true } })).toMatchObject({ captureId: 'c', status: 'failed', error: SCREENSHOT_COULD_NOT_START });
  });
  it('a poll error after the capture landed keeps the capture', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: landed, isError: true } })).toMatchObject({ status: 'captured', tiles: landed.tiles, title: 'Widget A' });
  });
  it('no id yet, or no answer yet, is starting', () => {
    expect(proofCaptureState({ captureId: null })).toMatchObject({ status: 'starting' });
    expect(proofCaptureState({ captureId: 'c', poll: { isError: false } })).toMatchObject({ status: 'starting' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/app && npx vitest run src/lib/site/proof-capture-state.test.ts`
Expected: FAIL — `./proof-capture-state` does not exist.

- [ ] **Step 3: Implement**

Create `packages/app/src/lib/site/proof-capture-state.ts`:

```ts
// One product's proof-page capture as the cards and the screenshot panel show it (spec 2026-10-20
// §3.5.5): never "stalled", never a raw start error, and a poll that errors stops "taking
// screenshot…". Pure; `use-proof-captures.ts` feeds it.
import type { Box } from './verification-model';
import { SCREENSHOT_COULD_NOT_START, captureErrorText } from './verify-messages';

export type ProofCapture = {
  captureId: string;
  status: 'starting' | 'capturing' | 'captured' | 'failed';
  error?: string;
  /** A failed capture's verdict (spec 2026-10-09 §A1/§A2): `refused` / `challenge` name the row's words. Absent for other failures. */
  verdict?: { kind: string };
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
  /** The captured page's `<title>`, when it reported one and this capture landed. */
  title?: string;
};

/** The part of `sources.proofPageCapture`'s answer this reads. */
export type ProofPoll = {
  status: 'capturing' | 'captured' | 'failed';
  error?: string;
  verdict?: { kind: string };
  title?: string;
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
};

export const EMPTY_CAPTURE: Pick<ProofCapture, 'tiles' | 'boxes' | 'pageHeight' | 'capturedHeight'> = { tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 };

export function proofCaptureState(args: { startError?: string; captureId: string | null; poll?: { data?: ProofPoll; isError: boolean } }): ProofCapture {
  if (args.startError !== undefined) return { captureId: '', status: 'failed', error: SCREENSHOT_COULD_NOT_START, ...EMPTY_CAPTURE };
  if (!args.captureId) return { captureId: '', status: 'starting', ...EMPTY_CAPTURE };
  const data = args.poll?.data;
  if (!data) {
    return args.poll?.isError
      ? { captureId: args.captureId, status: 'failed', error: SCREENSHOT_COULD_NOT_START, ...EMPTY_CAPTURE }
      : { captureId: args.captureId, status: 'starting', ...EMPTY_CAPTURE };
  }
  const error = captureErrorText(data.error);
  return {
    captureId: args.captureId,
    status: data.status,
    ...(error ? { error } : {}),
    ...(data.verdict ? { verdict: { kind: data.verdict.kind } } : {}),
    ...(data.title ? { title: data.title } : {}),
    tiles: data.tiles,
    boxes: data.boxes,
    pageHeight: data.pageHeight,
    capturedHeight: data.capturedHeight,
  };
}
```

`packages/app/src/lib/site/use-proof-captures.ts`:
- delete the `import type { Box } from './verification-model';` line, the local `ProofCapture` type and the `EMPTY_CAPTURE` constant (lines 9–30); add

```ts
import { proofCaptureState, type ProofCapture } from './proof-capture-state';

export type { ProofCapture } from './proof-capture-state';
```

- the `start` rejection handler stays as it is (it records that the url's start failed; the text is no longer shown);
- replace the `byUrl` loop (lines 139–167) with:

```ts
  const byUrl: Record<string, ProofCapture | undefined> = {};
  for (const url of urls) {
    const id = captureIds[url] ?? null;
    const poll = id ? pollById.get(id) : undefined;
    byUrl[url] = proofCaptureState({
      ...(url in startErrors ? { startError: startErrors[url]! } : {}),
      captureId: id,
      ...(poll ? { poll: { data: poll.data, isError: poll.isError } } : {}),
    });
  }
```

(`poll.data` is `sources.proofPageCapture`'s answer: it has every `ProofPoll` field plus a few more, and its `verdict` is a `{ kind }` object, so it assigns as is. If tsc disagrees, map the fields explicitly rather than casting.)

- [ ] **Step 4: Run the tests**

Run: `cd packages/app && npx vitest run src/lib/site/proof-capture-state.test.ts src/lib/site/verify-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/app && npx tsc --noEmit` — expected: no errors.

```bash
git add packages/app/src/lib/site/proof-capture-state.ts packages/app/src/lib/site/proof-capture-state.test.ts packages/app/src/lib/site/use-proof-captures.ts
git commit -m "feat(app): proof-page captures never show stalled or a raw start error

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Verification tab says it, in view; the route smoke proves it (`@robot/app`) — spec §3.1, §3.5.1–§3.5.2, §6

**Files:**
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (imports `:1-85`; state `:254`; `blocked` after `:370`; `handleVerify`/`reverifyField` `:1057-1103`; `rowHint` `:1120-1126`; rows' `badge` `:1348`; `detailBar` `:1420-1450`; `heads` `:1453-1471`; `stage`/`runNote` `:1478-1481`; `VerifyBar` `:1502-1527`; bottom block `:1575-1584`)
- Modify: `packages/app/src/components/verification/verify-bar.tsx`, `cell-detail-bar.tsx`, `product-card.tsx`
- Create: `packages/api/src/test-helpers/seed-silent-failures.ts`
- Modify: `packages/app/src/routes-smoke.test.ts` (header comment, imports, one new test before "a wall is reported as a wall")

**Interfaces:**
- Consumes: Task 4's `failedRun`; Task 5's `refusalFromError`, `verifyMessage`, `notCheckedText`, `stageText`, `cellHint`, `blockedReasons`, `badge({ …, blocked })`; Task 6's capture states (already wired inside the hook).
- Produces: `VerifyBar`'s `verify` prop gains `message?: string | null`, rendered as `<p role="alert" data-testid="verify-message">`; `DetailBarSelection` gains `hint?: string`, rendered as `<p data-testid="cell-hint">`; `ProductCard` gains `notChecked?: string | null`; `seedFailedAfterElsewhere(sourceId, { elsewhereKey, elsewhereUrl })` and `SEEDED_RAW_ERROR` in `packages/api/src/test-helpers/seed-silent-failures.ts`.

- [ ] **Step 1: Write the smoke test first**

Create `packages/api/src/test-helpers/seed-silent-failures.ts`:

```ts
// packages/api/src/test-helpers/seed-silent-failures.ts
// Verify never fails silently (spec 2026-10-20 §6): the route smoke's seeded state, inserted
// directly — no Verify is pressed. A completed Verify whose one field fails on one product with
// `elsewhere` (every other field certified at its current fieldHash), then a newer run that failed
// with a raw error. Both are newer than anything an earlier smoke step seeded. Cleaned up with the
// project: `source_verifications` cascades on `sources.id`.
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';

/** The failed run's stored error: library text a customer must never see. */
export const SEEDED_RAW_ERROR = 'page.goto: Timeout 60000ms exceeded. Request timed out.';

export async function seedFailedAfterElsewhere(sourceId: string, opts: { elsewhereKey: string; elsewhereUrl: string }): Promise<{ completedId: string; failedId: string }> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source) throw new Error(`seedFailedAfterElsewhere: source ${sourceId} not found`);
  const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
  if (!fields.some((f) => f.key === opts.elsewhereKey)) throw new Error(`seedFailedAfterElsewhere: ${opts.elsewhereKey} is not on this source's contract`);
  if (!set.urls.includes(opts.elsewhereUrl)) throw new Error(`seedFailedAfterElsewhere: ${opts.elsewhereUrl} is not a proof page`);

  const path: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
  const results = Object.fromEntries(fields.map((f) => {
    const failing = f.key === opts.elsewhereKey;
    const cells = Object.fromEntries(set.urls.map((u) => [u, failing && u === opts.elsewhereUrl
      ? { status: 'fail' as const, reason: 'elsewhere' as const }
      : { status: 'pass' as const, found: 'x', path }]));
    return [f.key, { key: f.key, cells, certified: failing ? [] : [path], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(f, set) }];
  }));

  const now = Date.now();
  const [done] = await db.insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', startedAt: new Date(now - 2000), completedAt: new Date(now - 1900), allPassed: false, results })
    .returning({ id: sourceVerifications.id });
  const [failed] = await db.insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', startedAt: new Date(now - 1000), completedAt: new Date(now - 900), errorMessage: SEEDED_RAW_ERROR })
    .returning({ id: sourceVerifications.id });
  return { completedId: done!.id, failedId: failed!.id };
}
```

`packages/app/src/routes-smoke.test.ts`:
- after the `seedJevReading` import add `import { seedFailedAfterElsewhere, SEEDED_RAW_ERROR } from '../../api/src/test-helpers/seed-silent-failures';`
- in the header comment, before "Needs the api-server and the app up", add:

```ts
// Verify never fails silently (spec 2026-10-20 §6): the step before the wall writes products 1–3
// with a value for every field, seeds a completed Verify whose Price fails on product 3 with
// `elsewhere` and a newer run that failed with a raw error (`seedFailedAfterElsewhere`), and reads
// the failed run's sentence in the Verify bar, the kept verdicts, and the `elsewhere` hint in the
// detail bar. Then it clicks Re-verify with `sources.verify` answered INSIDE the browser
// (`page.route`) by a refusal shaped as the api-server sends one, and reads the refusal's
// sentence: that request never reaches the api-server, so it cannot spend.
```

- insert this test immediately before `it('a wall is reported as a wall, in the same words everywhere', …)`:

```ts
  it('a failed run, an elsewhere cell and a refusal each say one sentence, and the table keeps its verdicts', async () => {
    expect(projectSlug, 'there is no project').not.toBeNull();
    expect(websiteSlug, 'there is no website').not.toBeNull();
    problems.length = 0;
    // Leave the tab first and let its flush-on-unmount autosave settle, as the address-warning step does.
    await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1500);
    const api = apiAs(await sessionCookie(context));
    const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    const priceKey = site.fields.find((f) => f.name === 'Price')?.key;
    expect(priceKey, 'no key for Price').toBeTruthy();
    expect(site.fields.some((f) => f.name === 'Rating'), 'no Rating field').toBe(true);

    // Products 1–3, a valid value for every field of the contract, nothing absent, no default: the
    // Verify gate is open, so Re-verify can be clicked.
    const urls = PRODUCTS.map((p) => `${SHOP}${p.path}`);
    const valueFor = (type: string, i: number): string => {
      switch (type) {
        case 'money': return ['129.99', '219.99', '149.00'][i]!;
        case 'number': return ['4.5', '3.8', '4.9'][i]!;
        case 'boolean': return 'yes';
        case 'url': case 'image': return urls[i]!;
        case 'date': return `2026-01-0${i + 1}`;
        default: return PRODUCTS[i]!.title;
      }
    };
    const defs = (site.schemaDefinition ?? []) as Array<{ key: string; description?: string }>;
    await api.sources.updateBinding.mutate({
      sourceId: site.id,
      urls,
      descriptions: Object.fromEntries(site.fields.map((f) => [f.key, defs.find((d) => d.key === f.key)?.description || 'on the page'])),
      expected: Object.fromEntries(site.fields.map((f) => [f.key, Object.fromEntries(urls.map((u, i) => [u, valueFor(f.type, i)]))])),
      cards: PRODUCTS.map((p, i) => ({ url: urls[i]!, title: p.title })),
      draft: true,
    });
    await seedFailedAfterElsewhere(site.id, { elsewhereKey: priceKey!, elsewhereUrl: urls[2]! });

    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const message = page.getByTestId('verify-message');
    await expect.poll(() => message.innerText(), { timeout: 20_000 }).toBe('Verify stopped before it finished. Your last results are kept — try again.');
    expect(await rowStatusText('Price'), 'the failed run blanked Price').toContain('fails on product 3');
    expect(await rowStatusText('Title'), 'the failed run blanked Title').toContain('verified');
    expect(await page.getByText(SEEDED_RAW_ERROR).count(), 'the raw error reached the page').toBe(0);
    await shootViewportBothThemes(page, 'app-site-verification-failed-run');

    await page.locator('button[aria-label^="Price on product 3: "]').click();
    await expect.poll(() => page.getByTestId('cell-hint').innerText(), { timeout: 10_000 })
      .toBe('Found on this product, but not where your other products show it. If this product really has no Price of its own, choose "Not on this product".');
    await shootViewportBothThemes(page, 'app-site-verification-elsewhere');

    // The refusal, answered in the browser as the api-server would send it (superjson, batched).
    const VERIFY = /\/trpc\/sources\.verify\?batch=1$/;
    let answered = 0;
    await page.route(VERIFY, async (route) => {
      answered++;
      await route.fulfill({
        status: 412,
        contentType: 'application/json',
        body: JSON.stringify([{ error: { json: { message: 'Verify could not start', code: -32012, data: { code: 'PRECONDITION_FAILED', httpStatus: 412, path: 'sources.verify', verifyProblems: [{ reason: 'blank', field: 'Rating', product: 3 }] } } } }]),
      });
    });
    try {
      const reverify = page.getByRole('button', { name: /^Re-verify/ });
      await expect.poll(() => reverify.isEnabled(), { timeout: 20_000 }).toBe(true);
      await reverify.click();
      await expect.poll(() => message.innerText(), { timeout: 20_000 }).toBe('Rating on product 3 needs a value, or "Not on this product". Nothing was checked.');
      expect(answered, 'the Verify request was not the one answered in the browser').toBe(1);
      expect(await rowStatusText('Price'), 'the refusal blanked the table').toContain('fails on product 3');
      await shootViewportBothThemes(page, 'app-site-verification-refusal');
    } finally {
      await page.unroute(VERIFY);
    }
    // The refused request's 412 is the browser's own console line, not a defect.
    const real = problems.filter((p) => !/status of 412/.test(p));
    expect(real, `the silent-failures walk logged errors:\n  ${real.join('\n  ')}`).toEqual([]);
  }, 120_000);
```

- [ ] **Step 2: Implement the components**

`packages/app/src/components/verification/verify-bar.tsx` — the `verify` prop type becomes

```ts
  /** `message` (spec 2026-10-20 §3.1): the one sentence about the last Verify — a refusal, a failed or a stalled run. */
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void; message?: string | null };
```

and, inside the right-hand `<div className="flex flex-wrap items-center gap-2">`, after the reason `span`:

```tsx
          {verify.message ? (
            <p role="alert" data-testid="verify-message" className="basis-full text-sm text-fail">
              {verify.message}
            </p>
          ) : null}
```

`packages/app/src/components/verification/cell-detail-bar.tsx` — in `DetailBarSelection` add

```ts
  /** What the cell's verdict means and what to do (spec 2026-10-20 §3.5.1): the hint the expanded row shows. */
  hint?: string;
```

and after the `selected-value` div:

```tsx
        {s.hint ? <p className="text-sm text-muted-foreground" data-testid="cell-hint">{s.hint}</p> : null}
```

`packages/app/src/components/verification/product-card.tsx` — add the prop `notChecked?: string | null;` (doc: "Why the last Verify could not check this product (spec 2026-10-20 §3.5.2); null when it did.") to the destructuring and the props type, and in the bottom bar replace the non-failed branch:

```tsx
        ) : notChecked ? (
          <span className="min-w-0 line-clamp-2 text-sm text-warn" title={notChecked}>
            {notChecked}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{status === 'captured' ? 'ready' : 'taking screenshot…'}</span>
        )}
```

- [ ] **Step 3: Wire the route**

In `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`:

1. Imports — the `verification-view` import becomes `import { blockedReasons, cellHint, cellStatusFor, verificationState, type PageVariantLike, type VerificationResults } from '../../../../../../lib/site/verification-view';` (drop `cellStatusFor` if nothing uses it after item 5 — grep), and add `import { notCheckedText, refusalFromError, stageText, verifyMessage } from '../../../../../../lib/site/verify-messages';`.
2. State (line 254): `const [error, setError] = useState<string | null>(null);` → `const [refusal, setRefusal] = useState<string | null>(null);`
3. After the `unchangedKeys` memo (around line 370):

```ts
  // Spec 2026-10-20 §3.5.2: why the last Verify could not capture a page, by url.
  const blocked = useMemo(() => blockedReasons(status?.captures), [status?.captures]);
```

4. `handleVerify` and `reverifyField`: `setError(null)` → `setRefusal(null)`; each `catch` becomes

```ts
    } catch (err) {
      // Spec 2026-10-20 §3.2: the server's structured problems in customer words, never the error's text.
      setRefusal(refusalFromError(err));
    } finally {
```

5. `rowHint` — replace its first block (`if (detailUrl && failedCell(f.key, detailUrl)) { … }`):

```ts
    // A cell's verdict says why on its row (spec C2's no_fitting_path), as do an AI failure and a page
    // the last Verify could not capture (spec 2026-10-20 §3.3, §3.5.2).
    if (detailUrl) {
      const hint = cellHint({ results, key: f.key, url: detailUrl, unchanged: unchangedKeys.includes(f.key), fieldType: f.type, fieldName: f.name, product: detailIndex + 1, blockedReason: blocked[detailUrl] });
      if (hint) return { text: hint };
    }
```

6. Rows: `badge: badge({ key: f.key, results, unchangedKeys, running: locked, cards: board.cards, blocked }),`
7. `detailBar`'s returned object gains

```ts
            // Spec 2026-10-20 §3.5.1: the hint where the customer looks, not only in the expanded row.
            hint: url ? cellHint({ results, key: detailField.key, url, unchanged: unchangedKeys.includes(detailField.key), fieldType: detailField.type, fieldName: detailField.name, product: selection.product + 1, blockedReason: blocked[url] }) : undefined,
```

8. `heads` — `ProductCard` gains `notChecked={!active && blocked[card.url] !== undefined ? notCheckedText(i + 1, blocked[card.url]) : null}`.
9. Replace the `stage` and `runNote` lines:

```ts
  // Non-null locks the tab: from the click, not only once the server says the run is active. In customer words (spec 2026-10-20 §5.4).
  const stage = stageText(active ? (status?.stage ?? 'starting') : verifying ? 'starting' : null, fieldNames);
  // Spec 2026-10-20 §3.1: one message slot, in the Verify bar — the refusal, or the run that failed or stalled.
  const message = verifyMessage({ refusal, failedRun: status?.failedRun ?? null, hasResults: !!results && Object.keys(results).length > 0, running: active || verifying });
```

10. `VerifyBar`'s `verify` prop gains `message,`.
11. Delete the bottom `{runNote ? (…) : null}` and `{error ? (…) : null}` blocks.
12. Grep the file for `setError`, `runNote`, `errorMessage` and the bare `error` state: none may remain (`saveError`, `typedError`, `defaultError`, `capture.error` and similar are unrelated and stay).

- [ ] **Step 4: Unit tests and types**

Run: `cd packages/app && npx vitest run src/lib/site && npx tsc --noEmit`; `cd packages/api && npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 5: Run the route smoke on an isolated pair**

Never against :3000/:4000. From the worktree (`.env` present, see Global Constraints), in two background shells:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-silent/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
```
```bash
cd /c/Users/Marko/Documents/projects/robot-platform-silent/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

Wait until both answer (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` → 200; `curl -s -o /dev/null -w "%{http_code}" http://localhost:4100/trpc/auth.session` → any HTTP code, not a connection error). Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-silent/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS, including "a failed run, an elsewhere cell and a refusal each say one sentence…". If many early steps fail at once (cards missing, "Reached … (HTTP 200)" missing), the :4100 browser wedged: stop the pair and start it again. Look at the new screenshots (`docs/testing/screens/app-site-verification-failed-run-*`, `…-elsewhere-*`, `…-refusal-*`): the sentence sits beside the Verify button, the table keeps its verdicts, the hint is under the selected cell.

Stop both by port (PowerShell), printing each command line before stopping it — only a `tsx src/index.ts` or `vite dev --port 3100` process from this worktree is ours:

```powershell
foreach ($port in 4100, 3100) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; $p.CommandLine; Stop-Process -Id $p.ProcessId -Confirm:$false } }
```

Restore the screenshots the smoke rewrote: `git checkout -- docs/testing/screens` (the new files are untracked and stay for Task 8).

- [ ] **Step 6: Commit**

```bash
git add "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/components/verification/verify-bar.tsx packages/app/src/components/verification/cell-detail-bar.tsx packages/app/src/components/verification/product-card.tsx packages/api/src/test-helpers/seed-silent-failures.ts packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): Verify's message in the Verify bar, hints in the detail bar, and the route smoke for both

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The merge gate, docs, and the merge (`CLAUDE.md` "Autonomous runs")

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-verify-silent-failures-design.md` (Status), `docs/handoff.md` (new section), `CLAUDE.md` (Key Technical Decisions), `docs/testing/2026-10-11-campaign-2.md:~202` (group 3, "Silent failures"), `docs/queue.md` (item 1 → Done)
- Add: the six new screenshots from the smoke (`docs/testing/screens/app-site-verification-{failed-run,elsewhere,refusal}-*.png`)

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch that passes the gate, docs that say what shipped, `main` fast-forwarded and pushed.

- [ ] **Step 1: Every task's tests and reviews are clean; trailers are right**

Confirm each task's per-task review (and fix rounds) ended clean. Count the trailers:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-silent && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` where the script amends only commits whose trailer names another model (memory `subagent-commit-trailers`).

- [ ] **Step 2: Full test run and type-check of every touched package**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-silent/packages/scraper && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-silent/packages/api && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-silent/packages/app && npx vitest run && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up, `.env` present). If a scraper Chromium file times out only in the full run, re-run that file alone; `transfer-marks.test.ts`'s JSON-LD image-array case is a known flake (handoff, next work item 5). A real failure blocks the merge: fix it on the branch.

- [ ] **Step 3: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. No open Critical or Important finding may remain; fix on the branch and re-run Step 2 for the touched packages.

- [ ] **Step 4: The route smoke, from the branch, on an isolated pair**

Exactly as Task 7 Step 5: the keyless api-server on :4100 (`ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts` from `packages/api-server`) and the app on :3100 (`VITE_API_URL=http://localhost:4100 npx vite dev --port 3100` from `packages/app`); wait for both; from `packages/app` run `RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts`. Expected: PASS. Look at the new screenshots. Stop both by port as in Task 7 (never :3000/:4000), then `git checkout -- docs/testing/screens` (the six new files stay). A second smoke run against the same api-server must start at least two minutes after the first ended (the wall step's backoff). No capture or extraction code changed in this plan, so gate 5 (a free live check) does not apply.

- [ ] **Step 5: Docs**

Note the last code commit: `git log -1 --format=%h` → `<sha>`.

1. Spec — replace the Status paragraph's first sentence with: ``**Status:** implemented on `feat/verify-silent-failures` and merged to `main` on 2026-10-20 (`<sha>`); written under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue item 1), with its plan (`docs/superpowers/plans/2026-10-20-verify-silent-failures.md`).`` Keep the rest of the paragraph.

2. `docs/handoff.md` — insert before `## Captures without overlays (2026-10-19)`:

```markdown
## Verify never fails silently (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-verify-silent-failures-design.md`, plan
`docs/superpowers/plans/2026-10-20-verify-silent-failures.md`. Branch `feat/verify-silent-failures`
from `main` at `7971bf8`. Campaign 2, group 3, "Silent failures" (skims' 412, skullcandy's
time-out, ridge's description).

**What a customer gets.** Every Verify, re-verify and proof-page capture that does not succeed ends
with one sentence, in view: beside the Verify button (`data-testid="verify-message"`) for a
refusal or a run that failed or stalled; in the detail bar (`data-testid="cell-hint"`) for a cell;
on the card for a page the run could not capture; in the Status column for a failed field (never
blank). A failed run never blanks the table: the last completed results stay. No raw error, field
key, address, HTTP code or internal word; the Verify stage line is in words too.

**What changed.**
1. `sources.verify` refuses with `cause: VerifyRefusal(problems)` (`packages/api/src/verify/verify-refusal.ts`);
   `errorFormatter` in `packages/api/src/trpc.ts` puts them on `error.data.verifyProblems`; the
   message is neutral and the raw problem text is logged. `bindingProblemList` gives each binding
   problem a reason, a field name and a product number; `bindingProblems` returns the same strings.
2. One field's AI throw is that field's `failReason: 'ai_unavailable'` (`run-verification.ts`); the
   run, its captures, cost and call count stand.
3. `verificationStatus` hands back the newest completed, error-free run plus `failedRun`
   (`{ id, startedAt, stalled }`, `verify/run-failure.ts`); `errorMessage` is no longer in the
   answer (ops reads it from the row).
4. Certify's two-of-three branch: `elsewhere` when another candidate reads the value on that page.
5. Capture failures inside a Verify are stored as sentences (`BROWSER_UNAVAILABLE` for library
   throws); the app shows stalled captures, failed starts and failed polls in words
   (`lib/site/proof-capture-state.ts`); a stalled coverage check says `COVERAGE_STALLED`.
6. All app copy lives in `packages/app/src/lib/site/verify-messages.ts`, with a no-internals sweep test.

**Planner's copy (the spec was silent; change freely):** `Verify stopped before it finished. Try
again.` (no earlier results), the badges `not finished — verify again` and `not verified — mark it
on the screenshot`, `the page could not be read`, and the stage lines (`Taking screenshot 2 of 3…`,
`Taking a closer look at {Field}…`, …).

**Open.**
- The verdict sentences a card and a "Not checked on product n — …" badge repeat name the host and,
  for a wall, the HTTP status (spec 2026-10-09 copy) — at odds with this spec's §5.4; the verdict
  copy needs a decision.
- "Run it again" for a stalled coverage check has no button: the check only starts after a passing
  Verify, and a fully verified website's Verify is disabled.
- A coverage check that throws still stores and shows its raw error as the stage line
  (`run-coverage-check.ts`, the catch at the end of `runCoverageCheck`).
- An invalid value refused by the server reads `Verify could not start…` (spec §3.2 "anything
  else"); the app's own gate catches those first today.
- The route smoke's refusal is answered in the browser; the formatter's wire shape is pinned by
  `packages/api/src/trpc-error-shape.test.ts`, not by a real refusal end to end.
- Spec §7 stays out: the variant check's single sentence, an app/server gate contract test, amounts
  in API answers, automatic AI retries.
```

3. `CLAUDE.md` — after the "Jev at Verify, in shadow (2026-10-16)" bullet in Key Technical Decisions:

```markdown
- Verify never fails silently (2026-10-20): every Verify, re-verify and proof-page capture that does not succeed ends with one customer sentence in view — a refusal (structured problems on `error.data.verifyProblems`, written by the app) or a failed run in the Verify bar, a cell's hint in the detail bar; a failed run never replaces the last completed results (`verificationStatus` returns them with `failedRun`); one field's AI failure is that field's `ai_unavailable`, never the run's; a value on a product in another place reads `elsewhere`, not `not_found`.
```

4. `docs/testing/2026-10-11-campaign-2.md` line ~202: `- **Silent failures:** … Open.` → ``- **Silent failures:** skims' HTTP 412, skullcandy's time-out, ridge's typed description with no reason. Fixed 2026-10-20 (`<sha>`, spec 2026-10-20-verify-silent-failures).``

5. `docs/queue.md`: delete item 1 from **Next** and renumber the rest (2 → 1, 3 → 2); add at the top of **Done**: ``- 2026-10-20 — Verify never fails silently (`<sha>`).``

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-silent && ls docs/testing/screens | grep verification-
git add docs/superpowers/specs/2026-10-20-verify-silent-failures-design.md docs/handoff.md CLAUDE.md docs/testing/2026-10-11-campaign-2.md docs/queue.md docs/testing/screens/app-site-verification-failed-run-dark.png docs/testing/screens/app-site-verification-failed-run-light.png docs/testing/screens/app-site-verification-elsewhere-dark.png docs/testing/screens/app-site-verification-elsewhere-light.png docs/testing/screens/app-site-verification-refusal-dark.png docs/testing/screens/app-site-verification-refusal-light.png
git commit -m "docs: Verify never fails silently — shipped; handoff, decisions, campaign 2 group 3, queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Use the screenshot names `shootViewportBothThemes` actually wrote, as the `ls` shows, if they differ.)

- [ ] **Step 6: Fast-forward `main` and push**

The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/verify-silent-failures
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. A refused fast-forward (main moved) means: rebase the branch on `main`, re-run Steps 2 and 4, try again.
