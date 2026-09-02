import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import {
  Activity, Download, ExternalLink, ListChecks, HelpCircle, CheckCircle2, Loader2,
} from 'lucide-react';
import { trpc } from '../lib/trpc';
import { runExportUrl } from '../lib/export-url';
import { summariseWorkList, listingValuesLabel } from '../lib/work-list';
import {
  progressLabel, isRunActive, runControls, extractButtonLabel, extractButtonTitle, requeueNotice,
} from '../lib/run-progress';
import { probeEvidence } from '../lib/probe-evidence';
import { parseRunLog } from '../lib/parse-run-log';
import { diagnoseRun, type Diagnosis } from '../lib/diagnose-run';
import {
  rowsMissingField, selectionToItemIds, reExtractLabel, emptyFilterNote,
  type ItemGap, type FieldCoverage,
} from '../lib/coverage-view';
import {
  previewSummary, strategyCopy, initialChecked, checkedHasDeadField, backfillMutationInput,
  type FieldClassification,
} from '../lib/backfill-preview';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { ResultsTable } from '../components/results-table';
import { AddFieldsControl } from '../components/add-fields-control';

// Mirrors `DETAIL_URL_FIELD` in packages/api/src/crawl/effective-schema.ts
// (re-exported from @robot/scraper). Not imported directly — the dashboard
// only depends on @robot/api, which doesn't re-export it.
const DETAIL_URL_FIELD = 'detail_url';

export default function SourceRunDetail() {
  const { project: projectSlug, source: sourceSlug, run: runId } = useParams({
    from: '/p/$project/sources/$source/runs/$run',
  });

  const detailQuery = trpc.runs.getWithDetails.useQuery({ id: runId });

  // Pre-return derivations. `detailQuery.data` is read directly (never
  // aliased to a separate const) so each narrowing check below applies where
  // it's used — an aliased const wouldn't be narrowed by the early-return
  // checks further down, since those check `detailQuery.data`, a different
  // binding from the same runtime value.
  const rawExtractionData = detailQuery.data?.extraction?.data;
  const data = Array.isArray(rawExtractionData) ? (rawExtractionData as Record<string, unknown>[]) : [];
  const runIsTerminal = detailQuery.data ? !isRunActive(detailQuery.data.run.status) : false;
  // The confirm gate owns the sample rows while it's showing (brief: evidence
  // summary, THEN the sample extracted rows, THEN the gate — all above the
  // work list). A single ResultsTable instance, relocated, not duplicated —
  // this must exactly match ProbeConfirmGate's own render condition below, or
  // the rows vanish from both places or appear in both. Computed here
  // (pre-return) because the coverage query's `enabled` needs it too.
  const probeGateShowing = detailQuery.data
    ? detailQuery.data.run.inputLabel === 'probe' && !detailQuery.data.source?.confirmedAt
    : false;
  // Finding 3 (final-review-findings.md): a backfill run's own audit rows
  // are deliberately partial — only the target fields were ever asked for,
  // so every other field reads "dead" in a coverage report that means
  // nothing here. Computed pre-return (same reasoning as probeGateShowing
  // above) because the coverage query's `enabled` needs it too, and reused
  // below instead of re-deriving from `run.inputLabel` a second time.
  const isBackfillRun = detailQuery.data ? detailQuery.data.run.inputLabel === 'backfill' : false;

  // Coverage is read-only and AI-free, but only means anything once the run
  // has stopped moving (a still-executing run's gaps are still closing under
  // it), once the probe gate isn't the only actionable control on the page
  // (see ProbeConfirmGate's doc comment), and never for a backfill run's own
  // deliberately-partial rows (Finding 3) — no fill badges or re-extract
  // button belong on any of those. `data.length > 0` skips the query on a
  // plan with nothing extracted yet, where a coverage report is pure
  // zero-noise.
  const coverageQuery = trpc.crawl.coverage.useQuery(
    { runId },
    { enabled: runIsTerminal && !probeGateShowing && !isBackfillRun && data.length > 0 },
  );

  // Filter (which field to show gaps for) and selection (which rows to
  // re-extract) — route-owned state, reset whenever the run identity changes
  // so a stale filter/selection can't survive a navigation to a different
  // run's page (including the navigation a successful backfill itself does).
  const [filterField, setFilterField] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  useEffect(() => {
    setFilterField(null);
    setSelectedUrls(new Set());
  }, [runId]);

  const gapByUrl = useMemo(
    () => new Map((coverageQuery.data?.gapItems ?? []).map((g) => [g.url, g] as const)),
    [coverageQuery.data],
  );

  // The work list's own query — WorkList (below) fetches the identical
  // input, so this is a cache hit there, not a second network round-trip.
  // Built here so ResultsTable can render confirmed-absent cells as "not on
  // page" instead of a plain blank (cellState, coverage-view.ts).
  const itemsQuery = trpc.crawl.items.useQuery({ runId });
  const absentByUrl = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of itemsQuery.data?.items ?? []) {
      const absent = Array.isArray(item.absentFields) ? (item.absentFields as string[]) : [];
      if (absent.length > 0) map.set(item.url, new Set(absent));
    }
    return map;
  }, [itemsQuery.data]);
  const missingRows = filterField ? rowsMissingField(data, filterField, gapByUrl) : [];
  const filteredData = filterField ? missingRows : data;

  const toggleRow = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  };
  // Every filter transition — picking a field, toggling it off, or an
  // explicit clear — invalidates whatever was selected under the OLD filter:
  // a selection made while viewing "missing X" must not silently carry into
  // "missing Y" or into no filter at all, where the Re-extract button would
  // fire against urls the operator never picked under the filter they're
  // looking at now.
  const toggleFilterField = (name: string) => {
    setFilterField((prev) => (prev === name ? null : name));
    setSelectedUrls(new Set());
  };
  const clearFilter = () => {
    setFilterField(null);
    setSelectedUrls(new Set());
  };
  const selectAllMissing = () => {
    // Matches ResultsTable's own `slice(0, 100)` — selection interacts with
    // rows ON SCREEN only; the filter is what narrows the total first.
    setSelectedUrls(new Set(
      missingRows.slice(0, 100)
        .map((r) => r._url)
        .filter((u): u is string => typeof u === 'string'),
    ));
  };

  if (detailQuery.isLoading) return <Spinner label="Loading run..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Run "${runId}"`} />;

  const { run, source, capture, extraction, backfillRuns } = detailQuery.data;
  const targetFields = Array.isArray(run.targetFields) ? (run.targetFields as string[]) : [];
  // Pull field shape from the source's stored selectors if available — best-effort.
  // `DETAIL_URL_FIELD` (packages/api/src/crawl/effective-schema.ts) is the
  // synthetic row-scoped "which detail page" field `sources.analyze` persists
  // into `selectorsJson.fields` verbatim for the discovery report — it is
  // filtered out of the server's effective schema but round-trips into this
  // raw read, so it must be excluded here too or it renders as a dead
  // always-"—" column.
  const fields = ((source as { selectorsJson?: { fields?: unknown[] } } | null)?.selectorsJson?.fields ?? []) as Array<{ name: string; type: string; enabled?: boolean }>;
  const resultsTable = (
    <ResultsTable
      data={filteredData}
      confidence={extraction?.confidence ?? null}
      fields={fields.filter((f) => f.name !== DETAIL_URL_FIELD)}
      coverage={coverageQuery.data?.fields}
      absentByUrl={absentByUrl}
      // Finding 3: a backfill run's own coverage is deliberately partial and
      // must never drive selection/re-extract — coverageQuery is already
      // disabled for one above, so `!!coverageQuery.data` alone would settle
      // to false here too, but the explicit `!isBackfillRun` says so without
      // relying on that indirection.
      selectable={!!coverageQuery.data && !isBackfillRun}
      selectedUrls={selectedUrls}
      onToggleRow={toggleRow}
      onFilterField={toggleFilterField}
    />
  );

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

      <div className="mt-3 flex items-center gap-3">
        <Activity className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-semibold tracking-tight">
          Run <span className="font-mono text-lg text-gray-500">{runId.slice(0, 8)}</span>
        </h1>
        <RunStatusBadge status={run.status} />
        <div className="ml-auto flex items-center gap-2">
          <ExportLink runId={runId} format="csv" />
          <ExportLink runId={runId} format="json" />
        </div>
      </div>

      {run.parentRunId && (
        <p className="mt-1 text-xs text-gray-500">
          Backfill of run{' '}
          <Link
            to="/p/$project/sources/$source/runs/$run"
            params={{ project: projectSlug, source: sourceSlug, run: run.parentRunId }}
            className="font-mono text-accent-700 hover:underline"
          >
            {run.parentRunId.slice(0, 8)}
          </Link>
          {targetFields.length > 0 && <> · fields: {targetFields.join(', ')}</>}
        </p>
      )}

      {backfillRuns.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          Backfilled by{' '}
          {backfillRuns.map((b, i) => (
            <span key={b.id}>
              {i > 0 && ', '}
              <Link
                to="/p/$project/sources/$source/runs/$run"
                params={{ project: projectSlug, source: sourceSlug, run: b.id }}
                className="font-mono text-accent-700 hover:underline"
              >
                run {b.id.slice(0, 8)}
              </Link>
              {' '}({b.status})
            </span>
          ))}
        </p>
      )}

      <dl className="card mt-6 grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-4">
        <Stat label="Status" value={run.status} />
        <Stat label="Started" value={run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'} />
        <Stat label="Completed" value={run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'} />
        <Stat label="Rows" value={String(run.resultCount ?? 0)} />
      </dl>

      {run.errorMessage && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
          <div className="micro-label text-red-600">Error</div>
          <div className="mt-1 font-mono text-red-800">{run.errorMessage}</div>
        </div>
      )}

      {capture?.url && (
        <div className="mt-8">
          <h2 className="micro-label">URL</h2>
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

      <ExecuteControls runId={runId} probeUnconfirmed={probeGateShowing} backfill={isBackfillRun} />

      {/* Finding 3: gated on !isBackfillRun, same as BackfillGapsPanel below
          — a backfill run's own coverage is deliberately partial and this
          bar's selection/re-extract must never act on it. */}
      {!isBackfillRun && (
        <CoverageActionBar
          runId={runId}
          projectSlug={projectSlug}
          sourceSlug={sourceSlug}
          filterField={filterField}
          missingCount={missingRows.length}
          onClearFilter={clearFilter}
          selectedUrls={selectedUrls}
          onSelectAll={selectAllMissing}
          gapByUrl={gapByUrl}
          coverage={coverageQuery.data?.fields}
        />
      )}

      {runIsTerminal && !probeGateShowing && !isBackfillRun && (
        <BackfillGapsPanel
          key={runId}
          runId={runId}
          projectSlug={projectSlug}
          sourceSlug={sourceSlug}
          gappyFieldNames={(coverageQuery.data?.fields ?? []).filter((f) => f.missing > 0).map((f) => f.name)}
        />
      )}

      <ProbeConfirmGate
        runId={runId}
        projectSlug={projectSlug}
        sourceSlug={sourceSlug}
        sourceId={source?.id ?? null}
        sourceConfirmed={!!source?.confirmedAt}
        runStatus={run.status}
        runErrorMessage={run.errorMessage}
        logs={run.logs}
        isProbeRun={run.inputLabel === 'probe'}
        sampleRows={resultsTable}
      />

      <WorkList runId={runId} />

      {!probeGateShowing && resultsTable}
    </div>
  );
}

/** A plain link, not a fetch — the api-server sets Content-Disposition itself. */
function ExportLink({ runId, format }: { runId: string; format: 'csv' | 'json' }) {
  return (
    <a
      href={runExportUrl(runId, format)}
      download
      className="btn-quiet"
    >
      <Download className="h-3 w-3" />
      {format.toUpperCase()}
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="micro-label">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
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
  const cls = status === 'completed' ? 'bg-emerald-100 text-emerald-800'
    : status === 'failed' ? 'bg-red-100 text-red-800'
    : isRunActive(status) || status === 'planning' ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-700';
  return (
    <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function ExecuteControls({ runId, probeUnconfirmed, backfill }: { runId: string; probeUnconfirmed: boolean; backfill: boolean }) {
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
  // only place most operators will ever see it. The one exception is a
  // probe run its Source hasn't confirmed yet: `probeUnconfirmed` suppresses
  // every control there, since the confirm gate above is the only actionable
  // control on that page — see runControls's own doc comment.
  const controls = runControls(data.status, data.counts, { probeUnconfirmed, backfill });

  // What the last execute actually reclaimed. `crawl.execute` returns the
  // count because "Resume N stalled" appears as soon as an item is `running`,
  // while the reclaim behind it only acts past the staleness threshold — so
  // inside that window the click really did launch a browser and really did
  // change nothing, and saying so beats leaving the operator to click again.
  const notice = execute.data && !execute.isPending
    ? requeueNotice(execute.data.requeued, data.counts)
    : null;

  return (
    <div className="card mt-6 flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="text-sm font-medium">{progressLabel(data.counts, data.status)}</span>
      <div className="ml-auto flex items-center gap-2">
        {controls.showExtract && (
          <button
            onClick={() => execute.mutate({ runId })}
            disabled={execute.isPending}
            className="btn-primary px-3 py-1.5 text-xs"
            title={extractButtonTitle(data.status, data.counts)}
          >
            {extractButtonLabel(data.counts)}
          </button>
        )}
        {controls.showRetry && (
          <button
            onClick={() => execute.mutate({ runId, retryFailed: true })}
            disabled={execute.isPending}
            className="btn-quiet"
            title="Re-queue the failed items and extract them again"
          >
            Retry {data.counts.failed} failed
          </button>
        )}
        {controls.showStop && (
          <button
            onClick={() => cancel.mutate({ runId })}
            disabled={cancel.isPending}
            className="btn-quiet hover:border-red-300 hover:bg-red-50 hover:text-red-700"
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
 * The one `crawl.backfill` mutation both spend paths share — the action bar's
 * Re-extract and the gaps panel's Run backfill. On success both must land
 * identically: this run (the backfill's PARENT) gets its "Backfilled by"
 * breadcrumb and coverage refreshed, and the operator navigates to the new
 * backfill run. One hook keeps the two paths identical by construction.
 */
function useBackfillMutation(projectSlug: string, sourceSlug: string) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  return trpc.crawl.backfill.useMutation({
    onSuccess: (result) => {
      utils.runs.getWithDetails.invalidate();
      utils.crawl.coverage.invalidate();
      navigate({
        to: '/p/$project/sources/$source/runs/$run',
        params: { project: projectSlug, source: sourceSlug, run: result.backfillRunId },
      });
    },
  });
}

/**
 * The manual backfill handle (spec: coverage report → re-extract selected).
 * Renders nothing until there's something to act on — a field filter is
 * active, or at least one row is selected — so it never competes for
 * attention with ExecuteControls on a run with clean coverage.
 *
 * The Re-extract button is the ONLY spender this bar offers: it fires
 * `crawl.backfill` only on this explicit click, its label (`reExtractLabel`)
 * names the page count and the cost shape honestly before the click, and a
 * `PRECONDITION_FAILED` from the API (e.g. a dead field with no
 * `deadFieldStrategy`) surfaces as the inline error note below rather than
 * throwing — this bar never picks a strategy on the operator's behalf.
 */
function CoverageActionBar({
  runId, projectSlug, sourceSlug, filterField, missingCount, onClearFilter, selectedUrls, onSelectAll, gapByUrl,
  coverage,
}: {
  runId: string;
  projectSlug: string;
  sourceSlug: string;
  filterField: string | null;
  missingCount: number;
  onClearFilter: () => void;
  selectedUrls: Set<string>;
  onSelectAll: () => void;
  gapByUrl: Map<string, ItemGap>;
  /** Per-field coverage — used only to explain a filter that renders zero rows (`emptyFilterNote`). */
  coverage?: FieldCoverage[];
}) {
  const backfill = useBackfillMutation(projectSlug, sourceSlug);

  if (!filterField && selectedUrls.size === 0) return null;

  const itemIds = selectionToItemIds([...selectedUrls], gapByUrl);
  // A field whose gaps are ALL confirmed-absent filters to zero rows — the
  // filter itself is correct (there is nothing left to repair), but a bare
  // disabled button with no rows on screen reads as broken. This note
  // replaces that button with the actual explanation (Task 9 parked finding).
  const note = filterField ? emptyFilterNote(coverage?.find((c) => c.name === filterField)) : null;

  return (
    <div className="card mt-6 flex flex-wrap items-center gap-3 px-4 py-3">
      {filterField && (
        <span className="text-sm text-gray-700">
          {missingCount} {missingCount === 1 ? 'row' : 'rows'} missing{' '}
          <code className="font-mono text-xs text-gray-900">{filterField}</code>
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {filterField && (
          <>
            <button onClick={onSelectAll} className="btn-quiet">Select all</button>
            <button onClick={onClearFilter} className="btn-quiet">Clear filter</button>
          </>
        )}
        {!note && (
          <button
            onClick={() => backfill.mutate({ runId, itemIds, targetFields: filterField ? [filterField] : undefined })}
            disabled={backfill.isPending || itemIds.length === 0}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {reExtractLabel(itemIds.length)}
          </button>
        )}
      </div>
      {note && <span className="basis-full text-[11px] text-gray-600">{note}</span>}
      {backfill.isError && (
        <span className="basis-full text-[11px] text-red-600">{backfill.error.message}</span>
      )}
    </div>
  );
}

/**
 * The bulk backfill handle (spec §2.4-2.5): "Backfill gaps" opens a preview
 * of what a backfill run against THIS run would do — every gappy field,
 * prechecked, with a fill bar and dead/healthy classification, a
 * per-dead-field strategy choice, and the honest "up to $X" cost line —
 * before the one spending click. Renders nothing when there are no gappy
 * fields at all.
 *
 * Two uses of the preview query (`crawl.backfillPreview`, free/AI-free),
 * both gated on `open` — a closed panel must not query. The first asks for
 * the FULL gappy field set (`gappyFieldNames`, computed by the caller from
 * the coverage query that's already loaded) and drives the checklist's fill
 * bars/classification chips and the strategy choice. The second asks for the
 * CHECKED subset and drives the summary line (D-UX1: the summary must follow
 * the checkboxes, not stay pinned to the full-set numbers from panel-open) —
 * react-query refetches it on every toggle since the field set is in its
 * query key, and the endpoint is read-only and free, so the extra query
 * costs nothing. Both derive from the same server-side
 * `loadRunCoverage`/`deriveBackfillItems`, so the summary and the run it
 * describes can never drift — the drift hazard the previous client-side
 * recomputation (a mirrored cost constant and re-implemented intersection
 * semantics) carried.
 */
function BackfillGapsPanel({
  runId, projectSlug, sourceSlug, gappyFieldNames,
}: {
  runId: string;
  projectSlug: string;
  sourceSlug: string;
  gappyFieldNames: string[];
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [strategy, setStrategy] = useState<'repair_sweep' | 'full_focus'>('repair_sweep');

  const previewQuery = trpc.crawl.backfillPreview.useQuery(
    { runId, targetFields: gappyFieldNames },
    { enabled: open },
  );

  useEffect(() => {
    if (previewQuery.data && checked === null) {
      setChecked(initialChecked(previewQuery.data.fields as FieldClassification[]));
    }
  }, [previewQuery.data, checked]);

  // The summary line's query — the checked subset, sorted so the query key is
  // stable under Set iteration order. `placeholderData` keeps the previous
  // summary on screen during the refetch a toggle triggers, instead of the
  // line blinking out on every checkbox click.
  const activeChecked = checked ?? new Set(gappyFieldNames);
  const checkedPreviewQuery = trpc.crawl.backfillPreview.useQuery(
    { runId, targetFields: [...activeChecked].sort() },
    { enabled: open, placeholderData: (prev) => prev },
  );

  const backfill = useBackfillMutation(projectSlug, sourceSlug);

  if (gappyFieldNames.length === 0) return null;

  if (!open) {
    return (
      <div className="mt-6">
        <button onClick={() => setOpen(true)} className="btn-quiet">Backfill gaps</button>
      </div>
    );
  }

  const fields = (previewQuery.data?.fields ?? []) as FieldClassification[];
  const showStrategy = checkedHasDeadField(fields, activeChecked);
  const deadCheckedFields = fields.filter((f) => activeChecked.has(f.name) && f.classification === 'dead');

  const toggleField = (name: string) => {
    setChecked((prev) => {
      const base = prev ?? new Set(gappyFieldNames);
      const next = new Set(base);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const mutationInput = previewQuery.data ? backfillMutationInput(fields, activeChecked, strategy) : null;

  return (
    <div className="card mt-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Backfill gaps</h2>
        <button onClick={() => setOpen(false)} className="btn-quiet">Close</button>
      </div>

      {!previewQuery.data ? (
        <p className="mt-3 text-sm text-gray-500">Loading preview…</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {fields.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activeChecked.has(f.name)}
                  onChange={() => toggleField(f.name)}
                  aria-label={`Include ${f.name}`}
                />
                <span className="font-mono text-xs text-gray-800">{f.name}</span>
                <span className="micro-label text-gray-500">{Math.round(f.fill * 100)}% filled</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  f.classification === 'dead' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                }`}
                >
                  {f.classification}
                </span>
              </li>
            ))}
          </ul>

          {showStrategy && (
            <div className="mt-4 space-y-2">
              {deadCheckedFields.map((f) => {
                const copy = strategyCopy(f);
                if (!copy) return null;
                return (
                  <div key={f.name} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <p className="micro-label text-amber-700">{copy.title}</p>
                    <label className="mt-1.5 flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`backfill-strategy-${f.name}`}
                        checked={strategy === 'repair_sweep'}
                        onChange={() => setStrategy('repair_sweep')}
                      />
                      {copy.recommended}
                    </label>
                    <label className="mt-1 flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`backfill-strategy-${f.name}`}
                        checked={strategy === 'full_focus'}
                        onChange={() => setStrategy('full_focus')}
                      />
                      {copy.alternative}
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          {checkedPreviewQuery.data && (
            <p className="mt-3 text-sm text-gray-700">
              {previewSummary(checkedPreviewQuery.data)}
            </p>
          )}

          <button
            onClick={() => mutationInput && backfill.mutate({ runId, ...mutationInput })}
            disabled={backfill.isPending || !mutationInput || mutationInput.targetFields.length === 0}
            className="btn-primary mt-3 px-3 py-1.5 text-xs"
          >
            Run backfill
          </button>
          {backfill.isError && <p className="mt-2 text-xs text-red-600">{backfill.error.message}</p>}
        </>
      )}
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
      <div className="flex items-baseline gap-3">
        <ListChecks className="h-4 w-4 self-center text-gray-400" />
        <h2 className="text-sm font-medium text-gray-900">Work list</h2>
        <span className="text-xs text-gray-500">{summariseWorkList(data.counts)}</span>
      </div>

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="micro-label px-3 py-2 text-left">Kind</th>
              <th className="micro-label px-3 py-2 text-left">Page</th>
              <th className="micro-label px-3 py-2 text-left">Status</th>
              <th className="micro-label px-3 py-2 text-left">URL</th>
              <th className="micro-label px-3 py-2 text-left">From the listing</th>
            </tr>
          </thead>
          <tbody>
            {data.items.slice(0, 200).map((item) => (
              <tr key={item.id} className="border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/60">
                <td className="px-3 py-2 align-top">
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
                    item.kind === 'listing' ? 'bg-accent-50 text-accent-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {item.kind}
                  </span>
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-gray-500">{item.pageNumber ?? '—'}</td>
                <td className="px-3 py-2 align-top">
                  <span className={`text-xs font-medium ${
                    item.status === 'failed' ? 'text-red-600'
                      : item.status === 'done' ? 'text-emerald-700' : 'text-gray-500'
                  }`}>
                    {item.status}
                  </span>
                  {item.error && <div className="max-w-[240px] font-mono text-[10px] text-red-600">{item.error}</div>}
                </td>
                <td className="px-3 py-2 align-top">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[420px] truncate font-mono text-xs text-gray-700 hover:text-accent-700"
                    title={item.url}
                  >
                    {item.url}
                  </a>
                </td>
                <td className="px-3 py-2 align-top font-mono text-[11px] text-gray-500">
                  {listingValuesLabel(item.listingValues)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.items.length > 200 && (
        <p className="mt-2 text-xs text-gray-500">Showing 200 of {data.items.length} items.</p>
      )}
    </div>
  );
}

/**
 * The probe-confirm gate (spec §3 step 2): shown above the work list for a
 * probe run on a still-unconfirmed Source. Evidence summary, THEN the sample
 * extracted rows, THEN "Is this the desirable path?" — Yes plans+navigates to
 * the full crawl; "Something's wrong" reveals the diagnosis panel, which also
 * renders on its own the moment the probe run itself failed (no click needed
 * for that case).
 *
 * `sampleRows` is the caller's one `<ResultsTable>` instance, not a second
 * one — the caller (SourceRunDetail) renders it here instead of at the
 * bottom of the page exactly when this gate is showing; the two render sites
 * share one condition (`probeGateShowing`) so the rows never vanish from
 * both places or double up in both.
 *
 * The container (and `sampleRows` within it) always renders once the gate is
 * showing at all — only the evidence summary and the Yes/No buttons wait on
 * `crawl.items`, degrading to a loading line / an inline error note while
 * that query is in flight or fails, rather than the whole gate (and the
 * sample rows riding along with it) disappearing for that window.
 *
 * Renders nothing once the Source is confirmed — an OLD probe run's page
 * must not re-offer a gate whose "Yes" would fire a second full plan on a
 * Source already crawling for real.
 */
function ProbeConfirmGate({
  runId, projectSlug, sourceSlug, sourceId, sourceConfirmed, runStatus, runErrorMessage, logs, isProbeRun,
  sampleRows,
}: {
  runId: string;
  projectSlug: string;
  sourceSlug: string;
  sourceId: string | null;
  sourceConfirmed: boolean;
  runStatus: string;
  runErrorMessage: string | null;
  logs: string | null;
  isProbeRun: boolean;
  sampleRows: ReactNode;
}) {
  const navigate = useNavigate();
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const [showAddFields, setShowAddFields] = useState(false);

  // Always called (rules-of-hooks) — gated below by isProbeRun/sourceConfirmed instead.
  const itemsQuery = trpc.crawl.items.useQuery({ runId }, { enabled: isProbeRun && !sourceConfirmed });
  const confirmMutation = trpc.sources.confirm.useMutation({
    onSuccess: (result) => {
      navigate({
        to: '/p/$project/sources/$source/runs/$run',
        params: { project: projectSlug, source: sourceSlug, run: result.runId },
      });
    },
  });

  if (!isProbeRun || sourceConfirmed) return null;

  // `itemsQuery.data` degrades gracefully rather than gating the whole gate:
  // returning null here (as this used to) meant `sampleRows` — the caller's
  // ONE ResultsTable instance, already withheld from its old bottom-of-page
  // spot because this gate is showing — never rendered anywhere for the
  // entire loading window, and PERMANENTLY if the query errored. The
  // container, header, and sample rows below now always render; only the
  // evidence summary and the Yes/No buttons (which need real counts to mean
  // anything) wait on the query.
  const { warnings, errors } = parseRunLog(logs);
  const counts = itemsQuery.data?.counts ?? null;
  const evidence = counts ? probeEvidence({ counts, warnings }) : null;

  const itemFailures = itemsQuery.data
    ? itemsQuery.data.items
      .filter((item) => item.kind === 'detail' && item.status === 'failed')
      .map((item) => ({ url: item.url, error: item.error }))
    : [];

  const runFailed = runStatus === 'failed';
  // Computed regardless of itemsQuery's state: a failed probe run's own
  // errorMessage/logs are enough to diagnose blocked/pagination/dead-link
  // even before (or without) the item-level detail loading — the diagnosis
  // panel re-renders with full item-failure detail once itemsQuery settles.
  const diagnosis: Diagnosis[] = diagnoseRun({
    warnings,
    errors: [
      ...errors.map((message) => ({ message })),
      ...(runErrorMessage ? [{ message: runErrorMessage }] : []),
    ],
    // No separate blockedReason channel at the run level — a block is caught
    // by diagnoseRun's own regex match over warnings/errors/itemFailures.
    blockedReason: null,
    rowsFound: counts ? counts.detail : null,
    itemFailures,
  });

  const showDiagnosisPanel = showDiagnosis || runFailed;

  return (
    <div className="card mt-6 p-4">
      <div className="flex items-baseline gap-3">
        <HelpCircle className="h-4 w-4 self-center text-gray-400" />
        <h2 className="text-sm font-medium text-gray-900">Probe results</h2>
      </div>

      {evidence ? (
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Stat label="Pages walked" value={String(evidence.pagesWalked)} />
          <Stat label="Items found" value={String(evidence.itemsFound)} />
          <Stat label="Pagination" value={evidence.paginationNote} />
          <Stat label="Warnings" value={String(evidence.warningsCount)} />
        </dl>
      ) : itemsQuery.isError ? (
        <p className="mt-3 text-sm text-red-600">
          Couldn't load the probe's evidence: {itemsQuery.error.message}
        </p>
      ) : (
        <p className="mt-3 text-sm text-gray-500">Loading probe evidence…</p>
      )}

      {sampleRows}

      {evidence && !runFailed && (
        <div className="mt-4">
          <p className="text-sm font-medium text-gray-900">Is this the desirable path?</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => sourceId && confirmMutation.mutate({ sourceId })}
              disabled={confirmMutation.isPending || !sourceId}
              className="btn-primary h-9"
            >
              {confirmMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCircle2 className="h-4 w-4" />}
              Yes, crawl everything
            </button>
            <button onClick={() => setShowDiagnosis((v) => !v)} className="btn-quiet">
              Something's wrong
            </button>
            <button onClick={() => setShowAddFields((v) => !v)} className="btn-quiet">
              Request more fields
            </button>
          </div>
          {confirmMutation.isError && (
            <p className="mt-2 text-xs text-red-600">{confirmMutation.error.message}</p>
          )}
        </div>
      )}

      {/*
        Same shared control as the Set-up page's add-fields section
        (components/add-fields-control.tsx) — here its "Re-analyze" click
        navigates back to Set-up after firing (`onAnalyzed`), landing the
        operator where the new schema actually renders, since a probe run's
        own page has no FieldsTable to refresh.
      */}
      {showAddFields && sourceId && (
        <AddFieldsControl
          sourceId={sourceId}
          onAnalyzed={() => navigate({ to: '/p/$project/sources/$source', params: { project: projectSlug, source: sourceSlug } })}
        />
      )}

      {showDiagnosisPanel && (
        <DiagnosisPanel diagnosis={diagnosis} projectSlug={projectSlug} sourceSlug={sourceSlug} sourceId={sourceId} />
      )}
    </div>
  );
}

/**
 * The honest actions on "no" (spec §3): switch mode, delete — and, in place
 * of an "Edit URLs" link, an honest note.
 *
 * Ruling R7 (final-review-findings.md, Finding 5): "Edit URLs" used to link
 * to `source-inputs.tsx`, an EmptyState stub with no editing behind it —
 * a dead end dressed as a button. InputSet editing is Phase 3b work, not
 * this wave's; the honest fix is telling the operator what to do today
 * (delete and recreate from the home page) instead of promising a working
 * editor that isn't there. "Switch mode" DOES work now — it points at
 * Source Config's new mode toggle (`source-config.tsx`), the other half of
 * this ruling.
 */
function DiagnosisPanel({
  diagnosis, projectSlug, sourceSlug, sourceId,
}: {
  diagnosis: Diagnosis[];
  projectSlug: string;
  sourceSlug: string;
  sourceId: string | null;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const deleteMutation = trpc.sources.delete.useMutation({
    onSuccess: () => {
      utils.sources.listByProject.invalidate();
      navigate({ to: '/p/$project/sources', params: { project: projectSlug } });
    },
  });

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      {diagnosis.length === 0 ? (
        <p className="text-sm text-gray-500">
          No specific problem found in the probe's own evidence — use your judgment, or pick one of
          the actions below.
        </p>
      ) : (
        <div className="space-y-2">
          {diagnosis.map((d, i) => (
            <div key={i} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <p className="micro-label text-red-600">{d.title}</p>
              <p className="mt-0.5 text-red-800">{d.detail}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        To change the input URLs, delete this source and paste new ones from{' '}
        <Link to="/" className="font-medium text-accent-700 underline-offset-2 hover:underline">
          the home page
        </Link>
        {' '}— InputSet editing isn't built yet.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          to="/p/$project/sources/$source/config"
          params={{ project: projectSlug, source: sourceSlug }}
          className="btn-quiet"
        >
          Switch mode
        </Link>
        <button
          onClick={() => {
            if (!sourceId) return;
            if (window.confirm('Delete this source? This cannot be undone.')) {
              deleteMutation.mutate({ sourceId });
            }
          }}
          disabled={deleteMutation.isPending || !sourceId}
          className="btn-quiet hover:border-red-300 hover:bg-red-50 hover:text-red-700"
        >
          Delete source
        </button>
      </div>
      {deleteMutation.isError && <p className="mt-2 text-xs text-red-600">{deleteMutation.error.message}</p>}
    </div>
  );
}
