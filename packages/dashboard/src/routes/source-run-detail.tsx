import { useEffect, useRef } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { Activity, Download, ExternalLink, ListChecks } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { screenshotUrl } from '../lib/screenshot-url';
import { runExportUrl } from '../lib/export-url';
import { summariseWorkList, listingValuesLabel } from '../lib/work-list';
import {
  progressLabel, isRunActive, runControls, extractButtonLabel, extractButtonTitle, requeueNotice,
} from '../lib/run-progress';
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
        <div className="ml-auto flex items-center gap-2">
          <ExportLink runId={runId} format="csv" />
          <ExportLink runId={runId} format="json" />
        </div>
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
            src={screenshotUrl(capture.screenshotPath) ?? ''}
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

      <ExecuteControls runId={runId} />

      <WorkList runId={runId} />

      <ResultsTable
        data={data}
        confidence={extraction?.confidence ?? null}
        fields={fields}
      />
    </div>
  );
}

/** A plain link, not a fetch — the api-server sets Content-Disposition itself. */
function ExportLink({ runId, format }: { runId: string; format: 'csv' | 'json' }) {
  return (
    <a
      href={runExportUrl(runId, format)}
      download
      className="flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      <Download className="h-3 w-3" />
      {format.toUpperCase()}
    </a>
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

/**
 * Amber is for a run still in motion. It used to branch on `'running'`, which
 * is an ITEM status — `run_items.status` — that a run row never holds, so the
 * one state worth colouring differently never was. The run statuses are
 * planning -> planned -> extracting -> completed | partial | failed, plus
 * cancelling / cancelled.
 */
function RunStatusBadge({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-emerald-100 text-emerald-700'
    : status === 'failed' ? 'bg-red-100 text-red-700'
    : isRunActive(status) || status === 'planning' ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-700';
  return <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${cls}`}>{status}</span>;
}

function ExecuteControls({ runId }: { runId: string }) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.crawl.status.useQuery(
    { runId },
    { refetchInterval: (query) => (isRunActive(query.state.data?.status ?? '') ? 3000 : false) },
  );
  const execute = trpc.crawl.execute.useMutation({
    onSuccess: () => { utils.crawl.invalidate(); utils.runs.invalidate(); },
  });
  const cancel = trpc.crawl.cancel.useMutation({ onSuccess: () => utils.crawl.invalidate() });

  const data = statusQuery.data;
  const active = data ? isRunActive(data.status) : false;

  // The poll above is the only thing telling this page a background crawl
  // settled — the header (`runs.getWithDetails`) and the work list
  // (`crawl.items`) aren't polled, so without this they'd sit stale until a
  // reload. Fire the invalidation once, on the falling edge into "settled",
  // not on every 3s tick: refetching a large work list on each poll of a long
  // crawl is exactly the waste this codebase avoids elsewhere.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (wasActiveRef.current && !active) {
      utils.runs.invalidate();
      utils.crawl.invalidate();
    }
    wasActiveRef.current = active;
  }, [active, utils]);

  if (!data || data.counts.detail === 0) return null;

  // Extract and Retry are offered on their counts alone, never gated on
  // `active` — see runControls. A run stalled at `extracting`/`cancelling`
  // with no loop behind it must stay actionable from this page, which is the
  // only place most operators will ever see it.
  const controls = runControls(data.status, data.counts);

  // What the last execute actually reclaimed. `crawl.execute` returns the
  // count because "Resume N stalled" appears as soon as an item is `running`,
  // while the reclaim behind it only acts past the staleness threshold — so
  // inside that window the click really did launch a browser and really did
  // change nothing, and saying so beats leaving the operator to click again.
  const notice = execute.data && !execute.isPending
    ? requeueNotice(execute.data.requeued, data.counts)
    : null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
      <span className="text-sm font-medium">{progressLabel(data.counts, data.status)}</span>
      <div className="ml-auto flex items-center gap-2">
        {controls.showExtract && (
          <button
            onClick={() => execute.mutate({ runId })}
            disabled={execute.isPending}
            className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title={extractButtonTitle(data.status, data.counts)}
          >
            {extractButtonLabel(data.counts)}
          </button>
        )}
        {controls.showRetry && (
          <button
            onClick={() => execute.mutate({ runId, retryFailed: true })}
            disabled={execute.isPending}
            className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Re-queue the failed items and extract them again"
          >
            Retry {data.counts.failed} failed
          </button>
        )}
        {controls.showStop && (
          <button
            onClick={() => cancel.mutate({ runId })}
            disabled={cancel.isPending}
            className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancel.isPending ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
      {notice && <span className="basis-full text-[11px] text-gray-600">{notice}</span>}
      {execute.isError && <span className="text-[11px] text-red-600">{execute.error.message}</span>}
      {cancel.isError && <span className="text-[11px] text-red-600">{cancel.error.message}</span>}
    </div>
  );
}

/**
 * The work list a plan produced: which listing pages were walked, and which
 * detail URLs each yielded.
 *
 * This is the inspection point the two-phase design exists for — the fan-out is
 * visible here BEFORE phase 2 turns it into requests, so a plan that queued the
 * wrong links (a facet sidebar, a privacy policy) is obvious rather than
 * expensive.
 */
function WorkList({ runId }: { runId: string }) {
  const itemsQuery = trpc.crawl.items.useQuery({ runId });
  const data = itemsQuery.data;
  if (!data || data.items.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3">
        <ListChecks className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-700">Work list</h2>
        <span className="text-xs text-gray-600">{summariseWorkList(data.counts)}</span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Kind</th>
              <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Page</th>
              <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Status</th>
              <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">URL</th>
              <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">From the listing</th>
            </tr>
          </thead>
          <tbody>
            {data.items.slice(0, 200).map((item) => (
              <tr key={item.id} className="border-b last:border-b-0">
                <td className="py-2 pr-4 align-top">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                    item.kind === 'listing' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {item.kind}
                  </span>
                </td>
                <td className="py-2 pr-4 align-top font-mono text-xs text-gray-500">{item.pageNumber ?? '—'}</td>
                <td className="py-2 pr-4 align-top">
                  <span className={`text-xs ${
                    item.status === 'failed' ? 'text-red-600'
                      : item.status === 'done' ? 'text-emerald-700' : 'text-gray-500'
                  }`}>
                    {item.status}
                  </span>
                  {item.error && <div className="max-w-[240px] font-mono text-[10px] text-red-600">{item.error}</div>}
                </td>
                <td className="py-2 pr-4 align-top">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[420px] truncate font-mono text-xs text-gray-700 hover:text-gray-900"
                    title={item.url}
                  >
                    {item.url}
                  </a>
                </td>
                <td className="py-2 pr-4 align-top font-mono text-[11px] text-gray-500">
                  {listingValuesLabel(item.listingValues)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length > 200 && (
          <p className="mt-2 text-xs text-gray-500">Showing 200 of {data.items.length} items</p>
        )}
      </div>
    </div>
  );
}
