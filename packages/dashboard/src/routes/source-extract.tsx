// packages/dashboard/src/routes/source-extract.tsx
// The Extract tab (phase 4): three steps — Pages, Sample, Run — over one
// website whose schema has already gone green on the Schema tab.
//
// This file is wiring only. Every decision it makes is a pure function in
// `lib/extract-view.ts` (which step is current, what the locked strip says,
// what the budget sentence means) and every pixel is one of the three section
// components. What lives here is the data: which queries feed which prop,
// which mutation each button runs, and what gets invalidated afterwards.
//
// The rule the tab is built on (see `stepper.tsx`): nothing disappears. A
// finished step keeps its content on screen behind "Edit"; an unreachable one
// stays visible, dimmed, saying why. So there is no wizard state machine here
// — `stepStates` derives all three states from saved data on every render, and
// the only local override is `editing`, which reopens one section until it is
// saved again.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { StatusStrip } from '../components/status-strip';
import { Stepper, Section, type Step } from '../components/stepper';
import { ExtractPages, type ListingCheck } from '../components/extract-pages';
import { ExtractSample } from '../components/extract-sample';
import { ExtractRun } from '../components/extract-run';
import { parseUrlLines } from '../lib/parse-url-lines';
import { parseCsv } from '../lib/csv';
import { isRunActive, progressLabel } from '../lib/run-progress';
import {
  budgetFromForm,
  budgetToForm,
  lockedStripText,
  productUrlCounts,
  runSentence,
  stepStates,
  type ExtractMode,
  type StepState,
} from '../lib/extract-view';

const TITLES = ['Pages', 'Sample', 'Run'] as const;
const HINTS = [
  'where the products come from',
  'proof that the walk works before anything runs at scale',
  'how much, then go',
] as const;

/** Why a section is dimmed. The locked one is the same for all three: the schema is not green yet. */
const LOCKED_REASON = 'Verify every field on the Schema tab first';

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `editing` reopens exactly one section: it becomes `current` and everything
 * after it goes back to `later`, because a step's evidence is only as good as
 * the step before it. Earlier sections keep whatever `stepStates` said.
 */
function withEditing(states: [StepState, StepState, StepState], editing: number | null): [StepState, StepState, StepState] {
  if (editing === null) return states;
  return states.map((state, i) =>
    i + 1 === editing ? 'current' : i + 1 > editing ? 'later' : state,
  ) as [StepState, StepState, StepState];
}

export default function SourceExtract() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/projects/$project/sources/$source/extract',
  });
  const utils = trpc.useUtils();

  const listQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  const sourceId = source?.id ?? '';

  const statusQuery = trpc.sources.verificationStatus.useQuery({ sourceId }, { enabled: !!source });
  const rowsQuery = trpc.sources.inputRows.useQuery({ sourceId }, { enabled: !!source });
  const runsQuery = trpc.runs.listBySource.useQuery({ sourceId }, { enabled: !!source });
  const contractQuery = trpc.datasets.getContract.useQuery(
    { datasetId: source?.datasetId ?? '' },
    { enabled: !!source?.datasetId },
  );

  const [mode, setMode] = useState<ExtractMode | null>(null);
  const [listing, setListing] = useState<string[]>([]);
  const [productText, setProductText] = useState('');
  const [checks, setChecks] = useState<Record<string, ListingCheck>>({});
  const [budget, setBudget] = useState<{ items: number | 'all'; pages: number | 'all' }>({ items: 'all', pages: 'all' });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const seeded = useRef(false);

  const checkMutation = trpc.sources.checkListingPage.useMutation();
  const listingPagesMutation = trpc.sources.setListingPages.useMutation();
  const productUrlsMutation = trpc.sources.setProductUrls.useMutation();
  const updateMutation = trpc.sources.update.useMutation();
  const probeMutation = trpc.crawl.probeAndSample.useMutation();
  const confirmMutation = trpc.sources.confirm.useMutation();
  const planMutation = trpc.crawl.plan.useMutation();
  const executeMutation = trpc.crawl.execute.useMutation();

  const parameters = (source?.parameters ?? null) as { inputMode?: ExtractMode } | null;
  const savedMode = parameters?.inputMode ?? null;
  const urlCount = source?.urlCount ?? 0;

  // Seeded once, from saved data, and never again: after this the local state
  // is what the operator is editing, and a background refetch (the
  // invalidation after a save, say) must not type over them.
  useEffect(() => {
    if (seeded.current || !source || !rowsQuery.data) return;
    const initialMode: ExtractMode | null =
      savedMode ??
      (source.listingMode === 'listing_to_detail'
        ? 'listing'
        : source.listingMode === 'detail' && urlCount > 0
          ? 'detail'
          : null);
    setMode(initialMode);
    const urls = rowsQuery.data.urls;
    if (initialMode === 'listing') setListing(urls);
    if (initialMode === 'detail') setProductText(urls.join('\n'));
    setBudget(budgetToForm(source.budget));
    seeded.current = true;
  }, [source, rowsQuery.data, savedMode, urlCount]);

  // Every listing page on screen carries a check, including the ones that were
  // already saved when the tab opened — a listing that has since stopped
  // yielding product links is exactly what step 1 exists to show, and a stored
  // count from some earlier day would not show it. The check is free (one page
  // load, no AI), and it runs once per mount for URLs that have no result yet.
  const checked = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== 'listing') return;
    for (const url of listing) {
      if (checked.current.has(url)) continue;
      void runCheck(url);
    }
  }, [mode, listing]);

  async function runCheck(url: string) {
    // Marked here, not in the effect: `ExtractPages` calls `onCheck` for a URL
    // it has just added, in the same handler that added it, so the effect must
    // find it already claimed or the new page would be checked twice.
    checked.current.add(url);
    setChecks((prev) => ({ ...prev, [url]: null })); // null renders as "checking…"
    try {
      const result = await checkMutation.mutateAsync({ listingUrl: url });
      setChecks((prev) => ({ ...prev, [url]: { productLinks: result.productLinks, pagerSeen: result.pagerSeen } }));
    } catch (err) {
      setChecks((prev) => ({ ...prev, [url]: { error: message(err) } }));
    }
  }

  const status = statusQuery.data ?? null;
  const green = !!(status?.current && status?.allPassed);
  const contract = useMemo(() => contractQuery.data ?? [], [contractQuery.data]);
  const currentKeys = status?.currentKeys ?? [];

  const runRows = runsQuery.data ?? [];
  // `listBySource` is newest-first, so the first match is the latest.
  const latestProbe = runRows.find((r) => r.inputLabel === 'probe') ?? null;

  /**
   * Has the sample finished producing its evidence?
   *
   * `stepStates` unlocks step 3 on a `completed` sample. A probe that
   * extracted some rows and gave up on the rest finalises `partial` — the
   * ordinary outcome of a three-product sample where one page 404s or a
   * certified path misses — and that run is terminal: it will never become
   * `completed`, no matter how long the tab waits. Its evidence is the same
   * evidence. So a terminal probe that produced rows is handed to
   * `stepStates` as the finished sample it is, rather than leaving Run
   * permanently out of reach behind a run that is already over.
   */
  const sampleFinished = !!(
    latestProbe &&
    (latestProbe.status === 'completed' || (latestProbe.status === 'partial' && (latestProbe.resultCount ?? 0) > 0))
  );

  const rowsUpdatedAt = rowsQuery.data?.updatedAt ?? null;
  const sampleStale = !!(latestProbe && rowsUpdatedAt && rowsUpdatedAt > latestProbe.createdAt);

  const runStatusQuery = trpc.crawl.status.useQuery(
    { runId: startedRunId ?? '' },
    {
      enabled: !!startedRunId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s !== undefined && (s === 'planning' || s === 'planned' || isRunActive(s)) ? 2000 : false;
      },
    },
  );

  const running = startedRunId !== null;
  // Saved, not merely typed: `inputMode` is the marker `setListingPages`/
  // `setProductUrls` write, so a legacy website whose input set predates the
  // Extract tab starts at step 1 with its rows already in the box, rather
  // than claiming pages it never confirmed.
  const pagesSaved = urlCount > 0 && savedMode !== null;
  const states = withEditing(
    stepStates({
      schemaGreen: green,
      mode,
      pagesSaved,
      sampleRun: latestProbe ? { status: sampleFinished ? 'completed' : latestProbe.status } : null,
      running,
    }),
    editing,
  );

  const steps: Step[] = TITLES.map((title, i) => ({ n: i + 1, title, detail: HINTS[i]!, state: states[i]! }));

  const verificationSet = (source?.verificationSet ?? null) as { urls?: string[] } | null;
  const proofUrls = verificationSet?.urls ?? [];
  const host = hostOf(proofUrls[0] ?? source?.urlTemplate);
  const productCounts = productUrlCounts(productText.split('\n'), proofUrls, host);

  const firstFailing = contract.find((f) => !currentKeys.includes(f.key));
  const stripText = lockedStripText({
    fieldCount: contract.length,
    currentKeys,
    firstFailing: firstFailing?.name ?? null,
  });

  const savingPages = listingPagesMutation.isPending || productUrlsMutation.isPending;
  const extracting =
    updateMutation.isPending || confirmMutation.isPending || planMutation.isPending || executeMutation.isPending;

  async function handleSave() {
    if (!source || !mode) return;
    setError(null);
    setSaveNote(null);
    try {
      if (mode === 'listing') {
        await listingPagesMutation.mutateAsync({ sourceId: source.id, urls: listing });
      } else {
        const { urls } = parseUrlLines(productText);
        const result = await productUrlsMutation.mutateAsync({ sourceId: source.id, urls });
        if (result.skipped.length > 0) {
          setSaveNote(
            `${result.skipped.length} ${result.skipped.length === 1 ? 'URL is' : 'URLs are'} off this website, so ${result.skipped.length === 1 ? 'it was' : 'they were'} skipped.`,
          );
        }
      }
      await Promise.all([
        utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }),
        utils.sources.inputRows.invalidate({ sourceId: source.id }),
      ]);
      setEditing(null);
    } catch (err) {
      setError(message(err));
    }
  }

  /**
   * A CSV of product URLs. The `url` column when the file has a header row;
   * otherwise the first column, provided its first cell really is a URL — a
   * one-column export with no header is the commonest shape a customer sends,
   * and refusing it outright would be pedantry. Anything else is refused by
   * name rather than silently importing the wrong column.
   */
  async function handleImportCsv(file: File) {
    setError(null);
    try {
      const table = parseCsv(await file.text());
      const header = (table[0] ?? []).map((c) => c.trim().toLowerCase());
      const urlColumn = header.indexOf('url');
      let cells: string[];
      if (urlColumn >= 0) {
        cells = table.slice(1).map((row) => row[urlColumn] ?? '');
      } else if (parseUrlLines(table[0]?.[0] ?? '').urls.length === 1) {
        cells = table.map((row) => row[0] ?? '');
      } else {
        setError('That file needs a "url" column, or one column of URLs and no header row.');
        return;
      }
      const { urls } = parseUrlLines(cells.join('\n'));
      if (urls.length === 0) {
        setError('No URLs in that file.');
        return;
      }
      setProductText((prev) => (prev.trim() === '' ? urls.join('\n') : `${prev.replace(/\n+$/, '')}\n${urls.join('\n')}`));
    } catch (err) {
      setError(`Could not read the file: ${message(err)}`);
    }
  }

  async function handleSample() {
    if (!source) return;
    setError(null);
    try {
      await probeMutation.mutateAsync({ sourceId: source.id });
      await utils.runs.listBySource.invalidate({ sourceId: source.id });
    } catch (err) {
      setError(message(err));
    }
  }

  /**
   * Start the real run, at the budget on screen.
   *
   * The budget is saved first, and only when it actually differs from what is
   * stored — the run reads it from the Source row, so a dropdown the operator
   * moved but never saved would otherwise be a lie on screen.
   *
   * Then, per mode: an unconfirmed listing website graduates through
   * `sources.confirm` (which plans at full budget and stamps `confirmedAt`),
   * an already-confirmed one plans directly, and a product-URL website plans
   * its known pages. **Every branch then calls `crawl.execute`** — planning
   * only builds the work list, and a button that says Extract has to extract.
   * `execute` returns as soon as the loop is started (it is re-entrant by
   * design), so the run's progress is read back from `crawl.status` below.
   */
  async function handleExtract() {
    if (!source) return;
    setError(null);
    try {
      const stored = budgetToForm(source.budget);
      if (stored.items !== budget.items || stored.pages !== budget.pages) {
        await updateMutation.mutateAsync({ id: source.id, budget: budgetFromForm(budget.items, budget.pages) });
      }
      const runId =
        mode === 'listing' && !source.confirmedAt
          ? (await confirmMutation.mutateAsync({ sourceId: source.id })).runId
          : (await planMutation.mutateAsync({ sourceId: source.id, probe: false })).runId;
      await executeMutation.mutateAsync({ runId });
      setStartedRunId(runId);
      await Promise.all([
        utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }),
        utils.runs.listBySource.invalidate({ sourceId: source.id }),
      ]);
    } catch (err) {
      setError(message(err));
    }
  }

  if (listQuery.isLoading) return <Spinner label="Loading website..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  // "Extracting · 12 of 40" while the loop is working; the run page's own
  // wording (`progressLabel`) once it is planned-but-idle or finished, so the
  // two screens never describe the same run differently.
  const runStatus = runStatusQuery.data;
  const activeRun = startedRunId
    ? {
        id: startedRunId,
        label: !runStatus
          ? 'Starting…'
          : isRunActive(runStatus.status)
            ? `Extracting · ${runStatus.counts.done} of ${runStatus.counts.detail}`
            : progressLabel(runStatus.counts, runStatus.status),
      }
    : null;

  const listingCount = mode === 'listing' ? listing.length : productCounts.total;
  const extractBlocked = !green || !pagesSaved || (mode === 'listing' && !sampleFinished);
  const extractReason = !pagesSaved
    ? mode === 'detail'
      ? 'Save your URLs first'
      : 'Save your pages first'
    : mode === 'listing' && !sampleFinished
      ? 'Sample first'
      : undefined;

  return (
    <div className="mt-6 space-y-4">
      {!green && (
        <StatusStrip
          summary={stripText}
          tone="warn"
          action={
            <Link
              to="/projects/$project/sources/$source"
              params={{ project: projectSlug, source: sourceSlug }}
              className="text-xs text-accent-800 underline-offset-2 hover:underline"
            >
              Go to the Schema tab
            </Link>
          }
        />
      )}

      <Stepper steps={steps} />

      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

      <Section
        n={1}
        title={TITLES[0]}
        hint={HINTS[0]}
        reason={green ? undefined : LOCKED_REASON}
        state={states[0]}
        onEdit={() => {
          setSaveNote(null);
          setEditing(1);
        }}
      >
        <ExtractPages
          mode={mode}
          onMode={setMode}
          listing={listing}
          onListing={(urls) => {
            setListing(urls);
            // A removed page takes its check with it — and is forgotten, so
            // pasting it back checks it again rather than showing "checking…"
            // for a request that will never be made.
            const kept = new Set(urls);
            for (const url of checked.current) if (!kept.has(url)) checked.current.delete(url);
            setChecks((prev) => Object.fromEntries(Object.entries(prev).filter(([url]) => kept.has(url))));
          }}
          checks={checks}
          onCheck={(url) => void runCheck(url)}
          productText={productText}
          onProductText={setProductText}
          proofUrls={proofUrls}
          host={host}
          onImportCsv={(file) => void handleImportCsv(file)}
          onSave={() => void handleSave()}
          saving={savingPages}
          readOnly={!green || states[0] !== 'current'}
        />
        {saveNote && <p className="mt-2 text-xs text-amber-800">{saveNote}</p>}
      </Section>

      <Section
        n={2}
        title={TITLES[1]}
        hint={HINTS[1]}
        reason={green ? 'Save your pages first' : LOCKED_REASON}
        state={states[1]}
        onEdit={() => setEditing(2)}
      >
        <ExtractSample
          mode={mode ?? 'listing'}
          runId={mode === 'listing' ? (latestProbe?.id ?? null) : null}
          sampling={probeMutation.isPending}
          onSample={() => void handleSample()}
          onSampleAgain={() => void handleSample()}
          columns={contract.map((f) => ({ key: f.key, name: f.name }))}
          stale={sampleStale}
          readOnly={!green}
        />
      </Section>

      <Section
        n={3}
        title={TITLES[2]}
        hint={HINTS[2]}
        reason={green ? (mode === 'detail' ? 'Save your URLs first' : 'Sample first') : LOCKED_REASON}
        state={states[2]}
      >
        <ExtractRun
          items={budget.items}
          pages={budget.pages}
          onChange={setBudget}
          sentence={runSentence(budget, listingCount)}
          onExtract={() => void handleExtract()}
          extracting={extracting}
          disabled={extractBlocked}
          // Only while the section is reachable. A dimmed section already says
          // why in place of its subtitle, and a second, differently-worded
          // reason beside the button ("Save your pages first" under a header
          // reading "Sample first") is one message too many.
          reason={states[2] === 'current' ? extractReason : undefined}
          activeRun={activeRun}
          projectSlug={projectSlug}
          sourceSlug={sourceSlug}
        />
      </Section>
    </div>
  );
}
