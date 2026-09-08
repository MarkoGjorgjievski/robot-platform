import { useParams, Link } from '@tanstack/react-router';
import { Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function SourcesList() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/sources' });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading sources..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const sources = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          Project
        </Link>
        <span>/</span>
        <span className="text-gray-700">Sources</span>
      </div>
      <div className="mt-2">
        <PageHeader
          title="Sources"
          description={<>All sources in this project. {sources.length} {sources.length === 1 ? 'source' : 'sources'}.</>}
        />
      </div>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Sources appear here once they're created in this project."
        />
      ) : (
        <ul className="card mt-6 divide-y divide-gray-100">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/projects/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.datasetSlug ? `${s.datasetName} · ` : ''}{s.urlTemplate}
                  </div>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-gray-600">
                  {s.inputStrategy ?? 'unknown'}
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
