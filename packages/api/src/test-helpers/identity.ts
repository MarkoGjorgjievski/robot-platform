// packages/api/src/test-helpers/identity.ts
// Belt-and-braces cleanup guard: tests that sign in and then delete the org
// they were given must never delete the seeded `default` org. Adoption of
// `default` is now an explicit script (packages/db/src/scripts/adopt-default.ts),
// never something a sign-in test could reach — but a test bug that deleted
// `default` would cascade every real project in the dev database, so every
// caller deletes through this guard instead of `db.delete(orgs)` directly.
import { expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs } from '@robot/db';

export async function deleteOwnOrg(orgId: string): Promise<void> {
  const row = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!row) return; // already gone (e.g. cascaded by a prior delete in the test)
  expect(row.slug).not.toBe('default');
  await db.delete(orgs).where(eq(orgs.id, orgId));
}
