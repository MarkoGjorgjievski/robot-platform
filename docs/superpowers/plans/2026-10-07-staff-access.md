# Staff Access to Customer Organisations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator (an `OPS_EMAILS` account) can enter any customer's organisation from ops, work on its websites without being a member, is blocked from destructive and organisation-level actions, and every change they make is logged and shown to staff and to the customer.

**Architecture:** The operator's own session row gains `staff_org_id` + `staff_entered_at`. `loadSession` resolves the session's org to that customer org while the email is still an operator and under 8 hours, so every existing org-scoped procedure works unchanged. Two middlewares on `protectedProcedure` do the rest: a deny-list guard (`auth/staff-guard.ts`) and an action logger (`auth/staff-actions.ts`) that writes one `staff_actions` row per successful staff-mode mutation. The app reads `staff` from `auth.me` and renders a banner, hides the org switcher, disables blocked controls, and shows the log in ops and in the customer's Settings.

**Tech Stack:** Drizzle + PostgreSQL (migration 0016), tRPC v11 middleware, Zod, vitest; TanStack Start app with Tailwind tokens, shadcn/Base UI, sonner toasts; Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-07-staff-access-design.md`

## Global Constraints

- **Who can enter:** `ops.enterOrg` is an `opsProcedure` (FORBIDDEN for a signed-in non-operator, UNAUTHORIZED signed out). All operators can enter any customer organisation; there is no consent step.
- **Validity:** a staff session counts only while the user's email is in `OPS_EMAILS` (checked on every request via `isOperatorEmail`) and for at most **8 hours** after `staff_entered_at` (`STAFF_SESSION_MS = 8 * 60 * 60 * 1000`). Otherwise the request is served as if the staff columns were empty.
- **No membership is ever created** by staff access. The only record is `staff_actions`.
- **Role inside a customer org:** `'member'` (least privilege). Every role-gated procedure is on the deny-list anyway.
- **Deny-list (exact paths)** in `packages/api/src/auth/staff-guard.ts`:
  `orgs.rename`, `orgs.delete`, `orgs.create`, `orgs.members.setRole`, `orgs.members.remove`, `auth.switchOrg`, `projects.delete`, `sources.delete`, `datasets.deleteField`, `datasets.deleteAxis`.
  (The spec's "`orgs.switch` or equivalents" is `auth.switchOrg` in this codebase.)
- **Blocked error:** `TRPCError({ code: 'FORBIDDEN', message: 'Not available while working as staff' })`. The app's disabled-control tooltip/note uses the same sentence: `Not available while working as staff`.
- **Allowed own-account changes:** `auth.updateName`, `auth.setTheme` — allowed and **not logged** (they change the staff member's own account, not the customer's data).
- **Copy (verbatim):**
  - Ops website page button: `Work on this website` (enabled for every operator, member or not).
  - Confirmation title: `Work on {website} as staff?`
  - Confirmation body: `You'll act inside {customer}'s organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to {customer}.`
  - Confirmation buttons: `Start working` (primary), `Cancel`.
  - Banner: `Working as Robot staff in {customer}`, with `Back to ops` on the right. Warn rail style: a 2 px warn left rail (`border-l-2 border-warn`), no background wash.
  - Expiry toast: `Your staff session in {customer} ended after 8 hours.`
  - Log events: `Started working as staff`, `Stopped working as staff`, `Stopped working as staff (signed out)`, `Staff session ended after 8 hours`.
  - Unmapped fallback: `Made a change on {website or project}`.
  - Ops sidebar item: `Staff activity` (under All websites). Ops website section heading: `Staff activity`, latest 10, with a link `See all` to the Staff activity page filtered to that customer.
  - Customer Settings section heading: `Robot staff activity`; empty state `No staff activity yet.`
  - Cost suffix on a run-linked entry: ` · $1.24` (two decimals), shown only when the run's `costUsd` > 0, read at view time from `runs.cost_usd`.
- **Paging:** ops Staff activity page 50 per page; customer Settings 20 per page; newest first.
- **`staff_actions` is append-only:** no update or delete procedure. `org_id` cascades on org delete; `user_id` is `on delete set null` with `actor_email` kept.
- **Queries are never logged.** Only successful mutations in staff mode, plus enter / leave / sign-out / expiry.
- **Ops was read-only (cut-over plan).** This plan amends it: `ops.enterOrg` and `ops.leaveOrg` are the only `ops.*` mutations, and they touch only the caller's own session row and the log.
- **Process constraints (standing):** never sign in as `markodjordjievski@gmail.com`; never touch org `default`/`mar` or projects Acne / Scratch / Competitor prices; never click Verify / Extract / Sample / Check with a dollar amount; never stop/start Marko's dev servers (:4000/:3000); `pg_dump` before running the migration on the dev DB; commit by explicit path only, never `git stash`; tests run with `vitest run --maxWorkers=2 --testTimeout=30000`.

## Rulings made while planning (Marko can overturn)

- **R1 — Verification autosave is coalesced.** `sources.updateBinding` fires on every edit of the Verification tab. Logging each call would bury the log. It logs `Edited the Verification answers on {website}` at most once per staff member per website per 10 minutes. Cost if wrong: a few lost timestamps of intermediate edits; Verify itself is always logged.
- **R2 — "Accepted a new location for Price on Nike"** has no single mutation that means exactly that. A field-scoped re-verify (`sources.verify` with non-empty `onlyKeys`) logs `Re-verified Price on Nike`; a full verify logs `Verified Nike`.
- **R3 — A failed log write does not fail the mutation.** The change has already happened; the error is `console.error`ed with the path and org. Cost if wrong: a rare gap in the audit log instead of a misleading error to the user.
- **R4 — CORS origin becomes configurable** (`APP_ORIGINS`, default `http://localhost:3000`) so the isolated :3100 → :4100 smoke runs without a web-security-disabled browser.

## Review Focus

1. **A staff session whose customer org is deleted** (customer deletes their org while staff are inside): the next request must serve the staff member's own org, not 401 and not crash. Pinned in Task 1 (`staff_org_id` is `on delete set null`; test).
2. **Removing the email from `OPS_EMAILS` mid-session**: the very next request is back in the own org, and a deny-listed procedure the user is allowed in their own org works again. Pinned in Task 1/2 tests.
3. **An operator who is also a real member of the customer org** enters as staff: still blocked from the deny-list and still logged (staff mode wins over membership). Pinned in Task 2.
4. **A mutation that throws** (e.g. NOT_FOUND) in staff mode writes no log row. Pinned in Task 3.
5. **Another org's member never sees** another org's staff activity, including via `ops.staffActivity` (operators only) and `orgs.staffActivity` (session org only). Pinned in Task 4.

---

## File map

**DB**
- Modify `packages/db/src/schema.ts` — `sessions.staffOrgId`, `sessions.staffEnteredAt`; new `staffActions` table + relations.
- Create `packages/db/drizzle/0016_staff_access.sql` (+ meta snapshot/journal via `drizzle-kit generate`).

**API**
- Modify `packages/api/src/trpc.ts` — `SessionInfo.staff`, `SessionInfo.staffExpired`; `protectedProcedure` gains the guard and logger middlewares.
- Modify `packages/api/src/auth/session.ts` — `STAFF_SESSION_MS`, staff-aware `loadSession`.
- Create `packages/api/src/auth/staff-guard.ts` — `STAFF_DENY_LIST`, `isStaffBlocked`, `STAFF_BLOCKED_MESSAGE`.
- Create `packages/api/src/auth/staff-actions.ts` — sentence table, target resolution, `recordStaffAction`, `logStaffMutation`.
- Create `packages/api/src/auth/staff-activity.ts` — `listStaffActivity` (shared query for ops and customer).
- Modify `packages/api/src/routers/ops.ts` — `enterOrg`, `leaveOrg`, `staffActivity`, `staffActivityFilters`.
- Modify `packages/api/src/routers/orgs.ts` — `staffActivity`.
- Modify `packages/api/src/routers/auth.ts` — `me` returns `staff`, `staffExpired`.
- Tests: `packages/api/src/auth/staff-session.test.ts`, `staff-guard.test.ts`, `staff-actions.test.ts`, `packages/api/src/routers/staff-activity.test.ts`.
- Modify `packages/api/src/test-helpers/identity.ts` — `enterAsStaff` helper.

**api-server**
- Modify `packages/api-server/src/app.ts` + `app.test.ts` — `APP_ORIGINS`.

**App**
- Modify `packages/app/src/lib/session.ts` — `Session.staff`, `Session.staffExpired`.
- Create `packages/app/src/lib/staff-view.ts` (+ `.test.ts`) — copy builders, `STAFF_BLOCKED`, `formatStaffEntry`.
- Create `packages/app/src/components/shell/staff-banner.tsx`, `components/ops/work-on-website-dialog.tsx`, `components/staff/staff-activity-list.tsx`.
- Modify `packages/app/src/routes/_app.tsx`, `components/shell/sidebar.tsx`, `components/shell/ops-sidebar.tsx`, `routes/_app/ops/websites/$sourceId.tsx`, `routes/_app/settings.tsx`, `routes/_app/projects/$project/sites/$site/settings.tsx`, `components/fields/fields-table.tsx`, `components/fields/variants-panel.tsx`, `components/org/general-panel.tsx`, `components/org/members-table.tsx`.
- Create `packages/app/src/routes/_app/ops/activity.tsx`.
- Create `packages/app/src/staff-smoke.test.ts`; root `package.json` script `test:ui:staff`.

**Docs**
- `docs/handoff.md`, `CLAUDE.md`, `.env.example`.

---

### Task 1: Staff columns, the log table, and a staff-aware session

**Files:**
- Modify: `packages/db/src/schema.ts:58-74`
- Create: `packages/db/drizzle/0016_staff_access.sql` (generated)
- Modify: `packages/api/src/trpc.ts:5-10`
- Modify: `packages/api/src/auth/session.ts:26-50`
- Modify: `packages/api/src/routers/auth.ts` (`me`)
- Modify: `packages/api/src/test-helpers/identity.ts`
- Test: `packages/api/src/auth/staff-session.test.ts`

**Interfaces:**
- Produces:
  - `sessions.staffOrgId: uuid | null` (FK orgs, `on delete set null`), `sessions.staffEnteredAt: timestamptz | null`.
  - `staffActions` table: `{ id uuid pk, orgId uuid not null (FK orgs cascade), userId uuid null (FK users set null), actorEmail varchar(255) not null, at timestamptz default now, action varchar(100) not null, summary text not null, projectId uuid null (FK projects set null), sourceId uuid null (FK sources set null), runId uuid null (FK runs set null) }`, indexes on `(org_id, at)` and `(source_id, at)`.
  - `SessionInfo.staff: { orgId: string; enteredAt: Date } | null`, `SessionInfo.staffExpired: { orgId: string; orgName: string } | null`.
  - `STAFF_SESSION_MS` exported from `auth/session.ts`.
  - `auth.me` output gains `staff: { orgId: string; orgName: string; enteredAt: Date } | null` and `staffExpired: { orgId: string; orgName: string } | null`.
  - Test helper `enterAsStaff(signedIn: SignedIn, orgId: string, enteredAt?: Date): Promise<SignedIn>` — sets the columns directly in the DB and returns a fresh caller from a reloaded session (Task 2's `ops.enterOrg` is the product path; this helper lets Task 1 test the loader alone).

- [ ] **Step 1: Schema.** In `packages/db/src/schema.ts`, add to `sessions`:

```ts
  // Staff access (spec 2026-10-07 §2.1): while set and valid, the session works inside this customer org.
  staffOrgId: uuid('staff_org_id').references(() => orgs.id, { onDelete: 'set null' }),
  staffEnteredAt: timestamp('staff_entered_at', { withTimezone: true }),
```

Add after the sessions relations:

```ts
// ─── Staff activity (spec 2026-10-07 §2.4) — append-only ────────────────────

export const staffActions = pgTable('staff_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 255 }).notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  summary: text('summary').notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
}, (table) => [
  index('staff_actions_org_at_idx').on(table.orgId, table.at),
  index('staff_actions_source_at_idx').on(table.sourceId, table.at),
]);
```

`staffActions` references `projects`, `sources`, `runs`, which are declared later in the file: place the table at the end of `schema.ts` (after `runs`), not next to `sessions`.

- [ ] **Step 2: Generate and apply the migration.** Back up first, then generate:

```bash
docker exec robot-platform-db pg_dump -U postgres -Fc robot_platform > "$SCRATCH/pre-0016.dump"   # $SCRATCH = the session scratchpad
pnpm --filter @robot/db exec drizzle-kit generate --name staff_access
pnpm db:migrate
```

Check the generated SQL is `0016_staff_access.sql` with two `ALTER TABLE "sessions" ADD COLUMN`, one `CREATE TABLE "staff_actions"`, five FKs and two indexes, and nothing else. (If `pg_dump`'s user/db names differ, read them from `DATABASE_URL` in `.env`.)

- [ ] **Step 3: Write the failing test** `packages/api/src/auth/staff-session.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sessions } from '@robot/db';
import { signedInCaller, enterAsStaff, type SignedIn } from '../test-helpers/identity.js';
import { loadSession, STAFF_SESSION_MS } from './session.js';

describe('staff session (spec 2026-10-07 §2.1)', () => {
  let staff: SignedIn;
  let customer: SignedIn;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    staff = await signedInCaller('staff-session-op');
    customer = await signedInCaller('staff-session-cust');
  });
  afterEach(() => { process.env.OPS_EMAILS = staff.user.email; });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await staff.cleanup();
  });

  it('serves the customer org while the email is an operator and under 8 hours', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    const inside = await enterAsStaff(staff, customer.org.id);
    expect(inside.session.org.id).toBe(customer.org.id);
    expect(inside.session.role).toBe('member');
    expect(inside.session.staff).toEqual({ orgId: customer.org.id, enteredAt: expect.any(Date) });
    expect(inside.session.staffExpired).toBeNull();
    const projects = await inside.caller.projects.list();
    expect(Array.isArray(projects)).toBe(true);
  });

  it('falls back to the own org when the email leaves OPS_EMAILS', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    await enterAsStaff(staff, customer.org.id);
    process.env.OPS_EMAILS = '';
    const s = (await loadSession(db, staff.session.token))!;
    expect(s.org.id).toBe(staff.org.id);
    expect(s.staff).toBeNull();
    expect(s.staffExpired).toBeNull();
  });

  it('falls back after 8 hours and reports staffExpired with the customer name', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    await enterAsStaff(staff, customer.org.id, new Date(Date.now() - STAFF_SESSION_MS - 1000));
    const s = (await loadSession(db, staff.session.token))!;
    expect(s.org.id).toBe(staff.org.id);
    expect(s.staff).toBeNull();
    expect(s.staffExpired).toEqual({ orgId: customer.org.id, orgName: customer.org.name });
  });

  it('falls back when the customer org is deleted', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    const doomed = await signedInCaller('staff-session-doomed');
    await enterAsStaff(staff, doomed.org.id);
    await doomed.cleanup();
    const s = (await loadSession(db, staff.session.token))!;
    expect(s.org.id).toBe(staff.org.id);
    expect(s.staff).toBeNull();
    const row = await db.query.sessions.findFirst({ where: eq(sessions.token, staff.session.token) });
    expect(row!.staffOrgId).toBeNull();
  });

  it('a non-staff session is unchanged', async () => {
    const s = (await loadSession(db, customer.session.token))!;
    expect(s.org.id).toBe(customer.org.id);
    expect(s.staff).toBeNull();
    expect(s.staffExpired).toBeNull();
  });

  it('auth.me exposes staff with the customer name', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    const inside = await enterAsStaff(staff, customer.org.id);
    const me = await inside.caller.auth.me();
    expect(me.staff).toEqual({ orgId: customer.org.id, orgName: customer.org.name, enteredAt: expect.any(Date) });
    expect(me.currentOrg.id).toBe(customer.org.id);
    expect(me.orgs.map((o) => o.id)).not.toContain(customer.org.id);
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (`enterAsStaff` / `STAFF_SESSION_MS` not exported):

`pnpm --filter @robot/api exec vitest run src/auth/staff-session.test.ts --maxWorkers=2 --testTimeout=30000`

- [ ] **Step 5: Implement.** In `trpc.ts`, extend `SessionInfo`:

```ts
  /** Staff access (spec 2026-10-07 §2.1): set while an operator works inside a customer org; `org` is that org. */
  staff: { orgId: string; enteredAt: Date } | null;
  /** The staff columns are set but the 8 hours have passed: the app shows the expiry toast and calls `ops.leaveOrg`. */
  staffExpired: { orgId: string; orgName: string } | null;
```

In `auth/session.ts`, replace `loadSession` (keep its doc comment, extended):

```ts
import { isOperatorEmail } from '../trpc.js';

/** How long one staff entry lasts (spec 2026-10-07 §2.1). */
export const STAFF_SESSION_MS = 8 * 60 * 60 * 1000;

export async function loadSession(db: Database, token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const [s] = await db
    .select({
      token: sessions.token, ownOrgId: sessions.orgId, staffOrgId: sessions.staffOrgId, staffEnteredAt: sessions.staffEnteredAt,
      userId: users.id, email: users.email, name: users.name, avatarColour: users.avatarColour, theme: users.theme,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!s) return null;

  const operator = isOperatorEmail(s.email);
  const staffSet = !!s.staffOrgId && !!s.staffEnteredAt;
  const staffValid = staffSet && operator && Date.now() - s.staffEnteredAt!.getTime() < STAFF_SESSION_MS;
  const orgId = staffValid ? s.staffOrgId! : s.ownOrgId;

  const [o] = await db
    .select({ id: orgs.id, slug: orgs.slug, name: orgs.name, personal: orgs.personal, role: memberships.role })
    .from(orgs)
    .leftJoin(memberships, and(eq(memberships.orgId, orgs.id), eq(memberships.userId, s.userId)))
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!o) return null;
  // Outside staff mode the session's org must still be one the user belongs to (as before).
  if (!staffValid && !o.role) return null;

  let staffExpired: SessionInfo['staffExpired'] = null;
  if (staffSet && operator && !staffValid) {
    const gone = await db.query.orgs.findFirst({ where: eq(orgs.id, s.staffOrgId!), columns: { name: true } });
    if (gone) staffExpired = { orgId: s.staffOrgId!, orgName: gone.name };
  }

  return {
    token: s.token,
    user: { id: s.userId, email: s.email, name: s.name, avatarColour: s.avatarColour, theme: s.theme as SessionInfo['user']['theme'] },
    org: { id: o.id, slug: o.slug, name: o.name, personal: o.personal },
    // Least privilege inside a customer org: every role-gated procedure is on the deny-list anyway.
    role: staffValid ? 'member' : (o.role as SessionInfo['role']),
    staff: staffValid ? { orgId: s.staffOrgId!, enteredAt: s.staffEnteredAt! } : null,
    staffExpired,
  };
}
```

Check `trpc.ts` doesn't import `auth/session.ts` (it doesn't today) so the new import is not a cycle. In `auth.me`, add to the return:

```ts
      staff: ctx.session.staff ? { ...ctx.session.staff, orgName: ctx.session.org.name } : null,
      staffExpired: ctx.session.staffExpired,
```

In `test-helpers/identity.ts` add:

```ts
/** Puts `who`'s session inside `orgId` as staff by writing the columns directly (Task 2's `ops.enterOrg` is the product path). */
export async function enterAsStaff(who: SignedIn, orgId: string, enteredAt: Date = new Date()): Promise<SignedIn> {
  await db.update(sessions).set({ staffOrgId: orgId, staffEnteredAt: enteredAt }).where(eq(sessions.token, who.session.token));
  const session = (await loadSession(db, who.session.token))!;
  return { ...who, session, caller: createCallerFactory(appRouter)({ db, session }) };
}
```

(import `sessions` from `@robot/db`). Then run `pnpm --filter @robot/api exec tsc --noEmit` and `pnpm --filter @robot/api-server exec tsc --noEmit` and add `staff: null, staffExpired: null` to every `SessionInfo` literal the compiler flags (test fakes).

- [ ] **Step 6: Run the test — expect PASS**, then the whole api and api-server suites and the db suite:

`pnpm --filter @robot/api exec vitest run --maxWorkers=2 --testTimeout=30000` (and the same for `@robot/api-server`, `@robot/db`).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0016_staff_access.sql packages/db/drizzle/meta/0016_snapshot.json packages/db/drizzle/meta/_journal.json packages/api/src/trpc.ts packages/api/src/auth/session.ts packages/api/src/routers/auth.ts packages/api/src/test-helpers/identity.ts packages/api/src/auth/staff-session.test.ts
# plus any test files where you added staff: null literals, by explicit path
git commit -m "feat(api): staff-aware sessions and the staff_actions table"
```

---

### Task 2: Entering, leaving, and the deny-list

**Files:**
- Create: `packages/api/src/auth/staff-guard.ts`
- Create: `packages/api/src/auth/staff-actions.ts` (only `recordStaffAction` in this task; Task 3 fills the rest)
- Modify: `packages/api/src/trpc.ts` (`protectedProcedure`)
- Modify: `packages/api/src/routers/ops.ts` (`enterOrg`, `leaveOrg`)
- Test: `packages/api/src/auth/staff-guard.test.ts`

**Interfaces:**
- Consumes: Task 1's `SessionInfo.staff`, `staffExpired`, `staffActions`, `enterAsStaff`.
- Produces:
  - `STAFF_DENY_LIST: readonly string[]`, `STAFF_BLOCKED_MESSAGE = 'Not available while working as staff'`, `isStaffBlocked(path: string): boolean`.
  - `recordStaffAction(db: Database, row: { orgId: string; userId: string; actorEmail: string; action: string; summary: string; projectId?: string | null; sourceId?: string | null; runId?: string | null }): Promise<void>`.
  - `ops.enterOrg({ sourceId }) → { path: string; orgName: string }` where `path = /projects/{projectSlug}/sites/{siteSlug}` (the Verification tab is the site index route).
  - `ops.leaveOrg() → { ok: true }`.

- [ ] **Step 1: Write the failing test** `packages/api/src/auth/staff-guard.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, memberships, sessions, staffActions } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory } from '../trpc.js';
import { loadSession } from './session.js';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createCustomerSource } from '../test-helpers/customer-source.js';
import { STAFF_DENY_LIST, isStaffBlocked } from './staff-guard.js';

const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;

async function reload(who: SignedIn): Promise<SignedIn> {
  const session = (await loadSession(db, who.session.token))!;
  return { ...who, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

describe('deny-list (spec 2026-10-07 §2.3)', () => {
  it('every listed path is a real mutation', () => {
    for (const path of STAFF_DENY_LIST) {
      expect(procedures[path], path).toBeDefined();
      expect(procedures[path]!._def.type, path).toBe('mutation');
    }
  });

  it('every orgs.* mutation is listed', () => {
    const orgMutations = Object.entries(procedures).filter(([p, v]) => p.startsWith('orgs.') && v._def.type === 'mutation').map(([p]) => p);
    for (const p of orgMutations) expect(isStaffBlocked(p), p).toBe(true);
  });
});

describe('entering and leaving (spec 2026-10-07 §2.2)', () => {
  let staff: SignedIn;
  let customer: SignedIn;
  let sourceId: string;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    staff = await signedInCaller('staff-guard-op');
    customer = await signedInCaller('staff-guard-cust');
    process.env.OPS_EMAILS = staff.user.email;
    staff = await reload(staff);
    ({ sourceId } = await createCustomerSource(customer));
  });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await staff.cleanup();
  });

  it('a non-operator cannot enter', async () => {
    await expect(customer.caller.ops.enterOrg({ sourceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enter → inside the customer org, logged; deny-listed calls are FORBIDDEN; leave → back, logged', async () => {
    const r = await staff.caller.ops.enterOrg({ sourceId });
    expect(r.path).toMatch(/^\/projects\/[^/]+\/sites\/[^/]+$/);
    expect(r.orgName).toBe(customer.org.name);
    const inside = await reload(staff);
    expect(inside.session.org.id).toBe(customer.org.id);

    await expect(inside.caller.sources.delete({ sourceId })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not available while working as staff' });
    await expect(inside.caller.orgs.rename({ name: 'Hijacked' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not available while working as staff' });
    await expect(inside.caller.orgs.create({ name: 'Side org' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(inside.caller.auth.switchOrg({ orgId: staff.org.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Own-account changes stay allowed.
    await expect(inside.caller.auth.setTheme({ theme: 'dark' })).resolves.toEqual({ theme: 'dark' });

    await inside.caller.ops.leaveOrg();
    const back = await reload(staff);
    expect(back.session.org.id).toBe(staff.org.id);
    expect(back.session.staff).toBeNull();

    const log = await db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id)).orderBy(staffActions.at);
    expect(log.map((l) => l.summary)).toEqual(['Started working as staff', 'Stopped working as staff']);
    expect(log[0]).toMatchObject({ userId: staff.user.id, actorEmail: staff.user.email, action: 'ops.enterOrg', sourceId });
  });

  it('a deny-listed procedure works again for the same user outside staff mode', async () => {
    const back = await reload(staff);
    await expect(back.caller.orgs.rename({ name: 'Own renamed' })).resolves.toEqual({ name: 'Own renamed' });
  });

  it('a real member who enters as staff is still blocked', async () => {
    await db.insert(memberships).values({ userId: staff.user.id, orgId: customer.org.id, role: 'admin' });
    try {
      await staff.caller.ops.enterOrg({ sourceId });
      const inside = await reload(staff);
      await expect(inside.caller.orgs.rename({ name: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not available while working as staff' });
      await inside.caller.ops.leaveOrg();
    } finally {
      await db.delete(memberships).where(and(eq(memberships.userId, staff.user.id), eq(memberships.orgId, customer.org.id)));
    }
  });

  it('signing out inside staff mode is logged', async () => {
    const other = await signedInCaller('staff-guard-op2');
    process.env.OPS_EMAILS = `${staff.user.email},${other.user.email}`;
    try {
      const op = await reload(other);
      await op.caller.ops.enterOrg({ sourceId });
      const inside = await reload(other);
      await inside.caller.auth.signOut();
      const last = await db.select().from(staffActions).where(and(eq(staffActions.orgId, customer.org.id), eq(staffActions.userId, other.user.id)));
      expect(last.map((l) => l.summary)).toContain('Stopped working as staff (signed out)');
    } finally {
      process.env.OPS_EMAILS = staff.user.email;
      await other.cleanup();
    }
  });

  it('leaving an expired staff session logs the expiry', async () => {
    await staff.caller.ops.enterOrg({ sourceId });
    await db.update(sessions).set({ staffEnteredAt: new Date(Date.now() - 9 * 3600_000) }).where(eq(sessions.token, staff.session.token));
    const expired = await reload(staff);
    expect(expired.session.staffExpired).toEqual({ orgId: customer.org.id, orgName: customer.org.name });
    await expired.caller.ops.leaveOrg();
    const row = await db.query.sessions.findFirst({ where: eq(sessions.token, staff.session.token) });
    expect(row!.staffOrgId).toBeNull();
    const log = await db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id));
    expect(log.map((l) => l.summary)).toContain('Staff session ended after 8 hours');
  });
});
```

`createCustomerSource` is the existing helper in `packages/api/src/test-helpers/customer-source.ts`; read its signature first and adapt the destructure (it may return `{ sourceId, projectId, ... }` and take the signed-in identity or its caller).

- [ ] **Step 2: Run it — expect FAIL** (`staff-guard.js` missing).

- [ ] **Step 3: Implement `staff-guard.ts`:**

```ts
// What staff may not do inside a customer's organisation (spec 2026-10-07 §2.3).
// One list, checked by one middleware on every protected procedure; a path not
// listed is allowed. `staff-guard.test.ts` fails if a listed path stops existing.

export const STAFF_BLOCKED_MESSAGE = 'Not available while working as staff';

export const STAFF_DENY_LIST = [
  // The organisation itself
  'orgs.rename',
  'orgs.delete',
  'orgs.create',
  'orgs.members.setRole',
  'orgs.members.remove',
  'auth.switchOrg',
  // Deletions
  'projects.delete',
  'sources.delete',
  'datasets.deleteField',
  'datasets.deleteAxis',
] as const;

const blocked = new Set<string>(STAFF_DENY_LIST);

export function isStaffBlocked(path: string): boolean {
  return blocked.has(path);
}
```

`staff-actions.ts` (first part; Task 3 extends this file):

```ts
// The staff activity log (spec 2026-10-07 §2.4): append-only rows the customer can read.
import { staffActions, type Database } from '@robot/db';

export type StaffActionRow = {
  orgId: string; userId: string; actorEmail: string; action: string; summary: string;
  projectId?: string | null; sourceId?: string | null; runId?: string | null;
};

export async function recordStaffAction(db: Database, row: StaffActionRow): Promise<void> {
  await db.insert(staffActions).values(row);
}
```

In `trpc.ts`, add the guard after the session check (the middleware receives `path`):

```ts
import { STAFF_BLOCKED_MESSAGE, isStaffBlocked } from './auth/staff-guard.js';

/** A procedure that needs a signed-in user; `ctx.session` is non-null inside.
 * Staff working inside a customer org (spec 2026-10-07) are refused the deny-listed paths. */
export const protectedProcedure = publicProcedure
  .use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
    return next({ ctx: { ...ctx, session: ctx.session } });
  })
  .use(({ ctx, path, next }) => {
    if (ctx.session.staff && isStaffBlocked(path)) throw new TRPCError({ code: 'FORBIDDEN', message: STAFF_BLOCKED_MESSAGE });
    return next();
  });
```

`auth.signOut`: log before the delete when in staff mode:

```ts
  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.session.staff) {
      await recordStaffAction(ctx.db, { orgId: ctx.session.staff.orgId, userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'auth.signOut', summary: 'Stopped working as staff (signed out)' });
    }
    ...existing body
```

In `routers/ops.ts` add (update the router's header comment: ops is read-only except these two, which touch only the caller's own session and the log):

```ts
  /** Staff access (spec 2026-10-07 §2.2): the caller's own session enters the website's organisation. */
  enterOrg: opsProcedure.input(z.object({ sourceId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ orgId: projects.orgId, orgName: orgs.name, projectId: projects.id, projectSlug: projects.slug, siteSlug: sources.slug })
      .from(sources)
      .innerJoin(projects, eq(sources.projectId, projects.id))
      .innerJoin(orgs, eq(projects.orgId, orgs.id))
      .where(eq(sources.id, input.sourceId))
      .limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Website not found' });
    // A previous, still-open staff entry elsewhere is closed first, so the log never shows two open entries.
    if (ctx.session.staff && ctx.session.staff.orgId !== row.orgId) {
      await recordStaffAction(ctx.db, { orgId: ctx.session.staff.orgId, userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'ops.leaveOrg', summary: 'Stopped working as staff' });
    }
    await ctx.db.update(sessions).set({ staffOrgId: row.orgId, staffEnteredAt: new Date() }).where(eq(sessions.token, ctx.session.token));
    await recordStaffAction(ctx.db, { orgId: row.orgId, userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'ops.enterOrg', summary: 'Started working as staff', projectId: row.projectId, sourceId: input.sourceId });
    return { path: `/projects/${row.projectSlug}/sites/${row.siteSlug}`, orgName: row.orgName };
  }),

  /** Any signed-in session with staff columns set may leave — also after the 8 hours, which logs the expiry. */
  leaveOrg: protectedProcedure.mutation(async ({ ctx }) => {
    const raw = await ctx.db.query.sessions.findFirst({ where: eq(sessions.token, ctx.session.token), columns: { staffOrgId: true } });
    if (raw?.staffOrgId) {
      await ctx.db.update(sessions).set({ staffOrgId: null, staffEnteredAt: null }).where(eq(sessions.token, ctx.session.token));
      const summary = ctx.session.staff ? 'Stopped working as staff' : ctx.session.staffExpired ? 'Staff session ended after 8 hours' : null;
      if (summary) await recordStaffAction(ctx.db, { orgId: raw.staffOrgId, userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'ops.leaveOrg', summary });
    }
    return { ok: true as const };
  }),
```

(Use the real column for the site slug — check `sources` in `schema.ts`; the app's site route uses the source's slug.) If the email was removed from `OPS_EMAILS` (neither `staff` nor `staffExpired`), leaving silently clears the columns without a log row: there is nothing honest to say.

- [ ] **Step 4: Run the test — expect PASS.** Then the full api suite.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/staff-guard.ts packages/api/src/auth/staff-guard.test.ts packages/api/src/auth/staff-actions.ts packages/api/src/trpc.ts packages/api/src/routers/ops.ts packages/api/src/routers/auth.ts
git commit -m "feat(api): enter and leave a customer org as staff; deny-list destructive and org actions"
```

---

### Task 3: Logging every staff-mode mutation

**Files:**
- Modify: `packages/api/src/auth/staff-actions.ts`
- Modify: `packages/api/src/trpc.ts` (logger middleware on `protectedProcedure`)
- Test: `packages/api/src/auth/staff-actions.test.ts`

**Interfaces:**
- Consumes: `recordStaffAction`, `SessionInfo.staff`.
- Produces:
  - `STAFF_ACTIONS: Record<string, StaffAction | null>` — every mutation path in the app router has a key; `null` means "never logged" with the reason in a comment.
  - `type StaffAction = { before?: (db: Database, input: any) => Promise<unknown>; describe: (c: DescribeArgs) => string | Promise<string>; runId?: (input: any, result: any) => string | undefined; coalesceMinutes?: number }`.
  - `type Target = { website: { id: string; name: string; projectId: string } | null; project: { id: string; name: string } | null }`; `resolveTarget(db, input, result): Promise<Target>`.
  - `logStaffMutation(args: { db; session: SessionInfo; path: string; input: unknown; result: unknown; before: unknown }): Promise<void>` — never throws (R3).
  - `beforeStaffMutation(db, path, input): Promise<unknown>` — runs `before` if any; never throws.

- [ ] **Step 1: Write the failing test** `packages/api/src/auth/staff-actions.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, staffActions } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory } from '../trpc.js';
import { loadSession } from './session.js';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createCustomerSource } from '../test-helpers/customer-source.js';
import { STAFF_ACTIONS, logStaffMutation } from './staff-actions.js';

const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;

describe('every mutation has a sentence (spec 2026-10-07 §2.4)', () => {
  it('STAFF_ACTIONS has a key for every mutation and nothing else', () => {
    const mutations = Object.entries(procedures).filter(([, v]) => v._def.type === 'mutation').map(([p]) => p).sort();
    expect(Object.keys(STAFF_ACTIONS).sort()).toEqual(mutations);
  });
});

describe('the staff action log', () => {
  let staff: SignedIn;
  let customer: SignedIn;
  let inside: SignedIn;
  let sourceId: string;
  const saved = process.env.OPS_EMAILS;
  const rows = async () => db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id)).orderBy(staffActions.at);

  beforeAll(async () => {
    staff = await signedInCaller('staff-log-op');
    customer = await signedInCaller('staff-log-cust');
    process.env.OPS_EMAILS = staff.user.email;
    ({ sourceId } = await createCustomerSource(customer));
    const s0 = (await loadSession(db, staff.session.token))!;
    await createCallerFactory(appRouter)({ db, session: s0 }).ops.enterOrg({ sourceId });
    const s = (await loadSession(db, staff.session.token))!;
    inside = { ...staff, session: s, caller: createCallerFactory(appRouter)({ db, session: s }) };
  });
  beforeEach(async () => { await db.delete(staffActions).where(eq(staffActions.orgId, customer.org.id)); });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await staff.cleanup();
  });

  it('an allowed mutation writes one row with the right sentence and ids', async () => {
    const before = (await customer.caller.sources.get({ sourceId })).name; // adapt to sources.get's real output shape
    await inside.caller.sources.rename({ sourceId, name: 'Zalando EU' });
    const log = await rows();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'sources.rename', summary: `Renamed website ${before} to Zalando EU`, sourceId, userId: staff.user.id });
    expect(log[0]!.projectId).toBeTruthy();
  });

  it('queries write nothing', async () => {
    await inside.caller.projects.list();
    await inside.caller.sources.get({ sourceId });
    expect(await rows()).toHaveLength(0);
  });

  it('a mutation that fails writes nothing', async () => {
    await expect(inside.caller.sources.rename({ sourceId: '00000000-0000-4000-8000-000000000000', name: 'X' })).rejects.toBeTruthy();
    expect(await rows()).toHaveLength(0);
  });

  it('own-account changes are not logged', async () => {
    await inside.caller.auth.updateName({ name: 'Staff Person' });
    expect(await rows()).toHaveLength(0);
  });

  it('the same mutation outside staff mode writes nothing', async () => {
    await customer.caller.sources.rename({ sourceId, name: 'Zalando' });
    expect(await rows()).toHaveLength(0);
  });

  it('Verification autosave is logged at most once per 10 minutes (ruling R1)', async () => {
    const call = { db, session: inside.session, path: 'sources.updateBinding', input: { sourceId }, result: undefined, before: undefined };
    await logStaffMutation(call);
    await logStaffMutation(call);
    expect((await rows()).map((r) => r.summary)).toEqual([expect.stringMatching(/^Edited the Verification answers on /)]);
  });
});
```

Also add unit tests for the sentence table that don't need a router call, one per row in the table below, by calling `STAFF_ACTIONS[path]!.describe({ db, input, result, before, target })` with a hand-built `target` (`{ website: { id: 's', name: 'Nike', projectId: 'p' }, project: { id: 'p', name: 'Shoes' } }`). Example:

```ts
const target = { website: { id: 's', name: 'Nike', projectId: 'p' }, project: { id: 'p', name: 'Shoes' } };
const say = (path: string, input: unknown, result: unknown = undefined, before: unknown = undefined) =>
  STAFF_ACTIONS[path]!.describe({ db, input, result, before, target });

it.each([
  ['crawl.execute', { runId: 'r' }, undefined, undefined, 'Ran an extraction on Nike'],
  ['crawl.plan', { sourceId: 's' }, { runId: 'r' }, { budget: 50 }, 'Planned an extraction on Nike (budget 50 products)'],
  ['sources.verify', { sourceId: 's' }, undefined, undefined, 'Verified Nike'],
  ['sources.verify', { sourceId: 's', onlyKeys: ['price'] }, undefined, { fieldNames: { price: 'Price' } }, 'Re-verified Price on Nike'],
  ['datasets.renameField', { datasetId: 'd', key: 'price', name: 'Sale price' }, undefined, { name: 'Price' }, 'Renamed field Price to Sale price'],
  ['sources.createInProject', { projectSlug: 'shoes', name: 'Zalando', url: 'https://zalando.de' }, { sourceId: 's2' }, undefined, 'Added website Zalando'],
  ['sources.update', { id: 's', isActive: false }, undefined, undefined, "Changed Nike's settings"],
])('%s → %s', async (path, input, result, before, expected) => {
  expect(await say(path, input, result, before)).toBe(expected);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the table.** In `staff-actions.ts`, below `recordStaffAction`:

```ts
import { eq } from 'drizzle-orm';
import { datasets, projects, runs, sources, staffActions, type Database } from '@robot/db';
import type { SessionInfo } from '../trpc.js';
import { contractAxes, contractFields } from '../contract.js';

export type Target = {
  website: { id: string; name: string; projectId: string } | null;
  project: { id: string; name: string } | null;
};
type DescribeArgs = { db: Database; input: any; result: any; before: any; target: Target };
export type StaffAction = {
  before?: (db: Database, input: any) => Promise<unknown>;
  describe: (c: DescribeArgs) => string | Promise<string>;
  runId?: (input: any, result: any) => string | undefined;
  coalesceMinutes?: number;
};

const site = (t: Target) => t.website?.name ?? 'a website';
const proj = (t: Target) => t.project?.name ?? 'a project';

async function fieldName(db: Database, datasetId: string, key: string): Promise<string | undefined> {
  const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, datasetId), columns: { schema: true } });
  return [...contractFields(ds?.schema), ...contractAxes(ds?.schema)].find((f) => f.key === key)?.name;
}
async function fieldNames(db: Database, sourceId: string): Promise<Record<string, string>> {
  const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { datasetId: true } });
  if (!src?.datasetId) return {};
  const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, src.datasetId), columns: { schema: true } });
  return Object.fromEntries(contractFields(ds?.schema).map((f) => [f.key, f.name]));
}
const VARIANT_MODES: Record<string, string> = { ignore: 'one row per product', row_per_variant: 'one row per variant', nested: 'variants in one row' };

export const STAFF_ACTIONS: Record<string, StaffAction | null> = {
  // ─ Never logged ─
  'auth.signIn': null, // no session yet
  'auth.signOut': null, // logged by the procedure itself, before the session row goes
  'auth.setTheme': null, // the staff member's own account
  'auth.updateName': null, // the staff member's own account
  'auth.switchOrg': null, // deny-listed: never succeeds in staff mode
  'orgs.create': null, // deny-listed
  'orgs.rename': null, // deny-listed
  'orgs.delete': null, // deny-listed
  'orgs.members.setRole': null, // deny-listed
  'orgs.members.remove': null, // deny-listed
  'projects.delete': null, // deny-listed
  'sources.delete': null, // deny-listed
  'datasets.deleteField': null, // deny-listed
  'datasets.deleteAxis': null, // deny-listed
  'ops.enterOrg': null, // writes its own row
  'ops.leaveOrg': null, // writes its own row

  // ─ Runs ─
  'crawl.plan': {
    before: async (db, i) => db.query.sources.findFirst({ where: eq(sources.id, i.sourceId), columns: { budget: true } }),
    describe: ({ input, before, target }) => input.probe
      ? `Tried a sample on ${site(target)}`
      : `Planned an extraction on ${site(target)} (budget ${before?.budget ?? '?'} products)`,
    runId: (_i, r) => r?.runId,
  },
  'crawl.probeAndSample': { describe: ({ target }) => `Ran a sample on ${site(target)}`, runId: (_i, r) => r?.runId },
  'crawl.execute': {
    describe: ({ input, target }) => input.retryFailed ? `Retried the failed pages of a run on ${site(target)}` : `Ran an extraction on ${site(target)}`,
    runId: (i) => i.runId,
  },
  'crawl.cancel': { describe: ({ target }) => `Cancelled a run on ${site(target)}`, runId: (i) => i.runId },
  'crawl.backfill': { describe: ({ target }) => `Filled in missing values on ${site(target)}`, runId: (i, r) => r?.backfillRunId ?? i.runId },

  // ─ Fields (the project's dataset) ─
  'datasets.addField': { describe: ({ input, target }) => `Added field ${input.name} to ${proj(target)}` },
  'datasets.renameField': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => `Renamed field ${before?.name ?? input.key} to ${input.name}`,
  },
  'datasets.retypeField': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => `Changed field ${before?.name ?? input.key} to ${input.type}`,
  },
  'datasets.setVariantMode': { describe: ({ input, target }) => `Set variants on ${proj(target)} to ${VARIANT_MODES[input.mode] ?? input.mode}` },
  'datasets.setFieldLevel': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => {
      const f = before?.name ?? input.key;
      return input.level === null ? `Reset where ${f} is read` : `Set ${f} to be read per ${input.level}`;
    },
  },
  'datasets.addAxis': { describe: ({ input }) => `Added variant column ${input.name}` },
  'datasets.renameAxis': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => `Renamed variant column ${before?.name ?? input.key} to ${input.name}`,
  },

  // ─ Projects ─
  'projects.create': { describe: ({ input }) => `Created project ${input.name}` },
  'projects.rename': {
    before: async (db, i) => db.query.projects.findFirst({ where: eq(projects.id, i.projectId), columns: { name: true } }),
    describe: ({ input, before }) => renamed('project', before?.name, input.name),
  },

  // ─ Websites ─
  'sources.createInProject': { describe: ({ input }) => `Added website ${input.name}` },
  'sources.rename': {
    before: async (db, i) => db.query.sources.findFirst({ where: eq(sources.id, i.sourceId), columns: { name: true } }),
    describe: ({ input, before }) => renamed('website', before?.name, input.name),
  },
  'sources.update': { describe: ({ target }) => `Changed ${site(target)}'s settings` },
  'sources.setListingPages': { describe: ({ target }) => `Changed the listing pages of ${site(target)}` },
  'sources.setProductUrls': { describe: ({ input, target }) => `Changed the product list of ${site(target)} (${input.urls.length} URLs)` },
  'sources.updateBinding': { describe: ({ target }) => `Edited the Verification answers on ${site(target)}`, coalesceMinutes: 10 },
  'sources.checkListingPage': { describe: ({ input }) => `Checked listing page ${input.listingUrl}` },
  'sources.captureProofPage': { describe: ({ target }) => `Captured a proof page on ${site(target)}` },
  'sources.transferMarks': { describe: ({ target }) => `Carried answers to other proof pages on ${site(target)}` },
  'sources.confirm': { describe: ({ target }) => `Confirmed the setup of ${site(target)}` },
  'sources.verify': {
    before: (db, i) => (i.onlyKeys?.length ? fieldNames(db, i.sourceId).then((names) => ({ fieldNames: names })) : Promise.resolve(undefined)),
    describe: ({ input, before, target }) => input.onlyKeys?.length
      ? `Re-verified ${input.onlyKeys.map((k: string) => before?.fieldNames?.[k] ?? k).join(', ')} on ${site(target)}`
      : `Verified ${site(target)}`,
  },
  'sources.checkDrift': { describe: ({ target }) => `Checked ${site(target)} for changes` },
  'sources.setVariantSetup': { describe: ({ target }) => `Set up variants on ${site(target)}` },
  'sources.saveVariantAnswer': { describe: ({ target }) => `Answered a variant question on ${site(target)}` },
};
```

`renamed` sits next to `site`/`proj`:

```ts
const renamed = (kind: string, from: string | undefined, to: string) => (from ? `Renamed ${kind} ${from} to ${to}` : `Renamed ${kind} to ${to}`);
```

Use it for the field and variant-column renames too (`renamed('field', before?.name, input.name)`, `renamed('variant column', …)`). `sources.verify` with `onlyKeys: []` (variants only) reads `Verified Nike`.

Verify the exact column names (`sources.budget`, `sources.datasetId`, `sources.name`) against `schema.ts` and adjust.

- [ ] **Step 4: Target resolution and the writer:**

```ts
/** Which website / project an input or result points at. */
export async function resolveTarget(db: Database, input: any, result: any): Promise<Target> {
  const i = (input ?? {}) as Record<string, unknown>;
  let sourceId = (i.sourceId ?? result?.sourceId) as string | undefined;
  if (!sourceId && typeof i.id === 'string') sourceId = i.id; // sources.update
  if (!sourceId && typeof i.runId === 'string') {
    sourceId = (await db.query.runs.findFirst({ where: eq(runs.id, i.runId), columns: { sourceId: true } }))?.sourceId ?? undefined;
  }
  let projectId = i.projectId as string | undefined;
  if (!projectId && typeof i.datasetId === 'string') {
    projectId = (await db.query.datasets.findFirst({ where: eq(datasets.id, i.datasetId), columns: { projectId: true } }))?.projectId;
  }
  if (!projectId && typeof result?.id === 'string' && typeof result?.datasetId === 'string') projectId = result.id; // projects.create
  const website = sourceId
    ? (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { id: true, name: true, projectId: true } })) ?? null
    : null;
  projectId ??= website?.projectId ?? undefined;
  const project = projectId
    ? (await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { id: true, name: true } })) ?? null
    : null;
  return { website: website as Target['website'], project };
}

export async function beforeStaffMutation(db: Database, path: string, input: unknown): Promise<unknown> {
  const action = STAFF_ACTIONS[path];
  if (!action?.before) return undefined;
  try { return await action.before(db, input); } catch { return undefined; }
}

/** Writes the row for one successful staff-mode mutation. Never throws (ruling R3). */
export async function logStaffMutation(a: { db: Database; session: SessionInfo; path: string; input: unknown; result: unknown; before: unknown }): Promise<void> {
  const staff = a.session.staff;
  const action = STAFF_ACTIONS[a.path];
  if (!staff || action === null) return;
  try {
    const target = await resolveTarget(a.db, a.input, a.result);
    const summary = action
      ? await action.describe({ db: a.db, input: a.input, result: a.result, before: a.before, target })
      : `Made a change on ${target.website?.name ?? target.project?.name ?? 'this organisation'}`;
    if (action?.coalesceMinutes && target.website) {
      const since = new Date(Date.now() - action.coalesceMinutes * 60_000);
      const recent = await a.db.query.staffActions.findFirst({
        where: (t, { and, eq: e, gt }) => and(e(t.userId, a.session.user.id), e(t.sourceId, target.website!.id), e(t.action, a.path), gt(t.at, since)),
        columns: { id: true },
      });
      if (recent) return;
    }
    await recordStaffAction(a.db, {
      orgId: staff.orgId, userId: a.session.user.id, actorEmail: a.session.user.email, action: a.path, summary,
      projectId: target.project?.id ?? null, sourceId: target.website?.id ?? null, runId: action?.runId?.(a.input, a.result) ?? null,
    });
  } catch (err) {
    console.error(`[staff-actions] could not log ${a.path} in org ${staff.orgId}`, err);
  }
}
```

(`db.query.staffActions` needs `staffActions` exported from `@robot/db`'s schema object — it is, once Task 1 added it to `schema.ts`.)

- [ ] **Step 5: The logger middleware** in `trpc.ts`, appended to `protectedProcedure` after the guard:

```ts
  .use(async ({ ctx, path, type, getRawInput, next }) => {
    if (type !== 'mutation' || !ctx.session.staff) return next();
    const input = await getRawInput().catch(() => undefined);
    const before = await beforeStaffMutation(ctx.db, path, input);
    const result = await next();
    if (result.ok) await logStaffMutation({ db: ctx.db, session: ctx.session, path, input, result: result.data, before });
    return result;
  });
```

Import `beforeStaffMutation`, `logStaffMutation` from `./auth/staff-actions.js`. `staff-actions.ts` imports only the `SessionInfo` **type** from `trpc.ts` (`import type`), so there is no runtime cycle. If the raw input of a procedure is wrapped (superjson over HTTP), `getRawInput` in v11 returns the deserialized value — confirm with the HTTP path in Task 7's smoke.

- [ ] **Step 6: Run the tests — expect PASS;** then the full api suite and api typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/auth/staff-actions.ts packages/api/src/auth/staff-actions.test.ts packages/api/src/trpc.ts
git commit -m "feat(api): log every staff-mode mutation with a plain sentence"
```

---

### Task 4: Reading the log — ops and the customer

**Files:**
- Create: `packages/api/src/auth/staff-activity.ts`
- Modify: `packages/api/src/routers/ops.ts`, `packages/api/src/routers/orgs.ts`
- Test: `packages/api/src/routers/staff-activity.test.ts`

**Interfaces:**
- Consumes: `staffActions`.
- Produces:
  - `type StaffEntry = { id: string; at: Date; actor: { name: string | null; email: string }; org: { id: string; name: string }; project: { id: string; name: string } | null; website: { id: string; name: string } | null; summary: string; run: { id: string; costUsd: number } | null }`.
  - `listStaffActivity(db, filter: { orgId?: string; userId?: string; sourceId?: string }, page: { offset: number; limit: number }): Promise<{ entries: StaffEntry[]; total: number }>` — newest first (`at desc, id desc`).
  - `ops.staffActivity({ orgId?, userId?, sourceId?, page = 0, pageSize = 50 (max 50) }) → { entries, total }` (opsProcedure, query).
  - `ops.staffActivityFilters() → { customers: Array<{ id, name }>; staff: Array<{ userId: string | null; email: string; name: string | null }> }` — the distinct orgs and actors that appear in the log, sorted by name/email.
  - `orgs.staffActivity({ page = 0 }) → { entries, total }` — the session's org only, 20 per page, any member (protectedProcedure, query).

- [ ] **Step 1: Write the failing test** `packages/api/src/routers/staff-activity.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, staffActions } from '@robot/db';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createCustomerSource } from '../test-helpers/customer-source.js';
import { recordStaffAction } from '../auth/staff-actions.js';

describe('staff activity (spec 2026-10-07 §2.4)', () => {
  let staff: SignedIn; let customer: SignedIn; let other: SignedIn;
  let sourceId: string; let projectId: string; let runId: string;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    staff = await signedInCaller('activity-op');
    customer = await signedInCaller('activity-cust');
    other = await signedInCaller('activity-other');
    process.env.OPS_EMAILS = staff.user.email;
    ({ sourceId, projectId } = await createCustomerSource(customer));
    const [run] = await db.insert(runs).values({ sourceId, status: 'completed', costUsd: '1.2400' }).returning({ id: runs.id });
    runId = run!.id;
    const base = { orgId: customer.org.id, userId: staff.user.id, actorEmail: staff.user.email };
    for (let n = 0; n < 23; n++) await recordStaffAction(db, { ...base, action: 'sources.update', summary: `Change ${n}`, projectId, sourceId });
    await recordStaffAction(db, { ...base, action: 'crawl.execute', summary: 'Ran an extraction on Nike', projectId, sourceId, runId });
    await recordStaffAction(db, { orgId: other.org.id, userId: staff.user.id, actorEmail: staff.user.email, action: 'sources.update', summary: 'Elsewhere' });
  });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await other.cleanup(); await customer.cleanup(); await staff.cleanup();
  });

  it('the customer sees their own entries, newest first, 20 per page, with run cost read now', async () => {
    const p0 = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(p0.total).toBe(24);
    expect(p0.entries).toHaveLength(20);
    expect(p0.entries[0]).toMatchObject({ summary: 'Ran an extraction on Nike', run: { id: runId, costUsd: 1.24 }, actor: { email: staff.user.email } });
    expect(p0.entries.every((e) => e.org.id === customer.org.id)).toBe(true);
    const p1 = await customer.caller.orgs.staffActivity({ page: 1 });
    expect(p1.entries).toHaveLength(4);
  });

  it('cost is read at view time, not stored', async () => {
    await db.update(runs).set({ costUsd: '2.5000' }).where(eq(runs.id, runId));
    const p0 = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(p0.entries[0]!.run!.costUsd).toBe(2.5);
  });

  it('another org sees only its own entries', async () => {
    const r = await other.caller.orgs.staffActivity({ page: 0 });
    expect(r.entries.map((e) => e.summary)).toEqual(['Elsewhere']);
  });

  it('ops filters by customer and staff member and by website', async () => {
    const all = await staff.caller.ops.staffActivity({ userId: staff.user.id });
    expect(all.total).toBeGreaterThanOrEqual(25);
    const byOrg = await staff.caller.ops.staffActivity({ orgId: customer.org.id });
    expect(byOrg.total).toBe(24);
    const bySite = await staff.caller.ops.staffActivity({ sourceId, pageSize: 10 });
    expect(bySite.entries).toHaveLength(10);
    const filters = await staff.caller.ops.staffActivityFilters();
    expect(filters.customers.map((c) => c.id)).toEqual(expect.arrayContaining([customer.org.id, other.org.id]));
    expect(filters.staff.map((s) => s.email)).toContain(staff.user.email);
  });

  it('a non-operator cannot read ops.staffActivity', async () => {
    await expect(customer.caller.ops.staffActivity({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a deleted staff user keeps their entries with the email', async () => {
    const gone = await signedInCaller('activity-gone');
    await recordStaffAction(db, { orgId: customer.org.id, userId: gone.user.id, actorEmail: gone.user.email, action: 'sources.update', summary: 'By someone gone' });
    await gone.cleanup();
    const r = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(r.entries[0]).toMatchObject({ summary: 'By someone gone', actor: { name: null, email: gone.user.email } });
    await db.delete(staffActions).where(eq(staffActions.summary, 'By someone gone')); // keep the counts above stable on re-run
  });
});
```

(Check `runs`' required columns in `schema.ts` and add any the insert needs. Test-file cleanup deleting log rows is test hygiene, not a product delete procedure.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `staff-activity.ts`:**

```ts
// Reading the staff activity log (spec 2026-10-07 §2.4) — one query for ops and the customer.
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { orgs, projects, runs, sources, staffActions, users, type Database } from '@robot/db';

export type StaffEntry = {
  id: string; at: Date;
  actor: { name: string | null; email: string };
  org: { id: string; name: string };
  project: { id: string; name: string } | null;
  website: { id: string; name: string } | null;
  summary: string;
  run: { id: string; costUsd: number } | null;
};

export async function listStaffActivity(
  db: Database,
  filter: { orgId?: string; userId?: string; sourceId?: string },
  page: { offset: number; limit: number },
): Promise<{ entries: StaffEntry[]; total: number }> {
  const conds: SQL[] = [];
  if (filter.orgId) conds.push(eq(staffActions.orgId, filter.orgId));
  if (filter.userId) conds.push(eq(staffActions.userId, filter.userId));
  if (filter.sourceId) conds.push(eq(staffActions.sourceId, filter.sourceId));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ n }]] = await Promise.all([
    db.select({
      id: staffActions.id, at: staffActions.at, summary: staffActions.summary, actorEmail: staffActions.actorEmail,
      userName: users.name, orgId: orgs.id, orgName: orgs.name,
      projectId: projects.id, projectName: projects.name, sourceId: sources.id, sourceName: sources.name,
      runId: runs.id, runCost: runs.costUsd,
    })
      .from(staffActions)
      .innerJoin(orgs, eq(staffActions.orgId, orgs.id))
      .leftJoin(users, eq(staffActions.userId, users.id))
      .leftJoin(projects, eq(staffActions.projectId, projects.id))
      .leftJoin(sources, eq(staffActions.sourceId, sources.id))
      .leftJoin(runs, eq(staffActions.runId, runs.id))
      .where(where)
      .orderBy(desc(staffActions.at), desc(staffActions.id))
      .offset(page.offset)
      .limit(page.limit),
    db.select({ n: count() }).from(staffActions).where(where),
  ]);

  return {
    total: Number(n),
    entries: rows.map((r) => ({
      id: r.id, at: r.at, summary: r.summary,
      actor: { name: r.userName ?? null, email: r.actorEmail },
      org: { id: r.orgId, name: r.orgName },
      project: r.projectId ? { id: r.projectId, name: r.projectName! } : null,
      website: r.sourceId ? { id: r.sourceId, name: r.sourceName! } : null,
      run: r.runId ? { id: r.runId, costUsd: Number(r.runCost) } : null,
    })),
  };
}
```

`ops.ts`:

```ts
  staffActivity: opsProcedure
    .input(z.object({
      orgId: z.string().uuid().optional(), userId: z.string().uuid().optional(), sourceId: z.string().uuid().optional(),
      page: z.number().int().min(0).default(0), pageSize: z.number().int().min(1).max(50).default(50),
    }))
    .query(({ ctx, input }) => listStaffActivity(ctx.db, input, { offset: input.page * input.pageSize, limit: input.pageSize })),

  staffActivityFilters: opsProcedure.query(async ({ ctx }) => {
    const customers = await ctx.db.selectDistinct({ id: orgs.id, name: orgs.name }).from(staffActions).innerJoin(orgs, eq(staffActions.orgId, orgs.id)).orderBy(orgs.name);
    const staff = await ctx.db.selectDistinct({ userId: staffActions.userId, email: staffActions.actorEmail, name: users.name })
      .from(staffActions).leftJoin(users, eq(staffActions.userId, users.id)).orderBy(staffActions.actorEmail);
    return { customers, staff };
  }),
```

`orgs.ts`:

```ts
  /** Robot staff activity in this organisation (spec 2026-10-07 §2.4) — every member may read it. */
  staffActivity: protectedProcedure
    .input(z.object({ page: z.number().int().min(0).default(0) }))
    .query(({ ctx, input }) => listStaffActivity(ctx.db, { orgId: ctx.session.org.id }, { offset: input.page * 20, limit: 20 })),
```

(`ops.staffActivity` takes an empty object, so the test's `ops.staffActivity({})` works. Use `.input(... ).optional()` defaults carefully: with `z.object` + defaults, `{}` is valid.)

- [ ] **Step 4: Run — expect PASS;** full api suite.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/staff-activity.ts packages/api/src/routers/ops.ts packages/api/src/routers/orgs.ts packages/api/src/routers/staff-activity.test.ts
git commit -m "feat(api): staff activity for ops and for the customer's Settings"
```

---

### Task 5: Staff mode in the app — enter, banner, blocked controls, expiry

**Files:**
- Modify: `packages/app/src/lib/session.ts`
- Create: `packages/app/src/lib/staff-view.ts`, `packages/app/src/lib/staff-view.test.ts`
- Create: `packages/app/src/components/shell/staff-banner.tsx`, `packages/app/src/components/ops/work-on-website-dialog.tsx`
- Modify: `packages/app/src/routes/_app.tsx`, `components/shell/sidebar.tsx`, `routes/_app/ops/websites/$sourceId.tsx` (replace `OpenInAppLink`), `routes/_app/settings.tsx`, `routes/_app/projects/$project/sites/$site/settings.tsx`, `components/fields/fields-table.tsx`, `components/fields/variants-panel.tsx`, `components/org/general-panel.tsx`, `components/org/members-table.tsx`

**Interfaces:**
- Consumes: `auth.me` `staff`/`staffExpired`; `ops.enterOrg` → `{ path, orgName }`; `ops.leaveOrg`.
- Produces:
  - `Session.staff: { orgId: string; orgName: string; enteredAt: Date } | null`, `Session.staffExpired: { orgId: string; orgName: string } | null`.
  - `staff-view.ts`: `STAFF_BLOCKED = 'Not available while working as staff'`; `bannerText(customer: string): string`; `confirmCopy(website: string, customer: string): { title: string; body: string }`; `expiryToast(customer: string): string`; `staffBlockedNote(staff: boolean, roleNote: string | null): string | null` (staff wins).
  - `useLeaveStaff(): { leave: () => Promise<void>; pending: boolean }` exported from `staff-banner.tsx` — calls `ops.leaveOrg`, invalidates the router (re-runs `getSession`), clears the query cache, navigates to `/ops`.

- [ ] **Step 1: Write the failing test** `packages/app/src/lib/staff-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STAFF_BLOCKED, bannerText, confirmCopy, expiryToast, staffBlockedNote } from './staff-view';

describe('staff-view (spec 2026-10-07 §2.2-2.3)', () => {
  it('copy is exact', () => {
    expect(bannerText('Acme')).toBe('Working as Robot staff in Acme');
    expect(confirmCopy('Nike', 'Acme')).toEqual({
      title: 'Work on Nike as staff?',
      body: "You'll act inside Acme's organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to Acme.",
    });
    expect(expiryToast('Acme')).toBe('Your staff session in Acme ended after 8 hours.');
    expect(STAFF_BLOCKED).toBe('Not available while working as staff');
  });

  it('staff mode wins over the role note', () => {
    expect(staffBlockedNote(true, 'Only owners can do that')).toBe(STAFF_BLOCKED);
    expect(staffBlockedNote(false, 'Only owners can do that')).toBe('Only owners can do that');
    expect(staffBlockedNote(false, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/app exec vitest run src/lib/staff-view.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement `staff-view.ts`:**

```ts
// Staff access copy (spec 2026-10-07 §2.2-2.3). Exact strings; the tests pin them.
export const STAFF_BLOCKED = 'Not available while working as staff';

export const bannerText = (customer: string) => `Working as Robot staff in ${customer}`;

export const confirmCopy = (website: string, customer: string) => ({
  title: `Work on ${website} as staff?`,
  body: `You'll act inside ${customer}'s organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to ${customer}.`,
});

export const expiryToast = (customer: string) => `Your staff session in ${customer} ended after 8 hours.`;

/** The reason a control is disabled: staff mode first, then whatever the role allows. */
export function staffBlockedNote(staff: boolean, roleNote: string | null): string | null {
  return staff ? STAFF_BLOCKED : roleNote;
}
```

`lib/session.ts`: add `staff` and `staffExpired` to `Session` (`auth.me` already returns them; `Omit<Session, 'isOperator'>` picks them up). `enteredAt` arrives as a `Date` via superjson.

- [ ] **Step 4: The banner and leaving** — `components/shell/staff-banner.tsx`:

```tsx
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { bannerText } from '../../lib/staff-view';

/** Leaves staff mode and lands in ops with a fresh session. */
export function useLeaveStaff() {
  const leaveOrg = trpc.ops.leaveOrg.useMutation();
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return {
    pending: leaveOrg.isPending,
    leave: async () => {
      await leaveOrg.mutateAsync();
      queryClient.clear();
      await router.invalidate();
      await navigate({ to: '/ops' });
    },
  };
}

/** Full width above the top bar, warn rail, no wash (spec 2026-10-07 §2.2). */
export function StaffBanner({ customer }: { customer: string }) {
  const { leave, pending } = useLeaveStaff();
  return (
    <div role="status" className="flex items-center gap-3 border-b border-line border-l-2 border-l-warn bg-bg px-5 py-2 text-sm md:px-8">
      <span className="min-w-0 flex-1 truncate">{bannerText(customer)}</span>
      <Button size="sm" variant="outline" onClick={() => void leave()} disabled={pending}>Back to ops</Button>
    </div>
  );
}
```

Check how other shell code gets the query client and invalidates the session after an org change (`org-switcher.tsx`'s `afterOrgChange`) and do exactly the same thing here instead of the guess above, if it differs.

In `_app.tsx`:
- `beforeLoad`: after the login check, `if (context.session.staffExpired && !isOpsPath(location.pathname)) throw redirect({ to: '/ops' });`.
- In `AppLayout`, when `!inOps && session.staff`, render `<StaffBanner customer={session.staff.orgName} />` as the first child of the right-hand column, above `<header>` (so it sits above the top bar; it scrolls away with the page — the header stays sticky).
- Add a `StaffExpiryNotice` effect component rendered once in `AppLayout`:

```tsx
function StaffExpiryNotice({ expired }: { expired: Session['staffExpired'] }) {
  const { leave } = useLeaveStaff();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!expired || shown.current === expired.orgId) return;
    shown.current = expired.orgId;
    toast(expiryToast(expired.orgName));
    void leave(); // clears the columns server-side and logs "Staff session ended after 8 hours" — so the toast is one-time
  }, [expired, leave]);
  return null;
}
```

In `sidebar.tsx`: when `session.staff` is set, don't render `<OrgSwitcher>` (render the customer name as plain text in its place, same height) and don't render the sidebar's existing "Back to ops" link (the banner carries it).

- [ ] **Step 5: "Work on this website"** — `components/ops/work-on-website-dialog.tsx`: a dialog using the app's existing dialog component (the same one `delete-website-dialog.tsx` uses), with `confirmCopy(website, customer)` title/body, buttons **Start working** (primary; disabled + "Starting…" while pending) and **Cancel**. On confirm: `const r = await enterOrg.mutateAsync({ sourceId }); queryClient.clear(); window.location.assign(r.path);` — a full navigation, like the old `OpenInAppLink`, so `getSession` re-reads the session for the new org. On error, show the error message in the dialog's error slot the way other dialogs do.

In `routes/_app/ops/websites/$sourceId.tsx`, replace `OpenInAppLink` with a `WorkOnWebsiteButton` (primary `Button` "Work on this website", always enabled for an operator) that opens the dialog with `data.website.name` and `data.org.name`. Remove the "not a member" tooltip and update the doc comment. `operatorIsMember` stays in the API output (unused here now) — leave it; removing it is out of scope.

- [ ] **Step 6: Blocked controls show why.** Use `session.staff` from the route context (`Route.useRouteContext()` or the `_app` route's context in components that already receive `session`); pass `staff: boolean` as a prop where a component doesn't have the session.
- **Website Settings** (`routes/_app/projects/$project/sites/$site/settings.tsx`): the **Delete website** button is `disabled` in staff mode with the `STAFF_BLOCKED` note in the muted line beside it (the app's rule: "Every disabled control says why, within a line of it") and as a `Tooltip` on the button (wrap in a focusable span, as the ops page did for its disabled link).
- **Fields** (`components/fields/fields-table.tsx` → `FieldRow`'s Delete control) and **variant columns** (`components/fields/variants-panel.tsx`, the delete `Button` near line 169): disabled with the `STAFF_BLOCKED` tooltip.
- **Organisation Settings** (`routes/_app/settings.tsx`, `general-panel.tsx`, `members-table.tsx`): rename, role select, Remove, and Delete organisation use `staffBlockedNote(!!session.staff, existingNote)` for their disabled state and note.
- Nothing else changes: every other control works for staff.

- [ ] **Step 7: Run the app unit tests and typecheck,** then commit:

`pnpm --filter @robot/app exec vitest run --maxWorkers=2 --testTimeout=30000` and `pnpm --filter @robot/app exec tsc --noEmit`

```bash
git add packages/app/src/lib/session.ts packages/app/src/lib/staff-view.ts packages/app/src/lib/staff-view.test.ts packages/app/src/components/shell/staff-banner.tsx packages/app/src/components/ops/work-on-website-dialog.tsx packages/app/src/routes/_app.tsx packages/app/src/components/shell/sidebar.tsx "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx" packages/app/src/routes/_app/settings.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/settings.tsx" packages/app/src/components/fields/fields-table.tsx packages/app/src/components/fields/variants-panel.tsx packages/app/src/components/org/general-panel.tsx packages/app/src/components/org/members-table.tsx
git commit -m "feat(app): work on a customer's website as staff — banner, blocked controls, expiry"
```

Never commit `packages/app/src/routeTree.gen.ts` changes made by Marko's dev server unless this task added a route (it doesn't).

---

### Task 6: Staff activity in the app — ops page, ops website section, customer Settings

**Files:**
- Create: `packages/app/src/components/staff/staff-activity-list.tsx`
- Create: `packages/app/src/routes/_app/ops/activity.tsx`
- Modify: `packages/app/src/lib/staff-view.ts` (+ test), `components/shell/ops-sidebar.tsx`, `routes/_app/ops/websites/$sourceId.tsx`, `routes/_app/settings.tsx`, `lib/ops-view.ts` if `isOpsPath`/breadcrumbs need the new route, `packages/app/src/routeTree.gen.ts` (regenerated by the router plugin when the route is added)

**Interfaces:**
- Consumes: `ops.staffActivity`, `ops.staffActivityFilters`, `orgs.staffActivity`, `StaffEntry` (Task 4).
- Produces:
  - `formatStaffEntry(e: StaffEntry-like, now: Date): { when: string; who: string; whoDetail: string; website: string; sentence: string; cost: string | null }` in `staff-view.ts` — `who` is the name or, when null, the email; `whoDetail` the email; `cost` is `$1.24` when `run.costUsd > 0`, else null; `when` uses the app's existing relative-time helper (find the one the Runs page uses).
  - `StaffActivityList({ entries, showCustomer, total, page, pageSize, onPage, empty })` — a table: When, Staff member, [Customer], Website, What happened (sentence, then ` · $1.24` in muted mono when cost). Pager: "Previous" / "Next" buttons, and "{from}–{to} of {total}".
  - Route `/ops/activity` with search params `{ org?: string; staff?: string; page?: number }`.

- [ ] **Step 1: Failing test** — extend `staff-view.test.ts`:

```ts
import { formatStaffEntry } from './staff-view';

it('formats an entry, with cost only when spent and the email when the name is gone', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const base = { id: '1', at: new Date('2026-10-07T11:00:00Z'), org: { id: 'o', name: 'Acme' }, project: null, website: { id: 's', name: 'Nike' }, summary: 'Ran an extraction on Nike' };
  const a = formatStaffEntry({ ...base, actor: { name: 'Sam', email: 'sam@robot.dev' }, run: { id: 'r', costUsd: 1.24 } }, now);
  expect(a).toMatchObject({ who: 'Sam', whoDetail: 'sam@robot.dev', website: 'Nike', sentence: 'Ran an extraction on Nike', cost: '$1.24' });
  const b = formatStaffEntry({ ...base, actor: { name: null, email: 'gone@robot.dev' }, run: { id: 'r', costUsd: 0 } }, now);
  expect(b).toMatchObject({ who: 'gone@robot.dev', cost: null });
  const c = formatStaffEntry({ ...base, website: null, actor: { name: 'Sam', email: 's@x' }, run: null }, now);
  expect(c.website).toBe('—');
});
```

- [ ] **Step 2: Run — expect FAIL. Step 3: implement `formatStaffEntry`** (declare a local `StaffEntryView` type mirroring Task 4's `StaffEntry`; `at` may arrive as `Date` through superjson). Run — PASS.

- [ ] **Step 4: `StaffActivityList`** in `components/staff/staff-activity-list.tsx`, built from the same table primitives the Runs page uses (find the org runs table in `components/runs/` and follow its markup and classes). Empty state: render the `empty` string in a muted row. Cost: muted, `font-mono`, after the sentence: `· $1.24`.

- [ ] **Step 5: Ops "Staff activity" page** `routes/_app/ops/activity.tsx`: `beforeLoad` redirects non-operators to `/projects` (copy `ops/index.tsx`'s guard). Two `Select`s at the top — "All customers" / each customer, "All staff" / each staff member (`name ?? email`) — from `ops.staffActivityFilters`, kept in the URL search params; table with `showCustomer`, 50 per page. Empty: `No staff activity yet.` Add the sidebar item `Staff activity` under `All websites` in `ops-sidebar.tsx` (same `Link` styling, active when on `/ops/activity`). Make sure `isOpsPath('/ops/activity')` is true and the ops breadcrumb reads "Ops / Staff activity".

- [ ] **Step 6: Ops website page section** in `$sourceId.tsx`: a `Staff activity` section after the existing sections, `ops.staffActivity({ sourceId, pageSize: 10 })`, no customer column, no pager, and a `See all` link to `/ops/activity?org={data.org.id}`. Empty: `No staff activity yet.`

- [ ] **Step 7: Customer Settings** (`routes/_app/settings.tsx`): a `Robot staff activity` section between Members and Danger zone, same panel styling as the others (`rise rounded-[6px] border border-line bg-panel …`), `orgs.staffActivity({ page })` with local page state, 20 per page, columns When / Staff member (name, email beneath in muted) / Website / What happened (+ cost). Empty: `No staff activity yet.` Visible to every member (no role check).

- [ ] **Step 8: Run app tests + typecheck; commit**

```bash
git add packages/app/src/lib/staff-view.ts packages/app/src/lib/staff-view.test.ts packages/app/src/components/staff/staff-activity-list.tsx packages/app/src/routes/_app/ops/activity.tsx packages/app/src/components/shell/ops-sidebar.tsx "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx" packages/app/src/routes/_app/settings.tsx packages/app/src/routeTree.gen.ts
# plus lib/ops-view.ts(+test) if changed
git commit -m "feat(app): staff activity in ops and in the customer's Settings"
```

---

### Task 7: Configurable CORS, the staff smoke, and docs

**Files:**
- Modify: `packages/api-server/src/app.ts:36-43`, `packages/api-server/src/app.test.ts`
- Create: `packages/app/src/staff-smoke.test.ts`
- Modify: root `package.json` (script `test:ui:staff`), `.env.example`, `CLAUDE.md`, `docs/handoff.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `APP_ORIGINS` env (comma-separated, default `http://localhost:3000`); `pnpm test:ui:staff`.

- [ ] **Step 1: Failing test** in `app.test.ts` (follow the file's existing CORS test at lines ~35-38):

```ts
it('allows the origins in APP_ORIGINS', async () => {
  const saved = process.env.APP_ORIGINS;
  process.env.APP_ORIGINS = 'http://localhost:3100, http://localhost:3000';
  try {
    const app = createApp(/* the same fakes the other tests pass */);
    const res = await app.request('/trpc/ops.me', { headers: { origin: 'http://localhost:3100' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3100');
  } finally {
    process.env.APP_ORIGINS = saved;
  }
});
```

- [ ] **Step 2: Implement** in `app.ts`:

```ts
  // CORS — the app shell. `APP_ORIGINS` (comma-separated) lets an isolated pair (e.g. :3100 → :4100) run beside the dev servers.
  const origins = (process.env.APP_ORIGINS ?? 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
  app.use('*', cors({ origin: origins, credentials: true }));
```

Run the api-server suite — PASS. Add to `.env.example`: `# APP_ORIGINS=http://localhost:3000   # comma-separated origins the api-server accepts (default :3000)`.

- [ ] **Step 3: The staff smoke** `packages/app/src/staff-smoke.test.ts` — runs only when `RUN_STAFF_SMOKE=1`; reads `APP_URL` (default `http://localhost:3100`), `API_URL` (default `http://localhost:4100`), `STAFF_SMOKE_OPERATOR` (the throwaway operator address the :4100 server has in `OPS_EMAILS`). Model it on `routes-smoke.test.ts` (Playwright `chromium.launch({ headless: true })`, sign-in through `/login`, DB cleanup through `@robot/api/test-helpers/identity`). Steps:
  1. Sign in a throwaway **customer** via the API (`auth.signIn` over HTTP with a cookie jar), create a project and a website with `projects.create` and `sources.createInProject` (no Verify, no Extract).
  2. In the browser, sign in as the operator; open `/ops/websites/{sourceId}`; click **Work on this website**; assert the dialog title `Work on {website} as staff?` and body; click **Start working**.
  3. Assert the banner `Working as Robot staff in {customer}` and that the org switcher is absent.
  4. Allowed edit: rename the website on its Settings tab (whatever control the Settings tab uses for the name); assert the new name shows.
  5. Blocked: assert **Delete website** is disabled and `Not available while working as staff` is visible within a line of it.
  6. Click **Back to ops**; assert the URL is `/ops` and the banner is gone.
  7. Sign in as the customer in a fresh context; open `/settings`; assert `Robot staff activity` lists `Started working as staff`, `Renamed website … to …`, `Stopped working as staff`.
  8. Screenshot each step into `docs/testing/screens/staff-*.png` (dark theme only).
  9. Cleanup: delete both throwaway users and their orgs via the identity helpers.

It never clicks Verify, Extract, Sample or Check.

Root `package.json`: `"test:ui:staff": "cross-env RUN_STAFF_SMOKE=1 pnpm --filter @robot/app exec vitest run src/staff-smoke.test.ts"`.

- [ ] **Step 4: Run the smoke on the isolated pair** (never Marko's :4000/:3000):

```bash
# api-server on :4100, keyless, with a throwaway operator
cross-env PORT=4100 ANTHROPIC_API_KEY= OPS_EMAILS=staff-smoke-op@example.com APP_ORIGINS=http://localhost:3100 pnpm --filter @robot/api-server dev   # background
# app on :3100 pointed at it
cross-env PORT=3100 VITE_API_URL=http://localhost:4100 pnpm --filter @robot/app dev   # background
cross-env APP_URL=http://localhost:3100 API_URL=http://localhost:4100 STAFF_SMOKE_OPERATOR=staff-smoke-op@example.com pnpm test:ui:staff
```

(Use the exact port flags the two packages' `dev` scripts accept — read their `package.json`. Stop only these two background processes afterwards.) Expected: PASS, screenshots written. Look at the screenshots.

- [ ] **Step 5: Docs.**
  - `CLAUDE.md`: Commands — add `pnpm test:ui:staff` (isolated pair, throwaway operator); add a Key Technical Decisions line: "Staff access (2026-10-07): an operator's session can enter a customer org from ops (`ops.enterOrg`), 8 hours max; deny-list in `packages/api/src/auth/staff-guard.ts`; every staff-mode mutation is logged in `staff_actions` and shown in ops and the customer's Settings."
  - `docs/handoff.md`: a short "Staff access" entry — what shipped, the rulings R1–R4, and that `OPS_EMAILS` must include Marko's address in `.env` for him to use it.

- [ ] **Step 6: Commit**

```bash
git add packages/api-server/src/app.ts packages/api-server/src/app.test.ts packages/app/src/staff-smoke.test.ts package.json .env.example CLAUDE.md docs/handoff.md docs/testing/screens/staff-*.png
git commit -m "test(app): staff-mode smoke on an isolated pair; APP_ORIGINS; docs"
```

---

## Final gate (controller)

All suites, each `vitest run --maxWorkers=2 --testTimeout=30000`: `@robot/db`, `@robot/api`, `@robot/api-server`, `@robot/app`, `@robot/scraper`, `@robot/browser`; typecheck api, api-server, app. Then the whole-branch review with these questions:
- Can any path reach a customer org's data as staff without `isOperatorEmail` being true on that request?
- Does any deny-listed action have a second route (another procedure, an api-server HTTP route) that does the same thing?
- Does every staff-mode mutation produce exactly one row (none for failures, none for queries)?
