import { useParams, Link } from '@tanstack/react-router';
import { Activity, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { formatDate } from '../lib/format';
import { RunStatusDot } from '../components/run-status-dot';
import { summariseWorkList, planCrawlLabel } from '../lib/work-list';

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
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-gray-900">Runs ({runs.length})</h2>
        <div className="ml-auto">
          <PlanCrawlButton sourceId={source.id} listingMode={source.listingMode} />
        </div>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Each extraction creates a Run row. Confirm this source's schema to kick off the first one."
        />
      ) : (
        <ul className="card mt-4 divide-y divide-gray-100">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                to="/p/$project/sources/$source/runs/$run"
                params={{ project: projectSlug, source: sourceSlug, run: r.id }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60"
              >
                <RunStatusDot status={r.status} />
                <Activity className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.status}
                    {r.resultCount != null && ` · ${r.resultCount} rows`}
                    {/* Finding 8a (final-review-findings.md): a backfill run
                        used to render indistinguishably from an ordinary
                        crawl — a quiet chip so "Rows" and status here are
                        read in context (a backfill's rows are deliberately
                        partial), without competing with the row's own
                        status text. */}
                    {r.inputLabel === 'backfill' && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 align-middle font-mono text-[10px] font-medium uppercase tracking-wide text-gray-500">
                        backfill
                      </span>
                    )}
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

/**
 * Plans a crawl: walks the listing pages and enumerates the detail URLs, without
 * fetching a single one of them.
 *
 * The button says "Plan", not "Run", because that distinction is the whole point
 * of the two-phase design — a human sees the fan-out before it becomes hundreds
 * of requests against a site.
 */
function PlanCrawlButton({ sourceId, listingMode }: { sourceId: string; listingMode: string | null }) {
  const utils = trpc.useUtils();
  const plan = trpc.crawl.plan.useMutation({
    onSuccess: () => utils.runs.invalidate(),
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => plan.mutate({ sourceId })}
        disabled={plan.isPending}
        className="btn-quiet disabled:opacity-50"
        title={
          listingMode === 'listing_to_detail'
            ? 'Walk the listing pages and enumerate detail URLs. Fetches no detail pages.'
            : 'Queue one work item per input row. Fetches nothing.'
        }
      >
        {planCrawlLabel(plan.isPending)}
      </button>
      {plan.isPending && (
        <span className="text-[11px] text-gray-500">Fetching listing pages — this takes a minute.</span>
      )}
      {plan.isError && <span className="max-w-xs text-right text-[11px] text-red-600">{plan.error.message}</span>}
      {plan.data && (
        <span className="text-[11px] text-gray-600">
          {summariseWorkList({
            listing: plan.data.listingPages,
            detail: plan.data.itemCount,
            pending: plan.data.itemCount,
            done: plan.data.listingPages,
            failed: 0,
          })}
        </span>
      )}
      {plan.data?.warnings.map((w) => (
        <span key={w} className="max-w-xs text-right text-[11px] text-amber-700">{w}</span>
      ))}
    </div>
  );
}
