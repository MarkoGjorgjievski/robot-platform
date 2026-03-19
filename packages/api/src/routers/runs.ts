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

  listBySource: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.runs.findMany({
        where: eq(runs.sourceId, input.sourceId),
        columns: {
          id: true, status: true, inputLabel: true,
          startedAt: true, completedAt: true, resultCount: true,
          errorMessage: true, createdAt: true,
        },
        orderBy: [desc(runs.createdAt)],
        limit: 50,
      });
      return results;
    }),

  getHtml: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.id),
        columns: { id: true, html: true },
      });
      if (!run) throw new Error(`Run ${input.id} not found`);
      return { html: run.html };
    }),

  getDetails: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.id),
        columns: {
          id: true,
          html: true,
          logs: true,
          results: true,
          errorMessage: true,
          status: true,
        },
      });
      if (!run) throw new Error(`Run ${input.id} not found`);
      return {
        html: run.html,
        logs: run.logs,
        results: run.results,
        errorMessage: run.errorMessage,
        status: run.status,
      };
    }),

  create: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid().optional(),
        sourceId: z.string().uuid().optional(),
        inputLabel: z.string().optional(),
      }).refine(
        (data) => data.extractorId || data.sourceId,
        { message: 'Either extractorId or sourceId must be provided' },
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const [run] = await ctx.db.insert(runs).values({
        extractorId: input.extractorId ?? null,
        sourceId: input.sourceId ?? null,
        inputLabel: input.inputLabel ?? null,
        status: 'queued',
      }).returning();
      return run;
    }),
});
