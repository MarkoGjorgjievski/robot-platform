import { useParams, Link } from '@tanstack/react-router';
import { Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function SourcesList() {
  const { project: projectSlug } = useParams({ from: '/p/$project/sources' });

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
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          Project
        </Link>
        <span>/</span>
        <span className="text-gray-700">Sources</span>
      </div>
      <h1 className="mt-2 text-xl font-bold tracking-tight">Sources</h1>
      <p className="mt-1 text-sm text-gray-600">
        All sources in this project. {sources.length} {sources.length === 1 ? 'source' : 'sources'}.
      </p>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Sources appear here when they're graduated from Sandbox or created in a Dataset (coming in Phase 3b/4)."
        />
      ) : (
        <ul className="mt-6 divide-y rounded-md border">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.datasetSlug ? `${s.datasetName} · ` : ''}{s.urlTemplate}
                  </div>
                </div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-600">
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
