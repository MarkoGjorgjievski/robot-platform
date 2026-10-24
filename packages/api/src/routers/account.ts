// packages/api/src/routers/account.ts
// The signed-in person's own email preferences (spec 2026-10-24 email §3.3–§3.4): "When a website needs attention"
// and "When a run fails". Account messages are always sent. For staff working in a customer's org it is still their
// own account (ctx.session.user is the operator).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users } from '@robot/db';
import { router, protectedProcedure } from '../trpc.js';

export type EmailPrefs = { attention: boolean; failedRuns: boolean };

const prefsOf = (u: { emailAttention: boolean; emailFailedRuns: boolean }): EmailPrefs => ({ attention: u.emailAttention, failedRuns: u.emailFailedRuns });

export const accountRouter = router({
  emailPrefs: protectedProcedure.query(async ({ ctx }): Promise<EmailPrefs> => {
    const u = await ctx.db.query.users.findFirst({ where: eq(users.id, ctx.session.user.id), columns: { emailAttention: true, emailFailedRuns: true } });
    return prefsOf(u ?? { emailAttention: true, emailFailedRuns: true });
  }),

  /** Saves on change (the panel's switches): only the preferences given change. */
  updateEmailPrefs: protectedProcedure
    .input(z.object({ attention: z.boolean().optional(), failedRuns: z.boolean().optional() }))
    .mutation(async ({ ctx, input }): Promise<EmailPrefs> => {
      const [u] = await ctx.db.update(users).set({
        ...(input.attention === undefined ? {} : { emailAttention: input.attention }),
        ...(input.failedRuns === undefined ? {} : { emailFailedRuns: input.failedRuns }),
        updatedAt: new Date(),
      }).where(eq(users.id, ctx.session.user.id)).returning({ emailAttention: users.emailAttention, emailFailedRuns: users.emailFailedRuns });
      return prefsOf(u!);
    }),
});
