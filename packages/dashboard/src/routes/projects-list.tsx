import { Link } from '@tanstack/react-router';
import { Folder, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';

export default function ProjectsList() {
  const listQuery = trpc.projects.list.useQuery();

  if (listQuery.isLoading) return <Spinner label="Loading projects..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  // Filter out Sandbox project — it has its own UI at /sandbox
  const projects = (listQuery.data ?? []).filter((p) => p.slug !== 'sandbox');

  return (
    <div>
      <PageHeader
        title="Projects"
        description={`Customer engagements. ${projects.length} ${projects.length === 1 ? 'project' : 'projects'}.`}
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Graduate a Sandbox source to create your first project (coming in Phase 4)."
          action={
            <Link to="/sandbox" className="text-sm font-medium text-accent-700 underline-offset-2 hover:underline">
              Go to Sandbox
            </Link>
          }
        />
      ) : (
        <ul className="card mt-6 divide-y divide-gray-100">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to="/p/$project"
                params={{ project: p.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60"
              >
                <Folder className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  {p.description && (
                    <div className="truncate text-xs text-gray-500">{p.description}</div>
                  )}
                </div>
                <span className="text-xs text-gray-400">{p.datasetCount} datasets</span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
