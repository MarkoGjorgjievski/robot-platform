import { useParams, Link } from '@tanstack/react-router';
import { Folder, Database, Layers, Activity, Globe } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';

const DEFAULT_ORG_SLUG = 'default';

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
        <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
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
        <div className="mt-6 rounded-md border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Last run</div>
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
    <div className="rounded-md border p-3 transition-colors hover:bg-gray-50">
      <div className="flex items-center gap-2 text-xs text-gray-500">
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

function RunStatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
    : status === 'running' ? 'bg-amber-500 animate-pulse'
    : 'bg-gray-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(diffMs / 3_600_000);
  const d = Math.floor(diffMs / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
