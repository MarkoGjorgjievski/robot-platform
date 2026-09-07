import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import SourceOverview from './source-overview';
import SourceSchema from './source-schema';

/**
 * The bare source URL (`/p/$project/sources/$source`): the Schema workspace
 * by default, until the Source has a completed run — then Overview. Both
 * remain one click away via the tab bar regardless of which one is showing
 * here (source-detail.tsx's "Overview" and "Schema" tabs).
 */
export default function SourceIndex() {
  const { project: projectSlug, source: sourceSlug } = useParams({ from: '/p/$project/sources/$source' });

  const listQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);

  const runsQuery = trpc.runs.listBySource.useQuery(
    { sourceId: source?.id ?? '' },
    { enabled: !!source },
  );

  if (listQuery.isLoading || (source && runsQuery.isLoading)) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  // A completed PROBE run does not count: the whole point of the probe-confirm
  // flow is that sampling a few items is not "this source has data" — the
  // operator still needs to see the Set-up workspace (or the confirm gate on
  // the probe run itself) until a REAL crawl has finished.
  //
  // Finding 8a (final-review-findings.md): a completed BACKFILL run doesn't
  // count either — its rows are deliberately partial (only the target
  // fields were ever asked for), the same reason a backfill run's own
  // coverage UI is hidden (source-run-detail.tsx, Finding 3). Without this,
  // a source whose only "completed" run was a backfill flipped straight to
  // Overview, skipping Set-up even though no real crawl had ever finished.
  const hasCompletedRun = (runsQuery.data ?? []).some(
    (r) => r.status === 'completed' && r.inputLabel !== 'probe' && r.inputLabel !== 'backfill',
  );
  return hasCompletedRun ? <SourceOverview /> : <SourceSchema />;
}
