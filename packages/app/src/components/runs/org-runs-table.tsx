import { Link } from '@tanstack/react-router';
import { RunDot } from '../run-dot';
import { Skeleton } from '../ui/skeleton';
import type { OrgRunView } from '../../lib/org-runs-view';

/**
 * Every run in the organisation (spec §5 `/runs`): the website's Runs table
 * with the project and website columns the website page does not need. The
 * dot is here too — this is the screen the spec names for "is anything
 * running", so the pulse must be the first thing in each row after its age.
 */
export function OrgRunsTable({ runs, loading }: { runs: OrgRunView[]; loading: boolean }) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      {/* Below `md` the table keeps its real width and the container scrolls (spec §3). */}
      <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
        <table className="w-full min-w-[760px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col className="w-[132px]" />
            <col className="w-[176px]" />
            <col />
            <col />
            <col className="w-[104px]" />
            <col className="w-[116px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
              <th className="px-4 text-left text-sm">Started</th>
              <th className="px-3 text-left text-sm">Status</th>
              <th className="px-3 text-left text-sm">Project</th>
              <th className="px-3 text-left text-sm">Website</th>
              <th className="px-3 text-right text-sm">Rows</th>
              <th className="px-4 text-right text-sm">Duration</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <LoadingRows /> : null}
            {!loading &&
              runs.map((run) => (
                <tr key={run.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Link
                      to="/projects/$project/sites/$site/runs/$run"
                      params={{ project: run.projectSlug, site: run.websiteSlug, run: run.id }}
                      className="font-mono text-text underline-offset-4 hover:underline"
                    >
                      {run.startedLabel}
                    </Link>
                    {run.error ? <div className="mt-0.5 text-sm text-fail">{run.error}</div> : null}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <RunDot status={run.state} detail={run.startedLabel} />
                      {run.statusLabel}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2.5">
                    <Link to="/projects/$project" params={{ project: run.projectSlug }} className="hover:underline underline-offset-4">
                      {run.projectName}
                    </Link>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2.5">
                    <Link
                      to="/projects/$project/sites/$site"
                      params={{ project: run.projectSlug, site: run.websiteSlug }}
                      className="hover:underline underline-offset-4"
                    >
                      {run.websiteName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                    {run.rowsLabel ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                    {run.durationLabel ?? '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-line last:border-0">
          <td className="px-4 py-2.5">
            <Skeleton className="h-3.5 w-20 bg-raised" />
          </td>
          <td colSpan={5} />
        </tr>
      ))}
    </>
  );
}
