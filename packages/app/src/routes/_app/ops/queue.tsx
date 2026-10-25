import type { ReactNode } from 'react';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { Page } from '../../../components/page';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  ATTENTION_EMPTY, FAILURES_EMPTY, QUEUE_REFRESH_MS, TYPES_EMPTY, WORKERS_EMPTY,
  attentionRowsView, failureRowsView, typeRowsView, workerRowsView, type QueueOverview,
} from '../../../lib/ops-queue-view';
import { trpc } from '../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../lib/use-unauthorized-redirect';

/**
 * Queue (spec 2026-10-25 monitoring §2.5): the workers' heartbeats, this server's jobs by type, what needs attention
 * and the last failures. Read-only, every 15 s. The server's FORBIDDEN on `ops.queue` is the real gate; a non-operator
 * is sent away first.
 */
export const Route = createFileRoute('/_app/ops/queue')({
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: OpsQueuePage,
});

const TH = 'px-3 py-2 text-left text-sm font-normal whitespace-nowrap text-muted-foreground';
const THN = 'px-3 py-2 text-right text-sm font-normal whitespace-nowrap text-muted-foreground';
const TD = 'px-3 py-2.5 align-top';
const NUM = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';
const ROW = 'border-b border-line last:border-0';

function Section({ title, testId, empty, children }: { title: string; testId: string; empty: string | null; children: ReactNode }) {
  return (
    <section data-testid={testId} className="rise mb-4 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">{title}</h2>
      {empty ? <p className="px-4 py-6 text-center text-base text-muted-foreground">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

function OpsQueuePage() {
  const query = trpc.ops.queue.useQuery(undefined, { refetchInterval: QUEUE_REFRESH_MS, refetchOnWindowFocus: true });
  const unauthorized = useUnauthorizedRedirect(query);
  if (unauthorized) return null;
  const data = query.data as QueueOverview | undefined;

  if (query.isError) {
    return (
      <Page title="Queue" subtitle="The workers and the jobs on this server's queue.">
        <p role="alert" className="rise text-base text-fail">The queue could not be loaded. Try again.</p>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Queue" subtitle="The workers and the jobs on this server's queue.">
        <Skeleton className="h-40 w-full bg-raised" />
      </Page>
    );
  }
  const workers = workerRowsView(data.workers, data.queue);
  const types = typeRowsView(data.types);
  const attention = attentionRowsView(data.attention);
  const failures = failureRowsView(data.failures);

  return (
    <Page title="Queue" subtitle={`The workers and the jobs on this server's queue (${data.queue}), every 15 seconds.`}>
      <Section title="Workers" testId="queue-workers" empty={workers.length === 0 ? WORKERS_EMPTY : null}>
        <table className="w-full min-w-[860px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>Worker</th><th className={TH}>Queue</th><th className={TH}>Version</th><th className={TH}>Last beat</th>
            <th className={THN}>Browsers</th><th className={TH}>Running</th><th className={TH}>Switches</th>
          </tr></thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} data-stale={String(w.stale)} className={ROW}>
                <td className={`${TD} font-mono text-sm`}>{w.id}</td>
                <td className={`${TD} font-mono text-sm`}>{w.queue}{w.thisQueue ? <span className="ml-2 text-muted-foreground">(this server)</span> : null}</td>
                <td className={`${TD} font-mono text-sm`}>{w.version}</td>
                <td className={`${TD} whitespace-nowrap ${w.stale ? 'text-fail' : ''}`}>{w.beatLabel}{w.stale ? ' — stopped answering' : ''}</td>
                <td className={NUM}>{w.browsersLabel}</td>
                <td className={`${TD} text-sm text-muted-foreground`}>{w.lanesLabel}</td>
                <td className={`${TD} text-sm text-muted-foreground`}>{w.switchesLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Jobs" testId="queue-types" empty={types.length === 0 ? TYPES_EMPTY : null}>
        <table className="w-full min-w-[720px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>Type</th><th className={THN}>Queued</th><th className={THN}>Running</th><th className={THN}>Done (24 h)</th>
            <th className={THN}>Failed (24 h)</th><th className={THN}>Oldest waiting</th><th className={THN}>Longest running</th>
          </tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.type} className={ROW}>
                <td className={`${TD} font-mono text-sm`}>{t.type}</td>
                <td className={NUM}>{t.queued}</td><td className={NUM}>{t.running}</td><td className={NUM}>{t.done}</td>
                <td className={NUM}>{t.failed}</td><td className={NUM}>{t.oldestLabel}</td><td className={NUM}>{t.longestLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Needs attention" testId="queue-attention" empty={attention.length === 0 ? ATTENTION_EMPTY : null}>
        <table className="w-full min-w-[860px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>What</th><th className={TH}>Type</th><th className={THN}>For</th><th className={TH}>Website</th>
            <th className={TH}>Job</th><th className={TH}>Worker</th><th className={TH}>Last error</th>
          </tr></thead>
          <tbody>
            {attention.map((a) => (
              <tr key={a.key} className={ROW}>
                <td className={`${TD} text-fail`}>{a.label}</td>
                <td className={`${TD} font-mono text-sm`}>{a.type}</td>
                <td className={NUM}>{a.ageLabel}</td>
                <td className={TD}>
                  {a.website ? <Link to="/ops/websites/$sourceId" params={{ sourceId: a.website.sourceId }} className="underline-offset-2 hover:underline">{a.website.name}</Link> : '—'}
                  {a.run ? <span className="ml-2 font-mono text-sm text-muted-foreground">{a.run}</span> : null}
                </td>
                <td className={`${TD} font-mono text-sm`}>{a.job}</td>
                <td className={`${TD} font-mono text-sm text-muted-foreground`}>{a.worker}</td>
                <td className={`${TD} max-w-[320px] text-sm break-words text-muted-foreground`}>{a.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Recent failures" testId="queue-failures" empty={failures.length === 0 ? FAILURES_EMPTY : null}>
        <table className="w-full min-w-[720px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>Type</th><th className={THN}>Attempts</th><th className={TH}>Error</th><th className={THN}>Finished</th>
          </tr></thead>
          <tbody>
            {failures.map((f) => (
              <tr key={f.key} className={ROW}>
                <td className={`${TD} font-mono text-sm`}>{f.type}</td>
                <td className={NUM}>{f.attemptsLabel}</td>
                <td className={`${TD} max-w-[480px] text-sm break-words text-muted-foreground`}>{f.error}</td>
                <td className={NUM}>{f.finishedLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </Page>
  );
}
