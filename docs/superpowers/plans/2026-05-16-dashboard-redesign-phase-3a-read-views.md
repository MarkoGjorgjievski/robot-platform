# Dashboard Redesign — Phase 3a: Read Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up read-only navigation across Projects → Datasets → Sources → Runs → Extractions. Build 12 page components (replacing Phase 1 placeholders), 1 new top-level route (`/projects`), and 6 new tRPC procedures to serve them. The DB is empty after the recent wipe, so every page will render empty states — that's expected; Phase 4 (Graduate) will populate real data.

**Architecture:** All reads via tRPC queries (`useQuery`); no mutations in this phase. Each page follows the same 4-state pattern: loading (Spinner) → error (ErrorBanner) → empty (helpful placeholder) → data (rendered content). The Source detail page uses sub-tab navigation (`Config | Inputs | Runs`) implemented as separate routes per spec Section 5. The `ResultsTable` component currently inlined in `sandbox-detail.tsx` is extracted to a shared component and reused on Run Detail. New backend procedures added incrementally to existing routers (no new router files).

**Tech Stack:** Unchanged. TanStack Router + Query + tRPC client on the dashboard; Drizzle on the backend.

**Important context for the implementer:**

- The user has authorized **auto-commit for Phase 3a**. Plan steps include `git commit` recipes; run them.
- DB state at start: 1 org (default), 1 project (sandbox), no datasets/sources/etc; 1 row preserved in domain_intelligence. Phase 3a's UI will render empty states across most pages.
- All Phase 1 placeholder routes still exist as `<Placeholder>` components — Phase 3a replaces each.
- The Sandbox flow (`/`, `/sandbox`, `/sandbox/$shortid`) is untouched. Sandbox sources have `dataset_id=null` and do NOT show up in Phase 3a's project navigation; they have their own UI from Phase 2.
- `psql`: `/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform`.
- Two long-running servers in dev: `pnpm --filter @robot/api-server dev` (`:4000`) and `pnpm --filter @robot/dashboard dev` (`:3456`).
- Phase 3a is **read-only**. No mutations beyond what already exists. Editing surfaces (schema editor, source bulk-create, browser config) are Phase 3b.

---

## File Structure

### Files created

| File | Responsibility |
|---|---|
| `packages/dashboard/src/routes/projects-list.tsx` | New `/projects` route — list of all non-sandbox projects |
| `packages/dashboard/src/components/sub-tab-nav.tsx` | Reusable Config/Inputs/Runs nav strip for Source detail pages |
| `packages/dashboard/src/components/results-table.tsx` | Extracted from sandbox-detail.tsx for reuse on Run Detail |
| `packages/dashboard/src/components/page-states.tsx` | Shared Spinner / ErrorBanner / Empty components (small consolidation) |

### Files modified

| File | Change |
|---|---|
| `packages/api/src/routers/projects.ts` | Add `getWithStats({ slug })` procedure |
| `packages/api/src/routers/sources.ts` | Add `listByProject({ projectSlug })` procedure |
| `packages/api/src/routers/runs.ts` | Add `getWithDetails({ id })` returning run + capture + extraction + source context |
| `packages/api/src/routers/domains.ts` | Add `listByProject({ projectSlug })` and `detailByProject({ projectSlug, domain })` procedures |
| `packages/api/src/routers/runs.test.ts` | **New** — input validation for new procedure |
| `packages/api/src/routers/domains.test.ts` | **New** — input validation for new procedures |
| `packages/dashboard/src/router.tsx` | Register `/projects` route; import 12 real route components |
| `packages/dashboard/src/components/layout.tsx` | Add "Projects" link to header nav |
| `packages/dashboard/src/routes/project-home.tsx` | Replace stub with real component |
| `packages/dashboard/src/routes/datasets-list.tsx` | Replace stub with real component |
| `packages/dashboard/src/routes/dataset-detail.tsx` | Replace stub with real component |
| `packages/dashboard/src/routes/sources-list.tsx` | Replace stub with real component |
| `packages/dashboard/src/routes/source-detail.tsx` | Replace stub: overview + sub-tab nav strip |
| `packages/dashboard/src/routes/source-config.tsx` | Replace stub with read-only config display |
| `packages/dashboard/src/routes/source-inputs.tsx` | Replace stub with read-only InputSet rows display |
| `packages/dashboard/src/routes/source-runs.tsx` | Replace stub with runs list |
| `packages/dashboard/src/routes/source-run-detail.tsx` | Replace stub with run + capture + extraction display |
| `packages/dashboard/src/routes/project-domains-list.tsx` | Replace stub with per-project domain list |
| `packages/dashboard/src/routes/project-domain-detail.tsx` | Replace stub with sources-touching-domain view |
| `packages/dashboard/src/routes/sandbox-detail.tsx` | Use shared `ResultsTable` component (no other change) |

### Files NOT touched

- `packages/dashboard/src/routes/inputsets-list.tsx`, `inputset-detail.tsx` — kept as Phase 1 placeholders; editing-heavy, deferred to Phase 3b
- `packages/dashboard/src/routes/domains-list.tsx`, `domain-detail.tsx` — global `/domains` library, deferred to Phase 5
- `packages/dashboard/src/routes/sandbox-index.tsx` — Phase 2 already filled this in
- `packages/dashboard/src/routes/landing.tsx` — Phase 2 already filled this in
- Any Sandbox-specific code or routes

---

## Task 1: New tRPC procedures

**Files:**
- Modify: `packages/api/src/routers/projects.ts`
- Modify: `packages/api/src/routers/sources.ts`
- Modify: `packages/api/src/routers/runs.ts`
- Modify: `packages/api/src/routers/domains.ts`
- Create: `packages/api/src/routers/runs.test.ts`
- Create: `packages/api/src/routers/domains.test.ts`

### Step 1: Add `projects.getWithStats` to `projects.ts`

Open `packages/api/src/routers/projects.ts`. After the existing `getBySlug` procedure (before `create`), add:

```ts
  getWithStats: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ projectId: projects.id })
        .from(projects)
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(eq(orgs.slug, input.orgSlug), eq(projects.slug, input.projectSlug)))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, row.projectId),
      });
      if (!project) return null;

      const [datasetCount, sourceCount, runCount, lastRun] = await Promise.all([
        ctx.db
          .select({ c: sql<number>`count(*)::int` })
          .from(datasets)
          .where(eq(datasets.projectId, project.id))
          .then((r) => r[0]?.c ?? 0),
        ctx.db
          .select({ c: sql<number>`count(${sources.id})::int` })
          .from(sources)
          .innerJoin(datasets, eq(sources.datasetId, datasets.id))
          .where(eq(datasets.projectId, project.id))
          .then((r) => r[0]?.c ?? 0),
        ctx.db
          .select({ c: sql<number>`count(${runs.id})::int` })
          .from(runs)
          .innerJoin(sources, eq(runs.sourceId, sources.id))
          .innerJoin(datasets, eq(sources.datasetId, datasets.id))
          .where(eq(datasets.projectId, project.id))
          .then((r) => r[0]?.c ?? 0),
        ctx.db
          .select({
            id: runs.id,
            sourceId: runs.sourceId,
            sourceSlug: sources.slug,
            status: runs.status,
            createdAt: runs.createdAt,
            completedAt: runs.completedAt,
            resultCount: runs.resultCount,
          })
          .from(runs)
          .innerJoin(sources, eq(runs.sourceId, sources.id))
          .innerJoin(datasets, eq(sources.datasetId, datasets.id))
          .where(eq(datasets.projectId, project.id))
          .orderBy(desc(runs.createdAt))
          .limit(1)
          .then((r) => r[0] ?? null),
      ]);

      return { project, datasetCount, sourceCount, runCount, lastRun };
    }),
```

Update the imports at the top of `projects.ts` to add anything missing. The current imports are:
```ts
import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { projects, orgs, datasets } from '@robot/db';
import { router, publicProcedure } from '../trpc';
```

Add `desc` and `sources`, `runs`:
```ts
import { z } from 'zod';
import { eq, sql, and, desc } from 'drizzle-orm';
import { projects, orgs, datasets, sources, runs } from '@robot/db';
import { router, publicProcedure } from '../trpc';
```

### Step 2: Add `sources.listByProject` to `sources.ts`

Open `packages/api/src/routers/sources.ts`. After the existing `getBySlug` procedure (before `create`), add:

```ts
  listByProject: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: sources.id,
          slug: sources.slug,
          name: sources.name,
          datasetId: sources.datasetId,
          datasetSlug: datasets.slug,
          datasetName: datasets.name,
          domainName: domains.name,
          urlTemplate: sources.urlTemplate,
          inputStrategy: sources.inputStrategy,
          listingMode: sources.listingMode,
          isActive: sources.isActive,
          isSandbox: sources.isSandbox,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
          eq(sources.isSandbox, false),
        ))
        .orderBy(sources.name);

      return results;
    }),
```

This excludes Sandbox sources (they have their own UI). Sandbox sources don't have a Dataset anyway, so the INNER JOIN on `datasets` already excludes them — the `isSandbox = false` is defensive.

### Step 3: Add `runs.getWithDetails` to `runs.ts`

Open `packages/api/src/routers/runs.ts`. After the existing `getById` procedure, add:

```ts
  getWithDetails: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.id),
        with: {
          source: {
            columns: { id: true, slug: true, name: true, urlTemplate: true, datasetId: true },
            with: {
              dataset: {
                columns: { id: true, slug: true, name: true, projectId: true },
                with: {
                  project: {
                    columns: { id: true, slug: true, name: true, orgId: true },
                    with: { org: { columns: { id: true, slug: true, name: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!run) return null;

      const [latestCapture, latestExtraction] = await Promise.all([
        ctx.db.query.captures.findFirst({
          where: eq(captures.runId, input.id),
          orderBy: [desc(captures.createdAt)],
        }),
        ctx.db.query.extractions.findFirst({
          where: eq(extractions.runId, input.id),
          orderBy: [desc(extractions.createdAt)],
        }),
      ]);

      return {
        run: {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          resultCount: run.resultCount,
          errorMessage: run.errorMessage,
          inputLabel: run.inputLabel,
          createdAt: run.createdAt,
        },
        source: run.source,
        capture: latestCapture ? {
          id: latestCapture.id,
          url: latestCapture.url,
          screenshotPath: latestCapture.screenshotPath,
        } : null,
        extraction: latestExtraction ? {
          data: latestExtraction.data,
          confidence: latestExtraction.confidence,
          rowCount: latestExtraction.rowCount,
          validationResult: latestExtraction.validationResult,
        } : null,
      };
    }),
```

Update imports at the top — currently:
```ts
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { runs } from '@robot/db';
```

Change to:
```ts
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { runs, captures, extractions } from '@robot/db';
```

### Step 4: Add `domains.listByProject` and `domains.detailByProject` to `domains.ts`

Open `packages/api/src/routers/domains.ts`. After the existing `update` procedure, add:

```ts
  listByProject: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      // Distinct domain hostnames from urlTemplate across the project's sources.
      // Sandbox sources excluded.
      const results = await ctx.db
        .selectDistinctOn([sql<string>`split_part(${sources.urlTemplate}, '/', 3)`], {
          hostname: sql<string>`split_part(${sources.urlTemplate}, '/', 3)`.as('hostname'),
          sourceCount: sql<number>`count(*) over (partition by split_part(${sources.urlTemplate}, '/', 3))::int`.as('source_count'),
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
          eq(sources.isSandbox, false),
        ));

      return results
        .filter((r) => r.hostname && r.hostname.length > 0)
        .map((r) => ({
          hostname: r.hostname.replace(/^www\./, ''),
          sourceCount: r.sourceCount,
        }));
    }),

  detailByProject: publicProcedure
    .input(z.object({
      orgSlug: z.string(),
      projectSlug: z.string(),
      domain: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      // Find sources in the project whose urlTemplate hostname matches the requested domain.
      const sourcesInDomain = await ctx.db
        .select({
          id: sources.id,
          slug: sources.slug,
          name: sources.name,
          urlTemplate: sources.urlTemplate,
          datasetSlug: datasets.slug,
          datasetName: datasets.name,
          inputStrategy: sources.inputStrategy,
          listingMode: sources.listingMode,
          createdAt: sources.createdAt,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
          eq(sources.isSandbox, false),
          sql`split_part(${sources.urlTemplate}, '/', 3) IN (${input.domain}, ${'www.' + input.domain})`,
        ));

      // Also pull domain intelligence cache info for this domain
      const intelligence = await ctx.db.query.domainIntelligence.findFirst({
        where: (di, { eq: dieq }) => dieq(di.domain, input.domain),
      });

      return {
        hostname: input.domain,
        sources: sourcesInDomain,
        intelligence: intelligence ? {
          pageType: intelligence.pageType,
          totalRuns: intelligence.totalRuns,
          successfulRuns: intelligence.successfulRuns,
          consecutiveFailures: intelligence.consecutiveFailures,
          lastUsedAt: intelligence.lastUsedAt,
          lastVerifiedAt: intelligence.lastVerifiedAt,
        } : null,
      };
    }),
```

Update imports at the top:
```ts
import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { domains, sources, datasets, projects, orgs } from '@robot/db';
import { router, publicProcedure } from '../trpc';
```

### Step 5: Add tests for the new procedures

Create `packages/api/src/routers/runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

function expectZodValidationError(err: unknown) {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

describe('runsRouter', () => {
  describe('getWithDetails input validation', () => {
    it('rejects missing id', async () => {
      try {
        await caller.runs.getWithDetails({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects non-uuid string', async () => {
      try {
        await caller.runs.getWithDetails({ id: 'not-a-uuid' });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns null for unknown run id', async () => {
      const result = await caller.runs.getWithDetails({ id: '00000000-0000-0000-0000-000000000000' });
      expect(result).toBeNull();
    });
  });

  describe('listBySource', () => {
    it('returns empty array for unknown sourceId', async () => {
      const result = await caller.runs.listBySource({ sourceId: '00000000-0000-0000-0000-000000000000' });
      expect(result).toEqual([]);
    });
  });
});
```

Create `packages/api/src/routers/domains.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

function expectZodValidationError(err: unknown) {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

describe('domainsRouter', () => {
  describe('listByProject input validation', () => {
    it('rejects empty input', async () => {
      try {
        await caller.domains.listByProject({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns empty array for unknown project', async () => {
      const result = await caller.domains.listByProject({ orgSlug: 'nope', projectSlug: 'nope' });
      expect(result).toEqual([]);
    });
  });

  describe('detailByProject input validation', () => {
    it('rejects missing domain', async () => {
      try {
        await caller.domains.detailByProject({ orgSlug: 'a', projectSlug: 'b' } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns empty sources for unknown project/domain', async () => {
      const result = await caller.domains.detailByProject({
        orgSlug: 'nope', projectSlug: 'nope', domain: 'example.com'
      });
      expect(result.sources).toEqual([]);
    });
  });
});
```

### Step 6: Type-check and run tests

```bash
cd packages/api && pnpm exec tsc --noEmit
pnpm --filter @robot/api exec vitest run
```

Both clean. Total tests should be 25 (8 scraper + 10 sandbox + 4 runs + 3 domains).

### Step 7: Commit

```bash
git add packages/api/src/routers/
git commit -m "feat(api): add read procedures for project home, source list, run details, project-domain views"
```

---

## Task 2: `/projects` list page + Layout nav

**Files:**
- Create: `packages/dashboard/src/routes/projects-list.tsx`
- Modify: `packages/dashboard/src/router.tsx`
- Modify: `packages/dashboard/src/components/layout.tsx`
- Create: `packages/dashboard/src/components/page-states.tsx`

### Step 1: Create the shared page-state components

Create `packages/dashboard/src/components/page-states.tsx`:

```tsx
import { Loader2, AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, dismiss }: { message: string; dismiss?: () => void }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {dismiss && (
        <button onClick={dismiss} className="text-xs underline">dismiss</button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mt-8 rounded-md border border-dashed p-12 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function NotFound({ what }: { what: string }) {
  return <ErrorBanner message={`${what} not found.`} />;
}
```

### Step 2: Create the projects-list page

Create `packages/dashboard/src/routes/projects-list.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { Folder, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';

export default function ProjectsList() {
  const listQuery = trpc.projects.list.useQuery();

  if (listQuery.isLoading) return <Spinner label="Loading projects..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  // Filter out Sandbox project — it has its own UI at /sandbox
  const projects = (listQuery.data ?? []).filter((p) => p.slug !== 'sandbox');

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Projects</h1>
      <p className="mt-1 text-sm text-gray-600">
        Customer engagements. {projects.length} {projects.length === 1 ? 'project' : 'projects'}.
      </p>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Graduate a Sandbox source to create your first project (coming in Phase 4)."
          action={
            <Link to="/sandbox" className="text-sm font-medium text-gray-900 underline">
              Go to Sandbox
            </Link>
          }
        />
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to="/p/$project"
                params={{ project: p.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Folder className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  {p.description && (
                    <div className="truncate text-xs text-gray-500">{p.description}</div>
                  )}
                </div>
                <span className="text-xs text-gray-400">{p.datasetCount} datasets</span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Step 3: Register `/projects` route

Open `packages/dashboard/src/router.tsx`. Add to imports:
```tsx
import ProjectsList from './routes/projects-list';
```

Add a new route definition near `indexRoute`:
```tsx
const projectsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsList,
});
```

Add `projectsListRoute` to the `rootRoute.addChildren([...])` array.

### Step 4: Add "Projects" link to Layout nav

Open `packages/dashboard/src/components/layout.tsx`. The current nav has Sandbox + Domains links. Add Projects between them:

```tsx
<nav className="flex gap-4 text-gray-600">
  <Link to="/projects" className="hover:text-gray-900">Projects</Link>
  <Link to="/sandbox" className="hover:text-gray-900">Sandbox</Link>
  <Link to="/domains" className="hover:text-gray-900">Domains</Link>
</nav>
```

### Step 5: Type-check + smoke

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
curl -s -o /dev/null -w '/projects: %{http_code}\n' http://localhost:3456/projects
curl -s -G --data-urlencode 'input={"json":null}' 'http://localhost:4000/trpc/projects.list' | head -c 300
kill $API_PID $DASH_PID 2>/dev/null
```

Both checks should return 200. `projects.list` returns the Sandbox project (will be filtered out client-side).

### Step 6: Commit

```bash
git add packages/dashboard/
git commit -m "feat(dashboard): /projects list page + Projects nav link + shared page-state components"
```

---

## Task 3: Project home (`/p/{project}`)

**Files:**
- Modify: `packages/dashboard/src/routes/project-home.tsx`

### Step 1: Rewrite project-home.tsx

Replace the entire contents of `packages/dashboard/src/routes/project-home.tsx` with:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Folder, Database, Layers, Activity, Globe } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';

// For now, all real projects belong to the 'default' org. Phase 3b/v3 will
// handle multi-org routing.
const DEFAULT_ORG_SLUG = 'default';

export default function ProjectHome() {
  const { project: projectSlug } = useParams({ from: '/p/$project' });
  const statsQuery = trpc.projects.getWithStats.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (statsQuery.isLoading) return <Spinner label="Loading project..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;

  const { project, datasetCount, sourceCount, runCount, lastRun } = statsQuery.data;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Folder className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
      </div>
      {project.description && (
        <p className="mt-1 text-sm text-gray-600">{project.description}</p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<Database className="h-4 w-4" />} label="Datasets" value={datasetCount} link={{ to: '/p/$project/datasets', params: { project: projectSlug } }} />
        <StatCard icon={<Layers className="h-4 w-4" />} label="Sources" value={sourceCount} link={{ to: '/p/$project/sources', params: { project: projectSlug } }} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Runs" value={runCount} />
        <StatCard icon={<Globe className="h-4 w-4" />} label="Domains" link={{ to: '/p/$project/domains', params: { project: projectSlug } }} />
      </div>

      {lastRun ? (
        <div className="mt-6 rounded-md border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Last run</div>
          <Link
            to="/p/$project/sources/$source/runs/$run"
            params={{ project: projectSlug, source: lastRun.sourceSlug ?? '', run: lastRun.id }}
            className="mt-1 flex items-center gap-2 text-sm hover:underline"
          >
            <RunStatusDot status={lastRun.status} />
            <span className="font-medium">{lastRun.status}</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-500">{lastRun.resultCount ?? 0} rows</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-400">{formatDate(new Date(lastRun.createdAt))}</span>
          </Link>
        </div>
      ) : (
        <EmptyState
          title="No activity yet"
          description="Datasets, sources, and runs will appear here once they're created."
        />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  link,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  link?: { to: string; params: Record<string, string> };
}) {
  const content = (
    <div className="rounded-md border p-3 transition-colors hover:bg-gray-50">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {icon}
        <span>{label}</span>
      </div>
      {value !== undefined && (
        <div className="mt-1 text-xl font-semibold">{value}</div>
      )}
    </div>
  );
  if (link) {
    return <Link to={link.to as never} params={link.params as never}>{content}</Link>;
  }
  return content;
}

function RunStatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
    : status === 'running' ? 'bg-amber-500 animate-pulse'
    : 'bg-gray-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(diffMs / 3_600_000);
  const d = Math.floor(diffMs / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

### Step 2: Type-check + smoke

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

The Project home only loads for existing projects. The Sandbox project exists but is filtered out of the projects list — direct navigation to `/p/sandbox` would technically work (since `sandbox` is a valid slug). For Phase 3a, this is acceptable — Phase 4 graduation creates the first real project.

### Step 3: Commit

```bash
git add packages/dashboard/src/routes/project-home.tsx
git commit -m "feat(dashboard): project home with dataset/source/run stats and last activity"
```

---

## Task 4: Datasets list + Dataset detail

**Files:**
- Modify: `packages/dashboard/src/routes/datasets-list.tsx`
- Modify: `packages/dashboard/src/routes/dataset-detail.tsx`

### Step 1: Rewrite datasets-list.tsx

Replace contents of `packages/dashboard/src/routes/datasets-list.tsx` with:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Database, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

export default function DatasetsList() {
  const { project: projectSlug } = useParams({ from: '/p/$project/datasets' });

  // Need the project id; use getWithStats which also returns the project.
  const statsQuery = trpc.projects.getWithStats.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  const listQuery = trpc.datasets.listByProject.useQuery(
    { projectId: statsQuery.data?.project.id ?? '' },
    { enabled: !!statsQuery.data?.project.id },
  );

  if (statsQuery.isLoading || listQuery.isLoading) return <Spinner label="Loading datasets..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const datasets = listQuery.data ?? [];

  return (
    <div>
      <Breadcrumbs projectSlug={projectSlug} projectName={statsQuery.data.project.name} />
      <h1 className="mt-2 text-xl font-bold tracking-tight">Datasets</h1>
      <p className="mt-1 text-sm text-gray-600">
        Schemas + the sources that feed them. {datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}.
      </p>

      {datasets.length === 0 ? (
        <EmptyState
          title="No datasets yet"
          description="Datasets group sources by their data shape. They're created during Sandbox source graduation (coming in Phase 4)."
        />
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {datasets.map((d) => (
            <li key={d.id}>
              <Link
                to="/p/$project/datasets/$dataset"
                params={{ project: projectSlug, dataset: d.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Database className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  {d.description && (
                    <div className="truncate text-xs text-gray-500">{d.description}</div>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {d.sourceCount} {d.sourceCount === 1 ? 'source' : 'sources'}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Breadcrumbs({ projectSlug, projectName }: { projectSlug: string; projectName: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <Link to="/projects" className="hover:text-gray-700">Projects</Link>
      <span>/</span>
      <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
        {projectName}
      </Link>
      <span>/</span>
      <span className="text-gray-700">Datasets</span>
    </div>
  );
}
```

### Step 2: Rewrite dataset-detail.tsx

Replace contents of `packages/dashboard/src/routes/dataset-detail.tsx` with:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
};

export default function DatasetDetail() {
  const { project: projectSlug, dataset: datasetSlug } = useParams({
    from: '/p/$project/datasets/$dataset',
  });

  const detailQuery = trpc.datasets.getBySlug.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
    datasetSlug,
  });

  if (detailQuery.isLoading) return <Spinner label="Loading dataset..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Dataset "${datasetSlug}"`} />;

  const dataset = detailQuery.data;
  const schema = (Array.isArray(dataset.schema) ? dataset.schema : []) as SchemaField[];
  const sources = (dataset as { sources?: Array<{ id: string; slug: string; name: string }> }).sources ?? [];

  return (
    <div>
      <Breadcrumbs projectSlug={projectSlug} datasetName={dataset.name} />
      <h1 className="mt-2 text-xl font-bold tracking-tight">{dataset.name}</h1>
      {dataset.description && (
        <p className="mt-1 text-sm text-gray-600">{dataset.description}</p>
      )}

      <h2 className="mt-6 text-sm font-semibold text-gray-700">Schema</h2>
      {schema.length === 0 ? (
        <EmptyState
          title="No fields defined yet"
          description="The schema editor with field-source classification is coming in Phase 3b."
        />
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="py-2 text-left font-medium text-gray-600">Field</th>
              <th className="py-2 text-left font-medium text-gray-600">Type</th>
              <th className="py-2 text-left font-medium text-gray-600">Required</th>
              <th className="py-2 text-left font-medium text-gray-600">Description</th>
            </tr>
          </thead>
          <tbody>
            {schema.map((f) => (
              <tr key={f.name} className="border-b last:border-b-0">
                <td className="py-2 font-mono text-xs">{f.name}</td>
                <td className="py-2 text-xs text-gray-600">{f.type}</td>
                <td className="py-2 text-xs text-gray-500">{f.required ? 'yes' : 'no'}</td>
                <td className="py-2 text-xs text-gray-500">{f.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-sm font-semibold text-gray-700">
        Sources ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Sources for this dataset will appear here when they're created. (Bulk-create UX coming in Phase 3b.)"
        />
      ) : (
        <ul className="mt-2 divide-y rounded-md border">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Breadcrumbs({ projectSlug, datasetName }: { projectSlug: string; datasetName: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <Link to="/projects" className="hover:text-gray-700">Projects</Link>
      <span>/</span>
      <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
        Project
      </Link>
      <span>/</span>
      <Link to="/p/$project/datasets" params={{ project: projectSlug }} className="hover:text-gray-700">
        Datasets
      </Link>
      <span>/</span>
      <span className="text-gray-700">{datasetName}</span>
    </div>
  );
}
```

### Step 3: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

### Step 4: Commit

```bash
git add packages/dashboard/src/routes/datasets-list.tsx packages/dashboard/src/routes/dataset-detail.tsx
git commit -m "feat(dashboard): datasets list + dataset detail with schema viewer"
```

---

## Task 5: Sources list + Source overview with sub-tab nav

**Files:**
- Modify: `packages/dashboard/src/routes/sources-list.tsx`
- Modify: `packages/dashboard/src/routes/source-detail.tsx`
- Create: `packages/dashboard/src/components/sub-tab-nav.tsx`

### Step 1: Create the SubTabNav component

Create `packages/dashboard/src/components/sub-tab-nav.tsx`:

```tsx
import { Link } from '@tanstack/react-router';

type Tab = {
  label: string;
  to: string;
  params: Record<string, string>;
};

export function SubTabNav({ tabs, activeTo }: { tabs: Tab[]; activeTo: string }) {
  return (
    <div className="mt-4 border-b">
      <nav className="flex gap-4">
        {tabs.map((tab) => {
          const isActive = tab.to === activeTo;
          return (
            <Link
              key={tab.to}
              to={tab.to as never}
              params={tab.params as never}
              className={`-mb-px border-b-2 px-1 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-gray-900 font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

### Step 2: Rewrite sources-list.tsx

Replace contents of `packages/dashboard/src/routes/sources-list.tsx` with:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

export default function SourcesList() {
  const { project: projectSlug } = useParams({ from: '/p/$project/sources' });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading sources..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const sources = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          Project
        </Link>
        <span>/</span>
        <span className="text-gray-700">Sources</span>
      </div>
      <h1 className="mt-2 text-xl font-bold tracking-tight">Sources</h1>
      <p className="mt-1 text-sm text-gray-600">
        All sources in this project. {sources.length} {sources.length === 1 ? 'source' : 'sources'}.
      </p>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Sources appear here when they're graduated from Sandbox or created in a Dataset (coming in Phase 3b/4)."
        />
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.datasetSlug ? `${s.datasetName} · ` : ''}{s.urlTemplate}
                  </div>
                </div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-600">
                  {s.inputStrategy ?? 'unknown'}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Step 3: Rewrite source-detail.tsx (overview + sub-tab nav)

Replace contents of `packages/dashboard/src/routes/source-detail.tsx` with:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Layers, ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { SubTabNav } from '../components/sub-tab-nav';

const DEFAULT_ORG_SLUG = 'default';

export default function SourceDetail() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source',
  });

  const sourceQuery = trpc.sources.getBySlug.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
    collectionSlug: 'placeholder', // Existing procedure signature; needs dataset slug
    sourceSlug,
  } as never, { enabled: false }); // Disabled — we use a different query below

  // For Phase 3a, query via sources.listByProject and pick the matching one.
  // (The existing sources.getBySlug requires a datasetSlug we don't have here.
  // Wiring an alternative read procedure is part of Task 1's scope iteration.)
  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          Project
        </Link>
        <span>/</span>
        <Link to="/p/$project/sources" params={{ project: projectSlug }} className="hover:text-gray-700">
          Sources
        </Link>
        <span>/</span>
        <span className="text-gray-700">{source.name}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Layers className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-bold tracking-tight">{source.name}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-600">
          {source.inputStrategy ?? 'unknown'}
        </span>
        {source.urlTemplate && (
          <a
            href={source.urlTemplate}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 truncate font-mono text-xs text-gray-500 hover:text-gray-700"
          >
            <span className="truncate max-w-md">{source.urlTemplate}</span>
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        )}
      </div>

      <SubTabNav
        activeTo="/p/$project/sources/$source"
        tabs={[
          { label: 'Overview', to: '/p/$project/sources/$source', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Config', to: '/p/$project/sources/$source/config', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Inputs', to: '/p/$project/sources/$source/inputs', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Runs', to: '/p/$project/sources/$source/runs', params: { project: projectSlug, source: sourceSlug } },
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
        <Stat label="Dataset" value={source.datasetName ?? '—'} />
        <Stat label="Strategy" value={source.inputStrategy ?? '—'} />
        <Stat label="Mode" value={source.listingMode ?? '—'} />
        <Stat label="Domain" value={source.domainName ?? '—'} />
        <Stat label="Active" value={source.isActive ? 'yes' : 'no'} />
        <Stat label="Created" value={new Date(source.createdAt).toLocaleDateString()} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
```

Note: the existing `sources.getBySlug` procedure requires `collectionSlug` (now `datasetSlug` after Phase 0 rename). For Phase 3a's source-detail page, we don't have a dataset slug in the URL — only project + source slug. The simplest path forward is to use `sources.listByProject` and find the matching source client-side. This works correctly for any project with ≤50 sources (the procedure's limit, which we haven't set yet but the data volumes are small for now). Adding a dedicated `sources.getByProjectAndSourceSlug` procedure is a Phase 3b consideration.

### Step 4: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

### Step 5: Commit

```bash
git add packages/dashboard/src/routes/sources-list.tsx packages/dashboard/src/routes/source-detail.tsx packages/dashboard/src/components/sub-tab-nav.tsx
git commit -m "feat(dashboard): sources list + source detail overview with sub-tab nav"
```

---

## Task 6: Source sub-tabs (config, inputs, runs)

**Files:**
- Modify: `packages/dashboard/src/routes/source-config.tsx`
- Modify: `packages/dashboard/src/routes/source-inputs.tsx`
- Modify: `packages/dashboard/src/routes/source-runs.tsx`

Each sub-tab shows read-only data for a specific facet of the source.

### Step 1: source-config.tsx

Replace contents of `packages/dashboard/src/routes/source-config.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

export default function SourceConfig() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source/config',
  });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Configuration</h2>
      <p className="mt-1 text-xs text-gray-500">Read-only. Editing comes in Phase 3b.</p>

      <dl className="mt-4 divide-y rounded-md border text-sm">
        <Row label="Strategy" value={source.inputStrategy ?? '—'} />
        <Row label="URL template" value={source.urlTemplate ?? '—'} mono />
        <Row label="Listing mode" value={source.listingMode ?? '—'} />
        <Row label="Dataset" value={source.datasetName ?? '—'} />
        <Row label="Domain" value={source.domainName ?? '—'} />
        <Row label="Active" value={source.isActive ? 'yes' : 'no'} />
      </dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[160px_1fr] px-4 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : 'text-sm'}>{value}</dd>
    </div>
  );
}
```

### Step 2: source-inputs.tsx

For inputs, we need the linked InputSet's rows. There isn't a direct procedure for that yet, so use the existing `inputs.ts` router pattern. Looking at the current schema, the `inputSets` table has `rows` as jsonb. We'll need a procedure to fetch the InputSet by source.

Actually, `sources.listByProject` doesn't include the InputSet. We need either:
- A new procedure `inputSets.getBySourceSlug({ orgSlug, projectSlug, sourceSlug })`, or
- For Phase 3a, render an empty state with a "comes in Phase 3b" message

For simplicity in Phase 3a, render the empty state. The Inputs tab existing is enough; full data wiring is Phase 3b alongside editing.

Replace contents of `packages/dashboard/src/routes/source-inputs.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { EmptyState } from '../components/page-states';

export default function SourceInputs() {
  const { source: sourceSlug } = useParams({ from: '/p/$project/sources/$source/inputs' });
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Inputs</h2>
      <p className="mt-1 text-xs text-gray-500">Values fed to this source's URL template. Source: <span className="font-mono">{sourceSlug}</span></p>
      <EmptyState
        title="InputSet display coming in Phase 3b"
        description="The full InputSet management UI (paste CSV, edit rows, swap InputSets) is part of the Phase 3b editing surfaces."
      />
    </div>
  );
}
```

### Step 3: source-runs.tsx

Replace contents of `packages/dashboard/src/routes/source-runs.tsx`:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Activity, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

export default function SourceRuns() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source/runs',
  });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);

  const runsQuery = trpc.runs.listBySource.useQuery(
    { sourceId: source?.id ?? '' },
    { enabled: !!source?.id },
  );

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;
  if (runsQuery.isLoading) return <Spinner label="Loading runs..." />;
  if (runsQuery.isError) return <ErrorBanner message={runsQuery.error.message} />;

  const runs = runsQuery.data ?? [];

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Runs ({runs.length})</h2>

      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Each extraction creates a Run row. Click 'Extract' on a graduated source to create the first one."
        />
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                to="/p/$project/sources/$source/runs/$run"
                params={{ project: projectSlug, source: sourceSlug, run: r.id }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <RunStatusDot status={r.status} />
                <Activity className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.status}
                    {r.resultCount != null && ` · ${r.resultCount} rows`}
                  </div>
                  <div className="truncate font-mono text-[11px] text-gray-500">
                    {r.id}
                  </div>
                </div>
                <span className="text-xs text-gray-400">
                  {formatDate(new Date(r.createdAt))}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunStatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
    : status === 'running' ? 'bg-amber-500 animate-pulse'
    : 'bg-gray-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function formatDate(date: Date): string {
  const now = new Date();
  const m = Math.floor((now.getTime() - date.getTime()) / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

### Step 4: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

### Step 5: Commit

```bash
git add packages/dashboard/src/routes/source-config.tsx packages/dashboard/src/routes/source-inputs.tsx packages/dashboard/src/routes/source-runs.tsx
git commit -m "feat(dashboard): source config / inputs / runs sub-tab pages"
```

---

## Task 7: Run detail + extracted ResultsTable

**Files:**
- Create: `packages/dashboard/src/components/results-table.tsx`
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`
- Modify: `packages/dashboard/src/routes/sandbox-detail.tsx` (use shared component)

### Step 1: Extract ResultsTable from sandbox-detail.tsx

Open `packages/dashboard/src/routes/sandbox-detail.tsx`. Find the inline `ResultsTable` function (near the bottom of the file). Copy its full body. Create `packages/dashboard/src/components/results-table.tsx`:

```tsx
type SchemaField = {
  name: string;
  type: string;
  description?: string;
  source?: string;
  api_path?: string;
  tier?: 'requested' | 'discovered';
  example_value?: string;
  enabled?: boolean;
};

export function ResultsTable({
  data,
  confidence,
  fields,
}: {
  data: Record<string, unknown>[];
  confidence: number | null;
  fields: SchemaField[];
}) {
  const fieldNames = fields.filter((f) => f.enabled !== false).map((f) => f.name);
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <span className="font-medium">Extraction results</span>
        {confidence != null && (
          <span className="text-xs text-gray-600">Confidence: {confidence}%</span>
        )}
      </div>
      {data.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-gray-500">
          No rows extracted.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                {fieldNames.map((name) => (
                  <th key={name} className="py-2 pr-4 text-left font-mono text-xs font-medium text-gray-600">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  {fieldNames.map((name) => (
                    <td key={name} className="py-2 pr-4 align-top font-mono text-xs">
                      {row[name] != null ? (
                        <span className="block max-w-[300px] truncate" title={String(row[name])}>
                          {String(row[name])}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 100 && (
            <p className="mt-2 text-xs text-gray-500">Showing 100 of {data.length} rows</p>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 2: Update sandbox-detail.tsx to import the shared component

In `packages/dashboard/src/routes/sandbox-detail.tsx`:

1. Remove the entire inline `function ResultsTable(...)` at the bottom (delete that whole function block).
2. Remove `CheckCircle2` from the lucide-react import if it was only used there (verify by grep — it's used in the in-file ResultsTable's "Extraction complete" heading, which we're moving out; the shared component above doesn't use it).
3. Add to imports:
```tsx
import { ResultsTable } from '../components/results-table';
```

Then verify the file still type-checks. The page's usage `<ResultsTable data={...} confidence={...} fields={...} />` was already compatible with the shared component's signature.

### Step 3: Rewrite source-run-detail.tsx

Replace contents of `packages/dashboard/src/routes/source-run-detail.tsx`:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Activity, ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { API_URL } from '../lib/api-url';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { ResultsTable } from '../components/results-table';

export default function SourceRunDetail() {
  const { project: projectSlug, source: sourceSlug, run: runId } = useParams({
    from: '/p/$project/sources/$source/runs/$run',
  });

  const detailQuery = trpc.runs.getWithDetails.useQuery({ id: runId });

  if (detailQuery.isLoading) return <Spinner label="Loading run..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Run "${runId}"`} />;

  const { run, source, capture, extraction } = detailQuery.data;
  const data = (Array.isArray(extraction?.data) ? extraction.data : []) as Record<string, unknown>[];
  // Pull field shape from the source's stored selectors if available — best-effort
  const fields = ((source as { selectorsJson?: { fields?: unknown[] } } | null)?.selectorsJson?.fields ?? []) as Array<{ name: string; type: string; enabled?: boolean }>;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">Project</Link>
        <span>/</span>
        <Link to="/p/$project/sources" params={{ project: projectSlug }} className="hover:text-gray-700">Sources</Link>
        <span>/</span>
        <Link to="/p/$project/sources/$source" params={{ project: projectSlug, source: sourceSlug }} className="hover:text-gray-700">
          {source?.name ?? sourceSlug}
        </Link>
        <span>/</span>
        <Link to="/p/$project/sources/$source/runs" params={{ project: projectSlug, source: sourceSlug }} className="hover:text-gray-700">Runs</Link>
        <span>/</span>
        <span className="text-gray-700 font-mono">{runId.slice(0, 8)}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Activity className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-bold tracking-tight">Run · {run.status}</h1>
        <RunStatusBadge status={run.status} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Stat label="Status" value={run.status} />
        <Stat label="Started" value={run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'} />
        <Stat label="Completed" value={run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'} />
        <Stat label="Rows" value={String(run.resultCount ?? 0)} />
      </dl>

      {run.errorMessage && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <div className="text-xs font-medium uppercase">Error</div>
          <div className="mt-1 font-mono">{run.errorMessage}</div>
        </div>
      )}

      {capture?.screenshotPath && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700">Capture screenshot</h2>
          <img
            src={capture.screenshotPath.startsWith('http') ? capture.screenshotPath : `${API_URL}${capture.screenshotPath}`}
            alt="Captured page"
            className="mt-2 w-full max-w-md rounded border"
          />
        </div>
      )}

      {capture?.url && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700">URL</h2>
          <a
            href={capture.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1 font-mono text-xs text-gray-600 hover:text-gray-900"
          >
            {capture.url}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <ResultsTable
        data={data}
        confidence={extraction?.confidence ?? null}
        fields={fields}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-emerald-100 text-emerald-700'
    : status === 'failed' ? 'bg-red-100 text-red-700'
    : status === 'running' ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-700';
  return <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${cls}`}>{status}</span>;
}
```

### Step 4: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

### Step 5: Commit

```bash
git add packages/dashboard/src/components/results-table.tsx packages/dashboard/src/routes/source-run-detail.tsx packages/dashboard/src/routes/sandbox-detail.tsx
git commit -m "feat(dashboard): run detail page; extract ResultsTable to shared component"
```

---

## Task 8: Domain views (per-project)

**Files:**
- Modify: `packages/dashboard/src/routes/project-domains-list.tsx`
- Modify: `packages/dashboard/src/routes/project-domain-detail.tsx`

### Step 1: project-domains-list.tsx

Replace contents:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

export default function ProjectDomainsList() {
  const { project: projectSlug } = useParams({ from: '/p/$project/domains' });
  const listQuery = trpc.domains.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading domains..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const domains = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">Project</Link>
        <span>/</span>
        <span className="text-gray-700">Domains</span>
      </div>
      <h1 className="mt-2 text-xl font-bold tracking-tight">Domains in this project</h1>
      <p className="mt-1 text-sm text-gray-600">
        Distinct hostnames touched by this project's sources. Useful when fixing a site that affects multiple sources.
      </p>

      {domains.length === 0 ? (
        <EmptyState
          title="No domains yet"
          description="As sources are added to this project, their domains appear here."
        />
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {domains.map((d) => (
            <li key={d.hostname}>
              <Link
                to="/p/$project/domains/$domain"
                params={{ project: projectSlug, domain: d.hostname }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Globe className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">{d.hostname}</div>
                </div>
                <span className="text-xs text-gray-400">
                  {d.sourceCount} {d.sourceCount === 1 ? 'source' : 'sources'}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Step 2: project-domain-detail.tsx

Replace contents:

```tsx
import { useParams, Link } from '@tanstack/react-router';
import { Globe, Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

export default function ProjectDomainDetail() {
  const { project: projectSlug, domain } = useParams({
    from: '/p/$project/domains/$domain',
  });
  const detailQuery = trpc.domains.detailByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
    domain,
  });

  if (detailQuery.isLoading) return <Spinner label="Loading domain..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Domain "${domain}"`} />;

  const { sources, intelligence } = detailQuery.data;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">Project</Link>
        <span>/</span>
        <Link to="/p/$project/domains" params={{ project: projectSlug }} className="hover:text-gray-700">Domains</Link>
        <span>/</span>
        <span className="font-mono text-gray-700">{domain}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Globe className="h-5 w-5 text-gray-400" />
        <h1 className="font-mono text-xl font-bold tracking-tight">{domain}</h1>
      </div>

      {intelligence && (
        <div className="mt-6 rounded-md border p-4">
          <h2 className="text-sm font-semibold text-gray-700">Cached intelligence</h2>
          <p className="mt-1 text-xs text-gray-500">
            Cross-customer knowledge accumulated for this domain.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="Page type" value={intelligence.pageType} />
            <Stat label="Runs (total)" value={String(intelligence.totalRuns)} />
            <Stat label="Successful" value={String(intelligence.successfulRuns)} />
            <Stat label="Consecutive failures" value={String(intelligence.consecutiveFailures)} />
          </dl>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold text-gray-700">
        Sources in this project touching {domain} ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <EmptyState
          title="No sources hit this domain in this project"
          description="If you see this on a domain page you navigated to, the project's sources changed since the listing was generated."
        />
      ) : (
        <ul className="mt-2 divide-y rounded-md border">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.datasetName} · {s.urlTemplate}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
```

### Step 3: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

### Step 4: Commit

```bash
git add packages/dashboard/src/routes/project-domains-list.tsx packages/dashboard/src/routes/project-domain-detail.tsx
git commit -m "feat(dashboard): per-project domain list + domain detail with intelligence stats"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only).

### Step 1: Typecheck all packages

```bash
cd /Users/marko/Documents/robot-platform
pnpm --filter @robot/db exec tsc --noEmit
pnpm --filter @robot/api exec tsc --noEmit
pnpm --filter @robot/api-server exec tsc --noEmit
pnpm --filter @robot/dashboard exec tsc --noEmit
pnpm --filter @robot/agent exec tsc --noEmit
pnpm --filter @robot/browser exec tsc --noEmit
pnpm --filter @robot/scraper exec tsc --noEmit
```

All 7 clean.

### Step 2: Run all test suites

```bash
pnpm --filter @robot/db exec vitest run
pnpm --filter @robot/api exec vitest run
pnpm --filter @robot/api-server exec vitest run
pnpm --filter @robot/scraper test
pnpm --filter @robot/browser test
```

Expected counts:
- `@robot/db`: 10
- `@robot/api`: 25 (8 scraper + 10 sandbox + 4 runs + 3 domains)
- `@robot/api-server`: 5
- `@robot/scraper`: 54
- `@robot/browser`: 9

Total: ~103 tests.

### Step 3: Start both servers

```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
```

### Step 4: Smoke-test all new routes

Every route should return HTTP 200 (Vite SPA mode serves index.html for every path):

```bash
for path in \
  "/projects" \
  "/p/sandbox" \
  "/p/sandbox/datasets" \
  "/p/sandbox/datasets/anything" \
  "/p/sandbox/sources" \
  "/p/sandbox/sources/foo" \
  "/p/sandbox/sources/foo/config" \
  "/p/sandbox/sources/foo/inputs" \
  "/p/sandbox/sources/foo/runs" \
  "/p/sandbox/sources/foo/runs/00000000-0000-0000-0000-000000000000" \
  "/p/sandbox/domains" \
  "/p/sandbox/domains/example.com"; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3456${path}")
  echo "${status} ${path}"
done
```

All should be 200. (The actual page content for non-existent projects/sources/runs will be the appropriate NotFound or EmptyState; this just verifies the routes resolve.)

### Step 5: Test new tRPC procedures end-to-end

```bash
echo "--- projects.getWithStats (sandbox) ---"
curl -s -G --data-urlencode 'input={"json":{"orgSlug":"default","projectSlug":"sandbox"}}' 'http://localhost:4000/trpc/projects.getWithStats' | head -c 400

echo ""
echo "--- sources.listByProject ---"
curl -s -G --data-urlencode 'input={"json":{"orgSlug":"default","projectSlug":"sandbox"}}' 'http://localhost:4000/trpc/sources.listByProject' | head -c 400

echo ""
echo "--- domains.listByProject ---"
curl -s -G --data-urlencode 'input={"json":{"orgSlug":"default","projectSlug":"sandbox"}}' 'http://localhost:4000/trpc/domains.listByProject' | head -c 400

echo ""
echo "--- runs.getWithDetails (unknown id → null) ---"
curl -s -G --data-urlencode 'input={"json":{"id":"00000000-0000-0000-0000-000000000000"}}' 'http://localhost:4000/trpc/runs.getWithDetails' | head -c 200
```

Expected: all 200 responses. The Sandbox project returns datasetCount=0, sourceCount=0, runCount=0, lastRun=null. listByProject and listByProject (domains) return empty arrays. getWithDetails for unknown id returns null in the `data.json` body.

### Step 6: Stop servers

```bash
kill $API_PID $DASH_PID 2>/dev/null
```

### Step 7: Final commit if anything was left over

```bash
git status
```

If clean, no commit needed. Otherwise stage + commit a final cleanup.

---

## Wrap-up checks

- [ ] All 7 packages typecheck clean.
- [ ] ~103 tests pass (+9 from Phase 2: 4 new runs tests + 3 new domains tests + 2 new sandbox tests already counted).
- [ ] 12 stub routes replaced with real components.
- [ ] `/projects` is a new working route.
- [ ] Layout nav has "Projects" link.
- [ ] `ResultsTable` extracted to a shared component, used by both sandbox-detail and source-run-detail.
- [ ] Sandbox flow (paste-and-go → wizard → results) still works.
- [ ] No new console errors during navigation.
- [ ] Empty states render reasonably across all pages (DB is mostly empty for Phase 3a).

---

## Notes for the implementer

- **DB is empty.** Most pages render empty states. That's expected. Phase 4 (Graduate) will populate real data; Phase 3a is the wiring.
- **The DEFAULT_ORG_SLUG = 'default' constant** is hardcoded across pages. Multi-org routing comes in v3. For now, the seed creates a single 'default' org and that's where everything lives.
- **`source-inputs.tsx` is intentionally a placeholder for Phase 3a.** Full InputSet display is editing-heavy; defer to Phase 3b.
- **`/domains` (global library)** is still a Phase 1 placeholder. That's Phase 5. The Phase 3a Domain views are per-PROJECT (`/p/{project}/domains/*`).
- **Existing `sources.getBySlug`** requires a `collectionSlug` parameter (legacy from before `dataset` rename). Phase 3a works around this by using `sources.listByProject` and filtering client-side. Adding a `sources.getByProjectAndSlug` procedure is a Phase 3b consideration.
- **`runs.getById` still exists** and includes the (legacy, now empty) extractor relation. `runs.getWithDetails` is the new procedure Phase 3a uses. Don't delete `runs.getById` — keep both.
- **No new DB schema changes.** Phase 0's schema covers everything Phase 3a reads.
- **Out of scope:** all editing, Graduate flow, schema field-source classification UI, source bulk-create, browser config, global Domain library, Inputs editing.
