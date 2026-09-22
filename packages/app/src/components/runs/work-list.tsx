import { listingValuesLabel, summariseWorkList, type WorkListCounts } from '../../lib/site/work-list';
import { workListNote } from '../../lib/site/run-screen-view';

/** One row of `crawl.items`, narrowed to what this table reads. */
export type WorkListItem = {
  id: string;
  kind: string;
  url: string;
  status: string;
  pageNumber: number | null;
  listingValues: unknown;
  error: string | null;
};

/** Enough rows to see the shape of a plan; the whole of a 5,000-URL crawl is not. */
const CAP = 200;

/**
 * The work list a plan produced: which listing pages were walked, and which
 * product URLs each one yielded.
 *
 * This is the inspection point the two-phase design exists for — the fan-out is
 * visible here BEFORE phase 2 turns it into requests, so a plan that queued the
 * wrong links (a facet sidebar, a privacy policy) is obvious rather than
 * expensive.
 */
export function WorkList({ items, counts }: { items: readonly WorkListItem[]; counts: WorkListCounts }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, CAP);
  const note = workListNote(shown.length, items.length);

  return (
    <section className="rise mb-3 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <h3 className="text-base font-medium">Pages</h3>
        <p className="text-sm text-muted-foreground">{summariseWorkList(counts)}</p>
      </div>

      {/* Below `md` the table keeps its real width and the container scrolls
          (spec §3); the head sticks only where the box is a real scrollport. */}
      <div className="overflow-auto md:max-h-[420px]">
        <table className="w-full min-w-max border-collapse text-base">
          <thead>
            <tr className="[&>th]:bg-panel [&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-sm [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground [&>th]:[box-shadow:inset_0_-1px_0_var(--border)] md:[&>th]:sticky md:[&>th]:top-0 md:[&>th]:z-10">
              <th>Kind</th>
              <th>Page</th>
              <th>Status</th>
              <th>Address</th>
              <th>From the listing</th>
            </tr>
          </thead>

          <tbody>
            {shown.map((item) => (
              <tr key={item.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                <td className="px-4 py-2 align-top whitespace-nowrap text-muted-foreground">{item.kind}</td>
                <td className="px-4 py-2 align-top font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                  {item.pageNumber ?? '—'}
                </td>
                <td className="px-4 py-2 align-top whitespace-nowrap">
                  {/* Colour only where it is state: a failed page is the reason
                      to read this table, a done one is the good case, and
                      everything else is quiet. No tint behind any of them. */}
                  <span
                    className={
                      item.status === 'failed'
                        ? 'text-fail'
                        : item.status === 'done'
                          ? 'text-pass'
                          : 'text-muted-foreground'
                    }
                  >
                    {item.status}
                  </span>
                  {item.error ? <div className="mt-0.5 max-w-[240px] text-sm text-fail">{item.error}</div> : null}
                </td>
                <td className="px-4 py-2 align-top">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.url}
                    className="block max-w-[420px] truncate font-mono underline-offset-4 hover:underline"
                  >
                    {item.url}
                  </a>
                </td>
                <td className="px-4 py-2 align-top font-mono text-sm text-muted-foreground">
                  <div className="max-w-[280px] truncate" title={listingValuesLabel(item.listingValues)}>
                    {listingValuesLabel(item.listingValues)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {note ? <p className="border-t border-line px-4 py-2.5 text-sm text-muted-foreground">{note}</p> : null}
    </section>
  );
}
