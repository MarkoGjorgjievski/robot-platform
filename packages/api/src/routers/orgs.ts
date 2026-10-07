import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { memberships, orgs, sessions, users, MEMBERSHIP_ROLES } from '@robot/db';
import { router, protectedProcedure, requireRole } from '../trpc.js';
import { slugify, uniqueSlug } from '../slug.js';
import { listStaffActivity } from '../auth/staff-activity.js';

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
    // The caller's session would cascade away with the org row and sign them
    // out — of everything, for deleting one team. Their personal organisation
    // always exists (signIn creates it and nothing deletes it), so the session
    // moves there first; the other members' sessions on this org do cascade,
    // and the app sends them to /login, which is the honest outcome for them.
    const personal = await ctx.db.query.orgs.findFirst({
      where: and(eq(orgs.ownerUserId, ctx.session.user.id), eq(orgs.personal, true)),
      // A user can own two personal orgs (adopt-default.ts leaves an existing one alone) — the oldest wins.
      orderBy: [asc(orgs.createdAt)],
      columns: { id: true, slug: true, name: true },
    });
    if (!personal) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'This account has no personal organisation' });
    await ctx.db.transaction(async (tx) => {
      await tx.update(sessions).set({ orgId: personal.id }).where(eq(sessions.token, ctx.session.token));
      // Projects, datasets, websites and runs cascade from the org row (schema.ts).
      await tx.delete(orgs).where(eq(orgs.id, ctx.session.org.id));
    });
    return { ok: true as const, nextOrg: personal };
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

  /** Robot staff activity in this organisation (spec 2026-10-07 §2.4) — every member may read it. */
  staffActivity: protectedProcedure
    .input(z.object({ page: z.number().int().min(0).default(0) }))
    .query(({ ctx, input }) => listStaffActivity(ctx.db, { orgId: ctx.session.org.id }, { offset: input.page * 20, limit: 20 })),
});
