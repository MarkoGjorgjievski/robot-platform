import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sourceInputs } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const sourceInputsRouter = router({
  listBySource: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.sourceInputs.findMany({
        where: eq(sourceInputs.sourceId, input.sourceId),
        orderBy: (inputs, { asc }) => [asc(inputs.createdAt)],
      });
      return results;
    }),

  create: publicProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        label: z.string().min(1).max(255),
        inputData: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .insert(sourceInputs)
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
        .update(sourceInputs)
        .set(data)
        .where(eq(sourceInputs.id, id))
        .returning();
      if (!result) {
        throw new Error(`Source input with id ${id} not found`);
      }
      return result;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .delete(sourceInputs)
        .where(eq(sourceInputs.id, input.id))
        .returning();
      if (!result) {
        throw new Error(`Source input with id ${input.id} not found`);
      }
      return result;
    }),
});
