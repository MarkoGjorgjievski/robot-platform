# Customer copy: capture failures and the page limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer never reads a host, an HTTP code, a wall vendor or "budget": capture-failure sentences are mapped to customer words at display time (staff keep the stored detail), and "budget" becomes "page limit" in customer copy.

**Architecture:** Stored texts (verdict sentences in runs, run items, captures, verifications, drift checks) do not change — drift and the run diagnosis read them. One pure mapper, `captureWords(text, staff)` in `packages/app/src/lib/capture-words.ts`, rewrites a stored capture text into its customer sentence; every customer screen that shows one passes it through, with `staff = showsMoney(session)`. "Budget" is reworded in four customer strings and one staff-activity summary (new rows written, old rows mapped at display).

**Tech Stack:** TypeScript (ESM), React 19 + TanStack Router (`@robot/app`), vitest, the TypeScript compiler API (copy sweep test).

**Spec:** `docs/superpowers/specs/2026-10-21-customer-copy-design.md`

## Global Constraints

- ESM everywhere; `.js` suffix on relative imports in scraper/api/browser, none in app.
- `@robot/app` imports only `@robot/scraper/normalize` from scraper and nothing from `@robot/api`; it gains no `@robot/browser` dependency (the capture-words test reads `packages/browser/src/verdict-copy.ts` by relative path — test only).
- Stored capture texts never change; `packages/browser/src/verdict-copy.ts` changes by one comment only.
- Staff detail = `showsMoney(session)` (`packages/app/src/lib/money-visibility.ts`): `captureWords(text, true) === text`. Ops screens are not touched.
- Customer copy never names internals (host, URL, HTTP status, vendor, "CAPTCHA", "browser", "proxy", "budget") or money.
- Tests per package, never `pnpm -r test`; api/scraper serially: `npx vitest run --no-file-parallelism`.
- Commits by explicit path, never `git add -A`, never stage `packages/app/src/routeTree.gen.ts`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never start, stop or restart Marko's dev servers (:3000/:4000).
- Code identifiers containing `budget` stay.

## Review Focus

1. A stored sentence for a host that is `localhost:4321` or a raw unparseable URL (verdict-copy falls back to the whole URL as `{host}`) — must still map, not fall to the generic sentence. Pinned in Task 1 (`HOSTS` includes both).
2. The backoff answer ("… Waiting 2 min before trying again.") and "Not tried: …" — the wrapper must survive and the inner sentence still map. Pinned in Task 1.
3. A non-capture text on the same surfaces (an extraction error in our own words, "stalled", `BROWSER_UNAVAILABLE`) — must pass through unchanged, not become the generic sentence. Pinned in Task 1.
4. A staff session inside a customer org must still read the stored detail on the run page and the Verification tab. Pinned in Task 2 (`staff: true` cases in each helper test).
5. A staff-activity row stored before this change ("(budget 50 products)") must read "(up to 50 products)" in the customer's Settings. Pinned in Task 3.

---

### Task 1: The mapper — `captureWords`

**Files:**
- Create: `packages/app/src/lib/capture-words.ts`
- Create: `packages/app/src/lib/use-staff-detail.ts`
- Create: `packages/app/src/lib/capture-words.test.ts`
- Modify: `packages/browser/src/verdict-copy.ts` (comment above `verdictSentence` only)

**Interfaces:**
- Produces: `captureWords(text: string, staff?: boolean, fallback?: string): string`; `PAGE_NOT_READ_SENTENCE: string`; `BLOCKED_SENTENCE: string`; `useStaffDetail(): boolean`.

- [ ] **Step 1: Write the failing test** — `packages/app/src/lib/capture-words.test.ts`

```ts
import { describe, expect, it } from 'vitest';
// Test only: the real sentences, so a change to verdict-copy.ts the mapper no longer
// recognises fails here instead of leaking a host (spec 2026-10-21 §6). The shipped app
// imports nothing from @robot/browser.
import { verdictSentence } from '../../../browser/src/verdict-copy';
import { BLOCKED_SENTENCE, PAGE_NOT_READ_SENTENCE, captureWords } from './capture-words';

const HOSTS = ['https://www.shop.example/p/1', 'https://scan.co.uk/c/gpu', 'http://localhost:4321/blocked', 'not a url'];
const VENDORS = ['cloudflare', 'akamai', 'perimeterx', 'datadome', 'aws-waf', 'unknown', undefined] as const;

type V = Parameters<typeof verdictSentence>[0];
const CASES: Array<[V, string]> = [
  [{ kind: 'ok', status: 200 } as V, 'This website opens normally.'],
  ...VENDORS.map((vendor): [V, string] => [{ kind: 'refused', status: 403, ...(vendor ? { vendor } : {}) } as V, "This website turned us away, so we can't read it yet. Contact us if you need it."]),
  [{ kind: 'challenge', status: 403 } as V, 'This website asked for a human check. Wait a few minutes and try again; its other pages are behind the same check.'],
  [{ kind: 'not-found', status: 404 } as V, "That page doesn't exist. Check the address."],
  [{ kind: 'redirected', status: 200, to: 'https://other.example/home' } as V, 'That address opened a page on another website. Paste a page from this website.'],
  [{ kind: 'blank', status: 200 } as V, 'The page came back empty. Try again.'],
  [{ kind: 'wrong-variant', status: 200, named: 'color=red' } as V, 'The page did not show the variant its address names. Check the address, or use another product.'],
  [{ kind: 'crashed' } as V, 'The page stopped loading before we could read it. Try again.'],
  [{ kind: 'unreachable' } as V, 'This website did not respond. Check the address, or try again later.'],
  [{ kind: 'timeout' } as V, 'This website took too long to answer. Try again.'],
];

const LEAKS = [/shop\.example|scan\.co\.uk|localhost|other\.example|not a url/i, /https?:/i, /\bHTTP\b/, /\b\d{3}\b/, /Cloudflare|Akamai|PerimeterX|DataDome|AWS WAF/i, /CAPTCHA/i, /\bbrowser\b/i, /color=red/];

describe('captureWords (spec 2026-10-21 §3)', () => {
  for (const url of HOSTS) {
    for (const [v, want] of CASES) {
      const stored = verdictSentence(v, url);
      it(`${v.kind} on ${url}`, () => {
        expect(captureWords(stored)).toBe(want);
        expect(captureWords(`Not tried: ${stored}`)).toBe(`Not tried: ${want}`);
        expect(captureWords(`${stored} Waiting 2 min before trying again.`)).toBe(`${want} Waiting 2 min before trying again.`);
        for (const leak of LEAKS) expect(captureWords(stored)).not.toMatch(leak);
        expect(captureWords(stored, true)).toBe(stored);
      });
    }
  }

  it('a same-site redirect reads as a different page, never the address', () => {
    expect(captureWords('redirected to https://www.shop.example/c/shoes')).toBe('That address opened a different page. Check the link, or use another product.');
  });

  it('our own sentences pass through', () => {
    for (const s of ["We couldn't open a browser to read this page. Try again in a minute.", 'stalled', 'No value found for Price.', 'Verify stopped before it finished. Try again.']) {
      expect(captureWords(s)).toBe(s);
    }
  });

  it('anything else holding a host, an address, a status or library text becomes the generic sentence', () => {
    for (const s of ['page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.example', 'listing capture failed: HTTP 404 Not Found', 'Page blocked or unusable: CAPTCHA detected', 'fetch failed for shop.example']) {
      expect(captureWords(s)).toBe(PAGE_NOT_READ_SENTENCE);
    }
    expect(captureWords('Page blocked or unusable: CAPTCHA detected', false, BLOCKED_SENTENCE)).toBe(BLOCKED_SENTENCE);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `packages/app`): `npx vitest run src/lib/capture-words.test.ts`
Expected: FAIL — cannot resolve `./capture-words`.

- [ ] **Step 3: Implement** — `packages/app/src/lib/capture-words.ts`

```ts
// Capture-failure sentences in customer words (spec 2026-10-21). The stored text — the sentence
// `verdictSentence` (packages/browser/src/verdict-copy.ts) wrote, which drift and the run
// diagnosis read as is — never changes; this maps it at display time. Staff (`showsMoney`: an
// operator, or a staff session in the org) read the stored text. Pure.

export const PAGE_NOT_READ_SENTENCE = "We couldn't read this page. Try again.";
/** The blocked-run diagnosis's fallback when its evidence is not one of our verdict sentences. */
export const BLOCKED_SENTENCE = 'This website turned us away for now. Wait a few minutes and try again.';

/** One rule per verdict sentence shape in verdict-copy.ts; `\S+` is the host (or the raw URL when it did not parse). */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Reached .+ \(HTTP \d+\)\.$/, 'This website opens normally.'],
  [/^.+ refused the browser \(HTTP \d+(?:, [^)]*)?\)\. We can't read this website from here yet\.$/, "This website turned us away, so we can't read it yet. Contact us if you need it."],
  [/^.+ asked for a human check \(CAPTCHA\)\. /, 'This website asked for a human check. Wait a few minutes and try again; its other pages are behind the same check.'],
  [/^That page doesn't exist on .+ \(404\)\. Check the address\.$/, "That page doesn't exist. Check the address."],
  [/^That address led to \S+\. Paste a page on .+\.$/, 'That address opened a page on another website. Paste a page from this website.'],
  [/^.+ sent an empty page\. Try again\.$/, 'The page came back empty. Try again.'],
  [/^The page did not show the variant the address names \([\s\S]*\)\.$/, 'The page did not show the variant its address names. Check the address, or use another product.'],
  [/^The browser crashed on this page\. Try again\.$/, 'The page stopped loading before we could read it. Try again.'],
  [/^.+ could not be reached \(no response\)\.$/, 'This website did not respond. Check the address, or try again later.'],
  [/^.+ did not answer in time\.$/, 'This website took too long to answer. Try again.'],
  [/^redirected to \S+$/i, 'That address opened a different page. Check the link, or use another product.'],
];

const NOT_TRIED = 'Not tried: ';
const WAITING = /\s*(Waiting \d+ min before trying again\.)$/;
const HOST = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;
const LEAK = /https?:\/\/|\bHTTP\b|\(\d{3}\)|status \d{3}|\b(?:Cloudflare|Akamai|PerimeterX|DataDome|AWS WAF|CAPTCHA)\b|\b(?:Error|Exception)\b|net::ERR_|localhost|\n/i;

/** A stored capture text as `staff` reads it (unchanged) or as a customer does (spec §3's table). */
export function captureWords(text: string, staff = false, fallback = PAGE_NOT_READ_SENTENCE): string {
  if (staff) return text;
  let body = text.trim();
  const prefix = body.startsWith(NOT_TRIED) ? NOT_TRIED : '';
  body = body.slice(prefix.length);
  const wait = WAITING.exec(body);
  const suffix = wait ? ` ${wait[1]}` : '';
  if (wait) body = body.slice(0, wait.index);
  const rule = RULES.find(([re]) => re.test(body));
  const sentence = rule ? rule[1] : HOST.test(body) || LEAK.test(body) ? fallback : body;
  return `${prefix}${sentence}${suffix}`;
}
```

`packages/app/src/lib/use-staff-detail.ts`:

```ts
import { useRouteContext } from '@tanstack/react-router';
import { showsMoney } from './money-visibility';

/** Whether this viewer reads stored capture detail (spec 2026-10-21 §2): the same people who see money. */
export function useStaffDetail(): boolean {
  const { session } = useRouteContext({ from: '/_app' });
  return showsMoney(session);
}
```

In `packages/browser/src/verdict-copy.ts`, above `export function verdictSentence`, add:

```ts
// Staff detail: a customer never reads these as written. `@robot/app`'s
// `lib/capture-words.ts` maps each shape below to its customer sentence at
// display time (spec 2026-10-21) — change a sentence here and its
// capture-words test fails until the mapper learns the new shape.
```

- [ ] **Step 4: Run the test and the type-check**

Run (from `packages/app`): `npx vitest run src/lib/capture-words.test.ts` → PASS. Then `npx tsc --noEmit` → no errors (it type-checks `browser/src/verdict-copy.ts` through the test import; if it reports an error inside the browser file, replace the import with a local copy of `verdictSentence` in the test file and keep a comment pointing at verdict-copy.ts).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/capture-words.ts packages/app/src/lib/capture-words.test.ts packages/app/src/lib/use-staff-detail.ts packages/browser/src/verdict-copy.ts
git commit -m "feat(app): captureWords — capture failures in customer words, staff keep the detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every customer screen shows capture texts through `captureWords`

**Files:**
- Modify: `packages/app/src/lib/site/proof-capture-state.ts` (+ test), `packages/app/src/lib/site/use-proof-captures.ts`
- Modify: `packages/app/src/lib/site/drift-view.ts` (+ test)
- Modify: `packages/app/src/lib/site/extract-view.ts` (+ test), `packages/app/src/components/extract/extract-pages.tsx`, `packages/app/src/components/extract/extract-sample.tsx`
- Modify: `packages/app/src/lib/site/diagnose-run.ts` (+ test), `packages/app/src/components/runs/probe-gate.tsx`
- Modify: `packages/app/src/components/verification/listing-bar.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`
- Modify: `packages/app/src/components/runs/work-list.tsx`, `runs-table.tsx`, `org-runs-table.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx`
- Modify: `packages/app/src/routes-smoke.test.ts` (three verdict assertions)

**Interfaces:**
- Consumes: `captureWords`, `BLOCKED_SENTENCE` (Task 1), `useStaffDetail` (Task 1).
- Produces: `proofCaptureState(args: {…; staff?: boolean})`, `driftRows(args: {…; staff?: boolean})`, `listingCheckLabel(check, staff = false)`, `DiagnoseRunInput.staff?: boolean`. Every new parameter defaults to the customer's view.

- [ ] **Step 1: Write the failing tests** (append to each existing test file; existing cases that pin stored text get `staff: true` added so they keep testing the staff view)

`proof-capture-state.test.ts` — change the existing "a verdict sentence and its kind pass through" case to pass `staff: true`, and add:

```ts
  it('a customer reads the verdict in customer words; the kind still passes through', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: failed('shop.example did not answer in time.', { kind: 'timeout' }), isError: false } }))
      .toMatchObject({ status: 'failed', error: 'This website took too long to answer. Try again.', verdict: { kind: 'timeout' } });
  });
```

`drift-view.test.ts` — give the existing not-checked case (`reason = 'shop.example refused the browser (HTTP 403).'`) `staff: true` in its `driftRows` args, and add a copy of it without `staff` expecting `'Product 3 could not be checked — We couldn\'t read this page. Try again.'` (that reason has no "We can't read…" tail, so it is not a full verdict sentence and takes the generic sentence) and one with the full sentence `"shop.example refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet."` expecting `"Product 3 could not be checked — This website turned us away, so we can't read it yet. Contact us if you need it."`.

`extract-view.test.ts`:

```ts
  it('a listing check error is shown in customer words; staff read it as stored', () => {
    const error = 'shop.example did not answer in time.';
    expect(listingCheckLabel({ error })).toEqual({ tone: 'error', text: 'This website took too long to answer. Try again.' });
    expect(listingCheckLabel({ error }, true)).toEqual({ tone: 'error', text: error });
  });
```

`diagnose-run.test.ts` — add `staff: true` to every existing `diagnoseRun({...})` input (they pin the stored detail), and add:

```ts
describe('diagnoseRun for a customer (spec 2026-10-21)', () => {
  const base = { warnings: [], errors: [], itemFailures: [] };
  it('a wall reads as its customer sentence, with no proxy line', () => {
    const [d] = diagnoseRun({ ...base, errors: [{ message: "scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet." }] });
    expect(d).toEqual({ severity: 'blocked', title: 'Site blocked our requests', detail: "This website turned us away, so we can't read it yet. Contact us if you need it." });
  });
  it('a health-check block reads as the blocked sentence', () => {
    const [d] = diagnoseRun({ ...base, blockedReason: 'CAPTCHA detected — site requires human verification' });
    expect(d!.detail).toBe('This website turned us away for now. Wait a few minutes and try again.');
  });
  it('a dead link names no status', () => {
    const [d] = diagnoseRun({ ...base, errors: [{ message: 'listing capture failed: HTTP 404 Not Found — page does not exist' }] });
    expect(d!.detail).toBe('The link appears dead. Check the address.');
  });
  it('a failed item reads in customer words', () => {
    const [d] = diagnoseRun({ ...base, itemFailures: [{ url: 'https://shop.example/p/1', error: 'shop.example did not answer in time.' }] });
    expect(d!.detail).toBe('This website took too long to answer. Try again.');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `packages/app`): `npx vitest run src/lib/site/proof-capture-state.test.ts src/lib/site/drift-view.test.ts src/lib/site/extract-view.test.ts src/lib/site/diagnose-run.test.ts`
Expected: FAIL — the new customer cases read the stored text.

- [ ] **Step 3: Implement the pure helpers**

`proof-capture-state.ts`: import `captureWords` from `'../capture-words'`; add `staff?: boolean` to `proofCaptureState`'s args; replace `const error = captureErrorText(data.error);` with

```ts
  const error = captureErrorText(data.error === undefined ? undefined : captureWords(data.error, args.staff));
```

`use-proof-captures.ts`: `const staff = useStaffDetail();` at the top of `useProofCaptures` (import from `'../use-staff-detail'`) and pass `staff` into its `proofCaptureState({...})` call.

`drift-view.ts`: add `staff?: boolean` to `driftRows`' args and pass it to `pageRows(pages, urls, staff)`; in `pageRows` the not-checked line becomes

```ts
    else if (p?.status === 'not-checked') texts.push({ url, text: `Product ${n} could not be checked — ${captureWords(p.reason, staff)}`, replaceable: false });
```

`extract-view.ts`: `export function listingCheckLabel(check: …, staff = false)` and `if ('error' in check) return { tone: 'error', text: captureWords(check.error, staff) };`.

`diagnose-run.ts`: add `staff?: boolean` to `DiagnoseRunInput`; import `captureWords, BLOCKED_SENTENCE` from `'../capture-words'`; then
- both blocked branches: `detail: staff ? \`${reason} — wait and retry; long-term this needs the proxy line item.\` : captureWords(reason, false, BLOCKED_SENTENCE)` (with `reason` = `blockedReason` / `blockedMatch`);
- dead link: `detail: staff ? \`The link appears dead (${deadLinkMatch}).\` : 'The link appears dead. Check the address.'`;
- extraction rows: `detail: captureWords(f.error, staff)`.
The matching (`BLOCKED_HEALTH_REASON`, `DEAD_LINK_REASON`, `BLOCKED_PAGE_ERROR`) keeps reading the stored text.

- [ ] **Step 4: Run the helper tests**

Run: the Step 2 command. Expected: PASS.

- [ ] **Step 5: Wire the components** (each reads `const staff = useStaffDetail();`, import from the relative `lib/use-staff-detail`, and `captureWords` from `lib/capture-words`)

- `listing-bar.tsx`: `{captureWords(found.message, staff)}` and `{captureWords(check.error.message, staff)}`.
- `sites/$site/index.tsx`: in the component that builds `blocked` (≈ line 375), `const staff = useStaffDetail();` and
  `const blocked = useMemo(() => Object.fromEntries(Object.entries(blockedReasons(status?.captures)).map(([u, r]) => [u, captureWords(r, staff)])), [status?.captures, staff]);`
  (badge, cell hint and "Not checked on product n — …" all read `blocked`; `notCheckedText`'s own redirect/URL guard still applies to staff). Pass `staff` into the `driftRows({...})` call (≈ line 441). The reachability lines (≈ 1509/1511) render `{captureWords(reachability.data.message, staff)}`, reading `useStaffDetail()` in that component.
- `extract-pages.tsx`: `listingCheckLabel(check, staff)`.
- `extract-sample.tsx`: `{captureWords(statusQuery.data.errorMessage, showMoney)}` (`showMoney` already is `showsMoney(session)`).
- `probe-gate.tsx`: pass `staff` into `diagnoseRun({...})`.
- `runs/$run.tsx`: `{captureWords(run.errorMessage, staff)}` (≈ line 297).
- `work-list.tsx`: `{captureWords(item.error, staff)}`; `runs-table.tsx` and `org-runs-table.tsx`: `{captureWords(run.error, staff)}`.

- [ ] **Step 6: Update the route smoke** — `packages/app/src/routes-smoke.test.ts` signs in as a customer:
  - ≈ line 916: `.toContain(\`Reached ${WEBSITE_HOST} (HTTP 200).\`)` → `.toContain('This website opens normally.')`
  - ≈ line 2091: → `.toContain("This website turned us away, so we can't read it yet. Contact us if you need it.")`, and add `expect(await page.locator('main').innerText(), 'the wall named the host').not.toContain(host);` after it.
  - ≈ line 2101: → `.toContain("This website turned us away, so we can't read it yet. Contact us if you need it. Waiting 2 min before trying again.")`

- [ ] **Step 7: Run the app tests and type-check**

Run (from `packages/app`): `npx vitest run` → PASS (the smoke skips without `RUN_UI_SMOKE`); `npx tsc --noEmit` → no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/lib/site/proof-capture-state.ts packages/app/src/lib/site/proof-capture-state.test.ts packages/app/src/lib/site/use-proof-captures.ts packages/app/src/lib/site/drift-view.ts packages/app/src/lib/site/drift-view.test.ts packages/app/src/lib/site/extract-view.ts packages/app/src/lib/site/extract-view.test.ts packages/app/src/lib/site/diagnose-run.ts packages/app/src/lib/site/diagnose-run.test.ts packages/app/src/components/extract/extract-pages.tsx packages/app/src/components/extract/extract-sample.tsx packages/app/src/components/runs/probe-gate.tsx packages/app/src/components/verification/listing-bar.tsx 'packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx' 'packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx' packages/app/src/components/runs/work-list.tsx packages/app/src/components/runs/runs-table.tsx packages/app/src/components/runs/org-runs-table.tsx packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): every customer screen shows capture failures in customer words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: "Budget" becomes "page limit", and the copy sweep

**Files:**
- Modify: `packages/app/src/components/settings/settings-rows.tsx` (lines ≈ 83, 133, 202)
- Modify: `packages/app/src/lib/site/run-screen-view.ts:272-275` (+ `run-screen-view.test.ts:306,320`)
- Modify: `packages/app/src/lib/staff-view.ts` (+ `staff-view.test.ts`)
- Modify: `packages/api/src/auth/staff-actions.ts:94-96` (+ `staff-actions.test.ts:95-96`)
- Modify: `packages/app/src/routes-smoke.test.ts:1475`
- Create: `packages/app/src/customer-copy-sweep.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `limitWords(summary: string): string` in `packages/app/src/lib/staff-view.ts`.

- [ ] **Step 1: Write the failing tests**

`run-screen-view.test.ts`: change the two expected lines to `'4 variant pages skipped for the page limit'` and `'1 variant page skipped for the page limit'`.

`staff-actions.test.ts`: change the two `crawl.plan` rows to `'Planned an extraction on Nike (up to 50 products)'` and `'Planned an extraction on Nike (all products)'`, and add `['crawl.plan', { sourceId: 's' }, { runId: 'r' }, {}, 'Planned an extraction on Nike']`.

`staff-view.test.ts`:

```ts
describe('limitWords (spec 2026-10-21 §4)', () => {
  it('rewords a stored "budget" bracket', () => {
    expect(limitWords('Planned an extraction on Nike (budget 50 products)')).toBe('Planned an extraction on Nike (up to 50 products)');
    expect(limitWords('Planned an extraction on Nike (budget all products)')).toBe('Planned an extraction on Nike (all products)');
    expect(limitWords('Planned an extraction on Nike (budget ? products)')).toBe('Planned an extraction on Nike');
    expect(limitWords('Ran a sample on Nike')).toBe('Ran a sample on Nike');
  });
  it('formatStaffEntry shows the reworded sentence', () => {
    const e = { id: '1', at: new Date(), actor: { name: 'A', email: 'a@x' }, org: { id: 'o', name: 'O' }, project: null, website: null, summary: 'Planned an extraction on Nike (budget 50 products)', run: null };
    expect(formatStaffEntry(e).sentence).toBe('Planned an extraction on Nike (up to 50 products)');
  });
});
```

`packages/app/src/customer-copy-sweep.test.ts`:

```ts
// Customer copy never says "budget", an HTTP code, or a verdict's staff wording (spec 2026-10-21 §6).
// Reads every shipped .ts/.tsx under src with the TypeScript parser — string literals, template
// text and JSX text only, so identifiers and comments never count. Staff screens are exempt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname);
const STAFF = [/^routes\/_app\/ops\//, /^components\/ops\//, /^lib\/ops-view\.ts$/, /^lib\/capture-words\.ts$/];
const FORBIDDEN = [/\bbudget\b/i, /\bHTTP \d/, /refused the browser/];
// "proxy line item" is not swept: diagnose-run.ts keeps it in its staff-only branch (Task 2), and
// diagnose-run.test.ts pins that a customer never reads it.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !n.endsWith('routeTree.gen.ts') ? [p] : [];
  });
}

function texts(path: string): string[] {
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.getText());
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

describe('customer copy sweep', () => {
  it('no customer string says budget, an HTTP code or a verdict\'s staff wording', () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (STAFF.some((re) => re.test(rel))) continue;
      for (const t of texts(f)) if (FORBIDDEN.some((re) => re.test(t))) hits.push(`${rel}: ${t.trim().slice(0, 80)}`);
    }
    expect(hits).toEqual([]);
  });
});
```

(`ts.isStringLiteral` also returns import specifiers; none contains a forbidden word. If the app's vitest environment has no `__dirname`, use `fileURLToPath(new URL('.', import.meta.url))` from `node:url`.)

- [ ] **Step 2: Run them to verify they fail**

Run (from `packages/app`): `npx vitest run src/customer-copy-sweep.test.ts src/lib/staff-view.test.ts src/lib/site/run-screen-view.test.ts` → FAIL (`limitWords` is not defined; the sweep lists at least `settings-rows.tsx` "Budget", "Save budget", "That budget could not be saved." and `run-screen-view.ts` "skipped for the budget"). Any other hit is either customer copy — reword it in spec §4's style and add a row to the spec's table — or a staff-only string, whose file then joins `STAFF` with a one-line comment saying why.
Run (from `packages/api`): `npx vitest run --no-file-parallelism src/auth/staff-actions.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`settings-rows.tsx`: `<Row label="Page limit">`, button text `Save page limit`, `setBudgetError('That page limit could not be saved.')`.

`run-screen-view.ts`: `` `${plural(summary.variantsSkippedForBudget, 'variant page')} skipped for the page limit` ``.

`staff-view.ts`:

```ts
/** A staff-activity summary in customer words (spec 2026-10-21 §4): rows written before it said "(budget n products)". */
export function limitWords(summary: string): string {
  return summary
    .replace(/ \(budget all products\)/, ' (all products)')
    .replace(/ \(budget (\d+) products\)/, ' (up to $1 products)')
    .replace(/ \(budget \? products\)/, '');
}
```

and in `formatStaffEntry`: `sentence: limitWords(e.summary),`.

`staff-actions.ts` `crawl.plan.describe`:

```ts
    describe: ({ input, before, target }) => {
      if (input.probe) return `Tried a sample on ${site(target)}`;
      const b = before?.budget;
      const limit = b === 'all' ? ' (all products)' : typeof b === 'number' ? ` (up to ${b} products)` : '';
      return `Planned an extraction on ${site(target)}${limit}`;
    },
```

`routes-smoke.test.ts:1475`: `.toContain('2 variant pages skipped for the page limit')` and its message `'the skipped-for-page-limit count is missing'`.

- [ ] **Step 4: Run the tests**

Run (from `packages/app`): `npx vitest run` → PASS; `npx tsc --noEmit` → clean.
Run (from `packages/api`): `npx vitest run --no-file-parallelism src/auth/staff-actions.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/settings/settings-rows.tsx packages/app/src/lib/site/run-screen-view.ts packages/app/src/lib/site/run-screen-view.test.ts packages/app/src/lib/staff-view.ts packages/app/src/lib/staff-view.test.ts packages/api/src/auth/staff-actions.ts packages/api/src/auth/staff-actions.test.ts packages/app/src/routes-smoke.test.ts packages/app/src/customer-copy-sweep.test.ts
git commit -m "feat: customers read \"page limit\", never \"budget\"; a sweep keeps it so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Merge gate (CLAUDE.md "Autonomous runs")

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-customer-copy-design.md` (Status), `docs/handoff.md` (top paragraph + a section), `CLAUDE.md` (one Key Technical Decisions line), `docs/queue.md` (items 1–2 to Done)

- [ ] **Step 1: Full tests and type-checks of every touched package** (worktree `C:\Users\Marko\Documents\projects\robot-platform-copy`; Postgres running)
  - `packages/app`: `npx vitest run` and `npx tsc --noEmit`
  - `packages/api`: `npx vitest run --no-file-parallelism` and `npx tsc --noEmit`
  - `packages/browser`: `npx vitest run` and `npx tsc --noEmit` (comment-only change; still run)
  All green, or fix and re-run.

- [ ] **Step 2: Whole-branch review** on the most capable model: `git diff main...feat/customer-copy` against the spec. It must check: no customer surface from spec §3's list still renders a raw capture text; staff (`showsMoney`) still read stored text; drift (`outcomeOfFailedCapture`) and `diagnoseRun`'s matching still read stored text; no Critical or Important finding open. Fix rounds commit by explicit path.

- [ ] **Step 3: Route smoke on the isolated pair** (never :3000/:4000)
  - api-server, from `packages/api-server` in the worktree, in the background: `ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts`
  - app, from `packages/app`, in the background: `VITE_API_URL=http://localhost:4100 npx vite dev --port 3100`
  - smoke, from `packages/app`: `RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts` → all pass. Look at `docs/testing/screens/app-site-verification-wall-refused.png`: the customer sentence, no host.
  - stop both by port (4100, 3100) only; `git checkout -- packages/app/src/routeTree.gen.ts` if it changed.

- [ ] **Step 4: Docs**
  - Spec Status → "Implemented 2026-10-21, merged (`<sha>`)."
  - `docs/handoff.md`: a top paragraph "**Latest: Customer copy (2026-10-21).** …" and a `## Customer copy (2026-10-21)` section (what changed, the mapper, staff detail, the sweeps, the smoke).
  - `CLAUDE.md` Key Technical Decisions, one line: "Customer copy (2026-10-21): capture failures are stored as staff detail (host, HTTP code) and mapped to customer words at display (`@robot/app` `lib/capture-words.ts`; staff = `showsMoney`); a customer reads "page limit", never "budget"; sweep tests keep both."
  - `docs/queue.md`: items 1 and 2 move to **Done** as "2026-10-21 — Capture-failure sentences in customer words (`<sha>`)." and "2026-10-21 — "Budget" becomes "Page limit" (`<sha>`)."; renumber Next.
  - Commit by explicit path with the trailer.

- [ ] **Step 5: Merge**

```bash
git fetch origin && git rebase origin/main
# re-run Step 1's app tests if the rebase pulled anything
git -C C:/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/customer-copy
git -C C:/Users/Marko/Documents/projects/robot-platform push origin main
```

If `main`'s checkout has local changes that block the fast-forward, run `git push origin feat/customer-copy:main` from the worktree instead (still a fast-forward) and leave the checkout for Marko.
