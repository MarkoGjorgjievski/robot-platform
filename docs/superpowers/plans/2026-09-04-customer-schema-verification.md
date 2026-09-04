# Customer Schema Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer fills a spreadsheet-like grid (field, type, description, expected value on each of three product URLs); we find each value mechanically in the captured pages, certify only paths that produce it on all three, and extract at scale with certified paths only.

**Architecture:** A new `verify/` module in `@robot/scraper` (normalize → search structured + DOM → certify across three captures → one AI call per stubborn field → results) sits beside the existing extraction chain, not inside it. Certified paths are stored per verification on a new `source_verifications` table and written to the domain cache under a concept key with a new `verified` path source. At scale `extract-item` routes a certified Source through `runVerifiedExtraction` (certified paths only, empty-and-counted on a miss). The dashboard's landing page and Source workspace are replaced by the grid.

**Tech Stack:** Drizzle/Postgres, tRPC v11 + Zod, Playwright Chromium via `IBrowser.setContentEvaluate` (there is no server-side DOM library — XPath and DOM search run in the browser), `AnthropicProvider.callWithTool`, Vite/TanStack dashboard, vitest.

**Spec:** docs/superpowers/specs/2026-09-04-customer-schema-verification-design.md

## Global Constraints

- **AI spend only on Marko's explicit go.** The Anthropic account holds ~$10 (funded 2026-09-02; stop near $8). Every task except Task 17's paid step is AI-free: tests run with `agent: null` or a stub. Never set `ANTHROPIC_API_KEY` in a test.
- Cost-bearing actions are explicit clicks with the upper-bound price shown first. No mount effects, no query-driven mutations.
- `completed_at` is the terminal marker on `source_verifications` exactly as on `runs`; in-flight guards key on `completed_at IS NULL`.
- Certification rule: a path certifies only if it yields the expected value on **all three** URLs. No tolerance. An XPath whose string contains the expected value is rejected.
- At scale, a certified Source runs certified paths only; a miss leaves the cell empty and is counted. No fallback to `runExtraction`.
- Customer-visible field type list is exactly `text | number | money | boolean | date | url | image | text_list`.
- Verification gates after every task: `pnpm -r test` green (Docker Postgres `robot-platform-db` running: `docker start robot-platform-db`), `pnpm typecheck` green (covers all seven packages), and the cache-hygiene query returns 0 rows: `select domain, page_type from domain_intelligence where domain in ('example.com','listing.example','shop.example') or domain like 'test-%';` (`shop.example` is this plan's fixture hostname — add it to the handoff's query in Task 16).
- All API test seeds go through a throwaway project deleted in `afterEach` (the `sources.test.ts` `makeThrowawayProject` pattern).
- Shell is Windows PowerShell 5.1: no `&&` chaining in commands you run; use `;`.
- Constants live once, in `packages/scraper/src/verify/constants.ts`: `VERIFY_URL_COUNT = 3`, `MAX_CERTIFIED_PATHS = 5`, `CAPTURE_REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000`, `EST_AI_COST_PER_FIELD_USD = 0.05`, `DRIFT_MISS_SHARE = 0.2`, `DRIFT_MIN_ROWS = 5`, `FIND_PRODUCT_PAGES_LIMIT = 10`, `VERIFY_STALL_MS = 15 * 60 * 1000`.
- Work on a feature branch `feat/schema-verification` off `main`. Commit after every task's green gate.

---

### Task 1: Schema — columns and the `source_verifications` table

**Files:**
- Create: `packages/db/drizzle/0009_schema_verification.sql` (+ journal entry + snapshot per drizzle convention)
- Modify: `packages/db/src/schema.ts` (`sources` at ~73, `runs` at ~345; new table after `captures` at ~317)
- Test: `packages/db/src/schema.test.ts` (extend existing)

**Interfaces:**
- Produces: `sources.schemaDefinition: jsonb | null`, `sources.verificationSet: jsonb | null`, `sources.driftedFields: jsonb | null` (string[]); `runs.driftedFields: jsonb | null` (string[]); table `sourceVerifications` with columns `id, sourceId, startedAt, completedAt, definitionHash, captures, results, allPassed, aiCalls, costUsd, createdAt`. Exported as `sourceVerifications` from `@robot/db`.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE "sources" ADD COLUMN "schema_definition" jsonb;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "verification_set" jsonb;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "drifted_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "drifted_fields" jsonb;
--> statement-breakpoint
CREATE TABLE "source_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "definition_hash" varchar(64) NOT NULL,
  "captures" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "results" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "all_passed" boolean NOT NULL DEFAULT false,
  "ai_calls" integer NOT NULL DEFAULT 0,
  "cost_usd" numeric(10, 4) NOT NULL DEFAULT 0,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "source_verifications_source_id_idx" ON "source_verifications" ("source_id");
--> statement-breakpoint
CREATE INDEX "source_verifications_source_completed_idx" ON "source_verifications" ("source_id", "completed_at");
```

Register in `packages/db/drizzle/meta/_journal.json` (idx 9, tag `0009_schema_verification`) with a snapshot, matching how 0008 is registered.

- [ ] **Step 2: Mirror in schema.ts**

`sources` gains, after `requestedFields`:

```ts
  // Customer-defined schema (spec §3.1): Array<{ key, name, type, description, concept }>.
  schemaDefinition: jsonb('schema_definition'),
  // The three verification URLs + expected values as typed (spec §3.2).
  verificationSet: jsonb('verification_set'),
  // Field keys flagged by the last run's drift check (spec §5.3): string[].
  driftedFields: jsonb('drifted_fields'),
```

`runs` gains, after `targetFields`:

```ts
  // Field keys whose miss rate crossed DRIFT_MISS_SHARE in this run: string[].
  driftedFields: jsonb('drifted_fields'),
```

New table after `capturesRelations`:

```ts
// ─── Source verifications (customer schema verification) ────────────────────
// One row per Verify click. `completed_at` is the terminal marker.

export const sourceVerifications = pgTable('source_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // sha256 of the schema_definition + verification_set this run verified; a
  // certification is current only while the Source's hash still matches.
  definitionHash: varchar('definition_hash', { length: 64 }).notNull(),
  // Record<url, { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string }>
  captures: jsonb('captures').notNull().default({}),
  // Record<fieldKey, FieldVerification> — see @robot/scraper verify/types.ts
  results: jsonb('results').notNull().default({}),
  allPassed: boolean('all_passed').notNull().default(false),
  aiCalls: integer('ai_calls').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('source_verifications_source_id_idx').on(table.sourceId),
  index('source_verifications_source_completed_idx').on(table.sourceId, table.completedAt),
]);

export const sourceVerificationsRelations = relations(sourceVerifications, ({ one }) => ({
  source: one(sources, { fields: [sourceVerifications.sourceId], references: [sources.id] }),
}));
```

Add `verifications: many(sourceVerifications)` to `sourcesRelations`. Add `numeric` to the drizzle-orm/pg-core import if it is not already there. Confirm `packages/db/src/index.ts` re-exports `*` from schema (it does today; if a named list is used, add `sourceVerifications`).

- [ ] **Step 3: Extend schema.test.ts**

```ts
it('source_verifications exposes the verification columns', () => {
  const cols = Object.keys(sourceVerifications);
  for (const c of ['id', 'sourceId', 'startedAt', 'completedAt', 'definitionHash', 'captures', 'results', 'allPassed', 'aiCalls', 'costUsd']) {
    expect(cols).toContain(c);
  }
});

it('sources and runs carry the schema-verification columns', () => {
  expect(Object.keys(sources)).toEqual(expect.arrayContaining(['schemaDefinition', 'verificationSet', 'driftedFields']));
  expect(Object.keys(runs)).toContain('driftedFields');
});
```

- [ ] **Step 4: Apply and run**

Run: `pnpm db:migrate; pnpm --filter @robot/db test`
Expected: migration applies; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): schema_definition, verification_set, drifted_fields and source_verifications"
```

---

### Task 2: Verifier types, constants, and per-type normalization

**Files:**
- Create: `packages/scraper/src/verify/types.ts`, `packages/scraper/src/verify/constants.ts`, `packages/scraper/src/verify/normalize.ts`
- Test: `packages/scraper/src/verify/normalize.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
export const CUSTOMER_FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type CustomerFieldType = (typeof CUSTOMER_FIELD_TYPES)[number];

export type SchemaDefinitionField = {
  key: string;          // stable slug, never changes
  name: string;         // customer label
  type: CustomerFieldType;
  description: string;
  concept: string;      // cache bridge
};

export type VerificationSet = {
  urls: string[];                                   // exactly VERIFY_URL_COUNT
  expected: Record<string, Record<string, string>>; // fieldKey → url → as typed
  listing_url?: string;
};

export type Transform = 'identity' | 'cents_to_units' | 'first_of_list';
export type CertifiedSource = 'api' | 'json-ld' | 'meta' | 'xpath';
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform };

export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch';
export type CellResult =
  | { status: 'pass'; found: string; path: CertifiedPath }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

export type FieldVerification = {
  key: string;
  cells: Record<string, CellResult>;   // url → result
  certified: CertifiedPath[];          // ranked, primary first; empty when failed
  weakEvidence: boolean;               // all three expected values identical
  aiCalled: boolean;
};

export type VerificationOutcome = {
  fields: Record<string, FieldVerification>;
  allPassed: boolean;
  aiCalls: number;
};
```

- Produces (normalize.ts):

```ts
export type NormalizeContext = { pageUrl?: string };
/** Canonical comparable string for the type, or null when raw cannot be read as that type. */
export function normalize(type: CustomerFieldType, raw: unknown, ctx?: NormalizeContext): string | null;
export function valuesEqual(type: CustomerFieldType, a: unknown, b: unknown, ctx?: NormalizeContext): boolean;
/** Customer-side validation of a typed expected value: an error message, or null when valid. */
export function validateExpected(type: CustomerFieldType, text: string): string | null;
/** The typed JS value an export cell carries for a normalized string. */
export function renderValue(type: CustomerFieldType, normalized: string): unknown;
```

- [ ] **Step 1: Write types.ts and constants.ts** as above; constants:

```ts
export const VERIFY_URL_COUNT = 3;
export const MAX_CERTIFIED_PATHS = 5;
export const CAPTURE_REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const EST_AI_COST_PER_FIELD_USD = 0.05;
export const DRIFT_MISS_SHARE = 0.2;
export const DRIFT_MIN_ROWS = 5;
export const FIND_PRODUCT_PAGES_LIMIT = 10;
/** An in-flight verification older than this is a crash leftover, not work in progress. */
export const VERIFY_STALL_MS = 15 * 60 * 1000;
```

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { normalize, valuesEqual, validateExpected, renderValue } from './normalize.js';

describe('normalize', () => {
  it('text: trims, collapses whitespace, NFKC; keeps case (comparison folds it)', () => {
    expect(normalize('text', '  Samsung  T7  2TB ')).toBe('Samsung T7 2TB');
    expect(normalize('text', 'ﬁle')).toBe('file');
    expect(valuesEqual('text', 'SAMSUNG t7', 'Samsung T7')).toBe(true);
  });
  it('number: parses both decimal separators and thousands separators', () => {
    expect(normalize('number', '1,299.50')).toBe('1299.5');
    expect(normalize('number', '1.299,50')).toBe('1299.5');
    expect(normalize('number', 1299.5)).toBe('1299.5');
    expect(normalize('number', 'twelve')).toBeNull();
  });
  it('money: strips currency symbols and codes, two decimals', () => {
    expect(normalize('money', '$129.99')).toBe('129.99');
    expect(normalize('money', 'EUR 129,99')).toBe('129.99');
    expect(normalize('money', '129.994')).toBe('129.99');
    expect(normalize('money', 'call for price')).toBeNull();
  });
  it('boolean: synonym sets', () => {
    expect(normalize('boolean', 'In Stock')).toBe('true');
    expect(normalize('boolean', 'https://schema.org/InStock')).toBe('true');
    expect(normalize('boolean', 'Out of stock')).toBe('false');
    expect(normalize('boolean', true)).toBe('true');
    expect(normalize('boolean', 'maybe')).toBeNull();
  });
  it('date: calendar day', () => {
    expect(normalize('date', '2026-09-04T13:00:00Z')).toBe('2026-09-04');
    expect(normalize('date', 'September 4, 2026')).toBe('2026-09-04');
    expect(normalize('date', 'not a date')).toBeNull();
  });
  it('url/image: resolves against the page and drops the fragment', () => {
    expect(normalize('url', '/p/1#top', { pageUrl: 'https://shop.example/x' })).toBe('https://shop.example/p/1');
    expect(normalize('image', 'HTTPS://CDN.Example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });
  it('text_list: splits on newline, comma, semicolon; set semantics', () => {
    expect(normalize('text_list', 'Red, Blue;Green')).toBe(normalize('text_list', ['green', 'red', 'blue']));
  });
});

describe('valuesEqual', () => {
  it('money within a cent', () => expect(valuesEqual('money', '129.99', 129.994)).toBe(true));
  it('null on either side is never equal', () => expect(valuesEqual('number', 'x', 'x')).toBe(false));
});

describe('validateExpected', () => {
  it('rejects a blank cell for every type', () => {
    expect(validateExpected('text', '   ')).toMatch(/required/i);
  });
  it('rejects a non-money in a money cell', () => {
    expect(validateExpected('money', 'call for price')).toMatch(/money/i);
    expect(validateExpected('money', '$1,299.00')).toBeNull();
  });
  it('accepts any non-blank text', () => expect(validateExpected('text', 'x')).toBeNull());
});

describe('renderValue', () => {
  it('numbers, booleans, lists become typed values', () => {
    expect(renderValue('money', '129.99')).toBe(129.99);
    expect(renderValue('boolean', 'true')).toBe(true);
    expect(renderValue('text_list', ['a', 'b'].join(String.fromCharCode(31)))).toEqual(['a', 'b']);
    expect(renderValue('text', 'hello')).toBe('hello');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement normalize.ts**

```ts
import type { CustomerFieldType } from './types.js';

export type NormalizeContext = { pageUrl?: string };

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock', 'https://schema.org/instock', 'http://schema.org/instock']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out', 'https://schema.org/outofstock', 'http://schema.org/outofstock']);
const LIST_SEP = String.fromCharCode(31); // unit separator: never appears in page text

function text(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** "1,299.50" | "1.299,50" | "1299" | 1299.5 → number. Currency symbols/codes stripped first. */
function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).normalize('NFKC').trim();
  s = s.replace(/[A-Za-z$€£¥₹\s]/g, ''); // symbols, codes, whitespace
  s = s.replace(/^[^\d\-+.,]+|[^\d.,]+$/g, '');
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const groups = s.split(',');
    // "1,299" is thousands; "129,99" is a decimal (two digits after a single comma).
    s = groups.length === 2 && groups[1]!.length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot > -1) {
    const groups = s.split('.');
    // "1.299" alone is ambiguous; treat a single 3-digit group as thousands only if there are 2+ dots.
    if (groups.length > 2) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(raw: unknown): string | null {
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  const s = text(raw)?.toLowerCase() ?? null;
  if (s === null) return null;
  if (TRUE_WORDS.has(s)) return 'true';
  if (FALSE_WORDS.has(s)) return 'false';
  return null;
}

/** Calendar day. A string carrying an explicit zone (Z or ±hh:mm) is read in UTC;
 *  anything else ("September 4, 2026", "2026-09-04 10:00") is a LOCAL date and
 *  must be read with local components — `toISOString()` on a local midnight in a
 *  UTC+2 zone yields the previous day. */
function day(raw: unknown): string | null {
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = typeof raw === 'string' ? raw.trim() : raw === null || raw === undefined ? '' : String(raw);
  if (s === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(s) && /T\d{2}:\d{2}/.test(s);
  return zoned ? new Date(t).toISOString().slice(0, 10) : local(new Date(t));
}

function url(raw: unknown, ctx?: NormalizeContext): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const u = new URL(raw.trim(), ctx?.pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch {
    return null;
  }
}

function list(raw: unknown): string | null {
  const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\n,;]/) : null;
  if (!items) return null;
  const norm = items.map((i) => text(i)?.toLowerCase() ?? null).filter((i): i is string => i !== null);
  if (norm.length === 0) return null;
  return [...new Set(norm)].sort().join(LIST_SEP);
}

export function normalize(type: CustomerFieldType, raw: unknown, ctx?: NormalizeContext): string | null {
  switch (type) {
    case 'text': return text(raw);
    case 'number': { const n = parseNumber(raw); return n === null ? null : String(n); }
    case 'money': { const n = parseNumber(raw); return n === null ? null : (Math.round(n * 100) / 100).toFixed(2); }
    case 'boolean': return bool(raw);
    case 'date': return day(raw);
    case 'url':
    case 'image': return url(raw, ctx);
    case 'text_list': return list(raw);
  }
}

export function valuesEqual(type: CustomerFieldType, a: unknown, b: unknown, ctx?: NormalizeContext): boolean {
  const na = normalize(type, a, ctx);
  const nb = normalize(type, b, ctx);
  if (na === null || nb === null) return false;
  return type === 'text' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

const TYPE_LABEL: Record<CustomerFieldType, string> = {
  text: 'text', number: 'a number', money: 'a money amount', boolean: 'yes/no (or in stock/out of stock)',
  date: 'a date', url: 'a URL', image: 'an image URL', text_list: 'a comma-separated list',
};

export function validateExpected(type: CustomerFieldType, textIn: string): string | null {
  if (textIn.trim() === '') return 'Expected value is required';
  if (normalize(type, textIn) === null) return `Not ${TYPE_LABEL[type]}`;
  return null;
}

export function renderValue(type: CustomerFieldType, normalized: string): unknown {
  switch (type) {
    case 'number':
    case 'money': return Number(normalized);
    case 'boolean': return normalized === 'true';
    case 'text_list': return normalized.split(LIST_SEP);
    default: return normalized;
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/normalize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/verify
git commit -m "feat(scraper): verifier types, constants and per-type normalization"
```

---

### Task 3: Transforms

**Files:**
- Create: `packages/scraper/src/verify/transforms.ts`
- Test: `packages/scraper/src/verify/transforms.test.ts`

**Interfaces:**
- Consumes: `normalize`, `valuesEqual` (Task 2).
- Produces:

```ts
export const TRANSFORMS: readonly Transform[]; // ['identity', 'cents_to_units', 'first_of_list']
export function applyTransform(raw: unknown, t: Transform): unknown;
/** The first transform (in TRANSFORMS order applicable to the type) under which raw equals expected; null if none. */
export function inferTransform(type: CustomerFieldType, raw: unknown, expected: string, ctx?: NormalizeContext): Transform | null;
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { applyTransform, inferTransform } from './transforms.js';

describe('applyTransform', () => {
  it('identity returns raw', () => expect(applyTransform('x', 'identity')).toBe('x'));
  it('cents_to_units divides numbers by 100', () => expect(applyTransform(12999, 'cents_to_units')).toBe(129.99));
  it('cents_to_units leaves non-numbers alone', () => expect(applyTransform('abc', 'cents_to_units')).toBe('abc'));
  it('first_of_list takes the first array item', () => expect(applyTransform(['a', 'b'], 'first_of_list')).toBe('a'));
  it('first_of_list on a non-array returns raw', () => expect(applyTransform('a', 'first_of_list')).toBe('a'));
});

describe('inferTransform', () => {
  it('prefers identity', () => expect(inferTransform('money', '$129.99', '129.99')).toBe('identity'));
  it('finds cents for money', () => expect(inferTransform('money', 12999, '129.99')).toBe('cents_to_units'));
  it('never uses cents for text', () => expect(inferTransform('text', 12999, '129.99')).toBeNull());
  it('finds first_of_list for a url array', () => {
    expect(inferTransform('image', ['https://c.example/a.jpg', 'https://c.example/b.jpg'], 'https://c.example/a.jpg')).toBe('first_of_list');
  });
  it('returns null when nothing matches', () => expect(inferTransform('number', '5', '6')).toBeNull());
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @robot/scraper exec vitest run src/verify/transforms.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { CustomerFieldType, Transform } from './types.js';
import { normalize, valuesEqual, type NormalizeContext } from './normalize.js';

export const TRANSFORMS: readonly Transform[] = ['identity', 'cents_to_units', 'first_of_list'];

const APPLICABLE: Record<CustomerFieldType, readonly Transform[]> = {
  text: ['identity', 'first_of_list'],
  number: ['identity', 'cents_to_units', 'first_of_list'],
  money: ['identity', 'cents_to_units', 'first_of_list'],
  boolean: ['identity', 'first_of_list'],
  date: ['identity', 'first_of_list'],
  url: ['identity', 'first_of_list'],
  image: ['identity', 'first_of_list'],
  text_list: ['identity'],
};

export function applyTransform(raw: unknown, t: Transform): unknown {
  switch (t) {
    case 'identity': return raw;
    case 'cents_to_units': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : null;
      return n === null ? raw : Math.round(n) / 100;
    }
    case 'first_of_list': return Array.isArray(raw) ? raw[0] : raw;
  }
}

export function inferTransform(type: CustomerFieldType, raw: unknown, expected: string, ctx?: NormalizeContext): Transform | null {
  for (const t of APPLICABLE[type]) {
    const v = applyTransform(raw, t);
    if (normalize(type, v, ctx) !== null && valuesEqual(type, v, expected, ctx)) return t;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**, then **Step 5: Commit** `feat(scraper): closed transform set`.

---

### Task 4: Structured search (API bodies, JSON-LD, meta)

**Files:**
- Create: `packages/scraper/src/verify/search-structured.ts`
- Test: `packages/scraper/src/verify/search-structured.test.ts`

**Interfaces:**
- Consumes: `inferTransform` (Task 3), `getByDotPath` from `../domain-cache.js` (existing, `packages/scraper/src/domain-cache.ts:929`), `PageCapture`/`StructuredData` from `@robot/browser`.
- Produces:

```ts
export type StructuredCandidate = { source: 'api' | 'json-ld' | 'meta'; path: string; transform: Transform; raw: unknown };
export function searchStructured(capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests'>, type: CustomerFieldType, expected: string): StructuredCandidate[];
/** Replay a structured path against a capture the way the cache does: first body where it resolves non-empty. */
export function resolveStructured(capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests'>, source: 'api' | 'json-ld' | 'meta', path: string): unknown;
```

Path format matches the cache: API and JSON-LD paths are dot-paths (`a.b[0].c`) resolved by `getByDotPath` against each JSON body / JSON-LD block in turn; a meta path is the meta key.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { searchStructured, resolveStructured } from './search-structured.js';

const capture = {
  url: 'https://shop.example/p/1',
  structuredData: {
    ldJson: [{ '@type': 'Product', name: 'Widget A', offers: { price: '129.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }],
    nextData: null, initialState: null,
    meta: { 'og:title': 'Widget A', 'product:price:amount': '129.99' },
  },
  interceptedRequests: [
    { url: 'https://shop.example/api/p/1', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true,
      responseBody: '{}', parsedJson: { item: { title: 'Widget A', priceCents: 12999, images: ['https://c.example/a.jpg', 'https://c.example/b.jpg'] }, related: [{ title: 'Widget B' }] } },
    { url: 'https://shop.example/telemetry', method: 'POST', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'text/plain', bodySize: 1, timestamp: 0, isJson: false, responseBody: 'ok', parsedJson: null },
  ],
};

describe('searchStructured', () => {
  it('finds a text value in api, json-ld and meta with identity transform', () => {
    const c = searchStructured(capture, 'text', 'Widget A');
    expect(c).toContainEqual({ source: 'api', path: 'item.title', transform: 'identity', raw: 'Widget A' });
    expect(c).toContainEqual({ source: 'json-ld', path: 'name', transform: 'identity', raw: 'Widget A' });
    expect(c).toContainEqual({ source: 'meta', path: 'og:title', transform: 'identity', raw: 'Widget A' });
    expect(c.find((x) => x.path === 'related[0].title')).toBeUndefined();
  });
  it('finds money via cents_to_units in the api and identity in json-ld', () => {
    const c = searchStructured(capture, 'money', '129.99');
    expect(c).toContainEqual({ source: 'api', path: 'item.priceCents', transform: 'cents_to_units', raw: 12999 });
    expect(c).toContainEqual({ source: 'json-ld', path: 'offers.price', transform: 'identity', raw: '129.99' });
  });
  it('finds an image via first_of_list on an array', () => {
    const c = searchStructured(capture, 'image', 'https://c.example/a.jpg');
    expect(c).toContainEqual({ source: 'api', path: 'item.images', transform: 'first_of_list', raw: ['https://c.example/a.jpg', 'https://c.example/b.jpg'] });
    expect(c).toContainEqual({ source: 'api', path: 'item.images[0]', transform: 'identity', raw: 'https://c.example/a.jpg' });
  });
  it('maps a schema.org availability to boolean', () => {
    expect(searchStructured(capture, 'boolean', 'in stock')).toContainEqual({ source: 'json-ld', path: 'offers.availability', transform: 'identity', raw: 'https://schema.org/InStock' });
  });
});

describe('resolveStructured', () => {
  it('replays api, json-ld and meta paths', () => {
    expect(resolveStructured(capture, 'api', 'item.priceCents')).toBe(12999);
    expect(resolveStructured(capture, 'json-ld', 'offers.price')).toBe('129.99');
    expect(resolveStructured(capture, 'meta', 'og:title')).toBe('Widget A');
    expect(resolveStructured(capture, 'api', 'nope.x')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
import type { PageCapture } from '@robot/browser';
import { getByDotPath } from '../domain-cache.js';
import { inferTransform } from './transforms.js';
import type { CustomerFieldType, Transform } from './types.js';

export type StructuredCandidate = { source: 'api' | 'json-ld' | 'meta'; path: string; transform: Transform; raw: unknown };

const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 25;

type Visit = (path: string, value: unknown) => void;

function walk(value: unknown, path: string, depth: number, visit: Visit): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    visit(path, value); // arrays are candidates themselves (first_of_list)
    value.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1, visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, path === '' ? k : `${path}.${k}`, depth + 1, visit);
    }
    return;
  }
  if (path !== '') visit(path, value);
}

function apiBodies(capture: Pick<PageCapture, 'interceptedRequests'>): unknown[] {
  return capture.interceptedRequests.filter((r) => r.isJson && r.parsedJson !== null).map((r) => r.parsedJson);
}

export function searchStructured(
  capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests'>,
  type: CustomerFieldType,
  expected: string,
): StructuredCandidate[] {
  const ctx = { pageUrl: capture.url };
  const out: StructuredCandidate[] = [];
  const seen = new Set<string>();
  const consider = (source: StructuredCandidate['source'], path: string, raw: unknown) => {
    const transform = inferTransform(type, raw, expected, ctx);
    if (transform === null) return;
    const id = `${source} ${path}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ source, path, transform, raw });
  };
  for (const body of apiBodies(capture)) walk(body, '', 0, (p, v) => consider('api', p, v));
  for (const block of capture.structuredData.ldJson) walk(block, '', 0, (p, v) => consider('json-ld', p, v));
  for (const [k, v] of Object.entries(capture.structuredData.meta)) consider('meta', k, v);
  return out;
}

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

export function resolveStructured(
  capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests'>,
  source: 'api' | 'json-ld' | 'meta',
  path: string,
): unknown {
  if (source === 'meta') return capture.structuredData.meta[path];
  const containers = source === 'api' ? apiBodies(capture) : capture.structuredData.ldJson;
  for (const c of containers) {
    const v = getByDotPath(c, path);
    if (nonEmpty(v)) return v;
  }
  return undefined;
}
```

- [ ] **Step 4: Run to verify it passes**, then **Step 5: Commit** `feat(scraper): mechanical structured search for expected values`.

---

### Task 5: DOM search and XPath probe scripts (real Chromium)

**Files:**
- Create: `packages/scraper/src/verify/dom-scripts.ts`
- Test: `packages/scraper/src/verify/dom-scripts.test.ts` (launches `PlaywrightBrowser`, no network — the `catalogue-serving.test.ts` pattern)

**Interfaces:**
- Consumes: `IBrowser.setContentEvaluate<T>(html, script)` (`packages/browser/src/playwright-browser.ts:338`).
- Produces:

```ts
export type DomNeedle = { key: string; type: CustomerFieldType; expected: string };
export type DomHit = { key: string; xpath: string; raw: string };
/** In-browser: find leaf elements/attributes whose value equals a needle; return structural XPaths. */
export function buildDomSearchScript(needles: DomNeedle[], pageUrl: string): string;
/** In-browser: evaluate each XPath (text, or attribute when the path ends in /@attr); null when nothing matched. */
export function buildXPathProbeScript(xpaths: string[]): string;
export type XPathProbeResult = Record<string, string | null>;
/** Rejected when the XPath text contains the expected value (case-insensitive, whitespace-collapsed). */
export function xpathContainsValue(xpath: string, expected: string): boolean;
```

Structural XPath rule: from the matched element walk up to the nearest ancestor with an `id` (→ `//*[@id="…"]`), else a `data-*` attribute (→ `//tag[@data-x="…"]`), else the `body`; then descend by `tag[@class="…"]` when the element has a class, else `tag[n]` (1-based among same-tag siblings). Attribute hits append `/@href`, `/@src`, or `/@content`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildDomSearchScript, buildXPathProbeScript, xpathContainsValue, type DomHit, type XPathProbeResult } from './dom-scripts.js';

const HTML = `<html><body>
<div id="main">
  <h1 class="title">Widget A</h1>
  <div class="price-box"><span class="was">$149.00</span><span class="now">$129.99</span></div>
  <p class="stock">In stock</p>
  <img class="hero" src="/img/a.jpg">
  <a class="buy" href="/checkout?p=1">Buy</a>
</div>
<div data-section="related"><span class="now">$99.00</span></div>
</body></html>`;

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

describe('buildDomSearchScript', () => {
  it('finds text, money, boolean, image and url values with structural xpaths', async () => {
    const hits = await browser.setContentEvaluate<DomHit[]>(HTML, buildDomSearchScript([
      { key: 'title', type: 'text', expected: 'Widget A' },
      { key: 'price', type: 'money', expected: '129.99' },
      { key: 'in_stock', type: 'boolean', expected: 'yes' },
      { key: 'image', type: 'image', expected: 'https://shop.example/img/a.jpg' },
      { key: 'buy', type: 'url', expected: 'https://shop.example/checkout?p=1' },
    ], 'https://shop.example/p/1'));
    expect(hits).toContainEqual({ key: 'title', xpath: '//*[@id="main"]/h1[@class="title"]', raw: 'Widget A' });
    expect(hits).toContainEqual({ key: 'price', xpath: '//*[@id="main"]/div[@class="price-box"]/span[@class="now"]', raw: '$129.99' });
    expect(hits.filter((h) => h.key === 'price')).toHaveLength(1); // the $149 and $99 spans do not match
    expect(hits).toContainEqual({ key: 'in_stock', xpath: '//*[@id="main"]/p[@class="stock"]', raw: 'In stock' });
    expect(hits).toContainEqual({ key: 'image', xpath: '//*[@id="main"]/img[@class="hero"]/@src', raw: '/img/a.jpg' });
    expect(hits).toContainEqual({ key: 'buy', xpath: '//*[@id="main"]/a[@class="buy"]/@href', raw: '/checkout?p=1' });
  });
  it('uses a data attribute anchor when there is no id', async () => {
    const hits = await browser.setContentEvaluate<DomHit[]>(HTML, buildDomSearchScript([{ key: 'rel', type: 'money', expected: '99' }], 'https://shop.example/'));
    expect(hits).toContainEqual({ key: 'rel', xpath: '//div[@data-section="related"]/span[@class="now"]', raw: '$99.00' });
  });
});

describe('buildXPathProbeScript', () => {
  it('returns text or attribute per xpath and null for no match', async () => {
    const r = await browser.setContentEvaluate<XPathProbeResult>(HTML, buildXPathProbeScript([
      '//*[@id="main"]/h1[@class="title"]',
      '//*[@id="main"]/img[@class="hero"]/@src',
      '//*[@id="nope"]',
    ]));
    expect(r['//*[@id="main"]/h1[@class="title"]']).toBe('Widget A');
    expect(r['//*[@id="main"]/img[@class="hero"]/@src']).toBe('/img/a.jpg');
    expect(r['//*[@id="nope"]']).toBeNull();
  });
});

describe('xpathContainsValue', () => {
  it('rejects a literal-value predicate', () => {
    expect(xpathContainsValue(`//span[contains(text(), '129.99')]`, '129.99')).toBe(true);
    expect(xpathContainsValue(`//span[@class="now"]`, '129.99')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @robot/scraper exec vitest run src/verify/dom-scripts.test.ts`.

- [ ] **Step 3: Implement**

The browser-side normalizer is a self-contained function (no imports) serialized with `.toString()`; it mirrors Task 2's rules for the types the DOM can hold.

```ts
import type { CustomerFieldType } from './types.js';

export type DomNeedle = { key: string; type: CustomerFieldType; expected: string };
export type DomHit = { key: string; xpath: string; raw: string };
export type XPathProbeResult = Record<string, string | null>;

/** Runs INSIDE the page. Keep it dependency-free: it is stringified into the script. */
function browserNormalize(type: string, raw: string, pageUrl: string): string | null {
  const t = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  const num = (s: string): number | null => {
    let x = s.replace(/[A-Za-z$€£¥₹\s]/g, '').replace(/^[^\d\-+.,]+|[^\d.,]+$/g, '');
    if (!/^[-+]?[\d.,]+$/.test(x) || !/\d/.test(x)) return null;
    const lc = x.lastIndexOf(','), ld = x.lastIndexOf('.');
    if (lc > -1 && ld > -1) x = lc > ld ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    else if (lc > -1) { const g = x.split(','); x = g.length === 2 && g[1]!.length !== 3 ? x.replace(',', '.') : x.replace(/,/g, ''); }
    else if (ld > -1) { const g = x.split('.'); if (g.length > 2) x = x.replace(/\./g, ''); }
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const TRUE = ['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock', 'https://schema.org/instock'];
  const FALSE = ['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out', 'https://schema.org/outofstock'];
  switch (type) {
    case 'text': return t.toLowerCase();
    case 'number': { const n = num(t); return n === null ? null : String(n); }
    case 'money': { const n = num(t); return n === null ? null : (Math.round(n * 100) / 100).toFixed(2); }
    case 'boolean': { const l = t.toLowerCase(); return TRUE.includes(l) ? 'true' : FALSE.includes(l) ? 'false' : null; }
    case 'date': {
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
      const d = Date.parse(t);
      if (Number.isNaN(d)) return null;
      const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(t) && /T\d{2}:\d{2}/.test(t);
      const x = new Date(d);
      return zoned ? x.toISOString().slice(0, 10) : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    }
    case 'url':
    case 'image': { try { const u = new URL(t, pageUrl); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; u.hash = ''; u.hostname = u.hostname.toLowerCase(); return u.href; } catch { return null; } }
    case 'text_list': { const items = t.split(/[\n,;]/).map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean); return items.length ? Array.from(new Set(items)).sort().join(' ') : null; }
    default: return null;
  }
}

/** Runs INSIDE the page. Structural XPath to an element: id anchor, else data-* anchor, else body. */
function browserXPath(el: Element): string {
  const step = (e: Element): string => {
    const tag = e.tagName.toLowerCase();
    const cls = (e.getAttribute('class') ?? '').trim();
    if (cls) return `${tag}[@class="${cls.replace(/"/g, '')}"]`;
    let i = 1;
    let s = e.previousElementSibling;
    while (s) { if (s.tagName === e.tagName) i++; s = s.previousElementSibling; }
    return `${tag}[${i}]`;
  };
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'body') {
    const id = cur.getAttribute('id');
    if (id) return `//*[@id="${id.replace(/"/g, '')}"]` + (parts.length ? '/' + parts.join('/') : '');
    const data = Array.from(cur.attributes).find((a) => a.name.startsWith('data-') && a.value !== '');
    if (data && cur !== el) return `//${cur.tagName.toLowerCase()}[@${data.name}="${data.value.replace(/"/g, '')}"]` + (parts.length ? '/' + parts.join('/') : '');
    parts.unshift(step(cur));
    cur = cur.parentElement;
  }
  return '//body' + (parts.length ? '/' + parts.join('/') : '');
}

export function buildDomSearchScript(needles: DomNeedle[], pageUrl: string): string {
  return `(() => {
    const normalize = ${browserNormalize.toString()};
    const xpathOf = ${browserXPath.toString()};
    const needles = ${JSON.stringify(needles)};
    const pageUrl = ${JSON.stringify(pageUrl)};
    const wanted = needles.map((n) => ({ ...n, norm: normalize(n.type, n.expected, pageUrl) })).filter((n) => n.norm !== null);
    const hits = [];
    const consider = (el, raw, attr) => {
      if (raw == null || String(raw).trim() === '') return;
      for (const n of wanted) {
        if (normalize(n.type, String(raw), pageUrl) !== n.norm) continue;
        hits.push({ key: n.key, xpath: xpathOf(el) + (attr ? '/@' + attr : ''), raw: String(raw) });
      }
    };
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
      if (el.children.length === 0) consider(el, el.textContent, null);
      if (el.hasAttribute('href')) consider(el, el.getAttribute('href'), 'href');
      if (el.hasAttribute('src')) consider(el, el.getAttribute('src'), 'src');
      if (el.hasAttribute('content')) consider(el, el.getAttribute('content'), 'content');
    }
    return hits;
  })()`;
}

export function buildXPathProbeScript(xpaths: string[]): string {
  return `(() => {
    const out = {};
    for (const xp of ${JSON.stringify(xpaths)}) {
      try {
        const m = xp.match(/^(.*)\\/@([a-zA-Z_:-]+)$/);
        const base = m ? m[1] : xp;
        const r = document.evaluate(base, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = r.singleNodeValue;
        if (!node) { out[xp] = null; continue; }
        const v = m ? node.getAttribute(m[2]) : (node.textContent ?? '');
        out[xp] = v == null || String(v).trim() === '' ? null : String(v).trim();
      } catch { out[xp] = null; }
    }
    return out;
  })()`;
}

export function xpathContainsValue(xpath: string, expected: string): boolean {
  const fold = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const e = fold(expected);
  return e.length > 0 && fold(xpath).includes(e);
}
```

`browserNormalize`'s `text` branch lower-cases; the hit's `raw` keeps the page's original casing, so the Node side (Task 6) compares with `valuesEqual` and renders from `raw`.

- [ ] **Step 4: Run to verify it passes**, then **Step 5: Commit** `feat(scraper): in-browser DOM search and XPath probe scripts`.

---

### Task 6: Certification across three captures

**Files:**
- Create: `packages/scraper/src/verify/certify.ts`
- Test: `packages/scraper/src/verify/certify.test.ts` (pure — XPath evaluation is injected)

**Interfaces:**
- Consumes: `searchStructured`, `resolveStructured` (Task 4), `buildDomSearchScript`, `buildXPathProbeScript`, `xpathContainsValue` (Task 5), `applyTransform` (Task 3), `normalize`/`valuesEqual`/`renderValue` (Task 2), `MAX_CERTIFIED_PATHS`.
- Produces:

```ts
export type CandidatePath = CertifiedPath;               // a path not yet proven
export type CaptureLike = Pick<PageCapture, 'url' | 'html' | 'structuredData' | 'interceptedRequests'>;
export type CertifyDeps = { evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult> };
export type CertifyInput = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;                      // url → as typed
  captures: Record<string, CaptureLike | null>;           // url → capture, null when not captured
  candidates: CandidatePath[];                            // from search + cache + AI; deduped inside
};
export function certify(input: CertifyInput, deps: CertifyDeps): Promise<FieldVerification>;
/** Gather mechanical candidates for a field across all captures (structured + DOM). */
export function gatherCandidates(field: SchemaDefinitionField, expected: Record<string, string>, captures: Record<string, CaptureLike | null>, deps: { runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]> }): Promise<{ candidates: CandidatePath[]; hitsByUrl: Record<string, number> }>;
export function rankCertified(paths: CertifiedPath[]): CertifiedPath[]; // api > json-ld > meta > xpath, then shorter path
```

Cell rules (spec §4.4/§4.6), applied per URL after evaluating every candidate on every capture:
- capture is `null` → `not_captured`.
- some candidate is correct on all captured URLs → every captured cell `pass` (found = the primary path's raw value rendered as a string) and `certified` = ranked list capped at `MAX_CERTIFIED_PATHS`.
- otherwise, for this URL: a candidate correct on **every other** captured URL but not here → `different_value` (found = its value here, when non-empty) or `type_mismatch` (its raw here is non-empty but does not normalize) or `not_found` (empty here); else candidates correct here exist → `ambiguous`; else `not_found`. `nearMisses` = up to three distinct non-empty raw values candidates produced on this URL.
- `weakEvidence` = all expected values normalize to one value.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { certify, rankCertified, type CaptureLike } from './certify.js';

const field = { key: 'price', name: 'Price', type: 'money' as const, description: 'green number', concept: 'price' };

function cap(url: string, price: string, other: string): CaptureLike {
  return {
    url, html: '<html></html>',
    structuredData: { ldJson: [{ offers: { price } }], nextData: null, initialState: null, meta: { 'product:price:amount': other } },
    interceptedRequests: [],
  };
}
const captures = {
  'https://s.example/1': cap('https://s.example/1', '129.99', '129.99'),
  'https://s.example/2': cap('https://s.example/2', '219.99', '219.99'),
  'https://s.example/3': cap('https://s.example/3', '149.00', '999.00'),
};
const expected = { 'https://s.example/1': '129.99', 'https://s.example/2': '219.99', 'https://s.example/3': '149' };
const xpathDeps = { evalXPaths: async (_html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, x.includes('now') ? 'ignored' : null])) };

describe('certify', () => {
  it('certifies only the path correct on all three, ranks it, and passes every cell', async () => {
    const r = await certify({ field, expected, captures, candidates: [
      { source: 'json-ld', path: 'offers.price', transform: 'identity' },
      { source: 'meta', path: 'product:price:amount', transform: 'identity' },
    ] }, xpathDeps);
    expect(r.certified).toEqual([{ source: 'json-ld', path: 'offers.price', transform: 'identity' }]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
    expect(r.cells['https://s.example/3']).toEqual({ status: 'pass', found: '149.00', path: r.certified[0] });
    expect(r.weakEvidence).toBe(false);
  });
  it('reports different_value on the page where a 2-of-3 path disagrees, pass nowhere', async () => {
    const r = await certify({ field, expected, captures, candidates: [{ source: 'meta', path: 'product:price:amount', transform: 'identity' }] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://s.example/3']).toMatchObject({ status: 'fail', reason: 'different_value', found: '999.00' });
    expect(r.cells['https://s.example/1']).toMatchObject({ status: 'fail', reason: 'ambiguous' });
  });
  it('reports not_found when nothing hit, not_captured for a null capture', async () => {
    const r = await certify({ field, expected, captures: { ...captures, 'https://s.example/3': null }, candidates: [] }, xpathDeps);
    expect(r.cells['https://s.example/1']).toEqual({ status: 'fail', reason: 'not_found' });
    expect(r.cells['https://s.example/3']).toEqual({ status: 'not_captured' });
  });
  it('flags weak evidence when all expected values are identical', async () => {
    const same = { 'https://s.example/1': '129.99', 'https://s.example/2': '129.99', 'https://s.example/3': '129.99' };
    const caps = { ...captures, 'https://s.example/2': cap('https://s.example/2', '129.99', 'x'), 'https://s.example/3': cap('https://s.example/3', '129.99', 'x') };
    const r = await certify({ field, expected: same, captures: caps, candidates: [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }] }, xpathDeps);
    expect(r.weakEvidence).toBe(true);
    expect(r.certified).toHaveLength(1);
  });
  it('rejects an xpath that embeds the expected value', async () => {
    const r = await certify({ field, expected, captures, candidates: [{ source: 'xpath', path: `//span[contains(text(),'129.99')]`, transform: 'identity' }] }, xpathDeps);
    expect(r.certified).toEqual([]);
  });
});

describe('rankCertified', () => {
  it('orders api, json-ld, meta, xpath then by path length', () => {
    const ranked = rankCertified([
      { source: 'xpath', path: '//a', transform: 'identity' },
      { source: 'meta', path: 'og:price', transform: 'identity' },
      { source: 'api', path: 'item.price.long.path', transform: 'identity' },
      { source: 'api', path: 'p', transform: 'identity' },
    ]);
    expect(ranked.map((p) => p.path)).toEqual(['p', 'item.price.long.path', 'og:price', '//a']);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
import type { PageCapture } from '@robot/browser';
import { MAX_CERTIFIED_PATHS } from './constants.js';
import { normalize, valuesEqual } from './normalize.js';
import { applyTransform } from './transforms.js';
import { resolveStructured, searchStructured } from './search-structured.js';
import { xpathContainsValue, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import type { CellResult, CertifiedPath, FieldVerification, SchemaDefinitionField } from './types.js';

export type CandidatePath = CertifiedPath;
export type CaptureLike = Pick<PageCapture, 'url' | 'html' | 'structuredData' | 'interceptedRequests'>;
export type CertifyDeps = { evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult> };
export type CertifyInput = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;
  captures: Record<string, CaptureLike | null>;
  candidates: CandidatePath[];
};

const SOURCE_RANK: Record<CertifiedPath['source'], number> = { api: 0, 'json-ld': 1, meta: 2, xpath: 3 };

export function rankCertified(paths: CertifiedPath[]): CertifiedPath[] {
  return [...paths].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.path.length - b.path.length);
}

function pathId(p: CandidatePath): string {
  return `${p.source} ${p.path} ${p.transform}`;
}

function dedupe(candidates: CandidatePath[]): CandidatePath[] {
  const seen = new Set<string>();
  return candidates.filter((c) => { const id = pathId(c); if (seen.has(id)) return false; seen.add(id); return true; });
}

export async function gatherCandidates(
  field: SchemaDefinitionField,
  expected: Record<string, string>,
  captures: Record<string, CaptureLike | null>,
  deps: { runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]> },
): Promise<{ candidates: CandidatePath[]; hitsByUrl: Record<string, number> }> {
  const candidates: CandidatePath[] = [];
  const hitsByUrl: Record<string, number> = {};
  for (const [url, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const exp = expected[url] ?? '';
    const structured = searchStructured(capture, field.type, exp);
    const dom = await deps.runDomSearch(capture.html, [{ key: field.key, type: field.type, expected: exp }], capture.url);
    hitsByUrl[url] = structured.length + dom.length;
    candidates.push(...structured.map((s) => ({ source: s.source, path: s.path, transform: s.transform })));
    candidates.push(...dom.map((h) => ({ source: 'xpath' as const, path: h.xpath, transform: 'identity' as const })));
  }
  return { candidates: dedupe(candidates), hitsByUrl };
}

type Eval = { raw: unknown; correct: boolean };

export async function certify(input: CertifyInput, deps: CertifyDeps): Promise<FieldVerification> {
  const { field, expected, captures } = input;
  const candidates = dedupe(input.candidates).filter((c) => c.source !== 'xpath' || !Object.values(expected).some((e) => xpathContainsValue(c.path, e)));
  const urls = Object.keys(captures);
  const capturedUrls = urls.filter((u) => captures[u] !== null);

  // Evaluate every candidate on every captured URL.
  const evals = new Map<string, Record<string, Eval>>(); // pathId → url → eval
  for (const url of capturedUrls) {
    const capture = captures[url]!;
    const ctx = { pageUrl: capture.url };
    const xpaths = candidates.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(capture.html, xpaths) : {};
    for (const c of candidates) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      const correct = raw !== null && raw !== undefined && raw !== '' && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
      (evals.get(pathId(c)) ?? evals.set(pathId(c), {}).get(pathId(c))!)[url] = { raw, correct };
    }
  }

  const correctEverywhere = candidates.filter((c) => capturedUrls.length > 0 && capturedUrls.every((u) => evals.get(pathId(c))?.[u]?.correct));
  const certified = rankCertified(correctEverywhere).slice(0, MAX_CERTIFIED_PATHS);
  const primary = certified[0];

  const cells: Record<string, CellResult> = {};
  for (const url of urls) {
    const capture = captures[url];
    if (!capture) { cells[url] = { status: 'not_captured' }; continue; }
    const ctx = { pageUrl: capture.url };
    if (primary) {
      const raw = evals.get(pathId(primary))![url]!.raw;
      cells[url] = { status: 'pass', found: String(raw), path: primary };
      continue;
    }
    const others = capturedUrls.filter((u) => u !== url);
    const nearMisses = [...new Set(candidates.map((c) => evals.get(pathId(c))?.[url]?.raw).filter((r) => r !== null && r !== undefined && r !== '').map(String))].slice(0, 3);
    const twoOfThree = candidates.find((c) => others.length > 0 && others.every((u) => evals.get(pathId(c))?.[u]?.correct) && !evals.get(pathId(c))?.[url]?.correct);
    if (twoOfThree) {
      const here = evals.get(pathId(twoOfThree))![url]!.raw;
      const empty = here === null || here === undefined || here === '';
      if (empty) cells[url] = { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
      else if (normalize(field.type, here, ctx) === null) cells[url] = { status: 'fail', reason: 'type_mismatch', found: String(here), ...(nearMisses.length ? { nearMisses } : {}) };
      else cells[url] = { status: 'fail', reason: 'different_value', found: String(here), ...(nearMisses.length ? { nearMisses } : {}) };
      continue;
    }
    const correctHere = candidates.some((c) => evals.get(pathId(c))?.[url]?.correct);
    cells[url] = correctHere
      ? { status: 'fail', reason: 'ambiguous', ...(nearMisses.length ? { nearMisses } : {}) }
      : { status: 'fail', reason: 'not_found', ...(nearMisses.length ? { nearMisses } : {}) };
  }

  const norms = new Set(Object.values(expected).map((e) => normalize(field.type, e)));
  return { key: field.key, cells, certified, weakEvidence: norms.size === 1 && Object.keys(expected).length > 1, aiCalled: false };
}
```

- [ ] **Step 4: Run to verify it passes**, then **Step 5: Commit** `feat(scraper): certify candidate paths across three captures`.

---

### Task 7: AI fallback — `propose_paths` tool and prompt

**Files:**
- Modify: `packages/agent/src/tools.ts` (append), `packages/agent/src/schema-agent.ts` (new method), `packages/agent/src/index.ts` (export the type)
- Create: `packages/scraper/src/verify/ai-fallback.ts`
- Test: `packages/agent/src/propose-paths.test.ts` (parser only), `packages/scraper/src/verify/ai-fallback.test.ts` (stub agent)

**Interfaces:**
- Produces (agent):

```ts
export type PathProposal = { source: 'api' | 'json-ld' | 'meta' | 'xpath'; path: string; transform: 'identity' | 'cents_to_units' | 'first_of_list' };
export type ProposePathsAgent = { proposePaths(userText: string): Promise<PathProposal[]> };
// SchemaAgent implements ProposePathsAgent; returns [] on Ollama (no tool calls) and throws on provider errors.
export function parsePathProposals(input: unknown): PathProposal[]; // exported from @robot/agent for tests
```

- Produces (scraper):

```ts
export type FallbackEvidence = { field: SchemaDefinitionField; expected: Record<string, string>; captures: Record<string, CaptureLike | null>; nearMisses: Record<string, string[]> };
export function buildProposePrompt(evidence: FallbackEvidence): string;
export async function proposeWithAi(evidence: FallbackEvidence, agent: ProposePathsAgent): Promise<CandidatePath[]>;
```

- [ ] **Step 1: Tool definition** (append to `tools.ts`):

```ts
export const proposePathsTool: Tool = {
  name: 'propose_paths',
  description: 'Propose extraction paths that yield the expected value for one field on every page shown. Paths must be structural: never put the expected value itself inside an XPath predicate.',
  input_schema: {
    type: 'object' as const,
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['api', 'json-ld', 'meta', 'xpath'], description: 'api = dot-path into an intercepted JSON body; json-ld = dot-path into a JSON-LD block; meta = meta tag name; xpath = XPath anchored on id/data-*/class' },
            path: { type: 'string' },
            transform: { type: 'string', enum: ['identity', 'cents_to_units', 'first_of_list'] },
            rationale: { type: 'string' },
          },
          required: ['source', 'path'],
        },
      },
    },
    required: ['proposals'],
  },
};
```

- [ ] **Step 2: Parser test** (`packages/agent/src/propose-paths.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { parsePathProposals } from './propose-paths.js';

describe('parsePathProposals', () => {
  it('keeps well-formed proposals, defaults transform to identity, drops junk', () => {
    expect(parsePathProposals({ proposals: [
      { source: 'api', path: 'item.price' },
      { source: 'xpath', path: '//span[@class="now"]', transform: 'cents_to_units' },
      { source: 'magic', path: 'x' },
      { source: 'api' },
    ] })).toEqual([
      { source: 'api', path: 'item.price', transform: 'identity' },
      { source: 'xpath', path: '//span[@class="now"]', transform: 'cents_to_units' },
    ]);
  });
  it('returns [] for an empty or malformed envelope', () => {
    expect(parsePathProposals({})).toEqual([]);
    expect(parsePathProposals(null)).toEqual([]);
  });
});
```

Create `packages/agent/src/propose-paths.ts`:

```ts
export type PathProposal = { source: 'api' | 'json-ld' | 'meta' | 'xpath'; path: string; transform: 'identity' | 'cents_to_units' | 'first_of_list' };
export type ProposePathsAgent = { proposePaths(userText: string): Promise<PathProposal[]> };

const SOURCES = new Set(['api', 'json-ld', 'meta', 'xpath']);
const TRANSFORMS = new Set(['identity', 'cents_to_units', 'first_of_list']);

export function parsePathProposals(input: unknown): PathProposal[] {
  const list = (input as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(list)) return [];
  const out: PathProposal[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const { source, path, transform } = p as Record<string, unknown>;
    if (typeof source !== 'string' || !SOURCES.has(source) || typeof path !== 'string' || path.trim() === '') continue;
    out.push({ source: source as PathProposal['source'], path: path.trim(), transform: typeof transform === 'string' && TRANSFORMS.has(transform) ? (transform as PathProposal['transform']) : 'identity' });
  }
  return out;
}

export const PROPOSE_PATHS_SYSTEM = `You locate one field's value on product pages and return STRUCTURAL extraction paths.
Rules: a path must work on every page shown, so anchor on ids, data-* attributes, class names or JSON keys — never on the value text. Do not write contains(text(), '<value>'). Prefer api, then json-ld, then meta, then xpath. Return at most 5 proposals.`;
```

Add to `SchemaAgent` (after `extractFromApi`):

```ts
  async proposePaths(userText: string): Promise<PathProposal[]> {
    if (!this.anthropic) return []; // tool calls only; Ollama has no callWithTool
    const result = await this.anthropic.callWithTool({
      system: PROPOSE_PATHS_SYSTEM,
      tool: proposePathsTool,
      userText,
      maxTokens: 2048,
    });
    return parsePathProposals(result);
  }
```

Export from `index.ts`: `export { parsePathProposals, PROPOSE_PATHS_SYSTEM, type PathProposal, type ProposePathsAgent } from './propose-paths.js';` and `proposePathsTool` alongside the other tools if tools are exported (they are not today — leave it internal).

- [ ] **Step 3: Scraper fallback test** (`ai-fallback.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { buildProposePrompt, proposeWithAi } from './ai-fallback.js';

const field = { key: 'price', name: 'Price', type: 'money' as const, description: 'green number next to Add to cart', concept: 'price' };
const cap = (url: string) => ({
  url, html: '<html><body><div id="p"><span class="now">$129.99</span></div></body></html>',
  structuredData: { ldJson: [{ name: 'W' }], nextData: null, initialState: null, meta: { 'og:title': 'W' } },
  interceptedRequests: [{ url: 'https://s.example/api', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true, responseBody: '{}', parsedJson: { item: { priceCents: 12999 } } }],
});
const evidence = { field, expected: { 'https://s.example/1': '129.99' }, captures: { 'https://s.example/1': cap('https://s.example/1') }, nearMisses: { 'https://s.example/1': ['$149.00'] } };

describe('buildProposePrompt', () => {
  it('carries the description, expected values per URL, near-misses, and the evidence', () => {
    const p = buildProposePrompt(evidence);
    expect(p).toContain('green number next to Add to cart');
    expect(p).toContain('https://s.example/1 → 129.99');
    expect(p).toContain('$149.00');
    expect(p).toContain('"priceCents":12999');
    expect(p).toContain('og:title');
  });
});

describe('proposeWithAi', () => {
  it('returns proposals as candidate paths and reports the call', async () => {
    const agent = { proposePaths: async () => [{ source: 'api' as const, path: 'item.priceCents', transform: 'cents_to_units' as const }] };
    expect(await proposeWithAi(evidence, agent)).toEqual([{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }]);
  });
});
```

- [ ] **Step 4: Implement `ai-fallback.ts`**

```ts
import type { ProposePathsAgent } from '@robot/agent';
import { visibleTextFromHtml } from '../corroborate-value.js';
import type { CandidatePath, CaptureLike } from './certify.js';
import type { SchemaDefinitionField } from './types.js';

export type FallbackEvidence = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;
  captures: Record<string, CaptureLike | null>;
  nearMisses: Record<string, string[]>;
};

const PER_BODY_CHARS = 8_000;
const API_SECTION_CHARS = 20_000;
const TEXT_WINDOW = 400;
const TEXT_SECTION_CHARS = 6_000;

function apiSection(capture: CaptureLike): string {
  let spent = 0;
  const parts: string[] = [];
  for (const r of capture.interceptedRequests) {
    if (!r.isJson || r.parsedJson === null) continue;
    const s = JSON.stringify(r.parsedJson);
    if (s.length > PER_BODY_CHARS || spent + s.length > API_SECTION_CHARS) { parts.push(`[body ${r.url} omitted: ${s.length} chars]`); continue; }
    parts.push(`[body ${r.url}]\n${s}`);
    spent += s.length;
  }
  return parts.join('\n');
}

function textWindows(html: string, expected: string): string {
  const text = visibleTextFromHtml(html);
  const idx = text.toLowerCase().indexOf(expected.toLowerCase());
  if (idx === -1) return text.slice(0, TEXT_SECTION_CHARS);
  return text.slice(Math.max(0, idx - TEXT_WINDOW), Math.min(text.length, idx + expected.length + TEXT_WINDOW));
}

export function buildProposePrompt(e: FallbackEvidence): string {
  const lines: string[] = [];
  lines.push(`FIELD: ${e.field.name} (key ${e.field.key}, type ${e.field.type})`);
  lines.push(`DESCRIPTION: ${e.field.description}`);
  lines.push('EXPECTED VALUE PER PAGE:');
  for (const [url, v] of Object.entries(e.expected)) lines.push(`- ${url} → ${v}`);
  for (const [url, capture] of Object.entries(e.captures)) {
    if (!capture) continue;
    lines.push(`\n=== PAGE ${url} ===`);
    const misses = e.nearMisses[url] ?? [];
    if (misses.length) lines.push(`Near-misses we found but which did not certify: ${misses.join(' | ')}`);
    lines.push(`--- intercepted JSON ---\n${apiSection(capture)}`);
    lines.push(`--- json-ld ---\n${JSON.stringify(capture.structuredData.ldJson).slice(0, PER_BODY_CHARS)}`);
    lines.push(`--- meta ---\n${JSON.stringify(capture.structuredData.meta).slice(0, 4_000)}`);
    lines.push(`--- visible text around the expected value ---\n${textWindows(capture.html, e.expected[url] ?? '')}`);
  }
  return lines.join('\n');
}

export async function proposeWithAi(e: FallbackEvidence, agent: ProposePathsAgent): Promise<CandidatePath[]> {
  const proposals = await agent.proposePaths(buildProposePrompt(e));
  return proposals.map((p) => ({ source: p.source, path: p.path, transform: p.transform }));
}
```

- [ ] **Step 5: Run both test files; expect PASS. Typecheck `pnpm typecheck`. Commit** `feat(agent,scraper): propose_paths tool and AI fallback prompt`.

---

### Task 8: `runVerification` orchestrator + hand-authored three-page fixture set

**Files:**
- Create: `packages/scraper/src/verify/run-verification.ts`, `packages/scraper/src/verify/index.ts`
- Create fixture set: `packages/scraper/src/__fixtures__/verify/shop-example/{p1,p2,p3}.json` (each a `CaptureLike` with `url`, `html`, `structuredData`, `interceptedRequests`), `packages/scraper/src/__fixtures__/verify/load.ts`
- Modify: `packages/scraper/src/index.ts` (re-export the verify module)
- Test: `packages/scraper/src/verify/run-verification.test.ts` (real Chromium, no network, `agent: null` and a stub agent)

**Interfaces:**
- Consumes: Tasks 2–7, `IBrowser` from `@robot/browser`.
- Produces:

```ts
export type VerificationRequest = {
  fields: SchemaDefinitionField[];
  verificationSet: VerificationSet;
};
export type VerificationDeps = {
  browser: IBrowser;
  agent: ProposePathsAgent | null;
  /** Pre-captured pages by url (reuse); a missing url is captured live. */
  captures?: Record<string, PageCapture>;
  /** Cached verified paths per concept for this domain, tried first. */
  cachedPaths?: (concept: string) => Promise<CertifiedPath[]>;
  /** Only re-run these field keys; others are copied from `previous`. */
  onlyKeys?: string[];
  previous?: VerificationOutcome;
  captureOne?: (browser: IBrowser, url: string) => Promise<PageCapture>;
};
export type VerificationRun = { outcome: VerificationOutcome; captures: Record<string, PageCapture | null>; captureErrors: Record<string, string> };
export function runVerification(req: VerificationRequest, deps: VerificationDeps): Promise<VerificationRun>;
export function definitionHash(fields: SchemaDefinitionField[], set: VerificationSet): string; // sha256 hex of canonical JSON
```

Order per field: cached verified paths → certify; if none certified, `gatherCandidates` → certify; if still none and `agent` present → `proposeWithAi` (once) → certify with proposals appended; `aiCalled` set accordingly. A URL whose capture throws is `null` with the error message in `captureErrors`. Capture uses `browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true })` unless `captureOne` is injected.

- [ ] **Step 1: Author the fixture triple.** Three pages for `https://shop.example/p/{1,2,3}`, same layout, different values, exercising: text (title in h1 + json-ld + api), money (displayed price in `span.now`, strikethrough `span.was`, api `priceCents`, json-ld `offers.price`), boolean (availability text + schema.org URL), image (`img.hero@src` relative + api `images[]`), url (`a.buy@href`), date (`time.ship` text like `Sep 4, 2026` + api `shipDate` ISO), text_list (`ul.colors > li` — DOM only matches as leaf items, so the expected list is found only via the api `colors` array), number (`span.rating`). Page 3 differs in layout on one field: its price sits in a `div.price-box` **without** the `span.was`, so the XPath `span[@class="now"]` still certifies while `span[2]` positional paths do not. Page 2 has `In stock`, page 3 `Out of stock`. Write each as JSON with `html` as a string. Keep every page under 8 KB. The api body's only money-shaped value is `item.priceCents` (so ranking is deterministic in the test below); it also carries `item.code: "SKU-A1"` and `item.shortCode: "A1"` (B2/C3 on pages 2/3) for the AI-stub test. `load.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { PageCapture } from '@robot/browser';

const DIR = join(dirname(fileURLToPath(import.meta.url)));

export function loadVerifyFixture(set: string, page: string): PageCapture {
  const raw = JSON.parse(readFileSync(join(DIR, set, `${page}.json`), 'utf-8')) as Omit<PageCapture, 'screenshot' | 'screenshotTiles' | 'markdown' | 'title' | 'timestamp'>;
  return { ...raw, markdown: '', title: '', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [] };
}
export const SHOP_EXAMPLE_URLS = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
export function loadShopExample(): Record<string, PageCapture> {
  return Object.fromEntries(SHOP_EXAMPLE_URLS.map((u, i) => [u, loadVerifyFixture('shop-example', `p${i + 1}`)]));
}
```

- [ ] **Step 2: Failing tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { runVerification, definitionHash } from './run-verification.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U } from '../__fixtures__/verify/load.js';

const fields = [
  { key: 'product_name', name: 'Product name', type: 'text' as const, description: 'big heading', concept: 'product_name' },
  { key: 'price', name: 'Price', type: 'money' as const, description: 'green number, not the crossed-out one', concept: 'price' },
  { key: 'in_stock', name: 'In stock', type: 'boolean' as const, description: 'availability line', concept: 'availability' },
  { key: 'image', name: 'Image', type: 'image' as const, description: 'main product photo', concept: 'image_url' },
  { key: 'colors', name: 'Colours', type: 'text_list' as const, description: 'colour chips', concept: 'colors' },
  { key: 'rating', name: 'Rating', type: 'number' as const, description: 'stars', concept: 'rating' },
];
const set = {
  urls: U,
  expected: {
    product_name: { [U[0]!]: 'Widget A', [U[1]!]: 'Widget B', [U[2]!]: 'Widget C' },
    price: { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' },
    in_stock: { [U[0]!]: 'yes', [U[1]!]: 'yes', [U[2]!]: 'no' },
    image: { [U[0]!]: 'https://shop.example/img/a.jpg', [U[1]!]: 'https://shop.example/img/b.jpg', [U[2]!]: 'https://shop.example/img/c.jpg' },
    colors: { [U[0]!]: 'Red, Blue', [U[1]!]: 'Green', [U[2]!]: 'Black, White, Grey' },
    rating: { [U[0]!]: '4.5', [U[1]!]: '3.8', [U[2]!]: '4.9' },
  },
};

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

describe('runVerification (shop-example, offline)', () => {
  it('certifies every field mechanically with zero AI calls', async () => {
    const run = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    expect(run.outcome.allPassed).toBe(true);
    expect(run.outcome.aiCalls).toBe(0);
    expect(run.outcome.fields.price!.certified[0]).toEqual({ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' });
    expect(run.outcome.fields.price!.certified.some((p) => p.source === 'xpath' && p.path.endsWith('span[@class="now"]'))).toBe(true);
    expect(run.outcome.fields.price!.certified.some((p) => p.path.includes("'129.99'"))).toBe(false);
  }, 60_000);

  it('a wrong expected value fails one cell with different_value and the field stays uncertified', async () => {
    const bad = { ...set, expected: { ...set.expected, price: { ...set.expected.price, [U[2]!]: '145.00' } } };
    const run = await runVerification({ fields: [fields[1]!], verificationSet: bad }, { browser, agent: null, captures: loadShopExample() });
    expect(run.outcome.allPassed).toBe(false);
    expect(run.outcome.fields.price!.cells[U[2]!]).toMatchObject({ status: 'fail', reason: 'different_value', found: expect.stringContaining('149') });
  }, 60_000);

  it('a stubborn field asks the agent once; a bad proposal is discarded, a good one certifies', async () => {
    const stubborn = [{ key: 'sku', name: 'SKU', type: 'text' as const, description: 'item number', concept: 'sku' }];
    // SKUs are only in the api under `item.code` as "SKU-A1" while the customer typed "A1" — nothing matches mechanically.
    const skuSet = { urls: U, expected: { sku: { [U[0]!]: 'A1', [U[1]!]: 'B2', [U[2]!]: 'C3' } } };
    let calls = 0;
    const agent = { proposePaths: async () => { calls++; return [
      { source: 'api' as const, path: 'item.code', transform: 'identity' as const },      // "SKU-A1" ≠ "A1" → discarded
      { source: 'api' as const, path: 'item.shortCode', transform: 'identity' as const }, // "A1" → certifies
    ]; } };
    const run = await runVerification({ fields: stubborn, verificationSet: skuSet }, { browser, agent, captures: loadShopExample() });
    expect(calls).toBe(1);
    expect(run.outcome.aiCalls).toBe(1);
    expect(run.outcome.fields.sku!.aiCalled).toBe(true);
    expect(run.outcome.fields.sku!.certified).toEqual([{ source: 'api', path: 'item.shortCode', transform: 'identity' }]);
  }, 60_000);

  it('a failing capture marks the column not_captured and records the error', async () => {
    const caps = loadShopExample();
    delete caps[U[2]!];
    const run = await runVerification({ fields: [fields[0]!], verificationSet: set }, { browser, agent: null, captures: caps, captureOne: async () => { throw new Error('blocked'); } });
    expect(run.captureErrors[U[2]!]).toBe('blocked');
    expect(run.outcome.fields.product_name!.cells[U[2]!]).toEqual({ status: 'not_captured' });
    expect(run.outcome.allPassed).toBe(false);
  }, 60_000);

  it('onlyKeys re-runs a subset and copies the rest from previous', async () => {
    const first = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const second = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample(), onlyKeys: ['price'], previous: first.outcome });
    expect(second.outcome.fields.product_name).toEqual(first.outcome.fields.product_name);
    expect(second.outcome.allPassed).toBe(true);
  }, 60_000);

  it('cached verified paths are tried first and skip the search', async () => {
    let searched = false;
    const run = await runVerification({ fields: [fields[1]!], verificationSet: set }, {
      browser, agent: null, captures: loadShopExample(),
      cachedPaths: async (concept) => concept === 'price' ? [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }] : [],
      captureOne: async () => { searched = true; throw new Error('should not capture'); },
    });
    expect(run.outcome.fields.price!.certified).toEqual([{ source: 'json-ld', path: 'offers.price', transform: 'identity' }]);
    expect(searched).toBe(false);
  }, 60_000);
});

describe('definitionHash', () => {
  it('is stable across key order and changes with any value', () => {
    const a = definitionHash(fields, set);
    const b = definitionHash([...fields].reverse(), set);
    expect(a).not.toBe(b); // order is part of the definition
    expect(definitionHash(fields, { ...set, listing_url: 'https://shop.example/c' })).not.toBe(a);
    expect(definitionHash(fields, set)).toBe(a);
  });
});
```

Make sure the fixture's api body for each page includes `item.code: "SKU-A1"` and `item.shortCode: "A1"` (B2/C3 on the other pages) so the AI-stub test is honest.

- [ ] **Step 3: Implement `run-verification.ts`**

```ts
import { createHash } from 'node:crypto';
import type { IBrowser, PageCapture } from '@robot/browser';
import type { ProposePathsAgent } from '@robot/agent';
import { certify, gatherCandidates, type CandidatePath, type CaptureLike } from './certify.js';
import { buildDomSearchScript, buildXPathProbeScript, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { proposeWithAi } from './ai-fallback.js';
import type { CertifiedPath, FieldVerification, SchemaDefinitionField, VerificationOutcome, VerificationSet } from './types.js';

export type VerificationRequest = { fields: SchemaDefinitionField[]; verificationSet: VerificationSet };
export type VerificationDeps = {
  browser: IBrowser;
  agent: ProposePathsAgent | null;
  captures?: Record<string, PageCapture>;
  cachedPaths?: (concept: string) => Promise<CertifiedPath[]>;
  onlyKeys?: string[];
  previous?: VerificationOutcome;
  captureOne?: (browser: IBrowser, url: string) => Promise<PageCapture>;
};
export type VerificationRun = { outcome: VerificationOutcome; captures: Record<string, PageCapture | null>; captureErrors: Record<string, string> };

const defaultCapture = (browser: IBrowser, url: string) => browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });

/** Same host and path (trailing slash and fragment ignored; query ignored — many shops append tracking params). */
function samePath(finalUrl: string, requested: string): boolean {
  try {
    const a = new URL(finalUrl); const b = new URL(requested);
    const norm = (p: string) => p.replace(/\/+$/, '') || '/';
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && norm(a.pathname) === norm(b.pathname);
  } catch { return false; }
}

export function definitionHash(fields: SchemaDefinitionField[], set: VerificationSet): string {
  const canon = JSON.stringify({
    fields: fields.map((f) => ({ key: f.key, name: f.name, type: f.type, description: f.description, concept: f.concept })),
    urls: set.urls,
    expected: Object.fromEntries(Object.keys(set.expected).sort().map((k) => [k, Object.fromEntries(Object.entries(set.expected[k]!).sort())])),
    listing_url: set.listing_url ?? null,
  });
  return createHash('sha256').update(canon).digest('hex');
}

export async function runVerification(req: VerificationRequest, deps: VerificationDeps): Promise<VerificationRun> {
  const captureOne = deps.captureOne ?? defaultCapture;
  const captures: Record<string, PageCapture | null> = {};
  const captureErrors: Record<string, string> = {};
  for (const url of req.verificationSet.urls) {
    if (deps.captures?.[url]) { captures[url] = deps.captures[url]!; continue; }
    try {
      const c = await captureOne(deps.browser, url);
      // Spec §4.1: a capture that landed on a different path (category page,
      // block page) is not this product page. `PageCapture.url` must be the
      // FINAL url for this to bite — check `PlaywrightBrowser.capture` sets it
      // from `page.url()` after navigation; if it only echoes the request, set
      // it there first (one line) and cover it in browser's own tests.
      if (samePath(c.url, url)) captures[url] = c;
      else { captures[url] = null; captureErrors[url] = `redirected to ${c.url}`; }
    } catch (err) { captures[url] = null; captureErrors[url] = err instanceof Error ? err.message : String(err); }
  }

  const evalXPaths = (html: string, xpaths: string[]) => deps.browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths));
  const runDomSearch = (html: string, needles: DomNeedle[], pageUrl: string) => deps.browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl));

  const fields: Record<string, FieldVerification> = {};
  let aiCalls = 0;
  for (const field of req.fields) {
    if (deps.onlyKeys && !deps.onlyKeys.includes(field.key) && deps.previous?.fields[field.key]) {
      fields[field.key] = deps.previous.fields[field.key]!;
      continue;
    }
    const expected = req.verificationSet.expected[field.key] ?? {};
    const caps: Record<string, CaptureLike | null> = captures;

    let result: FieldVerification | null = null;
    const cached = deps.cachedPaths ? await deps.cachedPaths(field.concept) : [];
    if (cached.length > 0) {
      const r = await certify({ field, expected, captures: caps, candidates: cached }, { evalXPaths });
      if (r.certified.length > 0) result = r;
    }
    let candidates: CandidatePath[] = [];
    if (!result) {
      const gathered = await gatherCandidates(field, expected, caps, { runDomSearch });
      candidates = [...cached, ...gathered.candidates];
      result = await certify({ field, expected, captures: caps, candidates }, { evalXPaths });
    }
    if (result.certified.length === 0 && deps.agent) {
      const nearMisses = Object.fromEntries(Object.entries(result.cells).map(([u, c]) => [u, c.status === 'fail' ? c.nearMisses ?? [] : []]));
      const proposals = await proposeWithAi({ field, expected, captures: caps, nearMisses }, deps.agent);
      aiCalls++;
      result = await certify({ field, expected, captures: caps, candidates: [...candidates, ...proposals] }, { evalXPaths });
      result.aiCalled = true;
    }
    fields[field.key] = result;
  }

  const allPassed = req.fields.length > 0 && Object.values(fields).every((f) => f.certified.length > 0 && Object.values(f.cells).every((c) => c.status === 'pass'));
  return { outcome: { fields, allPassed, aiCalls }, captures, captureErrors };
}
```

`verify/index.ts` re-exports everything public from types, constants, normalize, transforms, certify (`rankCertified`, `CaptureLike`), dom-scripts (`buildXPathProbeScript`, `XPathProbeResult`), run-verification. Add `export * from './verify/index.js';` to `packages/scraper/src/index.ts`.

- [ ] **Step 4: Run** `pnpm --filter @robot/scraper exec vitest run src/verify` → PASS; `pnpm typecheck` green. **Commit** `feat(scraper): runVerification orchestrator + shop-example fixture triple`.

---

### Task 9: Domain cache — `verified` path source

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (`PathSource` :9, `SOURCE_AUTHORITY` :191, `isProtectedPath` :604, `FieldPath` :12), `packages/scraper/src/index.ts`
- Test: `packages/scraper/src/domain-cache-verified.test.ts` (real Postgres, hostname `test-verified.example`)

**Interfaces:**
- Produces:

```ts
// PathSource gains 'verified'; FieldPath gains `transform?: 'identity' | 'cents_to_units' | 'first_of_list'`.
export async function saveVerifiedPaths(domain: string, pageType: string, byConcept: Record<string, CertifiedPath[]>, url: string): Promise<void>;
export async function lookupVerifiedPaths(domain: string, pageType: string, concept: string): Promise<CertifiedPath[]>;
export async function recordVerifiedPathStats(domain: string, pageType: string, entries: Array<{ concept: string; path: CertifiedPath; hit: boolean; value?: unknown; url?: string }>): Promise<void>;
```

Rules: `SOURCE_AUTHORITY.verified = 90` (below `human` 100); `isProtectedPath` returns true for `source === 'verified'`; `saveVerifiedPaths` upserts the `domain_intelligence` row (create with empty defaults if absent) and merges by `(source, path, transform)` identity — existing verified entries keep their hit/miss counters; the whole read-modify-write runs under `db.transaction` with `.for('update')` exactly like `saveDomainCache`. `lookupVerifiedPaths` returns the concept's `verified` paths ordered by hit rate then `rankCertified`. `recordVerifiedPathStats` increments hits/misses and updates `lastValue`/`lastUrl` on a hit.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { and, eq } from 'drizzle-orm';
import { saveVerifiedPaths, lookupVerifiedPaths, recordVerifiedPathStats, lookupDomainCache, prunePaths, sourceAuthority } from './domain-cache.js';

const D = 'test-verified.example';
afterEach(async () => { await db.delete(domainIntelligence).where(eq(domainIntelligence.domain, D)); });

describe('verified paths in the domain cache', () => {
  it('saves under the concept with source verified, ranks human above and everything else below', async () => {
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }] }, 'https://x/1');
    const paths = await lookupVerifiedPaths(D, 'detail', 'price');
    expect(paths).toEqual([{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }]);
    const cache = await lookupDomainCache(D, 'detail');
    expect(cache!.fieldPaths.price!.paths[0]).toMatchObject({ source: 'verified', path: 'item.priceCents', transform: 'cents_to_units', hits: 0, misses: 0 });
    expect(sourceAuthority('verified')).toBeGreaterThan(sourceAuthority('json-ld'));
    expect(sourceAuthority('verified')).toBeLessThan(sourceAuthority('human'));
  });
  it('re-saving the same path keeps its counters; the prune never drops a verified path', async () => {
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'p', transform: 'identity' }] }, 'https://x/1');
    await recordVerifiedPathStats(D, 'detail', [{ concept: 'price', path: { source: 'api', path: 'p', transform: 'identity' }, hit: false }, { concept: 'price', path: { source: 'api', path: 'p', transform: 'identity' }, hit: false }]);
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'p', transform: 'identity' }] }, 'https://x/2');
    const cache = await lookupDomainCache(D, 'detail');
    const p = cache!.fieldPaths.price!.paths[0]!;
    expect(p.misses).toBe(2);
    expect(prunePaths([{ ...p, hits: 0, misses: 50 }])).toHaveLength(1);
  });
});
```

The verified path's `path` string in the cache is the certified path and its structured source is kept in a new optional `FieldPath.origin?: 'api' | 'json-ld' | 'meta' | 'xpath'` so `lookupVerifiedPaths` can rebuild a `CertifiedPath`. Add `origin` next to `transform` on `FieldPath`.

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** in `domain-cache.ts`:

```ts
export type PathSource = 'api' | 'api-ai' | 'json-ld' | 'meta' | 'xpath' | 'xpath-cached' | 'human' | 'ai-vision' | 'ai-discovered-variants' | 'verified';
// FieldPath: add
//   transform?: 'identity' | 'cents_to_units' | 'first_of_list';
//   origin?: 'api' | 'json-ld' | 'meta' | 'xpath';
// SOURCE_AUTHORITY: add 'verified': 90
// isProtectedPath: return p.pinned === true || p.source === 'human' || p.source === 'verified';

type VerifiedPathLite = { source: 'api' | 'json-ld' | 'meta' | 'xpath'; path: string; transform: 'identity' | 'cents_to_units' | 'first_of_list' };

function sameVerified(p: FieldPath, c: VerifiedPathLite): boolean {
  return p.source === 'verified' && p.origin === c.source && p.path === c.path && (p.transform ?? 'identity') === c.transform;
}

export async function saveVerifiedPaths(domain: string, pageType: string, byConcept: Record<string, VerifiedPathLite[]>, url: string): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(domainIntelligence)
      .where(and(eq(domainIntelligence.domain, domain), eq(domainIntelligence.pageType, pageType))).for('update');
    const fieldPaths = { ...((existing?.fieldPaths as Record<string, FieldPathSet> | null) ?? {}) };
    for (const [concept, paths] of Object.entries(byConcept)) {
      const set = fieldPaths[concept] ?? { paths: [], conflictCount: 0 };
      for (const c of paths) {
        const prior = set.paths.find((p) => sameVerified(p, c));
        if (prior) { prior.lastUsedAt = now; prior.lastUrl = url; continue; }
        set.paths.push({ path: c.path, source: 'verified', origin: c.source, transform: c.transform, confidence: 1, hits: 0, misses: 0, lastValue: null, lastUsedAt: now, lastUrl: url });
      }
      fieldPaths[concept] = set;
    }
    if (existing) {
      await tx.update(domainIntelligence).set({ fieldPaths, updatedAt: new Date() }).where(eq(domainIntelligence.id, existing.id));
    } else {
      await tx.insert(domainIntelligence).values({ domain, pageType, fieldPaths, apiEndpoints: [], popupSelectors: [], hasJsonLd: false, hasNextData: false, totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, successRate: 0 });
    }
  });
  console.log(`[cache] verified paths for ${domain}/${pageType}: ${Object.keys(byConcept).length} concept(s)`);
}

export async function lookupVerifiedPaths(domain: string, pageType: string, concept: string): Promise<VerifiedPathLite[]> {
  const cache = await lookupDomainCache(domain, pageType);
  const set = cache?.fieldPaths[concept];
  if (!set) return [];
  const rate = (p: FieldPath) => (p.hits + p.misses > 0 ? p.hits / (p.hits + p.misses) : 1);
  return set.paths
    .filter((p) => p.source === 'verified' && p.origin)
    .sort((a, b) => rate(b) - rate(a))
    .map((p) => ({ source: p.origin!, path: p.path, transform: p.transform ?? 'identity' }));
}

export async function recordVerifiedPathStats(domain: string, pageType: string, entries: Array<{ concept: string; path: VerifiedPathLite; hit: boolean; value?: unknown; url?: string }>): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(domainIntelligence)
      .where(and(eq(domainIntelligence.domain, domain), eq(domainIntelligence.pageType, pageType))).for('update');
    if (!existing) return;
    const fieldPaths = { ...((existing.fieldPaths as Record<string, FieldPathSet> | null) ?? {}) };
    for (const e of entries) {
      const p = fieldPaths[e.concept]?.paths.find((x) => sameVerified(x, e.path));
      if (!p) continue;
      if (e.hit) { p.hits++; p.lastValue = e.value ?? p.lastValue; if (e.url) p.lastUrl = e.url; } else { p.misses++; }
      p.lastUsedAt = now;
    }
    await tx.update(domainIntelligence).set({ fieldPaths, updatedAt: new Date() }).where(eq(domainIntelligence.id, existing.id));
  });
}
```

Check the `domainIntelligence` insert's required columns against `schema.ts:263-294` and fill any other `notNull` column without a default. Export the three functions from `index.ts`. Add `test-verified.example` to the hygiene query's `test-%` coverage (it already matches the `test-%` prefix).

- [ ] **Step 4: Run the test + full scraper suite; hygiene query 0 rows. Commit** `feat(scraper): verified path source in the domain cache`.

---

### Task 10: Concept derivation, `effectiveSchema` for a schema definition, export headers by display name

**Files:**
- Create: `packages/scraper/src/verify/derive-concept.ts`, test `derive-concept.test.ts`
- Modify: `packages/api/src/crawl/effective-schema.ts`, `packages/api/src/export/build-run-export.ts`, `packages/api/src/export/load-run-export.ts`
- Test: `packages/api/src/crawl/effective-schema.test.ts` (extend or create), `packages/api/src/export/build-run-export.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
// derive-concept.ts
export function deriveConcept(name: string, type: CustomerFieldType): string;   // 'Unit cost' + money → 'price'
export function deriveKey(name: string, taken: Set<string>): string;             // 'Unit cost' → 'unit_cost', 'unit_cost_2' if taken
export function customerTypeToFieldType(type: CustomerFieldType): string;        // money→'price', text→'string', image→'image_url', text_list→'array', else same
// effective-schema.ts
export type EffectiveSchemaField = OriginField & { displayName?: string };
export function effectiveSchema(source: { dataset?: { schema?: unknown } | null; selectorsJson?: unknown; schemaDefinition?: unknown }): EffectiveSchemaField[];
export function isCustomerSchema(source: { schemaDefinition?: unknown }): boolean;
// build-run-export.ts
export type RunExportInput = { …; source: { …; schemaDefinition?: unknown } | null; … };
```

- [ ] **Step 1: derive-concept tests + implementation**

```ts
// test
import { describe, it, expect } from 'vitest';
import { deriveConcept, deriveKey, customerTypeToFieldType } from './derive-concept.js';
describe('deriveConcept', () => {
  it('maps price-like names to price', () => {
    for (const n of ['Price', 'unit cost', 'Sale price', 'current_price']) expect(deriveConcept(n, 'money')).toBe('price');
  });
  it('maps name-like names to product_name', () => {
    for (const n of ['Title', 'Product name', 'name']) expect(deriveConcept(n, 'text')).toBe('product_name');
  });
  it('falls back to the slug', () => expect(deriveConcept('Warranty period', 'text')).toBe('warranty_period'));
  it('type steers: any money field with an unknown name is still a price concept', () => expect(deriveConcept('MSRP', 'money')).toBe('price'));
});
describe('deriveKey', () => {
  it('slugs and disambiguates', () => {
    const taken = new Set(['unit_cost']);
    expect(deriveKey('Unit cost', new Set())).toBe('unit_cost');
    expect(deriveKey('Unit cost', taken)).toBe('unit_cost_2');
    expect(deriveKey('  ', new Set())).toBe('field');
  });
});
describe('customerTypeToFieldType', () => {
  it('maps to the agent FieldType vocabulary', () => {
    expect(customerTypeToFieldType('money')).toBe('price');
    expect(customerTypeToFieldType('text_list')).toBe('array');
    expect(customerTypeToFieldType('image')).toBe('image_url');
    expect(customerTypeToFieldType('text')).toBe('string');
    expect(customerTypeToFieldType('date')).toBe('date');
  });
});
```

```ts
// derive-concept.ts
import type { CustomerFieldType } from './types.js';

const ALIASES: Array<{ concept: string; patterns: RegExp[] }> = [
  { concept: 'price', patterns: [/\bprice\b/, /\bcost\b/, /\bmsrp\b/, /\brrp\b/] },
  { concept: 'product_name', patterns: [/^(product[_ ]?)?name$/, /^title$/, /\bproduct[_ ]?title\b/] },
  { concept: 'description', patterns: [/\bdescription\b/, /\bsummary\b/] },
  { concept: 'image_url', patterns: [/\bimage\b/, /\bphoto\b/, /\bpicture\b/] },
  { concept: 'brand', patterns: [/\bbrand\b/, /\bmanufacturer\b/] },
  { concept: 'sku', patterns: [/\bsku\b/, /\bitem[_ ]?(number|no|id)\b/, /\bmodel[_ ]?(number|no)\b/, /\bmpn\b/] },
  { concept: 'availability', patterns: [/\bavailab/, /\bin[_ ]?stock\b/, /\bstock\b/] },
  { concept: 'rating', patterns: [/\brating\b/, /\bstars?\b/] },
  { concept: 'review_count', patterns: [/\breview[_ ]?count\b/, /\breviews\b/] },
  { concept: 'currency', patterns: [/\bcurrency\b/] },
];

export function slug(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function deriveConcept(name: string, type: CustomerFieldType): string {
  const n = name.toLowerCase().replace(/[_-]+/g, ' ').trim();
  for (const { concept, patterns } of ALIASES) if (patterns.some((p) => p.test(n))) return concept;
  if (type === 'money') return 'price';
  if (type === 'image') return 'image_url';
  return slug(name) || 'field';
}

export function deriveKey(name: string, taken: Set<string>): string {
  const base = slug(name) || 'field';
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function customerTypeToFieldType(type: CustomerFieldType): string {
  switch (type) {
    case 'money': return 'price';
    case 'text': return 'string';
    case 'image': return 'image_url';
    case 'text_list': return 'array';
    default: return type;
  }
}
```

Export from `verify/index.ts`.

- [ ] **Step 2: effectiveSchema** — add before the dataset branch:

```ts
export function isCustomerSchema(source: { schemaDefinition?: unknown }): boolean {
  return Array.isArray(source.schemaDefinition) && source.schemaDefinition.length > 0;
}
// inside effectiveSchema, first:
if (isCustomerSchema(source)) {
  return (source.schemaDefinition as SchemaDefinitionField[]).map((f) => ({
    name: f.key, type: customerTypeToFieldType(f.type), origin: 'detail' as const, displayName: f.name,
  }));
}
```

Test: a source with `schemaDefinition` returns keys as names with `displayName`, ignoring a non-empty dataset schema and `selectorsJson`.

Every caller that loads a Source for `effectiveSchema` selects explicit columns and must add `schemaDefinition: true`, or a customer Source silently falls back to the old branch: `packages/api/src/routers/crawl.ts` (`probeAndSample`'s `execSource`, `execute`'s `run.source` with-clause, the backfill procedure's source load), `packages/api/src/crawl/plan-source.ts` (its source load), `packages/api/src/crawl/load-run-coverage.ts`. Grep `selectorsJson: true` to find them all; each gets the sibling line.

- [ ] **Step 3: Export headers** — `load-run-export.ts` adds `schemaDefinition: true` to the source columns; `build-run-export.ts`:

```ts
function customerColumns(schemaDefinition: unknown): Array<{ key: string; name: string }> | null {
  if (!Array.isArray(schemaDefinition) || schemaDefinition.length === 0) return null;
  return schemaDefinition.filter((f) => f && typeof f.key === 'string' && typeof f.name === 'string').map((f) => ({ key: f.key, name: f.name }));
}
// in buildRunExport, before `fields:`:
const customer = customerColumns(input.source?.schemaDefinition);
const outRows = customer
  ? rows.map((r) => { const o: Record<string, unknown> = {}; for (const c of customer) o[c.name] = r[c.key] ?? null; for (const k of Object.keys(r)) if (k.startsWith('_')) o[k] = r[k]; return o; })
  : rows;
const fieldList = customer ? customer.map((c) => ({ name: c.name })) : schemaFields(input.source?.selectorsJson ?? null);
// then: fields: deriveColumns(fieldList, outRows), rows: outRows
```

Test: rows keyed by `price` export under header `Price`; `_url` survives; an undeclared key that is not `_`-prefixed is dropped for a customer schema.

- [ ] **Step 4: Run `pnpm --filter @robot/scraper test; pnpm --filter @robot/api test; pnpm typecheck`. Commit** `feat(api,scraper): concept derivation, customer schema in effectiveSchema and exports`.

---

### Task 11: API — create, update, and find product pages

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (add three procedures; extend `listByProject` select with `schemaDefinition`, `verificationSet`, `driftedFields`)
- Create: `packages/api/src/verify/schema-input.ts` (Zod schemas + normalization), `packages/api/src/verify/find-product-pages.ts`
- Test: `packages/api/src/routers/sources-schema.test.ts`, `packages/api/src/verify/find-product-pages.test.ts`

**Interfaces:**
- Produces:

```ts
// schema-input.ts
export const customerFieldInput = z.object({ key: z.string().optional(), name: z.string().trim().min(1).max(100), type: z.enum(CUSTOMER_FIELD_TYPES), description: z.string().trim().min(1).max(1000) });
export const schemaInput = z.object({
  urls: z.array(z.string().url()).length(VERIFY_URL_COUNT),
  listingUrl: z.string().url().optional(),
  fields: z.array(customerFieldInput).min(1).max(100),
  expected: z.record(z.string(), z.record(z.string(), z.string())), // fieldKey|name → url → value
});
/** Assigns keys/concepts, validates hostnames + expected values; throws TRPCError BAD_REQUEST with a per-cell problem list. */
export function prepareSchema(input: z.infer<typeof schemaInput>, existing?: SchemaDefinitionField[]): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet; hostname: string };
export function schemaProblems(input: z.infer<typeof schemaInput>): string[]; // [] when valid
// find-product-pages.ts
export function rankProductLinks(anchors: Array<{ href: string; text: string }>, listingUrl: string, limit: number): string[];
```

- `sources.createWithSchema(schemaInput)` → creates InputSet (`columns: [{name:'url', primary:true}]`, rows = the three URLs), Source (`listingMode: listingUrl ? 'listing_to_detail' : 'detail'`, `inputStrategy: 'direct'`, `urlTemplate: urls[0]`, budget as quickCreate, `schemaDefinition`, `verificationSet`) under Scratch, exactly as `quickCreate` does; returns `{ sourceId, projectSlug, sourceSlug }`. If `listingUrl` is given the InputSet rows are the listing URL instead (that is what a listing crawl plans from) and the three product URLs live only in `verificationSet`.
- `sources.updateSchema({ sourceId, ...schemaInput })` → refuses (`PRECONDITION_FAILED`) while a verification is in flight (`completed_at IS NULL`); preserves keys of existing fields matched by key, derives new ones; writes both columns and `updatedAt`.
- `sources.findProductPages({ listingUrl })` → captures the page with `withBrowserSession` (no AI), collects `a[href]` via `setContentEvaluate`, returns `{ urls: rankProductLinks(...) }`. Ranking: same hostname, not the listing itself, group by path template (digits and long tokens replaced by `*`), take the largest group, preserve document order, dedupe, cap `FIND_PRODUCT_PAGES_LIMIT`.

- [ ] **Step 1: Tests for `prepareSchema`/`schemaProblems` and `rankProductLinks`** (pure):

```ts
// sources-schema.test.ts (unit part)
import { prepareSchema, schemaProblems } from '../verify/schema-input.js';
const U = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
const base = { urls: U, fields: [{ name: 'Price', type: 'money' as const, description: 'green' }], expected: { Price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } };
it('assigns key and concept', () => {
  const r = prepareSchema(base);
  expect(r.fields[0]).toEqual({ key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' });
  expect(r.verificationSet.expected.price).toEqual(base.expected.Price);
  expect(r.hostname).toBe('shop.example');
});
it('rejects mixed hostnames, duplicate urls, blank or mistyped cells', () => {
  expect(schemaProblems({ ...base, urls: [U[0]!, U[1]!, 'https://other.example/p'] })).toContain('All URLs must be on the same website');
  expect(schemaProblems({ ...base, urls: [U[0]!, U[0]!, U[2]!] })).toContain('URLs must be different pages');
  expect(schemaProblems({ ...base, expected: { Price: { [U[0]!]: '', [U[1]!]: 'x', [U[2]!]: '3' } } })).toEqual(expect.arrayContaining([expect.stringContaining('Price @ https://shop.example/p/1: Expected value is required'), expect.stringContaining('Price @ https://shop.example/p/2: Not a money amount')]));
});
it('keeps existing keys on update when the name matches by key', () => {
  const existing = [{ key: 'price', name: 'Old', type: 'money' as const, description: 'd', concept: 'price' }];
  const r = prepareSchema({ ...base, fields: [{ key: 'price', name: 'Unit cost', type: 'money', description: 'green' }], expected: { price: base.expected.Price! } }, existing);
  expect(r.fields[0]!.key).toBe('price');
  expect(r.fields[0]!.name).toBe('Unit cost');
});
```

```ts
// find-product-pages.test.ts
import { rankProductLinks } from './find-product-pages.js';
it('returns the largest same-host path cluster in document order, capped', () => {
  const anchors = [
    { href: '/', text: 'Home' }, { href: '/c/shoes', text: 'Shoes' },
    { href: '/p/air-1-12345', text: 'Air 1' }, { href: '/p/air-2-12346', text: 'Air 2' }, { href: '/p/air-3-12347', text: 'Air 3' },
    { href: 'https://cdn.other/x', text: '' }, { href: '/p/air-1-12345', text: 'dup' }, { href: '/help/returns', text: 'Returns' },
  ];
  expect(rankProductLinks(anchors, 'https://shop.example/c/shoes', 2)).toEqual(['https://shop.example/p/air-1-12345', 'https://shop.example/p/air-2-12346']);
});
```

- [ ] **Step 2: Implement `schema-input.ts`**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { CUSTOMER_FIELD_TYPES, VERIFY_URL_COUNT, deriveConcept, deriveKey, normalize, validateExpected, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';

export const customerFieldInput = z.object({
  key: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  type: z.enum(CUSTOMER_FIELD_TYPES),
  description: z.string().trim().min(1).max(1000),
});
export const schemaInput = z.object({
  urls: z.array(z.string().url()).length(VERIFY_URL_COUNT),
  listingUrl: z.string().url().optional(),
  fields: z.array(customerFieldInput).min(1).max(100),
  expected: z.record(z.string(), z.record(z.string(), z.string())),
});
export type SchemaInput = z.infer<typeof schemaInput>;

const host = (u: string) => new URL(u).hostname.toLowerCase();

export function schemaProblems(input: SchemaInput): string[] {
  const problems: string[] = [];
  const hosts = new Set(input.urls.map(host));
  if (input.listingUrl) hosts.add(host(input.listingUrl));
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  const canonical = new Set(input.urls.map((u) => normalize('url', u)));
  if (canonical.size !== input.urls.length) problems.push('URLs must be different pages');
  const names = new Set<string>();
  for (const f of input.fields) {
    const lower = f.name.toLowerCase();
    if (names.has(lower)) problems.push(`Duplicate field name: ${f.name}`);
    names.add(lower);
    const cells = input.expected[f.key ?? ''] ?? input.expected[f.name] ?? {};
    for (const url of input.urls) {
      const err = validateExpected(f.type, cells[url] ?? '');
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    }
  }
  return problems;
}

export function prepareSchema(input: SchemaInput, existing: SchemaDefinitionField[] = []): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet; hostname: string } {
  const problems = schemaProblems(input);
  if (problems.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join('\n') });
  const byKey = new Map(existing.map((f) => [f.key, f]));
  const taken = new Set<string>();
  const fields: SchemaDefinitionField[] = [];
  const expected: VerificationSet['expected'] = {};
  for (const f of input.fields) {
    const prior = f.key ? byKey.get(f.key) : undefined;
    const key = prior ? prior.key : deriveKey(f.name, taken);
    taken.add(key);
    fields.push({ key, name: f.name, type: f.type, description: f.description, concept: prior?.concept ?? deriveConcept(f.name, f.type) });
    const cells = input.expected[f.key ?? ''] ?? input.expected[f.name] ?? {};
    expected[key] = Object.fromEntries(input.urls.map((u) => [u, cells[u] ?? '']));
  }
  return { fields, verificationSet: { urls: input.urls, expected, ...(input.listingUrl ? { listing_url: input.listingUrl } : {}) }, hostname: host(input.urls[0]!) };
}
```

`CUSTOMER_FIELD_TYPES` must be exported as a tuple (`as const`) for `z.enum`.

- [ ] **Step 3: Implement the procedures** following the `confirm` pattern, and `find-product-pages.ts`:

```ts
export function rankProductLinks(anchors: Array<{ href: string; text: string }>, listingUrl: string, limit: number): string[] {
  const base = new URL(listingUrl);
  const template = (p: string) => p.replace(/\d+/g, '*').replace(/[a-z0-9-]{12,}/gi, '*');
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const a of anchors) {
    let u: URL;
    try { u = new URL(a.href, listingUrl); } catch { continue; }
    if (u.hostname !== base.hostname || (u.protocol !== 'http:' && u.protocol !== 'https:')) continue;
    u.hash = '';
    if (u.href === base.href || u.pathname === '/') continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    const key = template(u.pathname);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(u.href);
  }
  let best: string[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best.slice(0, limit);
}
```

The procedure: `withBrowserSession(async (browser) => { const capture = await browser.capture(listingUrl, { waitUntil: 'networkidle', interceptNetworkRequests: false }); return browser.setContentEvaluate<Array<{href:string;text:string}>>(capture.html, `(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim().slice(0, 80) })))()`); })` then `rankProductLinks(anchors, listingUrl, FIND_PRODUCT_PAGES_LIMIT)`.

- [ ] **Step 4: Integration test** (real Postgres, throwaway project pattern; `withBrowserSession` mocked with `vi.mock('../browser-session.js', …)` returning a fake browser whose `capture` returns a small HTML and whose `setContentEvaluate` returns anchors): `createWithSchema` persists `schemaDefinition` + `verificationSet` and lands in Scratch; `updateSchema` keeps keys and refuses during an in-flight verification (insert a `source_verifications` row with `completedAt: null`); `findProductPages` returns the ranked list.

- [ ] **Step 5: Run; commit** `feat(api): createWithSchema, updateSchema, findProductPages`.

---

### Task 12: API — `sources.verify` (fire-and-forget), status, and current certification

**Files:**
- Create: `packages/api/src/verify/run-source-verification.ts`, `packages/api/src/verify/current-certification.ts`
- Modify: `packages/api/src/routers/sources.ts` (add `verify`, `verificationStatus`, `verifyEstimate`)
- Test: `packages/api/src/verify/run-source-verification.test.ts` (`runVerification` mocked), `packages/api/src/verify/current-certification.test.ts`, `packages/api/src/routers/sources-verify.test.ts`

**Interfaces:**
- Produces:

```ts
// current-certification.ts
export type Certification = { verificationId: string; completedAt: Date; paths: Record<string /*field key*/, CertifiedPath[]>; concepts: Record<string, string> };
/** The latest completed, all-passed verification whose hash matches the Source's current definition; null otherwise. */
export function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null>;
export function sourceDefinitionHash(source: { schemaDefinition: unknown; verificationSet: unknown }): string | null;
// run-source-verification.ts
export function runSourceVerification(sourceId: string, verificationId: string, opts?: { onlyKeys?: string[] }): Promise<void>;
```

- `sources.verifyEstimate({ sourceId })` → `{ fields: number; upperBoundUsd: number; aiAvailable: boolean }` where `upperBoundUsd = fields × EST_AI_COST_PER_FIELD_USD` and `aiAvailable = !!process.env.ANTHROPIC_API_KEY`.
- `sources.verify({ sourceId, onlyKeys?: string[] })` → guards: Source exists, has a schema definition; an in-flight verification (`completed_at IS NULL`) younger than `VERIFY_STALL_MS` is returned as-is (`status: 'in-progress'`, nothing started); an in-flight one **older** than `VERIFY_STALL_MS` is a crash leftover (spec §7 "mid-verify crash") — it is closed first (`errorMessage: 'stalled'`, `completedAt: now`) and a fresh one starts, so a dead api-server process can never wedge a Source (the D2 lesson). Inserts the `source_verifications` row (`definitionHash` = current), then `void runSourceVerification(...).catch(log)`; returns `{ verificationId, status: 'started' | 'in-progress' }`.
- `sources.verificationStatus({ sourceId })` → latest row (`orderBy startedAt desc`) or null: `{ id, startedAt, completedAt, allPassed, results, captures, aiCalls, costUsd, errorMessage, current: boolean }` where `current` means hash matches the Source.
- `runSourceVerification`: loads Source; reuses captures from the previous verification when younger than `CAPTURE_REUSE_MAX_AGE_MS` **only** for a re-verify (`onlyKeys`) — re-capture needs the HTML, so store per-URL captures as files next to screenshots: write `capture.html`, `structuredData`, `interceptedRequests` (JSON-bearing only) as `${getCapturesDir()}/${captureId}.capture.json`, and load them back for reuse; inserts a `captures` row per URL with `screenshotPath`, `html`; persists screenshots with the same `persistScreenshot` code as `routers/scraper.ts:57-63` (extract that into `packages/api/src/persist-screenshot.ts` and reuse it in both places); snapshots usage before/after (`snapshotUsage`/`diffUsage`/`estimateCostUsd` from `@robot/agent`); on success writes `results`, `captures`, `allPassed`, `aiCalls`, `costUsd`, `completedAt`; on `allPassed` calls `saveVerifiedPaths(hostname, 'detail', byConcept, urls[0])` and clears `sources.driftedFields`; on throw writes `errorMessage` + `completedAt` (terminal, never stuck). Agent: `new SchemaAgent()` when `ANTHROPIC_API_KEY` is set, else `null`. Cached paths: `lookupVerifiedPaths(hostname, 'detail', concept)`. Browser via `withBrowserSession`.

- [ ] **Step 1: Tests**

`current-certification.test.ts` (Postgres): a source with a matching all-passed completed verification → certification with the field's paths; a later `updateSchema`-style hash change → null; a not-all-passed row → null; an in-flight row is ignored.

`run-source-verification.test.ts`: mock `@robot/scraper`'s `runVerification` (returns a canned `VerificationRun` with a `PageCapture` whose `screenshot` is `Buffer.from('x')`), mock `../browser-session.js`, mock `@robot/scraper` `saveVerifiedPaths`; assert the row reaches `completedAt` with `allPassed`, `results`, `captures[url].captureId` pointing at a real `captures` row with `screenshotPath`, and that `saveVerifiedPaths` was called with `{ price: [...] }` keyed by concept; a throwing `runVerification` writes `errorMessage` and `completedAt`.

`sources-verify.test.ts`: `verify` refuses a Source without a schema (`PRECONDITION_FAILED`); second call while in flight returns the same id with `status: 'in-progress'` and does not start again (mock `runSourceVerification`); an in-flight row whose `startedAt` is older than `VERIFY_STALL_MS` is closed with `errorMessage: 'stalled'` and a NEW verification starts (`status: 'started'`, different id); `verificationStatus` returns `current: false` after the hash changes; `verifyEstimate` returns `fields × 0.05` and `aiAvailable: false` in tests.

- [ ] **Step 2: Implement.** `current-certification.ts`:

```ts
export function sourceDefinitionHash(source: { schemaDefinition: unknown; verificationSet: unknown }): string | null {
  if (!Array.isArray(source.schemaDefinition) || !source.verificationSet) return null;
  return definitionHash(source.schemaDefinition as SchemaDefinitionField[], source.verificationSet as VerificationSet);
}

export async function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const hash = source ? sourceDefinitionHash(source) : null;
  if (!hash) return null;
  const row = await db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), eq(sourceVerifications.definitionHash, hash), eq(sourceVerifications.allPassed, true), isNotNull(sourceVerifications.completedAt)),
    orderBy: [desc(sourceVerifications.completedAt)],
  });
  if (!row) return null;
  const results = row.results as Record<string, FieldVerification>;
  const fields = source!.schemaDefinition as SchemaDefinitionField[];
  return {
    verificationId: row.id,
    completedAt: row.completedAt!,
    paths: Object.fromEntries(fields.map((f) => [f.key, results[f.key]?.certified ?? []])),
    concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
  };
}
```

`run-source-verification.ts` follows `startExecution`'s try/catch-everything shape:

```ts
import { eq } from 'drizzle-orm';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageCapture } from '@robot/browser';
import { SchemaAgent, snapshotUsage, diffUsage, estimateCostUsd } from '@robot/agent';
import { runVerification, saveVerifiedPaths, lookupVerifiedPaths, CAPTURE_REUSE_MAX_AGE_MS, type SchemaDefinitionField, type VerificationSet, type VerificationOutcome, type CertifiedPath } from '@robot/scraper';
import { db, sources, sourceVerifications, captures } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { persistScreenshot, getCapturesDir } from '../persist-screenshot.js';
import { safeErrorMessage } from '../crawl/plan-source.js';

type StoredCaptureRef = { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string };

async function storeCapture(sourceId: string, url: string, c: PageCapture): Promise<StoredCaptureRef> {
  const shot = c.screenshot.length > 0 ? await persistScreenshot(c.screenshot) : null;
  const [row] = await db.insert(captures).values({ sourceId, url, html: c.html, screenshotPath: shot?.url ?? null, metadata: { kind: 'verification' } }).returning({ id: captures.id });
  await mkdir(getCapturesDir(), { recursive: true });
  await writeFile(join(getCapturesDir(), `${row!.id}.capture.json`), JSON.stringify({
    url: c.url, html: c.html, structuredData: c.structuredData,
    interceptedRequests: c.interceptedRequests.filter((r) => r.isJson && r.parsedJson !== null),
  }));
  return { captureId: row!.id, capturedAt: new Date().toISOString(), ...(shot ? { screenshotUrl: shot.url } : {}) };
}

/** Null on any problem: a missing or unreadable file just means "capture again". */
async function loadStoredCapture(ref: StoredCaptureRef): Promise<PageCapture | null> {
  if (Date.now() - Date.parse(ref.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) return null;
  try {
    const raw = JSON.parse(await readFile(join(getCapturesDir(), `${ref.captureId}.capture.json`), 'utf-8'));
    return { ...raw, markdown: '', title: '', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [] } as PageCapture;
  } catch { return null; }
}

export async function runSourceVerification(sourceId: string, verificationId: string, opts: { onlyKeys?: string[] } = {}): Promise<void> {
  try {
    const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { id: true, schemaDefinition: true, verificationSet: true } });
    if (!source) throw new Error(`Source ${sourceId} not found`);
    const fields = source.schemaDefinition as SchemaDefinitionField[];
    const set = source.verificationSet as VerificationSet;
    const hostname = new URL(set.urls[0]!).hostname;

    // Re-verify only: reuse the previous completed run's captures when young
    // enough. The row being filled in is the newest, so look past it.
    const reuse: Record<string, PageCapture> = {};
    const reusedRefs = new Map<string, StoredCaptureRef>();
    let previous: VerificationOutcome | undefined;
    if (opts.onlyKeys) {
      const rows = await db.query.sourceVerifications.findMany({
        where: eq(sourceVerifications.sourceId, sourceId),
        orderBy: (t, { desc }) => [desc(t.startedAt)],
        limit: 3,
      });
      const last = rows.find((r) => r.id !== verificationId && r.completedAt !== null);
      if (last) {
        previous = { fields: last.results as VerificationOutcome['fields'], allPassed: last.allPassed, aiCalls: last.aiCalls };
        for (const [url, ref] of Object.entries(last.captures as Record<string, StoredCaptureRef>)) {
          if (!ref.captureId) continue;
          const c = await loadStoredCapture(ref);
          if (c) { reuse[url] = c; reusedRefs.set(url, ref); }
        }
      }
    }

    const before = snapshotUsage();
    const agent = process.env.ANTHROPIC_API_KEY ? new SchemaAgent() : null;
    const run = await withBrowserSession((browser) => runVerification({ fields, verificationSet: set }, {
      browser, agent, captures: reuse, onlyKeys: opts.onlyKeys, previous,
      cachedPaths: (concept) => lookupVerifiedPaths(hostname, 'detail', concept),
    }));
    const cost = estimateCostUsd(diffUsage(before, snapshotUsage())).usd;

    const captureRefs: Record<string, StoredCaptureRef> = {};
    for (const url of set.urls) {
      const c = run.captures[url];
      const reused = reusedRefs.get(url);
      if (c && reused) captureRefs[url] = reused;                       // no new captures row for a reused page
      else if (c) captureRefs[url] = await storeCapture(sourceId, url, c);
      else captureRefs[url] = { captureId: '', capturedAt: new Date().toISOString(), blockedReason: run.captureErrors[url] ?? 'not captured' };
    }

    await db.update(sourceVerifications).set({
      results: run.outcome.fields, captures: captureRefs, allPassed: run.outcome.allPassed,
      aiCalls: run.outcome.aiCalls, costUsd: cost.toFixed(4), completedAt: new Date(),
    }).where(eq(sourceVerifications.id, verificationId));

    if (run.outcome.allPassed) {
      const byConcept: Record<string, CertifiedPath[]> = {};
      for (const f of fields) (byConcept[f.concept] ??= []).push(...run.outcome.fields[f.key]!.certified);
      await saveVerifiedPaths(hostname, 'detail', byConcept, set.urls[0]!);
      await db.update(sources).set({ driftedFields: null, updatedAt: new Date() }).where(eq(sources.id, sourceId));
    }
  } catch (err) {
    console.error(`[verify] verification ${verificationId} failed:`, err);
    try {
      await db.update(sourceVerifications).set({ errorMessage: safeErrorMessage(err).slice(0, 1000), completedAt: new Date() }).where(eq(sourceVerifications.id, verificationId));
    } catch (recoveryErr) {
      console.error(`[verify] failed to record failure for ${verificationId}:`, recoveryErr);
    }
  }
}
```

Progress for the dashboard (spec §2.3 "capturing 1/3 … searching … asking AI"): `runVerification` gets an optional `onProgress?: (stage: string) => void` dep (called with `capturing 1/3`, `capturing 2/3`, `capturing 3/3`, `searching`, `asking AI for <key>`); `runSourceVerification` writes each stage into `sourceVerifications.captures` under a reserved `_stage` key — no new column, and `verificationStatus` surfaces it as `stage`.

`persist-screenshot.ts` is the extraction of `routers/scraper.ts:26-29` + `:57-63`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export function getCapturesDir(): string { return process.env.CAPTURES_DIR ?? join(process.cwd(), 'public', 'captures'); }
export async function persistScreenshot(screenshot: Buffer): Promise<{ id: string; url: string }> {
  const id = randomUUID();
  const dir = getCapturesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.png`), screenshot);
  return { id, url: `/captures/${id}.png` };
}
```

and `routers/scraper.ts` switches to calling it.

- [ ] **Step 3: Run all api tests; typecheck; commit** `feat(api): sources.verify with polling status and current certification`.

---

### Task 13: Certified extraction at scale, drift, and gating

**Files:**
- Create: `packages/scraper/src/verify/verified-extraction.ts` (+ test, real Chromium against `shop-example/p1`)
- Modify: `packages/api/src/crawl/extract-item.ts`, `packages/api/src/crawl/start-execution.ts`, `packages/api/src/routers/crawl.ts` (`plan`, `probeAndSample`, `execute`), `packages/api/src/routers/sources.ts` (`confirm`)
- Create: `packages/api/src/crawl/drift.ts` (+ test), `packages/api/src/crawl/require-certification.ts` (+ test)

**Interfaces:**
- Produces:

```ts
// verified-extraction.ts
export type VerifiedField = { key: string; type: CustomerFieldType; concept: string; paths: CertifiedPath[] };
export type VerifiedExtractionResult = { data: Record<string, unknown>; stats: Array<{ key: string; concept: string; path: CertifiedPath; hit: boolean; value?: unknown }> };
export function runVerifiedExtraction(req: { url: string; fields: VerifiedField[] }, deps: { browser: IBrowser; capture?: PageCapture }): Promise<VerifiedExtractionResult>;
// extract-item.ts: ExtractItemDeps gains `certification?: Certification | null` and `extractVerified?: typeof runVerifiedExtraction`
// drift.ts
export function driftedKeys(rows: Array<Record<string, unknown>>, keys: string[]): string[]; // pure
export function flagDrift(db: Database, runId: string, sourceId: string, keys: string[]): Promise<string[]>;
// require-certification.ts
export function requireCertification(db: Database, sourceId: string): Promise<Certification | null>; // throws PRECONDITION_FAILED for a customer-schema Source without one; null for a legacy Source
```

Behaviour: `runVerifiedExtraction` captures (or reuses), evaluates every field's paths in order — structured via `resolveStructured`, xpath via one `buildXPathProbeScript` batch per page — applies the transform, takes the first value whose `normalize(type, …)` is non-null, writes `renderValue(type, normalized)` into `data[key]`; a field with no producing path gets `data[key] = null`. `stats` records a miss for every path tried before the hit and a hit for the producing one. `extract-item` with `deps.certification` builds `VerifiedField[]` from the certification and `effectiveSchema` (type from `schemaDefinition`), calls `runVerifiedExtraction`, then `recordVerifiedPathStats(hostname, 'detail', stats)`; the row still goes through `mergeRow` with `detailRow = data`. `startExecution` loads `loadCurrentCertification(db, sourceId)` once and threads it into `extractItem`; after `finaliseRun`, for a certified Source it calls `flagDrift`. `driftedKeys`: with fewer than `DRIFT_MIN_ROWS` rows returns `[]`; otherwise keys whose null/'' share ≥ `DRIFT_MISS_SHARE`. `flagDrift` reads the run's `extractions.data` rows, writes `runs.driftedFields` and `sources.driftedFields`. Gating: `crawl.plan` (non-probe), `crawl.probeAndSample`, `crawl.execute`, and `sources.confirm` call `requireCertification` first; the error message is `Verify the schema before extracting`.

- [ ] **Step 1: Tests**

`verified-extraction.test.ts`: against `loadVerifyFixture('shop-example','p1')` with the certified paths from Task 8's first test (hard-code them): `data` equals `{ price: 129.99, product_name: 'Widget A', in_stock: true, image: 'https://shop.example/img/a.jpg' }` for those four fields; a field whose only path is `//*[@id="nope"]` yields `null` and a miss stat; a field whose first path misses and second hits records one miss then one hit.

`drift.test.ts`: `driftedKeys` returns `[]` under 5 rows; with 10 rows where `price` is null in 3 → `['price']`; `flagDrift` (Postgres, throwaway source + run + extractions) writes both columns.

`require-certification.test.ts`: legacy Source (no `schemaDefinition`) → null; customer Source without certification → throws `PRECONDITION_FAILED`; with a current certification → returns it.

`extract-item.test.ts` (extend existing if present, else create): with `certification` set and `extractVerified` stubbed, the stub is called with the field's paths and `runExtraction` is never called; without certification the old path is used.

- [ ] **Step 2: Implement**

`verified-extraction.ts`:

```ts
import type { IBrowser, PageCapture } from '@robot/browser';
import { normalize, renderValue } from './normalize.js';
import { applyTransform } from './transforms.js';
import { resolveStructured } from './search-structured.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';
import type { CertifiedPath, CustomerFieldType } from './types.js';

export type VerifiedField = { key: string; type: CustomerFieldType; concept: string; paths: CertifiedPath[] };
export type VerifiedExtractionResult = {
  data: Record<string, unknown>;
  stats: Array<{ key: string; concept: string; path: CertifiedPath; hit: boolean; value?: unknown }>;
};

export async function runVerifiedExtraction(
  req: { url: string; fields: VerifiedField[] },
  deps: { browser: IBrowser; capture?: PageCapture },
): Promise<VerifiedExtractionResult> {
  const capture = deps.capture ?? await deps.browser.capture(req.url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
  const xpaths = [...new Set(req.fields.flatMap((f) => f.paths.filter((p) => p.source === 'xpath').map((p) => p.path)))];
  const probe: XPathProbeResult = xpaths.length ? await deps.browser.setContentEvaluate<XPathProbeResult>(capture.html, buildXPathProbeScript(xpaths)) : {};
  const ctx = { pageUrl: capture.url };
  const data: Record<string, unknown> = {};
  const stats: VerifiedExtractionResult['stats'] = [];
  for (const f of req.fields) {
    data[f.key] = null;
    for (const p of f.paths) {
      const rawBase = p.source === 'xpath' ? probe[p.path] ?? null : resolveStructured(capture, p.source, p.path);
      const raw = applyTransform(rawBase, p.transform);
      const norm = raw === null || raw === undefined || raw === '' ? null : normalize(f.type, raw, ctx);
      if (norm === null) { stats.push({ key: f.key, concept: f.concept, path: p, hit: false }); continue; }
      const value = f.type === 'text' ? String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim() : renderValue(f.type, norm);
      data[f.key] = value;
      stats.push({ key: f.key, concept: f.concept, path: p, hit: true, value });
      break;
    }
  }
  return { data, stats };
}
```

`extract-item.ts` — `ExtractItemDeps` gains `certification?: Certification | null; extractVerified?: typeof runVerifiedExtraction; recordStats?: typeof recordVerifiedPathStats;`. At the top of `extractItem`, before `partitionSchemaByOrigin`:

```ts
  if (deps.certification) {
    const extractVerified = deps.extractVerified ?? runVerifiedExtraction;
    const recordStats = deps.recordStats ?? recordVerifiedPathStats;
    const types = new Map((deps.schemaDefinition ?? []).map((f) => [f.key, f.type]));
    const fields = schema
      .filter((f) => (f.origin ?? 'detail') === 'detail')
      .map((f) => ({ key: f.name, type: types.get(f.name) ?? 'text', concept: deps.certification!.concepts[f.name] ?? f.name, paths: deps.certification!.paths[f.name] ?? [] }));
    const verified = await extractVerified({ url: item.url, fields }, { browser: deps.browser });
    const hostname = new URL(item.url).hostname;
    await recordStats(hostname, 'detail', verified.stats.map((s) => ({ concept: s.concept, path: s.path, hit: s.hit, value: s.value, url: item.url })));
    const row = mergeRow({ inputFields: partitions.input, inputValues: item.inputValues, listingValues: item.listingValues, detailRow: verified.data, url: item.url, pageNumber: item.pageNumber });
    const hits = fields.filter((f) => verified.data[f.key] !== null).length;
    const confidence = fields.length ? Math.round((100 * hits) / fields.length) : 0; // "share of fields a proven path produced"
    // …then the same `captures` + `extractions` inserts as the legacy path below (extract them into a local
    // `persistRow(row, confidence)` helper so both branches share one implementation), and return
    // { row, extractionId, targetFields: item.targetFields }.
  }
```

(`ExtractItemDeps` also gains `schemaDefinition?: SchemaDefinitionField[]`, threaded from `startExecution`, which loads the Source's `schemaDefinition` alongside the certification. `partitions` is computed before the branch since both paths need `partitions.input`.)

`start-execution.ts`: after `const agent = new SchemaAgent();` add

```ts
      const certification = await loadCurrentCertification(db, sourceId);
      const sourceRow = certification ? await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } }) : null;
      const schemaDefinition = (sourceRow?.schemaDefinition as SchemaDefinitionField[] | null) ?? undefined;
```

thread `certification, schemaDefinition` into `extractItem`'s deps, and change `finalise` to

```ts
        finalise: async (_rowCount, cancelled, limitReached) => {
          const status = await finaliseRun(db, runId, cancelled, limitReached);
          if (certification && status !== 'extracting') await flagDrift(db, runId, sourceId, Object.keys(certification.paths));
          return status;
        },
```

`drift.ts`:

```ts
import { eq } from 'drizzle-orm';
import { DRIFT_MIN_ROWS, DRIFT_MISS_SHARE } from '@robot/scraper';
import { extractions, runs, sources } from '@robot/db';
import type { Database } from '@robot/db';

export function driftedKeys(rows: Array<Record<string, unknown>>, keys: string[]): string[] {
  if (rows.length < DRIFT_MIN_ROWS) return [];
  return keys.filter((k) => rows.filter((r) => r[k] === null || r[k] === undefined || r[k] === '').length / rows.length >= DRIFT_MISS_SHARE);
}

export async function flagDrift(db: Database, runId: string, sourceId: string, keys: string[]): Promise<string[]> {
  const found = await db.query.extractions.findMany({ where: eq(extractions.runId, runId), columns: { data: true } });
  const rows = found.flatMap((e) => (Array.isArray(e.data) ? (e.data as Array<Record<string, unknown>>) : []));
  const drifted = driftedKeys(rows, keys);
  await db.update(runs).set({ driftedFields: drifted }).where(eq(runs.id, runId));
  await db.update(sources).set({ driftedFields: drifted.length ? drifted : null, updatedAt: new Date() }).where(eq(sources.id, sourceId));
  return drifted;
}
```

`require-certification.ts`:

```ts
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { sources } from '@robot/db';
import type { Database } from '@robot/db';
import { isCustomerSchema } from './effective-schema.js';
import { loadCurrentCertification, type Certification } from '../verify/current-certification.js';

export async function requireCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } });
  if (!source || !isCustomerSchema(source)) return null;
  const cert = await loadCurrentCertification(db, sourceId);
  if (!cert) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify the schema before extracting' });
  return cert;
}
```

Call it as the first statement of `crawl.plan` (when `!input.probe`), `crawl.probeAndSample`, `crawl.execute`, and `sources.confirm`.

- [ ] **Step 3: Run `pnpm -r test`, typecheck, hygiene; commit** `feat: certified-only extraction at scale, drift flagging, and the certification gate`.

---

### Task 14: Dashboard — grid logic, CSV/XLSX import, and the grid component

**Files:**
- Create: `packages/dashboard/src/lib/schema-grid.ts` (+ `schema-grid.test.ts`), `packages/dashboard/src/lib/csv.ts` (+ `csv.test.ts`), `packages/dashboard/src/components/schema-grid.tsx`, `packages/dashboard/src/components/schema-import.tsx`
- Modify: `packages/dashboard/package.json` (add `read-excel-file` ^5)

**Interfaces:**
- Produces (schema-grid.ts, pure):

```ts
export const FIELD_TYPES = ['text','number','money','boolean','date','url','image','text_list'] as const;
export type GridFieldType = (typeof FIELD_TYPES)[number];
export type GridRow = { id: string; key?: string; name: string; type: GridFieldType; description: string; expected: string[] }; // expected[i] ↔ urls[i]
export type GridState = { urls: string[]; listingUrl: string; rows: GridRow[] };
export function emptyState(): GridState;            // 3 empty urls, one empty row
export function emptyRow(): GridRow;
export function validateExpectedClient(type: GridFieldType, text: string): string | null; // mirrors @robot/scraper validateExpected (server is authoritative)
export function parseBlock(text: string): string[][];   // TSV/newline block from the clipboard
export function applyPaste(state: GridState, at: { row: number; col: number }, block: string[][]): GridState; // col 0=name,1=type,2=description,3..=expected[i]
export function rowsFromTable(table: string[][], urlCount: number): { rows: GridRow[]; problems: string[] }; // header row: name,type,description,url1..url3 (case-insensitive; 'expected 1' also accepted)
export function gridProblems(state: GridState): string[];  // same wording as the server's schemaProblems
export function isComplete(state: GridState): boolean;
export function shortUrl(url: string): string;             // path only, middle-truncated to 28 chars
export function toSchemaInput(state: GridState): { urls: string[]; listingUrl?: string; fields: Array<{ key?: string; name: string; type: GridFieldType; description: string }>; expected: Record<string, Record<string, string>> };
export function fromSource(source: { schemaDefinition: unknown; verificationSet: unknown }): GridState | null;
// csv.ts
export function parseCsv(text: string): string[][]; // RFC 4180: quotes, escaped quotes, CRLF
```

Component `SchemaGrid({ state, onChange, cellStatus?, disabled })` where `cellStatus?: (rowId: string, urlIndex: number) => { status: 'pass'|'fail'|'not_captured'|'stale'; found?: string; reason?: string; hint?: string; weak?: boolean } | null`. Keyboard: Tab/Shift-Tab, arrows, Enter move focus (inputs registered in a `Map<'r,c', HTMLInputElement>`); `onPaste` on any cell calls `applyPaste`; type cells are `<select>`; a per-row delete button; "Add row" at the bottom. `SchemaImport({ urlCount, onRows })` renders a file input accepting `.csv,.xlsx`, parses CSV with `parseCsv` and XLSX with `read-excel-file` (`readXlsxFile(file)` → `string[][]` via `String`), then `rowsFromTable`, shows problems inline.

- [ ] **Step 1: Pure tests** covering: `parseBlock` splits tabs and newlines and trims a trailing newline; `applyPaste` expands rows and never writes past the last expected column; `rowsFromTable` maps headers case-insensitively and reports a missing header; `gridProblems` wording matches Task 11 (`'All URLs must be on the same website'`, `'URLs must be different pages'`, `'<name> @ <url>: Expected value is required'`); `shortUrl('https://shop.example/p/very/long/path/that/goes/on')` is `/p/very/…/goes/on`-style within 28 chars; `toSchemaInput` keys `expected` by `key` when present else `name`; `fromSource` round-trips a stored definition; `parseCsv` handles `"a,b","c""d"\r\n1,2`.

- [ ] **Step 2: Implement the pure libs**

`csv.ts`:

```ts
/** Minimal RFC 4180: quoted fields, doubled quotes, CRLF or LF rows. Trailing empty row dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
```

`schema-grid.ts` (the client-side validator mirrors `@robot/scraper`'s `validateExpected` rules; the server is authoritative and its `BAD_REQUEST` message is shown verbatim when they disagree):

```ts
export const FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type GridFieldType = (typeof FIELD_TYPES)[number];
export type GridRow = { id: string; key?: string; name: string; type: GridFieldType; description: string; expected: string[] };
export type GridState = { urls: string[]; listingUrl: string; rows: GridRow[] };
export const URL_COUNT = 3;
const FIXED_COLS = 3; // name, type, description

let seq = 0;
export function emptyRow(): GridRow { return { id: `r${Date.now().toString(36)}${(seq++).toString(36)}`, name: '', type: 'text', description: '', expected: Array(URL_COUNT).fill('') }; }
export function emptyState(): GridState { return { urls: Array(URL_COUNT).fill(''), listingUrl: '', rows: [emptyRow()] }; }

const TRUE = ['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock'];
const FALSE = ['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out'];
const LABEL: Record<GridFieldType, string> = { text: 'text', number: 'a number', money: 'a money amount', boolean: 'yes/no (or in stock/out of stock)', date: 'a date', url: 'a URL', image: 'an image URL', text_list: 'a comma-separated list' };

export function validateExpectedClient(type: GridFieldType, text: string): string | null {
  const t = text.trim();
  if (t === '') return 'Expected value is required';
  const ok = (() => {
    switch (type) {
      case 'text': case 'text_list': return true;
      case 'number': case 'money': return /\d/.test(t) && /^[^\d]*[-+]?[\d.,]+[^\d]*$/.test(t.replace(/[A-Za-z$€£¥₹\s]/g, ''));
      case 'boolean': return TRUE.includes(t.toLowerCase()) || FALSE.includes(t.toLowerCase());
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isNaN(Date.parse(t));
      case 'url': case 'image': try { return /^https?:$/.test(new URL(t).protocol); } catch { return false; }
    }
  })();
  return ok ? null : `Not ${LABEL[type]}`;
}

export function parseBlock(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
}

function setCell(row: GridRow, col: number, value: string): GridRow {
  if (col === 0) return { ...row, name: value };
  if (col === 1) return { ...row, type: (FIELD_TYPES as readonly string[]).includes(value.trim().toLowerCase()) ? (value.trim().toLowerCase() as GridFieldType) : row.type };
  if (col === 2) return { ...row, description: value };
  const i = col - FIXED_COLS;
  if (i < 0 || i >= URL_COUNT) return row;
  const expected = [...row.expected]; expected[i] = value;
  return { ...row, expected };
}

export function applyPaste(state: GridState, at: { row: number; col: number }, block: string[][]): GridState {
  const rows = [...state.rows];
  block.forEach((line, r) => {
    const idx = at.row + r;
    while (rows.length <= idx) rows.push(emptyRow());
    let row = rows[idx]!;
    line.forEach((value, c) => { row = setCell(row, at.col + c, value); });
    rows[idx] = row;
  });
  return { ...state, rows };
}

const HEADER_ALIASES: Record<string, number> = { name: 0, field: 0, 'field name': 0, type: 1, description: 2, where: 2 };

export function rowsFromTable(table: string[][], urlCount: number): { rows: GridRow[]; problems: string[] } {
  if (table.length < 2) return { rows: [], problems: ['The file needs a header row and at least one field row'] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const colOf = (n: number): number => header.findIndex((h) => Object.entries(HEADER_ALIASES).some(([k, v]) => v === n && h === k));
  const nameCol = colOf(0), typeCol = colOf(1), descCol = colOf(2);
  const urlCols = Array.from({ length: urlCount }, (_, i) => header.findIndex((h) => h === `url ${i + 1}` || h === `url${i + 1}` || h === `expected ${i + 1}` || h === `value ${i + 1}`));
  const problems: string[] = [];
  for (const [label, col] of [['name', nameCol], ['type', typeCol], ['description', descCol]] as const) if (col === -1) problems.push(`Missing column: ${label}`);
  urlCols.forEach((c, i) => { if (c === -1) problems.push(`Missing column: url ${i + 1}`); });
  if (problems.length) return { rows: [], problems };
  const rows = table.slice(1).map((line) => {
    const base = emptyRow();
    let row = setCell(base, 0, line[nameCol] ?? '');
    row = setCell(row, 1, line[typeCol] ?? '');
    row = setCell(row, 2, line[descCol] ?? '');
    urlCols.forEach((c, i) => { row = setCell(row, FIXED_COLS + i, line[c] ?? ''); });
    return row;
  });
  return { rows, problems: [] };
}

export function gridProblems(state: GridState): string[] {
  const problems: string[] = [];
  const urls = state.urls.map((u) => u.trim());
  if (urls.some((u) => u === '')) problems.push(`All ${URL_COUNT} product URLs are required`);
  const hosts = new Set<string>();
  for (const u of [...urls, state.listingUrl.trim()].filter(Boolean)) { try { hosts.add(new URL(u).hostname.toLowerCase()); } catch { problems.push(`Not a valid URL: ${u}`); } }
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  if (new Set(urls.map((u) => u.replace(/#.*$/, ''))).size !== urls.length) problems.push('URLs must be different pages');
  if (state.rows.length === 0) problems.push('Add at least one field');
  const names = new Set<string>();
  for (const r of state.rows) {
    if (r.name.trim() === '') { problems.push('Every field needs a name'); continue; }
    if (names.has(r.name.trim().toLowerCase())) problems.push(`Duplicate field name: ${r.name}`);
    names.add(r.name.trim().toLowerCase());
    if (r.description.trim() === '') problems.push(`${r.name}: description is required`);
    r.expected.forEach((v, i) => { const err = validateExpectedClient(r.type, v); if (err) problems.push(`${r.name} @ ${urls[i] || `URL ${i + 1}`}: ${err}`); });
  }
  return problems;
}

export function isComplete(state: GridState): boolean { return gridProblems(state).length === 0; }

export function shortUrl(url: string): string {
  let p: string;
  try { const u = new URL(url); p = u.pathname + (u.search ? '?…' : ''); } catch { p = url; }
  if (p.length <= 28) return p;
  return `${p.slice(0, 13)}…${p.slice(-14)}`;
}

export function toSchemaInput(state: GridState) {
  const urls = state.urls.map((u) => u.trim());
  const expected: Record<string, Record<string, string>> = {};
  for (const r of state.rows) expected[r.key ?? r.name] = Object.fromEntries(urls.map((u, i) => [u, r.expected[i] ?? '']));
  return {
    urls,
    ...(state.listingUrl.trim() ? { listingUrl: state.listingUrl.trim() } : {}),
    fields: state.rows.map((r) => ({ ...(r.key ? { key: r.key } : {}), name: r.name.trim(), type: r.type, description: r.description.trim() })),
    expected,
  };
}

export function fromSource(source: { schemaDefinition: unknown; verificationSet: unknown }): GridState | null {
  const def = source.schemaDefinition as Array<{ key: string; name: string; type: GridFieldType; description: string }> | null;
  const set = source.verificationSet as { urls: string[]; expected: Record<string, Record<string, string>>; listing_url?: string } | null;
  if (!Array.isArray(def) || !set) return null;
  return {
    urls: set.urls,
    listingUrl: set.listing_url ?? '',
    rows: def.map((f) => ({ ...emptyRow(), key: f.key, name: f.name, type: f.type, description: f.description, expected: set.urls.map((u) => set.expected[f.key]?.[u] ?? '') })),
  };
}
```

- [ ] **Step 3: Build the components**

`schema-grid.tsx` (the essentials; style with the existing `card`/`btn-primary` classes and Tailwind):

```tsx
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { FIELD_TYPES, URL_COUNT, applyPaste, emptyRow, parseBlock, shortUrl, validateExpectedClient, type GridState } from '../lib/schema-grid';

export type CellStatus = { status: 'pass' | 'fail' | 'not_captured' | 'stale'; found?: string; reason?: string; hint?: string; weak?: boolean };
type Props = { state: GridState; onChange: (next: GridState) => void; cellStatus?: (rowId: string, urlIndex: number) => CellStatus | null; disabled?: boolean };

const COLS = 3 + URL_COUNT;
const CELL_BG: Record<CellStatus['status'], string> = { pass: 'bg-emerald-50 border-emerald-300', fail: 'bg-red-50 border-red-300', not_captured: 'bg-amber-50 border-amber-300', stale: 'bg-gray-100 border-gray-300' };

export function SchemaGrid({ state, onChange, cellStatus, disabled }: Props) {
  const inputs = useRef(new Map<string, HTMLElement>());
  const reg = (r: number, c: number) => (el: HTMLElement | null) => { if (el) inputs.current.set(`${r},${c}`, el); else inputs.current.delete(`${r},${c}`); };
  const focus = (r: number, c: number) => inputs.current.get(`${r},${c}`)?.focus();

  function onKey(e: KeyboardEvent, r: number, c: number) {
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    const d = move[e.key];
    if (!d) return;
    const target = e.target as HTMLInputElement;
    // Let left/right move the caret inside a text input unless it is at an edge.
    if ((e.key === 'ArrowLeft' && target.selectionStart !== 0) || (e.key === 'ArrowRight' && target.selectionEnd !== target.value?.length)) return;
    let [nr, nc] = [r + d[0], c + d[1]];
    if (nc >= COLS) { nc = 0; nr++; }
    if (nc < 0) { nc = COLS - 1; nr--; }
    if (nr < 0) return;
    if (nr >= state.rows.length) { if (e.key === 'Enter' || e.key === 'Tab') onChange({ ...state, rows: [...state.rows, emptyRow()] }); else return; }
    e.preventDefault();
    setTimeout(() => focus(nr, nc), 0);
  }

  function onPaste(e: ClipboardEvent, r: number, c: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return; // single value: let the input handle it
    e.preventDefault();
    onChange(applyPaste(state, { row: r, col: c }, parseBlock(text)));
  }

  const setRow = (i: number, patch: Partial<GridState['rows'][number]>) => onChange({ ...state, rows: state.rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const setExpected = (i: number, u: number, v: string) => setRow(i, { expected: state.rows[i]!.expected.map((x, k) => (k === u ? v : x)) });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-2 py-1">Field</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Description (where it is, what it looks like)</th>
            {state.urls.map((u, i) => <th key={i} className="px-2 py-1 font-mono text-xs" title={u}>{u ? shortUrl(u) : `URL ${i + 1}`}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, r) => (
            <tr key={row.id}>
              <td className="p-1"><input ref={reg(r, 0)} disabled={disabled} value={row.name} onChange={(e) => setRow(r, { name: e.target.value })} onKeyDown={(e) => onKey(e, r, 0)} onPaste={(e) => onPaste(e, r, 0)} className="w-full rounded border border-gray-300 px-2 py-1" placeholder="price" /></td>
              <td className="p-1"><select ref={reg(r, 1)} disabled={disabled} value={row.type} onChange={(e) => setRow(r, { type: e.target.value as GridState['rows'][number]['type'] })} onKeyDown={(e) => onKey(e, r, 1)} className="rounded border border-gray-300 px-2 py-1">{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
              <td className="p-1"><input ref={reg(r, 2)} disabled={disabled} value={row.description} onChange={(e) => setRow(r, { description: e.target.value })} onKeyDown={(e) => onKey(e, r, 2)} onPaste={(e) => onPaste(e, r, 2)} className="w-full rounded border border-gray-300 px-2 py-1" placeholder="green number next to Add to cart, not the crossed-out one" /></td>
              {row.expected.map((v, u) => {
                const status = cellStatus?.(row.id, u) ?? null;
                const err = validateExpectedClient(row.type, v);
                return (
                  <td key={u} className="p-1 align-top">
                    <input ref={reg(r, 3 + u)} disabled={disabled} value={v} onChange={(e) => setExpected(r, u, e.target.value)} onKeyDown={(e) => onKey(e, r, 3 + u)} onPaste={(e) => onPaste(e, r, 3 + u)}
                      className={`w-full rounded border px-2 py-1 ${status ? CELL_BG[status.status] : err && v !== '' ? 'border-red-300' : 'border-gray-300'}`} />
                    {err && v !== '' && <p className="mt-0.5 text-xs text-red-700">{err}</p>}
                    {status?.status === 'pass' && status.found !== undefined && status.found !== v && <p className="mt-0.5 text-xs text-emerald-800">found: {status.found}</p>}
                    {status?.status === 'fail' && <p className="mt-0.5 text-xs text-red-800">{status.found !== undefined ? `found: ${status.found}. ` : ''}{status.hint}</p>}
                    {status?.status === 'not_captured' && <p className="mt-0.5 text-xs text-amber-800">page not captured</p>}
                    {status?.status === 'stale' && <p className="mt-0.5 text-xs text-gray-600">changed since verified</p>}
                    {status?.weak && <p className="mt-0.5 text-xs text-gray-500">weak evidence: same value on every page</p>}
                  </td>
                );
              })}
              <td className="p-1"><button type="button" disabled={disabled} onClick={() => onChange({ ...state, rows: state.rows.filter((_, j) => j !== r) })} className="text-gray-400 hover:text-red-600" aria-label="Delete row"><Trash2 className="h-4 w-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={disabled} onClick={() => onChange({ ...state, rows: [...state.rows, emptyRow()] })} className="mt-2 inline-flex items-center gap-1 text-sm text-accent-700"><Plus className="h-4 w-4" /> Add row</button>
    </div>
  );
}
```

`schema-import.tsx`: a `<label>` wrapping `<input type="file" accept=".csv,.xlsx" />`; on change, `.csv` → `parseCsv(await file.text())`, `.xlsx` → `(await readXlsxFile(file)).map((r) => r.map((c) => (c === null ? '' : String(c))))`; then `rowsFromTable(table, URL_COUNT)`; call `onRows(rows)` when `problems` is empty, else render the problems in a red list. Add `"read-excel-file": "^5.8.0"` to `dependencies`.

- [ ] **Step 4: `pnpm --filter @robot/dashboard test; pnpm --filter @robot/dashboard exec tsc --noEmit`. Commit** `feat(dashboard): schema grid logic, CSV/XLSX import, grid component`.

---

### Task 15: Dashboard — the grid screen replaces landing + Set-up

**Files:**
- Create: `packages/dashboard/src/routes/new-source.tsx`, `packages/dashboard/src/routes/source-schema.tsx`, `packages/dashboard/src/lib/verification-view.ts` (+ test)
- Modify: `packages/dashboard/src/router.tsx` (index → `NewSource`; `setup` → `SourceSchema`), `packages/dashboard/src/routes/source-index.tsx` (render `SourceSchema` instead of `SourceSetup`), `packages/dashboard/src/routes/source-detail.tsx` (tab label "Schema"), `packages/dashboard/src/routes-smoke.test.ts` (add `/` and a Scratch source's `/setup`)
- Delete: `packages/dashboard/src/routes/landing.tsx`, `packages/dashboard/src/routes/source-setup.tsx`, `packages/dashboard/src/components/add-fields-control.tsx`, `packages/dashboard/src/lib/add-fields.ts` (+ its test)

**Interfaces:**
- `verification-view.ts` (pure): `cellStatusFor(results, fieldKey, url, stale: boolean)` → the `cellStatus` shape from Task 14; `summaryLine(results)` → `"14 of 15 fields verified"`; `hintFor(reason)` → the four spec §4.6 hints verbatim; `isVerificationActive(row)` → `completedAt === null`.

Screens:
- **`/` NewSource**: the three URL inputs + optional listing URL + "Find product pages" (calls `sources.findProductPages`, lists up to ten URLs each with a "Use as URL 1/2/3" chooser) + `SchemaImport` + `SchemaGrid` + a "Save schema" button (enabled when `isComplete`) → `sources.createWithSchema` → navigate to `/p/scratch/sources/$slug`. Copy at the top: "Describe exactly what you need. We'll prove we can get it before extracting anything."
- **Source page (`SourceSchema`)**: `fromSource` → grid; `sources.verificationStatus` polled every 3s while active (`refetchInterval` pattern from `source-run-detail.tsx:359`); header with `summaryLine`; **Verify** button (label from `sources.verifyEstimate`: "Verify · up to $0.75", or "Verify · mechanical only (AI unavailable)"), disabled unless complete and not active; it saves first via `updateSchema` when the grid is dirty, then calls `sources.verify` with `onlyKeys` = keys of red/stale rows when a previous result exists; **Extract** enabled only when `status.current && status.allPassed`, and its handler is the mode branch copied from today's `source-setup.tsx:79-118` (detail → plan+execute; listing unconfirmed → probeAndSample; listing confirmed → plan). A `not_captured` column shows the capture error and the screenshot when present. Delete-source stays where it is today.

- [ ] **Step 1: `verification-view.test.ts`** for the four pure helpers (hint text equality with the spec table; summary line singular/plural; stale precedence over pass).
- [ ] **Step 2: Build the screens; wire the router; delete the old files and every import of them (grep `add-fields`, `AddFieldsControl`, `LandingPage`, `SourceSetup`).** Two details the spec requires: (a) *stale* — a row is stale when its name, type, description, or any expected value differs from `fromSource(source)` (the saved definition); `cellStatusFor` receives that flag and stale wins over pass; (b) *AI unavailable* — when `verifyEstimate.aiAvailable` is false, every red cell's hint is followed by "AI is unavailable on this machine, so only the mechanical search ran", and the Verify button reads "Verify · mechanical only". While a verification is active the grid is disabled and the header shows `status.stage`.
- [ ] **Step 3: `pnpm --filter @robot/dashboard exec tsc --noEmit; pnpm --filter @robot/dashboard test`; then with `pnpm dev:all` running, `pnpm test:ui`.** Commit `feat(dashboard): schema grid screen replaces landing and Set-up`.

---

### Task 16: Remove the old customer path; docs

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (delete `quickCreate`, `analyze`, `requestFields`, `setFieldEnabled` **if** `grep -rn "sources.quickCreate\|sources.analyze\|sources.requestFields\|sources.setFieldEnabled" packages/dashboard/src packages/api/src` shows no remaining caller other than their own tests; otherwise leave and record why), and their tests
- Modify: `CLAUDE.md` (Extraction Chain section gains a first line: "0. **Customer-verified paths** — a Source with a verified schema runs its certified paths only; nothing below applies to it"), `docs/extraction-architecture.md` (new section "Verification-first sources" summarizing spec §4–§5), `docs/handoff.md` (new top entry: what shipped, the `shop.example` hygiene hostname, that the live proof is Task 17 and unstarted), `docs/roadmap.md` (new v3 entry)
- Test: `pnpm -r test`, `pnpm typecheck`, hygiene query with `shop.example` added

- [ ] **Step 1: Delete dead procedures + tests; run the suite.**
- [ ] **Step 2: Docs.** The handoff entry must state plainly: built and offline-proven; **no live site has verified through this flow yet**. Record the one deliberate spec deviation: §4.2's "record the expected currency if present" is not stored (nothing consumes it yet); money cells normalize to an amount and the currency is dropped. Ticket it in `docs/ideas.md`.
- [ ] **Step 3: Commit** `chore: remove the discovered-schema customer path; docs for verification-first sources`.

---

### Task 17: Live proof — STOPS FOR MARKO

**Files:**
- Create: `docs/testing/2026-09-XX-schema-verification-live-proof.md`
- Optional: `packages/scraper/src/__fixtures__/corpus/newegg-{a,b,c}-detail.json` via `pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts <url> <label> detail` (free, network only)

- [ ] **Step 1: Free pre-checks (no API key set).** Start `pnpm dev:all`. Pick a corpus domain that captured on 2026-09-02 (`currys`, `bhphoto`, or `newegg`; **not** `uniqlo`). Open `/`, paste three product URLs, fill a grid of 6–8 fields by hand from the live pages, save, click Verify with `ANTHROPIC_API_KEY` **unset** (mechanical only). Record per field: certified or not, the primary path, and the reason on red cells. Screenshot the grid.
- [ ] **Step 2: STOP.** Report Step 1's table to Marko with the estimated upper bound (`red fields × $0.05`) and ask for the go on the paid re-verify. Do not proceed without it.
- [ ] **Step 3: Paid re-verify (Marko's go only).** Set `ANTHROPIC_API_KEY`, click Verify (only red fields re-run). Record `aiCalls`, `costUsd`, and which proposals certified. Then Extract ten items (a detail Source with ten pasted URLs), open the CSV, and hand-check every cell against the live pages. Record hits/misses per field and whether drift flagged anything.
- [ ] **Step 4: STOP.** Report results; ask Marko whether to capture the three pages as fixtures (Step 5) and whether the hand-checked row set is good enough to declare the flow live-proven.
- [ ] **Step 5: Write the proof doc and update `docs/handoff.md`; commit** `docs: schema-verification live proof`.
