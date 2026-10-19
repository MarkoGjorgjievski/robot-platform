// Who sees money (spec 2026-10-17 §8a). Marko, 2026-10-17: "once we have paying customers we don't
// want to show any price to the customer." Staff — an operator, or a staff session inside the
// customer's org — still do. Every amount on a customer screen goes through this.

export type MoneyViewer = { isOperator: boolean; staff?: unknown };

export function showsMoney(viewer: MoneyViewer): boolean {
  return viewer.isOperator || !!viewer.staff;
}
