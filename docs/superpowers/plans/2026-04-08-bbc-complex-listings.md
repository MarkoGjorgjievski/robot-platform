# BBC-Style Complex Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix listing extraction on complex pages (BBC News, React SPAs) by improving Claude's selector prompts and adding field-coverage-based retry logic.

**Architecture:** Improve the listing selector prompt to guide Claude on complex DOM structures. Add a `retrySelectorGeneration()` method that provides feedback about missing fields. Replace the row-count-only retry trigger with field coverage checks. Pure helper functions for coverage calculation.

**Tech Stack:** TypeScript, vitest, Anthropic Claude API (tool use)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/scraper/src/field-coverage.ts` | Create | `calculateFieldCoverage()` + `getMissingFields()` pure helpers |
| `packages/scraper/src/field-coverage.test.ts` | Create | Unit tests for coverage helpers |
| `packages/scraper/src/index.ts` | Modify | Export new helpers |
| `packages/agent/src/prompts.ts` | Modify | Improve listing prompt, add `selectorRetryUserContent()` |
| `packages/agent/src/schema-agent.ts` | Modify | Add `retrySelectorGeneration()` method |
| `packages/agent/src/types.ts` | Modify | Add `RetryFeedback` type |
| `packages/agent/src/index.ts` | Modify | Export new type |
| `packages/scraper/src/pipeline.ts` | Modify | Replace retry block with field-coverage-based retry |
| `packages/dashboard2/src/app/api/scraper/extract/route.ts` | Modify | Add coverage check + retry in XPath fallback |

---

### Task 1: Field coverage helpers

**Files:**
- Create: `packages/scraper/src/field-coverage.ts`
- Create: `packages/scraper/src/field-coverage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/scraper/src/field-coverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateFieldCoverage, getMissingFields } from './field-coverage.js';
import type { SchemaField } from '@robot/agent';

const fields: SchemaField[] = [
  { name: 'title', type: 'string', description: 'Title', required: true },
  { name: 'price', type: 'price', description: 'Price', required: true },
  { name: 'url', type: 'url', description: 'URL', required: false },
  { name: 'rating', type: 'number', description: 'Rating', required: false },
];

describe('calculateFieldCoverage', () => {
  it('returns 1.0 when all fields present in all rows', () => {
    const data = [
      { title: 'A', price: 10, url: 'https://a.com', rating: 4 },
      { title: 'B', price: 20, url: 'https://b.com', rating: 5 },
    ];
    expect(calculateFieldCoverage(data, fields)).toBe(1.0);
  });

  it('returns 0.5 when half the fields are present', () => {
    const data = [
      { title: 'A', price: 10 },
      { title: 'B', price: 20 },
    ];
    expect(calculateFieldCoverage(data, fields)).toBe(0.5);
  });

  it('returns 0 for empty data', () => {
    expect(calculateFieldCoverage([], fields)).toBe(0);
  });

  it('returns 0 for empty fields', () => {
    expect(calculateFieldCoverage([{ title: 'A' }], [])).toBe(0);
  });

  it('averages across rows with uneven coverage', () => {
    const data = [
      { title: 'A', price: 10, url: 'https://a.com', rating: 4 }, // 4/4
      { title: 'B' }, // 1/4
    ];
    // (4/4 + 1/4) / 2 = 0.625
    expect(calculateFieldCoverage(data, fields)).toBe(0.625);
  });

  it('ignores null and undefined values', () => {
    const data = [{ title: 'A', price: null, url: undefined, rating: 3 }];
    expect(calculateFieldCoverage(data, fields)).toBe(0.5);
  });
});

describe('getMissingFields', () => {
  it('returns fields missing in >50% of rows', () => {
    const data = [
      { title: 'A', price: 10 },
      { title: 'B', price: 20 },
      { title: 'C' },
    ];
    const missing = getMissingFields(data, fields);
    expect(missing).toContain('url');
    expect(missing).toContain('rating');
    expect(missing).not.toContain('title');
    expect(missing).not.toContain('price');
  });

  it('returns empty array when all fields present', () => {
    const data = [
      { title: 'A', price: 10, url: 'https://a.com', rating: 4 },
    ];
    expect(getMissingFields(data, fields)).toHaveLength(0);
  });

  it('returns all fields for empty data', () => {
    expect(getMissingFields([], fields)).toEqual(['title', 'price', 'url', 'rating']);
  });

  it('handles single row with partial data', () => {
    const data = [{ title: 'A' }];
    const missing = getMissingFields(data, fields);
    expect(missing).toContain('price');
    expect(missing).toContain('url');
    expect(missing).toContain('rating');
    expect(missing).not.toContain('title');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && npx vitest run src/field-coverage.test.ts`
Expected: FAIL — cannot find `./field-coverage.js`

- [ ] **Step 3: Implement field coverage helpers**

Create `packages/scraper/src/field-coverage.ts`:

```typescript
import type { SchemaField } from '@robot/agent';

/**
 * Calculate average field coverage across all rows.
 * Returns 0-1: ratio of non-null fields per row, averaged.
 */
export function calculateFieldCoverage(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): number {
  if (data.length === 0 || fields.length === 0) return 0;

  let totalCoverage = 0;
  for (const row of data) {
    let filled = 0;
    for (const field of fields) {
      if (row[field.name] !== undefined && row[field.name] !== null) {
        filled++;
      }
    }
    totalCoverage += filled / fields.length;
  }

  return totalCoverage / data.length;
}

/**
 * Return field names that are null/undefined in >50% of rows.
 * For empty data, returns all field names.
 */
export function getMissingFields(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): string[] {
  if (data.length === 0) return fields.map(f => f.name);

  return fields
    .filter(field => {
      const presentCount = data.filter(
        row => row[field.name] !== undefined && row[field.name] !== null,
      ).length;
      return presentCount <= data.length * 0.5;
    })
    .map(f => f.name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/scraper && npx vitest run src/field-coverage.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Export from scraper package**

Add to `packages/scraper/src/index.ts`:

```typescript
export { calculateFieldCoverage, getMissingFields } from './field-coverage.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/field-coverage.ts packages/scraper/src/field-coverage.test.ts packages/scraper/src/index.ts
git commit -m "feat(scraper): add field coverage helpers for listing retry logic"
```

---

### Task 2: Improve listing selector prompt

**Files:**
- Modify: `packages/agent/src/prompts.ts`

- [ ] **Step 1: Replace the listing branch of `selectorGenerationUserContent()`**

In `packages/agent/src/prompts.ts`, replace the listing return statement (lines 100-108):

Old code:
```typescript
  return `Given this HTML, generate XPath expressions to extract these fields from each repeating item:

${fieldList}

IMPORTANT: Some pages have metadata in sibling elements (e.g. Hacker News uses two <tr> rows per story). Use following-sibling:: to traverse to adjacent elements when needed.

HTML:

${html}`;
```

New code:
```typescript
  return `Given this HTML, generate XPath expressions to extract these fields from each repeating item:

${fieldList}

RULES FOR FINDING THE ROW CONTAINER (row_xpath):
- Look for elements that REPEAT with the same tag name and similar structure (e.g. multiple <article>, <li>, <div> with the same role)
- Prefer semantic HTML tags: <article>, <section>, <li>, <tr> over generic <div>
- DO NOT rely on class names — React/frameworks generate dynamic classes like "_card_a1b2c" that are unreliable
- Use data-* attributes when available: //article[@data-testid] or //div[@data-type="story"]
- The row_xpath should match ALL repeating items (typically 5-50 elements)

RULES FOR FIELD XPATHS:
- Start with relative paths (.//h2, .//span[@class]) for data INSIDE the row container
- If a field's data is NOT inside the row container (e.g. metadata in a sibling element), use axis traversal:
  - following-sibling::div[@class="meta"] — data in the next sibling element
  - preceding-sibling::header//span — data in a previous sibling
  - ancestor::div//aside//time — data in a parent's sibling
- EVERY field must have a working XPath. If you can't find a field inside the row, use axis traversal to reach it.

COMMON PATTERNS:
- News sites: <article> items with metadata in sibling <aside> or <footer> elements
- E-commerce: <div> cards where price/rating is in a nested component wrapper
- Tables: <tr> rows where some columns span multiple elements

HTML:

${html}`;
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/prompts.ts
git commit -m "feat(agent): improve listing selector prompt for complex DOM structures"
```

---

### Task 3: Add retry selector prompt and method

**Files:**
- Modify: `packages/agent/src/types.ts`
- Modify: `packages/agent/src/prompts.ts`
- Modify: `packages/agent/src/schema-agent.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add RetryFeedback type**

Add to `packages/agent/src/types.ts` at the end of the file:

```typescript
export type RetryFeedback = {
  missingFields: string[];
  rowCount: number;
  previousRowXpath: string;
};
```

- [ ] **Step 2: Export RetryFeedback from agent package**

In `packages/agent/src/index.ts`, add `RetryFeedback` to the type exports:

```typescript
export type {
  FieldType,
  SchemaField,
  PageType,
  DiscoveredSchema,
  SelectorField,
  ExtractionPlan,
  ValidationResult,
  ExtractionResult,
  ApiFieldExtraction,
  ApiExtractionResult,
  RetryFeedback,
} from './types.js';
```

- [ ] **Step 3: Add selectorRetryUserContent prompt**

Add this function to `packages/agent/src/prompts.ts`, after the `selectorGenerationUserContent` function:

```typescript
export function selectorRetryUserContent(
  html: string,
  fields: Array<{ name: string; type: string }>,
  feedback: { missingFields: string[]; rowCount: number; previousRowXpath: string },
  pageType?: string,
): string {
  const fieldList = fields.map(f => `- ${f.name} (${f.type})`).join('\n');
  const missingList = feedback.missingFields.map(f => `- ${f}`).join('\n');

  return `RETRY: Your previous selectors found ${feedback.rowCount} rows using row_xpath="${feedback.previousRowXpath}", but these fields returned null/empty in most rows:

${missingList}

Generate IMPROVED XPath expressions for ALL fields (not just the missing ones). You may keep the same row_xpath if it correctly identifies the repeating items, or change it if needed.

Fields to extract:
${fieldList}

TIPS FOR FIXING MISSING FIELDS:
- If the missing field's data is NOT inside the row container, use axis traversal (following-sibling::, ancestor::, preceding-sibling::)
- Try broader selectors: .//descendant::*[contains(text(), "price")] if a specific class-based XPath failed
- Check if the data is in a different attribute (e.g. @content, @data-value, @aria-label instead of textContent)
- The data might be in a <script> tag with JSON — if so, it can't be extracted via XPath (report what you can)

HTML:

${html}`;
}
```

- [ ] **Step 4: Import selectorRetryUserContent in schema-agent.ts**

In `packages/agent/src/schema-agent.ts`, add `selectorRetryUserContent` to the import from `./prompts.js` (line 7):

Change:
```typescript
import {
  SCHEMA_DISCOVERY_SYSTEM,
  SELECTOR_GENERATION_SYSTEM,
  API_EXTRACTION_SYSTEM,
  VALIDATION_SYSTEM,
  schemaDiscoveryUserContent,
  selectorGenerationUserContent,
  apiExtractionUserContent,
  validationUserContent,
} from './prompts.js';
```

To:
```typescript
import {
  SCHEMA_DISCOVERY_SYSTEM,
  SELECTOR_GENERATION_SYSTEM,
  API_EXTRACTION_SYSTEM,
  VALIDATION_SYSTEM,
  schemaDiscoveryUserContent,
  selectorGenerationUserContent,
  selectorRetryUserContent,
  apiExtractionUserContent,
  validationUserContent,
} from './prompts.js';
```

Also add `RetryFeedback` to the import from `./types.js` (line 16-22):

Change:
```typescript
import type {
  DiscoveredSchema,
  ExtractionPlan,
  ApiExtractionResult,
  ValidationResult,
  SchemaField,
} from './types.js';
```

To:
```typescript
import type {
  DiscoveredSchema,
  ExtractionPlan,
  ApiExtractionResult,
  ValidationResult,
  SchemaField,
  RetryFeedback,
} from './types.js';
```

- [ ] **Step 5: Add retrySelectorGeneration method to SchemaAgent**

Add this method to the `SchemaAgent` class in `packages/agent/src/schema-agent.ts`, after the `generateSelectors` method (after line 95):

```typescript
  async retrySelectorGeneration(
    capture: PageCapture,
    fields: SchemaField[],
    pageType: string,
    feedback: RetryFeedback,
  ): Promise<ExtractionPlan> {
    const html = truncateHtml(capture.html, this.anthropic ? 50000 : 30000);
    const fieldSummary = fields.map(f => ({ name: f.name, type: f.type }));
    const userText = selectorRetryUserContent(html, fieldSummary, feedback, pageType);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: SELECTOR_GENERATION_SYSTEM,
        tool: generateSelectorsTool,
        userText,
      });
      return result as ExtractionPlan;
    }

    const json = await this.ollama!.callWithJson({
      system: SELECTOR_GENERATION_SYSTEM + '\n\nYou MUST respond with valid JSON only. Return XPath expressions, NOT data values.',
      userText,
    }) as Record<string, unknown>;

    return normalizeSelectorResponse(json);
  }
```

- [ ] **Step 6: Verify types compile**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/prompts.ts packages/agent/src/schema-agent.ts packages/agent/src/index.ts
git commit -m "feat(agent): add retry selector generation with feedback prompt"
```

---

### Task 4: Update pipeline retry logic

**Files:**
- Modify: `packages/scraper/src/pipeline.ts`

- [ ] **Step 1: Add import for field coverage helpers**

In `packages/scraper/src/pipeline.ts`, add this import after line 3:

```typescript
import { calculateFieldCoverage, getMissingFields } from './field-coverage.js';
```

- [ ] **Step 2: Replace the retry block**

In `packages/scraper/src/pipeline.ts`, replace lines 61-71 (the current retry block):

Old code:
```typescript
      // If listing page returned very few rows, retry with a hint
      const isListing = ['listing', 'search_results', 'table'].includes(schema.page_type);
      if (isListing && extractionResult.data.length < 3) {
        console.warn(`[pipeline] Listing page returned only ${extractionResult.data.length} rows — retrying with stricter prompt`);
        plan = await this.agent.generateSelectors(capture, schema.fields, schema.page_type);
        plan.page_type = schema.page_type;
        const retry = await this.extractWithPlan(url, plan);
        if (retry.data.length > extractionResult.data.length) {
          extractionResult = retry;
        }
      }
```

New code:
```typescript
      // If listing page has low row count OR low field coverage, retry with feedback
      const isListing = ['listing', 'search_results', 'table'].includes(schema.page_type);
      if (isListing) {
        const fieldCoverage = calculateFieldCoverage(extractionResult.data, schema.fields);
        if (extractionResult.data.length < 3 || fieldCoverage < 0.5) {
          const missingFields = getMissingFields(extractionResult.data, schema.fields);
          console.warn(`[pipeline] Listing: ${extractionResult.data.length} rows, ${Math.round(fieldCoverage * 100)}% field coverage — retrying (missing: ${missingFields.join(', ')})`);
          plan = await this.agent.retrySelectorGeneration(capture, schema.fields, schema.page_type, {
            missingFields,
            rowCount: extractionResult.data.length,
            previousRowXpath: plan.row_xpath,
          });
          plan.page_type = schema.page_type;
          const retry = await this.extractWithPlan(url, plan);
          const retryCoverage = calculateFieldCoverage(retry.data, schema.fields);
          if (retryCoverage > fieldCoverage || retry.data.length > extractionResult.data.length) {
            extractionResult = retry;
          }
        }
      }
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/scraper && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all scraper tests**

Run: `cd packages/scraper && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/pipeline.ts
git commit -m "feat(scraper): field-coverage-based retry for listing pages"
```

---

### Task 5: Add coverage retry to extract route

**Files:**
- Modify: `packages/dashboard2/src/app/api/scraper/extract/route.ts`

- [ ] **Step 1: Add imports**

In `packages/dashboard2/src/app/api/scraper/extract/route.ts`, update the `@robot/scraper` import (line 17) to include the new helpers:

Change:
```typescript
    const { extractFromStructuredData, lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, acquireDomainLock, detectSchemaChanges, formatSchemaChanges, validateExtractedData } = await import('@robot/scraper');
```

To:
```typescript
    const { extractFromStructuredData, lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, acquireDomainLock, detectSchemaChanges, formatSchemaChanges, validateExtractedData, calculateFieldCoverage, getMissingFields } = await import('@robot/scraper');
```

- [ ] **Step 2: Add field coverage retry after XPath fallback**

In the extract route, replace the XPath fallback section (lines 199-232). The current code does a single `generateSelectors` attempt. Replace with coverage-aware retry:

Old code:
```typescript
    // ─── STEP 3: XPath fallback (for still-missing fields) ─────────────
    const missingAfterApi = schemaFields.filter(
      (f: { name: string }) => finalData[f.name] === undefined
    );

    let plan = null;
    if (missingAfterApi.length > 0) {
      console.log(`[extract] ${missingAfterApi.length} fields still missing, XPath fallback`);
      try {
        plan = await agent.generateSelectors(capture, missingAfterApi, resolvedPageType);
        const script = buildExtractionScript(plan);
        const xpathResult = await browser.evaluate<{ data: Record<string, unknown>[] }>(
          url, script, { waitUntil: 'networkidle' }
        );

        if (xpathResult.data.length > 0) {
          for (let i = 0; i < plan.fields.length; i++) {
            const fieldDef = plan.fields[i];
            const value = xpathResult.data[0][fieldDef.name];
            if (finalData[fieldDef.name] === undefined && value !== null && value !== undefined) {
              finalData[fieldDef.name] = value;
              fieldResults[fieldDef.name] = {
                value,
                source: 'xpath',
                path: fieldDef.xpath,
                confidence: 0.7,
              };
            }
          }
        }
      } catch (err) {
        console.error('[extract] XPath fallback failed (non-fatal):', err);
      }
    }
```

New code:
```typescript
    // ─── STEP 3: XPath fallback (for still-missing fields) ─────────────
    const missingAfterApi = schemaFields.filter(
      (f: { name: string }) => finalData[f.name] === undefined
    );

    let plan = null;
    if (missingAfterApi.length > 0) {
      console.log(`[extract] ${missingAfterApi.length} fields still missing, XPath fallback`);
      try {
        plan = await agent.generateSelectors(capture, missingAfterApi, resolvedPageType);
        const script = buildExtractionScript(plan);
        const xpathResult = await browser.evaluate<{ data: Record<string, unknown>[] }>(
          url, script, { waitUntil: 'networkidle' }
        );

        if (xpathResult.data.length > 0) {
          for (const fieldDef of plan.fields) {
            const value = xpathResult.data[0][fieldDef.name];
            if (finalData[fieldDef.name] === undefined && value !== null && value !== undefined) {
              finalData[fieldDef.name] = value;
              fieldResults[fieldDef.name] = {
                value,
                source: 'xpath',
                path: fieldDef.xpath,
                confidence: 0.7,
              };
            }
          }
        }

        // Coverage-based retry for listing pages
        const isListing = resolvedPageType === 'listing' || resolvedPageType === 'search_results' || resolvedPageType === 'table';
        if (isListing && xpathResult.data.length > 0) {
          const coverage = calculateFieldCoverage(xpathResult.data, schemaFields);
          if (coverage < 0.5) {
            const missing = getMissingFields(xpathResult.data, schemaFields);
            console.log(`[extract] Low field coverage (${Math.round(coverage * 100)}%), retrying — missing: ${missing.join(', ')}`);
            try {
              const retryPlan = await agent.retrySelectorGeneration(capture, schemaFields, resolvedPageType, {
                missingFields: missing,
                rowCount: xpathResult.data.length,
                previousRowXpath: plan.row_xpath,
              });
              const retryScript = buildExtractionScript(retryPlan);
              const retryResult = await browser.evaluate<{ data: Record<string, unknown>[] }>(
                url, retryScript, { waitUntil: 'networkidle' }
              );

              if (retryResult.data.length > 0) {
                for (const fieldDef of retryPlan.fields) {
                  const value = retryResult.data[0][fieldDef.name];
                  if (finalData[fieldDef.name] === undefined && value !== null && value !== undefined) {
                    finalData[fieldDef.name] = value;
                    fieldResults[fieldDef.name] = {
                      value,
                      source: 'xpath',
                      path: fieldDef.xpath,
                      confidence: 0.7,
                    };
                  }
                }
                plan = retryPlan;
              }
            } catch (retryErr) {
              console.error('[extract] XPath retry failed (non-fatal):', retryErr);
            }
          }
        }
      } catch (err) {
        console.error('[extract] XPath fallback failed (non-fatal):', err);
      }
    }
```

- [ ] **Step 3: Verify the file is syntactically valid**

Run: `cd packages/dashboard2 && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to our changes)

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard2/src/app/api/scraper/extract/route.ts
git commit -m "feat: add field coverage retry to extract route for listing pages"
```
