// View logic for drift repair's Task 3 (plan 2026-10-05): "n fields stopped
// extracting" on the website, and the Verification tab's banner. Pure, so the
// exact texts (Global Constraints) are tested without a server or a browser —
// the route and the header only call these and render what comes back.
//
// The app never imports `@robot/scraper`/`@robot/api`, so the shapes read
// here are re-declared, narrowed to what these two functions need.

/** `sources.checkDrift`'s row, narrowed to what the banner reads. `results` is
 *  null until the check is `done` — `emptyShare` is what carries percentages
 *  before then (the caller merges it in; see `sources.driftCheck`). */
export type DriftCheckView = {
  status: 'running' | 'done' | 'failed';
  results: { fields: Record<string, { emptyShare?: number }> } | null;
  runAt: string | Date | null;
};

/** "{n} fields stopped extracting"; "1 field …" for one; null with nothing drifted. */
export function driftBadge(driftedFields: string[] | null): string | null {
  if (!driftedFields || driftedFields.length === 0) return null;
  const n = driftedFields.length;
  return n === 1 ? '1 field stopped extracting' : `${n} fields stopped extracting`;
}

/** "a", "a and b", "a, b and c" — no Oxford comma (matches the badge's own field list). */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `d MMM`, e.g. "26 Sep" — locale-free, like the rest of the app's dates. */
function formatDMMM(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The Verification tab's banner (Global Constraints, Review Focus 3).
 *
 * No banner when nothing is drifted, even if an old check row is still
 * sitting there — a re-verify clears `driftedFields` but never the check
 * rows, so the banner would otherwise outlive the thing it is about.
 *
 * A `running` check always reads as "Checking what changed…", whatever
 * shares or dates are already on hand; once it is not running, the result
 * text includes the run's date when known, and each field's rounded empty
 * share when every drifted field has one — never a partial percentage list.
 */
export function driftBanner(args: {
  driftedFields: string[] | null;
  fieldNames: Record<string, string>;
  check: DriftCheckView | null;
}): { kind: 'none' } | { kind: 'checking'; text: string } | { kind: 'result'; text: string } {
  const { driftedFields, fieldNames, check } = args;
  if (!driftedFields || driftedFields.length === 0) return { kind: 'none' };

  if (check?.status === 'running') return { kind: 'checking', text: 'Checking what changed…' };

  const fieldsText = joinList(driftedFields.map((k) => fieldNames[k] ?? k));

  const shares = driftedFields.map((k) => check?.results?.fields[k]?.emptyShare);
  const hasAllShares = shares.every((s) => typeof s === 'number');

  const runAt = check?.runAt ? new Date(check.runAt) : null;

  if (hasAllShares && runAt) {
    const pct = joinList(shares.map((s) => `${Math.round((s as number) * 100)} %`));
    return { kind: 'result', text: `${fieldsText} stopped extracting in the run of ${formatDMMM(runAt)} (${pct} of products empty)` };
  }
  if (runAt) return { kind: 'result', text: `${fieldsText} stopped extracting in the run of ${formatDMMM(runAt)}` };
  return { kind: 'result', text: `${fieldsText} stopped extracting` };
}
