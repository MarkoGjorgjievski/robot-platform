import { useMemo } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { Button } from '../../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../../components/ui/skeleton';
import { BackfillPanel } from '../../../../../../../components/runs/backfill-panel';
import { CoverageBar } from '../../../../../../../components/runs/coverage-bar';
import { ExecuteControls } from '../../../../../../../components/runs/execute-controls';
import { ProbeGate } from '../../../../../../../components/runs/probe-gate';
import { ResultsTable } from '../../../../../../../components/runs/results-table';
import { RunFacts } from '../../../../../../../components/runs/run-facts';
import { RunHeader } from '../../../../../../../components/runs/run-header';
import { RunMisses } from '../../../../../../../components/runs/run-misses';
import { WorkList } from '../../../../../../../components/runs/work-list';
import { isRunActive } from '../../../../../../../lib/site/run-progress';
import {
  isRunId,
  resultsNote,
  resultsSummary,
  runFacts,
  variantCountLines,
  type VariantSummary,
} from '../../../../../../../lib/site/run-screen-view';
import { trpc } from '../../../../../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../../../../../lib/use-unauthorized-redirect';
import { useSite } from '../../$site';

/**
 * One extraction of this website: what it did, what it produced, and what can
 * still be done to it. The layout owns the website's title and the tab strip —
 * Runs stays lit here — so this screen starts at its own heading row.
 *
 * Two queries and one cache hit: `runs.getWithDetails` (the run, its lineage,
 * its capture and its rows) and `crawl.items` (the work list, and the per-page
 * confirmed-absent fields the sheet renders as "not on page"). The website's
 * contract comes from `useSite()`, which the layout has already loaded, so the
 * sheet's columns cost nothing.
 *
 * Nothing here polls on its own. `ExecuteControls` polls `crawl.status` at 3 s
 * while the run is active and invalidates everything else on the falling edge
 * into "settled" — one poll for the screen, not one per panel.
 *
 * Three more free reads sit behind gates rather than running on every visit:
 * `crawl.coverage` (the repair bar and the repair panel) only on a settled,
 * non-sample, non-repair extraction that actually produced rows — a moving run's
 * gaps are still closing under it, a sample's only actionable control is its own
 * gate, and a repair run's rows are deliberately partial, so a coverage report
 * over them would read every other field as dead; `crawl.misses` under the same
 * settled/non-sample/non-repair gate but without the `rows > 0` clause (it is
 * mounted on `repairable` alone); and `crawl.backfillPreview` only once the
 * repair panel is opened.
 */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/runs/$run')({
  component: RunScreen,
});

function RunScreen() {
  const { project: projectSlug, site: siteSlug, run: runId } = Route.useParams();
  // A run id that is not a uuid is a wrong address, not a failed request: the
  // procedure's own Zod would refuse it with a BAD_REQUEST that reads nothing
  // like "no such extraction", so the query is never sent.
  const valid = isRunId(runId);

  const site = useSite();
  const detail = trpc.runs.getWithDetails.useQuery({ id: runId }, { enabled: valid });
  // An ended session is a trip to /login, not a Retry button that can only fail
  // again; nothing is drawn while that navigation is in flight.
  const unauthorized = useUnauthorizedRedirect(detail);
  // Gated on the run existing: a work list for a run this account cannot see is
  // a second 404 for the same wrong address.
  const items = trpc.crawl.items.useQuery({ runId }, { enabled: valid && !!detail.data });

  const absentByUrl = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of items.data?.items ?? []) {
      const absent = Array.isArray(item.absentFields) ? (item.absentFields as string[]) : [];
      if (absent.length > 0) map.set(item.url, new Set(absent));
    }
    return map;
  }, [items.data]);

  const rawRows = detail.data?.extraction?.data;
  const rows = useMemo(
    () => (Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : []),
    [rawRows],
  );
  // The project's contract: `key` is what a result row is keyed by, `name` is
  // the plain-language heading. The same pair the Extract tab's sample uses.
  //
  // The contract is the ONLY source of columns here. The dashboard's run page
  // read a website's legacy `selectorsJson.fields` first and fell back to the
  // contract — that list is written by nothing any more (the `sources.analyze`
  // procedure that wrote it was removed in 2026-09) and is empty for every
  // verification-era website, which is what made the fallback necessary in the
  // first place. Dropping it is deliberate, and it takes the synthetic
  // `detail_url` column with it: that field only ever round-tripped out of the
  // legacy list, and the server's own effective schema already filters it out.
  const columns = useMemo(
    () => (site.data?.fields ?? []).map((f) => ({ key: f.key, name: f.name })),
    [site.data],
  );

  // Whether THIS run produced variant rows — not whether the project has
  // variants turned on, which a run started before that change, or one on a
  // website that found none, never carries (same `_product_key` test
  // `buildRunExport` uses). Only then does the sheet gain the axis columns
  // and the variant key: a flat run's sheet must stay exactly what it was.
  const isVariantsRun = useMemo(
    () => rows.some((r) => r._product_key !== undefined && r._product_key !== null),
    [rows],
  );
  const axisColumns = detail.data?.axisColumns ?? [];
  // Every field first, in the website's own field order (product- and
  // variant-level alike), then the axis columns, then the variant key last.
  // This is NOT the export's order: `build-run-export.ts`'s `shapeRows` puts
  // product fields, then axes, then variant-level fields, then
  // product_key/variant_key — so the sheet and the download can list the
  // same columns in a different order.
  const sheetColumns = useMemo(
    () => (isVariantsRun ? [...columns, ...axisColumns, { key: '_variant_key', name: 'Variant key' }] : columns),
    [columns, axisColumns, isVariantsRun],
  );

  // Derived before the early returns, not after: the coverage query's `enabled`
  // reads all three, and a hook cannot live below a `return`.
  const inputLabel = detail.data?.run.inputLabel ?? null;
  // A sample run whose website has not been confirmed yet: the confirm gate is
  // the only actionable control on that page, so every run control is
  // suppressed — see `runControls`' own doc comment.
  const probeUnconfirmed = inputLabel === 'probe' && !detail.data?.source?.confirmedAt;
  // A repair run's own rows are deliberately partial — only its target fields
  // were ever asked for — which changes what its controls may offer.
  const isBackfill = inputLabel === 'backfill';
  const runIsTerminal = detail.data ? !isRunActive(detail.data.run.status) : false;
  // The one gate the repair surfaces share. Read the screen's doc comment for
  // why each clause is here.
  const repairable = runIsTerminal && !probeUnconfirmed && !isBackfill;

  const coverage = trpc.crawl.coverage.useQuery(
    { runId },
    { enabled: valid && repairable && rows.length > 0 },
  );
  const gapByUrl = useMemo(
    () => new Map((coverage.data?.gapItems ?? []).map((g) => [g.url, g] as const)),
    [coverage.data],
  );

  if (unauthorized) return null;

  // Two ways to be told this run is not here: the procedure refused it (an id
  // from another organisation reads exactly like one that never existed, which
  // is the point), or it answered with nothing.
  const missing =
    !valid || detail.error?.data?.code === 'NOT_FOUND' || (detail.isSuccess && detail.data === null);

  if (missing) {
    return (
      <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
        {/* Not red: an id that is not an extraction is a wrong address, not a
            failure, and the red is what the customer must learn to read as
            "something broke". Announced all the same. */}
        <p role="alert" className="text-base">
          This extraction does not exist.
        </p>
        <Button variant="outline" asChild>
          <Link to="/projects/$project/sites/$site/runs" params={{ project: projectSlug, site: siteSlug }}>
            Runs
          </Link>
        </Button>
      </div>
    );
  }

  if (detail.isError) {
    return (
      <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
        {/* No cause is named: from here a failure could be the network, the
            api-server or the database. Say what happened and offer the one
            action that can change it. */}
        <p role="alert" className="text-base text-fail">
          Could not load this extraction.
        </p>
        <Button variant="outline" onClick={() => void detail.refetch()} disabled={detail.isFetching}>
          {detail.isFetching ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
        <Skeleton className="h-[22px] w-64 bg-raised" />
        <Skeleton className="mt-3 h-[22px] w-full bg-raised" />
        <Skeleton className="mt-2 h-[22px] w-full bg-raised" />
      </div>
    );
  }

  const { run, source, capture, extraction, backfillRuns } = detail.data;
  const rowCount = extraction?.rowCount ?? 0;
  const variantLines = variantCountLines(run.variantSummary as VariantSummary | null);

  // The screen's ONE results sheet. The sample gate owns it while it is showing
  // — the customer is being asked to judge those rows, so they belong under the
  // evidence and above the question — and it is withheld from its usual place
  // at the bottom for exactly as long. One instance, relocated, never two.
  //
  // The sheet's columns are the project's contract, and until `sources.get`
  // lands there is no contract to draw one from. An empty column list is not an
  // empty project: rendering the table with it would print "No fields in this
  // project yet", which is a claim, where the truth is that nobody has answered
  // yet. The shape of the panel, then — not a head of invented columns that
  // would be swapped a moment later.
  const resultsSheet = site.isPending ? (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="border-b border-line px-4 py-2.5">
        <Skeleton className="h-3.5 w-52 bg-raised" />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="border-b border-line px-4 py-2.5 last:border-0">
          <Skeleton className="h-3.5 w-full max-w-[420px] bg-raised" />
        </div>
      ))}
    </div>
  ) : (
    <ResultsTable
      columns={sheetColumns}
      rows={rows}
      absentByUrl={absentByUrl}
      summary={resultsSummary(rowCount, extraction?.confidence ?? null)}
      note={resultsNote(rows.length, rowCount)}
    />
  );

  return (
    <>
      <RunHeader
        runId={runId}
        project={projectSlug}
        site={siteSlug}
        run={run}
        backfillRuns={backfillRuns}
        downloadable={extraction !== null}
      />

      <RunFacts facts={runFacts(run)} />

      {/* The variant counts (spec §5.3), shown only on a run that produced
          variant rows — `variantCountLines` is already empty for every
          other run, so there is nothing to gate here beyond that. */}
      {variantLines.length > 0 ? (
        <ul className="rise mb-3 list-none text-base text-muted-foreground">
          {variantLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {/* The state colour on the words, with no tinted box behind them (spec §4).
          `whitespace-pre-line` because an engine error can arrive with its own
          line breaks in it. */}
      {run.errorMessage ? (
        <p role="alert" className="rise mb-3 border-l-2 border-fail pl-3 text-base whitespace-pre-line text-fail">
          {run.errorMessage}
        </p>
      ) : null}

      {capture?.url ? (
        <p className="rise mb-3 flex min-w-0 items-center gap-1.5 text-base text-muted-foreground">
          <a
            href={capture.url}
            target="_blank"
            rel="noopener noreferrer"
            title={capture.url}
            className="min-w-0 truncate font-mono text-link underline-offset-4 hover:underline"
          >
            {capture.url}
          </a>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </p>
      ) : null}

      <ExecuteControls runId={runId} probeUnconfirmed={probeUnconfirmed} backfill={isBackfill} />

      {/* Each panel is keyed by its own name AND the run: the route component is
          reused when only the run param changes, so a panel's own state — a
          picked field, a tick, an open repair preview — would otherwise survive a
          navigation to a different extraction and act on it. The name is not
          decoration: these four are siblings, and `key={runId}` alone would be
          the same key four times over. */}
      {repairable && coverage.data ? (
        <CoverageBar
          key={`bar-${runId}`}
          runId={runId}
          project={projectSlug}
          site={siteSlug}
          rows={rows}
          coverage={coverage.data.fields}
          gapByUrl={gapByUrl}
          columns={columns}
        />
      ) : null}

      {repairable ? (
        <RunMisses key={`misses-${runId}`} runId={runId} project={projectSlug} site={siteSlug} columns={columns} />
      ) : null}

      {repairable && coverage.data ? (
        <BackfillPanel
          key={`repair-${runId}`}
          runId={runId}
          project={projectSlug}
          site={siteSlug}
          gappyFieldNames={coverage.data.fields.filter((f) => f.missing > 0).map((f) => f.name)}
          columns={columns}
        />
      ) : null}

      {probeUnconfirmed ? (
        <ProbeGate
          key={`gate-${runId}`}
          project={projectSlug}
          site={siteSlug}
          sourceId={source?.id ?? null}
          runStatus={run.status}
          runErrorMessage={run.errorMessage}
          logs={run.logs}
          counts={items.data?.counts ?? null}
          items={items.data?.items ?? []}
          itemsError={items.isError}
          sampleRows={resultsSheet}
        />
      ) : null}

      <WorkList items={items.data?.items ?? []} counts={items.data?.counts ?? EMPTY_COUNTS} />

      {probeUnconfirmed ? null : resultsSheet}
    </>
  );
}

/** What `crawl.items` reports before it has answered — the work list draws nothing on these. */
const EMPTY_COUNTS = { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 };
