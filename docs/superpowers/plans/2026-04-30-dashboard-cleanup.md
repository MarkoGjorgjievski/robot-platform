# Dashboard Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the complex multi-page dashboard2 with a two-page dashboard: extraction wizard (landing) + past extractions list. Rename package from `dashboard2` to `dashboard`.

**Architecture:** Delete all existing pages and sidebar. Keep the UI component library, API routes (analyze/extract), and globals. Create a standalone `quickExtractions` DB table for auto-saving results. New layout with simple top bar. Wizard becomes the root page, extractions list is `/extractions`.

**Tech Stack:** Next.js 15, Tailwind v4, Radix UI, Drizzle ORM, PostgreSQL

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Delete | `packages/dashboard2/src/app/page.tsx` | Old customers list |
| Delete | `packages/dashboard2/src/app/domains/` (entire dir) | Domain library pages |
| Delete | `packages/dashboard2/src/app/scraper/` (entire dir) | Org/source pages + wizard |
| Delete | `packages/dashboard2/src/app/api/scraper/save/` | Old save route (org-based) |
| Delete | `packages/dashboard2/src/app/api/scraper/domain-reset/` | Domain reset route |
| Delete | `packages/dashboard2/src/app/api/scraper/find-path/` | Element picker path finder |
| Delete | `packages/dashboard2/src/app/api/scraper/override/` | Human override route |
| Delete | `packages/dashboard2/src/app/api/scraper/page-frame/` | Interactive picker |
| Delete | `packages/dashboard2/src/components/sidebar.tsx` | Old sidebar nav |
| Delete | `packages/dashboard2/src/components/status-badge.tsx` | Status badge |
| Delete | `packages/dashboard2/src/components/ui/checkbox.tsx` | Unused |
| Delete | `packages/dashboard2/src/components/ui/dialog.tsx` | Unused |
| Delete | `packages/dashboard2/src/components/ui/skeleton.tsx` | Unused |
| Delete | `packages/dashboard2/src/components/ui/tabs.tsx` | Unused |
| Delete | `packages/dashboard2/src/trpc/server.ts` | tRPC client (unused) |
| Modify | `packages/dashboard2/src/app/layout.tsx` | Remove sidebar, add top bar |
| Modify | `packages/dashboard2/src/app/globals.css` | Remove sidebar CSS vars |
| Create | `packages/dashboard2/src/app/page.tsx` | New root — extraction wizard |
| Create | `packages/dashboard2/src/app/extraction-wizard.tsx` | Wizard component (moved from old location, simplified) |
| Create | `packages/dashboard2/src/app/api/scraper/save-extraction/route.ts` | New auto-save route |
| Create | `packages/dashboard2/src/app/extractions/page.tsx` | Past extractions page |
| Create | `packages/db/src/quick-extractions.ts` | New standalone table |
| Modify | `packages/db/src/index.ts` | Export new table |
| Modify | `packages/dashboard2/package.json` | Rename to @robot/dashboard |
| Modify | `package.json` (root) | Update dev script filter |
| Modify | `CLAUDE.md` | Update package name + commands |

---

### Task 1: Add quick_extractions DB table

A standalone table for auto-saving extraction results. No org/source/collection dependency.

**Files:**
- Create: `packages/db/src/quick-extractions.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create the table schema**

Create `packages/db/src/quick-extractions.ts`:

```typescript
import { pgTable, text, timestamp, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';

export const quickExtractions = pgTable('quick_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  extractedData: jsonb('extracted_data').notNull().default([]),
  fields: jsonb('fields').notNull().default([]),
  confidence: integer('confidence'),
  sources: jsonb('sources'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('quick_extractions_domain_idx').on(table.domain),
  index('quick_extractions_created_at_idx').on(table.createdAt),
]);
```

- [ ] **Step 2: Export from db package**

In `packages/db/src/index.ts`, add the export. Read the file first to find the right location, then add:

```typescript
export { quickExtractions } from './quick-extractions.js';
```

- [ ] **Step 3: Generate and run migration**

Run: `cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction && pnpm --filter @robot/db exec drizzle-kit generate`

Then run the migration:

Run: `cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction && pnpm --filter @robot/db exec drizzle-kit push`

If drizzle-kit is not available or the DB is not running, skip this step — the table will be created on first use via push.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/quick-extractions.ts packages/db/src/index.ts
git commit -m "feat: add quick_extractions table for standalone extraction storage"
```

---

### Task 2: Delete old pages and components

Remove all pages, components, and API routes that are no longer needed.

**Files:**
- Delete: multiple directories and files (listed below)

- [ ] **Step 1: Delete old pages**

```bash
cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction
rm -rf packages/dashboard2/src/app/domains
rm -rf packages/dashboard2/src/app/scraper
rm packages/dashboard2/src/app/page.tsx
```

- [ ] **Step 2: Delete unused API routes**

```bash
rm -rf packages/dashboard2/src/app/api/scraper/save
rm -rf packages/dashboard2/src/app/api/scraper/domain-reset
rm -rf packages/dashboard2/src/app/api/scraper/find-path
rm -rf packages/dashboard2/src/app/api/scraper/override
rm -rf packages/dashboard2/src/app/api/scraper/page-frame
```

- [ ] **Step 3: Delete unused components**

```bash
rm packages/dashboard2/src/components/sidebar.tsx
rm packages/dashboard2/src/components/status-badge.tsx
rm packages/dashboard2/src/components/ui/checkbox.tsx
rm packages/dashboard2/src/components/ui/dialog.tsx
rm packages/dashboard2/src/components/ui/skeleton.tsx
rm packages/dashboard2/src/components/ui/tabs.tsx
rm packages/dashboard2/src/trpc/server.ts
```

- [ ] **Step 4: Remove the trpc directory if empty**

```bash
rmdir packages/dashboard2/src/trpc 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add -A packages/dashboard2/src
git commit -m "chore: delete old dashboard pages, sidebar, and unused components"
```

---

### Task 3: Simplify layout — replace sidebar with top bar

**Files:**
- Modify: `packages/dashboard2/src/app/layout.tsx`
- Modify: `packages/dashboard2/src/app/globals.css`

- [ ] **Step 1: Rewrite layout.tsx**

Replace the entire content of `packages/dashboard2/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Robot Platform',
  description: 'AI-powered data extraction',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${ibmPlexMono.variable} antialiased`}>
        <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b bg-background px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4" />
            Robot Platform
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/extractions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Extractions
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Clean up globals.css — remove sidebar CSS vars**

In `packages/dashboard2/src/app/globals.css`, remove these lines from the `@theme inline` block:

```css
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
```

And remove these from the `:root` block:

```css
  --sidebar: oklch(0.98 0.003 80);
  --sidebar-foreground: oklch(0.15 0.01 260);
  --sidebar-primary: oklch(0.2 0.01 260);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.95 0.005 80);
  --sidebar-accent-foreground: oklch(0.2 0.01 260);
  --sidebar-border: oklch(0.92 0.004 80);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction && pnpm --filter @robot/dashboard2 dev &`

Wait a few seconds, then check if Next.js compiled without errors. Kill the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard2/src/app/layout.tsx packages/dashboard2/src/app/globals.css
git commit -m "feat: replace sidebar with simple top bar layout"
```

---

### Task 4: Create the extraction wizard page

Move the wizard to the root page, stripped of org/customer context.

**Files:**
- Create: `packages/dashboard2/src/app/page.tsx`
- Create: `packages/dashboard2/src/app/extraction-wizard.tsx`

- [ ] **Step 1: Create the root page**

Create `packages/dashboard2/src/app/page.tsx`:

```tsx
import { ExtractionWizard } from './extraction-wizard';

export default function Home() {
  return <ExtractionWizard />;
}
```

- [ ] **Step 2: Create the wizard component**

Create `packages/dashboard2/src/app/extraction-wizard.tsx`. This is the old `wizard.tsx` from `scraper/[orgSlug]/new-source/` but simplified:

- Remove all props (`orgSlug`, `orgId`, `orgName`, `existingSchemas`)
- Remove Step 4 (Save) — auto-save happens when extraction completes
- Remove the existing schema selector (the `existingSchemas` dropdown)
- Keep: URL input, field input textarea, two-tier schema selection, extract, two-tier preview
- After successful extraction, auto-save via `POST /api/scraper/save-extraction`
- On the preview step, show a "New Extraction" button instead of "Save Source"

Read the current wizard file at `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx` for the full source. The new file should be a copy with these changes:

1. Remove the function props — the component takes no props:
```tsx
export function ExtractionWizard() {
```

2. Remove `ExistingSchema` type entirely.

3. Change steps from 4 to 3:
```tsx
type Step = 'url' | 'schema' | 'preview';

const steps: { key: Step; label: string }[] = [
  { key: 'url', label: 'URL' },
  { key: 'schema', label: 'Fields' },
  { key: 'preview', label: 'Results' },
];
```

4. Remove `sourceName` state, `existingSchemas` related code.

5. In `handleExtract`, after setting results, auto-save the extraction:
```tsx
// Auto-save extraction
try {
  await fetch('/api/scraper/save-extraction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url.trim(),
      extractedData: data.data ?? [],
      fields: enabledFields.map(f => ({ name: f.name, type: f.type, description: f.description, tier: f.tier })),
      confidence: data.confidence ?? null,
      sources: data.sources ?? {},
    }),
  });
} catch (err) {
  console.error('Auto-save failed (non-fatal):', err);
}
```

6. Remove the entire Step 4 (save) section. The breadcrumb should link to `/` instead of `/scraper/${orgSlug}`.

7. On the preview step, replace the "Save Source" button with:
```tsx
<Button
  size="sm"
  onClick={() => {
    // Reset for new extraction
    setStep('url');
    setUrl('');
    setUserFieldsInput('');
    setFields([]);
    setExtractedData([]);
    setRequestedResults([]);
    setDiscoveredResults([]);
    setConfidence(null);
    setError(null);
  }}
  className="gap-1.5"
>
  <Sparkles className="size-3.5" />
  New Extraction
</Button>
```

8. Remove the breadcrumb at the top (the "← orgName" link). Replace the `<h1>` with just "Extract Data".

- [ ] **Step 3: Verify it compiles and renders**

Run: `cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction && pnpm --filter @robot/dashboard2 dev`

Navigate to `http://localhost:3457` — should show the extraction wizard with URL input, field textarea, and Analyze button.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard2/src/app/page.tsx packages/dashboard2/src/app/extraction-wizard.tsx
git commit -m "feat: extraction wizard as landing page"
```

---

### Task 5: Create save-extraction API route

Auto-saves extraction results to the new `quick_extractions` table.

**Files:**
- Create: `packages/dashboard2/src/app/api/scraper/save-extraction/route.ts`

- [ ] **Step 1: Create the route**

Create `packages/dashboard2/src/app/api/scraper/save-extraction/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, extractedData, fields, confidence, sources } = await request.json();

    if (!url || !extractedData) {
      return NextResponse.json({ error: 'url and extractedData are required' }, { status: 400 });
    }

    const { db, quickExtractions } = await import('@robot/db');

    const domain = new URL(url).hostname.replace(/^www\./, '');

    const [extraction] = await db
      .insert(quickExtractions)
      .values({
        url,
        domain,
        extractedData,
        fields: fields ?? [],
        confidence: confidence != null ? Math.round(confidence * 100) : null,
        sources: sources ?? {},
      })
      .returning();

    console.log(`[save-extraction] Saved extraction ${extraction.id} for ${domain}`);

    return NextResponse.json({ id: extraction.id });
  } catch (err) {
    console.error('Save extraction error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Save failed' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard2/src/app/api/scraper/save-extraction/route.ts
git commit -m "feat: auto-save extraction API route"
```

---

### Task 6: Create extractions list page

Shows past extractions grouped by domain.

**Files:**
- Create: `packages/dashboard2/src/app/extractions/page.tsx`

- [ ] **Step 1: Create the page**

Create `packages/dashboard2/src/app/extractions/page.tsx`:

```tsx
import { db, quickExtractions } from '@robot/db';
import { desc } from 'drizzle-orm';
import { ExtractionsList } from './extractions-list';

export default async function ExtractionsPage() {
  const rows = await db
    .select()
    .from(quickExtractions)
    .orderBy(desc(quickExtractions.createdAt))
    .limit(50);

  // Group by domain
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = grouped.get(row.domain) ?? [];
    existing.push(row);
    grouped.set(row.domain, existing);
  }

  // Sort domains by most recent extraction
  const domains = Array.from(grouped.entries())
    .sort((a, b) => {
      const aDate = a[1][0].createdAt.getTime();
      const bDate = b[1][0].createdAt.getTime();
      return bDate - aDate;
    });

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Extractions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {rows.length} extraction{rows.length !== 1 ? 's' : ''} across {domains.length} domain{domains.length !== 1 ? 's' : ''}
      </p>

      <ExtractionsList domains={domains} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client component for expand/collapse**

Create `packages/dashboard2/src/app/extractions/extractions-list.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

type Extraction = {
  id: string;
  url: string;
  domain: string;
  extractedData: unknown;
  fields: unknown;
  confidence: number | null;
  sources: unknown;
  createdAt: Date;
};

type Props = {
  domains: [string, Extraction[]][];
};

export function ExtractionsList({ domains }: Props) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(
    domains.length > 0 ? domains[0][0] : null
  );
  const [expandedExtraction, setExpandedExtraction] = useState<string | null>(null);

  if (domains.length === 0) {
    return (
      <Card className="mt-8 border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">No extractions yet. Go extract something!</p>
      </Card>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {domains.map(([domain, extractions]) => (
        <Card key={domain}>
          {/* Domain header */}
          <button
            onClick={() => setExpandedDomain(expandedDomain === domain ? null : domain)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            {expandedDomain === domain ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <Globe className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{domain}</span>
            <Badge variant="secondary" className="text-[10px]">
              {extractions.length}
            </Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {formatDate(extractions[0].createdAt)}
            </span>
          </button>

          {/* Extraction rows */}
          {expandedDomain === domain && (
            <div className="border-t divide-y">
              {extractions.map(extraction => {
                const fields = Array.isArray(extraction.fields) ? extraction.fields : [];
                const data = Array.isArray(extraction.extractedData) ? extraction.extractedData : [];
                const path = new URL(extraction.url).pathname;
                const isExpanded = expandedExtraction === extraction.id;

                return (
                  <div key={extraction.id}>
                    <button
                      onClick={() => setExpandedExtraction(isExpanded ? null : extraction.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 pl-12 text-left transition-colors hover:bg-muted/50"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      <span data-slot="mono" className="text-xs text-muted-foreground truncate flex-1">
                        {path}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {fields.length} fields
                      </span>
                      {extraction.confidence != null && (
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            extraction.confidence > 80 ? 'text-emerald-600' :
                            extraction.confidence > 50 ? 'text-amber-600' : 'text-red-600'
                          }`}
                        >
                          {extraction.confidence}%
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(extraction.createdAt)}
                      </span>
                    </button>

                    {/* Inline data table */}
                    {isExpanded && data.length > 0 && (
                      <div className="border-t bg-muted/30 px-4 py-3 pl-12">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(data[0] as Record<string, unknown>).map(key => (
                                <TableHead key={key} className="text-[11px]">{key}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(data as Record<string, unknown>[]).slice(0, 10).map((row, i) => (
                              <TableRow key={i}>
                                {Object.values(row).map((val, j) => (
                                  <TableCell key={j} data-slot="mono" className="max-w-[200px] truncate text-xs">
                                    {val != null ? String(val) : <span className="text-muted-foreground/40">—</span>}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {data.length > 10 && (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Showing 10 of {data.length} rows
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 3: Verify the page renders**

Run the dev server and navigate to `http://localhost:3457/extractions`. Should show "No extractions yet" empty state (or data if the table has rows).

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard2/src/app/extractions/
git commit -m "feat: extractions list page grouped by domain"
```

---

### Task 7: Rename package from dashboard2 to dashboard

**Files:**
- Modify: `packages/dashboard2/package.json`
- Rename: `packages/dashboard2/` → `packages/dashboard/`
- Modify: `package.json` (root)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update package.json name and port**

In `packages/dashboard2/package.json`, change the name and port:

```json
{
  "name": "@robot/dashboard",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3456",
    "build": "next build",
    "start": "next start"
  }
}
```

Change only `name` from `@robot/dashboard2` to `@robot/dashboard` and port from `3457` to `3456`. Keep all dependencies unchanged.

- [ ] **Step 2: Remove @robot/api dependency**

In `packages/dashboard2/package.json`, remove `"@robot/api": "workspace:*"` from dependencies — tRPC is no longer used. Also remove `"superjson": "^2.2.0"` as it was only for tRPC.

- [ ] **Step 3: Rename the directory**

```bash
cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction
git mv packages/dashboard2 packages/dashboard
```

- [ ] **Step 4: Update root package.json**

In the root `package.json`, update the dev script:

```json
"dev": "pnpm --filter @robot/dashboard dev",
```

- [ ] **Step 5: Update CLAUDE.md**

In `CLAUDE.md`, update:

1. Package map table — change `@robot/dashboard2` to `@robot/dashboard`
2. Commands section — change `pnpm --filter @robot/dashboard2 dev` to `pnpm --filter @robot/dashboard dev` and update the port to `:3456`

- [ ] **Step 6: Run pnpm install to update lockfile**

```bash
cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction && pnpm install
```

- [ ] **Step 7: Verify it still works**

```bash
pnpm --filter @robot/dashboard dev
```

Navigate to `http://localhost:3456` — should show the extraction wizard.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: rename dashboard2 to dashboard, update port to 3456"
```

---

### Task 8: Verify and clean up

Final verification that everything works end-to-end.

- [ ] **Step 1: Verify all tests pass**

Run: `cd /Users/marko/Documents/robot-platform/.worktrees/field-aware-extraction && pnpm --filter @robot/scraper exec vitest run`
Expected: All tests pass.

- [ ] **Step 2: Verify dev server starts**

Run: `pnpm --filter @robot/dashboard dev`

1. Navigate to `http://localhost:3456` — extraction wizard loads
2. Navigate to `http://localhost:3456/extractions` — extractions list loads
3. Click "Extractions" in top bar — navigates correctly
4. Click "Robot Platform" logo — navigates back to wizard

- [ ] **Step 3: Check for any remaining dashboard2 references**

```bash
grep -r "dashboard2" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" . | grep -v node_modules | grep -v .worktrees
```

Fix any remaining references found.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: clean up remaining dashboard2 references"
```
