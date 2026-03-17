# Source Creation Form Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the source creation form into three sections (Schema, Extractor Config, Platform Config), rename `domain` to `runnerFramework`, add schema inheritance from collections, and add an inline domain picker.

**Architecture:** Backend-first — rename DB column and add new column, update API router, then redesign the dashboard form component. The Drizzle relation named `domain` (FK join to domains table) stays unchanged; only the varchar column is renamed.

**Tech Stack:** Drizzle ORM, tRPC v11, Next.js 15, React, SearchSelect component, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-03-17-source-creation-redesign.md`

---

## Chunk 1: Database & API Changes

### Task 1: Rename `sources.domain` column to `runner_framework`

**Files:**
- Modify: `packages/db/src/schema.ts:76`

- [ ] **Step 1: Run manual SQL rename**

Run against the local database:
```sql
ALTER TABLE sources RENAME COLUMN domain TO runner_framework;
```

This must be done manually because `drizzle-kit push` treats column renames as DROP + ADD, which loses data.

- [ ] **Step 2: Update Drizzle schema definition**

In `packages/db/src/schema.ts`, change line 76 from:
```typescript
domain: varchar('domain', { length: 50 }),
```
to:
```typescript
runnerFramework: varchar('runner_framework', { length: 50 }),
```

**Important:** Do NOT touch the `sourcesRelations` definition — the relation named `domain` (line 91, FK join to domains table via `domainId`) stays unchanged.

- [ ] **Step 3: Add `schemaValues` column**

In `packages/db/src/schema.ts`, add after the `runnerFramework` line:
```typescript
schemaValues: jsonb('schema_values').notNull().default({}),
```

- [ ] **Step 4: Run `drizzle-kit push`**

```bash
cd packages/db && pnpm drizzle-kit push
```

This syncs the new `schema_values` column. The `runner_framework` rename was already handled by manual SQL.

- [ ] **Step 5: Verify**

```bash
cd packages/db && pnpm drizzle-kit studio
```

Confirm `sources` table has `runner_framework` and `schema_values` columns.

---

### Task 2: Update `sources` API router

**Files:**
- Modify: `packages/api/src/routers/sources.ts:1-131`

- [ ] **Step 1: Update `listByCollection` query**

In `packages/api/src/routers/sources.ts`, change line 25 from:
```typescript
domain: sources.domain,
```
to:
```typescript
runnerFramework: sources.runnerFramework,
schemaValues: sources.schemaValues,
```

- [ ] **Step 2: Update `create` mutation input schema**

Replace line 121:
```typescript
domain: z.string().max(50).nullish(),
```
with:
```typescript
runnerFramework: z.string().max(50).nullish(),
schemaValues: z.record(z.string()).optional().default({}),
```

- [ ] **Step 3: Add `update` mutation**

Add after the `create` mutation (after line 130):
```typescript
update: publicProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      domainId: z.string().uuid().nullish(),
      name: z.string().min(1).max(255).optional(),
      slug: z.string().min(1).max(255).optional(),
      country: z.string().min(1).max(10).optional(),
      locale: z.string().max(10).nullish(),
      currency: z.string().max(10).nullish(),
      dataCenter: z.string().max(10).nullish(),
      proxyType: z.string().max(50).nullish(),
      loginPool: z.string().max(100).nullish(),
      maximumInputs: z.number().int().positive().nullish(),
      runnerFramework: z.string().max(50).nullish(),
      variant: z.string().max(50).optional(),
      robotTemplate: z.string().max(255).optional(),
      parameters: z.record(z.unknown()).optional(),
      schemaValues: z.record(z.string()).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    const [source] = await ctx.db
      .update(sources)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sources.id, id))
      .returning();

    if (!source) {
      throw new Error(`Source with id ${id} not found`);
    }

    return source;
  }),
```

- [ ] **Step 4: Verify API compiles**

```bash
cd packages/api && pnpm tsc --noEmit
```

---

### Task 3: Rename constant and update dashboard references

**Files:**
- Modify: `packages/dashboard/src/lib/constants.ts:157-160`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/actions.ts`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/collection-shell.tsx`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/layout.tsx`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/page.tsx`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/sources-layout.tsx`

- [ ] **Step 1: Rename constant in constants.ts**

Change lines 157-160 from:
```typescript
// Domain options (for source creation)
export const DOMAIN_OPTIONS: string[] = [
  "balancer", "nightmare",
];
```
to:
```typescript
// Runner framework options (for source creation)
export const RUNNER_FRAMEWORK_OPTIONS: string[] = [
  "balancer", "nightmare",
];
```

- [ ] **Step 2: Update sources/actions.ts**

Replace the `domain` field in the `createSource` function parameter type:
```typescript
export async function createSource(data: {
  collectionId: string;
  name: string;
  slug: string;
  country: string;
  locale?: string | null;
  currency?: string | null;
  dataCenter?: string | null;
  proxyType?: string | null;
  loginPool?: string | null;
  maximumInputs?: number | null;
  runnerFramework?: string | null;
  domainId?: string | null;
  variant?: string;
  robotTemplate?: string;
  schemaValues?: Record<string, string>;
}): Promise<{ slug: string }> {
  const source = await api.sources.create(data);
  return { slug: source.slug };
}
```

- [ ] **Step 3: Update layout.tsx sources mapping**

In `layout.tsx`, update the sources mapping (lines 29-44) to rename `domain` and add the new fields needed by SourceForm view mode:
```typescript
const sources = sourcesData.map((s) => ({
  id: s.id,
  name: s.name,
  slug: s.slug,
  href: `${sourcesBasePath}/${s.slug}`,
  country: s.country,
  locale: s.locale,
  currency: s.currency,
  runnerFramework: s.runnerFramework,
  dataCenter: s.dataCenter,
  proxyType: s.proxyType,
  loginPool: s.loginPool,
  maximumInputs: s.maximumInputs,
  isActive: s.isActive,
  updatedAt: s.updatedAt,
  domainId: s.domainId,
  robotTemplate: s.robotTemplate,
  variant: s.variant,
  schemaValues: (s.schemaValues ?? {}) as Record<string, string>,
}));
```

- [ ] **Step 4: Update sources/page.tsx**

Change `domain: s.domain,` (line 29) to:
```typescript
runnerFramework: s.runnerFramework,
```

- [ ] **Step 5: Update collection-shell.tsx interfaces**

In `collection-shell.tsx`, update the `SourceItem` interface (lines 10-25). Change `domain: string | null;` (line 18) to `runnerFramework: string | null;`. Add new fields needed by SourceForm in view mode:
```typescript
interface SourceItem {
  id: string;
  name: string;
  slug: string;
  href: string;
  country: string;
  locale: string | null;
  currency: string | null;
  runnerFramework: string | null;
  dataCenter: string | null;
  proxyType: string | null;
  loginPool: string | null;
  maximumInputs: number | null;
  isActive: boolean;
  updatedAt: Date;
  domainId: string | null;
  robotTemplate: string;
  variant: string;
  schemaValues: Record<string, string>;
}
```

Update `CollectionShellProps` (lines 27-47): rename `domain` in `onCreateSource`, and add new props:
```typescript
interface CollectionShellProps {
  sources: SourceItem[];
  collectionId: string;
  basePath: string;
  hasSchema: boolean;
  collectionSchema: Array<{ name: string; type: string; required: boolean; description?: string }>;
  domains: Array<{ id: string; name: string }>;
  onCreateSource: (data: {
    collectionId: string;
    name: string;
    slug: string;
    country: string;
    locale?: string | null;
    currency?: string | null;
    runnerFramework?: string | null;
    dataCenter?: string | null;
    proxyType?: string | null;
    loginPool?: string | null;
    maximumInputs?: number | null;
    domainId?: string | null;
    variant?: string;
    robotTemplate?: string;
    schemaValues?: Record<string, string>;
  }) => Promise<{ slug: string }>;
  onCreateDomain: (name: string) => Promise<{ id: string; name: string }>;
  header: React.ReactNode;
  children: React.ReactNode;
}
```

Update the component destructuring (line 54-62) to include `collectionSchema`, `domains`, `onCreateDomain`.

- [ ] **Step 5b: Update collection-shell.tsx display and SourceForm render sites**

Change the display logic (line 154) from:
```typescript
{s.domain ? ` · ${s.domain}` : ""}
```
to:
```typescript
{s.runnerFramework ? ` · ${s.runnerFramework}` : ""}
```

Update both `<SourceForm>` render sites (lines 215-234) to pass new props:
```tsx
{panel?.mode === "create" ? (
  <SourceForm
    mode="create"
    existingSlugs={sources.map((s) => s.slug)}
    collectionId={collectionId}
    onSubmit={onCreateSource}
    onClose={() => setPanel(null)}
    collectionSchema={collectionSchema}
    domains={domains}
    onCreateDomain={onCreateDomain}
  />
) : panel?.mode === "view" && selectedSource ? (
  <SourceForm
    key={selectedSource.slug}
    mode="view"
    source={selectedSource}
    existingSlugs={sources
      .filter((s) => s.slug !== selectedSource.slug)
      .map((s) => s.slug)}
    collectionId={collectionId}
    onSubmit={onCreateSource}
    onClose={() => setPanel(null)}
    collectionSchema={collectionSchema}
    domains={domains}
    onCreateDomain={onCreateDomain}
  />
) : null}
```

- [ ] **Step 6: Update sources-layout.tsx**

Change the interface property (line 15) from `domain: string | null;` to `runnerFramework: string | null;`.

Change the display logic (lines 114-115) from:
```typescript
{item.domain && (
  <Detail icon={<ServerIcon className="size-2.5" />} label={item.domain} />
)}
```
to:
```typescript
{item.runnerFramework && (
  <Detail icon={<ServerIcon className="size-2.5" />} label={item.runnerFramework} />
)}
```

- [ ] **Step 7: Verify dashboard compiles**

```bash
cd packages/dashboard && pnpm tsc --noEmit
```

---

## Chunk 2: Source Form Redesign

### Task 4: Restructure `source-form.tsx` with three sections

**Files:**
- Modify: `packages/dashboard/src/components/source-form.tsx:1-337`

- [ ] **Step 1: Update imports and constants**

Replace the import of `DOMAIN_OPTIONS` with `RUNNER_FRAMEWORK_OPTIONS`:
```typescript
import { COUNTRIES, LANGUAGES, CURRENCIES, DATA_CENTERS, PROXY_TYPES, LOGIN_POOLS, RUNNER_FRAMEWORK_OPTIONS } from "@/lib/constants";
```

Replace `domainOptions` (line 54):
```typescript
const runnerFrameworkOptions = RUNNER_FRAMEWORK_OPTIONS.map((rf) => ({ value: rf, label: rf }));
```

- [ ] **Step 2: Update interfaces**

Replace `SourceData` interface (lines 9-23):
```typescript
interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

interface Domain {
  id: string;
  name: string;
}

interface SourceData {
  id: string;
  name: string;
  slug: string;
  country: string;
  locale: string | null;
  currency: string | null;
  runnerFramework: string | null;
  dataCenter: string | null;
  proxyType: string | null;
  loginPool: string | null;
  maximumInputs: number | null;
  isActive: boolean;
  updatedAt: Date;
  domainId: string | null;
  robotTemplate: string;
  variant: string;
  schemaValues: Record<string, string>;
}
```

Replace `SourceFormProps` interface (lines 25-44):
```typescript
interface SourceFormProps {
  mode: "create" | "view";
  source?: SourceData;
  existingSlugs: string[];
  collectionId: string;
  onSubmit: (data: {
    collectionId: string;
    name: string;
    slug: string;
    country: string;
    locale?: string | null;
    currency?: string | null;
    runnerFramework?: string | null;
    dataCenter?: string | null;
    proxyType?: string | null;
    loginPool?: string | null;
    maximumInputs?: number | null;
    domainId?: string | null;
    variant?: string;
    robotTemplate?: string;
    schemaValues?: Record<string, string>;
  }) => Promise<{ slug: string }>;
  onClose: () => void;
  collectionSchema: SchemaField[];
  domains: Domain[];
  onCreateDomain: (name: string) => Promise<Domain>;
}
```

- [ ] **Step 3: Update component state**

**Preserve these existing derived values** (they must remain in the component):
```typescript
// Keep the existing destructuring: mode: initialMode
const [editing, setEditing] = useState(initialMode === "create");
const chain = useMemo(() => (name && country ? toChain(name, country) : ""), [name, country]);
const slug = chain;
const isView = initialMode === "view" && !editing;
```

Replace the state declarations (lines 70-78). Remove `domain` state, add new states:
```typescript
// Platform config
const [name, setName] = useState(source?.name ?? "");
const [country, setCountry] = useState(source?.country ?? "");
const [locale, setLocale] = useState(source?.locale ?? "");
const [currency, setCurrency] = useState(source?.currency ?? "");
const [runnerFramework, setRunnerFramework] = useState(source?.runnerFramework ?? "");
const [dataCenter, setDataCenter] = useState(source?.dataCenter ?? "");
const [proxyType, setProxyType] = useState(source?.proxyType ?? "");
const [loginPool, setLoginPool] = useState(source?.loginPool ?? "");
const [maximumInputs, setMaximumInputs] = useState(source?.maximumInputs?.toString() ?? "");

// Extractor config
const [domainId, setDomainId] = useState(source?.domainId ?? "");
const [robotTemplate, setRobotTemplate] = useState(source?.robotTemplate ?? "robots/san-antonio");
const [variant, setVariant] = useState(source?.variant ?? "default");

// Schema values — init from source or empty values for collection fields
const [schemaValues, setSchemaValues] = useState<Record<string, string>>(() => {
  if (source?.schemaValues) return source.schemaValues;
  const initial: Record<string, string> = {};
  for (const field of collectionSchema) {
    initial[field.name] = "";
  }
  return initial;
});

// Source-specific extra fields (not in collection schema)
const [extraFields, setExtraFields] = useState<{ name: string; value: string }[]>(() => {
  if (!source?.schemaValues) return [];
  const collectionFieldNames = new Set(collectionSchema.map((f) => f.name));
  return Object.entries(source.schemaValues)
    .filter(([key]) => !collectionFieldNames.has(key))
    .map(([name, value]) => ({ name, value }));
});

// Domain picker
const [availableDomains, setAvailableDomains] = useState<Domain[]>(domains);
const [creatingDomain, setCreatingDomain] = useState(false);

const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState("");
```

- [ ] **Step 4: Update handleSubmit**

Replace the `handleSubmit` function to include new fields:
```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  const err = validate();
  if (err) { setError(err); return; }
  setSubmitting(true);
  setError("");
  try {
    // Merge collection schema values with extra fields
    const allSchemaValues: Record<string, string> = { ...schemaValues };
    for (const ef of extraFields) {
      if (ef.name.trim()) {
        allSchemaValues[ef.name.trim()] = ef.value;
      }
    }

    await onSubmit({
      collectionId,
      name: name.trim(),
      slug,
      country,
      locale: locale || null,
      currency: currency || null,
      runnerFramework: runnerFramework || null,
      dataCenter: dataCenter || null,
      proxyType: proxyType || null,
      loginPool: loginPool || null,
      maximumInputs: maximumInputs ? parseInt(maximumInputs, 10) : null,
      domainId: domainId || null,
      variant,
      robotTemplate,
      schemaValues: allSchemaValues,
    });
    router.refresh();
    if (initialMode === "create") onClose();
  } catch {
    setError("Failed to save source.");
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 5: Add domain creation handler**

Add after state declarations:
```typescript
const handleCreateDomain = async (domainName: string) => {
  setCreatingDomain(true);
  try {
    const newDomain = await onCreateDomain(domainName);
    setAvailableDomains((prev) => [...prev, newDomain].sort((a, b) => a.name.localeCompare(b.name)));
    setDomainId(newDomain.id);
  } catch {
    setError("Failed to create domain.");
  } finally {
    setCreatingDomain(false);
  }
};
```

- [ ] **Step 6: Rewrite form JSX with three fieldsets**

Replace the entire `<form>` body with three fieldsets. The full JSX:

**Fieldset A: Schema**
```tsx
<fieldset>
  <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
    Schema
  </legend>
  <div className="space-y-2">
    {collectionSchema.map((field) => (
      <div key={field.name} className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[0.6rem] font-mono truncate" style={{ color: "var(--ws-text-muted)" }} title={field.name}>
          {field.name}
        </span>
        {isView ? (
          <ReadOnly value={schemaValues[field.name] || "—"} />
        ) : (
          <input
            type="text"
            value={schemaValues[field.name] || ""}
            onChange={(e) => setSchemaValues({ ...schemaValues, [field.name]: e.target.value })}
            placeholder={`selector for ${field.name}`}
            className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono outline-none"
            style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
          />
        )}
        <span className="shrink-0 text-[0.55rem] font-mono" style={{ color: "var(--ws-text-dim)" }}>
          {field.type}
        </span>
      </div>
    ))}

    {/* Source-specific extra fields */}
    {extraFields.map((ef, i) => (
      <div key={i} className="flex items-center gap-2">
        {isView ? (
          <span className="w-28 shrink-0 text-[0.6rem] font-mono truncate" style={{ color: "var(--ws-accent)" }} title={ef.name}>
            {ef.name}
          </span>
        ) : (
          <input
            type="text"
            value={ef.name}
            onChange={(e) => {
              const next = [...extraFields];
              next[i] = { ...next[i], name: e.target.value };
              setExtraFields(next);
            }}
            placeholder="field_name"
            className="w-28 shrink-0 rounded px-2 py-1.5 text-[0.6rem] font-mono outline-none"
            style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-accent-muted)", color: "var(--ws-accent)" }}
          />
        )}
        {isView ? (
          <ReadOnly value={ef.value || "—"} />
        ) : (
          <input
            type="text"
            value={ef.value}
            onChange={(e) => {
              const next = [...extraFields];
              next[i] = { ...next[i], value: e.target.value };
              setExtraFields(next);
            }}
            placeholder="selector"
            className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono outline-none"
            style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
          />
        )}
        {!isView && (
          <button
            type="button"
            onClick={() => setExtraFields(extraFields.filter((_, j) => j !== i))}
            className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
          >
            <XIcon className="size-2.5" style={{ color: "var(--ws-text-dim)" }} />
          </button>
        )}
      </div>
    ))}

    {!isView && (
      <button
        type="button"
        onClick={() => setExtraFields([...extraFields, { name: "", value: "" }])}
        className="flex items-center gap-1 text-[0.6rem] font-medium transition-colors hover:underline"
        style={{ color: "var(--ws-accent)" }}
      >
        <PlusIcon className="size-2.5" />
        Add source-specific field
      </button>
    )}
  </div>
</fieldset>
```

**Fieldset B: Extractor Config**
```tsx
<fieldset>
  <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
    Extractor Config
  </legend>
  <div className="space-y-3">
    <Field label="Robot Template">
      {isView ? (
        <ReadOnly value={robotTemplate} />
      ) : (
        <input
          type="text"
          value={robotTemplate}
          onChange={(e) => setRobotTemplate(e.target.value)}
          placeholder="robots/san-antonio"
          className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
        />
      )}
    </Field>

    <Field label="Country">
      {isView ? (
        <ReadOnly value={country} />
      ) : (
        <SearchSelect options={countryOptions} value={country} onChange={setCountry} placeholder="Select country..." />
      )}
    </Field>

    <Field label="Domain">
      {isView ? (
        <ReadOnly value={availableDomains.find((d) => d.id === domainId)?.name || "—"} />
      ) : (
        <DomainPicker
          domains={availableDomains}
          value={domainId}
          onChange={setDomainId}
          onCreateNew={handleCreateDomain}
          creating={creatingDomain}
        />
      )}
    </Field>

    <Field label="Schema Variant">
      {isView ? (
        <ReadOnly value={variant} />
      ) : (
        <input
          type="text"
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
          placeholder="e.g. singlePage, multiPages, screenshots"
          className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
        />
      )}
    </Field>
  </div>
</fieldset>
```

**Fieldset C: Platform Config**
```tsx
<fieldset>
  <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
    Platform Config
  </legend>
  <div className="space-y-3">
    <Field label="Name">
      {isView ? (
        <ReadOnly value={name} />
      ) : (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Best Buy"
          className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
        />
      )}
    </Field>

    <Field label="Runner Framework">
      {isView ? (
        <ReadOnly value={runnerFramework || "—"} />
      ) : (
        <SearchSelect options={runnerFrameworkOptions} value={runnerFramework} onChange={setRunnerFramework} placeholder="Select runner framework..." />
      )}
    </Field>

    <Field label="Locale">
      {isView ? (
        <ReadOnly value={locale || "—"} />
      ) : (
        <SearchSelect options={localeOptions} value={locale} onChange={setLocale} placeholder="Select locale..." />
      )}
    </Field>

    <Field label="Currency">
      {isView ? (
        <ReadOnly value={currency || "—"} />
      ) : (
        <SearchSelect options={currencyOptions} value={currency} onChange={setCurrency} placeholder="Select currency..." />
      )}
    </Field>

    <Field label="Data Center">
      {isView ? (
        <ReadOnly value={dataCenter || "—"} />
      ) : (
        <SearchSelect options={dataCenterOptions} value={dataCenter} onChange={setDataCenter} placeholder="Select data center..." />
      )}
    </Field>

    <Field label="Proxy Type">
      {isView ? (
        <ReadOnly value={proxyType || "—"} />
      ) : (
        <SearchSelect options={proxyTypeOptions} value={proxyType} onChange={setProxyType} placeholder="Select proxy type..." />
      )}
    </Field>

    <Field label="Login Pool">
      {isView ? (
        <ReadOnly value={loginPool || "—"} />
      ) : (
        <SearchSelect options={loginPoolOptions} value={loginPool} onChange={setLoginPool} placeholder="Select login pool..." />
      )}
    </Field>

    <Field label="Maximum Inputs">
      {isView ? (
        <ReadOnly value={maximumInputs || "—"} />
      ) : (
        <input
          type="number"
          value={maximumInputs}
          onChange={(e) => setMaximumInputs(e.target.value)}
          placeholder="e.g. 100"
          min={1}
          className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
        />
      )}
    </Field>

    <Field label="Chain">
      <ReadOnly value={chain || "—"} />
    </Field>

    <Field label="Slug">
      <ReadOnly value={slug || "—"} />
    </Field>
  </div>
</fieldset>
```

- [ ] **Step 7: Add `PlusIcon` to imports**

Update the lucide-react import to include `PlusIcon`:
```typescript
import { PencilIcon, XIcon, SaveIcon, PlusIcon } from "lucide-react";
```

---

### Task 5: Create `DomainPicker` component

**Files:**
- Create: `packages/dashboard/src/components/domain-picker.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState, useMemo } from "react";

interface Domain {
  id: string;
  name: string;
}

interface DomainPickerProps {
  domains: Domain[];
  value: string;
  onChange: (domainId: string) => void;
  onCreateNew: (name: string) => Promise<void>;
  creating: boolean;
}

export function DomainPicker({ domains, value, onChange, onCreateNew, creating }: DomainPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return domains;
    const q = search.toLowerCase();
    return domains.filter((d) => d.name.toLowerCase().includes(q));
  }, [domains, search]);

  const selectedName = domains.find((d) => d.id === value)?.name ?? "";
  const showCreateOption = search.trim() && !domains.some((d) => d.name.toLowerCase() === search.trim().toLowerCase());

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? search : selectedName}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(""); }}
        placeholder="Search domains..."
        className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
        style={{
          background: "var(--ws-surface)",
          border: "1px solid var(--ws-border)",
          color: "var(--ws-text)",
        }}
      />

      {open && (
        <div
          className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded shadow-lg"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}
        >
          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => { onChange(d.id); setSearch(""); setOpen(false); }}
              className="block w-full px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--ws-surface-hover)]"
              style={{ color: d.id === value ? "var(--ws-accent)" : "var(--ws-text)" }}
            >
              {d.name}
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              onClick={async () => {
                await onCreateNew(search.trim());
                setSearch("");
                setOpen(false);
              }}
              disabled={creating}
              className="block w-full px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-[var(--ws-surface-hover)]"
              style={{ color: "var(--ws-accent)" }}
            >
              {creating ? "Creating..." : `+ Create "${search.trim()}"`}
            </button>
          )}

          {filtered.length === 0 && !showCreateOption && (
            <div className="px-2.5 py-1.5 text-xs" style={{ color: "var(--ws-text-dim)" }}>
              No domains found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Import in source-form.tsx**

Add to the imports in `source-form.tsx`:
```typescript
import { DomainPicker } from "./domain-picker";
```

---

## Chunk 3: Wire Up the Form

### Task 6: Update source page and layout to pass new props

**Files:**
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/sources-layout.tsx`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/layout.tsx`
- Modify: `packages/dashboard/src/app/orgs/[orgSlug]/projects/[projectSlug]/collections/[collectionSlug]/sources/actions.ts`

- [ ] **Step 1: Add `createDomain` server action**

Add to `packages/dashboard/src/app/.../sources/actions.ts`:
```typescript
export async function createDomain(name: string): Promise<{ id: string; name: string }> {
  const prefix = name.charAt(0).toLowerCase();
  const domain = await api.domains.create({ name, prefix });
  return { id: domain.id, name: domain.name };
}
```

- [ ] **Step 2: Fetch domains in layout.tsx and pass to CollectionShell**

`SourceForm` is rendered inside `CollectionShell` (client component). The prop chain is: `layout.tsx` → `<CollectionShell>` → `<SourceForm>`.

In `layout.tsx`, add after the `sourcesData` fetch (line 23):
```typescript
const allDomains = await api.domains.list();
```

Update the `<CollectionShell>` JSX (lines 73-82) to pass the new props:
```tsx
<CollectionShell
  sources={sources}
  collectionId={collection.id}
  basePath={basePath}
  hasSchema={hasSchema}
  collectionSchema={(collection.schema ?? []) as Array<{ name: string; type: string; required: boolean; description?: string }>}
  domains={allDomains.map((d) => ({ id: d.id, name: d.name }))}
  onCreateSource={createSource}
  onCreateDomain={createDomain}
  header={header}
>
  {children}
</CollectionShell>
```

Also add the `createDomain` import at the top:
```typescript
import { createSource, createDomain } from "./sources/actions";
```

- [ ] **Step 4: Verify the full dashboard compiles and runs**

```bash
cd packages/dashboard && pnpm tsc --noEmit
pnpm --filter @robot/dashboard dev
```

Open the browser, navigate to a collection, and verify the source creation form shows all three sections.

- [ ] **Step 5: Test creating a source with the new form**

1. Navigate to a collection that has a schema defined
2. Click "New Source"
3. Verify: Schema section shows collection fields with empty value inputs
4. Fill in extractor config (robot template, country, pick/create a domain, schema variant)
5. Fill in platform config (name, runner framework, etc.)
6. Click Create
7. Verify source is created with all fields stored correctly
