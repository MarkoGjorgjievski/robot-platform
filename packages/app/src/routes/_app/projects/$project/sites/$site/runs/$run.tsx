import { useMemo } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { Button } from '../../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../../components/ui/skeleton';
import { ExecuteControls } from '../../../../../../../components/runs/execute-controls';
import { ResultsTable } from '../../../../../../../components/runs/results-table';
import { RunFacts } from '../../../../../../../components/runs/run-facts';
import { RunHeader } from '../../../../../../../components/runs/run-header';
import { WorkList } from '../../../../../../../components/runs/work-list';
import {
  isRunId,
  resultsNote,
  resultsSummary,
  runFacts,
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
 * The misses, the coverage bar, the repair panel and the sample-confirm gate are
 * Task 8; their mount points are marked below.
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
  const columns = useMemo(
    () => (site.data?.fields ?? []).map((f) => ({ key: f.key, name: f.name })),
    [site.data],
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
  // A sample run whose website has not been confirmed yet: the confirm gate
  // (Task 8) is the only actionable control on that page, so every run control
  // is suppressed — see `runControls`' own doc comment.
  const probeUnconfirmed = run.inputLabel === 'probe' && !source?.confirmedAt;
  // A repair run's own rows are deliberately partial — only its target fields
  // were ever asked for — which changes what its controls may offer.
  const isBackfill = run.inputLabel === 'backfill';
  const rowCount = extraction?.rowCount ?? 0;

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

      {/* Task 8: CoverageBar */}
      {/* Task 8: RunMisses */}
      {/* Task 8: BackfillPanel */}
      {/* Task 8: ProbeGate — it takes the sample rows, so the sheet below moves
          inside it while the gate is showing */}

      <WorkList items={items.data?.items ?? []} counts={items.data?.counts ?? EMPTY_COUNTS} />

      <ResultsTable
        columns={columns}
        rows={rows}
        absentByUrl={absentByUrl}
        summary={resultsSummary(rowCount, extraction?.confidence ?? null)}
        note={resultsNote(rows.length, rowCount)}
      />
    </>
  );
}

/** What `crawl.items` reports before it has answered — the work list draws nothing on these. */
const EMPTY_COUNTS = { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 };
