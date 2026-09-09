# MVP Flow Phase 2: Contract on the Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move field name and type to the project's dataset (the contract), keep per-website location hints, proof pages, expected values and certification on the source (the binding), make certification current per field so adding a field never discards other fields' proofs, migrate existing data, and give the project home an editable field list.

**Architecture:** Three layers already exist as three tables: `datasets.schema` (contract), `sources.schema_definition` + `sources.verification_set` + `source_verifications` (binding), `domain_intelligence` (knowledge). Today the wizard-era procedures write name and type only onto the source. This phase adds a `key` to dataset fields, four dataset field procedures that propagate to every source in the dataset, a per-field hash stored inside each verification result, a `sources.updateBinding` procedure that owns only descriptions, pages and expected values, and a one-off lift script. The verifier's search and certification rule are untouched; only the bookkeeping around its results changes.

**Tech Stack:** TypeScript, tRPC v11 + Zod + superjson, Drizzle ORM on PostgreSQL 16, Vitest, React 19 + TanStack Router/Query, Tailwind v4, lucide-react. pnpm workspaces + Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`, sections 4 (all), 5.3, 5.6 (the Field/Type columns and the paste-by-name rule only; the rest of 5.6 is phase 3), 8 (the dataset and source procedures), 9 (`fieldHash`, `definitionHash` without name), 10, 12 (phase 2).

## Global Constraints

- Contract fields (`datasets.schema` entries) have the shape `{ key, name, type, concept }` plus optional legacy properties (`description`, `required`, `origin`, `input_column`, `candidate`) that this phase preserves but never sets. `key` is minted once with `deriveKey` and never changes.
- A source's `schema_definition` keeps its shape `{ key, name, type, description, concept }`; `name`, `type` and `concept` are copies of the contract field with the same `key`. The source owns only `description`.
- Propagation rules (spec 4.3): add → every source gets the field with empty description and empty expected cells; rename → free, copies to every source, never changes a hash; retype → refused with `PRECONDITION_FAILED` while any source has a current certification for that key; delete → removes the field from the dataset and from every source's binding and verification set.
- Certification is current per field (spec 4.4): `fieldHash` is a sha256 over `{ key, type, description, concept, urls, expected[key] }`; a field is current when the latest completed, error-free verification holds a passing result for it whose `fieldHash` equals the present one. Extract unlocks when every contract field is current. `definitionHash` no longer includes `name`.
- Old verification rows have no `fieldHash` and count as not current; one free re-verify per existing source restores them (spec 4.5).
- Names are the customer's; nothing is auto-named without being editable. Customer-facing copy: sentence case, buttons say what happens, never "source", "dataset", "input set".
- Only http(s) URLs (`httpUrl`) anywhere a browser will later navigate.
- Tests hit the real database via `createCallerFactory(appRouter)({ db })`; Postgres runs in Docker (`robot-platform-db`). `pnpm -r --workspace-concurrency=1 test` is the gate. `pnpm test:ui` needs `pnpm dev:all` and is opt-in.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AZ6EysmV6fcq3FxP33KFsw`.
- Windows dev machine: Git Bash syntax; `npx pnpm` if the `pnpm` launcher fails.

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `packages/scraper/src/verify/run-verification.ts` | `fieldHash`, `definitionHash` without name, per-field copy-forward by hash | Modify |
| `packages/scraper/src/verify/types.ts` | `FieldVerification.fieldHash?: string` | Modify |
| `packages/scraper/src/verify/run-verification.test.ts` | hash tests, copy-forward test | Modify |
| `packages/api/src/contract.ts` | Contract field type, `contractFields(schema)`, `bindingFor(contract, description?)` | Create |
| `packages/api/src/contract.test.ts` | Tests | Create |
| `packages/api/src/verify/current-certification.ts` | `loadFieldCurrency`, `loadCurrentCertification` on per-field currency | Modify |
| `packages/api/src/verify/current-certification.test.ts` | Rewritten on the new helper | Modify |
| `packages/api/src/routers/datasets.ts` | `addField`, `renameField`, `retypeField`, `deleteField`, `fieldStatus`; `updateSchema` preserves key/concept | Modify |
| `packages/api/src/routers/datasets-fields.test.ts` | Tests | Create |
| `packages/api/src/verify/http-url.ts` | `httpUrl` (moved out of schema-input.ts) | Create |
| `packages/api/src/verify/binding-input.ts` | `bindingInput`, `bindingProblems`, `prepareBinding` | Create |
| `packages/api/src/verify/binding-input.test.ts` | Pure tests | Create |
| `packages/api/src/verify/schema-input.ts` | Deleted with `createWithSchema` | Delete |
| `packages/api/src/routers/sources.ts` | `createInProject` seeds the contract; `updateBinding` replaces `updateSchema`; `createWithSchema`, `quickCreate`, Scratch helpers removed; `verificationStatus` returns `currentKeys` | Modify |
| `packages/api/src/test-helpers/customer-source.ts` | `createProjectWithSource(...)` test fixture builder | Create |
| `packages/api/src/routers/sources-binding.test.ts` | Tests for `updateBinding` and the seeded `createInProject` | Create |
| `packages/api/src/routers/sources-schema.test.ts`, `sources.test.ts`, `sources-verify.test.ts`, `sources-project.test.ts`, `crawl/require-certification.test.ts`, `verify/run-source-verification.test.ts` | Setup moved to the helper; tests of removed procedures deleted | Modify |
| `packages/db/src/scripts/lift-contracts.ts` | One-off lift of per-source fields into their datasets | Create |
| `packages/db/src/scripts/lift-contracts.test.ts` | Test against seeded rows | Create |
| `packages/db/package.json`, root `package.json` | `db:lift-contracts` script | Modify |
| `packages/dashboard/src/lib/schema-grid.ts` | `toBindingInput`, `applyImportToRows`, contract-mode problems | Modify |
| `packages/dashboard/src/lib/schema-grid.test.ts` | Tests | Modify |
| `packages/dashboard/src/components/schema-grid.tsx` | `locked` name/type, no add/delete rows | Modify |
| `packages/dashboard/src/routes/source-schema.tsx` | Uses `updateBinding`, contract rows, project link | Modify |
| `packages/dashboard/src/components/contract-editor.tsx` | Project home field list: add, rename, retype, delete, verified-on | Create |
| `packages/dashboard/src/routes/project-home.tsx` | Mounts `ContractEditor` | Modify |
| `packages/dashboard/src/routes-smoke.test.ts` | Create flow adds a field first | Modify |
| `docs/handoff.md`, `CLAUDE.md` | Phase note | Modify |

---

### Task 1: `fieldHash`, `definitionHash` without name, per-field copy-forward

**Files:**
- Modify: `packages/scraper/src/verify/types.ts` (add `fieldHash?: string` to `FieldVerification`)
- Modify: `packages/scraper/src/verify/run-verification.ts`
- Modify: `packages/scraper/src/verify/run-verification.test.ts`

**Interfaces:**
- Produces: `fieldHash(field: SchemaDefinitionField, set: VerificationSet): string` exported from `@robot/scraper`; every `FieldVerification` written by `runVerification` carries `fieldHash`; `definitionHash` ignores `name`.
- Consumed by Task 2 (`loadFieldCurrency`) and Task 6 (dashboard reads `fieldHash` only through the API's `currentKeys`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/scraper/src/verify/run-verification.test.ts` (it already imports `definitionHash`, `runVerification` and builds `fields`/`set` fixtures; reuse its helpers, and add `fieldHash` to the import):

```ts
describe('fieldHash / definitionHash', () => {
  const set: VerificationSet = {
    urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'],
    expected: {
      price: { 'https://s.example/1': '1', 'https://s.example/2': '2', 'https://s.example/3': '3' },
      title: { 'https://s.example/1': 'a', 'https://s.example/2': 'b', 'https://s.example/3': 'c' },
    },
  };
  const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' };
  const title: SchemaDefinitionField = { key: 'title', name: 'Title', type: 'text', description: 'h1', concept: 'product_name' };

  it('is stable and ignores the field name', () => {
    expect(fieldHash(price, set)).toBe(fieldHash({ ...price, name: 'Cost' }, set));
    expect(definitionHash([price, title], set)).toBe(definitionHash([{ ...price, name: 'Cost' }, title], set));
  });
  it('changes with type, description, urls, or that field\'s expected values only', () => {
    const h = fieldHash(price, set);
    expect(fieldHash({ ...price, type: 'number' }, set)).not.toBe(h);
    expect(fieldHash({ ...price, description: 'red' }, set)).not.toBe(h);
    expect(fieldHash(price, { ...set, urls: [...set.urls].reverse() })).not.toBe(h);
    expect(fieldHash(price, { ...set, expected: { ...set.expected, price: { ...set.expected.price, 'https://s.example/1': '9' } } })).not.toBe(h);
    expect(fieldHash(price, { ...set, expected: { ...set.expected, title: { ...set.expected.title, 'https://s.example/1': 'zzz' } } })).toBe(h);
  });
});

describe('runVerification per-field copy-forward', () => {
  it('stamps fieldHash on every computed result and copies a previous result only when its hash still matches', async () => {
    const set: VerificationSet = {
      urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'],
      expected: {
        price: { 'https://s.example/1': '1', 'https://s.example/2': '2', 'https://s.example/3': '3' },
        title: { 'https://s.example/1': 'a', 'https://s.example/2': 'b', 'https://s.example/3': 'c' },
      },
    };
    const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' };
    const title: SchemaDefinitionField = { key: 'title', name: 'Title', type: 'text', description: 'h1', concept: 'product_name' };
    const stale: FieldVerification = { key: 'title', cells: {}, certified: [{ source: 'meta', path: 'og:title', transform: 'identity' }], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: 'not-the-current-hash' };
    const fresh: FieldVerification = { ...stale, fieldHash: fieldHash(title, set) };

    const deps = fakeDeps(set); // the file's existing helper: a browser stub whose captures return nothing, no agent
    const a = await runVerification({ fields: [price, title], verificationSet: set }, { ...deps, onlyKeys: ['price'], previous: { fields: { title: stale }, allPassed: false, aiCalls: 0 }, previousUrls: set.urls });
    expect(a.outcome.fields.title.fieldHash).toBe(fieldHash(title, set)); // recomputed, not copied
    expect(a.outcome.fields.title.certified).toEqual([]);                // the stub finds nothing, proving it re-ran
    expect(a.outcome.fields.price.fieldHash).toBe(fieldHash(price, set));

    const b = await runVerification({ fields: [price, title], verificationSet: set }, { ...deps, onlyKeys: ['price'], previous: { fields: { title: fresh }, allPassed: false, aiCalls: 0 }, previousUrls: set.urls });
    expect(b.outcome.fields.title).toBe(fresh);                          // copied as-is
  });
});
```

If the file has no `fakeDeps` helper, write one next to the other helpers in the file: it returns `{ browser: { setContentEvaluate: async () => [], capture: async (url) => ({ url, html: '<html></html>', title: '', markdown: '', screenshot: Buffer.alloc(0), screenshotTiles: [], timestamp: 0, structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] }) } as unknown as IBrowser, agent: null, captureOne: async (_b, url) => ({ ...same capture shape..., url }) }`. Look at how the existing tests in that file stub the browser and match their shape exactly.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/run-verification.test.ts`
Expected: FAIL: `fieldHash` is not exported; `definitionHash` with a renamed field differs.

- [ ] **Step 3: Implement**

In `packages/scraper/src/verify/types.ts`, add to `FieldVerification`:

```ts
  /** sha256 over this field's definition + the pages + its expected values; a result is current only while it matches (spec 4.4). Absent on rows written before phase 2. */
  fieldHash?: string;
```

In `packages/scraper/src/verify/run-verification.ts`, replace `definitionHash` with:

```ts
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Whole-definition hash, kept for history and the fast path. Excludes `name`: renaming is free (spec 4.3). */
export function definitionHash(fields: SchemaDefinitionField[], set: VerificationSet): string {
  return sha256(JSON.stringify({
    fields: fields.map((f) => ({ key: f.key, type: f.type, description: f.description, concept: f.concept })),
    urls: set.urls,
    expected: Object.fromEntries(Object.keys(set.expected).sort().map((k) => [k, Object.fromEntries(Object.entries(set.expected[k]!).sort())])),
    listing_url: set.listing_url ?? null,
  }));
}

/** Per-field hash (spec 4.4): the field's own definition, the pages, and only its expected cells. */
export function fieldHash(field: SchemaDefinitionField, set: VerificationSet): string {
  return sha256(JSON.stringify({
    key: field.key,
    type: field.type,
    description: field.description,
    concept: field.concept,
    urls: set.urls,
    expected: Object.fromEntries(Object.entries(set.expected[field.key] ?? {}).sort()),
  }));
}
```

In `runVerification`, replace the copy-forward block at the top of the `for (const field of req.fields)` loop with:

```ts
    const fh = fieldHash(field, req.verificationSet);
    const prev = deps.previous?.fields[field.key];
    if (reuseAllowed && deps.onlyKeys && !deps.onlyKeys.includes(field.key) && prev && prev.fieldHash === fh) {
      fields[field.key] = prev;
      continue;
    }
```

and at the end of the loop body, replace `fields[field.key] = result;` with `fields[field.key] = { ...result, fieldHash: fh };`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/ && pnpm --filter @robot/scraper typecheck`
Expected: PASS. If an existing test asserted that a result is copied forward without a `fieldHash` on the previous result, update that fixture to carry `fieldHash: fieldHash(field, set)`; say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts
git commit -m "feat(scraper): per-field verification hash; definition hash ignores the name"
```

---

### Task 2: Contract helpers and per-field certification currency

**Files:**
- Create: `packages/api/src/contract.ts`, `packages/api/src/contract.test.ts`
- Modify: `packages/api/src/verify/current-certification.ts`
- Modify: `packages/api/src/verify/current-certification.test.ts` (only the assertions named below; the setup moves to the helper in Task 5)

**Interfaces:**
- Produces:
  - `type ContractField = { key: string; name: string; type: CustomerFieldType; concept: string } & Record<string, unknown>`
  - `contractFields(schema: unknown): ContractField[]` — entries of a dataset schema that carry a `key`, in order.
  - `bindingFor(contract: ContractField[], descriptions?: Record<string, string>): SchemaDefinitionField[]` — one binding field per contract field, description from the map or `''`.
  - `loadFieldCurrency(db, sourceId): Promise<{ latest: { id: string; completedAt: Date; results: Record<string, FieldVerification> } | null; currentKeys: string[] }>`
  - `loadCurrentCertification(db, sourceId)` returns a `Certification` only when every field in `schema_definition` is in `currentKeys` (and the set has a parseable first url); shape unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/api/src/contract.test.ts
import { describe, it, expect } from 'vitest';
import { contractFields, bindingFor } from './contract.js';

describe('contractFields', () => {
  it('keeps only keyed entries, in order, with their legacy properties', () => {
    const schema = [
      { name: 'legacy', type: 'text', origin: 'listing' },
      { key: 'price', name: 'Price', type: 'money', concept: 'price', candidate: { concept: 'price', label: 'displayed' } },
      { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
    ];
    expect(contractFields(schema).map((f) => f.key)).toEqual(['price', 'title']);
    expect(contractFields(schema)[0]!.candidate).toEqual({ concept: 'price', label: 'displayed' });
  });
  it('is empty for a non-array or null schema', () => {
    expect(contractFields(null)).toEqual([]);
    expect(contractFields({ price: 'money' })).toEqual([]);
  });
});

describe('bindingFor', () => {
  it('copies key, name, type and concept and takes descriptions by key', () => {
    const contract = [{ key: 'price', name: 'Price', type: 'money' as const, concept: 'price' }];
    expect(bindingFor(contract, { price: 'green number' })).toEqual([{ key: 'price', name: 'Price', type: 'money', description: 'green number', concept: 'price' }]);
    expect(bindingFor(contract)[0]!.description).toBe('');
  });
});
```

And in `packages/api/src/verify/current-certification.test.ts` add one test to the existing describe (the file already creates a source with a schema and inserts `source_verifications` rows by hand; follow its pattern for inserting a row):

```ts
  it('loadFieldCurrency: a field is current only when the latest clean row holds a passing result with the present fieldHash', async () => {
    // setup: a source with fields price + title (see this file's existing fixture), then one completed row
    // whose results carry a matching fieldHash for price and a stale one for title.
    const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
    const fields = src!.schemaDefinition as SchemaDefinitionField[];
    const set = src!.verificationSet as VerificationSet;
    const pass = (key: string, fh: string) => ({
      key, fieldHash: fh, weakEvidence: false, aiCalled: false, incomplete: false,
      certified: [{ source: 'meta', path: 'x', transform: 'identity' }],
      cells: Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: '1', path: { source: 'meta', path: 'x', transform: 'identity' } }])),
    });
    await db.insert(sourceVerifications).values({
      sourceId, definitionHash: 'any', allPassed: false, completedAt: new Date(),
      results: { price: pass('price', fieldHash(fields[0]!, set)), title: pass('title', 'stale') },
    });
    const c = await loadFieldCurrency(db, sourceId);
    expect(c.currentKeys).toEqual(['price']);
    expect(await loadCurrentCertification(db, sourceId)).toBeNull(); // title is not current
  });
```

Import `fieldHash`, `SchemaDefinitionField`, `VerificationSet` from `@robot/scraper` and `loadFieldCurrency` from `./current-certification.js` in that test file.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @robot/api exec vitest run src/contract.test.ts src/verify/current-certification.test.ts`
Expected: FAIL: module `./contract.js` not found; `loadFieldCurrency` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/contract.ts
import type { CustomerFieldType, SchemaDefinitionField } from '@robot/scraper';

/**
 * The contract (spec 4.1): the project's field list, stored on its dataset.
 * Legacy dataset entries without a `key` (operator fields from the discovery
 * era) are preserved on every write but are not part of the contract.
 */
export type ContractField = { key: string; name: string; type: CustomerFieldType; concept: string } & Record<string, unknown>;

export function contractFields(schema: unknown): ContractField[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((f): f is ContractField => !!f && typeof f === 'object' && typeof (f as ContractField).key === 'string' && (f as ContractField).key.length > 0);
}

/** A website's binding rows for a contract (spec 4.2): name/type/concept copied, description the website's own. */
export function bindingFor(contract: ContractField[], descriptions: Record<string, string> = {}): SchemaDefinitionField[] {
  return contract.map((f) => ({ key: f.key, name: f.name, type: f.type, description: descriptions[f.key] ?? '', concept: f.concept }));
}
```

In `packages/api/src/verify/current-certification.ts`, add `fieldHash` to the `@robot/scraper` import and add before `loadCurrentCertification`:

```ts
/**
 * Per-field currency (spec 4.4). The latest completed, error-free run is the
 * only one consulted; a field is current when that run holds a passing result
 * for it whose `fieldHash` equals the hash of the field as it stands now.
 * Rows written before phase 2 carry no `fieldHash` and are never current.
 */
export async function loadFieldCurrency(db: Database, sourceId: string): Promise<{
  latest: { id: string; completedAt: Date; results: Record<string, FieldVerification> } | null;
  currentKeys: string[];
}> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return { latest: null, currentKeys: [] };
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  const row = await db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt)],
  });
  if (!row) return { latest: null, currentKeys: [] };
  const results = row.results as Record<string, FieldVerification>;

  const currentKeys = fields
    .filter((f) => {
      const r = results[f.key];
      if (!r || !r.fieldHash || r.fieldHash !== fieldHash(f, set)) return false;
      return r.certified.length > 0 && Object.values(r.cells).length > 0 && Object.values(r.cells).every((c) => c.status === 'pass');
    })
    .map((f) => f.key);

  return { latest: { id: row.id, completedAt: row.completedAt!, results }, currentKeys };
}
```

Add `isNull` to the `drizzle-orm` import. Then rewrite `loadCurrentCertification` to use it:

```ts
/** A certification exists only when EVERY contract field is current on this source (spec 4.4). */
export async function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  if (!source || !Array.isArray(source.schemaDefinition) || source.schemaDefinition.length === 0 || !source.verificationSet) return null;
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  const { latest, currentKeys } = await loadFieldCurrency(db, sourceId);
  if (!latest || currentKeys.length !== fields.length) return null;

  let hostname: string;
  try {
    hostname = new URL(set.urls[0]!).hostname;
  } catch {
    console.error(`[verify] source ${sourceId} has an unparseable verification url; treating it as uncertified`);
    return null;
  }

  return {
    verificationId: latest.id,
    completedAt: latest.completedAt,
    paths: Object.fromEntries(fields.map((f) => [f.key, latest.results[f.key]?.certified ?? []])),
    concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
    hostname,
  };
}
```

Keep `sourceDefinitionHash` exported (the `verify` procedure still writes `definitionHash` on each row).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/api exec vitest run src/contract.test.ts src/verify/current-certification.test.ts src/crawl/require-certification.test.ts && pnpm --filter @robot/api typecheck`
Expected: the two new tests pass. Existing tests in `current-certification.test.ts` and `require-certification.test.ts` that inserted rows with `allPassed: true` and a matching `definitionHash` but no `fieldHash` will now see `null`; update those fixtures to write `fieldHash: fieldHash(field, set)` into each result (the rule changed on purpose: spec 4.4/4.5). Name each changed test in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/contract.ts packages/api/src/contract.test.ts packages/api/src/verify/current-certification.ts packages/api/src/verify/current-certification.test.ts packages/api/src/crawl/require-certification.test.ts
git commit -m "feat(api): contract helpers; certification is current per field"
```

---

### Task 3: Dataset field procedures with propagation, and `fieldStatus`

**Files:**
- Modify: `packages/api/src/routers/datasets.ts`
- Create: `packages/api/src/routers/datasets-fields.test.ts`

**Interfaces:**
- Consumes: `contractFields`, `bindingFor` (Task 2); `loadFieldCurrency` (Task 2); `deriveKey`, `deriveConcept`, `CUSTOMER_FIELD_TYPES` from `@robot/scraper`; `projects.create` and `sources.createInProject` (phase 1) in tests.
- Produces:
  - `datasets.addField({ datasetId, name, type }) → { key, name, type, concept, affectedSourceIds: string[] }`
  - `datasets.renameField({ datasetId, key, name }) → { key, name, affectedSourceIds }`
  - `datasets.retypeField({ datasetId, key, type }) → { key, type, affectedSourceIds }`; `PRECONDITION_FAILED` when any source in the dataset has `key` in `currentKeys`.
  - `datasets.deleteField({ datasetId, key }) → { key, affectedSourceIds }`
  - `datasets.fieldStatus({ datasetId }) → Record<key, { verified: number; total: number; websites: Array<{ sourceId, slug, name, verified: boolean }> }>`
  - `datasets.updateSchema` preserves `key` and `concept` on each entry.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/api/src/routers/datasets-fields.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, projects, datasets, sources, inputSets, sourceVerifications } from '@robot/db';
import { fieldHash, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const projectIds: string[] = [];
afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

async function project(name = 'Fields') {
  const p = await caller.projects.create({ name });
  projectIds.push(p.id);
  return p;
}

describe('datasets.addField', () => {
  it('mints a key and concept, appends to the contract, and gives every website the field with an empty description and empty cells', async () => {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    const r = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    expect(r).toMatchObject({ key: 'price', name: 'Price', type: 'money', concept: 'price' });
    expect(r.affectedSourceIds).toEqual([a.sourceId]);
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect(ds?.schema).toEqual([{ key: 'price', name: 'Price', type: 'money', concept: 'price' }]);
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect(s?.schemaDefinition).toEqual([{ key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' }]);
  });
  it('rejects a duplicate name, case-insensitively, and the reserved detail_url name', async () => {
    const p = await project();
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await expect(caller.datasets.addField({ datasetId: p.datasetId, name: 'price', type: 'text' })).rejects.toThrow(/already/i);
    await expect(caller.datasets.addField({ datasetId: p.datasetId, name: 'detail_url', type: 'url' })).rejects.toThrow(/reserved/i);
  });
  it('keeps legacy unkeyed entries in the dataset schema', async () => {
    const p = await project();
    await db.update(datasets).set({ schema: [{ name: 'legacy', type: 'text', origin: 'listing' }] }).where(eq(datasets.id, p.datasetId));
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect((ds?.schema as unknown[]).length).toBe(2);
    expect((ds?.schema as Array<{ name: string }>)[0]!.name).toBe('legacy');
  });
});

describe('datasets.renameField / retypeField / deleteField', () => {
  async function seeded() {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    return { p, a, f };
  }
  it('rename copies to every website and never touches the key', async () => {
    const { p, a, f } = await seeded();
    await caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect((s?.schemaDefinition as SchemaDefinitionField[])[0]).toMatchObject({ key: 'price', name: 'Cost' });
  });
  it('retype is refused while a website has a current certification for the field', async () => {
    const { p, a, f } = await seeded();
    const urls = ['https://a.example/p/1', 'https://a.example/p/2', 'https://a.example/p/3'];
    await caller.sources.updateBinding({ sourceId: a.sourceId, urls, descriptions: { price: 'green' }, expected: { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } } });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    const field = (s!.schemaDefinition as SchemaDefinitionField[])[0]!;
    const set = s!.verificationSet as VerificationSet;
    await db.insert(sourceVerifications).values({
      sourceId: a.sourceId, definitionHash: 'x', allPassed: true, completedAt: new Date(),
      results: { price: { key: 'price', fieldHash: fieldHash(field, set), certified: [{ source: 'meta', path: 'p', transform: 'identity' }], weakEvidence: false, aiCalled: false, incomplete: false,
        cells: Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: { source: 'meta', path: 'p', transform: 'identity' } }])) } },
    });
    await expect(caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
  it('retype propagates when nothing is certified', async () => {
    const { p, a, f } = await seeded();
    await caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect((s?.schemaDefinition as SchemaDefinitionField[])[0]!.type).toBe('text');
  });
  it('delete removes the field from the contract, every binding and every verification set', async () => {
    const { p, a, f } = await seeded();
    const urls = ['https://a.example/p/1', 'https://a.example/p/2', 'https://a.example/p/3'];
    await caller.sources.updateBinding({ sourceId: a.sourceId, urls, descriptions: { price: 'green' }, expected: { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } } });
    const r = await caller.datasets.deleteField({ datasetId: p.datasetId, key: f.key });
    expect(r.affectedSourceIds).toEqual([a.sourceId]);
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect(s?.schemaDefinition).toEqual([]);
    expect((s?.verificationSet as VerificationSet).expected).toEqual({});
  });
});

describe('datasets.fieldStatus', () => {
  it('reports verified-on counts per field', async () => {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'B', url: 'https://b.example/' });
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    const status = await caller.datasets.fieldStatus({ datasetId: p.datasetId });
    expect(status[f.key]).toMatchObject({ verified: 0, total: 2 });
    expect(status[f.key]!.websites.map((w) => w.sourceId)).toContain(a.sourceId);
  });
});

describe('datasets.updateSchema keeps keys', () => {
  it('does not drop key or concept when an operator saves origins', async () => {
    const p = await project();
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await caller.datasets.updateSchema({ datasetId: p.datasetId, schema: [{ key: f.key, name: 'Price', type: 'money', concept: 'price', origin: 'detail' }] });
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect((ds?.schema as Array<Record<string, unknown>>)[0]).toMatchObject({ key: 'price', concept: 'price', origin: 'detail' });
  });
});
```

Note: the `retype refused` and `delete` tests call `sources.updateBinding`, which Task 4 adds. Run this file after Task 4; until then run it with `-t "addField|rename|propagates|fieldStatus|keeps keys"`.

- [ ] **Step 2: Run the runnable subset to see it fail**

Run: `pnpm --filter @robot/api exec vitest run src/routers/datasets-fields.test.ts -t "addField|rename|propagates|fieldStatus|keeps keys"`
Expected: FAIL: `addField` is not a procedure.

- [ ] **Step 3: Implement**

In `packages/api/src/routers/datasets.ts`, add imports:

```ts
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';
import { CUSTOMER_FIELD_TYPES, DETAIL_URL_FIELD, deriveConcept, deriveKey, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { contractFields, type ContractField } from '../contract.js';
import { loadFieldCurrency } from '../verify/current-certification.js';
```

Extend `datasetSchemaFieldSchema` with `key: z.string().optional(), concept: z.string().optional()` so `updateSchema` round-trips them (Zod strips unknown keys by default).

Add these helpers above the router:

```ts
async function loadDataset(db: Database, datasetId: string) {
  const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, datasetId), with: { sources: { columns: { id: true, slug: true, name: true, schemaDefinition: true, verificationSet: true } } } });
  if (!ds) throw new TRPCError({ code: 'NOT_FOUND', message: `Dataset ${datasetId} not found` });
  return ds;
}

function assertNameFree(contract: ContractField[], name: string, exceptKey?: string) {
  const lower = name.trim().toLowerCase();
  if (contract.some((f) => f.key !== exceptKey && f.name.trim().toLowerCase() === lower)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `A field named "${name}" already exists` });
  }
  if (deriveKey(name, new Set()) === DETAIL_URL_FIELD) throw new TRPCError({ code: 'BAD_REQUEST', message: `"${name}" is reserved` });
}

/** Apply `patch` to the source's binding + verification set for one key, or remove it when `patch` is null. */
async function propagate(
  tx: Database,
  srcs: Array<{ id: string; schemaDefinition: unknown; verificationSet: unknown }>,
  key: string,
  patch: Partial<SchemaDefinitionField> | { add: SchemaDefinitionField } | null,
): Promise<string[]> {
  const affected: string[] = [];
  for (const s of srcs) {
    const def = (Array.isArray(s.schemaDefinition) ? s.schemaDefinition : []) as SchemaDefinitionField[];
    const set = (s.verificationSet ?? null) as VerificationSet | null;
    let nextDef: SchemaDefinitionField[];
    let nextSet = set;
    if (patch === null) {
      nextDef = def.filter((f) => f.key !== key);
      if (set) nextSet = { ...set, expected: Object.fromEntries(Object.entries(set.expected).filter(([k]) => k !== key)) };
    } else if ('add' in patch) {
      if (def.some((f) => f.key === key)) continue;
      nextDef = [...def, patch.add];
      if (set) nextSet = { ...set, expected: { ...set.expected, [key]: Object.fromEntries(set.urls.map((u) => [u, ''])) } };
    } else {
      nextDef = def.map((f) => (f.key === key ? { ...f, ...patch } : f));
    }
    await tx.update(sources).set({ schemaDefinition: nextDef, verificationSet: nextSet, updatedAt: new Date() }).where(eq(sources.id, s.id));
    affected.push(s.id);
  }
  return affected;
}
```

Import `Database` as a type from `@robot/db` and `sources` (already imported). Then add the procedures to the router:

```ts
  /** Spec 4.3: add a field to the project's contract; every website gets it empty. */
  addField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), name: z.string().trim().min(1).max(100), type: z.enum(CUSTOMER_FIELD_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      const contract = contractFields(schema);
      assertNameFree(contract, input.name);
      const key = deriveKey(input.name, new Set(contract.map((f) => f.key)));
      const concept = deriveConcept(input.name, input.type);
      const field: ContractField = { key, name: input.name, type: input.type, concept };
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: [...schema, field], updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx as unknown as Database, ds.sources, key, { add: { key, name: input.name, type: input.type, description: '', concept } });
      });
      return { key, name: input.name, type: input.type, concept, affectedSourceIds };
    }),

  renameField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      const contract = contractFields(schema);
      if (!contract.some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
      assertNameFree(contract, input.name, input.key);
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, name: input.name } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx as unknown as Database, ds.sources, input.key, { name: input.name });
      });
      return { key: input.key, name: input.name, affectedSourceIds };
    }),

  /** Refused while any website has a current certification for the field (spec 4.3). Concept is left alone: it is the cache bridge. */
  retypeField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), type: z.enum(CUSTOMER_FIELD_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      if (!contractFields(schema).some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
      for (const s of ds.sources) {
        const { currentKeys } = await loadFieldCurrency(ctx.db, s.id);
        if (currentKeys.includes(input.key)) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${s.name} has verified this field; delete and re-add it to change its type` });
        }
      }
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, type: input.type } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx as unknown as Database, ds.sources, input.key, { type: input.type });
      });
      return { key: input.key, type: input.type, affectedSourceIds };
    }),

  deleteField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      if (!contractFields(schema).some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: schema.filter((f) => f.key !== input.key), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx as unknown as Database, ds.sources, input.key, null);
      });
      return { key: input.key, affectedSourceIds };
    }),

  /** "Verified on n of m websites" per field, for the project home (spec 5.3). */
  fieldStatus: publicProcedure
    .input(z.object({ datasetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const contract = contractFields(ds.schema);
      const perSource = await Promise.all(ds.sources.map(async (s) => ({ s, currentKeys: new Set((await loadFieldCurrency(ctx.db, s.id)).currentKeys) })));
      const out: Record<string, { verified: number; total: number; websites: Array<{ sourceId: string; slug: string; name: string; verified: boolean }> }> = {};
      for (const f of contract) {
        const websites = perSource.map(({ s, currentKeys }) => ({ sourceId: s.id, slug: s.slug, name: s.name, verified: currentKeys.has(f.key) }));
        out[f.key] = { verified: websites.filter((w) => w.verified).length, total: websites.length, websites };
      }
      return out;
    }),
```

If Drizzle's transaction type does not accept the `as unknown as Database` cast cleanly, type `propagate`'s first parameter as `Pick<Database, 'update'>` instead; the calls used are only `update(...).set(...).where(...)`.

- [ ] **Step 4: Run the runnable subset and typecheck**

Run: `pnpm --filter @robot/api exec vitest run src/routers/datasets-fields.test.ts -t "addField|rename|propagates|fieldStatus|keeps keys" && pnpm --filter @robot/api typecheck`
Expected: PASS for those; the two `updateBinding` tests run green after Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-fields.test.ts
git commit -m "feat(api): dataset field procedures propagate to every website; per-field status"
```

---

### Task 4: `sources.updateBinding`, `createInProject` seeds the contract, `verificationStatus.currentKeys`

**Files:**
- Create: `packages/api/src/verify/http-url.ts` (move `httpUrl` here), `packages/api/src/verify/binding-input.ts`, `packages/api/src/verify/binding-input.test.ts`
- Modify: `packages/api/src/routers/sources.ts` (replace `updateSchema` with `updateBinding`; `createInProject` seeds fields; `verificationStatus` adds `currentKeys` and computes `current` from it; `verifyEstimate` unchanged; `findProductPages` imports `httpUrl` from the new file)
- Create: `packages/api/src/routers/sources-binding.test.ts`
- Modify: `packages/api/src/routers/sources-project.test.ts` (its `updateSchema` tests become `updateBinding` tests: same scenarios, new input shape)

`createWithSchema`, `quickCreate` and `schema-input.ts` are removed in Task 5, not here, so the other test files keep compiling until their setup moves.

**Interfaces:**
- Produces:
  - `httpUrl` from `packages/api/src/verify/http-url.ts` (same definition as today).
  - `bindingInput = z.object({ sourceId: uuid, urls: z.array(httpUrl).length(VERIFY_URL_COUNT), listingUrl: httpUrl.optional(), descriptions: z.record(z.string(), z.string().trim().max(1000)), expected: z.record(z.string(), z.record(z.string(), z.string())) })`
  - `bindingProblems(input, contract): string[]` and `prepareBinding(input, contract): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet }`
  - `sources.updateBinding(bindingInput)` → the updated source row; same in-flight refusal, confirmed-lock and input-set ownership rules as `updateSchema` had.
  - `sources.createInProject` seeds `schema_definition` with `bindingFor(contract)` when the contract is non-empty, else `null`.
  - `sources.verificationStatus` returns `currentKeys: string[]` and `current = currentKeys.length === fields.length && fields.length > 0`.

- [ ] **Step 1: Write the failing pure tests**

```ts
// packages/api/src/verify/binding-input.test.ts
import { describe, it, expect } from 'vitest';
import { bindingProblems, prepareBinding } from './binding-input.js';
import type { ContractField } from '../contract.js';

const U = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
const contract: ContractField[] = [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }, { key: 'title', name: 'Title', type: 'text', concept: 'product_name' }];
const ok = {
  sourceId: '00000000-0000-0000-0000-000000000000', urls: U,
  descriptions: { price: 'green', title: 'h1' },
  expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' }, title: { [U[0]!]: 'a', [U[1]!]: 'b', [U[2]!]: 'c' } },
};

describe('bindingProblems', () => {
  it('is clean for a complete binding', () => expect(bindingProblems(ok, contract)).toEqual([]));
  it('names every gap', () => {
    expect(bindingProblems({ ...ok, urls: [U[0]!, U[1]!, 'https://other.example/p'] }, contract)).toContain('All URLs must be on the same website');
    expect(bindingProblems({ ...ok, urls: [U[0]!, U[0]!, U[2]!] }, contract)).toContain('URLs must be different pages');
    expect(bindingProblems({ ...ok, descriptions: { price: 'green' } }, contract)).toContain('Title: say where it is on this website');
    expect(bindingProblems({ ...ok, expected: { ...ok.expected, price: { [U[0]!]: 'call us', [U[1]!]: '2', [U[2]!]: '3' } } }, contract)).toEqual(expect.arrayContaining([expect.stringContaining('Price @ https://shop.example/p/1: Not a money amount')]));
    expect(bindingProblems({ ...ok, expected: { ...ok.expected, title: { [U[0]!]: '', [U[1]!]: 'b', [U[2]!]: 'c' } } }, contract)).toEqual(expect.arrayContaining([expect.stringContaining('Title @ https://shop.example/p/1: Expected value is required')]));
  });
  it('ignores keys that are not in the contract', () => {
    expect(bindingProblems({ ...ok, descriptions: { ...ok.descriptions, ghost: 'x' }, expected: { ...ok.expected, ghost: {} } }, contract)).toEqual([]);
  });
});

describe('prepareBinding', () => {
  it('builds the binding in contract order and the verification set keyed by contract key', () => {
    const r = prepareBinding({ ...ok, listingUrl: 'https://shop.example/all' }, contract);
    expect(r.fields).toEqual([
      { key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' },
      { key: 'title', name: 'Title', type: 'text', description: 'h1', concept: 'product_name' },
    ]);
    expect(r.verificationSet).toEqual({ urls: U, expected: ok.expected, listing_url: 'https://shop.example/all' });
  });
});
```

And in `packages/api/src/routers/sources-binding.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, sources, inputSets, sourceVerifications } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const projectIds: string[] = [];
afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});
const U = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];

async function seeded() {
  const p = await caller.projects.create({ name: 'Binding' });
  projectIds.push(p.id);
  await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
  const s = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://shop.example/' });
  return { p, s };
}

describe('sources.createInProject seeds the contract', () => {
  it('gives a new website every contract field with an empty description', async () => {
    const { s } = await seeded();
    const row = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) });
    expect(row?.schemaDefinition).toEqual([{ key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' }]);
    expect(row?.verificationSet).toBeNull();
  });
});

describe('sources.updateBinding', () => {
  it('writes descriptions, pages and expected values keyed by contract key, and creates the detail input set', async () => {
    const { s } = await seeded();
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    const row = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), with: { inputSet: true } });
    expect(row?.schemaDefinition).toEqual([{ key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' }]);
    expect(row?.verificationSet).toEqual({ urls: U, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    expect(row?.listingMode).toBe('detail');
    expect(row?.inputSet?.rows).toEqual(U.map((url) => ({ url })));
  });
  it('rejects a binding that leaves a contract field without a description or a cell', async () => {
    const { s } = await seeded();
    await expect(caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: {}, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } })).rejects.toThrow(/say where it is/);
  });
  it('cannot change name or type: the contract wins on every save', async () => {
    const { s, p } = await seeded();
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    await caller.datasets.renameField({ datasetId: p.datasetId, key: 'price', name: 'Cost' });
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green!' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    const row = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) });
    expect((row?.schemaDefinition as Array<{ name: string; description: string }>)[0]).toMatchObject({ name: 'Cost', description: 'green!' });
  });
});

describe('sources.verificationStatus.currentKeys', () => {
  it('is empty for a never-verified website and current is false', async () => {
    const { s } = await seeded();
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), results: {} });
    const st = await caller.sources.verificationStatus({ sourceId: s.sourceId });
    expect(st?.currentKeys).toEqual([]);
    expect(st?.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts src/routers/sources-binding.test.ts`
Expected: FAIL: modules not found; `updateBinding` not a procedure.

- [ ] **Step 3: Implement**

Create `packages/api/src/verify/http-url.ts` by moving the `httpUrl` export (with its comment) out of `schema-input.ts`; in `schema-input.ts` replace the definition with `export { httpUrl } from './http-url.js';` for now (Task 5 deletes the file).

```ts
// packages/api/src/verify/binding-input.ts
// A website's binding (spec 4.2): where each contract field is on this
// website, the three proof pages, and the expected values. Name and type are
// never accepted here; they come from the contract.
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { VERIFY_URL_COUNT, normalize, validateExpected, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { httpUrl } from './http-url.js';
import { bindingFor, type ContractField } from '../contract.js';

export const bindingInput = z.object({
  sourceId: z.string().uuid(),
  urls: z.array(httpUrl).length(VERIFY_URL_COUNT),
  listingUrl: httpUrl.optional(),
  descriptions: z.record(z.string(), z.string().trim().max(1000)),
  expected: z.record(z.string(), z.record(z.string(), z.string())),
});
export type BindingInput = z.infer<typeof bindingInput>;

const host = (u: string) => new URL(u).hostname.toLowerCase();

export function bindingProblems(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[]): string[] {
  const problems: string[] = [];
  const hosts = new Set(input.urls.map(host));
  if (input.listingUrl) hosts.add(host(input.listingUrl));
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  if (new Set(input.urls.map((u) => normalize('url', u))).size !== input.urls.length) problems.push('URLs must be different pages');
  for (const f of contract) {
    if (!(input.descriptions[f.key] ?? '').trim()) problems.push(`${f.name}: say where it is on this website`);
    const cells = input.expected[f.key] ?? {};
    for (const url of input.urls) {
      const err = validateExpected(f.type, cells[url] ?? '');
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    }
  }
  return problems;
}

/** Throws BAD_REQUEST with the problem list; otherwise the binding rows and the verification set. */
export function prepareBinding(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[]): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet } {
  const problems = bindingProblems(input, contract);
  if (problems.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join('\n') });
  const fields = bindingFor(contract, Object.fromEntries(contract.map((f) => [f.key, (input.descriptions[f.key] ?? '').trim()])));
  const expected: VerificationSet['expected'] = Object.fromEntries(contract.map((f) => [f.key, Object.fromEntries(input.urls.map((u) => [u, input.expected[f.key]?.[u] ?? '']))]));
  return { fields, verificationSet: { urls: input.urls, expected, ...(input.listingUrl ? { listing_url: input.listingUrl } : {}) } };
}
```

In `packages/api/src/routers/sources.ts`:

1. Imports: replace `import { schemaInput, prepareSchema, httpUrl } from '../verify/schema-input.js';` with `import { httpUrl } from '../verify/http-url.js';`, `import { bindingInput, prepareBinding } from '../verify/binding-input.js';`, `import { contractFields, bindingFor } from '../contract.js';`, and add `loadFieldCurrency` to the `../verify/current-certification.js` import.
2. In `createInProject`, load the dataset's schema when resolving `datasetId` (the `with: { datasets: … }` already fetches rows; add `columns: { id: true, schema: true }` to that relation, or read `project.datasets[0]?.schema`). After `datasetId` is known, compute `const contract = contractFields(datasetSchema); const schemaDefinition = contract.length > 0 ? bindingFor(contract) : null;` and include `schemaDefinition` in the insert values.
3. Replace the whole `updateSchema` procedure with `updateBinding`. It is the same body with these changes: `.input(bindingInput)`; destructure `const { sourceId, ...binding } = input;`; load the source `with: { dataset: { columns: { projectId: true, schema: true } }, inputSet: { columns: { rows: true } } }`; compute `const contract = contractFields(source.dataset?.schema); if (contract.length === 0) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add fields to the project before describing this website' });`; `const { rows, listingMode } = inputRowsFor(binding.urls, binding.listingUrl);`; `const { fields, verificationSet } = prepareBinding(binding, contract);`; the rest (in-flight refusal, confirmed lock, transaction, input-set ownership, budget patch) verbatim. Update the doc comment to say it writes the binding only.
4. In `verificationStatus`, replace the `currentHash` computation and the `current` field with:

```ts
      const { currentKeys } = await loadFieldCurrency(ctx.db, input.sourceId);
      const fieldCount = source && Array.isArray(source.schemaDefinition) ? source.schemaDefinition.length : 0;
      // ...
        currentKeys,
        current: fieldCount > 0 && currentKeys.length === fieldCount,
```

(`sourceDefinitionHash` stays imported for `verify`.)

- [ ] **Step 4: Rewrite the `updateSchema` tests in `sources-project.test.ts`**

Each `caller.sources.updateSchema({ sourceId, urls, fields, expected })` becomes: first `await caller.datasets.addField({ datasetId: p.datasetId, name: 'price', type: 'money' })` once per project (the helper `freshProject` can do it), then `caller.sources.updateBinding({ sourceId, urls, descriptions: { price: 'the price' }, expected })` with `expected` keyed by `price`. The assertions on `listingMode`, input-set rows, budget, the confirmed lock, and the foreign-rows guard stay exactly as they are.

- [ ] **Step 5: Run and typecheck**

Run: `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts src/routers/sources-binding.test.ts src/routers/sources-project.test.ts src/routers/datasets-fields.test.ts && pnpm --filter @robot/api typecheck`
Expected: PASS, including the two `datasets-fields` tests that needed `updateBinding`. Typecheck will fail on `sources-schema.test.ts` and others that still call `updateSchema`; that is Task 5's job. If Vitest's typecheck is not part of `vitest run`, note the `tsc` failures and continue.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/verify/http-url.ts packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts packages/api/src/verify/schema-input.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-binding.test.ts packages/api/src/routers/sources-project.test.ts
git commit -m "feat(api): sources.updateBinding owns the website's binding; createInProject seeds the contract; per-field currentKeys"
```

---

### Task 5: Remove the wizard-era procedures and move test setup to one helper

**Files:**
- Create: `packages/api/src/test-helpers/customer-source.ts`
- Delete: `packages/api/src/verify/schema-input.ts` (and its `schemaInput`/`prepareSchema` tests inside `sources-schema.test.ts`)
- Modify: `packages/api/src/routers/sources.ts` (remove `createWithSchema`, `quickCreate`, `getScratchProjectId`, `getOrCreateScratchDataset`, `insertScratchDatasetIfAbsent`, `slugifyDomain`, `shortRandomSuffix`, `SCRATCH_SLUG` if nothing else uses them; keep `inputRowsFor` and `LISTING_DEFAULT_BUDGET`)
- Modify: `packages/api/src/routers/sources-schema.test.ts`, `sources.test.ts`, `sources-verify.test.ts`, `crawl/require-certification.test.ts`, `verify/current-certification.test.ts`, `verify/run-source-verification.test.ts`

**Interfaces:**
- Produces: `createProjectWithSource(caller, opts: { tag: string; fields: Array<{ name: string; type: CustomerFieldType; description?: string }>; urls?: string[]; listingUrl?: string; expected?: Record<name, Record<url, string>> }) → { projectId, datasetId, projectSlug, sourceId, sourceSlug, urls, keys: Record<name, key>, cleanup(): Promise<void> }`. When `expected` is given it calls `updateBinding` so the source has a verification set; when omitted the source has fields but no binding.

- [ ] **Step 1: Write the helper**

```ts
// packages/api/src/test-helpers/customer-source.ts
// The one way tests build a project + website with a contract and, optionally,
// a binding. Replaces the wizard-era `createWithSchema`/`quickCreate` setup.
import { eq } from 'drizzle-orm';
import { db, projects, inputSets } from '@robot/db';
import type { CustomerFieldType } from '@robot/scraper';
import type { createCallerFactory } from '../trpc.js';
import type { appRouter } from '../routers/index.js';

type Caller = ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>;

export async function createProjectWithSource(caller: Caller, opts: {
  tag: string;
  fields: Array<{ name: string; type: CustomerFieldType; description?: string }>;
  urls?: string[];
  listingUrl?: string;
  expected?: Record<string, Record<string, string>>;
}) {
  const host = `test-${opts.tag}.example.com`;
  const urls = opts.urls ?? [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  const p = await caller.projects.create({ name: `Test ${opts.tag}` });
  const keys: Record<string, string> = {};
  for (const f of opts.fields) {
    const r = await caller.datasets.addField({ datasetId: p.datasetId, name: f.name, type: f.type });
    keys[f.name] = r.key;
  }
  const s = await caller.sources.createInProject({ projectSlug: p.slug, name: `Site ${opts.tag}`, url: urls[0]! });
  if (opts.expected) {
    await caller.sources.updateBinding({
      sourceId: s.sourceId,
      urls,
      ...(opts.listingUrl ? { listingUrl: opts.listingUrl } : {}),
      descriptions: Object.fromEntries(opts.fields.map((f) => [keys[f.name]!, f.description ?? `where ${f.name} is`])),
      expected: Object.fromEntries(Object.entries(opts.expected).map(([name, cells]) => [keys[name] ?? name, cells])),
    });
  }
  return {
    projectId: p.id, datasetId: p.datasetId, projectSlug: p.slug, sourceId: s.sourceId, sourceSlug: s.sourceSlug, urls, keys,
    cleanup: async () => {
      await db.delete(inputSets).where(eq(inputSets.projectId, p.id));
      await db.delete(projects).where(eq(projects.id, p.id));
    },
  };
}
```

- [ ] **Step 2: Remove the procedures**

In `sources.ts` delete `createWithSchema`, `quickCreate`, and the Scratch helper functions plus the comment block above them; delete `packages/api/src/verify/schema-input.ts`. Run `pnpm --filter @robot/api typecheck` and follow every error: each is a test still using the removed surface.

- [ ] **Step 3: Migrate each test file**

Rules, applied file by file:
- Replace every `caller.sources.createWithSchema({ urls, fields, expected })` with `const f = await createProjectWithSource(caller, { tag: '<unique>', fields, urls, expected })` and use `f.sourceId`; register `f.cleanup` in the file's `afterEach`/cleanup list instead of `cleanupSource`.
- Replace every `caller.sources.quickCreate({ mode, urls })` used as setup for another procedure with `createProjectWithSource(caller, { tag, fields: [{ name: 'Price', type: 'money' }], urls, ...(mode === 'listing' ? { listingUrl: urls[0] } : {}), expected: { Price: { [u1]: '1', [u2]: '2', [u3]: '3' } } })`; where the test relied on a 50-row input set, insert the input set directly with `db.insert(inputSets)` and point the source at it.
- Delete tests whose subject was `createWithSchema`, `quickCreate`, `insertScratchDatasetIfAbsent`, `getOrCreateScratchDataset`, `prepareSchema` or `schemaProblems` (the `binding-input.test.ts` from Task 4 covers the pure logic now). Keep tests of `confirm`, `delete`, `verify`, `verificationStatus`, `verifyEstimate`, `findProductPages`, `requireCertification`, `loadCurrentCertification`, `runSourceVerification`.
- `updateSchema` calls in the remaining tests become `updateBinding` calls per Task 4's Step 4 pattern (`descriptions` by key, `expected` by key from `f.keys`).
- The smoke-style comment blocks that explain "the same procedure the NewSource wizard calls" are deleted with the tests.

- [ ] **Step 4: Run the api suite**

Run: `pnpm --filter @robot/api typecheck && pnpm --filter @robot/api test`
Expected: green. Report the count of deleted tests per file in the report.

- [ ] **Step 5: Commit**

```bash
git add -A packages/api/src
git commit -m "refactor(api): remove createWithSchema and quickCreate; tests build customer sources through the contract"
```

---

### Task 6: Lift script

**Files:**
- Create: `packages/db/src/scripts/lift-contracts.ts`, `packages/db/src/scripts/lift-contracts.test.ts`
- Modify: `packages/db/package.json` (`"lift:contracts": "tsx src/scripts/lift-contracts.ts"`), root `package.json` (`"db:lift-contracts": "pnpm --filter @robot/db run lift:contracts"`)

**Interfaces:**
- Produces: `liftContracts(db): Promise<{ datasetsUpdated: number; projectsGivenDataset: number; conflicts: Array<{ datasetId: string; key: string; kept: string; ignored: string; sourceId: string }> }>` exported for tests; the script runs it and prints the summary.

Rules (spec 4.5):
1. Every project without a dataset gets one named after the project (slug = project slug).
2. For each dataset, for each source in it with an array `schema_definition`: for each field, if the dataset already has a keyed entry with that `key`, compare `type`; on mismatch record a conflict and leave the dataset's type. If no keyed entry has that key but an unkeyed legacy entry has the same `name` (case-insensitive), attach `key`, `type`, `concept` to that entry. Otherwise append `{ key, name, type, concept }`. Same key, different name: the first name wins (the dataset's).
3. Sources are not modified.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/scripts/lift-contracts.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources } from '../index.js';
import { liftContracts } from './lift-contracts.js';

const created: string[] = [];
afterEach(async () => { for (const id of created.splice(0)) await db.delete(projects).where(eq(projects.id, id)); });

describe('liftContracts', () => {
  it('lifts per-source fields into the dataset, flags type disagreements, and gives dataset-less projects one', async () => {
    const org = await db.query.orgs.findFirst({ where: eq(orgs.slug, 'default') });
    const [p] = await db.insert(projects).values({ orgId: org!.id, name: 'Lift', slug: `lift-${Date.now()}` }).returning();
    created.push(p!.id);
    const [ds] = await db.insert(datasets).values({ projectId: p!.id, name: 'Lift', slug: `lift-${Date.now()}`, schema: [{ name: 'Title', type: 'text', origin: 'listing' }] }).returning();
    const field = (key: string, name: string, type: string) => ({ key, name, type, description: 'x', concept: key });
    await db.insert(sources).values([
      { datasetId: ds!.id, name: 'a', slug: 'a', country: 'us', schemaDefinition: [field('price', 'Price', 'money'), field('title', 'Title', 'text')] },
      { datasetId: ds!.id, name: 'b', slug: 'b', country: 'us', schemaDefinition: [field('price', 'Price', 'number')] },
    ]);
    const [bare] = await db.insert(projects).values({ orgId: org!.id, name: 'Bare', slug: `bare-${Date.now()}` }).returning();
    created.push(bare!.id);

    const r = await liftContracts(db);
    const lifted = await db.query.datasets.findFirst({ where: eq(datasets.id, ds!.id) });
    expect(lifted?.schema).toEqual([
      { name: 'Title', type: 'text', origin: 'listing', key: 'title', concept: 'title' },
      { key: 'price', name: 'Price', type: 'money', concept: 'price' },
    ]);
    expect(r.conflicts).toEqual([{ datasetId: ds!.id, key: 'price', kept: 'money', ignored: 'number', sourceId: expect.any(String) }]);
    const bareDs = await db.query.datasets.findMany({ where: eq(datasets.projectId, bare!.id) });
    expect(bareDs.map((d) => d.name)).toEqual(['Bare']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @robot/db exec vitest run src/scripts/lift-contracts.test.ts`
Expected: FAIL: module not found.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/scripts/lift-contracts.ts
// One-off (spec 4.5): lift each website's field list into its project's dataset.
import { eq } from 'drizzle-orm';
import { db, projects, datasets, sources } from '../index.js';
import type { Database } from '../index.js';

type Field = { key: string; name: string; type: string; description?: string; concept: string };
type Entry = Record<string, unknown> & { key?: string; name?: string; type?: string; concept?: string };

export async function liftContracts(database: Database) {
  const conflicts: Array<{ datasetId: string; key: string; kept: string; ignored: string; sourceId: string }> = [];
  let projectsGivenDataset = 0;
  let datasetsUpdated = 0;

  const allProjects = await database.query.projects.findMany({ with: { datasets: { columns: { id: true } } } });
  for (const p of allProjects) {
    if (p.datasets.length === 0) {
      await database.insert(datasets).values({ projectId: p.id, name: p.name, slug: p.slug, schema: [] });
      projectsGivenDataset++;
    }
  }

  const allDatasets = await database.query.datasets.findMany({ with: { sources: { columns: { id: true, schemaDefinition: true } } } });
  for (const ds of allDatasets) {
    const schema: Entry[] = Array.isArray(ds.schema) ? [...(ds.schema as Entry[])] : [];
    let changed = false;
    for (const s of ds.sources) {
      if (!Array.isArray(s.schemaDefinition)) continue;
      for (const f of s.schemaDefinition as Field[]) {
        const keyed = schema.find((e) => e.key === f.key);
        if (keyed) {
          if (keyed.type !== f.type) conflicts.push({ datasetId: ds.id, key: f.key, kept: String(keyed.type), ignored: f.type, sourceId: s.id });
          continue;
        }
        const legacy = schema.find((e) => !e.key && typeof e.name === 'string' && e.name.toLowerCase() === f.name.toLowerCase());
        if (legacy) { legacy.key = f.key; legacy.type = f.type; legacy.concept = f.concept; }
        else schema.push({ key: f.key, name: f.name, type: f.type, concept: f.concept });
        changed = true;
      }
    }
    if (changed) {
      await database.update(datasets).set({ schema, updatedAt: new Date() }).where(eq(datasets.id, ds.id));
      datasetsUpdated++;
    }
  }
  return { datasetsUpdated, projectsGivenDataset, conflicts };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/lift-contracts.ts');
if (isMain) {
  liftContracts(db).then((r) => {
    console.log(`datasets updated: ${r.datasetsUpdated}; projects given a dataset: ${r.projectsGivenDataset}`);
    for (const c of r.conflicts) console.log(`conflict: dataset ${c.datasetId} field ${c.key}: kept ${c.kept}, ignored ${c.ignored} from source ${c.sourceId} (review by hand)`);
    process.exit(0);
  }).catch((err) => { console.error(err); process.exit(1); });
}
```

Confirm `Database` is exported from `packages/db/src/index.ts` (the api imports it from `@robot/db`, so it is). Add the two package scripts.

- [ ] **Step 4: Run the test, then run the script once against the dev database**

Run: `pnpm --filter @robot/db exec vitest run src/scripts/lift-contracts.test.ts && pnpm db:lift-contracts`
Expected: test PASS; the script prints its summary for the local database (Scratch's sources and the Ikea/Acne sources get their fields lifted). Paste the summary into the report.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/scripts/lift-contracts.ts packages/db/src/scripts/lift-contracts.test.ts packages/db/package.json package.json
git commit -m "feat(db): lift-contracts script moves per-website fields into their dataset"
```

---

### Task 7: Dashboard grid library in contract mode

**Files:**
- Modify: `packages/dashboard/src/lib/schema-grid.ts`, `packages/dashboard/src/lib/schema-grid.test.ts`

**Interfaces:**
- Produces:
  - `toBindingInput(state: GridState): { urls: string[]; listingUrl?: string; descriptions: Record<key, string>; expected: Record<key, Record<url, string>> }` (rows without a `key` are skipped).
  - `bindingProblems(state: GridState): string[]` (replaces `gridProblems` for the Schema tab: URL checks as today; per row: description required, each expected cell type-valid; no name/duplicate checks, no "add at least one field").
  - `applyImportToRows(current: GridRow[], imported: GridRow[]): { rows: GridRow[]; ignored: string[] }` — matches by name (case-insensitive, trimmed) onto existing rows only, taking description and expected values; imported names with no match are returned in `ignored`; current rows never removed or reordered.
  - `fromSource` unchanged. `isComplete(state)` now means `bindingProblems(state).length === 0`. `toSchemaInput`, `gridProblems`, `mergeImportedRows` deleted.

- [ ] **Step 1: Write the failing tests** (replace the `toSchemaInput`/`gridProblems`/`mergeImportedRows` tests in `schema-grid.test.ts` with these; keep the paste/parse/validate tests)

```ts
describe('toBindingInput', () => {
  it('keys descriptions and expected values by field key and skips keyless rows', () => {
    const state: GridState = { urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '', rows: [
      { id: 'a', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] },
      { id: 'b', name: 'ghost', type: 'text', description: 'x', expected: ['a', 'b', 'c'] },
    ] };
    expect(toBindingInput(state)).toEqual({ urls: state.urls, descriptions: { price: 'green' }, expected: { price: { 'https://s.example/1': '1', 'https://s.example/2': '2', 'https://s.example/3': '3' } } });
  });
});

describe('bindingProblems', () => {
  const ok: GridState = { urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '', rows: [{ id: 'a', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] }] };
  it('is clean when every row has a description and valid cells', () => expect(bindingProblems(ok)).toEqual([]));
  it('names the gaps by field name', () => {
    expect(bindingProblems({ ...ok, rows: [{ ...ok.rows[0]!, description: '' }] })).toContain('Price: say where it is on this website');
    expect(bindingProblems({ ...ok, rows: [{ ...ok.rows[0]!, expected: ['x', '2', '3'] }] })).toEqual(expect.arrayContaining([expect.stringContaining('Price @ https://s.example/1: Not a money amount')]));
    expect(bindingProblems({ ...ok, urls: ['', ...ok.urls.slice(1)] })).toContain('All 3 product URLs are required');
  });
});

describe('applyImportToRows', () => {
  const current: GridRow[] = [{ id: 'a', key: 'price', name: 'Price', type: 'money', description: '', expected: ['', '', ''] }];
  it('fills matching rows and reports names it could not place', () => {
    const imported: GridRow[] = [
      { id: 'x', name: 'price', type: 'text', description: 'green', expected: ['1', '2', '3'] },
      { id: 'y', name: 'colour', type: 'text', description: 'swatch', expected: ['r', 'g', 'b'] },
    ];
    const r = applyImportToRows(current, imported);
    expect(r.rows).toEqual([{ id: 'a', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] }]);
    expect(r.ignored).toEqual(['colour']);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/schema-grid.test.ts`
Expected: FAIL on the three new exports.

- [ ] **Step 3: Implement** in `schema-grid.ts`: delete `toSchemaInput`, `gridProblems`, `mergeImportedRows`; add:

```ts
export function toBindingInput(state: GridState) {
  const urls = state.urls.map((u) => u.trim());
  const descriptions: Record<string, string> = {};
  const expected: Record<string, Record<string, string>> = {};
  for (const r of state.rows) {
    if (!r.key) continue;
    descriptions[r.key] = r.description.trim();
    expected[r.key] = Object.fromEntries(urls.map((u, i) => [u, r.expected[i] ?? '']));
  }
  return { urls, ...(state.listingUrl.trim() ? { listingUrl: state.listingUrl.trim() } : {}), descriptions, expected };
}

export function bindingProblems(state: GridState): string[] {
  const problems: string[] = [];
  const urls = state.urls.map((u) => u.trim());
  if (urls.some((u) => u === '')) problems.push(`All ${URL_COUNT} product URLs are required`);
  const hosts = new Set<string>();
  for (const u of [...urls, state.listingUrl.trim()].filter(Boolean)) { try { hosts.add(new URL(u).hostname.toLowerCase()); } catch { problems.push(`Not a valid URL: ${u}`); } }
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  if (new Set(urls.map((u) => u.replace(/#.*$/, ''))).size !== urls.length) problems.push('URLs must be different pages');
  for (const r of state.rows) {
    if (r.description.trim() === '') problems.push(`${r.name}: say where it is on this website`);
    r.expected.forEach((v, i) => { const err = validateExpectedClient(r.type, v); if (err) problems.push(`${r.name} @ ${urls[i] || `URL ${i + 1}`}: ${err}`); });
  }
  return problems;
}

export function isComplete(state: GridState): boolean { return bindingProblems(state).length === 0; }

/** Import fills existing rows by name; it cannot add fields (those come from the project). */
export function applyImportToRows(current: GridRow[], imported: GridRow[]): { rows: GridRow[]; ignored: string[] } {
  const byName = new Map(imported.map((r) => [r.name.trim().toLowerCase(), r]));
  const used = new Set<string>();
  const rows = current.map((r) => {
    const hit = byName.get(r.name.trim().toLowerCase());
    if (!hit) return r;
    used.add(r.name.trim().toLowerCase());
    return { ...r, description: hit.description, expected: hit.expected };
  });
  const ignored = imported.filter((r) => !used.has(r.name.trim().toLowerCase())).map((r) => r.name);
  return { rows, ignored };
}
```

Replace the old `isComplete` definition. Keep `emptyRow`/`emptyState` (the import path still builds rows with them).

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/ && pnpm --filter @robot/dashboard typecheck`
Expected: the lib tests pass; typecheck fails only in `source-schema.tsx` and `schema-grid.tsx`, fixed in Task 8.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/schema-grid.ts packages/dashboard/src/lib/schema-grid.test.ts
git commit -m "feat(dashboard): schema grid state speaks bindings: descriptions and cells by key, import by name"
```

---

### Task 8: Schema tab on the contract, grid locked columns

**Files:**
- Modify: `packages/dashboard/src/components/schema-grid.tsx`, `packages/dashboard/src/routes/source-schema.tsx`

**Interfaces:**
- Consumes: `toBindingInput`, `bindingProblems`, `isComplete`, `applyImportToRows`, `fromSource` (Task 7); `sources.updateBinding`; `sources.verificationStatus.currentKeys` (Task 4); `sources.listByProject` rows carry `datasetSchema`.
- Produces: `SchemaGrid` accepts `locked?: boolean` (name input and type select disabled with title "Field names and types come from the project"; delete column and Add row hidden). The Schema tab renders rows from the source's binding, shows "Field names and types come from the project. Edit fields on the project page." with a link to `/projects/$project`, and an empty state when the contract is empty.

- [ ] **Step 1: `schema-grid.tsx`**

Add `locked?: boolean` to `Props`. On the name `<input>` and the type `<select>`: `disabled={disabled || locked}` and `title={locked ? 'Field names and types come from the project' : undefined}`. Wrap the delete `<td>` and the Add row `<button>` in `{!locked && …}`. The `<th />` for the delete column also goes inside `{!locked && …}`. Remove the `Plus` import if it becomes unused when `locked` is always passed; keep it since the component still supports unlocked mode.

- [ ] **Step 2: `source-schema.tsx`**

Changes, in order:
- Imports: swap `gridProblems`, `mergeImportedRows`, `toSchemaInput` for `bindingProblems`, `applyImportToRows`, `toBindingInput`; import `Link` from the router.
- `const updateSchemaMutation = trpc.sources.updateSchema.useMutation();` → `const updateBindingMutation = trpc.sources.updateBinding.useMutation();`
- `isDirty`: compare `JSON.stringify(toBindingInput(grid))` with `JSON.stringify(toBindingInput(savedGrid ?? emptyState()))`.
- `problems`: `bindingProblems(grid)`.
- In `handleVerify`, the save becomes `latestDefinition = await updateBindingMutation.mutateAsync({ sourceId: source.id, ...toBindingInput(grid) });`.
- Seeding: when `fromSource(source)` is null but `source.schemaDefinition` is a non-empty array (a website with fields and no binding yet), seed the grid with `{ urls: ['', '', ''], listingUrl: '', rows: (source.schemaDefinition as Array<{ key; name; type; description }>).map((f) => ({ ...emptyRow(), key: f.key, name: f.name, type: f.type, description: f.description })) }`.
- Empty contract: when `!Array.isArray(source.schemaDefinition) || source.schemaDefinition.length === 0`, render, in place of the URL block, import and grid: `<EmptyState title="No fields yet" description="Add the fields you want on the project page. Every website in the project gets them." action={<Link to="/projects/$project" params={{ project: projectSlug }} className="btn-primary h-9">Go to the project</Link>} />` (import `EmptyState`).
- Import handler: `onRows={(rows) => { const r = applyImportToRows(grid.rows, rows); updateGrid((g) => ({ ...g, rows: r.rows })); setImportIgnored(r.ignored); }}` with `const [importIgnored, setImportIgnored] = useState<string[]>([]);` and, under the import control, `{importIgnored.length > 0 && <p className="mt-1 text-xs text-amber-800">Not in this project, so skipped: {importIgnored.join(', ')}</p>}`.
- Above the grid card: `<p className="mt-4 text-xs text-gray-500">Field names and types come from the project. <Link to="/projects/$project" params={{ project: projectSlug }} className="underline-offset-2 hover:underline">Edit fields on the project page.</Link></p>`.
- `<SchemaGrid … locked />`.
- `extractEnabled` stays `!!(status?.current && status?.allPassed)`; `current` is now per-field on the server.
- `verifyBusy` uses `updateBindingMutation.isPending`.

- [ ] **Step 3: Typecheck, unit tests, browser check**

Run: `pnpm --filter @robot/dashboard typecheck && pnpm --filter @robot/dashboard test`. With both servers up, open the Ikea website under the Acne project: the grid shows its fields with name and type greyed, descriptions and cells editable, the project link above the table. Verify still works (it is a free mechanical re-verify since captures are fresh; do not click it if the estimate shows a cost).

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/schema-grid.tsx packages/dashboard/src/routes/source-schema.tsx
git commit -m "feat(dashboard): Schema tab edits the binding only; field names and types come from the project"
```

---

### Task 9: Project home field editor

**Files:**
- Create: `packages/dashboard/src/components/contract-editor.tsx`
- Modify: `packages/dashboard/src/routes/project-home.tsx` (replace the read-only Fields table with `<ContractEditor datasetId={…} projectSlug={…} />`)

**Interfaces:**
- Consumes: `datasets.listByProject`, `datasets.addField`, `renameField`, `retypeField`, `deleteField`, `fieldStatus` (Task 3); `Dialog`, `InlineRename` (phase 1); `FIELD_TYPES` from `lib/schema-grid`.
- Produces: `ContractEditor({ datasetId, projectSlug })`.

- [ ] **Step 1: Write the component**

```tsx
// packages/dashboard/src/components/contract-editor.tsx
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2, Trash2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { FIELD_TYPES, type GridFieldType } from '../lib/schema-grid';
import { Dialog } from './dialog';
import { InlineRename } from './inline-rename';

type Field = { key: string; name: string; type: string; concept?: string };

/** The project's field list (spec 5.3): the columns of the output, edited in place. */
export function ContractEditor({ datasetId, projectSlug }: { datasetId: string; projectSlug: string }) {
  const utils = trpc.useUtils();
  const dsQuery = trpc.datasets.listByProject.useQuery({ projectId: '' }, { enabled: false }); // placeholder removed below
  void dsQuery;
  const fieldsQuery = trpc.datasets.fieldStatus.useQuery({ datasetId });
  const contractQuery = trpc.datasets.getContract.useQuery({ datasetId });
  const invalidate = () => { utils.datasets.invalidate(); utils.sources.invalidate(); utils.projects.list.invalidate(); };
  const add = trpc.datasets.addField.useMutation({ onSuccess: invalidate });
  const rename = trpc.datasets.renameField.useMutation({ onSuccess: invalidate });
  const retype = trpc.datasets.retypeField.useMutation({ onSuccess: invalidate });
  const del = trpc.datasets.deleteField.useMutation({ onSuccess: invalidate });
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<GridFieldType>('text');
  const [deleting, setDeleting] = useState<Field | null>(null);
  const error = add.error ?? rename.error ?? retype.error ?? del.error;

  const fields = (contractQuery.data ?? []) as Field[];
  const status = fieldsQuery.data ?? {};

  function submitNew() {
    const name = newName.trim();
    if (!name) return;
    add.mutate({ datasetId, name, type: newType }, { onSuccess: () => { setNewName(''); setNewType('text'); } });
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-600"><tr><th className="py-1 text-left font-medium">Field</th><th className="py-1 text-left font-medium">Type</th><th className="py-1 text-left font-medium">Verified on</th><th /></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {fields.map((f) => {
            const s = status[f.key];
            const locked = !!s && s.verified > 0;
            return (
              <tr key={f.key}>
                <td className="py-1.5"><InlineRename value={f.name} className="font-mono text-xs" onSave={(name) => rename.mutate({ datasetId, key: f.key, name })} /></td>
                <td className="py-1.5">
                  <select value={f.type} disabled={locked} title={locked ? 'A verified website uses this type. Delete and re-add the field to change it.' : undefined}
                    onChange={(e) => retype.mutate({ datasetId, key: f.key, type: e.target.value as GridFieldType })} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-60">
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="py-1.5 text-xs">
                  {!s || s.total === 0 ? <span className="text-gray-400">no websites yet</span> : (
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.verified === s.total ? 'bg-emerald-600' : s.verified === 0 ? 'bg-gray-400' : 'bg-red-500'}`} />
                      {s.verified} of {s.total} websites
                      {s.verified < s.total && s.websites.filter((w) => !w.verified).slice(0, 1).map((w) => (
                        <Link key={w.sourceId} to="/projects/$project/sources/$source" params={{ project: projectSlug, source: w.slug }} className="underline-offset-2 hover:underline">{w.name}</Link>
                      ))}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right"><button type="button" aria-label={`Delete ${f.name}`} title="Delete field" onClick={() => setDeleting(f)} className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            );
          })}
          <tr>
            <td className="py-1.5"><input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitNew(); }} placeholder="field name" className="w-full rounded border border-gray-300 px-2 py-0.5 font-mono text-xs" aria-label="New field name" /></td>
            <td className="py-1.5"><select value={newType} onChange={(e) => setNewType(e.target.value as GridFieldType)} className="rounded border border-gray-300 px-2 py-0.5 text-xs">{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
            <td className="py-1.5" colSpan={2}><button type="button" className="btn-quiet h-7" disabled={!newName.trim() || add.isPending} onClick={submitNew}>{add.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Add field</button></td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500">Add a field here and every website gets a new column to verify. Renaming is free. A type locks once a website has verified it.</p>
      {error && <p className="mt-2 text-xs text-red-700">{error.message}</p>}

      <Dialog open={!!deleting} title={deleting ? `Delete ${deleting.name}?` : ''} onClose={() => { if (!del.isPending) setDeleting(null); }} preventClose={del.isPending}>
        {deleting && (
          <div className="text-sm text-gray-700">
            <p>The column disappears from the output and from every website in this project.</p>
            {(status[deleting.key]?.websites ?? []).length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-gray-600">
                {status[deleting.key]!.websites.map((w) => <li key={w.sourceId}>{w.name}{w.verified ? ' (verified)' : ''}</li>)}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-quiet h-9" disabled={del.isPending} onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="btn-primary h-9 bg-red-600 hover:bg-red-700" disabled={del.isPending} onClick={() => del.mutate({ datasetId, key: deleting.key }, { onSuccess: () => setDeleting(null) })}>
                {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Delete field
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
```

Remove the two placeholder lines (`dsQuery`) before committing; they are not part of the component. `datasets.getContract` does not exist yet: add it to `datasets.ts` in this task as `getContract: publicProcedure.input(z.object({ datasetId: z.string().uuid() })).query(async ({ ctx, input }) => contractFields((await loadDataset(ctx.db, input.datasetId)).schema))`, and a one-line test in `datasets-fields.test.ts` that it returns the added field.

- [ ] **Step 2: Mount it in `project-home.tsx`**

Replace the read-only Fields table (and its `fields` derivation) with:

```tsx
        <section>
          <h2 className="text-sm font-medium text-gray-900">Fields <span className="font-normal text-gray-500">the columns of your output</span></h2>
          <div className="mt-2">
            {datasets[0] ? <ContractEditor datasetId={datasets[0].id} projectSlug={projectSlug} /> : <p className="text-sm text-gray-500">Loading…</p>}
          </div>
        </section>
```

Keep the Output line; its column count becomes `contractFields`-style: `(Array.isArray(datasets[0]?.schema) ? (datasets[0]!.schema as unknown[]).length : 0)`. Import `ContractEditor`.

- [ ] **Step 3: Typecheck and browser check**

Run: `pnpm --filter @robot/dashboard typecheck && pnpm --filter @robot/dashboard test`. In the browser on the Acne project: fields show with "verified on 1 of 1 websites" for the lifted Ikea fields once that website has been re-verified (before that, 0 of 1, which is expected per spec 4.5). Add a field "test_field", see it appear on the Ikea Schema tab as a locked row, delete it from the project home, see it gone.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/contract-editor.tsx packages/dashboard/src/routes/project-home.tsx packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-fields.test.ts
git commit -m "feat(dashboard): project home edits the field list; verified-on per field"
```

---

### Task 10: Smoke test and docs

**Files:**
- Modify: `packages/dashboard/src/routes-smoke.test.ts` (the create-flow test adds a field before the website and asserts the locked row), `docs/handoff.md`, `CLAUDE.md`

- [ ] **Step 1: Smoke**

In the create-flow test, after `projects.create`: `await client.datasets.addField.mutate({ datasetId: project.datasetId, name: 'price', type: 'money' });`. Keep the existing assertions and add: `expect(await page.locator('input[value="price"][disabled]').count(), 'the contract row is not locked').toBeGreaterThan(0);`. Run `pnpm test:ui` with both servers up.

- [ ] **Step 2: Docs**

`docs/handoff.md`: add under the phase 1 entry a "MVP flow phase 2 (2026-09-09)" section: contract on the dataset (`datasets.schema` entries with `key`), the four field procedures and `fieldStatus`, `sources.updateBinding` replacing `updateSchema`, `createWithSchema`/`quickCreate` removed, per-field `fieldHash` and `currentKeys`, `pnpm db:lift-contracts` run once per environment (say it was run on this machine and what it printed), and that existing websites need one free re-verify to become current. `CLAUDE.md`: in Key Technical Decisions, after the routes bullet, add "Field name and type live on the project's dataset (the contract); a website owns only its location hints, proof pages, expected values and certification, which is current per field (2026-09-09, spec section 4)."

- [ ] **Step 3: Full gate and commit**

Run: `pnpm -r --workspace-concurrency=1 test`. Then:

```bash
git add packages/dashboard/src/routes-smoke.test.ts docs/handoff.md CLAUDE.md
git commit -m "test,docs: smoke adds a field before a website; phase 2 recorded"
```

---

## Self-review

**Spec coverage (phase 2 = spec 12 item 2):** contract on the dataset with `key` (Tasks 2, 3, 6); field procedures and propagation (Task 3); migration (Task 6); `createInProject` seeding and `updateBinding` (Task 4); per-field certification currency (Tasks 1, 2, 4); removal of `createWithSchema`/`quickCreate` (Task 5); project home field editing with verified-on (Task 9); Schema tab locked columns and paste-by-name (Tasks 7, 8); `definitionHash` without name (Task 1); tests (each task) and the gate (Task 10). Spec 5.3's delete dialog listing websites (Task 9). Spec 4.3's retype lock (Task 3). Not in this phase by design: the Schema tab's new layout and states (phase 3), Extract tab (phase 4), visual system (phase 5), `setListingPages`/`setProductUrls`/`checkListingPage` (phase 4).

**Placeholder scan:** the `dsQuery` placeholder lines in Task 9's component are explicitly removed in the same step; no TBDs.

**Type consistency:** `contractFields`/`bindingFor` (Task 2) used in Tasks 3, 4, 6 (Task 6 re-implements the lift without importing from the api package, since `@robot/db` cannot depend on `@robot/api`). `loadFieldCurrency` (Task 2) used in Tasks 3, 4. `updateBinding`'s input (Task 4) used in Tasks 3, 5, 7, 8. `fieldStatus` and `getContract` (Tasks 3, 9) used in Task 9. `fieldHash` (Task 1) used in Tasks 2, 3. The test helper (Task 5) is the only setup path from Task 5 onward.
