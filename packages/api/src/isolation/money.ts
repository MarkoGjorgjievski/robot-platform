// packages/api/src/isolation/money.ts
// Who receives money in an answer (spec 2026-10-24 tenant isolation §2.3): the app's `showsMoney` rule, on the
// server — an operator, or a staff session inside the customer's org. Marko, 2026-10-17: a customer sees no money
// anywhere, and an answer the browser receives counts.

export function viewerSeesMoney(ctx: { isOperator?: boolean; session: { staff: unknown } | null }): boolean {
  return !!ctx.isOperator || !!ctx.session?.staff;
}

/** `fields` for staff; for a customer nothing — the keys are left out, never zeroed (superjson would carry an
 *  `undefined` key's name, and a 0 would read as "free"). */
export function moneyFields<T extends Record<string, unknown>>(sees: boolean, fields: T): Partial<T> {
  return sees ? fields : {};
}
