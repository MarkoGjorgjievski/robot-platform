import { useEffect, useRef, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Plus } from 'lucide-react';
import { SchemaGrid } from '../../../../../../components/schema/schema-grid';
import { SchemaImport } from '../../../../../../components/schema/schema-import';
import { StatusStrip } from '../../../../../../components/schema/status-strip';
import { StepperStrip } from '../../../../../../components/schema/stepper-strip';
import { Button } from '../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../components/ui/skeleton';
import { TYPE_LABELS, type FieldType } from '../../../../../../lib/fields-view';
import {
  URL_COUNT,
  addPage,
  applyImportToRows,
  bindingProblems,
  canAddPage,
  emptyRow,
  emptyState,
  fromSource,
  isComplete,
  planArrival,
  reconcileRows,
  removePage,
  toBindingInput,
  type GridRow,
  type GridState,
} from '../../../../../../lib/site/schema-grid';
import { columnStates, stripState, stripSummary, thinEvidenceNote, typeFixSuggestion, verifyButton, type TimeEstimate } from '../../../../../../lib/site/schema-tab-view';
import { sharedNote, stepOf, stepStates } from '../../../../../../lib/site/schema-stepper-view';
import { cellStatusFor, reverifyKeys, verificationState, type CellStatus, type VerificationResults } from '../../../../../../lib/site/verification-view';
import { cellIsStale, saveButton } from '../../../../../../lib/site/schema-screen-view';
import { trpc } from '../../../../../../lib/trpc';
import { useProject } from '../../../$project';
import { useSite } from '../$site';

/**
 * Which step is open lives in the URL, so it survives a reload and can be
 * linked to; `addPage`/`field` are how a run's missed-products list sends a
 * page here (spec 2026-09-17 §6).
 *
 * Every key is optional, and the annotation is what makes that true for the
 * router as well: a schema whose properties are required — even as `| undefined`
 * — makes `search` a required prop on every `<Link>` to this route anywhere in
 * the app, sidebar and command palette included.
 */
export type SchemaSearch = { step?: 'fields' | 'pages'; addPage?: string; field?: string };

export const Route = createFileRoute('/_app/projects/$project/sites/$site/')({
  validateSearch: (search: Record<string, unknown>): SchemaSearch => ({
    ...(search.step === 'fields' || search.step === 'pages' ? { step: search.step } : {}),
    ...(typeof search.addPage === 'string' ? { addPage: search.addPage } : {}),
    ...(typeof search.field === 'string' ? { field: search.field } : {}),
  }),
  component: SchemaTab,
});

/** The website's own copy of the contract — one row per field, with this website's hint. */
type DefinitionField = { key: string; name: string; type: FieldType; description: string };

function definitionOf(schemaDefinition: unknown): DefinitionField[] {
  return Array.isArray(schemaDefinition) ? (schemaDefinition as DefinitionField[]) : [];
}

/**
 * Schema: the two steps that make a website verifiable — the fields it
 * collects, and the proof pages with what each field should read on them. The
 * website layout owns the title and the tab strip; this is the panels.
 */
function SchemaTab() {
  const { project: projectSlug, site: siteSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const site = useSite();
  const project = useProject();
  const source = site.data;

  const [grid, setGrid] = useState<GridState>(emptyState());
  const [error, setError] = useState<string | null>(null);
  // A grid freshly seeded from the website must not scream about empty cells
  // nobody has touched; this flips on the first edit, and on a click at the
  // disabled Verify button.
  const [touched, setTouched] = useState(false);
  // Which button is spinning. `updateBinding.isPending` cannot answer that on
  // its own: Verify saves through the same mutation, and for the window before
  // `verify` is called `verifyMutation.isPending` is still false — so the Save
  // button would spin for a run it did not start.
  const [savingOnly, setSavingOnly] = useState(false);
  const [importIgnored, setImportIgnored] = useState<string[]>([]);
  const initialized = useRef(false);
  // A state twin of `initialized`: the arrival effect must never plan against
  // `grid` until a render has committed the seeded grid, and only a state value
  // — not a ref, which mutates synchronously mid-commit — can say so.
  const [seeded, setSeeded] = useState(false);

  const updateGrid: typeof setGrid = (value) => {
    setTouched(true);
    setGrid(value);
  };

  // Declared before the status query: its `stallMs` is what tells the poll
  // whether an in-flight row is really in flight or is a crash leftover.
  const stallQuery = trpc.sources.verifyEstimate.useQuery({ sourceId: source?.id ?? '' }, { enabled: !!source });
  const stallMs = stallQuery.data?.stallMs;

  const statusQuery = trpc.sources.verificationStatus.useQuery(
    { sourceId: source?.id ?? '' },
    {
      enabled: !!source,
      // Only while genuinely active: a stalled row is never coming back on its
      // own, and polling it forever is what used to wedge this screen.
      refetchInterval: (query) => (verificationState(query.state.data ?? null, { stallMs }) === 'active' ? 3000 : false),
    },
  );

  const updateBinding = trpc.sources.updateBinding.useMutation();
  const verifyMutation = trpc.sources.verify.useMutation();
  const findPages = trpc.sources.findProductPages.useMutation();

  // Retypes a field to `url` from the grid's chip. The seeding effect will not
  // run again, so the row's type is patched locally here too.
  const retype = trpc.datasets.retypeField.useMutation({
    onSuccess: (_data, vars) => {
      void utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug });
      void utils.projects.get.invalidate();
      setGrid((g) => ({ ...g, rows: g.rows.map((r) => (r.key === vars.key ? { ...r, type: 'url' } : r)) }));
    },
  });

  // Seed the grid once the website loads. After that local edits are the truth
  // — a background refetch must never clobber what is being typed. Not a
  // customer edit, so it does not flip `touched`.
  useEffect(() => {
    if (initialized.current || !source) return;
    const saved = fromSource(source);
    if (saved) {
      setGrid(saved);
    } else {
      const definition = definitionOf(source.schemaDefinition);
      setGrid({
        urls: Array(URL_COUNT).fill(''),
        listingUrl: '',
        // A truly empty contract seeds no rows at all: `emptyState`'s placeholder
        // row would otherwise leak problems for a grid that is never shown.
        rows: definition.map((f) => ({ ...emptyRow(), key: f.key, name: f.name, type: f.type, description: f.description })),
      });
    }
    initialized.current = true;
    setSeeded(true);
  }, [source]);

  // The project's field list can change under an open tab. `reconcileRows`
  // appends, drops and renames without losing typed cells, and returns every
  // row it did not touch as the same object — so the identity check below
  // makes this safe to run on every refetch.
  useEffect(() => {
    if (!seeded || !source) return;
    const definition = definitionOf(source.schemaDefinition);
    setGrid((g) => {
      const next = reconcileRows(g.rows, definition, g.urls.length);
      if (next.length === g.rows.length && next.every((r, i) => r === g.rows[i])) return g;
      return { ...g, rows: next };
    });
  }, [source, seeded]);

  const status = statusQuery.data ?? null;
  const results = (status?.results ?? null) as VerificationResults | null;
  const strip = stripState({ verification: verificationState(status, { stallMs }), results });
  const active = strip === 'active';

  // Arrival from a run: `?addPage=<url>&field=<key>` for a field that needs
  // another proof page. Nothing is consumed while the table is locked, and the
  // effect re-runs once the lock lifts.
  const arrival = useRef(false);
  const [arrivalNote, setArrivalNote] = useState<string | null>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col: number } | null>(null);
  useEffect(() => {
    if (arrival.current || !search.addPage) return;
    const plan = planArrival(grid, { addPage: search.addPage, field: search.field, locked: active, ready: seeded });
    switch (plan.kind) {
      case 'none':
        return;
      case 'wait':
        setArrivalNote(plan.note);
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
  // `savedGrid` is null for a website that never had a schema saved — treated
  // as "saved: nothing", so anything typed reads as dirty.
  const dirty = JSON.stringify(toBindingInput(grid)) !== JSON.stringify(toBindingInput(savedGrid ?? emptyState()));
  const problems = bindingProblems(grid);
  const definition = definitionOf(source?.schemaDefinition);
  const fieldCount = definition.length;
  const contractEmpty = fieldCount === 0;
  const showProblems = touched && !contractEmpty && problems.length > 0;

  // With no `?step` at all `stepOf` answers 'pages' the moment the project has
  // a field, so a customer's own first chip would finish step 1 under their
  // hands. Pinned the first time the tab opens on step 1 by itself.
  useEffect(() => {
    if (!source || search.step || fieldCount > 0) return;
    void navigate({
      to: '/projects/$project/sites/$site',
      params: { project: projectSlug, site: siteSlug },
      search: (s) => ({ ...s, step: 'fields' as const }),
      replace: true,
    });
  }, [source, search.step, fieldCount, navigate, projectSlug, siteSlug]);

  const currentKeys = status?.currentKeys ?? [];

  /** The screen's own rule, tested in `lib/site/schema-screen-view.ts`. */
  const isStale = (row: GridRow, urlIndex: number) =>
    cellIsStale({ row, grid, savedGrid, results, currentKeys, urlIndex });

  const keyed = grid.rows.filter((r) => r.key);
  const staleKeys = keyed.filter((r) => grid.urls.some((_, i) => isStale(r, i))).map((r) => r.key!);
  const failingKeys = keyed
    .filter((r) => !staleKeys.includes(r.key!) && results?.[r.key!] && results[r.key!]!.certified.length === 0)
    .map((r) => r.key!);
  const reverify = reverifyKeys(results, grid, savedGrid, currentKeys); // undefined = everything
  const reverifyCount = reverify === undefined ? keyed.length : reverify.length;
  const firstRun = strip === 'editing' || strip === 'none';
  const estimateQuery = trpc.sources.verifyEstimate.useQuery(
    { sourceId: source?.id ?? '', ...(firstRun ? {} : { onlyKeys: reverify ?? undefined }) },
    { enabled: !!source },
  );
  const estimate = estimateQuery.data;

  // The rough time is frozen for the life of a run: `estimateQuery` already
  // describes the NEXT one, so reading it live would let "about 2 min" shrink
  // to "a few seconds" while the same run is still going.
  const [runEstimate, setRunEstimate] = useState<TimeEstimate | null>(null);
  const sawActive = useRef(false);
  useEffect(() => {
    if (active) {
      sawActive.current = true;
      return;
    }
    if (sawActive.current) {
      sawActive.current = false;
      setRunEstimate(null);
    }
  }, [active]);

  const busy = updateBinding.isPending || verifyMutation.isPending;
  const verify = verifyButton({
    state: strip,
    firstRun,
    reverifyCount,
    capturesFresh: !!estimate?.capturesFresh,
    aiAvailable: !!estimate?.aiAvailable,
    upperBoundUsd: estimate?.upperBoundUsd ?? 0,
    complete: isComplete(grid) && !contractEmpty,
    busy,
  });
  const captures = (status?.captures ?? {}) as Record<string, { captureId?: string; blockedReason?: string; screenshotUrl?: string }>;
  const columns = columnStates({ urls: grid.urls, state: strip, stage: status?.stage ?? null, captures });
  const progress = active
    ? (() => {
        const m = /^capturing (\d+)\/(\d+)/.exec(status?.stage ?? '');
        return m ? (Number(m[1]) - 1) / Number(m[2]) : status?.stage ? 0.9 : 0.05;
      })()
    : null;

  const summary = stripSummary({
    state: strip,
    fieldCount: keyed.length,
    pageCount: grid.urls.length,
    currentKeys,
    failingKeys,
    staleKeys,
    estimate: active ? runEstimate : (estimate ?? null),
  });
  const stage = active ? (status?.stage ?? 'starting') : null;
  const note = strip === 'failed' ? (status?.errorMessage ?? 'The last verification failed.') : null;
  const tone = strip === 'stalled' ? 'warn' : strip === 'failed' ? 'fail' : 'neutral';

  function cellStatus(rowId: string, urlIndex: number): CellStatus | null {
    const row = grid.rows.find((r) => r.id === rowId);
    if (!row) return null;
    const base = cellStatusFor(results, row.key ?? '', grid.urls[urlIndex] ?? '', isStale(row, urlIndex), row.type);
    if (base?.status === 'fail' && estimate && !estimate.aiAvailable) {
      return { ...base, hint: `${base.hint} AI is unavailable on this machine, so only the mechanical search ran.` };
    }
    return base;
  }

  function typeFix(rowId: string) {
    const row = grid.rows.find((r) => r.id === rowId);
    if (!row?.key || !source?.datasetId) return null;
    const suggested = typeFixSuggestion(row, grid.urls.map((_, i) => cellStatus(rowId, i)));
    if (!suggested) return null;
    return {
      suggested,
      pending: retype.isPending && retype.variables?.key === row.key,
      error: retype.error && retype.variables?.key === row.key ? retype.error.message : undefined,
      onApply: () => retype.mutate({ datasetId: source.datasetId!, key: row.key!, type: 'url' }),
    };
  }

  /**
   * Save the pages and values without spending anything.
   *
   * It invalidates everything a verify does, and for the same reason: a
   * field's `fieldHash` covers its description, the pages it is checked on and
   * its expected values, and `verificationStatus` recomputes `currentKeys` per
   * request. So a save on a verified website makes the server stop counting
   * those fields current — while the strip, which only polls during a run,
   * would go on saying "n of n fields verified" with Go to Extract live until
   * something else happened to refetch. `projects.get` is in the set because
   * the project page's per-website verified badge reads the same currency.
   */
  async function handleSave() {
    if (!source) return;
    setError(null);
    setSavingOnly(true);
    try {
      const saved = await updateBinding.mutateAsync({ sourceId: source.id, ...toBindingInput(grid) });
      const refreshed = fromSource(saved);
      if (refreshed) setGrid(refreshed);
      await Promise.all([
        utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug }),
        utils.projects.get.invalidate(),
        utils.sources.verifyEstimate.invalidate({ sourceId: source.id }),
        utils.sources.verificationStatus.invalidate({ sourceId: source.id }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingOnly(false);
    }
  }

  async function handleVerify() {
    if (!source) return;
    setError(null);
    // Frozen before anything can move it: `estimate` is priced against exactly
    // the fields this run is about to do.
    setRunEstimate(estimate ?? null);
    try {
      // The pre-save baseline, captured before `updateBinding` catches the
      // website's saved definition up to the grid.
      const priorResults = results;
      const priorSavedGrid = savedGrid;
      const priorCurrentKeys = currentKeys;

      let latest: { schemaDefinition: unknown; verificationSet: unknown } = source;
      if (dirty) {
        latest = await updateBinding.mutateAsync({ sourceId: source.id, ...toBindingInput(grid) });
        const refreshed = fromSource(latest);
        if (refreshed) setGrid(refreshed);
      }

      const onlyKeys = reverifyKeys(priorResults, fromSource(latest) ?? grid, priorSavedGrid, priorCurrentKeys);
      await verifyMutation.mutateAsync({ sourceId: source.id, onlyKeys });

      await Promise.all([
        utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug }),
        utils.projects.get.invalidate(),
        utils.sources.verifyEstimate.invalidate({ sourceId: source.id }),
        utils.sources.verificationStatus.invalidate({ sourceId: source.id }),
      ]);
    } catch (err) {
      setRunEstimate(null); // the run never started, so nothing is frozen
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (site.isPending) {
    return (
      <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
        <Skeleton className="h-[22px] w-64 bg-raised" />
        <Skeleton className="mt-3 h-[22px] w-full bg-raised" />
        <Skeleton className="mt-2 h-[22px] w-full bg-raised" />
      </div>
    );
  }
  if (!source) return null; // the layout has already said what went wrong

  const websiteCount = project.data?.websites.length ?? 0;
  const step = stepOf(search, fieldCount);
  const [s1, s2] = stepStates(step, fieldCount);
  const extractEnabled = !!(status?.current && status?.allPassed);
  const thin = thinEvidenceNote(results, grid.rows);

  return (
    <>
      <StepperStrip
        project={projectSlug}
        site={siteSlug}
        steps={[
          {
            step: 'fields',
            n: 1,
            title: 'Fields',
            detail: fieldCount ? `${fieldCount} field${fieldCount === 1 ? '' : 's'}${sharedNote(websiteCount) ? ` · ${sharedNote(websiteCount)}` : ''}` : 'none yet',
            state: s1,
          },
          {
            step: 'pages',
            n: 2,
            title: 'Pages and values',
            detail: `${grid.urls.length} page${grid.urls.length === 1 ? '' : 's'} of this website`,
            reason: 'Add a field first',
            state: s2,
          },
        ]}
      />

      {step === 'fields' ? (
        <FieldsPanel projectSlug={projectSlug} siteSlug={siteSlug} fields={definition} websiteCount={websiteCount} />
      ) : (
        <div className="space-y-3">
          {showProblems ? (
            <div role="alert" className="rise border-l-2 border-fail pl-3">
              <ul className="list-inside list-disc text-sm text-fail">
                {/* Keyed by position: two rows can genuinely produce the same
                    sentence, and this list is only ever re-derived whole. */}
                {problems.map((p, i) => (
                  <li key={`${i}-${p}`}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <StatusStrip
            summary={summary}
            stage={stage}
            progress={progress}
            note={note}
            tone={tone}
            lockNote={active ? 'the table is locked while this runs' : null}
            save={{
              label: 'Save pages and values',
              ...saveButton({ dirty, problems, active, busy }),
              busy: savingOnly,
              onClick: () => {
                setTouched(true);
                void handleSave();
              },
            }}
            verify={{ ...verify, busy, onClick: () => void handleVerify(), onDisabledClick: () => setTouched(true) }}
            extract={{
              disabled: !extractEnabled,
              reason: 'Unlocks when every cell is green',
              project: projectSlug,
              site: siteSlug,
            }}
          />

          {thin ? <p className="text-sm text-warn">{thin}</p> : null}
          {error ? (
            <p role="alert" className="text-sm whitespace-pre-line text-fail">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <SchemaImport
              urlCount={grid.urls.length}
              disabled={active}
              onRows={(rows) => {
                const applied = applyImportToRows(grid.rows, rows);
                updateGrid((g) => ({ ...g, rows: applied.rows }));
                setImportIgnored(applied.ignored);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={active || !canAddPage(grid)}
              onClick={() => updateGrid((g) => addPage(g))}
            >
              <Plus />
              Add page
            </Button>
            {/* Every disabled control says why, within a line of it. */}
            {!canAddPage(grid) ? (
              <span className="text-sm text-muted-foreground">Six pages is the most a website can be checked on</span>
            ) : null}
            {importIgnored.length > 0 ? (
              <span className="text-sm text-warn">Not in this project, so skipped: {importIgnored.join(', ')}</span>
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground">
            Field names and types come from the project.{' '}
            <Link to="/projects/$project/fields" params={{ project: projectSlug }} className="text-link underline-offset-4 hover:underline">
              Edit fields
            </Link>
          </p>

          {arrivalNote ? <p className="text-sm text-muted-foreground">{arrivalNote}</p> : null}

          <SchemaGrid
            state={grid}
            onChange={updateGrid}
            cellStatus={cellStatus}
            columnStates={columns}
            captures={captures}
            readOnly={active}
            onFindPages={async (u) => (await findPages.mutateAsync({ listingUrl: u })).urls}
            typeFix={typeFix}
            onRemovePage={(i) => updateGrid((g) => removePage(g, i))}
            focusCell={focusCell}
          />
        </div>
      )}
    </>
  );
}

/**
 * Step 1: what this website collects. The list is read-only here because a
 * field belongs to the project, not to one of its websites — editing it is one
 * link away, on the surface that owns it (spec 2026-09-18 §2.1).
 */
function FieldsPanel({
  projectSlug,
  siteSlug,
  fields,
  websiteCount,
}: {
  projectSlug: string;
  siteSlug: string;
  fields: DefinitionField[];
  websiteCount: number;
}) {
  const note = sharedNote(websiteCount);
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-base font-medium">
          {fields.length === 0
            ? 'No fields yet'
            : `${fields.length} field${fields.length === 1 ? '' : 's'}${note ? ` · ${note}` : ''}`}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects/$project/fields" params={{ project: projectSlug }}>
            Edit fields
          </Link>
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="px-4 py-5 text-base text-muted-foreground">
          This website collects nothing yet. Pick the fields on the project, then come back for its pages.
        </p>
      ) : (
        <ul className="px-4 py-2">
          {fields.map((f) => (
            <li key={f.key} className="flex items-baseline gap-2 border-b border-line py-1.5 last:border-0">
              <span className="min-w-0 truncate text-text">{f.name}</span>
              <span aria-hidden className="text-faint">
                ·
              </span>
              <span className="shrink-0 text-sm text-muted-foreground">{TYPE_LABELS[f.type]}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        {fields.length === 0 ? (
          <>
            <Button size="sm" disabled>
              Next: pages and values
              <ArrowRight />
            </Button>
            <span className="text-sm text-muted-foreground">Add a field first</span>
          </>
        ) : (
          <Button size="sm" asChild>
            <Link
              to="/projects/$project/sites/$site"
              params={{ project: projectSlug, site: siteSlug }}
              search={(s) => ({ ...s, step: 'pages' as const })}
            >
              Next: pages and values
              <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
