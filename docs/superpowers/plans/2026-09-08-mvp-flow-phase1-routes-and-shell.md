# MVP Flow Phase 1: Routes and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every customer screen under `/projects/…` with redirects from the old paths, make the projects list the home page, let the customer name projects and websites, and add the New project and Add website dialogs, so the shell is in its final shape before the field model and workspace tabs change in later phases.

**Architecture:** The dashboard is a Vite + TanStack Router SPA talking to a Hono-hosted tRPC v11 API. Routes are declared in code in `packages/dashboard/src/router.tsx`. This phase renames route paths, adds redirect routes for the legacy paths, adds four API procedures (project create with dataset, project rename, source create-in-project, source rename), extends the projects list query with per-project stats, and replaces the wizard landing page with the projects list. The schema grid, verifier, and crawl are untouched.

**Tech Stack:** TypeScript, React 19, TanStack Router 1.78, TanStack Query 5, tRPC 11 + Zod + superjson, Drizzle ORM on PostgreSQL 16, Vitest, Playwright (smoke), Tailwind v4, lucide-react icons. pnpm workspaces + Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`, sections 2, 3, 5.1, 5.2, 5.4, 5.5, 6 and 12 (phase 1).

## Global Constraints

- Every customer-facing URL lives under `/projects/…`; old `/p/…` and `/domains/…` paths stay as redirects indefinitely (spec 3.1).
- The noun in URLs and code stays `source`; interface text says "website" (spec 2).
- Nothing is auto-named without being editable. Project name is typed at creation. Website name is prefilled from the hostname and editable (spec 2).
- Copy: sentence case, plain verbs, every button says what happens, every disabled control has a visible reason within one line (spec 6). Customer-facing text never says "source", "dataset", "input set".
- No new UI library. Dialogs use the native `<dialog>` element.
- All packages are ESM (`"type": "module"`). Node 20.12 or newer.
- Tests: `pnpm -r test` is the gate and needs Postgres running (Docker container `robot-platform-db`). API router tests hit the real database via `createCallerFactory(appRouter)({ db })`. `pnpm test:ui` needs `pnpm dev:all` running and is opt-in via `RUN_UI_SMOKE=1`.
- Commit messages end with the attribution trailer the session uses:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01AZ6EysmV6fcq3FxP33KFsw`.
- Windows dev machine: run shell commands in Git Bash syntax. `pnpm` works through `npx pnpm` if the launcher is broken (see memory note "Windows dev machine setup").

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `packages/dashboard/src/lib/legacy-routes.ts` | Pure mapping from an old `/p/…` or `/domains/…` path to its new path | Create |
| `packages/dashboard/src/lib/legacy-routes.test.ts` | Tests for the mapper | Create |
| `packages/dashboard/src/lib/site-name.ts` | Pure: prefill a website name from a URL's hostname | Create |
| `packages/dashboard/src/lib/site-name.test.ts` | Tests | Create |
| `packages/dashboard/src/router.tsx` | New route paths, redirect routes, tab routes | Modify |
| `packages/dashboard/src/components/layout.tsx` | Nav: Projects, quiet Ops link | Modify |
| `packages/dashboard/src/components/dialog.tsx` | Native `<dialog>` wrapper with title, body, footer | Create |
| `packages/dashboard/src/components/inline-rename.tsx` | Title with a pencil that turns into an input | Create |
| `packages/dashboard/src/routes/projects-list.tsx` | Home: projects table + New project dialog | Rewrite |
| `packages/dashboard/src/routes/project-home.tsx` | Title with rename, fields (read-only this phase), websites, output line, Add website dialog | Rewrite |
| `packages/dashboard/src/routes/project-output.tsx` | `/projects/:project/output`: the project's dataset(s) | Create (moves `datasets-list.tsx` + `dataset-detail.tsx` behind one route) |
| `packages/dashboard/src/routes/source-detail.tsx` | Workspace header: breadcrumb with names, rename, tabs Schema / Overview / Runs / Settings | Modify |
| `packages/dashboard/src/routes/new-source.tsx` | The old wizard landing | Delete |
| `packages/dashboard/src/routes/source-index.tsx` | Auto-switch between Schema and Overview | Delete (index is always Schema) |
| every other file under `packages/dashboard/src/routes/` that contains `/p/$project` or `/domains` | Path strings in `useParams({ from })` and `<Link to>` | Modify (mechanical) |
| `packages/dashboard/src/routes-smoke.test.ts` | Route list, redirect checks, new create flow | Modify |
| `packages/api/src/slug.ts` | `slugify`, `uniqueSlug` | Create |
| `packages/api/src/slug.test.ts` | Tests | Create |
| `packages/api/src/routers/projects.ts` | `create` (new shape, creates dataset), `rename`, `list` with stats | Modify |
| `packages/api/src/routers/projects.test.ts` | Tests | Create |
| `packages/api/src/routers/sources.ts` | `createInProject`, `rename`, `updateSchema` syncs the input set | Modify |
| `packages/api/src/routers/sources-project.test.ts` | Tests for the three | Create |
| `docs/handoff.md`, `CLAUDE.md` | Route and command notes | Modify |

---

### Task 1: Legacy path mapper

**Files:**
- Create: `packages/dashboard/src/lib/legacy-routes.ts`
- Test: `packages/dashboard/src/lib/legacy-routes.test.ts`

**Interfaces:**
- Produces: `legacyTarget(pathname: string): string | null` — returns the new path for an old one, or `null` when the path is not a legacy path.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dashboard/src/lib/legacy-routes.test.ts
import { describe, it, expect } from 'vitest';
import { legacyTarget } from './legacy-routes';

describe('legacyTarget', () => {
  it('maps the project root', () => {
    expect(legacyTarget('/p/scratch')).toBe('/projects/scratch');
    expect(legacyTarget('/p/scratch/')).toBe('/projects/scratch');
  });
  it('maps sources and the renamed tabs', () => {
    expect(legacyTarget('/p/scratch/sources')).toBe('/projects/scratch/sources');
    expect(legacyTarget('/p/scratch/sources/abc')).toBe('/projects/scratch/sources/abc');
    expect(legacyTarget('/p/scratch/sources/abc/setup')).toBe('/projects/scratch/sources/abc');
    expect(legacyTarget('/p/scratch/sources/abc/config')).toBe('/projects/scratch/sources/abc/settings');
    expect(legacyTarget('/p/scratch/sources/abc/runs')).toBe('/projects/scratch/sources/abc/runs');
    expect(legacyTarget('/p/scratch/sources/abc/runs/r1')).toBe('/projects/scratch/sources/abc/runs/r1');
  });
  it('maps datasets to output and domains to ops', () => {
    expect(legacyTarget('/p/scratch/datasets')).toBe('/projects/scratch/output');
    expect(legacyTarget('/p/scratch/datasets/d1')).toBe('/projects/scratch/output');
    expect(legacyTarget('/domains')).toBe('/ops/domains');
    expect(legacyTarget('/domains/www.newegg.com')).toBe('/ops/domains/www.newegg.com');
  });
  it('sends the removed inputs screens to the project', () => {
    expect(legacyTarget('/p/scratch/inputs')).toBe('/projects/scratch');
    expect(legacyTarget('/p/scratch/inputs/i1')).toBe('/projects/scratch');
  });
  it('returns null for anything else', () => {
    expect(legacyTarget('/projects')).toBeNull();
    expect(legacyTarget('/projects/scratch')).toBeNull();
    expect(legacyTarget('/')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/legacy-routes.test.ts`
Expected: FAIL, cannot find module `./legacy-routes`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/dashboard/src/lib/legacy-routes.ts
/**
 * Old paths keep working forever (spec 3.1). This is the one table that says
 * where each one goes now; the router's redirect routes call it.
 */
export function legacyTarget(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  const domains = path.match(/^\/domains(\/.*)?$/);
  if (domains) return `/ops/domains${domains[1] ?? ''}`;

  const project = path.match(/^\/p\/([^/]+)(\/.*)?$/);
  if (!project) return null;
  const [, slug, rest = ''] = project;
  const base = `/projects/${slug}`;

  if (rest === '' ) return base;
  if (/^\/datasets(\/.*)?$/.test(rest)) return `${base}/output`;
  if (/^\/inputs(\/.*)?$/.test(rest)) return base;
  if (/^\/domains(\/.*)?$/.test(rest)) return `${base}${rest}`;

  const source = rest.match(/^\/sources\/([^/]+)(\/.*)?$/);
  if (source) {
    const [, sourceSlug, tail = ''] = source;
    const sbase = `${base}/sources/${sourceSlug}`;
    if (tail === '' || tail === '/setup') return sbase;
    if (tail === '/config') return `${sbase}/settings`;
    return `${sbase}${tail}`;
  }
  return `${base}${rest}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/legacy-routes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/legacy-routes.ts packages/dashboard/src/lib/legacy-routes.test.ts
git commit -m "feat(dashboard): legacy path mapper for the /p and /domains redirects"
```

---

### Task 2: Route move and redirects

**Files:**
- Modify: `packages/dashboard/src/router.tsx` (whole file)
- Modify: `packages/dashboard/src/components/layout.tsx`
- Delete: `packages/dashboard/src/routes/new-source.tsx`, `packages/dashboard/src/routes/source-index.tsx`
- Create: `packages/dashboard/src/routes/project-output.tsx`
- Modify (mechanical path-string edits): `packages/dashboard/src/routes/dataset-detail.tsx`, `datasets-list.tsx`, `domain-detail.tsx`, `domains-list.tsx`, `inputset-detail.tsx`, `inputsets-list.tsx`, `project-domain-detail.tsx`, `project-domains-list.tsx`, `project-home.tsx`, `projects-list.tsx`, `source-config.tsx`, `source-detail.tsx`, `source-inputs.tsx`, `source-overview.tsx`, `source-run-detail.tsx`, `source-runs.tsx`, `source-schema.tsx`, `sources-list.tsx`
- Modify: `packages/dashboard/src/routes-smoke.test.ts` (`ROUTES` list only; the rest of the smoke test changes in Task 9)

**Interfaces:**
- Consumes: `legacyTarget` from Task 1.
- Produces: route ids used by every later task, exactly: `/projects`, `/projects/$project`, `/projects/$project/output`, `/projects/$project/domains`, `/projects/$project/domains/$domain`, `/projects/$project/sources`, `/projects/$project/sources/$source` (layout) with children `/` (Schema), `overview`, `settings`, `runs`; `/projects/$project/sources/$source/runs/$run`; `/ops/domains`, `/ops/domains/$domain`.

- [ ] **Step 1: Replace the path strings mechanically**

Run from the repo root in Git Bash:

```bash
cd packages/dashboard/src
# project prefix
grep -rl "/p/\$project" routes router.tsx | xargs sed -i "s#/p/\$project#/projects/\$project#g"
# the schema tab is the index now; config is settings
sed -i "s#/projects/\$project/sources/\$source/setup#/projects/\$project/sources/\$source#g" routes/*.tsx router.tsx
sed -i "s#/projects/\$project/sources/\$source/config#/projects/\$project/sources/\$source/settings#g" routes/*.tsx router.tsx
# datasets list becomes output
sed -i "s#/projects/\$project/datasets/\$dataset#/projects/\$project/output#g; s#/projects/\$project/datasets#/projects/\$project/output#g" routes/*.tsx router.tsx
# global domains views move under ops
grep -rl "'/domains" routes components router.tsx | xargs sed -i "s#'/domains#'/ops/domains#g"
cd ../../..
```

Then open `packages/dashboard/src/routes/domains-list.tsx` and `domain-detail.tsx` and confirm the `useParams({ from: '/ops/domains/$domain' })` and every `<Link to="/ops/domains…">` read correctly. The sed above does not touch `/projects/$project/domains…` (project-scoped cache views), which keep their paths.

- [ ] **Step 2: Rewrite `router.tsx`**

Replace the whole file with:

```tsx
// packages/dashboard/src/router.tsx
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { Layout } from './components/layout';
import { legacyTarget } from './lib/legacy-routes';

import ProjectsList from './routes/projects-list';
import ProjectHome from './routes/project-home';
import ProjectOutput from './routes/project-output';
import ProjectDomainsList from './routes/project-domains-list';
import ProjectDomainDetail from './routes/project-domain-detail';
import SourcesList from './routes/sources-list';
import SourceDetail from './routes/source-detail';
import SourceSchema from './routes/source-schema';
import SourceOverview from './routes/source-overview';
import SourceConfig from './routes/source-config';
import SourceRuns from './routes/source-runs';
import SourceRunDetail from './routes/source-run-detail';
import DomainsList from './routes/domains-list';
import DomainDetail from './routes/domain-detail';

const rootRoute = createRootRoute({ component: Layout });

// Home is the projects list. After auth, `/` becomes the landing page and
// signed-in users still land on /projects (spec 3.3).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
});

const projectsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsList });
const projectHomeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project', component: ProjectHome });
const projectOutputRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/output', component: ProjectOutput });
const projectDomainsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/domains', component: ProjectDomainsList });
const projectDomainDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/domains/$domain', component: ProjectDomainDetail });
const sourcesListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/sources', component: SourcesList });

const sourceDetailLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/sources/$source',
  component: SourceDetail,
});
// The bare source URL is the Schema tab, always (spec 5.6).
const sourceSchemaRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: '/', component: SourceSchema });
const sourceOverviewRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: 'overview', component: SourceOverview });
const sourceSettingsRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: 'settings', component: SourceConfig });
const sourceRunsRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: 'runs', component: SourceRuns });

// Run detail stays at root level: own breadcrumbs, no tabs.
const sourceRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/sources/$source/runs/$run',
  component: SourceRunDetail,
});

// Operator views. Out of the customer nav, still routed (spec 3.1).
const opsDomainsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops/domains', component: DomainsList });
const opsDomainDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops/domains/$domain', component: DomainDetail });

// Legacy paths. `legacyTarget` is the single table of where each one went;
// these three routes only exist to catch the old prefixes and call it.
function legacyRedirect({ location }: { location: { pathname: string } }): never {
  const target = legacyTarget(location.pathname) ?? '/projects';
  throw redirect({ to: target as never });
}
const legacyProjectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$project', beforeLoad: legacyRedirect });
const legacyProjectSplatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$project/$', beforeLoad: legacyRedirect });
const legacyDomainsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/domains', beforeLoad: legacyRedirect });
const legacyDomainDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/domains/$', beforeLoad: legacyRedirect });

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsListRoute,
  projectHomeRoute,
  projectOutputRoute,
  projectDomainsListRoute,
  projectDomainDetailRoute,
  sourcesListRoute,
  sourceDetailLayoutRoute.addChildren([sourceSchemaRoute, sourceOverviewRoute, sourceSettingsRoute, sourceRunsRoute]),
  sourceRunDetailRoute,
  opsDomainsListRoute,
  opsDomainDetailRoute,
  legacyProjectRoute,
  legacyProjectSplatRoute,
  legacyDomainsRoute,
  legacyDomainDetailRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 3: Create `project-output.tsx` from the two dataset screens**

Create `packages/dashboard/src/routes/project-output.tsx`:

```tsx
// packages/dashboard/src/routes/project-output.tsx
import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import DatasetDetail from './dataset-detail';
import DatasetsList from './datasets-list';

/**
 * /projects/:project/output. A project normally has one dataset, so this
 * shows that dataset's table straight away; with several it lists them
 * (spec 3.1, 5.3).
 */
export default function ProjectOutput() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/output' });
  const projectQuery = trpc.projects.getBySlug.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });

  if (projectQuery.isLoading) return <Spinner label="Loading output..." />;
  if (projectQuery.isError) return <ErrorBanner message={projectQuery.error.message} />;
  if (!projectQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;

  const datasets = projectQuery.data.datasets;
  if (datasets.length === 1) return <DatasetDetail datasetSlug={datasets[0]!.slug} />;
  return <DatasetsList />;
}
```

Then change `dataset-detail.tsx` so it takes the dataset slug as a prop instead of a route param. Replace its `useParams` line:

```tsx
export default function DatasetDetail({ datasetSlug }: { datasetSlug: string }) {
  const { project: projectSlug } = useParams({ from: '/projects/$project/output' });
```

and delete the old `const { project: projectSlug, dataset: datasetSlug } = useParams({ from: … })`. In `datasets-list.tsx`, change `useParams({ from: '/projects/$project/output' })` if the sed left another id, and make each dataset row link to `/projects/$project/output` (the list is only shown when there are several; a per-dataset page returns in a later phase if needed). Any `<Link to="/projects/$project/output" params={{ project, dataset }}>` must drop the `dataset` param.

- [ ] **Step 4: Delete the two files and fix `source-detail.tsx` tabs**

```bash
git rm packages/dashboard/src/routes/new-source.tsx packages/dashboard/src/routes/source-index.tsx
```

In `packages/dashboard/src/routes/source-detail.tsx`, replace the `activeTo` computation and the `SubTabNav` block with:

```tsx
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sourceBasePath = `/projects/${projectSlug}/sources/${sourceSlug}`;
  let activeTo = '/projects/$project/sources/$source/';
  if (pathname.startsWith(`${sourceBasePath}/overview`)) activeTo = '/projects/$project/sources/$source/overview';
  else if (pathname.startsWith(`${sourceBasePath}/settings`)) activeTo = '/projects/$project/sources/$source/settings';
  else if (pathname.startsWith(`${sourceBasePath}/runs`)) activeTo = '/projects/$project/sources/$source/runs';
```

```tsx
      <SubTabNav
        activeTo={activeTo}
        tabs={[
          { label: 'Schema', to: '/projects/$project/sources/$source/', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Overview', to: '/projects/$project/sources/$source/overview', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Runs', to: '/projects/$project/sources/$source/runs', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Settings', to: '/projects/$project/sources/$source/settings', params: { project: projectSlug, source: sourceSlug } },
        ]}
      />
```

Remove the `Inputs` tab and the `source-inputs.tsx` import wherever it was referenced; the file can stay on disk (unrouted) or be deleted with `git rm packages/dashboard/src/routes/source-inputs.tsx packages/dashboard/src/routes/inputsets-list.tsx packages/dashboard/src/routes/inputset-detail.tsx`. Delete them; they are six-line stubs.

- [ ] **Step 5: Update the nav in `layout.tsx`**

Replace the `<nav>` block:

```tsx
          <nav className="flex items-center gap-1">
            <Link to="/projects" className={navLink} activeProps={{ className: `${navLink} ${navLinkActive}` }}>
              Projects
            </Link>
            <Link
              to="/ops/domains"
              className={`${navLink} text-gray-400`}
              activeProps={{ className: `${navLink} ${navLinkActive}` }}
              title="Operator view of the domain cache"
            >
              Ops
            </Link>
          </nav>
```

- [ ] **Step 6: Update the smoke test route list**

In `packages/dashboard/src/routes-smoke.test.ts`, replace the `ROUTES` array:

```ts
const ROUTES = [
  '/',
  '/projects',
  '/projects/scratch',
  '/projects/scratch/output',
  '/projects/scratch/domains',
  '/projects/scratch/sources',
  '/ops/domains',
  // Requires at least one extraction to have run.
  '/ops/domains/www.newegg.com',
  // Legacy paths must redirect, not 404 (spec 3.1).
  '/p/scratch',
  '/p/scratch/sources',
  '/domains',
];
```

- [ ] **Step 7: Typecheck and run the unit tests**

Run: `pnpm --filter @robot/dashboard typecheck && pnpm --filter @robot/dashboard test`
Expected: typecheck passes with no unknown route ids (TanStack Router's typed `to` catches every string the sed missed; fix each reported file by hand), and the lib tests pass. If typecheck reports `Type '"/projects/$project/sources/$source/setup"'`, that file still has an old string; fix it.

- [ ] **Step 8: Start both servers and click through**

Run: `pnpm dev:all` in a separate terminal, then open `http://localhost:3456/`, `http://localhost:3456/p/scratch`, `http://localhost:3456/domains`. Expected: `/` lands on the projects list; the two legacy URLs land on `/projects/scratch` and `/ops/domains`.

- [ ] **Step 9: Commit**

```bash
git add -A packages/dashboard/src
git commit -m "feat(dashboard): move customer routes under /projects, ops under /ops, redirects for the old paths"
```

---

### Task 3: Slug helpers in the API

**Files:**
- Create: `packages/api/src/slug.ts`
- Test: `packages/api/src/slug.test.ts`

**Interfaces:**
- Produces: `slugify(text: string): string` and `uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/slug.test.ts
import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it('lowercases, strips accents and punctuation, collapses separators', () => {
    expect(slugify('AbeBooks Q3')).toBe('abebooks-q3');
    expect(slugify('  Currys — laptops!  ')).toBe('currys-laptops');
    expect(slugify('Çà et là')).toBe('ca-et-la');
  });
  it('never returns an empty slug', () => {
    expect(slugify('***')).toBe('item');
  });
  it('caps length at 60', () => {
    expect(slugify('a'.repeat(100)).length).toBe(60);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when free', async () => {
    expect(await uniqueSlug('abebooks', async () => false)).toBe('abebooks');
  });
  it('appends the first free counter', async () => {
    const taken = new Set(['abebooks', 'abebooks-2']);
    expect(await uniqueSlug('abebooks', async (s) => taken.has(s))).toBe('abebooks-3');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/slug.test.ts`
Expected: FAIL, cannot find module `./slug.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/api/src/slug.ts
/** URL-safe slug from a customer-typed name. Never empty, at most 60 chars. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** `base`, or `base-2`, `base-3`, … — the first one `taken` says is free. */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free slug for ${base}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/slug.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/slug.ts packages/api/src/slug.test.ts
git commit -m "feat(api): slugify and uniqueSlug helpers"
```

---

### Task 4: `projects.create` with its dataset, `projects.rename`

**Files:**
- Modify: `packages/api/src/routers/projects.ts` (`create` procedure, add `rename`)
- Test: `packages/api/src/routers/projects.test.ts` (new)

**Interfaces:**
- Consumes: `slugify`, `uniqueSlug` (Task 3).
- Produces: `projects.create({ name, description? }) → { id, slug, name, datasetId }`; `projects.rename({ projectId, name }) → { id, name }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/routers/projects.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(projects).where(eq(projects.id, id)); // datasets cascade
});

describe('projects.create', () => {
  it('creates the project under the default org with one dataset named after it', async () => {
    const p = await caller.projects.create({ name: 'AbeBooks Q3', description: 'books' });
    created.push(p.id);
    expect(p.slug).toBe('abebooks-q3');
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect(ds?.name).toBe('AbeBooks Q3');
    expect(ds?.projectId).toBe(p.id);
    expect(ds?.schema).toEqual([]);
  });
  it('gives a second project with the same name a numbered slug', async () => {
    const a = await caller.projects.create({ name: 'Twice' });
    const b = await caller.projects.create({ name: 'Twice' });
    created.push(a.id, b.id);
    expect(b.slug).toBe('twice-2');
  });
  it('rejects an empty name', async () => {
    await expect(caller.projects.create({ name: '   ' })).rejects.toThrow();
  });
});

describe('projects.rename', () => {
  it('changes the name and keeps the slug', async () => {
    const p = await caller.projects.create({ name: 'Before' });
    created.push(p.id);
    const r = await caller.projects.rename({ projectId: p.id, name: 'After' });
    expect(r.name).toBe('After');
    const row = await db.query.projects.findFirst({ where: eq(projects.id, p.id) });
    expect(row?.slug).toBe('before');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/routers/projects.test.ts`
Expected: FAIL. `create` rejects the input shape (it requires `orgId` and `slug` today) and `rename` does not exist.

- [ ] **Step 3: Rewrite `create` and add `rename`**

In `packages/api/src/routers/projects.ts`, add the imports:

```ts
import { TRPCError } from '@trpc/server';
import { slugify, uniqueSlug } from '../slug.js';
```

Replace the `create` procedure with these two:

```ts
  /**
   * The customer names the project (spec 2, 5.2). It gets one dataset named
   * after it: the project's field list and output table (spec 4.1). Lives
   * under the single default org until auth arrives.
   */
  create: publicProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255), description: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.db.query.orgs.findFirst({ where: eq(orgs.slug, 'default') });
      if (!org) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No default org. Run `pnpm db:seed` first.' });

      const slug = await uniqueSlug(slugify(input.name), async (s) =>
        !!(await ctx.db.query.projects.findFirst({ where: and(eq(projects.orgId, org.id), eq(projects.slug, s)), columns: { id: true } })),
      );

      return ctx.db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({ orgId: org.id, name: input.name, slug, description: input.description ?? null })
          .returning({ id: projects.id, slug: projects.slug, name: projects.name });
        const [dataset] = await tx
          .insert(datasets)
          .values({ projectId: project!.id, name: input.name, slug, schema: [] })
          .returning({ id: datasets.id });
        return { ...project!, datasetId: dataset!.id };
      });
    }),

  rename: publicProcedure
    .input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(projects.id, input.projectId))
        .returning({ id: projects.id, name: projects.name });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectId} not found` });
      return row;
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/routers/projects.test.ts`
Expected: PASS, 4 tests. Then `pnpm --filter @robot/api typecheck` passes (nothing else called `projects.create` with the old shape; confirm with `grep -rn "projects.create" packages --include=*.ts --include=*.tsx`).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/projects.ts packages/api/src/routers/projects.test.ts
git commit -m "feat(api): projects.create names the project and makes its dataset; projects.rename"
```

---

### Task 5: `sources.createInProject`, `sources.rename`, and the input set sync in `updateSchema`

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (add two procedures after `quickCreate`; extend `updateSchema`)
- Test: `packages/api/src/routers/sources-project.test.ts` (new)

**Interfaces:**
- Consumes: `slugify`, `uniqueSlug` (Task 3); `projects.create` (Task 4) in tests.
- Produces: `sources.createInProject({ projectSlug, name, url }) → { sourceId, projectSlug, sourceSlug }`; `sources.rename({ sourceId, name }) → { id, name }`. `sources.updateSchema` now also writes the source's input set rows: the listing URL when given, else the three product URLs, and sets `listingMode` accordingly.

Why the sync: the old wizard created the input set at `createWithSchema` time. A source created by `createInProject` has none, and the planner plans from input set rows, so without this Extract on such a source would plan nothing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/routers/sources-project.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, sources, inputSets, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const projectIds: string[] = [];

afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    // input sets belong to the project and do not cascade from sources
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

async function freshProject(name = 'Proj') {
  const p = await caller.projects.create({ name });
  projectIds.push(p.id);
  return p;
}

describe('sources.createInProject', () => {
  it('creates a website in the project dataset with the given name and a slug from it', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'AbeBooks', url: 'https://www.abebooks.com/' });
    expect(r.projectSlug).toBe(p.slug);
    expect(r.sourceSlug).toBe('abebooks');
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.datasetId).toBe(p.datasetId);
    expect(s?.name).toBe('AbeBooks');
    expect(s?.urlTemplate).toBe('https://www.abebooks.com/');
    expect(s?.schemaDefinition).toBeNull();
    expect(s?.inputSetId).toBeNull();
  });
  it('numbers a second website with the same name', async () => {
    const p = await freshProject();
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'Same', url: 'https://a.example/' });
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Same', url: 'https://b.example/' });
    expect(r.sourceSlug).toBe('same-2');
  });
  it('rejects a non-http url', async () => {
    const p = await freshProject();
    await expect(caller.sources.createInProject({ projectSlug: p.slug, name: 'x', url: 'file:///etc/passwd' })).rejects.toThrow();
  });
  it('404s an unknown project', async () => {
    await expect(caller.sources.createInProject({ projectSlug: 'nope-nope', name: 'x', url: 'https://a.example/' })).rejects.toThrow(/not found/i);
  });
});

describe('sources.rename', () => {
  it('changes the name only', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Old', url: 'https://a.example/' });
    const out = await caller.sources.rename({ sourceId: r.sourceId, name: 'New' });
    expect(out.name).toBe('New');
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.slug).toBe('old');
  });
});

describe('sources.updateSchema keeps the input set in step', () => {
  const host = 'shop.example';
  const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  const fields = [{ name: 'price', type: 'money' as const, description: 'the price' }];
  const expected = { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } };

  it('creates a detail input set from the three product urls when there is no listing url', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateSchema({ sourceId: r.sourceId, urls, fields, expected });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('detail');
    expect(s?.inputSet?.rows).toEqual(urls.map((url) => ({ url })));
  });
  it('switches to one listing row and listing mode when a listing url is given, and back', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateSchema({ sourceId: r.sourceId, urls, fields, expected, listingUrl: `https://${host}/all` });
    let s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('listing_to_detail');
    expect(s?.inputSet?.rows).toEqual([{ url: `https://${host}/all` }]);
    const firstInputSetId = s?.inputSetId;

    await caller.sources.updateSchema({ sourceId: r.sourceId, urls, fields, expected });
    s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('detail');
    expect(s?.inputSetId).toBe(firstInputSetId); // updated in place, not recreated
    expect(s?.inputSet?.rows).toEqual(urls.map((url) => ({ url })));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/routers/sources-project.test.ts`
Expected: FAIL on `createInProject` not existing.

- [ ] **Step 3: Add the two procedures**

In `packages/api/src/routers/sources.ts` add the import `import { slugify, uniqueSlug } from '../slug.js';` and, directly after the `quickCreate` procedure, add:

```ts
  // ─── Project-scoped creation (mvp-flow phase 1, spec 5.4) ────────────────

  /**
   * "Add website": a named source in the project's dataset with nothing else
   * yet. The three proof pages, the fields and the listing pages are filled
   * in on its tabs afterwards; `updateSchema` creates the input set the
   * first time it has URLs to put in it.
   */
  createInProject: publicProcedure
    .input(z.object({
      projectSlug: z.string().min(1),
      name: z.string().trim().min(1).max(255),
      url: httpUrl,
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.slug, input.projectSlug),
        with: { datasets: { orderBy: (d, { asc }) => [asc(d.createdAt)], limit: 1 } },
      });
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });

      let datasetId = project.datasets[0]?.id;
      if (!datasetId) {
        const [ds] = await ctx.db.insert(datasets).values({ projectId: project.id, name: project.name, slug: project.slug, schema: [] }).returning({ id: datasets.id });
        datasetId = ds!.id;
      }

      const sourceSlug = await uniqueSlug(slugify(input.name), async (s) =>
        !!(await ctx.db.query.sources.findFirst({ where: and(eq(sources.datasetId, datasetId!), eq(sources.slug, s)), columns: { id: true } })),
      );

      const [source] = await ctx.db
        .insert(sources)
        .values({
          datasetId,
          name: input.name,
          slug: sourceSlug,
          country: 'us',
          inputStrategy: 'direct',
          urlTemplate: input.url,
        })
        .returning({ id: sources.id });

      return { sourceId: source!.id, projectSlug: project.slug, sourceSlug };
    }),

  rename: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(sources)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(sources.id, input.sourceId))
        .returning({ id: sources.id, name: sources.name });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      return row;
    }),
```

`httpUrl` is already imported in this file from `../verify/schema-input.js` (it is used by `findProductPages`); if the import is missing, add it. `projects` and `datasets` are already imported from `@robot/db`.

- [ ] **Step 4: Extend `updateSchema` to sync the input set**

In the `updateSchema` procedure, after the `.update(sources).set({ schemaDefinition: fields, verificationSet, updatedAt: new Date() })…returning()` statement and before `return updated;`, add:

```ts
      // Keep the planner's input in step with the schema (phase 1 plan, Task 5):
      // a listing URL means one listing row and listing mode; none means the
      // three product pages as detail rows. Updated in place so a source keeps
      // its input set id across edits.
      const rows = schema.listingUrl ? [{ url: schema.listingUrl }] : schema.urls.map((url) => ({ url }));
      const listingMode = schema.listingUrl ? 'listing_to_detail' : 'detail';
      const withProject = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, sourceId),
        columns: { inputSetId: true, name: true, confirmedAt: true, listingMode: true },
        with: { dataset: { columns: { projectId: true } } },
      });
      if (withProject?.confirmedAt && withProject.listingMode && withProject.listingMode !== listingMode) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} is confirmed; its listing mode is locked` });
      }
      if (withProject?.inputSetId) {
        await ctx.db.update(inputSets).set({ rows, updatedAt: new Date() }).where(eq(inputSets.id, withProject.inputSetId));
        await ctx.db.update(sources).set({ listingMode }).where(eq(sources.id, sourceId));
      } else if (withProject?.dataset?.projectId) {
        const [inputSet] = await ctx.db
          .insert(inputSets)
          .values({ projectId: withProject.dataset.projectId, type: 'direct', name: withProject.name, columns: [{ name: 'url', primary: true }], rows })
          .returning({ id: inputSets.id });
        await ctx.db
          .update(sources)
          .set({ inputSetId: inputSet!.id, listingMode, ...(schema.listingUrl ? { budget: LISTING_DEFAULT_BUDGET } : {}) })
          .where(eq(sources.id, sourceId));
      }
```

`inputSets` is already imported. The `dataset` relation on `sources` exists in `@robot/db` (`sourcesRelations`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @robot/api exec vitest run src/routers/sources-project.test.ts src/routers/sources-schema.test.ts src/routers/sources.test.ts`
Expected: PASS. If `sources-schema.test.ts` has an `updateSchema` test that asserts the source's input set is untouched, update that assertion to the new behaviour and say so in the commit message.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @robot/api typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routers/sources.ts packages/api/src/routers/sources-project.test.ts packages/api/src/routers/sources-schema.test.ts
git commit -m "feat(api): sources.createInProject and sources.rename; updateSchema keeps the input set in step"
```

---

### Task 6: `projects.list` with the stats the home page shows

**Files:**
- Modify: `packages/api/src/routers/projects.ts` (`list`)
- Modify: `packages/api/src/routers/projects.test.ts` (add a describe block)

**Interfaces:**
- Produces: each row of `projects.list` gains `sourceCount: number`, `verifiedSourceCount: number`, `fieldCount: number`, `lastRun: { createdAt: Date; resultCount: number | null } | null`. Existing fields stay.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/routers/projects.test.ts`:

```ts
describe('projects.list stats', () => {
  it('counts websites, verified websites, fields, and reports the last run', async () => {
    const p = await caller.projects.create({ name: 'Stats' });
    created.push(p.id);
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'B', url: 'https://b.example/' });
    await db.update(datasets).set({ schema: [{ key: 'price', name: 'price', type: 'money' }, { key: 'title', name: 'title', type: 'text' }] }).where(eq(datasets.id, p.datasetId));

    const row = (await caller.projects.list()).find((r) => r.id === p.id)!;
    expect(row.sourceCount).toBe(2);
    expect(row.verifiedSourceCount).toBe(0);
    expect(row.fieldCount).toBe(2);
    expect(row.lastRun).toBeNull();
  });
});
```

Note: `afterEach` in this file deletes the project; sources cascade from the dataset, which cascades from the project, but input sets do not exist for these sources, so nothing else is left behind.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/routers/projects.test.ts -t stats`
Expected: FAIL, `sourceCount` is undefined.

- [ ] **Step 3: Rewrite `list`**

Replace the `list` procedure body with:

```ts
  list: publicProcedure.query(async ({ ctx }) => {
    const base = await ctx.db
      .select({
        id: projects.id,
        orgId: projects.orgId,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        datasetCount: sql<number>`count(${datasets.id})::int`,
        fieldCount: sql<number>`coalesce(sum(jsonb_array_length(coalesce(${datasets.schema}, '[]'::jsonb))), 0)::int`,
      })
      .from(projects)
      .leftJoin(datasets, eq(projects.id, datasets.projectId))
      .groupBy(projects.id)
      .orderBy(projects.name);

    const sourceRows = await ctx.db
      .select({ projectId: datasets.projectId, id: sources.id, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id));

    const lastRuns = await ctx.db
      .select({
        projectId: datasets.projectId,
        createdAt: sql<Date>`max(${runs.createdAt})`,
      })
      .from(runs)
      .innerJoin(sources, eq(runs.sourceId, sources.id))
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .groupBy(datasets.projectId);

    const verifiedByProject = new Map<string, number>();
    const countByProject = new Map<string, number>();
    for (const s of sourceRows) {
      countByProject.set(s.projectId, (countByProject.get(s.projectId) ?? 0) + 1);
      const cert = await loadCurrentCertification(ctx.db, s.id);
      if (cert) verifiedByProject.set(s.projectId, (verifiedByProject.get(s.projectId) ?? 0) + 1);
    }

    const lastRunByProject = new Map<string, { createdAt: Date; resultCount: number | null }>();
    for (const r of lastRuns) {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.createdAt, r.createdAt),
        columns: { createdAt: true, resultCount: true },
      });
      if (run) lastRunByProject.set(r.projectId, run);
    }

    return base.map((p) => ({
      ...p,
      sourceCount: countByProject.get(p.id) ?? 0,
      verifiedSourceCount: verifiedByProject.get(p.id) ?? 0,
      lastRun: lastRunByProject.get(p.id) ?? null,
    }));
  }),
```

Add the import `import { loadCurrentCertification } from '../verify/current-certification.js';` at the top of the file. `runs` is already imported.

One query per source for the certification is acceptable at MVP size; it is the same loader the workspace uses, so "verified" means the same thing on every screen.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/api exec vitest run src/routers/projects.test.ts && pnpm --filter @robot/api typecheck`
Expected: PASS, 5 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/projects.ts packages/api/src/routers/projects.test.ts
git commit -m "feat(api): projects.list carries website, verified, field and last-run stats"
```

---

### Task 7: Dialog, inline rename, site-name helper

**Files:**
- Create: `packages/dashboard/src/components/dialog.tsx`
- Create: `packages/dashboard/src/components/inline-rename.tsx`
- Create: `packages/dashboard/src/lib/site-name.ts`
- Test: `packages/dashboard/src/lib/site-name.test.ts`

**Interfaces:**
- Produces: `<Dialog open title onClose>children</Dialog>`; `<InlineRename value onSave(name) pending?>` renders the name with a pencil and turns into an input on click; `siteNameFromUrl(url: string): string`.

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// packages/dashboard/src/lib/site-name.test.ts
import { describe, it, expect } from 'vitest';
import { siteNameFromUrl } from './site-name';

describe('siteNameFromUrl', () => {
  it('uses the registrable label, capitalised', () => {
    expect(siteNameFromUrl('https://www.abebooks.com/')).toBe('Abebooks');
    expect(siteNameFromUrl('https://shop.currys.co.uk/laptops')).toBe('Currys');
    expect(siteNameFromUrl('http://biblio.com')).toBe('Biblio');
  });
  it('returns an empty string for anything that is not a url yet', () => {
    expect(siteNameFromUrl('abebooks')).toBe('');
    expect(siteNameFromUrl('')).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/site-name.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the helper and the two components**

```ts
// packages/dashboard/src/lib/site-name.ts
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

/** "https://shop.currys.co.uk/x" → "Currys". Prefill only; the customer edits it (spec 5.4). */
export function siteNameFromUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return '';
  }
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return '';
  let i = labels.length - 2;
  if (i > 0 && SECOND_LEVEL.has(labels[i]!) && labels[labels.length - 1]!.length === 2) i -= 1;
  const label = labels[i]!;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
```

```tsx
// packages/dashboard/src/components/dialog.tsx
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Native <dialog>: focus trapping, Escape, and the backdrop come from the
 * browser. Body content is the form; the caller owns the footer buttons.
 */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-gray-900/30"
    >
      <div className="px-5 pt-4 pb-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </dialog>
  );
}

export const fieldClass = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100';
export const labelClass = 'block text-xs text-gray-600';
```

```tsx
// packages/dashboard/src/components/inline-rename.tsx
import { useEffect, useState } from 'react';
import { Pencil, Loader2 } from 'lucide-react';

/** A title the customer can rename in place. Enter saves, Escape cancels, blur saves. */
export function InlineRename({ value, onSave, pending, className }: { value: string; onSave: (name: string) => void; pending?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onSave(next);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className={`rounded-md border border-gray-300 px-2 py-0.5 focus:border-accent-500 focus:outline-none ${className ?? ''}`}
        aria-label="Name"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className={`group inline-flex items-center gap-2 text-left ${className ?? ''}`} title="Rename">
      <span>{value}</span>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : <Pencil className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500" />}
    </button>
  );
}
```

- [ ] **Step 4: Run the helper test and typecheck**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/site-name.test.ts && pnpm --filter @robot/dashboard typecheck`
Expected: PASS, 2 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/dialog.tsx packages/dashboard/src/components/inline-rename.tsx packages/dashboard/src/lib/site-name.ts packages/dashboard/src/lib/site-name.test.ts
git commit -m "feat(dashboard): native dialog, inline rename, site-name prefill helper"
```

---

### Task 8: Projects list with New project

**Files:**
- Rewrite: `packages/dashboard/src/routes/projects-list.tsx`

**Interfaces:**
- Consumes: `projects.list` stats (Task 6), `projects.create` (Task 4), `Dialog`, `fieldClass`, `labelClass` (Task 7), `formatDate` from `lib/format`.

- [ ] **Step 1: Rewrite the screen**

```tsx
// packages/dashboard/src/routes/projects-list.tsx
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { formatDate } from '../lib/format';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { Dialog, fieldClass, labelClass } from '../components/dialog';

/** Home (spec 5.1): every project, what is proven in it, when it last ran. */
export default function ProjectsList() {
  const listQuery = trpc.projects.list.useQuery();
  const [creating, setCreating] = useState(false);

  if (listQuery.isLoading) return <Spinner label="Loading projects..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  const projects = listQuery.data ?? [];

  const newButton = (
    <button type="button" className="btn-primary h-9" onClick={() => setCreating(true)}>New project</button>
  );

  return (
    <div>
      <PageHeader title="Projects" actions={newButton} />

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" description="A project holds the fields you want and the websites to get them from." action={newButton} />
      ) : (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Project</th>
                <th className="px-4 py-2 text-left font-medium">Websites</th>
                <th className="px-4 py-2 text-left font-medium">Fields</th>
                <th className="px-4 py-2 text-left font-medium">Last extraction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <Link to="/projects/$project" params={{ project: p.slug }} className="font-medium text-gray-900 hover:underline">{p.name}</Link>
                    {p.description && <div className="truncate text-xs text-gray-500">{p.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {p.sourceCount === 0 ? <span className="text-gray-400">none yet</span> : (
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${p.verifiedSourceCount === p.sourceCount ? 'bg-emerald-600' : p.verifiedSourceCount === 0 ? 'bg-gray-400' : 'bg-amber-500'}`} />
                        {p.verifiedSourceCount} of {p.sourceCount} verified
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{p.fieldCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.lastRun ? <>{formatDate(new Date(p.lastRun.createdAt))}{p.lastRun.resultCount != null && <>, {p.lastRun.resultCount} rows</>}</> : 'never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = trpc.projects.create.useMutation({
    onSuccess: (p) => {
      utils.projects.list.invalidate();
      onClose();
      navigate({ to: '/projects/$project', params: { project: p.slug } });
    },
  });

  return (
    <Dialog open={open} title="New project" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate({ name, description: description || undefined }); }}>
        <label className={labelClass}>Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="AbeBooks Q3" />
        </label>
        <label className={`${labelClass} mt-3`}>What is it for <span className="text-gray-400">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} placeholder="mountaineering books, prices and authors" />
        </label>
        <p className="mt-2 text-xs text-gray-500">Fields and websites come next, on the project page.</p>
        {create.isError && <p className="mt-2 text-xs text-red-700">{create.error.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-quiet h-9" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary h-9" disabled={!name.trim() || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck and look at it**

Run: `pnpm --filter @robot/dashboard typecheck`, then with `pnpm dev:all` running open `http://localhost:3456/projects`, click New project, create "Smoke test project". Expected: the dialog closes and the browser lands on `/projects/smoke-test-project`. Delete the project afterwards with `psql`/Drizzle Studio (`pnpm --filter @robot/db exec drizzle-kit studio`) or leave it; Task 9's smoke test cleans up its own.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/routes/projects-list.tsx
git commit -m "feat(dashboard): projects list is the home page, with stats and a New project dialog"
```

---

### Task 9: Project home with websites and Add website

**Files:**
- Rewrite: `packages/dashboard/src/routes/project-home.tsx`

**Interfaces:**
- Consumes: `projects.getWithStats`, `projects.rename` (Task 4), `sources.listByProject`, `sources.createInProject` (Task 5), `sources.verificationStatus` (existing; returns `{ current, allPassed, results }`), `datasets.listByProject` (existing, input `{ projectId }`), `Dialog`, `InlineRename`, `siteNameFromUrl` (Task 7).

This phase shows the fields read-only from the dataset schema; editing them is phase 2.

- [ ] **Step 1: Rewrite the screen**

```tsx
// packages/dashboard/src/routes/project-home.tsx
import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { siteNameFromUrl } from '../lib/site-name';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { Dialog, fieldClass, labelClass } from '../components/dialog';
import { InlineRename } from '../components/inline-rename';

type DatasetField = { key?: string; name: string; type: string };

/** Project home (spec 5.3): fields on the left, websites on the right, output underneath. */
export default function ProjectHome() {
  const { project: projectSlug } = useParams({ from: '/projects/$project' });
  const utils = trpc.useUtils();
  const statsQuery = trpc.projects.getWithStats.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const sourcesQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const projectId = statsQuery.data?.project.id;
  const datasetsQuery = trpc.datasets.listByProject.useQuery({ projectId: projectId ?? '' }, { enabled: !!projectId });
  const rename = trpc.projects.rename.useMutation({ onSuccess: () => { utils.projects.getWithStats.invalidate(); utils.projects.list.invalidate(); } });
  const [adding, setAdding] = useState(false);

  if (statsQuery.isLoading) return <Spinner label="Loading project..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;

  const { project } = statsQuery.data;
  const sources = sourcesQuery.data ?? [];
  const datasets = datasetsQuery.data ?? [];
  const fields = datasets.flatMap((d) => (Array.isArray(d.schema) ? (d.schema as DatasetField[]) : []));

  return (
    <div>
      <div className="text-xs text-gray-500"><Link to="/projects" className="hover:text-gray-700">Projects</Link></div>
      <InlineRename value={project.name} pending={rename.isPending} onSave={(name) => rename.mutate({ projectId: project.id, name })} className="mt-1 text-xl font-semibold tracking-tight" />
      {project.description && <p className="mt-1 text-sm text-gray-600">{project.description}</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-medium text-gray-900">Fields <span className="font-normal text-gray-500">the columns of your output</span></h2>
          {fields.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No fields yet. Fields are edited on a website's Schema tab for now.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-xs text-gray-600"><tr><th className="py-1 text-left font-medium">Field</th><th className="py-1 text-left font-medium">Type</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {fields.map((f, i) => <tr key={f.key ?? i}><td className="py-1.5 font-mono text-xs">{f.name}</td><td className="py-1.5 text-gray-600">{f.type}</td></tr>)}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-gray-900">Websites <span className="font-normal text-gray-500">where the fields are proven and extracted</span></h2>
          <ul className="mt-2 space-y-1.5">
            {sources.map((s) => <WebsiteRow key={s.id} projectSlug={projectSlug} source={s} />)}
            <li>
              <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50">
                + Add website <span className="text-xs text-gray-400">name it, then pick three product pages</span>
              </button>
            </li>
          </ul>
          {datasets.length > 0 && (
            <div className="mt-4 flex items-center gap-3 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700">
              <span className="font-medium">Output</span>
              <span>{fields.length} columns</span>
              <Link to="/projects/$project/output" params={{ project: projectSlug }} className="ml-auto underline-offset-2 hover:underline">Open</Link>
            </div>
          )}
        </section>
      </div>

      <AddWebsiteDialog open={adding} onClose={() => setAdding(false)} projectSlug={projectSlug} />
    </div>
  );
}

function WebsiteRow({ projectSlug, source }: { projectSlug: string; source: { id: string; slug: string; name: string; urlTemplate: string | null; schemaDefinition: unknown } }) {
  const status = trpc.sources.verificationStatus.useQuery({ sourceId: source.id });
  const total = Array.isArray(source.schemaDefinition) ? source.schemaDefinition.length : 0;
  const results = (status.data?.results ?? {}) as Record<string, { certified?: unknown[] }>;
  const passed = Object.values(results).filter((f) => Array.isArray(f.certified) && f.certified.length > 0).length;
  const current = !!status.data?.current;
  const label = total === 0 ? 'no fields yet' : current && status.data?.allPassed ? `${total} of ${total} verified` : `${current ? passed : 0} of ${total} verified`;
  const dot = total === 0 ? 'bg-gray-300' : current && status.data?.allPassed ? 'bg-emerald-600' : 'bg-red-500';
  let host = '';
  try { host = source.urlTemplate ? new URL(source.urlTemplate).hostname : ''; } catch { host = ''; }
  return (
    <li>
      <Link to="/projects/$project/sources/$source" params={{ project: projectSlug, source: source.slug }} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm hover:bg-gray-50/60">
        <span className="font-medium">{source.name}</span>
        <span className="font-mono text-xs text-gray-500">{host}</span>
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-gray-600"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>
      </Link>
    </li>
  );
}

function AddWebsiteDialog({ open, onClose, projectSlug }: { open: boolean; onClose: () => void; projectSlug: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const create = trpc.sources.createInProject.useMutation({
    onSuccess: (r) => {
      utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
      utils.projects.list.invalidate();
      onClose();
      navigate({ to: '/projects/$project/sources/$source', params: { project: r.projectSlug, source: r.sourceSlug } });
    },
  });

  function onUrlChange(v: string) {
    setUrl(v);
    if (!nameTouched) setName(siteNameFromUrl(v));
  }

  return (
    <Dialog open={open} title="Add website" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate({ projectSlug, name, url }); }}>
        <label className={labelClass}>Any page on the website
          <input autoFocus value={url} onChange={(e) => onUrlChange(e.target.value)} className={`${fieldClass} font-mono`} placeholder="https://www.abebooks.com/" />
        </label>
        <label className={`${labelClass} mt-3`}>Name
          <input value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} className={fieldClass} placeholder="AbeBooks" />
        </label>
        <p className="mt-1 text-xs text-gray-500">Prefilled from the address. Change it to anything.</p>
        <p className="mt-2 text-xs text-gray-500">Next you'll pick three product pages and fill in the expected values.</p>
        {create.isError && <p className="mt-2 text-xs text-red-700">{create.error.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-quiet h-9" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary h-9" disabled={!name.trim() || !/^https?:\/\//.test(url) || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add website
          </button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck and try it**

Run: `pnpm --filter @robot/dashboard typecheck`. With both servers up, open a project, rename it with the pencil, add a website with `https://www.abebooks.com/`. Expected: name prefills as "Abebooks", editable; confirming lands on the website's Schema tab with empty URL inputs and the grid.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/routes/project-home.tsx
git commit -m "feat(dashboard): project home with rename, websites and their state, Add website dialog"
```

---

### Task 10: Workspace header with names and rename

**Files:**
- Modify: `packages/dashboard/src/routes/source-detail.tsx` (breadcrumb and title block)

**Interfaces:**
- Consumes: `sources.rename` (Task 5), `projects.getWithStats` for the project name, `InlineRename` (Task 7).

- [ ] **Step 1: Replace the breadcrumb and title**

Add imports `import { InlineRename } from '../components/inline-rename';` and use `trpc.projects.getWithStats` for the project's name. Replace the breadcrumb block and the `<div className="mt-2 flex items-center gap-3">…</div>` title block with:

```tsx
  const projectQuery = trpc.projects.getWithStats.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const utils = trpc.useUtils();
  const rename = trpc.sources.rename.useMutation({ onSuccess: () => utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }) });
```

(place these hooks above the early returns) and in the JSX:

```tsx
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          {projectQuery.data?.project.name ?? projectSlug}
        </Link>
      </div>

      <div className="mt-1 flex items-center gap-3">
        <InlineRename value={source.name} pending={rename.isPending} onSave={(name) => rename.mutate({ sourceId: source.id, name })} className="text-xl font-semibold tracking-tight" />
        {source.urlTemplate && (
          <a href={source.urlTemplate} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 truncate font-mono text-xs text-gray-500 hover:text-accent-700">
            <span className="max-w-md truncate">{hostOf(source.urlTemplate)}</span>
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        )}
      </div>
```

with this helper at the bottom of the file:

```tsx
function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}
```

Remove the `inputStrategy` pill and the `Layers` icon import if it becomes unused.

- [ ] **Step 2: Typecheck, try a rename, commit**

Run: `pnpm --filter @robot/dashboard typecheck`. In the browser, rename a website from its header; the project home reflects it after navigating back.

```bash
git add packages/dashboard/src/routes/source-detail.tsx
git commit -m "feat(dashboard): workspace header shows project and website names, inline rename"
```

---

### Task 11: Smoke test for the new flow and the redirects

**Files:**
- Modify: `packages/dashboard/src/routes-smoke.test.ts`

**Interfaces:**
- Consumes: `projects.create`, `sources.createInProject`, `sources.delete` (existing; unconfirmed sources only), route ids from Task 2.

- [ ] **Step 1: Add project cleanup and a redirect assertion**

Replace the two Scratch-specific `it(...)` blocks at the bottom of the file with:

```ts
  // Legacy paths must land on their new home, not render the old tree or a 404.
  it('redirects /p/scratch/sources to /projects/scratch/sources', async () => {
    const page: Page = await browser.newPage();
    try {
      await page.goto(DASHBOARD + '/p/scratch/sources', { waitUntil: 'networkidle', timeout: 30_000 });
      expect(new URL(page.url()).pathname).toBe('/projects/scratch/sources');
    } finally {
      await page.close();
    }
  });

  // The phase 1 create flow: a named project, a named website in it, and the
  // website's Schema tab (the index route) rendering its URL inputs and grid.
  it('a project and a website created through the new procedures render', async () => {
    const project = await client.projects.create.mutate({ name: `Smoke ${Date.now()}` });
    createdProjects.push(project.id);
    const site = await client.sources.createInProject.mutate({ projectSlug: project.slug, name: 'Smoke site', url: 'https://smoke.example/' });
    created.push(site.sourceId);

    await checkRoute(`/projects/${project.slug}`);
    const route = `/projects/${project.slug}/sources/${site.sourceSlug}`;
    await checkRoute(route);

    const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(DASHBOARD + route, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(1500);
      for (let i = 1; i <= 3; i++) {
        expect(await page.getByText(`Product URL ${i}`).count(), `Product URL ${i} label is missing`).toBeGreaterThan(0);
      }
      expect(await page.getByPlaceholder('price').count(), 'the schema grid did not render').toBeGreaterThan(0);
      expect(await page.getByText('Smoke site').count(), 'the website name is not in the header').toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60_000);
```

Add `const createdProjects: string[] = [];` next to `created`, and extend `afterAll` so that after deleting sources it deletes projects. There is no `projects.delete` procedure; add one to `packages/api/src/routers/projects.ts`:

```ts
  /** Test and cleanup use only for now: cascades datasets, sources and runs. */
  delete: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(projects).where(eq(projects.id, input.projectId));
      return { deleted: true };
    }),
```

and in the smoke `afterAll`:

```ts
  for (const projectId of createdProjects.splice(0)) {
    await client.projects.delete.mutate({ projectId }).catch((err) => console.error(`[smoke] could not delete project ${projectId}:`, err));
  }
```

- [ ] **Step 2: Run the smoke test**

With `pnpm dev:all` running in another terminal: `pnpm test:ui`
Expected: every route in `ROUTES` passes, the redirect test passes, the create-flow test passes. `/ops/domains/www.newegg.com` needs the Newegg domain row from an earlier extraction; if this machine lacks it, that one test fails with an error banner and that is a data precondition, not a regression. Say so in the report.

- [ ] **Step 3: Run the whole gate**

Run: `pnpm -r test`
Expected: green. If `sources.test.ts` or `sources-schema.test.ts` depended on `updateSchema` leaving the input set alone, they were adjusted in Task 5.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/routes-smoke.test.ts packages/api/src/routers/projects.ts
git commit -m "test(dashboard): smoke covers the new routes, a legacy redirect, and the project/website create flow"
```

---

### Task 12: Docs

**Files:**
- Modify: `CLAUDE.md` (Extraction Chain step 0 wording, Commands unchanged)
- Modify: `docs/handoff.md` (new entry at the top)

- [ ] **Step 1: CLAUDE.md**

In the "Extraction Chain" step 0, replace "the grid on the home page" with "the Schema tab of a website inside a project". In "Key Technical Decisions", add after the dashboard bullet: "Customer routes live under `/projects/…`; `/p/…` and `/domains/…` are redirects (2026-09-08, spec `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`). Operator views are under `/ops/…`."

- [ ] **Step 2: handoff.md**

Add a section directly under "## Read this first":

```markdown
## MVP flow phase 1 (2026-09-08): routes and shell landed; phases 2 to 5 follow the spec

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`. Plan for this phase:
`docs/superpowers/plans/2026-09-08-mvp-flow-phase1-routes-and-shell.md`. What changed: `/projects`
is home; every customer route moved from `/p/…` to `/projects/…` with redirects kept
(`packages/dashboard/src/lib/legacy-routes.ts` is the table); operator cache views moved to
`/ops/domains`; the wizard landing page is gone; a project is created by name
(`projects.create` also makes its dataset) and a website by name inside it
(`sources.createInProject`); both are renameable inline; `sources.updateSchema` now keeps the
source's input set in step with the schema (listing URL → one listing row, else the three product
URLs as detail rows). Scratch is an ordinary project. `createWithSchema` and `quickCreate` still
exist and are removed in phase 2 with the project-level field list.

Next: phase 2 (contract on the dataset, per-field certification), then 3 (Schema tab), 4 (Extract
tab), 5 (visual system), each as its own plan.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/handoff.md
git commit -m "docs: routes and shell phase recorded in CLAUDE.md and the handoff"
```

---

## Self-review

**Spec coverage for phase 1 (spec 12, item 1):** `/projects` prefix and redirects (Task 1, 2); nav and ops area (Task 2); rename procedures (Tasks 4, 5, 10); Scratch as a normal project (nothing to do: it is listed like any other by Task 8, and the seed still creates it); New project and Add website dialogs (Tasks 8, 9); naming rule (Tasks 4, 5, 7, 9). Spec 5.5's header (Task 10). Spec 3.1's `/projects/:project/output` (Task 2). Tabs are Schema / Overview / Runs / Settings in this phase; Extract replaces Overview in phase 4, and the Fields panel becomes editable in phase 2.

**Placeholder scan:** none.

**Type consistency:** `projects.create` returns `{ id, slug, name, datasetId }` (Task 4) and is consumed with those names in Tasks 5, 6, 8, 11. `sources.createInProject` returns `{ sourceId, projectSlug, sourceSlug }` (Task 5) and is consumed as such in Tasks 6, 9, 11. `siteNameFromUrl` (Task 7) is used in Task 9. `legacyTarget` (Task 1) is used in Task 2. Route ids in Tasks 8, 9, 10, 11 match Task 2.
