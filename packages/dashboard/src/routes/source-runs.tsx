import { useParams, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { formatDate } from '../lib/format';
import { RunStatusDot } from '../components/run-status-dot';

export default function SourceRuns() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/projects/$project/sources/$source/runs',
  });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);

  const runsQuery = trpc.runs.listBySource.useQuery(
    { sourceId: source?.id ?? '' },
    { enabled: !!source?.id },
  );

  if (listQuery.isLoading) return <Spinner label="Loading website..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Website "${sourceSlug}"`} />;
  if (runsQuery.isLoading) return <Spinner label="Loading extractions..." />;
  if (runsQuery.isError) return <ErrorBanner message={runsQuery.error.message} />;

  const runs = runsQuery.data ?? [];
  // Extraction starts on the Extract tab (spec 5.7), which asks for the pages
  // and the budget first. This tab is the history of what that started, so the
  // only thing to offer here is the way over to it — no second, differently
  // worded entry point into the same machinery.
  const extractLink = (
    <Link
      to="/projects/$project/sources/$source/extract"
      params={{ project: projectSlug, source: sourceSlug }}
      className="btn-primary h-9"
    >
      Go to Extract
    </Link>
  );

  return (
    <div className="mt-6">
      <div>
        <h2 className="name text-lg">Runs</h2>
        <p className="label-soft mt-0.5">Every extraction this website has run.</p>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          title="No extractions yet"
          description="Extract to see runs here."
          action={extractLink}
        />
      ) : (
        <table className="sheet mt-4">
          <thead>
            <tr className="sheet-row">
              <th className="sheet-head px-3 py-2 text-left">Started</th>
              <th className="sheet-head px-3 py-2 text-left">Status</th>
              <th className="sheet-head px-3 py-2 text-left">Items</th>
              <th className="sheet-head px-3 py-2 text-left"> </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="sheet-row h-8">
                <td className="px-3 font-mono text-gray-600">{formatDate(new Date(r.createdAt))}</td>
                <td className="px-3">
                  <span className="inline-flex items-center gap-2">
                    <RunStatusDot status={r.status} />
                    {r.status}
                    {/* Finding 8a (final-review-findings.md): a backfill run used
                        to render indistinguishably from an ordinary crawl — a
                        quiet second fact so "Items" and status here are read in
                        context (a backfill's rows are deliberately partial). */}
                    {r.inputLabel === 'backfill' && <span className="text-xs text-gray-600">backfill</span>}
                  </span>
                </td>
                <td className="px-3 font-mono">{r.resultCount ?? '—'}</td>
                <td className="px-3 text-right">
                  <Link
                    to="/projects/$project/sources/$source/runs/$run"
                    params={{ project: projectSlug, source: sourceSlug, run: r.id }}
                    className="text-xs text-accent-700 underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
