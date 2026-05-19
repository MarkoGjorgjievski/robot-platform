# Dashboard Redesign — Phase 2: Sandbox Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interactive Sandbox wizard on the Phase 1 scaffold. A user pastes a URL on `/`, the system creates a draft Source in Sandbox, redirects to `/sandbox/{slug}`, runs analysis, lets the user toggle fields, runs extraction, persists results — and every step is saved to the DB so reload mid-flow rehydrates correctly.

**Architecture:** A new `sandbox` tRPC router in `@robot/api` wraps the existing `scraper.analyze`/`scraper.extract` procedures with DB persistence (Source row, Run, Capture, Extraction). The dashboard's three placeholder routes (`/`, `/sandbox`, `/sandbox/$shortid`) become real pages. State on the wizard page is derived from `sandbox.get` — the URL is the canonical state pointer. Coarse mutations per discrete action (paste, analyze, extract). Long-running extract is a blocking tRPC mutation with a spinner UI.

**Tech Stack:** Unchanged from Phase 1. `@tanstack/react-router` + `@tanstack/react-query` + `@trpc/react-query` on the dashboard; Hono + tRPC on api-server; Drizzle + Postgres in `@robot/db`.

**Important context for the implementer:**

- The user manages git commits but has authorized **auto-commit for this Phase 2 work**. Plan steps include `git commit` recipes and the executor should run them.
- No DB schema changes in Phase 2. Phase 0 already provisioned `is_sandbox`, `selectors_json`, `run_id`, `input_set_id`, etc. We use the existing columns.
- The current Sandbox Source slug format is `<domain-slug>-<random6>` (set during back-fill). New Sandbox Sources created in Phase 2 follow the same pattern.
- The wizard page derives state from `sandbox.get` data, not from local component state. Reload reconstructs the same view.
- Phase 2 is **NOT** Graduate (Phase 4), Project views (Phase 3), or DomainIntelligence views (Phase 5). Stay scoped.
- `psql`: `/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform`.
- Two long-running servers are needed during dev: `pnpm --filter @robot/api-server dev` on `:4000` and `pnpm --filter @robot/dashboard dev` on `:3456`.

---

## File Structure

### Files created

| File | Responsibility |
|---|---|
| `packages/api/src/routers/sandbox.ts` | tRPC procedures: `create`, `list`, `get`, `analyze`, `extract` |
| `packages/api/src/routers/sandbox.test.ts` | Vitest input-validation + DB-integration tests |
| `packages/dashboard/src/routes/landing.tsx` | The `/` paste-and-go form |
| `packages/dashboard/src/lib/api-url.ts` | Tiny helper exporting `API_URL` (used for screenshot src) |

### Files modified

| File | Change |
|---|---|
| `packages/api/src/routers/index.ts` | Register `sandboxRouter` |
| `packages/dashboard/src/router.tsx` | Replace inline index-route component with `LandingPage` import |
| `packages/dashboard/src/routes/sandbox-index.tsx` | Replace stub with real list view |
| `packages/dashboard/src/routes/sandbox-detail.tsx` | Replace stub with the real wizard |

### Files deleted

None. Phase 2 is additive on the dashboard side; the only "deletions" are replacing placeholder components with real ones.

---

## Task 1: Add `sandbox` tRPC router

**Files:**
- Create: `packages/api/src/routers/sandbox.ts`
- Create: `packages/api/src/routers/sandbox.test.ts`
- Modify: `packages/api/src/routers/index.ts`

### Step 1: Write the failing tests

Create `packages/api/src/routers/sandbox.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq, like } from 'drizzle-orm';
import { db, sources, inputSets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

const SANDBOX_TEST_PREFIX = 'test-sb-';

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

afterEach(async () => {
  // Clean up any test rows. Slug prefix matching catches both Source and InputSet.
  const testSources = await db.select({ id: sources.id, inputSetId: sources.inputSetId })
    .from(sources)
    .where(like(sources.slug, `${SANDBOX_TEST_PREFIX}%`));
  for (const s of testSources) {
    await db.delete(sources).where(eq(sources.id, s.id));
    if (s.inputSetId) {
      await db.delete(inputSets).where(eq(inputSets.id, s.inputSetId));
    }
  }
});

describe('sandboxRouter', () => {
  describe('create input validation', () => {
    it('rejects empty input', async () => {
      try {
        await caller.sandbox.create({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects non-URL string', async () => {
      try {
        await caller.sandbox.create({ url: 'not-a-url' });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  describe('get input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.get({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns null for unknown slug', async () => {
      const result = await caller.sandbox.get({ slug: 'definitely-not-a-real-slug-xyz' });
      expect(result).toBeNull();
    });
  });

  describe('extract input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.extract({ fields: [] } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects missing fields array', async () => {
      try {
        await caller.sandbox.extract({ slug: 'foo' } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  describe('analyze input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.analyze({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  describe('appRouter shape', () => {
    it('exposes all sandbox procedures', () => {
      expect(typeof caller.sandbox.create).toBe('function');
      expect(typeof caller.sandbox.list).toBe('function');
      expect(typeof caller.sandbox.get).toBe('function');
      expect(typeof caller.sandbox.analyze).toBe('function');
      expect(typeof caller.sandbox.extract).toBe('function');
    });
  });
});
```

The test slug prefix `test-sb-` won't be produced by real `sandbox.create` (which uses the domain-based slug). The afterEach cleanup is a safety net for any test that creates rows.

### Step 2: Run the tests to confirm failure

```bash
pnpm --filter @robot/api exec vitest run src/routers/sandbox.test.ts
```

Expected: FAIL — `Cannot find module './sandbox.js'` (the router file doesn't exist yet) AND `sandbox` property is not on `appRouter`.

### Step 3: Create `sandbox.ts` — the full file

Create `packages/api/src/routers/sandbox.ts`:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and, isNotNull } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { sources, projects, orgs, inputSets, runs, captures, extractions } from '@robot/db';
import { randomUUID } from 'node:crypto';
import { scraperRouter } from './scraper';

// ─── Helpers ────────────────────────────────────────────────────────────────

const SANDBOX_SLUG = 'sandbox';

function slugifyDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function getSandboxProjectId(): Promise<string> {
  // Pick the first org's Sandbox project (matches the back-fill convention).
  const allOrgs = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1);
  if (allOrgs.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No orgs found. Run `pnpm --filter @robot/db seed:sandbox` first.',
    });
  }
  const sandbox = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, allOrgs[0].id), eq(projects.slug, SANDBOX_SLUG)),
  });
  if (!sandbox) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `No Sandbox project for org ${allOrgs[0].slug}. Run seed:sandbox first.`,
    });
  }
  return sandbox.id;
}

// We need access to db; pull it from ctx via the procedures.
// (Importing db directly from @robot/db works because the api package already does this elsewhere.)
import { db } from '@robot/db';

// ─── Procedures ─────────────────────────────────────────────────────────────

export const sandboxRouter = router({
  /**
   * Create a draft Sandbox Source from a URL.
   * Returns { slug } so the client can immediately navigate to /sandbox/{slug}.
   * The actual analyze + extract steps are separate procedures.
   */
  create: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        requestedFields: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { url, requestedFields } = input;
      const domain = new URL(url).hostname.replace(/^www\./, '');
      const sandboxProjectId = await getSandboxProjectId();

      // Create the inline InputSet first (Source FK references its id).
      const [createdInputSet] = await db
        .insert(inputSets)
        .values({
          projectId: sandboxProjectId,
          type: 'direct',
          name: `inline:${url}`,
          columns: [{ name: 'url', primary: true, type: 'string' }],
          rows: [{ url }],
          isInline: true,
        })
        .returning({ id: inputSets.id });

      // Create the Sandbox Source.
      const slug = `${slugifyDomain(domain)}-${shortRandomSuffix()}`;
      const [createdSource] = await db
        .insert(sources)
        .values({
          name: `${domain}${new URL(url).pathname && new URL(url).pathname !== '/' ? ` ${new URL(url).pathname}` : ''}`,
          slug,
          country: 'us',
          sourceType: 'sandbox',
          isSandbox: true,
          inputStrategy: 'direct',
          urlTemplate: url,
          listingMode: 'detail',
          inputSetId: createdInputSet.id,
          datasetId: null,
          selectorsJson: requestedFields ? { requestedFields } : null,
        })
        .returning({ slug: sources.slug });

      return { slug: createdSource.slug };
    }),

  /**
   * List recent Sandbox Sources for the /sandbox index page.
   */
  list: publicProcedure.query(async () => {
    const rows = await db
      .select({
        slug: sources.slug,
        name: sources.name,
        urlTemplate: sources.urlTemplate,
        createdAt: sources.createdAt,
        updatedAt: sources.updatedAt,
      })
      .from(sources)
      .where(eq(sources.isSandbox, true))
      .orderBy(desc(sources.updatedAt))
      .limit(50);

    return rows;
  }),

  /**
   * Load full state for the wizard at /sandbox/{slug}.
   * Returns the Source row plus the latest Run + Extraction (if any).
   * Returns null if the slug doesn't match a Sandbox Source.
   */
  get: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) return null;

      const latestRun = await db
        .select()
        .from(runs)
        .where(eq(runs.sourceId, source.id))
        .orderBy(desc(runs.createdAt))
        .limit(1)
        .then((r) => r[0] ?? null);

      const latestExtraction = latestRun
        ? await db
            .select()
            .from(extractions)
            .where(eq(extractions.runId, latestRun.id))
            .orderBy(desc(extractions.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null;

      const latestCapture = latestRun
        ? await db
            .select()
            .from(captures)
            .where(eq(captures.runId, latestRun.id))
            .orderBy(desc(captures.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null;

      return {
        source: {
          id: source.id,
          slug: source.slug,
          name: source.name,
          urlTemplate: source.urlTemplate,
          selectorsJson: source.selectorsJson,
          isSandbox: source.isSandbox,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              startedAt: latestRun.startedAt,
              completedAt: latestRun.completedAt,
              errorMessage: latestRun.errorMessage,
              resultCount: latestRun.resultCount,
            }
          : null,
        latestExtraction: latestExtraction
          ? {
              data: latestExtraction.data,
              confidence: latestExtraction.confidence,
              validationResult: latestExtraction.validationResult,
            }
          : null,
        latestCapture: latestCapture
          ? {
              screenshotPath: latestCapture.screenshotPath,
            }
          : null,
      };
    }),

  /**
   * Run schema discovery on the Source's URL.
   * Writes the resulting schema to sources.selectors_json.
   * Idempotent: if selectors_json already has fields, returns the cached value
   * unless `force: true`.
   */
  analyze: publicProcedure
    .input(z.object({ slug: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }
      if (!source.urlTemplate) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Source has no URL' });
      }

      // Idempotency: if selectors_json already has fields, return them.
      const existing = source.selectorsJson as { fields?: unknown[]; schema?: unknown } | null;
      if (!input.force && existing && Array.isArray(existing.fields) && existing.fields.length > 0) {
        return existing;
      }

      // Pull requestedFields out of the stash, if any was set by create().
      const requestedFields =
        existing && typeof existing === 'object' && 'requestedFields' in existing
          ? (existing as { requestedFields?: string }).requestedFields
          : undefined;

      // Delegate to scraper.analyze (Phase 1 procedure).
      const scraperCaller = scraperRouter.createCaller(ctx);
      const result = await scraperCaller.analyze({ url: source.urlTemplate, requestedFields });

      // Persist schema to selectors_json.
      const schemaPayload = {
        fields: result.schema.fields,
        pageType: result.schema.page_type,
        cached: result.cached,
        cacheStats: result.cached && 'cacheStats' in result ? result.cacheStats : undefined,
        captureId: result.captureId,
        screenshotUrl: result.screenshotUrl,
      };
      await db
        .update(sources)
        .set({ selectorsJson: schemaPayload, updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      return schemaPayload;
    }),

  /**
   * Run extraction: save the current field selection, run scraper.extract,
   * persist Run + Capture + Extraction rows.
   */
  extract: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        fields: z.array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            description: z.string().optional(),
            tier: z.enum(['requested', 'discovered']).optional(),
            source: z.string().optional(),
            api_path: z.string().optional(),
            enabled: z.boolean().optional(),
          })
        ).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }
      if (!source.urlTemplate) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Source has no URL' });
      }

      // Save the current field state (with enabled flags) to selectors_json.
      const existing = (source.selectorsJson as { pageType?: string } | null) ?? null;
      const updatedSchema = {
        ...(existing ?? {}),
        fields: input.fields,
      };
      await db
        .update(sources)
        .set({ selectorsJson: updatedSchema, updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      // Create a Run row (status=running).
      const [run] = await db
        .insert(runs)
        .values({
          sourceId: source.id,
          status: 'running',
          startedAt: new Date(),
          inputLabel: source.urlTemplate.slice(0, 200),
        })
        .returning({ id: runs.id });

      try {
        // Filter to enabled fields only. Default enabled=true if not specified.
        const enabledFields = input.fields.filter((f) => f.enabled !== false);

        const scraperCaller = scraperRouter.createCaller(ctx);
        const result = await scraperCaller.extract({
          url: source.urlTemplate,
          fields: enabledFields,
          pageType: (existing?.pageType === 'listing' ? 'listing' : 'detail') as 'listing' | 'detail',
        });

        // Persist Capture row (we don't have the actual HTML here — scraper.extract
        // doesn't return it. Store the screenshot path if any, leave html null).
        // The screenshot is already written by scraper.analyze; reuse its path if available.
        const screenshotPath =
          existing && typeof existing === 'object' && 'screenshotUrl' in existing
            ? ((existing as { screenshotUrl?: string }).screenshotUrl ?? null)
            : null;

        const [capture] = await db
          .insert(captures)
          .values({
            sourceId: source.id,
            runId: run.id,
            url: source.urlTemplate,
            html: null,
            markdown: null,
            screenshotPath,
            metadata: {},
          })
          .returning({ id: captures.id });

        // Persist Extraction row.
        await db.insert(extractions).values({
          sourceId: source.id,
          captureId: capture.id,
          runId: run.id,
          data: result.data,
          rowCount: Array.isArray(result.data) ? result.data.length : 0,
          confidence: Math.round((result.confidence ?? 0) * 100),
          validationResult: result.qualityIssues ?? null,
        });

        // Update Run to completed.
        await db
          .update(runs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            resultCount: Array.isArray(result.data) ? result.data.length : 0,
          })
          .where(eq(runs.id, run.id));

        await db
          .update(sources)
          .set({ updatedAt: new Date() })
          .where(eq(sources.id, source.id));

        return { runId: run.id, ...result };
      } catch (err) {
        // Mark Run as failed.
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorMessage: err instanceof Error ? err.message : 'Extraction failed',
          })
          .where(eq(runs.id, run.id));

        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Extraction failed',
        });
      }
    }),
});
```

Note the `import { db } from '@robot/db';` near the middle of the file — keeping it after the helpers that use it is fine; TypeScript hoists imports. If you prefer, move the import to the top of the file alongside the other imports.

### Step 4: Register in `index.ts`

Edit `packages/api/src/routers/index.ts`. Add:
```ts
import { sandboxRouter } from './sandbox';
```
to the imports, and add:
```ts
sandbox: sandboxRouter,
```
to the `appRouter` object (place it alphabetically — between `runs:` and `scraper:`).

### Step 5: Build and run tests

```bash
cd packages/api && pnpm exec tsc --noEmit
pnpm --filter @robot/api exec vitest run src/routers/sandbox.test.ts
```

Both should be clean. All 10 tests in sandbox.test.ts should pass. The existing 8 scraper.test.ts tests should still pass — run them too:

```bash
pnpm --filter @robot/api exec vitest run
```

Expected: 18/18 (8 scraper + 10 sandbox).

### Step 6: Smoke-test against a running api-server (optional but recommended)

Start the api-server in the background:
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
SERVER_PID=$!
sleep 4
```

Hit `sandbox.list` (read-only, safe):
```bash
curl -s -G --data-urlencode 'input={"json":null}' 'http://localhost:4000/trpc/sandbox.list' | head -c 500
```

Expected: HTTP 200 with `{"result":{"data":{"json":[...]}}}` — likely 2 entries from Phase 0's back-fill (`ikea-com-*`).

Stop the server:
```bash
kill $SERVER_PID 2>/dev/null
```

### Step 7: Commit

```bash
git add packages/api/
git commit -m "feat(api): add sandbox tRPC router (create/list/get/analyze/extract)"
```

---

## Task 2: Landing page (`/`)

Replace the current inline placeholder index-route component with a real LandingPage component that has a URL input, optional fields textarea, and an Analyze button that calls `sandbox.create` and navigates to `/sandbox/{slug}`.

**Files:**
- Create: `packages/dashboard/src/routes/landing.tsx`
- Create: `packages/dashboard/src/lib/api-url.ts`
- Modify: `packages/dashboard/src/router.tsx`

### Step 1: Create the API URL helper

Create `packages/dashboard/src/lib/api-url.ts`:

```ts
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
```

This is shared between `lib/trpc.ts` (already references the same env var inline) and the wizard's screenshot URL composition. Refactor `lib/trpc.ts` to import this helper to keep the source of truth in one place.

Open `packages/dashboard/src/lib/trpc.ts` and change:
```ts
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
```
to:
```ts
import { API_URL } from './api-url';
```

### Step 2: Create `landing.tsx`

Create `packages/dashboard/src/routes/landing.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles, Loader2, Search } from 'lucide-react';
import { trpc } from '../lib/trpc';

export default function LandingPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [fieldsInput, setFieldsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.sandbox.create.useMutation({
    onSuccess: ({ slug }) => {
      navigate({ to: '/sandbox/$shortid', params: { shortid: slug } });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleSubmit() {
    setError(null);
    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    try {
      new URL(url.trim());
    } catch {
      setError('Not a valid URL');
      return;
    }
    createMutation.mutate({
      url: url.trim(),
      requestedFields: fieldsInput.trim() || undefined,
    });
  }

  const isPending = createMutation.isPending;

  return (
    <div className="mx-auto max-w-xl pt-12">
      <div className="flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
          <Sparkles className="h-7 w-7 text-gray-600" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Extract data from a URL</h1>
        <p className="mt-1 text-sm text-gray-600">
          Paste a URL and we'll capture the page, discover the data fields, and extract structured data.
        </p>
      </div>

      <div className="mt-8 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !fieldsInput.trim()) handleSubmit();
          }}
          placeholder="https://example.com/products"
          disabled={isPending}
          className="h-11 flex-1 rounded-md border border-gray-300 px-3 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isPending || !url.trim()}
          className="flex h-11 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Analyze
        </button>
      </div>

      <div className="mt-4">
        <label className="text-xs text-gray-600">
          Fields you need <span className="text-gray-400">(optional — one per line or comma-separated)</span>
        </label>
        <textarea
          value={fieldsInput}
          onChange={(e) => setFieldsInput(e.target.value)}
          placeholder={'price\ntitle\nrating\navailability'}
          rows={4}
          disabled={isPending}
          className="mt-1.5 w-full resize-none rounded-md border border-gray-300 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Replace the inline index route in `router.tsx`

Open `packages/dashboard/src/router.tsx`. At the top of the file, add the import:
```tsx
import LandingPage from './routes/landing';
```

Find the `indexRoute` definition. It currently looks like:
```tsx
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Placeholder title="Robot Platform" phase="Phase 2 (Sandbox)" />,
});
```

Change it to:
```tsx
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});
```

If `Placeholder` is no longer imported by `router.tsx` after this change, you may leave the import in place (it's still used by other inline things — verify by re-reading the file) or remove it if the file no longer references it.

### Step 4: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Expected: clean.

### Step 5: Smoke-test in browser

Start both servers (api-server + dashboard):
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
```

Open `http://localhost:3456` in a browser. Confirm:
- The landing page renders with the URL input + textarea + Analyze button.
- Typing an invalid URL shows the "Not a valid URL" error.
- Submitting a valid URL (e.g. `https://example.com`) navigates to `/sandbox/example-com-XXXXXX` (the slug suffix is random).
- Network tab shows a POST to `http://localhost:4000/trpc/sandbox.create` returning 200.

(The destination page is still a placeholder until Task 3.)

Stop both:
```bash
kill $API_PID $DASH_PID 2>/dev/null
```

### Step 6: Commit

```bash
git add packages/dashboard/
git commit -m "feat(dashboard): paste-and-go landing page on /"
```

---

## Task 3: Wizard page (`/sandbox/{slug}`)

The workhorse. Replaces the stub at `packages/dashboard/src/routes/sandbox-detail.tsx` with a state-derived wizard view: spinner during analysis → schema editor → extract spinner → results display.

**Files:**
- Modify: `packages/dashboard/src/routes/sandbox-detail.tsx`

### Step 1: Rewrite the wizard component

Replace the entire contents of `packages/dashboard/src/routes/sandbox-detail.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Loader2, AlertCircle, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { API_URL } from '../lib/api-url';

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

export default function SandboxDetail() {
  const { shortid: slug } = useParams({ from: '/sandbox/$shortid' });
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  // Load source state. Refetches on mutation success.
  const sourceQuery = trpc.sandbox.get.useQuery({ slug });

  // Auto-fire analyze if no schema yet. Guard against StrictMode double-fire.
  const analyzeMutation = trpc.sandbox.analyze.useMutation({
    onSuccess: () => utils.sandbox.get.invalidate({ slug }),
    onError: (err) => setError(err.message),
  });
  const extractMutation = trpc.sandbox.extract.useMutation({
    onSuccess: () => utils.sandbox.get.invalidate({ slug }),
    onError: (err) => setError(err.message),
  });

  const analyzeStartedRef = useRef(false);
  useEffect(() => {
    if (!sourceQuery.data) return;
    const schema = sourceQuery.data.source.selectorsJson as { fields?: unknown[] } | null;
    const hasFields = schema && Array.isArray(schema.fields) && schema.fields.length > 0;
    if (!hasFields && !analyzeStartedRef.current && !analyzeMutation.isPending) {
      analyzeStartedRef.current = true;
      analyzeMutation.mutate({ slug });
    }
  }, [sourceQuery.data, slug, analyzeMutation]);

  // Local field-toggle state, seeded from the source's schema. Re-syncs when source updates.
  const [fields, setFields] = useState<SchemaField[]>([]);
  useEffect(() => {
    if (!sourceQuery.data) return;
    const schema = sourceQuery.data.source.selectorsJson as { fields?: SchemaField[] } | null;
    if (schema && Array.isArray(schema.fields)) {
      setFields(schema.fields.map((f) => ({ ...f, enabled: f.enabled !== false })));
    }
  }, [sourceQuery.data]);

  if (sourceQuery.isLoading) {
    return <Spinner label="Loading..." />;
  }
  if (sourceQuery.isError) {
    return <ErrorBanner message={sourceQuery.error.message} />;
  }
  if (!sourceQuery.data) {
    return <ErrorBanner message={`Sandbox source not found: ${slug}`} />;
  }

  const { source, latestRun, latestExtraction, latestCapture } = sourceQuery.data;
  const schema = source.selectorsJson as {
    fields?: SchemaField[];
    pageType?: string;
    screenshotUrl?: string;
    cached?: boolean;
    cacheStats?: { totalRuns: number; successRate: number };
  } | null;
  const hasSchema = schema && Array.isArray(schema.fields) && schema.fields.length > 0;

  return (
    <div>
      <Header source={source} schema={schema} />

      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

      {!hasSchema && analyzeMutation.isPending && (
        <Spinner label="Capturing page and discovering schema (~30-60s)..." />
      )}

      {!hasSchema && !analyzeMutation.isPending && (
        <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          No schema yet.{' '}
          <button
            className="font-medium text-gray-900 underline"
            onClick={() => {
              analyzeStartedRef.current = true;
              setError(null);
              analyzeMutation.mutate({ slug });
            }}
          >
            Re-run analyze
          </button>
        </div>
      )}

      {hasSchema && (
        <SchemaEditor
          fields={fields}
          onToggle={(name) =>
            setFields((prev) => prev.map((f) => (f.name === name ? { ...f, enabled: f.enabled === false } : f)))
          }
          onToggleAll={(enabled) => setFields((prev) => prev.map((f) => ({ ...f, enabled })))}
          screenshotPath={schema.screenshotUrl ?? latestCapture?.screenshotPath ?? null}
        />
      )}

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

      {extractMutation.isPending && (
        <Spinner label="Running extraction (~30-90s). Leave this tab open." />
      )}

      {latestRun?.status === 'failed' && (
        <ErrorBanner message={`Extraction failed: ${latestRun.errorMessage ?? 'unknown error'}`} />
      )}

      {latestRun?.status === 'completed' && latestExtraction && !extractMutation.isPending && (
        <ResultsTable
          data={Array.isArray(latestExtraction.data) ? (latestExtraction.data as Record<string, unknown>[]) : []}
          confidence={latestExtraction.confidence}
          fields={fields}
        />
      )}
    </div>
  );
}

// ─── Sub-components (inline for v1) ─────────────────────────────────────────

function Header({
  source,
  schema,
}: {
  source: { name: string; urlTemplate: string | null };
  schema: { pageType?: string; cached?: boolean; cacheStats?: { totalRuns: number; successRate: number } } | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-bold tracking-tight">{source.name}</h1>
      {schema?.pageType && (
        <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase text-gray-600">
          {schema.pageType}
        </span>
      )}
      {schema?.cached && schema.cacheStats && (
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          Cached — {schema.cacheStats.totalRuns} runs, {schema.cacheStats.successRate}% reliability
        </span>
      )}
      {source.urlTemplate && (
        <a
          href={source.urlTemplate}
          target="_blank"
          rel="noopener"
          className="ml-auto truncate font-mono text-xs text-gray-500 hover:text-gray-700"
        >
          {source.urlTemplate}
        </a>
      )}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function ErrorBanner({ message, dismiss }: { message: string; dismiss?: () => void }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {dismiss && (
        <button onClick={dismiss} className="text-xs underline">
          dismiss
        </button>
      )}
    </div>
  );
}

function SchemaEditor({
  fields,
  onToggle,
  onToggleAll,
  screenshotPath,
}: {
  fields: SchemaField[];
  onToggle: (name: string) => void;
  onToggleAll: (enabled: boolean) => void;
  screenshotPath: string | null;
}) {
  const allEnabled = fields.every((f) => f.enabled !== false);
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
      <div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="w-8 py-2">
                <input
                  type="checkbox"
                  checked={allEnabled}
                  onChange={() => onToggleAll(!allEnabled)}
                  className="h-4 w-4"
                />
              </th>
              <th className="py-2 text-left font-medium text-gray-600">Field</th>
              <th className="py-2 text-left font-medium text-gray-600">Type</th>
              <th className="py-2 text-left font-medium text-gray-600">Example</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.name} className="border-b last:border-b-0">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={field.enabled !== false}
                    onChange={() => onToggle(field.name)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="py-2 font-mono text-xs">{field.name}</td>
                <td className="py-2 text-xs text-gray-600">{field.type}</td>
                <td className="py-2 font-mono text-xs text-gray-500">
                  {field.example_value ? (
                    <span className="block max-w-[200px] truncate" title={String(field.example_value)}>
                      {String(field.example_value)}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {screenshotPath && (
        <div>
          <img
            src={screenshotPath.startsWith('http') ? screenshotPath : `${API_URL}${screenshotPath}`}
            alt="Page screenshot"
            className="w-full rounded border"
          />
        </div>
      )}
    </div>
  );
}

function ResultsTable({
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
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span className="font-medium">Extraction complete</span>
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

### Step 2: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Expected: clean.

### Step 3: Smoke-test in browser (full flow)

Start both servers:
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
```

Walk through the full flow in a browser:

1. Open `http://localhost:3456`. Paste a real URL (e.g. `https://news.ycombinator.com` for fast iteration — Hacker News is cached and small).
2. Click Analyze. Browser navigates to `/sandbox/news-ycombinator-com-XXXXXX`.
3. Page shows "Capturing page and discovering schema..." spinner.
4. After ~30-60s, schema editor appears with toggleable fields and a screenshot thumbnail.
5. Toggle a few fields off. Click Extract.
6. Page shows "Running extraction..." spinner.
7. After ~10-30s, the results table appears with rows + confidence.
8. Reload the browser. The same `/sandbox/{slug}` URL re-loads the same view (schema + results), no re-running.
9. Open the network tab — verify all calls go to `http://localhost:4000/trpc/sandbox.*`.

If any step fails, fix the issue before committing. Common gotchas:
- StrictMode double-firing the analyze: the `analyzeStartedRef` guard should prevent it.
- Screenshot 404: verify the api-server is serving `/captures/*` and that `screenshotUrl` in the schema starts with `/captures/`.
- Network errors: verify CORS headers (`access-control-allow-origin: http://localhost:3456`).

Stop both servers:
```bash
kill $API_PID $DASH_PID 2>/dev/null
```

### Step 4: Verify DB state after the run

After a successful extraction, check that the DB has the persisted rows:
```bash
/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform <<'SQL'
SELECT s.slug, r.status, r.result_count, e.confidence
FROM sources s
JOIN runs r ON r.source_id = s.id
LEFT JOIN extractions e ON e.run_id = r.id
WHERE s.is_sandbox = true
ORDER BY r.created_at DESC
LIMIT 5;
SQL
```

Expected: rows for the source you just extracted, with `status = 'completed'` and a confidence value.

### Step 5: Commit

```bash
git add packages/dashboard/src/routes/sandbox-detail.tsx
git commit -m "feat(dashboard): sandbox wizard with analyze, schema editor, extract, results"
```

---

## Task 4: Sandbox list (`/sandbox`)

Replace the stub at `packages/dashboard/src/routes/sandbox-index.tsx` with a list of recent Sandbox Sources, each linking to its `/sandbox/{slug}` page.

**Files:**
- Modify: `packages/dashboard/src/routes/sandbox-index.tsx`

### Step 1: Rewrite the list component

Replace the entire contents of `packages/dashboard/src/routes/sandbox-index.tsx` with:

```tsx
import { Link } from '@tanstack/react-router';
import { Loader2, Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';

export default function SandboxIndex() {
  const listQuery = trpc.sandbox.list.useQuery();

  if (listQuery.isLoading) {
    return (
      <div className="mt-8 flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading recent sources...
      </div>
    );
  }

  if (listQuery.isError) {
    return <div className="mt-8 text-sm text-red-600">Error: {listQuery.error.message}</div>;
  }

  const sources = listQuery.data ?? [];

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Sandbox</h1>
      <p className="mt-1 text-sm text-gray-600">
        Throwaway drafts. {sources.length} recent {sources.length === 1 ? 'source' : 'sources'}.
      </p>

      {sources.length === 0 ? (
        <div className="mt-8 rounded-md border border-dashed p-12 text-center text-sm text-gray-500">
          No sandbox sources yet.{' '}
          <Link to="/" className="font-medium text-gray-900 underline">
            Paste a URL
          </Link>{' '}
          to get started.
        </div>
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {sources.map((s) => {
            const host = (() => {
              try {
                return new URL(s.urlTemplate ?? '').hostname.replace(/^www\./, '');
              } catch {
                return s.urlTemplate ?? '';
              }
            })();
            return (
              <li key={s.slug}>
                <Link
                  to="/sandbox/$shortid"
                  params={{ shortid: s.slug }}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
                >
                  <Globe className="h-4 w-4 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate font-mono text-xs text-gray-500">{host}</div>
                  </div>
                  <span className="text-xs text-gray-400">{formatDate(new Date(s.updatedAt))}</span>
                  <ArrowRight className="h-4 w-4 text-gray-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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

### Step 2: Type-check

```bash
cd packages/dashboard && pnpm exec tsc --noEmit
```

Expected: clean.

### Step 3: Smoke-test in browser

Start both servers, open `http://localhost:3456/sandbox`. Expected:
- A header "Sandbox" with a count.
- A list of Sources you've created during testing (including those from Phase 0 back-fill: 2 ikea.com items).
- Clicking a row navigates to `/sandbox/{slug}` and re-renders the wizard.

Verify the count matches `sandbox.list`'s return — at minimum 2 (the back-fill) plus whatever you created during Task 3 testing.

### Step 4: Commit

```bash
git add packages/dashboard/src/routes/sandbox-index.tsx
git commit -m "feat(dashboard): sandbox list page at /sandbox"
```

---

## Task 5: End-to-end verification

**Files:** none (verification only)

### Step 1: Typecheck the workspace

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

All 7 should be clean.

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
- `@robot/api`: 18 (8 scraper + 10 sandbox)
- `@robot/api-server`: 5
- `@robot/scraper`: 54
- `@robot/browser`: 9

Total: ~96 tests. All pass.

### Step 3: Full-flow smoke test

Start both servers:
```bash
pnpm --filter @robot/api-server dev > /tmp/api.log 2>&1 &
API_PID=$!
pnpm --filter @robot/dashboard dev > /tmp/dash.log 2>&1 &
DASH_PID=$!
sleep 5
```

Walk through in a browser (NOT just curl — this validates real UX):

1. Go to `http://localhost:3456`. Paste `https://news.ycombinator.com`. Click Analyze.
2. URL changes to `/sandbox/news-ycombinator-com-XXXXXX`. Spinner shows.
3. Schema editor renders. Confirm at least 3-4 fields are listed with example values.
4. Toggle one field off. Click Extract.
5. Spinner shows during extract.
6. Results table renders with the toggled field absent.
7. Click the browser back button → returns to `/`.
8. Type `/sandbox` in the URL → list page shows the entry you just created.
9. Click the entry → returns to the wizard view with persisted state (no re-running of analyze or extract).
10. Reload the wizard page → same view rehydrates instantly.

If anything fails, debug before declaring done.

### Step 4: DB sanity check

```bash
/opt/homebrew/opt/postgresql@17/bin/psql -d robot_platform <<'SQL'
SELECT
  (SELECT count(*) FROM sources WHERE is_sandbox = true) AS sandbox_sources,
  (SELECT count(*) FROM runs WHERE status = 'completed') AS completed_runs,
  (SELECT count(*) FROM runs WHERE status = 'failed') AS failed_runs,
  (SELECT count(*) FROM captures) AS captures,
  (SELECT count(*) FROM extractions) AS extractions;
SQL
```

Expected:
- `sandbox_sources` ≥ 3 (2 back-fill + at least 1 from testing)
- `completed_runs` ≥ 1
- `failed_runs` = 0 (no failed extractions during testing, hopefully)
- `captures` ≥ 1, `extractions` ≥ 1, linked by `run_id`

### Step 5: Stop servers

```bash
kill $API_PID $DASH_PID 2>/dev/null
```

### Step 6: Final commit (if anything was left over)

```bash
git status
```

If clean, no commit needed. If there's leftover cleanup:
```bash
git add -A
git commit -m "chore(dashboard): final Phase 2 cleanup"
```

---

## Wrap-up checks

- [ ] `/` renders the paste-and-go landing page.
- [ ] Submitting a URL creates a Sandbox Source and navigates to `/sandbox/{slug}`.
- [ ] The wizard page auto-fires analyze, shows schema editor, allows toggles.
- [ ] Extract creates Run + Capture + Extraction rows, displays results.
- [ ] Reload at any step rehydrates the same view from DB state.
- [ ] `/sandbox` lists all Sandbox Sources, ordered by recent activity.
- [ ] Header nav links (`Sandbox`, `Domains`) work — `Domains` is still a placeholder (Phase 5).
- [ ] All 7 packages typecheck clean.
- [ ] All ~96 tests pass.
- [ ] No new console errors during browser walk-through.

---

## Notes for the implementer

- **Inline sub-components in `sandbox-detail.tsx`.** The wizard has `Header`, `Spinner`, `ErrorBanner`, `SchemaEditor`, `ResultsTable` inline. If the file grows beyond ~400 lines, split into `packages/dashboard/src/components/wizard/*.tsx`. Don't split prematurely.
- **No new DB schema changes.** Phase 0 already provisioned everything Phase 2 needs.
- **StrictMode double-fire of analyze.** The `analyzeStartedRef.current` guard handles this. If you see analyze firing twice in dev, verify the ref is being set BEFORE `mutate()`.
- **Screenshot URLs.** `scraper.analyze` returns `/captures/<uuid>.png`. The dashboard composes the full URL via `API_URL + screenshotUrl`. If your screenshot 404s, check that the api-server's `CAPTURES_DIR` matches where `scraper.analyze` writes — both should resolve to `packages/api-server/public/captures/`.
- **Page-type detection.** `scraper.analyze` returns a `page_type` (`detail` | `listing`) in its schema response; we stash it on the Source's `selectors_json`. `sandbox.extract` reads it back to pass to `scraper.extract`. This roundtrip preserves the AI's page-type decision.
- **Run cleanup edge case.** If api-server crashes mid-extraction, the Run row sits at `status='running'` forever. Phase 2 doesn't add stale-detection — users see "Re-extract" works fine to recover. A follow-up cleanup task can add `running` → `stale` after 2 minutes.
- **Out of scope reminders:** No Graduate button, no Project/Dataset views, no DomainIntelligence views. Those are Phase 3+.
