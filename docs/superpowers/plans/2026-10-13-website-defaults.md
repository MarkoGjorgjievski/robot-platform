# A website's default values — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A website's binding carries a default per field; a run writes the certified path's value where a path reads one and the default where every path misses; Verify treats a blank cell on such a field as a default cell, certifies "by default only" for free when nothing reads the field, and every defaulted value is counted and marked on the run page, in the coverage and drift checks, in ops and in the judge report.

**Architecture:** The default lives on `VerificationSet.defaults` (jsonb, no migration). `@robot/scraper` owns the two rules — certification with default cells (`certify.ts`) and filling at extraction (`defaults.ts`, `verified-extraction.ts`). `@robot/api` carries the default through the binding, the certification loader, the item extractor (`validation_result.defaulted`), drift, the coverage check, the run coverage report, ops and the judge. `@robot/app` edits the default in the expanded field row, renders default cells, and shows the counts on the run page and the Sample panel. The spec's §8 copy table is the one source of every string.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres; tRPC v11; TanStack Start + React 19 + Tailwind v4; Playwright for the route smoke.

**Spec:** `docs/superpowers/specs/2026-10-13-website-defaults-design.md`

**Planner's notes (deviations from the brief's task shape):** seven tasks, not six — the api side splits into the certification/extraction path (Task 3) and the reporting path (Task 4), because a reviewer can approve one without the other and the two touch disjoint files. `same-everywhere` keeps its shape (two existing `toEqual` tests pin it); the route reads the shared value through a new pure helper `rowValue` instead. `Certification.defaults` is optional on the type (every fake in the api tests would otherwise need a field it never reads) but `loadCertificationState` always sets it.

## Global Constraints

- Copy is exact, from the spec's §8: input label `Default for this website`; under a set default `Fills every product the paths leave empty.`; warning `not on any proof page` with title `No proof page shows this value; it will still fill every product the paths leave empty.`; row action `Make it the default`; cell title `This website's default; a path that reads a value here wins`; row word `default only · no path reads it on this website`; binding problems `{Field}: a default and "not on this product" cannot both be set` and `{Field}: default — {validateExpected's text}`; run column head `default on {n}`; run cell title `this website's default`; run summary `… · {n} values from the website's defaults` (`1 value from …`); coverage row line `The default filled {n} of {m} sampled products` and `Every product gets the default`; ops `Default: {value}` and `no path — every product gets the default`; judge report column word `default`.
- Spec §9 property 9: a set, result or extraction with no `defaults`/`defaultOnly`/`defaulted` behaves byte-for-byte as today. Every optional field is omitted, never written as `undefined`, `null`, `[]` or `false`, when it would be empty.
- A default and "not on this product" never coexist on one field (spec §3): the board clears absent cells when a default is set; the server refuses a binding carrying both.
- A path's miss is still a miss for its stats; a defaulted field never counts toward `confidence` and never lands in `absentFields` (spec §5).
- No AI call for a field that qualifies for default only (spec §4, property 4).
- Tests per package only (`pnpm --filter @robot/<pkg> exec vitest run <file>`), never `pnpm -r test`; the scraper's Chromium tests one file at a time; the route smoke once, at the end (Task 7), against `pnpm dev:all` that Marko runs — never start or restart a server yourself.
- Commits by explicit path; never `git add -A`/`.`; never stage `packages/app/src/routeTree.gen.ts`; every message ends `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `.js` suffix on relative imports in scraper/api; none in app; `@robot/app` never imports `@robot/scraper` except `@robot/scraper/normalize`, and never `@robot/api`.

## Review Focus

1. A default typed with surrounding whitespace or a different case than the page's value (`" gymshark "`) must still make a path reading `Gymshark` correct on a default cell, and must hash and save trimmed. → Task 1 test "a typed value equal to the default, whatever its spaces and case, is a default cell"; Task 3 test "prepareBinding keeps trimmed, non-empty defaults only".
2. A money or number default (`"22"`, `"4,5"`) must be written in the field's rendered form (`22`, `4.5`), the same thing a path would write, and a default that does not parse for its type must never be written. → Task 2 `applyDefaults` tests.
3. A product whose only certified fields all have defaults must still wait for their paths before the capture is taken, or every such product would read the default while its data was still loading. → Task 2 `buildReadyCheck` test "with only defaulted fields, the check waits for them".
4. A run from before this change (no `defaulted` on any extraction) must show no default badge, no cell rail and an unchanged summary line, and drift must read it as today. → Task 4 `computeCoverage` test; Task 6 `resultsSummary`/`defaultBadge` tests with `undefined`; Task 3 `blankDefaulted` test with no default keys.
5. A field with a default whose proof pages' text never shows the default (the Gymshark tagline typed as a default) must warn in the input but never block Verify or the save. → Task 5 `defaultNotShown` tests and the `verifyGate` test with a default.

---

### Task 1: Certification with a default (`@robot/scraper`)

**Files:**
- Modify: `packages/scraper/src/verify/types.ts` (`VerificationSet.defaults`, `FieldVerification.defaultOnly`)
- Modify: `packages/scraper/src/verify/certify.ts` (`CertifyInput.defaultValue`, `expectedWithDefault`, default cells, must-read-something, `defaultOnly`, `greedyCover`'s `isProven`)
- Modify: `packages/scraper/src/verify/run-verification.ts` (`fieldHash`, `definitionHash`, the per-field loop, the AI skip, `allPassed`)
- Test: `packages/scraper/src/verify/certify.test.ts`, `packages/scraper/src/verify/run-verification.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  // types.ts
  VerificationSet.defaults?: Record<string, string>;   // fieldKey → the default as typed, trimmed; absent on sets written before
  FieldVerification.defaultOnly?: true;                // set only when the field passed by default only
  // certify.ts
  CertifyInput.defaultValue?: string;
  export function expectedWithDefault(urls: string[], expected: Record<string, string>, defaultValue: string | undefined, absent?: Record<string, true>): Record<string, string>;
  // run-verification.ts: fieldHash / definitionHash now read set.defaults; runVerification passes defaultValue through
  ```

- [ ] **Step 1: Failing tests in `certify.test.ts`** (append at the end of the file):

```ts
describe('certify — a website\'s default (spec 2026-10-13 §4)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const G = ['https://g.example/1', 'https://g.example/2', 'https://g.example/3'];
  const page = (url: string, ld: Record<string, unknown>, site = 'Gymshark | We Do Gym'): CaptureLike => ({
    url, html: '<html></html>',
    structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: { 'og:site_name': site } },
    interceptedRequests: [],
  });
  const named = (url: string, name = 'Gymshark') => page(url, { brand: { name } });
  const plain = { [G[0]!]: named(G[0]!), [G[1]!]: named(G[1]!), [G[2]!]: named(G[2]!) };
  const blank = { [G[0]!]: '', [G[1]!]: '', [G[2]!]: '' };
  const brandName = { source: 'json-ld' as const, path: 'brand.name', transform: 'identity' as const };
  const siteName = { source: 'meta' as const, path: 'og:site_name', transform: 'identity' as const };
  const nothing = { source: 'json-ld' as const, path: 'vendor.name', transform: 'identity' as const };
  const deps = { evalXPaths: async () => ({}) };

  it('expectedWithDefault fills every blank, non-absent cell with the default and leaves a typed value alone', () => {
    expect(expectedWithDefault(G, { [G[1]!]: 'Gymshark x Whitney' }, 'Gymshark')).toEqual({ [G[0]!]: 'Gymshark', [G[1]!]: 'Gymshark x Whitney', [G[2]!]: 'Gymshark' });
    expect(expectedWithDefault(G, { [G[1]!]: 'x' }, undefined)).toEqual({ [G[1]!]: 'x' });
    expect(expectedWithDefault(G, {}, '  ')).toEqual({});
    expect(expectedWithDefault(G, {}, 'Gymshark', { [G[2]!]: true })).toEqual({ [G[0]!]: 'Gymshark', [G[1]!]: 'Gymshark' });
  });

  it('with nothing typed, a fitting path that reads the default on every page certifies; one that reads another value never does (property 1)', async () => {
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: plain, candidates: [brandName, siteName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.cells[G[0]!]).toEqual({ status: 'pass', found: 'Gymshark', path: brandName });
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });

  it('a typed value equal to the default, whatever its spaces and case, is a default cell', async () => {
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: '  gymshark ' }, defaultValue: 'Gymshark', captures: plain, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.cells[G[1]!]).toMatchObject({ status: 'pass', found: 'Gymshark' });
  });

  it('a path that reads nothing anywhere never certifies; with no other path the field passes by default only (properties 2, 3)', async () => {
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: plain, candidates: [nothing] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBe(true);
    expect(r.cells).toEqual(Object.fromEntries(G.map((u) => [u, { status: 'pass', found: '' }])));
    expect(r.incomplete).toBe(false);
  });

  it('a typed value that differs from the default forbids default only: the cell fails as today (property 3)', async () => {
    const caps = { ...plain, [G[1]!]: page(G[1]!, { name: 'x' }) };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.cells[G[1]!]).toMatchObject({ status: 'fail', reason: 'not_found' });
  });

  it('a path that reads the typed collab value on its page and the default elsewhere certifies on every page', async () => {
    const caps = { ...plain, [G[1]!]: named(G[1]!, 'Gymshark x Whitney') };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.cells[G[1]!]).toMatchObject({ status: 'pass', found: 'Gymshark x Whitney' });
  });

  it('a path empty on the default cells and reading the typed value elsewhere certifies: empty is correct on a default cell', async () => {
    const caps = { [G[0]!]: page(G[0]!, { name: 'a' }), [G[1]!]: named(G[1]!, 'Gymshark x Whitney'), [G[2]!]: page(G[2]!, { name: 'c' }) };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.cells[G[0]!]).toEqual({ status: 'pass', found: '', path: brandName });
    expect(r.cells[G[1]!]).toMatchObject({ status: 'pass', found: 'Gymshark x Whitney' });
  });

  it('a weak field whose only matching path does not fit the concept passes by default only, never on that path', async () => {
    const caps = { [G[0]!]: page(G[0]!, { name: 'a' }, 'Gymshark'), [G[1]!]: page(G[1]!, { name: 'b' }, 'Gymshark'), [G[2]!]: page(G[2]!, { name: 'c' }, 'Gymshark') };
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: caps, candidates: [siteName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBe(true);
    expect(r.cells[G[0]!]).toEqual({ status: 'pass', found: '' });
  });

  it('every proof page is checked: a path wrong on a blank page four never certifies', async () => {
    const G4 = 'https://g.example/4';
    const caps = { ...plain, [G4]: named(G4, 'Other') };
    const r = await certify({ field: brand, expected: { ...blank, [G4]: '' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([]);
    expect(Object.keys(r.cells)).toEqual([...G, G4]);
    const three = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: plain, candidates: [brandName] }, deps);
    expect(three.certified).toEqual([brandName]);
  });

  it('a capture that failed keeps the field incomplete: never default only (property 3)', async () => {
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: { ...plain, [G[2]!]: null }, candidates: [nothing] }, deps);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.incomplete).toBe(true);
    expect(r.cells[G[2]!]).toEqual({ status: 'not_captured' });
  });

  it('without a default the same pages and candidates certify exactly as before (property 9)', async () => {
    const typed = { [G[0]!]: 'Gymshark', [G[1]!]: 'Gymshark', [G[2]!]: 'Gymshark' };
    const before = await certify({ field: brand, expected: typed, captures: plain, candidates: [brandName, siteName] }, deps);
    const withDefault = await certify({ field: brand, expected: typed, defaultValue: 'Gymshark', captures: plain, candidates: [brandName, siteName] }, deps);
    expect(before.certified).toEqual([brandName]);
    expect(before.defaultOnly).toBeUndefined();
    expect(withDefault).toEqual(before);
  });
});
```

Add `expectedWithDefault` to the file's import from `./certify.js`.

- [ ] **Step 2: Failing tests in `run-verification.test.ts`** (append):

```ts
describe('a website\'s default (spec 2026-10-13 §3/§4)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const blank = { [U[0]!]: '', [U[1]!]: '', [U[2]!]: '' };
  const base: VerificationSet = { urls: U, expected: { brand: blank } };
  const withDefault: VerificationSet = { ...base, defaults: { brand: 'Widgetco' } };

  it('a default moves the field\'s hash and the definition hash; another field\'s default does not; a blank default is no default', () => {
    expect(fieldHash(brand, withDefault)).not.toBe(fieldHash(brand, base));
    expect(fieldHash(brand, { ...base, defaults: { brand: ' Widgetco ' } })).toBe(fieldHash(brand, withDefault));
    expect(fieldHash(brand, { ...base, defaults: { brand: '' } })).toBe(fieldHash(brand, base));
    expect(fieldHash(fields[1]!, { ...set, defaults: { brand: 'Widgetco' } })).toBe(fieldHash(fields[1]!, set));
    expect(definitionHash([brand], withDefault)).not.toBe(definitionHash([brand], base));
    expect(definitionHash([brand], { ...base, defaults: {} })).toBe(definitionHash([brand], base));
  });

  it('a field with a default passes by default only on pages that never name it, with no AI call (property 4)', async () => {
    let calls = 0;
    const agent = { proposePaths: async () => { calls++; return []; } };
    const run = await runVerification({ fields: [brand], verificationSet: withDefault }, { browser, agent, captures: loadShopExample() });
    expect(run.outcome.fields.brand).toMatchObject({ certified: [], defaultOnly: true, aiCalled: false });
    expect(Object.values(run.outcome.fields.brand!.cells).every((c) => c.status === 'pass')).toBe(true);
    expect(run.outcome.allPassed).toBe(true);
    expect(run.outcome.aiCalls).toBe(0);
    expect(calls).toBe(0);
  }, 60_000);

  it('a path reading another product\'s value on a default cell is unsafe, and a typed page forbids default only', async () => {
    const name = { ...fields[0]!, key: 'name2' };
    const run = await runVerification(
      { fields: [name], verificationSet: { urls: U, expected: { name2: { [U[0]!]: '', [U[1]!]: 'Widget B', [U[2]!]: '' } }, defaults: { name2: 'Widget A' } } },
      { browser, agent: null, captures: loadShopExample() },
    );
    // Page 1 is a default cell the json-ld name path reads as "Widget A"; page 3 reads "Widget C" there — wrong on a default cell, so no path certifies and the typed page 2 forbids default only.
    expect(run.outcome.fields.name2!.certified).toEqual([]);
    expect(run.outcome.fields.name2!.defaultOnly).toBeUndefined();
    expect(run.outcome.allPassed).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 3: Run both test files, expect failures** on `expectedWithDefault` (not exported), `defaultOnly` (undefined) and the hash equalities.

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts src/verify/run-verification.test.ts`

- [ ] **Step 4: Types.** In `types.ts`, add to `VerificationSet` after `absent`:

```ts
  /** fieldKey → the website's default for that field, as typed and trimmed (spec 2026-10-13 §3): a run writes it into every cell the certified paths leave empty; at Verify a blank or default-equal cell is a default cell. Absent on sets written before it existed. */
  defaults?: Record<string, string>;
```

and to `FieldVerification` after `thinEvidence`:

```ts
  /** Set (true) only when the field passed by default only (spec 2026-10-13 §4): every checked page is a default cell and no candidate certified, so `certified` is empty and every product gets the default. Absent otherwise. */
  defaultOnly?: true;
```

- [ ] **Step 5: `certify.ts`.** Add `defaultValue` to `CertifyInput`:

```ts
  /** The website's default for this field (spec 2026-10-13 §3/§4): every captured page is checked; a blank or default-equal cell is a default cell, where a candidate reading the default or nothing is correct; a candidate must read a value on at least one page to certify; with every page a default cell and nothing certified, the field passes by default only. */
  defaultValue?: string;
```

Export the helper (after `checkedPages`):

```ts
/** A field's expected values with its default filled into every blank, non-absent cell (spec 2026-10-13 §3): what candidate search and certification compare against. Without a default (or a blank one), the map as given. */
export function expectedWithDefault(urls: string[], expected: Record<string, string>, defaultValue: string | undefined, absent: Record<string, true> = {}): Record<string, string> {
  const def = defaultValue?.trim();
  if (!def) return expected;
  return Object.fromEntries(urls.filter((u) => !absent[u]).map((u) => [u, (expected[u] ?? '').trim() === '' ? def : expected[u]!]));
}
```

Change `greedyCover`'s signature to `greedyCover(safe, pages, absent, isCorrect, isProven, rank)`: `uncovered` and `gain` keep using `isCorrect`; `proven` becomes `(c) => valued.filter((u) => isProven(c, u)).length`. Add to its doc comment: "On a default cell (spec 2026-10-13 §4) an empty read is correct but proves nothing, so `isProven` (correct with a value) counts the pages a path carries."

In `certifyCandidates`, replace the lines from `const urls = checkedPages(...)` to `const expected = ...` with:

```ts
  const defaultValue = input.defaultValue?.trim() || undefined;
  const allUrls = Object.keys(captures);
  // With a default every captured page is checked (spec 2026-10-13 §3); otherwise only the pages with a value or an absent mark.
  const urls = defaultValue !== undefined ? allUrls : checkedPages(allUrls, input.expected, absentMap);
  const filled = expectedWithDefault(allUrls, input.expected, defaultValue, absentMap);
  const expected = Object.fromEntries(urls.filter((u) => !absentSet.has(u)).map((u) => [u, filled[u] ?? input.expected[u] ?? '']));
  // A default cell: blank or equal to the default (spec 2026-10-13 §4). A candidate reading the default or nothing is correct there.
  const defaultCells = new Set(defaultValue === undefined ? [] : urls.filter((u) => !absentSet.has(u) && valuesEqual(field.type, expected[u]!, defaultValue)));
```

In the evaluation loop, replace the `correct` line with:

```ts
      const matches = !empty && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
      // An absent page: correct iff nothing. A default cell: nothing or the default (spec 2026-10-13 §4). Otherwise the typed value.
      const correct = absentSet.has(url) ? empty : defaultCells.has(url) ? (empty || matches) : matches;
```

Two blocks, in two places. **Block A** goes right after `const weakEvidence = …` and BEFORE the `if (weak && candidates.length === 0)` branch (it needs only `capturedUrls`, `urls`, `defaultCells` and `weakEvidence`, all declared by then; `capturedUrls` is already declared above `rank`):

```ts
  const complete = capturedUrls.length === urls.length;
  // Every captured page a default cell (spec 2026-10-13 §4): the field may pass by default only.
  const allDefault = defaultValue !== undefined && complete && capturedUrls.length > 0 && capturedUrls.every((u) => defaultCells.has(u));
  const defaultOnlyResult = (): FieldVerification => ({
    key: field.key,
    cells: Object.fromEntries(urls.map((u): [string, CellResult] => [u, captures[u] ? { status: 'pass', found: '' } : { status: 'not_captured' }])),
    certified: [], weakEvidence, aiCalled: false, incomplete: false, defaultOnly: true,
  });
```

and the weak branch's first line becomes `if (allDefault) return defaultOnlyResult();` (default only takes precedence over `no_fitting_path`, spec §4). Delete the later, existing `const complete = capturedUrls.length === urls.length;` line (it is now Block A's first line). **Block B** goes right after `const isCorrect = …`, below the evaluation loop:

```ts
  const isProven = (c: CandidatePath, u: string) => { const e = evals.get(pathId(c))?.[u]; return !!e && e.correct && !e.empty; };
  // Spec 2026-10-13 §4: with a default a candidate must read something somewhere — a path empty on every page proves nothing. Without one, nothing changes.
  const readsSomething = (c: CandidatePath) => defaultValue === undefined || capturedUrls.some((u) => isProven(c, u));
```

Then: `const safe = candidates.filter((c) => readsSomething(c) && capturedUrls.length > 0 && capturedUrls.every(…))` (the `every` body unchanged); `greedyCover(safe, capturedUrls, absentSet, isCorrect, isProven, rank)`; `provenOn: capturedUrls.filter((u) => !absentSet.has(u) && isProven(c, u))`. Right after `const certified: CertifiedPath[] = …`, add:

```ts
  if (certified.length === 0 && allDefault) return defaultOnlyResult();
```

(`thinEvidence`, cells and the return stay as they are; nothing else in the cells block changes.)

- [ ] **Step 6: `run-verification.ts`.** In `definitionHash`, before `return`, add:

```ts
  const defaultKeys = Object.keys(set.defaults ?? {}).filter((k) => (set.defaults![k] ?? '').trim() !== '').sort();
  const defaults = defaultKeys.length ? Object.fromEntries(defaultKeys.map((k) => [k, set.defaults![k]!.trim()])) : undefined;
```

and `...(defaults ? { defaults } : {})` as the last spread. In `fieldHash`:

```ts
  const def = (set.defaults?.[field.key] ?? '').trim();
  // A field with a default is checked on every proof page (spec 2026-10-13 §3).
  const pages = def ? [...set.urls] : checkedPages(set.urls, expected, Object.fromEntries(absent.map((u) => [u, true as const])));
```

and `...(def ? { default: def } : {})` as the last spread. In `runVerification`'s loop, replace `const expected = req.verificationSet.expected[field.key] ?? {};` and the `absent` line with:

```ts
    const absent = Object.keys(req.verificationSet.absent?.[field.key] ?? {});
    const defaultValue = (req.verificationSet.defaults?.[field.key] ?? '').trim() || undefined;
    // With a default the search looks for it on every blank page (spec 2026-10-13 §4): the JSON-LD brand path is found where nothing was typed.
    const expected = expectedWithDefault(req.verificationSet.urls, req.verificationSet.expected[field.key] ?? {}, defaultValue, Object.fromEntries(absent.map((u) => [u, true as const])));
```

Pass `defaultValue` into all three `certify({ … })` calls. Change the AI condition to `if (result.certified.length === 0 && !result.defaultOnly && !result.incomplete && deps.agent && !everyCellNoFittingPath(result))`. Change `allPassed` to `(f.certified.length > 0 || f.defaultOnly === true) && Object.values(f.cells).every((c) => c.status === 'pass')`. Import `expectedWithDefault` from `./certify.js`.

- [ ] **Step 7: Run the two files again, expect PASS; then the whole scraper verify suite once** (Chromium, one file at a time is fine; the full package run is allowed here since nothing else is running):

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts src/verify/run-verification.test.ts` then `pnpm --filter @robot/scraper exec vitest run src/verify`

- [ ] **Step 8: Commit**

```bash
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts
git commit -m "feat(scraper): certification with a website default — default cells, a path must read something, default-only passes without AI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Extraction with a default (`@robot/scraper`)

**Files:**
- Create: `packages/scraper/src/verify/defaults.ts`, `packages/scraper/src/verify/defaults.test.ts`
- Modify: `packages/scraper/src/verify/verified-extraction.ts` (`VerifiedField.defaultValue`, `VerifiedExtractionResult.defaulted`, `applyDefaults` after the paths, readiness), `packages/scraper/src/verify/index.ts` (export `defaults.js`)
- Test: `packages/scraper/src/verify/verified-extraction.test.ts`

**Interfaces:**
- Consumes: `normalize`, `renderValue` from `./normalize.js`.
- Produces:
  ```ts
  // defaults.ts
  export type DefaultedField = { key: string; type: CustomerFieldType; defaultValue?: string };
  export function renderDefault(type: CustomerFieldType, value: string): unknown;   // null when the text does not parse for the type
  export function applyDefaults(row: Record<string, unknown>, fields: DefaultedField[]): { row: Record<string, unknown>; defaulted: string[] };
  // verified-extraction.ts
  VerifiedField.defaultValue?: string;
  VerifiedExtractionResult.defaulted: string[];
  ```

- [ ] **Step 1: Failing tests, `defaults.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { applyDefaults, renderDefault } from './defaults.js';

describe('renderDefault', () => {
  it('writes the default as a path would: parsed for the type, text NFKC-collapsed, nothing when it does not parse', () => {
    expect(renderDefault('text', '  Gymshark   Ltd ')).toBe('Gymshark Ltd');
    expect(renderDefault('money', '22')).toBe(22);
    expect(renderDefault('number', '4,5')).toBe(4.5);
    expect(renderDefault('boolean', 'yes')).toBe(true);
    expect(renderDefault('boolean', 'out of stock')).toBe(false);
    expect(renderDefault('text_list', 'Red, Blue')).toEqual(['Red', 'Blue']);
    expect(renderDefault('money', 'call us')).toBeNull();
  });
});

describe('applyDefaults (spec 2026-10-13 §5, property 5)', () => {
  const fields = [
    { key: 'brand', type: 'text' as const, defaultValue: 'Gymshark' },
    { key: 'price', type: 'money' as const, defaultValue: '22' },
    { key: 'title', type: 'text' as const },
    { key: 'bad', type: 'money' as const, defaultValue: 'call us' },
  ];
  it('fills only the cells every path left empty, names them, and leaves the input row alone', () => {
    const row = { brand: null, price: 19.5, title: null, bad: null };
    const r = applyDefaults(row, fields);
    expect(r.row).toEqual({ brand: 'Gymshark', price: 19.5, title: null, bad: null });
    expect(r.defaulted).toEqual(['brand']);
    expect(row.brand).toBeNull();
  });
  it('treats undefined and the empty string as empty, and a field with no default as untouched', () => {
    expect(applyDefaults({ price: '' }, fields)).toEqual({ row: { price: 22 }, defaulted: ['price'] });
    expect(applyDefaults({}, fields)).toEqual({ row: { brand: 'Gymshark', price: 22 }, defaulted: ['brand', 'price'] });
    expect(applyDefaults({ title: null }, [{ key: 'title', type: 'text' }])).toEqual({ row: { title: null }, defaulted: [] });
  });
});
```

- [ ] **Step 2: Failing tests in `verified-extraction.test.ts`** (append; the file already launches Chromium and loads the p1 fixture):

```ts
describe('runVerifiedExtraction — a website\'s default (spec 2026-10-13 §5)', () => {
  const BRAND: VerifiedField = {
    key: 'brand', type: 'text', concept: 'brand',
    paths: [{ source: 'json-ld', path: 'vendor.name', transform: 'identity' }],
    defaultValue: 'Widgetco',
  };

  it('a field whose paths all miss takes the default; the path stat stays a miss and the flag is not checked (property 5)', async () => {
    const result = await runVerifiedExtraction({ url: URL, fields: [PRICE, BRAND] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.data).toEqual({ price: 129.99, brand: 'Widgetco' });
    expect(result.stats).toEqual([
      { key: 'price', concept: 'price', path: PRICE.paths[0], hit: true, value: 129.99 },
      { key: 'brand', concept: 'brand', path: BRAND.paths[0], hit: false },
    ]);
    expect(result.defaulted).toEqual(['brand']);
    expect(result.shown).toEqual({ price: true, brand: null });
  }, 30_000);

  it('a path that reads a value wins over the default', async () => {
    const named: VerifiedField = { ...PRODUCT_NAME, defaultValue: 'Nameless' };
    const result = await runVerifiedExtraction({ url: URL, fields: [named] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.data).toEqual({ product_name: 'Widget A' });
    expect(result.defaulted).toEqual([]);
    expect(result.shown).toEqual({ product_name: true });
  }, 30_000);

  it('a default-only field (no path) is filled on every product and records no stat', async () => {
    const result = await runVerifiedExtraction({ url: URL, fields: [{ ...BRAND, paths: [] }] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.data).toEqual({ brand: 'Widgetco' });
    expect(result.stats).toEqual([]);
    expect(result.defaulted).toEqual(['brand']);
  }, 30_000);

  it('a run without defaults reports an empty defaulted list (property 9)', async () => {
    const result = await runVerifiedExtraction({ url: URL, fields: [PRICE] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.defaulted).toEqual([]);
  }, 30_000);
});

describe('buildReadyCheck with defaults (spec 2026-10-13 §5, Review Focus 3)', () => {
  const snap = (ld: Record<string, unknown>): ReadySnapshot => ({ probe: {}, structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
  const BRAND: VerifiedField = { key: 'brand', type: 'text', concept: 'brand', paths: [{ source: 'json-ld', path: 'brand.name', transform: 'identity' }], defaultValue: 'Widgetco' };
  it('a defaulted field does not block: ready once the other field resolves', () => {
    const check = buildReadyCheck([PRODUCT_NAME, BRAND], URL);
    expect(check.isReady(snap({ name: 'Widget A' }))).toBe(true);
    expect(check.isReady(snap({}))).toBe(false);
  });
  it('with only defaulted fields, the check waits for them', () => {
    const check = buildReadyCheck([BRAND], URL);
    expect(check.isReady(snap({}))).toBe(false);
    expect(check.isReady(snap({ brand: { name: 'X' } }))).toBe(true);
  });
});
```

Add `buildReadyCheck` to the import from `./verified-extraction.js` and `import type { ReadySnapshot } from '@robot/browser';`.

- [ ] **Step 3: Run, expect failures** (`./defaults.js` missing; `defaulted` undefined; the ready check waits for brand).

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/defaults.test.ts src/verify/verified-extraction.test.ts`

- [ ] **Step 4: `defaults.ts`:**

```ts
// packages/scraper/src/verify/defaults.ts
// A website's default (spec 2026-10-13 §5): written into every cell the
// certified paths leave empty, in the form a path would have written.
import { normalize, renderValue } from './normalize.js';
import type { CustomerFieldType } from './types.js';

export type DefaultedField = { key: string; type: CustomerFieldType; defaultValue?: string };

/** The default as a run writes it — `evaluatePath`'s own rendering: text NFKC-collapsed and trimmed, every other type parsed and rendered. Null when the text does not parse for the type. */
export function renderDefault(type: CustomerFieldType, value: string): unknown {
  const norm = normalize(type, value);
  if (norm === null) return null;
  return type === 'text' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : renderValue(type, norm);
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/** Fills each field's default into the row where the cell is empty; returns a new row and the keys it filled, in field order. The input row is not changed. */
export function applyDefaults(row: Record<string, unknown>, fields: DefaultedField[]): { row: Record<string, unknown>; defaulted: string[] } {
  const out = { ...row };
  const defaulted: string[] = [];
  for (const f of fields) {
    if (f.defaultValue === undefined || !isEmpty(out[f.key])) continue;
    const rendered = renderDefault(f.type, f.defaultValue);
    if (rendered === null) continue;
    out[f.key] = rendered;
    defaulted.push(f.key);
  }
  return { row: out, defaulted };
}
```

Export it from `packages/scraper/src/verify/index.ts` beside the other verify modules: `export * from './defaults.js';`.

- [ ] **Step 5: `verified-extraction.ts`.** `VerifiedField` gains `/** The website's default (spec 2026-10-13 §5): written when every path misses; such a field never blocks readiness unless no other field would wait. */ defaultValue?: string;`. `VerifiedExtractionResult` gains `/** The field keys the website's default filled (spec §5): every certified path missed there. `[]` on a run with no defaults. */ defaulted: string[];`. In `buildReadyCheck` replace `const certified = fields.filter((f) => f.paths.length > 0);` with:

```ts
  const withPaths = fields.filter((f) => f.paths.length > 0);
  // Spec 2026-10-13 §5: a field with a default never blocks readiness — its paths may legitimately never resolve on this product — unless no other field would wait at all.
  const blocking = withPaths.filter((f) => f.defaultValue === undefined);
  const certified = blocking.length > 0 ? blocking : withPaths;
```

In `runVerifiedExtraction`, after the paths loop and before `const pageText`, add `const applied = applyDefaults(data, req.fields);` and return `{ data: applied.row, stats, timings: …, capture, shown, defaulted: applied.defaulted }`. (`shown` keeps reading `stats`, so a defaulted field — no hit — is `null`.) Import `applyDefaults` from `./defaults.js`.

- [ ] **Step 6: Run again, expect PASS.**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/defaults.test.ts src/verify/verified-extraction.test.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/scraper/src/verify/defaults.ts packages/scraper/src/verify/defaults.test.ts packages/scraper/src/verify/verified-extraction.ts packages/scraper/src/verify/verified-extraction.test.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): a run writes the website default where every certified path misses; defaulted fields never block readiness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The binding, the certification, the item, drift and the coverage check (`@robot/api`)

**Files:**
- Modify: `packages/api/src/verify/binding-input.ts`, `packages/api/src/routers/sources.ts:1075-1080` (the `verify` mutation's `bindingProblems` call), `packages/api/src/verify/current-certification.ts`, `packages/api/src/crawl/extract-item.ts`, `packages/api/src/crawl/drift.ts`, `packages/api/src/crawl/start-execution.ts:120`, `packages/api/src/verify/run-drift-check.ts:195`, `packages/api/src/verify/run-coverage-check.ts`
- Test: `packages/api/src/verify/binding-input.test.ts`, `packages/api/src/verify/current-certification.test.ts`, `packages/api/src/crawl/extract-item.test.ts`, `packages/api/src/crawl/drift.test.ts`, `packages/api/src/verify/run-coverage-check.test.ts`

**Interfaces:**
- Consumes: `VerifiedField.defaultValue`, `VerifiedExtractionResult.defaulted`, `applyDefaults`, `FieldVerification.defaultOnly`, `VerificationSet.defaults` (Tasks 1–2, all exported from `@robot/scraper`).
- Produces:
  ```ts
  bindingInput.defaults?: Record<string, string>;
  Certification.defaults?: Record<string, string>;                 // always set by loadCertificationState; fieldKey → trimmed default
  ValidationResult.defaulted?: string[];                           // omitted when empty
  export function blankDefaulted(rows, defaulted: string[], defaultKeys: ReadonlySet<string>): rows   // drift.ts
  flagDrift(db, runId, sourceId, keys, defaultKeys?: string[]); runEmptyShares(db, runId, keys, defaultKeys?: string[])
  CoverageDeps.extract → { data, shape, defaulted?: string[] } | { unread, wall }
  ```

- [ ] **Step 1: Failing tests, `binding-input.test.ts`** (append):

```ts
describe('bindingProblems — a website\'s default (spec 2026-10-13 §3, property 8)', () => {
  const blankTitle = { ...ok.expected, title: { [U[0]!]: '', [U[1]!]: '', [U[2]!]: '' } };
  it('allows blank cells on every page for a field with a default', () => {
    expect(bindingProblems({ ...ok, expected: blankTitle, defaults: { title: 'Widgetco' } }, contract)).toEqual([]);
    expect(bindingProblems({ ...ok, expected: blankTitle }, contract)).toEqual(expect.arrayContaining([expect.stringContaining('Title @ https://shop.example/p/1: Expected value is required')]));
  });
  it('refuses a default that fails the field\'s type, and one beside an absent mark', () => {
    expect(bindingProblems({ ...ok, defaults: { price: 'call us' } }, contract)).toContain('Price: default — Not a money amount');
    expect(bindingProblems({ ...ok, expected: blankTitle, defaults: { title: 'Widgetco' }, absent: { title: { [U[0]!]: true } } }, contract)).toContain('Title: a default and "not on this product" cannot both be set');
  });
  it('prepareBinding keeps trimmed, non-empty defaults only', () => {
    expect(prepareBinding({ ...ok, defaults: { title: '  Widgetco ', price: '  ' } }, contract).verificationSet.defaults).toEqual({ title: 'Widgetco' });
    expect(prepareBinding(ok, contract).verificationSet).not.toHaveProperty('defaults');
    expect(bindingInput.safeParse({ ...ok, defaults: { title: 'Widgetco' } }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Failing test, `current-certification.test.ts`** (append inside the file's existing `describe` for `loadCurrentCertification`, or as a new `describe`):

```ts
describe('a field passed by default only (spec 2026-10-13 §4/§5)', () => {
  it('is current with no path, and the certification carries the default', async () => {
    const s = await makeSchemaSource('default-only');
    try {
      const set = { ...(s.source.verificationSet as VerificationSet), defaults: { price: '9.99' } };
      await db.update(sources).set({ verificationSet: set }).where(eq(sources.id, s.sourceId));
      const fields = s.source.schemaDefinition as SchemaDefinitionField[];
      const cells = Object.fromEntries(s.urls.map((u) => [u, { status: 'pass', found: '' }]));
      await db.insert(sourceVerifications).values({
        sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true,
        results: { price: { ...fieldVerification([], { fieldHash: fieldHash(fields[0]!, set), cells }), defaultOnly: true } },
      });
      const currency = await loadFieldCurrency(db, s.sourceId);
      expect(currency.currentKeys).toEqual(['price']);
      const cert = await loadCurrentCertification(db, s.sourceId);
      expect(cert?.paths).toEqual({ price: [] });
      expect(cert?.defaults).toEqual({ price: '9.99' });
    } finally { await s.cleanup(); }
  });
  it('a failed result with no path and no defaultOnly is still not current', async () => {
    const s = await makeSchemaSource('no-path');
    try {
      const fields = s.source.schemaDefinition as SchemaDefinitionField[];
      const set = s.source.verificationSet as VerificationSet;
      const cells = Object.fromEntries(s.urls.map((u) => [u, { status: 'pass', found: '' }]));
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { price: fieldVerification([], { fieldHash: fieldHash(fields[0]!, set), cells }) } });
      expect((await loadFieldCurrency(db, s.sourceId)).currentKeys).toEqual([]);
      expect((await loadCurrentCertification(db, s.sourceId))?.defaults ?? {}).toEqual({});
    } finally { await s.cleanup(); }
  });
});
```

- [ ] **Step 3: Failing test, `extract-item.test.ts`** (append inside `describe('extractItem — with a certification')`):

```ts
  it('the website\'s default fills a field every path missed: in validationResult.defaulted, never a hit for confidence (properties 5, 6)', async () => {
    runExtractionMock.mockReset();
    const cert: Certification = { ...CERTIFICATION, paths: { ...CERTIFICATION.paths, brand: [] }, concepts: { ...CERTIFICATION.concepts, brand: 'brand' }, defaults: { brand: 'Widgetco' } };
    let seenFields: VerifiedField[] = [];
    const extractVerified = async (req: { url: string; fields: VerifiedField[] }): Promise<VerifiedExtractionResult> => {
      seenFields = req.fields;
      return {
        data: { price: 129.99, brand: 'Widgetco' },
        stats: [{ key: 'price', concept: 'price_concept', path: CERTIFICATION.paths.price![0]!, hit: true, value: 129.99 }],
        timings: null, capture: null, shown: { price: true, brand: null }, defaulted: ['brand'],
      };
    };
    const values = vi.fn(() => ({ returning: async () => [{ id: 'ext-1' }] }));
    const result = await extractItem({ insert: () => ({ values }) } as never, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r',
      schema: [...CERT_SCHEMA, { name: 'brand', type: 'string', origin: 'detail' as const }],
      schemaDefinition: [...SCHEMA_DEFINITION, { key: 'brand', name: 'Brand', type: 'text' as const, description: 'x', concept: 'brand' }],
      certification: cert, extractVerified, recordStats: vi.fn(async () => {}),
    });
    expect(seenFields.find((f) => f.key === 'brand')).toEqual({ key: 'brand', type: 'text', concept: 'brand', paths: [], defaultValue: 'Widgetco' });
    expect(seenFields.find((f) => f.key === 'price')).not.toHaveProperty('defaultValue');
    expect(result.row).toMatchObject({ price: 129.99, brand: 'Widgetco' });
    const extraction = (values.mock.calls[1]![0] as unknown) as { confidence: number; validationResult: unknown };
    expect(extraction.validationResult).toEqual({ shown: { price: true, brand: null }, paths: { price: CERTIFICATION.paths.price![0] }, defaulted: ['brand'] });
    expect(extraction.confidence).toBe(50);
  });

  it('a run without defaults writes no defaulted key at all (property 9)', async () => {
    const extractVerified = async (): Promise<VerifiedExtractionResult> => ({
      data: { price: 129.99 }, stats: [{ key: 'price', concept: 'price_concept', path: CERTIFICATION.paths.price![0]!, hit: true, value: 129.99 }], timings: null, capture: null, shown: { price: true }, defaulted: [],
    });
    const values = vi.fn(() => ({ returning: async () => [{ id: 'ext-1' }] }));
    await extractItem({ insert: () => ({ values }) } as never, ITEM, { browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA, schemaDefinition: SCHEMA_DEFINITION, certification: CERTIFICATION, extractVerified, recordStats: vi.fn(async () => {}) });
    expect((values.mock.calls[1]![0] as { validationResult: unknown }).validationResult).toEqual({ shown: { price: true }, paths: { price: CERTIFICATION.paths.price![0] } });
  });
```

Every existing `VerifiedExtractionResult` literal in this file (`shown: {}` ones) gains `defaulted: []` — the type now requires it.

- [ ] **Step 4: Failing test, `drift.test.ts`** (append to `describe('driftedKeys')` or a new describe):

```ts
describe('blankDefaulted (spec 2026-10-13 §5, property 7)', () => {
  it('reads a row as empty for a defaulted field, and leaves everything else alone', () => {
    const rows = [{ brand: 'Widgetco', price: 1 }, { brand: 'Widgetco', price: 2 }];
    expect(blankDefaulted(rows, ['brand'], new Set(['brand']))).toEqual([{ brand: null, price: 1 }, { brand: null, price: 2 }]);
    expect(blankDefaulted(rows, ['brand'], new Set())).toBe(rows);
    expect(blankDefaulted(rows, [], new Set(['brand']))).toBe(rows);
  });
});
```

Import `blankDefaulted` from `./drift.js`.

- [ ] **Step 5: Failing test, `run-coverage-check.test.ts`** (append; model on the file's existing injected-`extract` tests — the `certifiedWebsite` helper, `startCoverageCheck`, `runCoverageCheck` with `{ listing: listing(5), extract, proofShapes }`, `checkRow`):

```ts
  it('a sampled page where the default filled a field counts that field as empty (spec 2026-10-13 §5)', async () => {
    const w = await certifiedWebsite('cov-default');
    try {
      const extract = vi.fn(async () => ({ data: { price: 9.99, title: 'Widgetco' }, shape: single, defaulted: ['title'] }));
      const { checkId } = await startCoverageCheck(w.sourceId, w.verificationId, { listing: listing(3), extract, proofShapes });
      await runCoverageCheck(checkId, { listing: listing(3), extract, proofShapes });
      const row = await checkRow(checkId);
      const results = row.results as CoverageResults;
      expect(results.sampled.map((p) => ('empty' in p ? p.empty : p.unread))).toEqual([['title'], ['title'], ['title']]);
    } finally { await w.cleanup(); }
  });
```

(Use whichever names the file's `certifiedWebsite` returns for the verification id and cleanup — read the helper first; the assertion is the point.)

- [ ] **Step 6: Run the five files, expect failures.**

Run: `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts src/verify/current-certification.test.ts src/crawl/extract-item.test.ts src/crawl/drift.test.ts src/verify/run-coverage-check.test.ts`

- [ ] **Step 7: `binding-input.ts`.** Schema: after `absent`, add

```ts
  /** fieldKey → the website's default for that field (spec 2026-10-13 §3): a run writes it where every certified path misses. */
  defaults: z.record(z.string(), z.string().max(2000)).optional(),
```

In `bindingProblems`, inside the `for (const f of contract)` loop, right after `const absent = …`, add:

```ts
    const def = (input.defaults?.[f.key] ?? '').trim();
    if (def) {
      const err = validateExpected(f.type, def);
      if (err) problems.push(`${f.name}: default — ${err}`);
      // A default would fill the very cell the customer said is empty (spec 2026-10-13 §3).
      if (Object.keys(absent).length > 0) problems.push(`${f.name}: a default and "not on this product" cannot both be set`);
    }
```

Change the blank-cell rule to `if ((draft || i >= VERIFY_URL_MIN || def) && value.trim() === '') return;` — a blank cell on any page is a default cell for a field with a default. In `prepareBinding`, after `absent`, add:

```ts
  const defaults: NonNullable<VerificationSet['defaults']> = {};
  for (const f of contract) {
    const def = (input.defaults?.[f.key] ?? '').trim();
    if (def) defaults[f.key] = def;
  }
```

and `...(Object.keys(defaults).length ? { defaults } : {})` in the returned set. In `sources.ts`'s `verify` mutation, the `bindingProblems({ … })` call gains `...(set.absent ? { absent: set.absent } : {}), ...(set.defaults ? { defaults: set.defaults } : {})` (the absent marks were not passed before either; passing them is what the rules expect).

- [ ] **Step 8: `current-certification.ts`.** `Certification` gains `/** fieldKey → the website's trimmed default (spec 2026-10-13 §5); always set by `loadCertificationState`, optional only so older fakes compile. */ defaults?: Record<string, string>;`. In `currencyOf`, the `currentKeys` filter becomes `(r.certified.length > 0 || r.defaultOnly === true) && Object.values(r.cells).length > 0 && …`. In `loadCertificationState`'s returned `cert`, add:

```ts
      defaults: Object.fromEntries(fields.flatMap((f) => { const d = (set.defaults?.[f.key] ?? '').trim(); return d ? [[f.key, d] as const] : []; })),
```

- [ ] **Step 9: `extract-item.ts`.** `ValidationResult` gains `/** The field keys the website's default filled on at least one row of this item (spec 2026-10-13 §5); omitted when none. */ defaulted?: string[];`. In the certified branch's `fields` map, add `...(deps.certification!.defaults?.[f.name] !== undefined ? { defaultValue: deps.certification!.defaults[f.name]! } : {})`. After `const verified = …`:

```ts
    // Spec 2026-10-13 §5: a defaulted field is not a hit (confidence says what the paths produced).
    const productDefaulted = verified.defaulted;
    const hits = fields.filter((f) => verified.data[f.key] !== null && !productDefaulted.includes(f.key)).length;
```

(replace the existing `hits` line.) Build `validationResult` as:

```ts
    const withDefaulted = (vr: ValidationResult, keys: string[]): ValidationResult => (keys.length ? { ...vr, defaulted: keys } : vr);
    const validationResult = withDefaulted({ shown: verified.shown, paths: Object.fromEntries(…) }, productDefaulted);
```

In the list-variants branch, after `const built = buildVariantRows(…)`, when `built.withVariants`:

```ts
        // A variant-level field an entry left empty takes the default too (spec 2026-10-13 §5).
        const defaultFields = fields.filter((f) => f.defaultValue !== undefined);
        const applied = built.rows.map((r) => applyDefaults(r, defaultFields));
        const rowsOut = applied.map((a) => a.row);
        const defaultedAll = [...new Set([...productDefaulted, ...applied.flatMap((a) => a.defaulted)])];
```

and persist `rowsOut` with `withDefaulted({ shown, paths }, defaultedAll)` in place of `{ shown, paths }`. Import `applyDefaults` from `@robot/scraper`.

- [ ] **Step 10: `drift.ts`.** Add and export:

```ts
/** Pure: the rows with every key the default filled (`defaulted`, from the extraction's validation_result) read as empty, for the keys in `defaultKeys` only — so a path that stopped hitting on a defaulted field still shows as drift (spec 2026-10-13 §5). The rows as given when nothing applies. */
export function blankDefaulted(rows: Array<Record<string, unknown>>, defaulted: string[], defaultKeys: ReadonlySet<string>): Array<Record<string, unknown>> {
  const blank = defaulted.filter((k) => defaultKeys.has(k));
  if (blank.length === 0) return rows;
  return rows.map((r) => ({ ...r, ...Object.fromEntries(blank.map((k) => [k, null])) }));
}
```

`runRows(db, runId, defaultKeys: ReadonlySet<string> = new Set())` reads `columns: { data: true, validationResult: true }` and returns `found.flatMap((e) => blankDefaulted(Array.isArray(e.data) ? (e.data as Array<Record<string, unknown>>) : [], (e.validationResult as { defaulted?: string[] } | null)?.defaulted ?? [], defaultKeys))`. `runEmptyShares(db, runId, keys, defaultKeys: string[] = [])` and `flagDrift(db, runId, sourceId, keys, defaultKeys: string[] = [])` pass `new Set(defaultKeys)` through. In `start-execution.ts`'s `buildFinalise`: `doFlagDrift(db, runId, sourceId, Object.keys(certification.paths).filter((k) => certification.paths[k]!.length > 0), Object.keys(certification.defaults ?? {}))` — a default-only field has no path and never drifts. In `run-drift-check.ts`, the `runEmptyShares(db, check.runId, missing)` call gains a fourth argument `Object.keys(cert?.defaults ?? {})`.

- [ ] **Step 11: `run-coverage-check.ts`.** `CoverageDeps.extract` returns `{ data: Record<string, unknown>; shape: Shape; defaulted?: string[] } | { unread: string; wall: boolean }`; `defaultExtract` returns `{ data: r.data, shape: shapeOf(r.capture!), defaulted: r.defaulted }`. The `fields` map adds `...(cert.defaults?.[f.key] !== undefined ? { defaultValue: cert.defaults[f.key]! } : {})`. The sampled line becomes `empty: fields.filter((f) => isEmpty(r.data[f.key]) || (r.defaulted ?? []).includes(f.key)).map((f) => f.key)`.

- [ ] **Step 12: Run the five files again, expect PASS; then the whole api package.**

Run: `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts src/verify/current-certification.test.ts src/crawl/extract-item.test.ts src/crawl/drift.test.ts src/verify/run-coverage-check.test.ts` then `pnpm --filter @robot/api exec vitest run`

- [ ] **Step 13: Commit**

```bash
git add packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts packages/api/src/routers/sources.ts packages/api/src/verify/current-certification.ts packages/api/src/verify/current-certification.test.ts packages/api/src/crawl/extract-item.ts packages/api/src/crawl/extract-item.test.ts packages/api/src/crawl/drift.ts packages/api/src/crawl/drift.test.ts packages/api/src/crawl/start-execution.ts packages/api/src/verify/run-drift-check.ts packages/api/src/verify/run-coverage-check.ts packages/api/src/verify/run-coverage-check.test.ts
git commit -m "feat(api): a website's defaults ride the binding into certification, extraction, drift and the coverage check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The run coverage report, ops and the judge (`@robot/api`)

**Files:**
- Modify: `packages/api/src/crawl/coverage.ts`, `packages/api/src/crawl/load-run-coverage.ts`, `packages/api/src/routers/ops.ts:255-275`, `packages/api/src/judge-run.ts:220-250`, `packages/api/src/judge-run-report.ts`
- Test: `packages/api/src/crawl/coverage.test.ts`, `packages/api/src/routers/ops.test.ts`, `packages/api/src/judge-run-report.test.ts`

**Interfaces:**
- Consumes: `ValidationResult.defaulted`, `FieldVerification.defaultOnly`, `VerificationSet.defaults`.
- Produces:
  ```ts
  FieldCoverage.defaulted: number;
  RunCoverage.defaultedItems: Array<{ url: string; fields: string[] }>;   // first UNSHOWN_ITEMS_MAX
  computeCoverage items gain defaulted?: string[] | null;
  ops.website fields[] gain defaultValue?: string; defaultOnly?: true;
  judge Cell.defaulted?: true;
  ```

- [ ] **Step 1: Failing tests, `coverage.test.ts`.** Update the two existing `toEqual` objects with `defaulted: 0` per field and `defaultedItems: []` on the result where the whole result is compared; append:

```ts
  // Spec 2026-10-13 §7: a defaulted value is filled, counted apart, and listed per item.
  it('counts defaulted per field and lists the items, never counting them not shown', () => {
    const out = computeCoverage(
      [{ name: 'brand' }, { name: 'price' }],
      [
        { id: 'a', url: 'u1', row: { brand: 'Widgetco', price: 1 }, absentFields: [], shown: { brand: null, price: true }, defaulted: ['brand'] },
        { id: 'b', url: 'u2', row: { brand: 'Acme', price: 2 }, absentFields: [], shown: { brand: true, price: true }, defaulted: [] },
        { id: 'c', url: 'u3', row: { brand: 'Widgetco', price: 3 }, absentFields: [] },
      ],
    );
    expect(out.fields).toEqual([
      { name: 'brand', filled: 3, missing: 0, confirmedAbsent: 0, total: 3, notShown: 0, checked: 1, defaulted: 1 },
      { name: 'price', filled: 3, missing: 0, confirmedAbsent: 0, total: 3, notShown: 0, checked: 2, defaulted: 0 },
    ]);
    expect(out.defaultedItems).toEqual([{ url: 'u1', fields: ['brand'] }]);
    expect(out.unshownItems).toEqual([]);
  });
```

- [ ] **Step 2: Failing test, `ops.test.ts`** (append inside the `ops.website` describe, after the existing "gets its fields' certified paths" test; reuse its `certifyPaths`/`built` setup pattern):

```ts
    it('shows a field\'s default and marks a default-only field (spec 2026-10-13 §7)', async () => {
      // Set the default on the source's own verification set, then certify Price by default only.
      const src = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { verificationSet: true, schemaDefinition: true } });
      const set = { ...(src!.verificationSet as VerificationSet), defaults: { [priceKey]: '9.99' } };
      await db.update(sources).set({ verificationSet: set }).where(eq(sources.id, built.sourceId));
      const priceField = (src!.schemaDefinition as SchemaDefinitionField[]).find((f) => f.key === priceKey)!;
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: '' }]));
      await db.insert(sourceVerifications).values({ sourceId: built.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true,
        results: { [priceKey]: { key: priceKey, cells, certified: [], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(priceField, set), defaultOnly: true } } });
      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      const price = result.fields.find((f) => f.key === priceKey)!;
      expect(price).toMatchObject({ state: 'current', paths: [], defaultValue: '9.99', defaultOnly: true });
      expect(result.fields.find((f) => f.key !== priceKey)).not.toHaveProperty('defaultValue');
    });
```

(Take `priceKey`, `built`, `op` from the surrounding describe's own setup; import `sourceVerifications`, `fieldHash`, `VerificationSet`, `SchemaDefinitionField` as the file's other tests do.)

- [ ] **Step 3: Failing tests, `judge-run-report.test.ts`** (append):

```ts
describe('a defaulted value (spec 2026-10-13 §7)', () => {
  const defaultedItems: ItemResult[] = [{
    url: 'https://shop.example/p/9',
    cells: [
      { field: 'title', value: 'Widgetco', verdict: 'wrong', tile: 1, shown: null, defaulted: true },
      { field: 'price', value: 1, verdict: 'correct', tile: 1, shown: true },
    ],
  }];
  it('is left out of the confusion table and reads "default" in the flag column', () => {
    expect(confusionCounts(defaultedItems)).toMatchObject({ unflagged: 1, correctShown: 1, wrongTotal: 1 });
    expect(renderReport({ ...REPORT_BASE, items: defaultedItems })).toContain('shown: default');
  });
});
```

(`REPORT_BASE`: whatever `ReportInput` literal the file already builds for `renderReport` — name it as the file does. The `shown: default` line comes from the "Correct values flagged not shown"/per-cell listing that already prints `shown: ${shownText(c.shown)}`; if that section lists only `correct && shown === false` cells, assert instead on `shownText` exported for the test: `expect(shownText({ shown: null, defaulted: true })).toBe('default')`. Export `shownText` and make it take the cell.)

- [ ] **Step 4: Run, expect failures.**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/coverage.test.ts src/routers/ops.test.ts src/judge-run-report.test.ts`

- [ ] **Step 5: `coverage.ts`.** `FieldCoverage` gains `/** Values the website's default filled (spec 2026-10-13 §7). */ defaulted: number;`; `RunCoverage` gains `/** Items with at least one defaulted field, in item order, first `UNSHOWN_ITEMS_MAX`. */ defaultedItems: Array<{ url: string; fields: string[] }>;`; the items parameter gains `defaulted?: string[] | null;`. Initialise `defaulted: 0`; inside the per-field loop add:

```ts
      if (item.defaulted?.includes(fc.name)) { fc.defaulted++; defaultedFields.push(fc.name); }
```

with `const defaultedFields: string[] = [];` per item and, after the field loop, `if (defaultedFields.length > 0 && defaultedItems.length < UNSHOWN_ITEMS_MAX) defaultedItems.push({ url: item.url, fields: defaultedFields });`. Return `{ fields: fieldCoverage, gapItems, unshownItems, defaultedItems }`. In `load-run-coverage.ts`'s `loadRunCoverage`, pass `defaulted: (i.extraction?.validationResult as { defaulted?: string[] } | null)?.defaulted ?? null`.

- [ ] **Step 6: `ops.ts`.** In the `fields.map((f) => …)` of `website`, with `const set = row.verificationSet as VerificationSet | null;` read once above the map:

```ts
        const def = (set?.defaults?.[f.key] ?? '').trim();
        return {
          key: f.key, name: f.name, type: f.type, state,
          ...(def ? { defaultValue: def } : {}),
          ...(result?.defaultOnly ? { defaultOnly: true as const } : {}),
          paths: certified.map(…),
        };
```

- [ ] **Step 7: The judge.** In `judge-run.ts`, beside the `shown` read: `const defaulted = (r.validationResult as { defaulted?: string[] } | null)?.defaulted?.includes(f.key) === true;` and spread `...(defaulted ? { defaulted: true as const } : {})` into every cell pushed for a non-empty value (the unverifiable, text-settled and judged cells). In `judge-run-report.ts`, `Cell` gains `/** The run wrote the website's default here (spec 2026-10-13 §7): judged like any value, left out of the shown-flag confusion. */ defaulted?: true;`; `confusionCounts` skips with `if (cell.defaulted || cell.shown == null) { c.unflagged++; continue; }`; `shownText(c: Pick<Cell, 'shown' | 'defaulted'>)` returns `'default'` first when `c.defaulted`, and is exported; its one call site passes the cell.

- [ ] **Step 8: Run the three files, expect PASS; then the api package.**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/coverage.test.ts src/routers/ops.test.ts src/judge-run-report.test.ts` then `pnpm --filter @robot/api exec vitest run`

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/crawl/coverage.ts packages/api/src/crawl/coverage.test.ts packages/api/src/crawl/load-run-coverage.ts packages/api/src/routers/ops.ts packages/api/src/routers/ops.test.ts packages/api/src/judge-run.ts packages/api/src/judge-run-report.ts packages/api/src/judge-run-report.test.ts
git commit -m "feat(api): defaulted values counted in the run coverage report, shown in ops, judged but kept out of the flag's confusion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The Verification tab (`@robot/app`)

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (`Board.defaults`, `boardFrom`, `toBindingInput`, `setDefault`, `defaultOf`, `isDefaultCell`, `cellText`, `rowStatus`, `verifyGate`, `badge`, `defaultOnlyWord`, `rowValue`), `packages/app/src/lib/site/shown.ts` (`defaultNotShown`), `packages/app/src/lib/site/proof-coverage-view.ts` (`coverageLine`'s `hasDefault`, `EVERY_PRODUCT_DEFAULT`), `packages/app/src/components/verification/field-details.tsx`, `packages/app/src/components/verification/verification-table.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`
- Test: `packages/app/src/lib/site/verification-model.test.ts`, `packages/app/src/lib/site/shown.test.ts`, `packages/app/src/lib/site/proof-coverage-view.test.ts`

**Interfaces:**
- Consumes: the wire shapes from Tasks 3–4 (`verificationSet.defaults`, `results[key].defaultOnly`) — mirrored locally, never imported.
- Produces:
  ```ts
  Board.defaults: Record<string, string>;
  export function setDefault(board: Board, key: string, text: string): Board;        // trims; blank removes; clears the field's absent cells
  export function defaultOf(board: Board, key: string): string | undefined;
  export function isDefaultCell(board: Board, field: Field, live: Suggestions, url: string): boolean;
  export function rowValue(board: Board, live: Suggestions, key: string): string | null;  // the first answered-or-suggested value across the cards
  export function defaultOnlyWord(results: VerificationResultsLike | null, key: string, unchangedKeys: string[]): string | null;
  export const DEFAULT_ONLY_WORD = 'default only · no path reads it on this website';
  export const DEFAULT_CELL_TITLE = "This website's default; a path that reads a value here wins";
  // shown.ts
  export function defaultNotShown(field: Field, value: string, pageTexts: string[]): boolean;
  // proof-coverage-view.ts
  coverageLine(f, atLimit, onBoard = false, opts: { hasDefault?: boolean } = {})
  export const EVERY_PRODUCT_DEFAULT = 'Every product gets the default';
  // TableCell.isDefault?: boolean; TableRow.hasDefault, onMakeDefault, defaultOnlyWord; FieldDetails defaultValue/defaultError/defaultWarn/onDefault
  ```

- [ ] **Step 1: Failing tests, `verification-model.test.ts`** (append; add `setDefault, defaultOf, isDefaultCell, rowValue, defaultOnlyWord, DEFAULT_ONLY_WORD, cellText, type Suggestions` to the import):

```ts
describe('a website\'s default (spec 2026-10-13 §6)', () => {
  const BRAND: Field = { key: 'brand', name: 'Brand', type: 'text', description: 'maker', concept: 'brand' };
  const ALL = [...FIELDS, BRAND];
  const BL = { source: 'json-ld', path: 'brand.name' };

  it('saves and reads back defaults, trimmed, dropping blanks', () => {
    const b = setDefault(board(), 'brand', ' Widgetco ');
    expect(defaultOf(b, 'brand')).toBe('Widgetco');
    expect(toBindingInput(b, ALL).defaults).toEqual({ brand: 'Widgetco' });
    expect(toBindingInput(setDefault(b, 'brand', '  '), ALL)).not.toHaveProperty('defaults');
    const back = boardFrom({ schemaDefinition: ALL, verificationSet: { urls: U, expected: {}, defaults: { brand: 'Widgetco' } } });
    expect(back.defaults).toEqual({ brand: 'Widgetco' });
    expect(boardFrom({ schemaDefinition: ALL, verificationSet: { urls: U, expected: {} } }).defaults).toEqual({});
  });

  it('setting a default clears the field\'s absent cells, and nothing else', () => {
    let b = markAbsent(board(), 'brand', U[0]!);
    b = answer(b, 'brand', U[1]!, { value: 'Acme', mark: null });
    b = answer(b, 'title', U[2]!, { value: '', mark: null, absent: true });
    b = setDefault(b, 'brand', 'Widgetco');
    expect(b.answers.brand).toEqual({ [U[1]!]: { value: 'Acme', mark: null } });
    expect(isAbsent(b, 'title', U[2]!)).toBe(true);
  });

  it('a blank cell with a default is not missing, reads the default, and is a default cell', () => {
    const b = setDefault(board(), 'brand', 'Widgetco');
    expect(rowStatus(BRAND, b, {}, maps())).toEqual({ kind: 'accepted' });
    expect(rowStatus(BRAND, board(), {}, maps())).toEqual({ kind: 'needs-you', reason: 'missing on product 1', product: 1 });
    expect(cellText(b, BRAND, U[0]!, () => '')).toBe('Widgetco');
    expect(cellText(b, BRAND, U[0]!, () => 'Acme')).toBe('Acme');
    expect(isDefaultCell(b, BRAND, {}, U[0]!)).toBe(true);
    expect(isDefaultCell(answer(b, 'brand', U[0]!, { value: 'Acme', mark: null }), BRAND, {}, U[0]!)).toBe(false);
    expect(isDefaultCell(b, BRAND, liveFor(b, 'brand', [sug('Acme', [0], BL), null, null]), U[0]!)).toBe(false);
    expect(isDefaultCell(board(), BRAND, {}, U[0]!)).toBe(false);
  });

  it('the gate does not ask for a product on a field with a default (Review Focus 5)', () => {
    expect(verifyGate(full(), ALL, {}).ok).toBe(false);
    expect(verifyGate(setDefault(full(), 'brand', 'Widgetco'), ALL, {})).toEqual({ ok: true });
  });

  it('a suggestion that differs from the default follows the normal flow, and rowValue reads the shared value', () => {
    const b = setDefault(board(), 'brand', 'Widgetco');
    const live = liveFor(b, 'brand', [sug('Acme', [0], BL), sug('Acme', [0], BL), sug('Acme', [0], BL)]);
    const boxes = { [U[0]!]: boxesOf(['Acme']), [U[1]!]: boxesOf(['Acme']), [U[2]!]: boxesOf(['Acme']) };
    expect(rowStatus(BRAND, b, live, boxes)).toEqual({ kind: 'same-everywhere' });
    expect(rowValue(b, live, 'brand')).toBe('Acme');
    expect(rowValue(answer(b, 'brand', U[1]!, { value: 'Typed', mark: null }), {}, 'brand')).toBe('Typed');
    expect(rowValue(b, {}, 'brand')).toBeNull();
  });

  it('a default-only result reads verified, with its row word only while unchanged', () => {
    const results = { brand: { certified: [], defaultOnly: true as const, cells: { [U[0]!]: { status: 'pass' as const } } } };
    expect(badge({ key: 'brand', results, unchangedKeys: ['brand'], running: false, cards: board().cards })).toEqual({ kind: 'verified' });
    expect(defaultOnlyWord(results, 'brand', ['brand'])).toBe(DEFAULT_ONLY_WORD);
    expect(defaultOnlyWord(results, 'brand', [])).toBeNull();
    expect(defaultOnlyWord({ brand: { certified: [BL], cells: {} } }, 'brand', ['brand'])).toBeNull();
  });
});
```

- [ ] **Step 2: Failing tests, `shown.test.ts`** (append; add `defaultNotShown` to the import):

```ts
describe('defaultNotShown (spec 2026-10-13 §6)', () => {
  it('warns only when every captured proof page lacks the value', () => {
    expect(defaultNotShown(brand, 'Gymshark', ['gymshark we do gym', 'shop gymshark'])).toBe(false);
    expect(defaultNotShown(brand, 'Gymshark', ['gymshark we do gym', 'nothing here'])).toBe(false);
    expect(defaultNotShown(brand, 'Gymshark | We Do Gym', ['gymshark shorts', 'gymshark tops'])).toBe(true);
  });
  it('is inert with no captured text, a blank value, or an unchecked type', () => {
    expect(defaultNotShown(brand, 'Gymshark', ['', ''])).toBe(false);
    expect(defaultNotShown(brand, '  ', ['x'])).toBe(false);
    expect(defaultNotShown(available, 'yes', ['x'])).toBe(false);
  });
});
```

- [ ] **Step 3: Failing tests, `proof-coverage-view.test.ts`** (append; import `EVERY_PRODUCT_DEFAULT`):

```ts
describe('coverageLine with a default (spec 2026-10-13 §5/§8)', () => {
  it('says the default filled the empties and still offers the page', () => {
    expect(coverageLine({ ...f, explanation: null }, false, false, { hasDefault: true })).toEqual({ text: 'The default filled 2 of 20 sampled products', useAsProofPage: 'https://s.example/p/10' });
    expect(coverageLine({ ...f, empty: [f.empty[0]!], sampled: 1, explanation: null }, false, false, { hasDefault: true }).text).toBe('The default filled 1 of 1 sampled product');
  });
  it('keeps the explanation and the limit after it', () => {
    expect(coverageLine(f, true, false, { hasDefault: true }).text).toBe('The default filled 2 of 20 sampled products · all 2 list their sizes as variants in the page data · This website has its six proof pages');
  });
  it('names the default-only line', () => expect(EVERY_PRODUCT_DEFAULT).toBe('Every product gets the default'));
});
```

- [ ] **Step 4: Run, expect failures.**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts src/lib/site/shown.test.ts src/lib/site/proof-coverage-view.test.ts`

- [ ] **Step 5: `verification-model.ts`.** `Board` gains `defaults: Record<string, string>`; `emptyBoard` returns `defaults: {}`; `StoredVerificationSet` gains `defaults?: Record<string, string>`; `boardFrom` returns `defaults: { ...(set.defaults ?? {}) }` (and `{ ...emptyBoard(), descriptions }` on no set already carries `defaults: {}`); `toBindingInput`'s return type gains `defaults?: Record<string, string>` and the body:

```ts
  const defaults: Record<string, string> = {};
  for (const f of fields) { const d = (board.defaults[f.key] ?? '').trim(); if (d) defaults[f.key] = d; }
  …
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
```

Add, after `cellText`:

```ts
/** Sets the website's default for a field (spec 2026-10-13 §3/§6); a blank removes it. A default and "not on this product" never coexist: the field's absent cells are cleared. */
export function setDefault(board: Board, key: string, text: string): Board {
  const defaults = { ...board.defaults };
  const d = text.trim();
  if (d) defaults[key] = text; else delete defaults[key];
  const byUrl = Object.fromEntries(Object.entries(board.answers[key] ?? {}).filter(([, a]) => !a.absent));
  const answers = { ...board.answers };
  if (Object.keys(byUrl).length === 0) delete answers[key]; else answers[key] = byUrl;
  return { ...board, defaults, answers: d ? answers : board.answers };
}

export function defaultOf(board: Board, key: string): string | undefined {
  const d = (board.defaults[key] ?? '').trim();
  return d || undefined;
}

/** A cell with no answer and no suggestion on a field with a default (spec §6): it shows the default, muted. */
export function isDefaultCell(board: Board, field: Field, live: Suggestions, url: string): boolean {
  return defaultOf(board, field.key) !== undefined && !board.answers[field.key]?.[url] && !live[field.key]?.[url];
}

/** The first value a row carries across the cards — an answer or a suggestion — for "Make it the default"; null when it carries none. */
export function rowValue(board: Board, live: Suggestions, key: string): string | null {
  for (const c of board.cards) {
    const v = board.answers[key]?.[c.url]?.value ?? live[key]?.[c.url]?.value;
    if (v && v.trim()) return v;
  }
  return null;
}

export const DEFAULT_ONLY_WORD = 'default only · no path reads it on this website';
export const DEFAULT_CELL_TITLE = "This website's default; a path that reads a value here wins";

/** The row word beside a verified badge for a field that passed by default only (spec 2026-10-13 §6); null otherwise or once the field changed since. */
export function defaultOnlyWord(results: VerificationResultsLike | null, key: string, unchangedKeys: string[]): string | null {
  return results?.[key]?.defaultOnly === true && unchangedKeys.includes(key) ? DEFAULT_ONLY_WORD : null;
}
```

`cellText` becomes `return isAbsent(board, field.key, url) ? ABSENT_TEXT : (fallback() || defaultOf(board, field.key) || '');`. `VerificationResultsLike`'s value type gains `defaultOnly?: true`. In `rowStatus`'s loop: `if (!s) { if (required && defaultOf(board, field.key) === undefined) return { kind: 'needs-you', reason: \`missing on product ${n}\`, product: n }; continue; }`. In `badge`: `if (fv.certified.length > 0 || fv.defaultOnly === true) return { kind: 'verified' };`. In `verifyGate`'s first-three loop: `if (!a) { if (defaultOf(board, f.key) !== undefined) continue; return { ok: false, reason: …, gap: f.key }; }`. `setCards` must keep `defaults` (it spreads `board`, so it does).

- [ ] **Step 6: `shown.ts`.** Append:

```ts
/**
 * A default no captured proof page shows (spec 2026-10-13 §6): the §B2 check
 * against every page with text, true only when all of them lack it. Inert
 * with no captured text, a blank value, or a type the check never reads.
 */
export function defaultNotShown(field: Field, value: string, pageTexts: string[]): boolean {
  const v = value.trim();
  if (!v) return false;
  const texts = pageTexts.filter(Boolean);
  if (texts.length === 0) return false;
  return texts.every((t) => typedNotShown(field, { value: v, mark: null }, t));
}
```

- [ ] **Step 7: `proof-coverage-view.ts`.** `coverageLine(f, atLimit, onBoard = false, opts: { hasDefault?: boolean } = {})`; the first part becomes `opts.hasDefault ? \`The default filled ${f.empty.length} of ${f.sampled} sampled ${noun}\` : \`Empty on …\`` with the same singular/plural noun; add `export const EVERY_PRODUCT_DEFAULT = 'Every product gets the default';`.

- [ ] **Step 8: `field-details.tsx`.** Props gain `defaultValue: string; defaultError?: string; defaultWarn: boolean; onDefault: (value: string) => void;`. Add after the Type it block:

```tsx
      <div>
        <span className="mb-1 block text-sm text-muted-foreground">Default for this website</span>
        <Input aria-label={`Default ${field.name} for this website`} value={defaultValue} disabled={locked} onChange={(e) => onDefault(e.target.value)} />
        {defaultError ? (
          <p className="mt-1 text-sm text-fail">{defaultError}</p>
        ) : defaultValue.trim() ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Fills every product the paths leave empty.
            {defaultWarn ? <span className="ml-2 text-warn" title={DEFAULT_WARN_TITLE}>not on any proof page</span> : null}
          </p>
        ) : null}
      </div>
```

with `export const DEFAULT_WARN_TITLE = 'No proof page shows this value; it will still fill every product the paths leave empty.';` at the top.

- [ ] **Step 9: `verification-table.tsx`.** `TableCell` gains `/** A blank cell on a field with a default (spec 2026-10-13 §6): shows the default, muted, under `DEFAULT_CELL_TITLE`. */ isDefault?: boolean;`. `TableRow` gains `hasDefault: boolean; onMakeDefault: () => void; defaultOnlyWord: string | null;`. In the cell span: className adds `cell.isDefault && 'text-muted-foreground'`, title becomes `cell.notOnPage ? NOT_ON_PAGE_TITLE : cell.isDefault ? DEFAULT_CELL_TITLE : cell.value || undefined`. The "Not on this product" menu item: `disabled={locked || !cell.url.trim() || cell.absent || row.hasDefault}`. `StatusCell` takes `onMakeDefault` and, in the `same-everywhere` case, renders after "Accept anyway":

```tsx
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Make ${field.name} the default for this website`} title={locked ? LOCKED_REASON : undefined} onClick={onMakeDefault}>
            Make it the default
          </Button>
```

Beside `<BadgeView badge={row.badge} />` in the row head: `{row.defaultOnlyWord ? <span className="text-sm text-muted-foreground">{row.defaultOnlyWord}</span> : null}`. Import `DEFAULT_CELL_TITLE` from the model.

- [ ] **Step 10: The route.** In the `rows` map:

```ts
      const def = board.defaults[f.key] ?? '';
      …
      cells: board.cards.map((c) => ({ …, isDefault: isDefaultCell(board, f, live, c.url) })),
      hasDefault: defaultOf(board, f.key) !== undefined,
      defaultOnlyWord: defaultOnlyWord(results, f.key, unchangedKeys),
      details: {
        …,
        defaultValue: def,
        defaultError: def.trim() !== '' ? (validateValue(f.type, def) ?? undefined) : undefined,
        defaultWarn: defaultNotShown(f, def, board.cards.map((c) => pageFacts[c.url]?.pageText ?? '')),
        onDefault: (text: string) => setBoard((b) => setDefault(b, f.key, text)),
      },
      onMakeDefault: () => {
        const v = rowValue(board, live, f.key);
        if (!v) return;
        setBoard((b) => acceptRow(setDefault(b, f.key, v), f, live, boxesByUrl, 'via' in statuses[fi]! ? statuses[fi]!.via : undefined));
      },
```

`coverageFor(f)`: when `coverage` has no entry for the field and `results?.[f.key]?.defaultOnly && unchangedKeys.includes(f.key)`, return `{ text: EVERY_PRODUCT_DEFAULT, onUseAsProofPage: null }`; otherwise call `coverageLine(c, atLimit, onBoard, { hasDefault: defaultOf(board, f.key) !== undefined })`. The detail bar's `onAbsent` adds `&& defaultOf(board, detailField.key) === undefined`. Import `defaultNotShown` from `lib/site/shown`, `EVERY_PRODUCT_DEFAULT` from `proof-coverage-view`, and the new model exports.

- [ ] **Step 11: Run the three files, expect PASS; then the app package's unit tests** (`RUN_UI_SMOKE` unset, so the smoke is skipped).

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts src/lib/site/shown.test.ts src/lib/site/proof-coverage-view.test.ts` then `pnpm --filter @robot/app exec vitest run`

- [ ] **Step 12: Commit**

```bash
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/shown.ts packages/app/src/lib/site/shown.test.ts packages/app/src/lib/site/proof-coverage-view.ts packages/app/src/lib/site/proof-coverage-view.test.ts packages/app/src/components/verification/field-details.tsx packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
git commit -m "feat(app): a website's default in the Verification tab — the row's input and warning, default cells, make-it-the-default, the default-only row word

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The run page, the Sample panel and the ops page (`@robot/app`)

**Files:**
- Modify: `packages/app/src/lib/site/coverage-view.ts` (`FieldCoverage.defaulted`, `defaultBadge`), `packages/app/src/lib/site/run-screen-view.ts` (`resultsSummary`), `packages/app/src/components/runs/results-table.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx`, `packages/app/src/lib/site/extract-view.ts` (`sampleFacts`), `packages/app/src/components/extract/extract-sample.tsx`, `packages/app/src/lib/ops-view.ts` (`OpsField`, `defaultLine`, `DEFAULT_ONLY_PATHS`), `packages/app/src/routes/_app/ops/websites/$sourceId.tsx`
- Test: `packages/app/src/lib/site/coverage-view.test.ts`, `packages/app/src/lib/site/run-screen-view.test.ts`, `packages/app/src/lib/site/extract-view.test.ts`, `packages/app/src/lib/ops-view.test.ts`

**Interfaces:**
- Consumes: `crawl.coverage`'s `fields[].defaulted` and `defaultedItems`; `ops.website`'s `fields[].defaultValue`/`defaultOnly` (Task 4).
- Produces:
  ```ts
  export function defaultBadge(cov: FieldCoverage | undefined): string | null;   // 'default on 60' | null
  resultsSummary(rowCount, confidence, notShown?, defaulted?)
  sampleFacts(evidence, rows, extracted, notShown?, defaulted?: { count: number; fields: string[] })
  ResultsTable props: defaultedByUrl?: Map<string, Set<string>>
  export const DEFAULT_CELL_RAIL_TITLE = "this website's default";
  OpsField.defaultValue?: string; OpsField.defaultOnly?: boolean;
  export function defaultLine(field: Pick<OpsField, 'defaultValue'>): string | null;   // 'Default: Gymshark'
  export const DEFAULT_ONLY_PATHS = 'no path — every product gets the default';
  ```

- [ ] **Step 1: Failing tests** (append to each file):

`coverage-view.test.ts`:
```ts
describe('defaultBadge (spec 2026-10-13 §7)', () => {
  it('counts the values the default filled, and draws nothing on a run from before defaults', () => {
    expect(defaultBadge({ name: 'brand', filled: 60, missing: 0, confirmedAbsent: 0, total: 60, defaulted: 60 })).toBe('default on 60');
    expect(defaultBadge({ name: 'brand', filled: 60, missing: 0, confirmedAbsent: 0, total: 60, defaulted: 0 })).toBeNull();
    expect(defaultBadge({ name: 'brand', filled: 60, missing: 0, confirmedAbsent: 0, total: 60 })).toBeNull();
    expect(defaultBadge(undefined)).toBeNull();
  });
});
```

`run-screen-view.test.ts` (inside the `resultsSummary` describe):
```ts
    expect(resultsSummary(60, 100, 0, 60)).toBe("60 rows · 100% confidence · 60 values from the website's defaults");
    expect(resultsSummary(60, 100, 2, 1)).toBe("60 rows · 100% confidence · 2 values not shown on their page · 1 value from the website's defaults");
    expect(resultsSummary(60, 100, 0, 0)).toBe('60 rows · 100% confidence');
    expect(resultsSummary(60, 100, undefined, undefined)).toBe('60 rows · 100% confidence');
```

`extract-view.test.ts` (inside the `sampleFacts` describe):
```ts
  it('adds one fact for the values the website\'s defaults filled (spec 2026-10-13 §7)', () => {
    const facts = sampleFacts({ pagesWalked: 1, itemsFound: 3, warningsCount: 0, paginationNote: 'not reported' }, { complete: 3, total: 3 }, 3, undefined, { count: 3, fields: ['Brand'] });
    expect(facts.at(-1)).toEqual({ label: 'From defaults', value: "3 values from the website's defaults: Brand" });
    expect(sampleFacts({ pagesWalked: 1, itemsFound: 3, warningsCount: 0, paginationNote: 'not reported' }, { complete: 3, total: 3 }, 3, undefined, { count: 0, fields: [] }).some((f) => f.label === 'From defaults')).toBe(false);
  });
```

`ops-view.test.ts`:
```ts
describe('a website\'s default in ops (spec 2026-10-13 §7)', () => {
  it('names the default and the default-only path list', () => {
    expect(defaultLine({ defaultValue: 'Gymshark' })).toBe('Default: Gymshark');
    expect(defaultLine({})).toBeNull();
    expect(DEFAULT_ONLY_PATHS).toBe('no path — every product gets the default');
  });
});
```

- [ ] **Step 2: Run, expect failures.**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/coverage-view.test.ts src/lib/site/run-screen-view.test.ts src/lib/site/extract-view.test.ts src/lib/ops-view.test.ts`

- [ ] **Step 3: `coverage-view.ts`.** `FieldCoverage` gains `/** Values the website's default filled (spec 2026-10-13 §7). Absent on a run that predates defaults. */ defaulted?: number;`. Add:

```ts
/** The column head's third badge (spec 2026-10-13 §7): "default on 60" once the website's default filled any value; null otherwise, and on a run from before defaults. */
export function defaultBadge(cov: FieldCoverage | undefined): string | null {
  const n = cov?.defaulted ?? 0;
  return n > 0 ? `default on ${n}` : null;
}
```

- [ ] **Step 4: `run-screen-view.ts`.** `resultsSummary(rowCount, confidence, notShown?: number, defaulted?: number)`: after the not-shown clause, `if (defaulted) out += \` · ${defaulted.toLocaleString('en-US')} ${defaulted === 1 ? 'value' : 'values'} from the website's defaults\`` (restructure the function to build `out` from `base`, append each clause when its count is truthy).

- [ ] **Step 5: `results-table.tsx`.** Prop `defaultedByUrl?: Map<string, Set<string>>` (doc: per-row defaulted field keys, from `crawl.coverage`'s `defaultedItems`); `const NO_DEFAULTED_FIELDS: ReadonlySet<string> = new Set<string>();`; `export const DEFAULT_CELL_RAIL_TITLE = "this website's default";`. In the head, after the not-shown badge: `const dBadge = defaultBadge(covByKey.get(column.key));` rendered as `<span className="ml-1.5 font-mono text-xs normal-case text-muted-foreground">{dBadge}</span>` when set. In the body: `const defaulted = defaultedByUrl?.get(url) ?? NO_DEFAULTED_FIELDS;` and on the value cell `const isDefault = defaulted.has(column.key);` → className `isDefault ? 'border-l-2 border-line text-muted-foreground' : notShown ? 'border-l-2 border-warn' : ''`, title `isDefault ? DEFAULT_CELL_RAIL_TITLE : notShown ? 'not shown on the page' : undefined`. Import `defaultBadge`.

- [ ] **Step 6: The run route.** Beside `unshownByUrl`/`notShownCount`:

```ts
  const defaultedByUrl = useMemo(
    () => new Map((coverage.data?.defaultedItems ?? []).map((d) => [d.url, new Set(d.fields)] as const)),
    [coverage.data],
  );
  const defaultedCount = useMemo(() => (coverage.data?.fields ?? []).reduce((sum, f) => sum + (f.defaulted ?? 0), 0), [coverage.data]);
```

Pass `defaultedByUrl={defaultedByUrl}` and `summary={resultsSummary(rowCount, extraction?.confidence ?? null, notShownCount, defaultedCount)}`.

- [ ] **Step 7: The Sample panel.** `sampleFacts(evidence, rows, extracted, notShown?, defaulted?: { count: number; fields: string[] })`: after the not-shown fact, `if (defaulted && defaulted.count > 0) facts.push({ label: 'From defaults', value: \`${defaulted.count} ${defaulted.count === 1 ? 'value' : 'values'} from the website's defaults: ${defaulted.fields.join(', ')}\` });`. In `extract-sample.tsx`, mirror the `notShown` computation for `defaulted` (`f.defaulted ?? 0`, field names via `columns`) and pass it as the fifth argument.

- [ ] **Step 8: Ops.** `ops-view.ts`: `OpsField` gains `defaultValue?: string; defaultOnly?: boolean;`; add `export const DEFAULT_ONLY_PATHS = 'no path — every product gets the default';` and `export function defaultLine(field: Pick<OpsField, 'defaultValue'>): string | null { return field.defaultValue ? \`Default: ${field.defaultValue}\` : null; }`. In `$sourceId.tsx`'s field row: the summary span reads `hasPaths ? backupsSummary(field.paths) : field.defaultOnly ? DEFAULT_ONLY_PATHS : field.state === 'none' ? '' : 'No working path'`; the expanded block, before the ladder/no-paths branch, renders `{defaultLine(field) ? <p className="mb-2 text-sm text-muted-foreground">{defaultLine(field)}</p> : null}`; the no-paths paragraph reads `field.defaultOnly ? DEFAULT_ONLY_PATHS : field.state === 'none' ? 'Not verified yet.' : 'No path currently works.'`.

- [ ] **Step 9: Run the four files, expect PASS; then the app unit tests.**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/coverage-view.test.ts src/lib/site/run-screen-view.test.ts src/lib/site/extract-view.test.ts src/lib/ops-view.test.ts` then `pnpm --filter @robot/app exec vitest run`

- [ ] **Step 10: Commit**

```bash
git add packages/app/src/lib/site/coverage-view.ts packages/app/src/lib/site/coverage-view.test.ts packages/app/src/lib/site/run-screen-view.ts packages/app/src/lib/site/run-screen-view.test.ts packages/app/src/components/runs/results-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/runs/\$run.tsx" packages/app/src/lib/site/extract-view.ts packages/app/src/lib/site/extract-view.test.ts packages/app/src/components/extract/extract-sample.tsx packages/app/src/lib/ops-view.ts packages/app/src/lib/ops-view.test.ts "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx"
git commit -m "feat(app): defaulted values counted and marked on the run page and the Sample panel; the default and default-only fields in ops

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The route smoke and the docs

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts` (the coverage walk's Brand step; a new run-page test), `docs/handoff.md` (a new section at the top, the next-work list), `CLAUDE.md` (one Key Technical Decisions line), `docs/superpowers/specs/2026-10-13-website-defaults-design.md` (status line)
- Test: the smoke itself, `RUN_UI_SMOKE=1`, against `pnpm dev:all` that Marko runs

**Interfaces:**
- Consumes: everything above; `seedUnshownRun` (its `validationResult` type now accepts `defaulted`).

- [ ] **Step 1: The Verification tab, in the coverage walk.** Right after the existing Brand "not on this page" assertion (the typed tagline on product 1), the Brand row is expanded (Type it expanded it). Add:

```ts
    // Spec 2026-10-13 §6: a default for this website. Typed into the expanded
    // Brand row; products 2 and 3 have no Brand answer, so they read the default,
    // muted, and the row stops asking for them. Product 1 keeps its typed tagline.
    await page.getByRole('textbox', { name: 'Default Brand for this website', exact: true }).fill('Widget shop');
    const brand2 = page.locator('button[aria-label^="Brand on product 2: "]');
    await expect.poll(() => brand2.innerText(), { timeout: 20_000 }).toContain('Widget shop');
    expect(await brand2.getAttribute('title'), 'the default cell does not carry its title').toBe("This website's default; a path that reads a value here wins");
    await expect.poll(() => page.getByText('Fills every product the paths leave empty.', { exact: false }).count(), { timeout: 10_000 }).toBe(1);
    expect(await page.getByText('not on any proof page', { exact: true }).count(), 'the shop name is in every page\'s footer, so the default must not warn').toBe(0);
    await expect
      .poll(async () => ((await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! })).verificationSet as { defaults?: Record<string, string> } | null)?.defaults, { timeout: 20_000, interval: 500, message: 'the default was not saved' })
      .toEqual({ [keyOf('Brand')!]: 'Widget shop' });
    await shootViewportBothThemes(page, 'app-site-verification-default');
```

(`keyOf` as the test above it defines it; the title attribute lives on the cell's inner span — if `getAttribute('title')` on the button is null, read `brand2.locator('span').first()`.) The footer on every shop page says "Widget shop", so the warning must stay off; typing `Widget shop | We Do Widgets` instead would turn it on — assert that too, then set it back:

```ts
    await page.getByRole('textbox', { name: 'Default Brand for this website', exact: true }).fill('Widget shop | We Do Widgets');
    await expect.poll(() => page.getByText('not on any proof page', { exact: true }).count(), { timeout: 10_000 }).toBe(1);
    await page.getByRole('textbox', { name: 'Default Brand for this website', exact: true }).fill('Widget shop');
```

- [ ] **Step 2: A new run-page test** after "the run page counts, names and marks the values not shown on their page":

```ts
  // A website's default (spec 2026-10-13 §7): the run page counts and marks
  // the values the default filled. Seeded like the unshown run — three items
  // whose Brand the default filled, one of them from before the flag existed.
  it('the run page counts and marks the values the website\'s default filled', async () => {
    expect(projectSlug, 'there is no project to open a run on').not.toBeNull();
    expect(websiteSlug, 'there is no website to open a run on').not.toBeNull();
    problems.length = 0;
    const api = apiAs(await sessionCookie(context));
    const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    const keyOf = (name: string) => site.fields.find((f) => f.name === name)?.key;
    const [titleKey, priceKey, brandKey] = ['Title', 'Price', 'Brand'].map(keyOf);
    for (const [name, key] of [['Title', titleKey], ['Price', priceKey], ['Brand', brandKey]] as const) expect(key, `no key for ${name}`).toBeTruthy();
    const defaulted = { shown: { [titleKey!]: true, [priceKey!]: true, [brandKey!]: null }, paths: {}, defaulted: [brandKey!] };
    const item = (n: number, validationResult?: typeof defaulted) => ({
      url: `${SHOP}/p/${n}`,
      row: { [titleKey!]: `Widget ${n}`, [priceKey!]: 100 + n, [brandKey!]: 'Widget shop' },
      ...(validationResult ? { validationResult } : {}),
    });
    const runId = await seedUnshownRun(site.id, { items: [item(1, defaulted), item(2, defaulted), item(3)] });

    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}/runs/${runId}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');
    const main = page.locator('main');
    await expect.poll(() => main.innerText(), { timeout: 20_000 }).toContain("values from the website's defaults");
    const head = (name: string) => page.locator('thead th').filter({ hasText: new RegExp(`^${name}`) });
    expect(await head('Brand').innerText(), "Brand's column head does not count the defaulted values").toContain('default on 2');
    expect(await head('Price').innerText(), "Price's column head says default").not.toContain('default on');
    expect(await main.innerText(), 'the summary does not count the defaulted values').toContain("2 values from the website's defaults");
    expect(await page.locator(`td[title="this website's default"]`).count(), 'not exactly two cells carry the default rail').toBe(2);
    expect(await page.getByRole('heading', { name: 'Values not shown on their page', exact: true }).count(), 'a defaulted value was flagged not shown').toBe(0);
    await shoot(page, 'app-site-run-defaults.png');
    expect(problems, `the defaults run page logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 60_000);
```

Brand is on the contract by then (the coverage walk added it); Description was added by the unshown test and its column shows "—" here, which is fine.

- [ ] **Step 3: Run the smoke** (Marko's `pnpm dev:all` must be up on :3000/:4000; never start it yourself):

Run: `RUN_UI_SMOKE=1 pnpm --filter @robot/app exec vitest run src/routes-smoke.test.ts`
Expected: every test passes (24 of 24); screenshots `docs/testing/screens/app-site-verification-default-{dark,light}.png` and `app-site-run-defaults.png` written. Read the two new screenshots with the Read tool and say what they show.

- [ ] **Step 4: Docs.** `docs/handoff.md`: add a new section "A website's default values (2026-10-13)" above "Shown on the page (2026-10-12)" (spec and plan paths; what a customer gets, in the spec's §2 words; the two rules at Verify; what the run page, the coverage check, drift, ops and the judge show; how it was proven — unit counts per package, the smoke 24 of 24; what is not in it, from the spec's §11), add a "**Newest:**" paragraph for it in "Read this first" (demoting the shown-on-the-page one to "Before it"), and add to the next-work list a line "10. **A website's default values — done, 2026-10-13.**" with a one-line pointer. `CLAUDE.md`: under Key Technical Decisions, after the "Shown on the page" line, add "- A website's default values (2026-10-13): a binding carries a default per field; a run writes the certified path's value where one reads and the default where every path misses; Verify treats a blank cell on such a field as a default cell and certifies by default only, free, when nothing reads the field; defaulted values are counted on the run page, read as empty by drift and the coverage check, shown in ops and judged like any value." The spec's status line: "**Status:** implemented on `feat/website-defaults` (merged into `main` 2026-10-13), 2026-10-13; route smoke 24 of 24" plus a `**Deviations:**` list of anything the implementation changed from the spec's words.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes-smoke.test.ts docs/testing/screens/app-site-verification-default-dark.png docs/testing/screens/app-site-verification-default-light.png docs/testing/screens/app-site-run-defaults.png
git commit -m "test(app): route smoke sets a website default, reads the default cells, and counts defaulted values on a seeded run

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git add docs/handoff.md CLAUDE.md docs/superpowers/specs/2026-10-13-website-defaults-design.md
git commit -m "docs: a website's default values — handoff section, key decision, spec status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (run by the planner, 2026-10-13)

- **Spec coverage.** §3 the set, the binding rules, every-page checking, the hash → Tasks 1, 3. §4 default cells, must-read-something, weak-field precedence, default only, no AI, cells, `allPassed`/`currentKeys` → Tasks 1, 3. §5 `Certification.defaults`, `VerifiedField.defaultValue`, `applyDefaults`, stats untouched, `shown` null, readiness with the all-defaulted exception, variant rows, `validation_result.defaulted`, confidence, drift, the coverage check → Tasks 2, 3. §6 the input and its warning, "Make it the default", cells, `rowStatus`, `verifyGate`, no "Not on this product" on the field, the default-only row word, the coverage row lines → Task 5. §7 the run page badge/rail/summary, the Sample panel, ops, the judge → Tasks 4, 6. §8 copy → Global Constraints, verbatim in each task. §9 properties 1–9 → named in the tests. §10 unit/smoke/live: the live check on Gymshark is NOT in this plan — it needs the credit campaign's org and Marko's servers; the controller runs it after the merge, as the previous plans did (`docs/testing/results/2026-10-13-website-defaults-live-check.md`), and that is the one spec point left out.
- **Placeholders.** None; every code step carries its code. Two tests name a constant the implementer must read off the file (`REPORT_BASE` in Task 4 Step 3, `certifiedWebsite`'s return in Task 3 Step 5); both say what to assert.
- **Type consistency.** `defaultValue` (scraper `VerifiedField`, `CertifyInput`), `defaults` (set, binding, `Certification`, `Board`), `defaulted` (`VerifiedExtractionResult`, `ValidationResult`, `FieldCoverage`, `defaultedItems`), `defaultOnly` (`FieldVerification`, ops field, app `VerificationResultsLike`) are the same names in every task. `applyDefaults(row, fields)` and `renderDefault(type, value)` as declared in Task 2 are what Task 3 calls. `coverageLine`'s fourth argument is an options object in Task 5 and the route.
- **Review Focus.** 1 → Task 1 "whatever its spaces and case" + Task 3 "trimmed, non-empty"; 2 → Task 2 `renderDefault`/`applyDefaults`; 3 → Task 2 "with only defaulted fields"; 4 → Task 4 item `c` with no `validationResult`, Task 6 `undefined` cases, Task 3 `blankDefaulted` with no keys; 5 → Task 5 `defaultNotShown` and the `verifyGate` test.
