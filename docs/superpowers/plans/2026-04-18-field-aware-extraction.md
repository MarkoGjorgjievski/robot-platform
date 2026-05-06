# Field-Aware Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extraction pipeline field-aware so user-requested fields steer the AI, results display in two tiers (requested vs discovered), and incremental re-extraction works for newly added fields.

**Architecture:** Add a `tier` property to `SchemaField` (`"requested" | "discovered"`). Pass requested fields to AI prompts with explicit priority instructions. The analyze endpoint accepts optional user fields. The extract endpoint returns results split by tier. The wizard UI gets a field input area and two-tier results display.

**Tech Stack:** TypeScript, Anthropic Claude, vitest, Next.js 15 Server Components, Radix UI + Tailwind v4

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/agent/src/types.ts` | Add `tier` to SchemaField |
| Modify | `packages/agent/src/prompts.ts` | Field-priority-aware prompts |
| Create | `packages/scraper/src/field-normalizer.ts` | Normalize freeform user field input to SchemaField[] |
| Create | `packages/scraper/src/field-normalizer.test.ts` | Tests for normalizer |
| Modify | `packages/scraper/src/structured-extractor.ts` | Description-aware alias matching |
| Create | `packages/scraper/src/structured-extractor-aliases.test.ts` | Tests for expanded alias matching |
| Modify | `packages/dashboard2/src/app/api/scraper/analyze/route.ts` | Accept optional `requestedFields` param |
| Modify | `packages/dashboard2/src/app/api/scraper/extract/route.ts` | Return two-tier results, support incremental re-extraction |
| Modify | `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx` | Field input area, two-tier results |

---

### Task 1: Add `tier` to SchemaField type

**Files:**
- Modify: `packages/agent/src/types.ts:3-9`

- [ ] **Step 1: Add tier to SchemaField**

In `packages/agent/src/types.ts`, update the `SchemaField` type:

```typescript
export type FieldTier = 'requested' | 'discovered';

export type SchemaField = {
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
  example_value?: string;
  tier?: FieldTier;
};
```

`tier` is optional so all existing code that creates `SchemaField` without it still compiles — discovered fields just have `tier: undefined` which is treated as `"discovered"`.

- [ ] **Step 2: Add tier to extract route response type**

In `packages/dashboard2/src/app/api/scraper/extract/route.ts`, update the response JSON shape. After the existing `fieldCount` field (line 323), add `fieldsByTier`:

```typescript
return NextResponse.json({
  data: cleanedData,
  plan,
  confidence,
  sources,
  fieldCount: { found: foundFields, total: fields.length },
  fieldsByTier: {
    requested: requestedResults,
    discovered: discoveredResults,
  },
  cacheHit: cache !== null && cache.consecutiveFailures < 5,
  schemaChanges: schemaChanges.length > 0 ? schemaChanges : undefined,
  qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
});
```

Where `requestedResults` and `discoveredResults` are computed from `fieldResults` filtered by tier. We'll implement this in Task 5.

- [ ] **Step 3: Verify build**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/agent exec tsc --noEmit`
Expected: Clean compile, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/types.ts
git commit -m "feat: add tier property to SchemaField type"
```

---

### Task 2: Build field normalizer

Takes freeform user input (comma-separated or newline-separated field names/descriptions) and returns normalized `SchemaField[]` with `tier: "requested"`.

**Files:**
- Create: `packages/scraper/src/field-normalizer.ts`
- Create: `packages/scraper/src/field-normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/scraper/src/field-normalizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeUserFields } from './field-normalizer.js';

describe('normalizeUserFields', () => {
  it('normalizes comma-separated field names', () => {
    const result = normalizeUserFields('title, price, sku');
    expect(result).toEqual([
      { name: 'title', type: 'string', description: '', required: true, tier: 'requested' },
      { name: 'price', type: 'price', description: '', required: true, tier: 'requested' },
      { name: 'sku', type: 'string', description: '', required: true, tier: 'requested' },
    ]);
  });

  it('normalizes newline-separated fields', () => {
    const result = normalizeUserFields('title\nprice\nsku');
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('title');
  });

  it('converts natural names to snake_case', () => {
    const result = normalizeUserFields('Product Name, Shipping Weight, Review Count');
    expect(result[0].name).toBe('product_name');
    expect(result[1].name).toBe('shipping_weight');
    expect(result[2].name).toBe('review_count');
  });

  it('infers types from field names', () => {
    const result = normalizeUserFields('price, image_url, rating, in_stock, publish_date');
    expect(result[0].type).toBe('price');
    expect(result[1].type).toBe('image_url');
    expect(result[2].type).toBe('number');
    expect(result[3].type).toBe('boolean');
    expect(result[4].type).toBe('date');
  });

  it('deduplicates fields', () => {
    const result = normalizeUserFields('title, price, title');
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    const result = normalizeUserFields('');
    expect(result).toEqual([]);
  });

  it('handles fields with descriptions like "price - the current selling price"', () => {
    const result = normalizeUserFields('price - the current selling price');
    expect(result[0].name).toBe('price');
    expect(result[0].description).toBe('the current selling price');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/scraper exec vitest run src/field-normalizer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the normalizer**

Create `packages/scraper/src/field-normalizer.ts`:

```typescript
import type { SchemaField, FieldType } from '@robot/agent';

/**
 * Normalize freeform user field input into structured SchemaField[].
 * Accepts comma-separated or newline-separated field names.
 * Supports "field_name - description" format.
 */
export function normalizeUserFields(input: string): SchemaField[] {
  if (!input.trim()) return [];

  // Split on commas or newlines
  const separator = input.includes('\n') ? '\n' : ',';
  const raw = input.split(separator).map(s => s.trim()).filter(Boolean);

  const seen = new Set<string>();
  const fields: SchemaField[] = [];

  for (const entry of raw) {
    // Support "field_name - description" format
    const dashIdx = entry.indexOf(' - ');
    const namePart = dashIdx >= 0 ? entry.slice(0, dashIdx).trim() : entry.trim();
    const description = dashIdx >= 0 ? entry.slice(dashIdx + 3).trim() : '';

    const name = toSnakeCase(namePart);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    fields.push({
      name,
      type: inferType(name),
      description,
      required: true,
      tier: 'requested',
    });
  }

  return fields;
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → camel_Case
    .replace(/[\s\-]+/g, '_') // spaces/hyphens → underscores
    .replace(/[^a-zA-Z0-9_]/g, '') // strip special chars
    .toLowerCase();
}

function inferType(name: string): FieldType {
  if (name.includes('price') || name.includes('cost') || name.includes('discount_amount')) return 'price';
  if (name.includes('image')) return 'image_url';
  if (name === 'url' || name.includes('_url') || name.includes('link') || name.includes('href')) return 'url';
  if (name.includes('rating') || name.includes('count') || name.includes('number') || name.includes('review_count')) return 'number';
  if (name.includes('in_stock') || name.includes('available') || name.startsWith('is_') || name.startsWith('has_')) return 'boolean';
  if (name.includes('date') || name.includes('time') || name.includes('publish')) return 'date';
  if (name.includes('features') || name.includes('images') || name.includes('tags')) return 'array';
  return 'string';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/scraper exec vitest run src/field-normalizer.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Export from package index**

In `packages/scraper/src/index.ts`, add the export:

```typescript
export { normalizeUserFields } from './field-normalizer.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/field-normalizer.ts packages/scraper/src/field-normalizer.test.ts packages/scraper/src/index.ts
git commit -m "feat: add field normalizer for freeform user input"
```

---

### Task 3: Make AI prompts field-priority-aware

When requested fields are provided, prompts explicitly instruct the AI to prioritize finding them.

**Files:**
- Modify: `packages/agent/src/prompts.ts:1-20` (schema discovery system prompt)
- Modify: `packages/agent/src/prompts.ts:45-78` (schema discovery user content)
- Modify: `packages/agent/src/prompts.ts:176-189` (API extraction system prompt)
- Modify: `packages/agent/src/prompts.ts:191-205` (API extraction user content)

- [ ] **Step 1: Update schema discovery to accept requested fields**

In `packages/agent/src/prompts.ts`, modify `schemaDiscoveryUserContent` (line 45) to accept an optional `requestedFields` parameter:

```typescript
export function schemaDiscoveryUserContent(
  markdown: string,
  structuredData?: { ldJson?: Record<string, unknown>[]; meta?: Record<string, string> },
  requestedFields?: Array<{ name: string; type: string; description?: string }>,
) {
  let prompt = `Analyze this web page and propose a data schema for the primary data.`;

  // If user has requested specific fields, instruct AI to prioritize them
  if (requestedFields && requestedFields.length > 0) {
    const fieldList = requestedFields.map(f => {
      let line = `- ${f.name} (${f.type})`;
      if (f.description) line += ` — ${f.description}`;
      return line;
    }).join('\n');

    prompt += `

PRIORITY FIELDS — the user specifically needs these fields. You MUST include them in your schema, even if you cannot find obvious values for them on the page:

${fieldList}

After including all priority fields, also discover any additional fields available on the page.`;
  }

  // Include structured data if available — this is the most reliable source
  if (structuredData?.ldJson?.length) {
    const ldSummary = JSON.stringify(structuredData.ldJson.slice(0, 3), null, 2);
    prompt += `

IMPORTANT: The page contains JSON-LD structured data (Schema.org). Use this as the PRIMARY source for field discovery — it is the most reliable data on the page:

${ldSummary.slice(0, 5000)}`;
  }

  if (structuredData?.meta && Object.keys(structuredData.meta).length > 0) {
    const relevantMeta = Object.entries(structuredData.meta)
      .filter(([k]) => k.startsWith('og:') || k.startsWith('product:') || k.startsWith('twitter:') || k === 'description')
      .slice(0, 15);

    if (relevantMeta.length > 0) {
      prompt += `

Page meta tags:
${relevantMeta.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    }
  }

  prompt += `

Page content (markdown):

${markdown}`;

  return prompt;
}
```

- [ ] **Step 2: Update API extraction prompt to prioritize requested fields**

In `packages/agent/src/prompts.ts`, modify `apiExtractionUserContent` (line 191) to distinguish requested vs discovered fields:

```typescript
export function apiExtractionUserContent(
  apiJson: string,
  fields: Array<{ name: string; type: string; tier?: string }>,
  apiUrl: string,
): string {
  const requested = fields.filter(f => f.tier === 'requested');
  const discovered = fields.filter(f => f.tier !== 'requested');

  let fieldSection = '';
  if (requested.length > 0) {
    fieldSection += `REQUIRED fields (user specifically needs these — search thoroughly):\n${requested.map(f => `- ${f.name} (${f.type})`).join('\n')}`;
  }
  if (discovered.length > 0) {
    if (fieldSection) fieldSection += '\n\n';
    fieldSection += `Additional fields (extract if available):\n${discovered.map(f => `- ${f.name} (${f.type})`).join('\n')}`;
  }
  if (!fieldSection) {
    fieldSection = fields.map(f => `- ${f.name} (${f.type})`).join('\n');
  }

  return `Extract these fields from the API response:

${fieldSection}

API URL: ${apiUrl}

API Response (may be truncated):
${apiJson}`;
}
```

- [ ] **Step 3: Update selector generation prompt to prioritize requested fields**

In `packages/agent/src/prompts.ts`, modify `selectorGenerationUserContent` (line 80). Change the `fieldList` construction to distinguish tiers:

```typescript
export function selectorGenerationUserContent(
  html: string,
  fields: Array<{ name: string; type: string; tier?: string }>,
  pageType?: string,
) {
  const requested = fields.filter(f => f.tier === 'requested');
  const discovered = fields.filter(f => f.tier !== 'requested');

  let fieldList: string;
  if (requested.length > 0 && discovered.length > 0) {
    fieldList = `REQUIRED (must find):\n${requested.map(f => `- ${f.name} (${f.type})`).join('\n')}\n\nOPTIONAL (extract if visible):\n${discovered.map(f => `- ${f.name} (${f.type})`).join('\n')}`;
  } else {
    fieldList = fields.map(f => `- ${f.name} (${f.type})`).join('\n');
  }

  const isDetail = pageType === 'detail' || pageType === 'other';

  if (isDetail) {
    return `This is a DETAIL page (single item, e.g. product page or article). Generate XPath expressions to extract these fields:

${fieldList}

For detail pages:
- row_xpath should be a container that wraps the main content (e.g. //main, //article, //div[@id="product-detail"], //body). It should match exactly 1 element.
- Field XPaths should be ABSOLUTE (starting with //) so they work from the document root. Do NOT use relative paths starting with ".".
- Example: //span[@data-test="product-title"], //div[@class="price"]//span

HTML:

${html}`;
  }

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
}
```

- [ ] **Step 4: Update SchemaAgent.discoverSchema to pass requested fields**

In `packages/agent/src/schema-agent.ts`, modify `discoverSchema` (line 58) to accept optional requested fields:

```typescript
async discoverSchema(capture: PageCapture, requestedFields?: SchemaField[]): Promise<DiscoveredSchema> {
  const userText = schemaDiscoveryUserContent(
    capture.markdown,
    capture.structuredData,
    requestedFields?.map(f => ({ name: f.name, type: f.type, description: f.description })),
  );

  if (this.anthropic) {
    const result = await this.anthropic.callWithTool({
      system: SCHEMA_DISCOVERY_SYSTEM,
      tool: discoverSchemaTool,
      userText,
      image: capture.screenshot,
    });
    return result as DiscoveredSchema;
  }

  const json = await this.ollama!.callWithJson({
    system: SCHEMA_DISCOVERY_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
    userText: ollamaSchemaPrompt(capture.markdown),
    image: capture.screenshot,
  }) as Record<string, unknown>;

  return normalizeSchemaResponse(json);
}
```

- [ ] **Step 5: Update generateSelectors and extractFromApi to pass tier**

In `packages/agent/src/schema-agent.ts`, update `generateSelectors` (line 80) to pass tier through to the prompt:

```typescript
async generateSelectors(capture: PageCapture, fields: SchemaField[], pageType?: string): Promise<ExtractionPlan> {
  const html = truncateHtml(capture.html, this.anthropic ? 50000 : 30000);
  const fieldSummary = fields.map(f => ({ name: f.name, type: f.type, tier: f.tier }));
  const userText = selectorGenerationUserContent(html, fieldSummary, pageType);
  // ... rest unchanged
```

Update `extractFromApi` (line 160) similarly:

```typescript
async extractFromApi(
  apiJson: string,
  apiUrl: string,
  fields: SchemaField[],
): Promise<ApiExtractionResult> {
  const truncated = apiJson.length > 30000 ? apiJson.slice(0, 30000) + '\n... (truncated)' : apiJson;
  const fieldSummary = fields.map(f => ({ name: f.name, type: f.type, tier: f.tier }));
  const userText = apiExtractionUserContent(truncated, fieldSummary, apiUrl);
  // ... rest unchanged
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/agent exec tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/prompts.ts packages/agent/src/schema-agent.ts
git commit -m "feat: make AI prompts field-priority-aware for requested vs discovered"
```

---

### Task 4: Expand mechanical alias matching with field descriptions

When a user provides a field description (e.g., "shipping weight"), use it to expand alias matching in the mechanical extractor.

**Files:**
- Modify: `packages/scraper/src/structured-extractor.ts:101-123`
- Create: `packages/scraper/src/structured-extractor-aliases.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/scraper/src/structured-extractor-aliases.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractFromStructuredData } from './structured-extractor.js';
import type { StructuredData } from '@robot/browser';

const emptyStructured: StructuredData = { ldJson: [], meta: {}, nextData: null };

describe('extractFromStructuredData — description-based matching', () => {
  it('matches field by description words when name has no alias', () => {
    const intercepted = [{
      url: 'https://api.example.com/product',
      method: 'GET',
      responseBody: '{}',
      bodySize: 100,
      contentType: 'application/json',
      parsedJson: { package_weight: '2.5 lbs' },
    }];
    const result = extractFromStructuredData(
      emptyStructured,
      [{ name: 'shipping_weight', type: 'string', description: 'the package weight of the product' }],
      intercepted as any,
    );
    expect(result.data['shipping_weight']).toBe('2.5 lbs');
  });

  it('still prefers exact name match over description match', () => {
    const intercepted = [{
      url: 'https://api.example.com/product',
      method: 'GET',
      responseBody: '{}',
      bodySize: 100,
      contentType: 'application/json',
      parsedJson: { shipping_weight: '3 lbs', package_weight: '2.5 lbs' },
    }];
    const result = extractFromStructuredData(
      emptyStructured,
      [{ name: 'shipping_weight', type: 'string', description: 'the package weight' }],
      intercepted as any,
    );
    expect(result.data['shipping_weight']).toBe('3 lbs');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/scraper exec vitest run src/structured-extractor-aliases.test.ts`
Expected: First test FAILs — description matching not implemented.

- [ ] **Step 3: Update FieldRequest type and findFieldValue**

In `packages/scraper/src/structured-extractor.ts`, update the `FieldRequest` type (line 3) and `findFieldValue` (line 101):

```typescript
type FieldRequest = {
  name: string;
  type: string;
  description?: string;
};
```

Update `findFieldValue` to accept and use description:

```typescript
function findFieldValue(
  fieldName: string,
  fieldType: string,
  allData: Record<string, unknown>,
  description?: string,
): unknown {
  // Try exact match first
  if (isPrimitive(allData[fieldName])) return allData[fieldName];

  // Try known aliases
  const aliases = FIELD_ALIASES[fieldName] ?? [];
  for (const alias of aliases) {
    if (isPrimitive(allData[alias])) return allData[alias];
  }

  // Try fuzzy match (field name as substring)
  for (const [key, value] of Object.entries(allData)) {
    if (key.toLowerCase().includes(fieldName.toLowerCase()) && isPrimitive(value)) {
      return value;
    }
  }

  // Try description words as additional aliases
  if (description) {
    const words = description.toLowerCase()
      .replace(/[^a-z0-9\s_]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3); // skip short words like "the", "of", "a"
    const descSnake = words.join('_');

    // Try full description as snake_case key
    for (const [key, value] of Object.entries(allData)) {
      const keyLower = key.toLowerCase();
      if (keyLower === descSnake && isPrimitive(value)) return value;
    }

    // Try each meaningful word from description
    for (const word of words) {
      for (const [key, value] of Object.entries(allData)) {
        if (key.toLowerCase().includes(word) && isPrimitive(value)) return value;
      }
    }
  }

  return undefined;
}
```

Then update the call sites in `extractFromStructuredData` (lines 44, 52, 60) to pass description:

```typescript
let value = findFieldValue(field.name, field.type, apiFlat, field.description);
// ... (same for ldFlat and metaFlat calls)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/scraper exec vitest run src/structured-extractor-aliases.test.ts`
Expected: All 2 tests PASS.

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/scraper exec vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/structured-extractor.ts packages/scraper/src/structured-extractor-aliases.test.ts
git commit -m "feat: description-based alias matching in mechanical extractor"
```

---

### Task 5: Update extract route for two-tier results and incremental re-extraction

The extract API returns results split by tier. When `previousResults` is provided, it skips fields that already have values and only runs AI for new ones.

**Files:**
- Modify: `packages/dashboard2/src/app/api/scraper/extract/route.ts`

- [ ] **Step 1: Update input parsing to accept tier and previousResults**

In `packages/dashboard2/src/app/api/scraper/extract/route.ts`, update the input parsing at line 8:

```typescript
const { url, fields, captureId, pageType, previousResults } = await request.json();
```

And update `schemaFields` construction (line 42) to preserve tier:

```typescript
const schemaFields = fields.map((f: { name: string; type: string; description?: string; tier?: string }) => ({
  name: f.name,
  type: f.type,
  description: f.description ?? '',
  required: true,
  tier: f.tier ?? 'discovered',
}));
```

- [ ] **Step 2: Seed finalData with previousResults**

After line 56 (`let finalData: Record<string, unknown> = { ...mechanicalResult.data };`), add:

```typescript
// Seed with previous results for incremental re-extraction
if (previousResults && typeof previousResults === 'object') {
  for (const [name, value] of Object.entries(previousResults)) {
    if (value !== null && value !== undefined && finalData[name] === undefined) {
      finalData[name] = value;
      fieldResults[name] = {
        value,
        source: 'previous',
        path: '',
        confidence: 0.9,
      };
    }
  }
}
```

- [ ] **Step 3: Build two-tier response**

Before the `return NextResponse.json(...)` (line 318), add the tier split logic:

```typescript
// Split results by tier
const requestedFields = schemaFields.filter((f: { tier?: string }) => f.tier === 'requested');
const discoveredFieldNames = new Set(
  Object.keys(finalData).filter(name => !requestedFields.some((f: { name: string }) => f.name === name))
);

const requestedResults = requestedFields.map((f: { name: string; type: string }) => ({
  name: f.name,
  type: f.type,
  value: finalData[f.name] ?? null,
  status: finalData[f.name] !== undefined && finalData[f.name] !== null ? 'found' as const : 'not_found' as const,
  source: sources[f.name] ?? null,
}));

const discoveredResults = Object.entries(finalData)
  .filter(([name]) => discoveredFieldNames.has(name))
  .map(([name, value]) => ({
    name,
    type: schemaFields.find((f: { name: string }) => f.name === name)?.type ?? 'string',
    value,
    status: 'found' as const,
    source: sources[name] ?? null,
  }));
```

Then update the response to include `fieldsByTier`:

```typescript
return NextResponse.json({
  data: cleanedData,
  plan,
  confidence,
  sources,
  fieldCount: { found: foundFields, total: fields.length },
  fieldsByTier: {
    requested: requestedResults,
    discovered: discoveredResults,
  },
  cacheHit: cache !== null && cache.consecutiveFailures < 5,
  schemaChanges: schemaChanges.length > 0 ? schemaChanges : undefined,
  qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
});
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/dashboard2 exec tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard2/src/app/api/scraper/extract/route.ts
git commit -m "feat: two-tier extract results and incremental re-extraction support"
```

---

### Task 6: Update analyze route to accept optional requested fields

When the user provides fields upfront, the analyze endpoint passes them to schema discovery so the AI includes them in its response.

**Files:**
- Modify: `packages/dashboard2/src/app/api/scraper/analyze/route.ts`

- [ ] **Step 1: Accept requestedFields parameter**

In `packages/dashboard2/src/app/api/scraper/analyze/route.ts`, update input parsing (line 11):

```typescript
const { url, requestedFields } = await request.json();
```

- [ ] **Step 2: Pass requested fields to schema discovery**

Update the `discoverSchema` call (line 105) and add the `normalizeUserFields` import:

```typescript
const { normalizeUserFields } = await import('@robot/scraper');

// Normalize user-provided fields (if any)
const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];

// Discover schema (with requested fields for priority)
const agent = new SchemaAgent();
const schema = await agent.discoverSchema(capture, userFields.length > 0 ? userFields : undefined);
```

- [ ] **Step 3: Merge requested fields into discovered schema**

After schema discovery, merge so requested fields are always present in results — even if the AI didn't include them. Add after the `discoverSchema` call:

```typescript
// Ensure all requested fields appear in the schema
if (userFields.length > 0) {
  const discoveredNames = new Set(schema.fields.map(f => f.name));
  for (const uf of userFields) {
    if (!discoveredNames.has(uf.name)) {
      schema.fields.push(uf);
    } else {
      // Mark discovered field as requested
      const existing = schema.fields.find(f => f.name === uf.name);
      if (existing) existing.tier = 'requested';
    }
  }
  // Mark all user fields as requested
  for (const f of schema.fields) {
    if (userFields.some(uf => uf.name === f.name)) {
      f.tier = 'requested';
    }
  }
}
```

- [ ] **Step 4: Also handle cached domain path with requested fields**

In the cached branch (line 32-68), after building `cachedFields`, merge requested fields:

```typescript
if (cache && Object.keys(cache.fieldPaths).length > 0 && cache.consecutiveFailures < 5) {
  const { normalizeUserFields } = await import('@robot/scraper');
  const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];

  // ... existing cachedFields construction ...

  // Merge requested fields — mark cached ones as requested, add missing ones
  if (userFields.length > 0) {
    const cachedNames = new Set(cachedFields.map((f: { name: string }) => f.name));
    for (const uf of userFields) {
      if (cachedNames.has(uf.name)) {
        const existing = cachedFields.find((f: { name: string }) => f.name === uf.name);
        if (existing) existing.tier = 'requested';
      } else {
        cachedFields.push({
          name: uf.name,
          type: uf.type,
          description: uf.description || 'User requested (not yet cached)',
          required: true,
          tier: 'requested',
        });
      }
    }
  }

  return NextResponse.json({
    // ... existing response, but with updated cachedFields
  });
}
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/dashboard2 exec tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard2/src/app/api/scraper/analyze/route.ts
git commit -m "feat: analyze endpoint accepts requested fields for priority discovery"
```

---

### Task 7: Update wizard UI — field input and two-tier results

Add a textarea for user field input on the URL step, and split the preview step into two tiers.

**Files:**
- Modify: `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx`

- [ ] **Step 1: Add user field input state**

In `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx`, add state after `url` state (line 49):

```typescript
const [userFieldsInput, setUserFieldsInput] = useState('');
```

- [ ] **Step 2: Add field input textarea to URL step**

In the URL step section (after the URL input div around line 204), add a field input area:

```tsx
<div className="mt-4 w-full max-w-xl">
  <Label className="text-xs text-muted-foreground">
    Fields you need <span className="opacity-50">(optional — comma-separated)</span>
  </Label>
  <textarea
    value={userFieldsInput}
    onChange={(e) => setUserFieldsInput(e.target.value)}
    placeholder="e.g. title, price, sku, shipping_weight, review_count"
    rows={2}
    className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    disabled={loading}
  />
</div>
```

- [ ] **Step 3: Pass user fields to analyze endpoint**

Update `handleAnalyze` (line 70) to include the user fields in the request body:

```typescript
body: JSON.stringify({
  url: url.trim(),
  requestedFields: userFieldsInput.trim() || undefined,
}),
```

- [ ] **Step 4: Add tier tracking to wizard SchemaField type**

Update the `SchemaField` type at line 13:

```typescript
type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  example_value?: string;
  enabled: boolean;
  tier?: 'requested' | 'discovered';
};
```

And update the field state setter in `handleAnalyze` (line 94) to preserve tier:

```typescript
setFields(
  data.schema.fields.map((f: Omit<SchemaField, 'enabled'>) => ({
    ...f,
    enabled: true,
    tier: f.tier ?? 'discovered',
  }))
);
```

- [ ] **Step 5: Pass tier to extract endpoint**

Update `handleExtract` (line 108) to include tier in the fields sent to extract:

```typescript
const enabledFields = fields.filter(f => f.enabled);
const res = await fetch('/api/scraper/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: url.trim(),
    fields: enabledFields.map(f => ({ name: f.name, type: f.type, description: f.description, tier: f.tier })),
    captureId,
    pageType,
  }),
});
```

- [ ] **Step 6: Add state for two-tier results**

Add new state variables after `qualityIssues` (line 62):

```typescript
const [requestedResults, setRequestedResults] = useState<Array<{ name: string; type: string; value: unknown; status: 'found' | 'not_found'; source: string | null }>>([]);
const [discoveredResults, setDiscoveredResults] = useState<Array<{ name: string; type: string; value: unknown; status: 'found' | 'not_found'; source: string | null }>>([]);
```

Update `handleExtract` to store tier results:

```typescript
const data = await res.json();
setExtractedData(data.data ?? []);
setExtractionPlan(data.plan ?? null);
setConfidence(data.confidence ?? null);
setQualityIssues(data.qualityIssues ?? []);
setRequestedResults(data.fieldsByTier?.requested ?? []);
setDiscoveredResults(data.fieldsByTier?.discovered ?? []);
setStep('preview');
```

- [ ] **Step 7: Update preview step for two-tier display**

Replace the data table in the preview step (lines 409-438) with a two-tier layout. For a detail page (single row), show field-value pairs instead of a table:

```tsx
{extractedData.length > 0 ? (
  <div className="space-y-6">
    {/* Requested Fields */}
    {requestedResults.length > 0 && (
      <div>
        <Label className="text-xs">Your Fields</Label>
        <Card className="mt-2 divide-y">
          {requestedResults.map(field => (
            <div key={field.name} className="flex items-center gap-3 px-4 py-3">
              <div className={`size-2 rounded-full shrink-0 ${field.status === 'found' ? 'bg-emerald-500' : 'bg-red-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
                  {field.source && <Badge variant="outline" className="text-[10px]">{field.source}</Badge>}
                </div>
                {field.status === 'found' ? (
                  <p data-slot="mono" className="mt-0.5 truncate text-xs text-muted-foreground">
                    {String(field.value)}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-red-500">Not found on this page</p>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>
    )}

    {/* Discovered Fields */}
    {discoveredResults.length > 0 && (
      <div>
        <Label className="text-xs text-muted-foreground">Also found</Label>
        <Card className="mt-2 divide-y">
          {discoveredResults.map(field => (
            <div key={field.name} className="flex items-center gap-3 px-4 py-3">
              <div className="size-2 rounded-full shrink-0 bg-emerald-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
                </div>
                <p data-slot="mono" className="mt-0.5 truncate text-xs text-muted-foreground">
                  {String(field.value)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] h-6"
                onClick={() => {
                  // Promote to requested
                  setFields(prev => prev.map(f =>
                    f.name === field.name ? { ...f, tier: 'requested' } : f
                  ));
                  setRequestedResults(prev => [...prev, { ...field, status: 'found' }]);
                  setDiscoveredResults(prev => prev.filter(f => f.name !== field.name));
                }}
              >
                + Keep
              </Button>
            </div>
          ))}
        </Card>
      </div>
    )}

    {/* Fallback: show table for listing pages with multiple rows */}
    {extractedData.length > 1 && (
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              {fields.filter(f => f.enabled).map(f => (
                <TableHead key={f.name}>{f.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {extractedData.slice(0, 20).map((row, i) => (
              <TableRow key={i}>
                <TableCell data-slot="mono" className="text-muted-foreground">{i + 1}</TableCell>
                {fields.filter(f => f.enabled).map(f => (
                  <TableCell key={f.name} data-slot="mono" className="max-w-[200px] truncate text-xs">
                    {row[f.name] != null ? String(row[f.name]) : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {extractedData.length > 20 && (
          <div className="border-t p-3 text-xs text-muted-foreground">
            Showing 20 of {extractedData.length} rows
          </div>
        )}
      </Card>
    )}
  </div>
) : (
  <Card className="border-dashed p-12 text-center">
    <p className="text-sm text-muted-foreground">No data extracted.</p>
  </Card>
)}
```

- [ ] **Step 8: Verify build**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/dashboard2 dev`
Expected: Compiles and loads without errors. Navigate to the new source wizard to verify the textarea appears.

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx
git commit -m "feat: wizard field input and two-tier results display"
```

---

### Task 8: Update schema step to show two tiers

The schema step (step 2 of wizard) should show requested fields separately from discovered when the user provided fields upfront.

**Files:**
- Modify: `packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx`

- [ ] **Step 1: Split schema field list by tier**

Replace the single field list in the schema step (lines 309-342) with a two-tier layout:

```tsx
{/* Requested Fields */}
{fields.some(f => f.tier === 'requested') && (
  <>
    <Label>Your Fields</Label>
    <Card className="mt-2 divide-y">
      {fields.filter(f => f.tier === 'requested').map((field) => (
        <label
          key={field.name}
          className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <input
            type="checkbox"
            checked={field.enabled}
            onChange={() => {
              const next = fields.map(f =>
                f.name === field.name ? { ...f, enabled: !f.enabled } : f
              );
              setFields(next);
            }}
            className="mt-1 size-4 rounded border-input accent-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
              <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
            </div>
            {field.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
            )}
            {field.example_value && (
              <p data-slot="mono" className="mt-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {String(field.example_value)}
              </p>
            )}
          </div>
        </label>
      ))}
    </Card>
  </>
)}

{/* Discovered Fields */}
{fields.some(f => f.tier !== 'requested') && (
  <>
    <Label className={fields.some(f => f.tier === 'requested') ? 'mt-4' : ''}>
      {fields.some(f => f.tier === 'requested') ? 'Also Available' : isCached ? 'Available Fields' : 'Discovered Fields'}
    </Label>
    <Card className="mt-2 divide-y">
      {fields.filter(f => f.tier !== 'requested').map((field) => (
        <label
          key={field.name}
          className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <input
            type="checkbox"
            checked={field.enabled}
            onChange={() => {
              const next = fields.map(f =>
                f.name === field.name ? { ...f, enabled: !f.enabled } : f
              );
              setFields(next);
            }}
            className="mt-1 size-4 rounded border-input accent-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
              <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
            </div>
            {field.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
            )}
            {field.example_value && (
              <p data-slot="mono" className="mt-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {String(field.example_value)}
              </p>
            )}
          </div>
        </label>
      ))}
    </Card>
  </>
)}
```

When no fields have `tier === 'requested'` (user didn't provide fields upfront), everything shows as a single list — same as today.

- [ ] **Step 2: Verify build**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/dashboard2 dev`
Expected: Compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard2/src/app/scraper/[orgSlug]/new-source/wizard.tsx
git commit -m "feat: two-tier field display in schema selection step"
```

---

### Task 9: End-to-end manual test

Verify the complete flow works with a real URL.

**Files:** None (testing only)

- [ ] **Step 1: Test Path 2 — User has fields**

Run: `pnpm --filter @robot/dashboard2 dev`

1. Navigate to new source wizard
2. Enter a product URL (e.g., a Target or Amazon product page)
3. Type fields: `title, price, sku, rating, review_count, brand, shipping_weight`
4. Click Analyze
5. Verify: schema step shows "Your Fields" section with the 7 fields, plus "Also Available" with AI-discovered extras
6. Click Extract
7. Verify: preview shows two-tier results — requested fields with found/not-found, discovered below

- [ ] **Step 2: Test Path 3 — No fields (exploring)**

1. Navigate to new source wizard
2. Enter a product URL
3. Leave field input empty
4. Click Analyze
5. Verify: schema step shows single "Discovered Fields" list (no tier split)
6. Click Extract
7. Verify: preview shows all results as discovered (no "Your Fields" section)

- [ ] **Step 3: Test Path 1 — Cached domain**

Use the same domain from step 1 or 2 (now cached):

1. Navigate to new source wizard
2. Enter a different URL on the same domain
3. Type fields: `title, price, some_field_that_doesnt_exist`
4. Click Analyze
5. Verify: instant response with cached fields, user fields merged in
6. Click Extract
7. Verify: `some_field_that_doesnt_exist` shows as not found with explanation

- [ ] **Step 4: Run all tests**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/scraper exec vitest run`
Expected: All tests PASS including new field-normalizer and alias tests.
