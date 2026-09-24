# App Redesign — Plan 4, the Organisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four sidebar screens that are still placeholders become real — **Runs** (every run in the organisation, newest first, with the status dot), **Usage** (this month's spend and pages captured, per project, with one 28 px total), **Settings** (the organisation: name, members, danger zone) and **Account** (name, read-only email, appearance) — and a run's money is recorded so Usage can add it up.

**Architecture:** Two new read procedures, `runs.listByOrg` and `usage.byProject({ month })`, are session-only (`protectedProcedure` — no `orgSlug` shim, since the old dashboard has neither screen) and scoped org → project → dataset → source in one join each. A run learns its cost the way a verification already does — `snapshotUsage`/`diffUsage`/`estimateCostUsd` around its browser session — into a new `runs.cost_usd` column, added by both writers of a run (planning and execution), so Usage is the sum of `source_verifications.cost_usd` and `runs.cost_usd` for the month. The organisation screens call the `orgs.*` router plan 1 already built (create / rename / delete / members.list / setRole / remove) plus one new `auth.updateName`; `orgs.delete` learns to move the caller's session to their personal organisation first, so deleting a team is not a sign-out. Screens follow plans 2–3's grammar (`Page`, the panel/table classes, mutually exclusive loading / empty / error states, `useUnauthorizedRedirect`, every disabled control with a visible reason), and every rule that decides what a role may do lives in a tested `lib/*-view.ts`.

**Tech Stack:** TanStack Start + Router + Query (React 19), Tailwind v4, shadcn/ui (the primitives already in `components/ui`; nothing new), tRPC v11 + superjson, Drizzle + Postgres (one generated migration), Hono, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-app-redesign-design.md` — §2 (roles: `member` cannot rename or delete the org or manage members; `admin` manages members but cannot delete; `owner` everything; a personal org cannot be deleted), §3 (sidebar nav Projects / Runs / Usage / Settings; user menu → account; `/settings` org, `/account` account), §4 (the run dot "carried everywhere a run is mentioned … the org-wide Runs page"; "one 28 px figure where a screen has a headline number"), §5 rows `/runs`, `/usage`, `/settings`, `/account`, §6 (`runs.listByOrg`, `usage.byProject({ month })`), §7 plan (4), §8, §9 (no invitations — so **no "add member"** in this plan; the members table lists, re-roles and removes, exactly as §5 says. An "add an existing user by email" row is an open decision for Marko, recorded in the handoff by Task 7, not built here).

## Global Constraints

- ESM everywhere; `.js` import suffixes in `packages/api`, `packages/api-server` and `packages/db`; none in the app.
- One package's tests at a time: `pnpm --filter <pkg> exec vitest run --maxWorkers=1 <name>`; never `pnpm -r test` from a task.
- Commit with explicit paths only (`git add <paths>` then `git commit -m "…" -- <paths>`).
- **The dev database is the customer's only data.** No ad-hoc sign-ins, deletes or cleanup against it from an implementer; tests create their own rows under a throwaway identity (the `signIn` / `dropIdentity` helpers of `packages/api/src/routers/projects-get.test.ts`, which delete through `deleteOwnOrg`) and delete only those; org `default`, org `mar`, the user `markodjordjievski@gmail.com` and the projects Acne / Scratch / Competitor prices are never touched. Browser checks sign in through `/login` only as `<task>-<timestamp>@example.com`, on their own project and website (`https://example.com/…` URLs), and report the address. **A browser check never clicks "Delete organisation", "Remove" on a member, or any Save on Marko's account or org** — a throwaway's own org and account are the only ones a check may change.
- **The migration in Task 1 is additive** (one column with a default) and is the only schema change in this plan. It is generated with `drizzle-kit generate`, never hand-written; the controller takes a `pg_dump` before Task 1 runs `pnpm db:migrate`.
- **Nothing an implementer does spends money or runs the engine against a real site.** No Verify, Sample, Extract, Re-extract, backfill or "Find pages". Run cost is proven with `recordUsage` fed synthetic token counts, never with a model call.
- Spec §4 verbatim: dark tokens background `#0a0a0a`, panel `#111111`, raised `#171717`, border `#262626` (hover `#333333`), text `#ededed`, secondary `#a1a1a1`, muted `#666666` (never a text colour — `text-faint` is never text); light inverse; pass `#3ddc84` / `#0f7b3d`, fail `#ff5c5c` / `#c62828`, warn `#f5a623` / `#a26000`, link `#52a8ff` / `#0b6bcb`. State colour as a dot, a 2 px rail or a badge, never a background wash. 13 px body (`text-base`), 12 px secondary (`text-sm`), 20 px semibold title (`text-2xl`, the `Page` title), **28 px (`text-3xl`) only for the Usage total** — the one headline figure this plan has. Sentence case, no uppercase. 6 px radius, 1 px borders, no shadow in dark (`[box-shadow:var(--shadow)]` is the token). Motion: the `.rise` stagger, 150 ms hover, the running dot; nothing else moves. Tailwind spacing is 0.8125× nominal; spec pixels are literals (`size-[8px]`, `w-[176px]`).
- Copy (spec §4 and 2026-09-08 §6): "organisation", "member", "project", "website", "run", "page"; never "org" in the UI, never "source", "dataset", "tenant", "user" as a label (a member is a member; the signed-in person's page is "Account"). Every button says what happens ("Save name", "Remove", "Delete organisation"); every disabled control has a visible reason within one line; empty states are one sentence and an action.
- Polling has a stop condition: the org-wide Runs page refetches at 5 s **only while at least one row's dot is `running`**; never an unconditional interval. Usage does not poll.
- Session on a screen: `const { session } = Route.useRouteContext()` — `_app.tsx`'s `beforeLoad` puts a non-null session into every child route's context. After anything that changes what the session says (org name, user name, theme, current org), `await router.invalidate()` so the sidebar, breadcrumb and switcher re-read it; after a change of organisation, `queryClient.resetQueries()` **before** the invalidation (the reason is in `org-switcher.tsx`'s comment — read it, then reuse the pattern).
- The frontend-design rules apply: intentional, restrained, industrial-minimal; tables are the object; a settings screen is a column of hairline panels, each with one `h2` in `text-base font-medium` and rows in the `dl` grammar of `components/settings/settings-rows.tsx`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/schema.ts`, `packages/db/drizzle/0011_run_cost.sql` (+ meta) | `runs.cost_usd numeric(10,4) not null default 0` |
| `packages/api/src/crawl/record-run-cost.ts` (+test) | `costSince(before)`, `addRunCost(db, runId, usd)` |
| `packages/api/src/crawl/start-execution.ts`, `plan-source.ts` | record a run's cost on every exit path |
| `packages/api/src/routers/runs.ts` | `listByOrg` |
| `packages/api/src/routers/usage.ts` (new) + `index.ts` | `usage.byProject({ month })` |
| `packages/api/src/routers/auth.ts`, `orgs.ts` | `auth.updateName`; `orgs.delete` moves the caller's session first |
| `packages/api/src/routers/org-screens.test.ts` (new) | the tests for all four |
| `packages/app/src/lib/org-runs-view.ts` (+test) | rows for the org-wide table, `anyRunning` |
| `packages/app/src/lib/usage-view.ts` (+test) | month keys and labels, `usdLabel`, `usageView` |
| `packages/app/src/lib/org-settings-view.ts` (+test) | what a role may do, and the reason when it may not |
| `packages/app/src/lib/account-view.ts` (+test), `lib/apply-theme.ts` | name validation, theme options, the DOM theme flip shared with the user menu |
| `packages/app/src/routes/_app/{runs,usage,settings,account}.tsx` | the four screens (placeholders replaced in place) |
| `packages/app/src/components/runs/org-runs-table.tsx` | the org-wide table |
| `packages/app/src/components/usage/{usage-total,usage-table,month-stepper}.tsx` | the Usage panels |
| `packages/app/src/components/org/{general-panel,members-table,remove-member-dialog,delete-org-dialog}.tsx` | the Settings panels |
| `packages/app/src/components/account/{profile-panel,appearance-panel}.tsx` | the Account panels |
| `packages/app/src/components/page.tsx`, `components/shell/user-menu.tsx` | `ComingLater` removed; the theme flip moved to `lib/apply-theme.ts` |
| `packages/app/src/routes-smoke.test.ts`, `docs/testing/ui-check-app-org.mts` | smoke with real assertions per screen; look-only check on Marko's organisation |
| `docs/testing/screens/README.md`, `docs/handoff.md`, `CLAUDE.md` | the record |

---

### Task 1: A run records what it cost

**Files:**
- Modify: `packages/db/src/schema.ts` (the `runs` table, after `resultCount`)
- Create: `packages/db/drizzle/0011_run_cost.sql` and its `meta/` entries — **generated**, see Step 2
- Create: `packages/api/src/crawl/record-run-cost.ts`, `packages/api/src/crawl/record-run-cost.test.ts`
- Modify: `packages/api/src/crawl/start-execution.ts` (`startExecution`), `packages/api/src/crawl/plan-source.ts` (`planSource`)

**Interfaces:**
- Consumes: `snapshotUsage`, `diffUsage`, `estimateCostUsd`, `recordUsage`, `resetUsage`, `type UsageByModel` from `@robot/agent` (`packages/agent/src/usage.ts`; prices are USD per million tokens — `claude-sonnet-5` is `{ input: 3, output: 15 }`); the `runs` table; `withBrowserSession`.
- Produces:
  ```ts
  // packages/db schema
  runs.costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0')   // Drizzle reads numeric as a string
  // packages/api/src/crawl/record-run-cost.ts
  export function costSince(before: UsageByModel): number;                       // estimateCostUsd(diffUsage(before, snapshotUsage())).usd
  export async function addRunCost(db: typeof Database, runId: string, usd: number): Promise<void>;  // cost_usd = cost_usd + usd; a no-op for usd <= 0 or a non-finite number
  ```

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema.ts`, in `export const runs = pgTable('runs', { … })`, directly after `resultCount: integer('result_count'),`:

```ts
  // What this run's model calls cost, in USD, summed over both of its phases
  // (planning in plan-source.ts, execution in start-execution.ts) the way
  // source_verifications.cost_usd is measured for a Verify: the process-wide
  // usage counter (@robot/agent usage.ts) snapshotted before and after the
  // browser session. Two paid things in flight at once attribute each other's
  // tokens to whichever finishes — the same limit the verification figure has.
  // Usage (spec 2026-09-21 §5) adds this and the verification figure up.
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
```

- [ ] **Step 2: Generate the migration and apply it**

Run, from the repo root:

```bash
pnpm --filter @robot/db exec drizzle-kit generate --name run_cost
```

Expected: a new `packages/db/drizzle/0011_run_cost.sql` whose whole content is

```sql
ALTER TABLE "runs" ADD COLUMN "cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL;
```

plus `packages/db/drizzle/meta/0011_snapshot.json` and a new entry in `meta/_journal.json`. If the generated SQL contains anything else, the schema has drifted from the last snapshot — stop and report it (`BLOCKED`), do not edit the SQL by hand.

Then apply it: `pnpm db:migrate`. Expected: the migration runs without error; `pnpm --filter @robot/db exec vitest run --maxWorkers=1 schema` stays green.

- [ ] **Step 3: Write the failing test for the cost helpers**

`packages/api/src/crawl/record-run-cost.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { recordUsage, resetUsage, snapshotUsage } from '@robot/agent';
import { costSince, addRunCost } from './record-run-cost.js';

// The usage counter is process-wide; every case starts and ends it empty so
// no other test in this worker sees these tokens.
afterEach(() => resetUsage());

describe('costSince', () => {
  it('prices the tokens recorded since the snapshot, at the list rates', () => {
    resetUsage();
    const before = snapshotUsage();
    // claude-sonnet-5: $3 per million input tokens, $15 per million output tokens (usage.ts).
    recordUsage('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 100_000 });
    expect(costSince(before)).toBeCloseTo(3 + 1.5, 6);
  });

  it('is zero when nothing was recorded', () => {
    resetUsage();
    expect(costSince(snapshotUsage())).toBe(0);
  });
});

describe('addRunCost', () => {
  it('adds to the run, twice, and ignores nothing-to-add', async () => {
    const [run] = await db.insert(runs).values({ status: 'planned', inputLabel: 'cost-test' }).returning({ id: runs.id });
    try {
      await addRunCost(db, run!.id, 0.0123);
      await addRunCost(db, run!.id, 0.0123);
      await addRunCost(db, run!.id, 0);
      await addRunCost(db, run!.id, Number.NaN);
      const row = await db.query.runs.findFirst({ where: eq(runs.id, run!.id), columns: { costUsd: true } });
      expect(Number(row!.costUsd)).toBeCloseTo(0.0246, 4);
    } finally {
      await db.delete(runs).where(eq(runs.id, run!.id));
    }
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 record-run-cost`
Expected: FAIL — `./record-run-cost.js` does not exist.

- [ ] **Step 5: Write the helpers**

`packages/api/src/crawl/record-run-cost.ts`:

```ts
// packages/api/src/crawl/record-run-cost.ts
// What a run's model calls cost, measured the way run-source-verification.ts
// measures a Verify: the process-wide usage counter before and after.

import { eq, sql } from 'drizzle-orm';
import { runs } from '@robot/db';
import type { db as Database } from '@robot/db';
import { snapshotUsage, diffUsage, estimateCostUsd, type UsageByModel } from '@robot/agent';

/** USD spent since `before` (a `snapshotUsage()`), at usage.ts's list rates. */
export function costSince(before: UsageByModel): number {
  return estimateCostUsd(diffUsage(before, snapshotUsage())).usd;
}

/**
 * Adds `usd` to the run's `cost_usd`. An increment, not an assignment: a run
 * is paid for in two phases (planning, then execution — sometimes execution
 * more than once, when a stalled run is resumed) and each must add its own
 * figure without reading the other's. Nothing-to-add is a no-op rather than a
 * round trip, and a NaN — an estimator fed a model it cannot price — must
 * never reach the column.
 */
export async function addRunCost(db: typeof Database, runId: string, usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd <= 0) return;
  await db.update(runs)
    .set({ costUsd: sql`${runs.costUsd} + ${usd.toFixed(4)}::numeric` })
    .where(eq(runs.id, runId));
}
```

- [ ] **Step 6: Run the test to see it pass**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 record-run-cost`
Expected: PASS (3 tests).

- [ ] **Step 7: Record the cost in both writers of a run**

In `packages/api/src/crawl/start-execution.ts`:

- add `import { snapshotUsage } from '@robot/agent';` beside the existing `SchemaAgent` import (extend that import line), and `import { addRunCost, costSince } from './record-run-cost.js';`
- in `startExecution`, take the snapshot before the `try`, and add a `finally` that records the cost. The whole function body becomes:

```ts
  // Snapshotted outside the try: the cost of a run that failed part-way is
  // still money the customer spent, and Usage must show it.
  const before = snapshotUsage();
  try {
    await withBrowserSession(async (browser) => {
      // … unchanged …
    });
  } catch (err) {
    // … unchanged …
  } finally {
    try {
      await addRunCost(db, runId, costSince(before));
    } catch (costErr) {
      // A cost that could not be written is a gap in Usage, not a broken run;
      // and this must not become the unhandled rejection the comment above
      // this function exists to prevent.
      console.error(`[crawl] failed to record cost for run ${runId}:`, costErr);
    }
  }
```

In `packages/api/src/crawl/plan-source.ts`:

- extend `import { SchemaAgent } from '@robot/agent';` to `import { SchemaAgent, snapshotUsage } from '@robot/agent';` and add `import { addRunCost, costSince } from './record-run-cost.js';`
- directly after the `const [run] = await db.insert(runs)…returning(…)` statement add `const before = snapshotUsage();`
- turn the existing `try { … } catch (err) { …; throw err; }` into `try { … } catch (err) { …; throw err; } finally { … }` with:

```ts
  } finally {
    // The planning walk's own model calls (pagination detection, the
    // catalogue judge) are this run's money too; execution adds its own later.
    try {
      await addRunCost(db, run!.id, costSince(before));
    } catch (costErr) {
      console.error(`[crawl] failed to record planning cost for run ${run!.id}:`, costErr);
    }
  }
```

- [ ] **Step 8: Run the neighbouring suites**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 start-execution plan-source record-run-cost`
Expected: PASS — the existing `start-execution` and `plan-source` tests are unaffected (they exercise `buildOnDone`/`buildFinalise` and planning outcomes, not the usage counter).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0011_run_cost.sql packages/db/drizzle/meta/0011_snapshot.json packages/db/drizzle/meta/_journal.json packages/api/src/crawl/record-run-cost.ts packages/api/src/crawl/record-run-cost.test.ts packages/api/src/crawl/start-execution.ts packages/api/src/crawl/plan-source.ts
git commit -m "feat(api): a run records what its model calls cost" -- packages/db/src/schema.ts packages/db/drizzle/0011_run_cost.sql packages/db/drizzle/meta/0011_snapshot.json packages/db/drizzle/meta/_journal.json packages/api/src/crawl/record-run-cost.ts packages/api/src/crawl/record-run-cost.test.ts packages/api/src/crawl/start-execution.ts packages/api/src/crawl/plan-source.ts
```

---

### Task 2: `runs.listByOrg`, `usage.byProject`, `auth.updateName`, and a team delete that is not a sign-out

**Files:**
- Modify: `packages/api/src/routers/runs.ts` (add `listByOrg`), `packages/api/src/routers/auth.ts` (add `updateName`), `packages/api/src/routers/orgs.ts` (`delete`), `packages/api/src/routers/index.ts` (mount `usage`)
- Create: `packages/api/src/routers/usage.ts`
- Test: `packages/api/src/routers/org-screens.test.ts` (new); `packages/api/src/routers/orgs.test.ts` (one assertion changes, see Step 8)

**Interfaces:**
- Consumes: `protectedProcedure`, `requireRole`, `ctx.session` (`SessionInfo` in `trpc.ts`); tables `runs, sources, datasets, projects, sourceVerifications, captures, users, orgs, sessions`; the `signIn` / `dropIdentity` helpers copied from `projects-get.test.ts`.
- Produces:
  ```ts
  // runs.listByOrg — protectedProcedure, no input
  Array<{ id: string; status: string; inputLabel: string | null; startedAt: Date | null; completedAt: Date | null;
          resultCount: number | null; errorMessage: string | null; createdAt: Date; costUsd: number;
          project: { name: string; slug: string }; website: { name: string; slug: string } }>   // newest first, 100 at most
  // usage.byProject — protectedProcedure
  input:  { month: string /* 'YYYY-MM', UTC */ }
  output: { month: string;
            projects: Array<{ id: string; name: string; slug: string; spendUsd: number; pagesCaptured: number }>;  // every project in the org, spend desc then name asc
            total: { spendUsd: number; pagesCaptured: number } }
  // auth.updateName — protectedProcedure
  input: { name: string /* trimmed, 1..255 */ }   output: { name: string }
  // orgs.delete — unchanged input; output gains the org the session now stands on
  output: { ok: true; nextOrg: { id: string; slug: string; name: string } }
  ```

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routers/org-screens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, users, runs, captures, sourceVerifications, memberships } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const tag = `orgscr-${Date.now()}`;

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

/** A fresh caller on the same token, after something changed the session row. */
async function reload(r: Awaited<ReturnType<typeof signIn>>) {
  const session = (await loadSession(db, r.session.token))!;
  return { session, caller: createCallerFactory(appRouter)({ db, session }) };
}

const AUG = new Date('2026-08-15T12:00:00Z');
const SEP = new Date('2026-09-10T12:00:00Z');

describe('runs.listByOrg', () => {
  it('lists every run in the session org newest first, with its project and website, and nothing from another org', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-r1@example.com`);
      b = await signIn(`${tag}-r2@example.com`);
      const p = await a.caller.projects.create({ name: 'Prices' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://shop.example.com/x' });
      const q = await b.caller.projects.create({ name: 'Elsewhere' });
      const v = await b.caller.sources.createInProject({ projectSlug: q.slug, name: 'Other', url: 'https://other.example.com/x' });
      await db.insert(runs).values([
        { sourceId: w.sourceId, status: 'completed', startedAt: AUG, completedAt: AUG, resultCount: 3, createdAt: AUG, costUsd: '0.0200' },
        { sourceId: w.sourceId, status: 'extracting', startedAt: SEP, createdAt: SEP },
        { sourceId: v.sourceId, status: 'completed', completedAt: SEP, createdAt: SEP },
      ]);

      const got = await a.caller.runs.listByOrg();
      expect(got.map((r) => r.status)).toEqual(['extracting', 'completed']);
      expect(got[1]).toMatchObject({ resultCount: 3, costUsd: 0.02, project: { name: 'Prices', slug: p.slug }, website: { name: 'Shop', slug: w.slug } });
      expect(got.every((r) => r.website.slug === w.slug)).toBe(true);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('refuses without a session', async () => {
    const anon = createCallerFactory(appRouter)({ db, session: null });
    await expect(anon.runs.listByOrg()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('usage.byProject', () => {
  it('adds verification and run spend and counts pages captured, per project, for the month asked', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-u1@example.com`);
      const p = await a.caller.projects.create({ name: 'Busy' });
      const quiet = await a.caller.projects.create({ name: 'Quiet' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://shop.example.com/x' });
      await db.insert(sourceVerifications).values([
        { sourceId: w.sourceId, definitionHash: 'h'.repeat(64), startedAt: SEP, completedAt: SEP, costUsd: '0.0300' },
        { sourceId: w.sourceId, definitionHash: 'h'.repeat(64), startedAt: AUG, completedAt: AUG, costUsd: '1.0000' },
      ]);
      await db.insert(runs).values([
        { sourceId: w.sourceId, status: 'completed', completedAt: SEP, createdAt: SEP, costUsd: '0.0200' },
        { sourceId: w.sourceId, status: 'failed', completedAt: AUG, createdAt: AUG, costUsd: '2.0000' },
      ]);
      await db.insert(captures).values([
        { sourceId: w.sourceId, url: 'https://shop.example.com/1', createdAt: SEP },
        { sourceId: w.sourceId, url: 'https://shop.example.com/2', createdAt: SEP },
        { sourceId: w.sourceId, url: 'https://shop.example.com/3', createdAt: AUG },
      ]);

      const sep = await a.caller.usage.byProject({ month: '2026-09' });
      expect(sep.month).toBe('2026-09');
      expect(sep.projects.map((r) => [r.name, r.spendUsd, r.pagesCaptured])).toEqual([['Busy', 0.05, 2], ['Quiet', 0, 0]]);
      expect(sep.total).toEqual({ spendUsd: 0.05, pagesCaptured: 2 });

      const aug = await a.caller.usage.byProject({ month: '2026-08' });
      expect(aug.total).toEqual({ spendUsd: 3, pagesCaptured: 1 });

      const empty = await a.caller.usage.byProject({ month: '2026-07' });
      expect(empty.projects.map((r) => r.spendUsd)).toEqual([0, 0]);
      expect(empty.total).toEqual({ spendUsd: 0, pagesCaptured: 0 });
    } finally {
      if (a) await dropIdentity(a);
    }
  });

  it('rejects a month that is not YYYY-MM', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-u2@example.com`);
      await expect(a.caller.usage.byProject({ month: '2026-9' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});

describe('auth.updateName', () => {
  it('renames the signed-in user and me() says so', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-n1@example.com`);
      expect(await a.caller.auth.updateName({ name: '  Ada Lovelace ' })).toEqual({ name: 'Ada Lovelace' });
      const { caller } = await reload(a);
      expect((await caller.auth.me()).user.name).toBe('Ada Lovelace');
      await expect(a.caller.auth.updateName({ name: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});

describe('orgs.delete', () => {
  it("moves the caller's session to their personal organisation before the team goes", async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-d1@example.com`);
      const team = await a.caller.orgs.create({ name: `Team ${tag}` });
      const onTeam = await reload(a);
      expect(onTeam.session.org.id).toBe(team.id);

      const res = await onTeam.caller.orgs.delete();
      expect(res).toMatchObject({ ok: true, nextOrg: { id: a.org.id, slug: a.org.slug } });
      const after = await reload(a);
      expect(after.session.org.id).toBe(a.org.id);
      expect((await after.caller.auth.me()).orgs.map((o) => o.id)).toEqual([a.org.id]);
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 org-screens`
Expected: FAIL — `runs.listByOrg`, `usage`, `auth.updateName` are not on the router; the delete case fails on `nextOrg`.

- [ ] **Step 3: `runs.listByOrg`**

In `packages/api/src/routers/runs.ts`, extend the imports so `datasets, projects, sources` from `@robot/db` and `protectedProcedure` from `../trpc.js` are available (keep what is already imported), and add after `listBySource`:

```ts
  /**
   * Every run in the session's organisation, newest first (spec 2026-09-21
   * §5, the org-wide Runs page). Session-only — the old dashboard has no such
   * screen, so there is no `orgSlug` to shim. Scoped through the run's
   * website → project → org in one join; a run with no website (a legacy row)
   * belongs to nobody and is not listed, as `runInOrg` also rules.
   */
  listByOrg: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: runs.id, status: runs.status, inputLabel: runs.inputLabel,
        startedAt: runs.startedAt, completedAt: runs.completedAt, resultCount: runs.resultCount,
        errorMessage: runs.errorMessage, createdAt: runs.createdAt, costUsd: runs.costUsd,
        projectName: projects.name, projectSlug: projects.slug,
        websiteName: sources.name, websiteSlug: sources.slug,
      })
      .from(runs)
      .innerJoin(sources, eq(runs.sourceId, sources.id))
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(eq(projects.orgId, ctx.session.org.id))
      .orderBy(desc(runs.createdAt))
      .limit(100);
    return rows.map(({ projectName, projectSlug, websiteName, websiteSlug, costUsd, ...run }) => ({
      ...run,
      costUsd: Number(costUsd),
      project: { name: projectName, slug: projectSlug },
      website: { name: websiteName, slug: websiteSlug },
    }));
  }),
```

- [ ] **Step 4: `usage.byProject`**

`packages/api/src/routers/usage.ts`:

```ts
import { z } from 'zod';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { captures, datasets, projects, runs, sourceVerifications, sources } from '@robot/db';
import { router, protectedProcedure } from '../trpc.js';

/** `[first instant of the month, first instant of the next)`, in UTC. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/**
 * What the organisation spent this month and how many pages it captured, per
 * project (spec 2026-09-21 §5). Spend is `source_verifications.cost_usd` (by
 * the verification's start) plus `runs.cost_usd` (by the run's creation);
 * pages are `captures` rows (by creation). Every project in the org is listed,
 * a quiet one at zero — the table is the org's projects, not its receipts.
 */
export const usageRouter = router({
  byProject: protectedProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM') }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.session.org.id;
      const { start, end } = monthBounds(input.month);
      // `AnyPgColumn`, not one table's column type: the three timestamps live
      // on three tables and Drizzle types each by its table.
      const inMonth = (col: AnyPgColumn) => and(gte(col, start), lt(col, end));

      const list = await ctx.db.select({ id: projects.id, name: projects.name, slug: projects.slug })
        .from(projects).where(eq(projects.orgId, orgId));

      const bySource = (extra: ReturnType<typeof and>) => and(eq(projects.orgId, orgId), extra);

      const verificationSpend = await ctx.db
        .select({ projectId: projects.id, usd: sql<string>`coalesce(sum(${sourceVerifications.costUsd}), 0)` })
        .from(sourceVerifications)
        .innerJoin(sources, eq(sourceVerifications.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(bySource(inMonth(sourceVerifications.startedAt)))
        .groupBy(projects.id);

      const runSpend = await ctx.db
        .select({ projectId: projects.id, usd: sql<string>`coalesce(sum(${runs.costUsd}), 0)` })
        .from(runs)
        .innerJoin(sources, eq(runs.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(bySource(inMonth(runs.createdAt)))
        .groupBy(projects.id);

      const pages = await ctx.db
        .select({ projectId: projects.id, n: sql<number>`count(*)::int` })
        .from(captures)
        .innerJoin(sources, eq(captures.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(bySource(inMonth(captures.createdAt)))
        .groupBy(projects.id);

      const spend = new Map<string, number>();
      for (const r of [...verificationSpend, ...runSpend]) spend.set(r.projectId, (spend.get(r.projectId) ?? 0) + Number(r.usd));
      const captured = new Map(pages.map((r) => [r.projectId, Number(r.n)]));

      // Four decimals in the column, four decimals out: summing floats from
      // two tables must not turn 0.03 + 0.02 into 0.049999….
      const round = (n: number) => Math.round(n * 10_000) / 10_000;
      const rows = list
        .map((p) => ({ ...p, spendUsd: round(spend.get(p.id) ?? 0), pagesCaptured: captured.get(p.id) ?? 0 }))
        .sort((a, b) => b.spendUsd - a.spendUsd || a.name.localeCompare(b.name));
      return {
        month: input.month,
        projects: rows,
        total: {
          spendUsd: round(rows.reduce((s, r) => s + r.spendUsd, 0)),
          pagesCaptured: rows.reduce((s, r) => s + r.pagesCaptured, 0),
        },
      };
    }),
});
```

Mount it in `packages/api/src/routers/index.ts` beside the others: `import { usageRouter } from './usage.js';` and `usage: usageRouter,` in `appRouter`.

- [ ] **Step 5: `auth.updateName`**

In `packages/api/src/routers/auth.ts`, after `setTheme`:

```ts
  updateName: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users).set({ name: input.name, updatedAt: new Date() }).where(eq(users.id, ctx.session.user.id));
      return { name: input.name };
    }),
```

- [ ] **Step 6: `orgs.delete` moves the caller first**

Replace the `delete` procedure in `packages/api/src/routers/orgs.ts` with:

```ts
  delete: protectedProcedure.mutation(async ({ ctx }) => {
    requireRole(ctx.session, ['owner']);
    if (ctx.session.org.personal) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'A personal organisation cannot be deleted' });
    // The caller's session would cascade away with the org row and sign them
    // out — of everything, for deleting one team. Their personal organisation
    // always exists (signIn creates it and nothing deletes it), so the session
    // moves there first; the other members' sessions on this org do cascade,
    // and the app sends them to /login, which is the honest outcome for them.
    const personal = await ctx.db.query.orgs.findFirst({
      where: and(eq(orgs.ownerUserId, ctx.session.user.id), eq(orgs.personal, true)),
      columns: { id: true, slug: true, name: true },
    });
    if (!personal) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'This account has no personal organisation' });
    await ctx.db.transaction(async (tx) => {
      await tx.update(sessions).set({ orgId: personal.id }).where(eq(sessions.token, ctx.session.token));
      // Projects, datasets, websites and runs cascade from the org row (schema.ts).
      await tx.delete(orgs).where(eq(orgs.id, ctx.session.org.id));
    });
    return { ok: true as const, nextOrg: personal };
  }),
```

- [ ] **Step 7: Run the new tests**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 org-screens`
Expected: PASS (7 tests).

- [ ] **Step 8: Keep the existing org and auth suites green**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 orgs auth runs`
Expected: PASS unchanged. `orgs.test.ts`'s first case deletes the team as A and then signs A in again, expecting to land on the personal org — which still holds (the sign-in follows the last session's org, and that is now the personal one). Its comment ("Deleting the team org cascaded A's session") is no longer true: reword it to say the session moved to A's personal organisation, and the re-sign-in is now only proving where a fresh session lands. Nothing else in the three files changes; if something else fails, report it rather than editing around it.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/routers/runs.ts packages/api/src/routers/usage.ts packages/api/src/routers/index.ts packages/api/src/routers/auth.ts packages/api/src/routers/orgs.ts packages/api/src/routers/org-screens.test.ts packages/api/src/routers/orgs.test.ts
git commit -m "feat(api): runs.listByOrg, usage.byProject, auth.updateName; deleting a team keeps you signed in" -- packages/api/src/routers/runs.ts packages/api/src/routers/usage.ts packages/api/src/routers/index.ts packages/api/src/routers/auth.ts packages/api/src/routers/orgs.ts packages/api/src/routers/org-screens.test.ts packages/api/src/routers/orgs.test.ts
```

---

### Task 3: `/runs` — every run in the organisation

**Files:**
- Create: `packages/app/src/lib/org-runs-view.ts`, `packages/app/src/lib/org-runs-view.test.ts`, `packages/app/src/components/runs/org-runs-table.tsx`
- Modify: `packages/app/src/routes/_app/runs.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `runsView`, `type RunRow`, `type RunView` from `lib/runs-view.ts`; `RunDot`; `runs.listByOrg` (Task 2); the table grammar of `components/runs/runs-table.tsx`.
- Produces:
  ```ts
  export type OrgRunRow = RunRow & { costUsd: number; project: { name: string; slug: string }; website: { name: string; slug: string } };
  export type OrgRunView = RunView & { projectName: string; projectSlug: string; websiteName: string; websiteSlug: string };
  export function orgRunsView(rows: readonly OrgRunRow[], now?: Date): OrgRunView[];   // newest first, like runsView
  export function anyRunning(views: readonly { state: RunView['state'] }[]): boolean;    // the poll's stop condition
  ```

- [ ] **Step 1: Write the failing test**

`packages/app/src/lib/org-runs-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orgRunsView, anyRunning, type OrgRunRow } from './org-runs-view';

const now = new Date('2026-09-24T12:00:00Z');
const base = { inputLabel: null, errorMessage: null, resultCount: null, startedAt: null, completedAt: null, costUsd: 0 };
const row = (over: Partial<OrgRunRow>): OrgRunRow => ({
  id: 'r', status: 'completed', createdAt: now,
  project: { name: 'Prices', slug: 'prices' }, website: { name: 'Shop', slug: 'shop' },
  ...base, ...over,
});

describe('orgRunsView', () => {
  it('keeps runsView’s labels and adds where the run belongs, newest first', () => {
    const views = orgRunsView([
      row({ id: 'old', createdAt: new Date('2026-09-20T12:00:00Z'), startedAt: new Date('2026-09-20T12:00:00Z'), completedAt: new Date('2026-09-20T12:00:12Z'), resultCount: 3 }),
      row({ id: 'new', status: 'extracting', createdAt: now, website: { name: 'Other', slug: 'other' } }),
    ], now);
    expect(views.map((v) => v.id)).toEqual(['new', 'old']);
    expect(views[0]).toMatchObject({ state: 'running', statusLabel: 'Running', websiteName: 'Other', websiteSlug: 'other', projectSlug: 'prices' });
    expect(views[1]).toMatchObject({ state: 'done', rowsLabel: '3 rows', durationLabel: '12 s', startedLabel: '4 d ago' });
  });

  it('does not touch the rows it is given', () => {
    const rows = [row({ id: 'b', createdAt: new Date(1) }), row({ id: 'a', createdAt: new Date(2) })];
    orgRunsView(rows, now);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('anyRunning', () => {
  it('is true only while some dot is running', () => {
    expect(anyRunning([{ state: 'done' }, { state: 'running' }])).toBe(true);
    expect(anyRunning([{ state: 'done' }, { state: 'failed' }, { state: 'idle' }])).toBe(false);
    expect(anyRunning([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 org-runs-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the view module**

`packages/app/src/lib/org-runs-view.ts`:

```ts
import { runsView, type RunRow, type RunView } from './runs-view';

/** One row of `runs.listByOrg`: a website's run row plus where it belongs. */
export type OrgRunRow = RunRow & {
  costUsd: number;
  project: { name: string; slug: string };
  website: { name: string; slug: string };
};

export type OrgRunView = RunView & {
  projectName: string;
  projectSlug: string;
  websiteName: string;
  websiteSlug: string;
};

/**
 * The org-wide table is the website table with two more columns: the same
 * words for the same run (`runsView` is the one place a run is put into
 * words), joined back to its project and website by id.
 */
export function orgRunsView(rows: readonly OrgRunRow[], now: Date = new Date()): OrgRunView[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return runsView(rows, now).map((view) => {
    const row = byId.get(view.id)!;
    return {
      ...view,
      projectName: row.project.name,
      projectSlug: row.project.slug,
      websiteName: row.website.name,
      websiteSlug: row.website.slug,
    };
  });
}

/** The poll's stop condition: refetch only while something is actually moving. */
export function anyRunning(views: readonly { state: RunView['state'] }[]): boolean {
  return views.some((v) => v.state === 'running');
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 org-runs-view`
Expected: PASS (3 tests).

- [ ] **Step 5: The table**

`packages/app/src/components/runs/org-runs-table.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { RunDot } from '../run-dot';
import { Skeleton } from '../ui/skeleton';
import type { OrgRunView } from '../../lib/org-runs-view';

/**
 * Every run in the organisation (spec §5 `/runs`): the website's Runs table
 * with the project and website columns the website page does not need. The
 * dot is here too — this is the screen the spec names for "is anything
 * running", so the pulse must be the first thing in each row after its age.
 */
export function OrgRunsTable({ runs, loading }: { runs: OrgRunView[]; loading: boolean }) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      {/* Below `md` the table keeps its real width and the container scrolls (spec §3). */}
      <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
        <table className="w-full min-w-[760px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col className="w-[132px]" />
            <col className="w-[176px]" />
            <col />
            <col />
            <col className="w-[104px]" />
            <col className="w-[116px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
              <th className="px-4 text-left text-sm">Started</th>
              <th className="px-3 text-left text-sm">Status</th>
              <th className="px-3 text-left text-sm">Project</th>
              <th className="px-3 text-left text-sm">Website</th>
              <th className="px-3 text-right text-sm">Rows</th>
              <th className="px-4 text-right text-sm">Duration</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <LoadingRows /> : null}
            {!loading &&
              runs.map((run) => (
                <tr key={run.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Link
                      to="/projects/$project/sites/$site/runs/$run"
                      params={{ project: run.projectSlug, site: run.websiteSlug, run: run.id }}
                      className="font-mono text-text underline-offset-4 hover:underline"
                    >
                      {run.startedLabel}
                    </Link>
                    {run.error ? <div className="mt-0.5 text-sm text-fail">{run.error}</div> : null}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <RunDot status={run.state} detail={run.startedLabel} />
                      {run.statusLabel}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2.5">
                    <Link to="/projects/$project" params={{ project: run.projectSlug }} className="hover:underline underline-offset-4">
                      {run.projectName}
                    </Link>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2.5">
                    <Link
                      to="/projects/$project/sites/$site"
                      params={{ project: run.projectSlug, site: run.websiteSlug }}
                      className="hover:underline underline-offset-4"
                    >
                      {run.websiteName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                    {run.rowsLabel ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                    {run.durationLabel ?? '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-line last:border-0">
          <td className="px-4 py-2.5">
            <Skeleton className="h-3.5 w-20 bg-raised" />
          </td>
          <td colSpan={5} />
        </tr>
      ))}
    </>
  );
}
```

- [ ] **Step 6: The screen**

Replace `packages/app/src/routes/_app/runs.tsx` with:

```tsx
import { Link, createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { OrgRunsTable } from '../../components/runs/org-runs-table';
import { anyRunning, orgRunsView } from '../../lib/org-runs-view';
import { trpc } from '../../lib/trpc';
import { useUnauthorizedRedirect } from '../../lib/use-unauthorized-redirect';

export const Route = createFileRoute('/_app/runs')({
  component: RunsPage,
});

/** How often the table asks again while a run is moving. Nothing polls once every dot is still. */
const RUNNING_POLL_MS = 5_000;

function RunsPage() {
  const runs = trpc.runs.listByOrg.useQuery(undefined, {
    // The stop condition is the rows themselves: a page with nothing running
    // is a static page, and refetching it every five seconds would keep the
    // api-server busy for nobody.
    refetchInterval: (query) => (anyRunning(orgRunsView(query.state.data ?? [])) ? RUNNING_POLL_MS : false),
  });
  const rows = orgRunsView(runs.data ?? []);
  const unauthorized = useUnauthorizedRedirect(runs);

  const empty = !runs.isPending && !runs.isError && rows.length === 0;
  const showTable = runs.isPending || rows.length > 0;

  return (
    <Page title="Runs">
      {showTable ? <OrgRunsTable runs={rows} loading={runs.isPending} /> : null}

      {empty ? (
        <div className="rise rounded-[6px] border border-line bg-panel px-4 py-10 text-center [box-shadow:var(--shadow)]">
          <p className="text-base text-muted-foreground">
            No runs yet. Start one from a website's Extract tab —{' '}
            <Link to="/projects" className="text-text underline-offset-4 hover:underline">
              your projects
            </Link>
            .
          </p>
        </div>
      ) : null}

      {runs.isError && !unauthorized ? (
        <p role="alert" className="rise text-base text-fail">
          The runs could not be loaded. Try again.
        </p>
      ) : null}
    </Page>
  );
}
```

- [ ] **Step 7: Typecheck and look**

Run: `pnpm --filter @robot/app exec tsc --noEmit`
Expected: no errors.

Browser check (the api-server and app must be running — `pnpm dev:all` in another terminal if not): sign in through `/login` as `runs-<timestamp>@example.com`, open `/runs`: the empty state with its link. Do **not** sign in as anyone else. Report the address used. Confirm in the network panel that `runs.listByOrg` is requested once and not again (no run is moving).

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/lib/org-runs-view.ts packages/app/src/lib/org-runs-view.test.ts packages/app/src/components/runs/org-runs-table.tsx packages/app/src/routes/_app/runs.tsx
git commit -m "feat(app): the organisation's Runs page" -- packages/app/src/lib/org-runs-view.ts packages/app/src/lib/org-runs-view.test.ts packages/app/src/components/runs/org-runs-table.tsx packages/app/src/routes/_app/runs.tsx
```

---

### Task 4: `/usage` — this month, per project, one 28 px total

**Files:**
- Create: `packages/app/src/lib/usage-view.ts`, `packages/app/src/lib/usage-view.test.ts`, `packages/app/src/components/usage/usage-total.tsx`, `packages/app/src/components/usage/usage-table.tsx`, `packages/app/src/components/usage/month-stepper.tsx`
- Modify: `packages/app/src/routes/_app/usage.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `usage.byProject` (Task 2); `Button`; `lucide-react` `ChevronLeft`, `ChevronRight`.
- Produces:
  ```ts
  export function monthKey(d: Date): string;                       // 'YYYY-MM' in UTC
  export function shiftMonth(key: string, delta: number): string;  // '2026-01' - 1 → '2025-12'
  export function monthLabel(key: string): string;                 // 'September 2026'
  export function usdLabel(n: number): string;                     // '$0.00', '$0.05', '$12.30', '< $0.01' for 0 < n < 0.005
  export function pagesLabel(n: number): string;                   // '1 page' / '2 pages' / '0 pages'
  export type UsageRow = { id: string; name: string; slug: string; spendUsd: number; pagesCaptured: number };
  export type UsageRowView = UsageRow & { spendLabel: string; pagesLabel: string };
  export function usageView(rows: readonly UsageRow[]): UsageRowView[];   // order as given (the API sorts)
  ```

- [ ] **Step 1: Write the failing test**

`packages/app/src/lib/usage-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { monthKey, shiftMonth, monthLabel, usdLabel, pagesLabel, usageView } from './usage-view';

describe('months', () => {
  it('keys a date by its UTC month', () => {
    expect(monthKey(new Date('2026-09-24T23:30:00Z'))).toBe('2026-09');
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
  it('steps across a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-09', -3)).toBe('2026-06');
  });
  it('names a month', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2025-12')).toBe('December 2025');
  });
});

describe('usdLabel', () => {
  it('shows cents, and says when there is less than a cent', () => {
    expect(usdLabel(0)).toBe('$0.00');
    expect(usdLabel(0.05)).toBe('$0.05');
    expect(usdLabel(12.3)).toBe('$12.30');
    expect(usdLabel(0.004)).toBe('< $0.01');
    expect(usdLabel(0.005)).toBe('$0.01');
    expect(usdLabel(1234.5)).toBe('$1234.50');
  });
});

describe('pagesLabel', () => {
  it('counts pages', () => {
    expect(pagesLabel(0)).toBe('0 pages');
    expect(pagesLabel(1)).toBe('1 page');
    expect(pagesLabel(240)).toBe('240 pages');
  });
});

describe('usageView', () => {
  it('labels each row and keeps the order it was given', () => {
    const rows = usageView([
      { id: 'a', name: 'Busy', slug: 'busy', spendUsd: 0.05, pagesCaptured: 2 },
      { id: 'b', name: 'Quiet', slug: 'quiet', spendUsd: 0, pagesCaptured: 0 },
    ]);
    expect(rows.map((r) => [r.name, r.spendLabel, r.pagesLabel])).toEqual([['Busy', '$0.05', '2 pages'], ['Quiet', '$0.00', '0 pages']]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 usage-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the view module**

`packages/app/src/lib/usage-view.ts`:

```ts
/**
 * The Usage screen's words (spec §5 `/usage`). Months are UTC keys so the
 * screen and `usage.byProject` agree on where a month starts, whatever the
 * browser's zone; the same reason `isoDate` in projects-view is UTC.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Cents, like every other price in the app. Below half a cent the figure is
 * not zero — a verification that cost $0.004 was not free — so it says so
 * instead of rounding to a "$0.00" the customer would read as nothing spent.
 */
export function usdLabel(n: number): string {
  if (n > 0 && n < 0.005) return '< $0.01';
  return `$${n.toFixed(2)}`;
}

export function pagesLabel(n: number): string {
  return `${n} ${n === 1 ? 'page' : 'pages'}`;
}

export type UsageRow = { id: string; name: string; slug: string; spendUsd: number; pagesCaptured: number };
export type UsageRowView = UsageRow & { spendLabel: string; pagesLabel: string };

/** Labels only; the API already orders by spend then name. Pure. */
export function usageView(rows: readonly UsageRow[]): UsageRowView[] {
  return rows.map((r) => ({ ...r, spendLabel: usdLabel(r.spendUsd), pagesLabel: pagesLabel(r.pagesCaptured) }));
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 usage-view`
Expected: PASS (7 tests).

- [ ] **Step 5: The three panels**

`packages/app/src/components/usage/month-stepper.tsx`:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel } from '../../lib/usage-view';

/**
 * Which month the screen shows. Back is always possible; forward stops at
 * the current month — and rather than a disabled button that would owe the
 * reader a reason, the forward arrow is simply not there past it. A spacer
 * keeps the label from shifting when the arrow comes and goes.
 */
export function MonthStepper({
  month,
  isCurrent,
  onChange,
}: {
  month: string;
  isCurrent: boolean;
  onChange: (delta: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(-1)}
        className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-raised hover:text-text"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[132px] text-center text-base" aria-live="polite">
        {monthLabel(month)}
      </span>
      {isCurrent ? (
        <span aria-hidden className="size-7" />
      ) : (
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onChange(1)}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-raised hover:text-text"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}
```

`packages/app/src/components/usage/usage-total.tsx`:

```tsx
import { Skeleton } from '../ui/skeleton';
import { pagesLabel, usdLabel } from '../../lib/usage-view';

/**
 * The one 28 px figure in the app (spec §4): what the organisation spent in
 * the month shown. Pages captured is its secondary line — a count, not money,
 * so it does not compete for the headline.
 */
export function UsageTotal({ spendUsd, pagesCaptured, loading }: { spendUsd: number; pagesCaptured: number; loading: boolean }) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel px-4 py-4 [box-shadow:var(--shadow)]">
      <div className="text-sm text-muted-foreground">Spend this month</div>
      {loading ? (
        <Skeleton className="mt-1 h-8 w-32 bg-raised" />
      ) : (
        <div className="mt-1 font-mono text-3xl font-semibold tabular-nums" data-testid="usage-total">
          {usdLabel(spendUsd)}
        </div>
      )}
      <div className="mt-1 text-sm text-muted-foreground">{loading ? '' : `${pagesLabel(pagesCaptured)} captured`}</div>
    </div>
  );
}
```

`packages/app/src/components/usage/usage-table.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { Skeleton } from '../ui/skeleton';
import type { UsageRowView } from '../../lib/usage-view';

/** Per project: what it cost and how many pages it took. Every project is a row, a quiet one at $0.00. */
export function UsageTable({ rows, loading }: { rows: UsageRowView[]; loading: boolean }) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
        <table className="w-full min-w-[480px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col />
            <col className="w-[116px]" />
            <col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
              <th className="px-4 text-left text-sm">Project</th>
              <th className="px-3 text-right text-sm">Spend</th>
              <th className="px-4 text-right text-sm">Pages captured</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1].map((i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5"><Skeleton className="h-3.5 w-32 bg-raised" /></td>
                    <td colSpan={2} />
                  </tr>
                ))
              : rows.map((r) => (
                  <tr key={r.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                    <td className="max-w-0 truncate px-4 py-2.5">
                      <Link to="/projects/$project" params={{ project: r.slug }} className="text-text underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">{r.spendLabel}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">{r.pagesLabel}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: The screen**

Replace `packages/app/src/routes/_app/usage.tsx` with:

```tsx
import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { MonthStepper } from '../../components/usage/month-stepper';
import { UsageTable } from '../../components/usage/usage-table';
import { UsageTotal } from '../../components/usage/usage-total';
import { monthKey, shiftMonth, usageView } from '../../lib/usage-view';
import { trpc } from '../../lib/trpc';
import { useUnauthorizedRedirect } from '../../lib/use-unauthorized-redirect';

export const Route = createFileRoute('/_app/usage')({
  component: UsagePage,
});

function UsagePage() {
  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const usage = trpc.usage.byProject.useQuery({ month });
  const rows = usageView(usage.data?.projects ?? []);
  const unauthorized = useUnauthorizedRedirect(usage);

  const empty = !usage.isPending && !usage.isError && rows.length === 0;

  return (
    <Page
      title="Usage"
      actions={<MonthStepper month={month} isCurrent={month === current} onChange={(d) => setMonth((m) => shiftMonth(m, d))} />}
    >
      <div className="space-y-4">
        <UsageTotal
          spendUsd={usage.data?.total.spendUsd ?? 0}
          pagesCaptured={usage.data?.total.pagesCaptured ?? 0}
          loading={usage.isPending}
        />

        {empty ? (
          <div className="rise rounded-[6px] border border-line bg-panel px-4 py-10 text-center [box-shadow:var(--shadow)]">
            <p className="text-base text-muted-foreground">
              No projects yet —{' '}
              <Link to="/projects" className="text-text underline-offset-4 hover:underline">
                create one
              </Link>{' '}
              and its spend will show here.
            </p>
          </div>
        ) : (
          <UsageTable rows={rows} loading={usage.isPending} />
        )}

        {usage.isError && !unauthorized ? (
          <p role="alert" className="rise text-base text-fail">
            Usage could not be loaded. Try again.
          </p>
        ) : null}
      </div>
    </Page>
  );
}
```

- [ ] **Step 7: Typecheck and look**

Run: `pnpm --filter @robot/app exec tsc --noEmit` — no errors.

Browser check as `usage-<timestamp>@example.com` (through `/login`; report the address): `/usage` shows `$0.00`, "0 pages captured", the empty state; create a project through **New project** on `/projects`, return to `/usage`: the project is a row at `$0.00` / `0 pages`. Step back a month and forward again; the forward arrow disappears at the current month. Delete the throwaway project through its own UI if the project page offers it, otherwise leave it — never touch anything else.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/lib/usage-view.ts packages/app/src/lib/usage-view.test.ts packages/app/src/components/usage/month-stepper.tsx packages/app/src/components/usage/usage-total.tsx packages/app/src/components/usage/usage-table.tsx packages/app/src/routes/_app/usage.tsx
git commit -m "feat(app): the Usage page — spend and pages captured, per project" -- packages/app/src/lib/usage-view.ts packages/app/src/lib/usage-view.test.ts packages/app/src/components/usage/month-stepper.tsx packages/app/src/components/usage/usage-total.tsx packages/app/src/components/usage/usage-table.tsx packages/app/src/routes/_app/usage.tsx
```

---

### Task 5: `/settings` — the organisation: general, members, danger zone

**Files:**
- Create: `packages/app/src/lib/org-settings-view.ts`, `packages/app/src/lib/org-settings-view.test.ts`, `packages/app/src/components/org/general-panel.tsx`, `packages/app/src/components/org/members-table.tsx`, `packages/app/src/components/org/remove-member-dialog.tsx`, `packages/app/src/components/org/delete-org-dialog.tsx`
- Modify: `packages/app/src/routes/_app/settings.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `orgs.rename`, `orgs.members.list / setRole / remove`, `orgs.delete` (Task 2 shape); `projects.list` (for the delete dialog's count); `session.currentOrg.{name, role, personal}`, `session.user.id`; `AvatarSquare` (`components/shell/avatar.tsx`); `Select*`, `Button`, `Input`, `Label`, `Dialog*`.
- Produces:
  ```ts
  export type Role = 'owner' | 'admin' | 'member';
  export function roleLabel(role: Role): string;                                    // 'Owner' | 'Admin' | 'Member'
  export function renameNote(role: Role): string | null;                            // null when allowed; else the reason
  export function roleOptions(caller: Role): Role[];                                // owner → all three; admin → ['admin','member']; member → []
  export function roleNote(a: { caller: Role; target: Role }): string | null;       // why the Select is off
  export function removeNote(a: { caller: Role; target: Role; isSelf: boolean }): string | null;
  export function deleteNote(a: { role: Role; personal: boolean }): string | null;
  export function deleteSummary(projectCount: number): string;                     // what goes with the organisation
  ```

- [ ] **Step 1: Write the failing test**

`packages/app/src/lib/org-settings-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roleLabel, renameNote, roleOptions, roleNote, removeNote, deleteNote, deleteSummary } from './org-settings-view';

describe('roles on the Settings page (spec §2)', () => {
  it('labels roles in sentence case', () => {
    expect(['owner', 'admin', 'member'].map((r) => roleLabel(r as never))).toEqual(['Owner', 'Admin', 'Member']);
  });

  it('owner and admin may rename; a member is told why not', () => {
    expect(renameNote('owner')).toBeNull();
    expect(renameNote('admin')).toBeNull();
    expect(renameNote('member')).toBe('Only an owner or admin can rename the organisation');
  });

  it('an admin cannot grant owner; a member can grant nothing', () => {
    expect(roleOptions('owner')).toEqual(['owner', 'admin', 'member']);
    expect(roleOptions('admin')).toEqual(['admin', 'member']);
    expect(roleOptions('member')).toEqual([]);
  });

  it("the owner's row is fixed, and a member changes nobody", () => {
    expect(roleNote({ caller: 'owner', target: 'admin' })).toBeNull();
    expect(roleNote({ caller: 'admin', target: 'member' })).toBeNull();
    expect(roleNote({ caller: 'owner', target: 'owner' })).toBe("The owner's role cannot be changed");
    expect(roleNote({ caller: 'member', target: 'member' })).toBe('Only an owner or admin can change roles');
  });

  it('nobody removes the owner or themselves; a member removes nobody', () => {
    expect(removeNote({ caller: 'owner', target: 'member', isSelf: false })).toBeNull();
    expect(removeNote({ caller: 'admin', target: 'admin', isSelf: false })).toBeNull();
    expect(removeNote({ caller: 'owner', target: 'owner', isSelf: true })).toBe('The owner cannot be removed');
    expect(removeNote({ caller: 'admin', target: 'admin', isSelf: true })).toBe('You cannot remove yourself');
    expect(removeNote({ caller: 'member', target: 'member', isSelf: false })).toBe('Only an owner or admin can remove members');
  });

  it('only the owner deletes, and never a personal organisation', () => {
    expect(deleteNote({ role: 'owner', personal: false })).toBeNull();
    expect(deleteNote({ role: 'owner', personal: true })).toBe('Your personal organisation cannot be deleted');
    expect(deleteNote({ role: 'admin', personal: false })).toBe('Only the owner can delete the organisation');
    expect(deleteNote({ role: 'member', personal: true })).toBe('Your personal organisation cannot be deleted');
  });

  it('says what a delete takes with it', () => {
    expect(deleteSummary(0)).toBe('It has no projects. Its members lose access.');
    expect(deleteSummary(1)).toBe('Its 1 project, with every website, run and row in it, is deleted. Its members lose access.');
    expect(deleteSummary(3)).toBe('Its 3 projects, with every website, run and row in them, are deleted. Its members lose access.');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 org-settings-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the view module**

`packages/app/src/lib/org-settings-view.ts`:

```ts
/**
 * What a role may do on the organisation's Settings page, and — because every
 * disabled control owes the reader a reason — the sentence for when it may
 * not. The rules are spec 2026-09-21 §2's, and the API enforces the same ones
 * (orgs.ts); these exist so the reason is on screen before the click, not in
 * an error after it.
 */

export type Role = 'owner' | 'admin' | 'member';

const LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function roleLabel(role: Role): string {
  return LABELS[role];
}

const manages = (role: Role) => role === 'owner' || role === 'admin';

export function renameNote(role: Role): string | null {
  return manages(role) ? null : 'Only an owner or admin can rename the organisation';
}

/** What the caller may set someone to. Granting owner is the owner's alone (orgs.members.setRole). */
export function roleOptions(caller: Role): Role[] {
  if (caller === 'owner') return ['owner', 'admin', 'member'];
  if (caller === 'admin') return ['admin', 'member'];
  return [];
}

export function roleNote({ caller, target }: { caller: Role; target: Role }): string | null {
  if (target === 'owner') return "The owner's role cannot be changed";
  if (!manages(caller)) return 'Only an owner or admin can change roles';
  return null;
}

export function removeNote({ caller, target, isSelf }: { caller: Role; target: Role; isSelf: boolean }): string | null {
  if (target === 'owner') return 'The owner cannot be removed';
  if (!manages(caller)) return 'Only an owner or admin can remove members';
  if (isSelf) return 'You cannot remove yourself';
  return null;
}

export function deleteNote({ role, personal }: { role: Role; personal: boolean }): string | null {
  if (personal) return 'Your personal organisation cannot be deleted';
  if (role !== 'owner') return 'Only the owner can delete the organisation';
  return null;
}

export function deleteSummary(projectCount: number): string {
  if (projectCount === 0) return 'It has no projects. Its members lose access.';
  if (projectCount === 1) return 'Its 1 project, with every website, run and row in it, is deleted. Its members lose access.';
  return `Its ${projectCount} projects, with every website, run and row in them, are deleted. Its members lose access.`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 org-settings-view`
Expected: PASS (7 tests).

- [ ] **Step 5: The general panel**

`packages/app/src/components/org/general-panel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { renameNote, type Role } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

/**
 * The organisation's name. A field and a Save, not an inline rename: the name
 * is in the sidebar's switcher and the breadcrumb, and a change here must be
 * a deliberate act with a button, the way the account's name is.
 */
export function GeneralPanel({ name, role }: { name: string; role: Role }) {
  const router = useRouter();
  const rename = trpc.orgs.rename.useMutation();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  // The server is the authority: a name that changed elsewhere (another tab)
  // lands here unless this field is mid-edit.
  useEffect(() => setDraft((d) => (d === name ? d : d.trim() === '' ? name : d)), [name]);

  const note = renameNote(role);
  const trimmed = draft.trim();
  const unchanged = trimmed === name;
  const empty = trimmed === '';
  const reason = note ?? (empty ? 'Enter a name' : unchanged ? 'No changes to save' : null);

  async function save() {
    setError(null);
    try {
      await rename.mutateAsync({ name: trimmed });
      // The switcher and the breadcrumb read the session; re-run its loader.
      await router.invalidate();
    } catch {
      setError('The name could not be saved. Try again.');
    }
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">General</h2>
      <div className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
        <Label htmlFor="org-name" className="text-sm text-muted-foreground">Name</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="org-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!!note}
            maxLength={255}
            className="w-[280px] max-w-full"
          />
          <Button size="sm" variant="outline" onClick={() => void save()} disabled={!!reason || rename.isPending}>
            {rename.isPending ? 'Saving…' : 'Save name'}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {reason ? <span className="text-sm text-muted-foreground">{reason}</span> : null}
          {error ? <span role="alert" className="text-sm text-fail">{error}</span> : null}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: The members table and its remove dialog**

`packages/app/src/components/org/remove-member-dialog.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { trpc } from '../../lib/trpc';

export function RemoveMemberDialog({
  member,
  onOpenChange,
}: {
  /** The member to remove, or null when the dialog is closed. */
  member: { userId: string; name: string; email: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.orgs.members.remove.useMutation();
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    if (!member) return;
    setError(null);
    try {
      await remove.mutateAsync({ userId: member.userId });
      await utils.orgs.members.list.invalidate();
      onOpenChange(false);
    } catch (e) {
      // The table already shows the reason before the click; a refusal here
      // is a race (a role changed between load and confirm), so the API's own
      // words are the right ones.
      const err = e as { message?: string };
      setError(err.message ?? 'That member could not be removed. Try again.');
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member?.name}?</DialogTitle>
          <DialogDescription>
            {member?.email} loses access to this organisation and every project in it. They keep their own account.
          </DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={remove.isPending}>
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`variant="destructive"` is `--fail` on `--bg` (button.tsx): the filled confirm inside a dialog is the one place a red fill is the right mark — it *is* the destructive act, not a state wash. Outside the dialog the trigger stays an outline with red text.

`packages/app/src/components/org/members-table.tsx`:

```tsx
import { useState } from 'react';
import { AvatarSquare } from '../shell/avatar';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { RemoveMemberDialog } from './remove-member-dialog';
import { roleLabel, roleNote, roleOptions, removeNote, type Role } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

type Member = { userId: string; email: string; name: string; avatarColour: string; role: Role };

/**
 * Who is in the organisation and what they may do (spec §5 `/settings`:
 * list, role, remove). There is no "add" — invitations are outside this
 * design (spec §9) — so the table is the whole story of membership for now.
 */
export function MembersTable({ callerRole, callerUserId }: { callerRole: Role; callerUserId: string }) {
  const utils = trpc.useUtils();
  const members = trpc.orgs.members.list.useQuery();
  const setRole = trpc.orgs.members.setRole.useMutation();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(member: Member, role: Role) {
    setError(null);
    try {
      await setRole.mutateAsync({ userId: member.userId, role });
      await utils.orgs.members.list.invalidate();
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? 'That role could not be saved. Try again.');
    }
  }

  const rows = (members.data ?? []) as Member[];
  const options = roleOptions(callerRole);

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Members</h2>
      <div className="overflow-x-auto md:overflow-x-visible">
        <table className="w-full min-w-[560px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col />
            <col className="w-[200px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
              <th className="px-4 text-left text-sm">Member</th>
              <th className="px-3 text-left text-sm">Role</th>
              <th className="px-4 text-right text-sm"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {members.isPending ? (
              <tr><td className="px-4 py-2.5" colSpan={3}><Skeleton className="h-3.5 w-40 bg-raised" /></td></tr>
            ) : null}
            {rows.map((m) => {
              const isSelf = m.userId === callerUserId;
              const rNote = roleNote({ caller: callerRole, target: m.role });
              const xNote = removeNote({ caller: callerRole, target: m.role, isSelf });
              return (
                <tr key={m.userId} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <AvatarSquare initial={m.name} colour={m.avatarColour} />
                      <span className="min-w-0">
                        <span className="block truncate">{m.name}{isSelf ? <span className="text-muted-foreground"> · you</span> : null}</span>
                        <span className="block truncate font-mono text-sm text-muted-foreground">{m.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {rNote ? (
                      <span className="flex flex-col">
                        <span>{roleLabel(m.role)}</span>
                        <span className="text-sm text-muted-foreground">{rNote}</span>
                      </span>
                    ) : (
                      <Select value={m.role} onValueChange={(v) => void changeRole(m, v as Role)} disabled={setRole.isPending}>
                        <SelectTrigger size="sm" aria-label={`Role of ${m.name}`} className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((r) => (
                            <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {xNote ? (
                      <span className="text-sm text-muted-foreground">{xNote}</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setRemoving(m)}>Remove</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error ? <p role="alert" className="px-4 py-2 text-sm text-fail">{error}</p> : null}
      {members.isError ? <p role="alert" className="px-4 py-3 text-sm text-fail">The members could not be loaded. Try again.</p> : null}
      <RemoveMemberDialog member={removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} />
    </section>
  );
}
```

`SelectTrigger`'s `size="sm"` exists (settings-rows.tsx uses it). The owner's own row shows "The owner's role cannot be changed" and "The owner cannot be removed" — that is two reasons on one row, each beside the control it explains, and exactly what the API would say.

- [ ] **Step 7: The danger zone**

`packages/app/src/components/org/delete-org-dialog.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { deleteSummary } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

/**
 * The one irreversible thing on this page. The organisation's name has to be
 * typed back: a single confirm click is not enough for something that takes
 * every project with it. After it, the session stands on the caller's
 * personal organisation (orgs.delete moved it there), so the cache is thrown
 * away and the router re-reads the session — the same pattern as switching.
 */
export function DeleteOrgDialog({
  open,
  onOpenChange,
  orgName,
  projectCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  projectCount: number;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = trpc.orgs.delete.useMutation();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === orgName;

  async function onConfirm() {
    setError(null);
    try {
      await remove.mutateAsync();
      onOpenChange(false);
      // Everything cached belongs to the organisation that no longer exists.
      queryClient.clear();
      await router.invalidate();
      await navigate({ to: '/projects' });
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? 'The organisation could not be deleted. Try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTyped(''); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {orgName}?</DialogTitle>
          <DialogDescription>{deleteSummary(projectCount)} This cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="confirm-org-name" className="text-sm text-muted-foreground">Type the organisation's name to confirm</Label>
          <Input id="confirm-org-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
        <DialogFooter className="items-center">
          {!matches ? <span className="mr-auto text-sm text-muted-foreground">The name does not match yet</span> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={!matches || remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete organisation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: The screen**

Replace `packages/app/src/routes/_app/settings.tsx` with:

```tsx
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { DeleteOrgDialog } from '../../components/org/delete-org-dialog';
import { GeneralPanel } from '../../components/org/general-panel';
import { MembersTable } from '../../components/org/members-table';
import { Button } from '../../components/ui/button';
import { deleteNote } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

/** The organisation's settings (spec §3, §5): general, members, danger zone. */
function SettingsPage() {
  const { session } = Route.useRouteContext();
  const org = session.currentOrg;
  const projects = trpc.projects.list.useQuery();
  const [deleting, setDeleting] = useState(false);
  const note = deleteNote({ role: org.role, personal: org.personal });

  return (
    <Page title="Settings">
      <div className="space-y-4">
        <GeneralPanel key={org.id} name={org.name} role={org.role} />

        <MembersTable key={`m-${org.id}`} callerRole={org.role} callerUserId={session.user.id} />

        <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
          <h2 className="border-b border-line px-4 py-3 text-base font-medium">Danger zone</h2>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setDeleting(true)} disabled={!!note} className="text-fail">
              Delete organisation
            </Button>
            {/* Every disabled control says why, within a line of it. */}
            <span className="text-sm text-muted-foreground">
              {note ?? 'Deletes every project in it. Members lose access.'}
            </span>
          </div>
        </section>
      </div>

      <DeleteOrgDialog
        open={deleting}
        onOpenChange={setDeleting}
        orgName={org.name}
        projectCount={projects.data?.length ?? 0}
      />
    </Page>
  );
}
```

`key={org.id}` on the panels: switching organisation from the sidebar while on this page must reset the name draft and the members query to the new organisation, not carry the old draft over.

- [ ] **Step 9: Typecheck and look**

Run: `pnpm --filter @robot/app exec tsc --noEmit` — no errors.

Browser check as `settings-<timestamp>@example.com` (through `/login`; report the address): on `/settings` the name field holds the throwaway's personal org name; **Save name** is off with "No changes to save"; the members table has one row — the throwaway, `· you`, "Owner", both reasons beside it; **Delete organisation** is off with "Your personal organisation cannot be deleted". Rename the organisation to `Settings check` and Save: the breadcrumb and the org switcher say the new name without a reload. Then, from the switcher, **Create organisation** `Throwaway team <timestamp>`: on `/settings` the delete button is live; open the dialog, type the name, delete: you land on `/projects` in the personal organisation, still signed in, and the switcher no longer lists the team. Nothing else is touched.

- [ ] **Step 10: Commit**

```bash
git add packages/app/src/lib/org-settings-view.ts packages/app/src/lib/org-settings-view.test.ts packages/app/src/components/org/general-panel.tsx packages/app/src/components/org/members-table.tsx packages/app/src/components/org/remove-member-dialog.tsx packages/app/src/components/org/delete-org-dialog.tsx packages/app/src/routes/_app/settings.tsx
git commit -m "feat(app): the organisation's Settings page — general, members, danger zone" -- packages/app/src/lib/org-settings-view.ts packages/app/src/lib/org-settings-view.test.ts packages/app/src/components/org/general-panel.tsx packages/app/src/components/org/members-table.tsx packages/app/src/components/org/remove-member-dialog.tsx packages/app/src/components/org/delete-org-dialog.tsx packages/app/src/routes/_app/settings.tsx
```

---

### Task 6: `/account` — name, email, appearance; the placeholder component retires

**Files:**
- Create: `packages/app/src/lib/account-view.ts`, `packages/app/src/lib/account-view.test.ts`, `packages/app/src/lib/apply-theme.ts`, `packages/app/src/components/account/profile-panel.tsx`, `packages/app/src/components/account/appearance-panel.tsx`
- Modify: `packages/app/src/routes/_app/account.tsx` (replace the placeholder), `packages/app/src/components/shell/user-menu.tsx` (use `applyThemeNow`), `packages/app/src/components/page.tsx` (delete `ComingLater`)

**Interfaces:**
- Consumes: `auth.updateName` (Task 2), `auth.setTheme`; `resolveTheme`, `type Theme`, `THEMES_PREFS` from `lib/theme.ts`; `RadioGroup`, `RadioGroupItem` from `components/ui/radio-group.tsx`.
- Produces:
  ```ts
  // lib/account-view.ts
  export function nameProblem(name: string): string | null;   // 'Enter a name' | 'Keep it under 255 characters' | null (on the trimmed value)
  export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; hint: string }>;
  // lib/apply-theme.ts
  export function applyThemeNow(theme: Theme): void;           // flips <html data-theme> immediately (the user menu's optimistic step, shared)
  ```

- [ ] **Step 1: Write the failing test**

`packages/app/src/lib/account-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nameProblem, THEME_OPTIONS } from './account-view';

describe('nameProblem', () => {
  it('wants a name, and not a novel', () => {
    expect(nameProblem('Ada')).toBeNull();
    expect(nameProblem('  Ada  ')).toBeNull();
    expect(nameProblem('')).toBe('Enter a name');
    expect(nameProblem('   ')).toBe('Enter a name');
    expect(nameProblem('a'.repeat(255))).toBeNull();
    expect(nameProblem('a'.repeat(256))).toBe('Keep it under 255 characters');
  });
});

describe('THEME_OPTIONS', () => {
  it('offers the three preferences the session stores, dark first', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['dark', 'light', 'system']);
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['Dark', 'Light', 'System']);
    for (const o of THEME_OPTIONS) expect(o.hint.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 account-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the modules**

`packages/app/src/lib/account-view.ts`:

```ts
import type { Theme } from './theme';

/** Why a name cannot be saved — the same bounds `auth.updateName` enforces, said before the click. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name';
  if (trimmed.length > 255) return 'Keep it under 255 characters';
  return null;
}

/** The appearance radio (spec §5 `/account`). Same order as the user menu's Theme submenu. */
export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; hint: string }> = [
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'system', label: 'System', hint: 'Follows your device' },
];
```

`packages/app/src/lib/apply-theme.ts`:

```ts
import { resolveTheme, type Theme } from './theme';

/**
 * Flip the document's theme now, before the preference has round-tripped to
 * :4000 — a theme switch that waits for the network reads as a broken click.
 * Shared by the user menu and the Account page so both do exactly this.
 */
export function applyThemeNow(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(theme, prefersDark);
}
```

In `packages/app/src/components/shell/user-menu.tsx`, replace the body of `chooseTheme` with `applyThemeNow(theme); setTheme.mutate({ theme });`, import `applyThemeNow` from `../../lib/apply-theme`, and drop the now-unused `resolveTheme` import (keep `type Theme`).

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1 account-view theme`
Expected: PASS.

- [ ] **Step 5: The two panels**

`packages/app/src/components/account/profile-panel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { nameProblem } from '../../lib/account-view';
import { trpc } from '../../lib/trpc';

/** Name and email (spec §5 `/account`). The email is read-only for now — sign-in is a stub (spec §9). */
export function ProfilePanel({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const update = trpc.auth.updateName.useMutation();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft((d) => (d.trim() === '' ? name : d)), [name]);

  const trimmed = draft.trim();
  const reason = nameProblem(draft) ?? (trimmed === name ? 'No changes to save' : null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ name: trimmed });
      // The sidebar's user menu reads the session; re-run its loader.
      await router.invalidate();
    } catch {
      setError('The name could not be saved. Try again.');
    }
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Profile</h2>
      <dl>
        <div className="grid gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
          <dt><Label htmlFor="account-name" className="text-sm text-muted-foreground">Name</Label></dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Input id="account-name" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={256} className="w-[280px] max-w-full" />
            <Button size="sm" variant="outline" onClick={() => void save()} disabled={!!reason || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save name'}
            </Button>
            {reason ? <span className="text-sm text-muted-foreground">{reason}</span> : null}
            {error ? <span role="alert" className="text-sm text-fail">{error}</span> : null}
          </dd>
        </div>
        <div className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
          <dt className="text-sm text-muted-foreground">Email</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-base">{email}</span>
            <span className="text-sm text-muted-foreground">Email cannot be changed yet</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
```

`packages/app/src/components/account/appearance-panel.tsx`:

```tsx
import { useRouter } from '@tanstack/react-router';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { THEME_OPTIONS } from '../../lib/account-view';
import { applyThemeNow } from '../../lib/apply-theme';
import type { Theme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';

/** Dark, light or system (spec §5). Saves on choice; the flip is immediate, as in the user menu. */
export function AppearancePanel({ theme }: { theme: Theme }) {
  const router = useRouter();
  const setTheme = trpc.auth.setTheme.useMutation({ onSuccess: () => router.invalidate() });

  function choose(next: Theme) {
    applyThemeNow(next);
    setTheme.mutate({ theme: next });
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Appearance</h2>
      <div className="px-4 py-3">
        <RadioGroup value={theme} onValueChange={(v) => choose(v as Theme)} aria-label="Theme" className="gap-2">
          {THEME_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <RadioGroupItem id={`theme-${o.value}`} value={o.value} />
              <Label htmlFor={`theme-${o.value}`} className="text-base font-normal">
                {o.label} <span className="text-muted-foreground">· {o.hint}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
        {setTheme.isError ? <p role="alert" className="mt-2 text-sm text-fail">The preference could not be saved; it applies until you reload.</p> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: The screen, and the placeholder's retirement**

Replace `packages/app/src/routes/_app/account.tsx` with:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { AppearancePanel } from '../../components/account/appearance-panel';
import { ProfilePanel } from '../../components/account/profile-panel';

export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
});

/** The signed-in person's own settings (spec §3, §5): who they are, how the app looks to them. */
function AccountPage() {
  const { session } = Route.useRouteContext();
  return (
    <Page title="Account">
      <div className="space-y-4">
        <ProfilePanel key={session.user.name} name={session.user.name} email={session.user.email} />
        <AppearancePanel theme={session.user.theme} />
      </div>
    </Page>
  );
}
```

In `packages/app/src/components/page.tsx`, delete the `ComingLater` export and its doc comment — after this task nothing imports it (`grep -rn ComingLater packages/app/src` must return nothing).

- [ ] **Step 7: Typecheck and look**

Run: `pnpm --filter @robot/app exec tsc --noEmit` — no errors. Run: `pnpm --filter @robot/app exec vitest run --maxWorkers=1` — the whole app package, green.

Browser check as `account-<timestamp>@example.com` (through `/login`; report the address): `/account` shows the derived name (`Account-<timestamp>`) and the email with its note; change the name to `Ada Check`, Save: the user menu at the bottom of the sidebar says `Ada Check` without a reload. Choose Light: the page flips at once; reload: still light (the preference round-tripped). Choose Dark again. Nothing else is touched.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/lib/account-view.ts packages/app/src/lib/account-view.test.ts packages/app/src/lib/apply-theme.ts packages/app/src/components/account/profile-panel.tsx packages/app/src/components/account/appearance-panel.tsx packages/app/src/routes/_app/account.tsx packages/app/src/components/shell/user-menu.tsx packages/app/src/components/page.tsx
git commit -m "feat(app): the Account page — name, email, appearance" -- packages/app/src/lib/account-view.ts packages/app/src/lib/account-view.test.ts packages/app/src/lib/apply-theme.ts packages/app/src/components/account/profile-panel.tsx packages/app/src/components/account/appearance-panel.tsx packages/app/src/routes/_app/account.tsx packages/app/src/components/shell/user-menu.tsx packages/app/src/components/page.tsx
```

---

### Task 7: The smoke with real assertions, the look-only check, and the record

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts` (per-screen assertions and two round trips for plan 4's screens)
- Create: `docs/testing/ui-check-app-org.mts`
- Modify: `docs/testing/screens/README.md`, `docs/handoff.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above; the smoke's existing helpers (`shoot`, `chooseTheme`, `waitForHydration`, `apiAs`, `sessionCookie`, `problems`); `docs/testing/ui-check-app-site.mts` as the model for the look-only check (its `arg`, allow-list, `finally` summary and theme restore).

- [ ] **Step 1: Per-screen assertions in the smoke**

In `packages/app/src/routes-smoke.test.ts`, after the `SITE_SCREENS` constant, add:

```ts
/**
 * Plan 4's four organisation screens, each with the one thing that proves it
 * is the real screen: the runs empty state (nothing has run, and running
 * costs money), the Usage total at $0.00 with the throwaway's project in the
 * table, the personal organisation's name in the Settings field with the
 * delete refused for the right reason, and the account's own email.
 */
const ORG_SCREENS = [
  {
    route: '/runs',
    assert: async () => {
      expect(await page.locator('main').innerText(), '/runs is not in its empty state').toContain('No runs yet');
    },
  },
  {
    route: '/usage',
    assert: async () => {
      expect(await page.getByTestId('usage-total').innerText(), 'the Usage total is not $0.00').toBe('$0.00');
      expect(await page.locator('tbody tr').filter({ hasText: PROJECT_NAME }).count(), 'Usage has no row for this run’s project').toBe(1);
    },
  },
  {
    route: '/settings',
    assert: async () => {
      expect(await page.getByLabel('Name').inputValue(), 'the organisation name field is not prefilled').not.toBe('');
      expect(await page.locator('tbody tr').count(), 'the members table should hold exactly the throwaway').toBe(1);
      expect(await page.locator('tbody').innerText()).toContain('you');
      const del = page.getByRole('button', { name: 'Delete organisation' });
      expect(await del.isDisabled(), 'Delete organisation is live on a personal organisation').toBe(true);
      expect(await page.locator('main').innerText()).toContain('Your personal organisation cannot be deleted');
    },
  },
  {
    route: '/account',
    assert: async () => {
      expect(await page.locator('main').innerText(), '/account does not show the signed-in email').toContain(EMAIL);
      expect(await page.getByRole('radio', { name: /Dark/ }).count()).toBe(1);
    },
  },
] as const;
```

`EMAIL` is the file's existing module-level address. The project's name is currently a local inside the "a project created through the dialog" test (`const name = \`Smoke ${Date.now()}\``): hoist it to a module-level `const PROJECT_NAME = \`Smoke ${Date.now()}\`` beside `EMAIL`, use it in that test, and write `PROJECT_NAME` / `EMAIL` in `ORG_SCREENS` above. Then, inside the existing `every screen renders in the ${theme} theme` loop, after the generic checks and before `shoot(...)`, add:

```ts
        const screen = ORG_SCREENS.find((s) => s.route === route);
        if (screen) await screen.assert();
```

This needs the throwaway project to exist before that loop runs. If, in the current file, the project is created *after* the shell loop, move the shell-loop `describe` (or just the `for (const theme…)` block) below the project-creation test; the ordering is the only change.

Add two round-trip tests at the end of the `app shell` describe (before `signing out closes the door`):

```ts
  it('renaming the account reaches the server and the sidebar', async () => {
    await page.goto(`${APP}/account`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'aside');
    const name = `Smoke ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => page.locator('aside').innerText(), { timeout: 10_000 }).toContain(name);
    const cookie = await sessionCookie(context);
    expect((await apiAs(cookie!).auth.me.query()).user.name).toBe(name);
  });

  it('renaming the organisation reaches the server and the breadcrumb', async () => {
    await page.goto(`${APP}/settings`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'aside');
    const name = `Smoke org ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => page.locator('header nav').innerText(), { timeout: 10_000 }).toContain(name);
    const cookie = await sessionCookie(context);
    expect((await apiAs(cookie!).auth.me.query()).currentOrg.name).toBe(name);
  });
```

`page.getByLabel('Name')` must resolve to exactly one field on each of those two screens: on `/settings` the members table's Select is labelled `Role of …`, so it does; if Playwright reports two matches, scope with `page.locator('main').getByLabel('Name', { exact: true })`.

- [ ] **Step 2: Run the smoke**

With `pnpm dev:all` running in another terminal: `pnpm test:ui:app`
Expected: PASS in both themes; `docs/testing/screens/app-{runs,usage,settings,account}-{dark,light}.png` are retaken and now show the real screens. Report the throwaway address the run used.

- [ ] **Step 3: The look-only check on the real organisation**

`docs/testing/ui-check-app-org.mts` — modelled line for line on `docs/testing/ui-check-app-site.mts` (same header comment style, same `arg()` parsing, same copy-into-`packages/browser` invocation, same `finally` with the allow-list assertion, the evidence block and the theme restore). What differs:

- Walks `/runs`, `/usage`, `/settings`, `/account` in both themes and screenshots them to `docs/testing/screens/app-org-{runs,usage,settings,account}-<theme>.png`.
- `ALLOWED` is exactly: `auth.me`, `auth.signIn`, `auth.setTheme`, `projects.list`, `runs.listByOrg`, `usage.byProject`, `orgs.members.list`. Any other procedure name seen in a request fails the run — in particular `orgs.rename`, `orgs.delete`, `orgs.members.setRole`, `orgs.members.remove`, `auth.updateName`.
- The only `.click()` calls are Sign in and the theme items. **No Save, no Remove, no Delete organisation is ever clicked**; the check reads their labels and reasons only.
- PASS/FAIL lines: `/runs` has ≥ 1 row and every row's Started cell links to `/projects/…/sites/…/runs/…`; `/usage` shows a `usage-total` and one row per project of `projects.list`; `/settings` shows the org name in the field, the members table with the signed-in address marked `you`, and the delete button's state with its reason printed; `/account` shows the signed-in email and the checked theme radio equals `auth.me`'s theme.
- Restores the theme it found, in the `finally`.

Run it as the controller directs (the controller supplies `--email`; the implementer runs it only against their own throwaway if they run it at all) and record the PASS/FAIL lines in the task report.

- [ ] **Step 4: The record**

`docs/testing/screens/README.md`: the four rows for `app-{runs,usage,settings,account}` lose "placeholder until plan 4" and say what the screen is; add four rows for `app-org-*-<theme>.png` with the check that produces them.

`docs/handoff.md`: a new section at the top, `## App redesign, plan 4: the organisation (2026-09-24)`, in the shape of the plan 3 section — what landed per task with the commit shas, the API changes (`runs.listByOrg`, `usage.byProject`, `auth.updateName`, `orgs.delete`'s `nextOrg`, `runs.cost_usd` and where it is written), the rulings, what is still unguarded (unchanged from plan 3's list), the open decision **"a members table with no way to add a member — an 'add an existing user by email' row is ~20 lines when wanted; invitations by email remain outside the design (spec §9)"**, and a **Next** line: plan 5 (stepper steps 2–3), then plan 6 (cut-over). Also note that a run's cost is now recorded but not yet shown on the run page (the run facts panel could carry it; a one-line follow-up).

`CLAUDE.md`: in **Commands**, after `pnpm db:migrate` is mentioned in First-time setup, nothing changes; in the `@robot/app` row of the package map, extend the description to "…a project's websites, Fields and Output, a website's Schema / Extract / Runs / Settings, and the organisation's Runs, Usage, Settings and Account".

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes-smoke.test.ts docs/testing/ui-check-app-org.mts docs/testing/screens/README.md docs/testing/screens/app-runs-dark.png docs/testing/screens/app-runs-light.png docs/testing/screens/app-usage-dark.png docs/testing/screens/app-usage-light.png docs/testing/screens/app-settings-dark.png docs/testing/screens/app-settings-light.png docs/testing/screens/app-account-dark.png docs/testing/screens/app-account-light.png docs/handoff.md CLAUDE.md
git commit -m "test(app): the organisation screens in the smoke and the look-only check; the plan 4 record" -- packages/app/src/routes-smoke.test.ts docs/testing/ui-check-app-org.mts docs/testing/screens/README.md docs/testing/screens/app-runs-dark.png docs/testing/screens/app-runs-light.png docs/testing/screens/app-usage-dark.png docs/testing/screens/app-usage-light.png docs/testing/screens/app-settings-dark.png docs/testing/screens/app-settings-light.png docs/testing/screens/app-account-dark.png docs/testing/screens/app-account-light.png docs/handoff.md CLAUDE.md
```

(The `app-org-*` screenshots are committed by the controller after running the check against Marko's organisation, in the same way plan 3's `app-site-*-acne-*` set was.)

---

## Self-review

**Spec coverage.** §5 `/runs` → Task 3 (dot, status, project/website, rows, duration; newest first). §5 `/usage` → Tasks 1, 2, 4 (spend = `source_verifications.cost_usd` + run costs — run costs did not exist, hence Task 1; pages captured; per project; 28 px total). §5 `/settings` → Task 5 (general, members list / role / remove, danger zone owner-only, personal never). §5 `/account` → Task 6 (name, read-only email, appearance). §6 `runs.listByOrg`, `usage.byProject({ month })` → Task 2. §2 roles → `org-settings-view.ts` + the API's existing `requireRole`. §3 sidebar and user menu already link to all four (plan 1). §4 the dot on the org-wide Runs page → Task 3; the one 28 px figure → Task 4. §8 per-screen smoke, view-logic unit tests, look-only check → Task 7. Not covered on purpose: adding a member (§9), shown as an open decision.

**Placeholders.** None: every step carries its code, its command and its expected result.

**Type consistency.** `runs.listByOrg`'s row shape (Task 2) is `OrgRunRow` (Task 3) exactly — `costUsd: number`, `project: { name, slug }`, `website: { name, slug }` on top of `RunRow`. `usage.byProject`'s `projects[]` is `UsageRow` (Task 4). `orgs.delete` returns `{ ok, nextOrg }` (Task 2) and Task 5's dialog ignores the payload and re-reads the session, so the shape cannot drift under it. `Role` in `org-settings-view.ts` equals `SessionOrg['role']` in `lib/session.ts`. `applyThemeNow` (Task 6) takes the `Theme` of `lib/theme.ts`, the same type `auth.setTheme` accepts.
