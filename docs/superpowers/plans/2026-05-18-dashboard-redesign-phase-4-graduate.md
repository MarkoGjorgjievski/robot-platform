# Dashboard Redesign — Phase 4: Graduate Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Graduate flow that moves a Sandbox Source into a real Project + Dataset (creating either or both as needed). After this lands, a user can paste a URL → analyze → extract → graduate → see the source in `/p/{project}/sources/{source}` with full history (Runs/Captures/Extractions) intact.

**Architecture:** Single transactional `sandbox.graduate` tRPC mutation. Inline form on the Sandbox wizard page (`/sandbox/{slug}`) — no modal/dialog primitive needed. Backend uses Drizzle transactions to insert Project (if new) + Dataset (if new) + update Source + optionally promote inline InputSet, all-or-nothing. Schema for new Dataset auto-derives from the Sandbox source's `selectors_json.fields` with `source: 'detail'` defaulted per field; refinement happens in Phase 3b's schema editor. After success, dashboard redirects to `/p/{projectSlug}/sources/{sourceSlug}` — Phase 3a's source overview renders the graduated source.

**Tech Stack:** Unchanged. tRPC + Drizzle + Zod on the backend; React + TanStack Router + Query on the dashboard.

**Important context for the implementer:**

- The user has authorized **auto-commit for Phase 4**. Use `git commit` directly.
- **No DB schema changes.** Phase 0 already provisions `is_sandbox` (will be flipped to false), `dataset_id` (nullable, will be set), `is_inline` on InputSet (optionally flipped to false). Graduation is purely mutation.
- **DB state baseline:** 1 default org, 1 sandbox project. After a successful graduate, you'll see: 1 default org, 1 sandbox project, 1+ new "real" project, 1+ new dataset, 1 source migrated from sandbox to the new dataset.
- **psql:** `/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform`.
- **No new dashboard routes.** The Graduate button + form lives inside the existing `/sandbox/{slug}` wizard.
- **Phase 3a's read views become useful** after the first graduation — the new Project shows up in `/projects`, the Dataset in the project's Datasets list, etc.

---

## File Structure

### Files created

| File | Responsibility |
|---|---|
| `packages/dashboard/src/components/graduate-form.tsx` | Inline form: project picker + dataset picker + source name/slug + optional InputSet promotion |
| `packages/dashboard/src/lib/slugify.ts` | Tiny pure helper: `slugify(name) → slug`. Used to auto-fill slug fields from name input. |

### Files modified

| File | Change |
|---|---|
| `packages/api/src/routers/sandbox.ts` | Add `graduate` procedure (uses Drizzle transaction) |
| `packages/api/src/routers/sandbox.test.ts` | Add input-validation tests for `graduate` |
| `packages/dashboard/src/routes/sandbox-detail.tsx` | Add Graduate button + render `<GraduateForm />` inline when expanded |

### Files NOT touched

- Phase 3a's pages — they "just work" once a source is graduated (Phase 3a's `sources.listByProject` finds graduated sources because they're `is_sandbox=false`).
- DB schema, migrations, seeding scripts.
- Any other dashboard route.

---

## Task 1: `sandbox.graduate` tRPC procedure

**Files:**
- Modify: `packages/api/src/routers/sandbox.ts`
- Modify: `packages/api/src/routers/sandbox.test.ts`

### Step 1: Write the failing tests

Open `packages/api/src/routers/sandbox.test.ts`. Add a new `describe` block before the closing `});` of the outermost `describe('sandboxRouter', ...)`:

```ts
  describe('graduate input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.graduate({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects missing project', async () => {
      try {
        await caller.sandbox.graduate({ slug: 'foo' } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects new project without name', async () => {
      try {
        await caller.sandbox.graduate({
          slug: 'foo',
          project: { mode: 'new', newSlug: 'p' } as never,
          dataset: { mode: 'new', newName: 'D', newSlug: 'd' },
          source: { name: 'S', slug: 's' },
        });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects existing project without existingSlug', async () => {
      try {
        await caller.sandbox.graduate({
          slug: 'foo',
          project: { mode: 'existing' } as never,
          dataset: { mode: 'new', newName: 'D', newSlug: 'd' },
          source: { name: 'S', slug: 's' },
        });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('throws NOT_FOUND for unknown sandbox slug', async () => {
      try {
        await caller.sandbox.graduate({
          slug: 'does-not-exist-zzzzz',
          project: { mode: 'new', newName: 'Acme', newSlug: 'acme' },
          dataset: { mode: 'new', newName: 'Products', newSlug: 'products' },
          source: { name: 'Amazon', slug: 'amazon' },
        });
        throw new Error('should have thrown');
      } catch (err) {
        if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
        if (err.code !== 'NOT_FOUND') throw new Error(`expected NOT_FOUND, got ${err.code}`);
      }
    });
  });
```

Update the `appRouter shape` test to assert graduate:

```ts
    it('exposes all sandbox procedures', () => {
      expect(typeof caller.sandbox.create).toBe('function');
      expect(typeof caller.sandbox.list).toBe('function');
      expect(typeof caller.sandbox.get).toBe('function');
      expect(typeof caller.sandbox.analyze).toBe('function');
      expect(typeof caller.sandbox.extract).toBe('function');
      expect(typeof caller.sandbox.delete).toBe('function');
      expect(typeof caller.sandbox.graduate).toBe('function');
    });
```

### Step 2: Run tests to confirm failure

```bash
pnpm --filter @robot/api exec vitest run src/routers/sandbox.test.ts
```

Expected: FAIL — `caller.sandbox.graduate is not a function` plus the appRouter shape test failing.

### Step 3: Add the `graduate` procedure to `sandbox.ts`

Open `packages/api/src/routers/sandbox.ts`. Before the closing `});` of `sandboxRouter`, add this procedure:

```ts
  graduate: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        project: z.discriminatedUnion('mode', [
          z.object({ mode: z.literal('existing'), existingSlug: z.string().min(1) }),
          z.object({
            mode: z.literal('new'),
            newName: z.string().min(1).max(255),
            newSlug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
          }),
        ]),
        dataset: z.discriminatedUnion('mode', [
          z.object({ mode: z.literal('existing'), existingSlug: z.string().min(1) }),
          z.object({
            mode: z.literal('new'),
            newName: z.string().min(1).max(255),
            newSlug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
          }),
        ]),
        source: z.object({
          name: z.string().min(1).max(255),
          slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
        }),
        promoteInputSet: z
          .object({
            name: z.string().min(1).max(255),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const sandboxSource = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!sandboxSource) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }

      // Pick the default org for graduation
      const orgRow = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1);
      if (orgRow.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No orgs found' });
      }
      const orgId = orgRow[0].id;

      // Schema for the new dataset (if needed) — auto-derive from sandbox source's fields
      const sandboxSchema = (sandboxSource.selectorsJson as { fields?: Array<Record<string, unknown>> } | null) ?? null;
      const derivedDatasetSchema = (sandboxSchema?.fields ?? []).map((f) => ({
        ...f,
        source: (f as { source?: string }).source ?? 'detail',
      }));

      return await db.transaction(async (tx) => {
        // Step 1: resolve Project
        let projectId: string;
        let projectSlug: string;
        if (input.project.mode === 'existing') {
          const existing = await tx.query.projects.findFirst({
            where: and(eq(projects.orgId, orgId), eq(projects.slug, input.project.existingSlug)),
          });
          if (!existing) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `Project not found: ${input.project.existingSlug}`,
            });
          }
          if (existing.slug === 'sandbox') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot graduate into the Sandbox project',
            });
          }
          projectId = existing.id;
          projectSlug = existing.slug;
        } else {
          // Check slug collision
          const collision = await tx.query.projects.findFirst({
            where: and(eq(projects.orgId, orgId), eq(projects.slug, input.project.newSlug)),
          });
          if (collision) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Project slug "${input.project.newSlug}" already exists in this org`,
            });
          }
          if (input.project.newSlug === 'sandbox') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot use "sandbox" as a project slug',
            });
          }
          const [created] = await tx
            .insert(projects)
            .values({
              orgId,
              name: input.project.newName,
              slug: input.project.newSlug,
            })
            .returning({ id: projects.id, slug: projects.slug });
          projectId = created.id;
          projectSlug = created.slug;
        }

        // Step 2: resolve Dataset
        let datasetId: string;
        if (input.dataset.mode === 'existing') {
          const existing = await tx.query.datasets.findFirst({
            where: and(eq(datasets.projectId, projectId), eq(datasets.slug, input.dataset.existingSlug)),
          });
          if (!existing) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `Dataset not found in project: ${input.dataset.existingSlug}`,
            });
          }
          datasetId = existing.id;
        } else {
          const collision = await tx.query.datasets.findFirst({
            where: and(eq(datasets.projectId, projectId), eq(datasets.slug, input.dataset.newSlug)),
          });
          if (collision) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Dataset slug "${input.dataset.newSlug}" already exists in this project`,
            });
          }
          const [created] = await tx
            .insert(datasets)
            .values({
              projectId,
              name: input.dataset.newName,
              slug: input.dataset.newSlug,
              schema: derivedDatasetSchema,
            })
            .returning({ id: datasets.id });
          datasetId = created.id;
        }

        // Step 3: validate source slug doesn't collide within the new dataset
        const sourceCollision = await tx.query.sources.findFirst({
          where: and(eq(sources.datasetId, datasetId), eq(sources.slug, input.source.slug)),
        });
        if (sourceCollision) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Source slug "${input.source.slug}" already exists in this dataset`,
          });
        }

        // Step 4: update the Source
        await tx
          .update(sources)
          .set({
            isSandbox: false,
            datasetId,
            name: input.source.name,
            slug: input.source.slug,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, sandboxSource.id));

        // Step 5: optionally promote the inline InputSet
        if (input.promoteInputSet && sandboxSource.inputSetId) {
          await tx
            .update(inputSets)
            .set({
              isInline: false,
              name: input.promoteInputSet.name,
              updatedAt: new Date(),
            })
            .where(eq(inputSets.id, sandboxSource.inputSetId));
        }

        return { projectSlug, sourceSlug: input.source.slug };
      });
    }),
```

Note: this procedure references `inputSets` and uses `tx.query`. The `inputSets` import is already at the top of the file from Phase 2. Verify by reading the imports.

### Step 4: Run tests to confirm pass

```bash
pnpm --filter @robot/api exec vitest run src/routers/sandbox.test.ts
```

Expected: PASS. Test count for sandbox should rise from 10 to 15 (added 5 new tests).

### Step 5: Smoke-test with curl (optional but good)

Start the api-server if not running:
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
SERVER_PID=$!
sleep 4
```

Verify the procedure is exposed:
```bash
echo "--- sandbox.graduate (unknown sandbox slug → NOT_FOUND) ---"
curl -s -X POST 'http://localhost:4000/trpc/sandbox.graduate' \
  -H 'Content-Type: application/json' \
  -d '{"json":{"slug":"does-not-exist-zzzzz","project":{"mode":"new","newName":"Test","newSlug":"test"},"dataset":{"mode":"new","newName":"D","newSlug":"d"},"source":{"name":"S","slug":"s"}}}' | head -c 400
```

Expected: a 404-ish tRPC error response containing `"NOT_FOUND"` and the message about the missing sandbox slug.

Stop the server:
```bash
kill $SERVER_PID 2>/dev/null
```

### Step 6: Commit

```bash
git add packages/api/src/routers/sandbox.ts packages/api/src/routers/sandbox.test.ts
git commit -m "feat(api): add sandbox.graduate (transactional move to real Project + Dataset)"
```

---

## Task 2: Graduate form component

**Files:**
- Create: `packages/dashboard/src/lib/slugify.ts`
- Create: `packages/dashboard/src/components/graduate-form.tsx`

### Step 1: Create the slugify helper

Create `packages/dashboard/src/lib/slugify.ts`:

```ts
/**
 * Convert a human name into a URL-safe slug.
 * Lowercase, alphanumeric + hyphens, no leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

### Step 2: Create the GraduateForm component

Create `packages/dashboard/src/components/graduate-form.tsx`:

```tsx
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, X } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { ErrorBanner } from './page-states';
import { slugify } from '../lib/slugify';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

type Props = {
  sandboxSlug: string;
  defaultSourceName: string;
  onCancel: () => void;
};

export function GraduateForm({ sandboxSlug, defaultSourceName, onCancel }: Props) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // Project state
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('new');
  const [existingProjectSlug, setExistingProjectSlug] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSlug, setNewProjectSlug] = useState('');
  const [newProjectSlugTouched, setNewProjectSlugTouched] = useState(false);

  // Dataset state
  const [datasetMode, setDatasetMode] = useState<'existing' | 'new'>('new');
  const [existingDatasetSlug, setExistingDatasetSlug] = useState('');
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetSlug, setNewDatasetSlug] = useState('');
  const [newDatasetSlugTouched, setNewDatasetSlugTouched] = useState(false);

  // Source state
  const [sourceName, setSourceName] = useState(defaultSourceName);
  const [sourceSlug, setSourceSlug] = useState(slugify(defaultSourceName));
  const [sourceSlugTouched, setSourceSlugTouched] = useState(false);

  // InputSet promotion state
  const [promoteInputSet, setPromoteInputSet] = useState(false);
  const [inputSetName, setInputSetName] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from name unless user has touched the slug field
  useEffect(() => {
    if (!newProjectSlugTouched) setNewProjectSlug(slugify(newProjectName));
  }, [newProjectName, newProjectSlugTouched]);
  useEffect(() => {
    if (!newDatasetSlugTouched) setNewDatasetSlug(slugify(newDatasetName));
  }, [newDatasetName, newDatasetSlugTouched]);
  useEffect(() => {
    if (!sourceSlugTouched) setSourceSlug(slugify(sourceName));
  }, [sourceName, sourceSlugTouched]);

  // Project dropdown options — query existing non-sandbox projects
  const projectsQuery = trpc.projects.list.useQuery();
  const availableProjects = useMemo(
    () => (projectsQuery.data ?? []).filter((p) => p.slug !== 'sandbox'),
    [projectsQuery.data],
  );

  // Dataset dropdown options — depend on chosen existing project
  const selectedProjectId = useMemo(() => {
    if (projectMode !== 'existing' || !existingProjectSlug) return null;
    return availableProjects.find((p) => p.slug === existingProjectSlug)?.id ?? null;
  }, [projectMode, existingProjectSlug, availableProjects]);
  const datasetsQuery = trpc.datasets.listByProject.useQuery(
    { projectId: selectedProjectId ?? '' },
    { enabled: !!selectedProjectId },
  );

  const graduateMutation = trpc.sandbox.graduate.useMutation({
    onSuccess: ({ projectSlug, sourceSlug: returnedSourceSlug }) => {
      // Invalidate sandbox queries so list/get refresh
      utils.sandbox.list.invalidate();
      utils.sandbox.get.invalidate({ slug: sandboxSlug });
      utils.projects.list.invalidate();
      navigate({
        to: '/p/$project/sources/$source',
        params: { project: projectSlug, source: returnedSourceSlug },
      });
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);

    // Build the input
    const projectInput =
      projectMode === 'existing'
        ? { mode: 'existing' as const, existingSlug: existingProjectSlug }
        : { mode: 'new' as const, newName: newProjectName.trim(), newSlug: newProjectSlug.trim() };
    const datasetInput =
      datasetMode === 'existing'
        ? { mode: 'existing' as const, existingSlug: existingDatasetSlug }
        : { mode: 'new' as const, newName: newDatasetName.trim(), newSlug: newDatasetSlug.trim() };
    const sourceInput = { name: sourceName.trim(), slug: sourceSlug.trim() };

    // Basic client-side validation
    if (projectMode === 'existing' && !existingProjectSlug) {
      setError('Pick a project'); return;
    }
    if (projectMode === 'new' && (!newProjectName.trim() || !newProjectSlug.trim())) {
      setError('Project needs a name and slug'); return;
    }
    if (datasetMode === 'existing' && !existingDatasetSlug) {
      setError('Pick a dataset'); return;
    }
    if (datasetMode === 'new' && (!newDatasetName.trim() || !newDatasetSlug.trim())) {
      setError('Dataset needs a name and slug'); return;
    }
    if (!sourceInput.name || !sourceInput.slug) {
      setError('Source needs a name and slug'); return;
    }
    if (promoteInputSet && !inputSetName.trim()) {
      setError('Provide an InputSet name to promote it'); return;
    }

    graduateMutation.mutate({
      slug: sandboxSlug,
      project: projectInput,
      dataset: datasetInput,
      source: sourceInput,
      promoteInputSet: promoteInputSet ? { name: inputSetName.trim() } : undefined,
    });
  }

  const pending = graduateMutation.isPending;
  const canPickExistingProject = availableProjects.length > 0;
  const canPickExistingDataset = projectMode === 'existing' && (datasetsQuery.data?.length ?? 0) > 0;

  return (
    <div className="mt-6 rounded-md border border-gray-300 bg-gray-50 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Graduate to a real project</h2>
          <p className="mt-1 text-xs text-gray-600">
            Move this Sandbox source into a Project + Dataset. Runs and extracted data are preserved.
          </p>
        </div>
        <button
          onClick={onCancel}
          disabled={pending}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Project picker */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-gray-700">Project</legend>
        <div className="mt-2 flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={projectMode === 'existing'}
              onChange={() => setProjectMode('existing')}
              disabled={pending || !canPickExistingProject}
            />
            Existing
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={projectMode === 'new'}
              onChange={() => setProjectMode('new')}
              disabled={pending}
            />
            Create new
          </label>
        </div>

        {projectMode === 'existing' && (
          <select
            value={existingProjectSlug}
            onChange={(e) => setExistingProjectSlug(e.target.value)}
            disabled={pending}
            className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          >
            <option value="">Choose a project…</option>
            {availableProjects.map((p) => (
              <option key={p.id} value={p.slug}>{p.name}</option>
            ))}
          </select>
        )}

        {projectMode === 'new' && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
            />
            <input
              type="text"
              value={newProjectSlug}
              onChange={(e) => {
                setNewProjectSlugTouched(true);
                setNewProjectSlug(e.target.value);
              }}
              placeholder="project-slug"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 font-mono text-xs disabled:opacity-50"
            />
          </div>
        )}
      </fieldset>

      {/* Dataset picker */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-gray-700">Dataset</legend>
        <div className="mt-2 flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={datasetMode === 'existing'}
              onChange={() => setDatasetMode('existing')}
              disabled={pending || projectMode !== 'existing' || !canPickExistingDataset}
            />
            Existing
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={datasetMode === 'new'}
              onChange={() => setDatasetMode('new')}
              disabled={pending}
            />
            Create new
          </label>
        </div>

        {datasetMode === 'existing' && (
          <select
            value={existingDatasetSlug}
            onChange={(e) => setExistingDatasetSlug(e.target.value)}
            disabled={pending || projectMode !== 'existing'}
            className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          >
            <option value="">
              {projectMode !== 'existing' ? 'Pick an existing project first' : 'Choose a dataset…'}
            </option>
            {(datasetsQuery.data ?? []).map((d) => (
              <option key={d.id} value={d.slug}>{d.name}</option>
            ))}
          </select>
        )}

        {datasetMode === 'new' && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <input
              type="text"
              value={newDatasetName}
              onChange={(e) => setNewDatasetName(e.target.value)}
              placeholder="Dataset name (e.g. Products)"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
            />
            <input
              type="text"
              value={newDatasetSlug}
              onChange={(e) => {
                setNewDatasetSlugTouched(true);
                setNewDatasetSlug(e.target.value);
              }}
              placeholder="dataset-slug"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 font-mono text-xs disabled:opacity-50"
            />
          </div>
        )}
      </fieldset>

      {/* Source name/slug */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-gray-700">Source</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="Source name"
            disabled={pending}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          />
          <input
            type="text"
            value={sourceSlug}
            onChange={(e) => {
              setSourceSlugTouched(true);
              setSourceSlug(e.target.value);
            }}
            placeholder="source-slug"
            disabled={pending}
            className="h-9 rounded-md border border-gray-300 px-2 font-mono text-xs disabled:opacity-50"
          />
        </div>
      </fieldset>

      {/* Optional InputSet promotion */}
      <fieldset className="mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={promoteInputSet}
            onChange={(e) => setPromoteInputSet(e.target.checked)}
            disabled={pending}
          />
          <span>Promote inline InputSet to a named one</span>
        </label>
        {promoteInputSet && (
          <input
            type="text"
            value={inputSetName}
            onChange={(e) => setInputSetName(e.target.value)}
            placeholder="InputSet name (e.g. Acme ASINs Q1)"
            disabled={pending}
            className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          />
        )}
        {!promoteInputSet && (
          <p className="mt-1 text-xs text-gray-500">
            Leave inline (default). You can promote later when this list needs to be reused across sources.
          </p>
        )}
      </fieldset>

      {error && <ErrorBanner message={error} />}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-9 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="flex h-9 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Graduate
        </button>
      </div>
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
git add packages/dashboard/src/components/graduate-form.tsx packages/dashboard/src/lib/slugify.ts
git commit -m "feat(dashboard): GraduateForm component with project + dataset pickers"
```

---

## Task 3: Wire Graduate button into wizard

**Files:**
- Modify: `packages/dashboard/src/routes/sandbox-detail.tsx`

### Step 1: Add Graduate button + conditional form rendering

Open `packages/dashboard/src/routes/sandbox-detail.tsx`. Make these edits:

1. Add imports near the top:
```tsx
import { GraduateForm } from '../components/graduate-form';
import { ArrowUpCircle } from 'lucide-react';
```

2. In the main `SandboxDetail` component body, add a local state for whether the Graduate form is expanded:
```tsx
const [graduateExpanded, setGraduateExpanded] = useState(false);
```

3. After the existing JSX block that renders the "Extract / Re-extract" button (look for the section that has `<button onClick={() => { ... extractMutation.mutate(...) }}>` rendering "Extract" or "Re-extract"), add a Graduate button. Place it adjacent to the Extract button — same flex row, separated by a small gap. The button appears whenever the source has been loaded (i.e., `source` exists). When clicked, it sets `graduateExpanded(true)`.

Specifically, find this block (or similar):
```tsx
      {hasSchema && (
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-gray-600">
            {fields.filter((f) => f.enabled !== false).length} of {fields.length} fields selected
          </span>
          <button
            onClick={() => {
              setError(null);
              extractMutation.mutate({ slug, fields });
            }}
            disabled={extractMutation.isPending || fields.filter((f) => f.enabled !== false).length === 0}
            className="flex h-9 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {extractMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {latestRun ? 'Re-extract' : 'Extract'}
          </button>
        </div>
      )}
```

Modify the rightmost cluster to include a Graduate button:
```tsx
      {hasSchema && (
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-gray-600">
            {fields.filter((f) => f.enabled !== false).length} of {fields.length} fields selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGraduateExpanded(true)}
              disabled={graduateExpanded || extractMutation.isPending}
              className="flex h-9 items-center gap-2 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <ArrowUpCircle className="h-4 w-4" />
              Graduate
            </button>
            <button
              onClick={() => {
                setError(null);
                extractMutation.mutate({ slug, fields });
              }}
              disabled={extractMutation.isPending || fields.filter((f) => f.enabled !== false).length === 0}
              className="flex h-9 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {extractMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {latestRun ? 'Re-extract' : 'Extract'}
            </button>
          </div>
        </div>
      )}
```

4. Render the `<GraduateForm />` when expanded. After the schema editor and run results sections (or anywhere after the buttons block), add:
```tsx
      {graduateExpanded && (
        <GraduateForm
          sandboxSlug={slug}
          defaultSourceName={source.name}
          onCancel={() => setGraduateExpanded(false)}
        />
      )}
```

The form's `onSuccess` (inside the component) handles navigation, so we don't need to manage redirect state here.

### Step 2: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Clean.

### Step 3: Smoke test

Start the servers if not running:
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
```

Open `http://localhost:3456` in a browser. Paste a URL, click Analyze. Once schema appears, you should see two buttons: "Graduate" (outlined) and "Extract"/"Re-extract" (solid dark). Click Graduate — form expands. Click Cancel — form collapses.

Don't actually submit Graduate yet — Task 4 validates the full flow.

Stop the servers:
```bash
kill $API_PID $DASH_PID 2>/dev/null
```

### Step 4: Commit

```bash
git add packages/dashboard/src/routes/sandbox-detail.tsx
git commit -m "feat(dashboard): wire Graduate button + form into Sandbox wizard"
```

---

## Task 4: End-to-end verification

**Files:** none (verification only).

### Step 1: Typecheck all 7 packages

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

All clean.

### Step 2: Run all test suites

```bash
pnpm --filter @robot/db exec vitest run
pnpm --filter @robot/api exec vitest run
pnpm --filter @robot/api-server exec vitest run
pnpm --filter @robot/scraper test
pnpm --filter @robot/browser test
```

Expected: 109 total (10 + 31 + 5 + 54 + 9). The `@robot/api` count rose from 26 (Phase 3a) → 31 due to 5 new `sandbox.graduate` tests.

### Step 3: Full end-to-end smoke test against the running system

Start both servers:
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
```

#### 3a: Create a Sandbox source via tRPC

```bash
echo "--- 1. sandbox.create ---"
CREATE_RESP=$(curl -s -X POST 'http://localhost:4000/trpc/sandbox.create' \
  -H 'Content-Type: application/json' \
  -d '{"json":{"url":"https://www.ikea.com/my/en/p/klubbsporre-ergonomic-pillow-side-back-sleeper-80446097/"}}')
echo "$CREATE_RESP" | head -c 200
SLUG=$(echo "$CREATE_RESP" | sed -E 's/.*"slug":"([^"]+)".*/\1/')
echo ""
echo "SLUG=$SLUG"
```

#### 3b: Graduate without analyzing (test the "empty schema" graduation path)

```bash
echo "--- 2. sandbox.graduate (new project + new dataset) ---"
GRAD_RESP=$(curl -s -X POST 'http://localhost:4000/trpc/sandbox.graduate' \
  -H 'Content-Type: application/json' \
  -d "{\"json\":{\"slug\":\"$SLUG\",\"project\":{\"mode\":\"new\",\"newName\":\"Phase 4 Test\",\"newSlug\":\"phase-4-test\"},\"dataset\":{\"mode\":\"new\",\"newName\":\"Products\",\"newSlug\":\"products\"},\"source\":{\"name\":\"IKEA Pillow\",\"slug\":\"ikea-pillow\"}}}")
echo "$GRAD_RESP" | head -c 300
```

Expected: `{"result":{"data":{"json":{"projectSlug":"phase-4-test","sourceSlug":"ikea-pillow"}}}}`.

#### 3c: Verify the source moved

```bash
echo "--- 3. sandbox.get (should now be null — source is no longer a sandbox) ---"
curl -s -G --data-urlencode "input={\"json\":{\"slug\":\"$SLUG\"}}" 'http://localhost:4000/trpc/sandbox.get' | head -c 200

echo ""
echo "--- 4. projects.getWithStats (Phase 4 Test project) ---"
curl -s -G --data-urlencode 'input={"json":{"orgSlug":"default","projectSlug":"phase-4-test"}}' 'http://localhost:4000/trpc/projects.getWithStats' | head -c 400

echo ""
echo "--- 5. sources.listByProject (should show ikea-pillow under Phase 4 Test) ---"
curl -s -G --data-urlencode 'input={"json":{"orgSlug":"default","projectSlug":"phase-4-test"}}' 'http://localhost:4000/trpc/sources.listByProject' | head -c 400
```

Expected:
- sandbox.get returns `null` (source is no longer sandbox)
- projects.getWithStats returns the new project with `datasetCount: 1, sourceCount: 1`
- sources.listByProject returns 1 source with `slug: "ikea-pillow"` and `datasetSlug: "products"`

#### 3d: Verify DB state directly

```bash
/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform <<'SQL'
SELECT
  (SELECT count(*) FROM projects WHERE slug != 'sandbox') AS non_sandbox_projects,
  (SELECT count(*) FROM datasets) AS datasets,
  (SELECT count(*) FROM sources WHERE is_sandbox = false) AS real_sources,
  (SELECT count(*) FROM sources WHERE is_sandbox = true) AS sandbox_sources;
SQL
```

Expected:
- `non_sandbox_projects`: 1 (Phase 4 Test)
- `datasets`: 1 (products)
- `real_sources`: 1 (ikea-pillow)
- `sandbox_sources`: 0 (the source we created was graduated)

#### 3e: Test error paths

```bash
echo "--- 6. graduate with duplicate slug (CONFLICT) ---"
# Create another sandbox source, try to graduate into the same project with the same source slug
CREATE2=$(curl -s -X POST 'http://localhost:4000/trpc/sandbox.create' \
  -H 'Content-Type: application/json' \
  -d '{"json":{"url":"https://example.com/another"}}')
SLUG2=$(echo "$CREATE2" | sed -E 's/.*"slug":"([^"]+)".*/\1/')
curl -s -X POST 'http://localhost:4000/trpc/sandbox.graduate' \
  -H 'Content-Type: application/json' \
  -d "{\"json\":{\"slug\":\"$SLUG2\",\"project\":{\"mode\":\"existing\",\"existingSlug\":\"phase-4-test\"},\"dataset\":{\"mode\":\"existing\",\"existingSlug\":\"products\"},\"source\":{\"name\":\"IKEA Pillow\",\"slug\":\"ikea-pillow\"}}}" | head -c 300

echo ""
echo "--- 7. graduate into sandbox slug (BAD_REQUEST) ---"
curl -s -X POST 'http://localhost:4000/trpc/sandbox.graduate' \
  -H 'Content-Type: application/json' \
  -d "{\"json\":{\"slug\":\"$SLUG2\",\"project\":{\"mode\":\"existing\",\"existingSlug\":\"sandbox\"},\"dataset\":{\"mode\":\"new\",\"newName\":\"d\",\"newSlug\":\"d\"},\"source\":{\"name\":\"X\",\"slug\":\"x\"}}}" | head -c 300
```

Expected:
- Test 6: CONFLICT error mentioning the source slug already exists
- Test 7: BAD_REQUEST error mentioning "Cannot graduate into the Sandbox project"

Clean up the second test source:
```bash
/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform -c "DELETE FROM sources WHERE slug = '$SLUG2';"
```

#### 3f: Browser walkthrough (highly recommended)

In a browser:
1. Open `http://localhost:3456/`
2. Paste a URL (e.g., `https://news.ycombinator.com`), click Analyze
3. Wait for schema to appear
4. Click the new **Graduate** button — form expands
5. Fill in: new project name "Demo", new dataset name "Stories"
6. Click Graduate — should navigate to `/p/demo/sources/{slug}` showing Phase 3a's Source overview
7. Navigate to `/projects` — Demo project should appear in the list
8. Navigate to `/p/demo/datasets` — Stories dataset appears
9. Navigate back to `/sandbox` — the source you just graduated is GONE from the list

### Step 4: Stop servers

```bash
kill $API_PID $DASH_PID 2>/dev/null
```

### Step 5: Final commit if anything was left over

```bash
git status
```

If clean, no commit needed. If anything's uncommitted (unlikely), stage and commit.

---

## Wrap-up checks

- [ ] All 7 packages typecheck clean.
- [ ] All 109 tests pass.
- [ ] `sandbox.graduate` procedure exists and is callable.
- [ ] Graduate button appears on the Sandbox wizard page.
- [ ] Graduate form has project picker (existing or new), dataset picker, source name/slug, optional InputSet promotion.
- [ ] Successful graduate moves the Source row (`is_sandbox=false`, `dataset_id` set), creates Project/Dataset as needed, redirects to the new URL.
- [ ] Graduated source appears in Phase 3a's Project pages with full history.
- [ ] Old Sandbox URL of the graduated source returns null on `sandbox.get` (no longer in sandbox list).
- [ ] Slug collisions are caught as CONFLICT errors.
- [ ] Cannot graduate into the `sandbox` project (BAD_REQUEST).

---

## Notes for the implementer

- **No DB schema changes.** Phase 4 is purely a mutation layer + UI.
- **The Graduate mutation is transactional.** Any failure rolls back all changes. Project, Dataset, Source update, InputSet promotion — all or nothing.
- **Old Sandbox URL after graduation** returns null on `sandbox.get` (because the source is now `is_sandbox=false`). The wizard page renders the NotFound state. Acceptable — users navigate to the new URL on graduation; landing back on the old URL is rare.
- **`updatedAt` consistency:** the graduate procedure sets `updatedAt: new Date()` on the Source row. Since Phase 2 cleanup migrated timestamps to `timestamptz`, this is consistent UTC.
- **Schema derivation:** new datasets get `schema = sandboxSource.selectorsJson.fields` with `source: 'detail'` defaulted per field. The full field-source classification UX (`detail | listing | input.X | system`) is Phase 3b's schema editor. Phase 4 just provides a sane default.
- **No deletions:** Phase 4 doesn't delete anything — Sandbox sources are FLIPPED to non-sandbox, not deleted-and-recreated. This preserves all foreign-key references (Runs, Captures, Extractions stay attached).
- **Out of scope:**
  - Standalone Create Project / Create Dataset pages (deferred)
  - De-graduation (one-way operation)
  - Multi-org graduation (v3)
  - Field-source classification UX (Phase 3b)
  - Bulk graduation (one source at a time)
