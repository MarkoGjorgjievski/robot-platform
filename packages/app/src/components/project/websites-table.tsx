import { Link } from '@tanstack/react-router';
import { RunDot } from '../run-dot';
import { Skeleton } from '../ui/skeleton';
import type { VerifiedState, WebsiteView } from '../../lib/websites-view';

/**
 * The project home's table: one row per website, with how far its verification
 * has got, its last run and what that run produced.
 *
 * The name is the link into the website; the rest of the row is data about it.
 * A whole-row link would swallow the hostname and the counts into one enormous
 * target and give a screen reader four unrelated phrases as its name.
 */

/**
 * State as a 2 px rail on the Verified cell, never a wash behind it (spec §4).
 * The label keeps `--text`: colour here says "how far", the words say what, and
 * tinting the text too would make a half-verified website read as a warning.
 */
const RAIL: Record<VerifiedState, string> = {
  all: 'border-pass',
  partial: 'border-warn',
  none: 'border-fail',
  'no-fields': 'border-line',
};

export function WebsitesTable({
  projectSlug,
  websites,
  loading,
}: {
  projectSlug: string;
  websites: WebsiteView[];
  loading: boolean;
}) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      {/* Below `md` the table keeps its real width and the container scrolls
          (spec §3), so the name and its hostname stay readable. */}
      <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
        <table className="w-full min-w-[620px] border-collapse text-base md:min-w-0">
          {/* The name takes what is left; the three measurable columns are
              narrow and hard against the right edge, where the eye compares. */}
          <colgroup>
            <col />
            <col className="w-[160px]" />
            <col className="w-[132px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            {/* Sticky only from `md`: below it the table sits in a horizontal
                scroll container, which is also a vertical scrollport, and a
                sticky head there is pushed down over the first row. */}
            <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
              <th className="px-4 text-left text-sm">Name</th>
              {/* Over the label, not over the rail: 20 px is the cell's 9.75
                  + the rail's 2 + the label's 8.125 (see the cell below). */}
              <th className="pr-3 pl-[20px] text-left text-sm">Verified</th>
              <th className="px-3 text-right text-sm">Last run</th>
              <th className="px-4 text-right text-sm">Rows</th>
            </tr>
          </thead>

          <tbody>
            {loading ? <LoadingRows /> : null}

            {!loading &&
              websites.map((site) => (
                <tr
                  key={site.id}
                  className="border-b border-line transition-colors last:border-0 hover:bg-raised"
                >
                  <td className="max-w-0 px-4 py-2.5">
                    {/* Underlined on hover only: at rest the column is a list of
                        names, and four blue-ish rules down a table would make
                        the link the loudest thing in it. */}
                    <Link
                      to="/projects/$project/sites/$site"
                      params={{ project: projectSlug, site: site.slug }}
                      className="block truncate text-text underline-offset-4 hover:underline"
                    >
                      {site.name}
                    </Link>
                    {/* The address, quiet and in mono under the name: two
                        websites in a project can differ only by subdomain. */}
                    {site.hostname ? (
                      <div className="truncate font-mono text-sm text-muted-foreground">{site.hostname}</div>
                    ) : null}
                    {/* A field that stopped extracting (plan 2026-10-05 Task 3), in warn
                        colour — under the address, never a wash behind the row (spec §4
                        reasoning, same as the Verified rail above). */}
                    {site.driftBadge ? <div className="truncate text-sm text-warn">{site.driftBadge}</div> : null}
                  </td>
                  <td className="py-2.5 pr-3 pl-3 whitespace-nowrap">
                    {/* The rail is on the label, not on the cell: a cell-height
                        rail in every row stacks into one unbroken line down the
                        middle of the table, which reads as a column divider
                        that changes colour rather than as each row's state. */}
                    <span className={`inline-block border-l-2 pl-2.5 ${RAIL[site.verifiedState]}`}>
                      {site.verifiedLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-2">
                      <RunDot status={site.lastRunState} detail={site.lastRunLabel ?? undefined} />
                      <span className="font-mono text-muted-foreground">{site.lastRunLabel ?? '—'}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                    {site.rowsLabel ?? '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Three rows the shape of real ones — two lines in the name cell, so nothing jumps when the data lands. */
function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-line last:border-0">
          <td className="px-4 py-2.5">
            <Skeleton className="h-3.5 w-40 bg-raised" />
            <Skeleton className="mt-1.5 h-3 w-28 bg-raised" />
          </td>
          <td colSpan={3} />
        </tr>
      ))}
    </>
  );
}
