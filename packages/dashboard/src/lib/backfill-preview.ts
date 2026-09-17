// packages/dashboard/src/lib/backfill-preview.ts
// Pure helpers behind the bulk "Backfill gaps" panel (spec §2.4-2.5): the
// preview's cost/scope summary line, per-dead-field strategy copy, and the
// checklist-selection rules that decide what `crawl.backfill` gets sent.
// Components stay thin wrappers around these, same precedent as
// coverage-view.ts.

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
 * One page per gap item, so one count is the whole story.
 *
 * `certified` reads "free" instead — a verified website's repair runs
 * certified paths only, which never call AI (`backfillPreview`'s own
 * `estCostUsd: 0` for a certified website, packages/api/src/routers/crawl.ts)
 * — so no dollar figure, "up to" or otherwise, belongs in this line at all.
 */
export function previewSummary(p: { pages: number; estCostUsd: number; certified?: boolean }): string {
  const pages = p.pages === 1 ? 'page' : 'pages';
  const cost = p.certified ? 'free' : `up to ~$${p.estCostUsd.toFixed(2)} if no cache answers`;
  return `${p.pages} ${pages} — ${cost}`;
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
 *
 * Also null for a certified website (`opts.certified`) — repair-then-sweep
 * vs. full-focus is a distinction between two AI extraction strategies, and a
 * verified website's repair runs certified paths only, never AI. The panel
 * still sends `deadFieldStrategy: 'full_focus'` to satisfy the server's guard
 * (`backfillMutationInput`), just without ever showing this choice.
 */
export function strategyCopy(f: FieldClassification, opts?: { certified?: boolean }): { title: string; recommended: string; alternative: string } | null {
  if (f.classification === 'healthy' || opts?.certified) return null;
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
 *
 * `opts.certified` sends `full_focus` regardless of `strategy` — a certified
 * website never shows the strategy radio (`strategyCopy` above returns null
 * for it), but the server's guard 5 still requires SOME value whenever a
 * dead field is in scope; `full_focus` is the plain path straight through
 * `startExecution`, which is exactly what a certified repair already is.
 */
export function backfillMutationInput(
  fields: FieldClassification[],
  checked: Set<string>,
  strategy: 'repair_sweep' | 'full_focus',
  opts?: { certified?: boolean },
): { targetFields: string[]; deadFieldStrategy?: 'repair_sweep' | 'full_focus' } {
  const targetFields = fields.filter((f) => checked.has(f.name)).map((f) => f.name);
  if (!checkedHasDeadField(fields, checked)) return { targetFields };
  return { targetFields, deadFieldStrategy: opts?.certified ? 'full_focus' : strategy };
}
