# Websites change: keep running, re-check, tell the customer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A website whose pages moved on keeps running on its last good certified paths, refreshes the values that change by nature (price, rating, review count, stock) by itself when the same path still reads a valid value in the same place, is re-checked for free every three days, and tells the customer in one plain notice exactly what needs them.

**Architecture:** A new `field_holds` table keeps a field's last passing result when a Verify does not pass it, as long as its paths still extract; `loadCertificationState` counts held fields, so every reader of the certification (the gate, runs, drift, coverage) keeps working. The drift check gains triggers (`run`, `manual`, `verify`, `schedule`), records what a run would write per page, and applies a pure, conservative `planRefresh` (in `@robot/scraper`) that rewrites stale expected values of by-nature fields, logs each change in `value_refreshes` and starts a free re-verify on the captures it just read. A small in-process timer in the api-server claims due websites with `SKIP LOCKED` and runs the check plus the coverage check. The app reads one server-side `websiteAttention` for its badge ("Needs attention"), banner, row words and the refreshed line; staff see holds and automatic updates in ops.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres (drizzle-kit migrations); tRPC v11; Hono (api-server); TanStack Start + React 19 + Tailwind v4; Playwright (the route smoke, Chromium tests).

**Spec:** `docs/superpowers/specs/2026-10-21-websites-change-design.md`

**Planner's notes:** thirteen tasks, strictly in order — each consumes names the one before produces. 1 the migration; 2 the refresh rule (scraper); 3 holds in currency; 4 the check's triggers, readings and stored captures; 5 Verify keeps holds (+ `backfillHolds`); 6 refreshes; 7 the schedule; 8 what the app reads (routers, seed helper); 9 ops (first: its narrowed types must know `'held'` before the app type-checks the customer screens); 10 the customer's screens and the smoke test; 11 the read-only replay of the ten websites; 12 the merge gate; 13 applying it to the ten websites. Tasks 9 and 10 touch disjoint files; run 9 first so the app type-checks clean at the end of each. Line numbers were read on `feat/websites-change` @ `c3249bb` and are approximate — find the code by the quoted text.

## Global Constraints

- **The rules (spec §3):** a hold counts while the field is not current and today's `fieldHash` is in its `field_hashes`; certification = every contract field current or held, a held field's paths are the hold's `result.certified`. A Verify keeps/creates a hold for a field it did not pass only if the field had a certifying result whose hashes include today's hash and its paths still extract (a value on ≥ 1 captured page, or no page captured, or no paths). Checks never revoke; only the customer's edits do.
- **By nature (spec §3.2):** `CHANGES_BY_NATURE = { price: ['money'], rating: ['number'], review_count: ['number'], availability: ['boolean', 'text'] }`. A refresh needs: by nature; ≥ 1 page differs; ≥ 2 pages with an expected value read, none reads nothing; each differing page read by the same certified path that passed there; not `readsFixedVariant`; `shown !== false`; in range (price/rating > 0, rating ≤ 5/10/100 by the old value's scale, review count whole ≥ 0 and never to 0 from > 0, any number within `REFRESH_MAX_FACTOR = 5` either way). All or nothing per field. Marks and confirmed paths are kept. Boolean availability writes `In stock` / `Out of stock`; other booleans `Yes` / `No`; money its two-decimal normal form.
- **Schedule (spec §3.3):** `WEBSITE_CHECK_DAYS` default `3`; sweep every hour, first sweep 10 minutes after start, at most 6 websites per sweep, one at a time; `WEBSITE_CHECKS=off` disables. Tests never claim a website outside their own (`only:` filter) — the test database is Marko's.
- **Customer copy (spec §5), verbatim:** `Needs attention`; banner `{Subject} — {tail}` with subject parts `{Fields} needs you` / `{Fields} need you` and `product {n} no longer loads` / `products {list} no longer load`, joined with " and ", first letter capitalised; tails `runs go on with what you verified on {d MMM}.` / `runs go on as before.` / `extraction waits for you.`; held word `runs use what you verified on {d MMM}`; refreshed line `Updated automatically on {d MMM}: {now} on product {n} (was {was})` joined with `; `; lost row `Not found on product {n} — Mark it again` / `Not found on products {list} — Mark it again`; Extract line `{Fields} needs you on the Verification tab — runs go on with what you verified on {d MMM}.` (`need` for several). Lists "a, b and c", no Oxford comma. Never a path, source, JSON, check, hold, model, schedule or money word in customer copy (memory `customer-copy-no-internals`).
- **Staff copy (spec §6), verbatim:** flag `Held — runs use the paths verified {d MMM}`; section heading `Automatic updates`; line `{d MMM} · {Field} · product {n}: {was} → {now} · {path kind} {path}`; `Not updated automatically: {reason}` with reasons `a page reads nothing` (empty), `fewer than two pages read` (too-few-pages), `read from another place than verified` (not-same-place), `reads a fixed variant` (fixed-variant), `the page does not show the new value` (not-shown), `the new value is out of range` (out-of-range), `a Verify was running` (busy), `the value was edited meanwhile` (moved), `it could not be saved` (not-applied); overview `{c} of {n} fields · {h} held`.
- **No AI, no Jev, no money:** checks construct no agent; refresh re-verifies pass `free: true`; proof-page captures in checks keep `jev: false`; re-verifies reuse captures. No paid API in any test or script.
- ESM. Relative imports carry `.js` in `@robot/scraper`, `@robot/api`, `@robot/browser`; none in `@robot/app`. `@robot/app` imports nothing from `@robot/scraper` except `@robot/scraper/normalize`, and nothing from `@robot/api` (the existing `import type { AppRouter }` in `lib/trpc.ts` and the smoke's test-helper imports stay as they are).
- DB changes only through the Drizzle migration `0019_websites_change` in `@robot/db`.
- Tests per package, one file at a time while working: `cd packages/<pkg> && npx vitest run <file>`; the full api and scraper suites serially: `npx vitest run --no-file-parallelism`. Never `pnpm -r test`. The api and db tests need Postgres (`docker start robot-platform-db`).
- Commits by explicit path. Never `git add -A` / `git add .`. Never stage `packages/app/src/routeTree.gen.ts` (restore it with `git checkout -- packages/app/src/routeTree.gen.ts` if it changed). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never start, stop or restart Marko's dev servers (:3000, :4000). The only servers this plan starts are the isolated pair on :4100/:3100 (Task 12), with `WEBSITE_CHECKS=off`, stopped by port afterwards.
- Work only in `C:\Users\Marko\Documents\projects\robot-platform-change` (bash: `/c/Users/Marko/Documents/projects/robot-platform-change`) on `feat/websites-change`. Task 11 reads Marko's database and the main checkout's capture files; Task 13 writes to Marko's data (approved for the ten websites only).
- Files in this repo are CRLF. Edit with tools that keep line endings; new files may be LF.

## Review Focus

1. **A stale tab autosave after a refresh** — the customer has the Verification tab open while a scheduled refresh changes Price's expected values, then edits another field; the board autosaves the whole binding with Price's *old* values. The website must stay runnable (the pre-refresh hash is in `field_hashes`). → Task 6 test "a stale autosave writing the old value back keeps the hold".
2. **A test or script claiming a real website** — `claimDueWebsite` runs against Marko's database; any claim without `only` in a test would move his websites' `next_check_at` and check them. → Task 7 test "claims only the websites it is given" and the `only` parameter is required in every test call.
3. **A refresh racing a Verify the customer just started** — a check finishes while a Verify is in flight: no expected value may change under that Verify, and no second Verify may start. → Task 6 tests "skips while a Verify is in flight" (`applyRefreshes`) and "starts no re-verify while one is in flight" (`startRefreshVerify`).
4. **A field whose path reads on some pages and nothing on another (a new design on one proof page)** — must stay held (it still extracts), must never refresh, and its row must name the product: "Not found on product 2 — Mark it again". → Task 2 test "a page that reads nothing refuses as empty", Task 5 test "a path that reads on one page keeps the hold", Task 10 test for the `lost` row.
5. **A refresh-started Verify that fails again** — it must not start another check (no loop), and the hold must survive with the new hash so the website keeps running. → Task 5 test "a refresh-origin Verify starts no check" and Task 6 test "the website stays certified after a refresh whose re-verify fails".

---

### Task 1: The migration — holds, refreshes, a check's trigger, a website's next check (`@robot/db`) — spec §4

**Files:**
- Modify: `packages/db/src/schema.ts` (`driftChecks` `:434-447`; `sources` `:~150-190`; new tables after `coverageChecksRelations` `:~479`)
- Create: `packages/db/drizzle/0019_websites_change.sql`, `packages/db/drizzle/meta/0019_snapshot.json`, journal entry (generated)
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces: tables `fieldHolds` (`field_holds`) and `valueRefreshes` (`value_refreshes`); columns `driftChecks.trigger` (`varchar(12)`, not null, default `'run'`) and `sources.nextCheckAt` (`timestamptz`, nullable). Column names exactly as below; later tasks use them.

- [ ] **Step 1: Write the failing test**

In `packages/db/src/schema.test.ts`, change the import line to

```ts
import { db, orgs, projects, datasets, sources, runs, runItems, sourceVerifications, captures, jevReadings, users, memberships, sessions, driftChecks, fieldHolds, valueRefreshes } from './index.js';
```

and append:

```ts
describe('websites change (spec 2026-10-21 §4)', () => {
  let changeOrgId: string | null = null;
  afterEach(async () => {
    if (changeOrgId) await db.delete(orgs).where(eq(orgs.id, changeOrgId));
    changeOrgId = null;
  });

  it('stores one hold per website and field, with its hashes', async () => {
    const { orgId: seeded, source } = await seedSource();
    changeOrgId = seeded;
    const result = { key: 'price', cells: {}, certified: [], weakEvidence: false, aiCalled: false, incomplete: false };
    const [h] = await db.insert(fieldHolds).values({ sourceId: source.id, fieldKey: 'price', result, verifiedAt: new Date(), fieldHashes: ['a', 'b'] }).returning();
    expect(h!.fieldHashes).toEqual(['a', 'b']);
    expect(h!.failedVerificationId).toBeNull();
    await expect(db.insert(fieldHolds).values({ sourceId: source.id, fieldKey: 'price', result, verifiedAt: new Date() })).rejects.toThrow();
  });

  it('stores a value refresh, a check trigger defaulting to run, and a next check time', async () => {
    const { orgId: seeded, source } = await seedSource();
    changeOrgId = seeded;
    const [c] = await db.insert(driftChecks).values({ sourceId: source.id }).returning();
    expect(c!.trigger).toBe('run');
    const pages = { 'https://s.example/p/1': { was: '1.00', now: '1.10', path: { source: 'json-ld', path: 'offers.price', transform: 'identity' } } };
    const [r] = await db.insert(valueRefreshes).values({ sourceId: source.id, fieldKey: 'price', driftCheckId: c!.id, pages, fromHash: 'x', toHash: 'y' }).returning();
    expect(r!.pages).toEqual(pages);
    expect(r!.verificationId).toBeNull();
    const at = new Date('2026-10-24T00:00:00Z');
    await db.update(sources).set({ nextCheckAt: at }).where(eq(sources.id, source.id));
    const [s] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(s!.nextCheckAt?.toISOString()).toBe(at.toISOString());
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/db && npx vitest run src/schema.test.ts`
Expected: FAIL — `fieldHolds` / `valueRefreshes` are not exported.

- [ ] **Step 3: Write the schema**

In `packages/db/src/schema.ts`, inside `sources` after `variantSetup: jsonb('variant_setup'),` add:

```ts
  // When the scheduled website check (spec 2026-10-21 §3.3) may next read this
  // website's proof pages. Null = due. Moved on by every claim, every completed
  // Verify and every finished check.
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
```

Inside `driftChecks` after `status: varchar('status', { length: 12 }).notNull().default('running'),` add:

```ts
  // 'run' | 'manual' | 'verify' | 'schedule' (spec 2026-10-21 §3.3): what started the check.
  trigger: varchar('trigger', { length: 12 }).notNull().default('run'),
```

After `coverageChecksRelations` add:

```ts
// ─── Field holds and value refreshes (2026-10-21) ───────────────────────────
// Websites change (spec 2026-10-21 §3.1–§3.2): a hold keeps a field's last
// passing result after a Verify that did not pass it, so runs go on with the
// last good paths while they still extract; a value refresh records one
// automatic update of a by-nature field's expected values.

export const fieldHolds = pgTable('field_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  fieldKey: varchar('field_key', { length: 255 }).notNull(),
  // FieldVerification (@robot/scraper verify/types.ts): the last passing result; runs read its `certified`.
  result: jsonb('result').notNull(),
  // The completed Verify that passed it, and when.
  verificationId: uuid('verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  // The Verify that did not pass it; null when an automatic refresh made the hold.
  failedVerificationId: uuid('failed_verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  // string[]: every field hash this hold stands for (the hash it passed at, plus each refresh's).
  fieldHashes: jsonb('field_hashes').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('field_holds_source_field_idx').on(table.sourceId, table.fieldKey),
]);

export const valueRefreshes = pgTable('value_refreshes', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  fieldKey: varchar('field_key', { length: 255 }).notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  driftCheckId: uuid('drift_check_id').references(() => driftChecks.id, { onDelete: 'set null' }),
  // The free re-verify the refresh started; null when none could start.
  verificationId: uuid('verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  // Record<url, { was: string; now: string; path: CertifiedPath }>
  pages: jsonb('pages').notNull(),
  fromHash: varchar('from_hash', { length: 64 }).notNull(),
  toHash: varchar('to_hash', { length: 64 }).notNull(),
}, (table) => [
  index('value_refreshes_source_at_idx').on(table.sourceId, table.at),
]);
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
pnpm --filter @robot/db exec drizzle-kit generate --name websites_change
```

Expected: `packages/db/drizzle/0019_websites_change.sql`, `meta/0019_snapshot.json` and a journal entry. Read the SQL: it must only `CREATE TABLE "field_holds"`, `CREATE TABLE "value_refreshes"`, add their foreign keys and indexes, `ALTER TABLE "drift_checks" ADD COLUMN "trigger" varchar(12) DEFAULT 'run' NOT NULL` and `ALTER TABLE "sources" ADD COLUMN "next_check_at" timestamp with time zone`. Anything else (a drop, a rename) means the snapshot is stale: stop and investigate. Then:

```bash
pnpm db:migrate
```

The migration is additive; Marko's running servers ignore the new tables and columns.

- [ ] **Step 5: Run the test to make sure it passes**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/db && npx vitest run src/schema.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/0019_websites_change.sql packages/db/drizzle/meta/0019_snapshot.json packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): field holds, value refreshes, a check's trigger, a website's next check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The refresh rule (`@robot/scraper`) — spec §3.2

**Files:**
- Create: `packages/scraper/src/verify/refresh.ts`
- Modify: `packages/scraper/src/verify/drift-classify.ts` (types only, `:19-47`), `packages/scraper/src/verify/index.ts`
- Test: `packages/scraper/src/verify/refresh.test.ts`

**Interfaces:**
- Consumes: `normalize`, `valuesEqual` (`normalize.ts`), `readsFixedVariant` (`page-variant-match.ts`).
- Produces (all exported from `@robot/scraper`):
  - `CHANGES_BY_NATURE: Readonly<Record<string, readonly CustomerFieldType[]>>`, `REFRESH_MAX_FACTOR = 5`
  - `changesByNature(field: Pick<SchemaDefinitionField, 'concept' | 'type'>): boolean`
  - `type PathReading = { value: string | null; path: CertifiedPath | null; shown: boolean | null }`
  - `type RefreshRefusal = 'not-by-nature' | 'too-few-pages' | 'empty' | 'not-same-place' | 'fixed-variant' | 'not-shown' | 'out-of-range'`
  - `type RefreshPage = { was: string; now: string; path: CertifiedPath }`
  - `type RefreshPlan = { kind: 'none' } | { kind: 'refused'; reason: RefreshRefusal; url?: string } | { kind: 'refresh'; pages: Record<string, RefreshPage> }`
  - `planRefresh(input: { field: Pick<SchemaDefinitionField, 'type' | 'concept'>; expected: Record<string, string>; provenOn: Record<string, CertifiedPath | undefined>; readings: Record<string, PathReading> }): RefreshPlan`
  - `inRefreshRange(field, now: string, was: string): boolean`, `refreshedText(field, value: string): string`
  - In `drift-classify.ts`: `type DriftTrigger = 'run' | 'manual' | 'verify' | 'schedule'`; `type DriftCaptureRef = { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string }`; `DriftFieldResult` gains `reads?: Record<string, string | null>` and `refresh?: { applied: boolean; reason?: string }`; `DriftCheckResults` gains `trigger?: DriftTrigger`, `keys?: string[]`, `captures?: Record<string, DriftCaptureRef>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/scraper/src/verify/refresh.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planRefresh, changesByNature, inRefreshRange, refreshedText, type PathReading } from './refresh.js';
import type { CertifiedPath } from './types.js';

const U = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const API: CertifiedPath = { source: 'api', path: 'item.price', transform: 'identity' };
const price = { type: 'money' as const, concept: 'price' };
const read = (value: string | null, path: CertifiedPath | null = LD, shown: boolean | null = true): PathReading => ({ value, path, shown });
const expected = { [U[0]!]: '615.00', [U[1]!]: '435.00', [U[2]!]: '3250.00' };
const proven = { [U[0]!]: LD, [U[1]!]: LD, [U[2]!]: LD };

describe('changesByNature (spec 2026-10-21 §3.2)', () => {
  it('covers price, rating, review count and availability, by concept and type', () => {
    expect(changesByNature({ concept: 'price', type: 'money' })).toBe(true);
    expect(changesByNature({ concept: 'rating', type: 'number' })).toBe(true);
    expect(changesByNature({ concept: 'review_count', type: 'number' })).toBe(true);
    expect(changesByNature({ concept: 'availability', type: 'boolean' })).toBe(true);
    expect(changesByNature({ concept: 'availability', type: 'text' })).toBe(true);
  });
  it('never a title, brand, SKU, description, or a text field named for price', () => {
    for (const concept of ['product_name', 'brand', 'sku', 'description', 'image_url']) expect(changesByNature({ concept, type: 'text' })).toBe(false);
    expect(changesByNature({ concept: 'price', type: 'text' })).toBe(false); // "Price currency"
  });
});

describe('planRefresh (spec 2026-10-21 §3.2)', () => {
  it('refreshes every page whose value moved, through the path that passed there (Mejuri)', () => {
    const plan = planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625'), [U[1]!]: read('440'), [U[2]!]: read('3300') } });
    expect(plan).toEqual({ kind: 'refresh', pages: {
      [U[0]!]: { was: '615.00', now: '625.00', path: LD },
      [U[1]!]: { was: '435.00', now: '440.00', path: LD },
      [U[2]!]: { was: '3250.00', now: '3300.00', path: LD },
    } });
  });
  it('refreshes only the page that moved (Gymshark rating)', () => {
    const plan = planRefresh({
      field: { type: 'number', concept: 'rating' },
      expected: { [U[0]!]: '3.4', [U[1]!]: '3.5', [U[2]!]: '4' },
      provenOn: proven,
      readings: { [U[0]!]: read('3.4'), [U[1]!]: read('3.5'), [U[2]!]: read('4.2') },
    });
    expect(plan).toEqual({ kind: 'refresh', pages: { [U[2]!]: { was: '4', now: '4.2', path: LD } } });
  });
  it('is none when nothing moved, whatever the field', () => {
    expect(planRefresh({ field: { type: 'text', concept: 'product_name' }, expected: { [U[0]!]: 'A', [U[1]!]: 'B' }, provenOn: proven, readings: { [U[0]!]: read('A'), [U[1]!]: read('B') } })).toEqual({ kind: 'none' });
  });
  it('refuses a field that does not change by nature', () => {
    expect(planRefresh({ field: { type: 'text', concept: 'description' }, expected: { [U[0]!]: 'Old', [U[1]!]: 'B' }, provenOn: proven, readings: { [U[0]!]: read('New'), [U[1]!]: read('B') } }))
      .toEqual({ kind: 'refused', reason: 'not-by-nature' });
  });
  it('Review Focus 4: a page that reads nothing refuses as empty (a new design, not a price change)', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625'), [U[1]!]: read(null, null, null), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'empty', url: U[1] });
  });
  it('refuses with fewer than two pages read', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625') } })).toEqual({ kind: 'refused', reason: 'too-few-pages' });
  });
  it('refuses a value read through another path than the one that passed on that page', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625', API), [U[1]!]: read('435'), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'not-same-place', url: U[0] });
  });
  it('refuses a fixed variant index (Everlane, Burrow, Ridge)', () => {
    const fixed: CertifiedPath = { source: 'json-ld', path: 'hasVariant[0].offers.price', transform: 'identity' };
    const p = { [U[0]!]: fixed, [U[1]!]: fixed, [U[2]!]: fixed };
    expect(planRefresh({ field: price, expected, provenOn: p, readings: { [U[0]!]: read('900', fixed), [U[1]!]: read('435', fixed), [U[2]!]: read('3250', fixed) } }))
      .toEqual({ kind: 'refused', reason: 'fixed-variant', url: U[0] });
  });
  it('refuses a value the page does not show (Oliverbonas), and lets a boolean through (shown null)', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625', LD, false), [U[1]!]: read('435'), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'not-shown', url: U[0] });
    const stock = planRefresh({
      field: { type: 'boolean', concept: 'availability' },
      expected: { [U[0]!]: 'In stock', [U[1]!]: 'In stock' },
      provenOn: proven,
      readings: { [U[0]!]: read('false', LD, null), [U[1]!]: read('true', LD, null) },
    });
    expect(stock).toEqual({ kind: 'refresh', pages: { [U[0]!]: { was: 'In stock', now: 'Out of stock', path: LD } } });
  });
  it('refuses a price that moved more than five times (cents for units)', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('61500'), [U[1]!]: read('435'), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'out-of-range', url: U[0] });
  });
});

describe('inRefreshRange', () => {
  const rating = { type: 'number' as const, concept: 'rating' };
  const count = { type: 'number' as const, concept: 'review_count' };
  it('keeps a rating on its old scale and above zero', () => {
    expect(inRefreshRange(rating, '4.6', '4.5')).toBe(true);
    expect(inRefreshRange(rating, '6', '4.5')).toBe(false);
    expect(inRefreshRange(rating, '0', '4.5')).toBe(false);
    expect(inRefreshRange(rating, '8.4', '8.1')).toBe(true);
  });
  it('keeps a review count whole, lets a first review in, never drops to zero', () => {
    expect(inRefreshRange(count, '150', '149')).toBe(true);
    expect(inRefreshRange(count, '12.5', '12')).toBe(false);
    expect(inRefreshRange(count, '3', '0')).toBe(true);
    expect(inRefreshRange(count, '0', '45')).toBe(false);
  });
  it('lets a sale through and stops at a factor of five', () => {
    expect(inRefreshRange(price, '30.00', '100.00')).toBe(true);
    expect(inRefreshRange(price, '19.00', '100.00')).toBe(false);
  });
  it('says nothing about text and booleans', () => {
    expect(inRefreshRange({ type: 'text', concept: 'availability' }, 'Sold out', 'In stock')).toBe(true);
  });
});

describe('refreshedText', () => {
  it('writes stock in the customer’s words and money in its two-decimal form', () => {
    expect(refreshedText({ type: 'boolean', concept: 'availability' }, 'true')).toBe('In stock');
    expect(refreshedText({ type: 'boolean', concept: 'availability' }, 'false')).toBe('Out of stock');
    expect(refreshedText({ type: 'boolean', concept: 'gift_wrap' }, 'true')).toBe('Yes');
    expect(refreshedText(price, '625')).toBe('625.00');
    expect(refreshedText({ type: 'number', concept: 'rating' }, '4.2')).toBe('4.2');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/scraper && npx vitest run src/verify/refresh.test.ts`
Expected: FAIL — cannot find `./refresh.js`.

- [ ] **Step 3: Write the rule**

Create `packages/scraper/src/verify/refresh.ts`:

```ts
// packages/scraper/src/verify/refresh.ts
// Websites change (spec 2026-10-21 §3.2): may a check refresh a field's
// expected values by itself? Only for a field that changes by nature (price,
// rating, review count, availability), only where the same certified path that
// passed on a page now reads a different, valid, in-range value the page
// shows, never through a fixed variant index, and only when every page with an
// expected value reads one. All or nothing per field. Pure: readings in, a
// plan out. No model, ever.
import { normalize, valuesEqual } from './normalize.js';
import { readsFixedVariant } from './page-variant-match.js';
import type { CertifiedPath, CustomerFieldType, SchemaDefinitionField } from './types.js';

/** The concepts whose value changes by nature, and the types each may carry (spec §3.2's table). */
export const CHANGES_BY_NATURE: Readonly<Record<string, readonly CustomerFieldType[]>> = {
  price: ['money'],
  rating: ['number'],
  review_count: ['number'],
  availability: ['boolean', 'text'],
};

/** How far a number may move in one refresh, either way: a cents/units change or another element is not a price change. */
export const REFRESH_MAX_FACTOR = 5;

export function changesByNature(field: Pick<SchemaDefinitionField, 'concept' | 'type'>): boolean {
  return CHANGES_BY_NATURE[field.concept]?.includes(field.type) ?? false;
}

/** What a run writes on one page from a field's certified paths: the value (null for a miss), the path that read it, and whether the page shows it. */
export type PathReading = { value: string | null; path: CertifiedPath | null; shown: boolean | null };
export type RefreshRefusal = 'not-by-nature' | 'too-few-pages' | 'empty' | 'not-same-place' | 'fixed-variant' | 'not-shown' | 'out-of-range';
export type RefreshPage = { was: string; now: string; path: CertifiedPath };
export type RefreshPlan =
  | { kind: 'none' }
  | { kind: 'refused'; reason: RefreshRefusal; url?: string }
  | { kind: 'refresh'; pages: Record<string, RefreshPage> };

const pathId = (p: CertifiedPath) => `${p.source} ${p.path} ${p.transform}`;

/** Spec §3.2 condition 7. `now` is a run's value, `was` the stored expected value. Text and booleans are always in range. */
export function inRefreshRange(field: Pick<SchemaDefinitionField, 'type' | 'concept'>, now: string, was: string): boolean {
  if (field.type !== 'money' && field.type !== 'number') return true;
  const nNorm = normalize(field.type, now);
  const oNorm = normalize(field.type, was);
  if (nNorm === null || oNorm === null) return false;
  const n = Number(nNorm);
  const o = Number(oNorm);
  if (!Number.isFinite(n) || !Number.isFinite(o)) return false;
  if (field.concept === 'review_count') {
    if (!Number.isInteger(n) || n < 0) return false;
    if (o === 0) return true;   // a first review
    if (n === 0) return false;  // reviews do not vanish: another element
  } else {
    if (n <= 0 || o <= 0) return false;
    if (field.concept === 'rating') {
      const scale = o <= 5 ? 5 : o <= 10 ? 10 : 100;
      if (n > scale) return false;
    }
  }
  return n / o <= REFRESH_MAX_FACTOR && o / n <= REFRESH_MAX_FACTOR;
}

/** The expected value a refresh writes: stock in the customer's words, money in its two-decimal form, anything else as a run writes it. */
export function refreshedText(field: Pick<SchemaDefinitionField, 'type' | 'concept'>, value: string): string {
  if (field.type === 'boolean') {
    const yes = normalize('boolean', value) === 'true';
    if (field.concept === 'availability') return yes ? 'In stock' : 'Out of stock';
    return yes ? 'Yes' : 'No';
  }
  if (field.type === 'money') return normalize('money', value) ?? value;
  return value;
}

/**
 * The refresh a check may apply for one field (spec §3.2). `readings` holds only the pages captured now;
 * `provenOn` is the field's certifying result's passing cell path per page.
 */
export function planRefresh(input: {
  field: Pick<SchemaDefinitionField, 'type' | 'concept'>;
  expected: Record<string, string>;
  provenOn: Record<string, CertifiedPath | undefined>;
  readings: Record<string, PathReading>;
}): RefreshPlan {
  const { field, expected, provenOn, readings } = input;
  const deciding = Object.keys(readings).filter((u) => (expected[u] ?? '').trim() !== '');
  const differing = deciding.filter((u) => {
    const v = readings[u]!.value;
    return v !== null && !valuesEqual(field.type, v, expected[u]!, { pageUrl: u });
  });
  if (differing.length === 0) return { kind: 'none' };
  if (!changesByNature(field)) return { kind: 'refused', reason: 'not-by-nature' };
  const empty = deciding.find((u) => readings[u]!.value === null);
  if (empty !== undefined) return { kind: 'refused', reason: 'empty', url: empty };
  if (deciding.length < 2) return { kind: 'refused', reason: 'too-few-pages' };
  const pages: Record<string, RefreshPage> = {};
  for (const url of differing) {
    const r = readings[url]!;
    const proven = provenOn[url];
    if (!r.path || !proven || pathId(r.path) !== pathId(proven)) return { kind: 'refused', reason: 'not-same-place', url };
    if (readsFixedVariant(r.path)) return { kind: 'refused', reason: 'fixed-variant', url };
    if (r.shown === false) return { kind: 'refused', reason: 'not-shown', url };
    if (!inRefreshRange(field, r.value!, expected[url]!)) return { kind: 'refused', reason: 'out-of-range', url };
    pages[url] = { was: expected[url]!, now: refreshedText(field, r.value!), path: r.path };
  }
  return { kind: 'refresh', pages };
}
```

In `packages/scraper/src/verify/index.ts` add after `export * from './drift-classify.js';`:

```ts
export * from './refresh.js';
```

In `packages/scraper/src/verify/drift-classify.ts`, replace

```ts
export type DriftFieldResult = {
  key: string;
  /** `not-checked`: no page could be read now and at least one was not checked — nothing was learned. */
  result: 'other-layout' | 'moved' | 'changed' | 'lost' | 'not-checked';
  path?: CertifiedPath;
  pages: Record<string, DriftPage>;
  /** filled by the API from the run, not by classifyDrift */
  emptyShare?: number;
};

export type DriftCheckResults = { runId: string | null; fields: Record<string, DriftFieldResult> };
```

with

```ts
export type DriftFieldResult = {
  key: string;
  /** `not-checked`: no page could be read now and at least one was not checked — nothing was learned. */
  result: 'other-layout' | 'moved' | 'changed' | 'lost' | 'not-checked';
  path?: CertifiedPath;
  pages: Record<string, DriftPage>;
  /** filled by the API from the run, not by classifyDrift */
  emptyShare?: number;
  /** Filled by the API (spec 2026-10-21 §3.3): what a run writes on each captured page from the field's certified paths, null for nothing. */
  reads?: Record<string, string | null>;
  /** Filled by the API (spec 2026-10-21 §3.2): whether this check refreshed the field's expected values, and if not, why (staff only). */
  refresh?: { applied: boolean; reason?: string };
};

/** What started a check (spec 2026-10-21 §3.3). */
export type DriftTrigger = 'run' | 'manual' | 'verify' | 'schedule';
/** A capture a check read, as the API stores it (`StoredCaptureRef`). */
export type DriftCaptureRef = { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string };

/** `trigger`, `keys` and `captures` are absent on checks written before 2026-10-21. */
export type DriftCheckResults = {
  runId: string | null;
  fields: Record<string, DriftFieldResult>;
  trigger?: DriftTrigger;
  /** The fields the check was asked to read, when not the drifted ones. */
  keys?: string[];
  /** url → the capture the check read there; a refresh's re-verify reuses them. */
  captures?: Record<string, DriftCaptureRef>;
};
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/scraper && npx vitest run src/verify/refresh.test.ts src/verify/drift-classify.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/scraper/src/verify/refresh.ts packages/scraper/src/verify/refresh.test.ts packages/scraper/src/verify/drift-classify.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): the refresh rule — which changed values a check may take by itself

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Holds in the certification (`@robot/api`) — spec §3.1

**Files:**
- Create: `packages/api/src/verify/holds.ts`, `packages/api/src/verify/holds.test.ts`
- Modify: `packages/api/src/verify/current-certification.ts` (`FieldCurrency` `:60-64`, `currencyOf` `:109-133`, `fieldCurrencyOf` `:148-152`, `loadFieldCurrencyBatch` `:163-185`, `loadCertificationState` `:223-263`)
- Test: `packages/api/src/verify/current-certification.test.ts`

**Interfaces:**
- Consumes: `fieldHolds` (Task 1); `runVerifiedExtraction`, `PathReading` (Task 2) from `@robot/scraper`.
- Produces:
  - in `holds.ts`: `type Hold = { fieldKey: string; result: FieldVerification; verificationId: string | null; verifiedAt: Date; failedVerificationId: string | null; fieldHashes: string[] }`; `type Certifying = { result: FieldVerification; verificationId: string | null; verifiedAt: Date; fieldHashes: string[] }`; `resultPasses(r: FieldVerification | undefined): boolean`; `loadHolds(db: HoldsDb, sourceId: string): Promise<Hold[]>`; `loadHoldsBatch(db: HoldsDb, sourceIds: string[]): Promise<Map<string, Hold[]>>`; `readingsOf(browser: IBrowser, field: SchemaDefinitionField, paths: CertifiedPath[], captures: Record<string, PageCapture | null>): Promise<Record<string, PathReading>>`; `stillExtracts(result: Pick<FieldVerification, 'certified'>, readings: Record<string, PathReading>): boolean`; `type HoldsDb = Database | Parameters<Parameters<Database['transaction']>[0]>[0]`.
  - in `current-certification.ts`: `FieldCurrency` gains `heldKeys: string[]` and `held: Record<string, Hold>`; `certifyingResult(currency: FieldCurrency, key: string): Certifying | null`; `runnableOf(state: { cert: Certification | null; variants: VariantCurrency }): boolean`; `Certification` gains `held?: string[]` (set only when non-empty); `resultPasses` re-exported.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/verify/holds.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { IBrowser } from '@robot/browser';
import type { CertifiedPath, FieldVerification, SchemaDefinitionField } from '@robot/scraper';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';
import { readingsOf, resultPasses, stillExtracts } from './holds.js';

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' };
const browser = { setContentEvaluate: vi.fn(async () => ({})) } as unknown as IBrowser;

describe('readingsOf (spec 2026-10-21 §3.1)', () => {
  it('reads what a run writes on each captured page, with the path and whether the page shows it; no page load', async () => {
    const r = await readingsOf(browser, price, [LD], { [SHOP_EXAMPLE.p1.url]: SHOP_EXAMPLE.p1, 'https://gone.example/p/9': null });
    expect(r[SHOP_EXAMPLE.p1.url]).toEqual({ value: '129.99', path: LD, shown: true });
    expect(r['https://gone.example/p/9']).toBeUndefined();
  });
  it('reads null where no path resolves', async () => {
    const r = await readingsOf(browser, price, [{ source: 'json-ld', path: 'offers.nothing', transform: 'identity' }], { [SHOP_EXAMPLE.p1.url]: SHOP_EXAMPLE.p1 });
    expect(r[SHOP_EXAMPLE.p1.url]).toEqual({ value: null, path: null, shown: null });
  });
});

describe('stillExtracts', () => {
  const withPath = { certified: [LD] };
  it('is true when some captured page reads a value', () => {
    expect(stillExtracts(withPath, { a: { value: null, path: null, shown: null }, b: { value: '1', path: LD, shown: true } })).toBe(true);
  });
  it('is false when every captured page reads nothing', () => {
    expect(stillExtracts(withPath, { a: { value: null, path: null, shown: null } })).toBe(false);
  });
  it('is true when nothing was captured (nothing learned) or the result has no paths', () => {
    expect(stillExtracts(withPath, {})).toBe(true);
    expect(stillExtracts({ certified: [] }, { a: { value: null, path: null, shown: null } })).toBe(true);
  });
});

describe('resultPasses', () => {
  const base: FieldVerification = { key: 'price', cells: { a: { status: 'pass', found: '1', path: LD } }, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false };
  it('passes a certified result whose every cell passed', () => expect(resultPasses(base)).toBe(true));
  it('fails one failing cell, no cells, or nothing certified', () => {
    expect(resultPasses({ ...base, cells: { a: { status: 'fail', reason: 'different_value' } } })).toBe(false);
    expect(resultPasses({ ...base, cells: {} })).toBe(false);
    expect(resultPasses({ ...base, certified: [] })).toBe(false);
    expect(resultPasses(undefined)).toBe(false);
  });
});
```

In `packages/api/src/verify/current-certification.test.ts` change the imports to

```ts
import { db, sources, sourceVerifications, fieldHolds } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { loadCurrentCertification, loadFieldCurrency, loadFieldCurrencyBatch, notOnWebsiteKeys, sourceDefinitionHash, certifyingResult } from './current-certification.js';
```

and append:

```ts
describe('holds (spec 2026-10-21 §3.1)', () => {
  const heldPath: CertifiedPath[] = [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }];
  const failing = (fieldHashValue: string) => fieldVerification([], { fieldHash: fieldHashValue, cells: { x: { status: 'fail', reason: 'different_value', found: '9' } } });

  async function heldWebsite(tag: string, hashes: (now: string) => string[]) {
    const s = await makeSchemaSource(tag);
    const set = s.source.verificationSet as VerificationSet;
    const now = fieldHash((s.source.schemaDefinition as SchemaDefinitionField[])[0]!, set);
    const passed = currentPriceVerification(s.source, s.urls, heldPath);
    const verifiedAt = new Date(Date.now() - 86_400_000);
    await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: verifiedAt, allPassed: true, results: { price: passed } });
    await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { price: failing(now) } });
    await db.insert(fieldHolds).values({ sourceId: s.sourceId, fieldKey: 'price', result: passed, verifiedAt, fieldHashes: hashes(now) });
    return { ...s, now, verifiedAt };
  }

  it('a held field keeps the website certified on the hold’s paths', async () => {
    const s = await heldWebsite('held', (now) => [now]);
    try {
      const currency = await loadFieldCurrency(db, s.sourceId);
      expect(currency.currentKeys).toEqual([]);
      expect(currency.heldKeys).toEqual(['price']);
      const cert = await loadCurrentCertification(db, s.sourceId);
      expect(cert).not.toBeNull();
      expect(cert!.paths).toEqual({ price: heldPath });
      expect(cert!.held).toEqual(['price']);
      expect(certifyingResult(currency, 'price')!.verifiedAt.toISOString()).toBe(s.verifiedAt.toISOString());
    } finally { await s.cleanup(); }
  });

  it('the customer’s own edit (a hash outside the hold’s list) ends it', async () => {
    const s = await heldWebsite('held-edited', () => ['some-older-hash']);
    try {
      expect((await loadFieldCurrency(db, s.sourceId)).heldKeys).toEqual([]);
      expect(await loadCurrentCertification(db, s.sourceId)).toBeNull();
    } finally { await s.cleanup(); }
  });

  it('a hold that stands for an old and a refreshed hash counts on either', async () => {
    const s = await heldWebsite('held-two', (now) => ['before-the-refresh', now]);
    try {
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });

  it('a current field wins over a stale hold, and the batch read agrees', async () => {
    const s = await makeSchemaSource('held-current');
    try {
      const fresh: CertifiedPath[] = [{ source: 'api', path: 'item.price', transform: 'identity' }];
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { price: currentPriceVerification(s.source, s.urls, fresh) } });
      const set = s.source.verificationSet as VerificationSet;
      await db.insert(fieldHolds).values({ sourceId: s.sourceId, fieldKey: 'price', result: currentPriceVerification(s.source, s.urls, heldPath), verifiedAt: new Date(), fieldHashes: [fieldHash((s.source.schemaDefinition as SchemaDefinitionField[])[0]!, set)] });
      const cert = await loadCurrentCertification(db, s.sourceId);
      expect(cert!.paths).toEqual({ price: fresh });
      expect(cert!.held).toBeUndefined();
      const batch = await loadFieldCurrencyBatch(db, [{ id: s.sourceId, schemaDefinition: s.source.schemaDefinition, verificationSet: s.source.verificationSet }]);
      expect(batch.get(s.sourceId)!.heldKeys).toEqual([]);
      expect(batch.get(s.sourceId)!.currentKeys).toEqual(['price']);
    } finally { await s.cleanup(); }
  });

  it('the batch read counts a hold the same way the single read does', async () => {
    const s = await heldWebsite('held-batch', (now) => [now]);
    try {
      const batch = await loadFieldCurrencyBatch(db, [{ id: s.sourceId, schemaDefinition: s.source.schemaDefinition, verificationSet: s.source.verificationSet }]);
      expect(batch.get(s.sourceId)!.heldKeys).toEqual(['price']);
    } finally { await s.cleanup(); }
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/holds.test.ts src/verify/current-certification.test.ts`
Expected: FAIL — `./holds.js` missing; `heldKeys`/`certifyingResult` undefined.

- [ ] **Step 3: Write `holds.ts`**

Create `packages/api/src/verify/holds.ts`:

```ts
// packages/api/src/verify/holds.ts
// Websites change (spec 2026-10-21 §3.1): a hold keeps a field's last passing
// result after a Verify that did not pass it, while its paths still extract.
// This file loads holds and reads, the way a run would, what a set of paths
// writes on a set of captures (no page load). Writing holds lives here too
// (Task 5). Never a model call.
import { eq, inArray } from 'drizzle-orm';
import { fieldHolds, type Database } from '@robot/db';
import type { IBrowser, PageCapture } from '@robot/browser';
import { runVerifiedExtraction, type CertifiedPath, type FieldVerification, type PathReading, type SchemaDefinitionField } from '@robot/scraper';

/** The database or a transaction on it. */
export type HoldsDb = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type Hold = {
  fieldKey: string;
  result: FieldVerification;
  verificationId: string | null;
  verifiedAt: Date;
  failedVerificationId: string | null;
  fieldHashes: string[];
};

/** The result runs read for a field (its current result or its hold), with the hashes it stands for. */
export type Certifying = { result: FieldVerification; verificationId: string | null; verifiedAt: Date; fieldHashes: string[] };

/** Spec 4.4's pass rule, shared by currency and holds: something certifies it and every cell passed. */
export function resultPasses(r: FieldVerification | undefined): boolean {
  if (!r) return false;
  const cells = Object.values(r.cells);
  return (r.certified.length > 0 || r.defaultOnly === true || r.notOnWebsite === true) && cells.length > 0 && cells.every((c) => c.status === 'pass');
}

function toHold(r: typeof fieldHolds.$inferSelect): Hold {
  return {
    fieldKey: r.fieldKey,
    result: r.result as FieldVerification,
    verificationId: r.verificationId,
    verifiedAt: r.verifiedAt,
    failedVerificationId: r.failedVerificationId,
    fieldHashes: Array.isArray(r.fieldHashes) ? (r.fieldHashes as string[]) : [],
  };
}

export async function loadHolds(db: HoldsDb, sourceId: string): Promise<Hold[]> {
  const rows = await db.select().from(fieldHolds).where(eq(fieldHolds.sourceId, sourceId));
  return rows.map(toHold);
}

export async function loadHoldsBatch(db: HoldsDb, sourceIds: string[]): Promise<Map<string, Hold[]>> {
  const out = new Map<string, Hold[]>();
  if (sourceIds.length === 0) return out;
  const rows = await db.select().from(fieldHolds).where(inArray(fieldHolds.sourceId, sourceIds));
  for (const r of rows) (out.get(r.sourceId) ?? out.set(r.sourceId, []).get(r.sourceId)!).push(toHold(r));
  return out;
}

/**
 * What a run writes for `field` from `paths` on each captured page (`runVerifiedExtraction` with the
 * capture supplied: no page load). A null capture — a page that did not load — has no reading.
 */
export async function readingsOf(
  browser: IBrowser,
  field: SchemaDefinitionField,
  paths: CertifiedPath[],
  captures: Record<string, PageCapture | null>,
): Promise<Record<string, PathReading>> {
  const out: Record<string, PathReading> = {};
  for (const [url, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const r = await runVerifiedExtraction({ url, fields: [{ key: field.key, type: field.type, concept: field.concept, paths }] }, { browser, capture });
    const hit = r.stats.find((s) => s.key === field.key && s.hit);
    const v = r.data[field.key];
    out[url] = { value: v === null || v === undefined ? null : String(v), path: hit?.path ?? null, shown: r.shown[field.key] ?? null };
  }
  return out;
}

/** Spec §3.1: the paths still extract — a value on some captured page, or nothing was captured (nothing learned), or the result has no paths. */
export function stillExtracts(result: Pick<FieldVerification, 'certified'>, readings: Record<string, PathReading>): boolean {
  if (result.certified.length === 0) return true;
  const read = Object.values(readings);
  return read.length === 0 || read.some((r) => r.value !== null);
}
```

- [ ] **Step 4: Count holds in currency**

In `packages/api/src/verify/current-certification.ts`:

1. Add to the imports:

```ts
import { loadHolds, loadHoldsBatch, resultPasses, type Certifying, type Hold } from './holds.js';
```

and below the imports:

```ts
export { resultPasses } from './holds.js';
```

2. `Certification` — after `defaults?: Record<string, string>;` add:

```ts
  /** Spec 2026-10-21 §3.1: the fields read from their hold (the last passing result) because the latest Verify did not pass them. Set only when some are. */
  held?: string[];
```

3. Replace `FieldCurrency` with:

```ts
export type FieldCurrency = {
  latest: { id: string; completedAt: Date; results: Record<string, FieldVerification>; variantResults: VariantVerification | null } | null;
  currentKeys: string[];
  unchangedKeys: string[];
  /** Spec 2026-10-21 §3.1: fields not current whose hold stands for today's hash. Runs read the hold's paths. */
  heldKeys: string[];
  held: Record<string, Hold>;
};

/** A fresh empty currency each time: callers may keep and extend the arrays. */
const none = (): FieldCurrency => ({ latest: null, currentKeys: [], unchangedKeys: [], heldKeys: [], held: {} });
```

and replace every `return { latest: null, currentKeys: [], unchangedKeys: [] };` in the file with `return none();`.

4. In `currencyOf`, change the signature to `function currencyOf(source: …, row: CleanRunRow | undefined, holds: Hold[] = []): FieldCurrency`, replace the `currentKeys` filter body with `return resultPasses(results[key]);` (keep its two comment lines), and replace the final `return` with:

```ts
  // Spec 2026-10-21 §3.1: a field not current is held while its hold stands for today's hash.
  const heldKeys = fields
    .filter((f) => !currentKeys.includes(f.key) && holds.some((h) => h.fieldKey === f.key && h.fieldHashes.includes(fieldHash(f, set))))
    .map((f) => f.key);
  const held = Object.fromEntries(heldKeys.map((k) => [k, holds.find((h) => h.fieldKey === k)!]));

  const variantResults = (row.variantResults as VariantVerification | null | undefined) ?? null;
  return { latest: { id: row.id, completedAt: row.completedAt, results, variantResults }, currentKeys, unchangedKeys, heldKeys, held };
```

5. `fieldCurrencyOf`:

```ts
  const [row, holds] = await Promise.all([latestCleanRun(db, sourceId), loadHolds(db, sourceId)]);
  return currencyOf(source, row ?? undefined, holds);
```

6. `loadFieldCurrencyBatch`: after `const rowBySource = …` add `const holdsBySource = await loadHoldsBatch(db, ids);` and return `currencyOf(s, rowBySource.get(s.id) ?? undefined, holdsBySource.get(s.id) ?? [])`.

7. `loadCertificationState`: destructure `const { latest, currentKeys, heldKeys, held } = await fieldCurrencyOf(db, sourceId, source);`; replace `if (!latest || currentKeys.length !== fields.length) return { cert: null, variants };` with

```ts
  // Spec 2026-10-21 §3.1: every field current or held.
  if (!latest || currentKeys.length + heldKeys.length !== fields.length) return { cert: null, variants };
```

replace the `paths:` line with

```ts
      paths: Object.fromEntries(fields.map((f) => [f.key, held[f.key]?.result.certified ?? latest.results[f.key]?.certified ?? []])),
```

and add after the `defaults:` line:

```ts
      ...(heldKeys.length > 0 ? { held: heldKeys } : {}),
```

8. Append:

```ts
/** The result runs read for `key` now — its current result, else its hold — or null (spec 2026-10-21 §3.1). */
export function certifyingResult(currency: FieldCurrency, key: string): Certifying | null {
  if (currency.latest && currency.currentKeys.includes(key)) {
    const r = currency.latest.results[key]!;
    return { result: r, verificationId: currency.latest.id, verifiedAt: currency.latest.completedAt, fieldHashes: r.fieldHash ? [r.fieldHash] : [] };
  }
  const h = currency.held[key];
  return h ? { result: h.result, verificationId: h.verificationId, verifiedAt: h.verifiedAt, fieldHashes: h.fieldHashes } : null;
}

/** May this website run? `requireCertification`'s rule, as a boolean: a certification, and the variants it needs. */
export function runnableOf(state: { cert: Certification | null; variants: VariantCurrency }): boolean {
  if (!state.cert) return false;
  if (state.variants.required === 'setup-missing') return false;
  return state.variants.required !== 'yes' || (state.variants.current && state.variants.passed);
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/holds.test.ts src/verify/current-certification.test.ts src/crawl/require-certification.test.ts src/routers/ops.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors (other `FieldCurrency` constructions in tests, if any, gain `heldKeys: [], held: {}`).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/verify/holds.ts packages/api/src/verify/holds.test.ts packages/api/src/verify/current-certification.ts packages/api/src/verify/current-certification.test.ts
git commit -m "feat(api): a held field keeps the website certified on its last good paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The check's triggers, readings and stored captures (`@robot/api`) — spec §3.3

**Files:**
- Create: `packages/api/src/verify/check-schedule.ts`
- Modify: `packages/api/src/verify/run-drift-check.ts` (`CaptureProofPagesFn` `:40`, `startDriftCheck` `:107-131`, `runDriftCheck` `:140-216`)
- Test: `packages/api/src/verify/run-drift-check.test.ts`, `packages/api/src/verify/check-schedule.test.ts`

**Interfaces:**
- Consumes: `readingsOf` (Task 3); `DriftTrigger`, `DriftCheckResults.keys/captures/trigger`, `DriftFieldResult.reads` (Task 2); `readCaptureFile`, `StoredCaptureRef` (`capture-store.ts`).
- Produces:
  - `check-schedule.ts`: `WEBSITE_CHECK_DAYS_DEFAULT = 3`; `websiteCheckDays(env?: Record<string, string | undefined>): number`; `nextCheckAt(from?: Date, days?: number): Date`.
  - `run-drift-check.ts`: `type CheckedPage = { ref: StoredCaptureRef; capture: PageCapture; meta?: { boxes?: Box[] } }`; `CaptureProofPagesFn` now returns `Record<string, CheckedPage | { notChecked: string } | null>`; `storedCaptures(refs: Record<string, StoredCaptureRef>): CaptureProofPagesFn`; `startDriftCheck(sourceId, runId, opts: { capture?; fire?; emptyShare?; trigger?: DriftTrigger; keys?: string[] })`; `runDriftCheck(checkId, deps: { capture?; session? })` stores `trigger`, `keys`, `captures` and per-field `reads`, and sets `sources.nextCheckAt`. Task 6 adds refresh deps to `runDriftCheck`.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/verify/check-schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextCheckAt, websiteCheckDays } from './check-schedule.js';

describe('the check schedule (spec 2026-10-21 §3.3)', () => {
  it('is three days unless WEBSITE_CHECK_DAYS says otherwise', () => {
    expect(websiteCheckDays({})).toBe(3);
    expect(websiteCheckDays({ WEBSITE_CHECK_DAYS: '5' })).toBe(5);
    expect(websiteCheckDays({ WEBSITE_CHECK_DAYS: 'soon' })).toBe(3);
    expect(websiteCheckDays({ WEBSITE_CHECK_DAYS: '0' })).toBe(3);
  });
  it('adds the days to the moment given', () => {
    expect(nextCheckAt(new Date('2026-10-21T10:00:00Z'), 3).toISOString()).toBe('2026-10-24T10:00:00.000Z');
  });
});
```

In `packages/api/src/verify/run-drift-check.test.ts`, change the destructured import to

```ts
const { startDriftCheck, runDriftCheck, captureProofPagesWith, outcomeOfFailedCapture, storedCaptures, DRIFT_CHECK_STALL_MS } = await import('./run-drift-check.js');
```

and add inside `describe('runDriftCheck', …)`:

```ts
  it('a scheduled check reads the fields it is given, records what a run writes, the captures it read and the next check', async () => {
    const f = await certifiedWebsite('drift-schedule');
    try {
      await db.update(sources).set({ driftedFields: null }).where(eq(sources.id, f.sourceId));
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(clone(PAGES[u]!))] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price, f.keyOf.name] });
      await runDriftCheck(checkId, { capture });
      const row = (await checkRow(checkId))!;
      expect(row.trigger).toBe('schedule');
      const results = row.results as DriftCheckResults;
      expect(results.trigger).toBe('schedule');
      expect(results.keys).toEqual([f.keyOf.price, f.keyOf.name]);
      expect(Object.keys(results.fields).sort()).toEqual([f.keyOf.name, f.keyOf.price].sort());
      expect(results.fields[f.keyOf.price]!.result).toBe('other-layout');
      expect(results.fields[f.keyOf.price]!.reads).toEqual({ [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149' });
      expect(Object.keys(results.captures ?? {}).sort()).toEqual([...U].sort());
      const src = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    } finally { await f.cleanup(); }
  }, 120_000);

  it('storedCaptures reads the files a Verify stored and loads no page', async () => {
    await writeCaptureFile('11111111-1111-1111-1111-111111111111', clone(PAGES[U[0]!]!));
    const fn = storedCaptures({
      [U[0]!]: { captureId: '11111111-1111-1111-1111-111111111111', capturedAt: new Date().toISOString() },
      [U[1]!]: { captureId: '', capturedAt: new Date().toISOString(), blockedReason: 'The page could not be read.' },
    });
    const out = await fn('irrelevant', [U[0]!, U[1]!, U[2]!]);
    expect((out[U[0]!] as { capture: PageCapture }).capture.url).toBe(U[0]);
    expect(out[U[1]!]).toEqual({ notChecked: 'The page could not be read.' });
    expect(out[U[2]!]).toEqual({ notChecked: 'The page could not be read.' });
  });
```

(`writeCaptureFile` is already imported in this test file; `sources` and `eq` too.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/check-schedule.test.ts src/verify/run-drift-check.test.ts`
Expected: FAIL — `./check-schedule.js` missing; `storedCaptures` undefined; the scheduled check reads the drifted fields.

- [ ] **Step 3: Write `check-schedule.ts`**

```ts
// packages/api/src/verify/check-schedule.ts
// When a website's proof pages are next read by the scheduled check (spec
// 2026-10-21 §3.3). Kept apart from website-checks.ts so the Verify and the
// check can move `next_check_at` without importing the scheduler.
export const WEBSITE_CHECK_DAYS_DEFAULT = 3;

export function websiteCheckDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.WEBSITE_CHECK_DAYS);
  return Number.isFinite(n) && n > 0 ? n : WEBSITE_CHECK_DAYS_DEFAULT;
}

export function nextCheckAt(from: Date = new Date(), days: number = websiteCheckDays()): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
```

- [ ] **Step 4: Extend the check**

In `packages/api/src/verify/run-drift-check.ts`:

1. Imports — change the `@robot/db` import to include nothing new (it already has `sources`); change the scraper import to add `type Box, type DriftTrigger`; add:

```ts
import type { PageCapture } from '@robot/browser';
import { readCaptureFile, type StoredCaptureRef } from './capture-store.js';
import { readingsOf } from './holds.js';
import { nextCheckAt } from './check-schedule.js';
```

2. Replace the `CaptureProofPagesFn` type (and its doc comment's last sentence stays) with:

```ts
/** A captured page the check reads: a proof-page capture record, or a stored Verify capture (no box map). */
export type CheckedPage = { ref: StoredCaptureRef; capture: PageCapture; meta?: { boxes?: Box[] } };

export type CaptureProofPagesFn = (sourceId: string, urls: string[]) => Promise<Record<string, CheckedPage | { notChecked: string } | null>>;

/**
 * Spec 2026-10-21 §3.3 (`verify` trigger): the pages a Verify just read, from the files it stored — no
 * page load, no Jev reading. A page that Verify could not read is not checked, with its reason.
 */
export function storedCaptures(refs: Record<string, StoredCaptureRef>): CaptureProofPagesFn {
  return async (_sourceId, urls) => Object.fromEntries(await Promise.all(urls.map(async (url) => {
    const ref = refs[url];
    if (!ref || !ref.captureId) return [url, { notChecked: ref?.blockedReason ?? 'The page could not be read.' }] as const;
    const capture = await readCaptureFile(ref.captureId);
    return [url, capture ? { ref, capture } : { notChecked: 'The page could not be read.' }] as const;
  })));
}
```

3. `startDriftCheck` — opts type becomes `{ capture?: CaptureProofPagesFn; fire?: boolean; emptyShare?: Record<string, number>; trigger?: DriftTrigger; keys?: string[] }`; the insert becomes:

```ts
  const [row] = await db.insert(driftChecks)
    .values({ sourceId, runId, status: 'running', trigger: opts.trigger ?? 'run', results: { runId, fields: upFront, ...(opts.keys ? { keys: opts.keys } : {}) } })
    .returning({ id: driftChecks.id });
```

4. `runDriftCheck`:
   - after `const drifted = …` replace the `driftedFields` line with:

```ts
    // Spec 2026-10-21 §3.3: a check started with `keys` reads those fields; otherwise the drifted ones (today's rule).
    const upKeys = (check.results as { keys?: string[] } | null)?.keys;
    const trigger = (check.trigger ?? 'run') as DriftTrigger;
    const wanted = upKeys ?? drifted;
    const driftedFields = wanted.map((k) => fields.find((f) => f.key === k)).filter((f): f is SchemaDefinitionField => !!f);
```

   - declare before `if (toClassify.length > 0) {`: `const refs: Record<string, StoredCaptureRef> = {};` and `const readingsByKey: Record<string, Record<string, import('@robot/scraper').PathReading>> = {};` (import `type PathReading` from `@robot/scraper` at the top instead of the inline import).
   - in the records loop replace `else captures[u] = r ? { ...r.capture, boxes: r.meta.boxes } : null;` with

```ts
        else if (r) { captures[u] = { ...r.capture, boxes: r.meta?.boxes }; refs[u] = r.ref; }
        else captures[u] = null;
```

   - inside the session, after `out[field.key] = await classifyDrift({...}, classifyDeps);` add:

```ts
          // What a run writes on each captured page (spec 2026-10-21 §3.3): the hold rule and the refresh read it.
          const pageCaptures = Object.fromEntries(Object.entries(records).filter(([, r]) => !!r && !('notChecked' in r)).map(([u, r]) => [u, (r as CheckedPage).capture]));
          const readings = await readingsOf(browser, field, cert!.paths[field.key]!, pageCaptures);
          readingsByKey[field.key] = readings;
          out[field.key] = { ...out[field.key]!, reads: Object.fromEntries(Object.entries(readings).map(([u, r]) => [u, r.value])) };
```

   - replace `const results: DriftCheckResults = { runId: check.runId, fields: out };` with

```ts
    const results: DriftCheckResults = { runId: check.runId, fields: out, trigger, ...(upKeys ? { keys: upKeys } : {}), captures: refs };
```

   - after the `done` update add:

```ts
    // The pages were just read: the scheduled check need not read them again for a while (spec §3.3).
    await db.update(sources).set({ nextCheckAt: nextCheckAt() }).where(eq(sources.id, check.sourceId));
```

   (`readingsByKey` is unused until Task 6; keep it — Task 6 reads it. If the linter objects, prefix with `void readingsByKey;` after the session.)

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/check-schedule.test.ts src/verify/run-drift-check.test.ts src/verify/drift-end-to-end.test.ts && npx tsc --noEmit`
Expected: PASS (the existing drift tests unchanged), no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/verify/check-schedule.ts packages/api/src/verify/check-schedule.test.ts packages/api/src/verify/run-drift-check.ts packages/api/src/verify/run-drift-check.test.ts
git commit -m "feat(api): a check knows its trigger, reads given fields, records what a run writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verify keeps the last good certification (`@robot/api`) — spec §3.1, §8

**Files:**
- Modify: `packages/api/src/verify/holds.ts` (append `decideHolds`, `writeHolds`, `backfillHolds`), `packages/api/src/verify/run-source-verification.ts` (`:83-205`)
- Create: `packages/api/src/verify/run-source-verification-holds.test.ts`
- Test: `packages/api/src/verify/holds.test.ts`, `packages/api/src/verify/run-source-verification.test.ts` (must stay green)

**Interfaces:**
- Consumes: `loadFieldCurrency`, `certifyingResult` (Task 3); `readingsOf`, `stillExtracts`, `resultPasses`, `Hold`, `Certifying`, `HoldsDb` (Task 3); `startDriftCheck` with `trigger`/`keys`, `storedCaptures` (Task 4); `nextCheckAt` (Task 4).
- Produces:
  - `holds.ts`: `type HoldPlan = { upsert: Hold[]; remove: string[]; readings: Record<string, Record<string, PathReading>> }`; `decideHolds(args: { fields: SchemaDefinitionField[]; set: VerificationSet; keys: string[]; outcome: Record<string, FieldVerification>; certifying: (key: string) => Certifying | null; captures: Record<string, PageCapture | null>; browser: IBrowser; failedVerificationId: string }): Promise<HoldPlan>`; `writeHolds(db: HoldsDb, sourceId: string, plan: Pick<HoldPlan, 'upsert' | 'remove'>): Promise<void>`; `backfillHolds(db: Database, browser: IBrowser, sourceId: string, opts?: { write?: boolean }): Promise<HoldPlan & { certifying: Record<string, Certifying>; latestId: string | null; passing: string[] }>` (`passing`: the fields the latest Verify passed).
  - `run-source-verification.ts`: `runSourceVerification(sourceId, verificationId, opts: { onlyKeys?; free?; startCoverage?; captureRefs?: Record<string, StoredCaptureRef>; origin?: 'customer' | 'refresh'; startCheck?: StartVerifyCheck })`; `type StartVerifyCheck = (sourceId: string, keys: string[], refs: Record<string, StoredCaptureRef>) => Promise<unknown>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/verify/holds.test.ts` (add `decideHolds` to the import from `./holds.js`):

```ts
describe('decideHolds (spec 2026-10-21 §3.1)', () => {
  const U = [SHOP_EXAMPLE.p1.url, SHOP_EXAMPLE.p2.url];
  const caps = { [U[0]!]: SHOP_EXAMPLE.p1, [U[1]!]: SHOP_EXAMPLE.p2 };
  const set = { urls: U, expected: { price: { [U[0]!]: '1.00', [U[1]!]: '2.00' } } };
  const passed: FieldVerification = { key: 'price', cells: { [U[0]!]: { status: 'pass', found: '1', path: LD } }, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false };
  const failed: FieldVerification = { ...passed, certified: [], cells: { [U[0]!]: { status: 'fail', reason: 'different_value', found: '129.99' } } };
  const now = (f: SchemaDefinitionField) => scraper.fieldHash(f, set);
  const certifying = (hashes: string[], result = passed) => () => ({ result, verificationId: 'v0', verifiedAt: new Date('2026-10-12T00:00:00Z'), fieldHashes: hashes });
  const base = { fields: [price], set, keys: ['price'], captures: caps, browser, failedVerificationId: 'v1' };

  it('a passing field ends its hold', async () => {
    const plan = await decideHolds({ ...base, outcome: { price: passed }, certifying: certifying([now(price)]) });
    expect(plan.remove).toEqual(['price']);
    expect(plan.upsert).toEqual([]);
  });
  it('a failing field whose last good path still reads is held, from its certifying result', async () => {
    const plan = await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan.upsert).toEqual([{ fieldKey: 'price', result: passed, verificationId: 'v0', verifiedAt: new Date('2026-10-12T00:00:00Z'), failedVerificationId: 'v1', fieldHashes: [now(price)] }]);
    expect(plan.readings.price![U[0]!]!.value).toBe('129.99');
  });
  it('Review Focus 4: a path that reads on one page and nothing on another keeps the hold', async () => {
    const half = { ...SHOP_EXAMPLE.p2, structuredData: { ...SHOP_EXAMPLE.p2.structuredData, ldJson: [] } };
    const plan = await decideHolds({ ...base, captures: { [U[0]!]: SHOP_EXAMPLE.p1, [U[1]!]: half }, outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan.upsert.map((h) => h.fieldKey)).toEqual(['price']);
  });
  it('a path that reads nothing anywhere is not held', async () => {
    const gone = { source: 'json-ld' as const, path: 'offers.nothing', transform: 'identity' as const };
    const plan = await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)], { ...passed, certified: [gone] }) });
    expect(plan.upsert).toEqual([]);
    expect(plan.remove).toEqual(['price']);
  });
  it('a field the customer changed since its pass, or one that never passed, is not held', async () => {
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying(['an-older-hash']) })).upsert).toEqual([]);
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: () => null })).upsert).toEqual([]);
  });
  it('touches only the fields this Verify checked', async () => {
    const plan = await decideHolds({ ...base, keys: [], outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan).toEqual({ upsert: [], remove: [], readings: {} });
  });
});
```

with, at the top of `holds.test.ts`, `import * as scraper from '@robot/scraper';`.

Create `packages/api/src/verify/run-source-verification-holds.test.ts`:

```ts
// Spec 2026-10-21 §3.1: a Verify that does not pass a certified field keeps
// its last good certification while its paths still extract. runVerification
// and the browser are stubbed the way run-source-verification.test.ts stubs
// them; the captures carry real JSON-LD so the hold rule reads real values.
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { db, fieldHolds, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { writeCaptureFile } from './capture-store.js';

const { runVerificationMock } = vi.hoisted(() => ({ runVerificationMock: vi.fn() }));
vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, runVerification: runVerificationMock, saveVerifiedPaths: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../browser-session.js', () => ({ withBrowserSession: vi.fn(async (fn: (b: unknown) => Promise<unknown>) => fn({ setContentEvaluate: async () => ({}) })) }));
process.env.CAPTURES_DIR = mkdtempSync(join(tmpdir(), 'robot-holds-'));

const { runSourceVerification } = await import('./run-source-verification.js');
const { loadCurrentCertification } = await import('./current-certification.js');
const { backfillHolds } = await import('./holds.js');

const me = await signedInCaller('verify-holds');
afterAll(async () => { await me.cleanup(); });
afterEach(() => runVerificationMock.mockReset());

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const startCoverage = vi.fn(async () => ({ checkId: 'none', status: 'started' as const }));

function page(url: string, price: string | null): PageCapture {
  return {
    url, html: `<html><body><h1>P</h1><p>$${price ?? ''}</p></body></html>`, markdown: '', screenshot: Buffer.from('x'), screenshotTiles: [],
    verdict: { kind: 'ok', status: 200 }, title: '', timestamp: Date.now(),
    structuredData: { ldJson: price === null ? [] : [{ '@type': 'Product', offers: { price } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}

async function certified(tag: string) {
  // A draft binding first (blank cells are allowed), then the three expected prices.
  const f = await createProjectWithSource(me.caller, { tag: `holds-${tag}`, fields: [{ name: 'Price', type: 'money', description: 'x' }], expected: { Price: {} } });
  const urls = f.urls;
  await me.caller.sources.updateBinding({ sourceId: f.sourceId, urls, descriptions: { price: 'x' }, expected: { price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } } });
  const fresh = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const field = (fresh.schemaDefinition as SchemaDefinitionField[])[0]!;
  const hash = fieldHash(field, fresh.verificationSet as VerificationSet);
  const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: LD }]));
  const passed = { key: 'price', cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash };
  const [good] = await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() - 86_400_000), allPassed: true, results: { price: passed } }).returning({ id: sourceVerifications.id });
  return { ...f, urls, hash, passed, goodId: good!.id };
}

const failing = (urls: string[], hash: string) => ({
  key: 'price', certified: [], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash,
  cells: Object.fromEntries(urls.map((u) => [u, { status: 'fail', reason: 'different_value', found: '9' }])),
});

async function verify(sourceId: string, outcome: unknown, captures: Record<string, PageCapture | null>, opts: Record<string, unknown> = {}) {
  const [row] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x' }).returning({ id: sourceVerifications.id });
  runVerificationMock.mockResolvedValue({ outcome: { fields: outcome, allPassed: false, aiCalls: 0 }, captures, captureErrors: {} });
  const startCheck = vi.fn(async () => undefined);
  await runSourceVerification(sourceId, row!.id, { startCoverage, startCheck, ...opts });
  return { id: row!.id, startCheck };
}

describe('a Verify keeps the last good certification (spec 2026-10-21 §3.1)', () => {
  it('a failed re-verify whose path still reads keeps the website certified, holds the field and starts the verify check', async () => {
    const s = await certified('keep');
    try {
      const caps = Object.fromEntries(s.urls.map((u, i) => [u, page(u, String(1.5 + i))]));
      const { id, startCheck } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps);
      const hold = await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) });
      expect(hold).toMatchObject({ fieldKey: 'price', verificationId: s.goodId, failedVerificationId: id, fieldHashes: [s.hash] });
      expect((await loadCurrentCertification(db, s.sourceId))!.paths).toEqual({ price: [LD] });
      expect(startCheck).toHaveBeenCalledWith(s.sourceId, ['price'], expect.any(Object));
      const src = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    } finally { await s.cleanup(); }
  });

  it('a path that reads nothing on any page leaves the field uncertified and starts no check', async () => {
    const s = await certified('lost');
    try {
      const caps = Object.fromEntries(s.urls.map((u) => [u, page(u, null)]));
      const { startCheck } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps);
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeUndefined();
      expect(await loadCurrentCertification(db, s.sourceId)).toBeNull();
      expect(startCheck).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });

  it('a passing Verify ends the hold', async () => {
    const s = await certified('end');
    try {
      await db.insert(fieldHolds).values({ sourceId: s.sourceId, fieldKey: 'price', result: s.passed, verifiedAt: new Date(), fieldHashes: [s.hash] });
      await verify(s.sourceId, { price: s.passed }, Object.fromEntries(s.urls.map((u) => [u, page(u, '1.00')])));
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeUndefined();
    } finally { await s.cleanup(); }
  });

  it('Review Focus 5: a refresh-origin Verify that fails keeps the hold and starts no check', async () => {
    const s = await certified('refresh-origin');
    try {
      const caps = Object.fromEntries(s.urls.map((u, i) => [u, page(u, String(1.5 + i))]));
      const { startCheck } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps, { origin: 'refresh', onlyKeys: ['price'], free: true });
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeDefined();
      expect(startCheck).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });

  it('captures handed in are used first', async () => {
    const s = await certified('refs');
    try {
      await writeCaptureFile('22222222-2222-2222-2222-222222222222', page(s.urls[0]!, '7.00'));
      const refs = { [s.urls[0]!]: { captureId: '22222222-2222-2222-2222-222222222222', capturedAt: new Date().toISOString() } };
      await verify(s.sourceId, { price: s.passed }, Object.fromEntries(s.urls.map((u) => [u, page(u, '1.00')])), { captureRefs: refs, onlyKeys: ['price'] });
      const deps = runVerificationMock.mock.calls[0]![1] as { captures: Record<string, PageCapture> };
      expect(deps.captures[s.urls[0]!]!.structuredData.ldJson).toEqual([{ '@type': 'Product', offers: { price: '7.00' } }]);
    } finally { await s.cleanup(); }
  });
});

describe('backfillHolds (spec 2026-10-21 §8)', () => {
  it('holds what the latest Verify would have kept, from the newest earlier pass, on its stored captures', async () => {
    const s = await certified('backfill');
    try {
      const refs: Record<string, { captureId: string; capturedAt: string }> = {};
      for (const [i, u] of s.urls.entries()) {
        const id = `3333333${i}-3333-3333-3333-333333333333`;
        await writeCaptureFile(id, page(u, String(1.5 + i)));
        refs[u] = { captureId: id, capturedAt: new Date().toISOString() };
      }
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { price: failing(s.urls, s.hash) }, captures: refs });
      expect(await loadCurrentCertification(db, s.sourceId)).toBeNull();
      const out = await backfillHolds(db, { setContentEvaluate: async () => ({}) } as never, s.sourceId, { write: true });
      expect(out.upsert.map((h) => h.fieldKey)).toEqual(['price']);
      expect(out.certifying.price!.verificationId).toBe(s.goodId);
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });
});
```

Note: `createProjectWithSource` without `urls` builds `https://test-<tag>.example.com/p/{1,2,3}` and returns them as `urls`; its draft binding (blank cells) is then completed by the `updateBinding` call, the same two-step the other new test files use.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/holds.test.ts src/verify/run-source-verification-holds.test.ts`
Expected: FAIL — `decideHolds` / `backfillHolds` missing; no hold written.

- [ ] **Step 3: Write the hold decision and writes**

Append to `packages/api/src/verify/holds.ts` (extend the imports: `and, desc, isNotNull, isNull` from drizzle-orm; `sourceVerifications, sources` from `@robot/db`; `fieldHash, type VerificationSet` from `@robot/scraper`; `readCaptureFile, type StoredCaptureRef` from `./capture-store.js`):

```ts
export type HoldPlan = { upsert: Hold[]; remove: string[]; readings: Record<string, Record<string, PathReading>> };

/**
 * Spec §3.1, for each field a Verify checked: a pass ends its hold; a field it did not pass is held when it
 * had a certifying result whose hashes include today's hash and that result's paths still extract on the
 * Verify's captures; otherwise it has no hold. Reads the captures the way a run would (no page load).
 */
export async function decideHolds(args: {
  fields: SchemaDefinitionField[];
  set: VerificationSet;
  keys: string[];
  outcome: Record<string, FieldVerification>;
  certifying: (key: string) => Certifying | null;
  captures: Record<string, PageCapture | null>;
  browser: IBrowser;
  failedVerificationId: string;
}): Promise<HoldPlan> {
  const plan: HoldPlan = { upsert: [], remove: [], readings: {} };
  for (const field of args.fields.filter((f) => args.keys.includes(f.key))) {
    if (resultPasses(args.outcome[field.key])) { plan.remove.push(field.key); continue; }
    const c = args.certifying(field.key);
    if (!c || !c.fieldHashes.includes(fieldHash(field, args.set))) { plan.remove.push(field.key); continue; }
    const readings = await readingsOf(args.browser, field, c.result.certified, args.captures);
    plan.readings[field.key] = readings;
    if (!stillExtracts(c.result, readings)) { plan.remove.push(field.key); continue; }
    plan.upsert.push({ fieldKey: field.key, result: c.result, verificationId: c.verificationId, verifiedAt: c.verifiedAt, failedVerificationId: args.failedVerificationId, fieldHashes: c.fieldHashes });
  }
  return plan;
}

/** Writes a plan's holds and deletes its ended ones — call inside the Verify's own transaction. */
export async function writeHolds(db: HoldsDb, sourceId: string, plan: Pick<HoldPlan, 'upsert' | 'remove'>): Promise<void> {
  for (const h of plan.upsert) {
    const values = { result: h.result, verificationId: h.verificationId, verifiedAt: h.verifiedAt, failedVerificationId: h.failedVerificationId, fieldHashes: h.fieldHashes, updatedAt: new Date() };
    await db.insert(fieldHolds).values({ sourceId, fieldKey: h.fieldKey, ...values })
      .onConflictDoUpdate({ target: [fieldHolds.sourceId, fieldHolds.fieldKey], set: values });
  }
  if (plan.remove.length > 0) await db.delete(fieldHolds).where(and(eq(fieldHolds.sourceId, sourceId), inArray(fieldHolds.fieldKey, plan.remove)));
}

/**
 * Spec 2026-10-21 §8: the hold rule applied after the fact to a website's latest completed, clean Verify —
 * what it would have kept had this code run then. A field's certifying result is its newest earlier pass at
 * today's hash; the pages are the latest Verify's stored capture files (read whatever their age, no page
 * load). With `write`, writes the holds (never deletes one). Used once, for the ten websites (Task 11 reads
 * it without writing, Task 13 with).
 */
export async function backfillHolds(
  db: Database,
  browser: IBrowser,
  sourceId: string,
  opts: { write?: boolean } = {},
): Promise<HoldPlan & { certifying: Record<string, Certifying>; latestId: string | null; passing: string[] }> {
  const empty = { upsert: [], remove: [], readings: {}, certifying: {}, latestId: null, passing: [] };
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return empty;
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;
  const runs = await db.query.sourceVerifications.findMany({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt), desc(sourceVerifications.id)],
    limit: 30,
  });
  const latest = runs[0];
  if (!latest) return empty;
  const latestResults = latest.results as Record<string, FieldVerification>;
  const existing = await loadHolds(db, sourceId);
  const certifying: Record<string, Certifying> = {};
  const keys = fields.filter((f) => !resultPasses(latestResults[f.key]) && !existing.some((h) => h.fieldKey === f.key)).map((f) => f.key);
  for (const key of keys) {
    const field = fields.find((f) => f.key === key)!;
    const now = fieldHash(field, set);
    const good = runs.slice(1).find((r) => {
      const x = (r.results as Record<string, FieldVerification>)[key];
      return resultPasses(x) && x!.fieldHash === now;
    });
    if (good) certifying[key] = { result: (good.results as Record<string, FieldVerification>)[key]!, verificationId: good.id, verifiedAt: good.completedAt!, fieldHashes: [now] };
  }
  const captures: Record<string, PageCapture | null> = {};
  for (const [url, ref] of Object.entries((latest.captures ?? {}) as Record<string, StoredCaptureRef>)) {
    if (url === '_stage' || !set.urls.includes(url)) continue;
    captures[url] = ref.captureId ? await readCaptureFile(ref.captureId) : null;
  }
  const plan = await decideHolds({ fields, set, keys: Object.keys(certifying), outcome: latestResults, certifying: (k) => certifying[k] ?? null, captures, browser, failedVerificationId: latest.id });
  if (opts.write) await writeHolds(db, sourceId, { upsert: plan.upsert, remove: [] });
  const passing = fields.filter((f) => resultPasses(latestResults[f.key])).map((f) => f.key);
  return { ...plan, certifying, latestId: latest.id, passing };
}
```

- [ ] **Step 4: Keep holds at Verify time**

In `packages/api/src/verify/run-source-verification.ts`:

1. Imports — add:

```ts
import { readCaptureFile } from './capture-store.js';
import { certifyingResult, loadFieldCurrency } from './current-certification.js';
import { decideHolds, writeHolds, type HoldPlan } from './holds.js';
import { nextCheckAt } from './check-schedule.js';
```

(`loadStoredCapture`, `writeCaptureFile`, `type StoredCaptureRef` are already imported from `./capture-store.js`; merge `readCaptureFile` into that import line.)

2. Above `export async function runSourceVerification`, add:

```ts
/** Starts the check that follows a Verify which left fields held (spec 2026-10-21 §3.3, trigger `verify`). */
export type StartVerifyCheck = (sourceId: string, keys: string[], refs: Record<string, StoredCaptureRef>) => Promise<unknown>;

const startVerifyCheck: StartVerifyCheck = async (sourceId, keys, refs) => {
  // Imported when needed: run-drift-check reaches this module through refresh-values (spec §3.2), so a static import would be a cycle.
  const { startDriftCheck, storedCaptures } = await import('./run-drift-check.js');
  return startDriftCheck(sourceId, null, { trigger: 'verify', keys, capture: storedCaptures(refs) });
};
```

3. Options: change the third parameter to

```ts
  opts: {
    onlyKeys?: string[];
    free?: boolean;
    startCoverage?: typeof startCoverageCheck;
    /** Spec 2026-10-21 §3.2: captures to verify on, used before any other (a check's own, for a refresh's re-verify). */
    captureRefs?: Record<string, StoredCaptureRef>;
    /** `refresh`: started by an automatic refresh — it never starts a check, so refreshes cannot loop (spec §7.6). */
    origin?: 'customer' | 'refresh';
    startCheck?: StartVerifyCheck;
  } = {},
```

and after `const startCoverage = …` add `const startCheck = opts.startCheck ?? startVerifyCheck;`.

4. After `const hostname = new URL(set.urls[0]!).hostname;` add:

```ts
    // Spec 2026-10-21 §3.1: what certified each field before this Verify — the hold rule compares against it.
    const before = await loadFieldCurrency(db, sourceId);
```

5. Before `if (opts.onlyKeys) {` add:

```ts
    for (const [url, ref] of Object.entries(opts.captureRefs ?? {})) {
      if (!ref.captureId || !set.urls.includes(url)) continue;
      const c = await readCaptureFile(ref.captureId);
      if (c) { reuse[url] = c; reusedRefs.set(url, ref); }
    }
```

and inside the `onlyKeys` loop change `if (!ref.captureId) continue;` to `if (!ref.captureId || reuse[url]) continue;`.

6. Inside `withBrowserSession(async (browser) => { … })`, before `return { run, variantResults };` add:

```ts
      const holdPlan = await decideHolds({
        fields, set,
        keys: opts.onlyKeys ?? fields.map((f) => f.key),
        outcome: run.outcome.fields,
        certifying: (key) => certifyingResult(before, key),
        captures: run.captures,
        browser,
        failedVerificationId: verificationId,
      });
```

and return `{ run, variantResults, holdPlan }` (destructure `holdPlan` at the call: `const { run, variantResults, holdPlan } = await withBrowserSession(…)`; type the callback's return as `Promise<{ run: typeof run; variantResults: VariantVerification | null; holdPlan: HoldPlan }>` if inference needs it).

7. Replace the `await db.update(sourceVerifications).set({ … }).where(eq(sourceVerifications.id, verificationId));` block (the success write) with:

```ts
    // One transaction (spec §3.1): no reader sees a field uncertified between the result and its hold.
    await db.transaction(async (tx) => {
      await tx.update(sourceVerifications).set({
        results: run.outcome.fields,
        variantResults,
        captures: captureRefs,
        allPassed: run.outcome.allPassed,
        aiCalls: run.outcome.aiCalls,
        costUsd: cost.toFixed(4),
        completedAt: new Date(),
      }).where(eq(sourceVerifications.id, verificationId));
      await writeHolds(tx, sourceId, holdPlan);
      await tx.update(sources).set({ nextCheckAt: nextCheckAt() }).where(eq(sources.id, sourceId));
    });
```

8. After the `if (run.outcome.allPassed) { … }` block add:

```ts
    // Spec 2026-10-21 §3.3: fields this Verify left held are checked on its own captures (no page load) —
    // what changed, and whether it changed by nature. Never after a refresh's own re-verify (§7.6).
    if (opts.origin !== 'refresh' && holdPlan.upsert.length > 0) {
      void startCheck(sourceId, holdPlan.upsert.map((h) => h.fieldKey), captureRefs)
        .catch((err) => console.error(`[verify] the check after ${verificationId} could not start:`, err));
    }
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/holds.test.ts src/verify/run-source-verification-holds.test.ts src/verify/run-source-verification.test.ts src/routers/sources-verify.test.ts && npx tsc --noEmit`
Expected: PASS. (`run-source-verification.test.ts`'s browser stub is `{}`: its certified paths are API paths, so `readingsOf` never calls `setContentEvaluate`; if a case there now fails because it expects no `field_holds` side effect, the case is wrong only if it asserted row counts — fix the assertion, not the rule.)

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/verify/holds.ts packages/api/src/verify/holds.test.ts packages/api/src/verify/run-source-verification.ts packages/api/src/verify/run-source-verification-holds.test.ts
git commit -m "feat(api): a failed re-verify keeps the last good certification while it still extracts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Refreshes — the check takes changed values by nature and re-verifies, free (`@robot/api`) — spec §3.2

**Files:**
- Create: `packages/api/src/verify/refresh-values.ts`, `packages/api/src/verify/refresh-values.test.ts`
- Modify: `packages/api/src/verify/run-drift-check.ts` (`runDriftCheck`)
- Test: `packages/api/src/verify/run-drift-check.test.ts`

**Interfaces:**
- Consumes: `planRefresh`, `RefreshPage` (Task 2); `loadFieldCurrency`, `certifyingResult`, `sourceDefinitionHash` (Task 3); `runSourceVerification` options `captureRefs`, `origin`, `free`, `onlyKeys` (Task 5); `readingsByKey`, `refs` in `runDriftCheck` (Task 4); `fieldHolds`, `valueRefreshes` (Task 1).
- Produces:
  - `type RefreshRequest = { key: string; pages: Record<string, RefreshPage>; basisHash: string }`
  - `applyRefreshes(sourceId: string, checkId: string | null, requests: RefreshRequest[]): Promise<{ applied: string[]; skipped: Record<string, 'busy' | 'moved'> }>`
  - `startRefreshVerify(sourceId: string, keys: string[], captureRefs: Record<string, StoredCaptureRef>, deps?: { run?: typeof runSourceVerification }): Promise<string | null>`
  - `runDriftCheck(checkId, deps: { capture?; session?; applyRefreshes?: typeof applyRefreshes; startRefreshVerify?: typeof startRefreshVerify })` — fields' `refresh` filled; `value_refreshes.verification_id` set when a re-verify starts.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/verify/refresh-values.test.ts`:

```ts
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { applyRefreshes, startRefreshVerify } from './refresh-values.js';
import { loadCurrentCertification } from './current-certification.js';

const me = await signedInCaller('refresh-values');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

async function currentPrice(tag: string) {
  const f = await createProjectWithSource(me.caller, { tag: `refresh-${tag}`, fields: [{ name: 'Price', type: 'money' }], expected: { Price: {} } });
  const urls = f.urls;
  await me.caller.sources.updateBinding({ sourceId: f.sourceId, urls, descriptions: { price: 'x' }, expected: { price: { [urls[0]!]: '615.00', [urls[1]!]: '435.00', [urls[2]!]: '3250.00' } } });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const field = (src.schemaDefinition as SchemaDefinitionField[])[0]!;
  const set = src.verificationSet as VerificationSet;
  const hash = fieldHash(field, set);
  const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: 'x', path: LD }]));
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { price: { key: 'price', cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash } } });
  return { ...f, urls, hash, field };
}

const pages = (urls: string[]) => ({ [urls[0]!]: { was: '615.00', now: '625.00', path: LD } });

describe('applyRefreshes (spec 2026-10-21 §3.2)', () => {
  it('writes the new value, keeps the field certified through the change with both hashes, and logs it', async () => {
    const s = await currentPrice('apply');
    try {
      const out = await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(out).toEqual({ applied: ['price'], skipped: {} });
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) }))!;
      const set = src.verificationSet as VerificationSet;
      expect(set.expected.price![s.urls[0]!]).toBe('625.00');
      expect(set.expected.price![s.urls[1]!]).toBe('435.00');
      const toHash = fieldHash(s.field, set);
      const hold = (await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) }))!;
      expect(hold.fieldHashes).toEqual([s.hash, toHash]);
      expect(hold.failedVerificationId).toBeNull();
      const log = (await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, s.sourceId) }))!;
      expect(log).toMatchObject({ fieldKey: 'price', fromHash: s.hash, toHash, pages: pages(s.urls) });
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });

  it('Review Focus 1: a stale autosave writing the old value back keeps the hold', async () => {
    const s = await currentPrice('stale-autosave');
    try {
      await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      await me.caller.sources.updateBinding({ sourceId: s.sourceId, urls: s.urls, descriptions: { price: 'x' }, expected: { price: { [s.urls[0]!]: '615.00', [s.urls[1]!]: '435.00', [s.urls[2]!]: '3250.00' } } });
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });

  it('changes nothing when the stored value moved since the check read it', async () => {
    const s = await currentPrice('moved');
    try {
      await me.caller.sources.updateBinding({ sourceId: s.sourceId, urls: s.urls, descriptions: { price: 'x' }, expected: { price: { [s.urls[0]!]: '600.00', [s.urls[1]!]: '435.00', [s.urls[2]!]: '3250.00' } } });
      const out = await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(out).toEqual({ applied: [], skipped: { price: 'moved' } });
      expect(await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, s.sourceId) })).toBeUndefined();
    } finally { await s.cleanup(); }
  });

  it('Review Focus 3: skips while a Verify is in flight', async () => {
    const s = await currentPrice('busy');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x' });
      const out = await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(out).toEqual({ applied: [], skipped: { price: 'busy' } });
    } finally { await s.cleanup(); }
  });
});

describe('startRefreshVerify', () => {
  it('starts a free, refresh-origin re-verify of the refreshed fields on the check’s captures', async () => {
    const s = await currentPrice('reverify');
    try {
      const run = vi.fn(async () => undefined);
      const refs = { [s.urls[0]!]: { captureId: 'c1', capturedAt: new Date().toISOString() } };
      const id = await startRefreshVerify(s.sourceId, ['price'], refs, { run });
      expect(id).not.toBeNull();
      expect(run).toHaveBeenCalledWith(s.sourceId, id, { onlyKeys: ['price'], free: true, origin: 'refresh', captureRefs: refs });
    } finally { await s.cleanup(); }
  });
  it('Review Focus 3: starts no re-verify while one is in flight', async () => {
    const s = await currentPrice('reverify-busy');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x' });
      const run = vi.fn(async () => undefined);
      expect(await startRefreshVerify(s.sourceId, ['price'], {}, { run })).toBeNull();
      expect(run).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });
});
```

In `run-drift-check.test.ts`, add inside `describe('runDriftCheck', …)` (add `valueRefreshes` to the `@robot/db` import):

```ts
  /** p2's price moved from 219.99 to 229.99, everywhere the page has it (JSON-LD, meta, API, visible text). */
  function priceMovedOnP2(): Record<string, PageCapture> {
    const out: Record<string, PageCapture> = { [U[0]!]: clone(PAGES[U[0]!]!), [U[2]!]: clone(PAGES[U[2]!]!) };
    const p2 = PAGES[U[1]!]!;
    const moved = JSON.parse(JSON.stringify({ ...p2, screenshot: undefined, screenshotTiles: undefined }).replaceAll('219.99', '229.99').replaceAll('21999', '22999')) as PageCapture;
    out[U[1]!] = { ...moved, screenshot: p2.screenshot, screenshotTiles: p2.screenshotTiles };
    return out;
  }

  it('a by-nature field whose path reads a new value in the same place is refreshed and re-verified, free', async () => {
    const f = await certifiedWebsite('drift-refresh');
    try {
      const pages = priceMovedOnP2();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const startRefreshVerify = vi.fn(async () => null);
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price, f.keyOf.name] });
      await runDriftCheck(checkId, { capture, startRefreshVerify });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.price]!.refresh).toEqual({ applied: true });
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect((src.verificationSet as VerificationSet).expected[f.keyOf.price]![U[1]!]).toBe('229.99');
      expect(startRefreshVerify).toHaveBeenCalledWith(f.sourceId, [f.keyOf.price], results.captures);
      expect(await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, f.sourceId) })).toMatchObject({ fieldKey: f.keyOf.price, driftCheckId: checkId });
      expect(agentCtor).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  }, 120_000);

  it('a price the page does not show is refused, and nothing is written', async () => {
    const f = await certifiedWebsite('drift-no-refresh');
    try {
      // p2's page data says 229.99, but its visible text no longer shows any price.
      const hidden = priceMovedOnP2()[U[1]!]!;
      hidden.html = hidden.html.replaceAll('229.99', '');
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(u === U[1] ? hidden : clone(PAGES[u]!))] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const startRefreshVerify = vi.fn(async () => null);
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price] });
      await runDriftCheck(checkId, { capture, startRefreshVerify });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.price]!.refresh).toEqual({ applied: false, reason: 'not-shown' });
      expect(startRefreshVerify).not.toHaveBeenCalled();
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect((src.verificationSet as VerificationSet).expected[f.keyOf.price]![U[1]!]).toBe('219.99');
    } finally { await f.cleanup(); }
  }, 120_000);
```

And the name case, in the same `describe`:

```ts
  it('a changed text field records no refresh at all', async () => {
    const f = await certifiedWebsite('drift-name');
    try {
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(driftedPages()[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.name] });
      await runDriftCheck(checkId, { capture, startRefreshVerify: vi.fn(async () => null) });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.name]!.result).toBe('changed');
      expect(results.fields[f.keyOf.name]!.refresh).toBeUndefined();
    } finally { await f.cleanup(); }
  }, 120_000);
```

(If `SHOP_EXAMPLE.p2` writes the price in its intercepted API as cents under another number than `21999`, adjust `priceMovedOnP2` to that number — read `packages/api/src/test-helpers/shop-example.ts` first.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/refresh-values.test.ts src/verify/run-drift-check.test.ts`
Expected: FAIL — `./refresh-values.js` missing; the check refreshes nothing.

- [ ] **Step 3: Write `refresh-values.ts`**

```ts
// packages/api/src/verify/refresh-values.ts
// Websites change (spec 2026-10-21 §3.2): apply the refreshes a check planned
// — new expected values for by-nature fields, the hold that keeps the field
// certified through the change, one `value_refreshes` row each — then start a
// free re-verify of those fields on the check's own captures. Never a model:
// the re-verify is `free` and refresh-origin (it starts no check of its own).
import { eq } from 'drizzle-orm';
import { db, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type RefreshPage, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { certifyingResult, loadFieldCurrency, sourceDefinitionHash } from './current-certification.js';
import { resolveInFlightVerification } from './in-flight.js';
import { runSourceVerification } from './run-source-verification.js';
import type { StoredCaptureRef } from './capture-store.js';

/** One field's planned refresh, with the field hash the check read under. */
export type RefreshRequest = { key: string; pages: Record<string, RefreshPage>; basisHash: string };

/**
 * All of a check's refreshes in one transaction, under the source row lock `updateBinding` takes. A field is
 * skipped as `moved` when its hash or any refreshed cell's stored value changed since the check read them,
 * and everything is skipped as `busy` while a Verify is in flight (spec §3.2, §7.4).
 */
export async function applyRefreshes(sourceId: string, checkId: string | null, requests: RefreshRequest[]): Promise<{ applied: string[]; skipped: Record<string, 'busy' | 'moved'> }> {
  if (requests.length === 0) return { applied: [], skipped: {} };
  if (await resolveInFlightVerification(db, sourceId)) return { applied: [], skipped: Object.fromEntries(requests.map((r) => [r.key, 'busy' as const])) };
  const currency = await loadFieldCurrency(db, sourceId);
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet }).from(sources).where(eq(sources.id, sourceId)).for('update');
    const fields = (locked?.schemaDefinition ?? []) as SchemaDefinitionField[];
    let set = (locked?.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const applied: string[] = [];
    const skipped: Record<string, 'busy' | 'moved'> = {};
    for (const req of requests) {
      const field = fields.find((f) => f.key === req.key);
      const certifying = certifyingResult(currency, req.key);
      const fromHash = field ? fieldHash(field, set) : null;
      const unchanged = !!field && !!certifying && fromHash === req.basisHash
        && Object.entries(req.pages).every(([url, p]) => (set.expected[req.key]?.[url] ?? '') === p.was);
      if (!field || !certifying || !unchanged) { skipped[req.key] = 'moved'; continue; }
      const expected = { ...(set.expected[req.key] ?? {}) };
      for (const [url, p] of Object.entries(req.pages)) expected[url] = p.now;
      set = { ...set, expected: { ...set.expected, [req.key]: expected } };
      const toHash = fieldHash(field, set);
      const fieldHashes = [...new Set([...certifying.fieldHashes, fromHash!, toHash])];
      const values = {
        result: certifying.result, verificationId: certifying.verificationId, verifiedAt: certifying.verifiedAt,
        failedVerificationId: currency.held[req.key]?.failedVerificationId ?? null, fieldHashes, updatedAt: new Date(),
      };
      await tx.insert(fieldHolds).values({ sourceId, fieldKey: req.key, ...values })
        .onConflictDoUpdate({ target: [fieldHolds.sourceId, fieldHolds.fieldKey], set: values });
      await tx.insert(valueRefreshes).values({ sourceId, fieldKey: req.key, driftCheckId: checkId, pages: req.pages, fromHash: fromHash!, toHash });
      applied.push(req.key);
    }
    if (applied.length > 0) await tx.update(sources).set({ verificationSet: set, updatedAt: new Date() }).where(eq(sources.id, sourceId));
    return { applied, skipped };
  });
}

/**
 * The free re-verify of refreshed fields on the check's captures (spec §3.2): `onlyKeys`, `free`, origin
 * `refresh`. None while another Verify is in flight. Returns the new verification's id, or null.
 */
export async function startRefreshVerify(
  sourceId: string,
  keys: string[],
  captureRefs: Record<string, StoredCaptureRef>,
  deps: { run?: typeof runSourceVerification } = {},
): Promise<string | null> {
  if (keys.length === 0) return null;
  if (await resolveInFlightVerification(db, sourceId)) return null;
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const hash = source ? sourceDefinitionHash(source) : null;
  if (!hash) return null;
  const [row] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: hash }).returning({ id: sourceVerifications.id });
  void (deps.run ?? runSourceVerification)(sourceId, row!.id, { onlyKeys: keys, free: true, origin: 'refresh', captureRefs })
    .catch((err) => console.error(`[refresh] re-verify ${row!.id} failed:`, err));
  return row!.id;
}
```

- [ ] **Step 4: Apply refreshes at the end of every check**

In `packages/api/src/verify/run-drift-check.ts`:

1. Imports — add `inArray` to the drizzle import, `valueRefreshes` to the `@robot/db` import, `fieldHash, planRefresh` to the scraper import, and:

```ts
import { certifyingResult, loadFieldCurrency } from './current-certification.js';
import { applyRefreshes, startRefreshVerify, type RefreshRequest } from './refresh-values.js';
```

2. `runDriftCheck`'s `deps` type: `{ capture?: CaptureProofPagesFn; session?: Session; applyRefreshes?: typeof applyRefreshes; startRefreshVerify?: typeof startRefreshVerify }`.

3. After the empty-share loop and before `const results: DriftCheckResults = …`, add:

```ts
    // Spec 2026-10-21 §3.2: refresh what changed by nature, all or nothing per field.
    const currency = await loadFieldCurrency(db, check.sourceId);
    const requests: RefreshRequest[] = [];
    for (const field of toClassify) {
      const certifying = certifyingResult(currency, field.key);
      const readings = readingsByKey[field.key];
      if (!certifying || !readings) continue;
      const provenOn = Object.fromEntries(Object.entries(certifying.result.cells).map(([u, c]) => [u, c.status === 'pass' ? c.path : undefined]));
      const plan = planRefresh({ field, expected: set.expected[field.key] ?? {}, provenOn, readings });
      if (plan.kind === 'refresh') requests.push({ key: field.key, pages: plan.pages, basisHash: fieldHash(field, set) });
      else if (plan.kind === 'refused' && plan.reason !== 'not-by-nature') out[field.key] = { ...out[field.key]!, refresh: { applied: false, reason: plan.reason } };
    }
    let refreshed: string[] = [];
    if (requests.length > 0) {
      try {
        const outcome = await (deps.applyRefreshes ?? applyRefreshes)(check.sourceId, checkId, requests);
        refreshed = outcome.applied;
        for (const r of requests) {
          out[r.key] = { ...out[r.key]!, refresh: outcome.applied.includes(r.key) ? { applied: true } : { applied: false, reason: outcome.skipped[r.key] ?? 'busy' } };
        }
      } catch (err) {
        console.error(`[drift] check ${checkId}: refreshing failed:`, err);
        for (const r of requests) out[r.key] = { ...out[r.key]!, refresh: { applied: false, reason: 'not-applied' } };
      }
    }
```

4. After the `next_check_at` update (Task 4), add:

```ts
    // The refreshed fields are verified again, free, on the pages this check just read.
    if (refreshed.length > 0) {
      const id = await (deps.startRefreshVerify ?? startRefreshVerify)(check.sourceId, refreshed, refs);
      if (id) await db.update(valueRefreshes).set({ verificationId: id }).where(and(eq(valueRefreshes.driftCheckId, checkId), inArray(valueRefreshes.fieldKey, refreshed)));
    }
```

(Remove the `void readingsByKey;` placeholder from Task 4 if one was added.)

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/refresh-values.test.ts src/verify/run-drift-check.test.ts src/verify/drift-end-to-end.test.ts src/verify/run-source-verification-holds.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/verify/refresh-values.ts packages/api/src/verify/refresh-values.test.ts packages/api/src/verify/run-drift-check.ts packages/api/src/verify/run-drift-check.test.ts
git commit -m "feat(api): a check refreshes values that change by nature, then re-verifies them, free

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The schedule (`@robot/api`, `@robot/api-server`) — spec §3.3

**Files:**
- Create: `packages/api/src/verify/website-checks.ts`, `packages/api/src/verify/website-checks.test.ts`
- Modify: `packages/api/package.json` (`exports`), `packages/api-server/src/index.ts`

**Interfaces:**
- Consumes: `startDriftCheck`, `runDriftCheck`, `CaptureProofPagesFn` (Task 4/6); `startCoverageCheck`, `runCoverageCheck`, `CoverageDeps` (`run-coverage-check.ts`); `loadCertificationState`, `runnableOf` (Task 3); `resolveInFlightVerification`; `websiteCheckDays` (Task 4).
- Produces:
  - `claimDueWebsite(opts: { only?: string[]; days?: number }): Promise<string | null>`
  - `checkWebsite(sourceId: string, deps?: { capture?: CaptureProofPagesFn; coverage?: CoverageDeps }): Promise<'checked' | 'skipped'>`
  - `runDueWebsiteChecks(opts?: { limit?: number; only?: string[]; check?: typeof checkWebsite }): Promise<{ checked: string[]; skipped: string[] }>`
  - `websiteChecksEnabled(env?): boolean`; `startWebsiteChecks(opts?: { intervalMs?: number; firstDelayMs?: number; env?: Record<string, string | undefined>; sweep?: () => Promise<unknown> }): () => void`
  - package export `@robot/api/website-checks`.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/verify/website-checks.test.ts`:

```ts
// Spec 2026-10-21 §3.3. DB-backed against the shared dev database: every claim
// here passes `only` (Review Focus 2) — a bare claim would pick up real websites.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, coverageChecks, driftChecks, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { claimDueWebsite, checkWebsite, runDueWebsiteChecks, startWebsiteChecks, websiteChecksEnabled } from './website-checks.js';

const me = await signedInCaller('website-checks');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

async function certified(tag: string, opts: { listing?: boolean } = {}) {
  const f = await createProjectWithSource(me.caller, { tag: `checks-${tag}`, fields: [{ name: 'Price', type: 'money' }], expected: { Price: {} } });
  await me.caller.sources.updateBinding({
    sourceId: f.sourceId, urls: f.urls, ...(opts.listing ? { listingUrl: `https://test-checks-${tag}.example.com/c` } : {}),
    descriptions: { price: 'x' }, expected: { price: Object.fromEntries(f.urls.map((u, i) => [u, `${i + 1}.00`])) },
  });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const hash = fieldHash((src.schemaDefinition as SchemaDefinitionField[])[0]!, src.verificationSet as VerificationSet);
  const cells = Object.fromEntries(f.urls.map((u) => [u, { status: 'pass', found: 'x', path: LD }]));
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { price: { key: 'price', cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash } } });
  return f;
}

// Every page "could not be read": the check runs end to end with no browser and learns nothing.
const capture = vi.fn(async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, { notChecked: 'The page could not be read.' }])));

describe('claimDueWebsite', () => {
  it('Review Focus 2: claims only the websites it is given, once, and moves their next check on', async () => {
    const a = await certified('claim');
    try {
      const [first, second] = await Promise.all([claimDueWebsite({ only: [a.sourceId] }), claimDueWebsite({ only: [a.sourceId] })]);
      expect([first, second].filter(Boolean)).toEqual([a.sourceId]);
      expect(await claimDueWebsite({ only: [a.sourceId] })).toBeNull();
      const src = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    } finally { await a.cleanup(); }
  });
  it('never claims a website with no completed Verify', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'checks-never', fields: [{ name: 'Price', type: 'money' }], expected: { Price: {} } });
    try { expect(await claimDueWebsite({ only: [f.sourceId] })).toBeNull(); } finally { await f.cleanup(); }
  });
});

describe('checkWebsite', () => {
  it('runs the scheduled check on every certified field, then the coverage check', async () => {
    const a = await certified('run', { listing: true });
    try {
      const listing = vi.fn(async () => ({ productUrls: [], verdictMessage: null }));
      expect(await checkWebsite(a.sourceId, { capture, coverage: { listing } })).toBe('checked');
      const check = await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, a.sourceId) });
      expect(check).toMatchObject({ trigger: 'schedule', status: 'done' });
      expect((check!.results as { keys?: string[] }).keys).toEqual(['price']);
      expect(listing).toHaveBeenCalled();
      expect(await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, a.sourceId) })).toMatchObject({ status: 'done' });
    } finally { await a.cleanup(); }
  });
  it('skips a website with a Verify in flight, and tries again within the hour', async () => {
    const a = await certified('busy');
    try {
      await db.insert(sourceVerifications).values({ sourceId: a.sourceId, definitionHash: 'x' });
      expect(await checkWebsite(a.sourceId, { capture })).toBe('skipped');
      const src = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeLessThan(Date.now() + 2 * 3_600_000);
    } finally { await a.cleanup(); }
  });
  it('skips a website that is not certified', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'checks-uncert', fields: [{ name: 'Price', type: 'money' }], expected: { Price: {} } });
    try { expect(await checkWebsite(f.sourceId, { capture })).toBe('skipped'); } finally { await f.cleanup(); }
  });
});

describe('runDueWebsiteChecks', () => {
  it('checks due websites one at a time, up to the limit', async () => {
    const a = await certified('due-a');
    const b = await certified('due-b');
    try {
      const check = vi.fn(async () => 'checked' as const);
      const out = await runDueWebsiteChecks({ limit: 1, only: [a.sourceId, b.sourceId], check });
      expect(out.checked).toHaveLength(1);
      expect(check).toHaveBeenCalledTimes(1);
    } finally { await a.cleanup(); await b.cleanup(); }
  });
});

describe('startWebsiteChecks', () => {
  it('sweeps after the first delay and then every interval; WEBSITE_CHECKS=off never sweeps', async () => {
    vi.useFakeTimers();
    try {
      expect(websiteChecksEnabled({ WEBSITE_CHECKS: 'off' })).toBe(false);
      expect(websiteChecksEnabled({})).toBe(true);
      const sweep = vi.fn(async () => undefined);
      const stop = startWebsiteChecks({ sweep, firstDelayMs: 10, intervalMs: 100, env: {} });
      await vi.advanceTimersByTimeAsync(10);
      expect(sweep).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(sweep).toHaveBeenCalledTimes(2);
      stop();
      const off = vi.fn(async () => undefined);
      startWebsiteChecks({ sweep: off, firstDelayMs: 10, intervalMs: 100, env: { WEBSITE_CHECKS: 'off' } });
      await vi.advanceTimersByTimeAsync(500);
      expect(off).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/website-checks.test.ts`
Expected: FAIL — `./website-checks.js` missing.

- [ ] **Step 3: Write the scheduler**

Create `packages/api/src/verify/website-checks.ts`:

```ts
// packages/api/src/verify/website-checks.ts
// The scheduled website check (spec 2026-10-21 §3.3): every hour the
// api-server claims up to six websites whose `next_check_at` has passed and,
// one at a time, re-reads their proof pages (the drift check, trigger
// `schedule`, every certified field) and then samples their listing (the
// coverage check). Free: page loads and code only, no Jev, no model. The claim
// is `FOR UPDATE SKIP LOCKED`, so two api-servers on one database never check
// the same website twice.
import { and, eq, sql } from 'drizzle-orm';
import { db, runs, sources } from '@robot/db';
import type { VerificationSet } from '@robot/scraper';
import { loadCertificationState, runnableOf } from './current-certification.js';
import { resolveInFlightVerification } from './in-flight.js';
import { runDriftCheck, startDriftCheck, type CaptureProofPagesFn } from './run-drift-check.js';
import { runCoverageCheck, startCoverageCheck, type CoverageDeps } from './run-coverage-check.js';
import { websiteCheckDays } from './check-schedule.js';

const HOUR_MS = 60 * 60 * 1000;
export const SWEEP_LIMIT = 6;

export function websiteChecksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.WEBSITE_CHECKS ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Claims one due website and moves its `next_check_at` on by the check interval, atomically. Due: never
 * checked or past its time, with a completed clean Verify. `only` restricts the claim to those websites —
 * every test passes it (the test database is Marko's).
 */
export async function claimDueWebsite(opts: { only?: string[]; days?: number } = {}): Promise<string | null> {
  const seconds = Math.round((opts.days ?? websiteCheckDays()) * 86_400);
  const only = opts.only ? sql`AND s.id IN (${sql.join(opts.only.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  if (opts.only && opts.only.length === 0) return null;
  const result = await db.execute(sql`
    UPDATE sources SET next_check_at = now() + make_interval(secs => ${seconds})
     WHERE id = (
       SELECT s.id FROM sources s
        WHERE s.schema_definition IS NOT NULL AND s.verification_set IS NOT NULL
          AND (s.next_check_at IS NULL OR s.next_check_at <= now())
          AND EXISTS (SELECT 1 FROM source_verifications v WHERE v.source_id = s.id AND v.completed_at IS NOT NULL AND v.error_message IS NULL)
          ${only}
        ORDER BY s.next_check_at ASC NULLS FIRST, s.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id
  `);
  // postgres-js via drizzle returns the row list itself (claim-item.ts's note).
  const row = (result as unknown as Array<{ id: string }>)[0];
  return row ? String(row.id) : null;
}

async function retryWithinTheHour(sourceId: string): Promise<'skipped'> {
  await db.update(sources).set({ nextCheckAt: new Date(Date.now() + HOUR_MS) }).where(eq(sources.id, sourceId));
  return 'skipped';
}

/** One website's scheduled check: the proof pages, then the listing sample. Skipped while busy or uncertified. */
export async function checkWebsite(sourceId: string, deps: { capture?: CaptureProofPagesFn; coverage?: CoverageDeps } = {}): Promise<'checked' | 'skipped'> {
  const state = await loadCertificationState(db, sourceId);
  if (!runnableOf(state) || !state.cert) return 'skipped';
  if (await resolveInFlightVerification(db, sourceId)) return retryWithinTheHour(sourceId);
  const extracting = await db.query.runs.findFirst({ where: and(eq(runs.sourceId, sourceId), eq(runs.status, 'extracting')), columns: { id: true } });
  if (extracting) return retryWithinTheHour(sourceId);
  const keys = Object.keys(state.cert.paths).filter((k) => state.cert!.paths[k]!.length > 0);
  if (keys.length === 0) return 'skipped';
  const started = await startDriftCheck(sourceId, null, { trigger: 'schedule', keys, fire: false, ...(deps.capture ? { capture: deps.capture } : {}) });
  if (started.status === 'in-progress') return retryWithinTheHour(sourceId);
  await runDriftCheck(started.checkId, deps.capture ? { capture: deps.capture } : {});
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { verificationSet: true } });
  if ((source?.verificationSet as VerificationSet | null)?.listing_url) {
    const coverage = await startCoverageCheck(sourceId, null, { fire: false, ...(deps.coverage ?? {}) });
    if (coverage.status === 'started') await runCoverageCheck(coverage.checkId, deps.coverage ?? {});
  }
  return 'checked';
}

/** One sweep: claim and check due websites one at a time, at most `limit`. Never throws. */
export async function runDueWebsiteChecks(opts: { limit?: number; only?: string[]; check?: typeof checkWebsite } = {}): Promise<{ checked: string[]; skipped: string[] }> {
  const out = { checked: [] as string[], skipped: [] as string[] };
  const check = opts.check ?? checkWebsite;
  for (let i = 0; i < (opts.limit ?? SWEEP_LIMIT); i++) {
    let id: string | null = null;
    try {
      id = await claimDueWebsite(opts.only ? { only: opts.only } : {});
      if (!id) break;
      (await check(id)) === 'checked' ? out.checked.push(id) : out.skipped.push(id);
    } catch (err) {
      console.error(`[website-checks] ${id ?? 'claim'} failed:`, err);
      if (id) out.skipped.push(id);
    }
  }
  return out;
}

/** The api-server's timer: a first sweep after `firstDelayMs`, then one every `intervalMs`; never two at once. Returns a stop function. */
export function startWebsiteChecks(opts: { intervalMs?: number; firstDelayMs?: number; env?: Record<string, string | undefined>; sweep?: () => Promise<unknown> } = {}): () => void {
  if (!websiteChecksEnabled(opts.env)) return () => {};
  const sweep = opts.sweep ?? (() => runDueWebsiteChecks());
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sweep(); } catch (err) { console.error('[website-checks] sweep failed:', err); } finally { running = false; }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), opts.intervalMs ?? HOUR_MS);
    interval.unref?.();
  }, opts.firstDelayMs ?? 10 * 60 * 1000);
  first.unref?.();
  return () => { clearTimeout(first); if (interval) clearInterval(interval); };
}
```

In `packages/api/package.json` `exports`, add after `"./auth": "./src/auth/session.ts",`:

```json
    "./website-checks": "./src/verify/website-checks.ts",
```

In `packages/api-server/src/index.ts`, after the `serve(…)` call add:

```ts
// The scheduled website check (spec 2026-10-21 §3.3): every hour, free. `WEBSITE_CHECKS=off` turns it off.
const { startWebsiteChecks, websiteChecksEnabled } = await import('@robot/api/website-checks');
startWebsiteChecks();
console.log(`[api-server] website checks ${websiteChecksEnabled() ? 'on' : 'off'}`);
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/website-checks.test.ts && npx tsc --noEmit && cd ../api-server && npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors (api-server's own tests never start the timer: they import `createApp`, not `index.ts`).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/verify/website-checks.ts packages/api/src/verify/website-checks.test.ts packages/api/package.json packages/api-server/src/index.ts
git commit -m "feat(api-server): a free website check every three days, one website at a time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: What the app reads — attention, refreshes, runnable, ops (`@robot/api`) — spec §3.5, §5, §6

**Files:**
- Create: `packages/api/src/verify/attention.ts`, `packages/api/src/verify/attention.test.ts`, `packages/api/src/test-helpers/seed-attention.ts`
- Modify: `packages/api/src/routers/sources.ts` (`get` `:277-313`, `verificationStatus` `:1177-1238`, new `attention` after `coverage` `:~1261`), `packages/api/src/routers/projects.ts` (`get` `:146-153`), `packages/api/src/routers/ops.ts` (`websites` `:105-153`, `website` `:179-310`)
- Test: `packages/api/src/routers/sources-attention.test.ts`, `packages/api/src/routers/ops.test.ts`

**Interfaces:**
- Consumes: `loadFieldCurrency`, `loadCertificationState`, `runnableOf` (Task 3); `DriftCheckResults`, `DriftFieldResult`, `RefreshPage` (Task 2); `fieldHolds`, `valueRefreshes` (Task 1).
- Produces:
  - `attention.ts`: `type Attention = { fields: string[]; heldSince: Date | null; goneProducts: number[]; findings: Record<string, DriftFieldResult> }`; `websiteAttention(db: Database, sourceId: string): Promise<Attention>`; `needsAttention(a: Attention): boolean`; `type RefreshLineData = { key: string; at: Date; pages: Record<string, RefreshPage> }`; `latestRefreshes(db: Database, sourceId: string): Promise<RefreshLineData[]>`; `opsRefreshes(db: Database, sourceId: string): Promise<Array<{ at: Date; key: string; pages: Record<string, RefreshPage> }>>`.
  - `sources.attention({ sourceId })` → `Attention & { refreshes: RefreshLineData[]; runnable: boolean }`.
  - `sources.get` → adds `needsAttention: boolean`; `projects.get().websites[]` → adds `needsAttention: boolean`.
  - `sources.verificationStatus` → adds `heldKeys: string[]`, `held: Record<string, { verifiedAt: Date }>`, `runnable: boolean`.
  - `ops.websites[]` → adds `held: number`; `ops.website.fields[]` → `state` may be `'held'`, adds `heldSince?: string` (ISO); `ops.website` → adds `refreshes: Array<{ at: string; key: string; name: string; pages: Record<string, RefreshPage> }>`.
  - `seed-attention.ts`: `seedAttention(sourceId: string, args: { heldKey: string; refreshedKey: string }): Promise<{ heldSince: Date }>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/verify/attention.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, driftChecks, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type CertifiedPath, type DriftCheckResults, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { latestRefreshes, needsAttention, websiteAttention } from './attention.js';

const me = await signedInCaller('attention');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

async function twoFields(tag: string) {
  const f = await createProjectWithSource(me.caller, { tag: `attn-${tag}`, fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }], expected: { Price: {}, Title: {} } });
  await me.caller.sources.updateBinding({
    sourceId: f.sourceId, urls: f.urls, descriptions: { price: 'x', title: 'x' },
    expected: { price: Object.fromEntries(f.urls.map((u, i) => [u, `${i + 1}.00`])), title: Object.fromEntries(f.urls.map((u, i) => [u, `T${i}`])) },
  });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const fields = src.schemaDefinition as SchemaDefinitionField[];
  const set = src.verificationSet as VerificationSet;
  const pass = (key: string) => ({ key, cells: Object.fromEntries(f.urls.map((u) => [u, { status: 'pass', found: 'x', path: LD }])), certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(fields.find((x) => x.key === key)!, set) });
  return { ...f, fields, set, pass };
}

describe('websiteAttention (spec 2026-10-21 §3.5)', () => {
  it('nothing needs attention on a current website with no check', async () => {
    const s = await twoFields('none');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { price: s.pass('price'), title: s.pass('title') } });
      const a = await websiteAttention(db, s.sourceId);
      expect(a).toEqual({ fields: [], heldSince: null, goneProducts: [], findings: {} });
      expect(needsAttention(a)).toBe(false);
    } finally { await s.cleanup(); }
  });

  it('a held field, a check’s unrefreshed change and a gone page need attention; a refreshed change does not', async () => {
    const s = await twoFields('mixed');
    try {
      const verifiedAt = new Date(Date.now() - 2 * 86_400_000);
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: verifiedAt, allPassed: true, results: { price: s.pass('price'), title: s.pass('title') } });
      const failedTitle = { ...s.pass('title'), certified: [], cells: { [s.urls[0]!]: { status: 'fail', reason: 'different_value' } } };
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() - 86_400_000), allPassed: false, results: { price: s.pass('price'), title: failedTitle } });
      await db.insert(fieldHolds).values({ sourceId: s.sourceId, fieldKey: 'title', result: s.pass('title'), verifiedAt, fieldHashes: [s.pass('title').fieldHash] });
      const results: DriftCheckResults = {
        runId: null, trigger: 'schedule',
        fields: {
          title: { key: 'title', result: 'changed', pages: { [s.urls[0]!]: { status: 'ok', value: 'New', changed: true, was: 'T0' } } },
          price: { key: 'price', result: 'changed', pages: { [s.urls[1]!]: { status: 'page-gone' } }, refresh: { applied: true } },
        },
      };
      await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'done', trigger: 'schedule', results, completedAt: new Date() });
      const a = await websiteAttention(db, s.sourceId);
      expect(a.fields).toEqual(['title']);
      expect(a.heldSince!.toISOString()).toBe(verifiedAt.toISOString());
      expect(a.goneProducts).toEqual([2]);
      expect(Object.keys(a.findings)).toEqual(['title']);
    } finally { await s.cleanup(); }
  });

  it('a current field’s finding older than the latest Verify does not count', async () => {
    const s = await twoFields('old-check');
    try {
      await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'done', trigger: 'schedule', completedAt: new Date(), results: { runId: null, fields: { price: { key: 'price', result: 'lost', pages: {} } } } });
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() + 1000), allPassed: true, results: { price: s.pass('price'), title: s.pass('title') } });
      expect((await websiteAttention(db, s.sourceId)).fields).toEqual([]);
    } finally { await s.cleanup(); }
  });
});

describe('latestRefreshes', () => {
  it('gives each field’s newest refresh while it still describes the field', async () => {
    const s = await twoFields('refreshes');
    try {
      const pages = { [s.urls[0]!]: { was: '1.00', now: '1.10', path: LD } };
      await db.insert(valueRefreshes).values({ sourceId: s.sourceId, fieldKey: 'price', pages, fromHash: 'a', toHash: s.pass('price').fieldHash, at: new Date() });
      await db.insert(valueRefreshes).values({ sourceId: s.sourceId, fieldKey: 'title', pages, fromHash: 'a', toHash: 'stale' });
      const out = await latestRefreshes(db, s.sourceId);
      expect(out.map((r) => r.key)).toEqual(['price']);
      expect(out[0]!.pages).toEqual(pages);
    } finally { await s.cleanup(); }
  });
});
```

Create `packages/api/src/routers/sources-attention.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { seedAttention } from '../test-helpers/seed-attention.js';

const me = await signedInCaller('sources-attention');
afterAll(async () => { await me.cleanup(); });

describe('what the app reads about a website that changed (spec 2026-10-21 §5)', () => {
  it('attention, refreshes, held fields and runnable, through the routers', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'srcattn', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }], expected: { Price: {}, Title: {} } });
    try {
      await me.caller.sources.updateBinding({
        sourceId: f.sourceId, urls: f.urls, descriptions: { price: 'x', title: 'x' },
        expected: { price: Object.fromEntries(f.urls.map((u, i) => [u, `${i + 1}.00`])), title: Object.fromEntries(f.urls.map((u, i) => [u, `T${i}`])) },
      });
      const { heldSince } = await seedAttention(f.sourceId, { heldKey: 'title', refreshedKey: 'price' });
      const a = await me.caller.sources.attention({ sourceId: f.sourceId });
      expect(a.fields).toEqual(['title']);
      expect(a.runnable).toBe(true);
      expect(a.refreshes.map((r) => r.key)).toEqual(['price']);
      const status = await me.caller.sources.verificationStatus({ sourceId: f.sourceId });
      expect(status!.heldKeys).toEqual(['title']);
      expect(status!.held.title!.verifiedAt.toISOString()).toBe(heldSince.toISOString());
      expect(status!.runnable).toBe(true);
      const site = await me.caller.sources.get({ projectSlug: f.projectSlug, sourceSlug: f.sourceSlug });
      expect(site.needsAttention).toBe(true);
      const project = await me.caller.projects.get({ projectSlug: f.projectSlug });
      expect(project.websites[0]!.needsAttention).toBe(true);
    } finally { await f.cleanup(); }
  });
});
```

In `packages/api/src/routers/ops.test.ts`, add `import { seedAttention } from '../test-helpers/seed-attention.js';` and, inside `describe('ops.website', …)` after the `'failed'` case:

```ts
  it("marks a held field 'held' with the hold's paths and date, counts it on the overview, and lists the automatic updates (spec 2026-10-21 §6)", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-held-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    try {
      const host = `test-ops-held-${tag}.example.com`;
      const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
      const built = await createProjectWithSource(op.caller, {
        tag: `ops-held-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
        urls,
        expected: { Price: Object.fromEntries(urls.map((u) => [u, '9.99'])), Title: Object.fromEntries(urls.map((u, i) => [u, `T${i}`])) },
      });
      const { heldSince } = await seedAttention(built.sourceId, { heldKey: built.keys.Title!, refreshedKey: built.keys.Price! });

      const site = await op.caller.ops.website({ sourceId: built.sourceId });
      const title = site.fields.find((f) => f.key === built.keys.Title)!;
      expect(title.state).toBe('held');
      expect(title.heldSince).toBe(heldSince.toISOString());
      expect(title.paths.map((p) => p.path)).toEqual(['name']); // the hold's path (seedAttention certifies `json-ld name`)
      expect(site.refreshes).toEqual([expect.objectContaining({ key: built.keys.Price, name: 'Price' })]);

      const row = (await op.caller.ops.websites()).find((r) => r.sourceId === built.sourceId)!;
      expect(row.held).toBe(1);

      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/attention.test.ts src/routers/sources-attention.test.ts src/routers/ops.test.ts`
Expected: FAIL — modules and procedures missing.

- [ ] **Step 3: Write `attention.ts`**

```ts
// packages/api/src/verify/attention.ts
// What needs the customer on a website that changed (spec 2026-10-21 §3.5):
// held fields, the newest check's findings that were not refreshed, and proof
// pages that are gone — plus each field's newest automatic refresh that still
// describes it (§5). Read-only.
import { and, desc, eq } from 'drizzle-orm';
import { driftChecks, sources, valueRefreshes, type Database } from '@robot/db';
import { fieldHash, type DriftCheckResults, type DriftFieldResult, type RefreshPage, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { loadFieldCurrency } from './current-certification.js';

export type Attention = { fields: string[]; heldSince: Date | null; goneProducts: number[]; findings: Record<string, DriftFieldResult> };
export type RefreshLineData = { key: string; at: Date; pages: Record<string, RefreshPage> };

/** A finding the customer can act on: moved, lost, or a change that was not refreshed. */
function actionable(r: DriftFieldResult): boolean {
  return r.result === 'moved' || r.result === 'lost' || (r.result === 'changed' && r.refresh?.applied !== true);
}

async function sourceOf(db: Database, sourceId: string) {
  const s = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  return {
    fields: (Array.isArray(s?.schemaDefinition) ? s!.schemaDefinition : []) as SchemaDefinitionField[],
    set: (s?.verificationSet ?? { urls: [], expected: {} }) as VerificationSet,
  };
}

export async function websiteAttention(db: Database, sourceId: string): Promise<Attention> {
  const { fields, set } = await sourceOf(db, sourceId);
  const currency = await loadFieldCurrency(db, sourceId);
  const latestVerify = currency.latest?.completedAt ?? null;
  const checks = await db.query.driftChecks.findMany({
    where: and(eq(driftChecks.sourceId, sourceId), eq(driftChecks.status, 'done')),
    orderBy: [desc(driftChecks.createdAt)],
    limit: 5,
    columns: { createdAt: true, results: true },
  });
  const findings: Record<string, DriftFieldResult> = {};
  for (const f of fields) {
    const held = currency.heldKeys.includes(f.key);
    for (const c of checks) {
      const r = (c.results as DriftCheckResults | null)?.fields?.[f.key];
      if (!r?.result) continue; // an entry with only its up-front share
      // The newest check that read the field decides; a current field's finding counts only when newer than its Verify.
      if ((held || !latestVerify || c.createdAt > latestVerify) && actionable(r)) findings[f.key] = r;
      break;
    }
  }
  const gone = new Set<number>();
  for (const r of Object.values((checks[0]?.results as DriftCheckResults | null)?.fields ?? {})) {
    for (const [url, p] of Object.entries(r.pages ?? {})) {
      const i = set.urls.indexOf(url);
      if (p.status === 'page-gone' && i >= 0) gone.add(i + 1);
    }
  }
  const heldTimes = currency.heldKeys.map((k) => currency.held[k]!.verifiedAt.getTime());
  return {
    fields: fields.map((f) => f.key).filter((k) => currency.heldKeys.includes(k) || k in findings),
    heldSince: heldTimes.length > 0 ? new Date(Math.min(...heldTimes)) : null,
    goneProducts: [...gone].sort((a, b) => a - b),
    findings,
  };
}

export function needsAttention(a: Attention): boolean {
  return a.fields.length > 0 || a.goneProducts.length > 0;
}

/** Each field's newest automatic refresh, while it still describes the field (its new hash is today's). */
export async function latestRefreshes(db: Database, sourceId: string): Promise<RefreshLineData[]> {
  const { fields, set } = await sourceOf(db, sourceId);
  const rows = await db.select().from(valueRefreshes).where(eq(valueRefreshes.sourceId, sourceId)).orderBy(desc(valueRefreshes.at)).limit(200);
  const out: RefreshLineData[] = [];
  for (const f of fields) {
    const newest = rows.find((r) => r.fieldKey === f.key);
    if (newest && newest.toHash === fieldHash(f, set)) out.push({ key: f.key, at: newest.at, pages: newest.pages as Record<string, RefreshPage> });
  }
  return out;
}

/** Every automatic refresh, newest first, at most 50 — the ops page's list (spec §6). */
export async function opsRefreshes(db: Database, sourceId: string): Promise<Array<{ at: Date; key: string; pages: Record<string, RefreshPage> }>> {
  const rows = await db.select().from(valueRefreshes).where(eq(valueRefreshes.sourceId, sourceId)).orderBy(desc(valueRefreshes.at)).limit(50);
  return rows.map((r) => ({ at: r.at, key: r.fieldKey, pages: r.pages as Record<string, RefreshPage> }));
}
```

- [ ] **Step 4: Write the seed helper**

Create `packages/api/src/test-helpers/seed-attention.ts`:

```ts
// packages/api/src/test-helpers/seed-attention.ts
// A website that changed (spec 2026-10-21), seeded directly for the route
// smoke and router tests: every contract field passed two days ago; `heldKey`
// failed in a Verify that completed just now and is held; `refreshedKey` was refreshed automatically
// today; a scheduled check found `heldKey` changed. No browser, no Verify.
// Cleaned up with the project (every table cascades on `sources.id`).
import { eq } from 'drizzle-orm';
import { db, driftChecks, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type CertifiedPath, type DriftCheckResults, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';

export async function seedAttention(sourceId: string, args: { heldKey: string; refreshedKey: string }): Promise<{ heldSince: Date }> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source) throw new Error(`seedAttention: source ${sourceId} not found`);
  const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
  const path: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
  const pass = (f: SchemaDefinitionField) => ({
    key: f.key, cells: Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: 'x', path }])),
    certified: [path], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(f, set),
  });
  const heldSince = new Date(Date.now() - 2 * 86_400_000);
  const passing = Object.fromEntries(fields.map((f) => [f.key, pass(f)]));
  const held = fields.find((f) => f.key === args.heldKey);
  if (!held) throw new Error(`seedAttention: ${args.heldKey} is not on this website`);
  await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', completedAt: heldSince, allPassed: true, results: passing });
  const failedHeld = { ...pass(held), certified: [], cells: Object.fromEntries(set.urls.map((u) => [u, { status: 'fail', reason: 'different_value', found: 'New' }])) };
  // Completed now: any check seeded earlier on this website (the smoke's drift test) is older than this Verify, so it says nothing about a current field.
  await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { ...passing, [held.key]: failedHeld } });
  await db.insert(fieldHolds).values({ sourceId, fieldKey: held.key, result: pass(held), verifiedAt: heldSince, fieldHashes: [pass(held).fieldHash] });
  const refreshed = fields.find((f) => f.key === args.refreshedKey)!;
  const url = set.urls[0]!;
  await db.insert(valueRefreshes).values({
    sourceId, fieldKey: refreshed.key, pages: { [url]: { was: '1.00', now: '1.10', path } }, fromHash: 'seed', toHash: fieldHash(refreshed, set),
  });
  const results: DriftCheckResults = {
    runId: null, trigger: 'schedule',
    fields: { [held.key]: { key: held.key, result: 'changed', path, pages: { [url]: { status: 'ok', value: 'New', changed: true, was: 'Old' } } } },
  };
  await db.insert(driftChecks).values({ sourceId, status: 'done', trigger: 'schedule', results, completedAt: new Date() });
  await db.update(sources).set({ driftedFields: null }).where(eq(sources.id, sourceId));
  return { heldSince };
}
```

- [ ] **Step 5: Wire the routers**

`packages/api/src/routers/sources.ts`:
1. Imports: add `import { latestRefreshes, needsAttention, websiteAttention } from '../verify/attention.js';` and add `loadCertificationState, runnableOf` to the existing `../verify/current-certification.js` import.
2. `get`: before the `return {`, add `const attention = await websiteAttention(ctx.db, s.id);` and in the returned object after `driftedFields: …,` add `needsAttention: needsAttention(attention),`.
3. `verificationStatus`: after `const { currentKeys, unchangedKeys } = currency;` add `const runnable = runnableOf(await loadCertificationState(ctx.db, input.sourceId));` and in the returned object after `unchangedKeys,` add:

```ts
        // Spec 2026-10-21 §3.1: fields read from their last good result, and when that passed; runnable = every field current or held.
        heldKeys: currency.heldKeys,
        held: Object.fromEntries(currency.heldKeys.map((k) => [k, { verifiedAt: currency.held[k]!.verifiedAt }])),
        runnable,
```

4. `checkDrift`: `return startDriftCheck(input.sourceId, await latestDriftedRun(input.sourceId), { trigger: 'manual' });` (spec §3.3's `manual` trigger; it still reads the drifted fields).
5. After the `coverage` procedure add:

```ts
  /** What needs the customer on this website (spec 2026-10-21 §3.5), each field's live automatic refresh, and whether it runs. */
  attention: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const [attention, refreshes, state] = await Promise.all([
        websiteAttention(ctx.db, input.sourceId),
        latestRefreshes(ctx.db, input.sourceId),
        loadCertificationState(ctx.db, input.sourceId),
      ]);
      return { ...attention, refreshes, runnable: runnableOf(state) };
    }),
```

`packages/api/src/routers/projects.ts` `get`: import `{ needsAttention, websiteAttention }` from `../verify/attention.js` and in the `websites` map add `needsAttention: needsAttention(await websiteAttention(ctx.db, s.id)),`.

`packages/api/src/routers/ops.ts`:
1. Import `{ opsRefreshes }` from `../verify/attention.js`.
2. `websites` row: after `currentFields: …` add `held: currencyBySource.get(r.sourceId)?.heldKeys.length ?? 0,`.
3. `website`: in `Promise.all` add `opsRefreshes(db, row.sourceId)` (destructure as `refreshes`). In the field map, compute

```ts
        const hold = fieldCurrency.held[f.key];
        const state: 'current' | 'held' | 'changed' | 'failed' | 'none' = fieldCurrency.currentKeys.includes(f.key)
          ? 'current'
          : hold
            ? 'held'
            : result
              ? (fieldCurrency.unchangedKeys.includes(f.key) ? 'failed' : 'changed')
              : 'none';
        const certified = hold ? hold.result.certified : result?.certified ?? [];
```

(replacing the existing `state` and `certified` lines), add `...(hold ? { heldSince: hold.verifiedAt.toISOString() } : {}),` after `state,`, and in the returned object after `proofUrls: …` add:

```ts
      refreshes: refreshes.map((r) => ({ at: r.at.toISOString(), key: r.key, name: fields.find((f) => f.key === r.key)?.name ?? r.key, pages: r.pages })),
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run src/verify/attention.test.ts src/routers/sources-attention.test.ts src/routers/ops.test.ts src/routers/projects-get.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/verify/attention.ts packages/api/src/verify/attention.test.ts packages/api/src/test-helpers/seed-attention.ts packages/api/src/routers/sources.ts packages/api/src/routers/projects.ts packages/api/src/routers/ops.ts packages/api/src/routers/sources-attention.test.ts packages/api/src/routers/ops.test.ts
git commit -m "feat(api): what needs the customer, automatic updates and runnable, for the app and ops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Staff see holds and automatic updates (`@robot/app` ops) — spec §6

**Files:**
- Modify: `packages/app/src/lib/ops-view.ts` (`OpsWebsiteRow` `:11-21`, `OpsFieldState` `:~176`, `OpsField`, `verifiedText` `:83-86`, `fieldFlag` `:306-313`; new helpers), `packages/app/src/lib/ops-view.test.ts`, `packages/app/src/routes/_app/ops/index.tsx` (`:346`), `packages/app/src/routes/_app/ops/websites/$sourceId.tsx` (type `:61-73`, `fieldRowInfo` `:89-104`, a new section before `Proof pages` `:222`, the drift notice `:372-390`)

**Interfaces:**
- Consumes: `ops.websites[].held`, `ops.website.fields[].state === 'held'`, `.heldSince`, `ops.website.refreshes`, drift results' `refresh` (Task 8, Task 6).
- Produces: `OpsFieldState` includes `'held'`; `OpsField.heldSince?: string`; `OpsWebsiteRow.held: number`; `verifiedText(currentFields: number, fields: number, held?: number): string`; `fieldFlag({ drifted, held, changed, oneSource, firstPathPct })` with `held: string | null` (ISO); `heldFlag(heldSince: string): string`; `type OpsRefresh = { at: string; key: string; name: string; pages: Record<string, { was: string; now: string; path: { source: OpsPathSource; path: string } }> }`; `refreshOpsLines(refreshes: OpsRefresh[], proofUrls: readonly string[]): string[]`; `refreshRefusalText(reason: string | undefined): string | null`; `refreshRefusals(results: unknown): Record<string, string>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/lib/ops-view.test.ts` (extend its import from `./ops-view` with `heldFlag, refreshOpsLines, refreshRefusalText, refreshRefusals`):

```ts
describe('holds and automatic updates in ops (spec 2026-10-21 §6)', () => {
  it('the held flag and the overview’s held count', () => {
    expect(heldFlag(new Date(2026, 9, 12).toISOString())).toBe('Held — runs use the paths verified 12 Oct');
    expect(fieldFlag({ drifted: false, held: new Date(2026, 9, 12).toISOString(), changed: 'failed', oneSource: false, firstPathPct: null })).toBe('Held — runs use the paths verified 12 Oct');
    expect(fieldFlag({ drifted: true, held: new Date(2026, 9, 12).toISOString(), changed: false, oneSource: false, firstPathPct: null })).toBe('Stopped extracting');
    expect(verifiedText(6, 8, 2)).toBe('6 of 8 fields · 2 held');
    expect(verifiedText(6, 8)).toBe('6 of 8 fields');
    expect(verifiedText(0, 8, 2)).toBe('Not verified · 2 held');
  });
  it('one line per refreshed page, newest refresh first, with the path that read it', () => {
    const urls = ['u1', 'u2'];
    const lines = refreshOpsLines([
      { at: new Date(2026, 9, 24).toISOString(), key: 'price', name: 'Price', pages: { u2: { was: '435.00', now: '440.00', path: { source: 'json-ld', path: 'offers.price' } } } },
      { at: new Date(2026, 9, 21).toISOString(), key: 'rating', name: 'Rating', pages: { u1: { was: '4', now: '4.2', path: { source: 'xpath', path: '//span[1]' } } } },
    ], urls);
    expect(lines).toEqual([
      '24 Oct · Price · product 2: 435.00 → 440.00 · Page data offers.price',
      '21 Oct · Rating · product 1: 4 → 4.2 · Page element //span[1]',
    ]);
  });
  it('why a changed value was not taken automatically, in plain words', () => {
    expect(refreshRefusalText('not-shown')).toBe('Not updated automatically: the page does not show the new value');
    expect(refreshRefusalText('fixed-variant')).toBe('Not updated automatically: reads a fixed variant');
    expect(refreshRefusalText('busy')).toBe('Not updated automatically: a Verify was running');
    expect(refreshRefusalText(undefined)).toBeNull();
  });
  it('one refusal line per field the latest check did not refresh', () => {
    const results = { fields: { price: { refresh: { applied: false, reason: 'not-shown' } }, rating: { refresh: { applied: true } }, title: {} } };
    expect(refreshRefusals(results)).toEqual({ price: 'Not updated automatically: the page does not show the new value' });
    expect(refreshRefusals(null)).toEqual({});
  });
});
```

(Update the existing `fieldFlag` calls in this test file to pass `held: null`.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && npx vitest run src/lib/ops-view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the helpers**

In `packages/app/src/lib/ops-view.ts`:
- `OpsWebsiteRow` gains `held: number;` (doc: "fields read from their last good result (spec 2026-10-21 §3.1)").
- `OpsFieldState = 'current' | 'held' | 'changed' | 'failed' | 'none'` (doc line: "`held` — not current, read from its last passing result while its paths still extract (spec 2026-10-21 §3.1)").
- `OpsField` gains `heldSince?: string;`.
- `verifiedText`:

```ts
export function verifiedText(currentFields: number, fields: number, held = 0): string {
  const base = currentFields === 0 ? 'Not verified' : `${currentFields} of ${fields} fields`;
  return held > 0 ? `${base} · ${held} held` : base;
}
```

- `fieldFlag` gains `held: string | null` in its argument type; after `if (args.drifted) return 'Stopped extracting';` add `if (args.held) return heldFlag(args.held);`.
- Append:

```ts
const OPS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const opsDay = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${OPS_MONTHS[d.getMonth()]}`; };

/** Spec 2026-10-21 §6: a held field's flag. */
export function heldFlag(heldSince: string): string {
  return `Held — runs use the paths verified ${opsDay(heldSince)}`;
}

export type OpsRefresh = { at: string; key: string; name: string; pages: Record<string, { was: string; now: string; path: { source: OpsPathSource; path: string } }> };

/** Spec §6's Automatic updates list: one line per refreshed page, in the order given (newest first), pages in product order. */
export function refreshOpsLines(refreshes: OpsRefresh[], proofUrls: readonly string[]): string[] {
  return refreshes.flatMap((r) => proofUrls.flatMap((u, i) => {
    const p = r.pages[u];
    return p ? [`${opsDay(r.at)} · ${r.name} · product ${i + 1}: ${p.was} → ${p.now} · ${pathKind(p.path.source)} ${p.path.path}`] : [];
  }));
}

const REFUSAL_WORDS: Record<string, string> = {
  empty: 'a page reads nothing',
  'too-few-pages': 'fewer than two pages read',
  'not-same-place': 'read from another place than verified',
  'fixed-variant': 'reads a fixed variant',
  'not-shown': 'the page does not show the new value',
  'out-of-range': 'the new value is out of range',
  busy: 'a Verify was running',
  moved: 'the value was edited meanwhile',
  'not-applied': 'it could not be saved',
};

/** Spec §6: why a check did not take a by-nature field's changed value by itself; null when there is nothing to say. */
export function refreshRefusalText(reason: string | undefined): string | null {
  const words = reason ? REFUSAL_WORDS[reason] : undefined;
  return words ? `Not updated automatically: ${words}` : null;
}

/** The latest check's refusal line per field key (only fields it did not refresh). `results` is `ops.website.drift.results`, untyped in the app. */
export function refreshRefusals(results: unknown): Record<string, string> {
  const fields = (results as { fields?: Record<string, { refresh?: { applied: boolean; reason?: string } }> } | null | undefined)?.fields ?? {};
  const out: Record<string, string> = {};
  for (const [key, r] of Object.entries(fields)) {
    const text = r.refresh && !r.refresh.applied ? refreshRefusalText(r.refresh.reason) : null;
    if (text) out[key] = text;
  }
  return out;
}
```

(`pathKind` already exists in this file; if it is declared below, move these helpers after it.)

- [ ] **Step 4: Wire the ops pages**

1. `routes/_app/ops/index.tsx` `:346`: `{verifiedText(row.currentFields, row.fields, row.held)}`.
2. `routes/_app/ops/websites/$sourceId.tsx`:
   - `OpsWebsiteData` gains `refreshes: OpsRefresh[];` (import the type and `refreshOpsLines`, `refreshRefusals`);
   - `fieldRowInfo`: `const flag = fieldFlag({ drifted, held: field.state === 'held' ? field.heldSince ?? null : null, changed, oneSource: !!warn, firstPathPct });`
   - before `<section className="rise">` holding `Proof pages` (`:222`), add:

```tsx
          {data.refreshes.length > 0 ? (
            <section aria-labelledby="ops-refreshes-heading" className="rise mb-4">
              <h2 id="ops-refreshes-heading" className="text-lg font-medium">Automatic updates</h2>
              <ul className="mt-2 space-y-1 font-mono text-sm">
                {refreshOpsLines(data.refreshes, data.proofUrls).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>
          ) : null}
```

   - why a check did not take a changed value by itself, per field (the drift notice only shows for run-flagged drift, so this goes on the field row): in `OpsWebsitePage`, after `query.data` is known, `const refusals = refreshRefusals(data.drift?.results);`; give `FieldRow` a prop `refusal: string | null` (passed `refusals[field.key] ?? null`), and render it inside `FieldRow`'s outer `<div>`, right after the collapsed summary row's element, as `{refusal ? <p className="px-4 pb-2 text-sm text-muted-foreground">{refusal}</p> : null}`.

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && npx vitest run src/lib/ops-view.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. Restore `src/routeTree.gen.ts` if it changed.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/app/src/lib/ops-view.ts packages/app/src/lib/ops-view.test.ts packages/app/src/routes/_app/ops/index.tsx "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx"
git commit -m "feat(app): ops shows held fields and every automatic update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The customer's screens (`@robot/app`) — spec §5

**Files:**
- Create: `packages/app/src/lib/site/attention-view.ts`, `packages/app/src/lib/site/attention-view.test.ts`
- Modify: `packages/app/src/lib/site/drift-view.ts` (export `formatDMMM`, `joinList`; `DriftFieldResultLike.reads`; the `lost` case `:222-224`), `packages/app/src/lib/site/drift-view.test.ts`, `packages/app/src/lib/websites-view.ts`, `packages/app/src/lib/websites-view.test.ts`, `packages/app/src/components/site/site-header.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site.tsx` (`:91`), `packages/app/src/components/verification/drift-banner.tsx`, `packages/app/src/components/verification/verification-table.tsx` (`DriftLine` `:40-46`, `DriftLines` `:180-240`), `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (drift wiring `:385-460`, `driftLinesFor` `:1203-1260`, row word `:1357`, banner `:1554`, `extractEnabled` call `:1546`), `packages/app/src/lib/site/variants-row-view.ts` (`extractEnabled` `:343-346`) and its test, `packages/app/src/routes/_app/projects/$project/sites/$site/extract.tsx` (`:185-260`, `:415`), `packages/app/src/routes-smoke.test.ts`

**Interfaces:**
- Consumes: `sources.attention`, `sources.get.needsAttention`, `projects.get().websites[].needsAttention`, `sources.verificationStatus.heldKeys/held/runnable` (Task 8); `seedAttention` (Task 8).
- Produces (`attention-view.ts`): `NEEDS_ATTENTION = 'Needs attention'`; `websiteBadge(driftedFields: string[] | null, needsAttention: boolean | undefined): string | null`; `attentionBanner(args: { driftedFields: string[] | null; fields: string[]; fieldNames: Record<string, string>; goneProducts: number[]; heldSince: Date | string | null; runnable: boolean }): string | null`; `heldWord(verifiedAt: Date | string | undefined): string | null`; `refreshLine(r: { at: Date | string; pages: Record<string, { was: string; now: string }> } | undefined, urls: string[]): string | null`; `extractHeldLine(heldKeys: string[], fieldNames: Record<string, string>, heldSince: Date | string | null): string | null`. `extractEnabled(status: { runnable: boolean; variants: { current: boolean; passed: boolean } | null }): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/lib/site/attention-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { attentionBanner, extractHeldLine, heldWord, NEEDS_ATTENTION, refreshLine, websiteBadge } from './attention-view';

const names = { price: 'Price', rating: 'Rating', description: 'Description' };
const oct8 = new Date(2026, 9, 8);
const base = { driftedFields: null, fieldNames: names, goneProducts: [] as number[], heldSince: oct8, runnable: true };

describe('websiteBadge (spec 2026-10-21 §5)', () => {
  it('drift speaks first, then Needs attention, else nothing', () => {
    expect(websiteBadge(['price'], true)).toBe('1 field stopped extracting');
    expect(websiteBadge(null, true)).toBe(NEEDS_ATTENTION);
    expect(NEEDS_ATTENTION).toBe('Needs attention');
    expect(websiteBadge([], false)).toBeNull();
  });
});

describe('attentionBanner', () => {
  it('names the fields that need the customer, and that runs go on', () => {
    expect(attentionBanner({ ...base, fields: ['rating', 'description'] })).toBe('Rating and Description need you — runs go on with what you verified on 8 Oct.');
    expect(attentionBanner({ ...base, fields: ['price'] })).toBe('Price needs you — runs go on with what you verified on 8 Oct.');
  });
  it('names gone products, alone or with fields', () => {
    expect(attentionBanner({ ...base, fields: [], goneProducts: [2] })).toBe('Product 2 no longer loads — runs go on with what you verified on 8 Oct.');
    expect(attentionBanner({ ...base, fields: ['rating'], goneProducts: [2, 3] })).toBe('Rating needs you and products 2 and 3 no longer load — runs go on with what you verified on 8 Oct.');
  });
  it('says runs go on as before with nothing held, and that extraction waits when it cannot run', () => {
    expect(attentionBanner({ ...base, heldSince: null, fields: ['description'] })).toBe('Description needs you — runs go on as before.');
    expect(attentionBanner({ ...base, runnable: false, fields: ['price'] })).toBe('Price needs you — extraction waits for you.');
  });
  it('is silent when drift speaks, or nothing needs the customer', () => {
    expect(attentionBanner({ ...base, driftedFields: ['price'], fields: ['price'] })).toBeNull();
    expect(attentionBanner({ ...base, fields: [] })).toBeNull();
  });
  it('never names an internal', () => {
    const text = attentionBanner({ ...base, fields: ['price'], goneProducts: [1] })!;
    expect(text).not.toMatch(/path|json|check|hold|model|schedule|\$/i);
  });
});

describe('heldWord, refreshLine, extractHeldLine', () => {
  it('the held row word', () => {
    expect(heldWord(oct8)).toBe('runs use what you verified on 8 Oct');
    expect(heldWord(undefined)).toBeNull();
  });
  it('the refreshed line, in product order, skipping pages no longer on the board', () => {
    const urls = ['u1', 'u2', 'u3'];
    expect(refreshLine({ at: new Date(2026, 9, 24), pages: { u3: { was: '4', now: '4.2' } } }, urls)).toBe('Updated automatically on 24 Oct: 4.2 on product 3 (was 4)');
    expect(refreshLine({ at: new Date(2026, 9, 24), pages: { u2: { was: '45', now: '46' }, u1: { was: '149', now: '150' }, gone: { was: '1', now: '2' } } }, urls))
      .toBe('Updated automatically on 24 Oct: 150 on product 1 (was 149); 46 on product 2 (was 45)');
    expect(refreshLine(undefined, urls)).toBeNull();
  });
  it('the Extract tab line', () => {
    expect(extractHeldLine(['price'], names, oct8)).toBe('Price needs you on the Verification tab — runs go on with what you verified on 8 Oct.');
    expect(extractHeldLine(['price', 'rating'], names, oct8)).toBe('Price and Rating need you on the Verification tab — runs go on with what you verified on 8 Oct.');
    expect(extractHeldLine([], names, oct8)).toBeNull();
  });
});
```

In `packages/app/src/lib/site/drift-view.test.ts` add (next to the existing `driftRows` `lost` case):

```ts
  it('Review Focus 4: a lost field that still reads elsewhere names the products that read nothing', () => {
    const urls = ['u1', 'u2', 'u3'];
    const results = { runId: null, fields: { price: { result: 'lost' as const, pages: { u1: { status: 'ok' as const, value: null }, u2: { status: 'ok' as const, value: null }, u3: { status: 'ok' as const, value: null } }, reads: { u1: '1.00', u2: null, u3: '3.00' } } } };
    expect(driftRows({ fieldKeys: ['price'], urls, results, values: {} }).price![0]).toEqual({ kind: 'lost', text: 'Not found on product 2 — Mark it again' });
    const two = { ...results, fields: { price: { ...results.fields.price, reads: { u1: '1.00', u2: null, u3: null } } } };
    expect(driftRows({ fieldKeys: ['price'], urls, results: two, values: {} }).price![0]).toEqual({ kind: 'lost', text: 'Not found on products 2 and 3 — Mark it again' });
    const none = { ...results, fields: { price: { ...results.fields.price, reads: { u1: null, u2: null, u3: null } } } };
    expect(driftRows({ fieldKeys: ['price'], urls, results: none, values: {} }).price![0]).toEqual({ kind: 'lost', text: 'Not found on the page — Mark it again' });
  });
```

In `packages/app/src/lib/site/variants-row-view.test.ts`, replace the `extractEnabled` cases' inputs `{ current, allPassed, variants }` with `{ runnable, variants }` (`runnable: current && allPassed` for each existing case) and add: `expect(extractEnabled({ runnable: true, variants: null })).toBe(true); expect(extractEnabled({ runnable: false, variants: null })).toBe(false);`.

In `packages/app/src/lib/websites-view.test.ts`, give every `WebsiteRow` fixture `needsAttention: false` and add: a row with `driftedFields: null, needsAttention: true` maps to `driftBadge: 'Needs attention'`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && npx vitest run src/lib/site/attention-view.test.ts src/lib/site/drift-view.test.ts src/lib/site/variants-row-view.test.ts src/lib/websites-view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the view functions**

In `packages/app/src/lib/site/drift-view.ts`: change `function joinList` to `export function joinList` and `function formatDMMM` to `export function formatDMMM`; add `reads?: Record<string, string | null>;` to `DriftFieldResultLike`; replace the `lost` case with:

```ts
      case 'lost': {
        // Spec 2026-10-21 §3.4: read on some products and not others — name the ones that read nothing.
        const missing = urls.flatMap((u, i) => (r.reads && u in r.reads && r.reads[u] === null ? [i + 1] : []));
        const someRead = urls.some((u) => r.reads?.[u] != null);
        const where = missing.length === 1 ? `product ${missing[0]}` : `products ${joinList(missing.map(String))}`;
        rows.push({ kind: 'lost', text: someRead && missing.length > 0 ? `Not found on ${where} — Mark it again` : 'Not found on the page — Mark it again' });
        break;
      }
```

Create `packages/app/src/lib/site/attention-view.ts`:

```ts
// What a website that changed says to its customer (spec 2026-10-21 §5): the
// badge, the Verification banner, the held row word, the refreshed line and
// the Extract tab's line. Pure, so every sentence is tested without a server.
// Never names a path, a source, a check, a hold, a model or money.
import { driftBadge, formatDMMM, joinList } from './drift-view';

export const NEEDS_ATTENTION = 'Needs attention';

const day = (d: Date | string) => formatDMMM(new Date(d));
const needs = (names: string[], suffix = '') => `${joinList(names)} ${names.length === 1 ? 'needs' : 'need'} you${suffix}`;

/** The websites table's and the header's badge: drift first (today's text), then "Needs attention". */
export function websiteBadge(driftedFields: string[] | null, needsAttention: boolean | undefined): string | null {
  return driftBadge(driftedFields) ?? (needsAttention ? NEEDS_ATTENTION : null);
}

/** The Verification tab's banner when nothing is drifted (the drift banner speaks then). */
export function attentionBanner(args: {
  driftedFields: string[] | null;
  fields: string[];
  fieldNames: Record<string, string>;
  goneProducts: number[];
  heldSince: Date | string | null;
  runnable: boolean;
}): string | null {
  if (args.driftedFields && args.driftedFields.length > 0) return null;
  const parts: string[] = [];
  if (args.fields.length > 0) parts.push(needs(args.fields.map((k) => args.fieldNames[k] ?? k)));
  if (args.goneProducts.length === 1) parts.push(`product ${args.goneProducts[0]} no longer loads`);
  else if (args.goneProducts.length > 1) parts.push(`products ${joinList(args.goneProducts.map(String))} no longer load`);
  if (parts.length === 0) return null;
  const subject = joinList(parts);
  const tail = !args.runnable ? 'extraction waits for you.' : args.heldSince ? `runs go on with what you verified on ${day(args.heldSince)}.` : 'runs go on as before.';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} — ${tail}`;
}

/** Beside a held field's badge. */
export function heldWord(verifiedAt: Date | string | undefined): string | null {
  return verifiedAt ? `runs use what you verified on ${day(verifiedAt)}` : null;
}

/** Under a refreshed field's row, pages in product order; pages no longer on the board are left out. */
export function refreshLine(r: { at: Date | string; pages: Record<string, { was: string; now: string }> } | undefined, urls: string[]): string | null {
  if (!r) return null;
  const items = urls.flatMap((u, i) => (r.pages[u] ? [`${r.pages[u]!.now} on product ${i + 1} (was ${r.pages[u]!.was})`] : []));
  return items.length > 0 ? `Updated automatically on ${day(r.at)}: ${items.join('; ')}` : null;
}

/** The Extract tab's line while the website runs with held fields. */
export function extractHeldLine(heldKeys: string[], fieldNames: Record<string, string>, heldSince: Date | string | null): string | null {
  if (heldKeys.length === 0 || !heldSince) return null;
  return `${needs(heldKeys.map((k) => fieldNames[k] ?? k), ' on the Verification tab')} — runs go on with what you verified on ${day(heldSince)}.`;
}
```

`packages/app/src/lib/site/variants-row-view.ts`:

```ts
export function extractEnabled(status: { runnable: boolean; variants: { current: boolean; passed: boolean } | null }): boolean {
  if (!status.runnable) return false;
  return status.variants === null || (status.variants.current && status.variants.passed);
}
```

(update its doc comment: "runnable — every field current or held (spec 2026-10-21 §3.1)").

`packages/app/src/lib/websites-view.ts`: add `needsAttention: boolean;` to `WebsiteRow`, import `websiteBadge` from `./site/attention-view` (drop the `driftBadge` import if unused) and set `driftBadge: websiteBadge(w.driftedFields, w.needsAttention),` (keep the property name; update its doc comment to "drift's text, else 'Needs attention'").

- [ ] **Step 4: Wire the screens**

1. `components/site/site-header.tsx`: `SiteHeaderWebsite` gains `needsAttention: boolean`; `const badge = website ? websiteBadge(website.driftedFields, website.needsAttention) : null;` (import from `../../lib/site/attention-view`).
2. `routes/_app/projects/$project/sites/$site.tsx` `:91`: add `needsAttention: site.data.needsAttention` to the object.
3. `components/verification/drift-banner.tsx`: add a prop `attention: string | null`; render `{banner.kind === 'none' ? (attention ? <p role="status" className="border-l-2 border-warn pl-3 text-sm text-warn">{attention}</p> : null) : <p …>{banner.text}</p>}` — keep the existing paragraph for the drift banner exactly as it is.
4. `components/verification/verification-table.tsx`: add `| { kind: 'refreshed'; text: string }` to `DriftLine`; in `DriftLines` add the case:

```tsx
          case 'refreshed':
            return (
              <div key={i} className="text-sm text-muted-foreground">
                {line.text}
              </div>
            );
```

5. The Verification route `routes/_app/projects/$project/sites/$site/index.tsx`:
   - imports: `attentionBanner, heldWord, refreshLine` from `../../../../../../lib/site/attention-view`;
   - after `driftCheckQuery`, add:

```ts
  // Spec 2026-10-21 §3.5: what needs the customer when no run flagged drift, and each field's automatic update.
  const attentionQuery = trpc.sources.attention.useQuery({ sourceId });
  const attention = attentionQuery.data ?? null;
  const refreshByKey = useMemo(() => Object.fromEntries((attention?.refreshes ?? []).map((r) => [r.key, r])), [attention?.refreshes]);
```

   - in the `driftByField` memo replace `fieldKeys: driftedKeys,` and `results: …,` with:

```ts
        fieldKeys: driftedKeys.length > 0 ? driftedKeys : attention?.fields ?? [],
        results: driftedKeys.length > 0
          ? ((driftCheckQuery.data?.results as DriftCheckResultsLike | undefined) ?? null)
          : attention ? ({ runId: null, fields: attention.findings } as unknown as DriftCheckResultsLike) : null,
```

     and add `attention?.fields.join(','), attention?.findings` to its dependency list;
   - in `driftLinesFor(f)`: change `if (!rows) return undefined;` and the `return rows.map(…)` so that the mapped lines are kept in `const lines = (rows ?? []).map(…)`, then before returning add:

```ts
    const refreshed = refreshLine(refreshByKey[f.key], urls);
    if (refreshed) lines.unshift({ kind: 'refreshed', text: refreshed });
    return lines.length > 0 ? lines : undefined;
```

   - the row word (`:1357`): `defaultOnlyWord: heldWord(status?.held?.[f.key]?.verifiedAt) ?? defaultOnlyWord(results, f.key, unchangedKeys) ?? notOnWebsiteWord(results, f.key, unchangedKeys),`;
   - the `extractEnabled` call (`:1546`): `extractEnabled({ runnable: !!status.runnable, variants: variantsStatus })`;
   - the banner (`:1554`):

```tsx
      <DriftBanner
        driftedFields={source.driftedFields}
        fieldNames={fieldNames}
        check={driftCheck}
        attention={attention ? attentionBanner({ driftedFields: source.driftedFields, fields: attention.fields, fieldNames, goneProducts: attention.goneProducts, heldSince: attention.heldSince, runnable: attention.runnable }) : null}
      />
```

   - in the effect that runs when a Verify finishes (`sawActive`), also `void attentionQuery.refetch();`.
6. The Extract tab `extract.tsx`: `const green = !!status?.runnable;`; `const certifiedKeys = useMemo(() => [...(status?.currentKeys ?? []), ...(status?.heldKeys ?? [])], [status]);` and use `certifiedKeys` for `firstFailing` and `lockedStripText({ … currentKeys: certifiedKeys … })`; compute

```ts
  const fieldNames = useMemo(() => Object.fromEntries(contract.map((f) => [f.key, f.name])), [contract]);
  const heldSince = useMemo(() => {
    const times = Object.values(status?.held ?? {}).map((h) => new Date(h.verifiedAt).getTime());
    return times.length > 0 ? new Date(Math.min(...times)) : null;
  }, [status]);
  const heldLine = extractHeldLine(status?.heldKeys ?? [], fieldNames, heldSince);
```

   and at `:415` render `{green ? (heldLine ? <p role="status" className="border-l-2 border-warn pl-3 text-sm text-warn">{heldLine}</p> : null) : <ExtractLockedStrip text={lockedText} project={projectSlug} site={siteSlug} />}`.

- [ ] **Step 5: The route smoke test**

In `packages/app/src/routes-smoke.test.ts`, import `seedAttention` next to `seedDriftCheck`:

```ts
import { seedAttention } from '../../api/src/test-helpers/seed-attention';
```

and add right after the drift test (`it("a seeded drift check shows …")`):

```ts
  // Spec 2026-10-21 §5: a website whose pages changed keeps running and says
  // what needs the customer. Seeded directly (no browser check, no Verify),
  // after every screenshot of this website was taken, like the drift test.
  it('a website that changed keeps running and says what needs the customer', async () => {
    expect(projectSlug, 'there is no project to seed on').not.toBeNull();
    expect(websiteSlug, 'there is no website to seed on').not.toBeNull();
    problems.length = 0;
    const api = apiAs(await sessionCookie(context));
    const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    const price = site.fields.find((f) => f.name === 'Price')!;
    const other = site.fields.find((f) => f.name !== 'Price')!;
    await seedAttention(site.id, { heldKey: other.key, refreshedKey: price.key });

    await page.goto(`${APP}/projects/${projectSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    const row = page.locator('tbody tr').filter({ hasText: WEBSITE_HOST });
    await expect.poll(() => row.innerText(), { timeout: 20_000 }).toContain('Needs attention');

    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const banner = page.getByRole('status').filter({ hasText: 'needs you' });
    await expect.poll(() => banner.innerText(), { timeout: 20_000 }).toMatch(new RegExp(`^${other.name} needs you — runs go on with what you verified on \\d{1,2} [A-Z][a-z]{2}\\.$`));
    // The held row word sits beside the badge of a row in its accepted state; asserted on the page, not on one cell's layout.
    await expect.poll(() => page.getByText(/^runs use what you verified on \d{1,2} [A-Z][a-z]{2}$/).count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.getByText(/^Updated automatically on \d{1,2} [A-Z][a-z]{2}: 1\.10 on product 1 \(was 1\.00\)$/).count(), { timeout: 20_000 }).toBe(1);
    expect((await api.sources.verificationStatus.query({ sourceId: site.id }))!.runnable).toBe(true);
    await shoot(page, 'app-site-verification-attention.png');

    expect(problems, `the seeded website change logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 60_000);
```

(The smoke is run in Task 12 on the isolated pair; here only type-check it.)

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && npx vitest run src/lib && npx tsc --noEmit`
Expected: PASS, no type errors. Restore `src/routeTree.gen.ts` if it changed.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/app/src/lib/site/attention-view.ts packages/app/src/lib/site/attention-view.test.ts packages/app/src/lib/site/drift-view.ts packages/app/src/lib/site/drift-view.test.ts packages/app/src/lib/site/variants-row-view.ts packages/app/src/lib/site/variants-row-view.test.ts packages/app/src/lib/websites-view.ts packages/app/src/lib/websites-view.test.ts packages/app/src/components/site/site-header.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site.tsx" packages/app/src/components/verification/drift-banner.tsx packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" "packages/app/src/routes/_app/projects/\$project/sites/\$site/extract.tsx" packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): a website that changed says Needs attention, what needs you, and keeps running

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Replay the ten websites from stored data, read-only — spec §8, §9

**Files:**
- Create: `packages/api/src/scripts/ten-websites.ts`, `packages/api/src/scripts/websites-change-replay.ts`, `docs/testing/results/2026-10-21-websites-change/replay.json`, `docs/testing/results/2026-10-21-websites-change/replay.md`

**Interfaces:**
- Consumes: `backfillHolds(db, browser, id, { write: false })` (Task 5), `planRefresh` (Task 2), `loadCertificationState`, `runnableOf` (Task 3), `withBrowserSession`.
- Produces: `TEN: Record<string, string>` (source id → website label) in `scripts/ten-websites.ts`, which Task 13 imports; the replay results Task 13 compares against.

- [ ] **Step 1: Write the script**

`packages/api/src/scripts/ten-websites.ts`:

```ts
// The ten websites that lost their certification at the 2026-10-21 re-verify
// (docs/testing/results/2026-10-21-reverify-one-source/report.md): source id → label.
export const TEN: Record<string, string> = {
  'ae6fa0b3-4e5f-4028-8d35-993ce85b1d76': 'Barnesandnoble',
  'b4648622-bfa9-4d90-91b4-5a88ed288cd9': 'Acne / Ikea',
  '5cb04b47-53cf-4aac-9d66-d9ac5bf4c2de': 'Madeincookware',
  'b571fbfb-92e0-40af-bd87-e8b3f2d88a8a': 'Everlane',
  '7d6ce510-4452-4a43-ad9c-4d66f18ea2f0': 'Mejuri',
  '7f5cde3b-d233-4ee9-b8ee-25483a06c07d': 'Gymshark',
  'c716c55b-cd64-4930-87d0-01feec19bcab': 'Ridge',
  '3406d1ae-81b2-42fa-95f2-e7a3f4393b6e': 'Oliverbonas',
  'c8d2a589-f342-4e4a-8787-96ebc9a0d27a': 'Burrow',
  'f210ced9-645e-4b82-8c10-2e9683a2098f': 'Skullcandy',
};
```

`packages/api/src/scripts/websites-change-replay.ts`:

```ts
// packages/api/src/scripts/websites-change-replay.ts
// Read-only replay (spec 2026-10-21 §9): for the ten websites that lost their
// certification at the 2026-10-21 re-verify, what the new rules would do on
// that Verify's stored captures — which fields would be held (runs again),
// which values refreshed, what needs the customer. No database write (backfill
// with write: false), no page load (stored captures only), no model.
//
//   cd packages/api && ANTHROPIC_API_KEY= \
//     CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
//     npx tsx src/scripts/websites-change-replay.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { planRefresh, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { backfillHolds } from '../verify/holds.js';
import { loadCertificationState, runnableOf } from '../verify/current-certification.js';
import { TEN } from './ten-websites.js';

if (process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY must be empty for this run.'); process.exit(1); }
if (!process.env.CAPTURES_DIR) { console.error('Set CAPTURES_DIR to the main checkout’s api-server captures folder.'); process.exit(1); }
const OUT = '../../docs/testing/results/2026-10-21-websites-change';

type FieldOut = { name: string; held: boolean; refresh: string; reads: Record<string, string | null>; expected: Record<string, string> };
const report: Array<{ website: string; sourceId: string; runnableBefore: boolean; runnableAfter: boolean; fields: FieldOut[] }> = [];

await withBrowserSession(async (browser) => {
  for (const [id, website] of Object.entries(TEN)) {
    const src = (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { schemaDefinition: true, verificationSet: true } }))!;
    const fields = src.schemaDefinition as SchemaDefinitionField[];
    const set = src.verificationSet as VerificationSet;
    const runnableBefore = runnableOf(await loadCertificationState(db, id));
    const out = await backfillHolds(db, browser, id, { write: false });
    const heldKeys = out.upsert.map((h) => h.fieldKey);
    const rows: FieldOut[] = [];
    for (const key of Object.keys(out.readings)) {
      const field = fields.find((f) => f.key === key)!;
      const c = out.certifying[key]!;
      const provenOn = Object.fromEntries(Object.entries(c.result.cells).map(([u, cell]) => [u, cell.status === 'pass' ? cell.path : undefined]));
      const plan = heldKeys.includes(key) ? planRefresh({ field, expected: set.expected[key] ?? {}, provenOn, readings: out.readings[key]! }) : null;
      rows.push({
        name: field.name, held: heldKeys.includes(key),
        refresh: !plan ? 'not held' : plan.kind === 'refresh' ? `refresh: ${Object.values(plan.pages).map((p) => `${p.was} → ${p.now}`).join(', ')}` : plan.kind === 'refused' ? `refused: ${plan.reason}` : 'nothing moved',
        reads: Object.fromEntries(Object.entries(out.readings[key]!).map(([u, r]) => [u, r.value])),
        expected: set.expected[key] ?? {},
      });
    }
    // Runs after the backfill when every field passed on the latest Verify or would be held (variants: none of the ten has any).
    const runnableAfter = out.latestId !== null && fields.every((f) => out.passing.includes(f.key) || heldKeys.includes(f.key));
    report.push({ website, sourceId: id, runnableBefore, runnableAfter, fields: rows });
    console.log(`${website}: before ${runnableBefore ? 'runs' : 'refused'}, after ${runnableAfter ? 'runs' : 'refused'}; held ${heldKeys.length}; ${rows.map((r) => `${r.name} ${r.refresh}`).join(' | ')}`);
  }
});

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/replay.json`, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
console.log(`wrote ${OUT}/replay.json`);
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && ANTHROPIC_API_KEY= CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures npx tsx src/scripts/websites-change-replay.ts
```

Expected: ten lines; every website `before refused`, and held fields matching the spec's §8 table (all ten held; refreshes for Acne / Ikea Total reviews and Average rating, Mejuri Price, Gymshark Rating; refusals `fixed-variant` for Madeincookware/Everlane/Burrow Price and Ridge/Everlane In stock, `not-shown` for Barnesandnoble/Oliverbonas/Burrow Rating; `not-by-nature` for Description and SKU). Verify nothing was written: `SELECT count(*) FROM field_holds WHERE source_id IN (…the ten…)` is 0 (run it through a one-line `npx tsx -e` with `@robot/db`, or `docker exec robot-platform-db psql -U postgres robot_platform -c "…"`).

- [ ] **Step 3: Write `replay.md`**

`docs/testing/results/2026-10-21-websites-change/replay.md`: a short report — what was run (command, read-only, no AI, the stored 2026-10-21 captures), a table per website (Before: runs/refused; After: held fields, refreshed values with was → now, refused with the reason in words, needs the customer), and any difference from the spec's §8 table with its reason. If a difference shows a rule wrong (e.g. a refusal where the probe saw a clean refresh), stop and fix the rule with a test before going on.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/scripts/ten-websites.ts packages/api/src/scripts/websites-change-replay.ts docs/testing/results/2026-10-21-websites-change/replay.json docs/testing/results/2026-10-21-websites-change/replay.md
git commit -m "test(api): replay the ten websites from stored captures, read-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The merge gate, docs, the merge (`CLAUDE.md` "Autonomous runs")

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-websites-change-design.md` (Status), `docs/handoff.md` ("Read this first": the "Newest" line; a new section before `## HTML backups capped too (2026-10-21)`), `CLAUDE.md` (Key Technical Decisions; Environment: `WEBSITE_CHECKS`, `WEBSITE_CHECK_DAYS`), `.env.example` (the two variables, commented)

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch that passes the gate, docs that say what shipped, `main` fast-forwarded and pushed.

- [ ] **Step 1: Every task's tests and reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` where the script amends only commits whose trailer names another model (memory `subagent-commit-trailers`).

- [ ] **Step 2: Full test run and type-check of every touched package**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/db && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/scraper && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api-server && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && npx vitest run && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up). A Chromium file that times out only in the full run: re-run it alone; `transfer-marks.test.ts`'s JSON-LD image-array case is a known flake. A real failure blocks the merge: fix it on the branch with a test. Restore `packages/app/src/routeTree.gen.ts` if it changed.

- [ ] **Step 3: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. Points to press: §7's safety properties one by one (a refresh through another path, a fixed variant, an unshown value, a non-by-nature field, a value edited meanwhile, a Verify in flight); the hold rule's transaction (no window where a field reads uncertified); the hash list surviving a stale autosave; the scheduler's claim (`SKIP LOCKED`, `only` in every test, `WEBSITE_CHECKS=off`); no agent constructed and no Jev reading anywhere new; the import cycle broken by the dynamic import in `run-source-verification.ts`; customer copy against §5 verbatim and free of internals. No open Critical or Important finding may remain; fix on the branch and re-run Step 2 for the touched packages.

- [ ] **Step 4: The route smoke, from the branch, on an isolated pair**

In the background:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
```

and, in the background:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}` (the log says `website checks off`) and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS (27 of 27 on `main` before this branch, now 28). Look at `docs/testing/screens/app-site-verification-attention.png`: the banner, the held row word and the refreshed line are there and read as §5 says. Stop both servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

Then restore what the run rewrote except the new screenshot: `git checkout -- packages/app/src/routeTree.gen.ts` and `git status --short docs/testing/screens` — keep `app-site-verification-attention.png` (new) and restore the others (`git checkout -- <each changed existing file>`).

- [ ] **Step 5: The live check (gate 5)**

Extraction now reads held paths and checks load proof pages on a schedule. Task 11's replay is the check on real stored data; Task 13 is the live check on fresh pages (after the merge, approved as part of this item). If any code under `packages/scraper/src/verify` or `packages/api/src/verify` changed after Task 11 (review fixes), re-run Task 11 Steps 2–3 and commit the new results before going on.

- [ ] **Step 6: Docs**

Note the last code commit: `git log -1 --format=%h -- packages` → `<sha>`.

1. Spec — replace the Status paragraph's first sentence with: ``**Status:** implemented on `feat/websites-change` and merged to `main` on <date> (`<sha>`); written 2026-10-21 under the standing approval …`` (keep the rest), and add any deviation the reviews forced as a **Deviations:** sentence.
2. `CLAUDE.md` — in Key Technical Decisions after the "Jev at Verify, in shadow" bullet:

```markdown
- Websites change (2026-10-21): a failed re-verify never revokes a field whose last good paths still read a value — it is held (`field_holds`) and runs go on with those paths; only the customer's own edits move a certification. Values that change by nature (price, rating, review count, availability) refresh their expected values by themselves when the same certified path that passed on a page reads a valid, shown, in-range value there (never a fixed variant index; logged in `value_refreshes`, shown to the customer and in ops) and are re-verified, free. A free check of every certified website's proof pages and listing runs every three days from the api-server (`WEBSITE_CHECKS=off` turns it off). The website says "Needs attention" and the Verification tab says exactly what needs the customer.
```

   and in Environment:

```markdown
- `WEBSITE_CHECKS` — `off` turns off the scheduled website check (spec 2026-10-21 §3.3); unset = on. The isolated smoke pair sets `off`
- `WEBSITE_CHECK_DAYS` — days between a website's scheduled checks; default 3
```

3. `.env.example` — add, commented: `# WEBSITE_CHECKS=off` and `# WEBSITE_CHECK_DAYS=3` with a one-line comment each.
4. `docs/handoff.md` — replace the line starting `**Newest: [HTML backups capped too (2026-10-21)]` with `**Newest: [Websites change: keep running, re-check, tell the customer (2026-10-21)](#websites-change-keep-running-re-check-tell-the-customer-2026-10-21).** A failed re-verify keeps a field on its last good paths while they still read; prices, ratings, review counts and stock refresh themselves; a free check runs every three days; the website says what needs the customer. Merged <date> after the full gate.` followed by `**Before it: [HTML backups capped too (2026-10-21)](#html-backups-capped-too-2026-10-21).**` and the rest of the old line. Insert before `## HTML backups capped too (2026-10-21)` a section `## Websites change: keep running, re-check, tell the customer (2026-10-21)` with: spec/plan paths; **What changed** (holds; refreshes; the four triggers; the schedule; the notice — one paragraph each, from the spec); **How it was proven** (test counts from Step 2, the smoke, the replay's summary line); **What NOT to redo** (checks never revoke; refreshes are by-nature only, same path, never a fixed variant; the scheduler claim must keep `SKIP LOCKED` and tests must pass `only`); **Open** (spec §11's three questions, and the review's deferred Minors).

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add docs/superpowers/specs/2026-10-21-websites-change-design.md docs/handoff.md CLAUDE.md .env.example docs/testing/screens/app-site-verification-attention.png
git commit -m "docs: websites change — shipped; handoff, decisions, environment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Rebase on `main`, fast-forward `main`, push**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git checkout -- packages/app/src/routeTree.gen.ts
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 2 for the touched packages (and Step 4 if an app/api file on `main` changed). The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/websites-change
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. A refused fast-forward (main moved again) means: rebase again, re-run Steps 2 and 4, try again. Marko's dev servers are not restarted: they pick the change up (and the schedule starts) on his next restart — say so in the run's digest.

---

### Task 13: Apply it to the ten websites (free, keyless; writes Marko's data — approved for these ten) — spec §8, §9

**Files:**
- Create: `packages/api/src/scripts/apply-websites-change.ts`, `docs/testing/results/2026-10-21-websites-change/apply.json`, `docs/testing/results/2026-10-21-websites-change/apply.md`
- Modify: `docs/queue.md`, `docs/handoff.md` (the section's proof line)

**Interfaces:**
- Consumes: `TEN` (`scripts/ten-websites.ts`, Task 11), `backfillHolds` (Task 5), `checkWebsite` (Task 7), `websiteAttention`, `latestRefreshes` (Task 8), `loadCertificationState`, `runnableOf`, `loadFieldCurrency` (Task 3), `resolveInFlightVerification`.

- [ ] **Step 1: Back up the database**

```bash
mkdir -p /c/Users/Marko/Documents/projects/robot-platform-backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker exec robot-platform-db pg_dump -U postgres robot_platform > /c/Users/Marko/Documents/projects/robot-platform-backups/backup-$STAMP-pre-websites-change.sql
ls -l /c/Users/Marko/Documents/projects/robot-platform-backups/backup-$STAMP-pre-websites-change.sql
```

Expected: a file of roughly the size of `backup-20261021-115643-pre-reverify-one-source.sql` (≈ 540 MB) or more. Smaller than 100 MB, or an error: stop and fix before writing anything.

- [ ] **Step 2: Write the script**

```ts
// packages/api/src/scripts/apply-websites-change.ts
// Spec 2026-10-21 §8: the new behaviour, applied once to the ten websites that
// lost their certification at the 2026-10-21 re-verify (approved as part of
// queue item 1). Per website, one at a time: backfill its holds from its
// latest Verify's stored captures, then run one scheduled check on fresh pages
// (refreshes and their free re-verify included) and wait for that re-verify.
// Records before/after. Keyless; JEV_SHADOW must be empty; no sign-in, no
// user or org created, no binding edited except by a refresh.
//
//   cd packages/api && ANTHROPIC_API_KEY= JEV_SHADOW= \
//     CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
//     npx tsx src/scripts/apply-websites-change.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { db } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { backfillHolds } from '../verify/holds.js';
import { checkWebsite } from '../verify/website-checks.js';
import { latestRefreshes, websiteAttention } from '../verify/attention.js';
import { loadCertificationState, loadFieldCurrency, runnableOf } from '../verify/current-certification.js';
import { resolveInFlightVerification } from '../verify/in-flight.js';
import { TEN } from './ten-websites.js';

if (process.env.ANTHROPIC_API_KEY || process.env.JEV_SHADOW) { console.error('ANTHROPIC_API_KEY and JEV_SHADOW must be empty for this run.'); process.exit(1); }
if (!process.env.CAPTURES_DIR) { console.error('Set CAPTURES_DIR to the main checkout’s api-server captures folder.'); process.exit(1); }
const OUT = '../../docs/testing/results/2026-10-21-websites-change';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state(id: string) {
  const currency = await loadFieldCurrency(db, id);
  const attention = await websiteAttention(db, id);
  return {
    runnable: runnableOf(await loadCertificationState(db, id)),
    current: currency.currentKeys, held: currency.heldKeys,
    attention: { fields: attention.fields, goneProducts: attention.goneProducts, findings: Object.fromEntries(Object.entries(attention.findings).map(([k, r]) => [k, { result: r.result, refresh: r.refresh ?? null }])) },
    refreshes: (await latestRefreshes(db, id)).map((r) => ({ key: r.key, at: r.at.toISOString(), pages: Object.values(r.pages).map((p) => `${p.was} → ${p.now}`) })),
  };
}

const report: unknown[] = [];
for (const [id, website] of Object.entries(TEN)) {
  const before = await state(id);
  const backfill = await withBrowserSession((browser) => backfillHolds(db, browser, id, { write: true }));
  const afterBackfill = await state(id);
  const checked = await checkWebsite(id);
  for (let i = 0; i < 60 && (await resolveInFlightVerification(db, id)); i++) await sleep(5000);
  const after = await state(id);
  report.push({ website, sourceId: id, before, backfilled: backfill.upsert.map((h) => h.fieldKey), afterBackfill, checked, after });
  console.log(`${website}: ${before.runnable ? 'ran' : 'refused'} → ${after.runnable ? 'runs' : 'refused'}; held ${after.held.join(', ') || '—'}; refreshed ${after.refreshes.map((r) => r.key).join(', ') || '—'}; needs the customer: ${after.attention.fields.join(', ') || '—'}${after.attention.goneProducts.length ? `; gone products ${after.attention.goneProducts.join(', ')}` : ''}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/apply.json`, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
process.exit(0);
```

- [ ] **Step 3: Run it**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change/packages/api && ANTHROPIC_API_KEY= JEV_SHADOW= CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures npx tsx src/scripts/apply-websites-change.ts
```

Expected: ten lines, each `refused → runs`, or `refused → refused` with the field(s) that read nothing anywhere named under "needs the customer". The run loads each website's proof pages once (and its listing sample), one browser at a time; it never touches :3000/:4000. If the watchdog kills it, re-run: backfill is idempotent (it skips fields already held) and a check is just a check.

- [ ] **Step 4: Write `apply.md`, check "done when"**

`docs/testing/results/2026-10-21-websites-change/apply.md`: the backup file, what was run, a before → after table per website (runs?, held fields, values refreshed was → now, re-verify outcome, what needs the customer in the exact words the app shows — compose them with spec §5's rules), and what differs from the replay and why (the pages moved again, a page that came back, a wall). **Done when** each of the ten either runs or its "needs the customer" column names exactly what the customer must do. If one does neither (e.g. refused with an empty attention), that is a bug: fix it on a branch with a test, re-run for that website, and record it.

- [ ] **Step 5: The queue item to Done, handoff proof line, commit, push**

In `docs/queue.md`: delete item 1 from **Next** (renumber the rest); add at the top of **Done**: ``- <date> — Websites change: keep running, re-check, tell the customer (`<sha>`); the ten websites: `docs/testing/results/2026-10-21-websites-change/apply.md`.`` — and under **Needs Marko** add spec §11's three questions (schedule on by default on his next restart; backfilling holds for other websites; custom fields as "changes by nature"), plus any website from Step 4 that needs him. In `docs/handoff.md`'s new section, add the apply summary line under **How it was proven**.

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-change
git add packages/api/src/scripts/apply-websites-change.ts docs/testing/results/2026-10-21-websites-change/apply.json docs/testing/results/2026-10-21-websites-change/apply.md docs/queue.md docs/handoff.md
git commit -m "ops: the ten websites run again or say what needs the customer — websites change applied

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/websites-change
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: `main` at this commit, pushed. Then the run's digest (Claude Docs page, CLAUDE.md "Autonomous runs"): what shipped, the ten websites' outcome, what needs Marko.
