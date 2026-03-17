# Workspace: Run & Inspect — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable running inputs from the workspace, viewing rendered pages in an iframe, and inspecting the DOM with a toggleable inspector panel.

**Architecture:** Backend-first. DB schema changes → API layer → Runner updates → Dashboard UI. Each layer builds on the previous. The workspace extends existing components (`BottomPanel`, `DomViewer`, `ExtractorWorkspace`) rather than replacing them.

**Tech Stack:** Drizzle ORM (Postgres), tRPC v11, Zod, Playwright, Next.js 15 (Server Components + Server Actions), React, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-03-16-workspace-run-and-inspect-design.md`

---

## Chunk 1: Database Schema Changes

### Task 1: Add `sourceId` column and `html` column to `runs` table

**Files:**
- Modify: `packages/db/src/schema.ts:200-220`

- [ ] **Step 1: Make `extractorId` nullable and add `sourceId` + `html` columns**

In `packages/db/src/schema.ts`, update the `runs` table definition (line 200-216):

```typescript
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  extractorId: uuid('extractor_id').references(() => extractors.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  inputLabel: varchar('input_label', { length: 255 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  resultCount: integer('result_count'),
  results: jsonb('results'),
  html: text('html'),
  logs: text('logs'),
  videoUrl: text('video_url'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('runs_extractor_id_idx').on(table.extractorId),
  index('runs_source_id_idx').on(table.sourceId),
  index('runs_status_idx').on(table.status),
]);
```

Key changes:
- `extractorId` — removed `.notNull()` (was `.notNull()` at line 202)
- `sourceId` — new nullable FK to `sources.id`
- `html` — new `text` column for captured HTML (separate from `results` JSONB)
- Added index on `sourceId`

- [ ] **Step 2: Update `runsRelations` for nullable FKs**

Update `runsRelations` (line 218-220):

```typescript
export const runsRelations = relations(runs, ({ one }) => ({
  extractor: one(extractors, { fields: [runs.extractorId], references: [extractors.id] }),
  source: one(sources, { fields: [runs.sourceId], references: [sources.id] }),
}));
```

- [ ] **Step 3: Add `runs` relation to `sourcesRelations`**

Update `sourcesRelations` (line 89-92) to include runs:

```typescript
export const sourcesRelations = relations(sources, ({ one, many }) => ({
  collection: one(collections, { fields: [sources.collectionId], references: [collections.id] }),
  domain: one(domains, { fields: [sources.domainId], references: [domains.id] }),
  runs: many(runs),
}));
```

- [ ] **Step 4: Push schema changes to database**

Run: `cd packages/db && pnpm drizzle-kit push`
Expected: Schema synced, `runs` table updated with new columns.

- [ ] **Step 5: Verify existing data**

Run: `psql` or use Drizzle Studio to confirm existing runs still have their `extractorId` values and new columns are null.

---

### Task 2: Create `sourceInputs` table

**Files:**
- Modify: `packages/db/src/schema.ts` (after `sourcesRelations`, ~line 92)

- [ ] **Step 1: Add `sourceInputs` table definition**

Insert after `sourcesRelations` (line 92):

```typescript
// ─── Source Inputs ────────────────────────────────────────────────────────────

export const sourceInputs = pgTable('source_inputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 255 }).notNull(),
  inputData: jsonb('input_data').notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('source_inputs_source_id_idx').on(table.sourceId),
]);

export const sourceInputsRelations = relations(sourceInputs, ({ one }) => ({
  source: one(sources, { fields: [sourceInputs.sourceId], references: [sources.id] }),
}));
```

- [ ] **Step 2: Add `sourceInputs` to `sourcesRelations`**

Update `sourcesRelations` to include the new `many(sourceInputs)`:

```typescript
export const sourcesRelations = relations(sources, ({ one, many }) => ({
  collection: one(collections, { fields: [sources.collectionId], references: [collections.id] }),
  domain: one(domains, { fields: [sources.domainId], references: [domains.id] }),
  runs: many(runs),
  inputs: many(sourceInputs),
}));
```

- [ ] **Step 3: Export `sourceInputs` from the package**

Make sure `sourceInputs` is exported from `packages/db/src/schema.ts` (it will be auto-exported as a `const export`). Check that the `@robot/db` package.json exports include the schema.

- [ ] **Step 4: Push schema changes**

Run: `cd packages/db && pnpm drizzle-kit push`
Expected: `source_inputs` table created.

- [ ] **Step 5: Commit**

Stage: `packages/db/src/schema.ts`
Message: `feat(db): add sourceId/html to runs, create sourceInputs table`

---

## Chunk 2: API Layer

### Task 3: Update runs router — support `sourceId`

**Files:**
- Modify: `packages/api/src/routers/runs.ts`

- [ ] **Step 1: Update `create` mutation to accept `sourceId` or `extractorId`**

Replace the `create` mutation (lines 44-58):

```typescript
create: publicProcedure
  .input(
    z.object({
      extractorId: z.string().uuid().optional(),
      sourceId: z.string().uuid().optional(),
      inputLabel: z.string().optional(),
    }).refine(
      (data) => data.extractorId || data.sourceId,
      { message: 'Either extractorId or sourceId must be provided' },
    ),
  )
  .mutation(async ({ ctx, input }) => {
    const [run] = await ctx.db.insert(runs).values({
      extractorId: input.extractorId ?? null,
      sourceId: input.sourceId ?? null,
      inputLabel: input.inputLabel ?? null,
      status: 'queued',
    }).returning();
    return run;
  }),
```

- [ ] **Step 2: Add `listBySource` query**

Add after the existing `list` query:

```typescript
listBySource: publicProcedure
  .input(z.object({ sourceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const results = await ctx.db.query.runs.findMany({
      where: eq(runs.sourceId, input.sourceId),
      columns: {
        id: true, status: true, inputLabel: true,
        startedAt: true, completedAt: true, resultCount: true,
        errorMessage: true, createdAt: true,
      },
      orderBy: [desc(runs.createdAt)],
      limit: 50,
    });
    return results;
  }),
```

- [ ] **Step 3: Update imports**

At the top of `runs.ts`, add `sourceInputs` and `sources` to imports:

```typescript
import { runs } from '@robot/db';
```

Note: The API package uses `'@robot/db'` for imports (not `'@robot/db/schema'`). Ensure `sourceInputs` is re-exported from `@robot/db`'s barrel file after Chunk 1.

- [ ] **Step 4: Verify the router compiles**

Run: `cd packages/api && pnpm tsc --noEmit`
Expected: No errors in runs.ts.

---

### Task 4: Create `sourceInputs` router

**Files:**
- Create: `packages/api/src/routers/source-inputs.ts`
- Modify: `packages/api/src/routers/index.ts`

- [ ] **Step 1: Create the source-inputs router**

Create `packages/api/src/routers/source-inputs.ts`:

```typescript
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sourceInputs } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const sourceInputsRouter = router({
  listBySource: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.sourceInputs.findMany({
        where: eq(sourceInputs.sourceId, input.sourceId),
        orderBy: (inputs, { asc }) => [asc(inputs.createdAt)],
      });
      return results;
    }),

  create: publicProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        label: z.string().min(1).max(255),
        inputData: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .insert(sourceInputs)
        .values(input)
        .returning();
      return result;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).max(255).optional(),
        inputData: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [result] = await ctx.db
        .update(sourceInputs)
        .set(data)
        .where(eq(sourceInputs.id, id))
        .returning();
      if (!result) {
        throw new Error(`Source input with id ${id} not found`);
      }
      return result;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .delete(sourceInputs)
        .where(eq(sourceInputs.id, input.id))
        .returning();
      if (!result) {
        throw new Error(`Source input with id ${input.id} not found`);
      }
      return result;
    }),
});
```

- [ ] **Step 2: Register the router**

In `packages/api/src/routers/index.ts`, add:

```typescript
import { sourceInputsRouter } from './source-inputs';
```

And add to the router object:

```typescript
sourceInputs: sourceInputsRouter,
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/api && pnpm tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 4: Commit**

Stage: `packages/api/src/routers/runs.ts`, `packages/api/src/routers/source-inputs.ts`, `packages/api/src/routers/index.ts`
Message: `feat(api): add sourceId support to runs, create sourceInputs router`

---

## Chunk 3: Runner Updates

### Task 5: Update executor to support source-based runs

**Files:**
- Modify: `packages/runner/src/executor.ts`

- [ ] **Step 1: Add source imports**

Update imports at top of `executor.ts`:

```typescript
import { runs, extractors, extractorInputs, sources, sourceInputs } from '@robot/db/schema';
```

- [ ] **Step 2: Add source resolution logic after run loading (line 24)**

After loading the run record (line 24), add source resolution:

```typescript
// Load source or extractor
let params: Record<string, unknown> = {};
let entityLabel = '';
let entityId = '';

if (run.sourceId) {
  // Source-based run
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, run.sourceId!),
    with: { domain: true, collection: { with: { project: { with: { org: true } } } } },
  });
  if (!source) throw new Error(`Source ${run.sourceId!} not found`);

  params = (source.parameters ?? {}) as Record<string, unknown>;
  entityLabel = `${source.collection.project.org.name}/${source.domain?.name ?? 'unknown'}/${source.country}/${source.variant}`;
  entityId = source.id;
  logger.info(`Source: ${entityLabel}`);
} else if (run.extractorId) {
  // Legacy extractor-based run
  const extractor = await db.query.extractors.findFirst({
    where: eq(extractors.id, run.extractorId!),
    with: { domain: true, org: true },
  });
  if (!extractor) throw new Error(`Extractor ${run.extractorId!} not found`);

  params = (extractor.parameters ?? {}) as Record<string, unknown>;
  entityLabel = `${extractor.org.name}/${extractor.domain.name}/${extractor.country}/${extractor.variant}`;
  entityId = extractor.id;
  logger.info(`Extractor: ${entityLabel}`);
} else {
  throw new Error(`Run ${runId} has no sourceId or extractorId`);
}
```

- [ ] **Step 3: Update input loading to support both tables**

Replace the input loading section (lines 37-61):

```typescript
// Load input data
let inputData: Record<string, unknown> = {};
if (run.inputLabel) {
  if (run.sourceId) {
    const input = await db.query.sourceInputs.findFirst({
      where: (t, { and, eq: e }) => and(
        e(t.sourceId, run.sourceId!),
        e(t.label, run.inputLabel!),
      ),
    });
    if (input) {
      inputData = (input.inputData ?? {}) as Record<string, unknown>;
      logger.info(`Using input "${run.inputLabel}": ${JSON.stringify(inputData).slice(0, 200)}`);
    } else {
      logger.warn(`Input "${run.inputLabel}" not found, running without input data`);
    }
  } else {
    const input = await db.query.extractorInputs.findFirst({
      where: (t, { and, eq: e }) => and(
        e(t.extractorId, entityId),
        e(t.label, run.inputLabel!),
      ),
    });
    if (input) {
      inputData = (input.inputData ?? {}) as Record<string, unknown>;
      logger.info(`Using input "${run.inputLabel}": ${JSON.stringify(inputData).slice(0, 200)}`);
    } else {
      logger.warn(`Input "${run.inputLabel}" not found, running without input data`);
    }
  }
} else {
  // Use first available input
  if (run.sourceId) {
    const firstInput = await db.query.sourceInputs.findFirst({
      where: eq(sourceInputs.sourceId, run.sourceId!),
    });
    if (firstInput) {
      inputData = (firstInput.inputData ?? {}) as Record<string, unknown>;
      await db.update(runs).set({ inputLabel: firstInput.label }).where(eq(runs.id, runId));
      logger.info(`Using first input "${firstInput.label}": ${JSON.stringify(inputData).slice(0, 200)}`);
    }
  } else {
    const firstInput = await db.query.extractorInputs.findFirst({
      where: eq(extractorInputs.extractorId, entityId),
    });
    if (firstInput) {
      inputData = (firstInput.inputData ?? {}) as Record<string, unknown>;
      await db.update(runs).set({ inputLabel: firstInput.label }).where(eq(runs.id, runId));
      logger.info(`Using first input "${firstInput.label}": ${JSON.stringify(inputData).slice(0, 200)}`);
    }
  }
}
```

- [ ] **Step 4: Store HTML in the new `html` column**

Update the results storage (lines 207-220). The `html` variable is already captured at line 205. Change the `db.update` call:

```typescript
// Mark success
await db.update(runs)
  .set({
    status: 'completed',
    completedAt: new Date(),
    html: html,  // Store in dedicated text column
    results: {
      screenshotBase64: screenshotBase64.slice(0, 200_000),
      htmlLength: html.length,
      finalUrl: page.url(),
      responseStatus: response.status,
    },
    resultCount: 1,
  })
  .where(eq(runs.id, runId));
```

- [ ] **Step 5: Verify runner compiles**

Run: `cd packages/runner && pnpm tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 6: Manual test — run the worker**

Run: `pnpm --filter @robot/runner worker`
Verify: Worker starts and polls without errors. Create a test run from an existing extractor to confirm backward compatibility.

- [ ] **Step 7: Commit**

Stage: `packages/runner/src/executor.ts`
Message: `feat(runner): support source-based runs, store HTML in dedicated column`

---

## Chunk 4: Dashboard — Source Page Data Loading

### Task 6: Load source inputs and recent runs in the source workspace page

**Files:**
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/[sourceSlug]/page.tsx`

- [ ] **Step 1: Load source inputs and recent runs**

Update the data loading section (lines 17-21) to also fetch inputs and runs:

```typescript
const [source, orgs, allDomains] = await Promise.all([
  api.sources.getBySlug({ orgSlug, projectSlug, collectionSlug, sourceSlug }).catch(() => null),
  api.orgs.list(),
  api.domains.list(),
]);

if (!source) notFound();

// Load source inputs and recent runs
const [inputs, recentRuns] = await Promise.all([
  api.sourceInputs.listBySource({ sourceId: source.id }),
  api.runs.listBySource({ sourceId: source.id }),
]);
```

- [ ] **Step 2: Pass inputs and runs to ExtractorWorkspace**

Update the extractor mapping (lines 55-57) and component props (line 74):

```typescript
const extractor = {
  // ...existing fields...
  inputs: inputs.map((i) => ({
    id: i.id,
    label: i.label,
    inputData: i.inputData,
    createdAt: i.createdAt,
  })),
  credentials: [] as { id: string; environment: string; username: string | null; createdAt: Date }[],
};

// ...and update recentRuns prop:
recentRuns={recentRuns.map((r) => ({
  id: r.id,
  status: r.status,
  inputLabel: r.inputLabel,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
}))}
```

- [ ] **Step 3: Add `sourceId` prop to ExtractorWorkspace**

The workspace needs the source ID to create runs. Add `sourceId` as an optional prop:

In `page.tsx`, add to the ExtractorWorkspace call:
```typescript
sourceId={source.id}
```

In `packages/dashboard/src/components/workspace/extractor-workspace.tsx`, add to `ExtractorWorkspaceProps` (line 21):
```typescript
sourceId?: string;
```

And destructure it in the component function.

- [ ] **Step 4: Verify page loads**

Run: `pnpm --filter @robot/dashboard dev`
Navigate to a source workspace page. Verify it loads without errors (even if inputs are empty).

- [ ] **Step 5: Commit**

Stage: source page.tsx, extractor-workspace.tsx
Message: `feat(dashboard): load source inputs and runs in workspace page`

---

## Chunk 5: Dashboard — Inputs Panel

### Task 7: Create server actions for source inputs

**Files:**
- Create: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/[sourceSlug]/actions.ts`

- [ ] **Step 1: Create server actions**

```typescript
"use server";

import { api } from "@/trpc/server";
import { revalidatePath } from "next/cache";

export async function createSourceInput(sourceId: string, label: string, inputData: Record<string, unknown>) {
  const result = await api.sourceInputs.create({ sourceId, label, inputData });
  revalidatePath(".");
  return result;
}

export async function updateSourceInput(id: string, label: string, inputData: Record<string, unknown>) {
  const result = await api.sourceInputs.update({ id, label, inputData });
  revalidatePath(".");
  return result;
}

export async function deleteSourceInput(id: string) {
  const result = await api.sourceInputs.delete({ id });
  revalidatePath(".");
  return result;
}

export async function createSourceRun(sourceId: string, inputLabel: string) {
  const result = await api.runs.create({ sourceId, inputLabel });
  revalidatePath(".");
  return result;
}

export async function fetchRunData(runId: string) {
  return api.runs.getHtml({ id: runId });
}
```

---

### Task 8: Rewrite inputs panel with progressive key-value form

**Files:**
- Create: `packages/dashboard/src/components/workspace/inputs-panel.tsx`

- [ ] **Step 1: Create the InputsPanel component**

Create `packages/dashboard/src/components/workspace/inputs-panel.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { PlayIcon, PencilIcon, PlusIcon, XIcon, SaveIcon, TrashIcon } from "lucide-react";

interface InputEntry {
  id: string;
  label: string;
  inputData: Record<string, unknown>;
  createdAt: Date;
}

interface InputsPanelProps {
  inputs: InputEntry[];
  sourceId: string;
  onSave: (sourceId: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (id: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onRun: (sourceId: string, inputLabel: string) => Promise<unknown>;
}

type PanelMode =
  | { type: "list" }
  | { type: "create"; keys: string[]; values: Record<string, string> }
  | { type: "edit"; inputId: string; values: Record<string, string>; original: Record<string, string> };

export function InputsPanel({ inputs, sourceId, onSave, onUpdate, onDelete, onRun }: InputsPanelProps) {
  const [mode, setMode] = useState<PanelMode>({ type: "list" });
  const [runningLabel, setRunningLabel] = useState<string | null>(null);

  // Derive keys from the first input
  const templateKeys = inputs.length > 0
    ? Object.keys((inputs[0].inputData ?? {}) as Record<string, unknown>)
    : [];

  const handleAddInput = useCallback(() => {
    if (inputs.length === 0) {
      // First input: editable keys
      setMode({ type: "create", keys: [""], values: {} });
    } else {
      // Subsequent: pre-filled keys, empty values
      const emptyValues: Record<string, string> = {};
      for (const key of templateKeys) emptyValues[key] = "";
      setMode({ type: "create", keys: templateKeys, values: emptyValues });
    }
  }, [inputs.length, templateKeys]);

  const handleEdit = useCallback((input: InputEntry) => {
    const data = (input.inputData ?? {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) values[k] = String(v ?? "");
    setMode({ type: "edit", inputId: input.id, values, original: { ...values } });
  }, []);

  const handleSaveNew = useCallback(async (keys: string[], values: Record<string, string>) => {
    const inputData: Record<string, unknown> = {};
    for (const key of keys) {
      if (key.trim()) inputData[key.trim()] = values[key] ?? "";
    }
    const label = `input-${inputs.length + 1}`;
    await onSave(sourceId, label, inputData);
    setMode({ type: "list" });
  }, [inputs.length, onSave, sourceId]);

  const handleSaveEdit = useCallback(async (inputId: string, values: Record<string, string>) => {
    const input = inputs.find((i) => i.id === inputId);
    if (!input) return;
    const inputData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) inputData[k] = v;
    await onUpdate(inputId, input.label, inputData);
    setMode({ type: "list" });
  }, [inputs, onUpdate]);

  const handleRun = useCallback(async (label: string) => {
    setRunningLabel(label);
    try {
      await onRun(sourceId, label);
    } finally {
      setRunningLabel(null);
    }
  }, [onRun, sourceId]);

  const isDirty = mode.type === "edit"
    ? JSON.stringify(mode.values) !== JSON.stringify(mode.original)
    : false;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="ws-group-header" style={{ cursor: "default" }}>
        Inputs
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[0.55rem] opacity-60">{inputs.length}</span>
          {mode.type === "list" && (
            <button
              onClick={handleAddInput}
              className="flex items-center gap-0.5 text-[0.6rem] transition-colors hover:opacity-80"
              style={{ color: "var(--ws-accent)" }}
            >
              <PlusIcon className="size-3" />
              Add
            </button>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mode.type === "list" && inputs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3">
            <span className="text-[0.65rem]" style={{ color: "var(--ws-text-dim)" }}>
              No inputs yet
            </span>
            <button
              onClick={handleAddInput}
              className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] transition-colors"
              style={{ color: "var(--ws-accent)", background: "var(--ws-accent-surface)" }}
            >
              <PlusIcon className="size-3" />
              Add first input
            </button>
          </div>
        )}

        {/* List mode: show collapsed inputs */}
        {mode.type === "list" && inputs.map((input) => {
          const data = (input.inputData ?? {}) as Record<string, unknown>;
          const preview = Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`).join("  ");
          const isRunning = runningLabel === input.label;

          return (
            <div
              key={input.id}
              className="flex items-center gap-2 px-3 py-1.5"
              style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.65rem] font-medium" style={{ color: "var(--ws-text-muted)" }}>
                  {input.label}
                </div>
                <div className="truncate text-[0.55rem]" style={{ color: "var(--ws-text-dim)" }}>
                  {preview}
                </div>
              </div>
              <button
                onClick={() => handleEdit(input)}
                className="shrink-0 p-0.5 transition-colors hover:opacity-80"
                style={{ color: "var(--ws-text-dim)" }}
                title="Edit"
              >
                <PencilIcon className="size-3" />
              </button>
              <button
                onClick={() => handleRun(input.label)}
                disabled={isRunning}
                className="shrink-0 p-0.5 transition-colors hover:opacity-80 disabled:opacity-30"
                style={{ color: "var(--ws-accent)" }}
                title="Run"
              >
                <PlayIcon className="size-3" />
              </button>
            </div>
          );
        })}

        {/* Create mode */}
        {mode.type === "create" && (
          <CreateInputForm
            keys={mode.keys}
            values={mode.values}
            isFirstInput={inputs.length === 0}
            onSave={handleSaveNew}
            onCancel={() => setMode({ type: "list" })}
          />
        )}

        {/* Edit mode */}
        {mode.type === "edit" && (() => {
          const input = inputs.find((i) => i.id === mode.inputId);
          if (!input) return null;
          const keys = Object.keys((input.inputData ?? {}) as Record<string, unknown>);
          return (
            <EditInputForm
              keys={keys}
              values={mode.values}
              isDirty={isDirty}
              isSaved={!isDirty}
              inputLabel={input.label}
              onValuesChange={(values) => setMode({ ...mode, values })}
              onSave={() => handleSaveEdit(mode.inputId, mode.values)}
              onRun={() => handleRun(input.label)}
              onDelete={async () => { await onDelete(mode.inputId); setMode({ type: "list" }); }}
              onCancel={() => setMode({ type: "list" })}
            />
          );
        })()}
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function CreateInputForm({
  keys: initialKeys,
  values: initialValues,
  isFirstInput,
  onSave,
  onCancel,
}: {
  keys: string[];
  values: Record<string, string>;
  isFirstInput: boolean;
  onSave: (keys: string[], values: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [values, setValues] = useState(initialValues);

  const hasValues = Object.values(values).some((v) => v.trim() !== "");

  return (
    <div className="p-3">
      <div className="flex flex-col gap-2">
        {keys.map((key, i) => (
          <div key={i} className="flex items-center gap-2">
            {isFirstInput ? (
              <input
                className="w-[80px] shrink-0 rounded border px-2 py-1 text-[0.65rem] font-mono"
                style={{ background: "var(--ws-surface)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
                placeholder="key"
                value={key}
                onChange={(e) => {
                  const newKeys = [...keys];
                  newKeys[i] = e.target.value;
                  setKeys(newKeys);
                }}
              />
            ) : (
              <span className="w-[80px] shrink-0 text-[0.65rem]" style={{ color: "var(--ws-text-muted)" }}>
                {key}
              </span>
            )}
            <input
              className="flex-1 rounded border px-2 py-1 text-[0.65rem] font-mono"
              style={{ background: "var(--ws-surface)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
              placeholder="value..."
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
            {isFirstInput && (
              <button
                onClick={() => {
                  const newKeys = keys.filter((_, j) => j !== i);
                  setKeys(newKeys);
                }}
                className="shrink-0 p-0.5"
                style={{ color: "var(--ws-text-dim)" }}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {isFirstInput && (
        <button
          onClick={() => setKeys([...keys, ""])}
          className="mt-2 flex items-center gap-1 text-[0.6rem]"
          style={{ color: "var(--ws-accent)" }}
        >
          <PlusIcon className="size-3" />
          Add field
        </button>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-[0.6rem]"
          style={{ color: "var(--ws-text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(keys, values)}
          disabled={!hasValues}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] disabled:opacity-30"
          style={{ background: "var(--ws-accent-surface)", color: "var(--ws-accent)" }}
        >
          <SaveIcon className="size-3" />
          Save
        </button>
      </div>
    </div>
  );
}

function EditInputForm({
  keys,
  values,
  isDirty,
  isSaved,
  inputLabel,
  onValuesChange,
  onSave,
  onRun,
  onDelete,
  onCancel,
}: {
  keys: string[];
  values: Record<string, string>;
  isDirty: boolean;
  isSaved: boolean;
  inputLabel: string;
  onValuesChange: (values: Record<string, string>) => void;
  onSave: () => Promise<void>;
  onRun: () => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.65rem] font-medium" style={{ color: "var(--ws-text)" }}>{inputLabel}</span>
        <button
          onClick={onDelete}
          className="p-0.5 transition-colors hover:opacity-80"
          style={{ color: "var(--ws-danger)" }}
          title="Delete input"
        >
          <TrashIcon className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-[80px] shrink-0 text-[0.65rem]" style={{ color: "var(--ws-text-muted)" }}>
              {key}
            </span>
            <input
              className="flex-1 rounded border px-2 py-1 text-[0.65rem] font-mono"
              style={{ background: "var(--ws-surface)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
              value={values[key] ?? ""}
              onChange={(e) => onValuesChange({ ...values, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-[0.6rem]"
          style={{ color: "var(--ws-text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!isDirty}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] disabled:opacity-30"
          style={{ background: "var(--ws-accent-surface)", color: "var(--ws-accent)" }}
        >
          <SaveIcon className="size-3" />
          Save
        </button>
        <button
          onClick={onRun}
          disabled={!isSaved}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] disabled:opacity-30"
          style={{ background: "var(--ws-accent)", color: "#fff" }}
        >
          <PlayIcon className="size-3" />
          Run
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire InputsPanel into BottomPanel**

Modify `packages/dashboard/src/components/workspace/bottom-panel.tsx`:

Replace the right panel section (lines 122-176) with the new `InputsPanel` component. Full updated component:

```typescript
import { InputsPanel } from "./inputs-panel";

interface BottomPanelProps {
  runs: Run[];
  inputs: InputEntry[];
  sourceId?: string;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  onSaveInput: (sourceId: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onUpdateInput: (id: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onDeleteInput: (id: string) => Promise<unknown>;
  onRunInput: (sourceId: string, inputLabel: string) => Promise<unknown>;
}
```

Remove: `selectedInputId`, `onSelectInput` props.
Add: `sourceId`, `selectedRunId`, `onSelectRun`, and the input action callbacks.

Update the runs list (lines 51-66) — change `<a>` to `<button>` with `onSelectRun`:
```typescript
<button
  key={run.id}
  type="button"
  onClick={() => onSelectRun(run.id)}
  className="flex w-full items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--ws-surface-hover)]"
  style={{
    borderBottom: '1px solid var(--ws-border-subtle)',
    background: run.id === selectedRunId ? 'var(--ws-accent-surface)' : 'transparent',
    borderLeft: run.id === selectedRunId ? '2px solid var(--ws-accent)' : '2px solid transparent',
  }}
>
  {/* ...existing run row content... */}
</button>
```

Replace the right panel section (lines 122-176) with:
```typescript
{/* ── Right: Inputs panel ──────────────────── */}
<div
  className="flex w-[280px] shrink-0 flex-col overflow-hidden"
  style={{ borderLeft: '1px solid var(--ws-border)' }}
>
  {sourceId ? (
    <InputsPanel
      inputs={inputs.map((i) => ({ ...i, inputData: (i.inputData ?? {}) as Record<string, unknown> }))}
      sourceId={sourceId}
      onSave={onSaveInput}
      onUpdate={onUpdateInput}
      onDelete={onDeleteInput}
      onRun={onRunInput}
    />
  ) : (
    <div className="flex h-full items-center justify-center px-3">
      <span className="text-[0.65rem]" style={{ color: 'var(--ws-text-dim)' }}>Legacy extractor inputs</span>
    </div>
  )}
</div>
```

- [ ] **Step 3: Update ExtractorWorkspace to pass new props**

In `packages/dashboard/src/components/workspace/extractor-workspace.tsx`:

Add `useRouter` import:
```typescript
import { useRouter } from "next/navigation";
```

Add state and router in the component body:
```typescript
const router = useRouter();
const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
```

Update the `BottomPanel` call (currently around line 291-308) to pass the new props. The `sourceId` is already available from props (added in Chunk 4 Task 6 Step 3). Server actions are passed from the page through props — add these to `ExtractorWorkspaceProps`:

```typescript
// Add to ExtractorWorkspaceProps:
onSaveInput?: (sourceId: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
onUpdateInput?: (id: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
onDeleteInput?: (id: string) => Promise<unknown>;
onRunInput?: (sourceId: string, inputLabel: string) => Promise<unknown>;
```

Pass these through in the page.tsx where `ExtractorWorkspace` is used:
```typescript
onSaveInput={createSourceInput}
onUpdateInput={updateSourceInput}
onDeleteInput={deleteSourceInput}
onRunInput={createSourceRun}
```

Wire to BottomPanel:
```typescript
<BottomPanel
  runs={recentRuns}
  inputs={extractor.inputs}
  sourceId={sourceId}
  selectedRunId={selectedRunId}
  onSelectRun={setSelectedRunId}
  onSaveInput={onSaveInput ?? (async () => {})}
  onUpdateInput={onUpdateInput ?? (async () => {})}
  onDeleteInput={onDeleteInput ?? (async () => {})}
  onRunInput={onRunInput ?? (async () => {})}
/>
```

- [ ] **Step 4: Verify the page loads and inputs panel works**

Run: `pnpm --filter @robot/dashboard dev`
Navigate to source workspace. Test: create an input, edit it, run it.

- [ ] **Step 5: Commit**

Stage: actions.ts, inputs-panel.tsx, bottom-panel.tsx, extractor-workspace.tsx
Message: `feat(dashboard): add inputs panel with progressive key-value form and run creation`

---

## Chunk 6: Dashboard — Rendered Page Viewer & DOM Inspector

### Task 9: Create rendered page viewer component

**Files:**
- Create: `packages/dashboard/src/components/workspace/rendered-viewer.tsx`

- [ ] **Step 1: Create the RenderedViewer component**

```typescript
"use client";

import { useState } from "react";
import { EyeIcon, ImageIcon, PanelRightIcon } from "lucide-react";

interface RunResult {
  screenshotBase64?: string;
  htmlLength?: number;
  finalUrl?: string;
  responseStatus?: number;
}

interface RenderedViewerProps {
  html: string | null;
  results: RunResult | null;
  runStatus?: string;
}

type ViewTab = "rendered" | "screenshot";

export function RenderedViewer({ html, results, runStatus }: RenderedViewerProps) {
  const [tab, setTab] = useState<ViewTab>("rendered");
  const [inspectorOpen, setInspectorOpen] = useState(false);

  if (!html && !results) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-full items-center justify-center">
          <p className="text-[0.7rem]" style={{ color: "var(--ws-text-dim)" }}>
            Select a run to view results.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-3 py-1.5"
        style={{ background: "var(--ws-panel-header)", borderBottom: "1px solid var(--ws-border)" }}
      >
        <button
          className="ws-tab"
          data-state={tab === "rendered" ? "active" : "inactive"}
          onClick={() => setTab("rendered")}
        >
          <EyeIcon className="mr-1 inline size-3" />
          Rendered
        </button>
        <button
          className="ws-tab"
          data-state={tab === "screenshot" ? "active" : "inactive"}
          onClick={() => setTab("screenshot")}
        >
          <ImageIcon className="mr-1 inline size-3" />
          Screenshot
        </button>

        <span className="flex-1" />

        {results?.finalUrl && (
          <span className="mr-2 truncate text-[0.55rem]" style={{ color: "var(--ws-text-dim)", maxWidth: 300 }}>
            {results.finalUrl}
          </span>
        )}

        {tab === "rendered" && html && (
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] transition-colors"
            style={{
              color: inspectorOpen ? "var(--ws-accent)" : "var(--ws-text-muted)",
              background: inspectorOpen ? "var(--ws-accent-surface)" : "transparent",
              border: `1px solid ${inspectorOpen ? "var(--ws-accent)" : "var(--ws-border)"}`,
            }}
          >
            <PanelRightIcon className="size-3" />
            Inspector
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {tab === "rendered" && html && (
          <>
            {/* Rendered iframe */}
            <div className={inspectorOpen ? "flex-1 overflow-hidden" : "h-full w-full overflow-hidden"}>
              <iframe
                srcDoc={html}
                sandbox=""
                className="h-full w-full border-0"
                title="Rendered page"
              />
            </div>

            {/* DOM Inspector panel */}
            {inspectorOpen && (
              <DomInspector html={html} />
            )}
          </>
        )}

        {tab === "screenshot" && results?.screenshotBase64 && (
          <div className="flex-1 overflow-auto p-4">
            <img
              src={`data:image/png;base64,${results.screenshotBase64}`}
              alt="Page screenshot"
              className="max-w-full rounded border"
              style={{ borderColor: "var(--ws-border)" }}
            />
          </div>
        )}

        {tab === "screenshot" && !results?.screenshotBase64 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[0.7rem]" style={{ color: "var(--ws-text-dim)" }}>No screenshot available.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── DOM Inspector ──────────────────────────────────────── */

function DomInspector({ html }: { html: string }) {
  // Parse HTML into a tree structure for display
  // For now, use a simple approach: render the HTML as syntax-highlighted text
  // Note: Spec lists hover-linking (highlight iframe element on DOM hover) as in-scope.
  // This plan defers it to a follow-up — the initial DOM inspector shows a static tree only.

  return (
    <div
      className="flex w-[42%] shrink-0 flex-col overflow-hidden"
      style={{ borderLeft: "1px solid var(--ws-border)", background: "var(--ws-surface)" }}
    >
      <div
        className="flex items-center px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--ws-border)" }}
      >
        <span className="text-[0.6rem] font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-muted)" }}>
          Elements
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <DomTree html={html} />
      </div>
    </div>
  );
}

function DomTree({ html }: { html: string }) {
  // Parse the HTML string into a simple DOM tree using DOMParser
  // This runs client-side since we're in a "use client" component
  const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  if (!parser) return null;

  const doc = parser.parseFromString(html, "text/html");

  return (
    <div className="font-mono text-[0.6rem] leading-relaxed">
      <DomNode node={doc.documentElement} depth={0} />
    </div>
  );
}

function DomNode({ node, depth }: { node: Element; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const childElements = Array.from(node.children);
  const hasChildren = childElements.length > 0;
  const indent = depth * 12;

  // Build attribute string
  const attrs = Array.from(node.attributes)
    .filter((a) => a.name !== "xmlns")
    .map((a) => (
      <span key={a.name}>
        {" "}
        <span style={{ color: "var(--ws-text-dim)" }}>{a.name}</span>
        <span style={{ color: "var(--ws-text-dim)" }}>=</span>
        <span style={{ color: "var(--ws-accent)" }}>&quot;{a.value.slice(0, 60)}{a.value.length > 60 ? "…" : ""}&quot;</span>
      </span>
    ));

  // Text content (only if no child elements)
  const textContent = !hasChildren && node.textContent?.trim()
    ? node.textContent.trim().slice(0, 80)
    : null;

  return (
    <div>
      <div
        className="flex cursor-pointer items-start hover:bg-[var(--ws-surface-hover)]"
        style={{ paddingLeft: indent }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <span className="mr-1 w-3 shrink-0 text-center" style={{ color: "var(--ws-text-dim)" }}>
          {hasChildren ? (expanded ? "▼" : "▶") : " "}
        </span>
        <span>
          <span style={{ color: "var(--ws-text-muted)" }}>&lt;</span>
          <span style={{ color: "var(--ws-warning)" }}>{node.tagName.toLowerCase()}</span>
          {attrs}
          <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
          {textContent && (
            <span style={{ color: "var(--ws-text)" }}>{textContent}</span>
          )}
          {!hasChildren && (
            <>
              <span style={{ color: "var(--ws-text-muted)" }}>&lt;/</span>
              <span style={{ color: "var(--ws-warning)" }}>{node.tagName.toLowerCase()}</span>
              <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
            </>
          )}
        </span>
      </div>
      {expanded && childElements.map((child, i) => (
        <DomNode key={i} node={child} depth={depth + 1} />
      ))}
      {expanded && hasChildren && (
        <div style={{ paddingLeft: indent }}>
          <span className="ml-4">
            <span style={{ color: "var(--ws-text-muted)" }}>&lt;/</span>
            <span style={{ color: "var(--ws-warning)" }}>{node.tagName.toLowerCase()}</span>
            <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
          </span>
        </div>
      )}
    </div>
  );
}
```

---

### Task 10: Replace DomViewer with RenderedViewer in ExtractorWorkspace

**Files:**
- Modify: `packages/dashboard/src/components/workspace/extractor-workspace.tsx`

- [ ] **Step 1: Add run data fetching state**

Add state for selected run data and polling:

```typescript
const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
const [selectedRunHtml, setSelectedRunHtml] = useState<string | null>(null);
const [selectedRunResults, setSelectedRunResults] = useState<RunResult | null>(null);
const [selectedRunStatus, setSelectedRunStatus] = useState<string | null>(null);
const loadedRunIdRef = useRef<string | null>(null);
```

- [ ] **Step 2: Add polling for active runs**

Add a `useEffect` that polls for run status updates when a run is queued or running:

```typescript
useEffect(() => {
  if (!selectedRunId) return;
  const run = recentRuns.find((r) => r.id === selectedRunId);
  if (!run || run.status === "completed" || run.status === "failed") return;

  const interval = setInterval(async () => {
    // Trigger page refresh to get updated run status
    router.refresh();
  }, 2000);

  return () => clearInterval(interval);
}, [selectedRunId, recentRuns]);
```

- [ ] **Step 3: Fetch run HTML when a completed run is selected**

Add an effect to load run data:

```typescript
useEffect(() => {
  if (!selectedRunId) return;
  const run = recentRuns.find((r) => r.id === selectedRunId);
  if (!run || run.status !== "completed") {
    setSelectedRunHtml(null);
    setSelectedRunResults(null);
    setSelectedRunStatus(run?.status ?? null);
    return;
  }

  setSelectedRunStatus(run.status);

  // Guard: skip re-fetch if we already have HTML for this run ID
  // (polling refreshes recentRuns every 2s — don't re-download 500KB HTML each time)
  if (loadedRunIdRef.current === selectedRunId) return;

  // Fetch HTML via dedicated getHtml endpoint (avoids loading full run object)
  fetchRunData(selectedRunId).then((data) => {
    if (data) {
      setSelectedRunHtml(data.html ?? null);
      loadedRunIdRef.current = selectedRunId;
    }
  });
}, [selectedRunId, recentRuns]);
```

This requires a new server action `fetchRunData` in the source page actions file. Use the dedicated `getHtml` endpoint (Task 11) to avoid fetching the full run object:

```typescript
export async function fetchRunData(runId: string) {
  return api.runs.getHtml({ id: runId });
}
```

And the `runs.getById` query needs to return the `html` column. Update in `packages/api/src/routers/runs.ts`.

> **Note:** The existing `getById` uses `with: { extractor: { with: { org, domain } } }`. When `extractorId` is null (source-based runs), Drizzle returns `extractor: null` — no crash, but callers must handle the null. The `fetchRunData` action only reads `html`, `results`, `status`, so this is safe.

- [ ] **Step 4: Replace DomViewer with RenderedViewer**

In the main content area of ExtractorWorkspace, replace:
```typescript
<DomViewer lastRunId={...} lastRunStatus={...} />
```
with:
```typescript
<RenderedViewer
  html={selectedRunHtml}
  results={selectedRunResults}
  runStatus={selectedRunStatus ?? undefined}
/>
```

- [ ] **Step 5: Verify full flow end-to-end**

1. Navigate to source workspace
2. Create an input with a URL
3. Save the input
4. Click Run
5. See run appear in runs list as "queued" → "running" → "completed"
6. Click completed run
7. See rendered page in iframe
8. Switch to Screenshot tab
9. Toggle Inspector — see DOM tree

- [ ] **Step 6: Commit**

Stage: rendered-viewer.tsx, extractor-workspace.tsx, source page actions.ts, runs.ts
Message: `feat(dashboard): add rendered page viewer with DOM inspector`

---

## Chunk 7: Final Integration & Cleanup

### Task 11: Add `html` field to `runs.getById` response

**Files:**
- Modify: `packages/api/src/routers/runs.ts`

- [ ] **Step 1: Update `getById` to include html**

The `getById` query uses `db.query.runs.findFirst` which returns all columns by default, including the new `html` column. Verify this works by checking the response includes `html`. If not, add explicit column selection.

- [ ] **Step 2: Add a dedicated `getHtml` endpoint**

Since HTML can be 500KB, add a dedicated endpoint to avoid loading it when only metadata is needed. Update `fetchRunData` in the actions file to use this instead of `getById`:

```typescript
getHtml: publicProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const run = await ctx.db.query.runs.findFirst({
      where: eq(runs.id, input.id),
      columns: { id: true, html: true },
    });
    if (!run) throw new Error(`Run ${input.id} not found`);
    return { html: run.html };
  }),
```

- [ ] **Step 3: Update `listBySource` to NOT include html (performance)**

Ensure the list query only returns metadata, not the heavy `html` column:

```typescript
listBySource: publicProcedure
  .input(z.object({ sourceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const results = await ctx.db.query.runs.findMany({
      where: eq(runs.sourceId, input.sourceId),
      columns: {
        id: true, status: true, inputLabel: true,
        startedAt: true, completedAt: true, resultCount: true,
        errorMessage: true, createdAt: true,
      },
      orderBy: [desc(runs.createdAt)],
      limit: 50,
    });
    return results;
  }),
```

---

### Task 12: Remove old DomViewer component

**Files:**
- Delete: `packages/dashboard/src/components/workspace/dom-viewer.tsx`
- Modify: `packages/dashboard/src/components/workspace/extractor-workspace.tsx` (remove import)

- [ ] **Step 1: Remove DomViewer import and usage**

Remove `import { DomViewer } from "./dom-viewer";` from extractor-workspace.tsx.
Delete `dom-viewer.tsx`.

- [ ] **Step 2: Verify no broken imports**

Run: `pnpm --filter @robot/dashboard build`
Expected: Clean build.

- [ ] **Step 3: Final commit**

Stage: all modified files
Message: `feat: workspace run & inspect milestone complete`
