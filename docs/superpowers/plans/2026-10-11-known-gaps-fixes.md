# Known-gap fixes after the two October plans — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five known gaps the handoff recorded after honest page verdicts (2026-10-09) and proof-page coverage (2026-10-10), before the next campaign on new websites.

**Architecture:** Five independent, small changes, each in the layer that owns the behaviour: the wall classifier (`@robot/browser`), the drift check's page outcome (`@robot/scraper` + `@robot/api` + the app's drift row), the coverage loop (`@robot/api`), the Verification table's Status column (`@robot/app`), and the proof-page capture's page title flowing into a card's title (`@robot/api` + `@robot/app`).

**Tech Stack:** TypeScript ESM; vitest; Playwright for the route smoke; tRPC; TanStack Start + React 19 + Tailwind v4.

**Spec:** none — each fix is a gap recorded in `docs/handoff.md` ("Known gaps") with its intended behaviour stated there and restated per task below.

## Global Constraints

- Tests per package only, never `pnpm -r test`. One Chromium-heavy process at a time; the route smoke once, at the end (Task 6).
- Commits by explicit path (`git add -- <new>`; `git commit -m "…" -- <paths>`), never `git add -A`/`.`; never stage `packages/app/src/routeTree.gen.ts`; every message ends `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `.js` suffix on relative imports in browser/scraper/api; none in app. `@robot/app` never imports `@robot/scraper`/`@robot/api`.
- No model call anywhere; no real website loaded by a test.
- Copy is exact where given below.

## Review Focus

1. A proof page whose capture carries no title (older rows, a page with an empty `<title>`) keeps the card's current title; nothing overwrites a title the customer or the listing already gave. → Task 5.
2. A drift check where EVERY proof page could not be checked (the host backs off) must end `done` with the field `not checked`, never `lost`. → Task 2.
3. The coverage loop's status re-read must not turn a transient DB error into a failed check. → Task 3.
4. The sticky Status column must not cover the last product column's accept button on narrow widths. → Task 4.
5. A legitimate page that embeds a reCAPTCHA widget inside a long form (contact page) stays `ok`: the iframe rule applies to thin pages only. → Task 1.

---

### Task 1: A thin page with only a CAPTCHA iframe is a challenge (`@robot/browser`)

**Files:**
- Modify: `packages/browser/src/page-health.ts` (`detectWall`, ~line 203)
- Test: `packages/browser/src/verdict.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Failing tests** — append to `verdict.test.ts`'s `classifyVerdict` describe (use the file's helpers for building the input; mirror the existing "AWS WAF human check" case):

```ts
  it('a thin page whose only wall sign is a CAPTCHA iframe is a challenge', () => {
    const html = '<html><head><title>Please wait</title></head><body><div id="c"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=abc" title="reCAPTCHA"></iframe></div></body></html>';
    expect(classifyVerdict({ requestedUrl: 'https://s.example/p/1', finalUrl: 'https://s.example/p/1', status: 200, headers: {}, html, title: 'Please wait' })).toMatchObject({ kind: 'challenge' });
  });
  it('a long contact page that embeds a reCAPTCHA widget stays ok', () => {
    const body = `<p>${'Write to us about your order and we will answer within a day. '.repeat(40)}</p><iframe src="https://www.google.com/recaptcha/api2/anchor?k=abc"></iframe>`;
    const html = `<html><head><title>Contact</title></head><body>${body}</body></html>`;
    expect(classifyVerdict({ requestedUrl: 'https://s.example/contact', finalUrl: 'https://s.example/contact', status: 200, headers: {}, html, title: 'Contact', boxCount: 12 })).toMatchObject({ kind: 'ok' });
  });
```

- [ ] **Step 2: Run** — `pnpm --filter @robot/browser exec vitest run src/verdict.test.ts` → the first new test fails (`blank`).

- [ ] **Step 3: Implement** — in `detectWall`, after `CHALLENGE_MARKERS`:

```ts
/** A CAPTCHA widget's iframe: on a thin page it IS the page (the challenge), on a long page it is a form's helper. */
const CAPTCHA_IFRAME = /<iframe[^>]+src=["'][^"']*(recaptcha|hcaptcha|captcha-delivery|awswaf)[^"']*["']/;
```

and extend `isChallenge` with `|| CAPTCHA_IFRAME.test(lowerHtml)` (the function already returns null for pages at or above `SUBSTANTIAL_CONTENT_CHARS`, which keeps the contact page ok).

- [ ] **Step 4: Run** — the two tests pass; `pnpm --filter @robot/browser test` (one Chromium at a time; some tests launch one); `pnpm --filter @robot/browser exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(browser): a thin page whose only wall sign is a CAPTCHA iframe is a human check, not an empty page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/browser/src/page-health.ts packages/browser/src/verdict.test.ts
```

---

### Task 2: A drift check says "could not check" for a page it could not read (`@robot/scraper`, `@robot/api`, `@robot/app`)

**Files:**
- Modify: `packages/scraper/src/verify/drift-classify.ts` (`DriftPage` + `'not-checked'`, `classifyDrift` input `notChecked`)
- Modify: `packages/api/src/verify/run-drift-check.ts` (`CaptureProofPagesFn` result carries a failed capture's verdict; the split between gone and not checked)
- Modify: `packages/app/src/lib/site/drift-view.ts` (`DriftPageLike`, the row), `packages/app/src/components/verification/verification-table.tsx` (the `page-gone` items render a not-checked text with no Replace button)
- Test: `packages/scraper/src/verify/drift-classify.test.ts`, `packages/api/src/verify/run-drift-check.test.ts`, `packages/app/src/lib/site/drift-view.test.ts`

**Interfaces:**
- Produces: `DriftPage` gains `| { status: 'not-checked'; reason: string }`; `classifyDrift(input & { notChecked?: Record<string, string> }, deps)`; `CaptureProofPagesFn` returns `Record<string, ProofPageCaptureRecord | { notChecked: string } | null>`; app `DriftPageLike` gains the same variant; the row item `{ product, text, onReplace: (() => void) | null }`.

Behaviour: a proof page whose fresh capture failed with a verdict of `refused`, `challenge`, `blank`, `timeout`, `unreachable` or `crashed`, or that was answered from the host's backoff, is **not checked** — the field's result is decided on the pages that were read, and that page's row reads `Product 2 could not be checked — <the verdict sentence>` with no Replace button. A `not-found` or `redirected` verdict, or no record at all, stays **page gone** as today. A field with no readable page at all ends `other-layout`-less: result `lost` is wrong (nothing was learned) — add result `'not-checked'` to `DriftFieldResult.result` for that case, with every page `not-checked`; the app's banner words it "could not be checked now" (read `driftBanner` and add the case).

- [ ] **Step 1: Failing tests** — scraper: `classifyDrift` with `notChecked: { [U[2]]: 'shop.example refused the browser (HTTP 403).' }` and captures for U[0], U[1] only → decides on two pages, `pages[U[2]]` is `{ status: 'not-checked', reason }`; with all three not checked → `result: 'not-checked'`. api: `runDriftCheck` with the injected capture returning `{ notChecked: '…' }` for one url → the row's results carry it; app: `driftRows` renders the text `Product 3 could not be checked — shop.example refused the browser (HTTP 403).` with `onReplace: null`.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** — `run-drift-check.ts` `captureProofPagesWith`: after `runProofPageCaptureInSlot`, load the record; when the capture row's meta is `failed`, map its `verdict.kind`: `not-found`/`redirected`/absent → `null` (gone), anything else → `{ notChecked: <meta.error> }` (the error already is the verdict sentence since 2026-10-09). `runDriftCheck`: split `records` into `captures` (records), `notChecked` (reason by url) and gone (null); pass `notChecked` to `classifyDrift`; `classifyDrift` treats a not-checked url as neither deciding nor gone and stamps its page entry. App: `pageGoneRow` becomes `pageRows` producing both kinds with the exact texts; the table renders a not-checked item as the text alone.

- [ ] **Step 4: Run** — `pnpm --filter @robot/scraper test`, `pnpm --filter @robot/api test`, `pnpm --filter @robot/app test`; `tsc --noEmit` for the three.

- [ ] **Step 5: Commit** (explicit paths of the files above).

---

### Task 3: A superseded coverage check stops reading (`@robot/api`)

**Files:**
- Modify: `packages/api/src/verify/run-coverage-check.ts` (the page loop)
- Test: `packages/api/src/verify/run-coverage-check.test.ts`

- [ ] **Step 1: Failing test** — an injected `extract` that, on its second call, closes the row (`db.update(coverageChecks).set({ status: 'failed', error: 'superseded', completedAt: new Date() })`) → the loop stops after that page: `extract` called exactly 2 times, the row stays `failed/superseded`, `results.sampled` is not rewritten.

- [ ] **Step 2: Implement** — at the top of each loop iteration: `const still = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, checkId), columns: { status: true } }); if (still?.status !== 'running') { console.log(\`[coverage] check ${checkId} no longer running (${still?.status ?? 'gone'}); stopping\`); return; }` — wrapped in try/catch so a transient DB error is logged and the loop continues (Review Focus 3; test it with a `db` spy that throws once if the module allows injection, else document it).

- [ ] **Step 3: Run** — `pnpm --filter @robot/api exec vitest run src/verify/run-coverage-check.test.ts`, then `pnpm --filter @robot/api test`, `tsc --noEmit`.

- [ ] **Step 4: Commit.**

---

### Task 4: The Status column stays in view (`@robot/app`)

**Files:**
- Modify: `packages/app/src/components/verification/verification-table.tsx` (the status `<th>` in the head and the status `<td>` per row: `sticky right-0 z-10 bg-panel` plus a left border `border-l border-line`, mirroring the sticky field-name column on the left)

- [ ] **Step 1: Implement** — add the classes; the wrapper already has `overflow-x-auto`. Keep `w-[220px]`. Check the Fix/Accept button inside the last product cell is still clickable when the table is wider than the viewport (the sticky cell has a background, so it covers the scrolled-under cells by design; the last product column scrolls into view before the status column covers anything — verify by reasoning about `table-fixed` widths: 180 + n×190 + 220).

- [ ] **Step 2: Run** — `pnpm --filter @robot/app exec tsc --noEmit`; `pnpm --filter @robot/app test`.

- [ ] **Step 3: Commit.**

---

### Task 5: A card added by URL takes its title from the page (`@robot/api`, `@robot/app`)

**Files:**
- Modify: `packages/api/src/verify/proof-page-capture.ts` (`ProofPageMeta` captured variant gains `title?: string`; `runProofPageCapture` writes `capture.title.trim().slice(0, 120)` when non-empty; `ProofPageCaptureState` gains `title?`; `latestProofPageCaptures` passes it)
- Modify: `packages/api/src/routers/sources.ts` `proofPageCaptures` (passes `title` through — read what it returns per url)
- Modify: `packages/app/src/lib/site/use-proof-captures.ts` (`ProofCapture.title?`), `packages/app/src/lib/site/verification-model.ts` (`titleFromCapture(card, title): Card | null` — returns an updated card only when the card's title is blank, equals its url, or equals `shortUrl(url)`), the site route (an effect: for each captured url with a title, `setBoard(b => setCards(b, …))` when `titleFromCapture` says so; the autosave then carries `cards`)
- Test: `packages/app/src/lib/site/verification-model.test.ts` (`titleFromCapture`: url-as-title → replaced; "Widget D" → untouched; blank title → untouched), `packages/api/src/verify/proof-page-capture.test.ts` (a captured meta carries the page's title)

- [ ] **Step 1: Failing tests** — as above.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** — api and app tests, `tsc --noEmit` both.
- [ ] **Step 4: Commit.**

---

### Task 6: Smoke, handoff

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts` only if an assertion changed (the fourth card's title now becomes "Widget D": assert it in the coverage test, `card('Widget D')` → 1 after the capture); `docs/handoff.md` (the known gaps closed; a short "Known-gap fixes (2026-10-11)" section before the proof-page coverage one), `docs/testing/screens/*.png` refreshed by the run.

Needs `pnpm dev:all` running this branch (ask the controller if not).

- [ ] **Step 1: Run** `pnpm test:ui:app` once. Expected 22 of 22.
- [ ] **Step 2: Handoff** — in "Known gaps" of the two sections, mark the five as fixed with the commit; the new section lists what changed per fix in one line each.
- [ ] **Step 3: Commit** (smoke, handoff, screenshots by explicit path).

---

## Self-review

**Coverage.** The five gaps → Tasks 1–5; the smoke and handoff → Task 6. **Placeholders.** Task 2 and Task 5 give the behaviour and the interfaces and name the tests' cases rather than full code: both touch three packages and the implementer reads the files named; the exact row texts are given. **Types.** `not-checked` spelled the same in scraper and app; `title?` on the captured meta, the state and the app type. **Review Focus.** 1 → Task 5 tests; 2 → Task 2 (all-not-checked case); 3 → Task 3; 4 → Task 4 (reasoned, smoke screenshot); 5 → Task 1 (contact page test).
