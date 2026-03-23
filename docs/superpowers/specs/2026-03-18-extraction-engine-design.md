# Extraction Engine Design

**Date:** 2026-03-18 (updated 2026-03-20)
**Status:** Approved

## Overview

Build the extraction engine that closes the loop: schema fields (CSS/XPath selectors) -> extracted data from crawled pages -> structured results in the Data tab. Three additional features improve the workspace experience:

1. **Inline CSS capture** — Self-contained HTML snapshots with all CSS inlined at capture time
2. **Video recording** — Playwright records each run as `.webm`, playable in the dashboard
3. **Config overrides tab** — Bottom panel tab showing parameter merge details per run

---

## Extraction Engine

### Key Decisions

- **Output format:** Flat records — `{ fieldName: value }[]`. No Import.io `Group[]` compatibility.
- **Extraction runs in-browser:** Via `page.evaluate()` against the live rendered DOM (not server-side HTML parsing). This preserves JS-rendered content.
- **beforeExtract:** Runs in-browser via `page.evaluate()` — needs live page for popups/clicks.
- **Per-field transform:** Each schema field gets an optional `transform` function. Stored as a JS function string, executed server-side via `new Function('text', 'row', body)`.
- **Global transform.js:** Backward-compatible, runs server-side after per-field transforms. Only when `useTransform` parameter is true.

### Extraction Engine (`packages/runner/src/extractor.ts`)

Core function:

```ts
extractData(page: Page, schema: SchemaData, logger: RunLogger): Promise<Record<string, string | null>[]>
```

**Algorithm:**
1. If `recordXPath` or `recordSelector` is set and `singleRecord` is false — find all matching record containers, extract fields relative to each one
2. If `singleRecord` is true or no record selector — extract fields against the full page (one record)
3. For each field: try `xpath` first, fall back to `css`, then `defaultValue`
4. Apply `regExp` + `regExpReplace` if defined
5. Returns raw text values per field per record

**In-browser execution:** Pass field config into `page.evaluate()`, run selectors in the DOM, return extracted text. Server-side code handles transforms.

### Schema Loading

**For source-based runs:**
1. Load robot override via source's `domainId` + `country`
2. Pick schema variant from `source.parameters.schemaYAML` or first key in `override.schemas`
3. Fallback: convert collection schema to extraction format

**Domain default merging:** Load `robotOverrides.parameterOverrides` and deep-merge with source/extractor parameters. Source params take precedence.

### beforeExtract Execution

1. Load `jsOverrides.beforeExtract` from robot override
2. Execute via Playwright context proxy with `inputs` and `params` as arguments
3. Old CJS `module.exports = { implementation: async (...) => {} }` and new ESM `export default async function` formats both supported
4. Errors are caught and logged — a failing beforeExtract doesn't kill the run

### Transform Pipeline

**Per-field transform (new):**
- Each schema field has an optional `transform` string property
- Contains a JS function body: `function transform(text, row) { return text; }`
- Stored/edited in the Schema panel via CodeEditor
- Executed server-side: strip the function wrapper, create `new Function('text', 'row', body)`
- Functions are cached per extraction run

**Global transform.js (backward compat):**
- Loaded from `jsOverrides.transform`
- Only runs if `useTransform` parameter is true
- Receives the full records array, returns modified records

### Executor Flow

```
1.  Load run, source/extractor, input data          (unchanged)
2.  Load robot override                              (NEW)
3.  Merge parameters (override defaults + source)    (NEW)
4.  Build URL                                        (unchanged)
5.  Launch browser with video recording              (UPDATED)
6.  Configure, navigate                              (unchanged)
7.  Page validation, scrolling, ordered actions      (unchanged)
8.  Run beforeExtract                                (NEW)
9.  Run extraction — extractData(page, schema)       (NEW)
10. Run per-field transforms                         (NEW)
11. Run global transform.js                          (NEW)
12. Capture inlined HTML snapshot                    (UPDATED)
13. Capture screenshot                               (unchanged)
14. Close context, read video                        (NEW)
15. Store results with records, video, config        (UPDATED)
```

---

## Feature 1: Inline CSS at Capture Time

### Problem

The rendered viewer shows crawled HTML in an iframe. External stylesheets fail to load due to CORS (iframe origin vs. original site), causing unstyled pages.

### Solution

After extraction, before storing HTML, run `page.evaluate()` that:

1. Iterates `document.styleSheets`, reads `cssRules` from same-origin sheets, joins into `<style>` blocks
2. For cross-origin sheets that can't be read, fetches them via `fetch()` inside the page context and inlines the response text
3. Removes all `<link rel="stylesheet">` tags
4. Injects `<base href="origin/">` for remaining relative URLs (images, fonts)
5. Returns modified `document.documentElement.outerHTML`

### Trade-offs

- Stored HTML grows by ~50-200KB (CSS text is compact)
- Images still resolve via `<base href>` — show when original site is reachable
- Self-contained: no dependency on live site for styling

### Files

- `packages/runner/src/executor.ts` — new `captureInlinedHtml(page)` function

---

## Feature 2: Video Recording

### Problem

Users want to see how the page loaded and elements rendered during the crawl. A static screenshot only shows the final state.

### Solution

Use Playwright's built-in video recording:

1. Create temp directory per run: `/tmp/robot-videos/{runId}/`
2. Pass `recordVideo: { dir, size: { width: 1280, height: 720 } }` to `browser.newContext()`
3. After all work done, `context.close()` finalizes the `.webm` file
4. Read the file, store as base64 in `runs.results.videoBase64`
5. Clean up the temp file

**Runner always runs headless** — no browser window. `HEADFUL=1` is opt-in debug only.

### Size Estimates

| Duration | Resolution | Typical Size |
|----------|-----------|-------------|
| 10 sec   | 1280x720  | 200-500 KB  |
| 30 sec   | 1280x720  | 500 KB - 1.5 MB |
| 60 sec   | 1280x720  | 1 - 3 MB    |

### Dashboard

- Third tab in rendered viewer toolbar: **Rendered | Screenshot | Video**
- Video tab renders `<video controls autoplay muted playsInline>` with blob URL from base64
- Tab only visible when `results.videoBase64` exists

### Files

- `packages/runner/src/executor.ts` — `recordVideo` context option, read video after close
- `packages/dashboard/src/components/workspace/rendered-viewer.tsx` — Video tab

---

## Feature 3: Config Overrides Tab

### Problem

Users change parameters in the Config panel but can't tell if those changes actually affected the run.

### Solution

**Runner:** During parameter merge, diff `domainDefaults` vs `sourceParams` and store only changed keys plus the full merged result:

```ts
configSnapshot: {
  overrides: [
    { key: "timeout", from: 60000, to: 30000 },
    { key: "useTransform", from: undefined, to: true },
  ],
  merged: { timeout: 30000, goto2: { waitUntil: 'load' }, useTransform: true, ... },
}
```

`overrides` contains only keys where `sourceParams[key] !== domainDefaults[key]` — the actual diff.

**Dashboard:** New tab in bottom panel: **Output | Data | Config**

- Shows only the overrides: key, old value (dim/struck), new value (accent)
- Collapsible "All merged parameters" section below for the full picture
- If no overrides, shows "No parameter overrides — using domain defaults"

### Files

- `packages/runner/src/executor.ts` — capture config snapshots during merge
- `packages/dashboard/src/components/workspace/bottom-panel.tsx` — Config tab

---

## Schema Panel — Per-Field Transform Editor

Each expanded field gets a collapsible "transform" section:
- Toggle row with chevron to expand/collapse
- When expanded: CodeEditor component (~4-5 line height)
- Default scaffold: `function transform(text, row) { return text; }`
- Stored as `field.transform` string in the schema field object

---

## Results Storage

`runs.results` jsonb column:

```json
{
  "screenshotBase64": "...",
  "videoBase64": "...",
  "htmlLength": 123456,
  "finalUrl": "https://...",
  "responseStatus": 200,
  "records": [
    { "brand": "Apple", "price": "99.99" }
  ],
  "configSnapshot": {
    "overrides": [
      { "key": "timeout", "from": 60000, "to": 30000 }
    ],
    "merged": { ... }
  }
}
```

## Out of Scope

- Live browser streaming in dashboard (noVNC/CDP screencast)
- HAR storage for full resource fidelity (images, fonts)
- rrweb session replay
- Image inlining as data URIs (too much storage cost)
- MHTML capture (awkward to embed in iframe)
- Pagination (multi-page extraction)
- `jq` filter support
- `screenCapture` fields
- `solveCaptcha` integration
