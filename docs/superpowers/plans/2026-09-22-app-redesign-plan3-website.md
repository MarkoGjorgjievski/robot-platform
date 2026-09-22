# App Redesign — Plan 3, the Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A website has its own page in the new app — top tabs **Schema** (the stepper strip with step 1 done at the project level and step 2 "Pages and values" as today's grid, restyled), **Extract** (pages → sample → run), **Runs** (list) with a run page (results, misses, "Use as proof page"), and **Settings** (rename, listing mode, budget, delete) — and every website row and sidebar line links to it.

**Architecture:** One org-scoped loader, `sources.get({ projectSlug, sourceSlug })`, feeds the website layout, its header and every tab under one cache key; every per-website and per-run procedure the tabs call is moved onto the session's org through two helpers (`sourceInOrg`, `runInOrg`) with the `'default'` shim kept for the old dashboard. The old dashboard's pure view logic (`schema-grid`, `verification-view`, `schema-tab-view`, `extract-view`, `run-progress`, `coverage-view`, `backfill-preview`, `diagnose-run`, …) is ported **verbatim with its tests** under `packages/app/src/lib/site/` — the behaviour is proven; only the screens are redesigned. Screens follow plan 2's grammar (`Page`, the panel/table classes, mutually exclusive loading / empty / error states, `useUnauthorizedRedirect`).

**Tech Stack:** TanStack Start + Router + Query (React 19), Tailwind v4, shadcn/ui (adds `popover`, `textarea`, `checkbox`, `radio-group`, `progress`), tRPC v11 + superjson, Drizzle + Postgres, Hono, Vitest, Playwright, `read-excel-file` (XLSX import, as the old dashboard).

**Spec:** `docs/superpowers/specs/2026-09-21-app-redesign-design.md` — §3 (website tabs; breadcrumb org / project / website; ⌘K websites), §4, §5 website rows, §6 as restated, §7 plan (3), §8. Behaviour of each tab: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §5.5–5.8 and §6 (copy rules); the stepper's strip and step 1: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md` §2 (steps 2 and 3 as designed there are **plan 5**; this plan keeps the grid as the interim step 2, exactly as the redesign spec's §5 row says).

## Global Constraints

- ESM everywhere; `.js` import suffixes in `packages/api` and `packages/api-server`; none in the app.
- One package's tests at a time: `pnpm --filter <pkg> exec vitest run --maxWorkers=1 <name>`; never `pnpm -r test` from a task.
- Commit with explicit paths only (`git add <paths>` then `git commit -m "…" -- <paths>`).
- **The dev database is the customer's only data.** No ad-hoc sign-ins, deletes or cleanup against it from an implementer; tests create their own rows under a throwaway identity or the session-less caller and delete only those; org `default`, org `mar`, the user `markodjordjievski@gmail.com` and the projects Acne / Scratch / Competitor prices are never touched. Browser checks sign in through `/login` only as `<task>-<timestamp>@example.com`, on their own project and website (`https://example.com/…` URLs), and report the address.
- **Nothing an implementer does spends money or runs the engine against a real site.** Verify, Sample, Extract, Re-extract, backfill, "Yes, crawl everything" and "Find pages from a listing" are never clicked in a browser check — not on a throwaway website (the api-server has the Anthropic key), never on Marko's. Those flows are covered by the ported view-logic tests and the existing API tests; the look-only check reads Ikea's stored verification (Task 10) and clicks nothing. A Playwright check may set up pages/URLs (free, no browser on the server) and may *look at* the Verify/Extract buttons' labels, states and tooltips.
- Spec §4 verbatim: dark tokens background `#0a0a0a`, panel `#111111`, raised `#171717`, border `#262626` (hover `#333333`), text `#ededed`, secondary `#a1a1a1`, muted `#666666` (never a text colour); light inverse; pass `#3ddc84` / `#0f7b3d`, fail `#ff5c5c` / `#c62828`, warn `#f5a623` / `#a26000`, link `#52a8ff` / `#0b6bcb`. State colour as a dot, a 2 px rail or a badge, never a background wash — **this rules the grid's cells too**: a verified cell gets a 2 px left rail and its second line in the state colour, not a tinted background. 13 px body, 12 px secondary, 20 px semibold title. Sentence case, no uppercase. 6 px radius, 1 px borders, no shadow in dark. Motion: the `.rise` stagger, 150 ms hover, the running dot, and — new here — one `progress` bar for a verification or run in flight; all off under `prefers-reduced-motion`. Tailwind spacing is 0.8125× nominal; spec pixels are literals.
- Copy (spec 2026-09-08 §6): "project", "website", "field", "page", "product", "extraction" (a run in a sentence; the tab is "Runs"); never "source", "dataset", "input set", "binding", "schema definition". Every button says what happens ("Verify", "Sample 3 products", "Extract"); every disabled control has a visible reason within one line; empty states are one sentence and an action.
- Spec §6 (restated 2026-09-21): a procedure a rebuilt screen calls resolves its org with `resolveOrg(ctx, orgSlug ?? 'default')` — the session wins; the `'default'` fallback exists only for the old dashboard and carries the `TODO(cut-over, spec 2026-09-21 §2)` comment; a website or run outside the resolved org is `NOT_FOUND`. The old dashboard on `:3456` keeps working: nothing in `@robot/dashboard` changes, and `pnpm test:ui` (its Playwright smoke) must pass after Task 1.
- Polling has a stop condition: verification status polls at 3 s only while `verificationState === 'active'`; the sample polls `runs.listBySource` at 2 s only while the latest probe run has no `completedAt`; a run's `crawl.status` polls at 2 s only while `isRunActive`. Never an unconditional interval.
- The frontend-design rules apply: intentional, restrained, industrial-minimal; tables are the object; the grid is the page on the Schema tab.

---

## File map

| File | Responsibility |
|---|---|
| `packages/api/src/auth/scope.ts` (new) | `sourceInOrg(ctx, sourceId)`, `runInOrg(ctx, runId)` — the org guards |
| `packages/api/src/routers/sources.ts` | `get` (the website loader); guards on `rename update delete setListingPages setProductUrls inputRows updateBinding verifyEstimate verify verificationStatus confirm` |
| `packages/api/src/routers/runs.ts`, `crawl.ts` | guards on `getWithDetails listBySource` and `plan probeAndSample items status cancel execute coverage misses backfillPreview backfill` |
| `packages/app/src/routes/_app/projects/$project/sites/$site.tsx` | the website layout: header (name, rename, hostname), tabs, `useSite()` |
| `…/sites/$site/{index,extract,runs,settings}.tsx`, `…/sites/$site/runs/$run.tsx` | Schema, Extract, Runs, Settings, run page |
| `packages/app/src/lib/site-nav-view.ts` (+test) | tabs, crumbs with the website, `siteHref` |
| `packages/app/src/lib/site/*.ts` (+tests) | the ported view logic (see Task 3, 5, 7) |
| `packages/app/src/components/site/*.tsx` | tabs, header, inline rename |
| `packages/app/src/components/schema/*.tsx` | status strip, grid, page header cell + popover, import, stepper strip |
| `packages/app/src/components/extract/*.tsx` | pages, sample, run |
| `packages/app/src/components/runs/*.tsx` | runs table, run header, controls, results table, work list, misses, coverage bar, backfill panel, probe gate, diagnosis |
| `packages/app/src/components/settings/*.tsx` | rows, delete dialog |
| `packages/app/src/components/ui/{popover,textarea,checkbox,radio-group,progress}.tsx` | shadcn additions |
| `packages/app/src/components/{project/websites-table,shell/project-section,shell/command-menu}.tsx`, `routes/_app.tsx` | links and the website crumb |
| `packages/app/src/routes-smoke.test.ts`, `docs/testing/ui-check-app-site.mts` | smoke and look-only check |
| `docs/handoff.md`, `docs/testing/screens/README.md`, `CLAUDE.md` | the record |

---

### Task 1: `sources.get` and the org guards on every website and run procedure

**Files:**
- Create: `packages/api/src/auth/scope.ts`, `packages/api/src/auth/scope.test.ts`
- Modify: `packages/api/src/routers/sources.ts` (add `get`; guard eleven procedures), `packages/api/src/routers/runs.ts` (two), `packages/api/src/routers/crawl.ts` (ten)
- Test: `packages/api/src/routers/site-scope.test.ts` (new)

**Interfaces:**
- Consumes: `resolveOrg(ctx, orgSlug?)`; `findProjectInOrg` (file-local in `projects.ts` — duplicate the two-line lookup in `sources.ts` rather than exporting it).
- Produces:
  ```ts
  // auth/scope.ts
  export async function sourceInOrg(ctx: Context, sourceId: string): Promise<{ id: string; datasetId: string | null; projectId: string; orgId: string }>;  // NOT_FOUND when missing or outside resolveOrg(ctx, 'default')
  export async function runInOrg(ctx: Context, runId: string): Promise<{ id: string; sourceId: string | null }>;  // NOT_FOUND likewise (through the run's source)
  // sources.get
  input:  { projectSlug: string; sourceSlug: string; orgSlug?: string }
  output: { id, slug, name, url: string | null /* urlTemplate */, hostname: string, datasetId, listingMode: 'listing_to_detail' | 'detail' | null,
            confirmedAt: Date | null, isActive: boolean, budget: { max_items: number | 'all'; max_pages: number | 'all'; mode?: 'all' | 'first_n' } | null,
            parameters: Record<string, unknown>, schemaDefinition: unknown, verificationSet: unknown, driftedFields: string[] | null,
            project: { id: string; name: string; slug: string }, fields: ContractField[], createdAt: Date }
  ```
  A run with `sourceId === null` (legacy) is NOT_FOUND for a session caller and passes for the session-less shim only when it is in org `default` — simplest honest rule: `runInOrg` requires a source.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/auth/scope.test.ts` — pure-ish: with a throwaway signed-in identity `a` (the `signIn`/`dropIdentity` helpers exactly as `packages/api/src/routers/projects-get.test.ts` defines them) create a project + website via `a.caller`, insert one `runs` row for it; assert `sourceInOrg(ctxA, sourceId)` resolves, `sourceInOrg(ctxB, sourceId)` rejects `NOT_FOUND` for a second identity `b`, same for `runInOrg`; a random UUID rejects `NOT_FOUND`; clean up with `dropIdentity`.

`packages/api/src/routers/site-scope.test.ts` — one table-driven test: identity `a` creates a project, two fields, a website (`https://a.example.com/`), sets listing pages, inserts a completed run; identity `b` calls each of these with `a`'s ids and every one must reject `NOT_FOUND`:

```ts
const calls: Array<[string, () => Promise<unknown>]> = [
  ['sources.get', () => b.caller.sources.get({ projectSlug: p.slug, sourceSlug: w.sourceSlug })],
  ['sources.rename', () => b.caller.sources.rename({ sourceId, name: 'X' })],
  ['sources.update', () => b.caller.sources.update({ id: sourceId, isActive: false })],
  ['sources.setListingPages', () => b.caller.sources.setListingPages({ sourceId, urls: ['https://a.example.com/l'] })],
  ['sources.setProductUrls', () => b.caller.sources.setProductUrls({ sourceId, urls: ['https://a.example.com/p'] })],
  ['sources.inputRows', () => b.caller.sources.inputRows({ sourceId })],
  ['sources.verifyEstimate', () => b.caller.sources.verifyEstimate({ sourceId })],
  ['sources.verificationStatus', () => b.caller.sources.verificationStatus({ sourceId })],
  ['sources.verify', () => b.caller.sources.verify({ sourceId })],
  ['sources.confirm', () => b.caller.sources.confirm({ sourceId })],
  ['sources.delete', () => b.caller.sources.delete({ sourceId })],
  ['runs.getWithDetails', () => b.caller.runs.getWithDetails({ id: runId })],
  ['runs.listBySource', () => b.caller.runs.listBySource({ sourceId })],
  ['crawl.plan', () => b.caller.crawl.plan({ sourceId, probe: true })],
  ['crawl.probeAndSample', () => b.caller.crawl.probeAndSample({ sourceId })],
  ['crawl.items', () => b.caller.crawl.items({ runId })],
  ['crawl.status', () => b.caller.crawl.status({ runId })],
  ['crawl.cancel', () => b.caller.crawl.cancel({ runId })],
  ['crawl.execute', () => b.caller.crawl.execute({ runId, dryRun: true })],
  ['crawl.coverage', () => b.caller.crawl.coverage({ runId })],
  ['crawl.misses', () => b.caller.crawl.misses({ runId })],
  ['crawl.backfillPreview', () => b.caller.crawl.backfillPreview({ runId })],
  ['crawl.backfill', () => b.caller.crawl.backfill({ runId })],
];
for (const [name, call] of calls) await expect(call(), name).rejects.toMatchObject({ code: 'NOT_FOUND' });
```

`updateBinding` is included too, with a minimal valid binding input (copy one from `sources-binding.test.ts`). Then the positive side: `a.caller.sources.get(...)` returns `hostname === 'a.example.com'`, `fields.length === 2`, `project.slug === p.slug`; and the session-less shim: the bare caller's `sources.get({ projectSlug, sourceSlug, orgSlug: 'default' })` on a project created under `default` works, and `sources.rename({ sourceId })` on it works (falls to `default`).

- [ ] **Step 2: Run them to verify they fail** — `pnpm --filter @robot/api exec vitest run --maxWorkers=1 scope site-scope` → FAIL (module missing; `b` succeeds where it must not).

- [ ] **Step 3: Implement**

`packages/api/src/auth/scope.ts`:

```ts
// The org guards for per-website and per-run procedures (spec 2026-09-21 §6 as
// restated): a source or run outside the resolved org is NOT_FOUND — the same
// word as for one that does not exist, so a guessed id learns nothing.
// TODO(cut-over, spec 2026-09-21 §2): the `'default'` fallback exists only for the
// old dashboard, which calls these with no session; drop it when it is retired.
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { sources, datasets, projects, runs } from '@robot/db';
import type { Context } from '../trpc';
import { resolveOrg } from './session.js';

const notFound = (what: string, id: string) => new TRPCError({ code: 'NOT_FOUND', message: `${what} ${id} not found` });

export async function sourceInOrg(ctx: Context, sourceId: string) {
  const org = await resolveOrg(ctx, 'default');
  const row = await ctx.db
    .select({ id: sources.id, datasetId: sources.datasetId, projectId: projects.id, orgId: projects.orgId })
    .from(sources)
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(sources.id, sourceId))
    .limit(1);
  const s = row[0];
  if (!s || s.orgId !== org.id) throw notFound('Website', sourceId);
  return s;
}

export async function runInOrg(ctx: Context, runId: string) {
  const run = await ctx.db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { id: true, sourceId: true } });
  if (!run || !run.sourceId) throw notFound('Run', runId);
  await sourceInOrg(ctx, run.sourceId);
  return run;
}
```

In each guarded procedure, the first line of the handler becomes `await sourceInOrg(ctx, input.sourceId);` (or `input.id` for `sources.update`, `runInOrg(ctx, input.runId)` / `input.id` for runs) — before any read or write. Put one `TODO(cut-over…)` comment on the guard helper, not on every call site.

`sources.get` in `sources.ts`:

```ts
  /** The website loader for its page (spec 2026-09-21 §5): the row, its project and the contract, in one round trip. */
  get: publicProcedure
    .input(z.object({ projectSlug: z.string().min(1), sourceSlug: z.string().min(1), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, input.orgSlug ?? 'default');
      const project = await ctx.db.query.projects.findFirst({ where: and(eq(projects.orgId, org.id), eq(projects.slug, input.projectSlug)), columns: { id: true, name: true, slug: true } });
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });
      const row = await ctx.db
        .select({ source: sources, datasetSchema: datasets.schema })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .where(and(eq(datasets.projectId, project.id), eq(sources.slug, input.sourceSlug)))
        .limit(1);
      const hit = row[0];
      if (!hit) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceSlug} not found` });
      const s = hit.source;
      let hostname = '';
      try { hostname = s.urlTemplate ? new URL(s.urlTemplate).hostname : ''; } catch { hostname = ''; }
      return {
        id: s.id, slug: s.slug, name: s.name, url: s.urlTemplate, hostname, datasetId: s.datasetId,
        listingMode: s.listingMode as 'listing_to_detail' | 'detail' | null, confirmedAt: s.confirmedAt, isActive: s.isActive,
        budget: (s.budget ?? null) as { max_items: number | 'all'; max_pages: number | 'all'; mode?: 'all' | 'first_n' } | null,
        parameters: (s.parameters ?? {}) as Record<string, unknown>,
        schemaDefinition: s.schemaDefinition, verificationSet: s.verificationSet, driftedFields: s.driftedFields as string[] | null,
        project, fields: contractFields(hit.datasetSchema), createdAt: s.createdAt,
      };
    }),
```

- [ ] **Step 4: Run the tests** — the two new files, then `pnpm --filter @robot/api exec vitest run --maxWorkers=1 sources runs crawl` (every existing sources/runs/crawl test still passes session-less through the shim), `pnpm --filter @robot/api typecheck`, `pnpm --filter @robot/dashboard typecheck`, and — with `pnpm dev:all` up — `pnpm test:ui` (the old dashboard's smoke; it exercises `createInProject`, the Schema tab and Extract tab against these procedures).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/scope.ts packages/api/src/auth/scope.test.ts packages/api/src/routers/sources.ts packages/api/src/routers/runs.ts packages/api/src/routers/crawl.ts packages/api/src/routers/site-scope.test.ts
git commit -m "feat(api): sources.get, and every website and run procedure takes the org from the session" -- packages/api/src/auth/scope.ts packages/api/src/auth/scope.test.ts packages/api/src/routers/sources.ts packages/api/src/routers/runs.ts packages/api/src/routers/crawl.ts packages/api/src/routers/site-scope.test.ts
```

---

### Task 2: The website routes, layout, tabs, links and crumb

**Files:**
- Create: `packages/app/src/routes/_app/projects/$project/sites/$site.tsx` (layout), `…/sites/$site/index.tsx`, `…/sites/$site/extract.tsx`, `…/sites/$site/runs.tsx`, `…/sites/$site/runs/$run.tsx`, `…/sites/$site/settings.tsx` (placeholders via `ComingLater` for the five), `packages/app/src/components/site/site-tabs.tsx`, `packages/app/src/components/site/site-header.tsx`, `packages/app/src/components/site/inline-rename.tsx`, `packages/app/src/lib/site-nav-view.ts` (+ `site-nav-view.test.ts`)
- Modify: `packages/app/src/components/project/websites-table.tsx` (name cell links), `packages/app/src/components/shell/project-section.tsx` (website lines link, active state), `packages/app/src/components/shell/command-menu.tsx` (websites group, from `projects.get` of the current project when inside one, else none), `packages/app/src/routes/_app.tsx` (third crumb), `packages/app/src/lib/project-nav-view.ts` (`crumbs` gains the website)

**Interfaces:**
- Consumes: `trpc.sources.get({ projectSlug, sourceSlug })` (Task 1); `useProject()`; `useProjectSlug()`.
- Produces:
  ```ts
  // lib/site-nav-view.ts
  export const SITE_TABS: ReadonlyArray<{ to: '/projects/$project/sites/$site' | '/projects/$project/sites/$site/extract' | '/projects/$project/sites/$site/runs' | '/projects/$project/sites/$site/settings'; label: 'Schema' | 'Extract' | 'Runs' | 'Settings'; exact: boolean }>;  // Schema exact; Runs matches runs/:run too
  export function activeTab(pathname: string, base: string): (typeof SITE_TABS)[number]['label'];   // base = `/projects/p/sites/s`
  // lib/project-nav-view.ts
  export function crumbs(org: string, project: { name: string; slug: string } | null, site?: { name: string; slug: string } | null): Crumb[];  // third crumb links to the website's Schema tab
  // routes/…/sites/$site.tsx
  export function useSite(): UseTRPCQueryResult<sources.get output>;   // Route.useParams() of the layout → { project, site }
  export function useSiteSlugs(): { project?: string; site?: string };  // useParams({ strict: false }) for the shell
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SITE_TABS, activeTab } from './site-nav-view';
import { crumbs } from './project-nav-view';

describe('site tabs', () => {
  it('names the four tabs in order, Schema exact', () => {
    expect(SITE_TABS.map((t) => [t.label, t.exact])).toEqual([['Schema', true], ['Extract', false], ['Runs', false], ['Settings', false]]);
  });
  it('resolves the active tab from the path, a run page under Runs', () => {
    const base = '/projects/acne/sites/ikea';
    expect(activeTab(base, base)).toBe('Schema');
    expect(activeTab(`${base}/extract`, base)).toBe('Extract');
    expect(activeTab(`${base}/runs`, base)).toBe('Runs');
    expect(activeTab(`${base}/runs/abc`, base)).toBe('Runs');
    expect(activeTab(`${base}/settings`, base)).toBe('Settings');
  });
});

describe('crumbs with a website', () => {
  it('adds the website after the project', () => {
    expect(crumbs('Acme', { name: 'Prices', slug: 'prices' }, { name: 'Ikea', slug: 'ikea' })).toEqual([
      { label: 'Acme' },
      { label: 'Prices', to: '/projects/$project', params: { project: 'prices' } },
      { label: 'Ikea', to: '/projects/$project/sites/$site', params: { project: 'prices', site: 'ikea' } },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @robot/app exec vitest run site-nav-view` → FAIL.

- [ ] **Step 3: Implement**

`lib/site-nav-view.ts`:

```ts
/** The website's top tabs (spec 2026-09-21 §3) and the tab the path is on. Pure. */
export type SiteTabLabel = 'Schema' | 'Extract' | 'Runs' | 'Settings';
export const SITE_TABS = [
  { to: '/projects/$project/sites/$site', label: 'Schema', exact: true },
  { to: '/projects/$project/sites/$site/extract', label: 'Extract', exact: false },
  { to: '/projects/$project/sites/$site/runs', label: 'Runs', exact: false },
  { to: '/projects/$project/sites/$site/settings', label: 'Settings', exact: false },
] as const;

export function activeTab(pathname: string, base: string): SiteTabLabel {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  if (rest.startsWith('/extract')) return 'Extract';
  if (rest.startsWith('/runs')) return 'Runs';
  if (rest.startsWith('/settings')) return 'Settings';
  return 'Schema';
}
```

`crumbs` in `project-nav-view.ts` gains the optional third argument; `Crumb.to` widens to the union of the two route literals and `params` to `{ project: string; site?: string }` (keep the union-per-`to` shape Task 4 of plan 2 settled on).

The layout `sites/$site.tsx`: `createFileRoute('/_app/projects/$project/sites/$site')` renders `<SiteHeader />` then `<Outlet />`; exports `useSite()` (`Route.useParams()` → `trpc.sources.get.useQuery({ projectSlug: project, sourceSlug: site })`) and `useSiteSlugs()`. The header (`components/site/site-header.tsx`) is the spec 2026-09-08 §5.5 row restyled: on the left the website name as an `InlineRename` (a text that becomes an input on click/Enter, commits on blur/Enter via `trpc.sources.rename`, Escape restores — same rules as the Fields table's name input, 16 px on phones), on the right the hostname in mono `text-sm text-muted-foreground`; under it the tabs (`components/site/site-tabs.tsx`): four `Link`s styled as a line-tab strip (`border-b border-line`, the active one `border-b-2 border-text text-text -mb-px`, the others `text-muted-foreground hover:text-text`), `activeOptions={{ exact }}` per `SITE_TABS`, `aria-current="page"` on the active one. The tabs sit inside the `Page`'s title row area: the layout renders `<Page title={<InlineRename…/>} actions={<span className="font-mono …">{hostname}</span>}>` with the tab strip as the first child and the tab's own content after it — so each tab route renders its panels only, not its own `Page`. While `sources.get` is pending the title is a `Skeleton as="span"`; NOT_FOUND → "This website does not exist in <project>." with a link to the project (the plan-2 pattern); `useUnauthorizedRedirect(site)`.

Links: `websites-table.tsx`'s name cell → `<Link to="/projects/$project/sites/$site" params={{ project, site: w.slug }}>` (the table gets `projectSlug` as a prop); `project-section.tsx`'s website `<li>` → a `Link` with the same `activeProps` as the section's nav items (active on the website's subtree — `activeOptions={{ exact: false }}`); `_app.tsx`'s breadcrumb reads `useSiteSlugs()` and, when `site` is set, `trpc.sources.get.useQuery(…, { enabled })` for the name (same key as `useSite`); `command-menu.tsx` adds a "Websites" group when `useProjectSlug()` is set, from `projects.get`'s `websites`, each going to the website's Schema tab. Remove the "plain rows until plan 3" comments.

Regenerate `routeTree.gen.ts`; commit it.

- [ ] **Step 4: Verify** — unit tests + typecheck; in the browser as `site-<ts>@example.com`: create a project, add a website (`https://www.example.com/`), click its name → `/projects/<p>/sites/<s>`; the header shows the name and `www.example.com`; rename inline; the four tabs navigate and light correctly (a run URL keeps Runs lit); breadcrumb `org / project / website`; the sidebar line is lit; ⌘K lists the website. Console clean. Report the address.

- [ ] **Step 5: Commit** (explicit paths: the routes dir, `routeTree.gen.ts`, `components/site`, the three shell/project files, the two lib files and test).

---

### Task 3: Port the Schema tab's view logic

**Files:**
- Create under `packages/app/src/lib/site/`: `schema-grid.ts`, `verification-view.ts`, `schema-tab-view.ts`, `schema-stepper-view.ts`, `csv.ts`, `parse-url-lines.ts` — each **copied verbatim** from `packages/dashboard/src/lib/<same name>.ts` together with its `.test.ts` (every one of these has a test file next to it; copy them all). Only import paths change (`./extract-view` → the local copy: `StepState` is needed by `schema-stepper-view`, so copy `extract-view.ts` + test now too, even though Task 5 owns the Extract screen).

**Interfaces:** the exported signatures are exactly the old files' (the dossier lists them; `schema-grid.ts`: `FIELD_TYPES, GridRow, GridState, URL_MIN, URL_MAX, emptyState, validateExpectedClient, parseBlock, applyPaste, applyPasteByName, rowsFromTable, canAddPage, addPage, removePage, ArrivalPlan, planArrival, reconcileRows, toBindingInput, bindingProblems, isComplete, applyImportToRows, shortUrl, fromSource, importProblems`; `verification-view.ts`: `FailReason, CellResult, FieldVerification, VerificationResults, hintFor, cellStatusFor, VerificationState, verificationState, isRowStale, reverifyKeys`; `schema-tab-view.ts`: `StripState, ColumnState, CellLine, stripState, columnStates, TimeEstimate, roughTime, stripSummary, cellLine, verifyButton, thinEvidenceNote, typeFixSuggestion`; `schema-stepper-view.ts`: `SchemaStep, stepOf, stepStates`; `extract-view.ts`: `StepState, ExtractMode, SampleRun, sampleFinished, stepStates, listingCheckLabel, productUrlCounts, runSentence, budgetFromForm, budgetNeedsSave, budgetToForm, lockedStripText, sampleFacts, emptyCellNote`).

- [ ] **Step 1: Copy** the seven modules and their tests with `cp` (Git Bash) into `packages/app/src/lib/site/`; fix imports; `FIELD_TYPES` in `schema-grid.ts` duplicates `lib/fields-view.ts`'s — replace the local declaration with `import { FIELD_TYPES, type FieldType as GridFieldType } from '../fields-view'` and keep the re-export so the copied tests compile.
- [ ] **Step 2: Run** `pnpm --filter @robot/app exec vitest run lib/site` → all copied tests pass unchanged (a copied test that fails is a porting error, not a test to edit). Typecheck.
- [ ] **Step 3: Commit** `packages/app/src/lib/site` with `feat(app): the Schema and Extract view logic, ported with its tests`.

---

### Task 4: The Schema tab — stepper strip and the grid, restyled

**Files:**
- Create: `packages/app/src/components/schema/stepper-strip.tsx`, `status-strip.tsx`, `schema-grid.tsx`, `page-header-cell.tsx`, `schema-import.tsx`; `packages/app/src/components/ui/popover.tsx`, `progress.tsx` (shadcn, relative imports)
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`, `packages/app/package.json` (+ `read-excel-file`, as the old dashboard)

**Behaviour reference:** `packages/dashboard/src/routes/source-schema.tsx` and the components it renders (`stepper.tsx`, `status-strip.tsx`, `schema-grid.tsx`, `page-header-cell.tsx`, `schema-import.tsx`) — read them for every rule; the copy below is the spec's. This task rebuilds them in the new register; it does not copy their JSX.

**Interfaces:**
- Consumes: `useSite()`; `useProject()` (field count, website count); `lib/site/*` (Task 3); `trpc.sources.{verifyEstimate,verificationStatus,updateBinding,verify,findProductPages}`; `trpc.datasets.retypeField`.

- [ ] **Step 1: The screen.** Search param `?step=fields|pages` (`validateSearch` on the route; `stepOf(search, fields.length)`); arrival `?addPage=<url>&field=<key>` handled with `planArrival` exactly as the old screen (seeded state, locked while verifying).

  **Stepper strip** (`stepper-strip.tsx`): two cells — "1 · Fields" and "2 · Pages and values" — with `stepStates`; a cell is a `Link`-like button; the current one is outlined (`border-text`), `done` shows a check, `locked` is `text-muted-foreground` with the reason as its second line ("Add a field first"). Below the strip, step 1 renders a panel: the project's fields as a compact read-only list (name · type) with "Edit fields" → `/projects/$project/fields` and the note `sharedNote` when > 1 websites — fields are edited on the project, not here (spec 2026-09-18 §2.1: step 1 is a second surface on the same mutations; in this app the project's Fields page *is* that surface). Step 2 renders the status strip, the grid, and the import row.

  **Status strip** (`status-strip.tsx`): fixed-height panel; left `stripSummary`, then the stage text and, while `active`, a `Progress` bar (the `capturing n/m` parse from the old screen) and `roughTime`; right: **Verify / Re-verify** (`verifyButton` → label, disabled, reason as a tooltip and as the visible line under the button) and **Extract** (a `Link` to the Extract tab, disabled with "Unlocks when every cell is green" until `allPassed && current`). `stripState` drives it; `stalled` shows the amber note and "Run it again"; `failed` shows `errorMessage` in `text-fail`.

  **Grid** (`schema-grid.tsx`, `page-header-cell.tsx`): the table is the page. Columns: Field (name, read-only, `text-text`), Type (label, read-only), "Where it is on this website" (an input, the description), then one column per proof page. Field and Type cells carry one shared note above the table: "Field names and types come from the project." linking to Fields. Page header cell: page number, `shortUrl`, the `ColumnState` (captured / capturing / queued / not captured with reason) as a 2 px top rail + 12 px word, and a pencil that opens a `Popover` with the full URL input and "Don't have product pages yet? Find some from a listing page" → listing URL input → `findProductPages` → up to ten candidates with "Use as page n" (this one *is* allowed in the browser check only against `https://example.com` — it is a single free capture; still, the check may skip it). "Add page" up to `URL_MAX`; remove on pages beyond `URL_MIN`. Expected cells: an input; second line always reserved (`cellLine` → tone/text); a verified cell has a 2 px left rail in `pass`/`fail`/`warn` (stale) and the second line in the same tone — **no tinted background** (spec §4 beats the old tint). The type-fix chip (`typeFixSuggestion` → "Set type to link" → `datasets.retypeField`, refused message shown when the API refuses). Inputs are read-only while `active` (values legible, `aria-readonly`), and paste blocks (`applyPasteByName`) work on any expected cell.

  **Import** (`schema-import.tsx`): "Import CSV or XLSX" file input (`parseCsv` / `read-excel-file`) → `rowsFromTable` → `applyImportToRows`; `importProblems` shown as a `role="alert"` list.

  **Verify**: `handleVerify` as the old screen — freeze the estimate, save the binding if dirty (`toBindingInput`), then `verify({ onlyKeys: reverifyKeys(...) })`; poll `verificationStatus` at 3 s only while `verificationState === 'active'` (`stallMs` from the estimate). After completion invalidate `sources.get`, `projects.get`, `sources.verifyEstimate`, `sources.verificationStatus`.

  **Save**: "Save" is implicit — the binding is saved on Verify and on blur of the description/URL inputs? No: the old screen saves only on Verify. Keep that, and add one explicit outline **Save pages and values** button beside Verify that is enabled when `dirty && bindingProblems.length === 0` (the customer can save without paying); `bindingProblems` as the visible reason when disabled.

- [ ] **Step 2: Verify** — unit tests (`lib/site`) + typecheck; browser as `schema-<ts>@example.com`: a project with two catalogue fields, a website `https://www.example.com/`, open the Schema tab: step 1 lists the two fields with "Edit fields"; step 2: type three page URLs (`https://www.example.com/a|b|c`) and values into the grid, Save pages and values → reload → values persist (`sources.get`'s `verificationSet`); the Verify button reads "Verify · up to $0.10" (or "free" if the api-server has no key) — **do not click it**; the Extract link is disabled with its reason; import a two-line CSV and see the rows fill. Both themes; screenshots looked at and fixed (the cell rails, the header's rail, the popover, the strip's rhythm). Console clean. Report the address.

- [ ] **Step 3: Commit** (explicit paths: `components/schema`, `components/ui/{popover,progress}.tsx`, the route file, `package.json`, `pnpm-lock.yaml`).

---

### Task 5: The Extract tab

**Files:**
- Create: `packages/app/src/lib/site/run-progress.ts` (+test, copied verbatim from the dashboard), `packages/app/src/components/extract/extract-pages.tsx`, `extract-sample.tsx`, `extract-run.tsx`, `packages/app/src/components/ui/textarea.tsx` (shadcn)
- Modify: `…/sites/$site/extract.tsx`

**Behaviour reference:** `packages/dashboard/src/routes/source-extract.tsx` + `extract-pages.tsx`, `extract-sample.tsx`, `extract-run.tsx`; spec 2026-09-08 §5.7 is the authority for every sentence.

**Interfaces:**
- Consumes: `useSite()`; `lib/site/{extract-view,run-progress,parse-url-lines,csv}`; `trpc.sources.{inputRows,verificationStatus,checkListingPage,setListingPages,setProductUrls,update,confirm}`, `trpc.runs.listBySource`, `trpc.crawl.{status,probeAndSample,plan,execute}`, `trpc.datasets.getContract`.

- [ ] **Step 1: The screen.** The three-cell stepper strip (reuse Task 4's `StepperStrip` with three cells: Pages, Sample, Run; `stepStates` from `extract-view`). **Locked tab** when the schema is not fully green: every section dimmed (`opacity-60 pointer-events-none` on the sections, not the strip) and the strip reads `lockedStripText` with the link to the Schema tab.
  **Pages**: a segmented control (two `Button variant="outline"` in a group, the active one `bg-raised`): Listing pages / Product URLs. Listing: a small table (URL, Check result via `listingCheckLabel` as a `pass`/`warn`/`fail` dot + words, remove), an input to add (checked on add via `checkListingPage` — free, one capture; in the browser check use `https://example.com/` which reports "0 product links · no pager seen"), **Save pages** → `setListingPages`. Product URLs: a `Textarea` + "Import CSV" (`url` column) + the inline `productUrlCounts` line; **Save URLs** → `setProductUrls` (shows `skipped`). Saved pages come from `inputRows`; "Edit pages" unlocks the section once a sample exists (`editing` state), and editing marks the sample stale in place.
  **Sample** (listing mode only): "Sample 3 products" with the sentence; after it runs, `sampleFacts` as four facts in a row (mono numbers) and the sample rows in the contract's columns with `emptyCellNote` under empty cells; product-URL mode shows "No sample needed, the pages are known." Polls `runs.listBySource` at 2 s only while the latest probe run has no `completedAt`.
  **Run**: "Run [all ▾] products across [all ▾] pages" with two `Select`s (all / custom → a number box), `runSentence` under it, the safety-stop line, **Extract** (`extractButtonLabel`, `extractButtonTitle`); `handleExtract` exactly as the old screen (save budget if `budgetNeedsSave`; unconfirmed listing → `sources.confirm`, else `crawl.plan`; then `crawl.execute`). After start: `progressLabel` line with the `RunDot` and a link to the run page, polling `crawl.status` at 2 s only while `isRunActive`.

- [ ] **Step 2: Verify** — `lib/site` tests + typecheck; browser as `extract-<ts>@example.com`: the tab is locked on an unverified website with the right sentence and link; on the throwaway, switch to Product URLs on Settings is plan-later — instead assert the Pages section's controls render, paste two URLs, Save URLs, reload → they persist via `inputRows`. **Do not click Sample, Extract or Check on a real listing.** Both themes; screenshots looked at. Report the address.

- [ ] **Step 3: Commit** (explicit paths).

---

### Task 6: The Runs tab

**Files:**
- Create: `packages/app/src/lib/runs-view.ts` (+test), `packages/app/src/components/runs/runs-table.tsx`
- Modify: `…/sites/$site/runs.tsx`

**Interfaces:**
```ts
// lib/runs-view.ts
export type RunRow = { id: string; status: string; inputLabel: string | null; startedAt: Date | null; completedAt: Date | null; resultCount: number | null; errorMessage: string | null; createdAt: Date };
export type RunView = { id: string; state: RunDotStatus; statusLabel: string /* runDotLabel + " · backfill" | " · sample" when inputLabel is backfill|probe */; startedLabel: string /* relativeTime(startedAt ?? createdAt) */; durationLabel: string | null /* "12 s", "3 min", "1 h 04 min" from startedAt→completedAt */; rowsLabel: string | null; error: string | null };
export function durationLabel(start: Date | null, end: Date | null): string | null;
export function runsView(rows: readonly RunRow[], now?: Date): RunView[];   // newest first
```

- [ ] **Step 1: Test** — `durationLabel` cases (`null` when either is null; 12 s; 3 min; 1 h 04 min); `runsView` orders newest first, labels a `probe` run "Done · sample", a `backfill` run "Done · backfill", and an `extracting` run with no `completedAt` as `running`.
- [ ] **Step 2: Implement** the view; the table: Started (relative, mono), Status (`RunDot` + label), Rows (mono right), Duration (mono right), the row's name cell a `Link` to `…/runs/$run`; empty state "No extractions yet. Set up pages on the Extract tab." with the link; error rows show `error` as the second line in `text-fail`. The list does not poll (the run page does).
- [ ] **Step 3: Verify** (unit + typecheck; browser: the empty state on the throwaway; the table is proven by Task 10 on Acne — read-only) and **commit**.

---

### Task 7: The run page, part A — header, facts, controls, results, work list

**Files:**
- Create under `packages/app/src/lib/site/`: `work-list.ts`, `probe-evidence.ts`, `parse-run-log.ts`, `diagnose-run.ts`, `coverage-view.ts`, `backfill-preview.ts`, `run-misses-view.ts` (+ tests, copied verbatim from the dashboard); `packages/app/src/components/runs/run-header.tsx`, `run-facts.tsx`, `execute-controls.tsx`, `results-table.tsx`, `work-list.tsx`
- Modify: `…/sites/$site/runs/$run.tsx`

**Behaviour reference:** `packages/dashboard/src/routes/source-run-detail.tsx` (top half: header, export links, backfill breadcrumbs, facts, error banner, capture link, `ExecuteControls`, `WorkList`, `ResultsTable`).

- [ ] **Step 1: Port** the seven modules + tests (as Task 3); run `lib/site` tests.
- [ ] **Step 2: The page** — `trpc.runs.getWithDetails({ id })`; `Page` title "Extraction" with the `RunDot` + status word and, as actions, **Download CSV / JSON** (`exportUrl('runs', id, …)` from `lib/trpc.ts`, real anchors, disabled buttons when `extraction === null`); a "Part of <run>" / "Re-extracted in <n> runs" line for `parentRunId`/`backfillRuns`; facts row (Started, Completed, Duration, Rows — mono, from `runs-view`'s helpers); the error banner (`role="alert"`, `text-fail`, no wash); `ExecuteControls` (`runControls` → Extract / Retry failed / Stop via `crawl.execute` / `crawl.cancel`, polling `crawl.status` at 3 s while active, `requeueNotice`); the work list (`summariseWorkList`, table capped at 200, `listingValuesLabel`); the results table (the Output table's grammar: sticky head, `min-w-max`, truncation on an inner div, `cellText`; columns are the contract's names; "not on page" cells from `absentFields` as `text-muted-foreground` italics — no wash). The probe gate, misses, coverage bar and backfill panel are Task 8: leave clearly named mount points (`{/* Task 8: RunMisses */}`) — the page must render without them.
- [ ] **Step 3: Verify** (unit + typecheck; browser: a run page cannot be reached on a throwaway without running the engine — assert the NOT_FOUND branch on a random UUID reads "This extraction does not exist." with a link to Runs; Task 10 proves the populated page on Acne read-only if Acne has a run, else the empty branches) and **commit**.

---

### Task 8: The run page, part B — misses, coverage, backfill, probe gate, diagnosis

**Files:**
- Create: `packages/app/src/components/runs/run-misses.tsx`, `coverage-bar.tsx`, `backfill-panel.tsx`, `probe-gate.tsx`, `diagnosis-panel.tsx`; `packages/app/src/components/ui/checkbox.tsx`, `radio-group.tsx` (shadcn)
- Modify: `…/sites/$site/runs/$run.tsx`

**Behaviour reference:** the bottom half of `source-run-detail.tsx` (`RunMisses`, `CoverageActionBar`, `BackfillGapsPanel`, `ProbeConfirmGate`, `DiagnosisPanel`) and the ported `lib/site/{run-misses-view,coverage-view,backfill-preview,probe-evidence,diagnose-run,parse-run-log}`.

- [ ] **Step 1:** `RunMisses` (`crawl.misses`; groups by field then listing via `listingLabel`/`missLine`; each URL row has **Use as proof page** → `Link` to the Schema tab with `?addPage=<url>&field=<key>&step=pages`); `CoverageBar` (`crawl.coverage`, `fillBadge`, the filter select "rows missing <field>", select-all checkbox, **Re-extract n rows** → `crawl.backfill({ itemIds })` with `reExtractLabel`); `BackfillPanel` (`crawl.backfillPreview` twice as the old one, `previewSummary`, the field checkboxes with `FieldClassification`, the dead-field strategy `RadioGroup` with `strategyCopy`, **Run backfill** → `crawl.backfill(backfillMutationInput(...))`); `ProbeGate` (shown when `inputLabel === 'probe' && !confirmedAt`; `probeEvidence` facts, the sample rows, **Yes, crawl everything** → `sources.confirm` → navigate to the new run; **Something's wrong** → `DiagnosisPanel` (`diagnoseRun`; also shown on a failed run; its one action "Go to Settings")). Gate the coverage query as the old page does (`runIsTerminal && !probeGateShowing && !isBackfillRun && rows > 0`).
- [ ] **Step 2: Verify** (unit tests of the ported modules already cover the logic; typecheck; the components are exercised by Task 10 on Acne read-only where the data exists; nothing here is clicked in a browser check — the buttons' labels and disabled reasons are asserted) and **commit**.

---

### Task 9: The Settings tab

**Files:**
- Create: `packages/app/src/lib/site-settings-view.ts` (+test), `packages/app/src/components/settings/settings-rows.tsx`, `delete-website-dialog.tsx`
- Modify: `…/sites/$site/settings.tsx`

**Interfaces:**
```ts
// lib/site-settings-view.ts
export function listingModeLabel(mode: 'listing_to_detail' | 'detail' | null): string;   // "Listing pages" | "Product URLs" | "Not chosen yet"
export function modeLockNote(confirmedAt: Date | null): string | null;                    // "Mode is locked once the website is confirmed." | null
export function budgetSummary(b: { max_items: number | 'all'; max_pages: number | 'all' } | null): string;  // "All products across all pages" | "Up to 500 products across 10 pages"
export function deleteNote(confirmedAt: Date | null, runCount: number): string;           // confirmed → "A confirmed website cannot be deleted from here." ; else "Deletes the website, its pages, values and n extractions."
```

- [ ] **Step 1: Test** the four helpers (each branch).
- [ ] **Step 2: The screen** — a definition-list panel (rows: Name with the same `InlineRename`; Address (mono, the url); Listing mode with a `Select` of the two modes and `modeLockNote` as the visible reason when locked → `sources.update({ id, listingMode })`; Budget: two inputs "products" and "pages" each with an "all" toggle, `budgetSummary` line, **Save budget** → `sources.update({ id, budget })`; Active: a switch-like outline button → `isActive`); the **Danger zone** panel: "Delete website" → `DeleteWebsiteDialog` (title "Delete <name>?", `deleteNote`, destructive confirm) → `sources.delete` → on success invalidate `projects.get`/`projects.list` and navigate to the project; on `PRECONDITION_FAILED` show the API's message verbatim in the dialog (the ruling the old dashboard made; do not pre-empt client-side).
- [ ] **Step 3: Verify** — browser as `settings-<ts>@example.com`: rename, pick "Product URLs", save a budget "50 products across all pages", reload → all persist; delete the website → back on the project home with the row gone. Both themes. **Commit**.

---

### Task 10: Smoke, look-only check on Ikea, screenshots, handoff

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts`, `docs/testing/screens/README.md`, `docs/handoff.md`, `CLAUDE.md` (only if a command changed)
- Create: `docs/testing/ui-check-app-site.mts`

- [ ] **Step 1: Smoke** — on the run's throwaway project + website: Schema (step 1 and step 2 with three typed pages and values saved), Extract (locked strip), Runs (empty), Settings (rename round-trip), each in both themes with screenshots `app-site-{schema,extract,runs,settings}-{dark,light}.png`, console clean; cleanup unchanged (`projects.delete` cascades).
- [ ] **Step 2: Look-only check** — `docs/testing/ui-check-app-site.mts`, modelled on `ui-check-app-project.mts` (sign-in, theme choose/restore in `finally`, `--email/--project/--site`, `EXPECTED`): **read-only on Acne / Ikea** — Schema tab: the strip reads "8 of 8 fields verified …", the eight rows × three page columns are green (rail colour = the resolved `pass` token), the Verify button reads "Re-verify …" and is **not clicked**, the Extract link is enabled; Extract tab: the strip is not locked; Runs: the table or the empty state, branching on `runs.listBySource` (Acne has no run today — say so); Settings: mode/budget rows read what `sources.get` returns. Shell measurements on each. Screenshots `app-site-{schema,extract,runs,settings}-acne-{dark,light}.png`. LOOK at every screenshot and fix what a designer would; re-run.
- [ ] **Step 3: Docs** — README rows; the handoff section "App redesign, plan 3: the website (2026-09-22)" (per-task SHAs; the API changes: `sources.get`, the two guards and the 24 procedures now org-scoped, the remaining shim-only list — `sources.getBySlug/listByDataset/create`, `datasets.listByProject/getBySlug/create/updateSchema`, `domains.*`, `scraper.*`, `crawl.*`'s legacy `plan` for sources without a schema; what the check found and fixed; the screenshot set; open decisions — the grid's rails vs the old tint, the paste/import fast path kept, the Save button added beside Verify; next: plan 4 (org-wide runs, usage, org and account settings) then plan 5 (steps 2–3, the mark screen)); a memory-worthy line: no implementer clicked Verify/Extract on any website.
- [ ] **Step 4: Commit** (explicit paths).

---

## Self-review

- **Spec coverage.** Redesign spec §3 (tabs — Task 2; crumb with website — Task 2; ⌘K websites — Task 2), §5 rows (`/sites/:site` stepper step 1 + grid — Task 4; `…/extract` — Task 5; `…/runs`, `…/runs/:run` — Tasks 6–8 incl. misses and "Use as proof page"; `…/settings` listing mode, budget, delete — Task 9), §6 (the guards — Task 1), §8 (view-logic tests — Tasks 3, 6, 7, 9; smoke + look-only — Task 10). MVP spec §5.5 header (Task 2), §5.6 Schema states and copy (Task 4), §5.7 Extract sentences and locks (Task 5), §5.8 (Tasks 6–9). Stepper spec §2.1's second-website notes (Task 4's step 1 panel); §2.2–2.4 are plan 5 by the redesign spec's own §5 row.
- **Placeholders.** The screens are described by behaviour + the exact old component to read; the copy is quoted from the specs; view logic is ported verbatim (no re-derivation). Task 4's Save-button rule is stated exactly.
- **Type consistency.** `sources.get`'s shape (Task 1) is what `useSite()` (Task 2) returns and Tasks 4/5/9 read (`listingMode`, `confirmedAt`, `budget`, `schemaDefinition`, `verificationSet`, `fields`). `SITE_TABS` route literals match the files Task 2 creates. `runs-view`'s `RunRow` matches `runs.listBySource`'s row. `exportUrl('runs', …)` exists from plan 2.
- **Decisions this plan makes** (the executor's ledger carries them): step 1 on the Schema tab is a read-only list + "Edit fields" (the project's Fields page is the surface); the grid loses its tinted cells for 2 px rails (spec §4); a "Save pages and values" button exists beside Verify; every per-website/per-run procedure the tabs call is guarded now (24 procedures) rather than screen by screen; the mark screen stays plan 5; implementers never trigger Verify/Sample/Extract.
