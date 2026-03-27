import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { captures } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const capturesRouter = router({
  listBySource: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: captures.id,
          sourceId: captures.sourceId,
          url: captures.url,
          screenshotPath: captures.screenshotPath,
          createdAt: captures.createdAt,
        })
        .from(captures)
        .where(eq(captures.sourceId, input.sourceId))
        .orderBy(desc(captures.createdAt));
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [capture] = await ctx.db
        .select()
        .from(captures)
        .where(eq(captures.id, input.id))
        .limit(1);
      if (!capture) throw new Error(`Capture ${input.id} not found`);
      return capture;
    }),

  create: publicProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      url: z.string().url(),
      html: z.string().optional(),
      markdown: z.string().optional(),
      screenshotPath: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [capture] = await ctx.db.insert(captures).values(input).returning();
      return capture;
    }),
});
