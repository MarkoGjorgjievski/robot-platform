import { useParams, Link } from '@tanstack/react-router';
import { Database, ArrowRight } from 'lucide-react';
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

  if (statsQuery.isLoading || listQuery.isLoading) return <Spinner label="Loading datasets..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const datasets = listQuery.data ?? [];

  return (
    <div>
      <Breadcrumbs projectSlug={projectSlug} projectName={statsQuery.data.project.name} />
      <div className="mt-2">
        <PageHeader
          title="Datasets"
          description={<>Schemas + the sources that feed them. {datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}.</>}
        />
      </div>

      {datasets.length === 0 ? (
        <EmptyState
          title="No datasets yet"
          description="Datasets group sources by their data shape."
        />
      ) : (
        <ul className="card mt-6 divide-y divide-gray-100">
          {datasets.map((d) => (
            <li key={d.id}>
              <Link
                to="/projects/$project/output"
                params={{ project: projectSlug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60"
              >
                <Database className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  {d.description && (
                    <div className="truncate text-xs text-gray-500">{d.description}</div>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {d.sourceCount} {d.sourceCount === 1 ? 'source' : 'sources'}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Breadcrumbs({ projectSlug, projectName }: { projectSlug: string; projectName: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <Link to="/projects" className="hover:text-gray-700">Projects</Link>
      <span>/</span>
      <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
        {projectName}
      </Link>
      <span>/</span>
      <span className="text-gray-700">Datasets</span>
    </div>
  );
}
