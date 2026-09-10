# MVP Flow Phase 5: Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's visual tokens with the approved direction ("B, with the left border rail of A": Fraunces names, Public Sans interface text, IBM Plex Mono values, warm paper, moss accent, a 3px status rail), restyle every remaining screen onto it, finish the polish parked by phases 3 and 4, and capture one screenshot per screen state for hand review.

**Architecture:** Almost all of the restyle happens in one file: `styles.css`'s `@theme` block remaps the `gray-*` ramp, `accent-*`, fonts and status colours so every existing utility class picks up the new palette, and a handful of named utilities (`sheet`, `strip`, `label-soft`, `cell-rail-*`, `btn-*`) replace the per-file class soup that would otherwise drift. The screens then change only where structure differs from the spec (paper with rules instead of boxes, Fraunces for names, mono for values, 36px/32px rows, no uppercase labels, no glyphs in cells). Palette and type scale live as data in `lib/tokens.ts` so a unit test can prove the contrast rule mechanically. The route files stay where they are; two dead routes are deleted; the website delete moves from the run page to Settings, where the spec puts it.

**Tech Stack:** Tailwind v4 (`@theme`, `@utility`), React 19, TanStack Router, Vitest, Playwright (smoke + screenshots), Google Fonts.

**Spec:** `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` sections 7 (all, binding tokens), 6 (copy rules: sentence case, no uppercase tracked labels, no middle-dot chains in prose), 5.5 to 5.8 (screens), 10 (visual screenshots), 12 phase 5. Approved direction: `.superpowers/brainstorm/1289-1788861057/content/visual.html` variant B for palette and type, variant A's inset 3px rail for status (never B's ✓/✕ glyphs). The frontend-design skill's guidance applies: one memorable element (the proof-sheet table with its 2px ink rule and rails), everything else quiet; no decorative motion; no all-caps labels; no `·` chains in prose.

## Global Constraints

- Tokens (spec 7, verbatim). Type: Fraunces 500/600 for names of things (project name, website name, page titles); Public Sans 400/500/600 for interface text; IBM Plex Mono 400/500 for every value, URL, key and number in a table. Scale: 24/1.2 title, 18/1.25 section, 14/1.5 body, 13/1.45 table, 12/1.4 secondary, 11/1.35 cell second line. Tabular numerals in tables. Palette: paper `#f3f4f1`, surface `#fbfbf9`, ink `#1c1f1a`, ink-soft `#5f665c`, rule `#d5d9d1`, rule-soft `#e1e4de`, accent `#1f5e4a`, accent-hover `#174a3a`, accent-tint `#e8f2ea`; status pass `#1f7a4d`/`#eaf4ee`, fail `#a13a2a`/`#f6e6e3`, warn `#8a5a12`/`#f5ecdc`, changed `#7a8077`/`#ebece8`; strip paper-dark `#e9ebe5`.
- Status treatment: 3px rail on the cell's left edge in the status colour, cell background in the tint, value in ink, second line in the status colour for fail and warn and ink-soft otherwise. No glyphs in cells.
- Tables: surface background, 2px ink rule on top, 1px rule-soft between rows, header row Public Sans 600 12px ink-soft, URL headers in Plex Mono with the page number under them, rows 36px on the schema grid and 32px elsewhere.
- Strip: 38px, paper-dark, radius 8px, progress bar in accent. Buttons: primary accent/white radius 6px; quiet transparent with 1px rule border and ink text; disabled 45% opacity with the reason nearby. Cards only for dialogs and the websites list; everything else sits on the paper with rules. Motion: only the verifying shimmer and the progress bar; `prefers-reduced-motion` respected. Focus ring 2px accent, 2px offset. Every text token on its tint at least 4.5:1.
- Copy (spec 6): sentence case everywhere; no uppercase tracked labels (the `micro-label` utility is retired); no middle-dot chains in prose (a strip may use one separator between two facts); customer-facing text never says "source", "dataset", "input set".
- Structure does not change: no route moves, no procedure changes except `sources.delete` gaining nothing (it already exists). The Schema tab and Extract tab keep their tested behaviour; only classes and the parked polish change.
- Light mode only. No new dependencies (fonts via the existing Google Fonts link). Existing tests stay green; `pnpm test:ui` (RUN_UI_SMOKE=1) must pass against `pnpm dev:all`.
- Gate per package with one worker on this machine (`pnpm --filter <pkg> test -- --maxWorkers=1`). Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AZ6EysmV6fcq3FxP33KFsw`. Windows, Git Bash; `npx pnpm` if the launcher fails.
- Live checks are free by construction (screenshots of existing state; no Verify with a dollar label, no Extract).

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `packages/dashboard/src/lib/tokens.ts` (+test) | Palette and scale as data; `contrastRatio`; the test proves 4.5:1 for every text/tint pair | Create |
| `packages/dashboard/src/styles.css` | `@theme` remap (fonts, gray ramp → warm neutrals, accent → moss, status), utilities `sheet`, `sheet-row`, `strip`, `label-soft`, `name`, `btn-primary`, `btn-quiet`, `cell-rail-*`, `shimmer` | Rewrite |
| `packages/dashboard/index.html` | Fonts link: Fraunces 500/600, Public Sans 400/500/600, IBM Plex Mono 400/500; theme-color paper | Modify |
| `components/layout.tsx`, `page-header.tsx`, `sub-tab-nav.tsx`, `page-states.tsx`, `dialog.tsx`, `inline-rename.tsx`, `status-strip.tsx`, `run-status-dot.tsx` | Shell on the new tokens | Modify |
| `routes/datasets-list.tsx`, `routes/dataset-detail.tsx` | Not routed since phase 1 | Delete |
| `components/schema-grid.tsx`, `page-header-cell.tsx`, `lib/schema-tab-view.ts` (+test), `routes/source-schema.tsx` | Proof-sheet table, rails on tokens, rough time, a11y items | Modify |
| `components/stepper.tsx`, `extract-pages.tsx`, `extract-sample.tsx`, `extract-run.tsx`, `results-table.tsx`, `routes/source-extract.tsx` | Sections on paper with rules; sheet tables | Modify |
| `routes/projects-list.tsx`, `project-home.tsx`, `project-output.tsx`, `sources-list.tsx`, `source-detail.tsx`, `source-runs.tsx`, `source-config.tsx`, `components/contract-editor.tsx`, `schema-import.tsx` | Customer screens restyled; Settings gains delete | Modify |
| `routes/source-run-detail.tsx` | Restyle only; delete-website block moves out | Modify |
| `routes/domains-list.tsx`, `domain-detail.tsx`, `project-domains-list.tsx`, `project-domain-detail.tsx` | Ops screens restyled | Modify |
| `routes-smoke.test.ts` | Screenshot per screen state into `docs/testing/screens/` when `RUN_UI_SMOKE=1` | Modify |
| `docs/handoff.md`, spec section 12 | Phase 5 note; "landed" | Modify |

---

### Task 1: Tokens as data, the contrast proof, the stylesheet and fonts

**Files:**
- Create: `packages/dashboard/src/lib/tokens.ts`, `packages/dashboard/src/lib/tokens.test.ts`
- Rewrite: `packages/dashboard/src/styles.css`
- Modify: `packages/dashboard/index.html`

**Interfaces:**
```ts
export const palette = {
  paper: '#f3f4f1', surface: '#fbfbf9', paperDark: '#e9ebe5',
  ink: '#1c1f1a', inkSoft: '#5f665c', rule: '#d5d9d1', ruleSoft: '#e1e4de',
  accent: '#1f5e4a', accentHover: '#174a3a', accentTint: '#e8f2ea',
  pass: '#1f7a4d', passTint: '#eaf4ee', fail: '#a13a2a', failTint: '#f6e6e3',
  warn: '#8a5a12', warnTint: '#f5ecdc', changed: '#7a8077', changedTint: '#ebece8',
} as const;
export const textOnTint: Array<[text: keyof typeof palette, bg: keyof typeof palette]> = [
  ['ink','paper'],['ink','surface'],['ink','paperDark'],['inkSoft','paper'],['inkSoft','surface'],['inkSoft','paperDark'],
  ['ink','passTint'],['pass','passTint'],['ink','failTint'],['fail','failTint'],['ink','warnTint'],['warn','warnTint'],
  ['ink','changedTint'],['changed','changedTint'],['accent','paper'],['accent','surface'],['accent','accentTint'],
];
export function contrastRatio(hexA: string, hexB: string): number;   // WCAG 2.x relative luminance
export const scale = { title: [24, 1.2], section: [18, 1.25], body: [14, 1.5], table: [13, 1.45], secondary: [12, 1.4], cellLine: [11, 1.35] } as const;
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { palette, textOnTint, contrastRatio } from './tokens.js';
describe('tokens', () => {
  it('contrastRatio matches the WCAG reference pairs', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
  it('every text token on its tint is at least 4.5:1 (spec 7)', () => {
    for (const [text, bg] of textOnTint) expect(contrastRatio(palette[text], palette[bg]), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run, see it fail** — `pnpm --filter @robot/dashboard exec vitest run src/lib/tokens.test.ts`.

- [ ] **Step 3: Implement `tokens.ts`** (relative luminance per WCAG: sRGB channel → linear with the 0.03928 threshold; ratio `(L1+0.05)/(L2+0.05)`). If a pair fails the 4.5 rule, the palette in the spec is wrong for that pair: darken the text token minimally, record the new hex in the ledger and in Task 8's spec note, and keep the test as the proof. Do not lower the threshold.

- [ ] **Step 4: Rewrite `styles.css`**

```css
@import "tailwindcss";
/* Proof sheet: names in Fraunces, interface in Public Sans, values in Plex Mono. Warm paper, moss accent, a rail for status. Spec 7. */
@theme {
  --font-sans: "Public Sans", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Fraunces", Georgia, serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  /* The gray ramp is remapped to the warm neutrals so every existing gray-* class lands on the paper. */
  --color-gray-50: #fbfbf9;  /* surface */
  --color-gray-100: #f3f4f1; /* paper */
  --color-gray-200: #e1e4de; /* rule-soft */
  --color-gray-300: #d5d9d1; /* rule */
  --color-gray-400: #9ba39a;
  --color-gray-500: #7a8077; /* changed */
  --color-gray-600: #5f665c; /* ink-soft */
  --color-gray-700: #444a42;
  --color-gray-800: #2b312b;
  --color-gray-900: #1c1f1a; /* ink */
  --color-gray-950: #121410;
  --color-accent-50: #e8f2ea;  /* tint */
  --color-accent-100: #d3e6d8;
  --color-accent-500: #1f5e4a;
  --color-accent-600: #1f5e4a;
  --color-accent-700: #174a3a; /* hover */
  --color-pass: #1f7a4d;   --color-pass-tint: #eaf4ee;
  --color-fail: #a13a2a;   --color-fail-tint: #f6e6e3;
  --color-warn: #8a5a12;   --color-warn-tint: #f5ecdc;
  --color-changed: #7a8077; --color-changed-tint: #ebece8;
  --color-paper-dark: #e9ebe5;
  --color-white: #fbfbf9; /* "white" surfaces become surface */
}
@layer base {
  body { @apply bg-gray-100 text-gray-900 antialiased; font-size: 14px; line-height: 1.5; }
  ::selection { background: var(--color-accent-50); }
  :focus-visible { outline: 2px solid var(--color-accent-500); outline-offset: 2px; }
  table { font-variant-numeric: tabular-nums; font-size: 13px; line-height: 1.45; }
  h1 { @apply font-serif text-2xl font-semibold leading-[1.2] tracking-[-0.005em]; }
  h2 { @apply font-serif text-lg font-medium leading-[1.25]; }
}
/* The name of a thing (project, website, page title). */
@utility name { @apply font-serif font-semibold tracking-[-0.005em]; }
/* Secondary label, sentence case: replaces the retired uppercase micro-label. */
@utility label-soft { @apply text-xs font-medium text-gray-600; }
/* Card: dialogs and the websites list only. */
@utility card { @apply rounded-lg border border-gray-300 bg-gray-50; }
/* Sheet: a table on the paper. 2px ink rule on top, rule-soft between rows, surface background. */
@utility sheet { @apply w-full border-t-2 border-t-gray-900 bg-gray-50; }
@utility sheet-head { @apply text-xs font-semibold text-gray-600; }
@utility sheet-row { @apply border-b border-gray-200; }
/* Status strip (38px, paper-dark, radius 8). */
@utility strip { @apply flex h-[38px] items-center gap-3 overflow-hidden rounded-lg bg-paper-dark px-3 text-sm text-gray-900; }
@utility btn-primary { @apply inline-flex items-center justify-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-45 disabled:hover:bg-accent-600 disabled:pointer-events-none; }
@utility btn-quiet { @apply inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-45 disabled:pointer-events-none; }
/* The rail is the glyph. */
@utility cell-rail-pass { @apply border-l-[3px] border-l-pass bg-pass-tint; }
@utility cell-rail-fail { @apply border-l-[3px] border-l-fail bg-fail-tint; }
@utility cell-rail-stale { @apply border-l-[3px] border-l-changed bg-changed-tint; }
@utility cell-rail-not-captured { @apply border-l-[3px] border-l-warn bg-warn-tint; }
@utility cell-rail-none { @apply border-l-[3px] border-l-transparent; }
@utility line-pass { @apply text-gray-600; }  @utility line-fail { @apply text-fail; }  @utility line-warn { @apply text-warn; }  @utility line-stale { @apply text-gray-600; }
/* shimmer: keep the existing block and its reduced-motion rule. */
```

Keep the existing `shimmer` block. If Tailwind v4 rejects `--color-white` in `@theme`, drop that line and let Task 2 replace `bg-white` with `bg-gray-50` where it matters (grep count is small). `text-white` on the primary button stays white.

- [ ] **Step 5: `index.html`** — fonts link `https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap`; `theme-color` `#f3f4f1`.

- [ ] **Step 6: Typecheck, run the dashboard unit tests, open `pnpm dev:all` and eyeball `/projects` once** (the remap alone should already read as paper and moss; nothing may be unreadable). **Step 7: Commit** — `feat(dashboard): proof-sheet tokens — fonts, warm palette, sheet/strip/rail utilities; contrast proven in a test`.

---

### Task 2: The shell, and two dead routes

**Files:**
- Modify: `components/layout.tsx`, `page-header.tsx`, `sub-tab-nav.tsx`, `page-states.tsx`, `dialog.tsx`, `inline-rename.tsx`, `status-strip.tsx`, `run-status-dot.tsx`
- Delete: `routes/datasets-list.tsx`, `routes/dataset-detail.tsx` (not imported by `router.tsx`; confirm with grep before `git rm`)

Rules: header bar on paper with a 1px rule-soft bottom, wordmark in Fraunces 500 ("robot platform", no middle dot), nav links Public Sans; `PageHeader` title uses `name` (24/1.2), description 12/1.4 ink-soft; `SubTabNav` active tab underlined in accent, others ink-soft; `Spinner` neutral; `ErrorBanner` fail tint with a fail rail (no icon needed, keep the text); `EmptyState` on paper with a dashed rule border, no white box; `Dialog` keeps `card`; `InlineRename` shows the pencil only on hover/focus and uses `name`; `StatusStrip` uses the `strip` utility, tone `warn`/`error` swap the background for warn-tint/fail-tint with the matching text colour, the progress bar is accent on rule; `RunStatusDot` maps statuses to pass/fail/warn/changed tokens. `micro-label` usages inside these files → `label-soft`.

- [ ] **Step 1** edit; **Step 2** `grep -rn "micro-label" packages/dashboard/src` must show no hit in these files; typecheck; unit tests; **Step 3** commit `feat(dashboard): shell on the proof-sheet tokens; two unrouted dataset screens deleted`.

---

### Task 3: Schema tab — the proof sheet, rough time, accessibility

**Files:**
- Modify: `components/schema-grid.tsx`, `components/page-header-cell.tsx`, `lib/schema-tab-view.ts` + `schema-tab-view.test.ts`, `routes/source-schema.tsx`, `components/contract-editor.tsx`, `components/schema-import.tsx`

**Interfaces:**
```ts
export function roughTime(estimate: { fields: number; aiFields: number; capturesFresh: boolean }): string;
// capturesFresh ? aiFields * 8 s : 3 captures * 12 s + aiFields * 8 s; < 45 s → "under a minute"; else "about n min" (rounded up). Pure; tested for 0 AI fields fresh ("a few seconds"), 8 AI fields stale ("about 2 min"), 3 AI fields fresh ("under a minute").
```

Rules: table uses `sheet`/`sheet-head`/`sheet-row`, rows 36px (`h-9`), header URL cells in mono with the page number under them (`label-soft`); expected cells: rail classes on tokens, value in mono ink, second line 11/1.35 in `line-*` per status (fail and warn coloured, otherwise ink-soft); no icons inside expected cells; the capture state in the URL header is text (`captured` / `capturing` / `queued` / `not captured`) via `label-soft`, icons removed; the Verifying strip appends the rough time from `roughTime(verifyEstimate)` as its second fact ("Verifying · about 2 min" is the one allowed separator); the strip's `aria-live` stays on the strip only (remove any `aria-live` on the grid), and the disabled Verify button's reason span gets `tabIndex={0}` and `role="note"` so keyboard users can reach it; `micro-label` → `label-soft`.

- [ ] **Step 1** failing tests for `roughTime`; **Step 2** implement; **Step 3** restyle; typecheck; unit tests; browser check on Ikea's Schema tab (read-only, no Verify click); screenshot `docs/testing/screens/schema-tab-results.png` refreshed; **Step 4** commit `feat(dashboard): Schema tab as the proof sheet; rough time in the verifying strip; strip a11y`.

---

### Task 4: Extract tab on paper

**Files:**
- Modify: `components/stepper.tsx`, `extract-pages.tsx`, `extract-sample.tsx`, `extract-run.tsx`, `results-table.tsx`, `routes/source-extract.tsx`

Rules: sections are not boxes: each `Section` is a block on the paper separated by a 1px rule-soft top rule, its number and title in `name` 18/1.25, hint in ink-soft 12; a `done` section has no grey background (only its Edit link and the 60% opacity on its body); locked/later stay at 50% with the reason; the `Stepper` strip is three quiet cells with a 2px accent underline on the current one and a pass-coloured rail on done ones (no check icons); the listing table and the sample table use `sheet` (rows 32px), URLs and values in mono; the check label colours map to pass/warn/fail tokens; the run sentence's selects and number boxes are quiet inputs with a 1px rule border on surface; buttons per tokens; `results-table.tsx` header row `sheet-head`, `headerVariant='celebrate'` keeps its copy but uses accent-tint, not emerald; `micro-label` → `label-soft`.

- [ ] **Step 1** restyle; typecheck; unit tests; browser check on Ikea's Extract tab (no Extract click; a "Sample again" click is allowed, it is free); refresh `extract-pages.png`, `extract-sample.png`, `extract-run.png`; **Step 2** commit `feat(dashboard): Extract tab on paper with rules; sheet tables`.

---

### Task 5: Projects, project home, output, website header, Runs list, Settings with delete

**Files:**
- Modify: `routes/projects-list.tsx`, `project-home.tsx`, `project-output.tsx`, `sources-list.tsx`, `source-detail.tsx`, `source-runs.tsx`, `source-config.tsx`, `source-run-detail.tsx` (remove the delete-website block only)

Rules: project and website names in `name`; the websites list keeps cards (spec 7) with the name in Fraunces and the URL in mono; the projects list is a `sheet` table (name, websites, fields verified, last run) with 32px rows; Output is a sheet; Runs list is a sheet (started, status dot + word, items, link), no card; Settings: the existing toggles restyled, plus a "Delete website" quiet button in fail colour that opens the existing `Dialog` with the sentence "Delete <name>? Its runs and results are deleted too. This cannot be undone." and buttons "Delete website" / "Keep it", calling `sources.delete` and navigating to the project home; the same block is removed from `source-run-detail.tsx` (move, do not duplicate); `micro-label` → `label-soft`; no `·` chains in prose (rewrite any as sentences).

- [ ] **Step 1** restyle + move delete; typecheck; unit tests; smoke (`RUN_UI_SMOKE=1`) still green; browser check of `/projects`, a project home, a Settings tab (do not delete a real website; cancel the dialog); **Step 2** commit `feat(dashboard): customer screens on the proof sheet; website delete lives on Settings`.

---

### Task 6: Run detail

**Files:**
- Modify: `routes/source-run-detail.tsx`, `components/results-table.tsx` (only if Task 4 left header/celebrate work undone)

Rules: structure unchanged (spec 5.8); page title in `name`; the evidence summary, work list, coverage badges, backfill controls and results table move onto `sheet` tables and `label-soft` labels; status colours to tokens (`emerald` → pass, `red` → fail, `amber` → warn); the probe confirm gate is a block on paper with a rule, not a box; buttons per tokens; every `micro-label` gone; kind badges (`listing`/`detail`) are lowercase text in mono, not uppercase pills.

- [ ] **Step 1** restyle in passes (the file is ~1000 lines; keep every handler byte-identical); typecheck; unit tests; smoke; browser check on an existing Ikea run page; refresh `docs/testing/screens/run-detail.png` (new); **Step 2** commit `feat(dashboard): run detail restyled; structure unchanged`.

---

### Task 7: Ops screens

**Files:**
- Modify: `routes/domains-list.tsx`, `domain-detail.tsx`, `project-domains-list.tsx`, `project-domain-detail.tsx`

Rules: these are operator views; same tokens, `sheet` tables, mono for keys and paths, `label-soft`, no cards; the domain name in mono (it is a hostname, not a name of a thing); the health/degradation flags on pass/warn/fail tokens.

- [ ] **Step 1** restyle; typecheck; smoke; browser check `/ops/domains` and one domain; **Step 2** commit `feat(dashboard): ops screens on the proof-sheet tokens`.

---

### Task 8: Screenshots per screen state, docs, the gate

**Files:**
- Modify: `packages/dashboard/src/routes-smoke.test.ts`, `docs/handoff.md`, spec section 12 (and section 7 if a token was darkened in Task 1)

Rules: when `RUN_UI_SMOKE=1`, each `checkRoute` also writes `page.screenshot({ path: docs/testing/screens/<slug>.png, fullPage: true })` where `<slug>` is the route path with `/` → `-` (leading dash dropped), plus the four Extract moments and the Schema states already captured by earlier tasks; not asserted (spec 10). A `README.md` in `docs/testing/screens/` lists each file and the state it shows. Handoff: `## MVP flow phase 5 (2026-09-10): the proof sheet` right after the phase 4 section — tokens landed, what `styles.css` remaps and why (one file restyles everything), the utilities and their meaning, what moved (delete to Settings), what was deleted (two dataset routes), the contrast test as the mechanical guarantee, the rough time formula, any darkened token, the screenshot list; "What NOT to redo" gets one line (do not reintroduce uppercase labels or cards outside dialogs and the websites list). Spec 12 phase 5: "Landed 2026-09-10". Gate per package with one worker; `RUN_UI_SMOKE=1` run against `pnpm dev:all`.

- [ ] **Step 1** smoke screenshots; **Step 2** docs; **Step 3** gate; **Step 4** commit `test,docs: screenshots per screen state; phase 5 handoff`.

---

## Self-review

**Spec coverage:** section 7 tokens, type, palette, status treatment, tables, strip, buttons, cards rule, motion, focus, contrast (Tasks 1 to 7; contrast proven in Task 1's test); section 6 copy (every task retires `micro-label` and `·` chains); 5.5 header (Task 5), 5.6 strip rough time (Task 3), 5.7 Extract on the tokens (Task 4), 5.8 Runs and run detail restyled, Settings with rename (exists) and delete (Task 5, 6); section 10 visual screenshots (Task 8); section 12 phase 5 ops screens (Task 7). Parked from phases 3 and 4: rough time (T3), aria-live scope and disabled-reason span (T3), strip summary/detail split is already two spans (no work), 7-vs-28 listing check disagreement is engine work, not visual — recorded in the handoff as still open (T8).

**Placeholder scan:** none; every task names its files, classes and copy.

**Type consistency:** `roughTime` (T3) consumes `verifyEstimate`'s `{ fields, aiFields, capturesFresh }` which exist since phase 3; `sources.delete` (T5) exists; `sheet`/`sheet-head`/`sheet-row`/`strip`/`label-soft`/`name`/`cell-rail-*`/`line-*` are all defined in T1 and consumed by T2 to T7.
