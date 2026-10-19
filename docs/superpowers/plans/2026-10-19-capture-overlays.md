# Captures Without Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A capture closes what the page put over the product and never opens anything over it itself, so a proof page's screenshot shows the product (spec §3).

**Architecture:** One new browser-safe module, `packages/browser/src/overlays.ts`, holds the rules (pure functions, unit-tested in Node) and the page code (DOM helpers and `entry…` functions), sent to the page as strings that `pageScript()` assembles with an esbuild `__name` shim. `playwright-browser.ts` keeps the orchestration: its `expandHiddenContent` and `dismissPopups` are rewritten to call those scripts, and `capture()` gains a final pass, a scroll to the top and one warning line. No new field on the capture result, no customer-visible change.

**Tech Stack:** TypeScript (ESM), Playwright (1.58 in the lockfile; Chromium), vitest 3, Node `http` for fixture pages, tsx for the live-check script.

**Spec:** `docs/superpowers/specs/2026-10-19-capture-overlays-design.md` (binding). Evidence: `docs/testing/results/2026-10-19-capture-overlays/findings.md` and `probe.mts` beside it. Where this plan departs from the spec it says so below, with the reason; the plan wins where they differ.

## Global Constraints

- Work only in the worktree `C:\Users\Marko\Documents\projects\robot-platform-captures`, branch `feat/capture-overlays`. Never touch the main checkout.
- Never start, stop or restart Marko's dev servers (:3000, :4000). Nothing in this plan needs an api-server or a database.
- ESM everywhere; relative imports in `packages/browser` carry the `.js` suffix (`import { … } from './overlays.js'`).
- Page code: a function that runs in the page references only constants and functions declared in `overlays.ts` and listed in `PAGE_CONSTANTS` / `PAGE_FUNCTIONS` — never an import, never a module-level `const` arrow. Every page script is built by `pageScript()` (it starts with `PAGE_PRELUDE`).
- Tests per package only: `cd packages/browser && npx vitest run src/<file>`. Chromium test files one at a time (one browser at a time on this machine). Never `pnpm -r test`, never `pnpm test` at the root.
- `npx tsc --noEmit` in `packages/browser` must report no error in a file this plan touches.
- Commits by explicit path: `git add <path> <path>` then `git commit`; never `git add -A`, `git add .` or `git commit -a`. Every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No rule depends on a site's name, domain or language beyond the close words of §3.3.4 (spec §5.4). Site names appear only in comments and tests that cite the evidence.
- No new field on `PageCapture`; a remaining overlay is one `console.warn` line (spec §8.3).
- A page with no overlay is captured as today: no extra wait longer than the existing ones, no extra screenshot (spec §5.5). The final pass has no settle wait.
- No paid API anywhere. The live check is free, keyless and runs one browser at a time.
- Working-copy files are CRLF (`core.autocrlf=true`); the Edit tool copes, `sed` one-liners may not.

## Review Focus

The inputs the spec implies but its fixture list does not exercise, most likely to bite first. Each has its test in the owning task.

1. **A page whose whole content sits in a fixed full-window container (an app shell).** §3.1's fourth bullet would call it an overlay and the removal pass would blank the page. Expected: nothing is hidden, the product stays on the screenshot. Pinned by the `holdsPage` guard (Task 1 unit + page tests) and the `/app-shell` capture (Task 3).
2. **A fixed buy box covering a quarter of the window that holds the price.** §3.1 calls it an overlay. Expected: the price stays in the captured HTML (the removal pass hides, it does not remove). Pinned by `/buy-box` (Task 3).
3. **A consent banner inside an open shadow root.** Today's Playwright text selectors pierce open shadow roots; an in-page `querySelectorAll` does not. Expected: still accepted. Pinned by `/shadow-consent` (Task 3).
4. **A close button whose click navigates by script, met in the final pass.** Expected: the capture still ends on the requested page. Pinned by `/navigating-close` (Task 4).
5. **A heavy page (15,000 elements) with no overlay.** The overlay scans walk every element several times. Expected: no slower than today beyond scan time. Pinned by `/heavy` (Task 4).

## Where the plan departs from the spec, and why

1. **§3.1 — the page is never an overlay.** `<html>`, `<body>`, and any element containing the page's `main` or its first `h1`, are never overlays. Without this an app shell (`position:fixed; inset:0` around the whole page) is an overlay by the fourth bullet and the removal pass blanks the capture.
2. **§3.2.5 — a control already expanded when the pass begins counts as clicked.** Once-per-element alone does not fix mejuri: round 1 opens Materials, which closes Description (never clicked by us, now `aria-expanded="false"`); round 2 would click Description and close Materials again. Counting the initially-open control as clicked ends with Materials open.
3. **§3.2 — the tabs step gets skips 1–3 and the undo net too, and never follows a link elsewhere even into a new tab.** A tab that opens a video modal is the same failure as `Zoom`; a `target="_blank"` link would open a page in the capture's browser context that nothing closes.
4. **§3.3.5 — overlays found by the §3.1 definition are hidden (`display:none !important`), not removed.** Their text stays in the captured HTML, so a fixed panel that holds a product field (Review Focus 2) still extracts. Today's removal selectors keep removing, as today, and the expand pass's undo (§3.2.4) still removes what our own clicks opened.
5. **§3.3 — at most six dismissal clicks per pass.** Each click waits 800 ms before it is judged; a page full of dead "Close" buttons would otherwise cost seconds per round.
6. **§3.4 — the navigated-away check runs again after the final pass.** A close button can navigate by script (`location.href = …`), which `hrefNavigates` cannot see.
7. **§3.3 — dismissal looks inside open shadow roots**, as the Playwright text selectors it replaces did (Review Focus 3).
8. **All page code goes through `pageScript()` with an `__name` shim.** Found while planning: under `pnpm dev:all` (tsx, esbuild `keepNames`) today's tabs step serialises `function clickTab` as `…__name(clickTab,"clickTab")…`, the page has no `__name`, the evaluate throws and its `catch` hides it — tabs have been clicked only under vitest. After this plan, real captures click tabs for the first time; the live check is where that shows.

## File structure

| File | Responsibility |
|---|---|
| `packages/browser/src/overlays.ts` (create) | The rules and the page code: constants, pure helpers, DOM helpers, `entry…` functions, `pageScript()`, the exported script strings, `overlayWarning()` |
| `packages/browser/src/overlays.test.ts` (create) | Node unit tests of the pure helpers and of `pageScript()`'s shape |
| `packages/browser/src/overlays-page.test.ts` (create) | Chromium tests of the overlay definition, topmost/centre overlay, variant and never-click tests (via `setContentEvaluate`, no server) |
| `packages/browser/src/__fixtures__/overlay-pages.ts` (create) | Test-only: a local HTML server, a fixture product page, a page-state probe |
| `packages/browser/src/capture-expand-overlays.test.ts` (create) | Chromium capture tests of §3.2 |
| `packages/browser/src/capture-dismiss.test.ts` (create) | Chromium capture tests of §3.3 |
| `packages/browser/src/capture-final-pass.test.ts` (create) | Chromium capture tests of §3.4 and §5.5 |
| `packages/browser/src/playwright-browser.ts` (modify) | `hrefNavigates` moves out (re-exported); `expandHiddenContent`, `dismissPopups` rewritten; `capture()` final pass |
| `docs/testing/capture-overlays-check.mts` (create) | The free live check (probe.mts mode A, adapted), with a `--self-test` |
| `docs/handoff.md`, `CLAUDE.md`, the spec, `docs/testing/2026-10-11-campaign-2.md` (modify) | Docs |

---

### Task 1: The overlay module — definition, names, never-click rules, `pageScript`

**Files:**
- Create: `packages/browser/src/overlays.ts`
- Create: `packages/browser/src/overlays.test.ts`
- Create: `packages/browser/src/overlays-page.test.ts`
- Modify: `packages/browser/src/playwright-browser.ts:139-157` (`hrefNavigates` moves to `overlays.ts`, re-exported)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (exported from `./overlays.js`):
  - `CLOSE_WORDS: readonly string[]`, `ROBOT_STATE_KEY: string`
  - `normName(s: string | null | undefined): string`
  - `isDismissName(name: string | null | undefined, wanted: string): boolean`
  - `isCloseWord(name: string | null | undefined): boolean`
  - `isSettingsName(name: string | null | undefined): boolean`
  - `hasVariantClassWord(className: string | null | undefined): boolean`
  - `interface VariantFacts { tag; role; ariaPressed; ariaChecked; inChoiceGroup; choiceInput; className }`, `isVariantControlFacts(f: VariantFacts): boolean`
  - `isFileLink(href: string | null | undefined): boolean`
  - `hrefNavigates(link: { href: string | null; target: string | null } | null): boolean`
  - `interface Box { top; left; width; height }`, `coverage(rect: Box, vw: number, vh: number): number`
  - `interface OverlayFacts { tag; id; className; role; ariaModal; openDialog; position; rect: Box; vw; vh; holdsPage }`, `overlayByFacts(f: OverlayFacts): boolean`
  - `interface OverlayDescription { tag: string; id: string; text: string }`
  - `PAGE_PRELUDE: string`, `pageScript(entry: ((...args: never[]) => unknown) | string, arg?: unknown): string`
  - `LIST_OVERLAYS_SCRIPT`, `TOPMOST_OVERLAY_SCRIPT`, `CENTRE_OVERLAY_SCRIPT` (strings; evaluate to `OverlayDescription[]`, `OverlayDescription | null`, `OverlayDescription | null`)
  - Page-only names later tasks call inside the page: `robotState()` (fields `clicked`, `tried`, `baseline`, `pending`, `last`, `lastHost`), `classOf`, `parentOf`, `searchRoots`, `queryDeep(roots, selector)`, `isShown`, `holdsPage`, `isOverlay`, `outermostOverlay`, `listOverlayEls`, `centreOverlayEl`, `topmostOverlayEl`, `describeEl`, `accessibleName`, `isVariantControl`, `neverDismiss`.

- [ ] **Step 0: Install the worktree's dependencies (it has no `node_modules`)**

Run (Bash): `cd /c/Users/Marko/Documents/projects/robot-platform-captures && pnpm install --frozen-lockfile`
Expected: completes; `packages/browser/node_modules/.bin/vitest` exists. If `pnpm` is "not recognized", run `npm i -g pnpm@10.30.3` and retry (the standalone launcher on this machine is broken). Chromium is already installed in the user's Playwright cache.

Then: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/dismiss-navigation.test.ts`
Expected: PASS (7 tests) — the baseline works.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/browser/src/overlays.test.ts`:

```ts
// The pure halves of the overlay rules (spec 2026-10-19 §3.1, §3.3.1, §3.3.2, §3.3.4). They run in
// Node here and, inside pageScript(), in the page.
import { describe, it, expect } from 'vitest';
import {
  CLOSE_WORDS, PAGE_PRELUDE, coverage, hasVariantClassWord, isCloseWord, isDismissName, isFileLink,
  isSettingsName, isVariantControlFacts, normName, overlayByFacts, pageScript,
  type OverlayFacts, type VariantFacts,
} from './overlays.js';

describe('normName', () => {
  it('trims, collapses whitespace and case-folds', () => {
    expect(normName('  OK \n')).toBe('ok');
    expect(normName('Accept\n  All')).toBe('accept all');
    expect(normName('Schließen')).toBe('schließen');
    expect(normName(null)).toBe('');
  });
});

describe('isDismissName — whole names, not substrings (§3.3.1)', () => {
  it('matches the whole name, in any case and spacing', () => {
    expect(isDismissName('OK', 'ok')).toBe(true);
    expect(isDismissName(' Ok ', 'OK')).toBe(true);
    expect(isDismissName('OK, got it', 'ok, got it')).toBe(true);
  });
  it('never matches a name that merely contains the text — the ikea, skullcandy and puma clicks', () => {
    expect(isDismissName('Cookie settings', 'ok')).toBe(false);
    expect(isDismissName('look', 'ok')).toBe(false);
    expect(isDismissName('Rosy Outlook', 'ok')).toBe(false);
  });
  it('an empty name matches nothing', () => {
    expect(isDismissName('', '')).toBe(false);
    expect(isDismissName(null, 'ok')).toBe(false);
  });
});

describe('isCloseWord (§3.3.4)', () => {
  it('knows the close words in the languages the campaign met', () => {
    for (const w of ['Close', 'Schließen', 'schliessen', 'Fermer', 'Cerrar', 'Chiudi', 'Sluiten', 'Fechar', 'Zamknij', 'Stäng', 'Luk', 'Lukk', 'Sulje', '×', '✕', 'X', 'Dismiss', 'No thanks', 'Not now', 'Continue shopping', 'Stay here']) {
      expect(isCloseWord(w), w).toBe(true);
    }
    expect(CLOSE_WORDS).toHaveLength(21);
  });
  it('is a whole-name test too', () => {
    expect(isCloseWord('Close dialog')).toBe(false);
    expect(isCloseWord('Closet')).toBe(false);
    expect(isCloseWord('Add to bag')).toBe(false);
    expect(isCloseWord('')).toBe(false);
  });
});

describe("isSettingsName — never the page's settings (§3.3.2)", () => {
  it('names settings, preferences, manage, customise, options or more info, in any case', () => {
    for (const n of ['Cookie settings', 'Manage preferences', 'Customise', 'Customize cookies', 'OPTIONS', 'More info', 'manage']) {
      expect(isSettingsName(n), n).toBe(true);
    }
  });
  it('leaves accept and close names alone', () => {
    for (const n of ['Accept all', 'OK', 'Close', 'Got it', 'Optionsbar', '']) expect(isSettingsName(n), n).toBe(false);
  });
});

describe('isVariantControlFacts — never a variant control (§3.3.2)', () => {
  const none: VariantFacts = { tag: 'BUTTON', role: null, ariaPressed: false, ariaChecked: false, inChoiceGroup: false, choiceInput: false, className: '' };
  it('a plain button is not a variant control', () => {
    expect(isVariantControlFacts(none)).toBe(false);
    expect(isVariantControlFacts({ ...none, className: 'btn btn--primary' })).toBe(false);
  });
  it('aria-pressed, aria-checked, radio/option/tab roles and inputs are', () => {
    expect(isVariantControlFacts({ ...none, ariaPressed: true })).toBe(true);
    expect(isVariantControlFacts({ ...none, ariaChecked: true })).toBe(true);
    expect(isVariantControlFacts({ ...none, role: 'Radio' })).toBe(true);
    expect(isVariantControlFacts({ ...none, role: 'option' })).toBe(true);
    expect(isVariantControlFacts({ ...none, role: 'tab' })).toBe(true);
    expect(isVariantControlFacts({ ...none, tag: 'INPUT' })).toBe(true);
  });
  it('anything in a fieldset, radiogroup or listbox, or wrapping a radio, is', () => {
    expect(isVariantControlFacts({ ...none, inChoiceGroup: true })).toBe(true);
    expect(isVariantControlFacts({ ...none, choiceInput: true })).toBe(true);
  });
  it('a class word containing swatch or variant is — the "Rosy Outlook" swatch', () => {
    expect(isVariantControlFacts({ ...none, className: 'product-swatch__item' })).toBe(true);
    expect(isVariantControlFacts({ ...none, className: 'pill VariantPill' })).toBe(true);
    expect(hasVariantClassWord('ProductSwatch')).toBe(true);
    expect(hasVariantClassWord('')).toBe(false);
  });
});

describe('isFileLink (§3.2.6)', () => {
  it('a link to a document is a file', () => {
    expect(isFileLink('/files/manual.pdf')).toBe(true);
    expect(isFileLink('https://x.test/a/B.PDF?v=2')).toBe(true);
    expect(isFileLink('/doc.pdf#page=2')).toBe(true);
    expect(isFileLink('/sheet.xlsx')).toBe(true);
  });
  it('a page, a fragment or nothing is not', () => {
    expect(isFileLink('/p/sofa')).toBe(false);
    expect(isFileLink('#specs')).toBe(false);
    expect(isFileLink('/pdf-guide')).toBe(false);
    expect(isFileLink(null)).toBe(false);
  });
});

describe('coverage', () => {
  it('is the share of the window a box covers, clipped to the window', () => {
    expect(coverage({ top: 0, left: 0, width: 1280, height: 800 }, 1280, 800)).toBe(1);
    expect(coverage({ top: -400, left: 0, width: 1280, height: 800 }, 1280, 800)).toBe(0.5);
    expect(coverage({ top: 0, left: 1280, width: 400, height: 800 }, 1280, 800)).toBe(0);
    expect(coverage({ top: 0, left: 0, width: 10, height: 10 }, 0, 0)).toBe(0);
  });
});

describe('overlayByFacts — the one definition (§3.1)', () => {
  const base: OverlayFacts = {
    tag: 'div', id: '', className: '', role: null, ariaModal: null, openDialog: false, position: 'static',
    rect: { top: 0, left: 0, width: 1280, height: 800 }, vw: 1280, vh: 800, holdsPage: false,
  };
  const small = { top: 600, left: 20, width: 300, height: 120 };
  it('a dialog by role, aria-modal or an open <dialog> is an overlay at any size', () => {
    expect(overlayByFacts({ ...base, role: 'dialog', rect: small })).toBe(true);
    expect(overlayByFacts({ ...base, role: 'alertdialog', rect: small })).toBe(true);
    expect(overlayByFacts({ ...base, ariaModal: 'true', rect: small })).toBe(true);
    expect(overlayByFacts({ ...base, openDialog: true, rect: small })).toBe(true);
  });
  it('a box named modal/drawer/lightbox/popup/dialog counts when fixed or absolute and a quarter of the window', () => {
    expect(overlayByFacts({ ...base, className: 'modal-wrapper', position: 'absolute', rect: { top: 0, left: 0, width: 800, height: 500 } })).toBe(true);
    expect(overlayByFacts({ ...base, tag: 'modal-dialog', position: 'fixed' })).toBe(true);
    expect(overlayByFacts({ ...base, id: 'size-drawer', position: 'fixed', rect: { top: 0, left: 800, width: 480, height: 800 } })).toBe(true);
    expect(overlayByFacts({ ...base, className: 'modal-wrapper', position: 'absolute', rect: { top: 0, left: 0, width: 300, height: 200 } })).toBe(false);
    expect(overlayByFacts({ ...base, className: 'modal', position: 'static' })).toBe(false);
  });
  it('any fixed box covering a quarter is an overlay — the puma location popup', () => {
    expect(overlayByFacts({ ...base, tag: 'section', position: 'fixed' })).toBe(true);
    expect(overlayByFacts({ ...base, position: 'absolute' })).toBe(false);
  });
  it('but not the page\'s header or footer', () => {
    expect(overlayByFacts({ ...base, tag: 'header', position: 'fixed' })).toBe(false);
    expect(overlayByFacts({ ...base, tag: 'nav', position: 'fixed', rect: { top: 0, left: 0, width: 400, height: 800 } })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'navigation', position: 'fixed', rect: { top: 0, left: 0, width: 400, height: 800 } })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'banner', position: 'fixed' })).toBe(false);
    // A band under 200 px at the top or bottom edge (a window short enough for it to cover a quarter).
    expect(overlayByFacts({ ...base, position: 'fixed', vh: 600, rect: { top: 0, left: 0, width: 1280, height: 180 } })).toBe(false);
    expect(overlayByFacts({ ...base, position: 'fixed', vh: 600, rect: { top: 420, left: 0, width: 1280, height: 180 } })).toBe(false);
    expect(overlayByFacts({ ...base, position: 'fixed', vh: 600, rect: { top: 200, left: 0, width: 1280, height: 180 } })).toBe(true);
  });
  it('a fixed box off the window covers nothing', () => {
    expect(overlayByFacts({ ...base, position: 'fixed', rect: { top: 0, left: 1280, width: 480, height: 800 } })).toBe(false);
  });
  it('the page itself is never an overlay — an app shell (plan departure 1)', () => {
    expect(overlayByFacts({ ...base, position: 'fixed', holdsPage: true })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'dialog', holdsPage: true })).toBe(false);
  });
});

describe('pageScript', () => {
  it('starts with the __name shim the dev runtime needs', () => {
    expect(PAGE_PRELUDE).toBe('var __name = (fn) => fn;');
    expect(pageScript('1')).toContain(`(() => {\n${PAGE_PRELUDE}\n`);
  });
  it('carries the constants and every page function by name', () => {
    const s = pageScript('1');
    expect(s).toContain('const CLOSE_WORDS = [');
    expect(s).toContain('const ROBOT_STATE_KEY = "__robotCapture";');
    for (const name of ['normName', 'overlayByFacts', 'hrefNavigates', 'isOverlay', 'outermostOverlay', 'listOverlayEls', 'topmostOverlayEl', 'accessibleName', 'neverDismiss', 'robotState', 'queryDeep']) {
      expect(s).toContain(`function ${name}(`);
    }
  });
  it('a string entry is an expression; a function entry is called with its argument as JSON', () => {
    expect(pageScript('2 + 2').trimEnd().endsWith('return (2 + 2);\n})()')).toBe(true);
    const s = pageScript(function entryEcho(x: { a: string }) { return x.a; } as (...args: never[]) => unknown, { a: "it's" });
    expect(s).toContain('({"a":"it\'s"})');
  });
});
```

Note on the last test: the inline `function entryEcho` is only stringified and checked, never run, so it may live in the test file.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/overlays.test.ts`
Expected: FAIL — `Failed to resolve import "./overlays.js"`.

- [ ] **Step 3: Write `overlays.ts`**

Create `packages/browser/src/overlays.ts`:

```ts
// What a capture closes, and what it must never open or click.
// Spec: docs/superpowers/specs/2026-10-19-capture-overlays-design.md
//
// One module, two runtimes. The pure helpers run in Node (unit tests) and in the page; the DOM
// helpers and the `entry…` functions run only in the page, sent as a string that pageScript()
// assembles: PAGE_PRELUDE, every constant in PAGE_CONSTANTS, the source of every function in
// PAGE_FUNCTIONS, then the call. Three rules keep that working:
//  1. A function that runs in the page names only constants and functions declared in THIS module —
//     never an import. Vitest rewrites an imported name to `__vi_import_0__.name`, which the page
//     does not have.
//  2. Every page function is a `function` declaration listed in PAGE_FUNCTIONS (the page throws
//     ReferenceError on one that is not), and every constant it reads is in PAGE_CONSTANTS.
//  3. Every script starts with PAGE_PRELUDE. Under the dev runtime (tsx: esbuild with keepNames) a
//     nested function's source reads `__name(fn, "name")`, and the page has no `__name`. The tabs
//     step this module replaces threw on exactly that under `pnpm dev:all`, and its catch hid it.

// ---- Constants ------------------------------------------------------------------------------

/** Names of a close control inside the topmost overlay (§3.3.4), case-folded. */
export const CLOSE_WORDS: readonly string[] = [
  'close', 'schließen', 'schliessen', 'fermer', 'cerrar', 'chiudi', 'sluiten', 'fechar', 'zamknij',
  'stäng', 'luk', 'lukk', 'sulje', '×', '✕', 'x', 'dismiss', 'no thanks', 'not now',
  'continue shopping', 'stay here',
];

/** The window property holding the capture's in-page memory. Not enumerable; never in the HTML. */
export const ROBOT_STATE_KEY = '__robotCapture';

// ---- Pure: names --------------------------------------------------------------------------------

/** Trimmed, whitespace-collapsed, case-folded — the form every name comparison uses. */
export function normName(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whole names, not substrings (§3.3.1). `button:has-text("OK")` matched "Cookie settings" (ikea:
 * opened the preference centre), a review chip "look" (skullcandy) and the swatch "Rosy Outlook"
 * (puma: changed the variant). A name is the text, or it is not.
 */
export function isDismissName(name: string | null | undefined, wanted: string): boolean {
  const n = normName(name);
  return n !== '' && n === normName(wanted);
}

/** Is this name one of the close words (§3.3.4)? Whole names only. */
export function isCloseWord(name: string | null | undefined): boolean {
  const n = normName(name);
  return n !== '' && CLOSE_WORDS.includes(n);
}

/** Settings, preferences, manage, customise/customize, options or more info, as a word (§3.3.2). */
export function isSettingsName(name: string | null | undefined): boolean {
  return /(^|[^\p{L}])(settings|preferences|manage|customi[sz]e|options|more info)(?=$|[^\p{L}])/u.test(normName(name));
}

/** Does a class attribute have a word containing "swatch" or "variant"? */
export function hasVariantClassWord(className: string | null | undefined): boolean {
  return (className ?? '').split(/\s+/).some((w) => /swatch|variant/i.test(w));
}

export interface VariantFacts {
  tag: string;
  role: string | null;
  ariaPressed: boolean;
  ariaChecked: boolean;
  /** Inside a fieldset, `[role=radiogroup]` or `[role=listbox]`. */
  inChoiceGroup: boolean;
  /** Wraps a radio/checkbox input, or is a `<label>` for one. */
  choiceInput: boolean;
  className: string;
}

/** A control that picks what the page shows — dismissal never clicks one outside an overlay (§3.3.2, §5.1). */
export function isVariantControlFacts(f: VariantFacts): boolean {
  if (f.ariaPressed || f.ariaChecked) return true;
  const role = normName(f.role);
  if (role === 'radio' || role === 'option' || role === 'tab') return true;
  if (f.tag.toLowerCase() === 'input') return true;
  if (f.inChoiceGroup || f.choiceInput) return true;
  return hasVariantClassWord(f.className);
}

// ---- Pure: links --------------------------------------------------------------------------------

/** A link to a document rather than a page (§3.2.6: ikea's tabs step clicked its PDFs). */
export function isFileLink(href: string | null | undefined): boolean {
  if (!href) return false;
  return /\.(pdf|docx?|xlsx?|pptx?|zip|csv|rtf|odt|ods|epub)(?:[?#]|$)/i.test(href.trim());
}

/**
 * Given the nearest enclosing anchor (or null), would clicking it leave the page?
 *
 * An anchor is only dangerous if it actually goes somewhere. `<a href="#">` and
 * `href="javascript:void(0)"` are the standard way to build a close button, and a
 * blanket "never click an anchor" rule would break dismissal on many real sites —
 * so the guard has to be about the destination, not the tag.
 *
 * (Moved here from playwright-browser.ts, which re-exports it: the page needs it too.)
 */
export function hrefNavigates(link: { href: string | null; target: string | null } | null): boolean {
  if (!link?.href) return false;
  const href = link.href.trim().toLowerCase();
  if (href === '' || href === '#' || href.startsWith('#')) return false;
  if (href.startsWith('javascript:')) return false;
  // Opens a new tab; the page we are capturing stays put.
  if (link.target === '_blank') return false;
  return true;
}

// ---- Pure: the overlay definition (§3.1) -------------------------------------------------------

export interface Box { top: number; left: number; width: number; height: number }

/** The share of the window (0–1) a box covers, clipped to the window. */
export function coverage(rect: Box, vw: number, vh: number): number {
  if (vw <= 0 || vh <= 0) return 0;
  const w = Math.max(0, Math.min(rect.left + rect.width, vw) - Math.max(rect.left, 0));
  const h = Math.max(0, Math.min(rect.top + rect.height, vh) - Math.max(rect.top, 0));
  return (w * h) / (vw * vh);
}

export interface OverlayFacts {
  tag: string;
  id: string;
  className: string;
  role: string | null;
  ariaModal: string | null;
  openDialog: boolean;
  /** Computed `position`. */
  position: string;
  rect: Box;
  vw: number;
  vh: number;
  /** Contains the page's `main` or its first `h1`: the element IS the page (plan departure 1). */
  holdsPage: boolean;
}

/**
 * Is a VISIBLE element an overlay (§3.1)? Visibility is the caller's check (isShown in the page).
 * One definition, used by the expand pass's skips and undo, by dismissal's topmost layer and
 * removal pass, and by the final warning.
 */
export function overlayByFacts(f: OverlayFacts): boolean {
  if (f.holdsPage) return false;
  const role = normName(f.role);
  if (role === 'dialog' || role === 'alertdialog' || normName(f.ariaModal) === 'true' || f.openDialog) return true;
  const quarter = coverage(f.rect, f.vw, f.vh) >= 0.25;
  if (!quarter) return false;
  const named = /modal|drawer|lightbox|popup|dialog/i.test(`${f.tag} ${f.id} ${f.className}`);
  if (named && (f.position === 'fixed' || f.position === 'absolute')) return true;
  if (f.position !== 'fixed') return false;
  const tag = f.tag.toLowerCase();
  if (tag === 'header' || tag === 'footer' || tag === 'nav' || role === 'banner' || role === 'navigation') return false;
  const atEdge = f.rect.top <= 0 || f.rect.top + f.rect.height >= f.vh;
  return !(f.rect.height < 200 && atEdge);
}

/** What a log line or a test needs to name an overlay. */
export interface OverlayDescription { tag: string; id: string; text: string }

// ---- Page only: DOM helpers -----------------------------------------------------------------------

interface RobotState {
  /** Expand pass: every control clicked (or already expanded when the pass began). */
  clicked: WeakSet<Element>;
  /** Dismissal: every element clicked once; never clicked again in this capture. */
  tried: WeakSet<Element>;
  /** Expand pass: the overlays present before the current round. */
  baseline: Set<Element>;
  /** Expand pass: the overlays that appeared during the current round. */
  pending: Element[];
  /** Dismissal: the element last clicked, and the layer it sits in. */
  last: Element | null;
  lastHost: Element | null;
}

/** The capture's memory inside this document. A navigation starts it fresh. */
function robotState(): RobotState {
  const w = window as unknown as Record<string, RobotState | undefined>;
  let s = w[ROBOT_STATE_KEY];
  if (!s) {
    s = { clicked: new WeakSet(), tried: new WeakSet(), baseline: new Set(), pending: [], last: null, lastHost: null };
    Object.defineProperty(window, ROBOT_STATE_KEY, { value: s, enumerable: false, configurable: true, writable: true });
  }
  return s;
}

/** An element's class attribute as a string (an SVG element's `className` is not one). */
function classOf(el: Element): string {
  const c = (el as HTMLElement).className as unknown;
  return typeof c === 'string' ? c : (el.getAttribute('class') ?? '');
}

/** The parent element, crossing out of a shadow root to its host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

/** The document and every open shadow root inside it (Playwright's selectors reached those). */
function searchRoots(): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of Array.from(roots[i].querySelectorAll('*'))) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return roots;
}

/** querySelectorAll across the given roots; an invalid selector yields what was found so far. */
function queryDeep(roots: Array<Document | ShadowRoot>, selector: string): Element[] {
  const out: Element[] = [];
  for (const root of roots) {
    try {
      out.push(...Array.from(root.querySelectorAll(selector)));
    } catch {
      return out;
    }
  }
  return out;
}

/** Has a box, not display:none, not visibility:hidden, opacity above 0 (§3.1). */
function isShown(el: Element): boolean {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Does this element contain the page itself — its `main` or its first `h1`? */
function holdsPage(el: Element): boolean {
  const main = document.querySelector('main');
  const h1 = document.querySelector('h1');
  return (main !== null && el.contains(main)) || (h1 !== null && el.contains(h1));
}

/** The §3.1 definition, applied to a live element. */
function isOverlay(el: Element): boolean {
  if (el === document.documentElement || el === document.body || !isShown(el)) return false;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return overlayByFacts({
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className: classOf(el),
    role: el.getAttribute('role'),
    ariaModal: el.getAttribute('aria-modal'),
    openDialog: el.tagName === 'DIALOG' && (el as HTMLDialogElement).open,
    position: s.position,
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    vw: window.innerWidth,
    vh: window.innerHeight,
    holdsPage: holdsPage(el),
  });
}

/** The outermost overlay this element sits in (itself included), or null. */
function outermostOverlay(el: Element): Element | null {
  let found: Element | null = null;
  for (let e: Element | null = el; e && e !== document.body && e !== document.documentElement; e = parentOf(e)) {
    if (isOverlay(e)) found = e;
  }
  return found;
}

/**
 * Every overlay on the page, in document order, shadow roots included. Cheap first: an element
 * that is not dialog-like and covers less than a quarter of the window never gets a computed style.
 */
function listOverlayEls(): Element[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Element[] = [];
  for (const el of queryDeep(searchRoots(), '*')) {
    if (!el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')) {
      const r = el.getBoundingClientRect();
      if (coverage({ top: r.top, left: r.left, width: r.width, height: r.height }, vw, vh) < 0.25) continue;
    }
    if (isOverlay(el)) out.push(el);
  }
  return out;
}

/** The overlay the browser hit-tests first at the window's centre (into open shadow roots), or null. */
function centreOverlayEl(): Element | null {
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  let hit = document.elementFromPoint(x, y);
  while (hit && hit.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit ? outermostOverlay(hit) : null;
}

/** §3.1's topmost overlay: the one at the centre, failing that the one with the highest z-index. */
function topmostOverlayEl(): Element | null {
  const atCentre = centreOverlayEl();
  if (atCentre) return atCentre;
  let best: Element | null = null;
  let bestZ = -Infinity;
  for (const el of listOverlayEls()) {
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    const zz = Number.isNaN(z) ? 0 : z;
    if (zz >= bestZ) { best = el; bestZ = zz; }
  }
  return best ? (outermostOverlay(best) ?? best) : null;
}

function describeEl(el: Element): OverlayDescription {
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { tag: el.tagName.toLowerCase(), id: el.id || '', text };
}

/** A control's accessible name, close enough: aria-label, aria-labelledby, text, value, title. */
function accessibleName(el: Element): string {
  const label = normName(el.getAttribute('aria-label'));
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = normName(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const text = normName((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;
  if (el instanceof HTMLInputElement) return normName(el.value);
  return normName(el.getAttribute('title'));
}

/** §3.3.2's variant control, read off a live element. */
function isVariantControl(el: Element): boolean {
  const control = el.tagName === 'LABEL' ? (el as HTMLLabelElement).control : null;
  return isVariantControlFacts({
    tag: el.tagName,
    role: el.getAttribute('role'),
    ariaPressed: el.hasAttribute('aria-pressed'),
    ariaChecked: el.hasAttribute('aria-checked'),
    inChoiceGroup: el.closest('fieldset, [role="radiogroup"], [role="listbox"]') !== null,
    choiceInput: el.querySelector('input[type="radio"], input[type="checkbox"]') !== null
      || (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')),
    className: classOf(el),
  });
}

/**
 * Dismissal never clicks this (§3.3.2): a variant control outside an overlay (a consent dialog's
 * own toggles are not the product's), anything named like settings, or a link that leaves the page.
 */
function neverDismiss(el: Element): boolean {
  if (isVariantControl(el) && outermostOverlay(el) === null) return true;
  if (isSettingsName(accessibleName(el))) return true;
  const a = el.closest('a');
  return hrefNavigates(a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null);
}

// ---- Page only: entries -------------------------------------------------------------------------

function entryListOverlays(): OverlayDescription[] {
  return listOverlayEls().map((el) => describeEl(el));
}

function entryTopmostOverlay(): OverlayDescription | null {
  const el = topmostOverlayEl();
  return el ? describeEl(el) : null;
}

function entryCentreOverlay(): OverlayDescription | null {
  const el = centreOverlayEl();
  return el ? describeEl(el) : null;
}

// ---- Script assembly. Keep at the end of the module: pageScript reads the constants above. -----

/** esbuild's keepNames helper, as a no-op: see rule 3 at the top. `var`, so a real one is harmless. */
export const PAGE_PRELUDE = 'var __name = (fn) => fn;';

/** Every constant page code reads, emitted as `const NAME = <json>;` under the same name. */
const PAGE_CONSTANTS: Record<string, unknown> = { CLOSE_WORDS, ROBOT_STATE_KEY };

/** Every function page code calls, emitted from its own source. */
const PAGE_FUNCTIONS: ReadonlyArray<(...args: never[]) => unknown> = [
  // pure
  normName, isDismissName, isCloseWord, isSettingsName, hasVariantClassWord, isVariantControlFacts,
  isFileLink, hrefNavigates, coverage, overlayByFacts,
  // DOM
  robotState, classOf, parentOf, searchRoots, queryDeep, isShown, holdsPage, isOverlay,
  outermostOverlay, listOverlayEls, centreOverlayEl, topmostOverlayEl, describeEl, accessibleName,
  isVariantControl, neverDismiss,
];

/**
 * A self-invoking page script: the prelude, the constants, every page function, then the entry.
 * A function entry is called with `arg` as JSON; a string entry is an expression over the helpers
 * (tests use that form, since a function written in a test file may not name the helpers).
 */
export function pageScript(entry: ((...args: never[]) => unknown) | string, arg?: unknown): string {
  const constants = Object.entries(PAGE_CONSTANTS).map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`).join('\n');
  const functions = PAGE_FUNCTIONS.map((fn) => fn.toString()).join('\n');
  const call = typeof entry === 'string'
    ? `(${entry})`
    : `(${entry.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
  return `(() => {\n${PAGE_PRELUDE}\n${constants}\n${functions}\nreturn ${call};\n})()`;
}

/** Every overlay on the page → `OverlayDescription[]`. */
export const LIST_OVERLAYS_SCRIPT = pageScript(entryListOverlays);
/** §3.1's topmost overlay → `OverlayDescription | null`. */
export const TOPMOST_OVERLAY_SCRIPT = pageScript(entryTopmostOverlay);
/** The overlay at the window's centre, if any → `OverlayDescription | null` (§3.4's warning). */
export const CENTRE_OVERLAY_SCRIPT = pageScript(entryCentreOverlay);
```

- [ ] **Step 4: Move `hrefNavigates` out of `playwright-browser.ts`**

In `packages/browser/src/playwright-browser.ts`, delete the whole `hrefNavigates` block — from the doc comment line `/**` above ` * Given the nearest enclosing anchor (or null), would clicking it leave the page?` through the function's closing `}` — and add, right after the existing `import { rowCountScript, stampScript, scopeExtractionScript } from './scroll-pages.js';` line:

```ts
import { hrefNavigates } from './overlays.js';
```

and, right after the `const isCrash = …` line:

```ts
// Moved to overlays.ts (the page needs it too); re-exported for existing importers.
export { hrefNavigates };
```

`navigatesAway` keeps calling `hrefNavigates` until Task 3 deletes it.

- [ ] **Step 5: Run the unit tests and the moved function's tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/overlays.test.ts`
Expected: PASS.
Run: `npx vitest run src/dismiss-navigation.test.ts`
Expected: PASS (7 tests; it imports `hrefNavigates` through the re-export).

- [ ] **Step 6: Write the failing page tests**

Create `packages/browser/src/overlays-page.test.ts`:

```ts
// The overlay definition (spec 2026-10-19 §3.1) and the never-click rules (§3.3.2), on a real DOM.
// setContentEvaluate injects HTML offline (no server, no network) at a 1280×800 window.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { CENTRE_OVERLAY_SCRIPT, LIST_OVERLAYS_SCRIPT, TOPMOST_OVERLAY_SCRIPT, pageScript, type OverlayDescription } from './overlays.js';

let browser: PlaywrightBrowser;
beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const ids = (list: OverlayDescription[]) => list.map((d) => d.id).sort();

const MIXED = `<!doctype html><html><body style="margin:0">
<header id="site-header" style="position:fixed;top:0;left:0;right:0;height:80px;background:#fff">Shop</header>
<div id="promo" style="position:fixed;left:0;right:0;bottom:0;height:150px;background:#eee">Free delivery</div>
<main id="product" style="min-height:2400px"><h1>Widget</h1></main>
<div id="consent" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;background:#fff">Cookies</div>
<div id="hidden-dialog" role="dialog" style="display:none">Hidden</div>
<div id="clear-dialog" role="dialog" style="position:fixed;inset:0;opacity:0">Faded</div>
<section id="geo" style="position:fixed;inset:0;background:rgba(0,0,0,.4)"><div style="margin:200px auto;width:400px;background:#fff">Choose location</div></section>
<div id="static-modal" class="modal" style="height:900px">Static</div>
<div id="abs-lightbox" class="lightbox" style="position:absolute;top:0;left:0;width:800px;height:500px">Lightbox</div>
<div id="abs-plain" style="position:absolute;top:0;left:0;width:1280px;height:800px;pointer-events:none"></div>
<div id="side-nav" role="navigation" style="position:fixed;top:0;left:0;width:400px;height:800px">Menu</div>
</body></html>`;

describe('the overlay definition in a real page (§3.1)', () => {
  it('lists dialogs, a fixed full-window box and a named absolute layer — not headers, footers, hidden or static boxes', async () => {
    const list = await browser.setContentEvaluate<OverlayDescription[]>(MIXED, LIST_OVERLAYS_SCRIPT);
    expect(ids(list)).toEqual(['abs-lightbox', 'consent', 'geo']);
    expect(list.find((d) => d.id === 'geo')).toEqual({ tag: 'section', id: 'geo', text: 'Choose location' });
  }, 30_000);

  it('a fixed full-window container holding the page is never an overlay (app shell)', async () => {
    const html = `<!doctype html><html><body style="margin:0"><div id="shell" style="position:fixed;inset:0;overflow:auto"><main><h1>Lamp</h1><div style="height:3000px"></div></main></div></body></html>`;
    expect(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT)).toEqual([]);
  }, 30_000);

  it('finds an overlay inside an open shadow root', async () => {
    const html = `<!doctype html><html><body><main><h1>Widget</h1></main><div id="host"></div>
      <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<div id="shadow-layer" style="position:fixed;inset:0;background:#000">Sign up</div>';</script></body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT))).toEqual(['shadow-layer']);
  }, 30_000);
});

describe('the topmost and the centre overlay', () => {
  it('the topmost is the one hit at the centre; an outer wrapper wins over its dialog', async () => {
    const html = `<!doctype html><html><body style="margin:0"><main style="min-height:2400px"><h1>Widget</h1></main>
      <div id="low" style="position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.3)"></div>
      <div id="wrap" class="modal-wrapper" style="position:fixed;inset:0;z-index:100"><div id="inner" role="dialog" style="width:600px;height:400px;margin:200px auto;background:#fff">Sign up</div></div>
      </body></html>`;
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, TOPMOST_OVERLAY_SCRIPT))?.id).toBe('wrap');
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, CENTRE_OVERLAY_SCRIPT))?.id).toBe('wrap');
  }, 30_000);

  it('failing the centre, the topmost is the overlay with the highest z-index; the centre has none', async () => {
    const html = `<!doctype html><html><body style="margin:0"><main style="min-height:2400px"><h1>Widget</h1></main>
      <div id="consent" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;z-index:5;background:#fff">Cookies</div>
      <div id="chat" role="dialog" style="position:fixed;right:20px;bottom:20px;width:300px;height:120px;z-index:50;background:#fff">Chat</div>
      </body></html>`;
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, TOPMOST_OVERLAY_SCRIPT))?.id).toBe('chat');
    expect(await browser.setContentEvaluate<OverlayDescription | null>(html, CENTRE_OVERLAY_SCRIPT)).toBeNull();
  }, 30_000);
});

describe('the never-click rules on live elements (§3.3.2)', () => {
  it('knows a variant control when it sees one', async () => {
    const html = `<!doctype html><html><body><main><h1>Shoe</h1>
      <button id="pressed" aria-pressed="false">Black</button>
      <button id="checked" role="radio" aria-checked="true">M</button>
      <div role="radiogroup"><span id="in-group">S</span></div>
      <fieldset><button id="in-fieldset">L</button></fieldset>
      <button id="swatch" class="product-swatch__item">Rosy Outlook</button>
      <button id="variant" class="variant-pill">Red</button>
      <input id="qty" type="number">
      <label id="size-label"><input type="radio" name="s">XL</label>
      <button id="tab" role="tab">Specs</button>
      <button id="ok">OK</button>
      <button id="look" class="chip">look</button>
      </main></body></html>`;
    const found = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('main [id]')).filter((el) => isVariantControl(el)).map((el) => el.id)",
    ));
    expect(found.sort()).toEqual(['checked', 'in-fieldset', 'in-group', 'pressed', 'qty', 'size-label', 'swatch', 'tab', 'variant']);
  }, 30_000);

  it('never dismisses a page swatch, a settings control or a link away — a consent dialog\'s own toggle is fine', async () => {
    const html = `<!doctype html><html><body><main><h1>Shoe</h1>
      <button id="swatch" class="swatch">Rosy Outlook</button>
      <button id="settings">Cookie settings</button>
      <button id="manage">Manage preferences</button>
      <a id="away" href="/other-product">OK</a>
      <a id="hash" href="#">Close</a>
      <button id="ok">OK</button>
      </main>
      <div role="dialog" style="position:fixed;bottom:0;left:0;width:400px;height:200px;background:#fff">
        <button id="consent-toggle" aria-pressed="false">Analytics</button>
        <button id="consent-more">More info</button>
      </div></body></html>`;
    const found = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('[id]')).filter((el) => neverDismiss(el)).map((el) => el.id)",
    ));
    expect(found.sort()).toEqual(['away', 'consent-more', 'manage', 'settings', 'swatch']);
  }, 30_000);
});

describe('the __name shim', () => {
  it('lets a keepNames-wrapped function run in the page (the dev runtime\'s output)', async () => {
    const html = '<!doctype html><html><body></body></html>';
    expect(await browser.setContentEvaluate<number>(html, pageScript("__name(() => 42, 'f')()"))).toBe(42);
  }, 30_000);
});
```

- [ ] **Step 7: Run the page tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/overlays-page.test.ts`
Expected: PASS (8 tests). If a list differs, the definition and the test disagree: fix `overlays.ts` against spec §3.1 (and departure 1), not the expected list. If the page throws `ReferenceError` (`__vi_…`, or a helper's name), a page function broke rule 1 or 2 at the top of `overlays.ts`.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no error in `src/overlays.ts`, `src/overlays.test.ts`, `src/overlays-page.test.ts`, `src/playwright-browser.ts`.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-captures
git add packages/browser/src/overlays.ts packages/browser/src/overlays.test.ts packages/browser/src/overlays-page.test.ts packages/browser/src/playwright-browser.ts
git commit -m "$(cat <<'EOF'
feat(browser): one overlay definition, whole-name and never-click rules, page scripts with the __name shim

Spec 2026-10-19 §3.1, §3.3.1, §3.3.2. overlays.ts holds the pure rules and the page code;
hrefNavigates moves there (re-exported) because the page needs it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The expand pass never opens an overlay

**Files:**
- Modify: `packages/browser/src/overlays.ts` (constants, `isDialogLikeFacts`, `opensLayer`, page helpers and entries, assembly lists, scripts)
- Modify: `packages/browser/src/overlays.test.ts` (append)
- Create: `packages/browser/src/__fixtures__/overlay-pages.ts`
- Create: `packages/browser/src/capture-expand-overlays.test.ts`
- Modify: `packages/browser/src/playwright-browser.ts` (`expandHiddenContent` rewritten, `undoNewOverlays` added, imports)

**Interfaces:**
- Consumes (Task 1): `normName`, `classOf`, `outermostOverlay`, `listOverlayEls`, `isShown`, `describeEl`, `robotState` (fields `clicked`, `baseline`, `pending`), `hrefNavigates`, `isFileLink`, `pageScript`, `OverlayDescription`.
- Produces:
  - exported constants `HASPOPUP_SKIP`, `EXPAND_SELECTORS`, `EXPAND_TEXT_PATTERN`
  - `interface ControlledFacts { tag; id; className; role; ariaModal; position }`, `isDialogLikeFacts(f: ControlledFacts): boolean`, `opensLayer(ariaHaspopup: string | null): boolean`
  - page-only `isDialogLike(el)`, `expandSkip(el)`, `liftScrollLock()` (Task 3's removal pass calls `liftScrollLock`)
  - scripts `EXPAND_START_SCRIPT` (→ number), `OVERLAY_BASELINE_SCRIPT` (→ number), `EXPAND_ROUND_SCRIPT` (→ number clicked/opened), `NEW_OVERLAYS_SCRIPT` (→ number), `REMOVE_NEW_OVERLAYS_SCRIPT` (→ `OverlayDescription[]`), `TABS_SCRIPT` (→ number)
  - test helpers in `src/__fixtures__/overlay-pages.ts`: `serveHtml(pages: Record<string, string>): Promise<HtmlSite>` (`{ baseUrl, requested: string[], close() }`), `fixturePage(main: string, outside?: string, script?: string): string`, `pageState(ids: string[]): string`, `interface PageState` — Tasks 3 and 4 use them.

- [ ] **Step 1: Write the failing unit tests**

Append to `packages/browser/src/overlays.test.ts` (and add `isDialogLikeFacts, opensLayer, type ControlledFacts` to its import from `./overlays.js`):

```ts
describe('opensLayer — aria-haspopup that means a layer (§3.2.1)', () => {
  it('dialog, true, menu, listbox, grid and tree open a layer', () => {
    for (const v of ['dialog', 'true', 'menu', 'listbox', 'grid', 'tree', ' Dialog ']) expect(opensLayer(v), v).toBe(true);
  });
  it('false, empty or absent does not', () => {
    for (const v of ['false', '', null]) expect(opensLayer(v), String(v)).toBe(false);
  });
});

describe('isDialogLikeFacts — an aria-controls target that is a layer (§3.2.2)', () => {
  const panel: ControlledFacts = { tag: 'DIV', id: 'acc-panel', className: 'accordion__panel', role: 'region', ariaModal: null, position: 'static' };
  it('a plain panel is not', () => {
    expect(isDialogLikeFacts(panel)).toBe(false);
  });
  it('a dialog role, aria-modal or <dialog> is — kith\'s size drawer', () => {
    expect(isDialogLikeFacts({ ...panel, role: 'dialog' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, role: 'alertdialog' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, ariaModal: 'true' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, tag: 'DIALOG' })).toBe(true);
  });
  it('a tag, id or class naming a modal, drawer, lightbox or popup is', () => {
    expect(isDialogLikeFacts({ ...panel, tag: 'S-DRAWER' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, id: 'ProductSizeDrawer' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, className: 'fit-modal' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, className: 'zoom-lightbox' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, id: 'popup-1' })).toBe(true);
  });
  it('a fixed target is', () => {
    expect(isDialogLikeFacts({ ...panel, position: 'fixed' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/overlays.test.ts`
Expected: FAIL — `opensLayer` / `isDialogLikeFacts` is not exported (`is not a function`).

- [ ] **Step 3: Add the pure pieces to `overlays.ts`**

In `packages/browser/src/overlays.ts`, after the `ROBOT_STATE_KEY` constant, add:

```ts
/** aria-haspopup values that mean "this opens a layer", not "this reveals a panel" (§3.2.1). */
export const HASPOPUP_SKIP: readonly string[] = ['dialog', 'true', 'menu', 'listbox', 'grid', 'tree'];

/** The structural controls the expand pass clicks (today's Phase 1 list, unchanged). */
export const EXPAND_SELECTORS: readonly string[] = [
  'main details:not([open]) summary',
  'article details:not([open]) summary',
  'main [aria-expanded="false"]',
  'article [aria-expanded="false"]',
  'main [data-toggle="collapse"]',
  'article [data-toggle="collapse"]',
];

/** "Show more" and friends, as a RegExp source (today's Phase 2 pattern, unchanged). */
export const EXPAND_TEXT_PATTERN = '^(show more|see more|see all|view details|read more|expand|view all|load more|\\+ more|show all)$';
```

After `overlayByFacts`, add:

```ts
// ---- Pure: what the expand pass must not click (§3.2) -------------------------------------------

/** Does this aria-haspopup value say the control opens a layer? */
export function opensLayer(ariaHaspopup: string | null): boolean {
  return HASPOPUP_SKIP.includes(normName(ariaHaspopup));
}

export interface ControlledFacts {
  tag: string;
  id: string;
  className: string;
  role: string | null;
  ariaModal: string | null;
  /** Computed `position` (it is computed even while the target is display:none). */
  position: string;
}

/** Is an aria-controls target a layer rather than a panel (§3.2.2)? */
export function isDialogLikeFacts(f: ControlledFacts): boolean {
  const role = normName(f.role);
  if (role === 'dialog' || role === 'alertdialog' || normName(f.ariaModal) === 'true' || f.tag.toLowerCase() === 'dialog') return true;
  if (/modal|drawer|lightbox|popup/i.test(`${f.tag} ${f.id} ${f.className}`)) return true;
  return f.position === 'fixed';
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/overlays.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the fixture helper**

Create `packages/browser/src/__fixtures__/overlay-pages.ts`:

```ts
// Test-only: fixture product pages for the capture-overlay tests, served over real HTTP so
// capture() navigates as it does on a site. Every requested path is logged, so a test can prove
// that a link was never followed.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface HtmlSite {
  baseUrl: string;
  /** Every path requested, in order (query strings dropped). */
  requested: string[];
  close(): Promise<void>;
}

/** Serve `pages` (path → HTML); anything else is a small 404 page. */
export async function serveHtml(pages: Record<string, string>): Promise<HtmlSite> {
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requested.push(path);
    const html = pages[path];
    if (html === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    requested,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The page's own bookkeeping: every click on an element with an id (capture phase, so a click the
 * page swallows still counts), every layer it opens, and free-form flags.
 */
export const TRACK_SCRIPT = `window.__clicks = []; window.__opened = {}; window.__flags = {};
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest ? e.target.closest('[id]') : null;
  if (t && t.id !== 'product') window.__clicks.push(t.id);
}, true);
function openLayer(id) { const d = document.getElementById(id); d.style.display = 'block'; d.setAttribute('open', ''); window.__opened[id] = (window.__opened[id] || 0) + 1; }
function shutLayer(id) { const d = document.getElementById(id); if (d) { d.style.display = 'none'; d.removeAttribute('open'); } }`;

/**
 * A product page: `main#product` tall enough that the window's centre sits on it, then `outside`
 * (layers, banners), then the bookkeeping and `script`.
 */
export function fixturePage(main: string, outside = '', script = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Widget</title></head>
<body style="margin:0;font:16px sans-serif">
<main id="product" style="min-height:2400px"><h1>Widget</h1><p id="price">$12.50</p>${main}</main>
${outside}
<script>${TRACK_SCRIPT}
${script}</script>
</body></html>`;
}

export interface PageState {
  clicks: string[];
  opened: Record<string, number>;
  flags: Record<string, unknown>;
  /** 'product' when the window's centre is on the product, else the id or tag hit there. */
  centre: string | null;
  shown: Record<string, boolean>;
  exists: Record<string, boolean>;
  pressed: Record<string, string | null>;
  bodyOverflowY: string;
  detailsOpen: Record<string, boolean>;
  scrollY: number;
}

/** An `annotate` script: capture() runs it after its last pass, just before the screenshot. */
export function pageState(ids: string[]): string {
  return `(() => {
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const shown = (id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const ids = ${JSON.stringify(ids)};
  return {
    clicks: window.__clicks || [],
    opened: window.__opened || {},
    flags: window.__flags || {},
    centre: hit && hit.closest('#product') ? 'product' : (hit ? (hit.id || hit.tagName.toLowerCase()) : null),
    shown: Object.fromEntries(ids.map((id) => [id, shown(id)])),
    exists: Object.fromEntries(ids.map((id) => [id, !!document.getElementById(id)])),
    pressed: Object.fromEntries(Array.from(document.querySelectorAll('[aria-pressed][id]')).map((el) => [el.id, el.getAttribute('aria-pressed')])),
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    detailsOpen: Object.fromEntries(Array.from(document.querySelectorAll('details[id]')).map((d) => [d.id, d.open])),
    scrollY: Math.round(window.scrollY),
  };
})()`;
}
```

- [ ] **Step 6: Write the failing capture tests**

Create `packages/browser/src/capture-expand-overlays.test.ts`:

```ts
// Spec 2026-10-19 §3.2: the expand pass reveals what belongs in the page and never leaves an
// overlay over it. The four expand-pass sites of campaign 2 (colourpop, mejuri, kith, thomann),
// mejuri's single-open accordion and the tabs that followed links (thomann, ikea), as fixtures.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { fixturePage, pageState, serveHtml, type HtmlSite, type PageState } from './__fixtures__/overlay-pages.js';

const ZOOM_MODAL = `<modal-dialog id="zoom-modal" style="display:none;position:fixed;inset:0;z-index:100;background:#000;color:#fff">Zoomed image</modal-dialog>`;
const OPEN_ZOOM = `document.getElementById('zoom').addEventListener('click', () => { openLayer('zoom-modal'); document.body.style.overflow = 'hidden'; });`;

const PAGES: Record<string, string> = {
  // colourpop: a Zoom button that says nothing about the lightbox it opens; Escape closes it.
  '/zoom': fixturePage(`<button id="zoom" aria-expanded="false">Zoom</button>`, ZOOM_MODAL,
    `${OPEN_ZOOM}
     document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { shutLayer('zoom-modal'); document.body.style.overflow = ''; window.__flags.escaped = true; } });`),
  // The same lightbox, deaf to Escape: removed, and the scroll lock lifted.
  '/zoom-deaf': fixturePage(`<button id="zoom" aria-expanded="false">Zoom</button>`, ZOOM_MODAL, OPEN_ZOOM),
  // mejuri, thomann, kith: controls that declare the layer they open.
  '/dialog-triggers': fixturePage(
    `<button id="sg" aria-haspopup="dialog" aria-expanded="false">Size guide</button>
     <a id="warn" href="#" aria-haspopup="dialog" aria-expanded="false">Safety and warnings</a>
     <button id="drawer-btn" aria-expanded="false" aria-controls="size-drawer">View size guide</button>
     <button id="fit-btn" aria-expanded="false" aria-controls="fit-modal">Don't see your size?</button>`,
    `<div id="sg-dialog" role="dialog" style="display:none;position:fixed;inset:10%;background:#fff;z-index:50">Size guide</div>
     <s-drawer id="size-drawer" role="dialog" style="display:none;position:fixed;top:0;right:0;width:480px;height:100%;background:#fff;z-index:50">Drawer</s-drawer>
     <div id="fit-modal" class="fit-modal" style="display:none;position:fixed;inset:20%;background:#fff;z-index:50">Fit</div>`,
    `document.getElementById('sg').addEventListener('click', () => openLayer('sg-dialog'));
     document.getElementById('warn').addEventListener('click', (e) => { e.preventDefault(); openLayer('sg-dialog'); });
     document.getElementById('drawer-btn').addEventListener('click', () => openLayer('size-drawer'));
     document.getElementById('fit-btn').addEventListener('click', () => openLayer('fit-modal'));`),
  // What belongs in the page: an accordion panel, a <details>, tabs. Two tabs are links: another
  // page, and a PDF in a new tab. Neither is followed.
  '/accordion': fixturePage(
    `<button id="acc" aria-expanded="false" aria-controls="acc-panel">Materials</button>
     <div id="acc-panel" hidden>MATERIALS_TEXT</div>
     <details id="det"><summary>Care</summary>CARE_TEXT</details>
     <div role="tablist">
       <button role="tab" id="t1" aria-selected="true">Description</button>
       <button role="tab" id="t2" aria-selected="false">Specs</button>
       <a role="tab" id="t3" href="/service">Service</a>
       <a role="tab" id="t4" href="/files/manual.pdf" target="_blank">Manual</a>
     </div>`, '',
    `document.getElementById('acc').addEventListener('click', function () {
       const open = this.getAttribute('aria-expanded') !== 'true';
       this.setAttribute('aria-expanded', String(open));
       document.getElementById('acc-panel').hidden = !open;
     });`),
  // A tab that opens a video layer (the undo net covers the tabs step too: plan departure 3).
  '/tab-video': fixturePage(
    `<div role="tablist"><button role="tab" id="tv1" aria-selected="true">Overview</button><button role="tab" id="tv2">Video</button></div>`,
    `<div id="video-modal" style="display:none;position:fixed;inset:0;z-index:100;background:#000"></div>`,
    `document.getElementById('tv2').addEventListener('click', () => openLayer('video-modal'));`),
  // mejuri: a single-open accordion. Opening Materials closes Description.
  '/single-open': fixturePage(
    `<button id="desc-btn" class="acc" aria-expanded="true" aria-controls="desc">Description</button><div id="desc">DESCRIPTION_TEXT</div>
     <button id="mat-btn" class="acc" aria-expanded="false" aria-controls="mat">Materials &amp; Specifications</button><div id="mat" hidden>MATERIALS_TEXT</div>`, '',
    `document.querySelectorAll('.acc').forEach((b) => b.addEventListener('click', () => {
       const opening = b.getAttribute('aria-expanded') !== 'true';
       document.querySelectorAll('.acc').forEach((o) => { o.setAttribute('aria-expanded', 'false'); document.getElementById(o.getAttribute('aria-controls')).hidden = true; });
       if (opening) { b.setAttribute('aria-expanded', 'true'); document.getElementById(b.getAttribute('aria-controls')).hidden = false; }
     }));`),
};

const IDS = ['zoom-modal', 'sg-dialog', 'size-drawer', 'fit-modal', 'acc-panel', 'video-modal', 'mat', 'desc'];

let browser: PlaywrightBrowser;
let site: HtmlSite;
beforeAll(async () => {
  site = await serveHtml(PAGES);
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

async function capture(path: string) {
  const c = await browser.capture(`${site.baseUrl}${path}`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS) });
  return { c, s: c.annotation as PageState };
}

describe('the expand pass never leaves an overlay over the product (spec 2026-10-19 §3.2)', () => {
  it('a Zoom button that opened a lightbox is undone with Escape, and is clicked once (colourpop)', async () => {
    const { s } = await capture('/zoom');
    expect(s.opened['zoom-modal']).toBe(1);
    expect(s.flags.escaped).toBe(true);
    expect(s.shown['zoom-modal']).toBe(false);
    expect(s.centre).toBe('product');
    expect(s.clicks.filter((id) => id === 'zoom')).toHaveLength(1);
  }, 60_000);

  it('a lightbox deaf to Escape is removed, and the scroll lock lifted', async () => {
    const { s } = await capture('/zoom-deaf');
    expect(s.opened['zoom-modal']).toBe(1);
    expect(s.exists['zoom-modal']).toBe(false);
    expect(s.bodyOverflowY).not.toBe('hidden');
    expect(s.centre).toBe('product');
  }, 60_000);

  it('controls that declare a layer are never clicked (mejuri, thomann, kith)', async () => {
    const { s } = await capture('/dialog-triggers');
    expect(s.opened).toEqual({});
    for (const id of ['sg', 'warn', 'drawer-btn', 'fit-btn']) expect(s.clicks).not.toContain(id);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('an accordion panel, a <details> and the tabs are still expanded; no tab that is a link is followed', async () => {
    const { c, s } = await capture('/accordion');
    expect(s.shown['acc-panel']).toBe(true);
    expect(c.html).toContain('MATERIALS_TEXT');
    expect(s.detailsOpen.det).toBe(true);
    expect(s.clicks).toContain('t2');
    expect(s.clicks).not.toContain('t3');
    expect(s.clicks).not.toContain('t4');
    expect(site.requested).not.toContain('/service');
    expect(site.requested).not.toContain('/files/manual.pdf');
    expect(new URL(c.url).pathname).toBe('/accordion');
  }, 60_000);

  it('a tab that opened a layer is undone', async () => {
    const { s } = await capture('/tab-video');
    expect(s.clicks).toContain('tv2');
    expect(s.opened['video-modal']).toBe(1);
    expect(s.shown['video-modal']).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('a single-open accordion ends with the panel it opened still open (mejuri)', async () => {
    const { s } = await capture('/single-open');
    expect(s.shown.mat).toBe(true);
    expect(s.clicks.filter((id) => id === 'mat-btn')).toHaveLength(1);
    expect(s.clicks).not.toContain('desc-btn');
  }, 60_000);
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/capture-expand-overlays.test.ts`
Expected: FAIL — at least: `/zoom` (lightbox still shown, clicked twice), `/zoom-deaf`, `/dialog-triggers` (`opened` not empty), `/accordion` (`/service` requested), `/tab-video` (layer shown), `/single-open` (`mat` hidden).

- [ ] **Step 8: Add the page helpers and entries to `overlays.ts`**

In `packages/browser/src/overlays.ts`, before the line `// ---- Page only: entries`, add:

```ts
/** §3.2.2 on a live element. */
function isDialogLike(el: Element): boolean {
  return isDialogLikeFacts({
    tag: el.tagName,
    id: el.id || '',
    className: classOf(el),
    role: el.getAttribute('role'),
    ariaModal: el.getAttribute('aria-modal'),
    position: getComputedStyle(el).position,
  });
}

/** The expand pass skips this control (§3.2.1–3): it opens a layer, controls one, or sits in one. */
function expandSkip(el: Element): boolean {
  if (opensLayer(el.getAttribute('aria-haspopup'))) return true;
  for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/)) {
    const target = id ? document.getElementById(id) : null;
    if (target && isDialogLike(target)) return true;
  }
  return outermostOverlay(el) !== null;
}

/** Undo a scroll lock (overflow hidden on html/body, or a body pinned with position:fixed). */
function liftScrollLock(): void {
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.style.removeProperty('overflow');
    el.style.removeProperty('overflow-y');
    if (getComputedStyle(el).overflowY === 'hidden') el.style.setProperty('overflow-y', 'visible', 'important');
  }
  const body = document.body;
  if (body && body.style.position === 'fixed') {
    body.style.removeProperty('position');
    body.style.removeProperty('top');
  }
}
```

After `entryCentreOverlay`, add:

```ts
/**
 * Start of the expand pass: a control already expanded counts as clicked (§3.2.5, plan departure
 * 2), so a single-open accordion is not toggled back to the panel the page opened.
 */
function entryExpandStart(): number {
  const st = robotState();
  let n = 0;
  for (const el of Array.from(document.querySelectorAll('main [aria-expanded="true"], article [aria-expanded="true"]'))) {
    st.clicked.add(el);
    n++;
  }
  return n;
}

/** Remember which overlays are there before a round, so the round's own can be told apart. */
function entryOverlayBaseline(): number {
  const st = robotState();
  st.baseline = new Set(listOverlayEls());
  return st.baseline.size;
}

/**
 * One expand round: today's structural controls and "show more" buttons, each clicked at most once
 * per capture, skipping layer triggers and anything inside an overlay; closed <details> are opened.
 *
 * Clicks happen IN THE PAGE (`element.click()`), not through a Playwright locator: a locator click
 * scrolls its element into view first, and on a listing that loads lazily that appends products —
 * one real listing captured 144, 144, 72 and 108 rows across four runs. Revealing DOM that already
 * exists is this pass's job; loading more of a list is pagination's.
 */
function entryExpandRound(): number {
  const st = robotState();
  let n = 0;
  const click = (el: Element): void => {
    if (st.clicked.has(el) || expandSkip(el)) return;
    st.clicked.add(el);
    try { (el as HTMLElement).click(); n++; } catch { /* not clickable */ }
  };
  for (const selector of EXPAND_SELECTORS) {
    const els = Array.prototype.slice.call(document.querySelectorAll(selector), 0, 10) as Element[];
    for (const el of els) {
      // offsetParent is null for display:none. Outside the viewport is fine and expected.
      if ((el as HTMLElement).offsetParent === null) continue;
      click(el);
    }
  }
  const re = new RegExp(EXPAND_TEXT_PATTERN, 'i');
  const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  for (const el of Array.from(main.querySelectorAll('button, a[role="button"], [class*="expand"], [class*="show-more"], [class*="read-more"]'))) {
    if (re.test(el.textContent?.trim() ?? '') && (el as HTMLElement).offsetParent !== null) click(el);
  }
  for (const el of Array.from(main.querySelectorAll('details:not([open])'))) {
    if (outermostOverlay(el) !== null) continue;
    el.setAttribute('open', '');
    n++;
  }
  return n;
}

/** The overlays that appeared since the baseline (§3.2.4). */
function entryNewOverlays(): number {
  const st = robotState();
  st.pending = listOverlayEls().filter((el) => !st.baseline.has(el));
  return st.pending.length;
}

/** After Escape: remove what the round opened and is still there, and lift the scroll lock. */
function entryRemoveNewOverlays(): OverlayDescription[] {
  const st = robotState();
  const removed: OverlayDescription[] = [];
  const any = st.pending.length > 0;
  for (const el of st.pending) {
    if (!el.isConnected || !isShown(el)) continue;
    removed.push(describeEl(el));
    el.remove();
  }
  st.pending = [];
  if (any) liftScrollLock();
  return removed;
}

/**
 * Click through tabs so every panel's content is in the DOM. Never a tab that is a link elsewhere
 * (new tab or not) or to a file (§3.2.6, plan departure 3), and the same skips as the rounds.
 * Clicks are staggered 300 ms apart; the caller waits for them.
 */
function entryTabs(): number {
  const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  const picked: HTMLElement[] = [];
  const seen = new Set<Element>();
  const consider = (el: Element): void => {
    if (seen.has(el) || (el as HTMLElement).offsetParent === null) return;
    seen.add(el);
    const a = el.closest('a');
    if (a) {
      const href = a.getAttribute('href');
      if (hrefNavigates({ href, target: null }) || isFileLink(href)) return;
    }
    if (expandSkip(el)) return;
    picked.push(el as HTMLElement);
  };
  main.querySelectorAll('[role="tab"]').forEach((el) => consider(el));
  main.querySelectorAll('[data-tab]').forEach((el) => consider(el));
  main.querySelectorAll('[class*="tab" i]').forEach((el) => {
    const classes = classOf(el).toLowerCase();
    if ((classes.includes('tab__') || classes.includes('tab-') || classes.includes('tabs__'))
        && !classes.includes('panel') && !classes.includes('content') && !classes.includes('body')
        && el.matches('button, a, [role="tab"]')) consider(el);
  });
  picked.forEach((el, i) => { setTimeout(() => el.click(), i * 300); });
  return picked.length;
}
```

Replace the assembly lists:

```ts
const PAGE_CONSTANTS: Record<string, unknown> = {
  CLOSE_WORDS, ROBOT_STATE_KEY, HASPOPUP_SKIP, EXPAND_SELECTORS, EXPAND_TEXT_PATTERN,
};

const PAGE_FUNCTIONS: ReadonlyArray<(...args: never[]) => unknown> = [
  // pure
  normName, isDismissName, isCloseWord, isSettingsName, hasVariantClassWord, isVariantControlFacts,
  isFileLink, hrefNavigates, coverage, overlayByFacts, opensLayer, isDialogLikeFacts,
  // DOM
  robotState, classOf, parentOf, searchRoots, queryDeep, isShown, holdsPage, isOverlay,
  outermostOverlay, listOverlayEls, centreOverlayEl, topmostOverlayEl, describeEl, accessibleName,
  isVariantControl, neverDismiss, isDialogLike, expandSkip, liftScrollLock,
];
```

At the end of the module, add:

```ts
/** Start of the expand pass → number of controls already expanded. */
export const EXPAND_START_SCRIPT = pageScript(entryExpandStart);
/** Remember the overlays present now → their count. */
export const OVERLAY_BASELINE_SCRIPT = pageScript(entryOverlayBaseline);
/** One expand round → number of controls clicked or <details> opened. */
export const EXPAND_ROUND_SCRIPT = pageScript(entryExpandRound);
/** Overlays that appeared since the baseline → their count. */
export const NEW_OVERLAYS_SCRIPT = pageScript(entryNewOverlays);
/** Remove what appeared and is still there → `OverlayDescription[]`. */
export const REMOVE_NEW_OVERLAYS_SCRIPT = pageScript(entryRemoveNewOverlays);
/** Click the tabs (staggered) → how many will be clicked. */
export const TABS_SCRIPT = pageScript(entryTabs);
```

- [ ] **Step 9: Rewrite `expandHiddenContent` in `playwright-browser.ts`**

Change the overlays import to:

```ts
import {
  hrefNavigates, EXPAND_START_SCRIPT, OVERLAY_BASELINE_SCRIPT, EXPAND_ROUND_SCRIPT, NEW_OVERLAYS_SCRIPT,
  REMOVE_NEW_OVERLAYS_SCRIPT, TABS_SCRIPT, type OverlayDescription,
} from './overlays.js';
```

Replace the whole `expandHiddenContent` method — from its doc comment `/**` + ` * Expand hidden content (accordions, "show more" links, collapsed sections)` through the method's closing brace just before `/**` + ` * Extract structured data embedded in the page:` — with:

```ts
  /**
   * Reveal what belongs in the page — accordions, `<details>`, "show more", tabs — and never leave
   * an overlay over it (spec 2026-10-19 §3.2). The rules and the page code are in overlays.ts:
   * layer triggers are skipped, each control is clicked at most once (one already expanded counts),
   * and an overlay that appears during a round is closed — Escape, then removed — before the next.
   * Runs after popup dismissal, before the screenshot; crawl() runs it on listing page 1 too.
   */
  private async expandHiddenContent(page: Page): Promise<void> {
    await page.evaluate(EXPAND_START_SCRIPT).catch(() => 0);
    for (let round = 0; round < 2; round++) {
      await page.evaluate(OVERLAY_BASELINE_SCRIPT).catch(() => 0);
      const expanded = Number(await page.evaluate(EXPAND_ROUND_SCRIPT).catch(() => 0));
      if (!expanded) break;
      await page.waitForTimeout(500);
      await this.undoNewOverlays(page);
    }

    // Tabs: load every panel's content into the DOM. Same skips, same undo.
    await page.evaluate(OVERLAY_BASELINE_SCRIPT).catch(() => 0);
    const tabs = Number(await page.evaluate(TABS_SCRIPT).catch(() => 0));
    if (tabs > 0) {
      await page.waitForTimeout(Math.min(tabs * 300 + 500, 3000));
      await this.undoNewOverlays(page);
    }
  }

  /**
   * Close every overlay that appeared since the last baseline (§3.2.4): Escape once, then remove
   * what is still there and lift the scroll lock. This is the net for controls nothing gives away
   * (colourpop's `Zoom`). Costs nothing when no overlay appeared.
   */
  private async undoNewOverlays(page: Page): Promise<void> {
    const fresh = Number(await page.evaluate(NEW_OVERLAYS_SCRIPT).catch(() => 0));
    if (!fresh) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    const removed = (await page.evaluate(REMOVE_NEW_OVERLAYS_SCRIPT).catch(() => [])) as OverlayDescription[];
    if (process.env.CAPTURE_DEBUG) {
      const names = removed.map((d) => `${d.tag}${d.id ? `#${d.id}` : ''}`).join(', ') || 'none';
      console.log(`[capture] expand opened ${fresh} overlay(s); removed after Escape: ${names}`);
    }
  }
```

- [ ] **Step 10: Run the capture tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/capture-expand-overlays.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 11: Run the neighbours that exercise the expand pass, one file at a time**

Run: `npx vitest run src/capture-ready-after-expand.test.ts`
Expected: PASS (6 tests — "Show more" still revealed).
Run: `npx vitest run src/overlays-page.test.ts`
Expected: PASS.
Run: `npx vitest run src/overlays.test.ts`
Expected: PASS.
Run: `cd ../scraper && npx vitest run src/__fixtures__/capture-no-scroll.test.ts`
Expected: PASS (2 tests — the expand pass still does not scroll, still expands below the fold).

- [ ] **Step 12: Typecheck**

Run: `cd ../browser && npx tsc --noEmit`
Expected: no error in a file this task touched.

- [ ] **Step 13: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-captures
git add packages/browser/src/overlays.ts packages/browser/src/overlays.test.ts packages/browser/src/__fixtures__/overlay-pages.ts packages/browser/src/capture-expand-overlays.test.ts packages/browser/src/playwright-browser.ts
git commit -m "$(cat <<'EOF'
feat(browser): the expand pass never leaves an overlay — skips layer triggers, undoes what it opened, clicks once

Spec 2026-10-19 §3.2. A control already expanded counts as clicked (single-open accordions);
the tabs step gets the same skips and undo and never follows a link or a file. Page code now goes
through pageScript, so the tabs step also runs under tsx (it threw on __name before).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Dismissal closes overlays without touching the page

**Files:**
- Modify: `packages/browser/src/overlays.ts` (dismissal constants, `hideOverlay`, entries, assembly lists, scripts)
- Modify: `packages/browser/src/overlays.test.ts` (append)
- Create: `packages/browser/src/capture-dismiss.test.ts`
- Modify: `packages/browser/src/playwright-browser.ts` (delete `POPUP_DISMISS_SELECTORS` and `navigatesAway`, drop the `Locator` type import, rewrite `dismissPopups`, add constants)

**Interfaces:**
- Consumes (Tasks 1–2): `robotState` (`tried`, `last`, `lastHost`), `topmostOverlayEl`, `outermostOverlay`, `listOverlayEls`, `searchRoots`, `queryDeep`, `isShown`, `holdsPage`, `accessibleName`, `normName`, `isCloseWord`, `isDismissName`, `neverDismiss`, `liftScrollLock`, `pageScript`; test helpers `serveHtml`, `fixturePage`, `pageState`, `PageState`.
- Produces:
  - exported `type DismissStep = { css: string } | { name: string }`, `DISMISS_STEPS: readonly DismissStep[]`, `REMOVAL_SELECTORS: readonly string[]`, `DISMISS_HOST_SELECTOR: string`
  - scripts `NEXT_DISMISS_CANDIDATE_SCRIPT` (→ `Element | null`, for `page.evaluateHandle`), `LAST_DISMISS_WORKED_SCRIPT` (→ boolean), `REMOVAL_PASS_SCRIPT` (→ number hidden or removed)
  - `PlaywrightBrowser.dismissPopups(page: Page, opts?: { settleMs?: number }): Promise<void>` (private; Task 4 calls it with `{ settleMs: 0 }`)

- [ ] **Step 1: Write the failing unit tests**

Append to `packages/browser/src/overlays.test.ts` (add `DISMISS_STEPS` to the import):

```ts
describe('DISMISS_STEPS — today\'s list, whole names instead of substrings (§3.3.1)', () => {
  it('has no substring text selector left', () => {
    for (const s of DISMISS_STEPS) if ('css' in s) expect(s.css).not.toMatch(/:has-text|:text/);
  });
  it('stores names case-folded, and lists "OK, got it" by its whole name', () => {
    for (const s of DISMISS_STEPS) if ('name' in s) expect(s.name).toBe(normName(s.name));
    expect(DISMISS_STEPS).toContainEqual({ name: 'ok, got it' });
    expect(DISMISS_STEPS).toContainEqual({ name: 'ok' });
  });
  it('keeps today\'s order: the consent managers before the generic close controls', () => {
    const onetrust = DISMISS_STEPS.findIndex((s) => 'css' in s && s.css === '#onetrust-accept-btn-handler');
    const close = DISMISS_STEPS.findIndex((s) => 'name' in s && s.name === 'close');
    const ariaClose = DISMISS_STEPS.findIndex((s) => 'css' in s && s.css === '[aria-label="Close"]');
    expect(onetrust).toBeGreaterThanOrEqual(0);
    expect(onetrust).toBeLessThan(close);
    expect(close).toBeLessThan(ariaClose);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/overlays.test.ts`
Expected: FAIL — `DISMISS_STEPS` is undefined.

- [ ] **Step 3: Add the dismissal constants**

In `packages/browser/src/overlays.ts`, after `EXPAND_TEXT_PATTERN`, add:

```ts
/** One dismissal step: a CSS selector, or a whole accessible name (case-folded) of a button. */
export type DismissStep = { css: string } | { name: string };

/**
 * Today's dismissal list, in today's order, with every `button:has-text("…")` turned into a whole
 * name (§3.3.1). A name step matches `button, [role=button]` whose accessible name IS the text.
 */
export const DISMISS_STEPS: readonly DismissStep[] = [
  // Cookie consent
  { css: 'button[id*="cookie" i][id*="accept" i]' },
  { css: 'button[id*="cookie" i][id*="close" i]' },
  { css: 'button[id*="consent" i][id*="accept" i]' },
  { css: 'button[class*="cookie" i][class*="accept" i]' },
  { css: 'button[class*="consent" i][class*="accept" i]' },
  { css: 'button[data-testid*="cookie" i]' },
  { css: '#onetrust-accept-btn-handler' },
  { css: '#accept-cookie-notification' },
  { css: '.cookie-banner button' },
  { css: '.cookie-notice button' },
  { css: '[aria-label*="cookie" i][aria-label*="accept" i]' },
  { css: '[aria-label*="cookie" i][aria-label*="close" i]' },
  // Generic consent/privacy modals
  { css: 'button[id*="consent" i][id*="close" i]' },
  { css: 'button[class*="consent" i][class*="close" i]' },
  { css: '[data-testid="close-consent"]' },
  { css: 'button[class*="privacy" i][class*="accept" i]' },
  // Health data consent (Target-style)
  { css: 'button[class*="consent" i][class*="continue" i]' },
  // Whole names (were substring `:has-text`)
  { name: 'continue shopping' },
  { name: 'accept all' },
  { name: 'accept cookies' },
  { name: 'accept all cookies' },
  { name: 'i accept' },
  { name: 'i agree' },
  { name: 'got it' },
  { name: 'ok, got it' },
  { name: 'ok' },
  { name: 'close' },
  // Newsletter/email modals
  { css: '[aria-label="Close dialog"]' },
  { css: '[aria-label="Close modal"]' },
  { css: '[aria-label="Close"]' },
  { css: 'button[class*="modal" i][class*="close" i]' },
  { css: '.modal-close' },
  { css: '.popup-close' },
  { css: '[data-dismiss="modal"]' },
  // Generic overlay close buttons
  { css: 'dialog button[aria-label*="close" i]' },
  { css: '[role="dialog"] button[aria-label*="close" i]' },
];

/** Today's JavaScript removal selectors; still removed (not hidden), as today. */
export const REMOVAL_SELECTORS: readonly string[] = [
  '[class*="overlay" i][class*="modal" i]',
  '[class*="overlay" i][class*="consent" i]',
  '[class*="modal" i][class*="backdrop" i]',
  '[id*="consent" i][role="dialog"]',
  '[role="dialog"][aria-modal="true"]',
];

/**
 * The layer a clicked control belongs to when it is not inside a §3.1 overlay (a small cookie bar):
 * if that layer went away, the click worked (§3.3.3).
 */
export const DISMISS_HOST_SELECTOR = [
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog',
  '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
  '[id*="banner" i]', '[class*="banner" i]', '[id*="popup" i]', '[class*="popup" i]',
  '[id*="modal" i]', '[class*="modal" i]',
].join(', ');
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/overlays.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing capture tests**

Create `packages/browser/src/capture-dismiss.test.ts`:

```ts
// Spec 2026-10-19 §3.3: dismissal closes what the page put over the product without touching the
// page. Campaign 2's dismissal sites (ikea, skullcandy, lacoste, puma DE) as fixtures, plus the
// three inputs the plan's Review Focus names (app shell, fixed buy box, shadow-root consent).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { fixturePage, pageState, serveHtml, TRACK_SCRIPT, type HtmlSite, type PageState } from './__fixtures__/overlay-pages.js';

const SWATCHES = `<div class="reviews"><button id="chip-look" class="chip">look</button></div>
  <div class="swatches"><button id="swatch-black" class="swatch" aria-pressed="true">Black</button><button id="swatch-rosy" class="swatch" aria-pressed="false">Rosy Outlook</button></div>`;
const SWATCH_SCRIPT = `document.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.swatch').forEach((o) => o.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true');
}));`;

const PAGES: Record<string, string> = {
  // ikea: "Cookie settings" sits first in the banner; only "OK" closes it.
  '/cookie-settings': fixturePage(SWATCHES,
    `<div id="cookie-banner" class="cookie-banner" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff;z-index:10">
       <button id="cookie-settings">Cookie settings</button> <button id="cookie-ok">OK</button></div>
     <div id="prefs" role="dialog" style="display:none;position:fixed;inset:10%;background:#fff;z-index:20">Preference centre</div>`,
    `${SWATCH_SCRIPT}
     document.getElementById('cookie-settings').addEventListener('click', () => openLayer('prefs'));
     document.getElementById('cookie-ok').addEventListener('click', () => document.getElementById('cookie-banner').remove());`),
  // skullcandy's "look", puma's "Rosy Outlook", and a real "OK" after them in the document.
  '/names': fixturePage(SWATCHES,
    `<div id="notice" style="position:fixed;left:0;right:0;bottom:0;height:100px;background:#fff">We use cookies. <button id="notice-ok">OK</button></div>`,
    `${SWATCH_SCRIPT}
     document.getElementById('notice-ok').addEventListener('click', () => document.getElementById('notice').remove());`),
  // lacoste: a promo bar whose close button never closes it, beside a consent modal no step names.
  // The bar sits above the backdrop (a real mouse click reaches it) at z-index 1000, which today's
  // `body > div` removal rule (z-index above 1000) leaves alone.
  '/promo-consent': fixturePage('',
    `<div id="promo" class="promo-bar" style="position:fixed;top:0;left:0;right:0;z-index:1000;background:#222;color:#fff;padding:8px">Free delivery <button id="promo-close" aria-label="Close">×</button></div>
     <div id="consent-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900"></div>
     <div id="consent" role="dialog" aria-modal="true" style="position:fixed;top:200px;left:340px;width:600px;height:400px;z-index:950;background:#fff">
       <p>We use cookies</p><button id="consent-agree">Agree</button></div>`,
    `document.getElementById('consent-agree').addEventListener('click', () => { document.getElementById('consent').remove(); document.getElementById('consent-backdrop').remove(); });`),
  // puma DE: a location popup with no role, a fixed full-window box and a "Schließen" button.
  '/geo': fixturePage('',
    `<section id="geo" style="position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.4)">
       <div style="margin:200px auto;width:500px;background:#fff;padding:20px">Standort wählen <button id="geo-close"><span>Schließen</span></button></div></section>`,
    `document.getElementById('geo-close').addEventListener('click', () => document.getElementById('geo').remove());`),
  // Review Focus 1: the whole page in a fixed full-window container.
  '/app-shell': `<!doctype html><html><head><meta charset="utf-8"><title>Lamp</title></head><body style="margin:0">
    <div id="shell" style="position:fixed;inset:0;overflow:auto"><main id="product"><h1>Lamp</h1><p id="price">PRICE_40</p><div style="height:3000px"></div></main></div>
    <script>${TRACK_SCRIPT}</script></body></html>`,
  // Review Focus 2: a fixed buy box covering a third of the window, holding the price.
  '/buy-box': fixturePage('',
    `<aside id="buybox" style="position:fixed;top:0;right:0;width:420px;height:800px;background:#fff"><p>PRICE_EUR_129</p><button id="add">Add to bag</button></aside>`),
  // Review Focus 3: a consent banner inside an open shadow root.
  '/shadow-consent': fixturePage('', `<div id="cmp-host"></div>`,
    `const root = document.getElementById('cmp-host').attachShadow({ mode: 'open' });
     root.innerHTML = '<div style="position:fixed;left:0;right:0;bottom:0;height:150px;background:#fff"><button id="accept">Accept all</button></div>';
     root.getElementById('accept').addEventListener('click', () => { window.__flags.accepted = true; document.getElementById('cmp-host').remove(); });`),
};

const IDS = ['cookie-banner', 'prefs', 'notice', 'promo', 'consent', 'consent-backdrop', 'geo', 'shell', 'buybox', 'cmp-host'];

let browser: PlaywrightBrowser;
let site: HtmlSite;
beforeAll(async () => {
  site = await serveHtml(PAGES);
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

async function capture(path: string) {
  const c = await browser.capture(`${site.baseUrl}${path}`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS) });
  return { c, s: c.annotation as PageState };
}

describe('dismissal closes overlays without touching the page (spec 2026-10-19 §3.3)', () => {
  it('"Cookie settings" is never clicked; "OK" closes the banner; the swatch is untouched (ikea)', async () => {
    const { s } = await capture('/cookie-settings');
    expect(s.clicks).toEqual(['cookie-ok']);
    expect(s.opened).toEqual({});
    expect(s.exists['cookie-banner']).toBe(false);
    expect(s.pressed).toEqual({ 'swatch-black': 'true', 'swatch-rosy': 'false' });
  }, 60_000);

  it('"look" and "Rosy Outlook" are not "OK": only the real OK is clicked (skullcandy, puma)', async () => {
    const { s } = await capture('/names');
    expect(s.clicks).toEqual(['notice-ok']);
    expect(s.exists.notice).toBe(false);
    expect(s.pressed).toEqual({ 'swatch-black': 'true', 'swatch-rosy': 'false' });
  }, 60_000);

  it('a close button that changes nothing is clicked once; the removal pass still closes the consent (lacoste)', async () => {
    const { s } = await capture('/promo-consent');
    expect(s.clicks.filter((id) => id === 'promo-close')).toHaveLength(1);
    expect(s.shown.consent).toBe(false);
    expect(s.shown['consent-backdrop']).toBe(false);
    expect(s.shown.promo).toBe(true);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('the topmost layer is closed by its own close word — "Schließen" (puma DE)', async () => {
    const { s } = await capture('/geo');
    expect(s.clicks).toContain('geo-close');
    expect(s.exists.geo).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('an app shell is the page, not an overlay: nothing is hidden (Review Focus 1)', async () => {
    const { c, s } = await capture('/app-shell');
    expect(s.shown.shell).toBe(true);
    expect(c.html).toContain('PRICE_40');
  }, 60_000);

  it('a fixed buy box is hidden from the screenshot but its price stays in the HTML (Review Focus 2)', async () => {
    const { c } = await capture('/buy-box');
    expect(c.html).toContain('PRICE_EUR_129');
  }, 60_000);

  it('a consent banner inside an open shadow root is still accepted (Review Focus 3)', async () => {
    const { s } = await capture('/shadow-consent');
    expect(s.flags.accepted).toBe(true);
    expect(s.exists['cmp-host']).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/capture-dismiss.test.ts`
Expected: FAIL on `/cookie-settings`, `/names`, `/promo-consent` and `/geo`. `/app-shell`, `/buy-box` and `/shadow-consent` pass already: they are guards that the new code must keep green.

- [ ] **Step 7: Add the dismissal page code to `overlays.ts`**

Before the line `// ---- Page only: entries`, add:

```ts
/** Take an overlay off the screenshot but keep its text in the HTML (§3.3.5, plan departure 4). */
function hideOverlay(el: Element): void {
  (el as HTMLElement).style?.setProperty('display', 'none', 'important');
}
```

After `entryTabs`, add:

```ts
/**
 * The next control dismissal should click, or null (§3.3.1, §3.3.2, §3.3.4). First a close word
 * inside the topmost overlay; then today's steps in order. Every element is offered once per
 * capture: whether its click worked or not, it is never offered again.
 */
function entryNextDismissCandidate(): Element | null {
  const st = robotState();
  const usable = (el: Element): boolean => !st.tried.has(el) && isShown(el) && !neverDismiss(el);
  const take = (el: Element): Element => {
    st.tried.add(el);
    st.last = el;
    st.lastHost = outermostOverlay(el) ?? el.closest(DISMISS_HOST_SELECTOR);
    return el;
  };
  const CONTROLS = 'button, a, [role="button"], [aria-label]';
  const top = topmostOverlayEl();
  if (top) {
    const inside = [
      ...Array.from(top.querySelectorAll(CONTROLS)),
      ...(top.shadowRoot ? Array.from(top.shadowRoot.querySelectorAll(CONTROLS)) : []),
    ];
    for (const el of inside) {
      if (!usable(el)) continue;
      const names = [accessibleName(el), normName(el.getAttribute('aria-label')), normName((el as HTMLElement).innerText ?? el.textContent), normName(el.getAttribute('title'))];
      if (names.some((n) => isCloseWord(n))) return take(el);
    }
  }
  const roots = searchRoots();
  let named: Array<[Element, string]> | null = null;
  for (const step of DISMISS_STEPS) {
    let els: Element[];
    if ('css' in step) {
      els = queryDeep(roots, step.css);
    } else {
      named ??= queryDeep(roots, 'button, [role="button"]').map((el): [Element, string] => [el, accessibleName(el)]);
      els = named.filter(([, name]) => isDismissName(name, step.name)).map(([el]) => el);
    }
    for (const el of els) if (usable(el)) return take(el);
  }
  return null;
}

/** Did the last click work (§3.3.3)? The element, or the layer it sat in, is gone or hidden. */
function entryLastDismissWorked(): boolean {
  const st = robotState();
  const gone = (el: Element | null): boolean => el !== null && (!el.isConnected || !isShown(el));
  return gone(st.last) || gone(st.lastHost);
}

/**
 * The removal pass, every round (§3.3.5): hide every §3.1 overlay, remove today's selectors and
 * today's high z-index body children (never the page itself), lift the scroll lock → how many.
 */
function entryRemovalPass(): number {
  let n = 0;
  for (const el of listOverlayEls()) {
    if (!isShown(el)) continue; // inside one hidden a moment ago
    hideOverlay(el);
    n++;
  }
  const remove = (el: Element): void => {
    if (!el.isConnected || el === document.body || el === document.documentElement || holdsPage(el)) return;
    el.remove();
    n++;
  };
  for (const selector of REMOVAL_SELECTORS) document.querySelectorAll(selector).forEach((el) => remove(el));
  document.querySelectorAll('body > div').forEach((el) => {
    const s = getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'absolute') && parseFloat(s.zIndex) > 1000 && el.querySelector('button')) remove(el);
  });
  // Today's unconditional reset; the fuller lift only when something was taken away.
  if (document.body) document.body.style.overflow = '';
  if (document.documentElement) document.documentElement.style.overflow = '';
  if (n > 0) liftScrollLock();
  return n;
}
```

Replace the assembly lists:

```ts
const PAGE_CONSTANTS: Record<string, unknown> = {
  CLOSE_WORDS, ROBOT_STATE_KEY, HASPOPUP_SKIP, EXPAND_SELECTORS, EXPAND_TEXT_PATTERN,
  DISMISS_STEPS, REMOVAL_SELECTORS, DISMISS_HOST_SELECTOR,
};

const PAGE_FUNCTIONS: ReadonlyArray<(...args: never[]) => unknown> = [
  // pure
  normName, isDismissName, isCloseWord, isSettingsName, hasVariantClassWord, isVariantControlFacts,
  isFileLink, hrefNavigates, coverage, overlayByFacts, opensLayer, isDialogLikeFacts,
  // DOM
  robotState, classOf, parentOf, searchRoots, queryDeep, isShown, holdsPage, isOverlay,
  outermostOverlay, listOverlayEls, centreOverlayEl, topmostOverlayEl, describeEl, accessibleName,
  isVariantControl, neverDismiss, isDialogLike, expandSkip, liftScrollLock, hideOverlay,
];
```

At the end of the module, add:

```ts
/** The next control to click → `Element | null`. Use with `page.evaluateHandle`. */
export const NEXT_DISMISS_CANDIDATE_SCRIPT = pageScript(entryNextDismissCandidate);
/** Did the last click work → boolean. */
export const LAST_DISMISS_WORKED_SCRIPT = pageScript(entryLastDismissWorked);
/** The removal pass → number of overlays hidden or elements removed. */
export const REMOVAL_PASS_SCRIPT = pageScript(entryRemovalPass);
```

- [ ] **Step 8: Rewrite `dismissPopups` in `playwright-browser.ts`**

1. Delete the `POPUP_DISMISS_SELECTORS` constant (from `// Common popup/consent selectors to auto-dismiss before capture` through its closing `];`) and, in its place, add:

```ts
// Dismissal (spec 2026-10-19 §3.3). The rules and the page code are in overlays.ts.
/** Before the first pass, a moment for popups that arrive just after load (not before the final pass). */
const DISMISS_SETTLE_MS = 1500;
/** Rounds per pass; a round that closed and removed nothing ends the pass. */
const DISMISS_MAX_ROUNDS = 4;
/** Clicks per pass, worked or not: each waits DISMISS_CLICK_SETTLE_MS, and a dead one is never retried. */
const DISMISS_MAX_CLICKS = 6;
/** How long a click gets to take effect before it is judged. */
const DISMISS_CLICK_SETTLE_MS = 800;
```

2. Delete the `navigatesAway` function with its doc comment (the page-side `neverDismiss` makes the same `hrefNavigates` check now).
3. In the first line's Playwright import, replace `type Locator, ` with `type JSHandle, `.
4. Extend the overlays import with `NEXT_DISMISS_CANDIDATE_SCRIPT, LAST_DISMISS_WORKED_SCRIPT, REMOVAL_PASS_SCRIPT`.
5. Replace the whole `dismissPopups` method (its doc comment `/**` + ` * Try to dismiss common popups, consent banners, and modals.` through its closing brace) with:

```ts
  /**
   * Close what the page put over the product, without touching the page (spec 2026-10-19 §3.3).
   *
   * Each round: first a close word inside the topmost overlay, then today's steps — whole names,
   * never a variant, settings or navigating control (on Barnes & Noble a broad selector once
   * clicked through to another product: wrong AND self-consistent data). A click counts only if
   * the element or its layer went away; a dead one is never clicked again and the round tries the
   * next. Then the removal pass, every round. A round that changed nothing ends the pass.
   *
   * `settleMs: 0` is the final pass before the screenshot (§3.4): no wait on a clean page.
   */
  private async dismissPopups(page: Page, opts: { settleMs?: number } = {}): Promise<void> {
    const settleMs = opts.settleMs ?? DISMISS_SETTLE_MS;
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    let clicksLeft = DISMISS_MAX_CLICKS;
    for (let round = 0; round < DISMISS_MAX_ROUNDS; round++) {
      let closedByClick = false;
      while (!closedByClick && clicksLeft > 0) {
        // A string script's handle is typed JSHandle<unknown>; asElement() needs to know it may be a Node.
        const handle = await page.evaluateHandle(NEXT_DISMISS_CANDIDATE_SCRIPT)
          .then((h) => (h as JSHandle<Node | null>).asElement())
          .catch((err) => { if (isCrash(err)) throw err; return null; });
        if (!handle) break;
        clicksLeft--;
        try {
          await handle.click({ timeout: 2000, force: true });
        } catch (err) {
          if (isCrash(err)) throw err; // a click that throws changed nothing; judged below
        }
        await page.waitForTimeout(DISMISS_CLICK_SETTLE_MS);
        closedByClick = await page.evaluate(LAST_DISMISS_WORKED_SCRIPT).then(Boolean).catch(() => false);
        await handle.dispose().catch(() => {});
      }

      const removed = Number(await page.evaluate(REMOVAL_PASS_SCRIPT).catch((err) => { if (isCrash(err)) throw err; return 0; }));
      if (removed > 0) await page.waitForTimeout(500);
      if (!closedByClick && removed === 0) break;
    }
  }
```

- [ ] **Step 9: Run the capture tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/capture-dismiss.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Run the neighbours, one file at a time**

Run: `npx vitest run src/capture-expand-overlays.test.ts` — Expected: PASS (6).
Run: `npx vitest run src/dismiss-navigation.test.ts` — Expected: PASS (7).
Run: `npx vitest run src/capture-annotate.test.ts` — Expected: PASS (4).
Run: `npx vitest run src/capture-verdict.test.ts` — Expected: PASS.
Run: `npx vitest run src/overlays.test.ts` — Expected: PASS.
Run: `cd ../scraper && npx vitest run src/__fixtures__/capture-no-scroll.test.ts` — Expected: PASS (2).

- [ ] **Step 11: Typecheck**

Run: `cd ../browser && npx tsc --noEmit`
Expected: no error in a file this task touched (in particular no "Locator is declared but never used" and no "navigatesAway").

- [ ] **Step 12: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-captures
git add packages/browser/src/overlays.ts packages/browser/src/overlays.test.ts packages/browser/src/capture-dismiss.test.ts packages/browser/src/playwright-browser.ts
git commit -m "$(cat <<'EOF'
feat(browser): dismissal closes overlays without touching the page

Spec 2026-10-19 §3.3: whole names, never a variant/settings/navigating control, a click counts
only if it worked and is never retried, the topmost layer is closed by its close word, the
removal pass runs every round (hides §3.1 overlays, removes today's selectors), at most four
rounds and six clicks. Reaches consent banners in open shadow roots.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: One more pass just before the screenshot, then the top, then one warning line

**Files:**
- Modify: `packages/browser/src/overlays.ts` (add `overlayWarning`)
- Modify: `packages/browser/src/overlays.test.ts` (append)
- Create: `packages/browser/src/capture-final-pass.test.ts`
- Modify: `packages/browser/src/playwright-browser.ts` (`capture()` after the after-expand ready wait; the `returnIfNavigatedAway` comment; imports)

**Interfaces:**
- Consumes: `dismissPopups(page, { settleMs: 0 })` (Task 3), `CENTRE_OVERLAY_SCRIPT`, `OverlayDescription` (Task 1), test helpers (Task 2).
- Produces: `overlayWarning(url: string, d: OverlayDescription): string` — the one warning line. Nothing for later tasks besides the behaviour.

- [ ] **Step 1: Write the failing unit test**

Append to `packages/browser/src/overlays.test.ts` (add `overlayWarning` to the import):

```ts
describe('overlayWarning (§3.4)', () => {
  it('names the overlay by tag, id and the first 60 characters of its text', () => {
    expect(overlayWarning('https://x.test/p/1', { tag: 'div', id: 'nag', text: 'Subscribe' }))
      .toBe('[browser] https://x.test/p/1: an overlay still covers the middle of the page after dismissal: div#nag "Subscribe"');
    expect(overlayWarning('https://x.test/p/1', { tag: 'section', id: '', text: 'Standort wählen' }))
      .toBe('[browser] https://x.test/p/1: an overlay still covers the middle of the page after dismissal: section "Standort wählen"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/overlays.test.ts`
Expected: FAIL — `overlayWarning` is not a function.

- [ ] **Step 3: Add `overlayWarning`**

In `packages/browser/src/overlays.ts`, after the `OverlayDescription` interface, add:

```ts
/** The one line a capture logs when an overlay still covers the window's centre (§3.4, §8.3). */
export function overlayWarning(url: string, d: OverlayDescription): string {
  return `[browser] ${url}: an overlay still covers the middle of the page after dismissal: ${d.tag}${d.id ? `#${d.id}` : ''} "${d.text}"`;
}
```

(Node only — not in `PAGE_FUNCTIONS`.)

Run: `npx vitest run src/overlays.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing capture tests**

Create `packages/browser/src/capture-final-pass.test.ts`:

```ts
// Spec 2026-10-19 §3.4 and §5.5: one more dismissal pass just before the screenshot (late banners:
// puma's OneTrust), the page back at the top (ikea's y≈1000), one warning line for an overlay that
// survives — and no new wait on a page with nothing over it.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import type { ReadySnapshot } from './types.js';
import { fixturePage, pageState, serveHtml, type HtmlSite, type PageState } from './__fixtures__/overlay-pages.js';

// The spec's fixture says "two seconds after load"; three keeps it clear of the first pass's
// 1.5 s settle wait on a slow machine, so only the final pass can be the one that closes it.
const LATE_MS = 3000;

const PAGES: Record<string, string> = {
  '/late-banner': fixturePage('', '',
    `setTimeout(() => {
       const b = document.createElement('div');
       b.id = 'onetrust-banner-sdk';
       b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:140px;background:#fff;z-index:10';
       b.innerHTML = '<button id="onetrust-accept-btn-handler">Accept All Cookies</button>';
       document.body.appendChild(b);
       b.querySelector('button').addEventListener('click', () => { window.__flags.acceptedAt = Math.round(performance.now()); b.remove(); });
     }, ${LATE_MS});`),
  // ikea: the dismissal click scrolls its element into view.
  '/scrolled': fixturePage('',
    `<div id="consent-notice" class="cookie-notice" style="padding:20px;background:#eee">We use cookies <button id="notice-ok">Got it</button></div>`,
    `document.getElementById('notice-ok').addEventListener('click', () => document.getElementById('consent-notice').remove());`),
  // An overlay that comes back every 100 ms: nothing can close it, so the capture says so.
  '/nag': fixturePage('', '',
    `function nag() {
       const old = document.getElementById('nag');
       if (old && getComputedStyle(old).display !== 'none') return;
       if (old) old.remove();
       const d = document.createElement('div');
       d.id = 'nag';
       d.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.6);color:#fff';
       d.textContent = 'Subscribe to our newsletter for 10% off your first order';
       document.body.appendChild(d);
     }
     nag(); setInterval(nag, 100);`),
  // Review Focus 4: a late dialog whose Close button navigates by script.
  '/navigating-close': fixturePage('', '',
    `setTimeout(() => {
       const d = document.createElement('div');
       d.id = 'leave'; d.setAttribute('role', 'dialog');
       d.style.cssText = 'position:fixed;inset:25%;background:#fff;z-index:100';
       d.innerHTML = '<button id="leave-close" aria-label="Close">×</button>';
       document.body.appendChild(d);
       d.querySelector('button').addEventListener('click', () => { location.href = '/elsewhere'; });
     }, ${LATE_MS});`),
  // Review Focus 5: a heavy page with nothing over it.
  '/heavy': fixturePage(`<div id="heavy">${'<span>x </span>'.repeat(15_000)}</div>`),
};

const IDS = ['onetrust-banner-sdk', 'consent-notice', 'nag', 'leave'];
const present = (id: string) => `(() => !!document.getElementById(${JSON.stringify(id)}))()`;
const isTrue = (s: ReadySnapshot) => s.probe === true;

let browser: PlaywrightBrowser;
let site: HtmlSite;
beforeAll(async () => {
  site = await serveHtml(PAGES);
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

describe('the final pass before the screenshot (spec 2026-10-19 §3.4)', () => {
  it('closes a cookie banner that appeared after the first pass (puma\'s late OneTrust)', async () => {
    const c = await browser.capture(`${site.baseUrl}/late-banner`, {
      waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS),
      ready: { script: present('onetrust-banner-sdk'), isReady: isTrue, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300 },
    });
    const s = c.annotation as PageState;
    expect(c.timings?.readyState).toBe('ready');
    expect(s.flags.acceptedAt as number).toBeGreaterThanOrEqual(LATE_MS);
    expect(s.exists['onetrust-banner-sdk']).toBe(false);
  }, 60_000);

  it('leaves the page at the top after a dismissal click scrolled it (ikea)', async () => {
    const c = await browser.capture(`${site.baseUrl}/scrolled`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS) });
    const s = c.annotation as PageState;
    expect(s.clicks).toContain('notice-ok');
    expect(s.scrollY).toBe(0);
  }, 60_000);

  it('logs one warning line naming an overlay it could not close, and still captures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await browser.capture(`${site.baseUrl}/nag`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
      const lines = warn.mock.calls.map((args) => String(args[0])).filter((l) => l.includes('overlay still covers'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/: an overlay still covers the middle of the page after dismissal: div#nag "Subscribe to our newsletter/);
      expect(c.screenshotTiles).toHaveLength(1);
      expect(c.timings!.totalMs).toBeLessThan(15_000); // four rounds per pass, bounded
    } finally {
      warn.mockRestore();
    }
  }, 60_000);

  it('ends on the requested page when a final-pass click navigates by script (Review Focus 4)', async () => {
    const c = await browser.capture(`${site.baseUrl}/navigating-close`, {
      waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1,
      ready: { script: present('leave'), isReady: isTrue, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300 },
    });
    expect(site.requested).toContain('/elsewhere');
    expect(new URL(c.url).pathname).toBe('/navigating-close');
  }, 60_000);
});

describe('a page with no overlay is captured as today (spec §5.5)', () => {
  it('adds no wait: a heavy page with nothing over it, no warning (Review Focus 5)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await browser.capture(`${site.baseUrl}/heavy`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
      // Today's floor is the 1.5 s settle wait before the first pass plus one screenshot. A second
      // settle wait, or a loop that does not stop on a clean page, lands well above this bound.
      expect(c.timings!.totalMs - c.timings!.navigateMs).toBeLessThan(2_500);
      expect(warn.mock.calls.some((args) => String(args[0]).includes('overlay still covers'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  }, 60_000);
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx vitest run src/capture-final-pass.test.ts`
Expected: FAIL on the late banner (still there), `/scrolled` (scrollY > 0), `/nag` (no warning line) and `/navigating-close` (`/elsewhere` never requested). `/heavy` PASSES — it is the guard. If `/heavy` fails here, before any Task 4 change, read the measured value from the failure: set the bound to that value plus 400 ms, and say so in the commit message.

- [ ] **Step 6: Add the final pass to `capture()`**

In `packages/browser/src/playwright-browser.ts`, extend the overlays import with `CENTRE_OVERLAY_SCRIPT, overlayWarning`. Then find:

```ts
        if (options.ready && readyWhen === 'after-expand') {
          ready = await this.waitUntilReady(page, url, intercepted, options.ready);
          await stage(`ready (after expand): ${ready.state}`);
        }
```

and insert right after it:

```ts

        // Spec 2026-10-19 §3.4: one more dismissal pass for what arrived late (a consent manager
        // that renders after the first pass), with no settle wait — a page with nothing over it
        // costs no time. A close button can navigate by script, so the check runs again. Then
        // back to the top: a dismissal click scrolls its element into view.
        await this.dismissPopups(page, { settleMs: 0 });
        await this.returnIfNavigatedAway(page, url, options);
        await page.evaluate('window.scrollTo(0, 0)').catch((err) => { if (isCrash(err)) throw err; });
        const covering = (await page.evaluate(CENTRE_OVERLAY_SCRIPT).catch((err) => {
          if (isCrash(err)) throw err;
          return null;
        })) as OverlayDescription | null;
        if (covering) console.warn(overlayWarning(url, covering));
        await stage('after final pass');
```

In `returnIfNavigatedAway`, replace the two comment lines

```ts
    // Deliberately no second dismissal pass: it is what moved us, and a popup
    // left standing costs far less than silently capturing another product.
```

with:

```ts
    // No dismissal here. capture() runs one final pass after the first return and
    // then calls this once more; after that second return nothing clicks again —
    // a popup left standing costs far less than silently capturing another product.
```

- [ ] **Step 7: Run the capture tests**

Run: `npx vitest run src/capture-final-pass.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Run every browser test file this plan touched or that captures, one at a time**

Run each, one after another, from `packages/browser`; each Expected: PASS.
`npx vitest run src/overlays.test.ts`
`npx vitest run src/overlays-page.test.ts`
`npx vitest run src/capture-expand-overlays.test.ts`
`npx vitest run src/capture-dismiss.test.ts`
`npx vitest run src/capture-annotate.test.ts`
`npx vitest run src/capture-ready.test.ts`
`npx vitest run src/capture-ready-after-expand.test.ts`
`npx vitest run src/capture-verdict.test.ts`
`npx vitest run src/dismiss-navigation.test.ts`
`npx vitest run src/set-content-evaluate.test.ts`
Then: `cd ../scraper && npx vitest run src/__fixtures__/capture-no-scroll.test.ts` — Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `cd ../browser && npx tsc --noEmit`
Expected: no error in a file this task touched.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-captures
git add packages/browser/src/overlays.ts packages/browser/src/overlays.test.ts packages/browser/src/capture-final-pass.test.ts packages/browser/src/playwright-browser.ts
git commit -m "$(cat <<'EOF'
feat(browser): one more dismissal pass before the screenshot, back to the top, one warning line

Spec 2026-10-19 §3.4: late banners are closed, a dismissal click's scroll is undone, an overlay
still at the centre is logged by tag, id and text. The navigated-away check runs again after the
final pass. No settle wait on that pass: a clean page costs no time (§5.5).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The free live-check script and the docs

**Files:**
- Create: `docs/testing/capture-overlays-check.mts`
- Modify: `docs/superpowers/specs/2026-10-19-capture-overlays-design.md` (Status paragraph)
- Modify: `docs/handoff.md` (new section before `## Verify dead ends (2026-10-17)`)
- Modify: `CLAUDE.md` (Key Technical Decisions: the popup line, one new line)
- Modify: `docs/testing/2026-10-11-campaign-2.md` (group 2 marked)

**Interfaces:**
- Consumes: `PlaywrightBrowser.capture` with `annotate` and `maxTiles`; `CENTRE_OVERLAY_SCRIPT` (Task 1).
- Produces: `docs/testing/capture-overlays-check.mts` with `--self-test`; the post-merge live run writes `docs/testing/results/2026-10-19-capture-overlays/<site>-<n>-after.png|json` and `after.md`.

- [ ] **Step 1: Write the live-check script**

Create `docs/testing/capture-overlays-check.mts`:

```ts
// Live check for "captures without overlays" (spec docs/superpowers/specs/2026-10-19-capture-overlays-design.md §6).
// Re-captures campaign 2's group 2 proof pages with the real PlaywrightBrowser and writes, beside the
// before screenshots (`<site>-<n>-A.png`, probe.mts mode A, 2026-10-19):
//   <site>-<n>-after.png    the first tile, as a proof page gets it
//   <site>-<n>-after.json   what covers the centre, the visible dialogs, what stayed expanded
//   after.md                one table, every page
// Free and keyless: no API, no server, one browser at a time. Never run two of these at once.
//
// Run from packages/browser, so `playwright` resolves:
//   npx tsx ../../docs/testing/capture-overlays-check.mts                  every site
//   npx tsx ../../docs/testing/capture-overlays-check.mts ikea,pumade      some sites
//   npx tsx ../../docs/testing/capture-overlays-check.mts --self-test      a local page, no network
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlaywrightBrowser } from '../../packages/browser/src/playwright-browser.ts';
import { CENTRE_OVERLAY_SCRIPT, type OverlayDescription } from '../../packages/browser/src/overlays.ts';

const SITES: Array<[string, string[]]> = [
  ['colourpop', ['https://colourpop.com/products/aurora-stuck-shadow-palette', 'https://colourpop.com/products/fade-to-hue-pressed-powder-makeup-palette']],
  ['mejuri', ['https://mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+Gold', 'https://mejuri.com/my/en/products/diamonds-band?Material=14k+Yellow+Gold&Stone=Natural+Diamond']],
  ['kith', ['https://kith.com/collections/kith-women-sweatshirts/products/khwa030083-338', 'https://kith.com/collections/kith-women-sweatshirts/products/khwa030103-2017']],
  ['skullcandy', ['https://www.skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-personal-sound', 'https://www.skullcandy.com/products/grom-wireless-headphones-for-kids']],
  ['lacoste', ['https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=001', 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031']],
  ['pumade', ['https://eu.puma.com/de/de/pd/suede-classic-sneakers-unisex/399781?swatch=07', 'https://eu.puma.com/de/de/pd/palermo-sneakers-unisex/396463?swatch=98']],
  ['thomann', ['https://www.thomann.de/de/taylor_814ce_n.htm?type=category', 'https://www.thomann.de/de/taylor_112ce_n.htm?type=category', 'https://www.thomann.de/de/taylor_314ce_n.htm?type=category']],
  ['ikea', ['https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/', 'https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/']],
];

interface Probe {
  url: string;
  scrollY: number;
  width: number;
  centre: OverlayDescription | null;
  dialogs: string[];
  expanded: { aria: number; details: number; tabs: string[] };
}

// Read after the capture's last pass (annotate runs after it, just before the screenshot).
const PROBE = `(() => {
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight; };
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  return {
    url: location.href,
    scrollY: Math.round(scrollY),
    width: document.documentElement.scrollWidth,
    centre: ${CENTRE_OVERLAY_SCRIPT},
    dialogs: [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]')].filter(vis).map((d) => desc(d) + ' «' + txt(d).slice(0, 50) + '»'),
    expanded: {
      aria: document.querySelectorAll('main [aria-expanded="true"], article [aria-expanded="true"]').length,
      details: document.querySelectorAll('details[open]').length,
      tabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) => txt(t).slice(0, 30)),
    },
  };
})()`;

interface Row {
  page: string;
  url: string;
  verdict: string;
  centre: string;
  dialogs: number;
  scrollY: number;
  expanded: string;
  warnings: string[];
  error?: string;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');

async function checkPage(b: PlaywrightBrowser, page: string, url: string, outDir: string): Promise<Row> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); warn(...args); };
  try {
    const c = await b.capture(url, { interceptNetworkRequests: false, maxTiles: 1, timeout: 60_000, annotate: PROBE });
    writeFileSync(join(outDir, `${page}-after.png`), c.screenshotTiles[0] ?? c.screenshot);
    writeFileSync(join(outDir, `${page}-after.json`), JSON.stringify({ url, finalUrl: c.url, verdict: c.verdict, probe: c.annotation, warnings }, null, 1));
    const p = c.annotation as Probe | undefined;
    return {
      page, url, verdict: c.verdict.kind,
      centre: p?.centre ? `${p.centre.tag}${p.centre.id ? '#' + p.centre.id : ''} «${p.centre.text}»` : (p ? 'none' : '?'),
      dialogs: p?.dialogs.length ?? -1,
      scrollY: p?.scrollY ?? -1,
      expanded: p ? `${p.expanded.aria} / ${p.expanded.details} / ${p.expanded.tabs.join(', ') || '–'}` : '?',
      warnings,
    };
  } catch (err) {
    return { page, url, verdict: 'failed', centre: '?', dialogs: -1, scrollY: -1, expanded: '?', warnings, error: (err as Error).message.split('\n')[0].slice(0, 160) };
  } finally {
    console.warn = warn;
  }
}

function table(rows: Row[]): string {
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a checkout */ }
  return [
    '# Capture overlays — after (live check)',
    '',
    `Run on ${new Date().toISOString().slice(0, 10)} at \`${commit}\` with \`docs/testing/capture-overlays-check.mts\` (free, keyless, one browser; the browser is wherever this machine is).`,
    'Before: `<site>-<n>-A.png` (probe.mts mode A, 2026-10-19). After: `<site>-<n>-after.png`.',
    'Expected per page (spec §6): no overlay at the window\'s centre, and the §5.3 accordions and tabs still open.',
    '',
    '| Page | Verdict | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Overlay warnings | Before | After |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.page} | ${cell(r.verdict)}${r.error ? ` (${cell(r.error)})` : ''} | ${cell(r.centre)} | ${r.dialogs} | ${r.scrollY} | ${cell(r.expanded)} | ${r.warnings.filter((w) => w.includes('overlay still covers')).length} | [before](${r.page}-A.png) | [after](${r.page}-after.png) |`),
    '',
    '## Reading',
    '',
  ].join('\n') + '\n';
}

async function selfTest(): Promise<void> {
  // A lightbox behind a Zoom button, an accordion, and a banner with "Cookie settings" before "OK".
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Widget</title></head><body style="margin:0">
<main style="min-height:2400px"><h1>Widget</h1><p>$12.50</p>
<button id="zoom" aria-expanded="false">Zoom</button>
<button id="acc" aria-expanded="false" aria-controls="panel">Materials</button><div id="panel" hidden>Cotton</div></main>
<modal-dialog id="zoom-modal" style="display:none;position:fixed;inset:0;background:#000"></modal-dialog>
<div class="cookie-banner" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff"><button id="s">Cookie settings</button><button id="ok">OK</button></div>
<script>
document.getElementById('zoom').onclick = () => { document.getElementById('zoom-modal').style.display = 'block'; };
document.getElementById('acc').onclick = function () { this.setAttribute('aria-expanded', 'true'); document.getElementById('panel').hidden = false; };
document.getElementById('ok').onclick = () => document.querySelector('.cookie-banner').remove();
</script></body></html>`;
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/1`;
  const out = join(tmpdir(), 'capture-overlays-self-test');
  mkdirSync(out, { recursive: true });
  const b = new PlaywrightBrowser();
  await b.launch({ headless: true });
  try {
    const row = await checkPage(b, 'self-1', url, out);
    console.log(JSON.stringify(row, null, 1));
    const ok = row.verdict !== 'failed' && row.centre === 'none' && row.expanded.startsWith('1 ');
    console.log(ok ? `self-test passed; files in ${out}` : 'self-test FAILED');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await b.close();
    server.close();
  }
}

if (process.argv[2] === '--self-test') {
  await selfTest();
} else {
  const outDir = fileURLToPath(new URL('./results/2026-10-19-capture-overlays/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const only = process.argv[2]?.split(',');
  const rows: Row[] = [];
  for (const [site, urls] of SITES) {
    if (only && !only.includes(site)) continue;
    const b = new PlaywrightBrowser();
    await b.launch({ headless: true });
    try {
      for (const [i, url] of urls.entries()) {
        const row = await checkPage(b, `${site}-${i + 1}`, url, outDir);
        rows.push(row);
        console.log(`${row.page} ${row.verdict} centre=${row.centre} dialogs=${row.dialogs} scrollY=${row.scrollY} expanded=${row.expanded}${row.error ? ` error=${row.error}` : ''}`);
      }
    } finally {
      await b.close();
    }
  }
  const name = only ? `after-${only.join('-')}.md` : 'after.md';
  writeFileSync(join(outDir, name), table(rows));
  console.log(`wrote ${join(outDir, name)}`);
}
```

- [ ] **Step 2: Run the self-test (local page, no network)**

Run (Bash): `cd /c/Users/Marko/Documents/projects/robot-platform-captures/packages/browser && npx tsx ../../docs/testing/capture-overlays-check.mts --self-test`
Expected: the row printed with `"centre": "none"` and `"expanded": "1 / 0 / –"`, then `self-test passed; files in …`, exit code 0. (Do not run the full live check on the branch: it runs on `main` after merge — see the end of this plan.)

- [ ] **Step 3: Commit the script**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-captures
git add docs/testing/capture-overlays-check.mts
git commit -m "$(cat <<'EOF'
test(browser): free live check for captures without overlays, with an offline self-test

Re-captures campaign 2's group 2 proof pages and writes after-screenshots and a table beside the
before ones (spec 2026-10-19 §6). Run on main after merge, one browser at a time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Update the spec's Status paragraph**

In `docs/superpowers/specs/2026-10-19-capture-overlays-design.md`, replace the Status paragraph's opening up to and including `Not yet reviewed by Marko.` (whatever its wording is when you get there — the planner rewrote it once) with:

```markdown
**Status:** built on `feat/capture-overlays` per its plan
(`docs/superpowers/plans/2026-10-19-capture-overlays.md`, which departs from §3.1–§3.4 in eight small
ways listed under "Where the plan departs from the spec"; the plan wins where they differ) and
proven offline by the fixture tests in `packages/browser`. The live check
(`docs/testing/capture-overlays-check.mts`) runs on `main` after merge. Not yet reviewed by Marko.
```

Keep the rest of the paragraph (from `The problem` on) as it is.

- [ ] **Step 5: Add the handoff section**

In `docs/handoff.md`, insert before the line `## Verify dead ends (2026-10-17)`:

```markdown
## Captures without overlays (2026-10-19)

Spec `docs/superpowers/specs/2026-10-19-capture-overlays-design.md`, plan
`docs/superpowers/plans/2026-10-19-capture-overlays.md`, evidence
`docs/testing/results/2026-10-19-capture-overlays/findings.md`. Branch `feat/capture-overlays`
from `main` at `ed3cf41`. Campaign 2, group 2 (`docs/testing/2026-10-11-campaign-2.md`).

**What a customer gets.** Nothing new on any screen. A proof page's screenshot shows the product
where it used to show a zoom lightbox, a size-guide drawer, a video modal, a cookie preference
centre or a geo popup, so marking works where it did not, and the judge and Jev read the product.
Captures already stored are not redone; a re-capture gets the clean screenshot.

**What changed** (all in `packages/browser`; the rules and the page code are in `src/overlays.ts`):

1. **One overlay definition** (§3.1): a visible dialog (`role=dialog/alertdialog`, `aria-modal`,
   an open `<dialog>`), a fixed or absolute box named modal/drawer/lightbox/popup/dialog covering a
   quarter of the window, or any fixed box covering a quarter that is not a header or footer —
   never `<html>`, `<body>` or a box holding the page's `main` or first `h1`.
2. **The expand pass never leaves an overlay** (§3.2): it skips `aria-haspopup` layer triggers,
   controls whose `aria-controls` target is dialog-like, and anything inside an overlay; it clicks
   each control once (one already expanded counts as clicked); an overlay that appears during a
   round is closed (Escape, then removed, scroll lock lifted). The tabs step has the same rules and
   never follows a link elsewhere or to a file.
3. **Dismissal** (§3.3): whole names, not substrings ("Cookie settings", "look", "Rosy Outlook" are
   not "OK"); never a variant control, a settings/preferences/manage/options control or a link
   away; a click counts only if the element or its layer went away, and a dead one is never
   retried; each round first closes the topmost layer by its own close word (Close, Schließen, ×,
   …); then a removal pass hides every overlay (its text stays in the HTML) and removes today's
   selectors; at most four rounds and six clicks per pass. Consent banners in open shadow roots are
   still reached.
4. **One more pass just before the screenshot** (§3.4), the navigated-away check again, then the
   page scrolls to the top. An overlay still at the centre is one warning line:
   `[browser] <url>: an overlay still covers the middle of the page after dismissal: div#x "…"`.
   No new field on the capture result.

**Found on the way.** The old tabs step never ran under `pnpm dev:all`: tsx (esbuild `keepNames`)
serialised its inner `function clickTab` with `__name(…)`, the page has no `__name`, and the
step's `catch` hid the error — tabs were clicked only under vitest. All page code now goes through
`pageScript()` with an `__name` shim, so real captures click tabs for the first time. Watch the
live check for tabs that load something unexpected.

**Tests** (each file alone: `cd packages/browser && npx vitest run src/<file>`): `overlays.test.ts`
(pure rules), `overlays-page.test.ts` (the definition in Chromium), `capture-expand-overlays.test.ts`,
`capture-dismiss.test.ts`, `capture-final-pass.test.ts`; `dismiss-navigation.test.ts` unchanged;
`packages/scraper/src/__fixtures__/capture-no-scroll.test.ts` still green.

**Live check — runs on `main` after merge.** Free, keyless, one browser:
`cd packages/browser && npx tsx ../../docs/testing/capture-overlays-check.mts` (`--self-test` first:
a local page, no network). It re-captures the findings' proof pages and writes
`<site>-<n>-after.png` and `after.md` beside the before screenshots. Expected: no overlay at the
centre on each page; the §5.3 accordions and tabs still open.

**Open.** Thomann's `waitUntil: 'load'` timing out at 45 s in the judge and Jev scripts (§7);
choosing a shop's country (§7); a customer message for "the product is covered" if the live check
shows it is still common (§8.3). A fixed buy box covering a quarter of the window is hidden from the
screenshot (its text stays in the HTML) — watch for it in the live check.
```

- [ ] **Step 6: Update `CLAUDE.md`**

Replace the line

```markdown
- Popup auto-dismissal — 3 rounds of click + JS removal before capture
```

with

```markdown
- Popup auto-dismissal — up to 4 rounds of whole-name and close-word clicks (each counts only if it worked) and a removal pass every round, then one more pass just before the screenshot (2026-10-19)
```

and insert, right after the line that begins `- Jev at Verify, in shadow (2026-10-16):`, this line:

```markdown
- Captures without overlays (2026-10-19): a capture closes what the page put over the product and never opens anything over it itself. One overlay definition (`packages/browser/src/overlays.ts`); the expand pass skips layer triggers, clicks each control once and closes any overlay it opened; dismissal never clicks a variant, settings or navigating control, closes the topmost layer by its close word and hides overlays every round; after a final pass the page scrolls to the top, and an overlay still at the centre is one warning line, never a field on the result. Page code goes through `pageScript()` (esbuild `__name` shim).
```

- [ ] **Step 7: Mark campaign 2's group 2**

In `docs/testing/2026-10-11-campaign-2.md`:

Replace

```markdown
   - Too wide: ridge, ruggable and mejuri put the product column at x≈2068–3474, off a 1280-px screenshot.
```

with

```markdown
   - Too wide: ridge, ruggable and mejuri put the product column at x≈2068–3474, off a 1280-px screenshot. Fixed by the stealth change of 2026-10-16 (`e59a2ed`).
   - Overlays fixed: spec 2026-10-19 (captures without overlays) — our own expand and dismissal passes opened or kept seven of the eight; live check `docs/testing/results/2026-10-19-capture-overlays/after.md` (after merge).
```

and replace

```markdown
   - stop the popup pass from opening drawers and videos;
```

with

```markdown
   - stop the popup pass from opening drawers and videos — done, spec 2026-10-19;
```

- [ ] **Step 8: Commit the docs**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-captures
git add docs/superpowers/specs/2026-10-19-capture-overlays-design.md docs/handoff.md CLAUDE.md docs/testing/2026-10-11-campaign-2.md
git commit -m "$(cat <<'EOF'
docs: captures without overlays — spec status, handoff, CLAUDE.md decision, campaign 2 group 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## After merge: the live check (controller, on `main`)

Not a branch task: it needs the merged code and a quiet machine. Free, keyless, no server.

1. From `packages/browser` on `main`: `npx tsx ../../docs/testing/capture-overlays-check.mts --self-test` — expect `self-test passed`.
2. Run the full check in the background (about 10–20 minutes, one browser; nothing else Chromium-heavy at the same time): `npx tsx ../../docs/testing/capture-overlays-check.mts`. If the memory watchdog kills it, rerun the missing sites by name (`… ikea,pumade`); that writes `after-ikea-pumade.md` — merge its rows into `after.md` by hand.
3. Open each before/after pair with the Read tool (`<site>-<n>-A.png`, `<site>-<n>-after.png`) and write one line per site under `## Reading` in `after.md`: what the after-screenshot shows, whether §5.3's expansions are still there (mejuri, puma and ikea accordions, skullcandy's `<details>`, kith, ikea and thomann tabs), and any surprise from tabs now being clicked under tsx.
4. Update the handoff section's "Live check" paragraph with the outcome (N of 8 sites with no overlay at the centre; what remains) and the spec's Status line ("live-checked on `main` @ `<sha>`: …").
5. Commit by explicit path: the `*-after.png`, `*-after.json` and `after*.md` files in `docs/testing/results/2026-10-19-capture-overlays/`, `docs/handoff.md`, the spec. A site that still shows an overlay is recorded as open, with its element; no code change on `main` without a plan.
