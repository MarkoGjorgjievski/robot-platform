# Extraction Engine Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Build the extraction engine that closes the loop: schema fields (CSS/XPath selectors) → extracted data from crawled pages → structured results in the Data tab. This is the core value of the platform — config and schema drive actual data extraction.

## Key Decisions

- **Output format:** Flat records — `{ fieldName: value }[]`. No Import.io `Group[]` compatibility.
- **Extraction runs in-browser:** Via `page.evaluate()` against the live rendered DOM (not server-side HTML parsing). This preserves JS-rendered content.
- **beforeExtract:** Runs in-browser via `page.evaluate()` — needs live page for popups/clicks.
- **Per-field transform:** Each schema field gets an optional `transform` function. Stored as a JS function string, executed server-side via `new Function('text', 'row', body)`.
- **Global transform.js:** Backward-compatible, runs server-side after per-field transforms. Only when `useTransform` parameter is true.

## Architecture

### 1. Extraction Engine (`packages/runner/src/extractor.ts`)

New file. Core function:

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

### 2. Schema Loading

**For source-based runs:**
1. Load robot override via source's `domainId` + `country`
2. Pick schema variant from `source.parameters.schemaYAML` or first key in `override.schemas`
3. Fallback: convert collection schema to extraction format

**For legacy extractor-based runs:**
1. Load override via `extractor.domainId` + `country`
2. Pick schema from `extractor.parameters.schemaYAML`

**Domain default merging:** Load `robotOverrides.parameterOverrides` and deep-merge with source/extractor parameters. Source params take precedence. This means config panel changes flow through without copying every default.

### 3. beforeExtract Execution

1. Load `jsOverrides.beforeExtract` from robot override
2. If it exists, execute via `page.evaluate()` with `inputs` and `params` as arguments
3. The old CJS `module.exports = { implementation: async (...) => {} }` format needs the implementation body extracted and wrapped
4. Errors are caught and logged — a failing beforeExtract doesn't kill the run

### 4. Transform Pipeline

**Per-field transform (new):**
- Each schema field has an optional `transform` string property
- Contains a JS function body: `function transform(text, row) { return text; }`
- Stored/edited in the Schema panel via CodeEditor
- Executed server-side: strip the function wrapper, create `new Function('text', 'row', body)`
- Called with raw extracted text and the full row object
- Functions are cached per extraction run (not re-created per record)

**Global transform.js (backward compat):**
- Loaded from `jsOverrides.transform`
- Only runs if `useTransform` parameter is true
- Receives the full records array, returns modified records
- Runs after per-field transforms

### 5. Updated Executor Flow

```
1.  Load run, source/extractor, input data          (unchanged)
2.  Load robot override                              (NEW)
3.  Merge parameters (override defaults + source)    (NEW)
4.  Build URL                                        (unchanged)
5.  Launch browser, configure                        (unchanged)
6.  Navigate                                         (unchanged)
7.  Page validation, scrolling, ordered actions       (unchanged)
8.  Run beforeExtract                                (NEW)
9.  Run extraction — extractData(page, schema)       (NEW)
10. Run per-field transforms                         (NEW)
11. Run global transform.js                          (NEW)
12. Capture screenshot and HTML                      (unchanged)
13. Store results with extracted records             (UPDATED)
```

### 6. Results Storage

`runs.results` jsonb column now contains:

```json
{
  "screenshotBase64": "...",
  "htmlLength": 123456,
  "finalUrl": "https://...",
  "responseStatus": 200,
  "records": [
    { "brand": "Apple", "price": "99.99" },
    { "brand": "Samsung", "price": "79.99" }
  ]
}
```

`runs.resultCount` = actual number of extracted records.

The Data tab in the bottom panel already renders `JSON.stringify(runResults, null, 2)` — extracted records show up automatically.

### 7. Schema Panel — Per-Field Transform Editor

Each expanded field in the Schema panel gets a collapsible "transform" section:
- Toggle row with chevron to expand/collapse
- When expanded: CodeEditor component (~4-5 line height)
- Default scaffold when empty:
  ```js
  function transform(text, row) {
    return text;
  }
  ```
- Stored as `field.transform` string in the schema field object
- `SchemaField` interface gets: `transform?: string`

## Files Changed

| File | Change |
|------|--------|
| `packages/runner/src/extractor.ts` | **New** — extraction engine core |
| `packages/runner/src/executor.ts` | Load override, merge params, call beforeExtract → extract → transform pipeline |
| `packages/dashboard/src/components/workspace/schema-panel.tsx` | Add per-field transform CodeEditor |

## Out of Scope

- Pagination (multi-page extraction)
- `jq` filter support
- `screenCapture` fields
- Table view for Data tab (JSON display is fine for now)
- `solveCaptcha` integration
