# Candidate Labelling (v2.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-domain candidate catalogues with AI labelling and vision-verified `displayed` flags; per-dataset candidate selection; serving order selection > displayed > current ranking; conflict detection narrowed to genuine poison/staleness.

**Architecture:** A new `candidate_catalogue` jsonb column on `domain_intelligence` maps meaning to path; `datasets.schema` fields gain an optional `candidate: {concept, label}` ref; `resolveFromCache` gains a selection-aware pre-ranking; `detectPathConflicts` gains catalogue- and URL-awareness. AI touches only two cold paths (one labelling pass per domain, one displayed-verification per concept), both cached.

**Tech Stack:** TypeScript ESM, Drizzle/PostgreSQL, vitest, tRPC v11 + Zod, Anthropic SDK (existing patterns only — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-25-candidate-labelling-design.md`

## Global Constraints

- All packages are ESM (`"type": "module"`); imports end in `.js` inside `src`.
- No new npm dependencies anywhere in this plan.
- Postgres must be running (`docker start robot-platform-db`) for `pnpm -r test` and migrations.
- After every task: `pnpm -r test` green AND the cache-hygiene gate returns zero rows:
  `docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select domain, page_type from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%';"`
- `pnpm typecheck` does NOT cover `@robot/dashboard`; after dashboard tasks also run `pnpm --filter @robot/dashboard exec tsc --noEmit`.
- Catalogue caps (spec §3.1): max 8 candidates per concept; labels unique per concept; at most one `displayed: true` per concept.
- Commit messages end with `Co-Authored-By:` per repo convention; one focused commit per task.
- TDD: every behavior change starts with a failing test, watched to fail.

---

### Task 1: Catalogue types + sanitizer + DB column

**Files:**
- Create: `packages/scraper/src/candidate-catalogue.ts`
- Create: `packages/scraper/src/candidate-catalogue.test.ts`
- Modify: `packages/db/src/schema.ts` (domainIntelligence table, after `rowSelector`)
- Modify: `packages/scraper/src/index.ts` (re-export the new module)

**Interfaces:**
- Produces: `type Candidate = { label: string; source: string; path: string; sampleValue: unknown; scope?: Record<string, string>; displayed?: boolean; verifiedAt?: string }`
- Produces: `type CandidateCatalogue = Record<string, Candidate[]>`
- Produces: `sanitizeCatalogue(raw: unknown): CandidateCatalogue` — never throws; drops malformed entries; enforces the three caps.
- Produces: DB column `domain_intelligence.candidate_catalogue jsonb default '{}'`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/scraper/src/candidate-catalogue.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeCatalogue, type CandidateCatalogue } from './candidate-catalogue.js';

const cand = (label: string, over: Record<string, unknown> = {}) => ({
  label, source: 'api', path: `MainItem.${label}`, sampleValue: 1, ...over,
});

describe('sanitizeCatalogue', () => {
  it('passes a well-formed catalogue through unchanged', () => {
    const raw: CandidateCatalogue = { price: [cand('list'), cand('displayed', { source: 'xpath', path: '//span' })] };
    expect(sanitizeCatalogue(raw)).toEqual(raw);
  });

  it('returns an empty catalogue for garbage input, never throwing', () => {
    expect(sanitizeCatalogue(null)).toEqual({});
    expect(sanitizeCatalogue('nope')).toEqual({});
    expect(sanitizeCatalogue({ price: 'nope' })).toEqual({});
  });

  it('drops candidates missing a label, source, or path', () => {
    const out = sanitizeCatalogue({ price: [cand('list'), { label: 'broken' }] });
    expect(out.price).toHaveLength(1);
  });

  it('caps a concept at 8 candidates, keeping the first 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => cand(`c${i}`));
    expect(sanitizeCatalogue({ price: many }).price).toHaveLength(8);
  });

  it('drops a duplicate label within a concept, keeping the first', () => {
    const out = sanitizeCatalogue({ price: [cand('list'), cand('list', { path: 'Other' })] });
    expect(out.price).toHaveLength(1);
    expect(out.price![0]!.path).toBe('MainItem.list');
  });

  it('keeps displayed on at most one candidate per concept (first wins)', () => {
    const out = sanitizeCatalogue({
      price: [cand('a', { displayed: true }), cand('b', { displayed: true })],
    });
    expect(out.price!.filter((c) => c.displayed === true)).toHaveLength(1);
    expect(out.price![0]!.displayed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/candidate-catalogue.test.ts`
Expected: FAIL — module `./candidate-catalogue.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/scraper/src/candidate-catalogue.ts
/**
 * The candidate catalogue: what one domain CAN yield for one concept.
 * Discovered once per domain (spec §4), cached on domain_intelligence,
 * refreshed only on operator request. The catalogue never serves values —
 * serving stays in field_paths; this is the map from meaning to path.
 */

/** Semantic family, snake_case singular: "price", "rating", "review_count". */
export type ConceptName = string;

export type Candidate = {
  /** Short distinctive label within the concept: "displayed", "list", "yotpo". */
  label: string;
  /** Same vocabulary as FieldPath.source. */
  source: string;
  /** Dot-path or XPath — the path language field_paths already speaks. */
  path: string;
  /** Value observed when the catalogue was built; display only, never served. */
  sampleValue: unknown;
  /** Scope facts that make the value interpretable (label-only in v2.5). */
  scope?: Record<string, string>;
  /** Set by displayed-verification; at most one true per concept. */
  displayed?: boolean;
  /** When displayed-verification last ran for this concept (ISO). */
  verifiedAt?: string;
};

export type CandidateCatalogue = Record<ConceptName, Candidate[]>;

export const MAX_CANDIDATES_PER_CONCEPT = 8;

/**
 * Never throws: catalogue data crosses an AI boundary and a DB boundary, and a
 * malformed entry must cost the entry, not the extraction.
 */
export function sanitizeCatalogue(raw: unknown): CandidateCatalogue {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CandidateCatalogue = {};
  for (const [concept, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const seen = new Set<string>();
    let displayedTaken = false;
    const kept: Candidate[] = [];
    for (const entry of value) {
      if (kept.length >= MAX_CANDIDATES_PER_CONCEPT) break;
      if (entry === null || typeof entry !== 'object') continue;
      const c = entry as Record<string, unknown>;
      if (typeof c.label !== 'string' || c.label.length === 0) continue;
      if (typeof c.source !== 'string' || typeof c.path !== 'string' || c.path.length === 0) continue;
      if (seen.has(c.label)) continue;
      seen.add(c.label);
      const candidate: Candidate = {
        label: c.label, source: c.source, path: c.path, sampleValue: c.sampleValue,
      };
      if (c.scope && typeof c.scope === 'object' && !Array.isArray(c.scope)) {
        candidate.scope = c.scope as Record<string, string>;
      }
      if (c.displayed === true && !displayedTaken) {
        candidate.displayed = true;
        displayedTaken = true;
      }
      if (typeof c.verifiedAt === 'string') candidate.verifiedAt = c.verifiedAt;
      kept.push(candidate);
    }
    if (kept.length > 0) out[concept] = kept;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/candidate-catalogue.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the DB column and migration**

In `packages/db/src/schema.ts`, inside `domainIntelligence` directly under the `rowSelector` line, add:

```ts
  // What this domain CAN yield per concept — labelled candidates, discovered
  // once per domain by the v2.5 labelling pass. Never serves values.
  candidateCatalogue: jsonb('candidate_catalogue').default({}).notNull(),
```

Generate + apply (drizzle-kit config lives in `@robot/db`; migrations land in `packages/db/drizzle/`):

```powershell
pnpm --filter @robot/db exec drizzle-kit generate --name candidate_catalogue
pnpm db:migrate
```

Inspect the generated SQL: it must be exactly one `ALTER TABLE "domain_intelligence" ADD COLUMN "candidate_catalogue" jsonb DEFAULT '{}' NOT NULL;` — if drizzle generates anything destructive, stop and fix the schema edit instead of editing the SQL.

- [ ] **Step 6: Re-export and verify the workspace**

In `packages/scraper/src/index.ts`, add alongside the existing domain-cache exports:

```ts
export { sanitizeCatalogue, MAX_CANDIDATES_PER_CONCEPT, type Candidate, type CandidateCatalogue, type ConceptName } from './candidate-catalogue.js';
```

Run: `pnpm -r test` then the cache-hygiene gate (Global Constraints).
Expected: all green, zero hygiene rows.

- [ ] **Step 7: Commit**

```powershell
git add packages/scraper/src/candidate-catalogue.ts packages/scraper/src/candidate-catalogue.test.ts packages/scraper/src/index.ts packages/db
git commit -m "feat(scraper,db): candidate catalogue types, sanitizer, and column (v2.5 task 1)"
```

---

### Task 2: Catalogue read/write plumbing in the domain cache

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (DomainCache type ~line 30; `lookupDomainCache` ~line 49; new functions near `savePaginationConfig`)
- Modify: `packages/scraper/src/index.ts`
- Test: `packages/scraper/src/candidate-catalogue.test.ts` (extend)

**Interfaces:**
- Consumes: `sanitizeCatalogue`, `CandidateCatalogue` (Task 1).
- Produces: `DomainCache` gains `candidateCatalogue: CandidateCatalogue`.
- Produces: `saveCandidateCatalogue(domain: string, pageType: string, catalogue: CandidateCatalogue): Promise<void>` — sanitizes, then writes the column.
- Produces: `clearCandidateCatalogue(domain: string, pageType: string): Promise<void>` — resets to `{}` (the "refresh" primitive: cleared now, rebuilt by the next successful extraction).

- [ ] **Step 1: Wire the read path**

In `domain-cache.ts`: add `candidateCatalogue: CandidateCatalogue;` to the `DomainCache` type, import the type from `./candidate-catalogue.js`, and in `lookupDomainCache`'s result mapping populate it with `sanitizeCatalogue(result.candidateCatalogue)` (both the exact-match and the brand/TLD-group return sites — search for every `return {` in that function).

- [ ] **Step 2: Write the writers**

Model on `savePaginationConfig` (same file — single `db.update` keyed by domain+pageType, console.log on write):

```ts
/** Write a freshly discovered catalogue. Sanitized on the way in; an empty
 *  sanitize result is still written (an explicit "nothing labelled" is data). */
export async function saveCandidateCatalogue(
  domain: string, pageType: string, catalogue: CandidateCatalogue,
): Promise<void> {
  const clean = sanitizeCatalogue(catalogue);
  await db
    .update(domainIntelligence)
    .set({ candidateCatalogue: clean, updatedAt: new Date() })
    .where(and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ));
  console.log(`[cache] candidate catalogue for ${domain}/${pageType}: ${Object.keys(clean).length} concept(s)`);
}

/** The refresh primitive: clear now, rebuild on the next successful extraction. */
export async function clearCandidateCatalogue(domain: string, pageType: string): Promise<void> {
  await db
    .update(domainIntelligence)
    .set({ candidateCatalogue: {}, updatedAt: new Date() })
    .where(and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ));
  console.log(`[cache] candidate catalogue cleared for ${domain}/${pageType}`);
}
```

Export both from `packages/scraper/src/index.ts`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @robot/scraper test` then `pnpm typecheck`.
Expected: green. (The writers are thin DB passthroughs in the `savePaginationConfig` mold — the sanitizer they route through is what carries the tests.)

- [ ] **Step 4: Commit**

```powershell
git add packages/scraper/src
git commit -m "feat(scraper): catalogue read/write plumbing on the domain cache (v2.5 task 2)"
```

---

### Task 3: `lastUrl` on paths + stable AI path identity

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (`FieldPath` type ~line 11; `mergeFieldPaths` ~line 662; `buildFreshPaths`; the outcome type `saveDomainCache` consumes — find its declaration by searching the file/`types.ts` for `fieldResults`)
- Test: Create `packages/scraper/src/domain-cache-merge.test.ts`

**Interfaces:**
- Consumes: `FieldPath`, `mergeFieldPaths` internals (not exported — export it for testing: `export function mergeFieldPaths(...)`, mirroring how other internals like `prunePaths` are already exported).
- Produces: `FieldPath.lastUrl?: string`; merge semantics: `ai-discovered-variants` paths replace-by-source instead of appending.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/scraper/src/domain-cache-merge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeFieldPaths, type FieldPathSet } from './domain-cache.js';

const NOW = '2026-08-25T00:00:00.000Z';
const existingSet = (over: Record<string, unknown> = {}): Record<string, FieldPathSet> => ({
  variants: {
    paths: [{
      path: 'Style buttons below title (old wording)', source: 'ai-discovered-variants',
      confidence: 0.6, hits: 1, misses: 0, lastValue: '[]', lastUsedAt: NOW, ...over,
    }],
    conflictCount: 0,
  },
});
const result = (path: string, source = 'ai-discovered-variants') => ({
  variants: { path, source, value: '[]', confidence: 0.6, found: true },
});

describe('mergeFieldPaths — ai path identity', () => {
  it('REPLACES an existing ai-discovered-variants path instead of appending a near-duplicate', () => {
    const merged = mergeFieldPaths(existingSet(), result('Style buttons below title (new wording)'), [], true, NOW);
    expect(merged.variants!.paths).toHaveLength(1);
    expect(merged.variants!.paths[0]!.path).toBe('Style buttons below title (new wording)');
  });

  it('still appends for path-identified sources when the path differs', () => {
    const merged = mergeFieldPaths(
      { price: { paths: [{ path: '//a', source: 'xpath', confidence: 0.9, hits: 1, misses: 0, lastValue: '1', lastUsedAt: NOW }], conflictCount: 0 } },
      { price: { path: '//b', source: 'xpath', value: '2', confidence: 0.9, found: true } },
      [], true, NOW,
    );
    expect(merged.price!.paths).toHaveLength(2);
  });
});

describe('mergeFieldPaths — lastUrl bookkeeping', () => {
  it('stamps lastUrl on a new path when the outcome carries a url', () => {
    const merged = mergeFieldPaths(
      {}, { price: { path: '//b', source: 'xpath', value: '2', confidence: 0.9, found: true } },
      [], true, NOW, 'https://shop.example.com/p/1',
    );
    expect(merged.price!.paths[0]!.lastUrl).toBe('https://shop.example.com/p/1');
  });

  it('updates lastUrl on an existing path that resolved again', () => {
    const merged = mergeFieldPaths(
      { price: { paths: [{ path: '//a', source: 'xpath', confidence: 0.9, hits: 1, misses: 0, lastValue: '1', lastUsedAt: NOW, lastUrl: 'https://shop.example.com/p/old' }], conflictCount: 0 } },
      { price: { path: '//a', source: 'xpath', value: '2', confidence: 0.9, found: true } },
      [], true, NOW, 'https://shop.example.com/p/new',
    );
    expect(merged.price!.paths[0]!.lastUrl).toBe('https://shop.example.com/p/new');
  });
});
```

(Adjust the `result(...)` literal to the actual `fieldResults` entry shape once read — it lives on the outcome type `saveDomainCache` consumes; the properties used by `mergeFieldPaths` are `path`, `source`, `value`, and per-entry found/confidence handling visible at the top of the merge loop. Keep the tests' assertions identical.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/domain-cache-merge.test.ts`
Expected: FAIL — `mergeFieldPaths` not exported, then (after exporting) the replace and lastUrl assertions fail.

- [ ] **Step 3: Implement**

In `domain-cache.ts`:

1. `FieldPath` gains `` `/** URL of the page this path last resolved on; conflict detection compares only same-page observations. */ lastUrl?: string;` ``
2. Export `mergeFieldPaths` and add a trailing optional parameter `lastUrl?: string`; `saveDomainCache` passes `outcome.url` (add `url: string` to the outcome type it consumes, and set it at the one call site that builds the outcome — in `extraction-orchestrator.ts`, where `domain`/`pageType` are already set, add `url`). `buildFreshPaths` gains the same parameter.
3. In the merge loop, before the same-source-same-path lookup:

```ts
    // AI-description sources use prose as their "path", so every re-discovery
    // words it differently and the cache accretes near-duplicates (five for
    // Newegg variants by 2026-08-25). Identity for them is the SOURCE: a new
    // description replaces the old one in place, stats carried forward.
    if (result.source === 'ai-discovered-variants') {
      const prior = pathSet.paths.find(p => p.source === 'ai-discovered-variants');
      if (prior) {
        prior.path = result.path;
        prior.lastValue = result.value;
        prior.lastUsedAt = now;
        if (lastUrl) prior.lastUrl = lastUrl;
        prior.hits += 1;
        continue;
      }
    }
```

4. Wherever the loop sets `lastValue`/`lastUsedAt` on an existing or new path, also set `lastUrl` when provided.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/domain-cache-merge.test.ts` then `pnpm --filter @robot/scraper test`.
Expected: new tests PASS; whole scraper suite green (existing merge behavior for path-identified sources unchanged).

- [ ] **Step 5: Commit**

```powershell
git add packages/scraper/src
git commit -m "feat(scraper): lastUrl bookkeeping and stable ai path identity (v2.5 task 3)"
```

---

### Task 4: Narrow `detectPathConflicts`

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (`detectPathConflicts` ~line 170)
- Modify: `packages/api/src/routers/domains.ts` (the `intelligenceDetail` call site, ~line 218 — passes the row's catalogue)
- Test: Create `packages/scraper/src/detect-path-conflicts.test.ts`

**Interfaces:**
- Consumes: `CandidateCatalogue` (Task 1), `FieldPath.lastUrl` (Task 3).
- Produces: `detectPathConflicts(fieldPaths: Record<string, FieldPathSet>, catalogue?: CandidateCatalogue): PathConflict[]` — the second argument is optional; every existing call site keeps compiling.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/scraper/src/detect-path-conflicts.test.ts
import { describe, it, expect } from 'vitest';
import { detectPathConflicts, type FieldPathSet } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

const NOW = '2026-08-25T00:00:00.000Z';
const path = (p: string, source: string, lastValue: unknown, lastUrl?: string) => ({
  path: p, source, confidence: 0.9, hits: 2, misses: 0, lastValue, lastUsedAt: NOW, lastUrl,
});
const set = (...paths: ReturnType<typeof path>[]): Record<string, FieldPathSet> =>
  ({ price: { paths, conflictCount: 0 } });

const U = 'https://shop.example.com/p/1';

describe('detectPathConflicts — narrowed (v2.5)', () => {
  it('still fires for same-page unlabelled disagreement (the poison signal)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499', U), path('b', 'api', '9.99', U)));
    expect(conflicts).toHaveLength(1);
  });

  it('does NOT fire when the disagreeing paths map to DIFFERENT labelled candidates', () => {
    const catalogue: CandidateCatalogue = {
      price: [
        { label: 'displayed', source: 'json-ld', path: 'a', sampleValue: '499' },
        { label: 'list', source: 'api', path: 'b', sampleValue: '9.99' },
      ],
    };
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499', U), path('b', 'api', '9.99', U)), catalogue);
    expect(conflicts).toEqual([]);
  });

  it('STILL fires when two paths map to the SAME labelled candidate and disagree', () => {
    const catalogue: CandidateCatalogue = {
      price: [{ label: 'displayed', source: 'json-ld', path: 'a', sampleValue: '499' }],
    };
    // Same candidate path recorded under two sources — same label, so still a conflict.
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499', U), path('a', 'xpath', '9.99', U)), catalogue);
    expect(conflicts).toHaveLength(1);
  });

  it('does NOT fire when the values were observed on different pages', () => {
    const conflicts = detectPathConflicts(set(
      path('a', 'api', 'carte postale ancienne', 'https://shop.example.com/p/1'),
      path('b', 'xpath', 'The Road to Nab End', 'https://shop.example.com/p/2'),
    ));
    expect(conflicts).toEqual([]);
  });

  it('keeps firing when lastUrl is absent on both (pre-v2.5 rows must not go silent)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499'), path('b', 'api', '9.99')));
    expect(conflicts).toHaveLength(1);
  });

  it('format-only numeric variants never conflicted and still do not (valuesMatch tolerance)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'api', '$299.00', U), path('b', 'api-ai', 299, U)));
    expect(conflicts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/detect-path-conflicts.test.ts`
Expected: FAIL on the labelled-different and different-pages cases (and the last test PASSES — it is the regression lock proving `valuesMatch` already normalizes; spec §6.2 as amended).

- [ ] **Step 3: Implement**

In `detectPathConflicts`, after `withValues` is computed and before the values comparison:

```ts
    // Same-page observations only: two paths last exercised on different URLs
    // are telling you about staleness, not disagreement (triage class 4,
    // 2026-08-25 — AbeBooks' api path and xpath path held titles of two
    // different books). Rows predating lastUrl keep the old behaviour.
    const urls = new Set(withValues.map((p) => p.lastUrl).filter((u): u is string => !!u));
    if (urls.size > 1) continue;

    // Paths that map to DIFFERENT labelled candidates of a concept are the
    // catalogue working, not a conflict. Same-label disagreement still fires —
    // that is the poison signal this detector exists for.
    if (catalogue) {
      const labelOf = (p: FieldPath): string | null => {
        for (const candidates of Object.values(catalogue)) {
          const hit = candidates.find((c) => c.path === p.path);
          if (hit) return hit.label;
        }
        return null;
      };
      const labels = withValues.map(labelOf);
      const distinctKnown = new Set(labels.filter((l): l is string => l !== null));
      if (distinctKnown.size > 1 && labels.every((l) => l !== null)) continue;
    }
```

Then in `packages/api/src/routers/domains.ts` `intelligenceDetail`, pass the catalogue:

```ts
          conflicts: detectPathConflicts(
            (r.fieldPaths ?? {}) as Parameters<typeof detectPathConflicts>[0],
            sanitizeCatalogue(r.candidateCatalogue),
          ),
```

(import `sanitizeCatalogue` from `@robot/scraper`). Also pass `sanitizeCatalogue(existing.candidateCatalogue)` at the `saveDomainCache` warn-loop call site in `domain-cache.ts` (~line 622).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/detect-path-conflicts.test.ts`, then `pnpm -r test`, then `pnpm typecheck`.
Expected: all green. The existing `domains.test.ts` in `@robot/api` must stay green untouched (optional second argument).

- [ ] **Step 5: Commit**

```powershell
git add packages/scraper/src packages/api/src/routers/domains.ts
git commit -m "feat(scraper,api): conflict detection narrowed to same-page, same-candidate disagreement (v2.5 task 4)"
```

---

### Task 5: Catalogue discovery — prompt builder, parser with fabricated-path rejection, client wrapper

**Files:**
- Create: `packages/agent/src/catalogue.ts`
- Create: `packages/agent/src/catalogue.test.ts`
- Modify: `packages/agent/src/index.ts` (export)
- Modify: `packages/scraper/src/domain-cache.ts` (export `getByDotPath` — it is file-internal today, used at ~line 427)

**Interfaces:**
- Consumes: `Candidate`, `CandidateCatalogue`, `sanitizeCatalogue` from `@robot/scraper`; `getByDotPath(body: unknown, path: string): unknown`.
- Produces: `type CatalogueEvidence = { apiBodies: unknown[]; jsonLdBlocks: unknown[]; meta: Record<string, string>; fieldResults: Array<{ name: string; value: unknown; source: string; path: string }> }`
- Produces: `buildCataloguePrompt(evidence: CatalogueEvidence): string` (pure)
- Produces: `parseCatalogueResponse(toolInput: unknown, evidence: CatalogueEvidence): CandidateCatalogue` (pure — rejects fabricated paths)
- Produces: `discoverCandidateCatalogue(evidence: CatalogueEvidence, opts: { apiKey: string; model?: string }): Promise<CandidateCatalogue>` (thin Anthropic wrapper, tool-use forced, modelled on the existing AI-API analysis call in `@robot/agent` — reuse its client construction and tool-choice pattern)

- [ ] **Step 1: Write the failing tests (parser is the load-bearing part)**

```ts
// packages/agent/src/catalogue.test.ts
import { describe, it, expect } from 'vitest';
import { buildCataloguePrompt, parseCatalogueResponse, type CatalogueEvidence } from './catalogue.js';

const evidence: CatalogueEvidence = {
  apiBodies: [{ MainItem: { OriginalUnitPrice: 679.99, FinalPrice: 399.99 } }],
  jsonLdBlocks: [{ '@type': 'Product', offers: { price: 389.99 } }],
  meta: { 'og:title': 'SSD 9100 PRO' },
  fieldResults: [{ name: 'price', value: 389.99, source: 'xpath', path: '//span[@class="price-current"]' }],
};

describe('parseCatalogueResponse', () => {
  it('accepts a candidate whose dot-path resolves against the provided API bodies', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'list', source: 'api', path: 'MainItem.OriginalUnitPrice', sampleValue: 679.99 }],
    }, evidence);
    expect(out.price).toHaveLength(1);
  });

  it('accepts a candidate whose path is a path the extraction itself used', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'displayed', source: 'xpath', path: '//span[@class="price-current"]', sampleValue: 389.99 }],
    }, evidence);
    expect(out.price).toHaveLength(1);
  });

  it('REJECTS a candidate whose path resolves nowhere — a fabricated answer never reaches the cache', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'promo', source: 'api', path: 'MainItem.PromoPriceInvented', sampleValue: 1 }],
    }, evidence);
    expect(out.price).toBeUndefined();
  });

  it('routes through sanitizeCatalogue (caps, duplicate labels, garbage)', () => {
    expect(parseCatalogueResponse('garbage', evidence)).toEqual({});
  });
});

describe('buildCataloguePrompt', () => {
  it('carries the evidence and the labelling rules', () => {
    const prompt = buildCataloguePrompt(evidence);
    expect(prompt).toContain('OriginalUnitPrice');
    expect(prompt).toContain('price-current');
    expect(prompt).toContain('snake_case');   // concept naming rule
    expect(prompt).toContain('meaning');      // "label the meaning, never the path"
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robot/agent exec vitest run src/catalogue.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`export { getByDotPath }` in `domain-cache.ts` (pure helper, no body change) and re-export from `packages/scraper/src/index.ts`. Then:

```ts
// packages/agent/src/catalogue.ts
import { sanitizeCatalogue, getByDotPath, type CandidateCatalogue } from '@robot/scraper';

export type CatalogueEvidence = {
  apiBodies: unknown[];
  jsonLdBlocks: unknown[];
  meta: Record<string, string>;
  fieldResults: Array<{ name: string; value: unknown; source: string; path: string }>;
};

export function buildCataloguePrompt(evidence: CatalogueEvidence): string {
  return [
    'You are cataloguing what this product page CAN yield, per concept.',
    'Group value-bearing paths into concepts (snake_case singular: price, rating, review_count, image).',
    'Label each candidate by its meaning, never its path: "list", "range_min", "promo", "yotpo".',
    'Only use paths that appear in the evidence below. Never invent a path.',
    'A candidate may carry scope facts (e.g. {"seller": "MobileMonster"}, {"system": "yotpo"}).',
    '',
    '## Extraction results (paths the pipeline already used)',
    JSON.stringify(evidence.fieldResults, null, 2),
    '## API bodies (dot-paths resolve against these)',
    JSON.stringify(evidence.apiBodies).slice(0, 30_000),
    '## JSON-LD',
    JSON.stringify(evidence.jsonLdBlocks).slice(0, 10_000),
    '## Meta tags',
    JSON.stringify(evidence.meta),
  ].join('\n');
}

/**
 * Fabricated paths are rejected MECHANICALLY, before anything is written —
 * the same "never cache an unverified answer" rule the pagination work
 * established. A path is real if it resolves against a provided API body,
 * or is verbatim one the extraction itself used.
 */
export function parseCatalogueResponse(toolInput: unknown, evidence: CatalogueEvidence): CandidateCatalogue {
  const clean = sanitizeCatalogue(toolInput);
  const knownPaths = new Set(evidence.fieldResults.map((f) => f.path));
  const out: CandidateCatalogue = {};
  for (const [concept, candidates] of Object.entries(clean)) {
    const kept = candidates.filter((c) => {
      if (knownPaths.has(c.path)) return true;
      return evidence.apiBodies.some((body) => {
        const v = getByDotPath(body, c.path);
        return v !== undefined && v !== null;
      });
    });
    if (kept.length > 0) out[concept] = kept;
  }
  return out;
}
```

`discoverCandidateCatalogue` wraps the two pure functions with an Anthropic tool-use call: copy the client construction, model default, and forced tool-choice shape from the existing AI-API analysis function in this package (search `@robot/agent/src` for `tool_choice`), define one tool `record_catalogue` whose input schema is `{ [concept]: Candidate[] }` (describe fields, keep it permissive — the parser is the gate), and return `parseCatalogueResponse(toolUse.input, evidence)`; on any API error, log and return `{}` (discovery must never fail an extraction).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/agent test` and `pnpm typecheck`.
Expected: green.

- [ ] **Step 5: Commit**

```powershell
git add packages/agent/src packages/scraper/src
git commit -m "feat(agent): catalogue discovery with mechanical fabricated-path rejection (v2.5 task 5)"
```

---

### Task 6: Discovery trigger in the extraction orchestrator

**Files:**
- Modify: `packages/scraper/src/extraction-orchestrator.ts` (after the `saveCache` call; also `ExtractionDeps`)
- Test: Create `packages/scraper/src/extraction-orchestrator-catalogue.test.ts` (pattern: copy the deps-faking setup from `extraction-orchestrator-cached-xpath.test.ts`)

**Interfaces:**
- Consumes: `discoverCandidateCatalogue` shape (Task 5) — injected, never imported directly, so the scraper package does not gain an agent dependency for tests.
- Produces: `ExtractionDeps` gains `discoverCatalogue?: (evidence: CatalogueEvidence-shaped object) => Promise<CandidateCatalogue>` and `saveCatalogue?: (domain: string, pageType: string, catalogue: CandidateCatalogue) => Promise<void>` (defaults: undefined → skip, and `saveCandidateCatalogue`).

- [ ] **Step 1: Write the failing tests**

Three cases, using the existing fake-deps pattern from `extraction-orchestrator-cached-xpath.test.ts` (fake browser/agent/lookupCache/saveCache):

```ts
it('runs discovery after a successful extraction when the domain catalogue is empty', async () => {
  // lookupCache returns a cache whose candidateCatalogue is {}
  // deps.discoverCatalogue is a vi.fn resolving { price: [ ...one candidate... ] }
  // deps.saveCatalogue is a vi.fn
  // → discoverCatalogue called once; saveCatalogue called with (domain, pageType, that catalogue)
});
it('does NOT run discovery when the catalogue is already populated', async () => {
  // lookupCache returns candidateCatalogue: { price: [cand] } → discoverCatalogue not called
});
it('a discovery failure never fails the extraction', async () => {
  // discoverCatalogue rejects → runExtraction still resolves; saveCatalogue not called
});
```

Write them fully against the copied fake-deps scaffold; assert on the `vi.fn` calls exactly as sketched.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @robot/scraper exec vitest run src/extraction-orchestrator-catalogue.test.ts`; expected: `discoverCatalogue` never called (property does not exist yet).

- [ ] **Step 3: Implement**

In `runExtraction`, directly after the successful `saveCache(outcome)` call (find the single call site), add:

```ts
    // v2.5 catalogue discovery: one labelled pass per domain, only when the
    // catalogue is cold, only after a successful extraction, and NEVER able to
    // fail the run — the catalogue is an enrichment, not a dependency.
    if (deps.discoverCatalogue && cache && Object.keys(cache.candidateCatalogue ?? {}).length === 0) {
      try {
        const catalogue = await deps.discoverCatalogue({
          apiBodies: interceptedRequests.filter(r => r.parsedJson).map(r => r.parsedJson),
          jsonLdBlocks: jsonLdBlocks ?? [],
          meta: metaTags ?? {},
          fieldResults: Object.entries(fieldResults).map(([name, r]) => ({
            name, value: r.value, source: r.source, path: r.path,
          })),
        });
        if (Object.keys(catalogue).length > 0) {
          await (deps.saveCatalogue ?? saveCandidateCatalogue)(domain, resolvedPageType, catalogue);
        }
      } catch (err) {
        console.error('[extract] catalogue discovery failed (non-fatal):', err);
      }
    }
```

Bind the local names (`interceptedRequests`, `jsonLdBlocks`, `metaTags`, `fieldResults`) to whatever the orchestrator actually calls them at that point in the function — they all exist in scope by the save step; match the file's own variables rather than renaming anything.

Wire the production default where `runExtraction` deps are assembled in `@robot/api` (`packages/api/src/routers/scraper.ts` and `packages/api/src/crawl/extract-item.ts` both build `ExtractionDeps`): pass `discoverCatalogue` wrapping `discoverCandidateCatalogue` with `process.env.ANTHROPIC_API_KEY`, only when the key is set.

- [ ] **Step 4: Run** — new tests PASS; `pnpm -r test` green; hygiene gate zero rows.

- [ ] **Step 5: Commit**

```powershell
git add packages/scraper/src packages/api/src
git commit -m "feat(scraper,api): cold-catalogue discovery trigger after successful extraction (v2.5 task 6)"
```

---

### Task 7: Selection-aware serving in `resolveFromCache`

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (`resolveFromCache`, line ~333)
- Modify: `packages/scraper/src/extraction-orchestrator.ts` (the `resolveFromCache` call, line ~323; `ExtractionRequest` field type)
- Test: Create `packages/scraper/src/resolve-selection.test.ts`

**Interfaces:**
- Consumes: `CandidateCatalogue` (Task 1).
- Produces: `resolveFromCache(fieldPaths, allExtractedData, requestedFields, opts?: { catalogue?: CandidateCatalogue; selections?: Record<string, { concept: string; label: string }> })` — fourth argument optional, all existing call sites compile unchanged.
- Produces: `ExtractionRequest`'s field entries accept `candidate?: { concept: string; label: string }` (they are structurally typed schema fields; add the optional property to the field type the orchestrator declares).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/scraper/src/resolve-selection.test.ts
import { describe, it, expect } from 'vitest';
import { resolveFromCache, type FieldPathSet } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

const NOW = '2026-08-25T00:00:00.000Z';
const path = (p: string, source: string, hits: number, over: Record<string, unknown> = {}) => ({
  path: p, source, confidence: 0.9, hits, misses: 0, lastValue: 'x', lastUsedAt: NOW, ...over,
});
// Two price paths; the api one has the better stats and wins today.
const fieldPaths: Record<string, FieldPathSet> = {
  price: { paths: [path('MainItem.FinalPrice', 'api', 10), path('//span[@class="pc"]', 'xpath', 1)], conflictCount: 0 },
};
// resolveFromCache reads values via allExtractedData keyed by path (see its body).
const data = { 'MainItem.FinalPrice': 399.99, '//span[@class="pc"]': 389.99 };
const catalogue: CandidateCatalogue = {
  price: [
    { label: 'displayed', source: 'xpath', path: '//span[@class="pc"]', sampleValue: 389.99, displayed: true },
    { label: 'final', source: 'api', path: 'MainItem.FinalPrice', sampleValue: 399.99 },
  ],
};

describe('resolveFromCache — selection and displayed-default (v2.5)', () => {
  it('baseline: without opts the statistically better path still wins', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price']);
    expect(resolved.price!.value).toBe(399.99);
  });

  it('an explicit selection outranks everything', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price'], {
      catalogue, selections: { price: { concept: 'price', label: 'final' } },
    });
    expect(resolved.price!.value).toBe(399.99);
    const other = resolveFromCache(fieldPaths, data, ['price'], {
      catalogue, selections: { price: { concept: 'price', label: 'displayed' } },
    });
    expect(other.resolved.price!.value).toBe(389.99);
  });

  it('without a selection, the displayed candidate outranks the statistical winner', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price'], { catalogue });
    expect(resolved.price!.value).toBe(389.99);
  });

  it('a dangling selection degrades to the default ranking, never fails the field', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price'], {
      catalogue, selections: { price: { concept: 'price', label: 'gone' } },
    });
    expect(resolved.price!.value).toBe(389.99); // displayed-default still applies
  });
});
```

- [ ] **Step 2: Run to verify they fail** — baseline passes, the other three fail (no fourth parameter).

- [ ] **Step 3: Implement**

In `resolveFromCache`, add the optional `opts` parameter and, after `const ranked = [...pathSet.paths].sort(comparePaths);`, hoist preferred paths to the front:

```ts
    // v2.5 serving order (spec §6.1): the customer's own selection first, then
    // the vision-verified displayed candidate, then the statistical ranking.
    // A selection that maps to no catalogue entry (label renamed, catalogue
    // refreshed) degrades to the next rung and is logged — never a failure.
    const concept = opts?.catalogue ? findConcept(opts.catalogue, fieldName, opts?.selections?.[fieldName]) : null;
    const hoist = (predicate: (p: FieldPath) => boolean) => {
      const i = ranked.findIndex(predicate);
      if (i > 0) ranked.unshift(ranked.splice(i, 1)[0]!);
    };
    const selection = opts?.selections?.[fieldName];
    const selectedPath = selection && concept
      ? concept.find((c) => c.label === selection.label)?.path ?? null
      : null;
    if (selection && !selectedPath) {
      console.warn(`[cache] selection "${selection.concept}/${selection.label}" for field "${fieldName}" matches no catalogue candidate — serving default`);
    }
    const displayedPath = concept?.find((c) => c.displayed === true)?.path ?? null;
    if (displayedPath) hoist((p) => p.path === displayedPath);
    if (selectedPath) hoist((p) => p.path === selectedPath);
```

with the helper (same file):

```ts
/** The concept a schema field maps to: explicit selection first, else the
 *  field's name matched against concept names (exact, then naive plural). */
function findConcept(
  catalogue: CandidateCatalogue,
  fieldName: string,
  selection?: { concept: string },
): Candidate[] | null {
  if (selection) return catalogue[selection.concept] ?? null;
  if (catalogue[fieldName]) return catalogue[fieldName]!;
  const singular = fieldName.replace(/s$/, '');
  return catalogue[singular] ?? null;
}
```

In `extraction-orchestrator.ts`: the field type gains `candidate?: { concept: string; label: string }`; at the `resolveFromCache` call site (~line 323) pass:

```ts
      const cacheResult = resolveFromCache(cache.fieldPaths, finalData, fieldNames, {
        catalogue: cache.candidateCatalogue,
        selections: Object.fromEntries(fields.filter((f) => f.candidate).map((f) => [f.name, f.candidate!])),
      });
```

- [ ] **Step 4: Run** — new tests PASS; `pnpm -r test` + `pnpm typecheck` green.

- [ ] **Step 5: Commit**

```powershell
git add packages/scraper/src
git commit -m "feat(scraper): serving order selection > displayed > statistical ranking (v2.5 task 7)"
```

---

### Task 8: Displayed verification judge

**Files:**
- Create: `packages/agent/src/judge-displayed.ts`
- Create: `packages/agent/src/judge-displayed.test.ts`
- Modify: `packages/agent/src/judge-calibration.test.ts` (one new gated case)
- Modify: `packages/agent/src/index.ts`, `packages/scraper/src/domain-cache.ts` (writer)

**Interfaces:**
- Consumes: judge client patterns from `packages/agent/src/judge.ts` (`JUDGE_MODEL`, request tuning, system-prompt style).
- Produces: `buildDisplayedPrompt(concept: string, candidates: Array<{ label: string; value: unknown }>): string` (pure)
- Produces: `parseDisplayedVerdict(text: string, labels: string[]): string | null` (pure — returns a label or null for "none")
- Produces: `judgeDisplayedCandidate(opts: { screenshot: Buffer; concept: string; candidates: Array<{ label: string; value: unknown }>; apiKey: string; model?: string }): Promise<string | null>`
- Produces: `markDisplayed(domain: string, pageType: string, concept: string, label: string | null): Promise<void>` in `domain-cache.ts` — sets `displayed: true` on the named label (clearing others) and `verifiedAt` (ISO now) on every candidate of the concept; label `null` records `verifiedAt` only.

- [ ] **Step 1: Failing tests for the pure parts**

```ts
// packages/agent/src/judge-displayed.test.ts
import { describe, it, expect } from 'vitest';
import { buildDisplayedPrompt, parseDisplayedVerdict } from './judge-displayed.js';

describe('parseDisplayedVerdict', () => {
  it('returns the label the model named', () => {
    expect(parseDisplayedVerdict('DISPLAYED: list', ['list', 'final'])).toBe('list');
  });
  it('returns null for NONE', () => {
    expect(parseDisplayedVerdict('DISPLAYED: NONE', ['list'])).toBeNull();
  });
  it('returns null for a label not offered (a hallucinated label must not stick)', () => {
    expect(parseDisplayedVerdict('DISPLAYED: promo', ['list', 'final'])).toBeNull();
  });
});

describe('buildDisplayedPrompt', () => {
  it('offers every candidate with its value and demands the DISPLAYED: sentinel', () => {
    const p = buildDisplayedPrompt('price', [{ label: 'list', value: 679.99 }, { label: 'final', value: 399.99 }]);
    expect(p).toContain('list');
    expect(p).toContain('679.99');
    expect(p).toContain('DISPLAYED:');
    expect(p).toContain('NONE');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (module missing), **Step 3: implement** — `buildDisplayedPrompt` asks: "Which of these candidate values, if any, is what this page visibly shows a shopper for {concept}? Answer exactly `DISPLAYED: <label>` or `DISPLAYED: NONE`."; `parseDisplayedVerdict` matches `/DISPLAYED:\s*([\w-]+)/` and validates against `labels`; `judgeDisplayedCandidate` copies `judgeFieldExtraction`'s client/model/tuning shape (judge.ts:78-90), sends the screenshot image block + prompt, returns the parsed verdict, `null` on any error. `markDisplayed` mirrors `pinFieldPath`'s read-modify-write on the catalogue column with the exactly-one-displayed rule.

- [ ] **Step 4: Calibration entry** — in `judge-calibration.test.ts`, add one `RUN_JUDGE_CALIBRATION`-gated case following the file's existing pattern: the fixture page's known price candidates, expecting the displayed one back. Run `pnpm --filter @robot/agent test` (calibration self-skips without the env var).

- [ ] **Step 5: Commit**

```powershell
git add packages/agent/src packages/scraper/src
git commit -m "feat(agent,scraper): displayed-candidate verification judge and catalogue writer (v2.5 task 8)"
```

---

### Task 9: API surface — schema field ref, catalogue in intelligenceDetail, refresh mutation

**Files:**
- Modify: `packages/api/src/routers/datasets.ts` (`datasetSchemaFieldSchema` — declared near the top; find with grep)
- Modify: `packages/api/src/routers/domains.ts` (`intelligenceDetail` return; new `refreshCatalogue` mutation)
- Test: Modify `packages/api/src/routers/datasets-schema-field.test.ts` and `packages/api/src/routers/domains.test.ts` (follow each file's existing patterns)

**Interfaces:**
- Consumes: `clearCandidateCatalogue`, `sanitizeCatalogue` from `@robot/scraper`.
- Produces: `datasetSchemaFieldSchema` accepts optional `candidate: { concept: string; label: string }`.
- Produces: `intelligenceDetail` page types carry `catalogue: CandidateCatalogue`.
- Produces: `domains.refreshCatalogue` mutation `{ domain, pageType }` → clears the catalogue (rebuild happens on the next successful extraction — this is the spec's "manual refresh" made cheap and safe: no live fetch, no spend, from the button).

- [ ] **Step 1: Failing tests** — extend `datasets-schema-field.test.ts`: a field with `candidate: { concept: 'price', label: 'list' }` parses; a field with `candidate: { concept: '' }` is rejected; a field without `candidate` still parses. Extend `domains.test.ts` for `intelligenceDetail` including `catalogue` and for `refreshCatalogue` calling the clear function (inject/mocked per that file's existing style).
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** — zod: `candidate: z.object({ concept: z.string().min(1), label: z.string().min(1) }).optional()`; `intelligenceDetail` adds `catalogue: sanitizeCatalogue(r.candidateCatalogue)` to each page-type object; `refreshCatalogue` is a `publicProcedure.input(z.object({ domain: z.string().min(1), pageType: z.string().min(1) })).mutation(...)` calling `clearCandidateCatalogue`.
- [ ] **Step 4: Run** — `pnpm --filter @robot/api test`, `pnpm typecheck`, green. Also confirm the extraction request path carries `candidate` through: grep `@robot/api` for where dataset schema fields become `ExtractionRequest.fields` (the crawl `extract-item.ts` merge and the scraper router) and pass the property through wherever fields are re-mapped — TypeScript will surface any narrowing that drops it once `ExtractionRequest` (Task 7) declares it.
- [ ] **Step 5: Commit**

```powershell
git add packages/api/src
git commit -m "feat(api): candidate refs on dataset schema fields, catalogue read + refresh (v2.5 task 9)"
```

---

### Task 10: Dashboard — picker, catalogue view, provenance label

**Files:**
- Modify: `packages/dashboard/src/routes/dataset-detail.tsx` (schema editor rows)
- Modify: `packages/dashboard/src/routes/domain-detail.tsx` (catalogue section + refresh button)
- Modify: `packages/dashboard/src/components/results-table.tsx` (tooltip)
- Create: `packages/dashboard/src/lib/candidate-picker.ts` + `candidate-picker.test.ts` (the pure logic: which fields get a picker, option list construction)

**Interfaces:**
- Consumes: `domains.intelligenceDetail` (`catalogue` per page type), `datasets.updateSchema` (fields now carry `candidate`), `domains.refreshCatalogue`.
- Produces: `pickerOptions(catalogue: CandidateCatalogue, fieldName: string, current?: {concept: string; label: string}): Array<{ concept: string; label: string; sampleValue: unknown; displayed: boolean; scope?: Record<string,string>; selected: boolean }> | null` — null when no picker is warranted (<2 candidates).

- [ ] **Step 1: Failing tests for the pure logic**

```ts
// packages/dashboard/src/lib/candidate-picker.test.ts
import { describe, it, expect } from 'vitest';
import { pickerOptions } from './candidate-picker';

const catalogue = {
  price: [
    { label: 'list', source: 'api', path: 'a', sampleValue: 679.99 },
    { label: 'displayed', source: 'xpath', path: 'b', sampleValue: 389.99, displayed: true },
  ],
  brand: [{ label: 'only', source: 'meta', path: 'c', sampleValue: 'X' }],
};

describe('pickerOptions', () => {
  it('offers a picker for a field whose concept has 2+ candidates, displayed first', () => {
    const opts = pickerOptions(catalogue, 'price');
    expect(opts).toHaveLength(2);
    expect(opts![0]!.label).toBe('displayed');
  });
  it('marks the current selection', () => {
    const opts = pickerOptions(catalogue, 'price', { concept: 'price', label: 'list' });
    expect(opts!.find((o) => o.selected)!.label).toBe('list');
  });
  it('returns null for single-candidate concepts and unknown fields', () => {
    expect(pickerOptions(catalogue, 'brand')).toBeNull();
    expect(pickerOptions(catalogue, 'weight')).toBeNull();
  });
  it('matches naive plurals (images -> image)', () => {
    const c = { image: [{ label: 'a', source: 'meta', path: 'x', sampleValue: 1 }, { label: 'b', source: 'json-ld', path: 'y', sampleValue: 2 }] };
    expect(pickerOptions(c, 'images')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**, **Step 3: implement** `pickerOptions` (concept lookup mirrors `findConcept` from Task 7: explicit > exact > naive singular; sort displayed-first; `selected` from `current`).
- [ ] **Step 4: Wire the UI** (styling follows the design system in `src/styles.css` — `card`, `micro-label`, `btn-quiet`, accent tokens):
  - **dataset-detail.tsx**: fetch `domains.intelligenceDetail` for each distinct source hostname on the dataset (hostnames come from the sources list the page already renders; `new URL(urlTemplate).hostname`); merge the page-type catalogues; per schema-field row where `pickerOptions(...)` is non-null render a `<select>` of options labelled `` `${o.label} — ${formatValue(o.sampleValue)}${o.displayed ? ' (displayed)' : ''}` `` plus a "default" option; on change call the page's existing `updateSchema` save path with `candidate` set (or removed for "default").
  - **domain-detail.tsx**: per page-type card, under the selectors table, a "Candidate catalogue" section — one row per concept listing candidates as pills (`micro-label` for the concept, mono sample values, accent pill for `displayed`), plus a `btn-quiet` "Refresh catalogue" wired to `domains.refreshCatalogue` with the note "cleared now — rebuilt by the next successful run".
  - **results-table.tsx**: the header keeps working from `fields`; where a field object carries `candidate`, append `· ${candidate.label}` to the `title` tooltip on that column's `<th>`.
- [ ] **Step 5: Verify** — `pnpm --filter @robot/dashboard test`, `pnpm --filter @robot/dashboard exec tsc --noEmit`; then `pnpm dev:all` and click through Dataset detail + Domain detail (catalogues will be empty until a discovery has run — the section must render its empty state cleanly, not crash).
- [ ] **Step 6: Commit**

```powershell
git add packages/dashboard/src
git commit -m "feat(dashboard): candidate picker, catalogue view, provenance labels (v2.5 task 10)"
```

---

### Task 11: Tier 1 fixture gate + live dogfood (STOP for approval before spending)

**Files:**
- Create: `packages/scraper/src/__fixtures__/catalogue-serving.test.ts` (or extend the existing fixture-harness test file for the Newegg fixture — follow the harness pattern in `packages/scraper/src/__fixtures__/`)
- Modify: `docs/handoff.md` (record the outcome)

- [ ] **Step 1: Fixture-replay test** — using the Tier 1 harness and the `newegg-gpu` fixtures: seed a `DomainCache` whose `fieldPaths` and `candidateCatalogue` contain two price candidates with the fixture's real paths, run the extraction with (a) no selection + displayed flag → displayed value wins; (b) an explicit selection of the other label → that value wins. This is the end-to-end proof that selection survives the whole chain, not just `resolveFromCache`.
- [ ] **Step 2: Run the full gates** — `pnpm -r test`, hygiene gate, `pnpm typecheck`, `pnpm --filter @robot/dashboard exec tsc --noEmit`. All green.
- [ ] **Step 3: Commit**

```powershell
git add packages/scraper/src docs/handoff.md
git commit -m "test(scraper): Tier 1 catalogue-serving fixture gate (v2.5 task 11)"
```

- [ ] **Step 4: Live dogfood — REQUIRES MARKO'S EXPLICIT GO (spends ~$0.15 + API budget).** One extraction each against `newegg`, `target`, `barnesandnoble` corpus URLs (`pnpm --filter @robot/scraper exec tsx src/test-run.ts "<url>"`) with `ANTHROPIC_API_KEY` set, letting the cold-catalogue trigger fire. Then review each catalogue by hand in the domain UI (labels sensible? sample values real? displayed plausible?) and run displayed-verification per multi-candidate concept. Record results + catalogue contents in `docs/handoff.md`. Do NOT enable anything customer-facing on a domain whose catalogue failed hand review — clear it via the refresh button instead.

---

## Self-review notes (already applied)

- Spec §6.2's "valuesMatch gains numeric normalization" — investigation showed `valuesMatch` (domain-cache.ts:767) already normalizes with 5% tolerance; Task 4 Step 1 carries the regression-lock test instead of a change, and the spec has been amended to say so.
- Every task's interfaces reference only names defined here or verified in the codebase (signatures checked against `domain-cache.ts`, `extraction-orchestrator.ts`, `judge.ts`, `datasets.ts`, `domains.ts`, `schema.ts` on 2026-08-25).
- Spec coverage: §3.1→Tasks 1-2; §3.2→Task 9; §3.3→Task 3; §4→Tasks 5-6; §5→Task 8; §6.1→Task 7; §6.2→Task 4; §7→Task 10; §8→no task needed (exports read schema fields; Task 9's pass-through is the only touchpoint); §9→Tasks 1-11 test steps + Task 11; §10 rollout order preserved (Task 3-4 = spec step 3, independent as promised).
