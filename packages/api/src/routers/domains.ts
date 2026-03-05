import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { domains } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const domainsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.domains.findMany({
      orderBy: (domains, { asc }) => [asc(domains.name)],
    });

    return results;
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const domain = await ctx.db.query.domains.findFirst({
        where: eq(domains.id, input.id),
        with: {
          robotOverrides: true,
        },
      });

      if (!domain) {
        throw new Error(`Domain with id ${input.id} not found`);
      }

      return domain;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        prefix: z.string().max(10).nullable().optional(),
        hasGotoOverride: z.boolean().optional(),
        hasSetZipCodeOverride: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db.insert(domains).values(input).returning();
      return domain;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        prefix: z.string().max(10).nullable().optional(),
        hasGotoOverride: z.boolean().optional(),
        hasSetZipCodeOverride: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [domain] = await ctx.db
        .update(domains)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(domains.id, id))
        .returning();

      if (!domain) {
        throw new Error(`Domain with id ${id} not found`);
      }

      return domain;
    }),
});
