import { useParams, Link } from '@tanstack/react-router';
import { Database, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function DatasetsList() {
  const { project: projectSlug } = useParams({ from: '/p/$project/datasets' });

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
      <h1 className="mt-2 text-xl font-bold tracking-tight">Datasets</h1>
      <p className="mt-1 text-sm text-gray-600">
        Schemas + the sources that feed them. {datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}.
      </p>

      {datasets.length === 0 ? (
        <EmptyState
          title="No datasets yet"
          description="Datasets group sources by their data shape. They're created during Sandbox source graduation (coming in Phase 4)."
        />
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {datasets.map((d) => (
            <li key={d.id}>
              <Link
                to="/p/$project/datasets/$dataset"
                params={{ project: projectSlug, dataset: d.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
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
      <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
        {projectName}
      </Link>
      <span>/</span>
      <span className="text-gray-700">Datasets</span>
    </div>
  );
}
