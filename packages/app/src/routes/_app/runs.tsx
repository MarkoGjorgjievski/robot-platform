import { Link, createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { OrgRunsTable } from '../../components/runs/org-runs-table';
import { anyRunning, orgRunsView } from '../../lib/org-runs-view';
import { trpc } from '../../lib/trpc';
import { useUnauthorizedRedirect } from '../../lib/use-unauthorized-redirect';

export const Route = createFileRoute('/_app/runs')({
  component: RunsPage,
});

/** How often the table asks again while a run is moving. Nothing polls once every dot is still. */
const RUNNING_POLL_MS = 5_000;

function RunsPage() {
  const runs = trpc.runs.listByOrg.useQuery(undefined, {
    // The stop condition is the rows themselves: a page with nothing running
    // is a static page, and refetching it every five seconds would keep the
    // api-server busy for nobody.
    refetchInterval: (query) => (anyRunning(orgRunsView(query.state.data ?? [])) ? RUNNING_POLL_MS : false),
  });
  const rows = orgRunsView(runs.data ?? []);
  const unauthorized = useUnauthorizedRedirect(runs);

  const empty = !runs.isPending && !runs.isError && rows.length === 0;
  const showTable = runs.isPending || rows.length > 0;

  return (
    <Page title="Runs">
      {showTable ? <OrgRunsTable runs={rows} loading={runs.isPending} /> : null}

      {empty ? (
        <div className="rise rounded-[6px] border border-line bg-panel px-4 py-10 text-center [box-shadow:var(--shadow)]">
          <p className="text-base text-muted-foreground">
            No runs yet. Start one from a website's Extract tab —{' '}
            <Link to="/projects" className="text-text underline-offset-4 hover:underline">
              your projects
            </Link>
            .
          </p>
        </div>
      ) : null}

      {runs.isError && !unauthorized ? (
        <p role="alert" className="rise text-base text-fail">
          The runs could not be loaded. Try again.
        </p>
      ) : null}
    </Page>
  );
}
