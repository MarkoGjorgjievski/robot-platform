import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router';
import { Page } from '../../../../components/page';
import { OutputTable } from '../../../../components/output/output-table';
import { Button, buttonVariants } from '../../../../components/ui/button';
import { outputView } from '../../../../lib/output-view';
import { exportUrl, trpc } from '../../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../../lib/use-unauthorized-redirect';

export const Route = createFileRoute('/_app/projects/$project/output')({ component: OutputScreen });

/**
 * Output: what the project has collected, and the file of it.
 *
 * Its own query rather than `useProject()` — this is the whole sheet, capped at
 * 500 rows for the browser, and putting it under the cache key the breadcrumb
 * and the sidebar share would make every screen in the project carry it.
 */
function OutputScreen() {
  const { project: slug } = Route.useParams();
  const { session } = useRouteContext({ from: '/_app' });
  const output = trpc.projects.output.useQuery({ projectSlug: slug });
  // An ended session is a trip to /login, not a Retry button that can only fail
  // again; nothing is drawn while that navigation is in flight.
  const unauthorized = useUnauthorizedRedirect(output);

  const view = outputView({
    fields: output.data?.fields ?? [],
    rows: output.data?.rows ?? [],
    rowCount: output.data?.rowCount ?? 0,
    websites: output.data?.websites ?? [],
  });
  // A slug that is not a project in this org, as opposed to a request that
  // failed: one is a wrong address, the other is something to retry.
  const missing = output.error?.data?.code === 'NOT_FOUND';
  // The file is the api-server's, by the project's id — so there is nothing to
  // download until the query has said which project, and whether it has rows.
  const file = output.data && output.data.rowCount > 0 ? output.data.project.id : null;

  if (unauthorized) return null;

  return (
    <Page
      title="Output"
      actions={
        output.isError ? undefined : (
          <>
            {/* Real anchors when there is a file: the api-server serves the
                export as a download, and an anchor is what a browser can open
                in a new tab, copy the address of and reach by keyboard. With no
                rows they are buttons instead — a disabled anchor is not a
                thing, and `pointer-events: none` on one leaves it in the tab
                order pointing at an empty file. */}
            {file ? (
              <>
                <a className={buttonVariants({ variant: 'outline' })} href={exportUrl('projects', file, 'csv')} download>
                  Download CSV
                </a>
                <a className={buttonVariants({ variant: 'outline' })} href={exportUrl('projects', file, 'json')} download>
                  Download JSON
                </a>
              </>
            ) : (
              <>
                <Button variant="outline" disabled>
                  Download CSV
                </Button>
                <Button variant="outline" disabled>
                  Download JSON
                </Button>
              </>
            )}
          </>
        )
      }
    >
      {output.isError ? (
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          {missing ? (
            <>
              {/* Not red: a slug that is not a project is a wrong address, not
                  a failure. Announced all the same. */}
              <p role="alert" className="text-base">
                This project does not exist in {session.currentOrg.name}.
              </p>
              <Button variant="outline" asChild>
                <Link to="/projects">All projects</Link>
              </Button>
            </>
          ) : (
            <>
              {/* No cause is named: from here a failure could be the network,
                  the api-server, the database or a bug. Say what happened and
                  offer the one action that can change it. */}
              <p role="alert" className="text-base text-fail">
                Could not load the output.
              </p>
              <Button variant="outline" onClick={() => void output.refetch()} disabled={output.isFetching}>
                {output.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <OutputTable view={view} loading={output.isPending} />
      )}
    </Page>
  );
}
