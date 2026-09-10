import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { Loader2, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { screenshotUrl } from '../lib/screenshot-url';
import { Spinner, ErrorBanner, NotFound, EmptyState } from '../components/page-states';
import { SchemaGrid, type CellStatus } from '../components/schema-grid';
import { SchemaImport } from '../components/schema-import';
import { SchemaUrls } from '../components/schema-urls';
import { applyImportToRows, bindingProblems, emptyRow, emptyState, fromSource, isComplete, toBindingInput, URL_COUNT, type GridState } from '../lib/schema-grid';
import { cellStatusFor, isRowStale, reverifyKeys, summaryLine, verificationState, type VerificationResults } from '../lib/verification-view';

/**
 * The Schema tab (Task 15 brief) — what used to be Set-up. `fromSource`
 * seeds the grid once from the Source's saved schema/verification set;
 * after that the grid is the single source of truth for edits until the
 * operator hits Verify, which saves (if dirty) then kicks off a
 * verification run. Extract is gated on the LAST verification still being
 * current (schema hasn't changed since) and fully passing — enforced again
 * server-side by `crawl.plan`/`probeAndSample` (`requireCertification`).
 */
export default function SourceSchema() {
  const navigate = useNavigate();
  const { project: projectSlug, source: sourceSlug } = useParams({ from: '/projects/$project/sources/$source' });
  const utils = trpc.useUtils();

  const [grid, setGrid] = useState<GridState>(emptyState());
  const [error, setError] = useState<string | null>(null);
  // Spec 2.1: a hostname mismatch (and friends) is rejected inline, not just
  // silently disabling Save/Verify. Gated on `touched` so a grid freshly
  // seeded from the Source does not scream on first paint - flips true on
  // any grid edit, or a click on the (possibly disabled) Verify button.
  const [touched, setTouched] = useState(false);
  const [importIgnored, setImportIgnored] = useState<string[]>([]);
  const initialized = useRef(false);

  const updateGrid: typeof setGrid = (value) => {
    setTouched(true);
    setGrid(value);
  };

  const listQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);

  // Declared before the status query: its `stallMs` is what tells the poll
  // (and everything else on this screen) whether an in-flight row is really
  // in flight or is a crash leftover — see `verificationState` (C1).
  const estimateQuery = trpc.sources.verifyEstimate.useQuery({ sourceId: source?.id ?? '' }, { enabled: !!source });
  const stallMs = estimateQuery.data?.stallMs;

  const statusQuery = trpc.sources.verificationStatus.useQuery(
    { sourceId: source?.id ?? '' },
    {
      enabled: !!source,
      // Poll only while genuinely active: a stalled row is never coming back
      // on its own, and polling it forever is exactly what wedged this screen.
      refetchInterval: (query) => (verificationState(query.state.data ?? null, { stallMs }) === 'active' ? 3000 : false),
    },
  );

  const updateBindingMutation = trpc.sources.updateBinding.useMutation();
  const verifyMutation = trpc.sources.verify.useMutation();
  const findMutation = trpc.sources.findProductPages.useMutation();
  const planMutation = trpc.crawl.plan.useMutation();
  const executeMutation = trpc.crawl.execute.useMutation();
  const probeMutation = trpc.crawl.probeAndSample.useMutation();
  const extractPending = planMutation.isPending || executeMutation.isPending || probeMutation.isPending;

  // Seed the grid once the Source loads. After that, local edits are the
  // source of truth - a background refetch of `listByProject` (e.g. from
  // the verify-triggered invalidation below) must never clobber what the
  // operator is mid-typing. Not a user edit, so it does not flip `touched`.
  useEffect(() => {
    if (initialized.current || !source) return;
    const seeded = fromSource(source);
    if (seeded) {
      setGrid(seeded);
      initialized.current = true;
      return;
    }
    // A website with fields lifted from the project (Task 6) but no
    // verification set yet: seed rows from the project's fields with empty
    // URLs, ready for the operator to fill in.
    if (Array.isArray(source.schemaDefinition) && source.schemaDefinition.length > 0) {
      const fields = source.schemaDefinition as Array<{ key: string; name: string; type: GridState['rows'][number]['type']; description: string }>;
      setGrid({
        urls: ['', '', ''],
        listingUrl: '',
        rows: fields.map((f) => ({ ...emptyRow(), key: f.key, name: f.name, type: f.type, description: f.description })),
      });
      initialized.current = true;
    }
  }, [source]);

  const status = statusQuery.data ?? null;
  const state = verificationState(status, { stallMs });
  const active = state === 'active';
  const savedGrid = source ? fromSource(source) : null;
  const results = (status?.results ?? null) as VerificationResults | null;
  const estimate = estimateQuery.data;

  // `savedGrid` is null for a Source that predates this feature (never had a
  // schema saved) - treated as "saved: nothing" so any grid the operator
  // fills in reads as dirty, not as already matching a saved state.
  const isDirty = JSON.stringify(toBindingInput(grid)) !== JSON.stringify(toBindingInput(savedGrid ?? emptyState()));
  const problems = bindingProblems(grid);
  const showProblems = touched && problems.length > 0;

  function cellStatus(rowId: string, urlIndex: number): CellStatus | null {
    const row = grid.rows.find((r) => r.id === rowId);
    if (!row) return null;
    const url = grid.urls[urlIndex] ?? '';
    const base = cellStatusFor(results, row.key ?? '', url, isRowStale(row, savedGrid), row.type);
    if (base?.status === 'fail' && estimate && !estimate.aiAvailable) {
      return { ...base, hint: `${base.hint} AI is unavailable on this machine, so only the mechanical search ran.` };
    }
    return base;
  }

  async function handleVerify() {
    if (!source) return;
    setError(null);
    try {
      // `results`/`savedGrid` are the PRE-save baseline - captured now,
      // before `updateBinding` catches the Source's saved definition up to
      // `grid`, so a field the operator just edited still reads as having
      // drifted from what the last verification actually ran against.
      const priorResults = results;
      const priorSavedGrid = savedGrid;

      let latestDefinition: { schemaDefinition: unknown; verificationSet: unknown } = source;
      if (isDirty) {
        latestDefinition = await updateBindingMutation.mutateAsync({ sourceId: source.id, ...toBindingInput(grid) });
        const refreshed = fromSource(latestDefinition);
        if (refreshed) setGrid(refreshed);
      }

      // Matched by key against the fresh (post-save) grid: an existing field
      // keeps its key across the save, and a brand-new field's fresh key was
      // never in `priorResults` at all - `reverifyKeys` picks up both cases.
      const latestGrid = fromSource(latestDefinition) ?? grid;
      const onlyKeys = reverifyKeys(priorResults, latestGrid, priorSavedGrid);

      await verifyMutation.mutateAsync({ sourceId: source.id, onlyKeys });
      utils.sources.verificationStatus.invalidate({ sourceId: source.id });
      utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleExtract() {
    if (!source) return;
    setError(null);
    try {
      const isListing = source.listingMode === 'listing_to_detail';
      if (!isListing) {
        // Detail Source: plan (one detail item per input row), then execute
        // every one of them - no probe gate for a Source already pointed
        // straight at product pages.
        const plan = await planMutation.mutateAsync({ sourceId: source.id, probe: false });
        await executeMutation.mutateAsync({ runId: plan.runId });
        navigate({ to: '/projects/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: plan.runId } });
        return;
      }
      if (!source.confirmedAt) {
        // Listing, unconfirmed: probe the first input + sample a few
        // details. The run-detail page's confirm gate takes it from here.
        const probe = await probeMutation.mutateAsync({ sourceId: source.id });
        navigate({ to: '/projects/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: probe.runId } });
        return;
      }
      // Listing, already confirmed: a full plan across every input row.
      const plan = await planMutation.mutateAsync({ sourceId: source.id, probe: false });
      navigate({ to: '/projects/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: plan.runId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  const isListing = source.listingMode === 'listing_to_detail';
  const extractLabel = !isListing
    ? 'Extract'
    : !source.confirmedAt
      ? 'Probe & sample'
      : 'Extract everything';

  const verifyLabel = !estimate
    ? 'Verify'
    : estimate.aiAvailable
      ? `Verify · up to $${estimate.upperBoundUsd.toFixed(2)}`
      : 'Verify · mechanical only';
  const verifyBusy = updateBindingMutation.isPending || verifyMutation.isPending;
  const verifyDisabled = active || !isComplete(grid) || verifyBusy;
  const extractEnabled = !!(status?.current && status?.allPassed);

  const captures = (status?.captures ?? {}) as Record<string, { blockedReason?: string; screenshotUrl?: string }>;
  // M8: a field can be neither green nor red — `incomplete` means a page it
  // needed never got captured, so there was nothing to certify against.
  const anyIncomplete = Object.values(results ?? {}).some((f) => f.incomplete);

  return (
    <div className="mt-6">
      {showProblems && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-xs">
          <ul className="list-inside list-disc text-red-700">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{summaryLine(results)}</p>
          {active && status?.stage && <p className="mt-0.5 text-xs text-gray-500">{status.stage}</p>}
          {anyIncomplete && (
            <p className="mt-0.5 text-xs text-gray-500">Some pages were not captured, so nothing certified yet.</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {/*
            Wrapping div, not the button itself: a disabled <button> never
            dispatches click at all, not even to ancestors, so clicking a
            disabled Verify while incomplete needs a non-disabled element
            underneath to catch the click and reveal the inline problems
            list above (spec 2.1 - "rejected inline").
          */}
          <div onClick={() => setTouched(true)}>
            <button type="button" className="btn-quiet h-9" disabled={verifyDisabled} onClick={handleVerify}>
              {verifyBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {verifyLabel}
            </button>
          </div>
          <button type="button" className="btn-primary h-9" disabled={!extractEnabled || extractPending} onClick={handleExtract}>
            {extractPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {extractLabel}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

      {/*
        C1: a verification that died with the api-server leaves a row that
        never completes. Say so, and leave Verify enabled — its click goes
        through `sources.verify`, which closes the stale row out server-side
        and starts a fresh one.
      */}
      {state === 'stalled' && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This verification stalled (the server may have restarted). Run it again.
        </div>
      )}

      {/* A run that completed with an error: show what it said, Verify stays enabled. */}
      {state === 'failed' && status?.errorMessage && <ErrorBanner message={status.errorMessage} />}

      {grid.urls.some((u) => captures[u]?.blockedReason) && (
        <div className="mt-4 space-y-2">
          {grid.urls.map((u, i) => {
            const capture = captures[u];
            if (!capture?.blockedReason) return null;
            return (
              <div key={i} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p><span className="font-medium">URL {i + 1}</span> could not be captured: {capture.blockedReason}</p>
                {capture.screenshotUrl && (
                  <img src={screenshotUrl(capture.screenshotUrl) ?? ''} alt="Capture screenshot" className="mt-2 max-w-sm rounded border" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!Array.isArray(source.schemaDefinition) || source.schemaDefinition.length === 0 ? (
        <EmptyState
          title="No fields yet"
          description="Add the fields you want on the project page. Every website in the project gets them."
          action={<Link to="/projects/$project" params={{ project: projectSlug }} className="btn-primary h-9">Go to the project</Link>}
        />
      ) : (
        <>
          {/*
            C2 (spec §2.1, §7, §9): the three verification URLs and the optional
            listing URL belong to the schema, so this screen owns them too — not
            only the New Source wizard. Edits go through `updateGrid`, so a URL
            change marks the grid dirty exactly like a cell edit: Verify saves it
            first via `updateBinding`, and the changed `definitionHash`
            invalidates the old certification on its own. A Source with no saved
            `verificationSet` at all opens here with empty URL inputs, ready to
            fill in.
          */}
          <div className="mt-4">
            <SchemaUrls
              state={grid}
              onChange={updateGrid}
              disabled={active}
              onFindProductPages={async (listingUrl) => (await findMutation.mutateAsync({ listingUrl })).urls}
            />
          </div>

          <div className="mt-4">
            {/*
              Import fills existing rows by name; it cannot add fields (those
              come from the project) — names not found among this contract's
              fields are reported as skipped, not silently dropped.
            */}
            <SchemaImport
              urlCount={URL_COUNT}
              onRows={(rows) => {
                const r = applyImportToRows(grid.rows, rows);
                updateGrid((g) => ({ ...g, rows: r.rows }));
                setImportIgnored(r.ignored);
              }}
            />
            {importIgnored.length > 0 && <p className="mt-1 text-xs text-amber-800">Not in this project, so skipped: {importIgnored.join(', ')}</p>}
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Field names and types come from the project. <Link to="/projects/$project" params={{ project: projectSlug }} className="underline-offset-2 hover:underline">Edit fields on the project page.</Link>
          </p>

          <div className="card mt-4 p-4">
            <SchemaGrid state={grid} onChange={updateGrid} cellStatus={cellStatus} disabled={active} locked />
          </div>
        </>
      )}
    </div>
  );
}
