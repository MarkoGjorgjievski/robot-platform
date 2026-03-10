import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { robotOverrides } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const overridesRouter = router({
  getByDomainCountry: publicProcedure
    .input(z.object({
      domainId: z.string().uuid(),
      country: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const override = await ctx.db.query.robotOverrides.findFirst({
        where: and(
          eq(robotOverrides.domainId, input.domainId),
          eq(robotOverrides.country, input.country),
        ),
      });
      return override ?? null;
    }),

  updateSchema: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      schemaName: z.string(),
      schema: z.record(z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.robotOverrides.findFirst({
        where: eq(robotOverrides.id, input.id),
      });

      if (!existing) {
        throw new Error(`Robot override with id ${input.id} not found`);
      }

      const currentSchemas = (existing.schemas as Record<string, unknown>) ?? {};
      const updatedSchemas = { ...currentSchemas, [input.schemaName]: input.schema };

      const [updated] = await ctx.db
        .update(robotOverrides)
        .set({ schemas: updatedSchemas, updatedAt: new Date() })
        .where(eq(robotOverrides.id, input.id))
        .returning();

      return updated;
    }),
});
