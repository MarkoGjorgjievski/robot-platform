import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { extractorInputs } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const inputsRouter = router({
  listByExtractor: publicProcedure
    .input(z.object({ extractorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.extractorInputs.findMany({
        where: eq(extractorInputs.extractorId, input.extractorId),
        orderBy: (inputs, { asc }) => [asc(inputs.createdAt)],
      });

      return results;
    }),

  create: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid(),
        label: z.string().min(1).max(255),
        inputData: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .insert(extractorInputs)
        .values(input)
        .returning();
      return result;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).max(255).optional(),
        inputData: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [result] = await ctx.db
        .update(extractorInputs)
        .set(data)
        .where(eq(extractorInputs.id, id))
        .returning();

      if (!result) {
        throw new Error(`Extractor input with id ${id} not found`);
      }

      return result;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .delete(extractorInputs)
        .where(eq(extractorInputs.id, input.id))
        .returning();

      if (!result) {
        throw new Error(`Extractor input with id ${input.id} not found`);
      }

      return result;
    }),
});
