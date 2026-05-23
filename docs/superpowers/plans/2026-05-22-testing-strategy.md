# Testing & Extraction-Quality Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-tier extraction-quality harness — a deterministic fixture-replay gate (Tier 1, runs on every change, no LLM/network) and an on-demand live dogfood CLI with an LLM-as-judge (Tier 2) — plus the docs and corpus that anchor them.

**Architecture:** Tier 1 lives in `packages/scraper/src/__fixtures__/`: a JSON fixture format per real page, a `runFixtureReplay` helper that runs the deterministic chain (mechanical → cached API paths → cached XPaths via Playwright `setContent` → `resolveFromCache` cross-validation) and asserts golden expected values. Tier 2 lives in `packages/api/src/dogfood.ts`: a CLI that calls the real `extract` procedure via `createCallerFactory` against a `manifest.ts` of live URLs, calls a new `judgeFieldExtraction` (in `@robot/agent`) per resolved field, and writes a timestamped Markdown report under `docs/testing/results/`. `pnpm -r test` becomes the green gate.

**Tech Stack:** TypeScript, Vitest, Playwright (`setContent` offline), tRPC v11, Drizzle, Anthropic SDK, ESM with `.js` import extensions on `.ts` files.

**Spec:** `docs/superpowers/specs/2026-05-22-testing-strategy-design.md`.

**Commit convention:** user commits manually; each task ends with a suggested message — do not run `git commit` unless asked. Stage only the listed files (never `git add -A`).

---

## File Structure

**P1 — foundation gate**
- Modify: `packages/agent/package.json`, `packages/dashboard/package.json` — `vitest --passWithNoTests`.
- Create: `packages/scraper/src/__fixtures__/types.ts` — `Fixture` type.
- Create: `packages/scraper/src/__fixtures__/load.ts` — `loadFixture` / `listFixtures`.
- Modify: `packages/browser/src/playwright-browser.ts` — add `setContentEvaluate` method.
- Modify: `packages/browser/src/types.ts` — extend `IBrowser` interface.
- Create: `packages/scraper/src/__fixtures__/replay.ts` — `runFixtureReplay(fixture)`.
- Create: `packages/scraper/src/capture-fixture.ts` — CLI to capture a real page into a fixture.
- Create: `packages/scraper/src/__fixtures__/corpus/amazon-godiva-detail.json` — first seed fixture.
- Create: `packages/scraper/src/__fixtures__/corpus.test.ts` — vitest harness that loops the corpus.
- Create: `docs/testing.md` — strategy + how-to-add-fixture.
- Modify: `docs/roadmap.md` — "Testing & Quality Harness" entry.

**P2 — live dogfood + judge**
- Create: `packages/scraper/src/__fixtures__/corpus/manifest.ts` — `liveCorpus[]`.
- Create: `packages/agent/src/judge.ts` — `judgeFieldExtraction(...)`.
- Modify: `packages/agent/src/index.ts` — re-export `judgeFieldExtraction`.
- Create: `packages/api/src/dogfood.ts` — CLI harness.
- Modify: `packages/api/package.json` — `"dogfood"` script.
- Create: `docs/testing/results/.gitkeep` — keep the dir.

**P3 — corpus growth**
- Create: `packages/scraper/src/__fixtures__/corpus/nike-air-jordan-detail.json`.
- Create: `packages/scraper/src/__fixtures__/corpus/ikea-pillow-detail.json` (or whichever IKEA URL is reachable).

Dashboard smoke E2E is deferred to a follow-up (recorded in the spec as out-of-scope-for-this-plan).

---

# Phase P1 — Foundation gate

### Task P1.1: Unblock the workspace gate

**Files:** `packages/agent/package.json`, `packages/dashboard/package.json`

- [ ] **Step 1: Edit both packages' `test` script** from `"vitest"` to:

```json
"test": "vitest --passWithNoTests"
```

(Both packages currently have a `test` script but no test files, which makes `vitest` exit 1 and breaks `pnpm -r test`. `--passWithNoTests` is the official escape hatch.)

- [ ] **Step 2: Verify.**

Run: `pnpm -r test`
Expected: exit 0; every package either runs its tests successfully or reports "No test files found" but passes.

- [ ] **Step 3: Suggested commit:** `chore: pass --passWithNoTests on agent/dashboard so pnpm -r test is a real gate`

### Task P1.2: Fixture type + loader

**Files:** Create `packages/scraper/src/__fixtures__/types.ts`, `packages/scraper/src/__fixtures__/load.ts`

- [ ] **Step 1: Create the type.**

```typescript
// packages/scraper/src/__fixtures__/types.ts
import type { InterceptedRequest, StructuredData } from '@robot/browser';
import type { FieldPathSet } from '../domain-cache.js';

export type Fixture = {
  label: string;
  url: string;
  domain: string;
  pageType: 'detail' | 'listing';
  capturedAt: string;
  html: string;
  structuredData: StructuredData;
  interceptedRequests: InterceptedRequest[];
  fieldPaths: Record<string, FieldPathSet>;
  /** Golden expected values per field; `null` = legitimately not on the page. */
  expected: Record<string, unknown>;
};
```

- [ ] **Step 2: Create the loader.**

```typescript
// packages/scraper/src/__fixtures__/load.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { Fixture } from './types.js';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'corpus');

export function loadFixture(label: string): Fixture {
  const path = join(CORPUS_DIR, `${label}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Fixture;
}

export function listFixtures(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}
```

- [ ] **Step 3: Make sure the corpus directory exists** (will be empty until P1.5 lands a fixture). Create `packages/scraper/src/__fixtures__/corpus/.gitkeep` so git tracks the empty dir.

- [ ] **Step 4: Typecheck.**

Run: `pnpm --filter @robot/scraper exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Suggested commit:** `feat(scraper): fixture format + loader for the extraction regression corpus`

### Task P1.3a: `setContentEvaluate` on the browser

**Files:** Modify `packages/browser/src/types.ts`, `packages/browser/src/playwright-browser.ts`

We add a method that loads given HTML *offline* (no network) into a real Chromium page and evaluates a JS expression — this is what gives Tier 1 its prod-fidelity XPath replay.

- [ ] **Step 1: Add to the `IBrowser` interface** in `types.ts` (after the existing `evaluate` method):

```typescript
  setContentEvaluate<T = unknown>(html: string, script: string): Promise<T>;
```

- [ ] **Step 2: Implement on `PlaywrightBrowser`** (`playwright-browser.ts`). Add this method to the class (anywhere alongside `evaluate`):

```typescript
  async setContentEvaluate<T = unknown>(html: string, script: string): Promise<T> {
    if (!this.browser) throw new Error('Browser not launched. Call launch() first.');
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      // Playwright evaluates a string as a JS expression — the script is an IIFE.
      const result = await page.evaluate(script);
      return result as T;
    } finally {
      await context.close();
    }
  }
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm --filter @robot/browser exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Suggested commit:** `feat(browser): setContentEvaluate — offline page.setContent + page.evaluate for fixture replay`

### Task P1.3b: `runFixtureReplay` helper

**Files:** Create `packages/scraper/src/__fixtures__/replay.ts`

This is the load-bearing piece: it runs the deterministic chain against a fixture exactly the way `extract` runs against a live page, but without any LLM call and with the captured HTML served via `setContentEvaluate`.

- [ ] **Step 1: Create the helper.**

```typescript
// packages/scraper/src/__fixtures__/replay.ts
import { PlaywrightBrowser } from '@robot/browser';
import type { SchemaField } from '@robot/agent';
import { extractFromStructuredData } from '../structured-extractor.js';
import {
  resolveApiPathsFromCache,
  resolveFromCache,
  buildCachedXPathScript,
} from '../domain-cache.js';
import { validateFieldShape } from '../shape-validator.js';
import type { Fixture } from './types.js';

export type ReplayResult = {
  resolved: Record<string, unknown>;
  sources: Record<string, string>;
};

export async function runFixtureReplay(fixture: Fixture): Promise<ReplayResult> {
  const fieldNames = Object.keys(fixture.expected);
  const fields: SchemaField[] = fieldNames.map((name) => ({
    name, type: 'string', description: '', required: true, tier: 'discovered',
  }));

  const finalData: Record<string, unknown> = {};
  const sources: Record<string, string> = {};

  function tryAssign(name: string, value: unknown, source: string): boolean {
    if (finalData[name] !== undefined) return false;
    if (value === undefined || value === null || value === '') return false;
    const field = fields.find((f) => f.name === name);
    const v = validateFieldShape(value, field?.type ?? 'string', { fieldName: name });
    if (!v.ok) return false;
    finalData[name] = v.normalized;
    sources[name] = source;
    return true;
  }

  // 1. Mechanical / structured-data flattening
  const fieldsWithHints = fields.map((f) => ({
    name: f.name, type: f.type, description: f.description,
    sourceHint: undefined as 'api' | 'json-ld' | 'meta' | 'page' | undefined,
  }));
  const mech = extractFromStructuredData(fixture.structuredData, fieldsWithHints, fixture.interceptedRequests);
  for (const [name, val] of Object.entries(mech.data)) {
    tryAssign(name, val, mech.sources[name] ?? 'mechanical');
  }

  // 2. Cached API dot-paths against intercepted JSON
  const apiRes = resolveApiPathsFromCache(fixture.fieldPaths, fixture.interceptedRequests, fieldNames);
  for (const [n, r] of Object.entries(apiRes.resolved)) tryAssign(n, r.value, r.source);

  // 3. Cached XPaths replayed offline via setContent + the prod Chromium engine
  const stillMissing = fieldNames.filter((n) => finalData[n] === undefined);
  const cachedScript = buildCachedXPathScript(fixture.fieldPaths, stillMissing);
  if (cachedScript) {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
        fixture.html, cachedScript.script,
      );
      if (result.data.length > 0) {
        for (const [n, v] of Object.entries(result.data[0])) tryAssign(n, v, 'xpath-cached');
      }
    } finally {
      await browser.close();
    }
  }

  // 4. resolveFromCache cross-validation over whatever we've gathered
  const cr = resolveFromCache(fixture.fieldPaths, finalData, fieldNames);
  for (const [n, r] of Object.entries(cr.resolved)) {
    if (finalData[n] === undefined) tryAssign(n, r.value, r.source);
  }

  return { resolved: finalData, sources };
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @robot/scraper exec tsc --noEmit`
Expected: PASS. If any imported function signature doesn't match what's used above (e.g. `extractFromStructuredData` expects different field shape), read the actual signature in `packages/scraper/src/structured-extractor.ts` and adjust the local mapping — don't change the helper's API. If a mismatch is structural, STOP and report.

- [ ] **Step 3: Suggested commit:** `feat(scraper): runFixtureReplay — deterministic extraction replay over a fixture`

### Task P1.4: `capture-fixture` CLI

**Files:** Create `packages/scraper/src/capture-fixture.ts`

A one-shot CLI: capture a real URL via Playwright, look up the current cache, write a fixture JSON ready for golden expectations.

- [ ] **Step 1: Create the script.**

```typescript
// packages/scraper/src/capture-fixture.ts
// Usage: pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts <url> <label> [detail|listing]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Load repo-root .env so DATABASE_URL etc. are available.
try {
  const env = readFileSync('/Users/marko/Documents/robot-platform/.env', 'utf-8');
  for (const line of env.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i === -1) continue;
    const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
} catch {}

const url = process.argv[2];
const label = process.argv[3];
const pageType = (process.argv[4] ?? 'detail') as 'detail' | 'listing';
if (!url || !label) {
  console.error('usage: capture-fixture <url> <label> [detail|listing]');
  process.exit(1);
}

const { PlaywrightBrowser } = await import('@robot/browser');
const { lookupDomainCache } = await import('./domain-cache.js');

const domain = new URL(url).hostname;
const browser = new PlaywrightBrowser();
await browser.launch({ headless: true });
let capture;
try {
  capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
} finally {
  await browser.close();
}

const cache = await lookupDomainCache(domain, pageType);
const fixture = {
  label, url, domain, pageType,
  capturedAt: new Date().toISOString(),
  html: capture.html,
  structuredData: capture.structuredData,
  // Keep only intercepted requests that carry a parsed JSON body — those are what cached API paths replay against.
  interceptedRequests: capture.interceptedRequests.filter((r) => r.responseBody && r.parsedJson),
  fieldPaths: cache?.fieldPaths ?? {},
  expected: {} as Record<string, unknown>,
};

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/corpus',
  `${label}.json`,
);
writeFileSync(out, JSON.stringify(fixture, null, 2));
console.log(`wrote ${out}`);
console.log(`Next: open the file and fill in the "expected" map with the known-correct values for the fields you want to gate on.`);
process.exit(0);
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @robot/scraper exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Suggested commit:** `feat(scraper): capture-fixture CLI writes a Fixture JSON from a live URL`

### Task P1.5: Seed the Amazon Godiva fixture

**Files:** Create `packages/scraper/src/__fixtures__/corpus/amazon-godiva-detail.json`

- [ ] **Step 1: Capture.**

Run: `pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts "https://www.amazon.com/Godiva-Assorted-Chocolate-Chocolates-Pralin%C3%A9s/dp/B0GN4GHMH7/" amazon-godiva-detail detail`
Expected: `wrote .../corpus/amazon-godiva-detail.json`. (Network + Playwright; needs the DB up for the cache lookup. If the cache row is empty/missing, `fieldPaths` defaults to `{}` and Tier-1 cached-path assertions will be near-empty — capture against a domain whose cache is populated.)

- [ ] **Step 2: Fill in the golden `expected` map** by hand-editing the fixture JSON. Use the known-good values from prior dogfooding (we already know what's correct on this page):

```jsonc
"expected": {
  "brand": "Visit the Godiva Chocolatier Store",
  "rating": 4.15,
  "review_count": 27,
  "size_options": "30 Pieces",
  "product_name": "Godiva Gold Assorted Chocolate Gift Box, Belgian Dark & Milk Chocolates with Pralinés, Ganaches & Caramels, Gourmet Gift for Mother's Day, Kosher, Iris Ribbon, 30 Pc",
  "image_url": "https://m.media-amazon.com/images/I/71ha8omWoBL._SX569_.jpg",
  "best_sellers_rank": "#44,742 in Grocery & Gourmet Food",
  "upc": null,
  "asin": null,
  "price": null,
  "weight": null
}
```

(Use `null` for fields that are legitimately not on the page or that we know the cache can't reach — Tier 1 will then assert they remain unresolved. Adjust to match whatever the live capture actually returns; small string mismatches between captures and goldens are normal and you'll iterate the goldens once the test runs.)

- [ ] **Step 3: Suggested commit:** `test(scraper): seed amazon-godiva-detail fixture with golden expected values`

### Task P1.6: Vitest harness over the corpus

**Files:** Create `packages/scraper/src/__fixtures__/corpus.test.ts`

- [ ] **Step 1: Create the harness.**

```typescript
// packages/scraper/src/__fixtures__/corpus.test.ts
import { describe, it, expect } from 'vitest';
import { listFixtures, loadFixture } from './load.js';
import { runFixtureReplay } from './replay.js';

describe('extraction fixture corpus (Tier 1 deterministic gate)', () => {
  const labels = listFixtures();
  if (labels.length === 0) {
    it.skip('no fixtures yet — add one with capture-fixture', () => {});
    return;
  }

  for (const label of labels) {
    it(`replays ${label} to its golden expected values`, async () => {
      const fixture = loadFixture(label);
      const result = await runFixtureReplay(fixture);
      for (const [field, expected] of Object.entries(fixture.expected)) {
        if (expected === null) {
          expect(result.resolved[field]).toBeUndefined();
        } else {
          expect(result.resolved[field]).toEqual(expected);
        }
      }
    }, 30_000);
  }
});
```

- [ ] **Step 2: Run it.**

Run: `pnpm --filter @robot/scraper test corpus`
Expected: PASS — the Amazon Godiva fixture replay matches the goldens you wrote. If a golden mismatches the replay, **first** look at what the replay actually returned and decide whether the golden is wrong (the page changed since you wrote it, or the cached path doesn't actually return that exact text) or the replay is wrong (a real regression). Update the golden to match reality only if the replay's value is the genuinely-correct one.

- [ ] **Step 3: Workspace-wide check.**

Run: `pnpm -r test`
Expected: every package green, including the new fixture test.

- [ ] **Step 4: Suggested commit:** `test(scraper): vitest harness loops the fixture corpus`

### Task P1.7: `docs/testing.md`

**Files:** Create `docs/testing.md`

- [ ] **Step 1: Write the file.**

````markdown
# Testing

Two tiers + three channels (CLI / agent / web). The whole strategy is in `docs/superpowers/specs/2026-05-22-testing-strategy-design.md`; this file is the *how-to*.

## Tier 1 — Deterministic fixture-replay gate

Runs on every change. No LLM, no network, no flakes. Replays each fixture's deterministic chain (mechanical → cached API paths → cached XPaths via Playwright `setContent` → cross-validation) and asserts golden values.

**Run it:** `pnpm -r test` (or `pnpm --filter @robot/scraper test corpus`).

**Add a fixture (one real page → one regression-protected test):**

```bash
pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts \
  "<the URL>" <label> [detail|listing]
```

That writes `packages/scraper/src/__fixtures__/corpus/<label>.json` with a real capture, the current cache's `fieldPaths`, and an empty `expected`. Open the file, fill `expected` with the known-correct values for the fields you want to gate (use `null` for fields legitimately absent from the page). Re-run `pnpm --filter @robot/scraper test corpus` and iterate goldens until green. Commit the fixture.

**When a fixture starts failing, do this in order:**
1. Look at the actual replayed value — did the page change? Did our code change? `git log` the diff that broke it.
2. If our code regressed: that's the bug. Fix it; the fixture stays.
3. If the page changed (selectors no longer match the same text): re-capture and update the goldens.
4. Never update the goldens to silence a real regression.

## Tier 2 — Live dogfood with LLM-as-judge

Runs on demand. The full real pipeline against a corpus of live URLs, plus an LLM-judge that scores each resolved field (`correct` / `wrong` / `not-on-page`). Writes a timestamped Markdown report to `docs/testing/results/`.

**Run it:** `pnpm --filter @robot/api dogfood` (set `ANTHROPIC_API_KEY`; needs the DB up; uses real Claude calls — costs ~a few cents per run).

**Add a live URL:** append an entry to `packages/scraper/src/__fixtures__/corpus/manifest.ts`. Include `knownAbsentFields` for fields the page legitimately doesn't expose (so they're counted as "absent" not "miss").

**Read a report:** the `[wrong]` flags are the high-signal output — they're the wrong-but-non-null cases (the cached `diet_type` = product title pattern). Resolution rate is just the headline; the per-field judge column is where the truth lives.

## Web channel

A dashboard smoke E2E is on the backlog (single test that drives `sandbox → analyze → extract → results render`). Deferred until a real UI behaviour actively regresses.

## CI

There's no remote yet, so "CI" is `pnpm -r test` run locally. When a remote is wired, the Tier 1 gate is the obvious thing to run on push.
````

- [ ] **Step 2: Suggested commit:** `docs(testing): how-to for Tier 1 fixture-replay gate (Tier 2 + web added in later phases)`

### Task P1.8: Roadmap entry

**Files:** Modify `docs/roadmap.md`

- [ ] **Step 1: Add a cross-cutting "Testing & Quality Harness" section.** Insert it after the existing `## Track interactions` section (so it's clearly cross-cutting), with this content:

```markdown
---

## Testing & Quality Harness (IN PROGRESS)

Spec: `docs/superpowers/specs/2026-05-22-testing-strategy-design.md`. Plan: `docs/superpowers/plans/2026-05-22-testing-strategy.md`. Strategy + how-to: `docs/testing.md`.

- [x] **P1 — Deterministic fixture-replay gate.** Tier 1 harness (`packages/scraper/src/__fixtures__/`), `setContentEvaluate` on the browser, first seed fixture (Amazon Godiva), `pnpm -r test` is a real green gate.
- [ ] **P2 — Live dogfood + LLM-judge.** CLI in `packages/api/src/dogfood.ts`, `liveCorpus` manifest, per-run Markdown reports under `docs/testing/results/`.
- [ ] **P3 — Corpus growth.** Add Nike + IKEA fixtures.

(Dashboard smoke E2E is a separate follow-up, not part of this initiative.)
```

(Adjust the `[x]`/`[ ]` checkboxes as phases ship.)

- [ ] **Step 2: Suggested commit:** `docs(roadmap): record Testing & Quality Harness initiative; P1 done`

---

# Phase P2 — Live dogfood + LLM-judge

### Task P2.1: `liveCorpus` manifest

**Files:** Create `packages/scraper/src/__fixtures__/corpus/manifest.ts`

- [ ] **Step 1: Create the manifest.**

```typescript
// packages/scraper/src/__fixtures__/corpus/manifest.ts
export type LiveCorpusEntry = {
  label: string;
  url: string;
  pageType: 'detail' | 'listing';
  /** Field names to request. Use ['discover'] to let analyze propose. */
  fields: string[];
  /** Fields we expect to NOT be on this page — counted as "absent" in reports, not "miss". */
  knownAbsentFields?: string[];
};

export const liveCorpus: LiveCorpusEntry[] = [
  {
    label: 'amazon-godiva',
    url: 'https://www.amazon.com/Godiva-Assorted-Chocolate-Chocolates-Pralin%C3%A9s/dp/B0GN4GHMH7/',
    pageType: 'detail',
    fields: ['discover'],
    knownAbsentFields: ['upc'],
  },
];
```

- [ ] **Step 2: Suggested commit:** `feat(scraper): liveCorpus manifest for Tier 2 dogfood`

### Task P2.2: `judgeFieldExtraction`

**Files:** Create `packages/agent/src/judge.ts`, modify `packages/agent/src/index.ts`

- [ ] **Step 1: Create the judge.**

```typescript
// packages/agent/src/judge.ts
import Anthropic from '@anthropic-ai/sdk';

export type JudgeVerdict = 'correct' | 'wrong' | 'not-on-page' | 'error';

const SYSTEM = `You judge whether an extracted field value is correct on a webpage. You are shown a screenshot of the page, the field name, and the extracted value. Reply with EXACTLY one word: "correct" (the value is right), "wrong" (a value is visible on the page for this field but it's different from what was extracted), or "not-on-page" (the value the field would have is not visible on the page at all). No explanation.`;

export async function judgeFieldExtraction(opts: {
  screenshot: Buffer;
  field: string;
  value: unknown;
  apiKey: string;
  model?: string;
}): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const res = await client.messages.create({
      model: opts.model ?? 'claude-sonnet-4-20250514',
      max_tokens: 16,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: `Field: ${opts.field}\nExtracted value: ${JSON.stringify(opts.value)}` },
        ],
      }],
    });
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return 'error';
    const t = text.text.trim().toLowerCase();
    if (t.startsWith('correct')) return 'correct';
    if (t.startsWith('wrong')) return 'wrong';
    if (t.startsWith('not')) return 'not-on-page';
    return 'error';
  } catch (err) {
    console.error('[judge] error:', err);
    return 'error';
  }
}
```

- [ ] **Step 2: Re-export from `@robot/agent`.** Append to `packages/agent/src/index.ts`:

```typescript
export { judgeFieldExtraction, type JudgeVerdict } from './judge.js';
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm --filter @robot/agent exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Suggested commit:** `feat(agent): judgeFieldExtraction — LLM-as-judge for Tier 2 dogfood`

### Task P2.3: Dogfood CLI

**Files:** Create `packages/api/src/dogfood.ts`, modify `packages/api/package.json`

- [ ] **Step 1: Create the CLI.**

```typescript
// packages/api/src/dogfood.ts
// Usage: pnpm --filter @robot/api dogfood
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

try {
  const env = readFileSync('/Users/marko/Documents/robot-platform/.env', 'utf-8');
  for (const line of env.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i === -1) continue;
    const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
} catch {}
process.env.CAPTURES_DIR ??= '/tmp/dogfood-captures';

const { db } = await import('@robot/db');
const { scraperRouter } = await import('./routers/scraper.js');
const { judgeFieldExtraction } = await import('@robot/agent');
const { liveCorpus } = await import('@robot/scraper/src/__fixtures__/corpus/manifest.js' as string);

const caller = scraperRouter.createCaller({ db } as never);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const lines: string[] = [`# Dogfood ${stamp}`, ''];

let totalResolved = 0, totalWrong = 0, totalNotOnPage = 0, totalAbsent = 0, totalFields = 0;

for (const site of liveCorpus) {
  lines.push(`## ${site.label} — ${site.url}`, '');

  const analysis = await caller.analyze({ url: site.url });
  const fields = (analysis.schema.fields as Array<{ name: string; type: string; description?: string; tier?: string; example_value?: string }>)
    .map((f) => ({ name: f.name, type: f.type, description: f.description, tier: f.tier, example_value: f.example_value }));

  const result = await caller.extract({ url: site.url, fields, pageType: site.pageType });

  // Screenshot for the judge — extract just wrote one to CAPTURES_DIR (via the cache-miss path or analyze cache-hit).
  // The captureId returned by analyze is the filename stem; if extract recapped, use the one analyze persisted.
  const screenshotPath = analysis.screenshotUrl
    ? join(process.env.CAPTURES_DIR!, analysis.screenshotUrl.replace(/^\/captures\//, ''))
    : null;
  const screenshot = screenshotPath ? readFileSync(screenshotPath) : null;

  lines.push(`Resolved: ${result.fieldCount.found}/${result.fieldCount.total} (${Math.round(result.confidence * 100)}%)`, '');
  totalFields += result.fieldCount.total;

  const rows = [...result.fieldsByTier.requested, ...result.fieldsByTier.discovered];
  for (const row of rows) {
    if (row.value == null) {
      const absent = site.knownAbsentFields?.includes(row.name) ?? false;
      lines.push(`- [${absent ? 'absent' : 'miss'}] ${row.name}: —`);
      if (absent) totalAbsent++;
      continue;
    }
    totalResolved++;
    const verdict = screenshot
      ? await judgeFieldExtraction({ screenshot, field: row.name, value: row.value, apiKey })
      : 'error' as const;
    if (verdict === 'wrong') totalWrong++;
    if (verdict === 'not-on-page') totalNotOnPage++;
    const valStr = String(JSON.stringify(row.value)).slice(0, 100);
    lines.push(`- [${verdict}] ${row.name}: ${valStr} (src=${row.source})`);
  }
  lines.push('');
}

lines.push('## Aggregate', '');
lines.push(`- Total fields requested: ${totalFields}`);
lines.push(`- Resolved: ${totalResolved}`);
lines.push(`- Resolved but wrong: ${totalWrong}`);
lines.push(`- Resolved but not on page: ${totalNotOnPage}`);
lines.push(`- Legitimately absent: ${totalAbsent}`);

const outDir = '/Users/marko/Documents/robot-platform/docs/testing/results';
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${stamp}-dogfood.md`);
writeFileSync(outPath, lines.join('\n'));
console.log(`wrote ${outPath}`);
process.exit(0);
```

- [ ] **Step 2: Add the `dogfood` script.** In `packages/api/package.json`'s `scripts`:

```json
"dogfood": "tsx src/dogfood.ts"
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm --filter @robot/api exec tsc --noEmit`
Expected: PASS. If the workspace import `@robot/scraper/src/__fixtures__/corpus/manifest.js` doesn't resolve (depends on the `@robot/scraper` package's `exports` field), instead add a re-export to `packages/scraper/src/index.ts`: `export { liveCorpus, type LiveCorpusEntry } from './__fixtures__/corpus/manifest.js';` and import via `@robot/scraper`. Note that adjustment in the commit message.

- [ ] **Step 4: Smoke run** (real Claude calls; needs DB up):

Run: `pnpm --filter @robot/api dogfood`
Expected: writes `docs/testing/results/<timestamp>-dogfood.md` and exits 0. Open the file and confirm rows look right (resolved counts, judge verdicts).

- [ ] **Step 5: Suggested commit:** `feat(api): dogfood CLI — live extraction + LLM-judge + Markdown report`

### Task P2.4: Keep the results dir + record the run

**Files:** Create `docs/testing/results/.gitkeep`; commit the first report produced by P2.3 step 4

- [ ] **Step 1: Create the placeholder.**

```bash
mkdir -p docs/testing/results && touch docs/testing/results/.gitkeep
```

- [ ] **Step 2: Suggested commit:** `docs(testing): seed results dir with the first dogfood report`

(Stage the `.gitkeep` *and* the timestamped Markdown report from P2.3.)

---

# Phase P3 — Corpus growth

### Task P3.1: Nike fixture

**Files:** Create `packages/scraper/src/__fixtures__/corpus/nike-air-jordan-detail.json`

- [ ] **Step 1: Capture.**

Run: `pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts "https://www.nike.com/t/air-jordan-12-retro-mens-shoes-pz28oX9z/CT8013-003" nike-air-jordan-detail detail`
Expected: `wrote .../nike-air-jordan-detail.json`.

- [ ] **Step 2: Fill `expected`** with known-good values from the Nike `nextData` (which we know reaches the AI cleanly post-v1.1b). Include at minimum:

```jsonc
"expected": {
  "product_name": "Air Jordan 12 Retro",
  "color": "Black/Varsity Red",
  "brand": "Jordan"
}
```

(Adjust per what the live capture's cache actually resolves; missing fields can stay out of `expected` until you want to gate on them.)

- [ ] **Step 3: Verify the harness picks it up.**

Run: `pnpm --filter @robot/scraper test corpus`
Expected: PASS for both fixtures.

- [ ] **Step 4: Suggested commit:** `test(scraper): nike-air-jordan-detail fixture`

### Task P3.2: IKEA fixture

**Files:** Create `packages/scraper/src/__fixtures__/corpus/<ikea-label>-detail.json`

- [ ] **Step 1: Pick a reachable IKEA product URL** (one whose `domainIntelligence` row has cached `fieldPaths` — check via the `/domains` view). If we don't have one cached, skip this task and revisit after the next IKEA extraction.

- [ ] **Step 2: Capture + fill expected** following the same pattern as P3.1.

- [ ] **Step 3: Suggested commit:** `test(scraper): ikea fixture`

### Task P3.3: Update roadmap

**Files:** Modify `docs/roadmap.md`

- [ ] **Step 1:** flip the `[ ]` checkboxes for P2 and P3 to `[x]` in the "Testing & Quality Harness" section once both phases ship.

- [ ] **Step 2: Suggested commit:** `docs(roadmap): P2 + P3 of Testing & Quality Harness done`

---

## End-of-initiative verification

- [ ] `pnpm -r test` is green across the workspace (Tier 1 included).
- [ ] `pnpm --filter @robot/api dogfood` writes a fresh report under `docs/testing/results/` with at least one site judged.
- [ ] Adding a new fixture (`capture-fixture` → fill goldens → commit) takes under 10 minutes.
- [ ] A deliberate regression (e.g. break a cached path in `domain-cache.ts`) turns a fixture test red — proving the gate has teeth.

---

## Self-Review Notes

- **Spec coverage:** Tier 1 → P1 tasks 1–6 (gate hygiene, fixture format/loader, setContentEvaluate, replay helper, capture CLI, first fixture, vitest harness). Docs → P1.7. Roadmap → P1.8. Tier 2 → P2 (manifest, judge, CLI, results dir). Corpus growth → P3. Dashboard smoke E2E is recorded as out-of-scope-for-this-plan (mentioned in `docs/testing.md` and the roadmap entry).
- **No placeholders:** every step contains runnable code or an exact edit.
- **Type consistency:** `Fixture` (P1.2) is consumed verbatim by `runFixtureReplay` (P1.3b), `capture-fixture` (P1.4), and the vitest harness (P1.6). `JudgeVerdict` (P2.2) is the return of the judge call in `dogfood.ts` (P2.3). `LiveCorpusEntry` (P2.1) is the type of the iterable in `dogfood.ts`.
- **TDD vs evidence:** the load-bearing replay helper is verified by running the seeded fixture (real-data integration); the judge is verified by the smoke dogfood run; the strategy is in the spec. No fake unit tests around LLM calls.
- **YAGNI:** no recorded LLM cassettes, no full dashboard E2E coverage, no per-PR CI service (no remote yet) — all explicitly deferred.
