import { cellText } from '../../lib/output-view';
import { notShownBadge, type FieldCoverage } from '../../lib/site/coverage-view';

/** The project's contract, as the sheet reads it: `key` keys a row, `name` is the heading. */
export type ResultColumn = { key: string; name: string };

const NO_ABSENT_FIELDS: ReadonlySet<string> = new Set<string>();
const NO_UNSHOWN_FIELDS: ReadonlySet<string> = new Set<string>();

/**
 * What this run extracted, one row per page.
 *
 * The same sheet grammar as the project's Output table — sticky head, `min-w-max`
 * in its own scroll container, truncation on an inner div rather than the cell —
 * because it is the same object: a project's contract can run to twenty columns,
 * so this is the one table in the app allowed to be wider than the page (spec §4).
 *
 * The columns are the contract's, not the row's own keys: a field the engine
 * never filled has no key in the row, and a sheet built from the rows would
 * quietly drop the very column the customer is looking for.
 */
export function ResultsTable({
  columns,
  rows,
  absentByUrl,
  unshownByUrl,
  coverage,
  summary,
  note,
}: {
  columns: readonly ResultColumn[];
  rows: readonly Record<string, unknown>[];
  /** Per-row confirmed-absent field keys, keyed by the row's `_url` (`crawl.items`). */
  absentByUrl: Map<string, Set<string>>;
  /** Per-row not-shown field keys, keyed by the row's `_url` (`crawl.coverage`'s `unshownItems`, spec 2026-10-12 §5). Absent on a run that never computed coverage. */
  unshownByUrl?: Map<string, Set<string>>;
  /** `crawl.coverage`'s per-field report, for the column head's second badge (`notShownBadge`, spec §5/§7). Absent — same as every entry missing — draws no badge, same as today. */
  coverage?: readonly FieldCoverage[];
  /** "1,204 rows · 92% confidence" (`resultsSummary`). */
  summary: string;
  /** "Showing the first 500 of 1,204 …" (`resultsNote`), or null when it is all here. */
  note: string | null;
}) {
  const covByKey = new Map((coverage ?? []).map((c) => [c.name, c] as const));
  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      {/* What is on the screen, said once above the sheet rather than in a
          caption under row 500 nobody scrolls to. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <h3 className="text-base font-medium">Rows</h3>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>

      {rows.length === 0 || columns.length === 0 ? (
        <p className="px-4 py-5 text-base text-muted-foreground">
          {columns.length === 0
            ? 'No fields in this project yet, so there is nothing to show.'
            : 'No rows came back from this extraction.'}
        </p>
      ) : (
        <>
          {/* Both axes in one box from `md`: the sheet is wide *and* long, and a
              page-level horizontal scroll container would park its scrollbar
              under the last row, where nobody can reach it. Capping the height
              here makes the container a real scrollport, which is also the only
              way the head can stick. Below `md` the height is uncapped: a nested
              vertical scroll region on a phone traps the page. */}
          <div className="overflow-auto md:max-h-[calc(100svh-320px)]">
            <table className="w-full min-w-max border-collapse text-base">
              <thead>
                {/* The head's hairline is an inset shadow, not a border: under
                    `border-collapse` a cell's border belongs to the table and
                    slides away with it, leaving a sticky head with nothing under
                    it. */}
                <tr className="[&>th]:bg-panel [&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-sm [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground [&>th]:[box-shadow:inset_0_-1px_0_var(--border)] md:[&>th]:sticky md:[&>th]:top-0 md:[&>th]:z-10">
                  {columns.map((column) => {
                    // The column head's second badge (spec 2026-10-12 §5/§7):
                    // how many of this field's values the "shown on the page"
                    // check caught, or "not checked" for a field it never ran
                    // on — shown even on a column with nothing missing, which
                    // is why this reads `coverage` directly rather than riding
                    // along with a fill badge this table has never drawn.
                    const badge = notShownBadge(covByKey.get(column.key));
                    return (
                      <th key={column.key} title={`${column.key} · ${column.name}`}>
                        {column.name}
                        {badge ? (
                          <span className={`ml-1.5 font-mono text-xs normal-case ${badge === 'not checked' ? 'text-muted-foreground' : 'text-warn'}`}>
                            {badge}
                          </span>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {rows.map((row, i) => {
                  // `_url` is the row's own address, written by the extractor
                  // beside the contract's fields — the key `crawl.items` keys
                  // its confirmed-absent fields by.
                  const url = typeof row._url === 'string' ? row._url : '';
                  const absent = absentByUrl.get(url) ?? NO_ABSENT_FIELDS;
                  const unshown = unshownByUrl?.get(url) ?? NO_UNSHOWN_FIELDS;
                  return (
                    <tr key={i} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                      {columns.map((column, c) => {
                        const text = cellText(row[column.key]);
                        if (text === '') {
                          return (
                            <td key={column.key} className="px-4 py-2.5 align-top text-muted-foreground">
                              {/* "not on page" is the engine's own answer — the
                                  field was looked for and confirmed absent — and
                                  it is a different thing from a cell nobody
                                  could fill. Both stay quiet; neither is
                                  invented, and neither gets a tint. */}
                              {absent.has(column.key) ? <span className="italic">not on page</span> : '—'}
                            </td>
                          );
                        }
                        // A not-shown value still has its value — the check
                        // only flags where it came from, never withholds it
                        // (spec §5: "the value stays") — so this is a rail on
                        // the one cell type that can ever carry one: an empty
                        // cell above has nothing the check could have passed
                        // or failed.
                        const notShown = unshown.has(column.key);
                        return (
                          <td
                            key={column.key}
                            className={`px-4 py-2.5 align-top ${notShown ? 'border-l-2 border-warn' : ''}`}
                            title={notShown ? 'not shown on the page' : undefined}
                          >
                            {/* The cap is on a div, not on the cell:
                                `max-width` on a `td` is ignored in automatic
                                table layout, so a long description would set its
                                column's width instead of truncating inside it.
                                The full value is the `title`. */}
                            <div className={`max-w-[320px] truncate ${c === 0 ? 'font-medium' : ''}`} title={text}>
                              {text}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {note ? <p className="border-t border-line px-4 py-2.5 text-sm text-muted-foreground">{note}</p> : null}
        </>
      )}
    </section>
  );
}
