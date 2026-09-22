import { useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { diagnoseRun } from '../../lib/site/diagnose-run';
import { parseRunLog } from '../../lib/site/parse-run-log';
import { probeEvidence } from '../../lib/site/probe-evidence';
import { probeFacts } from '../../lib/site/run-screen-view';
import { DiagnosisPanel } from './diagnosis-panel';
import type { WorkListItem } from './work-list';

/**
 * The sample gate: a website is walked once, cheaply, and nothing crawls for
 * real until the customer has looked at what came back and said yes.
 *
 * Evidence first — pages walked, products found, how it paged, how many
 * warnings — then the sample's own rows, then the question. "Yes, crawl
 * everything" plans the full crawl and takes the customer to it. "Something's
 * wrong" opens the diagnosis, which also opens by itself when the sample run
 * failed: there is nothing to say yes to there, so the question is withheld and
 * the explanation takes its place without a click.
 *
 * `sampleRows` is the route's ONE results sheet, moved in here rather than
 * drawn twice — the route withholds it from its usual place at the bottom for
 * exactly as long as this gate is showing, so the rows can never vanish from
 * both places or appear in both.
 *
 * The route mounts this only for a sample run on an unconfirmed website, and
 * passes the work list it has already loaded rather than opening a second
 * reader of the same key. The evidence and the question wait on that list; the
 * sample rows do not, so a slow or failed work list never takes the rows off
 * the screen with it.
 */
export function ProbeGate({
  project,
  site,
  sourceId,
  runStatus,
  runErrorMessage,
  logs,
  counts,
  items,
  itemsError,
  sampleRows,
}: {
  project: string;
  site: string;
  /** The website to confirm. `null` only for an extraction whose website is gone. */
  sourceId: string | null;
  runStatus: string;
  runErrorMessage: string | null;
  logs: string | null;
  /** `crawl.items`' counts, or null while that query is in flight or failed. */
  counts: { listing: number; detail: number } | null;
  items: readonly WorkListItem[];
  itemsError: boolean;
  sampleRows: ReactNode;
}) {
  const navigate = useNavigate();
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const confirm = trpc.sources.confirm.useMutation({
    onSuccess: (result) => {
      void navigate({
        to: '/projects/$project/sites/$site/runs/$run',
        params: { project, site, run: result.runId },
      });
    },
  });

  const { warnings, errors } = parseRunLog(logs);
  const evidence = counts ? probeEvidence({ counts, warnings }) : null;
  const runFailed = runStatus === 'failed';

  const itemFailures = items
    .filter((item) => item.kind === 'detail' && item.status === 'failed')
    .map((item) => ({ url: item.url, error: item.error }));

  // Computed whatever the work list is doing: a failed sample's own error and
  // logs are enough to name a block, a pagination problem or a dead link before
  // the per-page detail arrives, and this re-renders with that detail once it
  // does. There is no separate blocked channel at the run level — a block is
  // caught by `diagnoseRun`'s own match over the evidence.
  const diagnosis = diagnoseRun({
    warnings,
    errors: [...errors.map((message) => ({ message })), ...(runErrorMessage ? [{ message: runErrorMessage }] : [])],
    blockedReason: null,
    rowsFound: counts ? counts.detail : null,
    itemFailures,
  });

  return (
    <>
      <div className="rise mb-3 rounded-[6px] border border-line bg-panel px-4 py-3 [box-shadow:var(--shadow)]">
        <h3 className="text-base font-medium">Sample results</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          One walk of this website, to see where it leads before anything crawls it for real.
        </p>

        {evidence ? (
          // The same grammar the extraction's own facts use — a quiet label,
          // the value in mono because it is the thing being read. Written here
          // rather than through `RunFacts` because these four belong inside
          // this panel, under its heading, not in a second panel of their own.
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
            {probeFacts(evidence).map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-sm text-muted-foreground">{fact.label}</dt>
                <dd className="mt-0.5 font-mono text-lg break-words">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : itemsError ? (
          <p role="alert" className="mt-3 text-base text-fail">
            Could not load what this sample walked.
          </p>
        ) : (
          <p className="mt-3 text-base text-muted-foreground">Loading what this sample walked…</p>
        )}
      </div>

      <div className="mb-3">{sampleRows}</div>

      {evidence && !runFailed ? (
        <div className="rise mb-3 rounded-[6px] border border-line bg-panel px-4 py-3 [box-shadow:var(--shadow)]">
          <p className="text-base font-medium">Is this the right path?</p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={confirm.isPending || !sourceId}
              onClick={() => sourceId && confirm.mutate({ sourceId })}
            >
              {confirm.isPending ? <Loader2 className="animate-spin" /> : null}
              Yes, crawl everything
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowDiagnosis((v) => !v)}>
              Something's wrong
            </Button>
            {/* Every disabled control says why, within a line of it. */}
            {!sourceId ? (
              <span className="text-base text-muted-foreground">This extraction has no website behind it any more</span>
            ) : null}
          </div>

          {confirm.isError ? (
            <p role="alert" className="mt-2 text-base text-fail">
              {confirm.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {showDiagnosis || runFailed ? (
        <DiagnosisPanel diagnosis={diagnosis} project={project} site={site} />
      ) : null}
    </>
  );
}
