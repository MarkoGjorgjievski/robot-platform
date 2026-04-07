# Data Quality Checks

## Purpose

Validate extracted field values against their declared types after extraction, before returning results. Catches bad data early (HTML in text, negative prices, broken URLs) and auto-fixes what it can.

## Module

New file: `packages/scraper/src/data-quality.ts`

Exported from `packages/scraper/src/index.ts`.

## Types

```typescript
type QualityIssue = {
  field: string;
  row?: number;              // undefined = applies to all rows
  type: 'warning' | 'error';
  message: string;
  autoFixed?: boolean;       // true if the value was corrected in-place
  originalValue?: unknown;   // original value before auto-fix
};

type QualityResult = {
  data: Record<string, unknown>[];  // cleaned data (auto-fixes applied)
  issues: QualityIssue[];
};
```

## Function

```typescript
function validateExtractedData(
  data: Record<string, unknown>[],
  fields: SchemaField[],       // from @robot/agent types (has name + type)
): QualityResult
```

Pure function, no side effects. Returns a new copy of data with auto-fixes applied, plus an issues array.

## Validation Rules

### Per-field type checks

| Type | Auto-fix | Warning | Error |
|------|----------|---------|-------|
| `price` | Strip currency symbols ($, EUR, etc.), parse to number | Price = 0 (could be free) | Price < 0; not a number after parsing |
| `number` | Strip commas, parse | — | Not numeric; abs(value) > 1e9 |
| `url` / `image_url` | Trim whitespace | — | Does not start with `http://` or `https://`; fails `new URL()` |
| `string` | Strip HTML tags (`<tag>` patterns); collapse whitespace | Value > 5000 chars (likely wrong element) | Just whitespace after stripping |
| `date` | — | Date > 1 year in the future | Not parseable as date |
| `boolean` | Convert "yes"/"true"/"1" → true, "no"/"false"/"0" → false | — | Not convertible to boolean |
| `array` | — | Empty array | Not an array |

### Cross-row checks (listings only, when data.length > 1)

- **Duplicate values:** If all rows have the exact same value for a field, issue warning ("all rows identical — likely wrong selector").
- **Missing required fields:** If > 50% of rows are missing a required field, issue warning.

### What we do NOT check

- No semantic validation (e.g., "is this really a product name?") — that's AI validation's job.
- No cross-field consistency (e.g., "sale price < regular price") — too domain-specific for v1.
- No deduplication of rows.

## Integration

### Extract route (`/api/scraper/extract/route.ts`)

Called after Step 4 (confidence calculation), before returning JSON:

```typescript
import { validateExtractedData } from '@robot/scraper';

// ... after extraction ...
const { data: cleanedData, issues } = validateExtractedData(
  [finalData],  // or multiple rows for listings
  schemaFields,
);

return NextResponse.json({
  data: cleanedData,
  // ... existing fields ...
  qualityIssues: issues.length > 0 ? issues : undefined,
});
```

### Wizard preview (`wizard.tsx`)

Display quality issues as inline warnings/errors beneath the data table. No new UI components needed — use existing `Badge` with amber (warning) and red (error) colors. Auto-fixes show a small "auto-fixed" badge.

### Pipeline (`pipeline.ts`)

Also call `validateExtractedData` at the end of `ScraperPipeline.run()` before returning `PipelineResult`, so CLI test runs also get quality checks.

## Testing

Unit tests in `packages/scraper/src/__tests__/data-quality.test.ts`:

- Each field type with valid, warning, and error cases
- Auto-fix cases (HTML stripping, currency parsing, boolean conversion)
- Cross-row duplicate detection
- Missing required field detection
- Edge cases: empty data, no fields, null values
