import { useState } from 'react';
import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router';
import { Page } from '../../../../components/page';
import { AddWebsiteDialog } from '../../../../components/project/add-website-dialog';
import { WebsitesTable } from '../../../../components/project/websites-table';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { websitesView } from '../../../../lib/websites-view';
import { useProject } from '../$project';

export const Route = createFileRoute('/_app/projects/$project/')({ component: ProjectHome });

/**
 * The project home: the websites the project collects from, and the way to add
 * one. It is the first screen of the flow, so it is a table from the very first
 * website — the customer's mental model of a project is this list.
 */
function ProjectHome() {
  const { project: slug } = Route.useParams();
  const { session } = useRouteContext({ from: '/_app' });
  const project = useProject();
  const [adding, setAdding] = useState(false);

  const fieldCount = project.data?.fields.length ?? 0;
  const websites = websitesView(project.data?.websites ?? [], fieldCount);
  const empty = !!project.data && websites.length === 0;
  // A slug that is not a project in this org, as opposed to a request that
  // failed: one is a wrong address, the other is something to retry.
  const missing = project.error?.data?.code === 'NOT_FOUND';

  return (
    <Page
      // The title is the thing being loaded, so it waits as a bar rather than
      // as a blank line that reflows the page under it when the name arrives.
      title={
        project.data?.name ??
        (project.isError ? 'Project' : <Skeleton className="h-[20px] w-[180px] bg-raised" />)
      }
      // One "Add website" on screen at a time: while the empty state carries
      // the button, a second identical primary in the title row is a tell.
      actions={
        project.isError || empty ? undefined : <Button onClick={() => setAdding(true)}>Add website</Button>
      }
    >
      {project.isError ? (
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          {missing ? (
            <>
              {/* Not red: a slug that is not a project is a wrong address, not
                  a failure, and the red is what the customer must learn to read
                  as "something broke". Announced all the same. */}
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
                  the api-server, the database or a bug, and telling someone to
                  check a server they may not run is a guess dressed as advice.
                  Say what happened and offer the one action that can change it. */}
              <p role="alert" className="text-base text-fail">
                Could not load the project.
              </p>
              <Button variant="outline" onClick={() => void project.refetch()} disabled={project.isFetching}>
                {project.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </>
          )}
        </div>
      ) : empty ? (
        // An empty table head over nothing is furniture: with no website yet the
        // panel holds one sentence and the way out of it, and nothing else.
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          <p className="text-base text-muted-foreground">
            No websites yet. Add the first one to start collecting {fieldCount > 0 ? 'its fields' : 'data'}.
          </p>
          <Button onClick={() => setAdding(true)}>Add website</Button>
        </div>
      ) : (
        <WebsitesTable websites={websites} loading={project.isPending} />
      )}

      {/* Every row would say "No fields yet" — said once, under the table, with
          the way to fix it, instead of four times inside it. */}
      {!project.isError && !empty && !project.isPending && fieldCount === 0 ? (
        <p className="rise mt-3 text-base text-muted-foreground">
          This project has no fields yet —{' '}
          <Link
            to="/projects/$project/fields"
            params={{ project: slug }}
            className="text-text underline-offset-4 hover:underline"
          >
            add them on the Fields page
          </Link>
          .
        </p>
      ) : null}

      <AddWebsiteDialog projectSlug={slug} open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
