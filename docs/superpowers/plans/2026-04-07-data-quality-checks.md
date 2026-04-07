# Data Quality Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate extracted field values against their declared types, auto-fix common issues (HTML in text, currency symbols in prices), and surface warnings/errors to the user.

**Architecture:** A single pure function `validateExtractedData` in `@robot/scraper` that takes extracted rows + field schema, returns cleaned data + quality issues. Integrated into the extract API route and surfaced in the wizard preview step.

**Tech Stack:** TypeScript, vitest, Next.js API routes, React (wizard UI)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/scraper/src/data-quality.ts` | Create | Pure validation function + all type-specific rules |
| `packages/scraper/src/data-quality.test.ts` | Create | Unit tests for all validation rules |
| `packages/scraper/src/index.ts` | Modify | Export new module |
| `packages/dashboard2/src/app/api/scraper/extract/route.ts` | Modify | Call `validateExtractedData` before returning response |
| `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx` | Modify | Store + display quality issues in preview step |

---

### Task 1: Core types and price validation

**Files:**
- Create: `packages/scraper/src/data-quality.ts`
- Create: `packages/scraper/src/data-quality.test.ts`

- [ ] **Step 1: Write failing tests for price validation**

Create `packages/scraper/src/data-quality.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateExtractedData } from './data-quality.js';
import type { SchemaField } from '@robot/agent';

const priceField: SchemaField = { name: 'price', type: 'price', description: 'Product price', required: true };

describe('validateExtractedData', () => {
  describe('price fields', () => {
    it('passes valid prices through unchanged', () => {
      const { data, issues } = validateExtractedData(
        [{ price: 29.99 }],
        [priceField],
      );
      expect(data[0].price).toBe(29.99);
      expect(issues).toHaveLength(0);
    });

    it('strips currency symbols and parses to number', () => {
      const { data, issues } = validateExtractedData(
        [{ price: '$29.99' }],
        [priceField],
      );
      expect(data[0].price).toBe(29.99);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        field: 'price',
        type: 'warning',
        autoFixed: true,
        originalValue: '$29.99',
      });
    });

    it('handles EUR and GBP symbols', () => {
      const { data: d1 } = validateExtractedData([{ price: '€49.00' }], [priceField]);
      expect(d1[0].price).toBe(49.00);

      const { data: d2 } = validateExtractedData([{ price: '£12.50' }], [priceField]);
      expect(d2[0].price).toBe(12.50);
    });

    it('handles comma-formatted prices', () => {
      const { data } = validateExtractedData([{ price: '1,299.99' }], [priceField]);
      expect(data[0].price).toBe(1299.99);
    });

    it('warns on price = 0', () => {
      const { data, issues } = validateExtractedData([{ price: 0 }], [priceField]);
      expect(data[0].price).toBe(0);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'warning', message: expect.stringContaining('zero') });
    });

    it('errors on negative price', () => {
      const { issues } = validateExtractedData([{ price: -5 }], [priceField]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'error' });
    });

    it('errors on non-numeric price', () => {
      const { issues } = validateExtractedData([{ price: 'not a price' }], [priceField]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'error' });
    });

    it('errors on price > 1000000', () => {
      const { issues } = validateExtractedData([{ price: 9999999 }], [priceField]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'error' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/scraper && npx vitest run src/data-quality.test.ts`
Expected: FAIL — cannot find `./data-quality.js`

- [ ] **Step 3: Write the data-quality module with price validation**

Create `packages/scraper/src/data-quality.ts`:

```typescript
import type { SchemaField } from '@robot/agent';

export type QualityIssue = {
  field: string;
  row?: number;
  type: 'warning' | 'error';
  message: string;
  autoFixed?: boolean;
  originalValue?: unknown;
};

export type QualityResult = {
  data: Record<string, unknown>[];
  issues: QualityIssue[];
};

export function validateExtractedData(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): QualityResult {
  if (data.length === 0 || fields.length === 0) {
    return { data, issues: [] };
  }

  const issues: QualityIssue[] = [];
  const cleaned = data.map((row, rowIdx) => {
    const newRow = { ...row };
    for (const field of fields) {
      if (newRow[field.name] === undefined || newRow[field.name] === null) continue;
      const result = validateField(field, newRow[field.name], data.length > 1 ? rowIdx : undefined);
      newRow[field.name] = result.value;
      issues.push(...result.issues);
    }
    return newRow;
  });

  // Cross-row checks for listings
  if (cleaned.length > 1) {
    issues.push(...checkCrossRow(cleaned, fields));
  }

  return { data: cleaned, issues };
}

function validateField(
  field: SchemaField,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  switch (field.type) {
    case 'price': return validatePrice(field.name, value, row);
    default: return { value, issues: [] };
  }
}

function validatePrice(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  let parsed = value;

  // Auto-fix: strip currency symbols and parse
  if (typeof value === 'string') {
    const stripped = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const num = parseFloat(stripped);
    if (isNaN(num)) {
      issues.push({ field: name, row, type: 'error', message: `Price is not a valid number: "${value}"` });
      return { value, issues };
    }
    parsed = num;
    issues.push({
      field: name,
      row,
      type: 'warning',
      message: `Price parsed from string "${value}" to ${num}`,
      autoFixed: true,
      originalValue: value,
    });
  }

  if (typeof parsed !== 'number' || isNaN(parsed)) {
    issues.push({ field: name, row, type: 'error', message: `Price is not a number` });
    return { value, issues };
  }

  if (parsed < 0) {
    issues.push({ field: name, row, type: 'error', message: `Price is negative: ${parsed}` });
  } else if (parsed === 0) {
    issues.push({ field: name, row, type: 'warning', message: `Price is zero (may be intentional)` });
  } else if (parsed > 1_000_000) {
    issues.push({ field: name, row, type: 'error', message: `Price is unreasonably high: ${parsed}` });
  }

  return { value: parsed, issues };
}

function checkCrossRow(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const field of fields) {
    const values = data.map(row => row[field.name]);
    const nonNull = values.filter(v => v !== undefined && v !== null);

    // All rows identical
    if (nonNull.length > 1 && nonNull.every(v => JSON.stringify(v) === JSON.stringify(nonNull[0]))) {
      issues.push({
        field: field.name,
        type: 'warning',
        message: `All ${nonNull.length} rows have identical value — likely wrong selector`,
      });
    }

    // Required field missing in > 50% of rows
    if (field.required && nonNull.length < data.length * 0.5) {
      issues.push({
        field: field.name,
        type: 'warning',
        message: `Required field missing in ${data.length - nonNull.length}/${data.length} rows`,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/scraper && npx vitest run src/data-quality.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/data-quality.ts packages/scraper/src/data-quality.test.ts
git commit -m "feat(scraper): add data quality validation — price checks"
```

---

### Task 2: String, URL, and number validation

**Files:**
- Modify: `packages/scraper/src/data-quality.ts`
- Modify: `packages/scraper/src/data-quality.test.ts`

- [ ] **Step 1: Write failing tests for string, URL, and number validation**

Append to `packages/scraper/src/data-quality.test.ts`:

```typescript
const stringField: SchemaField = { name: 'title', type: 'string', description: 'Product title', required: false };
const urlField: SchemaField = { name: 'url', type: 'url', description: 'Product URL', required: false };
const imageField: SchemaField = { name: 'image', type: 'image_url', description: 'Image', required: false };
const numberField: SchemaField = { name: 'rating', type: 'number', description: 'Rating', required: false };

describe('string fields', () => {
  it('passes clean strings through', () => {
    const { data, issues } = validateExtractedData([{ title: 'iPhone 15' }], [stringField]);
    expect(data[0].title).toBe('iPhone 15');
    expect(issues).toHaveLength(0);
  });

  it('strips HTML tags', () => {
    const { data, issues } = validateExtractedData(
      [{ title: '<span class="bold">iPhone</span> 15 <br/>' }],
      [stringField],
    );
    expect(data[0].title).toBe('iPhone 15');
    expect(issues[0]).toMatchObject({ autoFixed: true });
  });

  it('errors on whitespace-only after stripping', () => {
    const { issues } = validateExtractedData([{ title: '<div>  </div>' }], [stringField]);
    expect(issues.some(i => i.type === 'error')).toBe(true);
  });

  it('warns on very long strings', () => {
    const { issues } = validateExtractedData([{ title: 'x'.repeat(6000) }], [stringField]);
    expect(issues.some(i => i.type === 'warning' && i.message.includes('long'))).toBe(true);
  });
});

describe('url fields', () => {
  it('passes valid URLs', () => {
    const { issues } = validateExtractedData([{ url: 'https://example.com/product' }], [urlField]);
    expect(issues).toHaveLength(0);
  });

  it('errors on non-http URLs', () => {
    const { issues } = validateExtractedData([{ url: 'javascript:void(0)' }], [urlField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });

  it('errors on unparseable URLs', () => {
    const { issues } = validateExtractedData([{ url: 'not a url at all' }], [urlField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });

  it('auto-fixes trimming whitespace', () => {
    const { data, issues } = validateExtractedData([{ url: '  https://example.com  ' }], [urlField]);
    expect(data[0].url).toBe('https://example.com');
    expect(issues[0]).toMatchObject({ autoFixed: true });
  });

  it('validates image_url same as url', () => {
    const { issues } = validateExtractedData([{ image: 'not-a-url' }], [imageField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });
});

describe('number fields', () => {
  it('passes valid numbers', () => {
    const { issues } = validateExtractedData([{ rating: 4.5 }], [numberField]);
    expect(issues).toHaveLength(0);
  });

  it('parses string numbers', () => {
    const { data, issues } = validateExtractedData([{ rating: '4.5' }], [numberField]);
    expect(data[0].rating).toBe(4.5);
    expect(issues[0]).toMatchObject({ autoFixed: true });
  });

  it('strips commas from numbers', () => {
    const { data } = validateExtractedData([{ rating: '1,234' }], [numberField]);
    expect(data[0].rating).toBe(1234);
  });

  it('errors on non-numeric', () => {
    const { issues } = validateExtractedData([{ rating: 'high' }], [numberField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });

  it('errors on absurdly large numbers', () => {
    const { issues } = validateExtractedData([{ rating: 2e10 }], [numberField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && npx vitest run src/data-quality.test.ts`
Expected: FAIL — new tests fail because `validateField` only handles `price`

- [ ] **Step 3: Add string, URL, and number validation to data-quality.ts**

Add these cases to the `validateField` switch in `packages/scraper/src/data-quality.ts`:

```typescript
    case 'string': return validateString(field.name, value, row);
    case 'url':
    case 'image_url': return validateUrl(field.name, value, row);
    case 'number': return validateNumber(field.name, value, row);
```

Add these functions after `validatePrice`:

```typescript
function validateString(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  if (typeof value !== 'string') return { value, issues };

  // Auto-fix: strip HTML tags
  const stripped = value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (stripped !== value) {
    if (stripped === '') {
      issues.push({ field: name, row, type: 'error', message: 'String is empty after stripping HTML' });
      return { value: stripped, issues };
    }
    issues.push({
      field: name, row, type: 'warning',
      message: `Stripped HTML tags from value`,
      autoFixed: true, originalValue: value,
    });
    value = stripped;
  }

  if (typeof value === 'string' && value.length > 5000) {
    issues.push({ field: name, row, type: 'warning', message: `String is very long (${value.length} chars) — may be wrong element` });
  }

  return { value, issues };
}

function validateUrl(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  if (typeof value !== 'string') {
    issues.push({ field: name, row, type: 'error', message: 'URL is not a string' });
    return { value, issues };
  }

  // Auto-fix: trim whitespace
  const trimmed = value.trim();
  if (trimmed !== value) {
    issues.push({
      field: name, row, type: 'warning',
      message: 'Trimmed whitespace from URL',
      autoFixed: true, originalValue: value,
    });
    value = trimmed;
  }

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    issues.push({ field: name, row, type: 'error', message: `URL does not start with http(s): "${trimmed.slice(0, 60)}"` });
    return { value, issues };
  }

  try {
    new URL(trimmed);
  } catch {
    issues.push({ field: name, row, type: 'error', message: `URL is not parseable: "${trimmed.slice(0, 60)}"` });
  }

  return { value, issues };
}

function validateNumber(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  let parsed = value;

  if (typeof value === 'string') {
    const stripped = value.replace(/,/g, '');
    const num = parseFloat(stripped);
    if (isNaN(num)) {
      issues.push({ field: name, row, type: 'error', message: `Not a valid number: "${value}"` });
      return { value, issues };
    }
    parsed = num;
    issues.push({
      field: name, row, type: 'warning',
      message: `Parsed number from string "${value}" to ${num}`,
      autoFixed: true, originalValue: value,
    });
  }

  if (typeof parsed !== 'number' || isNaN(parsed)) {
    issues.push({ field: name, row, type: 'error', message: 'Not a number' });
    return { value, issues };
  }

  if (Math.abs(parsed) > 1e9) {
    issues.push({ field: name, row, type: 'error', message: `Number is unreasonably large: ${parsed}` });
  }

  return { value: parsed, issues };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/scraper && npx vitest run src/data-quality.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/data-quality.ts packages/scraper/src/data-quality.test.ts
git commit -m "feat(scraper): add string, URL, and number quality checks"
```

---

### Task 3: Boolean, date validation and cross-row checks

**Files:**
- Modify: `packages/scraper/src/data-quality.ts`
- Modify: `packages/scraper/src/data-quality.test.ts`

- [ ] **Step 1: Write failing tests for boolean, date, and cross-row checks**

Append to `packages/scraper/src/data-quality.test.ts`:

```typescript
const boolField: SchemaField = { name: 'in_stock', type: 'boolean', description: 'In stock', required: false };
const dateField: SchemaField = { name: 'published', type: 'date', description: 'Date', required: false };

describe('boolean fields', () => {
  it('passes actual booleans', () => {
    const { data, issues } = validateExtractedData([{ in_stock: true }], [boolField]);
    expect(data[0].in_stock).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it('converts "yes"/"true"/"1" to true', () => {
    for (const val of ['yes', 'Yes', 'true', 'True', '1']) {
      const { data, issues } = validateExtractedData([{ in_stock: val }], [boolField]);
      expect(data[0].in_stock).toBe(true);
      expect(issues[0]).toMatchObject({ autoFixed: true });
    }
  });

  it('converts "no"/"false"/"0" to false', () => {
    for (const val of ['no', 'No', 'false', 'False', '0']) {
      const { data, issues } = validateExtractedData([{ in_stock: val }], [boolField]);
      expect(data[0].in_stock).toBe(false);
      expect(issues[0]).toMatchObject({ autoFixed: true });
    }
  });

  it('errors on unconvertible values', () => {
    const { issues } = validateExtractedData([{ in_stock: 'maybe' }], [boolField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });
});

describe('date fields', () => {
  it('passes valid date strings', () => {
    const { issues } = validateExtractedData([{ published: '2025-01-15' }], [dateField]);
    expect(issues).toHaveLength(0);
  });

  it('errors on unparseable dates', () => {
    const { issues } = validateExtractedData([{ published: 'not-a-date' }], [dateField]);
    expect(issues[0]).toMatchObject({ type: 'error' });
  });

  it('warns on dates far in the future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    const { issues } = validateExtractedData([{ published: future.toISOString() }], [dateField]);
    expect(issues.some(i => i.type === 'warning' && i.message.includes('future'))).toBe(true);
  });
});

describe('cross-row checks', () => {
  it('warns when all rows have identical value for a field', () => {
    const { issues } = validateExtractedData(
      [{ title: 'Same' }, { title: 'Same' }, { title: 'Same' }],
      [stringField],
    );
    expect(issues.some(i => i.message.includes('identical'))).toBe(true);
  });

  it('warns when required field missing in > 50% of rows', () => {
    const reqField: SchemaField = { name: 'price', type: 'price', description: '', required: true };
    const { issues } = validateExtractedData(
      [{ price: 10 }, {}, {}, {}],
      [reqField],
    );
    expect(issues.some(i => i.message.includes('missing'))).toBe(true);
  });

  it('does not warn on single-row data', () => {
    const { issues } = validateExtractedData([{ title: 'Only one' }], [stringField]);
    expect(issues).toHaveLength(0);
  });
});

describe('edge cases', () => {
  it('handles empty data array', () => {
    const { data, issues } = validateExtractedData([], [priceField]);
    expect(data).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it('handles empty fields array', () => {
    const { data, issues } = validateExtractedData([{ price: 10 }], []);
    expect(data[0].price).toBe(10);
    expect(issues).toHaveLength(0);
  });

  it('skips null/undefined values', () => {
    const { issues } = validateExtractedData([{ price: null }], [priceField]);
    expect(issues).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && npx vitest run src/data-quality.test.ts`
Expected: FAIL — boolean and date cases fail

- [ ] **Step 3: Add boolean and date validation**

Add these cases to the `validateField` switch in `packages/scraper/src/data-quality.ts`:

```typescript
    case 'boolean': return validateBoolean(field.name, value, row);
    case 'date': return validateDate(field.name, value, row);
```

Add these functions:

```typescript
const TRUTHY = new Set(['yes', 'true', '1']);
const FALSY = new Set(['no', 'false', '0']);

function validateBoolean(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  if (typeof value === 'boolean') return { value, issues };

  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (TRUTHY.has(lower)) {
      issues.push({
        field: name, row, type: 'warning',
        message: `Converted "${value}" to true`,
        autoFixed: true, originalValue: value,
      });
      return { value: true, issues };
    }
    if (FALSY.has(lower)) {
      issues.push({
        field: name, row, type: 'warning',
        message: `Converted "${value}" to false`,
        autoFixed: true, originalValue: value,
      });
      return { value: false, issues };
    }
  }

  issues.push({ field: name, row, type: 'error', message: `Cannot convert to boolean: "${value}"` });
  return { value, issues };
}

function validateDate(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  if (typeof value !== 'string') {
    issues.push({ field: name, row, type: 'error', message: 'Date is not a string' });
    return { value, issues };
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    issues.push({ field: name, row, type: 'error', message: `Cannot parse date: "${value}"` });
    return { value, issues };
  }

  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  if (parsed > oneYearFromNow) {
    issues.push({ field: name, row, type: 'warning', message: `Date is far in the future: ${value}` });
  }

  return { value, issues };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/scraper && npx vitest run src/data-quality.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/data-quality.ts packages/scraper/src/data-quality.test.ts
git commit -m "feat(scraper): add boolean, date, and cross-row quality checks"
```

---

### Task 4: Export and integrate into extract route

**Files:**
- Modify: `packages/scraper/src/index.ts`
- Modify: `packages/dashboard2/src/app/api/scraper/extract/route.ts`

- [ ] **Step 1: Export from scraper package**

Add to `packages/scraper/src/index.ts`:

```typescript
export { validateExtractedData, type QualityIssue, type QualityResult } from './data-quality.js';
```

- [ ] **Step 2: Integrate into extract route**

In `packages/dashboard2/src/app/api/scraper/extract/route.ts`, the import on line 17 already imports from `@robot/scraper`. Add `validateExtractedData` to that import.

Change line 17 from:

```typescript
    const { extractFromStructuredData, lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, acquireDomainLock, detectSchemaChanges, formatSchemaChanges } = await import('@robot/scraper');
```

to:

```typescript
    const { extractFromStructuredData, lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, acquireDomainLock, detectSchemaChanges, formatSchemaChanges, validateExtractedData } = await import('@robot/scraper');
```

Then, after the cache save block (after line 272) and before the `return NextResponse.json(...)` on line 274, add:

```typescript
    // ─── STEP 5: Data quality validation ───────────────────────────────
    const { data: cleanedData, issues: qualityIssues } = validateExtractedData(
      [finalData],
      schemaFields,
    );
```

And update the return statement (line 274-282) to use `cleanedData` and include `qualityIssues`:

```typescript
    return NextResponse.json({
      data: cleanedData,
      plan,
      confidence,
      sources,
      fieldCount: { found: foundFields, total: fields.length },
      cacheHit: cache !== null && cache.consecutiveFailures < 5,
      schemaChanges: schemaChanges.length > 0 ? schemaChanges : undefined,
      qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
    });
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `cd packages/scraper && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/scraper/src/index.ts packages/dashboard2/src/app/api/scraper/extract/route.ts
git commit -m "feat: integrate data quality checks into extract route"
```

---

### Task 5: Display quality issues in wizard preview

**Files:**
- Modify: `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx`

- [ ] **Step 1: Add state for quality issues**

In `wizard.tsx`, after line 61 (`const [confidence, setConfidence] = ...`), add:

```typescript
  const [qualityIssues, setQualityIssues] = useState<Array<{ field: string; row?: number; type: 'warning' | 'error'; message: string; autoFixed?: boolean }>>([]);
```

- [ ] **Step 2: Store quality issues from extract response**

In the `handleExtract` function, after line 132 (`setConfidence(data.confidence ?? null);`), add:

```typescript
      setQualityIssues(data.qualityIssues ?? []);
```

- [ ] **Step 3: Display quality issues in preview step**

In the preview step section (after the confidence bar, around line 380, before the `{extractedData.length > 0 ? (` block), add:

```tsx
          {qualityIssues.length > 0 && (
            <Card className="mb-4 divide-y">
              {qualityIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 px-4 py-2">
                  <Badge
                    className={`mt-0.5 text-[10px] shrink-0 ${
                      issue.type === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {issue.type}
                  </Badge>
                  <div className="min-w-0">
                    <span data-slot="mono" className="text-xs font-medium">{issue.field}</span>
                    <span className="text-xs text-muted-foreground ml-2">{issue.message}</span>
                    {issue.autoFixed && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">auto-fixed</Badge>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
```

- [ ] **Step 4: Verify the dashboard builds**

Run: `pnpm --filter @robot/dashboard2 build`
Expected: Build succeeds with no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx
git commit -m "feat(dashboard): display data quality issues in wizard preview"
```
