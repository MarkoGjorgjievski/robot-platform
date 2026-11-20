// The Fields list's order while the customer drags it (Marko 2026-11-20). Pure, so the moves are tested.

/** `keys` with `key` moved to index `to` (clamped to the list). */
export function moveKey(keys: readonly string[], key: string, to: number): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return [...keys];
  const next = keys.filter((k) => k !== key);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, key);
  return next;
}

/**
 * The fields in the order being arranged, or as the server lists them when nothing is being arranged. A field the
 * arranged order does not know (added meanwhile) goes at the end; one it names that is gone is dropped.
 */
export function orderedFields<T extends { key: string }>(fields: readonly T[], order: readonly string[] | null): T[] {
  if (!order) return [...fields];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const known = order.map((k) => byKey.get(k)).filter((f): f is T => !!f);
  return [...known, ...fields.filter((f) => !order.includes(f.key))];
}
