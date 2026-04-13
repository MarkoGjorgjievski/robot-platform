# Fix BBC-Style Complex Listings

## Problem

Listing pages with custom React components (BBC News, modern SPAs) fail silently. The system finds rows but misses fields because:

1. **Generic listing prompt** — `selectorGenerationUserContent()` for listings is 4 lines with no guidance on complex DOM structures, React components, or scattered metadata
2. **Useless retry** — pipeline calls `generateSelectors()` with the same prompt when rows < 3. Same input = same output.
3. **Row-count-only trigger** — retry triggers on `data.length < 3`, not field coverage. A page with 5 rows and 2/8 fields filled passes.

## Solution

### 1. Improve listing selector prompt (`packages/agent/src/prompts.ts`)

Replace the listing branch of `selectorGenerationUserContent()` with a prompt that guides Claude on:

- **Finding repeating containers**: Look for elements that repeat with the same tag name and similar structure, not just shared class names. React generates dynamic classes like `_article_1a2b3` — prefer `<article>`, `<section>`, `<div>` with `data-*` attributes or semantic tags.
- **Scattered metadata**: When data is spread across sibling elements (not all inside the row container), use `following-sibling::`, `preceding-sibling::`, or `ancestor::` axis. Give concrete examples beyond Hacker News.
- **Field coverage goal**: Explicitly tell Claude "every field must have a working XPath — if a field's data isn't inside the row element, use axis traversal to reach it."

The improved prompt should be ~20 lines (not a wall of text). Concrete examples of patterns, not abstract rules.

### 2. Add retry selector method (`packages/agent/src/schema-agent.ts`)

Add a `retrySelectorGeneration()` method that takes:
- The same `capture`, `fields`, `pageType` as `generateSelectors()`
- Plus `feedback`: `{ missingFields: string[], rowCount: number, previousRowXpath: string }`

This method calls Claude with an enhanced prompt: "Your previous row_xpath `X` found N rows, but these fields returned null: [list]. Try broader selectors, sibling traversal, or ancestor access for the missing fields."

Also add the corresponding prompt function `selectorRetryUserContent()` in `prompts.ts`.

### 3. Add field coverage retry logic

**In `packages/scraper/src/pipeline.ts`:**

Replace the current retry block (lines 61-71) with:

```
const isListing = ['listing', 'search_results', 'table'].includes(schema.page_type);
if (isListing) {
  const fieldCoverage = calculateFieldCoverage(extractionResult.data, schema.fields);
  if (extractionResult.data.length < 3 || fieldCoverage < 0.5) {
    // Retry with feedback about what's missing
    const missingFields = getMissingFields(extractionResult.data, schema.fields);
    plan = await this.agent.retrySelectorGeneration(capture, schema.fields, schema.page_type, {
      missingFields,
      rowCount: extractionResult.data.length,
      previousRowXpath: plan.row_xpath,
    });
    plan.page_type = schema.page_type;
    const retry = await this.extractWithPlan(url, plan);
    if (retry.data.length >= extractionResult.data.length) {
      const retryCoverage = calculateFieldCoverage(retry.data, schema.fields);
      if (retryCoverage > fieldCoverage || retry.data.length > extractionResult.data.length) {
        extractionResult = retry;
      }
    }
  }
}
```

**In `packages/dashboard2/src/app/api/scraper/extract/route.ts`:**

Apply the same field coverage check in the XPath fallback section (Step 3). After the first XPath extraction attempt, if field coverage is low, call `retrySelectorGeneration()` with feedback.

### 4. Helper functions (`packages/scraper/src/field-coverage.ts`)

Small utility file:

```typescript
function calculateFieldCoverage(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): number
// Returns 0-1: average ratio of non-null fields per row

function getMissingFields(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): string[]
// Returns field names that are null/undefined in >50% of rows
```

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/prompts.ts` | Improve listing prompt in `selectorGenerationUserContent()`, add `selectorRetryUserContent()` |
| `packages/agent/src/schema-agent.ts` | Add `retrySelectorGeneration()` method |
| `packages/agent/src/types.ts` | Add `RetryFeedback` type |
| `packages/scraper/src/field-coverage.ts` | New file: `calculateFieldCoverage()` + `getMissingFields()` |
| `packages/scraper/src/field-coverage.test.ts` | Tests for coverage helpers |
| `packages/scraper/src/index.ts` | Export new helpers |
| `packages/scraper/src/pipeline.ts` | Replace retry block with field-coverage-based retry |
| `packages/dashboard2/src/app/api/scraper/extract/route.ts` | Add coverage check + retry in XPath fallback |

## What We're NOT Doing

- No changes to the executor — listing mode logic is correct
- No DOM manipulation or HTML snippeting — full HTML on retry
- No React-specific detection — improved prompts handle this generically
- No changes to schema discovery — page type detection works
- No changes to validation — it validates rows, not field coverage (that's our new retry trigger)
