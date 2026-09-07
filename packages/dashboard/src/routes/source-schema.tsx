import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { Loader2, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { screenshotUrl } from '../lib/screenshot-url';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { SchemaGrid, type CellStatus } from '../components/schema-grid';
import { emptyState, fromSource, isComplete, toSchemaInput, type GridRow, type GridState } from '../lib/schema-grid';
import { cellStatusFor, isRowStale, isVerificationActive, summaryLine, type FieldVerification, type VerificationResults } from '../lib/verification-view';

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
  const { project: projectSlug, source: sourceSlug } = useParams({ from: '/p/$project/sources/$source' });
  const utils = trpc.useUtils();

  const [grid, setGrid] = useState<GridState>(emptyState());
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const listQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);

  const statusQuery = trpc.sources.verificationStatus.useQuery(
    { sourceId: source?.id ?? '' },
    { enabled: !!source, refetchInterval: (query) => (isVerificationActive(query.state.data ?? null) ? 3000 : false) },
  );
  const estimateQuery = trpc.sources.verifyEstimate.useQuery({ sourceId: source?.id ?? '' }, { enabled: !!source });

  const updateSchemaMutation = trpc.sources.updateSchema.useMutation();
  const verifyMutation = trpc.sources.verify.useMutation();
  const planMutation = trpc.crawl.plan.useMutation();
  const executeMutation = trpc.crawl.execute.useMutation();
  const probeMutation = trpc.crawl.probeAndSample.useMutation();
  const extractPending = planMutation.isPending || executeMutation.isPending || probeMutation.isPending;

  // Seed the grid once the Source loads. After that, local edits are the
  // source of truth — a background refetch of `listByProject` (e.g. from
  // the verify-triggered invalidation below) must never clobber what the
  // operator is mid-typing.
  useEffect(() => {
    if (initialized.current || !source) return;
    const seeded = fromSource(source);
    if (seeded) {
      setGrid(seeded);
      initialized.current = true;
    }
  }, [source]);

  const status = statusQuery.data ?? null;
  const active = isVerificationActive(status);
  const savedGrid = source ? fromSource(source) : null;
  const results = (status?.results ?? null) as VerificationResults | null;
  const estimate = estimateQuery.data;

  // `savedGrid` is null for a Source that predates this feature (never had a
  // schema saved) — treated as "saved: nothing" so any grid the operator
  // fills in reads as dirty, not as already matching a saved state.
  const isDirty = JSON.stringify(toSchemaInput(grid)) !== JSON.stringify(toSchemaInput(savedGrid ?? emptyState()));

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

  /** A row needs re-verifying when it's stale, or its last result wasn't a full pass (never checked, or any red cell). */
  function needsReverify(row: GridRow): boolean {
    if (isRowStale(row, savedGrid)) return true;
    const fv: FieldVerification | undefined = row.key ? (results?.[row.key] ?? undefined) : undefined;
    if (!fv) return true;
    return fv.certified.length === 0;
  }

  async function handleVerify() {
    if (!source) return;
    setError(null);
    try {
      // Scope a re-verify to red/stale fields once there's a previous run to
      // compare against — matched by NAME (not key), since a brand-new,
      // unsaved field has no key yet until `updateSchema` assigns one below.
      const namesNeedingVerify = results ? new Set(grid.rows.filter(needsReverify).map((r) => r.name.trim())) : null;

      let latestDefinition: { schemaDefinition: unknown; verificationSet: unknown } = source;
      if (isDirty) {
        latestDefinition = await updateSchemaMutation.mutateAsync({ sourceId: source.id, ...toSchemaInput(grid) });
        const refreshed = fromSource(latestDefinition);
        if (refreshed) setGrid(refreshed);
      }

      let onlyKeys: string[] | undefined;
      if (namesNeedingVerify) {
        const latestGrid = fromSource(latestDefinition) ?? grid;
        onlyKeys = latestGrid.rows.filter((r) => r.key && namesNeedingVerify.has(r.name.trim())).map((r) => r.key!);
      }

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
        // every one of them — no probe gate for a Source already pointed
        // straight at product pages.
        const plan = await planMutation.mutateAsync({ sourceId: source.id, probe: false });
        await executeMutation.mutateAsync({ runId: plan.runId });
        navigate({ to: '/p/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: plan.runId } });
        return;
      }
      if (!source.confirmedAt) {
        // Listing, unconfirmed: probe the first input + sample a few
        // details. The run-detail page's confirm gate takes it from here.
        const probe = await probeMutation.mutateAsync({ sourceId: source.id });
        navigate({ to: '/p/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: probe.runId } });
        return;
      }
      // Listing, already confirmed: a full plan across every input row.
      const plan = await planMutation.mutateAsync({ sourceId: source.id, probe: false });
      navigate({ to: '/p/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: plan.runId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  const verifyLabel = !estimate
    ? 'Verify'
    : estimate.aiAvailable
      ? `Verify · up to $${estimate.upperBoundUsd.toFixed(2)}`
      : 'Verify · mechanical only';
  const verifyBusy = updateSchemaMutation.isPending || verifyMutation.isPending;
  const verifyDisabled = active || !isComplete(grid) || verifyBusy;
  const extractEnabled = !!(status?.current && status?.allPassed);

  const captures = (status?.captures ?? {}) as Record<string, { blockedReason?: string; screenshotUrl?: string }>;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{summaryLine(results)}</p>
          {active && status?.stage && <p className="mt-0.5 text-xs text-gray-500">{status.stage}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button type="button" className="btn-quiet h-9" disabled={verifyDisabled} onClick={handleVerify}>
            {verifyBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {verifyLabel}
          </button>
          <button type="button" className="btn-primary h-9" disabled={!extractEnabled || extractPending} onClick={handleExtract}>
            {extractPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Extract
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

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

      <div className="card mt-4 p-4">
        <SchemaGrid state={grid} onChange={setGrid} cellStatus={cellStatus} disabled={active} />
      </div>
    </div>
  );
}
