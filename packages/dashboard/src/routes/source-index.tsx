import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import SourceOverview from './source-overview';
import SourceSetup from './source-setup';

/**
 * The bare source URL (`/p/$project/sources/$source`): the Set-up workspace
 * by default, until the Source has a completed run — then Overview. Both
 * remain one click away via the tab bar regardless of which one is showing
 * here (source-detail.tsx's "Overview" and "Set up" tabs).
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
  const hasCompletedRun = (runsQuery.data ?? []).some(
    (r) => r.status === 'completed' && r.inputLabel !== 'probe',
  );
  return hasCompletedRun ? <SourceOverview /> : <SourceSetup />;
}
