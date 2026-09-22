import { Skeleton } from '../ui/skeleton';
import type { OutputView } from '../../lib/output-view';

/**
 * The output sheet: every website's latest rows under one header, the way the
 * file has them. This is the one table in the app allowed to be wider than the
 * page (spec §4) — a project's contract can run to twenty columns — so it lives
 * in its own scroll container rather than squeezing columns to fit.
 */
export function OutputTable({ view, loading }: { view: OutputView; loading: boolean }) {
  if (loading) return <LoadingPanel />;

  // An empty head over nothing is furniture, and a summary bar above it would
  // only say "No rows yet" a second time: with no run yet the panel holds one
  // sentence and says where the rows will come from.
  if (view.total === 0) {
    return (
      <div className="rise rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
        <p className="text-base text-muted-foreground">
          No rows yet. Run a website from its Extract page once it is verified.
        </p>
      </div>
    );
  }

  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      {/* What is on the screen, said once above the sheet rather than in a
          caption under 500 rows nobody scrolls to. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <p className="text-sm text-muted-foreground">{view.summary}</p>
        {view.truncated ? (
          <p className="text-sm text-muted-foreground">
            Showing the first {view.shown} of {view.total} — the file has all of them.
          </p>
        ) : null}
      </div>

      {/* Both axes in one box from `md`: the sheet is wide *and* long, and a
          page-level horizontal scroll container would park its scrollbar under
          row 500, where nobody can reach it. Capping the height here makes the
          container a real scrollport, which is also the only way the head can
          stick — a `sticky` head inside a container that scrolls sideways but
          never vertically does nothing at all. Below `md` the height is
          uncapped: a nested vertical scroll region on a phone traps the page. */}
      <div className="overflow-auto rounded-b-[6px] md:max-h-[calc(100svh-190px)]">
        <table className="w-full min-w-max border-collapse text-base">
          <thead>
            {/* The head's hairline is an inset shadow, not a border: under
                `border-collapse` a cell's border belongs to the table and slides
                away with it, leaving a sticky head with nothing under it. */}
            <tr className="[&>th]:bg-panel [&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-sm [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground [&>th]:[box-shadow:inset_0_-1px_0_var(--border)] md:[&>th]:sticky md:[&>th]:top-0 md:[&>th]:z-10">
              {view.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {view.rows.map((row, i) => (
              <tr key={i} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                {row.map((text, c) => (
                  <td key={c} className="px-4 py-2.5 align-top">
                    {/* The cap is on a div, not on the cell: `max-width` on a
                        `td` is ignored in automatic table layout, so a long
                        description would set its column's width instead of
                        truncating inside it. The full value is the `title`, so
                        it is still readable without leaving the screen.

                        Nothing is right-aligned: these are strings of unknown
                        type, and a column of prices that came back as text
                        would be the only one that moved. */}
                    <div
                      className={`max-w-[320px] truncate ${c === 0 ? 'font-medium' : ''}`}
                      title={text || undefined}
                    >
                      {text}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The shape of the panel, not of the table: until the query lands there are no
 * columns to draw, and a head of three invented ones would be swapped for the
 * real ones a moment later.
 */
function LoadingPanel() {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="border-b border-line px-4 py-2.5">
        <Skeleton className="h-3.5 w-52 bg-raised" />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="border-b border-line px-4 py-2.5 last:border-0">
          <Skeleton className="h-3.5 w-full max-w-[420px] bg-raised" />
        </div>
      ))}
    </div>
  );
}
