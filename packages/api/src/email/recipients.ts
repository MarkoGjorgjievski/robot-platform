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

/**
 * Spec §4.1 at send time (final review M3): whether the person a queued message is addressed to may still get it —
 * null when they may, else the reason it is skipped. Attention and run-failed: still an owner or admin who keeps
 * that kind on; staff-access: still an owner or admin; role-changed: still a member; removed: always (they are no
 * longer a member by design).
 */
export async function whyNotNow(dbh: DbOrTx, m: { kind: string; orgId: string; userId: string | null }): Promise<string | null> {
  if (m.kind === 'removed') return null;
  const [r] = m.userId ? await memberRows(dbh, m.orgId, m.userId) : [];
  if (!r) return 'not sent: the recipient is no longer a member of this organisation';
  if (m.kind === 'role-changed') return null;
  if (r.role !== 'owner' && r.role !== 'admin') return 'not sent: the recipient is no longer an owner or admin of this organisation';
  if (m.kind === 'staff-access') return null;
  if (m.kind === 'attention') return r.emailAttention ? null : 'not sent: the recipient turned these emails off';
  if (m.kind === 'run-failed') return r.emailFailedRuns ? null : 'not sent: the recipient turned these emails off';
  return `not sent: unknown kind ${m.kind}`;
}
