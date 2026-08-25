import { useParams, Link } from '@tanstack/react-router';
import { Folder, Database, Layers, Activity, Globe } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { formatDate } from '../lib/format';
import { RunStatusDot } from '../components/run-status-dot';

export default function ProjectHome() {
  const { project: projectSlug } = useParams({ from: '/p/$project' });
  const statsQuery = trpc.projects.getWithStats.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (statsQuery.isLoading) return <Spinner label="Loading project..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;

  const { project, datasetCount, sourceCount, runCount, lastRun } = statsQuery.data;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Folder className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
      </div>
      {project.description && (
        <p className="mt-1 text-sm text-gray-600">{project.description}</p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<Database className="h-4 w-4" />} label="Datasets" value={datasetCount} link={{ to: '/p/$project/datasets', params: { project: projectSlug } }} />
        <StatCard icon={<Layers className="h-4 w-4" />} label="Sources" value={sourceCount} link={{ to: '/p/$project/sources', params: { project: projectSlug } }} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Runs" value={runCount} />
        <StatCard icon={<Globe className="h-4 w-4" />} label="Domains" link={{ to: '/p/$project/domains', params: { project: projectSlug } }} />
      </div>

      {lastRun ? (
        <div className="card mt-6 p-4">
          <div className="micro-label">Last run</div>
          <Link
            to="/p/$project/sources/$source/runs/$run"
            params={{ project: projectSlug, source: lastRun.sourceSlug ?? '', run: lastRun.id }}
            className="mt-1 flex items-center gap-2 text-sm hover:underline"
          >
            <RunStatusDot status={lastRun.status} />
            <span className="font-medium">{lastRun.status}</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-500">{lastRun.resultCount ?? 0} rows</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-400">{formatDate(new Date(lastRun.createdAt))}</span>
          </Link>
        </div>
      ) : (
        <EmptyState
          title="No activity yet"
          description="Datasets, sources, and runs will appear here once they're created."
        />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  link,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  link?: { to: string; params: Record<string, string> };
}) {
  const content = (
    <div className="card p-3 transition-colors hover:bg-gray-50/60">
      <div className="micro-label flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      {value !== undefined && (
        <div className="mt-1 text-xl font-semibold">{value}</div>
      )}
    </div>
  );
  if (link) {
    return <Link to={link.to as never} params={link.params as never}>{content}</Link>;
  }
  return content;
}
