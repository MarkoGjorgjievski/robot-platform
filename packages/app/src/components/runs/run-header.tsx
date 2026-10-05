import { Link } from '@tanstack/react-router';
import { RunDot } from '../run-dot';
import { Button, buttonVariants } from '../ui/button';
import { exportUrl } from '../../lib/trpc';
import { reExtractedLabel, repairNote, runStatusLine, shortRunId } from '../../lib/site/run-screen-view';

/** One of `backfillRuns` — the repairs spawned against this run. */
export type BackfillRunRef = { id: string; status: string };

/**
 * The run page's own title row: what this screen is, what the run's state is,
 * and the file of it.
 *
 * "Extraction", not the run's id — the id is in the address bar and in the two
 * lineage lines below, and a page titled `3f1a2b4c` tells the customer nothing
 * they came here to learn. The website's name is the `h1` above, drawn by the
 * layout; this is the `h2` under its tab strip.
 */
export function RunHeader({
  runId,
  project,
  site,
  run,
  backfillRuns,
  downloadable,
}: {
  runId: string;
  project: string;
  site: string;
  run: {
    status: string;
    completedAt: Date | null;
    inputLabel: string | null;
    parentRunId: string | null;
    targetFields: string[] | null;
  };
  backfillRuns: readonly BackfillRunRef[];
  /** Whether anything was extracted — with nothing behind them the downloads are buttons, not links. */
  downloadable: boolean;
}) {
  const { state, label } = runStatusLine(run);
  const repairing = repairNote(run.targetFields);

  return (
    <header className="rise mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg font-medium">
          Extraction
          <RunDot status={state} />
          <span className="font-normal text-muted-foreground">{label}</span>
        </h2>

        {/* Where this run sits among the others: the one it repairs, and the
            ones sent to repair it. Both are quiet lines rather than panels —
            most runs have neither. */}
        {run.parentRunId ? (
          <p className="mt-1 text-base text-muted-foreground">
            Part of{' '}
            <Link
              to="/projects/$project/sites/$site/runs/$run"
              params={{ project, site, run: run.parentRunId }}
              className="font-mono text-link underline-offset-4 hover:underline"
            >
              {shortRunId(run.parentRunId)}
            </Link>
            {repairing ? ` · ${repairing}` : null}
          </p>
        ) : null}

        {backfillRuns.length > 0 ? (
          <p className="mt-1 text-base text-muted-foreground">
            {reExtractedLabel(backfillRuns.length)}:{' '}
            {backfillRuns.map((b, i) => (
              <span key={b.id}>
                {i > 0 ? ', ' : null}
                <Link
                  to="/projects/$project/sites/$site/runs/$run"
                  params={{ project, site, run: b.id }}
                  className="font-mono text-link underline-offset-4 hover:underline"
                >
                  {shortRunId(b.id)}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {/* Real anchors when there is a file: the api-server serves the export as
          a download, and an anchor is what a browser can open in a new tab, copy
          the address of and reach by keyboard. With nothing extracted they are
          buttons instead — a disabled anchor is not a thing, and
          `pointer-events: none` on one leaves it in the tab order pointing at an
          empty file. (The same bargain the project's Output screen strikes.) */}
      <div className="flex items-center gap-2">
        {downloadable ? (
          <>
            <a
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              href={exportUrl('runs', runId, 'csv')}
              download
            >
              Download CSV
            </a>
            <a
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              href={exportUrl('runs', runId, 'json')}
              download
            >
              Download JSON
            </a>
            <a
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              href={exportUrl('runs', runId, 'xlsx')}
              download
            >
              Download Excel
            </a>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled>
              Download CSV
            </Button>
            <Button variant="outline" size="sm" disabled>
              Download JSON
            </Button>
            <Button variant="outline" size="sm" disabled>
              Download Excel
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
