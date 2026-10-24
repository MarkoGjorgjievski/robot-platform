// The staff-only "Monthly AI limit" panel on the organisation's Settings (spec 2026-10-24 metering §2.4). Pure. A
// customer never sees it: Settings draws it for operators only.
import { usdLabel } from './usage-view';

/** `ops.orgs`' row for the org: the fields the panel reads. */
export type AiLimitRow = { capUsd: number | null; capIsDefault: boolean; ownCapUsd: number | null; defaultCapUsd: number | null; aiUsd: number; remainingUsd: number | null; reached: boolean };

export const AI_LIMIT_TITLE = 'Monthly AI limit';
const AMOUNT = 'Enter an amount in dollars, like 40 or 40.50';

/** "$25", "$40.50" — the limit as staff type it (the api's staff log writes it the same way). */
export function capText(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

export function defaultHint(defaultCapUsd: number | null): string {
  return defaultCapUsd === null ? 'Leave empty for no limit' : `Leave empty to use the default (${capText(defaultCapUsd)})`;
}

/** Empty is "use the default"; anything else is dollars with at most two decimals, up to $1,000,000. */
export function parseCapDraft(draft: string): { ok: true; capUsd: number | null } | { ok: false; reason: string } {
  const t = draft.trim().replace(/^\$\s*/, '');
  if (t === '') return { ok: true, capUsd: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, reason: AMOUNT };
  const n = Number(t);
  if (n > 1_000_000) return { ok: false, reason: 'At most $1,000,000' };
  return { ok: true, capUsd: n };
}

/** `draft` null: untouched — the field shows the org's own limit, or nothing when it uses the default. */
export function aiLimitView(row: AiLimitRow | null, draft: string | null) {
  const shown = draft ?? (row?.ownCapUsd != null ? String(row.ownCapUsd) : '');
  const parsed = parseCapDraft(shown);
  const unchanged = parsed.ok && parsed.capUsd === (row?.ownCapUsd ?? null);
  return {
    draft: shown,
    spentLine: row ? `${usdLabel(row.aiUsd)} spent this month` : '',
    capLine: !row ? '' : row.capUsd === null ? 'No limit' : `${capText(row.capUsd)} limit${row.capIsDefault ? ' (default)' : ''}`,
    remainingLine: row && row.remainingUsd !== null ? `${usdLabel(row.remainingUsd)} left` : '',
    reached: row?.reached ?? false,
    hint: defaultHint(row ? row.defaultCapUsd : null),
    saveReason: !row ? 'Loading…' : !parsed.ok ? parsed.reason : unchanged ? 'No changes to save' : null,
    capUsd: parsed.ok ? parsed.capUsd : null,
  };
}
