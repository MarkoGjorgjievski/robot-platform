import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { extractions } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const extractionsRouter = router({
  listBySource: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(extractions)
        .where(eq(extractions.sourceId, input.sourceId))
        .orderBy(desc(extractions.createdAt));
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [extraction] = await ctx.db
        .select()
        .from(extractions)
        .where(eq(extractions.id, input.id))
        .limit(1);
      if (!extraction) throw new Error(`Extraction ${input.id} not found`);
      return extraction;
    }),

  create: publicProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      captureId: z.string().uuid(),
      data: z.array(z.record(z.unknown())),
      rowCount: z.number().int().optional(),
      confidence: z.number().int().min(0).max(100).optional(),
      validationResult: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [extraction] = await ctx.db.insert(extractions).values({
        ...input,
        rowCount: input.rowCount ?? (input.data as unknown[]).length,
      }).returning();
      return extraction;
    }),
});
