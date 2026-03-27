import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { orgs, extractors } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const orgsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select({
        id: orgs.id,
        name: orgs.name,
        slug: orgs.slug,
        description: orgs.description,
        createdAt: orgs.createdAt,
        updatedAt: orgs.updatedAt,
        extractorCount: sql<number>`count(${extractors.id})::int`,
      })
      .from(orgs)
      .leftJoin(extractors, eq(orgs.id, extractors.orgId))
      .groupBy(orgs.id)
      .orderBy(orgs.name);

    return results;
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const org = await ctx.db.query.orgs.findFirst({
        where: eq(orgs.slug, input.slug),
        with: {
          projects: true,
        },
      });
      if (!org) throw new Error(`Org not found: ${input.slug}`);
      return org;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const org = await ctx.db.query.orgs.findFirst({
        where: eq(orgs.id, input.id),
        with: {
          extractors: true,
        },
      });

      if (!org) {
        throw new Error(`Org with id ${input.id} not found`);
      }

      return org;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [org] = await ctx.db.insert(orgs).values(input).returning();
      return org;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [org] = await ctx.db
        .update(orgs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(orgs.id, id))
        .returning();

      if (!org) {
        throw new Error(`Org with id ${id} not found`);
      }

      return org;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [org] = await ctx.db
        .delete(orgs)
        .where(eq(orgs.id, input.id))
        .returning();

      if (!org) {
        throw new Error(`Org with id ${input.id} not found`);
      }

      return org;
    }),
});
