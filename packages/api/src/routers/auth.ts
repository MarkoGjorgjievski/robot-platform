import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { memberships, orgs, sessions, users, USER_THEMES } from '@robot/db';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { slugify, uniqueSlug } from '../slug.js';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, avatarColourFor, mintToken } from '../auth/session.js';

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
      // The membership is resolved inside the transaction and its role reused below,
      // so the org a session lands on is always one the user is still a member of.
      const { user, org, role } = await ctx.db.transaction(async (tx) => {
        const existing = await tx.query.users.findFirst({ where: eq(users.email, input.email) });
        if (existing) {
          // Back to the org they last worked in — but only while they are still a
          // member of it; otherwise the org they joined most recently.
          const last = await tx.query.sessions.findFirst({ where: eq(sessions.userId, existing.id), orderBy: [desc(sessions.createdAt)] });
          const lastMembership = last
            ? await tx.query.memberships.findFirst({ where: and(eq(memberships.userId, existing.id), eq(memberships.orgId, last.orgId)) })
            : undefined;
          const membership = lastMembership
            ?? await tx.query.memberships.findFirst({ where: eq(memberships.userId, existing.id), orderBy: [desc(memberships.createdAt)] });
          if (!membership) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'This account has no organisation' });
          const org = (await tx.query.orgs.findFirst({ where: eq(orgs.id, membership.orgId) }))!;
          return { user: existing, org, role: membership.role };
        }
        // A new user always gets a fresh personal org (spec §2, amended 2026-09-21):
        // adoption of the seeded `default` org is an explicit script now, never automatic sign-in.
        const name = nameFromEmail(input.email);
        const [created] = await tx.insert(users).values({ email: input.email, name, avatarColour: avatarColourFor(input.email) }).returning();
        const user = created!;
        const slug = await uniqueSlug(slugify(name), async (s) => !!(await tx.query.orgs.findFirst({ where: eq(orgs.slug, s) })));
        const [org] = await tx.insert(orgs).values({ name, slug, personal: true, ownerUserId: user.id }).returning();
        await tx.insert(memberships).values({ userId: user.id, orgId: org!.id, role: 'owner' });
        return { user, org: org!, role: 'owner' };
      });
      const token = mintToken();
      await ctx.db.insert(sessions).values({ token, userId: user.id, orgId: org.id, expiresAt: new Date(Date.now() + SESSION_MAX_AGE_S * 1000) });
      ctx.setCookie?.(SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE_S });
      return { user: { id: user.id, email: user.email, name: user.name, avatarColour: user.avatarColour, theme: user.theme }, org: orgOut(org, role) };
    }),

  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(sessions).where(eq(sessions.token, ctx.session.token));
    ctx.clearCookie?.(SESSION_COOKIE);
    return { ok: true as const };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: orgs.id, slug: orgs.slug, name: orgs.name, personal: orgs.personal, role: memberships.role })
      .from(memberships)
      .innerJoin(orgs, eq(memberships.orgId, orgs.id))
      .where(eq(memberships.userId, ctx.session.user.id))
      .orderBy(orgs.name);
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

  updateName: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users).set({ name: input.name, updatedAt: new Date() }).where(eq(users.id, ctx.session.user.id));
      return { name: input.name };
    }),
});
