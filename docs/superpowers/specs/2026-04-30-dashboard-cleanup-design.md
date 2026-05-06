# Dashboard Cleanup Design

## Problem

The current dashboard (dashboard2) has too many pages and concepts: customers, organizations, domains library, sources, schema editor, sidebar navigation. For polishing single product page extraction, most of this is unnecessary overhead. The user doesn't know where to go.

## Design

### Two Pages

**`/` — Extraction Wizard**
The landing page. Enter URL, optionally provide fields, extract, see results. This is the existing `NewSourceWizard` stripped of org/customer context.

Changes from current wizard:
- Remove `orgSlug`, `orgId`, `orgName`, `existingSchemas` props
- Remove Step 4 (Save) — extraction results auto-save when extraction completes
- Steps become: URL (with optional field input) → Schema → Preview
- No source naming, no org assignment

Everything from the field-aware extraction work stays: field input textarea, two-tier schema selection, two-tier results display.

**`/extractions` — Past Extractions**
Past extractions grouped by domain, sorted by most recent.

- Domain sections: domain name, extraction count, last extracted date
- Expand domain to see extractions: URL path, date, field count
- Click extraction to expand inline and show data table of field names and values
- Load most recent 50 extractions, no pagination for now

### Navigation

No sidebar. Simple top bar: logo on left, navigation link on right.
- On `/`: link says "Extractions" → `/extractions`
- On `/extractions`: link says "New Extraction" → `/`

### Storage

Each extraction auto-saves with:
- `url` — the page URL
- `domain` — extracted from URL for grouping
- `extractedData` — field values (JSON)
- `fields` — field config used (names, types, tiers)
- `confidence` — extraction confidence score
- `sources` — which extraction method found each field
- `createdAt` — timestamp

Existing DB tables (orgs, collections, sources, domain_intelligence) stay in `@robot/db` — the dashboard just doesn't use them. Domain intelligence cache continues to work behind the scenes in the extraction pipeline.

### Package Rename

`dashboard2` → `dashboard`:
- Rename directory `packages/dashboard2` → `packages/dashboard`
- Update `package.json` name: `@robot/dashboard2` → `@robot/dashboard`
- Update pnpm-workspace.yaml if needed
- Update turborepo config if needed
- Update CLAUDE.md commands

Port stays `:3456`.

### What Gets Deleted

- Sidebar component
- All pages under `/scraper/[orgSlug]/...`
- `/domains` and `/domains/[domain]` pages
- `/` customers list page
- Customer/org-related components and server actions
- Schema editor component
- Source detail/actions components
- Any tRPC client usage (the new dashboard uses direct fetch to API routes)

### What Gets Kept

- UI component library (Button, Card, Badge, Table, Input, Label, etc.)
- Root layout (fonts, metadata) — simplified without sidebar
- API routes (`/api/scraper/analyze`, `/api/scraper/extract`) — these are the extraction pipeline
- The wizard component (refactored to remove org dependency)
