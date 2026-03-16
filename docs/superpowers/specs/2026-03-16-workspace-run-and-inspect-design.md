# Workspace: Run & Inspect — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Milestone goal:** Run a single input from the workspace, view the rendered page, and inspect the DOM.

## Overview

Enable the workspace to create and run inputs against a source, display the captured page in a rendered iframe, and provide a toggleable DOM inspector for element exploration. This is the foundation for the selector builder (next milestone).

## Architecture: Backend-First Approach

Build the data pipeline first (DB → API → Runner), then wire up the UI.

## 1. Database & API Changes

### Schema changes

**`runs` table** — add nullable `sourceId` FK:
- `sourceId: uuid | null` (FK → sources.id)
- `extractorId: uuid | null` — **migration required**: change from `.notNull()` to nullable. Existing rows keep their `extractorId` values. Drizzle relation definition for `runsRelations` must be updated to handle nullable `extractorId`.
- Application-level constraint: at least one of `sourceId` or `extractorId` must be set (validated in `runs.create` API input schema via Zod `.refine()`).

**`runs` table** — add separate `html` text column:
- `html: text | null` — stored as a dedicated column (not inside `results` JSONB) for efficiency with large strings. 500KB cap enforced at application level. This avoids bloating the `results` JSONB which already holds the screenshot base64.

**`runs.results` JSONB** — unchanged structure:
```json
{
  "screenshotBase64": "string (200KB cap)",
  "htmlLength": "number (existing)",
  "finalUrl": "string",
  "responseStatus": "number"
}
```

**`sourceInputs` table** — new table (separate from `extractorInputs` which serves legacy):
- `id: uuid` (PK)
- `sourceId: uuid` (FK → sources.id)
- `label: string`
- `inputData: jsonb`
- `createdAt: timestamp`

### API changes

**`runs` router:**
- `runs.create` — accept `sourceId` as alternative to `extractorId`
- `runs.listBySource` — new query filtered by `sourceId`

**`sourceInputs` router** (new):
- `sourceInputs.listBySource(sourceId)`
- `sourceInputs.create({ sourceId, label, inputData })`
- `sourceInputs.update({ id, label, inputData })`
- `sourceInputs.delete({ id })`

### Runner changes

**`runs.create` API signature:**
```
{ sourceId?: uuid, extractorId?: uuid, inputLabel?: string }
```
Zod `.refine()` ensures exactly one of `sourceId` or `extractorId` is provided.

**`executor.ts`:**
- When `sourceId` is set: load source from `sources` table (has `parameters`, `domainId`, `robotTemplate`, `country` — same fields as extractor). Load domain overrides via `robotOverrides` using `source.domainId` + `source.country`. Build URL from `source.parameters.URLTemplate` + input data (same interpolation logic).
- Capture full HTML string → store in `runs.html` column (500KB cap).
- Resolve input data: look up `sourceInputs` by `sourceId` + matching `label` field (same pattern as current `extractorInputs` lookup by `extractorId` + `inputLabel`).

## 2. Workspace UI — Bottom Panel

### Layout

Three-column bottom panel:
- **Left (~25%):** Runs list
- **Center:** Logs / Data tabs
- **Right (~28%):** Inputs panel

### Runs list (bottom-left)

- Shows runs for the current source, ordered by most recent
- Each row: status indicator (color dot), run ID (short), time ago
- Click a run → loads its results in the main workspace area (rendered page)
- Loading/running state shows a spinner or pulsing indicator
- Selected run is visually highlighted

### Inputs panel (bottom-right)

Progressive flow:

1. **Empty state:** Key-value form with editable key names + values. `+ Add field` to add more keys. Separate Save and Run buttons.
2. **Has inputs:** Collapsed cards showing label + first key preview. Each has Edit (✎) and Run (▶). `+ Add input` creates a new entry with keys pre-filled from existing inputs — only values are editable.
3. **Editing:** Expands inline with value fields. Cancel / Save / Run buttons.

Button states:
- **Save** — enabled only when values have changed (dirty state)
- **Run ▶** — enabled only when the input is saved (clean state)

### Inputs data model

- Keys are derived from the first input's `inputData` keys
- New inputs inherit those keys automatically
- Key editing only available on the first input (or when no inputs exist). If the first input is deleted, the next input becomes the key template — its keys are used for new inputs. Keys are never "locked" to a deleted row.

### Run creation flow

1. User clicks ▶ on a saved input
2. Client calls server action → `api.runs.create({ sourceId, inputLabel })`
3. New run appears in the runs list with `queued` status
4. Runner picks it up, status transitions: queued → running → completed/failed
5. UI polls every 2 seconds to show status updates. Polling stops when run reaches a terminal status (completed/failed). Websockets deferred to later.

## 3. Main Workspace — Rendered Page + Inspector

### Default state (no run selected)

Empty placeholder in the main area: "Select a run to view results."

### Run selected — Rendered view (default)

- Toolbar at top: **Rendered** | **Screenshot** tabs + **Inspector** toggle button on the right
- Main area renders the captured HTML in a sandboxed iframe with `sandbox=""` (most restrictive — no scripts, no same-origin, no forms). This is third-party HTML and must not execute JS or access the parent frame.
- Full width when inspector is closed

### Screenshot tab

- Shows `screenshotBase64` as an image, full width, scrollable

### DOM Inspector (toggled)

- Toggle button in toolbar activates/deactivates
- When open: rendered page shrinks to ~58% width, inspector panel takes ~42% on the right
- Inspector panel is resizable (drag handle, same pattern as existing right sidebar)
- Shows DOM tree with collapsible nodes, syntax-colored tags/attributes

### Interaction model

- **Hover on rendered page** → highlights element + corresponding DOM node in inspector
- **Hover on DOM tree** → highlights element on rendered page
- **Click element** (either side) → future milestone: selector builder
- Inspector has "Elements" view (DOM tree). "Styles" tab placeholder for later.

## 4. Relationship to Existing Components

The existing `ExtractorWorkspace` component and its sub-components (`BottomPanel`, `DomViewer`, `RecorderBar`, etc.) already have the structural layout we need — three-column bottom panel, a DOM viewer area, and a right sidebar. This milestone **extends and rewires** these existing components rather than replacing them:

- `BottomPanel` — extend with inputs CRUD (progressive key-value), wire run creation, add polling
- `DomViewer` — replace placeholder with rendered iframe + inspector toggle (replaces existing DOM/Visual toggle buttons)
- `ExtractorWorkspace` — the source workspace page already maps source data to the extractor shape and passes it to this component. Source-specific behavior (sourceId-based runs, sourceInputs) will be handled by checking which ID is present.

## 5. Scope Boundaries

### In scope

- DB schema changes (sourceId on runs, html in results, sourceInputs table)
- API: runs.create with sourceId, runs.listBySource, sourceInputs CRUD
- Runner: capture HTML, resolve source-based runs
- Workspace bottom panel: inputs CRUD (progressive key-value), run creation, runs list with status
- Workspace main area: rendered page in iframe, screenshot tab
- DOM inspector: toggleable panel, element tree, hover-linking between rendered and tree
- Status polling for run updates

### Out of scope (future milestones)

- Selector builder (click element → suggest selector → assign to schema field)
- Schema field ↔ DOM element highlighting/overlays
- Bulk run (run all inputs at once)
- Websocket-based live status updates
- Recorder bar wiring (play/pause/stop transport controls)
- Auth flow (credentials, checkAuthentication)
- `extract()` implementation in runner
- Data tab in bottom panel (extracted structured data)
- Styles panel in inspector

## 6. Data Flow Summary

```
User fills input values → Save → Run ▶
  → api.runs.create({ sourceId, inputLabel })
  → runs table: status='queued'
  → Runner worker polls, picks up run
  → Resolves source params + input data from sourceInputs
  → Launches Playwright, navigates, captures screenshot + HTML
  → runs.html = captured HTML, runs.results = { screenshotBase64, finalUrl, responseStatus }
  → runs.status = 'completed'
  → UI polls, sees completed run
  → User clicks run in bottom-left
  → Workspace loads results, renders HTML in iframe
  → User toggles Inspector → DOM tree appears alongside rendered page
  → Hover-linking between rendered elements and DOM tree nodes
```
