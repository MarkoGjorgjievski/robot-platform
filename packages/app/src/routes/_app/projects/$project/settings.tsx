import type { ReactNode } from 'react';
import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router';
import { Page } from '../../../../components/page';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Button } from '../../../../components/ui/button';
import { ProjectInlineRename } from '../../../../components/site/inline-rename';
import { useUnauthorizedRedirect } from '../../../../lib/use-unauthorized-redirect';
import { useProject } from '../$project';

export const Route = createFileRoute('/_app/projects/$project/settings')({ component: SettingsScreen });

/**
 * Settings: the project's own options (cut-over Task 1) — for now, just its
 * name. The same definition-list panel the website's Settings tab draws
 * (`SettingsRows`), with `ProjectInlineRename` standing in for `InlineRename`.
 */
function SettingsScreen() {
  const { session } = useRouteContext({ from: '/_app' });
  const project = useProject();
  // An ended session is a trip to /login, not a Retry button that can only fail
  // again; nothing is drawn while that navigation is in flight.
  const unauthorized = useUnauthorizedRedirect(project);
  // A slug that is not a project in this org, as opposed to a request that
  // failed: one is a wrong address, the other is something to retry.
  const missing = project.error?.data?.code === 'NOT_FOUND';

  if (unauthorized) return null;

  return (
    <Page title="Settings">
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
      ) : project.data ? (
        <dl className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
          <Row label="Name">
            <ProjectInlineRename
              projectId={project.data.id}
              orgSlug={session.currentOrg.slug}
              name={project.data.name}
              ariaLabel="Name"
              size="row"
            />
          </Row>
        </dl>
      ) : (
        <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
          <Skeleton className="h-[22px] w-64 bg-raised" />
        </div>
      )}
    </Page>
  );
}

/** One row of the definition list: a quiet label on the left, the control on the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0 sm:items-center">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
