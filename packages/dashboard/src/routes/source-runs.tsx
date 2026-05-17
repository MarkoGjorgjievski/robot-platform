import { useParams, Link } from '@tanstack/react-router';
import { Activity, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { formatDate } from '../lib/format';
import { RunStatusDot } from '../components/run-status-dot';

export default function SourceRuns() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source/runs',
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

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;
  if (runsQuery.isLoading) return <Spinner label="Loading runs..." />;
  if (runsQuery.isError) return <ErrorBanner message={runsQuery.error.message} />;

  const runs = runsQuery.data ?? [];

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Runs ({runs.length})</h2>

      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Each extraction creates a Run row. Click 'Extract' on a graduated source to create the first one."
        />
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                to="/p/$project/sources/$source/runs/$run"
                params={{ project: projectSlug, source: sourceSlug, run: r.id }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <RunStatusDot status={r.status} />
                <Activity className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.status}
                    {r.resultCount != null && ` · ${r.resultCount} rows`}
                  </div>
                  <div className="truncate font-mono text-[11px] text-gray-500">
                    {r.id}
                  </div>
                </div>
                <span className="text-xs text-gray-400">
                  {formatDate(new Date(r.createdAt))}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
