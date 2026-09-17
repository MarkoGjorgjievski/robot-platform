import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearch, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound, EmptyState } from '../components/page-states';
import { SchemaGrid, type CellStatus } from '../components/schema-grid';
import { SchemaImport } from '../components/schema-import';
import { StatusStrip } from '../components/status-strip';
import { addPage, applyImportToRows, bindingProblems, canAddPage, emptyRow, emptyState, fromSource, isComplete, planArrival, removePage, toBindingInput, URL_COUNT, type GridRow, type GridState } from '../lib/schema-grid';
import { cellStatusFor, isRowStale, reverifyKeys, verificationState, type VerificationResults } from '../lib/verification-view';
import { stripState, columnStates, stripSummary, thinEvidenceNote, verifyButton, typeFixSuggestion, type TimeEstimate } from '../lib/schema-tab-view';

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
  // A STATE twin of `initialized` (Task 6 review, finding F1): the arrival effect below
  // must never plan against `grid` until a render has actually committed the seeded
  // grid, and only a state value — not a ref, which mutates synchronously mid-commit —
  // can tell it that. See the seeding effect and the arrival effect for why.
  const [seeded, setSeeded] = useState(false);

  const updateGrid: typeof setGrid = (value) => {
    setTouched(true);
    setGrid(value);
  };

  const listQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);

  // Declared before the status query: its `stallMs` is what tells the poll
  // (and everything else on this screen) whether an in-flight row is really
  // in flight or is a crash leftover — see `verificationState` (C1).
  const stallEstimateQuery = trpc.sources.verifyEstimate.useQuery({ sourceId: source?.id ?? '' }, { enabled: !!source });
  const stallMs = stallEstimateQuery.data?.stallMs;

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

  // Retypes a field to `url` from the grid's type-fix chip. The seeding
  // effect will not re-run after this (`initialized` is already true), so
  // the grid row's type is patched locally here too.
  const retype = trpc.datasets.retypeField.useMutation({
    onSuccess: (_data, vars) => {
      utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
      utils.datasets.invalidate();
      setGrid((g) => ({ ...g, rows: g.rows.map((r) => (r.key === vars.key ? { ...r, type: 'url' } : r)) }));
    },
  });

  // Seed the grid once the Source loads. After that, local edits are the
  // source of truth - a background refetch of `listByProject` (e.g. from
  // the verify-triggered invalidation below) must never clobber what the
  // operator is mid-typing. Not a user edit, so it does not flip `touched`.
  useEffect(() => {
    if (initialized.current || !source) return;
    const fromSaved = fromSource(source);
    if (fromSaved) {
      setGrid(fromSaved);
      initialized.current = true;
      setSeeded(true);
      return;
    }
    // A website with fields lifted from the project (Task 6) but no
    // verification set yet: seed rows from the project's fields with empty
    // URLs, ready for the operator to fill in.
    if (Array.isArray(source.schemaDefinition) && source.schemaDefinition.length > 0) {
      const fields = source.schemaDefinition as Array<{ key: string; name: string; type: GridState['rows'][number]['type']; description: string }>;
      setGrid({
        urls: Array(URL_COUNT).fill(''),
        listingUrl: '',
        rows: fields.map((f) => ({ ...emptyRow(), key: f.key, name: f.name, type: f.type, description: f.description })),
      });
      initialized.current = true;
      setSeeded(true);
      return;
    }
    // A truly empty contract (no fields on the project at all): no rows to
    // seed, so `emptyState()`'s dummy row must not linger - it would leak
    // validation problems for an empty name/description/cells that the
    // EmptyState branch below never shows a grid for anyway.
    setGrid({ urls: Array(URL_COUNT).fill(''), listingUrl: '', rows: [] });
    initialized.current = true;
    setSeeded(true);
  }, [source]);

  // `active` (the table-locked state) has to be known before the arrival effect below
  // can decide whether to touch the grid, so this computation — normally read further
  // down alongside the rest of the strip's derived state — is pulled up here instead.
  const status = statusQuery.data ?? null;
  const results = (status?.results ?? null) as VerificationResults | null;
  const vState = verificationState(status, { stallMs });
  const strip = stripState({ verification: vState, results });
  const active = strip === 'active';

  // Arrival from a run (spec 2026-09-17 §6): a run page can link here with
  // `?addPage=<url>&field=<key>` for a field that needs another proof page.
  // router.tsx imports this component, so the route object cannot be imported back here.
  const search = useSearch({ strict: false }) as { addPage?: string; field?: string };
  const arrival = useRef(false);
  const [arrivalNote, setArrivalNote] = useState<string | null>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col: number } | null>(null);
  // F1 (Task 6 review, cold-load bug): a ref alone cannot gate this effect against the
  // placeholder grid. On a cold load, the seeding effect above sets `initialized.current
  // = true` SYNCHRONOUSLY and calls `setGrid(...)` (an ASYNCHRONOUS state update) in the
  // very same commit as this effect. Because passive effects for one commit all run in
  // hook-declaration order against that commit's closures, this effect could see
  // `initialized.current` already flipped true while `grid` is still the closure's
  // stale `emptyState()` placeholder — the seeded grid hadn't been applied to state yet.
  // That is exactly what produced the corruption the browser check caught: a page
  // appended to an empty one-row grid, "8 of 0 fields", bogus URL-required problems, and
  // the arrival ref consumed before the real grid ever existed.
  //
  // The fix: `seeded` (state, not a ref) is flipped in the SAME seeding-effect call as
  // `setGrid`, so React batches both into the SAME next commit — the first commit where
  // this effect can observe `seeded === true` is also the first one where `grid` (in the
  // same closure) is the real seeded grid. `planArrival` itself refuses (`kind: 'none'`)
  // whenever `ready` is false, so "not seeded yet" is a directly testable rule, not just
  // this effect's timing.
  //
  // While `active` (table locked while verifying), the arrival is likewise NOT consumed:
  // the `arrival` ref stays false and nothing is called, so a customer landing here
  // mid-run cannot mutate a grid the UI is showing as locked and read-only. `active` is
  // in the dependency array so the effect re-evaluates once the lock lifts and applies
  // the arrival then, exactly once.
  useEffect(() => {
    if (arrival.current || !search.addPage) return;
    const addPageUrl = search.addPage;
    const plan = planArrival(grid, { addPage: addPageUrl, field: search.field, locked: active, ready: seeded });
    switch (plan.kind) {
      case 'none':
        return; // no addPage param, or the grid isn't seeded yet — retry once `seeded`/`grid` change
      case 'wait':
        setArrivalNote(plan.note); // still locked: don't consume the arrival, retry once it lifts
        return;
      case 'refused':
        arrival.current = true;
        setArrivalNote(plan.note);
        return;
      case 'add':
        arrival.current = true;
        setGrid(plan.state);
        setTouched(true);
        setArrivalNote(plan.note);
        if (plan.focus) setFocusCell(plan.focus);
        return;
    }
  }, [search.addPage, search.field, active, grid, seeded]);

  const savedGrid = source ? fromSource(source) : null;

  // `savedGrid` is null for a Source that predates this feature (never had a
  // schema saved) - treated as "saved: nothing" so any grid the operator
  // fills in reads as dirty, not as already matching a saved state.
  const isDirty = JSON.stringify(toBindingInput(grid)) !== JSON.stringify(toBindingInput(savedGrid ?? emptyState()));
  const problems = bindingProblems(grid);
  const contractEmpty = !Array.isArray(source?.schemaDefinition) || source.schemaDefinition.length === 0;
  const showProblems = touched && !contractEmpty && problems.length > 0;

  const currentKeys = status?.currentKeys ?? [];

  // Fix 1+5: a cell must read as stale for the SAME reasons the strip's
  // "changed since" count does — not just a row-level definition/expected
  // drift (`isRowStale`), but also a key the server no longer counts as
  // current (its stored fieldHash no longer matches the live definition),
  // or this specific column's URL having been edited since the last
  // verification (the stored result was proven against a different page at
  // this index, so showing it here would be describing the wrong page).
  // The second check must not fire when there are no results at all — a
  // never-verified source has nothing stale.
  function cellIsStale(row: GridRow, urlIndex: number): boolean {
    if (isRowStale(row, grid, savedGrid)) return true;
    if (row.key && results && !currentKeys.includes(row.key) && results[row.key]) return true; // server no longer counts it current
    const saved = savedGrid?.urls[urlIndex];
    const now = grid.urls[urlIndex];
    return !!(saved && now !== saved && row.key && results?.[row.key]?.cells[saved]); // URL edited: keep the old result visible as stale
  }

  const keyed = grid.rows.filter((r) => r.key);
  const staleKeys = keyed.filter((r) => grid.urls.some((_, i) => cellIsStale(r, i))).map((r) => r.key!);
  const failingKeys = keyed.filter((r) => !staleKeys.includes(r.key!) && results?.[r.key!] && results[r.key!]!.certified.length === 0).map((r) => r.key!);
  const reverify = reverifyKeys(results, grid, savedGrid, currentKeys); // undefined = everything
  const reverifyCount = reverify === undefined ? keyed.length : reverify.length;
  const firstRun = strip === 'editing' || strip === 'none';
  const estimateQuery = trpc.sources.verifyEstimate.useQuery({ sourceId: source?.id ?? '', ...(firstRun ? {} : { onlyKeys: reverify ?? undefined }) }, { enabled: !!source });
  const estimate = estimateQuery.data;
  // The rough time in the Verifying strip is frozen for the life of the run.
  // `estimateQuery` already describes the NEXT run — it re-prices against
  // `reverify`, and `capturesFresh` flips to true the moment this very run
  // stores its captures — so reading it live would let "about 2 min" shrink to
  // "a few seconds" while the same run is still going. Only a run started from
  // this screen has a snapshot; after a reload mid-run there is none, and the
  // strip honestly says just "Verifying" rather than guessing from next-run
  // numbers.
  const [runEstimate, setRunEstimate] = useState<TimeEstimate | null>(null);
  const sawActive = useRef(false);
  const verifyBusy = updateBindingMutation.isPending || verifyMutation.isPending;
  const verify = verifyButton({ state: strip, firstRun, reverifyCount, capturesFresh: !!estimate?.capturesFresh, aiAvailable: !!estimate?.aiAvailable, upperBoundUsd: estimate?.upperBoundUsd ?? 0, complete: isComplete(grid) && !contractEmpty, busy: verifyBusy });
  const captures = (status?.captures ?? {}) as Record<string, { captureId?: string; capturedAt?: string; screenshotUrl?: string; blockedReason?: string }>;
  const columns = columnStates({ urls: grid.urls, state: strip, stage: status?.stage ?? null, captures });
  const progress = active ? (() => { const m = /^capturing (\d+)\/(\d+)/.exec(status?.stage ?? ''); return m ? (Number(m[1]) - 1) / Number(m[2]) : status?.stage ? 0.9 : 0.05; })() : null;
  // The run's frozen snapshot is released once it is over, so the next run
  // starts from a fresh one. Keyed on `active` alone: setting `runEstimate` in
  // the handler does not re-run this, so it cannot clear the value it was just
  // given in the window before the status query reports the run as active.
  useEffect(() => {
    if (active) { sawActive.current = true; return; }
    if (sawActive.current) { sawActive.current = false; setRunEstimate(null); }
  }, [active]);

  // The Verifying strip states two facts: that it is verifying, and roughly how
  // long that takes (spec 5.6). Until the estimate lands there is only the first.
  const summary = stripSummary({ state: strip, fieldCount: keyed.length, pageCount: grid.urls.length, currentKeys, failingKeys, staleKeys, estimate: active ? runEstimate : (estimate ?? null) });
  const stage = active ? (status?.stage ?? 'starting') : strip === 'failed' ? (status?.errorMessage ?? null) : null;
  const tone = strip === 'stalled' ? 'warn' : strip === 'failed' ? 'error' : 'neutral';
  const lockNote = active ? 'table locked while verifying' : null;

  function cellStatus(rowId: string, urlIndex: number): CellStatus | null {
    const row = grid.rows.find((r) => r.id === rowId);
    if (!row) return null;
    const url = grid.urls[urlIndex] ?? '';
    const base = cellStatusFor(results, row.key ?? '', url, cellIsStale(row, urlIndex), row.type);
    if (base?.status === 'fail' && estimate && !estimate.aiAvailable) {
      return { ...base, hint: `${base.hint} AI is unavailable on this machine, so only the mechanical search ran.` };
    }
    return base;
  }

  async function handleVerify() {
    if (!source) return;
    setError(null);
    // Freeze the rough time before anything can move it: `estimate` is priced
    // against exactly the fields this run is about to do.
    setRunEstimate(estimate ?? null);
    try {
      // `results`/`savedGrid` are the PRE-save baseline - captured now,
      // before `updateBinding` catches the Source's saved definition up to
      // `grid`, so a field the operator just edited still reads as having
      // drifted from what the last verification actually ran against.
      const priorResults = results;
      const priorSavedGrid = savedGrid;
      const priorCurrentKeys = currentKeys;

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
      const onlyKeys = reverifyKeys(priorResults, latestGrid, priorSavedGrid, priorCurrentKeys);

      await verifyMutation.mutateAsync({ sourceId: source.id, onlyKeys });
      utils.sources.verificationStatus.invalidate({ sourceId: source.id });
      utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
    } catch (err) {
      setRunEstimate(null); // the run never started, so nothing is frozen
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (listQuery.isLoading) return <Spinner label="Loading website..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Website "${sourceSlug}"`} />;

  // The strip's second button is now a handoff, not an action: everything it
  // used to start (probe, plan, execute) belongs to the Extract tab, which
  // asks for the pages and the budget first. Still gated on the same green,
  // so the tab is only offered once there is something certified to run.
  const extractEnabled = !!(status?.current && status?.allPassed);

  function typeFix(rowId: string) {
    const row = grid.rows.find((r) => r.id === rowId);
    if (!row?.key || !source?.datasetId) return null;
    const cells = grid.urls.map((_, i) => cellStatus(rowId, i));
    const suggested = typeFixSuggestion(row, cells);
    if (!suggested) return null;
    return { suggested, pending: retype.isPending && retype.variables?.key === row.key, error: retype.error && retype.variables?.key === row.key ? retype.error.message : undefined, onApply: () => retype.mutate({ datasetId: source.datasetId!, key: row.key!, type: 'url' }) };
  }

  return (
    <div className="mt-6 space-y-4">
      {showProblems && (
        <div className="border-l-[3px] border-l-fail bg-fail-tint p-3 text-xs">
          <ul className="list-inside list-disc text-fail">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {contractEmpty ? (
        <EmptyState
          title="No fields yet"
          description="Add the fields you want on the project page. Every website in the project gets them."
          action={<Link to="/projects/$project" params={{ project: projectSlug }} className="btn-primary h-9">Go to the project</Link>}
        />
      ) : (
        <>
          <StatusStrip
            summary={summary}
            stage={stage}
            progress={progress}
            lockNote={lockNote}
            tone={tone}
            verify={{ label: verify.label, disabled: verify.disabled, reason: verify.reason, busy: verifyBusy, onClick: handleVerify, onDisabledClick: () => setTouched(true) }}
            extract={{ label: 'Go to Extract', disabled: !extractEnabled, reason: 'Unlocks when every cell is green', busy: false, onClick: () => navigate({ to: '/projects/$project/sources/$source/extract', params: { project: projectSlug, source: sourceSlug } }) }}
          />
          {(() => { const t = thinEvidenceNote(results, grid.rows); return t ? <p className="mt-1 text-[12px] line-warn">{t}</p> : null; })()}

          {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

          <div className={active ? 'pointer-events-none opacity-40' : ''}>
            {/*
              Import fills existing rows by name; it cannot add fields (those
              come from the project) — names not found among this contract's
              fields are reported as skipped, not silently dropped.
            */}
            <div className="flex flex-wrap items-center gap-2">
              <SchemaImport
                urlCount={grid.urls.length}
                onRows={(rows) => {
                  const r = applyImportToRows(grid.rows, rows);
                  updateGrid((g) => ({ ...g, rows: r.rows }));
                  setImportIgnored(r.ignored);
                }}
              />
              {/*
                F2 (Task 6 review): the header's own Add-page control is the last
                column of a wide, horizontally-scrolling table, so on a narrow
                viewport it can sit off-screen. This is the same handler, kept
                visible next to Import regardless of scroll position — hidden or
                faded under exactly the same conditions as the header one: six
                pages already (canAddPage false) hides it, and the surrounding
                `active`-faded wrapper disables it while the table is locked.
              */}
              {canAddPage(grid) && (
                <button type="button" className="btn-quiet" onClick={() => setGrid((g) => addPage(g))} aria-label="Add a proof page">
                  Add proof page
                </button>
              )}
            </div>
            {importIgnored.length > 0 && <p className="mt-1 text-xs text-warn">Not in this project, so skipped: {importIgnored.join(', ')}</p>}
          </div>

          <p className="label-soft">
            Field names and types come from the project. <Link to="/projects/$project" params={{ project: projectSlug }} className="underline-offset-2 hover:underline">Edit fields on the project page.</Link>
          </p>

          {arrivalNote && <p className="label-soft">{arrivalNote}</p>}

          {/* The proof sheet sits on the paper: rules, not a box (spec 7). */}
          <SchemaGrid
            state={grid}
            onChange={updateGrid}
            cellStatus={cellStatus}
            columnStates={columns}
            captures={captures}
            readOnly={active}
            pending={active}
            onFindPages={async (u) => (await findMutation.mutateAsync({ listingUrl: u })).urls}
            typeFix={typeFix}
            onAddPage={canAddPage(grid) ? () => setGrid((g) => addPage(g)) : undefined}
            onRemovePage={(i) => setGrid((g) => removePage(g, i))}
            focusCell={focusCell}
          />
        </>
      )}
    </div>
  );
}
