import { useParams, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { formatDate } from '../lib/format';
import { RunStatusDot } from '../components/run-status-dot';
import { summariseWorkList, planCrawlLabel } from '../lib/work-list';

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
  // One Plan crawl button, never two: with no runs it is the empty state's
  // action, otherwise it sits in the header.
  const planButton = <PlanCrawlButton sourceId={source.id} listingMode={source.listingMode} />;

  return (
    <div className="mt-6">
      <div className="flex items-start gap-3">
        <div>
          <h2 className="name text-lg">Runs</h2>
          <p className="label-soft mt-0.5">Every extraction this website has run.</p>
        </div>
        {runs.length > 0 && <div className="ml-auto">{planButton}</div>}
      </div>

      {runs.length === 0 ? (
        <EmptyState
          title="No extractions yet"
          description="Plan a crawl to enumerate the pages, then extract them."
          action={planButton}
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
        className="btn-quiet"
        title={
          listingMode === 'listing_to_detail'
            ? 'Walk the listing pages and enumerate detail URLs. Fetches no detail pages.'
            : 'Queue one work item per input row. Fetches nothing.'
        }
      >
        {planCrawlLabel(plan.isPending)}
      </button>
      {plan.isPending && (
        <span className="text-[11px] text-gray-600">Fetching listing pages — this takes a minute.</span>
      )}
      {plan.isError && <span className="max-w-xs text-right text-[11px] text-fail">{plan.error.message}</span>}
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
        <span key={w} className="max-w-xs text-right text-[11px] text-warn">{w}</span>
      ))}
    </div>
  );
}
