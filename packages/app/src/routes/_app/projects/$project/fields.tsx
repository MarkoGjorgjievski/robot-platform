import { useState } from 'react';
import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router';
import { Page } from '../../../../components/page';
import { AddCustomFieldDialog } from '../../../../components/fields/add-custom-field-dialog';
import { FieldCatalogue } from '../../../../components/fields/field-catalogue';
import { FieldsTable } from '../../../../components/fields/fields-table';
import { Button } from '../../../../components/ui/button';
import { fieldsView } from '../../../../lib/fields-view';
import { trpc } from '../../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../../lib/use-unauthorized-redirect';
import { useProject } from '../$project';

export const Route = createFileRoute('/_app/projects/$project/fields')({ component: FieldsScreen });

/**
 * Fields: the list of things the project collects, and the catalogue to fill it
 * from. The two panels sit side by side from `lg` — picking from the catalogue
 * and watching the list grow is one motion, and a customer who has to scroll
 * between them loses the thread of what they have already chosen.
 *
 * The contract comes from `useProject()` rather than from its own query: the
 * breadcrumb, the sidebar and the project home already hold it under that one
 * cache key, so every change here invalidates one thing and all four follow.
 */
function FieldsScreen() {
  const { session } = useRouteContext({ from: '/_app' });
  const project = useProject();
  const [adding, setAdding] = useState(false);
  // An ended session is a trip to /login, not a Retry button that can only fail
  // again; nothing is drawn while that navigation is in flight.
  const unauthorized = useUnauthorizedRedirect(project);

  const datasetId = project.data?.datasetId ?? null;
  const websiteCount = project.data?.websites.length ?? 0;

  const status = trpc.datasets.fieldStatus.useQuery(
    { datasetId: datasetId ?? '' },
    { enabled: !!datasetId },
  );

  const fields = fieldsView(project.data?.fields ?? [], status.data, websiteCount);
  // A slug that is not a project in this org, as opposed to a request that
  // failed: one is a wrong address, the other is something to retry.
  const missing = project.error?.data?.code === 'NOT_FOUND';
  const empty = !!project.data && fields.length === 0;

  if (unauthorized) return null;

  return (
    <Page
      title="Fields"
      actions={
        project.isError || !datasetId ? undefined : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            Add your own
          </Button>
        )
      }
    >
      {project.isError ? (
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
                Could not load the project.
              </p>
              <Button variant="outline" onClick={() => void project.refetch()} disabled={project.isFetching}>
                {project.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </>
          )}
        </div>
      ) : project.data && !datasetId ? (
        // A project made before the contract existed. There is nothing to edit
        // and nothing to add to, so the screen says only that.
        <p className="rise text-base text-muted-foreground">This project has no field list yet.</p>
      ) : (
        // `items-start` so the shorter panel keeps its own height: a catalogue
        // stretched to match a long field list would be a box of empty panel.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          {empty ? (
            // An empty table head over nothing is furniture: with no field yet
            // the panel holds one sentence, and the catalogue beside it is the
            // way out of the state.
            <div className="rise rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
              <p className="text-base text-muted-foreground">
                No fields yet. Pick them from the catalogue, or add your own.
              </p>
            </div>
          ) : (
            <FieldsTable
              // Empty only while the project is still loading, and then the
              // table holds skeleton rows: there is nothing to rename, retype
              // or delete until `datasetId` is real.
              datasetId={datasetId ?? ''}
              fields={fields}
              websiteCount={websiteCount}
              loading={project.isPending}
            />
          )}

          {datasetId ? (
            <FieldCatalogue
              datasetId={datasetId}
              existingNames={fields.map((f) => f.name)}
              websiteCount={websiteCount}
              onAddYourOwn={() => setAdding(true)}
            />
          ) : null}
        </div>
      )}

      {datasetId ? (
        <AddCustomFieldDialog
          datasetId={datasetId}
          websiteCount={websiteCount}
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}
    </Page>
  );
}
