// packages/dashboard/src/lib/backfill-preview.ts
// Pure helpers behind the bulk "Backfill gaps" panel (spec §2.4-2.5): the
// preview's cost/scope summary line, per-dead-field strategy copy, and the
// checklist-selection rules that decide what `crawl.backfill` gets sent.
// Components stay thin wrappers around these, same precedent as
// coverage-view.ts.

import type { ItemGap } from './coverage-view';

/**
 * Mirrors `@robot/api`'s `FieldClassification`
 * (packages/api/src/crawl/backfill.ts) rather than importing it — this
 * package only depends on @robot/api's router types for tRPC's client, not
 * its internal crawl types (coverage-view.ts's header comment sets the same
 * precedent).
 */
export type FieldClassification = { name: string; fill: number; classification: 'healthy' | 'dead' };

/**
 * The preview panel's one-line cost/scope summary, shown above "Run
 * backfill" — "up to", never an exact figure, because a backfill item may
 * resolve for free at a cheaper cache tier than AI
 * (`EST_AI_COST_PER_PAGE_USD`'s own doc comment, packages/api/src/crawl/backfill.ts).
 */
export function previewSummary(p: { items: number; pages: number; estCostUsd: number }): string {
  const rows = p.items === 1 ? 'row' : 'rows';
  const pages = p.pages === 1 ? 'page' : 'pages';
  return `${p.items} ${rows}, ${p.pages} ${pages} — up to ~$${p.estCostUsd.toFixed(2)} if no cache answers`;
}

/**
 * Per-dead-field strategy copy for the preview's radio group (spec §2.5) —
 * null for a healthy field, which never gets a strategy choice at all: only
 * a field whose cached path is presumed broken (fill below the dead-field
 * threshold) needs one.
 *
 * Both strategies are described even though only ONE strategy value is ever
 * sent to `crawl.backfill` for the whole request (`deadFieldStrategy` is a
 * single enum, not per-field) — each dead field gets its own copy explaining
 * ITS OWN broken path, but the choice the operator makes applies uniformly
 * to every checked dead field, matching what the API actually accepts.
 */
export function strategyCopy(f: FieldClassification): { title: string; recommended: string; alternative: string } | null {
  if (f.classification === 'healthy') return null;
  const pct = Math.round(f.fill * 100);
  return {
    title: `${f.name} — ${pct}% filled, its extraction path looks broken`,
    recommended: 'Repair-then-sweep (recommended): re-discover the path on 3 sample pages, then sweep the rest for free with the repaired cache.',
    alternative: 'Full focus: re-fetch every gappy page with AI focused on this field — costlier, simpler, occasionally right when no one path generalizes.',
  };
}

/** The checklist's initial selection when the panel opens — every field the preview returned, checked. */
export function initialChecked(fields: FieldClassification[]): Set<string> {
  return new Set(fields.map((f) => f.name));
}

/** Whether the strategy radio belongs on screen — only when a CHECKED field is dead. */
export function checkedHasDeadField(fields: FieldClassification[], checked: Set<string>): boolean {
  return fields.some((f) => checked.has(f.name) && f.classification === 'dead');
}

/**
 * What `crawl.backfill` gets sent for the current checklist state.
 * `deadFieldStrategy` is omitted, not sent stale, the moment every checked
 * dead field is unchecked — the API refuses a strategy for fields no longer
 * in scope, and this panel never picks one behind the operator's back.
 */
export function backfillMutationInput(
  fields: FieldClassification[],
  checked: Set<string>,
  strategy: 'repair_sweep' | 'full_focus',
): { targetFields: string[]; deadFieldStrategy?: 'repair_sweep' | 'full_focus' } {
  const targetFields = fields.filter((f) => checked.has(f.name)).map((f) => f.name);
  return checkedHasDeadField(fields, checked) ? { targetFields, deadFieldStrategy: strategy } : { targetFields };
}

/**
 * Mirrors `EST_AI_COST_PER_PAGE_USD` (packages/api/src/crawl/backfill.ts) —
 * that constant lives in @robot/api's internal crawl types, which this
 * package deliberately doesn't import (see `FieldClassification`'s doc
 * comment above; same precedent as `DETAIL_URL_FIELD` in
 * source-run-detail.tsx). Keep the two values in step if either moves.
 */
const EST_AI_COST_PER_PAGE_USD = 0.05;

/**
 * The preview's items/pages/cost, recomputed client-side from data already
 * on the page (D-UX1) — the coverage query's `gapItems` intersected with the
 * CHECKED field set, so the summary line follows the checkboxes instead of
 * staying pinned to the full-gappy-set number `crawl.backfillPreview`
 * returned when the panel opened.
 *
 * Same semantics as the server's `deriveBackfillItems`
 * (packages/api/src/crawl/backfill.ts): an item counts iff its
 * `missingFields` intersects `checked`. Monotone in `checked` — the numbers
 * can only shrink as fields are unchecked, never exceed what the
 * server-side preview quoted for the full set, so this is a client-side
 * refinement, never an overstatement in the other direction.
 */
export function derivedPreview(
  gapItems: ItemGap[],
  checked: Set<string>,
): { items: number; pages: number; estCostUsd: number } {
  const items = gapItems.filter((g) => g.missingFields.some((f) => checked.has(f))).length;
  return { items, pages: items, estCostUsd: Number((items * EST_AI_COST_PER_PAGE_USD).toFixed(2)) };
}
