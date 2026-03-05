import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { extractors } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const extractorsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          orgId: z.string().uuid().optional(),
          domainId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input?.orgId) {
        conditions.push(eq(extractors.orgId, input.orgId));
      }
      if (input?.domainId) {
        conditions.push(eq(extractors.domainId, input.domainId));
      }

      const results = await ctx.db.query.extractors.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        with: {
          org: { columns: { id: true, name: true, slug: true } },
          domain: { columns: { id: true, name: true } },
        },
        orderBy: (extractors, { desc }) => [desc(extractors.createdAt)],
      });

      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const extractor = await ctx.db.query.extractors.findFirst({
        where: eq(extractors.id, input.id),
        with: {
          org: true,
          domain: true,
          inputs: true,
          credentials: true,
        },
      });

      if (!extractor) {
        throw new Error(`Extractor with id ${input.id} not found`);
      }

      return extractor;
    }),

  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        domainId: z.string().uuid(),
        country: z.string().min(1).max(10),
        robotTemplate: z.string().max(255).optional(),
        variant: z.string().min(1).max(50),
        parameters: z.record(z.unknown()).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [extractor] = await ctx.db
        .insert(extractors)
        .values(input)
        .returning();
      return extractor;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        orgId: z.string().uuid().optional(),
        domainId: z.string().uuid().optional(),
        country: z.string().min(1).max(10).optional(),
        robotTemplate: z.string().max(255).optional(),
        variant: z.string().min(1).max(50).optional(),
        parameters: z.record(z.unknown()).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [extractor] = await ctx.db
        .update(extractors)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(extractors.id, id))
        .returning();

      if (!extractor) {
        throw new Error(`Extractor with id ${id} not found`);
      }

      return extractor;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [extractor] = await ctx.db
        .delete(extractors)
        .where(eq(extractors.id, input.id))
        .returning();

      if (!extractor) {
        throw new Error(`Extractor with id ${input.id} not found`);
      }

      return extractor;
    }),
});
