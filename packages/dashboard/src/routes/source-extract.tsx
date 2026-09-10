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
  sampleFinished,
  stepStates,
  type ExtractMode,
  type SampleRun,
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
  /** The Source id the local state was seeded from, so a `$source` change reseeds. */
  const seeded = useRef<string | null>(null);

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

  // Seeded once per website, from saved data: after that the local state is
  // what the operator is editing, and a background refetch (the invalidation
  // after a save, say) must not type over them. Keyed on the Source's id, not
  // a bare boolean, so navigating from one website's Extract tab to another's
  // — the router reuses this component — reseeds instead of leaving the first
  // website's pages on screen.
  useEffect(() => {
    if (!source || !rowsQuery.data) return;
    if (seeded.current === source.id) return;
    const initialMode: ExtractMode | null =
      savedMode ??
      (source.listingMode === 'listing_to_detail'
        ? 'listing'
        : source.listingMode === 'detail' && urlCount > 0
          ? 'detail'
          : null);
    setMode(initialMode);
    const urls = rowsQuery.data.urls;
    // Saved pages arrive unchecked, and stay that way until someone asks: the
    // check is a real page load on the api-server, and opening a tab must not
    // spend one per page. `Check` on the row is how it is asked for.
    setChecks(Object.fromEntries(urls.map((url) => [url, { saved: true as const }])));
    setListing(initialMode === 'listing' ? urls : []);
    setProductText(initialMode === 'detail' ? urls.join('\n') : '');
    setBudget(budgetToForm(source.budget));
    setEditing(null);
    setSaveNote(null);
    setStartedRunId(null);
    seeded.current = source.id;
  }, [source, rowsQuery.data, savedMode, urlCount]);

  async function runCheck(url: string) {
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
  const sampleRun: SampleRun | null = latestProbe
    ? { status: latestProbe.status, rows: latestProbe.resultCount ?? 0 }
    : null;
  const sampleIsFinished = sampleFinished(sampleRun);

  // The website's own full runs — not the probe samples, not a repair
  // backfill, which is a different run's remainder.
  const latestFullRun = runRows.find((r) => r.inputLabel !== 'probe' && r.inputLabel !== 'backfill') ?? null;

  const rowsUpdatedAt = rowsQuery.data?.updatedAt ?? null;
  const sampleStale = !!(latestProbe && rowsUpdatedAt && rowsUpdatedAt > latestProbe.createdAt);

  // A run started from this tab is not the only run worth showing: reloading
  // the page, or opening the tab while a crawl kicked off an hour ago is still
  // working, must show the progress line and the link to it rather than
  // offering Extract again on a website already extracting.
  useEffect(() => {
    if (startedRunId || !latestFullRun) return;
    if (isRunActive(latestFullRun.status)) setStartedRunId(latestFullRun.id);
  }, [startedRunId, latestFullRun]);

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
  /**
   * Are the pages on screen the pages that are actually stored?
   *
   * Saved, not merely typed: `inputMode` is the marker `setListingPages`/
   * `setProductUrls` write, so a legacy website whose input set predates the
   * Extract tab starts at step 1 with its rows already in the box, rather than
   * claiming pages it never confirmed.
   *
   * `savedMode === mode` is the other half, and it is what stops a real
   * misfire: flipping the segmented control to the other shape without saving
   * left this true, so Run stayed unlocked and Extract planned against the
   * input still stored for the mode the operator had just navigated away from.
   * A switched mode has nothing saved *for that mode*, so step 1 goes back to
   * `current` until it does.
   */
  const pagesSaved = urlCount > 0 && savedMode !== null && savedMode === mode;
  const states = withEditing(
    stepStates({ schemaGreen: green, mode, pagesSaved, sampleRun, running }),
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
      // `listByProject` too: a probe's plan writes to the Source row, and the
      // header/tabs above read it from the same cached list this tab does.
      await Promise.all([
        utils.runs.listBySource.invalidate({ sourceId: source.id }),
        utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }),
      ]);
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
  if (!source) return <NotFound what={`Website "${sourceSlug}"`} />;

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
  const extractBlocked = !green || !pagesSaved || (mode === 'listing' && !sampleIsFinished);
  const extractReason = !pagesSaved
    ? mode === 'detail'
      ? 'Save your URLs first'
      : 'Save your pages first'
    : mode === 'listing' && !sampleIsFinished
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
            // A removed page takes its check with it, so re-adding it later
            // starts from "checking…" rather than showing the result of a
            // check on a page that has since been taken off the list.
            const kept = new Set(urls);
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
        onEdit={() => {
          setSaveNote(null);
          setEditing(2);
        }}
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
          mode={mode ?? 'listing'}
          items={budget.items}
          pages={budget.pages}
          onChange={setBudget}
          sentence={runSentence(budget, listingCount, mode ?? 'listing')}
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
