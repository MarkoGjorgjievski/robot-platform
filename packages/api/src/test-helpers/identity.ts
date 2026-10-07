// packages/api/src/test-helpers/identity.ts
// Belt-and-braces cleanup guard: tests that sign in and then delete the org
// they were given must never delete the seeded `default` org. Adoption of
// `default` is now an explicit script (packages/db/src/scripts/adopt-default.ts),
// never something a sign-in test could reach — but a test bug that deleted
// `default` would cascade every real project in the dev database, so every
// caller deletes through this guard instead of `db.delete(orgs)` directly.
import { expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, orgs, sessions, users } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter, type AppRouter } from '../routers/index.js';
import type { SessionInfo } from '../trpc.js';
import { loadSession, SESSION_COOKIE } from '../auth/session.js';

export async function deleteOwnOrg(orgId: string): Promise<void> {
  const row = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!row) return; // already gone (e.g. cascaded by a prior delete in the test)
  expect(row.slug).not.toBe('default');
  await db.delete(orgs).where(eq(orgs.id, orgId));
}

/**
 * A throwaway signed-in identity: a fresh user with their own personal org,
 * signed in through `auth.signIn` exactly as the app does, and an appRouter
 * caller bound to that session. Every customer procedure needs a session and
 * works in its org only (cut-over), so this is how every test reaches them —
 * never the seeded `default` org. `cleanup` deletes the org (cascading its
 * projects, datasets, websites and runs) and then the user.
 */
/** An appRouter caller. Spelled from names in scope so declaration emit can write it (TS2742). */
export type AppCaller = ReturnType<ReturnType<typeof createCallerFactory<AppRouter['_def']['record']>>>;

export type SignedIn = {
  user: { id: string; email: string; name: string };
  org: { id: string; slug: string; name: string; personal: boolean; role: string };
  session: SessionInfo;
  caller: AppCaller;
  cleanup: () => Promise<void>;
};

export async function signIn(email: string): Promise<SignedIn> {
  const cookies: Record<string, string | null> = {};
  const anon = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: (n) => { cookies[n] = null; } });
  const r = await anon.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies[SESSION_COOKIE]!))!;
  return {
    ...r,
    session,
    caller: createCallerFactory(appRouter)({ db, session }),
    cleanup: async () => {
      await deleteOwnOrg(r.org.id);
      await db.delete(users).where(eq(users.id, r.user.id));
    },
  };
}

/** `signIn` as a unique address built from `tag`, for a test file's own identity. */
export function signedInCaller(tag: string): Promise<SignedIn> {
  return signIn(`${tag.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`);
}

/** Puts `who`'s session inside `orgId` as staff by writing the columns directly (Task 2's `ops.enterOrg` is the product path). */
export async function enterAsStaff(who: SignedIn, orgId: string, enteredAt: Date = new Date()): Promise<SignedIn> {
  await db.update(sessions).set({ staffOrgId: orgId, staffEnteredAt: enteredAt }).where(eq(sessions.token, who.session.token));
  const session = (await loadSession(db, who.session.token))!;
  return { ...who, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

/**
 * Deletes the user with `email`, if there is one, and every personal org they
 * own (each through `deleteOwnOrg`'s guard) — for a smoke run that signs in a
 * fixed throwaway address and must start clean and leave nothing behind.
 * Only ever pass a throwaway `@example.com` address.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  expect(email.endsWith('@example.com'), 'deleteUserByEmail is for throwaway @example.com addresses only').toBe(true);
  const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (!user) return;
  const owned = await db.query.orgs.findMany({ where: and(eq(orgs.ownerUserId, user.id), eq(orgs.personal, true)) });
  for (const org of owned) await deleteOwnOrg(org.id);
  await db.delete(users).where(eq(users.id, user.id));
}
