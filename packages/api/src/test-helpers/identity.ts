// packages/api/src/test-helpers/identity.ts
// Belt-and-braces cleanup guard: tests that sign in and then delete the org
// they were given must never delete the seeded `default` org. Adoption of
// `default` is now an explicit script (packages/db/src/scripts/adopt-default.ts),
// never something a sign-in test could reach — but a test bug that deleted
// `default` would cascade every real project in the dev database, so every
// caller deletes through this guard instead of `db.delete(orgs)` directly.
import { expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, users } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
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
export async function signIn(email: string) {
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
export function signedInCaller(tag: string) {
  return signIn(`${tag.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`);
}
