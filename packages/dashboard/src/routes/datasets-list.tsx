import { useParams, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function DatasetsList() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/output' });

  // Need the project id; use getWithStats which also returns the project.
  const statsQuery = trpc.projects.getWithStats.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  const listQuery = trpc.datasets.listByProject.useQuery(
    { projectId: statsQuery.data?.project.id ?? '' },
    { enabled: !!statsQuery.data?.project.id },
  );

  if (statsQuery.isLoading || listQuery.isLoading) return <Spinner label="Loading output..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const datasets = listQuery.data ?? [];

  return (
    <div>
      <Breadcrumbs projectSlug={projectSlug} projectName={statsQuery.data.project.name} />
      <div className="mt-2">
        <PageHeader
          title="Output"
          description="This project has more than one set of columns. Pick the one you want to see."
        />
      </div>

      {datasets.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="Add fields on the project page and the output appears here."
        />
      ) : (
        <table className="sheet mt-6">
          <thead>
            <tr className="sheet-row">
              <th className="sheet-head px-3 py-2 text-left">Name</th>
              <th className="sheet-head px-3 py-2 text-left">Websites</th>
              <th className="sheet-head px-3 py-2 text-left"> </th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <tr key={d.id} className="sheet-row h-8">
                <td className="px-3">
                  <span className="name text-[15px]">{d.name}</span>
                  {d.description && <span className="ml-2 text-xs text-gray-600">{d.description}</span>}
                </td>
                <td className="px-3 font-mono">{d.sourceCount}</td>
                <td className="px-3 text-right">
                  <Link
                    to="/projects/$project/output"
                    params={{ project: projectSlug }}
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

function Breadcrumbs({ projectSlug, projectName }: { projectSlug: string; projectName: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-600">
      <Link to="/projects" className="hover:text-gray-900">Projects</Link>
      <span>/</span>
      <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-900">
        {projectName}
      </Link>
      <span>/</span>
      <span className="text-gray-900">Output</span>
    </div>
  );
}
