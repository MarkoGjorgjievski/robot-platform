import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { credentials } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const credentialsRouter = router({
  listByExtractor: publicProcedure
    .input(z.object({ extractorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.credentials.findMany({
        where: eq(credentials.extractorId, input.extractorId),
        orderBy: (creds, { asc }) => [asc(creds.environment)],
      });

      return results;
    }),

  create: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid(),
        environment: z.string().max(50).optional(),
        username: z.string().nullable().optional(),
        password: z.string().nullable().optional(),
        extraFields: z.record(z.unknown()).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .insert(credentials)
        .values(input)
        .returning();
      return result;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        environment: z.string().max(50).optional(),
        username: z.string().nullable().optional(),
        password: z.string().nullable().optional(),
        extraFields: z.record(z.unknown()).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [result] = await ctx.db
        .update(credentials)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(credentials.id, id))
        .returning();

      if (!result) {
        throw new Error(`Credential with id ${id} not found`);
      }

      return result;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .delete(credentials)
        .where(eq(credentials.id, input.id))
        .returning();

      if (!result) {
        throw new Error(`Credential with id ${input.id} not found`);
      }

      return result;
    }),
});
