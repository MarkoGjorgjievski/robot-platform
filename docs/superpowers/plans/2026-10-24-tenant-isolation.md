# Tenant isolation audit, as tests — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, as tests, that no organisation can reach another's rows or files; take every money amount out of customer answers; and put fixed-window rate limits on sign-in, the heavy calls, the address checks and everything else.

**Architecture:** `@robot/api` gains `src/isolation/`: a two-organisation fixture (`two-orgs.ts`) holding one of everything a customer owns; a classification of all 85 tRPC procedures (`procedure-classes.ts`) and a sweep that calls each across the two orgs (`procedure-sweep.test.ts`); `money.ts` (`viewerSeesMoney`, the app's `showsMoney` rule on the server), applied in the six money-bearing procedures and proven by a money sweep (`money-sweep.test.ts`); and `rate-limit.ts`, a fixed-window counter applied as one tRPC middleware on `publicProcedure` (so on every procedure), keyed by group. `@robot/api-server` passes the client address into the tRPC context (`client-ip.ts`, `TRUST_PROXY`) and gets a file-route sweep (`isolation-routes.test.ts`). `@robot/app` makes the money fields optional in its types and shows the rate-limit sentence on the login form and through `mutationErrorText`. One hole found while classifying is fixed: `projects.list` read every organisation's websites and runs (nothing leaked into the answer, but every org's rows were read and certified on each call).

**Tech Stack:** TypeScript ESM; tRPC v11 (`initTRPC`, `createCallerFactory`, middleware with `path` / `getRawInput`) + zod 3 + superjson; Drizzle + Postgres (postgres-js); Hono 4 + `@hono/node-server` 1.19 (`getConnInfo` from `@hono/node-server/conninfo`) + `@hono/trpc-server`; vitest 4; TanStack Start + React 19 (app); Playwright (route smoke).

**Spec:** `docs/superpowers/specs/2026-10-24-tenant-isolation-design.md`

**Planner's notes:** seven tasks, in order. Tasks 2 and 4 consume Task 1's fixture; Tasks 4 and 5 consume Task 2's table; Task 6 consumes Task 5's sentence. Tasks 1–5 all touch `@robot/api` and must not run in parallel. Line numbers were read on `feat/tenant-isolation` @ `fca0e159` and are approximate — find code by the quoted text. Work only in `C:\Users\Marko\Documents\projects\robot-platform-tenant` (bash: `/c/Users/Marko/Documents/projects/robot-platform-tenant`). Decisions the spec left open are listed under "Settled here" at the end of this plan; the reviewer of each task reads them.

## Global Constraints

- **Classes** (spec §2.1, verbatim): `scoped` — takes ids of one org's rows — org A's caller, given org B's ids, gets `NOT_FOUND`; org B's rows are unchanged after the call (row snapshots before and after). `org-wide` — no ids; answers about the caller's org — org A's answer contains none of org B's ids, slugs or names (a deep scan of the JSON). `self` — only the caller's own user or session — A's call never changes B's user or session rows. `membership` — takes a user or org id that must be a membership of the caller (`auth.switchOrg`, `orgs.members.*`) — with B's org id or B's user id: refused (`NOT_FOUND` / `FORBIDDEN`), B unchanged. `ops` — operator only — a non-operator gets `FORBIDDEN`. `public` — no session needed — listed explicitly; must not leak another org's data. `stateless` — touches no org's rows (the address checks) — covered by the rate limit (§2.4), not by scoping.
- **Sweep rules** (§2.1): the sweep fails when a procedure is missing from the table or the table names one that no longer exists — a new procedure must be classified before it can merge; for `scoped`, the table gives an input builder `(b: OrgFixture) => input`, fed with org B's ids; for every class except `public`, the same call with no session must answer `UNAUTHORIZED`; no call may start a browser, an AI call or real work — a refused call refuses before anything is queued, and the sweep checks that no job was enqueued on the test queue.
- **Fixture** (§2.1): `isolation/two-orgs.ts` builds orgs A and B, each with: a project, a dataset with fields and a website with a binding (`createProjectWithSource`); a run with items, and a proof-page capture row with its file on disk; a verification row, a drift check and a coverage check (the existing `seed-*` helpers); a variant setup, an email message, a staff action, and a `run_files` snapshot with a webhook secret; a second member. Everything is cleaned up afterwards. Built through the real procedures where they are cheap, inserted directly where they would launch work.
- **File routes** (§2.2, verbatim): `GET /captures/<B's file>` — no session 401, org A's session 404; traversal (`../`, `%2e%2e`, `\`) is 400. `GET /export/runs/<B's run>.csv|json|xlsx` — 401 / 404. `GET …?snapshot=1` — 401 / 404. Signed link for B's run — 200 by design; a tampered sig, an expired link, another run's sig, a wrong format, or a sig made before a rotated secret all give the same 404. `GET /export/projects/<B's project>.<fmt>` — 401 / 404. Org B's own session gets 200 on each, so the fixture is proven real.
- **Money** (§2.3): `viewerSeesMoney(ctx) = ctx.isOperator || !!ctx.session?.staff`, the same rule as the app's `showsMoney`. Each money-bearing procedure leaves its money fields out (`undefined`, not 0) when it is false: `runs.listByOrg` `costUsd`; `sources.verificationStatus` `costUsd`; `sources.verifyEstimate` `upperBoundUsd`, `perFieldUsd` (it still answers `aiAvailable`, field counts, etc.); `crawl.backfillPreview` `estCostUsd`; `usage.byProject` `spendUsd` (per project and total); `orgs.staffActivity` `run.costUsd`; any other found by the sweep: its money fields. The app's types make these fields optional; its screens already show them only when `showsMoney`. The money sweep calls every `scoped`, `org-wide` and `self` query as a plain customer of org A, on org A's own fixture (runs with a cost and a verification with a cost), and deep-scans each answer for a key matching `/usd|cost|spend|price(?!s?$)/i` whose value is a number or a numeric string; excluded subtrees: scraped data (`data`, `values`, `rows`, `fields`, `expected`, and the export row objects); the same calls as staff (in staff mode) must return the money fields.
- **Rate limits** (§2.4, verbatim): `isolation/rate-limit.ts` is a fixed-window counter in the api process (a `Map` with a 1-minute window, pruned), applied as tRPC middleware on `publicProcedure` / `protectedProcedure` by procedure group: sign-in `auth.signIn` 10 / min per email (lower-cased) and 30 / min per client IP; heavy `sources.verify`, `sources.confirm`, `sources.captureProofPage`, `crawl.plan`, `crawl.probeAndSample`, `crawl.execute`, `crawl.backfill`, `sources.detectVariants`, `sources.transferMarks` 30 / min per org; network `sources.reachability`, `sources.checkListingPage`, `sources.variantLinksNear`, `sources.variantList` 60 / min per org; everything else 600 / min per session. A refused call answers `TOO_MANY_REQUESTS` with **"Too many requests. Wait a minute and try again."**; the app's `mutationErrorText` passes that sentence through, and the sign-in form shows it. Client IP from the api-server's request (`x-forwarded-for` only when `TRUST_PROXY=on`, else the socket address), passed into the tRPC context. Staff are limited like anyone else, on their own key. `RATE_LIMITS=off` turns it off; the vitest configs set it off; the limiter's own tests turn it on in-process with injected limits. One limiter per api-server process.
- **Customer copy:** no money, no HTTP codes, no hosts, never "budget", no internals (no model, "Jev", job, queue or worker words) in anything a customer reads. The rate-limit sentence is the only new customer copy; `packages/app/src/customer-copy-sweep.test.ts` stays green.
- **No paid AI, no browser in the sweeps.** Nothing here calls a model. The procedure and money sweeps mock `runAndWait` and `awaitJob` to throw, and every refused call must leave the test queue's job count unchanged. Every process this plan starts runs with `ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL=`.
- **Marko's data and servers:** never start, stop or restart his dev servers (:3000/:4000) or his worker, never stop or recreate the `robot-platform-db` container, never write a dev-DB row outside tests (every fixture row goes with its throwaway orgs and users; `deleteOwnOrg` refuses the `default` org). No migration in this item.
- **Tests:** Postgres is the `robot-platform-db` container (`docker start robot-platform-db` if it is stopped); api and api-server tests get a per-file `JOB_QUEUE` automatically (`src/test-setup/job-queue.ts`). One file at a time while working (`cd packages/<pkg> && npx vitest run <file>`); full suites serially with `npx vitest run --no-file-parallelism`. Never `pnpm -r test`.
- **Memory is tight (~2.5 GB free):** one heavy job at a time — never two vitest suites, a Chromium test, or the smoke pair and anything else, at once.
- **ESM:** relative imports carry `.js` in `@robot/db`, `@robot/scraper`, `@robot/api`, `@robot/api-server`, `@robot/worker`; none in `@robot/app`.
- **Commits:** by explicit path (`git add <paths>` then `git commit`), never `git add -A` / `git add .`; never stage `packages/app/src/routeTree.gen.ts`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Line endings:** files in this repo are CRLF on this machine — edit with tools that keep them (the Edit tool does); new files may be LF.

## Review Focus

1. **An own id paired with the other org's id** (org A's website with org B's capture id, A's run with B's run items, A's website with B's product addresses) — a person expects nothing of B in the answer and B untouched, not only for calls made wholly of B's ids. → Task 2 tests "RF1: …" (three).
2. **A client that rotates `X-Forwarded-For` to dodge the per-address sign-in limit** — a person expects the header ignored unless `TRUST_PROXY=on`, and behind a proxy the address the proxy saw (the last entry), never one the client wrote first. → Task 5 test "RF2: a rotated X-Forwarded-For does not reset the sign-in limit; behind a proxy the last entry counts".
3. **One email spelled differently** (`" Bob@Example.COM "` against `bob@example.com`) — a person expects one sign-in budget per address, however it is typed. → Task 5 test "RF3: case and spaces do not make a new email".
4. **Staff working inside a customer's org** — a person expects staff Verify clicks not to use up the customer's 30 a minute, and a customer's flood not to lock out the staff member helping them. → Task 5 test "RF4: staff in an org and its customers count apart".
5. **A customer's own field named like money** ("Unit cost USD") — a person expects their scraped values and expected values to reach them whole; only our amounts go. → Task 4 test "RF5: a customer still reads their own money-named data".

---

### Task 1: The two-organisation fixture (`@robot/api` `src/isolation/two-orgs.ts`) — spec §2.1 "The fixture"

**Files:**
- Create: `packages/api/src/isolation/two-orgs.ts`, `packages/api/src/isolation/two-orgs.test.ts`
- Modify: `packages/api/package.json` (`exports`: add `"./isolation/two-orgs": "./src/isolation/two-orgs.ts"` after `"./test-helpers/seed-coverage-check"`)

**Interfaces:**
- Consumes: `signedInCaller`, `deleteOwnOrg`, `type SignedIn` (`test-helpers/identity.ts`); `createProjectWithSource` (`test-helpers/customer-source.ts`); `seedPassingVerification` (`test-helpers/seed-coverage-check.ts`); `seedDriftCheck` (`test-helpers/seed-drift-check.ts`); `seedJevReading` (`test-helpers/seed-jev-reading.ts`); `getCapturesDir` (`persist-screenshot.ts`); `jobQueueName` (`jobs/queue.ts`); `sourceInOrg`, `runInOrg`, `captureInOrg` (`auth/scope.ts`, test only).
- Produces (all exported from `packages/api/src/isolation/two-orgs.ts`, and from `@robot/api/isolation/two-orgs`):
  - `FIXTURE_COST = { runUsd: '0.1234', verificationUsd: '0.0300' } as const`
  - `type OrgFixture = { tag: string; owner: SignedIn; member: { id: string; email: string }; org: { id: string; slug: string; name: string }; projectId: string; projectSlug: string; projectName: string; datasetId: string; sourceId: string; sourceSlug: string; sourceName: string; host: string; urls: string[]; keys: { title: string; price: string }; axisKey: string; runId: string; itemIds: string[]; runCaptureId: string; captureId: string; tileFile: string; verificationId: string; driftCheckId: string; coverageCheckId: string; jevReadingId: string; staffActionId: string; staffEmail: string; emailMessageId: string; webhookSecret: string }`
  - `type TwoOrgs = { a: OrgFixture; b: OrgFixture; capturesDir: string; cleanup: () => Promise<void> }`
  - `buildTwoOrgs(opts: { tag: string; capturesDir?: string }): Promise<TwoOrgs>` — `capturesDir` defaults to `getCapturesDir()` (the tile and the `<captureId>.capture.json` sidecar are written there).
  - `needlesOf(f: OrgFixture): string[]` — every id, slug, name, email, secret and host of `f` (what another org's answer must never contain).
  - `snapshotOrg(f: OrgFixture): Promise<string>` — every row `f` owns, across 22 tables, as one JSON string (equal before and after = unchanged).
  - `queuedJobCount(): Promise<number>` — jobs on this test file's queue (`jobQueueName()`), any status.

- [ ] **Step 1: Write the failing test** — `packages/api/src/isolation/two-orgs.test.ts`:

```ts
// The two-organisation fixture is itself proven (spec 2026-10-24 tenant isolation §2.1): each org holds one of
// everything, its own; no needle of one org appears in the other's rows (the deep scans rely on it); a snapshot is
// stable while nothing changes; and cleanup leaves no row and no file behind.
import { describe, expect, it } from 'vitest';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, emailMessages, jevReadings, orgs, runFiles, sources, users } from '@robot/db';
import { captureInOrg, runInOrg, sourceInOrg } from '../auth/scope.js';
import { buildTwoOrgs, needlesOf, queuedJobCount, snapshotOrg } from './two-orgs.js';

const dir = join(tmpdir(), 'robot-isolation-captures');

describe('two throwaway organisations (spec 2026-10-24 tenant isolation §2.1)', () => {
  it('each holds one of everything, its own; cleanup leaves nothing', async () => {
    const jobsBefore = await queuedJobCount();
    const t = await buildTwoOrgs({ tag: 'iso-fixture', capturesDir: dir });
    process.env.CAPTURES_DIR = dir;
    try {
      for (const f of [t.a, t.b]) {
        const ctx = { db, session: f.owner.session };
        expect((await sourceInOrg(ctx, f.sourceId)).orgId).toBe(f.org.id);
        await runInOrg(ctx, f.runId);
        await captureInOrg(ctx, f.captureId);
        const c = f.owner.caller;
        expect((await c.runs.getWithDetails({ id: f.runId }))!.run.status).toBe('completed');
        expect((await c.crawl.items({ runId: f.runId })).items.map((i) => i.id).sort()).toEqual([...f.itemIds].sort());
        expect(await c.sources.proofPageCapture({ captureId: f.captureId })).toMatchObject({ status: 'captured', tiles: [`/captures/${f.tileFile}`] });
        expect((await c.sources.suggestMarks({ captureId: f.captureId })).captureId).toBe(f.captureId);
        expect((await c.sources.verificationStatus({ sourceId: f.sourceId }))!.id).toBe(f.verificationId);
        expect((await c.sources.driftCheck({ sourceId: f.sourceId }))!.id).toBe(f.driftCheckId);
        expect((await c.sources.coverage({ sourceId: f.sourceId }))!.id).toBe(f.coverageCheckId);
        expect((await c.orgs.members.list()).map((m) => m.userId).sort()).toEqual([f.owner.user.id, f.member.id].sort());
        expect((await c.orgs.staffActivity({ page: 0 })).entries.map((e) => e.id)).toEqual([f.staffActionId]);
        expect((await c.datasets.variants({ datasetId: f.datasetId })).axes.map((a) => a.key)).toEqual([f.axisKey]);
        const site = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { webhookSecret: true, variantSetup: true } }))!;
        expect(site.webhookSecret).toBe(f.webhookSecret);
        expect(site.variantSetup).toMatchObject({ method: 'none', axes: [] });
        expect((await db.select().from(runFiles).where(eq(runFiles.runId, f.runId))).map((r) => r.format).sort()).toEqual(['csv', 'json', 'xlsx']);
        expect((await db.query.emailMessages.findFirst({ where: eq(emailMessages.id, f.emailMessageId) }))!.orgId).toBe(f.org.id);
        expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, f.jevReadingId) }))!.sourceId).toBe(f.sourceId);
        await stat(join(dir, f.tileFile));
        await stat(join(dir, `${f.captureId}.capture.json`));
      }
      // The deep scans look for one org's needles in the other's answers: none may already sit in the other's rows.
      const aRows = await snapshotOrg(t.a);
      const bRows = await snapshotOrg(t.b);
      for (const n of needlesOf(t.b)) expect(aRows.includes(n), `B's ${n} is in A's rows`).toBe(false);
      for (const n of needlesOf(t.a)) expect(bRows.includes(n), `A's ${n} is in B's rows`).toBe(false);
      for (const n of needlesOf(t.b)) expect(bRows.includes(n), `B's ${n} is not in B's own rows`).toBe(true);
      expect(await snapshotOrg(t.b)).toBe(bRows);
      // Built without queueing any work.
      expect(await queuedJobCount()).toBe(jobsBefore);
    } finally {
      await t.cleanup();
    }
    for (const f of [t.a, t.b]) {
      expect(await db.query.orgs.findFirst({ where: eq(orgs.id, f.org.id) })).toBeUndefined();
      expect(await db.query.users.findFirst({ where: eq(users.id, f.owner.user.id) })).toBeUndefined();
      expect(await db.query.users.findFirst({ where: eq(users.id, f.member.id) })).toBeUndefined();
      await expect(stat(join(dir, f.tileFile))).rejects.toThrow();
      await expect(stat(join(dir, `${f.captureId}.capture.json`))).rejects.toThrow();
    }
  }, 120_000);
});
```

(The third loop proves each needle is a real value of B's — a needle that names nothing could never fail a scan.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/two-orgs.test.ts`
Expected: FAIL — `Cannot find module './two-orgs.js'`.

- [ ] **Step 3: The fixture** — `packages/api/src/isolation/two-orgs.ts`:

```ts
// packages/api/src/isolation/two-orgs.ts
// Two throwaway organisations, A and B, each holding one of everything a customer owns (spec 2026-10-24 tenant
// isolation §2.1): the procedure, money and file-route sweeps aim A's caller at B's ids. Cheap things go through the
// real procedures; anything that would start work (a run, a capture, a Verify, a check) is inserted directly, as the
// seed-* helpers do. `cleanup` removes every org the two owners own (a sweep may create one), the four users and the
// files written. Test-only: it reaches `deleteOwnOrg`, which asserts with vitest's `expect`.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  db, orgs, users, memberships, sources, runs, runItems, captures, extractions, sourceVerifications, coverageChecks,
  staffActions, emailMessages, runFiles, jobs,
} from '@robot/db';
import type { CertifiedPath } from '@robot/scraper';
import { signedInCaller, deleteOwnOrg, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedPassingVerification } from '../test-helpers/seed-coverage-check.js';
import { seedDriftCheck } from '../test-helpers/seed-drift-check.js';
import { seedJevReading } from '../test-helpers/seed-jev-reading.js';
import { getCapturesDir } from '../persist-screenshot.js';
import { jobQueueName } from '../jobs/queue.js';

/** What org A's and B's run and verification cost (the money sweep's amounts). */
export const FIXTURE_COST = { runUsd: '0.1234', verificationUsd: '0.0300' } as const;

export type OrgFixture = {
  tag: string;
  owner: SignedIn;
  member: { id: string; email: string };
  org: { id: string; slug: string; name: string };
  projectId: string; projectSlug: string; projectName: string; datasetId: string;
  sourceId: string; sourceSlug: string; sourceName: string; host: string; urls: string[];
  keys: { title: string; price: string }; axisKey: string;
  runId: string; itemIds: string[]; runCaptureId: string;
  captureId: string; tileFile: string;
  verificationId: string; driftCheckId: string; coverageCheckId: string; jevReadingId: string;
  staffActionId: string; staffEmail: string; emailMessageId: string; webhookSecret: string;
};

export type TwoOrgs = { a: OrgFixture; b: OrgFixture; capturesDir: string; cleanup: () => Promise<void> };

const TITLE_PATH: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
const PRICE_PATH: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

async function buildOrg(tag: string, dir: string): Promise<OrgFixture> {
  const owner = await signedInCaller(tag);
  const host = `test-${tag}.example.com`;
  const urls = [1, 2, 3].map((n) => `https://${host}/p/${n}`);
  // The project, its dataset and fields, and the website with its binding: the real procedures (cheap, no work).
  const site = await createProjectWithSource(owner.caller, {
    tag,
    urls,
    fields: [{ name: 'Title', type: 'text' }, { name: 'Price', type: 'money' }],
    expected: {
      Title: Object.fromEntries(urls.map((u, i) => [u, `Lamp ${i + 1}`])),
      Price: Object.fromEntries(urls.map((u, i) => [u, `${19 + i}.99`])),
    },
  });
  const keys = { title: site.keys.Title!, price: site.keys.Price! };
  const axis = await owner.caller.datasets.addAxis({ datasetId: site.datasetId, name: 'Colour' });

  // The variant setup and the webhook secret: direct (setVariantSetup and sources.update are covered by the sweep).
  const webhookSecret = randomBytes(32).toString('hex');
  await db.update(sources).set({ variantSetup: { method: 'none', axes: [], confirmedAt: new Date().toISOString() }, webhookSecret })
    .where(eq(sources.id, site.sourceId));

  // A second member.
  const [member] = await db.insert(users)
    .values({ email: `${tag}-member-${randomUUID().slice(0, 8)}@example.com`, name: `Member ${tag}`, avatarColour: '#52a8ff' })
    .returning({ id: users.id, email: users.email });
  await db.insert(memberships).values({ userId: member!.id, orgId: owner.org.id, role: 'member' });

  // A completed run with a cost: one extracted product, one failed (a gap), its delivered files.
  const [run] = await db.insert(runs)
    .values({ sourceId: site.sourceId, status: 'completed', startedAt: new Date(), completedAt: new Date(), resultCount: 1, costUsd: FIXTURE_COST.runUsd })
    .returning({ id: runs.id });
  const [runCapture] = await db.insert(captures).values({ sourceId: site.sourceId, runId: run!.id, url: urls[0]! }).returning({ id: captures.id });
  const [extraction] = await db.insert(extractions)
    .values({ sourceId: site.sourceId, captureId: runCapture!.id, runId: run!.id, data: [{ [keys.title]: 'Lamp 1', [keys.price]: '19.99', _url: urls[0] }], rowCount: 1 })
    .returning({ id: extractions.id });
  const items = await db.insert(runItems).values([
    { runId: run!.id, kind: 'detail', url: urls[0]!, status: 'done', extractionId: extraction!.id, completedAt: new Date() },
    { runId: run!.id, kind: 'detail', url: urls[1]!, status: 'failed', error: 'This page could not be read.' },
  ]).returning({ id: runItems.id });
  await db.insert(runFiles).values((['csv', 'json', 'xlsx'] as const).map((format) => ({
    runId: run!.id, format, filename: `site-${tag}.${format}`, bytes: Buffer.from(`${tag}:${format}`), rows: 1,
  })));

  // A proof-page capture with its tile and its sidecar on disk (no browser).
  const tileFile = `iso-${randomUUID()}.png`;
  const now = new Date().toISOString();
  const [capture] = await db.insert(captures).values({
    sourceId: site.sourceId, url: urls[0]!,
    metadata: { kind: 'proof-page', status: 'captured', url: urls[0], startedAt: now, capturedAt: now, tiles: [`/captures/${tileFile}`], boxes: [], pageHeight: 10, capturedHeight: 10, contentHeight: 10, title: 'Lamp 1' },
  }).returning({ id: captures.id });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, tileFile), Buffer.from(`tile ${tag}`));
  await writeFile(join(dir, `${capture!.id}.capture.json`), JSON.stringify({
    url: urls[0],
    html: '<html><head><title>Lamp 1</title></head><body><h1>Lamp 1</h1><p class="price">19.99</p></body></html>',
    structuredData: { ldJson: [{ '@type': 'Product', name: 'Lamp 1', offers: { price: '19.99' } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  }));
  const { readingId } = await seedJevReading({ sourceId: site.sourceId, captureId: capture!.id, url: urls[0]!, answers: {} });

  // A drift check (with its own baseline), then the newest, passing, paid verification, then a coverage check.
  const { checkId: driftCheckId } = await seedDriftCheck(site.sourceId, keys.price);
  const { verificationId } = await seedPassingVerification(site.sourceId, { [keys.title]: [TITLE_PATH], [keys.price]: [PRICE_PATH] });
  await db.update(sourceVerifications).set({ costUsd: FIXTURE_COST.verificationUsd, aiCalls: 1 }).where(eq(sourceVerifications.id, verificationId));
  const [coverage] = await db.insert(coverageChecks)
    .values({ sourceId: site.sourceId, verificationId, status: 'done', completedAt: new Date() })
    .returning({ id: coverageChecks.id });

  // A staff action on the run, and an email message.
  const staffEmail = `staff-${tag}@example.com`;
  const [action] = await db.insert(staffActions).values({
    orgId: owner.org.id, userId: null, actorEmail: staffEmail, action: 'crawl.execute', summary: `Ran an extraction on Site ${tag}`,
    projectId: site.projectId, sourceId: site.sourceId, runId: run!.id,
  }).returning({ id: staffActions.id });
  const [mail] = await db.insert(emailMessages).values({
    orgId: owner.org.id, userId: owner.user.id, kind: 'attention', dedupeKey: `isolation:${owner.org.id}`, toAddress: owner.user.email,
    subject: `Site ${tag} needs your attention`, text: 'Price needs you.\n', html: '<p>Price needs you.</p>', status: 'skipped',
  }).returning({ id: emailMessages.id });

  return {
    tag, owner, member: { id: member!.id, email: member!.email },
    org: { id: owner.org.id, slug: owner.org.slug, name: owner.org.name },
    projectId: site.projectId, projectSlug: site.projectSlug, projectName: `Test ${tag}`, datasetId: site.datasetId,
    sourceId: site.sourceId, sourceSlug: site.sourceSlug, sourceName: `Site ${tag}`, host, urls,
    keys, axisKey: axis.key,
    runId: run!.id, itemIds: items.map((i) => i.id), runCaptureId: runCapture!.id,
    captureId: capture!.id, tileFile,
    verificationId, driftCheckId, coverageCheckId: coverage!.id, jevReadingId: readingId,
    staffActionId: action!.id, staffEmail, emailMessageId: mail!.id, webhookSecret,
  };
}

export async function buildTwoOrgs(opts: { tag: string; capturesDir?: string }): Promise<TwoOrgs> {
  const dir = opts.capturesDir ?? getCapturesDir();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 4)}`;
  const a = await buildOrg(`${opts.tag}-${stamp}-a`, dir);
  const b = await buildOrg(`${opts.tag}-${stamp}-b`, dir);
  return {
    a, b, capturesDir: dir,
    cleanup: async () => {
      for (const f of [a, b]) {
        await rm(join(dir, f.tileFile), { force: true });
        await rm(join(dir, `${f.captureId}.capture.json`), { force: true });
      }
      // Every org the two owners own: their personal orgs, and any a sweep created (orgs.create). Each goes through
      // deleteOwnOrg's guard (never `default`); projects, websites, runs, checks, messages and staff actions cascade.
      const owned = await db.select({ id: orgs.id }).from(orgs).where(inArray(orgs.ownerUserId, [a.owner.user.id, b.owner.user.id]));
      for (const o of owned) await deleteOwnOrg(o.id);
      for (const f of [a, b]) await deleteOwnOrg(f.org.id);
      await db.delete(users).where(inArray(users.id, [a.owner.user.id, a.member.id, b.owner.user.id, b.member.id]));
    },
  };
}

/** Everything that names `f`: what another org's answer must never contain. */
export function needlesOf(f: OrgFixture): string[] {
  return [
    f.org.id, f.org.slug, f.org.name, f.owner.user.id, f.owner.user.email, f.member.id, f.member.email,
    f.projectId, f.projectSlug, f.projectName, f.datasetId, f.sourceId, f.sourceSlug, f.sourceName, f.host,
    f.runId, ...f.itemIds, f.runCaptureId, f.captureId, f.tileFile, f.verificationId, f.driftCheckId, f.coverageCheckId,
    f.jevReadingId, f.staffActionId, f.staffEmail, f.emailMessageId, f.webhookSecret,
  ];
}

const sourcesOf = (orgId: string) =>
  sql`(SELECT s.id FROM sources s JOIN datasets d ON d.id = s.dataset_id JOIN projects p ON p.id = d.project_id WHERE p.org_id = ${orgId})`;
const runsOf = (orgId: string) => sql`(SELECT r.id FROM runs r WHERE r.source_id IN ${sourcesOf(orgId)})`;

function snapshotQueries(f: OrgFixture): Record<string, SQL> {
  const org = f.org.id;
  const people = sql`(${f.owner.user.id}::uuid, ${f.member.id}::uuid)`;
  return {
    orgs: sql`SELECT * FROM orgs WHERE id = ${org}`,
    users: sql`SELECT * FROM users WHERE id IN ${people}`,
    sessions: sql`SELECT * FROM sessions WHERE user_id IN ${people}`,
    memberships: sql`SELECT * FROM memberships WHERE org_id = ${org}`,
    projects: sql`SELECT * FROM projects WHERE org_id = ${org}`,
    datasets: sql`SELECT d.* FROM datasets d JOIN projects p ON p.id = d.project_id WHERE p.org_id = ${org}`,
    input_sets: sql`SELECT i.* FROM input_sets i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ${org}`,
    sources: sql`SELECT * FROM sources WHERE id IN ${sourcesOf(org)}`,
    runs: sql`SELECT * FROM runs WHERE source_id IN ${sourcesOf(org)}`,
    run_items: sql`SELECT * FROM run_items WHERE run_id IN ${runsOf(org)}`,
    run_files: sql`SELECT id, run_id, format, filename, md5(bytes) AS bytes_md5, rows, created_at FROM run_files WHERE run_id IN ${runsOf(org)}`,
    webhook_deliveries: sql`SELECT * FROM webhook_deliveries WHERE run_id IN ${runsOf(org)}`,
    captures: sql`SELECT * FROM captures WHERE source_id IN ${sourcesOf(org)}`,
    extractions: sql`SELECT * FROM extractions WHERE source_id IN ${sourcesOf(org)}`,
    source_verifications: sql`SELECT * FROM source_verifications WHERE source_id IN ${sourcesOf(org)}`,
    drift_checks: sql`SELECT * FROM drift_checks WHERE source_id IN ${sourcesOf(org)}`,
    coverage_checks: sql`SELECT * FROM coverage_checks WHERE source_id IN ${sourcesOf(org)}`,
    field_holds: sql`SELECT * FROM field_holds WHERE source_id IN ${sourcesOf(org)}`,
    value_refreshes: sql`SELECT * FROM value_refreshes WHERE source_id IN ${sourcesOf(org)}`,
    jev_readings: sql`SELECT * FROM jev_readings WHERE source_id IN ${sourcesOf(org)}`,
    staff_actions: sql`SELECT * FROM staff_actions WHERE org_id = ${org}`,
    email_messages: sql`SELECT * FROM email_messages WHERE org_id = ${org}`,
  };
}

/** Every row `f` owns, in a stable order: equal before and after a call means the call changed nothing of `f`. */
export async function snapshotOrg(f: OrgFixture): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const [table, inner] of Object.entries(snapshotQueries(f))) {
    const res = await db.execute(sql`SELECT coalesce(json_agg(t ORDER BY row_to_json(t)::text), '[]'::json) AS rows FROM (${inner}) t`);
    out[table] = (res as unknown as Array<{ rows: unknown }>)[0]!.rows;
  }
  return JSON.stringify(out);
}

/** Jobs on this test file's queue, any status: a refused call must leave it as it was. */
export async function queuedJobCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.queue, jobQueueName()));
  return Number(row!.n);
}
```

Notes for the implementer:
- `deleteOwnOrg` returns early for an org already gone, so the second loop (the personal orgs, which `owned` already covered) is a no-op guard for a personal org whose `ownerUserId` were ever null.
- If `sql\`(${a}::uuid, ${b}::uuid)\`` does not render as a parenthesised list in this Drizzle version, write `IN (${f.owner.user.id}::uuid, ${f.member.id}::uuid)` inline in both queries.
- `seedDriftCheck` inserts its own baseline verification before `seedPassingVerification` inserts the paid one, so the paid one is the newest by `started_at`. If the self-test's `verificationStatus` line ever reads the baseline instead (two equal `started_at`s), move the baseline back right after `seedDriftCheck`: `await db.update(sourceVerifications).set({ startedAt: sql\`started_at - interval '1 second'\` }).where(eq(sourceVerifications.sourceId, site.sourceId));`.

- [ ] **Step 4: Add the package export** — `packages/api/package.json`, in `exports`, after `"./test-helpers/seed-coverage-check": "./src/test-helpers/seed-coverage-check.ts"`:

```json
    "./isolation/two-orgs": "./src/isolation/two-orgs.ts"
```

(add the comma on the line before).

- [ ] **Step 5: Run it to see it pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/two-orgs.test.ts && npx tsc --noEmit`
Expected: PASS (1 test), no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add packages/api/src/isolation/two-orgs.ts packages/api/src/isolation/two-orgs.test.ts packages/api/package.json
git commit -m "test(api): two throwaway organisations, each with one of everything a customer owns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every procedure classified, and the procedure sweep (`@robot/api` `src/isolation/`) — spec §2.1, §3, §4.1

**Files:**
- Create: `packages/api/src/isolation/procedure-classes.ts`, `packages/api/src/isolation/procedure-sweep.test.ts`, `packages/api/src/isolation/projects-list-scope.test.ts`
- Modify: `packages/api/src/routers/projects.ts` (`list`, ~lines 53–74: the `sourceRows` and `lastRuns` queries)

**Interfaces:**
- Consumes: Task 1's `buildTwoOrgs`, `needlesOf`, `snapshotOrg`, `queuedJobCount`, `type OrgFixture`, `type TwoOrgs`; `signIn`, `signedInCaller`, `enterAsStaff` (`test-helpers/identity.ts`); `appRouter` (`routers/index.ts`); `createCallerFactory` (`trpc.ts`).
- Produces (`packages/api/src/isolation/procedure-classes.ts`):
  - `type ProcedureClass = 'scoped' | 'org-wide' | 'self' | 'membership' | 'ops' | 'public' | 'stateless'`
  - `type ProcedureEntry = { class: 'scoped'; input: (f: OrgFixture) => unknown; works?: string } | { class: 'org-wide'; input?: (f: OrgFixture) => unknown } | { class: 'self'; input?: (f: OrgFixture) => unknown } | { class: 'membership'; inputs: (b: OrgFixture) => unknown[]; refusal: 'NOT_FOUND' | 'FORBIDDEN' } | { class: 'ops'; input?: (f: OrgFixture) => unknown } | { class: 'public'; input?: (f: OrgFixture) => unknown } | { class: 'stateless' }` — `works` names the real work a `scoped` call does for its own org (the money sweep never calls those).
  - `PROCEDURE_CLASSES: Record<string, ProcedureEntry>` — 85 entries: scoped 56, org-wide 8, self 8, membership 3, ops 5, public 3, stateless 2.

The table (every procedure in `appRouter` on `fca0e159`, enumerated from `appRouter._def.procedures`):

| Class | Procedures |
|---|---|
| `scoped` (56) | `projects.get`, `projects.output`, `projects.rename`, `projects.delete`; `datasets.addField`, `datasets.renameField`, `datasets.retypeField`, `datasets.deleteField`, `datasets.fieldStatus`, `datasets.variants`, `datasets.setVariantMode`, `datasets.setFieldLevel`, `datasets.addAxis`, `datasets.renameAxis`, `datasets.deleteAxis`; `sources.get`, `sources.update`, `sources.rotateWebhookSecret`, `sources.createInProject`, `sources.rename`, `sources.setListingPages`, `sources.setProductUrls`, `sources.inputRows`, `sources.updateBinding`, `sources.captureProofPage`, `sources.proofPageCapture`, `sources.proofPageCaptures`, `sources.suggestMarks`, `sources.jevReadings`, `sources.transferMarks`, `sources.confirm`, `sources.delete`, `sources.verifyEstimate`, `sources.verify`, `sources.verificationStatus`, `sources.checkDrift`, `sources.driftCheck`, `sources.coverage`, `sources.attention`, `sources.detectVariants`, `sources.setVariantSetup`, `sources.saveVariantAnswer`, `sources.variantList`, `sources.variantLinksNear`; `runs.getWithDetails`, `runs.listBySource`; `crawl.plan`, `crawl.probeAndSample`, `crawl.items`, `crawl.status`, `crawl.cancel`, `crawl.execute`, `crawl.coverage`, `crawl.misses`, `crawl.backfillPreview`, `crawl.backfill` |
| `org-wide` (8) | `orgs.rename`, `orgs.delete`, `orgs.members.list`, `orgs.staffActivity`, `projects.list`, `projects.create`, `runs.listByOrg`, `usage.byProject` |
| `self` (8) | `auth.signOut`, `auth.me`, `auth.setTheme`, `auth.updateName`, `account.emailPrefs`, `account.updateEmailPrefs`, `orgs.create`, `ops.leaveOrg` |
| `membership` (3) | `auth.switchOrg` (FORBIDDEN), `orgs.members.setRole` (NOT_FOUND), `orgs.members.remove` (NOT_FOUND) |
| `ops` (5) | `ops.websites`, `ops.website`, `ops.enterOrg`, `ops.staffActivity`, `ops.staffActivityFilters` |
| `public` (3) | `auth.signIn`, `datasets.catalogue`, `ops.me` |
| `stateless` (2) | `sources.reachability`, `sources.checkListingPage` |

- [ ] **Step 1: The table** — `packages/api/src/isolation/procedure-classes.ts`:

```ts
// packages/api/src/isolation/procedure-classes.ts
// Every tRPC procedure, classified (spec 2026-10-24 tenant isolation §2.1). The procedure sweep fails on a path
// missing here, or named here and gone: a new procedure must say how it is scoped before it can merge. Input builders
// take a fixture: `scoped` and `membership` ones are fed the OTHER org's, the rest the caller's own.
import type { OrgFixture } from './two-orgs.js';

export type ProcedureClass = 'scoped' | 'org-wide' | 'self' | 'membership' | 'ops' | 'public' | 'stateless';
type Build = (f: OrgFixture) => unknown;

export type ProcedureEntry =
  /** Takes ids of one org's rows. `works`: the real work the call does for its own org (a worker job) — only ever
   *  exercised as a refusal; the money sweep does not call it. */
  | { class: 'scoped'; input: Build; works?: string }
  /** No ids; answers about, or acts on, the caller's own org. */
  | { class: 'org-wide'; input?: Build }
  /** Only the caller's own user or session. */
  | { class: 'self'; input?: Build }
  /** Takes a user or org id that must be a membership of the caller; each of `inputs(B)` is refused with `refusal`. */
  | { class: 'membership'; inputs: (b: OrgFixture) => unknown[]; refusal: 'NOT_FOUND' | 'FORBIDDEN' }
  /** Operators only. */
  | { class: 'ops'; input?: Build }
  /** No session needed; the answer names nothing of another org. */
  | { class: 'public'; input?: Build }
  /** Touches no org's rows (an address check): covered by the rate limit (§2.4); never called with a session here. */
  | { class: 'stateless' };

const month = () => new Date().toISOString().slice(0, 7);
const site = (f: OrgFixture) => ({ sourceId: f.sourceId });
const run = (f: OrgFixture) => ({ runId: f.runId });
const ds = (f: OrgFixture) => ({ datasetId: f.datasetId });

export const PROCEDURE_CLASSES: Record<string, ProcedureEntry> = {
  // ─── auth ───
  'auth.signIn': { class: 'public', input: (f) => ({ email: f.owner.user.email, password: 'x' }) },
  'auth.signOut': { class: 'self' },
  'auth.me': { class: 'self' },
  'auth.switchOrg': { class: 'membership', inputs: (b) => [{ orgId: b.org.id }], refusal: 'FORBIDDEN' },
  'auth.setTheme': { class: 'self', input: () => ({ theme: 'light' }) },
  'auth.updateName': { class: 'self', input: () => ({ name: 'Renamed by the sweep' }) },
  // ─── account ───
  'account.emailPrefs': { class: 'self' },
  'account.updateEmailPrefs': { class: 'self', input: () => ({ attention: false }) },
  // ─── orgs ───
  'orgs.create': { class: 'self', input: () => ({ name: 'Sweep side org' }) },
  'orgs.rename': { class: 'org-wide', input: (f) => ({ name: `${f.org.name} renamed` }) },
  'orgs.delete': { class: 'org-wide' },
  'orgs.members.list': { class: 'org-wide' },
  'orgs.members.setRole': { class: 'membership', inputs: (b) => [{ userId: b.member.id, role: 'admin' }, { userId: b.owner.user.id, role: 'member' }], refusal: 'NOT_FOUND' },
  'orgs.members.remove': { class: 'membership', inputs: (b) => [{ userId: b.member.id }, { userId: b.owner.user.id }], refusal: 'NOT_FOUND' },
  'orgs.staffActivity': { class: 'org-wide', input: () => ({ page: 0 }) },
  // ─── projects ───
  'projects.list': { class: 'org-wide' },
  'projects.get': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug }) },
  'projects.output': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug }) },
  'projects.create': { class: 'org-wide', input: () => ({ name: 'Sweep project' }) },
  'projects.rename': { class: 'scoped', input: (f) => ({ projectId: f.projectId, name: 'Stray' }) },
  'projects.delete': { class: 'scoped', input: (f) => ({ projectId: f.projectId }) },
  // ─── datasets ───
  'datasets.catalogue': { class: 'public' },
  'datasets.addField': { class: 'scoped', input: (f) => ({ ...ds(f), name: 'Stray', type: 'text' }) },
  'datasets.renameField': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title, name: 'Stray' }) },
  'datasets.retypeField': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title, type: 'number' }) },
  'datasets.deleteField': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title }) },
  'datasets.fieldStatus': { class: 'scoped', input: ds },
  'datasets.variants': { class: 'scoped', input: ds },
  'datasets.setVariantMode': { class: 'scoped', input: (f) => ({ ...ds(f), mode: 'row_per_variant' }) },
  'datasets.setFieldLevel': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title, level: 'variant' }) },
  'datasets.addAxis': { class: 'scoped', input: (f) => ({ ...ds(f), name: 'Stray' }) },
  'datasets.renameAxis': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.axisKey, name: 'Stray' }) },
  'datasets.deleteAxis': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.axisKey }) },
  // ─── sources ───
  'sources.get': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug, sourceSlug: f.sourceSlug }) },
  'sources.update': { class: 'scoped', input: (f) => ({ id: f.sourceId, isActive: false }) },
  'sources.rotateWebhookSecret': { class: 'scoped', input: (f) => ({ id: f.sourceId }) },
  'sources.createInProject': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug, name: 'Stray', url: f.urls[0] }) },
  'sources.rename': { class: 'scoped', input: (f) => ({ ...site(f), name: 'Stray' }) },
  'sources.setListingPages': { class: 'scoped', input: (f) => ({ ...site(f), urls: [`https://${f.host}/l`] }) },
  'sources.setProductUrls': { class: 'scoped', input: (f) => ({ ...site(f), urls: [f.urls[0]] }) },
  'sources.inputRows': { class: 'scoped', input: site },
  'sources.updateBinding': { class: 'scoped', input: (f) => ({ ...site(f), urls: f.urls, descriptions: {}, expected: {} }) },
  'sources.checkListingPage': { class: 'stateless' },
  'sources.reachability': { class: 'stateless' },
  'sources.captureProofPage': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0] }), works: 'a proof-page capture job' },
  'sources.proofPageCapture': { class: 'scoped', input: (f) => ({ captureId: f.captureId }) },
  'sources.proofPageCaptures': { class: 'scoped', input: (f) => ({ ...site(f), urls: [f.urls[0]] }) },
  'sources.suggestMarks': { class: 'scoped', input: (f) => ({ captureId: f.captureId }) },
  'sources.jevReadings': { class: 'scoped', input: (f) => ({ ...site(f), captureIds: [f.captureId] }) },
  'sources.transferMarks': { class: 'scoped', input: (f) => ({ ...site(f), fromUrl: f.urls[0], toUrls: [f.urls[1]] }), works: 'a transfer-marks job' },
  'sources.confirm': { class: 'scoped', input: site, works: 'a plan job and a full run' },
  'sources.delete': { class: 'scoped', input: site },
  'sources.verifyEstimate': { class: 'scoped', input: site },
  'sources.verify': { class: 'scoped', input: site, works: 'a verify job' },
  'sources.verificationStatus': { class: 'scoped', input: site },
  'sources.checkDrift': { class: 'scoped', input: site, works: 'a drift-check job' },
  'sources.driftCheck': { class: 'scoped', input: site },
  'sources.coverage': { class: 'scoped', input: site },
  'sources.attention': { class: 'scoped', input: site },
  'sources.detectVariants': { class: 'scoped', input: site, works: 'a detect-variants job' },
  'sources.setVariantSetup': { class: 'scoped', input: (f) => ({ ...site(f), method: 'none', axes: [] }) },
  'sources.saveVariantAnswer': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0], answer: null }) },
  'sources.variantList': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0], list: { source: 'json-ld', path: 'offers' } }) },
  'sources.variantLinksNear': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0], xpath: '//a' }), works: 'a variant-links-near job' },
  // ─── ops ───
  'ops.me': { class: 'public' },
  'ops.websites': { class: 'ops' },
  'ops.website': { class: 'ops', input: site },
  'ops.enterOrg': { class: 'ops', input: site },
  'ops.leaveOrg': { class: 'self' },
  'ops.staffActivity': { class: 'ops', input: (f) => ({ orgId: f.org.id }) },
  'ops.staffActivityFilters': { class: 'ops' },
  // ─── runs ───
  'runs.getWithDetails': { class: 'scoped', input: (f) => ({ id: f.runId }) },
  'runs.listBySource': { class: 'scoped', input: site },
  'runs.listByOrg': { class: 'org-wide' },
  // ─── crawl ───
  'crawl.plan': { class: 'scoped', input: (f) => ({ ...site(f), probe: true }), works: 'a plan job' },
  'crawl.probeAndSample': { class: 'scoped', input: site, works: 'a plan job and a sample run' },
  'crawl.items': { class: 'scoped', input: run },
  'crawl.status': { class: 'scoped', input: run },
  'crawl.cancel': { class: 'scoped', input: run },
  'crawl.execute': { class: 'scoped', input: (f) => ({ ...run(f), dryRun: true }) },
  'crawl.coverage': { class: 'scoped', input: run },
  'crawl.misses': { class: 'scoped', input: run },
  'crawl.backfillPreview': { class: 'scoped', input: run },
  'crawl.backfill': { class: 'scoped', input: run, works: 'a backfill run' },
  // ─── usage ───
  'usage.byProject': { class: 'org-wide', input: () => ({ month: month() }) },
};
```

- [ ] **Step 2: Write the sweep** — `packages/api/src/isolation/procedure-sweep.test.ts`:

```ts
// Tenant isolation, as a test (spec 2026-10-24 §2.1, §4.1): every tRPC procedure is classified, and each is called
// across two throwaway organisations. A procedure missing from the table fails here — a new one must say how it is
// scoped before it can merge. No call may reach the worker: `runAndWait` and `awaitJob` throw, and every call below
// must leave org B's rows and the test queue exactly as they were.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory } from '../trpc.js';
import { enterAsStaff, signIn, signedInCaller } from '../test-helpers/identity.js';
import { PROCEDURE_CLASSES, type ProcedureEntry } from './procedure-classes.js';
import { buildTwoOrgs, needlesOf, queuedJobCount, snapshotOrg, type TwoOrgs } from './two-orgs.js';

vi.mock('../jobs/enqueue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/enqueue.js')>()),
  runAndWait: async () => { throw new Error('procedure sweep: a call reached the worker'); },
}));
vi.mock('../jobs/queue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/queue.js')>()),
  awaitJob: async () => { throw new Error('procedure sweep: a call waited on a job'); },
}));

process.env.CAPTURES_DIR = join(tmpdir(), 'robot-isolation-captures');

type Procedures = Record<string, { _def: { type: 'query' | 'mutation' | 'subscription' } }>;
const procedures = (appRouter as unknown as { _def: { procedures: Procedures } })._def.procedures;
const createCaller = createCallerFactory(appRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (caller: unknown, path: string) => path.split('.').reduce<any>((node, key) => node[key], caller) as (input?: unknown) => Promise<unknown>;
const pathsOf = (cls: ProcedureEntry['class']) => Object.entries(PROCEDURE_CLASSES).filter(([, e]) => e.class === cls).map(([p]) => p);
function entry<C extends ProcedureEntry['class']>(path: string, cls: C): Extract<ProcedureEntry, { class: C }> {
  const e = PROCEDURE_CLASSES[path]!;
  if (e.class !== cls) throw new Error(`${path} is ${e.class}, not ${cls}`);
  return e as Extract<ProcedureEntry, { class: C }>;
}

type Settled = { ok: true; value: unknown } | { ok: false; error: { code?: string; message: string } };
async function settle(p: Promise<unknown>): Promise<Settled> {
  try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: e as { code?: string; message: string } }; }
}
const codeOf = (s: Settled) => (s.ok ? 'answered' : s.error.code);
function namesNothingOf(answer: unknown, needles: string[], label: string) {
  const text = JSON.stringify(answer) ?? '';
  for (const n of needles) expect(text.includes(n), `${label} names ${n} of the other organisation`).toBe(false);
}

let t: TwoOrgs;
const savedOps = process.env.OPS_EMAILS;
beforeAll(async () => {
  process.env.OPS_EMAILS = ''; // nobody here is an operator, unless a test says so
  t = await buildTwoOrgs({ tag: 'iso-sweep' });
}, 120_000);
afterAll(async () => {
  if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps;
  await t?.cleanup();
});

/** B's rows and the test queue before and after `call`: neither may change. */
async function leavesBAlone(label: string, call: () => Promise<unknown>): Promise<Settled> {
  const before = await snapshotOrg(t.b);
  const jobs = await queuedJobCount();
  const out = await settle(call());
  expect(await snapshotOrg(t.b), `${label} changed org B's rows`).toBe(before);
  expect(await queuedJobCount(), `${label} queued work`).toBe(jobs);
  return out;
}

describe('the classification table (spec §2.1)', () => {
  it('names every procedure, and only procedures that exist', () => {
    expect(Object.keys(PROCEDURE_CLASSES).sort()).toEqual(Object.keys(procedures).sort());
  });

  it('the stateless procedures are the two address checks', () => {
    expect(pathsOf('stateless').sort()).toEqual(['sources.checkListingPage', 'sources.reachability']);
  });
});

describe('no session (spec §2.1)', () => {
  const bare = createCaller({ db, session: null });
  // Every guard runs before input parsing, so `{}` reaches it for every path.
  it.each(Object.keys(PROCEDURE_CLASSES).filter((p) => PROCEDURE_CLASSES[p]!.class !== 'public'))('%s is UNAUTHORIZED', async (path) => {
    expect(codeOf(await leavesBAlone(path, () => at(bare, path)({})))).toBe('UNAUTHORIZED');
  });
});

describe("scoped: org B's ids from org A's caller (spec §2.1)", () => {
  it.each(pathsOf('scoped'))('%s is NOT_FOUND and leaves B alone', async (path) => {
    const e = entry(path, 'scoped');
    expect(codeOf(await leavesBAlone(path, () => at(t.a.owner.caller, path)(e.input(t.b))))).toBe('NOT_FOUND');
  });

  // The inputs aim at real rows: B's own owner, with the same input, is not told NOT_FOUND (queries only — a mutation
  // would change B, and a `works` query would reach the worker).
  it.each(pathsOf('scoped').filter((p) => procedures[p]!._def.type === 'query' && !entry(p, 'scoped').works))(
    "%s: B's own owner reaches B's row with the same input",
    async (path) => {
      const out = await settle(at(t.b.owner.caller, path)(entry(path, 'scoped').input(t.b)));
      expect(out.ok || out.error.code !== 'NOT_FOUND', out.ok ? path : `${path}: ${out.error.message}`).toBe(true);
    },
  );
});

describe("org-wide: about the caller's own org (spec §2.1)", () => {
  it.each(pathsOf('org-wide'))('%s names nothing of B and leaves B alone', async (path) => {
    const e = entry(path, 'org-wide');
    const out = await leavesBAlone(path, () => at(t.a.owner.caller, path)(e.input?.(t.a)));
    namesNothingOf(out.ok ? out.value : out.error.message, needlesOf(t.b), path);
  });
});

describe("self: only the caller's own user and session (spec §2.1)", () => {
  it.each(pathsOf('self'))('%s answers, names nothing of B and leaves B alone', async (path) => {
    // A session of A's owner of its own: `auth.signOut` ends it and `orgs.create` moves it.
    const fresh = await signIn(t.a.owner.user.email);
    const out = await leavesBAlone(path, () => at(fresh.caller, path)(entry(path, 'self').input?.(t.a)));
    expect(out.ok, out.ok ? path : `${path}: ${out.error.message}`).toBe(true);
    namesNothingOf(out.ok ? out.value : null, needlesOf(t.b), path);
  });
});

describe("membership: B's org and people (spec §2.1)", () => {
  it.each(pathsOf('membership'))("%s refuses B's org id and user ids", async (path) => {
    const e = entry(path, 'membership');
    for (const input of e.inputs(t.b)) {
      expect(codeOf(await leavesBAlone(path, () => at(t.a.owner.caller, path)(input))), `${path} ${JSON.stringify(input)}`).toBe(e.refusal);
    }
  });
});

describe('ops: operators only (spec §2.1)', () => {
  it.each(pathsOf('ops'))('%s is FORBIDDEN to a customer', async (path) => {
    expect(codeOf(await leavesBAlone(path, () => at(t.a.owner.caller, path)(entry(path, 'ops').input?.(t.b))))).toBe('FORBIDDEN');
  });
});

describe('public: no session needed (spec §2.1)', () => {
  it.each(pathsOf('public'))('%s answers without a session and names nothing of B', async (path) => {
    const anon = createCaller({ db, session: null, setCookie: () => {}, clearCookie: () => {} });
    const out = await leavesBAlone(path, () => at(anon, path)(entry(path, 'public').input?.(t.a)));
    expect(out.ok, out.ok ? path : `${path}: ${out.error.message}`).toBe(true);
    namesNothingOf(out.ok ? out.value : null, needlesOf(t.b), path);
  });
});

describe("RF1: an own id paired with the other org's id", () => {
  it("RF1: a staff session in A asking for B's capture under A's website is NOT_FOUND", async () => {
    const op = await signedInCaller('iso-sweep-op');
    process.env.OPS_EMAILS = op.user.email;
    try {
      const inside = await enterAsStaff(op, t.a.org.id);
      const out = await leavesBAlone('jevReadings', () => inside.caller.sources.jevReadings({ sourceId: t.a.sourceId, captureIds: [t.a.captureId, t.b.captureId] }));
      expect(codeOf(out)).toBe('NOT_FOUND');
    } finally {
      process.env.OPS_EMAILS = '';
      await op.cleanup();
    }
  });

  it("RF1: A's backfill naming B's run items backfills nothing", async () => {
    const out = await leavesBAlone('backfill', () => t.a.owner.caller.crawl.backfill({ runId: t.a.runId, itemIds: t.b.itemIds }));
    expect(out.ok ? 'answered' : [out.error.code, out.error.message]).toEqual(['PRECONDITION_FAILED', 'nothing to backfill — no items are missing the requested fields']);
  });

  it("RF1: A's proof-page captures asked for at B's addresses answer nothing of B", async () => {
    const out = await leavesBAlone('proofPageCaptures', () => t.a.owner.caller.sources.proofPageCaptures({ sourceId: t.a.sourceId, urls: t.b.urls }));
    expect(out.ok).toBe(true);
    // The answer is keyed by the addresses asked for; nothing else of B may be in it.
    namesNothingOf(out.ok ? out.value : null, needlesOf(t.b).filter((n) => !t.b.urls.some((u) => u.includes(n))), 'proofPageCaptures');
  });
});
```

- [ ] **Step 3: Run the sweep**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/procedure-sweep.test.ts`
Expected: PASS — the audit found every id-taking procedure guarded. Any failure is a hole (spec §3): fix it in its router through the existing helpers (`sourceInOrg`, `runInOrg`, `captureInOrg`, `findProjectInOrg`, `loadDatasetInOrg`, or a filter on `ctx.session.org`), keep its row in the table, and re-run. A failure that is the sweep's own fault (an input that does not parse — the code is `BAD_REQUEST`; a `self` input that is refused) is fixed in the table, never by loosening an assertion. Record every hole fixed in the commit message.

- [ ] **Step 4: Write the failing test for the hole found while classifying** — `packages/api/src/isolation/projects-list-scope.test.ts`:

```ts
// `projects.list` read every organisation's websites and runs (spec 2026-10-24 tenant isolation §3): its answer was
// filtered by project, so nothing leaked, but each call certified every website in the database. It reads the
// caller's org only.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTwoOrgs, type TwoOrgs } from './two-orgs.js';

const { seen } = vi.hoisted(() => ({ seen: new Set<string>() }));
vi.mock('../verify/current-certification.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/current-certification.js')>();
  return {
    ...real,
    loadCurrentCertification: async (...args: Parameters<typeof real.loadCurrentCertification>) => {
      seen.add(args[1]);
      return real.loadCurrentCertification(...args);
    },
  };
});

process.env.CAPTURES_DIR = join(tmpdir(), 'robot-isolation-captures');
let t: TwoOrgs;
beforeAll(async () => { t = await buildTwoOrgs({ tag: 'iso-list' }); }, 120_000);
afterAll(async () => { await t?.cleanup(); });

describe('projects.list (spec 2026-10-24 tenant isolation §3)', () => {
  it("certifies the caller's websites only, and gives the caller's own last run", async () => {
    seen.clear();
    const list = await t.a.owner.caller.projects.list();
    expect([...seen]).toEqual([t.a.sourceId]);
    expect(list.map((p) => p.id)).toEqual([t.a.projectId]);
    expect(list[0]).toMatchObject({ sourceCount: 1, verifiedSourceCount: 1, lastRun: { status: 'completed' } });
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/projects-list-scope.test.ts`
Expected: FAIL — `seen` holds every website in the database (org B's among them), not only `t.a.sourceId`.

- [ ] **Step 6: Scope `projects.list`** — `packages/api/src/routers/projects.ts`, in `list`, replace the two unscoped queries (`const sourceRows = …` and `const lastRuns = …`) with:

```ts
      // The caller's org only (spec 2026-10-24 tenant isolation §3): these used to read every org's websites and
      // runs — filtered out of the answer by project, but every website in the database was certified on each call.
      const sourceRows = await ctx.db
        .select({ projectId: datasets.projectId, id: sources.id })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(eq(projects.orgId, org.id));

      const lastRuns = await ctx.db
        .selectDistinctOn([datasets.projectId], {
          projectId: datasets.projectId,
          createdAt: runs.createdAt,
          resultCount: runs.resultCount,
          // The run status dot is the app's one carried signal (spec 2026-09-21 §4):
          // without the status every project's last run renders grey, which is the
          // one thing the dot exists not to do.
          status: runs.status,
          completedAt: runs.completedAt,
        })
        .from(runs)
        .innerJoin(sources, eq(runs.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(eq(projects.orgId, org.id))
        .orderBy(datasets.projectId, desc(runs.createdAt), desc(runs.id));
```

- [ ] **Step 7: Run both, and the files they touch**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/projects-list-scope.test.ts && npx vitest run src/isolation/procedure-sweep.test.ts && npx vitest run src/routers/projects.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add packages/api/src/isolation/procedure-classes.ts packages/api/src/isolation/procedure-sweep.test.ts packages/api/src/isolation/projects-list-scope.test.ts packages/api/src/routers/projects.ts
git commit -m "test(api): every procedure classified and swept across two organisations; projects.list reads the caller's org only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The file-route sweep (`@robot/api-server` `src/isolation-routes.test.ts`) — spec §2.2, §4.2

**Files:**
- Create: `packages/api-server/src/isolation-routes.test.ts`
- Modify (only if a hole is found): `packages/api-server/src/routes/captures-gate.ts`, `packages/api-server/src/routes/export.ts`

**Interfaces:**
- Consumes: Task 1's `buildTwoOrgs`, `type TwoOrgs` via `@robot/api/isolation/two-orgs` (fields used: `owner.session.token`, `runId`, `projectId`, `sourceId`, `tileFile`, `tag`, `webhookSecret`); `createApp` (`app.ts`); the signing rule of `checkFileSignature` (HMAC-SHA256 of `<runId>.<format>.<expires>`, hex — as `export-snapshot.test.ts` computes it).
- Produces: nothing new (a test).

- [ ] **Step 1: Write the sweep** — `packages/api-server/src/isolation-routes.test.ts`:

```ts
// Tenant isolation, file routes (spec 2026-10-24 §2.2, §4.2): org B's capture tile, run files (live and snapshot) and
// project files, against the real Hono app and database — 401 with no session, 404 to org A, 400 for a traversal,
// 200 to org B (so the fixture is real); a signed link opens B's snapshot by design, and every wrong one answers
// exactly what a missing run does.
import { createHmac, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { buildTwoOrgs, type TwoOrgs } from '@robot/api/isolation/two-orgs';
import { createApp } from './app.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
/** `serveStatic`'s root in app.ts: the tiles must be written where it serves them. */
const CAPTURES_PUBLIC_DIR = join(__dirname, '..', 'public', 'captures');
const FORMATS = ['csv', 'json', 'xlsx'] as const;
const sign = (secret: string, runId: string, format: string, expires: number) => createHmac('sha256', secret).update(`${runId}.${format}.${expires}`).digest('hex');
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

describe.skipIf(!process.env.DATABASE_URL)('file routes across two organisations (spec 2026-10-24 tenant isolation §2.2)', () => {
  const app = createApp();
  let t: TwoOrgs;
  beforeAll(async () => { t = await buildTwoOrgs({ tag: 'iso-routes', capturesDir: CAPTURES_PUBLIC_DIR }); }, 120_000);
  afterAll(async () => { await t?.cleanup(); });

  const cookieOf = (f: TwoOrgs['a']) => `robot_session=${f.owner.session.token}`;
  const get = (path: string, cookie?: string) => app.fetch(new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined));
  const bFiles = (): Array<[string, string]> => [
    ['the capture tile', `/captures/${t.b.tileFile}`],
    ...FORMATS.map((f): [string, string] => [`the run's ${f}`, `/export/runs/${t.b.runId}.${f}`]),
    ...FORMATS.map((f): [string, string] => [`the run's ${f} snapshot`, `/export/runs/${t.b.runId}.${f}?snapshot=1`]),
    ...FORMATS.map((f): [string, string] => [`the project's ${f}`, `/export/projects/${t.b.projectId}.${f}`]),
  ];

  it("every file of B's: 401 with no session, 404 to org A, 200 to org B", async () => {
    for (const [what, path] of bFiles()) {
      expect((await get(path)).status, `${what}, no session`).toBe(401);
      expect((await get(path, cookieOf(t.a))).status, `${what}, org A`).toBe(404);
      expect((await get(path, cookieOf(t.b))).status, `${what}, org B`).toBe(200);
    }
  });

  it.each(['..%2f', '%2e%2e%2f', '..%5c', '%2e%2e%5c', 'x%2f'])("a traversal (%s) towards B's tile is 400, signed in or not", async (prefix) => {
    const path = `/captures/${prefix}${t.b.tileFile}`;
    expect((await get(path)).status).toBe(400);
    expect((await get(path, cookieOf(t.a))).status).toBe(400);
  });

  it("a signed link opens B's snapshot with no session — by design", async () => {
    const exp = inAnHour();
    const res = await get(`/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${sign(t.b.webhookSecret, t.b.runId, 'csv', exp)}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(`${t.b.tag}:csv`);
  });

  it('every wrong signed link answers exactly what a missing run does', async () => {
    const exp = inAnHour();
    const past = Math.floor(Date.now() / 1000) - 1;
    const good = sign(t.b.webhookSecret, t.b.runId, 'csv', exp);
    const missingRun = randomUUID();
    const missing = await get(`/export/runs/${missingRun}.csv?expires=${exp}&sig=${sign(t.b.webhookSecret, missingRun, 'csv', exp)}`);
    const expected = [missing.status, await missing.text()];
    expect(expected[0]).toBe(404);
    const cases: Array<[string, string]> = [
      ['a tampered signature', `/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`],
      ['an expired link', `/export/runs/${t.b.runId}.csv?expires=${past}&sig=${sign(t.b.webhookSecret, t.b.runId, 'csv', past)}`],
      ["another run's signature", `/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${sign(t.b.webhookSecret, t.a.runId, 'csv', exp)}`],
      ["org A's secret", `/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${sign(t.a.webhookSecret, t.b.runId, 'csv', exp)}`],
      ['the wrong format', `/export/runs/${t.b.runId}.json?expires=${exp}&sig=${good}`],
    ];
    for (const [why, path] of cases) {
      const res = await get(path);
      expect([res.status, await res.text()], why).toEqual(expected);
    }
  });

  it('a link signed before the secret was rotated answers the same 404', async () => {
    const exp = inAnHour();
    const before = sign(t.b.webhookSecret, t.b.runId, 'csv', exp);
    await db.update(sources).set({ webhookSecret: 'ef'.repeat(32) }).where(eq(sources.id, t.b.sourceId));
    try {
      expect((await get(`/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${before}`)).status).toBe(404);
    } finally {
      await db.update(sources).set({ webhookSecret: t.b.webhookSecret }).where(eq(sources.id, t.b.sourceId));
    }
  });
});
```

(A literal `../` or `\` in a request URL is normalised away by the URL parser before Hono sees it — `\` becomes `/` and `..` segments are resolved — so only the percent-encoded forms reach the gate; those are the ones a client can send.)

- [ ] **Step 2: Run it**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api-server && npx vitest run src/isolation-routes.test.ts`
Expected: PASS (the gates in `captures-gate.ts` and `routes/export.ts` already check the org). Any failure is a hole (spec §3): fix the route (an org check before any read; the same 404 for "not yours" and "not there"), add the case to `export-route.test.ts` or `app.test.ts` with its own assertion, and re-run.

- [ ] **Step 3: Type-check, and leave nothing behind**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api-server && npx tsc --noEmit && ls public/captures | grep -c "^iso-" ; git -C /c/Users/Marko/Documents/projects/robot-platform-tenant status --short`
Expected: no type errors; `0` files named `iso-*` left in `public/captures`; `git status` shows only the new test file (tiles and sidecars there are gitignored anyway).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add packages/api-server/src/isolation-routes.test.ts
git commit -m "test(api-server): every file route swept across two organisations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: No money in a customer answer (`@robot/api` `src/isolation/money.ts`, six procedures, the money sweep; `@robot/app` types) — spec §2.3, §4.3

**Files:**
- Create: `packages/api/src/isolation/money.ts`, `packages/api/src/isolation/money.test.ts`, `packages/api/src/isolation/money-sweep.test.ts`
- Modify: `packages/api/src/routers/runs.ts` (`listByOrg`, ~lines 197–218); `packages/api/src/routers/sources.ts` (`verifyEstimate` return ~lines 1046–1060; `verificationStatus` return `costUsd: row.costUsd` ~line 1194); `packages/api/src/routers/crawl.ts` (`backfillPreview` return ~line 451); `packages/api/src/routers/usage.ts` (the `rows` / return block ~lines 68–84); `packages/api/src/routers/orgs.ts` (`staffActivity`, ~lines 101–104)
- Modify (existing tests that read money as a customer — they now read it as an operator): `packages/api/src/routers/org-screens.test.ts`, `packages/api/src/routers/crawl-backfill-preview.test.ts`, `packages/api/src/routers/sources-verify.test.ts` (the two `sources.verifyEstimate` describes, ~lines 393 and 435), `packages/api/src/routers/staff-activity.test.ts`
- Modify (app types): `packages/app/src/lib/org-runs-view.ts`, `packages/app/src/lib/site/backfill-preview.ts`, `packages/app/src/lib/staff-view.ts`, `packages/app/src/lib/usage-view.ts`
- Test (app): `packages/app/src/lib/usage-view.test.ts`, `packages/app/src/lib/staff-view.test.ts`, `packages/app/src/lib/site/backfill-preview.test.ts`, `packages/app/src/lib/org-runs-view.test.ts` (one new case each)

**Interfaces:**
- Consumes: Task 1's fixture (`buildTwoOrgs`, `FIXTURE_COST`, `type TwoOrgs`); Task 2's `PROCEDURE_CLASSES`, `type ProcedureEntry`; `signedInCaller`, `enterAsStaff`, `type SignedIn`; `createProjectWithSource`.
- Produces (`packages/api/src/isolation/money.ts`):
  - `viewerSeesMoney(ctx: { isOperator?: boolean; session: { staff: unknown } | null }): boolean`
  - `moneyFields<T extends Record<string, unknown>>(sees: boolean, fields: T): Partial<T>` — `fields` for staff, `{}` for a customer (the keys are absent).
  - Answer shapes: `runs.listByOrg` rows `costUsd?: number`; `sources.verificationStatus` `costUsd?: string`; `sources.verifyEstimate` `perFieldUsd?: number`, `upperBoundUsd?: number`; `crawl.backfillPreview` `estCostUsd?: number`; `usage.byProject` `projects[].spendUsd?: number`, `total.spendUsd?: number`; `orgs.staffActivity` `entries[].run: { id: string; costUsd?: number } | null` (type `CustomerStaffEntry`, exported from `routers/orgs.ts`).
  - App: `OrgRunRow.costUsd?: number`; `previewSummary(p: { pages: number; estCostUsd?: number; certified?: boolean }, showMoney: boolean)`; `StaffEntryView.run: { id: string; costUsd?: number } | null`; `UsageRow.spendUsd?: number`; `usageHeadline(total: { spendUsd?: number; pagesCaptured: number }, …)`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/isolation/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moneyFields, viewerSeesMoney } from './money.js';

describe('who receives money (spec 2026-10-24 tenant isolation §2.3)', () => {
  it("is the app's showsMoney rule: an operator, or a staff session", () => {
    expect(viewerSeesMoney({ isOperator: false, session: { staff: null } })).toBe(false);
    expect(viewerSeesMoney({ isOperator: true, session: { staff: null } })).toBe(true);
    expect(viewerSeesMoney({ isOperator: false, session: { staff: { orgId: 'o', enteredAt: new Date() } } })).toBe(true);
    expect(viewerSeesMoney({ session: null })).toBe(false);
  });

  it('a customer gets the keys left out, not zeroed', () => {
    expect(moneyFields(false, { costUsd: 1.5 })).toEqual({});
    expect('costUsd' in moneyFields(false, { costUsd: 1.5 })).toBe(false);
    expect(moneyFields(true, { costUsd: 0 })).toEqual({ costUsd: 0 });
  });
});
```

`packages/api/src/isolation/money-sweep.test.ts`:

```ts
// No money in a customer answer (spec 2026-10-24 tenant isolation §2.3, §4.3): every scoped, org-wide and self query,
// called by a plain customer of org A on org A's own fixture (a run with a cost, a verification with a cost), carries
// no amount; the same calls by staff in staff mode still do. No call reaches the worker.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, captures, extractions, runs } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { enterAsStaff, signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { PROCEDURE_CLASSES } from './procedure-classes.js';
import { buildTwoOrgs, type TwoOrgs } from './two-orgs.js';

vi.mock('../jobs/enqueue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/enqueue.js')>()),
  runAndWait: async () => { throw new Error('money sweep: a call reached the worker'); },
}));
vi.mock('../jobs/queue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/queue.js')>()),
  awaitJob: async () => { throw new Error('money sweep: a call waited on a job'); },
}));

process.env.CAPTURES_DIR = join(tmpdir(), 'robot-isolation-captures');

const MONEY_KEY = /usd|cost|spend|price(?!s?$)/i;
/** Scraped or customer-typed data, never searched: a customer's own "price" field is theirs, not our money. */
const CUSTOMER_DATA = new Set(['data', 'values', 'rows', 'fields', 'expected', 'defaults', 'listingValues']);

/** Every path in `v` whose key reads as money and whose value is an amount (a number or a numeric string). */
function moneyPaths(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyPaths(x, `${path}[${i}]`));
  if (v === null || typeof v !== 'object' || v instanceof Date) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
    if (CUSTOMER_DATA.has(k)) return [];
    const here = path ? `${path}.${k}` : k;
    const amount = typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)));
    return [...(MONEY_KEY.test(k) && amount ? [here] : []), ...moneyPaths(x, here)];
  });
}

/** What staff must still read, per procedure (spec §2.3's table, on this fixture: one project, one run, one staff action). */
const STAFF_MONEY: Record<string, string[]> = {
  'runs.listByOrg': ['[0].costUsd'],
  'sources.verificationStatus': ['costUsd'],
  'sources.verifyEstimate': ['perFieldUsd', 'upperBoundUsd'],
  'crawl.backfillPreview': ['estCostUsd'],
  'usage.byProject': ['projects[0].spendUsd', 'total.spendUsd'],
  'orgs.staffActivity': ['entries[0].run.costUsd'],
};

type Procedures = Record<string, { _def: { type: string } }>;
const procedures = (appRouter as unknown as { _def: { procedures: Procedures } })._def.procedures;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (caller: unknown, path: string) => path.split('.').reduce<any>((node, key) => node[key], caller) as (input?: unknown) => Promise<unknown>;
const swept = Object.entries(PROCEDURE_CLASSES)
  .filter(([p, e]) => (e.class === 'scoped' || e.class === 'org-wide' || e.class === 'self') && procedures[p]!._def.type === 'query' && !(e.class === 'scoped' && e.works))
  .map(([p]) => p);

let t: TwoOrgs;
let op: SignedIn;
let staff: SignedIn;
const savedOps = process.env.OPS_EMAILS;
const inputFor = (path: string) => {
  const e = PROCEDURE_CLASSES[path]!;
  return 'input' in e && e.input ? e.input(t.a) : undefined;
};

beforeAll(async () => {
  t = await buildTwoOrgs({ tag: 'iso-money' });
  op = await signedInCaller('iso-money-op');
  process.env.OPS_EMAILS = op.user.email; // the operator only: org A's owner is a plain customer
  staff = await enterAsStaff(op, t.a.org.id);
}, 120_000);
afterAll(async () => {
  if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps;
  await op?.cleanup();
  await t?.cleanup();
});

describe('a customer receives no amount (spec §2.3)', () => {
  it('the sweep calls every money-bearing procedure the spec names', () => {
    expect(swept).toEqual(expect.arrayContaining(Object.keys(STAFF_MONEY)));
  });

  it.each(swept)('%s carries no amount to a customer of the org', async (path) => {
    expect(moneyPaths(await at(t.a.owner.caller, path)(inputFor(path)))).toEqual([]);
  });
});

describe('staff in staff mode still read the amounts (spec §2.3)', () => {
  it.each(Object.entries(STAFF_MONEY))('%s gives staff %j', async (path, paths) => {
    expect(moneyPaths(await at(staff.caller, path)(inputFor(path)))).toEqual(expect.arrayContaining(paths));
  });
});

describe('RF5: a customer still reads their own money-named data', () => {
  it('RF5: a field called "Unit cost USD" keeps its values in the run rows and the expected values', async () => {
    const me = await signedInCaller('iso-money-rf5');
    try {
      const urls = [1, 2, 3].map((n) => `https://test-iso-money-rf5.example.com/p/${n}`);
      const site = await createProjectWithSource(me.caller, {
        tag: 'iso-money-rf5', urls,
        fields: [{ name: 'Unit cost USD', type: 'money' }],
        expected: { 'Unit cost USD': Object.fromEntries(urls.map((u) => [u, '4.20'])) },
      });
      const key = site.keys['Unit cost USD']!;
      const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'completed', completedAt: new Date(), resultCount: 1, costUsd: '0.5000' }).returning({ id: runs.id });
      const [cap] = await db.insert(captures).values({ sourceId: site.sourceId, runId: run!.id, url: urls[0]! }).returning({ id: captures.id });
      await db.insert(extractions).values({ sourceId: site.sourceId, captureId: cap!.id, runId: run!.id, data: [{ [key]: '4.20' }], rowCount: 1 });

      const details = await me.caller.runs.getWithDetails({ id: run!.id });
      expect((details!.extraction!.data as Array<Record<string, unknown>>)[0]).toMatchObject({ [key]: '4.20' });
      const got = await me.caller.sources.get({ projectSlug: site.projectSlug, sourceSlug: site.sourceSlug });
      expect((got.verificationSet as { expected: Record<string, Record<string, string>> }).expected[key]![urls[0]!]).toBe('4.20');
      // …while our amount for the same run is gone.
      expect((await me.caller.runs.listByOrg())[0]).not.toHaveProperty('costUsd');
    } finally {
      await me.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/money.test.ts src/isolation/money-sweep.test.ts`
Expected: FAIL — `money.ts` does not exist; once it does, the customer sweep lists `[0].costUsd`, `costUsd`, `perFieldUsd`, `upperBoundUsd`, `estCostUsd`, `projects[0].spendUsd`, `total.spendUsd`, `entries[0].run.costUsd` for the six procedures.

- [ ] **Step 3: The helper** — `packages/api/src/isolation/money.ts`:

```ts
// packages/api/src/isolation/money.ts
// Who receives money in an answer (spec 2026-10-24 tenant isolation §2.3): the app's `showsMoney` rule, on the
// server — an operator, or a staff session inside the customer's org. Marko, 2026-10-17: a customer sees no money
// anywhere, and an answer the browser receives counts.

export function viewerSeesMoney(ctx: { isOperator?: boolean; session: { staff: unknown } | null }): boolean {
  return !!ctx.isOperator || !!ctx.session?.staff;
}

/** `fields` for staff; for a customer nothing — the keys are left out, never zeroed (superjson would carry an
 *  `undefined` key's name, and a 0 would read as "free"). */
export function moneyFields<T extends Record<string, unknown>>(sees: boolean, fields: T): Partial<T> {
  return sees ? fields : {};
}
```

- [ ] **Step 4: The six procedures**

`packages/api/src/routers/runs.ts` — import `import { moneyFields, viewerSeesMoney } from '../isolation/money.js';` and replace the `listByOrg` return:

```ts
    // Spec 2026-10-24 tenant isolation §2.3: a run's cost is staff-only.
    const sees = viewerSeesMoney(ctx);
    return rows.map(({ projectName, projectSlug, websiteName, websiteSlug, costUsd, ...run }) => ({
      ...run,
      ...moneyFields(sees, { costUsd: Number(costUsd) }),
      project: { name: projectName, slug: projectSlug },
      website: { name: websiteName, slug: websiteSlug },
    }));
```

`packages/api/src/routers/sources.ts` — import the same two names. In `verifyEstimate`, replace the return block from `const perFieldUsd = …` to its `};` with:

```ts
      const perFieldUsd = estAiCostPerFieldUsd(urls.length);
      return {
        fields,
        aiFields,
        // Spec 2026-10-24 tenant isolation §2.3: the prices are staff-only; a customer still gets the counts and `aiAvailable`.
        ...moneyFields(viewerSeesMoney(ctx), { perFieldUsd, upperBoundUsd: aiAvailable ? Math.round(aiFields * perFieldUsd * 100) / 100 : 0 }),
        aiAvailable,
        capturesFresh,
        // The dashboard must not hardcode the stall window (C1): it decides
        // whether an in-flight verification is genuinely running or is a
        // crash leftover using the SAME threshold `sources.verify` applies
        // server-side when it closes a stalled row out and starts a fresh one.
        stallMs: VERIFY_STALL_MS,
      };
```

In `verificationStatus`, replace the line `costUsd: row.costUsd,` with:

```ts
        // Spec 2026-10-24 tenant isolation §2.3: staff-only.
        ...moneyFields(viewerSeesMoney(ctx), { costUsd: row.costUsd }),
```

`packages/api/src/routers/crawl.ts` — import the two names; in `backfillPreview`, replace the `estCostUsd: …` line with:

```ts
        // A certified website runs certified paths only; it never reaches the AI tiers the "up to" figure prices.
        // Spec 2026-10-24 tenant isolation §2.3: the figure is staff-only.
        ...moneyFields(viewerSeesMoney(ctx), { estCostUsd: certified ? 0 : Number((items.length * EST_AI_COST_PER_PAGE_USD).toFixed(2)) }),
```

`packages/api/src/routers/usage.ts` — import the two names; replace everything from `const rows = list` to the end of the returned object with:

```ts
      const sees = viewerSeesMoney(ctx);
      const priced = list.map((p) => ({ ...p, spendUsd: round(spend.get(p.id) ?? 0), pagesCaptured: captured.get(p.id) ?? 0 }));
      // Staff: by spend, then name. A customer gets no spend (spec 2026-10-24 tenant isolation §2.3), and no order by
      // it either — that would rank it: by pages captured, then name.
      priced.sort(sees
        ? (a, b) => b.spendUsd - a.spendUsd || a.name.localeCompare(b.name)
        : (a, b) => b.pagesCaptured - a.pagesCaptured || a.name.localeCompare(b.name));
      return {
        month: input.month,
        projects: priced.map(({ spendUsd, ...p }) => ({ ...p, ...moneyFields(sees, { spendUsd }) })),
        total: {
          ...moneyFields(sees, { spendUsd: round(priced.reduce((s, r) => s + r.spendUsd, 0)) }),
          pagesCaptured: priced.reduce((s, r) => s + r.pagesCaptured, 0),
        },
      };
```

`packages/api/src/routers/orgs.ts` — import `viewerSeesMoney` and `type StaffEntry` (`import { listStaffActivity, type StaffEntry } from '../auth/staff-activity.js';`); above `export const orgsRouter`:

```ts
/** A staff-activity entry as a customer reads it (spec 2026-10-24 tenant isolation §2.3): which run, never its cost. */
export type CustomerStaffEntry = Omit<StaffEntry, 'run'> & { run: { id: string; costUsd?: number } | null };
```

and replace `staffActivity`:

```ts
  /** Robot staff activity in this organisation (spec 2026-10-07 §2.4) — every member may read it. */
  staffActivity: protectedProcedure
    .input(z.object({ page: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }): Promise<{ entries: CustomerStaffEntry[]; total: number }> => {
      const page = await listStaffActivity(ctx.db, { orgId: ctx.session.org.id }, { offset: input.page * 20, limit: 20 });
      if (viewerSeesMoney(ctx)) return page;
      return { ...page, entries: page.entries.map((e) => ({ ...e, run: e.run ? { id: e.run.id } : null })) };
    }),
```

- [ ] **Step 5: Run the new tests to see them pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/money.test.ts && npx vitest run src/isolation/money-sweep.test.ts`
Expected: PASS. A customer path the sweep still lists that is not one of the six is "any other found by the sweep" (spec §2.3): leave its key out the same way (`moneyFields(viewerSeesMoney(ctx), …)`), add it to `STAFF_MONEY`, and add its app type to Step 7. A listed path that is a customer's own data (not our amount) is a fixture or exclusion question — say so in the task report; never widen `CUSTOMER_DATA` without the reviewer agreeing.

- [ ] **Step 6: The existing tests read money as an operator now**

`packages/api/src/routers/org-screens.test.ts` — after the `dropIdentity` line, add:

```ts
/** Money is staff-only (spec 2026-10-24 tenant isolation §2.3): the amounts below are read as an operator. */
async function asOperator<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.OPS_EMAILS;
  process.env.OPS_EMAILS = email;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved; }
}
```

In `runs.listByOrg`'s first test replace the `expect(got[1]).toMatchObject({ resultCount: 3, costUsd: 0.02, … })` line with:

```ts
      expect(got[1]).toMatchObject({ resultCount: 3, project: { name: 'Prices', slug: p.slug }, website: { name: 'Shop', slug: w.sourceSlug } });
      expect(got[1]).not.toHaveProperty('costUsd');
      expect((await asOperator(a.user.email, () => a!.caller.runs.listByOrg()))[1]).toMatchObject({ costUsd: 0.02 });
```

In `usage.byProject`'s test replace everything from `const sep = await a.caller.usage.byProject({ month: '2026-09' });` to `expect(empty.total).toEqual({ spendUsd: 0, pagesCaptured: 0 });` with:

```ts
      // A customer: pages only, ordered by pages then name, and no spend anywhere.
      const sep = await a.caller.usage.byProject({ month: '2026-09' });
      expect(sep.month).toBe('2026-09');
      expect(sep.projects.map((r) => [r.name, r.pagesCaptured])).toEqual([['Busy', 2], ['Quiet', 0]]);
      expect(sep.projects.some((r) => 'spendUsd' in r)).toBe(false);
      expect(sep.total).toEqual({ pagesCaptured: 2 });
      expect((await a.caller.usage.byProject({ month: '2026-07' })).projects.map((r) => r.name)).toEqual(['Busy', 'Quiet']);

      // Staff: the spend, as before.
      await asOperator(a.user.email, async () => {
        const sepStaff = await a!.caller.usage.byProject({ month: '2026-09' });
        expect(sepStaff.projects.map((r) => [r.name, r.spendUsd, r.pagesCaptured])).toEqual([['Busy', 0.05, 2], ['Quiet', 0, 0]]);
        expect(sepStaff.total).toEqual({ spendUsd: 0.05, pagesCaptured: 2 });
        const aug = await a!.caller.usage.byProject({ month: '2026-08' });
        expect(aug.total).toEqual({ spendUsd: 3, pagesCaptured: 1 });
        const empty = await a!.caller.usage.byProject({ month: '2026-07' });
        expect(empty.projects.map((r) => r.spendUsd)).toEqual([0, 0]);
        expect(empty.total).toEqual({ spendUsd: 0, pagesCaptured: 0 });
      });
```

`packages/api/src/routers/crawl-backfill-preview.test.ts` — after `afterAll(async () => { await me.cleanup(); });` add:

```ts
// `estCostUsd` is staff-only (spec 2026-10-24 tenant isolation §2.3): this file reads it as an operator. A customer's
// preview has none (isolation/money-sweep.test.ts).
const savedOps = process.env.OPS_EMAILS;
process.env.OPS_EMAILS = me.user.email;
afterAll(() => { if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps; });
```

`packages/api/src/routers/sources-verify.test.ts` — add `beforeAll` to the vitest import; as the first lines inside `describe('sources.verifyEstimate', () => {` and inside `describe('sources.verifyEstimate re-verify pricing', () => {`:

```ts
  // The prices are staff-only (spec 2026-10-24 tenant isolation §2.3): read here as an operator.
  const savedOps = process.env.OPS_EMAILS;
  beforeAll(() => { process.env.OPS_EMAILS = me.user.email; });
  afterAll(() => { if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps; });
```

`packages/api/src/routers/staff-activity.test.ts` — import `sessions` from `@robot/db` and `enterAsStaff` from `../test-helpers/identity.js`. Replace the first test's title and its third `expect` with:

```ts
  it('the customer sees their own entries, newest first, 20 per page, with the run and no cost', async () => {
```

```ts
    expect(p0.entries[0]).toMatchObject({ summary: 'Ran an extraction on Nike', run: { id: runId }, actor: { email: staff.user.email } });
    expect(p0.entries[0]!.run).not.toHaveProperty('costUsd');
```

and replace the body of `it('cost is read at view time, not stored', …)` with:

```ts
    await db.update(runs).set({ costUsd: '2.5000' }).where(eq(runs.id, runId));
    // Staff in staff mode read the cost (spec 2026-10-24 tenant isolation §2.3), as it is now.
    const inside = await enterAsStaff(staff, customer.org.id);
    try {
      const p0 = await inside.caller.orgs.staffActivity({ page: 0 });
      expect(p0.entries[0]!.run!.costUsd).toBe(2.5);
    } finally {
      await db.update(sessions).set({ staffOrgId: null, staffEnteredAt: null }).where(eq(sessions.token, staff.session.token));
    }
```

Run, one file at a time: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && for f in org-screens crawl-backfill-preview sources-verify staff-activity; do npx vitest run src/routers/$f.test.ts || break; done && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: The app's types** (the screens already gate every amount on `showsMoney`; only the types change, and the `?? 0`s keep the staff labels)

`packages/app/src/lib/org-runs-view.ts`:

```ts
/** One row of `runs.listByOrg`: a website's run row plus where it belongs. `costUsd` reaches staff only (spec 2026-10-24 tenant isolation §2.3). */
export type OrgRunRow = RunRow & {
  costUsd?: number;
  project: { name: string; slug: string };
  website: { name: string; slug: string };
};
```

`packages/app/src/lib/site/backfill-preview.ts` — `previewSummary`:

```ts
export function previewSummary(p: { pages: number; estCostUsd?: number; certified?: boolean }, showMoney: boolean): string {
  const pages = p.pages === 1 ? 'page' : 'pages';
  if (!showMoney) return `${p.pages} ${pages}`; // spec 2026-10-17 §8a
  const cost = p.certified ? 'free' : `up to ~$${(p.estCostUsd ?? 0).toFixed(2)} if no cache answers`;
  return `${p.pages} ${pages} — ${cost}`;
}
```

`packages/app/src/lib/staff-view.ts` — in `StaffEntryView`, `run: { id: string; costUsd?: number } | null;` (comment above it: `/** The run's cost reaches staff only (spec 2026-10-24 tenant isolation §2.3). */`), and in `formatStaffEntry`:

```ts
    cost: showMoney && e.run && (e.run.costUsd ?? 0) > 0 ? `$${e.run.costUsd!.toFixed(2)}` : null,
```

`packages/app/src/lib/usage-view.ts`:

```ts
/** `spendUsd` reaches staff only (spec 2026-10-24 tenant isolation §2.3). */
export type UsageRow = { id: string; name: string; slug: string; spendUsd?: number; pagesCaptured: number };
/** `spendLabel` is null for a customer (spec 2026-10-17 §8a): spend is staff-only. */
export type UsageRowView = UsageRow & { spendLabel: string | null; pagesLabel: string };

/** Labels only; the API orders the rows (staff: by spend, then name; a customer: by pages captured, then name). Pure. */
export function usageView(rows: readonly UsageRow[], showMoney: boolean): UsageRowView[] {
  return rows.map((r) => ({ ...r, spendLabel: showMoney ? usdLabel(r.spendUsd ?? 0) : null, pagesLabel: pagesLabel(r.pagesCaptured) }));
}

/** The usage headline (spec 2026-10-17 §8a): spend for staff; pages captured for a customer. */
export function usageHeadline(total: { spendUsd?: number; pagesCaptured: number }, month: string, showMoney: boolean): { label: string; figure: string; sub: string } {
  return showMoney
    ? { label: `Spend in ${monthLabel(month)}`, figure: usdLabel(total.spendUsd ?? 0), sub: `${pagesLabel(total.pagesCaptured)} captured` }
    : { label: `Pages captured in ${monthLabel(month)}`, figure: pagesLabel(total.pagesCaptured), sub: '' };
}
```

(`usage-total.tsx` keeps `spendUsd: number`; its one caller already passes `usage.data?.total.spendUsd ?? 0`. `verify-button.ts`'s caller already passes `estimate?.upperBoundUsd ?? 0`.)

App tests — one case each, appended inside the existing describes:

`packages/app/src/lib/usage-view.test.ts` (inside `describe('usage without money for a customer (spec 2026-10-17 §8a)', …)`):

```ts
  it('a customer row and total arrive with no spend at all (spec 2026-10-24 tenant isolation §2.3)', () => {
    expect(usageView([{ id: 'p', name: 'P', slug: 'p', pagesCaptured: 3 }], false)).toEqual([{ id: 'p', name: 'P', slug: 'p', pagesCaptured: 3, spendLabel: null, pagesLabel: '3 pages' }]);
    expect(usageHeadline({ pagesCaptured: 3 }, '2026-10', false)).toEqual({ label: 'Pages captured in October 2026', figure: '3 pages', sub: '' });
  });
```

`packages/app/src/lib/staff-view.test.ts` (inside `describe('staff-view (spec 2026-10-07 §2.2-2.3)', …)`, using that describe's `base` and `now`):

```ts
  it('a customer entry carries the run without its cost (spec 2026-10-24 tenant isolation §2.3)', () => {
    expect(formatStaffEntry({ ...base, run: { id: 'r' } }, now, false).cost).toBeNull();
    expect(formatStaffEntry({ ...base, run: { id: 'r' } }, now, true).cost).toBeNull();
  });
```

`packages/app/src/lib/site/backfill-preview.test.ts` (inside `describe('previewSummary', …)`):

```ts
  it('a customer preview arrives with no figure (spec 2026-10-24 tenant isolation §2.3)', () => {
    expect(previewSummary({ pages: 2 }, false)).toBe('2 pages');
  });
```

`packages/app/src/lib/org-runs-view.test.ts` (inside its first `describe`; build the row from that file's existing row helper or literal, without `costUsd`):

```ts
  it('a customer row with no cost reads as any other (spec 2026-10-24 tenant isolation §2.3)', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const row = { id: 'r1', status: 'completed', inputLabel: null, startedAt: now, completedAt: now, resultCount: 3, errorMessage: null, createdAt: now, project: { name: 'P', slug: 'p' }, website: { name: 'W', slug: 'w' } };
    expect(orgRunsView([row], now)[0]).toMatchObject({ id: 'r1', projectSlug: 'p', websiteSlug: 'w' });
  });
```

(If `RunRow` in `runs-view.ts` names its fields differently, copy the shape the file's existing cases use, minus `costUsd`.)

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/app && npx vitest run src/lib/usage-view.test.ts src/lib/staff-view.test.ts src/lib/site/backfill-preview.test.ts src/lib/org-runs-view.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors (the routes `usage.tsx`, `runs.tsx`, `backfill-panel.tsx`, `staff-activity-list.tsx` and `sites/$site/index.tsx` compile against the optional fields).

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add packages/api/src/isolation/money.ts packages/api/src/isolation/money.test.ts packages/api/src/isolation/money-sweep.test.ts packages/api/src/routers/runs.ts packages/api/src/routers/sources.ts packages/api/src/routers/crawl.ts packages/api/src/routers/usage.ts packages/api/src/routers/orgs.ts packages/api/src/routers/org-screens.test.ts packages/api/src/routers/crawl-backfill-preview.test.ts packages/api/src/routers/sources-verify.test.ts packages/api/src/routers/staff-activity.test.ts packages/app/src/lib/org-runs-view.ts packages/app/src/lib/site/backfill-preview.ts packages/app/src/lib/staff-view.ts packages/app/src/lib/usage-view.ts packages/app/src/lib/usage-view.test.ts packages/app/src/lib/staff-view.test.ts packages/app/src/lib/site/backfill-preview.test.ts packages/app/src/lib/org-runs-view.test.ts
git commit -m "fix(api): no money in a customer answer — costs, spend and estimates reach staff only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rate limits (`@robot/api` `src/isolation/rate-limit.ts` + middleware; `@robot/api-server` client address, `TRUST_PROXY`) — spec §2.4, §4.4

**Files:**
- Create: `packages/api/src/isolation/rate-limit.ts`, `packages/api/src/isolation/rate-limit.test.ts`, `packages/api-server/src/client-ip.ts`, `packages/api-server/src/client-ip.test.ts`
- Modify: `packages/api/src/trpc.ts` (`Context`, `publicProcedure`); `packages/api/package.json` (`exports`: `"./isolation/rate-limit": "./src/isolation/rate-limit.ts"`); `packages/api-server/src/app.ts` (`createContext`); `packages/api-server/src/app.test.ts` (one new describe)
- Modify (switch off in tests): `packages/api/vitest.config.ts`, `packages/api-server/vitest.config.ts`, `packages/worker/vitest.config.ts`, `packages/app/vitest.config.ts`

**Interfaces:**
- Consumes: Task 2's `PROCEDURE_CLASSES` (test only); `appRouter`, `createCallerFactory`, `type SessionInfo` (`trpc.ts`).
- Produces (`packages/api/src/isolation/rate-limit.ts`, also `@robot/api/isolation/rate-limit`):
  - `RATE_LIMITED_MESSAGE = 'Too many requests. Wait a minute and try again.'`; `WINDOW_MS = 60_000`
  - `type RateLimits = { signInEmail: number; signInIp: number; heavy: number; network: number; session: number }`; `DEFAULT_LIMITS: RateLimits = { signInEmail: 10, signInIp: 30, heavy: 30, network: 60, session: 600 }`
  - `HEAVY_PROCEDURES`, `NETWORK_PROCEDURES` (readonly string tuples, spec §2.4's lists); `type RateGroup = 'sign-in' | 'heavy' | 'network' | 'session'`; `groupOf(path: string): RateGroup`
  - `type RateKey = { key: string; limit: number }`; `type RateCaller = { session: { token: string; user: { id: string }; org: { id: string }; staff: unknown } | null; clientIp?: string }`; `rateKeys(path: string, who: RateCaller, rawInput: unknown, limits?: RateLimits): RateKey[]`
  - `class RateLimiter { constructor(opts?: { limits?: RateLimits; windowMs?: number; now?: () => number }); readonly limits: RateLimits; take(keys: RateKey[]): boolean; prune(): void; readonly size: number }`
  - `useRateLimiter(next: RateLimiter): RateLimiter` (swaps the process's limiter, returns the old one — tests only); `rateLimitsOn(env?: Record<string, string | undefined>): boolean`; `enforceRateLimit(path: string, who: RateCaller, getRawInput: () => Promise<unknown>): Promise<void>` (throws `TRPCError` `TOO_MANY_REQUESTS` with `RATE_LIMITED_MESSAGE`)
  - `Context` gains `clientIp?: string`.
  - `packages/api-server/src/client-ip.ts`: `clientIpOf(c: import('hono').Context, env?: Record<string, string | undefined>): string`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/isolation/rate-limit.test.ts`:

```ts
// Rate limits (spec 2026-10-24 tenant isolation §2.4, §4.4): a fixed-window counter per process, by group. Every
// procedure test file runs with RATE_LIMITS=off (vitest.config.ts); this one turns it on, with its own limiter.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory, type SessionInfo } from '../trpc.js';
import { PROCEDURE_CLASSES } from './procedure-classes.js';
import {
  DEFAULT_LIMITS, HEAVY_PROCEDURES, NETWORK_PROCEDURES, RATE_LIMITED_MESSAGE, RateLimiter, groupOf, rateKeys, rateLimitsOn, useRateLimiter,
  type RateLimits,
} from './rate-limit.js';

const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
const createCaller = createCallerFactory(appRouter);

/** A session that needs no rows: its org and user ids name nothing, so every scoped call is NOT_FOUND. */
function sessionIn(orgId: string, o: { staff?: boolean } = {}): SessionInfo {
  return {
    token: randomUUID(),
    user: { id: randomUUID(), email: `rl-${randomUUID()}@example.com`, name: 'RL', avatarColour: '#3ddc84', theme: 'dark' },
    org: { id: orgId, slug: 'rl', name: 'RL', personal: true },
    role: 'owner',
    staff: o.staff ? { orgId, enteredAt: new Date() } : null,
    staffExpired: null,
  };
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'answered'; } catch (e) { return (e as { code: string }).code; }
}

describe('the counter (spec §2.4)', () => {
  it('counts per key within a window, opens again when it ends, and prunes ended windows', () => {
    let now = 1_000_000;
    const l = new RateLimiter({ windowMs: 60_000, now: () => now });
    const k = (key: string, limit = 2) => [{ key, limit }];
    expect([l.take(k('a')), l.take(k('a')), l.take(k('a'))]).toEqual([true, true, false]);
    expect(l.take(k('b'))).toBe(true);
    now += 59_999;
    expect(l.take(k('a'))).toBe(false);
    now += 1;
    expect(l.take(k('a'))).toBe(true);
    now += 60_000;
    l.prune();
    expect(l.size).toBe(0);
  });

  it('is all or nothing across keys: a refused call counts against none of them', () => {
    const l = new RateLimiter();
    expect(l.take([{ key: 'x', limit: 1 }])).toBe(true);
    expect(l.take([{ key: 'y', limit: 1 }, { key: 'x', limit: 1 }])).toBe(false);
    expect(l.take([{ key: 'y', limit: 1 }])).toBe(true);
  });

  it('prunes by itself once a window has passed', () => {
    let now = 0;
    const l = new RateLimiter({ windowMs: 1000, now: () => now });
    for (let i = 0; i < 50; i++) l.take([{ key: `k${i}`, limit: 1 }]);
    expect(l.size).toBe(50);
    now = 1000;
    l.take([{ key: 'fresh', limit: 1 }]);
    expect(l.size).toBe(1);
  });
});

describe('groups and keys (spec §2.4)', () => {
  it('the heavy and network lists are real procedures, and the stateless ones are network', () => {
    for (const p of [...HEAVY_PROCEDURES, ...NETWORK_PROCEDURES]) expect(procedures[p], p).toBeDefined();
    for (const [p, e] of Object.entries(PROCEDURE_CLASSES)) if (e.class === 'stateless') expect(groupOf(p), p).toBe('network');
    expect(groupOf('auth.signIn')).toBe('sign-in');
    expect(groupOf('sources.verify')).toBe('heavy');
    expect(groupOf('sources.variantList')).toBe('network');
    expect(groupOf('projects.list')).toBe('session');
  });

  it('each group keys and limits as the spec says', () => {
    const s = sessionIn('org-1');
    expect(rateKeys('auth.signIn', { session: null, clientIp: '1.2.3.4' }, { email: 'bob@example.com' })).toEqual([
      { key: 'sign-in:email:bob@example.com', limit: 10 }, { key: 'sign-in:ip:1.2.3.4', limit: 30 },
    ]);
    expect(rateKeys('sources.verify', { session: s }, undefined)).toEqual([{ key: 'heavy:org:org-1', limit: 30 }]);
    expect(rateKeys('sources.reachability', { session: s }, undefined)).toEqual([{ key: 'network:org:org-1', limit: 60 }]);
    expect(rateKeys('projects.list', { session: s }, undefined)).toEqual([{ key: `session:${s.token}`, limit: 600 }]);
    expect(rateKeys('datasets.catalogue', { session: null, clientIp: '1.2.3.4' }, undefined)).toEqual([{ key: 'session:ip:1.2.3.4', limit: 600 }]);
    expect(rateKeys('auth.signIn', { session: null }, 'not an object')).toEqual([{ key: 'sign-in:ip:unknown', limit: 30 }]);
  });

  it('RF3: case and spaces do not make a new email', () => {
    const [a] = rateKeys('auth.signIn', { session: null }, { email: ' Bob@Example.COM ' });
    const [b] = rateKeys('auth.signIn', { session: null }, { email: 'bob@example.com' });
    expect(a).toEqual(b);
  });

  it('RATE_LIMITS=off is the only way off', () => {
    expect(rateLimitsOn({})).toBe(true);
    expect(rateLimitsOn({ RATE_LIMITS: 'on' })).toBe(true);
    expect(rateLimitsOn({ RATE_LIMITS: ' OFF ' })).toBe(false);
  });
});

describe('the procedures, refused (spec §2.4)', () => {
  const saved = process.env.RATE_LIMITS;
  let previous: RateLimiter;
  const fresh = (limits: Partial<RateLimits> = {}) => useRateLimiter(new RateLimiter({ limits: { ...DEFAULT_LIMITS, ...limits } }));
  beforeAll(() => { process.env.RATE_LIMITS = 'on'; previous = fresh(); });
  beforeEach(() => { fresh(); });
  afterAll(() => {
    useRateLimiter(previous);
    if (saved === undefined) delete process.env.RATE_LIMITS; else process.env.RATE_LIMITS = saved;
  });

  // An empty password is refused by the input check (BAD_REQUEST) after the limiter counted it: nothing is written.
  it('signIn is refused on the 11th call for one email, whatever the address', async () => {
    const email = `rl-${randomUUID()}@example.com`;
    for (let i = 0; i < 10; i++) {
      const anon = createCaller({ db, session: null, clientIp: `10.0.0.${i}` });
      expect(await codeOf(anon.auth.signIn({ email, password: '' }))).toBe('BAD_REQUEST');
    }
    const eleventh = createCaller({ db, session: null, clientIp: '10.0.1.1' });
    await expect(eleventh.auth.signIn({ email: email.toUpperCase(), password: '' })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED_MESSAGE });
    expect(await codeOf(eleventh.auth.signIn({ email: `other-${email}`, password: '' }))).toBe('BAD_REQUEST');
  });

  it('signIn is refused on the 31st call from one address, while another address is not', async () => {
    const anon = createCaller({ db, session: null, clientIp: '10.1.0.1' });
    for (let i = 0; i < 30; i++) expect(await codeOf(anon.auth.signIn({ email: `rl-${i}-${randomUUID()}@example.com`, password: '' }))).toBe('BAD_REQUEST');
    expect(await codeOf(anon.auth.signIn({ email: `rl-${randomUUID()}@example.com`, password: '' }))).toBe('TOO_MANY_REQUESTS');
    const other = createCaller({ db, session: null, clientIp: '10.1.0.2' });
    expect(await codeOf(other.auth.signIn({ email: `rl-${randomUUID()}@example.com`, password: '' }))).toBe('BAD_REQUEST');
  });

  it('a heavy procedure is refused on the 31st call for one org, while another org is unaffected', async () => {
    const orgX = randomUUID();
    const one = createCaller({ db, session: sessionIn(orgX) });
    const two = createCaller({ db, session: sessionIn(orgX) }); // another member of the same org: the same budget
    for (let i = 0; i < 30; i++) expect(await codeOf((i % 2 ? one : two).sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    await expect(one.sources.verify({ sourceId: randomUUID() })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED_MESSAGE });
    expect(await codeOf(two.crawl.plan({ sourceId: randomUUID(), probe: true }))).toBe('TOO_MANY_REQUESTS');
    expect(await codeOf(createCaller({ db, session: sessionIn(randomUUID()) }).sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    // Other groups are not this one: the org's ordinary calls still answer.
    expect(await codeOf(one.sources.verificationStatus({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
  });

  it('RF4: staff in an org and its customers count apart', async () => {
    fresh({ heavy: 2 });
    const org = randomUUID();
    const customer = createCaller({ db, session: sessionIn(org) });
    const staff = createCaller({ db, session: sessionIn(org, { staff: true }) });
    for (let i = 0; i < 2; i++) expect(await codeOf(customer.sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    expect(await codeOf(customer.sources.verify({ sourceId: randomUUID() }))).toBe('TOO_MANY_REQUESTS');
    for (let i = 0; i < 2; i++) expect(await codeOf(staff.sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    expect(await codeOf(staff.sources.verify({ sourceId: randomUUID() }))).toBe('TOO_MANY_REQUESTS');
  });

  it('everything else is per session', async () => {
    fresh({ session: 3 });
    const s = createCaller({ db, session: sessionIn(randomUUID()) });
    for (let i = 0; i < 3; i++) expect(await codeOf(s.auth.me())).toBe('answered');
    expect(await codeOf(s.auth.me())).toBe('TOO_MANY_REQUESTS');
    expect(await codeOf(createCaller({ db, session: sessionIn(randomUUID()) }).auth.me())).toBe('answered');
  });

  it('RATE_LIMITS=off lets every call through', async () => {
    fresh({ session: 1 });
    process.env.RATE_LIMITS = 'off';
    try {
      const s = createCaller({ db, session: sessionIn(randomUUID()) });
      for (let i = 0; i < 3; i++) expect(await codeOf(s.auth.me())).toBe('answered');
    } finally {
      process.env.RATE_LIMITS = 'on';
    }
  });
});
```

`packages/api-server/src/client-ip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { clientIpOf } from './client-ip.js';

const socket = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
function ipOf(env: Record<string, string | undefined>, headers: Record<string, string> = {}, bindings?: unknown) {
  const app = new Hono().get('/ip', (c) => c.text(clientIpOf(c, env)));
  return app.request('/ip', { headers }, bindings as never).then((r) => r.text());
}

describe('the client address (spec 2026-10-24 tenant isolation §2.4)', () => {
  it('is the socket address, whatever X-Forwarded-For says, unless TRUST_PROXY=on', async () => {
    expect(await ipOf({}, { 'x-forwarded-for': '6.6.6.6' }, socket('10.0.0.5'))).toBe('10.0.0.5');
    expect(await ipOf({ TRUST_PROXY: 'off' }, { 'x-forwarded-for': '6.6.6.6' }, socket('10.0.0.5'))).toBe('10.0.0.5');
  });

  it('behind a trusted proxy, the last X-Forwarded-For entry — the address the proxy saw', async () => {
    expect(await ipOf({ TRUST_PROXY: 'on' }, { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, socket('10.0.0.5'))).toBe('203.0.113.7');
    expect(await ipOf({ TRUST_PROXY: ' ON ' }, { 'x-forwarded-for': ' 203.0.113.7 ' }, socket('10.0.0.5'))).toBe('203.0.113.7');
    expect(await ipOf({ TRUST_PROXY: 'on' }, {}, socket('10.0.0.5'))).toBe('10.0.0.5');
  });

  it('is "unknown" with no socket (an in-process request)', async () => {
    expect(await ipOf({})).toBe('unknown');
  });
});
```

`packages/api-server/src/app.test.ts` — add imports `import { RateLimiter, DEFAULT_LIMITS, useRateLimiter, RATE_LIMITED_MESSAGE } from '@robot/api/isolation/rate-limit';` and `import { afterEach, beforeEach } from 'vitest';` (merge into the existing vitest import), and append:

```ts
// Rate limits over HTTP (spec 2026-10-24 tenant isolation §2.4): the client address reaches the limiter, a refusal is
// a 429 with the customer sentence, and X-Forwarded-For counts only behind a trusted proxy. An invalid email is
// refused by the input check after the limiter counted it, so nothing is written.
describe('rate limits over HTTP', () => {
  const saved = { RATE_LIMITS: process.env.RATE_LIMITS, TRUST_PROXY: process.env.TRUST_PROXY };
  let previous: RateLimiter;
  beforeEach(() => { process.env.RATE_LIMITS = 'on'; previous = useRateLimiter(new RateLimiter({ limits: { ...DEFAULT_LIMITS, signInIp: 2 } })); });
  afterEach(() => {
    useRateLimiter(previous);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const signInFrom = (remoteAddress: string, email: string, headers: Record<string, string> = {}) =>
    createApp().request('/trpc/auth.signIn', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ json: { email, password: 'x' } }),
    }, { incoming: { socket: { remoteAddress } } } as never);

  it('the third sign-in from one address is a 429 with the sentence', async () => {
    expect((await signInFrom('10.9.0.1', 'a')).status).toBe(400);
    expect((await signInFrom('10.9.0.1', 'b')).status).toBe(400);
    const third = await signInFrom('10.9.0.1', 'c');
    expect(third.status).toBe(429);
    expect((await third.json()).error.json.message).toBe(RATE_LIMITED_MESSAGE);
    expect((await signInFrom('10.9.0.2', 'd')).status).toBe(400);
  });

  it('RF2: a rotated X-Forwarded-For does not reset the sign-in limit; behind a proxy the last entry counts', async () => {
    delete process.env.TRUST_PROXY;
    expect((await signInFrom('10.9.1.1', 'a', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(400);
    expect((await signInFrom('10.9.1.1', 'b', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(400);
    expect((await signInFrom('10.9.1.1', 'c', { 'x-forwarded-for': '3.3.3.3' })).status).toBe(429);

    process.env.TRUST_PROXY = 'on';
    // Behind the proxy (one socket), each client is its own address…
    for (const [n, client] of ['198.51.100.1', '198.51.100.2', '198.51.100.3'].entries()) {
      expect((await signInFrom('10.9.2.1', `e${n}`, { 'x-forwarded-for': client })).status).toBe(400);
    }
    // …and what a client writes first is ignored: the proxy's last entry is the one counted.
    expect((await signInFrom('10.9.2.1', 'f', { 'x-forwarded-for': '7.7.7.1, 198.51.100.9' })).status).toBe(400);
    expect((await signInFrom('10.9.2.1', 'g', { 'x-forwarded-for': '7.7.7.2, 198.51.100.9' })).status).toBe(400);
    expect((await signInFrom('10.9.2.1', 'h', { 'x-forwarded-for': '7.7.7.3, 198.51.100.9' })).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/rate-limit.test.ts`, then `cd ../api-server && npx vitest run src/client-ip.test.ts`
Expected: FAIL — `./rate-limit.js` and `./client-ip.js` do not exist.

- [ ] **Step 3: The limiter** — `packages/api/src/isolation/rate-limit.ts`:

```ts
// packages/api/src/isolation/rate-limit.ts
// Rate limits (spec 2026-10-24 tenant isolation §2.4): one fixed-window counter per api process, applied to every
// procedure by one middleware (trpc.ts). Groups: sign-in (per email and per client address), heavy and network work
// (per org; staff on their own key), everything else (per session). One limiter per process: several servers would
// need a shared store (spec §2.4, Open). RATE_LIMITS=off turns it off (the test configs do).
import { TRPCError } from '@trpc/server';

export const RATE_LIMITED_MESSAGE = 'Too many requests. Wait a minute and try again.';
export const WINDOW_MS = 60_000;

export type RateLimits = { signInEmail: number; signInIp: number; heavy: number; network: number; session: number };
export const DEFAULT_LIMITS: RateLimits = { signInEmail: 10, signInIp: 30, heavy: 30, network: 60, session: 600 };

export const HEAVY_PROCEDURES = [
  'sources.verify', 'sources.confirm', 'sources.captureProofPage', 'crawl.plan', 'crawl.probeAndSample', 'crawl.execute',
  'crawl.backfill', 'sources.detectVariants', 'sources.transferMarks',
] as const;
export const NETWORK_PROCEDURES = ['sources.reachability', 'sources.checkListingPage', 'sources.variantLinksNear', 'sources.variantList'] as const;

export type RateGroup = 'sign-in' | 'heavy' | 'network' | 'session';
const heavy = new Set<string>(HEAVY_PROCEDURES);
const network = new Set<string>(NETWORK_PROCEDURES);

export function groupOf(path: string): RateGroup {
  if (path === 'auth.signIn') return 'sign-in';
  if (heavy.has(path)) return 'heavy';
  if (network.has(path)) return 'network';
  return 'session';
}

export type RateKey = { key: string; limit: number };
export type RateCaller = { session: { token: string; user: { id: string }; org: { id: string }; staff: unknown } | null; clientIp?: string };

/** The keys one call counts against. The sign-in email is read from the raw input, trimmed and lower-cased as the
 *  input check does, so an invalid attempt counts too. A staff session counts heavy and network work on its own key,
 *  never the customer org's. */
export function rateKeys(path: string, who: RateCaller, rawInput: unknown, limits: RateLimits = DEFAULT_LIMITS): RateKey[] {
  const ip = who.clientIp?.trim() || 'unknown';
  const group = groupOf(path);
  if (group === 'sign-in') {
    const raw = rawInput && typeof rawInput === 'object' ? (rawInput as { email?: unknown }).email : undefined;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return [...(email ? [{ key: `sign-in:email:${email}`, limit: limits.signInEmail }] : []), { key: `sign-in:ip:${ip}`, limit: limits.signInIp }];
  }
  const s = who.session;
  if (group === 'heavy' || group === 'network') {
    const actor = !s ? `ip:${ip}` : s.staff ? `staff:${s.user.id}` : `org:${s.org.id}`;
    return [{ key: `${group}:${actor}`, limit: limits[group] }];
  }
  return [{ key: s ? `session:${s.token}` : `session:ip:${ip}`, limit: limits.session }];
}

/** Fixed windows in a Map, pruned at most once a window. `take` is all or nothing: a refused call counts nowhere. */
export class RateLimiter {
  readonly limits: RateLimits;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private readonly windows = new Map<string, { start: number; count: number }>();
  private lastPrune: number;

  constructor(opts: { limits?: RateLimits; windowMs?: number; now?: () => number } = {}) {
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.clock = opts.now ?? Date.now;
    this.lastPrune = this.clock();
  }

  take(keys: RateKey[]): boolean {
    const now = this.clock();
    if (now - this.lastPrune >= this.windowMs) this.prune();
    const live = keys.map((k) => {
      const w = this.windows.get(k.key);
      return w && now - w.start < this.windowMs ? w : undefined;
    });
    if (keys.some((k, i) => (live[i]?.count ?? 0) >= k.limit)) return false;
    keys.forEach((k, i) => {
      const w = live[i];
      if (w) w.count++;
      else this.windows.set(k.key, { start: now, count: 1 });
    });
    return true;
  }

  prune(): void {
    const now = this.clock();
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
    this.lastPrune = now;
  }

  get size(): number {
    return this.windows.size;
  }
}

let limiter = new RateLimiter();

/** Swaps the process's limiter and returns the one it replaced (tests inject their limits this way). */
export function useRateLimiter(next: RateLimiter): RateLimiter {
  const previous = limiter;
  limiter = next;
  return previous;
}

export function rateLimitsOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.RATE_LIMITS ?? '').trim().toLowerCase() !== 'off';
}

/** The middleware's body: counts the call, or refuses it with the customer sentence. The log line names the procedure
 *  and its group, never the email or the address. */
export async function enforceRateLimit(path: string, who: RateCaller, getRawInput: () => Promise<unknown>): Promise<void> {
  if (!rateLimitsOn()) return;
  const raw = groupOf(path) === 'sign-in' ? await getRawInput().catch(() => undefined) : undefined;
  if (limiter.take(rateKeys(path, who, raw, limiter.limits))) return;
  console.warn(`[rate-limit] refused ${path} (${groupOf(path)})`);
  throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED_MESSAGE });
}
```

- [ ] **Step 4: The middleware and the context** — `packages/api/src/trpc.ts`:

Add the import `import { enforceRateLimit } from './isolation/rate-limit.js';`. In `Context`, after `session: SessionInfo | null;`:

```ts
  /** The caller's address, for the sign-in rate limit (spec 2026-10-24 tenant isolation §2.4): the api-server's socket
   *  address, or `X-Forwarded-For`'s last entry with `TRUST_PROXY=on`. A test caller may omit it ("unknown"). */
  clientIp?: string;
```

Replace `export const publicProcedure = t.procedure.use(withOperatorFlag);` with:

```ts
/** Rate limits (spec 2026-10-24 tenant isolation §2.4), on every procedure — before the session check, so a flood with
 *  no session counts against its address. */
const withRateLimit = t.middleware(async ({ ctx, path, getRawInput, next }) => {
  await enforceRateLimit(path, ctx, getRawInput);
  return next();
});

export const publicProcedure = t.procedure.use(withOperatorFlag).use(withRateLimit);
```

`packages/api/package.json` — in `exports`, after the `./isolation/two-orgs` line: `"./isolation/rate-limit": "./src/isolation/rate-limit.ts"`.

- [ ] **Step 5: The client address** — `packages/api-server/src/client-ip.ts`:

```ts
// The caller's address for the rate limits (spec 2026-10-24 tenant isolation §2.4). The socket's, unless
// TRUST_PROXY=on — then the last X-Forwarded-For entry, the one the proxy in front of us wrote (the entries before it
// are whatever the client sent). "unknown" when there is no socket (an in-process request).
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

export function clientIpOf(c: Context, env: Record<string, string | undefined> = process.env): string {
  if ((env.TRUST_PROXY ?? '').trim().toLowerCase() === 'on') {
    const last = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
}
```

`packages/api-server/src/app.ts` — import `import { clientIpOf } from './client-ip.js';` and in `createContext`'s returned object, after `session: …,`:

```ts
          clientIp: clientIpOf(c),
```

- [ ] **Step 6: Off in every test config**

`packages/api/vitest.config.ts` — the `env` line becomes `env: { JEV_SHADOW: '', SMTP_URL: '', RATE_LIMITS: 'off' },`, and the comment above gains: `Rate limits are off too (RATE_LIMITS=off): a suite makes hundreds of calls a minute on one session; isolation/rate-limit.test.ts turns them on with its own limiter.`
`packages/api-server/vitest.config.ts` — `env: { JEV_SHADOW: '', RATE_LIMITS: 'off' }`, comment: `…, rate limits off (app.test.ts turns them on for its own describe)`.
`packages/worker/vitest.config.ts` — `env: { JEV_SHADOW: '', SMTP_URL: '', RATE_LIMITS: 'off' }`, comment gains `rate limits off`.
`packages/app/vitest.config.ts` — in `test`, add `env: { RATE_LIMITS: 'off' },` with the comment `// Off as in the api's own config, should a unit test ever reach an api procedure in-process.`

- [ ] **Step 7: Run them to see them pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run src/isolation/rate-limit.test.ts && npx vitest run src/trpc-error-shape.test.ts && npx vitest run src/auth/staff-guard.test.ts && npx tsc --noEmit`, then `cd ../api-server && npx vitest run src/client-ip.test.ts && npx vitest run src/app.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add packages/api/src/isolation/rate-limit.ts packages/api/src/isolation/rate-limit.test.ts packages/api/src/trpc.ts packages/api/package.json packages/api/vitest.config.ts packages/api-server/src/client-ip.ts packages/api-server/src/client-ip.test.ts packages/api-server/src/app.ts packages/api-server/src/app.test.ts packages/api-server/vitest.config.ts packages/worker/vitest.config.ts packages/app/vitest.config.ts
git commit -m "feat(api): rate limits — sign-in per email and address, heavy and network work per org, the rest per session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: What a customer reads when refused (`@robot/app` `lib/mutation-error.ts`, `lib/sign-in-error.ts`) — spec §2.4 "Customer wording"

**Files:**
- Modify: `packages/app/src/lib/mutation-error.ts`, `packages/app/src/lib/sign-in-error.ts`
- Test: `packages/app/src/lib/mutation-error.test.ts`, `packages/app/src/lib/sign-in-error.test.ts`

**Interfaces:**
- Consumes: Task 5's sentence (copied as the app's own constant — the app does not import `@robot/api` at runtime) and the tRPC error shape (`error.data.code === 'TOO_MANY_REQUESTS'`).
- Produces: `TOO_MANY_REQUESTS_TEXT = 'Too many requests. Wait a minute and try again.'` (exported from `lib/mutation-error.ts`); `mutationErrorText` returns it for any `TOO_MANY_REQUESTS`, staff included; `signInErrorMessage` returns it for a `TOO_MANY_REQUESTS` error (the login form renders `signInErrorMessage(err)` in its alert, `routes/login.tsx` ~line 45).

- [ ] **Step 1: Write the failing tests**

`packages/app/src/lib/mutation-error.test.ts` — import `TOO_MANY_REQUESTS_TEXT` too; in `'a server error, a network failure or no code at all reads as the generic sentence'` delete the line `expect(mutationErrorText(err('Too many requests', 'TOO_MANY_REQUESTS'))).toBe(SOMETHING_WENT_WRONG);`, and add:

```ts
  it('a rate-limited call reads the rate-limit sentence, for a customer and for staff (spec 2026-10-24 tenant isolation §2.4)', () => {
    expect(TOO_MANY_REQUESTS_TEXT).toBe('Too many requests. Wait a minute and try again.');
    expect(mutationErrorText(err('Too many requests. Wait a minute and try again.', 'TOO_MANY_REQUESTS'))).toBe(TOO_MANY_REQUESTS_TEXT);
    expect(mutationErrorText(err('anything at all', 'TOO_MANY_REQUESTS'))).toBe(TOO_MANY_REQUESTS_TEXT);
    expect(mutationErrorText(err('anything at all', 'TOO_MANY_REQUESTS'), true)).toBe(TOO_MANY_REQUESTS_TEXT);
  });
```

`packages/app/src/lib/sign-in-error.test.ts` — add:

```ts
  it('a rate-limited sign-in reads the rate-limit sentence (spec 2026-10-24 tenant isolation §2.4)', () => {
    const limited = Object.assign(new Error('Too many requests. Wait a minute and try again.'), { data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 } });
    expect(signInErrorMessage(limited)).toBe('Too many requests. Wait a minute and try again.');
    const odd = Object.assign(new Error('rate limited by something'), { data: { code: 'TOO_MANY_REQUESTS' } });
    expect(signInErrorMessage(odd)).toBe('Too many requests. Wait a minute and try again.');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/app && npx vitest run src/lib/mutation-error.test.ts src/lib/sign-in-error.test.ts`
Expected: FAIL — `TOO_MANY_REQUESTS_TEXT` is not exported; the sign-in case returns the raw message.

- [ ] **Step 3: The wording**

`packages/app/src/lib/mutation-error.ts` — after `export const SOMETHING_WENT_WRONG = …`:

```ts
/** A refused call over the rate limits (spec 2026-10-24 tenant isolation §2.4) — the api's own sentence, kept here so
 *  a customer always reads exactly this, whatever the message carried. */
export const TOO_MANY_REQUESTS_TEXT = 'Too many requests. Wait a minute and try again.';
```

and as the first line of `mutationErrorText`'s body:

```ts
  if (error.data?.code === 'TOO_MANY_REQUESTS') return TOO_MANY_REQUESTS_TEXT;
```

`packages/app/src/lib/sign-in-error.ts` — import `import { TOO_MANY_REQUESTS_TEXT } from './mutation-error';` and as the first lines of `signInErrorMessage`'s body:

```ts
  // Rate limits (spec 2026-10-24 tenant isolation §2.4): ten sign-ins a minute per email, thirty per address.
  const code = (error as { data?: { code?: unknown } } | null | undefined)?.data?.code;
  if (code === 'TOO_MANY_REQUESTS') return TOO_MANY_REQUESTS_TEXT;
```

- [ ] **Step 4: Run them, and the copy sweep**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/app && npx vitest run src/lib/mutation-error.test.ts src/lib/sign-in-error.test.ts src/customer-copy-sweep.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add packages/app/src/lib/mutation-error.ts packages/app/src/lib/mutation-error.test.ts packages/app/src/lib/sign-in-error.ts packages/app/src/lib/sign-in-error.test.ts
git commit -m "feat(app): a rate-limited call says to wait a minute, on the sign-in form and every button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, the merge gate, the merge (`CLAUDE.md` "Autonomous runs") — spec §5

**Files:**
- Modify: `CLAUDE.md`; `docs/superpowers/specs/2026-10-24-tenant-isolation-design.md` (Status); `docs/handoff.md`; `docs/queue.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch that passes the gate; `main` fast-forwarded and pushed.

- [ ] **Step 1: Reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` (memory `subagent-commit-trailers`).

- [ ] **Step 2: Full test run and type-check of every touched package** (one at a time — memory)

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api-server && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/worker && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/app && npx vitest run --no-file-parallelism && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up; the app's route smoke skips without `RUN_UI_SMOKE`; `@robot/worker` changed only in its vitest config, but its tests call the api in-process). A Chromium file that times out only in the full run: re-run it alone. A real failure blocks the merge: fix it on the branch with a test. Then: `git status --short` — restore `packages/app/src/routeTree.gen.ts` if it changed; no test left a `jobs` row (`SELECT queue, count(*) FROM jobs WHERE queue LIKE 'test-%' GROUP BY queue` → none); no fixture left a user (`SELECT count(*) FROM users WHERE email LIKE 'iso-%' OR email LIKE 'staff-iso-%' OR email LIKE 'rl-%'` → 0); no file left (`ls packages/api-server/public/captures | grep -c '^iso-'` and `ls "$TMP/robot-isolation-captures" 2>/dev/null | grep -c '^iso-'` → 0).

- [ ] **Step 3: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. Points to press: the table against `appRouter` — every procedure in exactly one class, and each class right for what the code does (a procedure that takes any id of an org's row is `scoped`, whatever its rate group); every `scoped` input aims at a real row of B's (the "B's own owner" cases) and parses (a `BAD_REQUEST` would pass for the wrong reason — the sweep asserts the code, so check none was relaxed); the snapshot covers every table an org owns (compare `snapshotQueries` with `packages/db/src/schema.ts`: any table with an `org_id`, a `source_id` or a `run_id` must be in it); the sweeps cannot reach the worker (`runAndWait`/`awaitJob` mocked; queue counts asserted); `projects.list`'s two queries are scoped and nothing else in the routers reads across orgs (`grep -n "\.from(\|findMany(" packages/api/src/routers/*.ts`); the money — the six procedures leave their keys out for a customer and keep them for an operator and a staff session, nothing else in a customer answer carries an amount (the money sweep), the customer `usage.byProject` order does not follow spend, the app's optional types compile and the screens still gate on `showsMoney`; the limiter — the groups and limits verbatim from §2.4, the email key trimmed and lower-cased, all-or-nothing counting, pruning, staff on their own key, the sign-in IP from the socket unless `TRUST_PROXY=on` and then the last `X-Forwarded-For` entry, `RATE_LIMITS=off` in every vitest config, the log line carrying no email or address; customer copy — the one new sentence, verbatim, on the login form and through `mutationErrorText`; no AI call and no browser anywhere in the new tests. No open Critical or Important finding may remain; fix on the branch and re-run Step 2 for the touched packages.

- [ ] **Step 4: The route smoke, from the branch, on an isolated pair with its worker (gate 4: `@robot/app` and `@robot/api` changed)**

Rate limits stay at their default — **on** — on the pair's api-server: the smoke is the proof that the app works under them for a customer. Estimate (read from `packages/app/src/routes-smoke.test.ts`): one customer session, two sign-ins through the form (the walk and the sign-out test; under 10 per email and 30 per address), a few proof-page captures, transfers and variant detections (well under 30 heavy calls a minute), and roughly 60 page loads of ~10–15 calls each over several minutes (a few hundred calls a minute at the busiest, under 600 per session). If a refusal shows up anyway, see the rule after the smoke.

A stop file for the worker: `/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` (delete it first if it exists). In the background, three processes (the api-server's output to a log file, for the check below):

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts > /c/Users/Marko/AppData/Local/Temp/claude/api-4100.log 2>&1
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= WEBSITE_CHECKS=off RECURRING_RUNS=off JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop npx tsx src/index.ts
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

(`RATE_LIMITS` and `TRUST_PROXY` are not in `.env`; if `grep -E '^(RATE_LIMITS|TRUST_PROXY)=' /c/Users/Marko/Documents/projects/robot-platform-tenant/.env` prints anything, prefix the api-server command with `RATE_LIMITS= TRUST_PROXY=` so it runs at the defaults.)

Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}`, the worker's log says `on queue "isolated-4100"` with `website checks off`, `recurring runs off` and `mail off`, and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS, every test. Then `grep -c "\[rate-limit\]" /c/Users/Marko/AppData/Local/Temp/claude/api-4100.log` → `0`. Look at `docs/testing/screens/app-usage-dark.png` and `-light.png` (pages captured as the headline, no spend column, nothing overflowing) and `app-runs-*.png` (no cost column) in both themes.

**If the smoke trips a limit** (a `[rate-limit] refused …` line, or a test failing on "Too many requests"): read the line's procedure and group. If one screen's own polling or loading pattern trips it, that is an Important finding — fix the screen's requests on the branch (never the limits, which are the spec's) and run the smoke again. If it is the smoke's robot speed alone (a burst no person makes — e.g. the walk's back-to-back page loads exceeding 600 a minute on one session), re-run the smoke once with `RATE_LIMITS=off` on the api-server to finish the gate, and say in the run's digest which group tripped and how many calls the minute held (count the api-server's request log lines for that minute).

Stop the worker with `touch /c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` and wait for it to exit (`stopping (stop file)`), then the two servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

If the worker has not exited 60 s after the stop file: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*robot-platform-tenant*packages*worker*src*index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }`. Then `DELETE FROM jobs WHERE queue = 'isolated-4100'` (via `npx tsx -e` with `@robot/db`, from `packages/worker`). Restore: `git checkout -- packages/app/src/routeTree.gen.ts docs/testing/screens`.

- [ ] **Step 5: Gate 5 does not apply**

Capture and extraction code is untouched (`git diff main...HEAD --stat -- packages/browser packages/scraper packages/agent` → nothing); say so in the digest.

- [ ] **Step 6: Docs**

Note the last code commit: `git log -1 --format=%h -- packages` → `<sha>`.

1. Spec — the Status paragraph's first sentence becomes ``**Status:** implemented on `feat/tenant-isolation` and merged to `main` on <date> (`<sha>`); written 2026-10-24 under the standing approval …`` (keep the rest); add a **Proven:** sentence (the procedure sweep: 85 procedures classified — scoped 56, org-wide 8, self 8, membership 3, ops 5, public 3, stateless 2 — each called across two orgs with B's rows and the queue unchanged; the file-route sweep; the money sweep with its count of customer queries; the limiter's tests; test counts from Step 2; the smoke with limits on), the hole fixed (`projects.list`), and any **Deviations:** the reviews forced, plus "Settled here" below.
2. `CLAUDE.md`:
   - Environment, after `WEBSITE_CHECK_DAYS` (or after the last `WORKER_*` line):
     - `` - `RATE_LIMITS` — the api's rate limits (spec 2026-10-24 tenant isolation): on unless set to `off`. Sign-in 10 a minute per email and 30 per client address; Verify, runs, proof-page captures and the other heavy calls 30 a minute per organisation; the address checks 60 per organisation; everything else 600 per session. Staff count on their own key. One limiter per api-server process (several servers would need a shared store). Every vitest config sets it `off` ``
     - `` - `TRUST_PROXY` — `on` takes the client address for the sign-in limit from the last `X-Forwarded-For` entry; set it only behind a proxy that writes that header (otherwise a client could pick its own address). Off by default: the socket address. Behind a proxy with it off, every client shares the proxy's address and its 30 sign-ins a minute ``
   - Commands, after the `pnpm test:liveness` line: `` - `cd packages/api && npx vitest run src/isolation` — the tenant-isolation sweeps: every procedure classified (`src/isolation/procedure-classes.ts`; a new procedure fails until it is) and called across two throwaway organisations, no money in a customer answer, the rate limits (Postgres; free, no browser). The file routes: `cd packages/api-server && npx vitest run src/isolation-routes.test.ts` ``
   - Key Technical Decisions, after the "Email (2026-10-24)" bullet:

```markdown
- Tenant isolation, as tests (2026-10-24): every tRPC procedure is classified in `packages/api/src/isolation/procedure-classes.ts` — scoped, org-wide, self, membership, ops, public or stateless — and a sweep calls each across two throwaway organisations: another org's ids answer NOT_FOUND with its rows unchanged and nothing queued, no session answers UNAUTHORIZED, a new procedure fails the sweep until it is classified. The file routes are swept the same way (401 / 404 / 400; every wrong signed link the same 404). Money (`costUsd`, `spendUsd`, `upperBoundUsd`, `perFieldUsd`, `estCostUsd`) is left out of every customer answer (`viewerSeesMoney`, the app's `showsMoney` rule on the server; a customer's Usage is ordered by pages); a money sweep proves none reaches a customer and staff still get them. Fixed-window rate limits in the api process (`RATE_LIMITS`, `TRUST_PROXY`); a refusal reads "Too many requests. Wait a minute and try again."
```

3. `docs/handoff.md` — the "Newest" line becomes `**Newest: [Tenant isolation (2026-10-24)](#tenant-isolation-2026-10-24).** Every api procedure and file route is proven, as tests, to refuse another organisation; customers receive no money amounts; sign-in, the heavy work and the address checks are rate limited. Merged <date>.` followed by `**Before it: [Email (2026-10-24)](#email-2026-10-24).** …` (the old Newest line's sentence) and the old "Before it" demoted to "Before that". Insert before `## Email (2026-10-24)` a section `## Tenant isolation (2026-10-24)` with: spec/plan paths; **What changed** (the classification and the procedure sweep; the file-route sweep; money left out for customers, the six procedures and the customer Usage order; the rate limits and their groups, `RATE_LIMITS`, `TRUST_PROXY`, the sentence; the `projects.list` fix — one paragraph each, from the spec); **How it was proven** (the sweeps' counts, test counts from Step 2, the smoke with limits on and its Usage/Runs screenshots); **After pulling** (nothing to install or migrate; restart `pnpm dev:all` to get the limits; a customer's Usage and Runs show no money as before, now because the api sends none); **What NOT to redo** (never add a procedure without its row in `procedure-classes.ts`; never send money to a customer and hide it in the app — leave the key out with `moneyFields(viewerSeesMoney(ctx), …)`; never turn `TRUST_PROXY` on without a proxy that writes `X-Forwarded-For`; never let a sweep reach the worker — keep the `runAndWait`/`awaitJob` mocks; the tests run with `RATE_LIMITS=off`); **Open** (spec §6: distributed limits for several api-servers, per-role money, billing, abuse detection beyond fixed windows, real authentication — sign-in still accepts any password; `sources.get` hands the webhook secret to every member, by design for the Settings tab; a query refused by the limits shows the screen's own error line, not the sentence — only buttons and sign-in word it).
4. `docs/queue.md` — move item 1 from **Next** to **Done** as `- <date> — Tenant isolation audit, as tests (\`<sha>\`): every procedure classified and swept across two organisations (85; one hole fixed — projects.list read every org's websites), every file route swept, no money in customer answers, rate limits (RATE_LIMITS, TRUST_PROXY). After merge: restart dev:all.`; renumber **Next**; in **Needs Marko** add: `- **Real sign-in.** Sign-in still accepts any password (spec 2026-10-24 tenant isolation §6); the new limits slow guessing but do not stop it. Passwords, magic links, or an identity provider?` and `- **Rate limits behind a proxy.** With a proxy in front of the api-server, set TRUST_PROXY=on (otherwise every client shares its 30 sign-ins a minute). Several api-servers would need a shared store for the limits.`

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git add docs/superpowers/specs/2026-10-24-tenant-isolation-design.md CLAUDE.md docs/handoff.md docs/queue.md
git commit -m "docs: tenant isolation — shipped; handoff, decisions, commands, env, queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Rebase on `main`, fast-forward `main`, push**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-tenant
git checkout -- packages/app/src/routeTree.gen.ts
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 2 for the touched packages (and Step 4 if an app/api file on `main` changed). If `main` gained a procedure, the sweep fails until it has its row in `procedure-classes.ts` — classify it on this branch (that is the sweep doing its job). The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/tenant-isolation
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. Marko's dev servers are not restarted: they keep the old code (no limits, money still sent and hidden by the app) until he restarts `pnpm dev:all` — say so in the run's digest. Finally: no `isolated-4100`/`test-%` jobs, no `iso-*`/`rl-*` users, no `iso-*` capture files, nothing listening on :4100 or :3100.

---

## Settled here (spec ambiguities, decided for this plan)

1. **Class is about scoping, group is about rate.** `sources.detectVariants`, `sources.variantList` and `sources.variantLinksNear` take a website id, so they are `scoped` (the sweep proves they refuse B's) though their rate groups are heavy / network; only `sources.reachability` and `sources.checkListingPage` take no id and are `stateless`.
2. **`self` includes `orgs.create`** (it makes a new org of the caller's own and touches no existing one), `ops.leaveOrg` (the caller's own session, any signed-in user may call it) and `auth.me` (the caller's own memberships). **`org-wide` includes the mutations on the caller's own org** — `orgs.rename`, `orgs.delete` (refused `PRECONDITION_FAILED` on A's personal org, still swept), `projects.create` — swept for "names nothing of B, B unchanged".
3. **Membership refusal codes are the code's**: `auth.switchOrg` FORBIDDEN, `orgs.members.setRole` / `remove` NOT_FOUND — each with B's member and B's owner.
4. **"No job enqueued" is checked as "the test queue's job count is unchanged"** after every swept call (stronger than "none for B's ids"), and the sweeps mock `runAndWait` and `awaitJob` to throw, so a hole surfaces as a failed assertion and never as work.
5. **Scoped queries are also called by B's own owner** with the same input (must not be NOT_FOUND): it proves every builder aims at a real row, so a NOT_FOUND from A cannot pass for a typo. Mutations and `works` queries are not (they would change B or reach the worker).
6. **`works`** marks a scoped procedure that does real work for its own org; the money sweep skips the two such queries (`sources.detectVariants`, `sources.variantLinksNear`, which return worker results with no amount).
7. **Money is left out as an absent key**, not an `undefined` value: superjson would carry the key's name to the browser. `moneyFields(sees, {…})` spreads `{}` for a customer.
8. **A customer's Usage is ordered by pages captured, then name** — ordering by spend would rank it. Staff keep spend-then-name.
9. **A customer's staff-activity entry keeps `run: { id }`** (the run link), never its cost.
10. **The money sweep's exclusion list** is the spec's (`data`, `values`, `rows`, `fields`, `expected` — the export rows sit under `rows`) plus `defaults` (the customer's typed default values) and `listingValues` (values scraped from a listing page): both are the customer's data. The main fixture's fields are Title and Price (a key `price` never matches the pattern); the money-named field lives in RF5's own website.
11. **The sign-in email key** is the raw input's email, trimmed and lower-cased as the input check does, read before validation — an invalid attempt counts. No email in the input: the address key only.
12. **Counting is all or nothing**: a refused call counts against none of its keys. A call with no session keys by client address (`session:ip:<addr>`, and the heavy/network groups `ip:<addr>`), so an anonymous flood counts — the limiter runs before the session check.
13. **Staff "on their own key"**: in staff mode, heavy and network work counts on `staff:<userId>`, never the customer org's `org:<orgId>`; the session group is per session anyway.
14. **`TRUST_PROXY=on` takes the last `X-Forwarded-For` entry** (the one the trusted proxy wrote), not the first (which the client controls). With no header, the socket address; with no socket (an in-process request), `unknown`.
15. **The refusal log line** (`[rate-limit] refused <path> (<group>)`) names no email or address.
16. **The app always shows its own copy of the sentence** for `TOO_MANY_REQUESTS`, staff included (the staff "message as sent" rule would show the same words). Queries refused by the limits keep their screen's own error line (listed under Open in the handoff).
17. **`RATE_LIMITS=off` in four vitest configs** — api, api-server, worker (its tests call the api in-process) and app (parity; its unit tests do not reach the api today).
18. **The route smoke runs with the limits on**, by estimate under every limit; the rule for a refusal is in Task 7 Step 4.
19. **The hole fixed**: `projects.list` read every org's websites (and certified each) and every org's runs; the answer was already filtered by project, so nothing leaked. Scoped to the caller's org with a test that watches which websites it certifies.
20. **Count**: 85 procedures on `fca0e159` — scoped 56, org-wide 8, self 8, membership 3, ops 5, public 3 (`auth.signIn`, `datasets.catalogue`, `ops.me`), stateless 2.
