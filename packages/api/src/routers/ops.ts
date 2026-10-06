import { router, publicProcedure } from '../trpc.js';

/**
 * Operators (ops mode, 2026-10-06): staff who answer "which customer websites
 * need us, and why?" from their own shell, read-only. `me` is the one public
 * entry point the app's shell needs before it can decide what to show — it
 * never throws for a signed-out visitor, it just says no.
 */
export const opsRouter = router({
  me: publicProcedure.query(({ ctx }) => ({ isOperator: ctx.isOperator })),
});
