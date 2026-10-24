// Per fixture website: a project and website with its proof pages and expected values, a passing Verify on the
// fixture's certified paths, and a run of `pages` pending detail items — all in the bench database.
import { db, runs, runItems } from '@robot/db';
import { appRouter, createCallerFactory } from '@robot/api';
import { loadSession, SESSION_COOKIE } from '@robot/api/auth';
// Type-only: identity.ts imports vitest at runtime.
import type { AppCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
import { seedPassingVerification } from '@robot/api/test-helpers/seed-coverage-check';
import { FIXTURE_FIELDS, product, type FixtureShop, type FixtureSite } from './fixture-shop.js';

export type SeededSite = { site: number; sourceId: string; runId: string; keys: Record<string, string> };

export type BenchUser = { caller: AppCaller; userId: string; email: string; orgId: string; orgName: string; token: string };

/** A user signed in through the real `auth.signIn` (a new address gets its own personal organisation, as owner). */
export async function benchSignIn(email: string): Promise<BenchUser> {
  const cookies: Record<string, string | null> = {};
  const anon = createCallerFactory(appRouter)({ db, session: null, setCookie: (n: string, v: string) => { cookies[n] = v; }, clearCookie: (n: string) => { cookies[n] = null; } });
  const r = await anon.auth.signIn({ email, password: 'x' });
  const token = cookies[SESSION_COOKIE]!;
  return { caller: await benchCallerFor(token), userId: r.user.id, email: r.user.email, orgId: r.org.id, orgName: r.org.name, token };
}

/** A caller on that session as it is now (after `ops.enterOrg` moved it, say). */
export async function benchCallerFor(token: string): Promise<AppCaller> {
  const session = await loadSession(db, token);
  if (!session) throw new Error('bench: no session for that token');
  return createCallerFactory(appRouter)({ db, session });
}

/** A throwaway user signed in through the real `auth.signIn`, as the test helpers do (identity.ts imports vitest, so not used here). */
export async function benchCaller(): Promise<AppCaller> {
  return (await benchSignIn(`bench-${Date.now()}@example.com`)).caller;
}

/** One fixture website: a project and website with its proof pages and expected values, and a passing Verify on the fixture's certified paths. */
export async function seedCertifiedWebsite(caller: AppCaller, site: FixtureSite): Promise<{ sourceId: string; keys: Record<string, string> }> {
  const urls = [1, 2, 3].map((id) => site.productUrl(id));
  const expected = Object.fromEntries(FIXTURE_FIELDS.map((f) => [f.name, Object.fromEntries(urls.map((u, i) => [u, String(product(site.index, i + 1)[f.truth] ?? '')]))]));
  const made = await createProjectWithSource(caller, { tag: `bench-${site.index}`, fields: FIXTURE_FIELDS.map(({ name, type }) => ({ name, type })), urls, expected });
  await seedPassingVerification(made.sourceId, Object.fromEntries(FIXTURE_FIELDS.map((f) => [made.keys[f.name]!, f.paths])));
  return { sourceId: made.sourceId, keys: made.keys };
}

export async function seedBenchRuns(shop: FixtureShop, pages: number): Promise<SeededSite[]> {
  const caller = await benchCaller();
  const out: SeededSite[] = [];
  for (const site of shop.sites) {
    const { sourceId, keys } = await seedCertifiedWebsite(caller, site);
    const [run] = await db.insert(runs).values({ sourceId, status: 'pending' }).returning({ id: runs.id });
    await db.insert(runItems).values(Array.from({ length: pages }, (_, i) => ({ runId: run!.id, kind: 'detail', url: site.productUrl(i + 1), status: 'pending' })));
    out.push({ site: site.index, sourceId, runId: run!.id, keys });
  }
  return out;
}
