import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../components/ui/skeleton';
import { Section } from '../../../../../../components/extract/section';
import { ExtractLockedStrip, ExtractStrip } from '../../../../../../components/extract/extract-strip';
import { ExtractPages, type ListingCheck } from '../../../../../../components/extract/extract-pages';
import { ExtractSample } from '../../../../../../components/extract/extract-sample';
import { ExtractRun } from '../../../../../../components/extract/extract-run';
import { parseCsv } from '../../../../../../lib/site/csv';
import { parseUrlLines } from '../../../../../../lib/site/parse-url-lines';
import { isRunActive } from '../../../../../../lib/site/run-progress';
import {
  budgetFromForm,
  budgetNeedsSave,
  budgetToForm,
  lockedStripText,
  productUrlCounts,
  runSentence,
  sampleFinished,
  stepStates,
  type ExtractMode,
  type SampleRun,
} from '../../../../../../lib/site/extract-view';
import {
  appendUrls,
  csvUrlCells,
  extractGate,
  hostOf,
  isProbeMoving,
  pagesAreSaved,
  runProgressLine,
  sampleGate,
  saveNote,
  stripCells,
  tooManyMessage,
  withEditing,
} from '../../../../../../lib/site/extract-screen-view';
import { trpc } from '../../../../../../lib/trpc';
import { useSite } from '../$site';

/**
 * Extract: which pages of this website to collect from, proof that the walk
 * works, and how much to run (spec 2026-09-08 §5.7). The website layout owns the
 * title and the tab strip; this is the strip of three steps and the three
 * sections under it.
 *
 * This file is wiring only. Every decision it makes is a pure function in
 * `lib/site/extract-view.ts` (which step is current, what the locked strip says,
 * what the budget sentence means) or `lib/site/extract-screen-view.ts` (why a
 * button is off, what a save did, what the strip cells read), and every pixel is
 * one of the three section components.
 *
 * The rule the tab is built on: nothing disappears. A finished step keeps its
 * content on screen behind "Edit pages"; an unreachable one stays visible,
 * dimmed, saying why. So there is no wizard state machine here — `stepStates`
 * derives all three states from saved data on every render, and the only local
 * override is `editing`, which reopens one section until it is saved again.
 */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/extract')({
  component: ExtractTab,
});

const HINTS = [
  'where the products come from',
  'proof that the walk works before anything runs at scale',
  'how much, then go',
] as const;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ExtractTab() {
  const { project: projectSlug, site: siteSlug } = Route.useParams();
  const utils = trpc.useUtils();

  const site = useSite();
  const source = site.data;
  const sourceId = source?.id ?? '';

  const statusQuery = trpc.sources.verificationStatus.useQuery({ sourceId }, { enabled: !!source });
  const rowsQuery = trpc.sources.inputRows.useQuery({ sourceId }, { enabled: !!source });
  // Polled while the latest probe is still moving, and only then.
  //
  // This query is what step 3's unlock is derived from (`sampleRun` ->
  // `sampleFinished` -> `stepStates`), and the client's own `staleTime` means
  // nothing would refetch it after `handleSample` invalidates it — which
  // happens while the probe is still extracting. Without the interval the happy
  // path stops dead after the sample: section 2 fills in from its own poll and
  // section 3 stays out of reach until a reload.
  const runsQuery = trpc.runs.listBySource.useQuery(
    { sourceId },
    {
      enabled: !!source,
      refetchInterval: (query) => {
        const probe = (query.state.data ?? []).find((r) => r.inputLabel === 'probe');
        // `completedAt` is the terminal marker every reader in this codebase
        // trusts: a `planned` probe that planned nothing is as finished as a
        // `completed` one, and status alone cannot tell those apart.
        if (!probe || probe.completedAt !== null) return false;
        return isProbeMoving(probe.status) ? 2000 : false;
      },
    },
  );

  const [mode, setMode] = useState<ExtractMode | null>(null);
  const [listing, setListing] = useState<string[]>([]);
  const [productText, setProductText] = useState('');
  const [checks, setChecks] = useState<Record<string, ListingCheck>>({});
  const [budget, setBudget] = useState<{ items: number | 'all'; pages: number | 'all' }>({ items: 'all', pages: 'all' });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  /** The website the local state was seeded from, so a `$site` change reseeds. */
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
  const savedUrls = useMemo(() => rowsQuery.data?.urls ?? [], [rowsQuery.data]);

  // Seeded once per website, from saved data: after that the local state is
  // what the customer is editing, and a background refetch (the invalidation
  // after a save, say) must not type over them. Keyed on the website's id, not
  // a bare boolean, so navigating from one website's Extract tab to another's —
  // the router reuses this component — reseeds instead of leaving the first
  // website's pages on screen.
  useEffect(() => {
    if (!source || !rowsQuery.data) return;
    if (seeded.current === source.id) return;
    const initialMode: ExtractMode | null =
      savedMode ??
      (source.listingMode === 'listing_to_detail'
        ? 'listing'
        : source.listingMode === 'detail' && savedUrls.length > 0
          ? 'detail'
          : null);
    setMode(initialMode);
    // Saved pages arrive unchecked, and stay that way until someone asks: the
    // check is a real page load on the api-server, and opening a tab must not
    // spend one per page. `Check` on the row is how it is asked for.
    setChecks(Object.fromEntries(savedUrls.map((url) => [url, { saved: true as const }])));
    setListing(initialMode === 'listing' ? savedUrls : []);
    setProductText(initialMode === 'detail' ? savedUrls.join('\n') : '');
    // `legacy`: no `inputMode` marker means the Extract tab has never saved this
    // website's pages, so a stored 40/3 can only be the old flow's own starter
    // rather than a choice. See `budgetToForm`.
    setBudget(budgetToForm(source.budget, { legacy: savedMode === null }));
    setEditing(null);
    setNote(null);
    setStartedRunId(null);
    seeded.current = source.id;
  }, [source, rowsQuery.data, savedMode, savedUrls]);

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
  const currentKeys = useMemo(() => status?.currentKeys ?? [], [status]);
  // The contract comes with the website — `sources.get` returns it as `fields`
  // — so the tab does not run `datasets.getContract` a second time for the same
  // rows the layout already holds.
  const contract = useMemo(() => source?.fields ?? [], [source]);

  const runRows = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  // `listBySource` is newest-first, so the first match is the latest.
  const latestProbe = runRows.find((r) => r.inputLabel === 'probe') ?? null;
  const sampleRun: SampleRun | null = latestProbe
    ? { status: latestProbe.status, rows: latestProbe.resultCount ?? 0 }
    : null;
  const sampleDone = sampleFinished(sampleRun);

  // The website's own full runs — not the probe samples, and not a repair
  // backfill, which is a different run's remainder.
  const latestFullRun = runRows.find((r) => r.inputLabel !== 'probe' && r.inputLabel !== 'backfill') ?? null;

  const rowsUpdatedAt = rowsQuery.data?.updatedAt ?? null;
  const sampleStale = !!(latestProbe && rowsUpdatedAt && rowsUpdatedAt > latestProbe.createdAt);

  // A run started from this tab is not the only run worth showing: reloading the
  // page, or opening the tab while a crawl kicked off an hour ago is still
  // working, must show the progress line and the link to it rather than offering
  // Extract again on a website already extracting.
  useEffect(() => {
    if (startedRunId || !latestFullRun) return;
    if (isRunActive(latestFullRun.status)) setStartedRunId(latestFullRun.id);
  }, [startedRunId, latestFullRun]);

  const runStatusQuery = trpc.crawl.status.useQuery(
    { runId: startedRunId ?? '' },
    {
      enabled: !!startedRunId,
      // Only while the loop is actually working. `crawl.execute` flips the run
      // to `extracting` before it returns, so there is no planned-but-starting
      // window to cover here — and a run stuck at `planned` would otherwise be
      // polled every two seconds for as long as the tab stays open.
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s !== undefined && isRunActive(s) ? 2000 : false;
      },
    },
  );

  const running = startedRunId !== null;
  // Are the pages on screen the pages that are actually stored? All three halves
  // of that question — and why a reopened section 1 answers no — are in
  // `pagesAreSaved`, with its tests.
  const pagesSaved = pagesAreSaved({ savedCount: savedUrls.length, savedMode, mode, editing });
  const states = withEditing(stepStates({ schemaGreen: green, mode, pagesSaved, sampleRun, running }), editing);

  const verificationSet = (source?.verificationSet ?? null) as { urls?: string[] } | null;
  // Stable identity: this array is a prop of `ExtractPages` and a dependency of
  // the memo below, and `?? []` would hand both a fresh one per render.
  const proofUrlsRaw = verificationSet?.urls;
  const proofUrls = useMemo(() => proofUrlsRaw ?? [], [proofUrlsRaw]);
  const host = hostOf(proofUrls[0] ?? source?.url);
  // One pass over every pasted line for the whole screen. At the 5,000-URL
  // ceiling each pass is 5,000 `new URL()` calls, and the tab and the Pages
  // section used to make one each — two per keystroke — for the same answer.
  // Counted here, where the text lives, and handed down.
  const productCounts = useMemo(
    () => productUrlCounts(productText.split('\n'), proofUrls, host),
    [productText, proofUrls, host],
  );

  const firstFailing = contract.find((f) => !currentKeys.includes(f.key));
  const lockedText = lockedStripText({
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
    setNote(null);
    try {
      if (mode === 'listing') {
        const tooMany = tooManyMessage('listing', listing.length);
        if (tooMany) {
          setError(tooMany);
          return;
        }
        await listingPagesMutation.mutateAsync({ sourceId: source.id, urls: listing });
      } else {
        // `invalid` is every non-blank line that is not an http(s) URL. It is
        // deliberately NOT sent: `setProductUrls` validates each entry with
        // `httpUrl`, so one `ftp:` line would fail the entire save with a Zod
        // payload naming an index nobody can map back to a line. The lines stay
        // in the box; the note says how many were left out.
        const { urls, invalid } = parseUrlLines(productText);
        const tooMany = tooManyMessage('detail', urls.length);
        if (tooMany) {
          setError(tooMany);
          return;
        }
        if (urls.length === 0) {
          setError('None of those lines are web addresses, so nothing was saved.');
          return;
        }
        const result = await productUrlsMutation.mutateAsync({ sourceId: source.id, urls });
        setNote(saveNote({ skipped: result.skipped.length, invalid: invalid.length }));
      }
      await Promise.all([
        utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug }),
        utils.sources.inputRows.invalidate({ sourceId: source.id }),
      ]);
      setEditing(null);
    } catch (err) {
      setError(message(err));
    }
  }

  /** A CSV of product URLs — the `url` column, or one column of URLs and no header (`csvUrlCells`). */
  async function handleImportCsv(file: File) {
    setError(null);
    try {
      const picked = csvUrlCells(parseCsv(await file.text()));
      if ('error' in picked) {
        setError(picked.error);
        return;
      }
      const { urls } = parseUrlLines(picked.cells.join('\n'));
      if (urls.length === 0) {
        setError('No URLs in that file.');
        return;
      }
      setProductText((prev) => appendUrls(prev, urls));
    } catch (err) {
      setError(`Could not read the file: ${message(err)}`);
    }
  }

  async function handleSample() {
    if (!source) return;
    setError(null);
    try {
      await probeMutation.mutateAsync({ sourceId: source.id });
      // `sources.get` too: a probe's plan writes to the website's row, and the
      // header above reads it from the same cache this tab does.
      await Promise.all([
        utils.runs.listBySource.invalidate({ sourceId: source.id }),
        utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug }),
      ]);
    } catch (err) {
      setError(message(err));
    }
  }

  /**
   * Start the real run, at the budget on screen.
   *
   * The budget is saved first, and only when it actually differs from what is
   * stored — the run reads it from the website's row, so a dropdown that was
   * moved but never saved would otherwise be a lie on screen. The comparison is
   * against the RAW stored value, not against `budgetToForm` of it: `{}` and
   * all/all both read back as all/all, so a form-side diff could never see a
   * website whose budget had never been written (see `budgetNeedsSave`).
   *
   * Then, per mode: an unconfirmed listing website graduates through
   * `sources.confirm` (which plans at full budget and stamps `confirmedAt`), an
   * already-confirmed one plans directly, and a product-URL website plans its
   * known pages. **Every branch then calls `crawl.execute`** — planning only
   * builds the work list, and a button that says Extract has to extract.
   * `execute` returns as soon as the loop is started, so the run's progress is
   * read back from `crawl.status` above.
   */
  async function handleExtract() {
    if (!source) return;
    setError(null);
    try {
      const form = budgetFromForm(budget.items, budget.pages);
      if (budgetNeedsSave(source.budget, form)) {
        await updateMutation.mutateAsync({ id: source.id, budget: form });
      }
      const runId =
        mode === 'listing' && !source.confirmedAt
          ? (await confirmMutation.mutateAsync({ sourceId: source.id })).runId
          : (await planMutation.mutateAsync({ sourceId: source.id, probe: false })).runId;
      await executeMutation.mutateAsync({ runId });
      setStartedRunId(runId);
      // `projects.get` too: the project page's websites table has a last-run
      // cell and a run dot per website, and this is the moment both change.
      await Promise.all([
        utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug }),
        utils.runs.listBySource.invalidate({ sourceId: source.id }),
        utils.projects.get.invalidate(),
      ]);
    } catch (err) {
      setError(message(err));
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

  const progress = startedRunId ? runProgressLine(runStatusQuery.data) : null;
  const pageCount = mode === 'detail' ? productCounts.total : listing.length;
  const cells = stripCells({
    states,
    mode,
    pageCount,
    sampleRows: sampleDone ? (sampleRun?.rows ?? 0) : null,
    runLabel: progress?.label ?? null,
  });
  const pagesReadOnly = !green || states[0] !== 'current';
  const extractReason = extractGate({ green, pagesSaved, mode, sampleDone });
  const columns = contract.map((f) => ({ key: f.key, name: f.name }));

  return (
    <>
      {green ? null : <ExtractLockedStrip text={lockedText} project={projectSlug} site={siteSlug} />}

      <ExtractStrip cells={cells} />

      {error ? (
        <p role="alert" className="rise mb-3 border-l-2 border-fail pl-3 text-base whitespace-pre-line text-fail">
          {error}
        </p>
      ) : null}

      {/* Dimmed, and genuinely out of reach: `pointer-events-none` alone still
          leaves every control in the tab order, so `inert` is what stops a
          keyboard walking into a section the strip has just said is locked. */}
      <div className={`space-y-3 ${green ? '' : 'pointer-events-none opacity-60'}`} inert={green ? undefined : true}>
        <Section
          n={1}
          title="Pages"
          hint={HINTS[0]}
          action={
            green && pagesReadOnly ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNote(null);
                  setEditing(1);
                }}
              >
                Edit pages
              </Button>
            ) : null
          }
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
            counts={productCounts}
            onImportCsv={(file) => void handleImportCsv(file)}
            onSave={() => void handleSave()}
            saving={savingPages}
            readOnly={pagesReadOnly}
          />
          {note ? <p className="mt-3 text-base text-muted-foreground">{note}</p> : null}
        </Section>

        <Section n={2} title="Sample" hint={HINTS[1]}>
          <ExtractSample
            mode={mode ?? 'listing'}
            runId={mode === 'listing' ? (latestProbe?.id ?? null) : null}
            sampling={probeMutation.isPending}
            onSample={() => void handleSample()}
            columns={columns}
            stale={sampleStale}
            disabledReason={sampleGate({ green, pagesSaved })}
          />
        </Section>

        <Section n={3} title="Run" hint={HINTS[2]}>
          <ExtractRun
            mode={mode ?? 'listing'}
            items={budget.items}
            pages={budget.pages}
            onChange={setBudget}
            sentence={runSentence(budget, pageCount, mode ?? 'listing')}
            onExtract={() => void handleExtract()}
            extracting={extracting}
            reason={extractReason}
            activeRun={startedRunId && progress ? { id: startedRunId, ...progress } : null}
            project={projectSlug}
            site={siteSlug}
          />
        </Section>
      </div>
    </>
  );
}
