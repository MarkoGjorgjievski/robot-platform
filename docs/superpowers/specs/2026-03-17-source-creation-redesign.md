# Source Creation Form Redesign — Design Spec

**Date:** 2026-03-17
**Status:** Draft
**Goal:** Restructure the source creation form into three clear sections (Schema, Extractor Config, Platform Config), add schema inheritance from collections, rename the `domain` field to `runnerFramework`, and add an inline domain picker.

## Overview

The current source creation form mixes concerns: the `domain` dropdown (`balancer`/`nightmare`) is confused with the `domains` table (website identifiers like `amazon`, `redfin`). The form also lacks schema integration — collection fields aren't visible during source creation.

This redesign separates the form into three sections matching distinct responsibilities, adds schema value editing per source, and introduces a domain picker that searches existing domains or creates new ones inline.

## 1. Database Changes

### Rename `sources.domain` → `sources.runnerFramework`

- DB column: `domain` varchar(50) → `runner_framework` varchar(50)
- Drizzle field: `sources.domain` → `sources.runnerFramework`
- Values remain: `"balancer"` | `"nightmare"`
- Constant rename: `DOMAIN_OPTIONS` → `RUNNER_FRAMEWORK_OPTIONS`

### Add `sources.schemaValues` column

- `schemaValues: jsonb('schema_values').notNull().default({})`
- Structure: `{ "field_name": "selector_or_expression", ... }`
- Contains values for both inherited collection fields and source-specific extra fields
- The collection's `schema` array is the source of truth for which field names are "inherited" (locked) vs "extra" (source-scoped)

### No other schema changes

- `sources.variant` stays as-is in the DB (displayed as "Schema Variant" in the UI)
- `sources.domainId` already exists as FK to `domains` table
- `sources.robotTemplate` already exists with default `'robots/san-antonio'`
- `domains.create` API endpoint already exists

## 2. Source Creation Form — Three Sections

### Section A: Schema

Displays collection schema fields with read-only names and editable values.

```
┌─ Schema ──────────────────────────────────────────────┐
│  product_name   [//h1[@class='title']]        string  │
│  price          [.price-current]              number  │
│  image_url      [________________]            url     │
│                                                       │
│  + Add source-specific field                          │
└───────────────────────────────────────────────────────┘
```

**Behavior:**
- On create: all fields from `collections.schema` are listed with empty value inputs
- Field names and types are read-only (inherited from collection)
- Values are free-text inputs — selectors, XPaths, jq expressions, etc.
- "Add source-specific field" adds a new row where both name and value are editable (scoped to this source only)
- Stored in `sources.schemaValues` JSONB

**Determining inherited vs extra fields:**
- Any field name that exists in `collections.schema[].name` is inherited (name locked, value editable)
- Any field name in `schemaValues` that does NOT exist in `collections.schema` is a source-specific extra field (both name and value editable, deletable)

### Section B: Extractor Config

Maps directly to `extractor:new` CLI parameters.

```
┌─ Extractor Config ────────────────────────────────────┐
│  Robot Template   [robots/san-antonio          ]      │
│  Country          [CA ▾                        ]      │
│  Domain           [williamssonoma ▾       + New ]      │
│  Schema Variant   [screenshots ▾               ]      │
└───────────────────────────────────────────────────────┘
```

**Fields:**
- **Robot Template** — text input, defaults to `robots/san-antonio`. Maps to `sources.robotTemplate`.
- **Country** — searchable dropdown (`SearchSelect`). Maps to `sources.country`.
- **Domain** — searchable dropdown from `domains` table + "Create new" option. Maps to `sources.domainId`. See Section 3 for picker behavior.
- **Schema Variant** — text input or dropdown of known variants (`default`, `singlePage`, `multiPages`, `screenshots`, etc.). Maps to `sources.variant` in DB.

### Section C: Platform Config

Organization and infrastructure settings.

```
┌─ Platform Config ─────────────────────────────────────┐
│  Name              [Best Buy                   ]      │
│  Runner Framework   [balancer ▾                ]      │
│  Locale            [en_CA ▾                    ]      │
│  Currency          [CAD ▾                      ]      │
│  Data Center       [us-east ▾                  ]      │
│  Proxy Type        [residential ▾              ]      │
│  Login Pool        [— ▾                        ]      │
│  Maximum Inputs    [100                        ]      │
│  Chain             best_buy_ca  (auto-generated)      │
│  Slug              best_buy_ca  (auto-generated)      │
└───────────────────────────────────────────────────────┘
```

**Fields:**
- **Name** — required text input. Used to generate chain/slug.
- **Runner Framework** — dropdown: `balancer` | `nightmare`. Maps to `sources.runnerFramework` (renamed from `sources.domain`).
- **Locale, Currency, Data Center, Proxy Type, Login Pool, Maximum Inputs** — unchanged from current form.
- **Chain, Slug** — auto-generated read-only fields (from name + country).

## 3. Domain Picker Behavior

The Domain field in Extractor Config uses a searchable dropdown that queries the `domains` table:

1. User types — dropdown filters existing domains by name
2. If a match exists — select it, sets `sources.domainId`
3. If no match — show "Create new domain: {typed text}" option at the bottom
4. Selecting "Create new" calls `domains.create` API with the typed name, then assigns the returned `domainId` to the source
5. Domain `prefix` is passed as the first letter of the name, client-side, before calling the API (e.g., `name: "walmart"` → `prefix: "w"`)

**API:** Uses existing `domains.create` endpoint — no new API needed. The `domains.list` endpoint already returns all domains sorted by name.

**Data source for create flow:** The calling page already has access to the collection (from the URL params). The collection's `schema` field is fetched as part of the collection query and passed down as the `collectionSchema` prop.

## 4. API Changes

### `sources` router

- **`sources.create`** — update input schema:
  - Add `schemaValues: z.record(z.string()).optional().default({})`
  - Replace `domain` field with `runnerFramework` in Zod schema
  - Keep `domainId`, `variant`, `robotTemplate`, `country` as-is
- **`sources.update`** — new endpoint (does not currently exist). Create with same Zod schema as `create`, accepting partial fields. Required for editing sources from the view mode.

### Constants

- Rename `DOMAIN_OPTIONS` → `RUNNER_FRAMEWORK_OPTIONS` in `constants.ts`
- Update all imports

## 5. Component Changes

### `source-form.tsx` — restructure into three fieldsets

Current single form with "Identity" + "Infrastructure" sections becomes:
- Fieldset A: **Schema** — collection fields with value inputs
- Fieldset B: **Extractor Config** — robot template, country, domain picker, schema variant
- Fieldset C: **Platform Config** — name, runner framework, locale, currency, etc.

### Files requiring `domain` → `runnerFramework` updates

Beyond `source-form.tsx`, these files reference `source.domain` (the varchar field) and must be updated:
- `packages/api/src/routers/sources.ts` — `listByCollection` selects `sources.domain`
- `packages/dashboard/src/app/.../collections/[collectionSlug]/collection-shell.tsx` — displays `s.domain`
- `packages/dashboard/src/app/.../collections/[collectionSlug]/layout.tsx` — reads `s.domain`
- `packages/dashboard/src/app/.../collections/[collectionSlug]/sources/page.tsx` — reads `s.domain`
- `packages/dashboard/src/app/.../collections/[collectionSlug]/sources/sources-layout.tsx` — displays `item.domain`

### New props needed

```typescript
interface SourceFormProps {
  // existing
  mode: "create" | "view";
  source?: SourceData;
  existingSlugs: string[];
  collectionId: string;
  onSubmit: (data: SourceSubmitData) => Promise<{ slug: string }>;
  onClose: () => void;
  // new
  collectionSchema: SchemaField[];  // from collections.schema
  domains: Domain[];                 // from domains.list
  onCreateDomain: (name: string) => Promise<Domain>;  // calls domains.create
}
```

### `SourceData` interface update

```typescript
interface SourceData {
  // existing fields...
  domain: string | null;        // REMOVE
  runnerFramework: string | null; // ADD (renamed)
  domainId: string | null;      // ADD (website domain FK)
  robotTemplate: string;        // ADD
  variant: string;              // ADD (displayed as "Schema Variant")
  schemaValues: Record<string, string>; // ADD
}
```

## 6. Migration Path

**Column rename requires manual SQL** — `drizzle-kit push` treats renames as DROP + ADD, which would lose data. Steps:
1. Run manual SQL: `ALTER TABLE sources RENAME COLUMN domain TO runner_framework;`
2. Then run `drizzle-kit push` to add the `schema_values` column and sync the rest
3. Existing source rows: `runner_framework` inherits old `domain` values, `schema_values` defaults to `{}`

**Note:** The Drizzle *relation* named `domain` (the FK join to `domains` table via `domainId`) remains unchanged. Only the varchar column `domain` (holding `balancer`/`nightmare`) is renamed to `runnerFramework`.

## 7. Out of Scope

- Schema variant dropdown populated from `robotOverrides.schemas` — future enhancement, for now it's a free-text input
- Collection schema field editing from the source form — fields are added/removed at the collection level only
- Parameter overrides editing — the `sources.parameters` JSONB is not exposed in this form redesign
