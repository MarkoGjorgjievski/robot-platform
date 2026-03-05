import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { runs } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const runsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.runs.findMany({
        where: input?.extractorId ? eq(runs.extractorId, input.extractorId) : undefined,
        orderBy: [desc(runs.createdAt)],
        limit: 50,
      });
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.id),
        with: {
          extractor: {
            with: {
              org: { columns: { id: true, name: true } },
              domain: { columns: { id: true, name: true } },
            },
          },
        },
      });

      if (!run) {
        throw new Error(`Run with id ${input.id} not found`);
      }

      return run;
    }),

  create: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid(),
        inputLabel: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [run] = await ctx.db.insert(runs).values({
        extractorId: input.extractorId,
        inputLabel: input.inputLabel ?? null,
        status: 'queued',
      }).returning();
      return run;
    }),
});
