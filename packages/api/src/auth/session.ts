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

/** The session row joined to its user, org and role — null when the token is unknown or expired. */
export async function loadSession(db: Database, token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const row = await db
    .select({
      token: sessions.token,
      userId: users.id, email: users.email, name: users.name, avatarColour: users.avatarColour, theme: users.theme,
      orgId: orgs.id, slug: orgs.slug, orgName: orgs.name, personal: orgs.personal,
      role: memberships.role,
    })
    .from(sessions)
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
