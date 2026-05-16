import { useParams, Link } from '@tanstack/react-router';
import { Activity, ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { API_URL } from '../lib/api-url';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { ResultsTable } from '../components/results-table';

export default function SourceRunDetail() {
  const { project: projectSlug, source: sourceSlug, run: runId } = useParams({
    from: '/p/$project/sources/$source/runs/$run',
  });

  const detailQuery = trpc.runs.getWithDetails.useQuery({ id: runId });

  if (detailQuery.isLoading) return <Spinner label="Loading run..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Run "${runId}"`} />;

  const { run, source, capture, extraction } = detailQuery.data;
  const data = (Array.isArray(extraction?.data) ? extraction.data : []) as Record<string, unknown>[];
  // Pull field shape from the source's stored selectors if available — best-effort
  const fields = ((source as { selectorsJson?: { fields?: unknown[] } } | null)?.selectorsJson?.fields ?? []) as Array<{ name: string; type: string; enabled?: boolean }>;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">Project</Link>
        <span>/</span>
        <Link to="/p/$project/sources" params={{ project: projectSlug }} className="hover:text-gray-700">Sources</Link>
        <span>/</span>
        <Link to="/p/$project/sources/$source" params={{ project: projectSlug, source: sourceSlug }} className="hover:text-gray-700">
          {source?.name ?? sourceSlug}
        </Link>
        <span>/</span>
        <Link to="/p/$project/sources/$source/runs" params={{ project: projectSlug, source: sourceSlug }} className="hover:text-gray-700">Runs</Link>
        <span>/</span>
        <span className="text-gray-700 font-mono">{runId.slice(0, 8)}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Activity className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-bold tracking-tight">Run · {run.status}</h1>
        <RunStatusBadge status={run.status} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Stat label="Status" value={run.status} />
        <Stat label="Started" value={run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'} />
        <Stat label="Completed" value={run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'} />
        <Stat label="Rows" value={String(run.resultCount ?? 0)} />
      </dl>

      {run.errorMessage && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <div className="text-xs font-medium uppercase">Error</div>
          <div className="mt-1 font-mono">{run.errorMessage}</div>
        </div>
      )}

      {capture?.screenshotPath && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700">Capture screenshot</h2>
          <img
            src={capture.screenshotPath.startsWith('http') ? capture.screenshotPath : `${API_URL}${capture.screenshotPath}`}
            alt="Captured page"
            className="mt-2 w-full max-w-md rounded border"
          />
        </div>
      )}

      {capture?.url && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700">URL</h2>
          <a
            href={capture.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1 font-mono text-xs text-gray-600 hover:text-gray-900"
          >
            {capture.url}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <ResultsTable
        data={data}
        confidence={extraction?.confidence ?? null}
        fields={fields}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-emerald-100 text-emerald-700'
    : status === 'failed' ? 'bg-red-100 text-red-700'
    : status === 'running' ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-700';
  return <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${cls}`}>{status}</span>;
}
