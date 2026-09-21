# App Redesign — Plan 1, the Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `@robot/app` on TanStack Start that signs a user in, knows their organisations, shows the sidebar shell in the dark monochrome console look (light as a preference), and lists the org's projects — the surface every later screen inherits.

**Architecture:** Identity lands in `@robot/db` (users, memberships, sessions, org ownership) and `@robot/api` (an `auth` router, an `orgs` router, a session-aware tRPC context with an `orgSlug` shim so the old dashboard keeps working). The new app is a separate package on `:3000`, calling the api-server over tRPC-HTTP with credentials; the root route gates on the session server-side and renders `data-theme` from the user's preference. shadcn/ui components on Tailwind v4 with our tokens; Geist Sans/Mono self-hosted.

**Tech Stack:** TanStack Start + Router + Query (React 19), Vite, Tailwind v4, shadcn/ui, tRPC v11 + superjson, Drizzle + Postgres, Hono, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-app-redesign-design.md` — §2 (architecture), §3 (IA), §4 (visual system), §5 rows `/login` and `/projects`, §6 (API), §7 plan (1), §8 (testing).

## Global Constraints

- ESM everywhere; `.js` import suffixes in `packages/api`, `packages/db`, `packages/api-server`; none in the app (matches `@robot/dashboard`).
- Run one package's tests at a time: `pnpm --filter <pkg> exec vitest run --maxWorkers=1 <name>`; `@robot/api` and `@robot/db` tests need Postgres. Never `pnpm -r test`.
- Commit with explicit paths only (`git add <paths>` then `git commit -m "…" -- <paths>`).
- Spec §4 verbatim: dark tokens background `#0a0a0a`, panel `#111111`, raised `#171717`, border `#262626` (hover `#333333`), text `#ededed`, secondary `#a1a1a1`, muted `#666666`; light `#ffffff`, `#fafafa`, `#f4f4f4`, `#e5e5e5` / `#d4d4d4`, `#171717`, `#666666`, `#a1a1a1`; pass `#3ddc84` / `#0f7b3d`, fail `#ff5c5c` / `#c62828`, warn `#f5a623` / `#a26000`, link `#52a8ff` / `#0b6bcb`. Every text-on-surface pair ≥ 4.5:1. Geist Sans / Geist Mono self-hosted. 13 px body, 12 px secondary, 20 px semibold page title, 28 px headline figure. Sentence case, no uppercase labels. 6 px radius, 1 px borders, no shadow in dark. Motion: page-load stagger 60 ms/panel at 200 ms, 150 ms hover transitions, the running dot pulses at 1.6 s; all off under `prefers-reduced-motion`.
- Copy: customer wording only — "website", "field", "page", "run", "organisation"; never "source", "binding", "dataset".
- Spec §2: session cookie `robot_session`, httpOnly, SameSite=Lax, 30 days; any password accepted; first sign-in ever adopts the seeded `default` org; later new users get a personal org named after them; `member` cannot rename/delete the org or manage members; `admin` manages members but cannot delete; a personal org cannot be deleted.
- Spec §7: the old dashboard on `:3456` keeps working throughout (the `orgSlug` shim); nothing in `@robot/dashboard` changes.
- TanStack Start API names change between minor versions: the implementer verifies every `@tanstack/react-start` call in this plan against the installed version's docs (context7 or the package's `.d.ts`) before relying on it, and reports any rename.
- The frontend-design skill's rules apply to every screen: an intentional, restrained industrial-minimal look; no generic defaults; motion only where the spec says.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/schema.ts` | `users`, `memberships`, `sessions`; `orgs.personal`, `orgs.ownerUserId`; relations |
| `packages/db/drizzle/0010_identity.sql` (+ meta) | the migration |
| `packages/api/src/trpc.ts` | `Context { db, session? }`, `requireSession`, `requireRole` |
| `packages/api/src/auth/session.ts` (new) | cookie name, token minting, `loadSession(db, token)`, `resolveOrg(ctx, orgSlug?)` (the shim) |
| `packages/api/src/routers/auth.ts` (new) | `signIn`, `signOut`, `me`, `switchOrg` |
| `packages/api/src/routers/orgs.ts` (new) | `create`, `rename`, `delete`, `members.list/setRole/remove` |
| `packages/api/src/routers/projects.ts` | `list`/`create`/`delete` resolve the org via `resolveOrg` |
| `packages/api/src/routers/index.ts` | mount `auth`, `orgs` |
| `packages/api-server/src/app.ts` | context from the request cookie; `Set-Cookie` back; CORS for `:3000` |
| `packages/app/*` (new) | TanStack Start app: tokens, theme, fonts, tRPC client, routes `/login`, `/projects`, shell components |
| `package.json`, `turbo.json` | `dev:all` starts the app too |
| `docs/testing/ui-check-app-shell.mts` | look-only check, both themes |

---

### Task 1: Identity tables

**Files:**
- Modify: `packages/db/src/schema.ts` (after the `orgs` block)
- Create: `packages/db/drizzle/0010_identity.sql` via `drizzle-kit generate`
- Test: `packages/db/src/schema.test.ts` (one case)

**Interfaces:**
- Produces:
  ```ts
  export const users: { id uuid pk, email varchar(255) unique notNull, name varchar(255) notNull, avatarColour varchar(7) notNull, theme varchar(10) notNull default 'dark', createdAt, updatedAt }
  export const memberships: { id uuid pk, userId → users cascade, orgId → orgs cascade, role varchar(10) notNull ('owner'|'admin'|'member'), createdAt; unique (userId, orgId) }
  export const sessions: { token varchar(64) pk, userId → users cascade, orgId → orgs cascade, expiresAt timestamptz notNull, createdAt }
  orgs gains: personal boolean notNull default false, ownerUserId uuid nullable → users set null
  export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const; export type MembershipRole
  export const USER_THEMES = ['dark', 'light', 'system'] as const; export type UserTheme
  ```

- [ ] **Step 1: Failing test** — append to `schema.test.ts` (read its existing style; it inserts and reads rows against the real DB):

```ts
describe('identity', () => {
  it('a user, a membership and a session round-trip; the pair (user, org) is unique', async () => {
    const [org] = await db.insert(orgs).values({ name: `Id ${Date.now()}`, slug: `id-${Date.now()}` }).returning();
    const [user] = await db.insert(users).values({ email: `id-${Date.now()}@example.com`, name: 'Id', avatarColour: '#3ddc84' }).returning();
    try {
      await db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'owner' });
      await expect(db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'member' })).rejects.toThrow();
      const [s] = await db.insert(sessions).values({ token: 'tok-' + Date.now(), userId: user!.id, orgId: org!.id, expiresAt: new Date(Date.now() + 1000) }).returning();
      expect(s!.userId).toBe(user!.id);
      await db.update(orgs).set({ personal: true, ownerUserId: user!.id }).where(eq(orgs.id, org!.id));
      expect((await db.query.orgs.findFirst({ where: eq(orgs.id, org!.id) }))!.personal).toBe(true);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    }
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/db exec vitest run --maxWorkers=1 schema` → `users` is not exported.

- [ ] **Step 3: Schema**

After the `orgs` block:

```ts
// ─── Identity (spec 2026-09-21 §2) ──────────────────────────────────────────
// A user belongs to orgs through memberships; a session names the user and
// the org they are currently working in. Sign-in is a stub for now (any
// password), so there is no password column: the tables are shaped for real
// auth later, not for this one.

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const USER_THEMES = ['dark', 'light', 'system'] as const;
export type UserTheme = (typeof USER_THEMES)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  avatarColour: varchar('avatar_colour', { length: 7 }).notNull(),
  theme: varchar('theme', { length: 10 }).notNull().default('dark'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 10 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('memberships_user_org_idx').on(table.userId, table.orgId),
  index('memberships_org_id_idx').on(table.orgId),
]);

export const sessions = pgTable('sessions', {
  token: varchar('token', { length: 64 }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('sessions_user_id_idx').on(table.userId)]);

export const usersRelations = relations(users, ({ many }) => ({ memberships: many(memberships), sessions: many(sessions) }));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  org: one(orgs, { fields: [memberships.orgId], references: [orgs.id] }),
}));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  org: one(orgs, { fields: [sessions.orgId], references: [orgs.id] }),
}));
```

In `orgs`, add `personal: boolean('personal').notNull().default(false),` and `ownerUserId: uuid('owner_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),` (the `AnyPgColumn` annotation breaks the circular type, as `schema.ts` already does elsewhere). Add `memberships: many(memberships)` to `orgsRelations`.

- [ ] **Step 4: Migration** — `pnpm --filter @robot/db exec drizzle-kit generate --name identity` (writes `drizzle/0010_identity.sql` and `meta/`), then `pnpm db:migrate`. Read the SQL: it must create the three tables, the two `orgs` columns, and no other diff (if drizzle-kit wants to touch unrelated tables, stop and report — it means schema.ts and the DB were already out of step).

- [ ] **Step 5: Run, expect pass; typecheck; commit**

```bash
pnpm --filter @robot/db exec vitest run --maxWorkers=1 schema && pnpm --filter @robot/db typecheck
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/0010_identity.sql packages/db/drizzle/meta
git commit -m "feat(db): users, memberships, sessions; an org has an owner and may be personal" -- packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/0010_identity.sql packages/db/drizzle/meta
```

---

### Task 2: Session context, `auth` router, the org shim

**Files:**
- Create: `packages/api/src/auth/session.ts`, `packages/api/src/routers/auth.ts`
- Modify: `packages/api/src/trpc.ts`, `packages/api/src/routers/index.ts`
- Test: `packages/api/src/routers/auth.test.ts` (new), `packages/api/src/auth/session.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  // trpc.ts
  export type SessionInfo = { token: string; user: { id: string; email: string; name: string; avatarColour: string; theme: UserTheme }; org: { id: string; slug: string; name: string; personal: boolean }; role: MembershipRole };
  export type Context = { db: Database; session: SessionInfo | null; setCookie?: (name: string, value: string, opts: { maxAge: number }) => void; clearCookie?: (name: string) => void };
  export const protectedProcedure // throws UNAUTHORIZED without ctx.session; ctx.session is non-null inside
  export function requireRole(ctx, roles: MembershipRole[]) // FORBIDDEN otherwise
  // auth/session.ts
  export const SESSION_COOKIE = 'robot_session'; export const SESSION_MAX_AGE_S = 30 * 24 * 3600;
  export function mintToken(): string                       // 32 random bytes, hex
  export async function loadSession(db, token): Promise<SessionInfo | null>  // null when missing/expired; joins user, org, membership role
  export async function resolveOrg(ctx, orgSlug?: string): Promise<{ id: string; slug: string }>   // ctx.session.org when a session exists, else the org by slug, else NOT_FOUND
  export function avatarColourFor(email: string): string    // one of eight fixed hexes, by hash
  // routers/auth.ts
  auth.signIn({ email, password }) → { user, org }        // sets the cookie via ctx.setCookie
  auth.signOut() → { ok: true }                            // deletes the session row, clears the cookie
  auth.me() → { user, orgs: [{ id, slug, name, personal, role }], currentOrg: { id, slug, name, personal, role } }   // UNAUTHORIZED without a session
  auth.switchOrg({ orgId }) → { currentOrg }               // membership required, updates the session row
  auth.setTheme({ theme }) → { theme }
  ```
- Sign-in rules (spec §2): email lower-cased and trimmed; existing user → new session on their most recent org (the org of their last session, else their personal org); new user → if `users` is empty, adopt the seeded `default` org: set `personal = true`, `ownerUserId`, rename it to `<name>` (name = the part before `@`, capitalised) and slug to `slugify(name)`, add an `owner` membership; otherwise create a personal org `<name>` with slug `uniqueSlug(slugify(name))` (`../slug.js`) and an `owner` membership.

- [ ] **Step 1: Failing tests**

`packages/api/src/auth/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users, orgs, memberships, sessions } from '@robot/db';
import { loadSession, mintToken, avatarColourFor, resolveOrg } from './session.js';

describe('session', () => {
  it('mints 64 hex chars and picks a stable avatar colour', () => {
    expect(mintToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(avatarColourFor('a@b.c')).toBe(avatarColourFor('a@b.c'));
    expect(avatarColourFor('a@b.c')).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('loads a live session with its user, org and role; null when expired or unknown', async () => {
    const tag = Date.now();
    const [org] = await db.insert(orgs).values({ name: `S ${tag}`, slug: `s-${tag}` }).returning();
    const [user] = await db.insert(users).values({ email: `s-${tag}@example.com`, name: 'S', avatarColour: '#000000' }).returning();
    await db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'admin' });
    const token = mintToken();
    await db.insert(sessions).values({ token, userId: user!.id, orgId: org!.id, expiresAt: new Date(Date.now() + 60_000) });
    const dead = mintToken();
    await db.insert(sessions).values({ token: dead, userId: user!.id, orgId: org!.id, expiresAt: new Date(Date.now() - 1) });
    try {
      const s = await loadSession(db, token);
      expect(s).toMatchObject({ token, user: { id: user!.id, email: `s-${tag}@example.com` }, org: { id: org!.id, slug: `s-${tag}` }, role: 'admin' });
      expect(await loadSession(db, dead)).toBeNull();
      expect(await loadSession(db, 'nope')).toBeNull();
      expect(await resolveOrg({ db, session: s }, 'default')).toMatchObject({ id: org!.id }); // the session wins over orgSlug
      expect(await resolveOrg({ db, session: null }, `s-${tag}`)).toMatchObject({ id: org!.id });
      await expect(resolveOrg({ db, session: null }, 'no-such-org')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    }
  });
});
```

`packages/api/src/routers/auth.test.ts` (uses `createCallerFactory(appRouter)` with a context that records cookies):

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users, orgs, memberships } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';

function callerWith(session: Awaited<ReturnType<typeof loadSession>> = null) {
  const cookies: Record<string, string | null> = {};
  const caller = createCallerFactory(appRouter)({ db, session, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: (n) => { cookies[n] = null; } });
  return { caller, cookies };
}

describe('auth', () => {
  it('a new user signs in with any password, gets a personal org and a session cookie', async () => {
    const email = `new-${Date.now()}@example.com`;
    const { caller, cookies } = callerWith();
    const r = await caller.auth.signIn({ email: ` ${email.toUpperCase()} `, password: 'whatever' });
    try {
      expect(r.user.email).toBe(email);
      expect(r.org.personal).toBe(true);
      const token = cookies['robot_session']!;
      const s = await loadSession(db, token);
      expect(s).toMatchObject({ user: { email }, org: { id: r.org.id }, role: 'owner' });
      const me = await callerWith(s).caller.auth.me();
      expect(me.orgs.map((o) => o.id)).toContain(r.org.id);
      expect(me.currentOrg.id).toBe(r.org.id);
      await callerWith(s).caller.auth.setTheme({ theme: 'light' });
      expect((await callerWith(await loadSession(db, token)).caller.auth.me()).user.theme).toBe('light');
      await callerWith(s).caller.auth.signOut();
      expect(await loadSession(db, token)).toBeNull();
    } finally {
      await db.delete(orgs).where(eq(orgs.id, r.org.id));
      await db.delete(users).where(eq(users.id, r.user.id));
    }
  });
  it('me and switchOrg refuse without a session; switchOrg refuses a non-member', async () => {
    const { caller } = callerWith();
    await expect(caller.auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const a = await callerWith().caller.auth.signIn({ email: `a-${Date.now()}@example.com`, password: 'x' });
    const b = await callerWith().caller.auth.signIn({ email: `b-${Date.now()}@example.com`, password: 'x' });
    try {
      const again = callerWith();
      await again.caller.auth.signIn({ email: a.user.email, password: 'x' });   // an existing user: a new session, no new org
      const sa = await loadSession(db, again.cookies['robot_session']!);
      expect(sa!.org.id).toBe(a.org.id);
      await expect(callerWith(sa).caller.auth.switchOrg({ orgId: b.org.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await db.insert(memberships).values({ userId: a.user.id, orgId: b.org.id, role: 'member' });
      expect((await callerWith(sa).caller.auth.switchOrg({ orgId: b.org.id })).currentOrg.id).toBe(b.org.id);
    } finally {
      for (const r of [a, b]) { await db.delete(orgs).where(eq(orgs.id, r.org.id)); await db.delete(users).where(eq(users.id, r.user.id)); }
    }
  });
});
```

The "first sign-in adopts `default`" rule cannot be tested against the shared dev database (users already exist after the first test), so it is tested as a pure function: export `adoptOrCreateOrg({ userCount, defaultOrg })` decisions from `auth.ts` — `it('adopts default only when no user exists', () => { expect(planFirstOrg({ userCount: 0, hasDefault: true })).toBe('adopt'); expect(planFirstOrg({ userCount: 1, hasDefault: true })).toBe('create'); expect(planFirstOrg({ userCount: 0, hasDefault: false })).toBe('create'); })`. The live adoption is proven in Task 7's browser check on your own database.

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/api exec vitest run --maxWorkers=1 session auth`.

- [ ] **Step 3: Implement**

`trpc.ts`:

```ts
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Database, MembershipRole, UserTheme } from '@robot/db';

export type SessionInfo = {
  token: string;
  user: { id: string; email: string; name: string; avatarColour: string; theme: UserTheme };
  org: { id: string; slug: string; name: string; personal: boolean };
  role: MembershipRole;
};

/** `setCookie`/`clearCookie` are provided by the HTTP host (api-server); a test caller may omit them. */
export type Context = {
  db: Database;
  session: SessionInfo | null;
  setCookie?: (name: string, value: string, opts: { maxAge: number }) => void;
  clearCookie?: (name: string) => void;
};

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/** A procedure that needs a signed-in user; `ctx.session` is non-null inside. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export function requireRole(session: SessionInfo, roles: MembershipRole[]): void {
  if (!roles.includes(session.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role in this organisation does not allow that' });
}
```

`auth/session.ts`:

```ts
// packages/api/src/auth/session.ts
// The session cookie and what it resolves to (spec 2026-09-21 §2). `resolveOrg`
// is the shim that keeps the old dashboard working: with a session the org is
// the session's; without one it is the `orgSlug` the old app still sends.
import { randomBytes, createHash } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { memberships, orgs, sessions, users, type Database } from '@robot/db';
import type { Context, SessionInfo } from '../trpc.js';

export const SESSION_COOKIE = 'robot_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

const AVATAR_COLOURS = ['#3ddc84', '#52a8ff', '#f5a623', '#ff5c5c', '#c084fc', '#2dd4bf', '#fb7185', '#a3e635'];

export function mintToken(): string {
  return randomBytes(32).toString('hex');
}

export function avatarColourFor(email: string): string {
  const h = createHash('sha256').update(email.toLowerCase()).digest();
  return AVATAR_COLOURS[h[0]! % AVATAR_COLOURS.length]!;
}

export async function loadSession(db: Database, token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const row = await db.select({
    token: sessions.token,
    userId: users.id, email: users.email, name: users.name, avatarColour: users.avatarColour, theme: users.theme,
    orgId: orgs.id, slug: orgs.slug, orgName: orgs.name, personal: orgs.personal,
    role: memberships.role,
  }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(orgs, eq(sessions.orgId, orgs.id))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, orgs.id)))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const r = row[0];
  if (!r) return null;
  return {
    token: r.token,
    user: { id: r.userId, email: r.email, name: r.name, avatarColour: r.avatarColour, theme: r.theme as SessionInfo['user']['theme'] },
    org: { id: r.orgId, slug: r.slug, name: r.orgName, personal: r.personal },
    role: r.role as SessionInfo['role'],
  };
}

export async function resolveOrg(ctx: Pick<Context, 'db' | 'session'>, orgSlug?: string): Promise<{ id: string; slug: string }> {
  if (ctx.session) return { id: ctx.session.org.id, slug: ctx.session.org.slug };
  if (!orgSlug) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  const org = await ctx.db.query.orgs.findFirst({ where: eq(orgs.slug, orgSlug), columns: { id: true, slug: true } });
  if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: `Organisation ${orgSlug} not found` });
  return org;
}
```

`routers/auth.ts`:

```ts
import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db as _db, memberships, orgs, sessions, users, USER_THEMES } from '@robot/db';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { slugify, uniqueSlug } from '../slug.js';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, avatarColourFor, loadSession, mintToken } from '../auth/session.js';

/** The first account ever adopts the seeded `default` org so existing projects stay visible; everyone after gets their own. */
export function planFirstOrg(a: { userCount: number; hasDefault: boolean }): 'adopt' | 'create' {
  return a.userCount === 0 && a.hasDefault ? 'adopt' : 'create';
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const orgOut = (o: { id: string; slug: string; name: string; personal: boolean }, role: string) => ({ id: o.id, slug: o.slug, name: o.name, personal: o.personal, role });

export const authRouter = router({
  signIn: publicProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Any password signs in for now (spec §9): the shape is here, the check is not.
      const { user, org } = await ctx.db.transaction(async (tx) => {
        let user = await tx.query.users.findFirst({ where: eq(users.email, input.email) });
        if (user) {
          const last = await tx.query.sessions.findFirst({ where: eq(sessions.userId, user.id), orderBy: [desc(sessions.createdAt)] });
          const orgId = last?.orgId ?? (await tx.query.memberships.findFirst({ where: eq(memberships.userId, user.id), orderBy: [desc(memberships.createdAt)] }))?.orgId;
          if (!orgId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'This account has no organisation' });
          const org = (await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) }))!;
          return { user, org };
        }
        const name = nameFromEmail(input.email);
        const [created] = await tx.insert(users).values({ email: input.email, name, avatarColour: avatarColourFor(input.email) }).returning();
        user = created!;
        const [{ n }] = await tx.select({ n: count() }).from(users);
        const seeded = await tx.query.orgs.findFirst({ where: eq(orgs.slug, 'default') });
        let org;
        if (planFirstOrg({ userCount: Number(n), hasDefault: !!seeded }) === 'adopt') {
          const slug = await uniqueSlug(slugify(name), async (s) => !!(await tx.query.orgs.findFirst({ where: eq(orgs.slug, s) })));
          [org] = await tx.update(orgs).set({ name, slug, personal: true, ownerUserId: user.id, updatedAt: new Date() }).where(eq(orgs.id, seeded!.id)).returning();
        } else {
          const slug = await uniqueSlug(slugify(name), async (s) => !!(await tx.query.orgs.findFirst({ where: eq(orgs.slug, s) })));
          [org] = await tx.insert(orgs).values({ name, slug, personal: true, ownerUserId: user.id }).returning();
        }
        await tx.insert(memberships).values({ userId: user.id, orgId: org!.id, role: 'owner' });
        return { user, org: org! };
      });
      const token = mintToken();
      await ctx.db.insert(sessions).values({ token, userId: user.id, orgId: org.id, expiresAt: new Date(Date.now() + SESSION_MAX_AGE_S * 1000) });
      ctx.setCookie?.(SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE_S });
      const role = (await ctx.db.query.memberships.findFirst({ where: and(eq(memberships.userId, user.id), eq(memberships.orgId, org.id)) }))!.role;
      return { user: { id: user.id, email: user.email, name: user.name, avatarColour: user.avatarColour, theme: user.theme }, org: orgOut(org, role) };
    }),

  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(sessions).where(eq(sessions.token, ctx.session.token));
    ctx.clearCookie?.(SESSION_COOKIE);
    return { ok: true as const };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select({ id: orgs.id, slug: orgs.slug, name: orgs.name, personal: orgs.personal, role: memberships.role })
      .from(memberships).innerJoin(orgs, eq(memberships.orgId, orgs.id)).where(eq(memberships.userId, ctx.session.user.id)).orderBy(orgs.name);
    return { user: ctx.session.user, orgs: rows, currentOrg: { ...ctx.session.org, role: ctx.session.role } };
  }),

  switchOrg: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const m = await ctx.db.query.memberships.findFirst({ where: and(eq(memberships.userId, ctx.session.user.id), eq(memberships.orgId, input.orgId)) });
      if (!m) throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of that organisation' });
      await ctx.db.update(sessions).set({ orgId: input.orgId }).where(eq(sessions.token, ctx.session.token));
      const org = (await ctx.db.query.orgs.findFirst({ where: eq(orgs.id, input.orgId) }))!;
      return { currentOrg: orgOut(org, m.role) };
    }),

  setTheme: protectedProcedure
    .input(z.object({ theme: z.enum(USER_THEMES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users).set({ theme: input.theme, updatedAt: new Date() }).where(eq(users.id, ctx.session.user.id));
      return { theme: input.theme };
    }),
});
```

(Remove the unused `db as _db` and `loadSession` imports if the linter/typecheck complains; they are listed only to make the dependency explicit.) Mount `auth: authRouter` in `routers/index.ts`. Every existing test file that builds a caller with `({ db })` must now pass `({ db, session: null })` — update them with a search-and-replace (`createCaller({ db })` → `createCaller({ db, session: null })`; `caller = createCallerFactory(appRouter)({ db })` likewise) and run the api suite once.

- [ ] **Step 4: Run** — `pnpm --filter @robot/api exec vitest run --maxWorkers=1 session auth`, then the whole api suite (`pnpm --filter @robot/api exec vitest run --maxWorkers=1`) to prove the context change broke nothing; `pnpm --filter @robot/api typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): sessions, the auth router, and an org shim for the old dashboard" -- packages/api/src
```

(`packages/api/src` as a whole is the explicit path here because the context change touches every test file's caller construction.)

---

### Task 3: `orgs` router; projects resolve their org

**Files:**
- Create: `packages/api/src/routers/orgs.ts`
- Modify: `packages/api/src/routers/projects.ts` (`list`, `create`, `delete`), `packages/api/src/routers/index.ts`
- Test: `packages/api/src/routers/orgs.test.ts` (new), `packages/api/src/routers/projects.test.ts` (one case: another org's project is invisible)

**Interfaces:**
- Produces:
  ```ts
  orgs.create({ name }) → { id, slug, name, personal: false, role: 'owner' }   // creator becomes owner; session switched to it
  orgs.rename({ name })                                                          // owner|admin, current org
  orgs.delete()                                                                  // owner only; refuses a personal org (PRECONDITION_FAILED); cascades projects
  orgs.members.list() → [{ userId, email, name, avatarColour, role }]
  orgs.members.setRole({ userId, role })                                         // owner|admin; cannot change the owner's role; only the owner may grant owner
  orgs.members.remove({ userId })                                                // owner|admin; cannot remove the owner or yourself
  projects.list({ orgSlug? })  // shim: session org, else orgSlug
  projects.create({ name, orgSlug? }), projects.delete({ projectId })           // delete refuses a project outside the resolved org with NOT_FOUND
  ```

- [ ] **Step 1: Failing tests** — `orgs.test.ts`: sign two users in (as in `auth.test.ts`'s helper), then: A creates a team org → A is owner, `me().currentOrg` is the team; A adds B as member by inserting a membership; B (session on the team) is FORBIDDEN on `rename`, `delete`, `members.setRole`; A `setRole(B, admin)` → B can `rename` but `delete` is FORBIDDEN; A `delete()` on the team succeeds and its projects are gone; A `delete()` on the personal org → PRECONDITION_FAILED. `projects.test.ts`: with two sessions on two orgs, a project created under A is absent from B's `projects.list()` and B's `projects.delete({ projectId })` is NOT_FOUND; the old caller (`session: null`) with `orgSlug: 'default'` still lists as before.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — `orgs.ts`:

```ts
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { memberships, orgs, sessions, users, MEMBERSHIP_ROLES } from '@robot/db';
import { router, protectedProcedure, requireRole } from '../trpc.js';
import { slugify, uniqueSlug } from '../slug.js';

/** Organisations and who is in them (spec 2026-09-21 §2). Every procedure acts on the session's current org. */
export const orgsRouter = router({
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const slug = await uniqueSlug(slugify(input.name), async (s) => !!(await ctx.db.query.orgs.findFirst({ where: eq(orgs.slug, s) })));
      const org = await ctx.db.transaction(async (tx) => {
        const [org] = await tx.insert(orgs).values({ name: input.name, slug, personal: false, ownerUserId: ctx.session.user.id }).returning();
        await tx.insert(memberships).values({ userId: ctx.session.user.id, orgId: org!.id, role: 'owner' });
        await tx.update(sessions).set({ orgId: org!.id }).where(eq(sessions.token, ctx.session.token));
        return org!;
      });
      return { id: org.id, slug: org.slug, name: org.name, personal: false, role: 'owner' as const };
    }),

  rename: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.session, ['owner', 'admin']);
      await ctx.db.update(orgs).set({ name: input.name, updatedAt: new Date() }).where(eq(orgs.id, ctx.session.org.id));
      return { name: input.name };
    }),

  delete: protectedProcedure.mutation(async ({ ctx }) => {
    requireRole(ctx.session, ['owner']);
    if (ctx.session.org.personal) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'A personal organisation cannot be deleted' });
    // Projects, datasets, websites and runs cascade from the org row (schema.ts); the session row cascades too,
    // so the caller is signed out of this org and the app sends them to another one they belong to.
    await ctx.db.delete(orgs).where(eq(orgs.id, ctx.session.org.id));
    return { ok: true as const };
  }),

  members: router({
    list: protectedProcedure.query(async ({ ctx }) =>
      ctx.db.select({ userId: users.id, email: users.email, name: users.name, avatarColour: users.avatarColour, role: memberships.role })
        .from(memberships).innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.orgId, ctx.session.org.id)).orderBy(users.name)),

    setRole: protectedProcedure
      .input(z.object({ userId: z.string().uuid(), role: z.enum(MEMBERSHIP_ROLES) }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.session, ['owner', 'admin']);
        const target = await ctx.db.query.memberships.findFirst({ where: and(eq(memberships.userId, input.userId), eq(memberships.orgId, ctx.session.org.id)) });
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not a member of this organisation' });
        if (target.role === 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: "The owner's role cannot be changed" });
        if (input.role === 'owner') requireRole(ctx.session, ['owner']);
        await ctx.db.update(memberships).set({ role: input.role }).where(eq(memberships.id, target.id));
        return { userId: input.userId, role: input.role };
      }),

    remove: protectedProcedure
      .input(z.object({ userId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx.session, ['owner', 'admin']);
        if (input.userId === ctx.session.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot remove yourself' });
        const target = await ctx.db.query.memberships.findFirst({ where: and(eq(memberships.userId, input.userId), eq(memberships.orgId, ctx.session.org.id)) });
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not a member of this organisation' });
        if (target.role === 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: 'The owner cannot be removed' });
        await ctx.db.delete(memberships).where(eq(memberships.id, target.id));
        await ctx.db.delete(sessions).where(and(eq(sessions.userId, input.userId), eq(sessions.orgId, ctx.session.org.id)));
        return { ok: true as const };
      }),
  }),
});
```

In `projects.ts`: `list` gains `.input(z.object({ orgSlug: z.string().optional() }).optional())` and filters `where(eq(projects.orgId, org.id))` with `const org = await resolveOrg(ctx, input?.orgSlug)`; `create` replaces the hard-coded `orgs.slug === 'default'` lookup with `resolveOrg(ctx, input.orgSlug)` (input gains optional `orgSlug`); `delete` loads the project and throws NOT_FOUND unless `project.orgId === org.id`. Mount `orgs: orgsRouter`. The old dashboard calls `projects.list()` with no input and `projects.create({ name })` — with `session: null` and no `orgSlug` those would now throw UNAUTHORIZED; so the shim's fallback when BOTH are absent is the `default` org (`resolveOrg(ctx, orgSlug ?? 'default')` in these two procedures only, with a comment naming the cut-over that removes it).

- [ ] **Step 4: Run the api suite, typecheck, commit**

```bash
git add packages/api/src/routers/orgs.ts packages/api/src/routers/orgs.test.ts packages/api/src/routers/projects.ts packages/api/src/routers/projects.test.ts packages/api/src/routers/index.ts
git commit -m "feat(api): organisations with roles; projects live in the session's organisation" -- packages/api/src/routers/orgs.ts packages/api/src/routers/orgs.test.ts packages/api/src/routers/projects.ts packages/api/src/routers/projects.test.ts packages/api/src/routers/index.ts
```

---

### Task 4: The api-server reads and writes the cookie; CORS for the app

**Files:**
- Modify: `packages/api-server/src/app.ts`
- Test: `packages/api-server/src/app.test.ts` (two cases)

**Interfaces:**
- `createContext` becomes `({ req, resHeaders })`: parses `Cookie` for `robot_session` (`hono/cookie`'s `getCookie` needs a Hono context; parse the header directly with a tiny helper), `loadSession(db, token)`, and provides `setCookie`/`clearCookie` that append `Set-Cookie` headers to `resHeaders` with `HttpOnly; SameSite=Lax; Path=/; Max-Age=…` (and `Secure` when `process.env.NODE_ENV === 'production'`).
- CORS origins: `['http://localhost:3456', 'http://localhost:3000']`, `credentials: true`.

- [ ] **Step 1: Failing tests** — in `app.test.ts` (read how it builds the app without Postgres — export routes are injectable; for these two cases the DB is needed, so mark them with the same guard the file uses for DB-backed cases, or skip when `DATABASE_URL` is unset): (a) `POST /trpc/auth.signIn` with a JSON body returns a `Set-Cookie` header containing `robot_session=` and `HttpOnly`; (b) `GET /trpc/auth.me` with that cookie returns the user; without it, 401.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — `@hono/trpc-server`'s `createContext` receives `(opts, c)`; use `c.req.header('cookie')` and `c.header('Set-Cookie', …, { append: true })`. Cookie parse: `const token = /(?:^|;\s*)robot_session=([^;]+)/.exec(cookieHeader ?? '')?.[1] ?? ''`. Context: `{ db, session: await loadSession(db, token), setCookie: (name, value, { maxAge }) => c.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`, { append: true }), clearCookie: (name) => c.header('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, { append: true }) }`.

- [ ] **Step 4: Run, typecheck, commit**

```bash
git add packages/api-server/src/app.ts packages/api-server/src/app.test.ts
git commit -m "feat(api-server): the session cookie in and out; CORS for the new app" -- packages/api-server/src/app.ts packages/api-server/src/app.test.ts
```

---

### Task 5: `@robot/app` — package, tokens, theme, fonts, tRPC client, login

**Files:**
- Create: `packages/app/package.json`, `packages/app/vite.config.ts`, `packages/app/tsconfig.json`, `packages/app/app.config.ts` (if the installed TanStack Start version uses one), `packages/app/src/router.tsx`, `packages/app/src/routes/__root.tsx`, `packages/app/src/routes/login.tsx`, `packages/app/src/routes/index.tsx`, `packages/app/src/styles/tokens.css`, `packages/app/src/styles/app.css`, `packages/app/src/lib/trpc.ts`, `packages/app/src/lib/session.server.ts`, `packages/app/src/lib/theme.ts`, `packages/app/src/lib/tokens.ts`, `packages/app/public/fonts/Geist*.woff2`, `packages/app/components.json` (shadcn)
- Modify: `package.json` (root: `dev:all` unchanged — turbo picks up the new package's `dev`; add `"test:ui:app"`), `pnpm-workspace.yaml` (already `packages/*`)
- Test: `packages/app/src/lib/tokens.test.ts`, `packages/app/src/lib/theme.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/tokens.ts — the palette as data + WCAG contrast, both themes (mirrors packages/dashboard/src/lib/tokens.ts's contrastRatio)
  export const THEMES: Record<'dark'|'light', { bg, panel, raised, border, borderHover, text, secondary, muted, pass, fail, warn, link }>;
  export function contrastRatio(a: string, b: string): number;
  // lib/theme.ts — pure
  export type Theme = 'dark' | 'light' | 'system';
  export function resolveTheme(pref: Theme, systemPrefersDark: boolean): 'dark' | 'light';
  export const THEME_BOOT_SCRIPT: string;   // inline <script> for pref 'system': sets data-theme before first paint
  // lib/trpc.ts — `trpc` (createTRPCReact<AppRouter>) with httpBatchLink({ url: `${API_URL}/trpc`, transformer: superjson, fetch: (u, o) => fetch(u, { ...o, credentials: 'include' }) }); API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
  // lib/session.server.ts — createServerFn: getSession() forwards the request's Cookie header to `${API_URL}/trpc/auth.me` and returns the `me` payload or null
  ```
- Routes: `__root.tsx` renders `<html data-theme=…>` from `getSession()` (dark when signed out), loads fonts and `app.css`, provides `QueryClient` + `trpc.Provider`; `index.tsx` redirects to `/projects` (signed in) or `/login`; `login.tsx` is the sign-in form: email, password, one primary button "Sign in", inline error, `auth.signIn` then `navigate('/projects')`. A signed-in visit to `/login` redirects to `/projects`.

- [ ] **Step 1: Scaffold** — `pnpm create @tanstack/start@latest` is interactive; instead add `packages/app` by hand: `package.json` with scripts `dev: "vite dev --port 3000"`, `build`, `test: "vitest --passWithNoTests"`, `typecheck: "tsc --noEmit"`; dependencies `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/react-query`, `@trpc/client`, `@trpc/react-query`, `@trpc/server`, `superjson`, `react`, `react-dom`, `lucide-react`, `@robot/api` (types only), `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/*` as shadcn pulls them; dev `vite`, `@tailwindcss/vite`, `tailwindcss`, `typescript`, `vitest`, `playwright`, `@types/react`, `@types/react-dom`. `vite.config.ts` with `tanstackStart()` and `@tailwindcss/vite`; check the installed `@tanstack/react-start` docs (context7 `tanstack/router`) for the exact plugin import and whether `app.config.ts` is still used. `pnpm install`. Initialise shadcn: `pnpm dlx shadcn@latest init` (style: default, base colour: neutral, CSS variables: yes, Tailwind v4) and add `button input label dropdown-menu dialog table tabs badge tooltip skeleton sonner command sheet separator`. Download Geist Sans and Geist Mono `.woff2` (variable) from the `geist` npm package (`pnpm add geist` and copy from `node_modules/geist/dist/fonts/…`) into `public/fonts/`.

- [ ] **Step 2: Failing tests** — `tokens.test.ts`: for each theme, `contrastRatio(text, bg) ≥ 4.5`, `contrastRatio(secondary, panel) ≥ 4.5`, `contrastRatio(link, bg) ≥ 4.5`, and each state colour against `bg` ≥ 3 (they are used as dots and rails, not text); `theme.test.ts`: `resolveTheme('system', true) === 'dark'`, `resolveTheme('system', false) === 'light'`, `resolveTheme('light', true) === 'light'`; `THEME_BOOT_SCRIPT` contains `prefers-color-scheme` and `data-theme`.

- [ ] **Step 3: Tokens and styles** — `tokens.css`:

```css
:root[data-theme="dark"] {
  --bg: #0a0a0a; --panel: #111111; --raised: #171717; --border: #262626; --border-hover: #333333;
  --text: #ededed; --secondary: #a1a1a1; --muted: #666666;
  --pass: #3ddc84; --fail: #ff5c5c; --warn: #f5a623; --link: #52a8ff;
  --shadow: none;
}
:root[data-theme="light"] {
  --bg: #ffffff; --panel: #fafafa; --raised: #f4f4f4; --border: #e5e5e5; --border-hover: #d4d4d4;
  --text: #171717; --secondary: #666666; --muted: #a1a1a1;
  --pass: #0f7b3d; --fail: #c62828; --warn: #b26a00; --link: #0b6bcb;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}
```

`app.css`: `@import "tailwindcss"; @import "./tokens.css";` then `@theme inline { --color-bg: var(--bg); … --font-sans: "Geist", ui-sans-serif, system-ui; --font-mono: "Geist Mono", ui-monospace, monospace; --radius: 6px; }`, the two `@font-face` rules (weights 100–900 variable), base: `html { background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 13px; -webkit-font-smoothing: antialiased; }`, the `@keyframes rise { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }` and `.rise { animation: rise 200ms ease-out both; }` with `.rise:nth-child(n)` delays of `calc(60ms * (n - 1))` for n = 1…8, `@keyframes pulse-dot` (opacity 1 → 0.35 → 1 over 1.6 s), and `@media (prefers-reduced-motion: reduce) { .rise, .dot-running { animation: none } * { transition: none !important } }`. shadcn's generated CSS variables map onto ours (`--background: var(--bg)`, `--foreground: var(--text)`, `--card: var(--panel)`, `--border: var(--border)`, `--primary: var(--text)`, `--primary-foreground: var(--bg)`, `--muted-foreground: var(--secondary)`, `--ring: var(--border-hover)`, `--radius: 6px`) — the primary button is white-on-black in dark and black-on-white in light, per the monochrome rule.

- [ ] **Step 4: Root, index and login routes** as the interface describes. `__root.tsx`'s `loader`/`beforeLoad` calls `getSession()` (server function) and puts `{ session }` in route context; `<html lang="en" data-theme={resolved}>` where `resolved = session ? (session.user.theme === 'system' ? 'dark' : session.user.theme) : 'dark'` and, for `system`, `THEME_BOOT_SCRIPT` is inlined in `<head>` to flip it before paint. Login page: centred 360 px panel on the bare background, the product name "robot platform" in Geist Mono 12 px muted above the form, no illustration; error text in `--fail`. Use shadcn `Input`, `Label`, `Button`.

- [ ] **Step 5: Run** — `pnpm --filter @robot/app exec vitest run`, `pnpm --filter @robot/app typecheck`, then `pnpm --filter @robot/app dev` with the api-server up: open `http://localhost:3000/login`, sign in with any email, land on `/projects` (a placeholder page for now: the page title "Projects" and nothing else — Task 6 fills it), reload keeps you signed in, `/login` redirects to `/projects`. Confirm the cookie is sent cross-port (Network tab: `credentials: include`, `Set-Cookie` on sign-in).

- [ ] **Step 6: Commit** (explicit paths: the whole `packages/app` tree except `node_modules`, plus root `package.json`/lockfile)

```bash
git add packages/app pnpm-lock.yaml package.json
git commit -m "feat(app): TanStack Start package with tokens, themes, Geist, the tRPC client and sign-in" -- packages/app pnpm-lock.yaml package.json
```

---

### Task 6: The shell — sidebar, org switcher, user menu, ⌘K, projects list, RunDot

**Files:**
- Create: `packages/app/src/components/shell/sidebar.tsx`, `org-switcher.tsx`, `user-menu.tsx`, `command-menu.tsx`, `packages/app/src/components/run-dot.tsx`, `packages/app/src/components/page.tsx` (title + actions header), `packages/app/src/routes/_app.tsx` (layout route: session required, sidebar + content), `packages/app/src/routes/_app/projects.tsx`, `packages/app/src/routes/_app/runs.tsx`, `_app/usage.tsx`, `_app/settings.tsx`, `_app/account.tsx` (the last four are placeholders: page title + "Coming in a later plan" in muted text — they exist so the nav is real), `packages/app/src/lib/run-dot-view.ts`, `packages/app/src/lib/projects-view.ts`
- Test: `packages/app/src/lib/run-dot-view.test.ts`, `packages/app/src/lib/projects-view.test.ts`

**Interfaces:**
- `RunDot({ status })` — `status: 'idle' | 'running' | 'done' | 'failed' | 'partial'`; `runDotState(run: { status: string; completedAt?: Date | null } | null): RunDotStatus` maps engine statuses (`completed → done`, `failed → failed`, `partial → partial`, `running|planned|planning|executing → running`, null → idle). 8 px circle, colour by state (`muted`, `text` + `.dot-running` pulse, `pass`, `fail`, `warn`), `aria-label` = the state word, tooltip.
- `projectsView(rows)` — sorts by name, formats `websites n · fields m`, last run relative time ("3 h ago") and dot state.
- Sidebar (240 px, `--panel`, right hairline): top the `OrgSwitcher` (avatar square in the user's colour with the org initial, name, `personal` shows a "Personal" badge; dropdown: the user's orgs with role, "Create organisation" opening a dialog → `orgs.create` then `switchOrg`); nav items with lucide icons (`FolderKanban` Projects, `Activity` Runs, `Gauge` Usage, `Settings` Settings), active item `--raised` background + `--text`, others `--secondary`; bottom: ⌘K button ("Search… ⌘K") opening `CommandMenu` (shadcn `command`; lists projects from `projects.list`, Enter navigates) and `UserMenu` (avatar, name, email muted; menu: Theme submenu dark/light/system calling `auth.setTheme` and flipping `data-theme` immediately, "Account", "Sign out" → `auth.signOut` then `/login`).
- Header: breadcrumbs (org name for now) left, page title from `Page`.
- Projects list: `Page` title "Projects", action "New project" (dialog: name, `projects.create`, navigate nowhere yet — the project page is plan 2 — just refresh the list); shadcn `Table`: Name (Geist Sans 13 px, link disabled for now with `title="Opens in plan 2"`), Websites (mono, right), Fields (mono, right), Last run (`RunDot` + relative time, mono), Created (mono). Empty state: one line of muted text "No projects yet." and the button. Each panel gets `.rise`.
- Mobile ≤ 768 px: the sidebar becomes a shadcn `Sheet` behind a menu button in the header.

- [ ] **Step 1: Failing tests** — `run-dot-view.test.ts` (each mapping above + unknown → `idle`), `projects-view.test.ts` (sort, the `websites n · fields m` string, relative time for 0 s / 5 min / 3 h / 2 d / 30 d as `just now`, `5 min ago`, `3 h ago`, `2 d ago`, `30 d ago`).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** the components and routes as described; `_app.tsx`'s `beforeLoad` redirects to `/login` when route context has no session. `projects.list` is called with no input (the session carries the org).

- [ ] **Step 4: Run** unit tests, typecheck, and the dev servers: sign in, see the shell, create a project, switch theme, sign out. Fix what you see before committing (this is where the frontend-design skill's eye applies: spacing at 13 px body, hairlines not boxes, nothing decorative).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src
git commit -m "feat(app): the shell — sidebar, organisation switcher, user menu, command menu, projects" -- packages/app/src
```

---

### Task 7: Smoke, look-only check in both themes, `dev:all`, handoff

**Files:**
- Create: `packages/app/src/routes-smoke.test.ts` (model: `packages/dashboard/src/routes-smoke.test.ts`, `RUN_UI_SMOKE=1`, base `http://localhost:3000`), `docs/testing/ui-check-app-shell.mts`
- Modify: root `package.json` (`"test:ui:app": "cross-env RUN_UI_SMOKE=1 pnpm --filter @robot/app exec vitest run src/routes-smoke.test.ts"`), `docs/testing/screens/README.md`, `docs/handoff.md`, `CLAUDE.md` (Package Map row for `@robot/app`, `dev:all` note that three servers start)

- [ ] **Step 1: Smoke** — signs in through the browser (`/login`, fill, submit), then for `/projects`, `/runs`, `/usage`, `/settings`, `/account`: render, no console errors, screenshot per theme (`app-<route>-dark.png`, `app-<route>-light.png` under `docs/testing/screens/`, switching the theme through the user menu between the two passes); `/login` screenshot signed out; creates a throwaway project through the dialog and asserts it in the table; signs out and asserts `/projects` redirects to `/login`. Cleans up the project over tRPC (with the cookie) at the end.

- [ ] **Step 2: Look-only check** — `ui-check-app-shell.mts` (run from `packages/browser` as the earlier checks say): the same walk with PASS/FAIL lines plus these judgements printed as measurements: sidebar width 240, body font-size 13 px, page title 20 px, table row height ≤ 40 px, no element with `text-transform: uppercase`, no box-shadow in dark, the running dot's animation name when a run exists. Then LOOK at the screenshots (Read renders PNGs) in both themes and fix what a designer would: alignment of the avatar and org name, hairline weights, hover states, the dialog's spacing, focus rings (visible, `--border-hover`), the empty state. Re-run after each fix.

- [ ] **Step 3: First sign-in on your database** — this is the one live proof of the `default`-org adoption: with the api-server running against the real DB and no users yet, sign in as `markodjordjievski@gmail.com`; assert `auth.me` returns the personal org "Markodjordjievski" (renamed from `default`) and that the existing projects (Acne, Scratch) are in the list. Record it in the handoff. (If a test earlier in this plan already created users in the dev DB, the adoption will not fire — delete those test users first: they are the `*@example.com` rows.)

- [ ] **Step 4: Docs** — screens README rows; handoff section "App redesign, plan 1: the shell (2026-09-21)": spec/plan paths, what landed per task, the API changes and the shim, how to run (`pnpm dev:all` now starts api-server :4000, dashboard :3456, app :3000), the screenshot set for Marko's review, what the check found and fixed, next plan (plan 2: project home, fields, output). CLAUDE.md: the `@robot/app` row and the commands.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes-smoke.test.ts docs/testing/ui-check-app-shell.mts docs/testing/screens docs/handoff.md CLAUDE.md package.json
git commit -m "docs: app shell smoke, look-only check in both themes, and the handoff" -- packages/app/src/routes-smoke.test.ts docs/testing/ui-check-app-shell.mts docs/testing/screens docs/handoff.md CLAUDE.md package.json
```
