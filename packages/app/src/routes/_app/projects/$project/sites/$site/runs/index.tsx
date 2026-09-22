import { Link, createFileRoute } from '@tanstack/react-router';
import { Button } from '../../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../../components/ui/skeleton';
import { RunsTable } from '../../../../../../../components/runs/runs-table';
import { runsView } from '../../../../../../../lib/runs-view';
import { trpc } from '../../../../../../../lib/trpc';
import { useSite } from '../../$site';

/**
 * Runs: this website's extraction history (Task 6). The layout owns the title
 * and the tabs; this is the table of what happened, newest first.
 *
 * `runs/index.tsx` rather than `runs.tsx`: a single run is a sibling screen, not
 * something drawn inside the list, and a `runs.tsx` beside a `runs/` directory
 * is a *layout* for it — its body would stay on screen above every run page.
 *
 * The list does not poll — a run's own page (Task 7) is where a moving run is
 * watched. Reopening this tab, or the invalidations Extract already fires after
 * a sample or a run starts, are what keep it current.
 */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/runs/')({
  component: RunsTab,
});

function RunsTab() {
  const { project: projectSlug, site: siteSlug } = Route.useParams();
  const site = useSite();
  const source = site.data;

  const runsQuery = trpc.runs.listBySource.useQuery({ sourceId: source?.id ?? '' }, { enabled: !!source });

  if (site.isPending) {
    return (
      <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
        <Skeleton className="h-[22px] w-64 bg-raised" />
        <Skeleton className="mt-3 h-[22px] w-full bg-raised" />
        <Skeleton className="mt-2 h-[22px] w-full bg-raised" />
      </div>
    );
  }
  if (!source) return null; // the layout has already said what went wrong

  const views = runsView(runsQuery.data ?? []);
  const empty = !runsQuery.isPending && !runsQuery.isError && views.length === 0;

  if (runsQuery.isError) {
    return (
      <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
        {/* No cause is named: from here a failure could be the network, the
            api-server or the database. Say what happened and offer the one
            action that can change it. */}
        <p role="alert" className="text-base text-fail">
          Could not load extractions.
        </p>
        <Button variant="outline" onClick={() => void runsQuery.refetch()} disabled={runsQuery.isFetching}>
          {runsQuery.isFetching ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (empty) {
    // An empty table head over nothing is furniture: with no run yet the panel
    // holds one sentence and the way to the tab that starts one, and nothing
    // else.
    return (
      <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
        <p className="text-base text-muted-foreground">No extractions yet. Set up pages on the Extract tab.</p>
        <Button variant="outline" asChild>
          <Link to="/projects/$project/sites/$site/extract" params={{ project: projectSlug, site: siteSlug }}>
            Extract
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <RunsTable projectSlug={projectSlug} siteSlug={siteSlug} runs={views} loading={runsQuery.isPending} />
  );
}
