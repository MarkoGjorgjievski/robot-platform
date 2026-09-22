import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import {
  extractButtonLabel,
  extractButtonTitle,
  isRunActive,
  progressLabel,
  requeueNotice,
  runControls,
} from '../../lib/site/run-progress';

/**
 * What can still be done to this run: extract the pending URLs, retry the failed
 * ones, or ask a working loop to stop.
 *
 * Which of the three appear is `runControls`' decision, not this component's —
 * including the rule that Extract and Retry are offered on their counts alone,
 * never gated on "is it active", so a run stalled at `extracting` with no loop
 * behind it stays rescuable from the one page most people will ever see it on.
 * Read that module's doc comment before changing anything here.
 *
 * Nothing is drawn until the run has a work list (`counts.detail === 0`): a run
 * that planned nothing has nothing to extract, and three buttons over it would
 * be furniture.
 */
export function ExecuteControls({
  runId,
  probeUnconfirmed,
  backfill,
}: {
  runId: string;
  /** A sample run whose website has not been confirmed — the probe gate is the only control there. */
  probeUnconfirmed: boolean;
  /** A repair run, whose leftover pending work is a failed repair's remainder rather than work to redo. */
  backfill: boolean;
}) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.crawl.status.useQuery(
    { runId },
    // Three seconds, and only while the loop is actually working. A settled run
    // is never going to change again, and polling it forever is what wedges a
    // screen.
    { refetchInterval: (query) => (isRunActive(query.state.data?.status ?? '') ? 3000 : false) },
  );
  const execute = trpc.crawl.execute.useMutation({
    onSuccess: () => {
      void utils.crawl.invalidate();
      void utils.runs.invalidate();
      // `projects.get` too: the project page's websites table has a last-run
      // cell and a run dot per website, and this is the moment both change.
      void utils.projects.get.invalidate();
    },
  });
  const cancel = trpc.crawl.cancel.useMutation({
    onSuccess: () => {
      void utils.crawl.invalidate();
      // `projects.get` too: the project page's websites table has a last-run
      // cell and a run dot per website, and this is the moment both change.
      void utils.projects.get.invalidate();
    },
  });

  const data = statusQuery.data;
  const active = data ? isRunActive(data.status) : false;

  // The poll above is the only thing telling this page a background crawl
  // settled — the header (`runs.getWithDetails`) and the work list
  // (`crawl.items`) are not polled, so without this they would sit stale until a
  // reload. Fired once, on the falling edge into "settled", not on every 3 s
  // tick: refetching a large work list on each poll of a long crawl is exactly
  // the waste this codebase avoids elsewhere.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      void utils.runs.invalidate();
      void utils.crawl.invalidate();
      // `projects.get` too: the project page's websites table has a last-run
      // cell and a run dot per website, and this is the moment both change.
      void utils.projects.get.invalidate();
    }
    wasActive.current = active;
  }, [active, utils]);

  if (!data || data.counts.detail === 0) return null;

  const controls = runControls(data.status, data.counts, { probeUnconfirmed, backfill });
  // What the last execute actually reclaimed. `crawl.execute` returns the count
  // because "Resume N stalled" appears as soon as an item is `running`, while
  // the reclaim behind it only acts past the staleness threshold — so inside
  // that window the click really did launch a browser and really did change
  // nothing, and saying so beats leaving the operator to click again.
  const notice = execute.data && !execute.isPending ? requeueNotice(execute.data.requeued, data.counts) : null;

  return (
    <div className="rise mb-3 rounded-[6px] border border-line bg-panel px-4 py-3 [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="font-mono text-base">{progressLabel(data.counts, data.status)}</p>

        <div className="flex flex-wrap items-center gap-2">
          {controls.showExtract ? (
            <Button
              size="sm"
              disabled={execute.isPending}
              title={extractButtonTitle(data.status, data.counts)}
              onClick={() => execute.mutate({ runId })}
            >
              {execute.isPending ? <Loader2 className="animate-spin" /> : null}
              {extractButtonLabel(data.counts)}
            </Button>
          ) : null}

          {controls.showRetry ? (
            <Button
              variant="outline"
              size="sm"
              disabled={execute.isPending}
              title="Re-queue the failed pages and extract them again"
              onClick={() => execute.mutate({ runId, retryFailed: true })}
            >
              Retry {data.counts.failed} failed
            </Button>
          ) : null}

          {controls.showStop ? (
            // The red is on the text on hover, not a fill behind it: stopping is
            // the one destructive thing on this page, and this system says that
            // with the state colour rather than with a wash (spec §4).
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              className="hover:border-fail hover:text-fail"
              onClick={() => cancel.mutate({ runId })}
            >
              {cancel.isPending ? 'Stopping…' : 'Stop'}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? <p className="mt-2 text-base text-muted-foreground">{notice}</p> : null}
      {execute.isError ? (
        <p role="alert" className="mt-2 text-base text-fail">
          {execute.error.message}
        </p>
      ) : null}
      {cancel.isError ? (
        <p role="alert" className="mt-2 text-base text-fail">
          {cancel.error.message}
        </p>
      ) : null}
    </div>
  );
}
