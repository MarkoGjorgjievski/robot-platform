// The session cookie and what it resolves to (spec 2026-09-21 §2). `resolveOrg`
// is the caller's org: the session's and nothing else. The old dashboard's
// `orgSlug` shim was removed at cut-over (spec §6-7); no input picks an org.
import { randomBytes, createHash } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { memberships, orgs, sessions, users, type Database } from '@robot/db';
import type { Context, SessionInfo } from '../trpc.js';
import { isOperatorEmail } from '../trpc.js';

export type { SessionInfo };

export const SESSION_COOKIE = 'robot_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

/** How long one staff entry lasts (spec 2026-10-07 §2.1). */
export const STAFF_SESSION_MS = 8 * 60 * 60 * 1000;

const AVATAR_COLOURS = ['#3ddc84', '#52a8ff', '#f5a623', '#ff5c5c', '#c084fc', '#2dd4bf', '#fb7185', '#a3e635'];

export function mintToken(): string {
  return randomBytes(32).toString('hex');
}

export function avatarColourFor(email: string): string {
  const h = createHash('sha256').update(email.toLowerCase()).digest();
  return AVATAR_COLOURS[h[0]! % AVATAR_COLOURS.length]!;
}

/**
 * The session row joined to its user, org and role — null when the token is unknown or expired.
 *
 * Staff access (spec 2026-10-07 §2.1): while the staff columns are set, the email is in
 * `OPS_EMAILS` and it is under `STAFF_SESSION_MS`, `org` is the staff org with role `'member'`;
 * when the 8 hours have passed (still an operator), `staffExpired` names the customer org;
 * otherwise the staff columns are ignored and `org` is the session's own org as before.
 */
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
  let staffValid = staffSet && operator && Date.now() - s.staffEnteredAt!.getTime() < STAFF_SESSION_MS;
  const orgId = staffValid ? s.staffOrgId! : s.ownOrgId;

  const orgQuery = (id: string) => db
    .select({ id: orgs.id, slug: orgs.slug, name: orgs.name, personal: orgs.personal, role: memberships.role })
    .from(orgs)
    .leftJoin(memberships, and(eq(memberships.orgId, orgs.id), eq(memberships.userId, s.userId)))
    .where(eq(orgs.id, id))
    .limit(1);

  let [o] = await orgQuery(orgId);
  if (!o && staffValid) {
    // Deletion race: the staff org vanished between the first query and this one. Land the
    // operator in their own org rather than 401ing them (Review Focus 1).
    staffValid = false;
    [o] = await orgQuery(s.ownOrgId);
  }
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

/** The signed-in caller's org. UNAUTHORIZED without a session: no input ever picks an org. */
export function resolveOrg(ctx: Pick<Context, 'session'>): { id: string; slug: string } {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  return { id: ctx.session.org.id, slug: ctx.session.org.slug };
}
