// packages/api/src/email/recipients.ts
// Who an email goes to (spec 2026-10-24 email §3.1, §7): the org's members, read from memberships — never a staff
// session (§4.5: staff are not members). Website and run emails go to owners and admins who keep that kind on;
// account messages ignore preferences.
import { and, eq } from 'drizzle-orm';
import { memberships, users } from '@robot/db';
import type { DbOrTx } from '../jobs/queue.js';

export type Recipient = { userId: string; email: string };
export type MemberRow = Recipient & { role: string; emailAttention: boolean; emailFailedRuns: boolean };
export type Preference = 'attention' | 'failedRuns';

/** Owners and admins, by `pref` (null: always), without `except`; by address, so the order is stable. */
export function lookoutsOf(rows: MemberRow[], pref: Preference | null, except: string | null = null): Recipient[] {
  return rows
    .filter((r) => (r.role === 'owner' || r.role === 'admin') && r.userId !== except)
    .filter((r) => pref === null || (pref === 'attention' ? r.emailAttention : r.emailFailedRuns))
    .sort((a, b) => a.email.localeCompare(b.email))
    .map(({ userId, email }) => ({ userId, email }));
}

async function memberRows(dbh: DbOrTx, orgId: string, userId?: string): Promise<MemberRow[]> {
  return dbh
    .select({ userId: users.id, email: users.email, role: memberships.role, emailAttention: users.emailAttention, emailFailedRuns: users.emailFailedRuns })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(userId ? and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)) : eq(memberships.orgId, orgId));
}

export async function orgLookouts(dbh: DbOrTx, orgId: string, pref: Preference | null, except: string | null = null): Promise<Recipient[]> {
  return lookoutsOf(await memberRows(dbh, orgId), pref, except);
}

/** That user while they are a member of the org (any role); null otherwise. */
export async function orgMember(dbh: DbOrTx, orgId: string, userId: string): Promise<Recipient | null> {
  const [r] = await memberRows(dbh, orgId, userId);
  return r ? { userId: r.userId, email: r.email } : null;
}
