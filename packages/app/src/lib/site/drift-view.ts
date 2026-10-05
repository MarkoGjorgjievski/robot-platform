// View logic for drift repair's Tasks 3-4 (plan 2026-10-05): "n fields
// stopped extracting" on the website, the Verification tab's banner, the
// drift line under a drifted row, and accepting a repair. Pure, so the exact
// texts and board edits (Global Constraints) are tested without a server or a
// browser — the route and the table only call these and render/save what
// comes back.
//
// The app never imports `@robot/scraper`/`@robot/api`, so the shapes read
// here are re-declared, narrowed to what these functions need.
import { answer, type Board, type Mark } from './verification-model';

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

// --- Task 4: repair actions on the drifted rows -----------------------------

/** `@robot/scraper`'s `DriftPage`, re-declared (see the file's own doc comment). */
export type DriftPageLike = { status: 'ok'; value: string | null; mark?: Mark; changed?: boolean; was?: string } | { status: 'page-gone' };

/** `@robot/scraper`'s `DriftFieldResult`, narrowed to what `driftRows` reads. */
export type DriftFieldResultLike = {
  result: 'other-layout' | 'moved' | 'changed' | 'lost';
  pages: Record<string, DriftPageLike>;
};

/** `sources.driftCheck`'s `results` once the check is `done` (`DriftCheckResults`). */
export type DriftCheckResultsLike = { runId: string | null; fields: Record<string, DriftFieldResultLike> };

export type DriftRow =
  | { kind: 'moved'; text: string; marks: Record<string, Mark> }
  | { kind: 'changed'; text: string; values: Record<string, { value: string; mark?: Mark }> }
  | { kind: 'other-layout'; text: string; runId: string | null }
  | { kind: 'lost'; text: string }
  | { kind: 'page-gone'; texts: Array<{ url: string; text: string }> };

/**
 * Whether a `moved` row has anything for "Accept new location" to write: a
 * mark on at least one page. A move found through a structured path, or an
 * element outside the page's box map, carries none — accepting would change
 * nothing and ask for no Verify, so the action is not offered (final review M5).
 */
export function canAcceptMoved(marks: Record<string, Mark>): boolean {
  return Object.keys(marks).length > 0;
}

/**
 * The stored expected values (`sources.verificationSet.expected`, the server's
 * copy) — what a `changed` row's "(was {old})" falls back to when the check
 * did not record one. Never the live board: once the customer accepts the new
 * values the board holds them, and "was" would echo the new value (final review M4).
 */
export function storedExpected(verificationSet: unknown): Record<string, Record<string, string>> {
  const expected = (verificationSet as { expected?: Record<string, Record<string, string>> } | null)?.expected;
  return expected && typeof expected === 'object' ? expected : {};
}

/** The gone pages among `urls` (in product order), as the row text the Global Constraints give for each. */
function pageGoneRow(pages: Record<string, DriftPageLike>, urls: string[]): DriftRow | null {
  const texts = urls
    .map((url, i) => ({ url, n: i + 1, gone: pages[url]?.status === 'page-gone' }))
    .filter((p) => p.gone)
    .map(({ url, n }) => ({ url, text: `Product ${n} no longer loads — Replace product ${n}` }));
  return texts.length > 0 ? { kind: 'page-gone', texts } : null;
}

/**
 * One row per drifted field, in `fieldKeys` order (Global Constraints' texts,
 * verbatim), plus a `page-gone` row beside it for any proof page that no
 * longer loads — one entry per gone product, whatever the field's own result.
 *
 * A `changed` row lists, and accepts, only the pages whose value differs
 * from the stored expected one (the check's own `changed` flag; final review
 * I3). Its "was {old}" is the expected value the check compared against
 * (`page.was`), else `values[key][url]` — the stored expected values
 * (`storedExpected`), never the live board (M4).
 *
 * A `moved` row with no mark on any page reads "Moved on the page" alone:
 * there is no new location to accept (`canAcceptMoved`, M5).
 *
 * A field in `fieldKeys` with no entry in `results.fields` (not classified
 * yet, e.g. the check is still running) is skipped — its row appears once the
 * check lands and the caller re-renders with fresh `results`.
 */
export function driftRows(args: {
  fieldKeys: string[];
  urls: string[];
  results: DriftCheckResultsLike | null;
  values: Record<string, Record<string, string>>;
}): Record<string, DriftRow[]> {
  const { fieldKeys, urls, results, values } = args;
  const out: Record<string, DriftRow[]> = {};
  if (!results) return out;

  for (const key of fieldKeys) {
    const r = results.fields[key];
    if (!r) continue;
    const rows: DriftRow[] = [];

    switch (r.result) {
      case 'moved': {
        const marks: Record<string, Mark> = {};
        for (const url of urls) {
          const p = r.pages[url];
          if (p?.status === 'ok' && p.mark) marks[url] = p.mark;
        }
        rows.push({ kind: 'moved', text: canAcceptMoved(marks) ? 'Moved on the page — Accept new location' : 'Moved on the page', marks });
        break;
      }
      case 'changed': {
        const vals: Record<string, { value: string; mark?: Mark }> = {};
        const lines: Array<{ n: number; line: string }> = [];
        urls.forEach((url, i) => {
          const p = r.pages[url];
          if (p?.status !== 'ok' || p.value === null) return;
          const was = p.was ?? values[key]?.[url] ?? '';
          // Unchanged pages are not part of the change. A row written before the
          // check marked pages (no `changed` flag) falls back to plain text equality.
          if (p.changed === false || (p.changed === undefined && p.value === was)) return;
          vals[url] = p.mark ? { value: p.value, mark: p.mark } : { value: p.value };
          lines.push({ n: i + 1, line: `Page now shows ${p.value} (was ${was})` });
        });
        // A single affected product reads as the plain template; more than one
        // names each ("on product n") so the one line still says which is which.
        const text = lines.length === 1 ? lines[0]!.line : lines.map((l) => `${l.line} on product ${l.n}`).join('; ');
        rows.push({ kind: 'changed', text, values: vals });
        break;
      }
      case 'other-layout':
        rows.push({
          kind: 'other-layout',
          text: 'The products you verified still work; some others differ — See missed products',
          runId: results.runId,
        });
        break;
      case 'lost':
        rows.push({ kind: 'lost', text: 'Not found on the page — Mark it again' });
        break;
    }

    const gone = pageGoneRow(r.pages, urls);
    if (gone) rows.push(gone);

    if (rows.length > 0) out[key] = rows;
  }
  return out;
}

/**
 * Accept a `moved` row: each page's mark becomes the found element, its value
 * left exactly as it was (Global Constraints) — so a page with no prior
 * answer has nothing to attach the new mark to, and is skipped (classifyDrift
 * only ever drifts a field that was certified, so every deciding page should
 * already have one). Pure: a new board with only this field's cells touched
 * (Review Focus 5) — the caller pushes it through the existing autosave.
 */
export function acceptMoved(board: Board, key: string, marks: Record<string, Mark>): Board {
  let next = board;
  for (const [url, mark] of Object.entries(marks)) {
    const prev = next.answers[key]?.[url];
    if (!prev) continue;
    next = answer(next, key, url, { value: prev.value, mark });
  }
  return next;
}

/**
 * Accept a `changed` row: each page's expected value and mark become the new
 * ones (a page with no mark is stored as typed, like any value no element on
 * the page shows). Pure, touching only this field's cells (Review Focus 5).
 */
export function acceptChanged(board: Board, key: string, values: Record<string, { value: string; mark?: Mark }>): Board {
  let next = board;
  for (const [url, v] of Object.entries(values)) {
    next = answer(next, key, url, { value: v.value, mark: v.mark ?? null });
  }
  return next;
}
