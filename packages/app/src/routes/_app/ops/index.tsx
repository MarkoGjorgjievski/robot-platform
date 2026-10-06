import { useMemo } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { Page } from '../../../components/page';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { RunDot } from '../../../components/run-dot';
import { Skeleton } from '../../../components/ui/skeleton';
import { relativeTime } from '../../../lib/projects-view';
import { runDotState } from '../../../lib/run-dot-view';
import {
  OPS_REASONS,
  defaultOpsView,
  lastRunText,
  matchesOpsQuery,
  moneyText,
  needsAttention,
  opsRowOrder,
  sortFooterText,
  sortRowsBy,
  totalsText,
  verifiedState,
  verifiedText,
  type OpsSortKey,
  type OpsWebsiteRow,
} from '../../../lib/ops-view';
import { trpc } from '../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../lib/use-unauthorized-redirect';

/** Shareable state (plan "Ops design"): view, reason, search, customer and sort all live in the URL. */
export type OpsOverviewSearch = {
  view?: 'attention' | 'all';
  reason?: 'drift' | 'failed' | 'unverified';
  q?: string;
  customer?: string;
  sort?: OpsSortKey;
};

const SORT_KEYS: OpsSortKey[] = ['run-desc', 'run-asc', 'spend-desc', 'spend-asc'];
const REASON_KEYS = OPS_REASONS.map((r) => r.key);

/**
 * Ops overview — "which customer websites need us, and why?" (spec "Ops
 * design"). Non-operators never see this screen: the server's FORBIDDEN on
 * `ops.websites` is the real gate; here the route itself sends a
 * non-operator back to /projects before it renders anything.
 */
export const Route = createFileRoute('/_app/ops/')({
  validateSearch: (search: Record<string, unknown>): OpsOverviewSearch => ({
    view: search.view === 'all' || search.view === 'attention' ? search.view : undefined,
    reason: REASON_KEYS.includes(search.reason as (typeof REASON_KEYS)[number]) ? (search.reason as OpsOverviewSearch['reason']) : undefined,
    q: typeof search.q === 'string' && search.q.length > 0 ? search.q : undefined,
    customer: typeof search.customer === 'string' && search.customer.length > 0 ? search.customer : undefined,
    sort: SORT_KEYS.includes(search.sort as OpsSortKey) ? (search.sort as OpsSortKey) : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: OpsOverviewPage,
});

/** The query also refetches on window focus and every 60 s (Global Constraints). */
const REFRESH_MS = 60_000;

function OpsOverviewPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const websites = trpc.ops.websites.useQuery(undefined, { refetchInterval: REFRESH_MS, refetchOnWindowFocus: true });
  const unauthorized = useUnauthorizedRedirect(websites);
  const rows = (websites.data ?? []) as OpsWebsiteRow[];

  function patchSearch(patch: Partial<OpsOverviewSearch>) {
    void navigate({
      to: '/ops',
      search: (prev) => {
        const out: OpsOverviewSearch = { ...prev, ...patch };
        for (const key of Object.keys(out) as (keyof OpsOverviewSearch)[]) {
          if (out[key] === undefined) delete out[key];
        }
        return out;
      },
      replace: true,
    });
  }

  const attentionCount = useMemo(() => rows.filter(needsAttention).length, [rows]);
  const view = search.view ?? defaultOpsView(attentionCount);

  const customers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows) byId.set(r.org.id, r.org.name);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'en', { sensitivity: 'base' }));
  }, [rows]);

  const scoped = useMemo(
    () => rows.filter((r) => (!search.customer || r.org.id === search.customer) && matchesOpsQuery(r, search.q ?? '')),
    [rows, search.customer, search.q],
  );
  const attentionScoped = useMemo(() => scoped.filter(needsAttention), [scoped]);
  const base = view === 'attention' ? attentionScoped : scoped;
  const activeReason = view === 'attention' ? OPS_REASONS.find((r) => r.key === search.reason) : undefined;
  const reasonFiltered = activeReason ? base.filter(activeReason.test) : base;
  const visible = search.sort ? sortRowsBy(reasonFiltered, search.sort) : opsRowOrder(reasonFiltered);

  function toggleSort(column: 'run' | 'spend') {
    patchSearch({ sort: search.sort === `${column}-desc` ? `${column}-asc` : `${column}-desc` });
  }
  function ariaSortFor(column: 'run' | 'spend'): 'ascending' | 'descending' | 'none' {
    if (search.sort === `${column}-desc`) return 'descending';
    if (search.sort === `${column}-asc`) return 'ascending';
    return 'none';
  }

  const loading = websites.isPending;
  const noWebsitesAtAll = !loading && !websites.isError && rows.length === 0;
  const nothingMatches = !loading && !websites.isError && !noWebsitesAtAll && visible.length === 0;
  const noActiveFilter = !search.q && !search.customer && !search.reason;
  const totalCustomers = new Set(rows.map((r) => r.org.id)).size;

  if (unauthorized) return null;

  return (
    <Page
      title="All websites"
      subtitle="Every customer's websites, the ones that need you first."
      actions={
        <>
          <span className="text-sm text-muted-foreground">
            Updated{' '}
            <span className="font-mono tabular-nums">
              {websites.dataUpdatedAt ? relativeTime(new Date(websites.dataUpdatedAt)) : 'just now'}
            </span>
          </span>
          <Button variant="outline" onClick={() => void websites.refetch()} disabled={websites.isFetching}>
            <RefreshCw className="size-4" />
            {websites.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </>
      }
    >
      {websites.isError ? (
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          <p role="alert" className="text-base text-fail">
            Couldn't load websites.
          </p>
          <Button variant="outline" onClick={() => void websites.refetch()} disabled={websites.isFetching}>
            {websites.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : noWebsitesAtAll ? (
        <div className="rise rounded-[6px] border border-line bg-panel p-5 [box-shadow:var(--shadow)]">
          <p className="text-base text-muted-foreground">No customer websites yet. They appear here as soon as a customer adds one.</p>
        </div>
      ) : (
        <>
          <div className="rise mb-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Show" className="inline-flex rounded-md border border-line bg-panel p-0.5">
              <button
                type="button"
                aria-pressed={view === 'attention'}
                onClick={() => patchSearch({ view: 'attention', reason: undefined })}
                className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-sm ${view === 'attention' ? 'bg-raised text-text' : 'text-muted-foreground hover:text-text'}`}
              >
                Needs attention <span className="font-mono tabular-nums">{attentionScoped.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={view === 'all'}
                onClick={() => patchSearch({ view: 'all', reason: undefined })}
                className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-sm ${view === 'all' ? 'bg-raised text-text' : 'text-muted-foreground hover:text-text'}`}
              >
                All <span className="font-mono tabular-nums">{scoped.length}</span>
              </button>
            </div>

            <label htmlFor="ops-search" className="sr-only">
              Search
            </label>
            <Input
              id="ops-search"
              type="search"
              placeholder="Search customers, websites or addresses"
              autoComplete="off"
              className="min-w-[200px] flex-1 sm:max-w-[320px]"
              value={search.q ?? ''}
              onChange={(e) => patchSearch({ q: e.target.value.length > 0 ? e.target.value : undefined })}
            />

            <Select value={search.customer ?? '__all__'} onValueChange={(v) => patchSearch({ customer: v === '__all__' ? undefined : v })}>
              <SelectTrigger aria-label="Customer" className="min-w-[160px]">
                <SelectValue placeholder="All customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All customers</SelectItem>
                {customers.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {view === 'attention' ? (
            <div role="group" aria-label="Narrow to one reason" className="rise mb-3 flex flex-wrap gap-1.5">
              {OPS_REASONS.map((reason) => {
                const n = attentionScoped.filter(reason.test).length;
                if (n === 0) return null;
                const pressed = search.reason === reason.key;
                return (
                  <button
                    key={reason.key}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => patchSearch({ reason: pressed ? undefined : reason.key })}
                    className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-sm ${pressed ? 'border-text text-text' : 'border-line text-muted-foreground hover:border-line-hover hover:text-text'}`}
                  >
                    {reason.label} <span className="font-mono tabular-nums">{n}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
            <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
              <table className="w-full min-w-[760px] border-collapse text-base md:min-w-0">
                <colgroup>
                  <col />
                  <col className="w-[200px]" />
                  <col className="w-[150px]" />
                  <col className="w-[150px]" />
                  <col className="w-[110px]" />
                </colgroup>
                <thead>
                  <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
                    <th className="px-4 text-left text-sm">Website</th>
                    <th className="px-3 text-left text-sm">Customer and project</th>
                    <th className="px-3 text-left text-sm">Verified</th>
                    <th className="px-3 text-right text-sm" aria-sort={ariaSortFor('run')}>
                      <button type="button" aria-label="Sort by last run" onClick={() => toggleSort('run')} className="inline-flex items-center gap-1 hover:text-text">
                        Last run
                      </button>
                    </th>
                    <th className="px-4 text-right text-sm" aria-sort={ariaSortFor('spend')}>
                      <button type="button" aria-label="Sort by spend this month" onClick={() => toggleSort('spend')} className="inline-flex items-center gap-1 hover:text-text">
                        This month
                      </button>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? <LoadingRows /> : null}
                  {!loading && visible.map((row) => <OpsRow key={row.sourceId} row={row} onCustomerClick={() => patchSearch({ customer: row.org.id })} />)}
                </tbody>
              </table>
            </div>

            {nothingMatches ? (
              <div className="flex flex-col items-center gap-2.5 px-4 py-10 text-center">
                {view === 'attention' && noActiveFilter ? (
                  <>
                    <RunDot status="done" />
                    <p className="text-base font-medium">Nothing needs you right now.</p>
                    <p className="text-sm text-muted-foreground">All {rows.length} websites are verified and their last runs finished.</p>
                    <Button variant="outline" onClick={() => patchSearch({ view: 'all' })}>
                      Show all websites
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-base text-muted-foreground">No websites match.</p>
                    <Button variant="outline" onClick={() => patchSearch({ q: undefined, customer: undefined, reason: undefined })}>
                      Clear search and filters
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-muted-foreground">
              <span>{totalsText(rows.length, totalCustomers)}</span>
              <span>{sortFooterText(search.sort)}</span>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

const VERIFIED_RAIL: Record<ReturnType<typeof verifiedState>, string> = {
  pass: 'border-pass',
  warn: 'border-warn',
  fail: 'border-fail',
};

/** The problem line under the host (Global Constraints): drift first, then a failed last run — never both at once. */
function problemLine(row: OpsWebsiteRow, runFailed: boolean): string | null {
  if (row.drifted > 0) return row.drifted === 1 ? '1 field stopped extracting' : `${row.drifted} fields stopped extracting`;
  if (runFailed) return 'Last run failed';
  return null;
}

function OpsRow({ row, onCustomerClick }: { row: OpsWebsiteRow; onCustomerClick: () => void }) {
  const runState = row.lastRun ? runDotState({ status: row.lastRun.status }) : 'idle';
  const problem = problemLine(row, runState === 'failed');

  return (
    <tr className="border-b border-line transition-colors last:border-0 hover:bg-raised">
      <td className="max-w-0 px-4 py-2.5">
        {/* Task 4 adds the real `/ops/websites/$sourceId` route; a plain anchor
            until then — same destination, no router type to satisfy yet. */}
        <a href={`/ops/websites/${row.sourceId}`} className="block truncate text-text underline-offset-4 hover:underline">
          {row.website.name}
        </a>
        {row.website.host ? <div className="truncate font-mono text-sm text-muted-foreground">{row.website.host}</div> : null}
        {problem ? <div className={`truncate text-sm ${row.drifted > 0 ? 'text-warn' : 'text-fail'}`}>{problem}</div> : null}
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          onClick={onCustomerClick}
          aria-label={`Show only ${row.org.name}'s websites`}
          className="block max-w-full truncate text-left text-text underline-offset-4 hover:underline"
        >
          {row.org.name}
        </button>
        <div className="truncate text-sm text-muted-foreground">{row.project.name}</div>
      </td>
      <td className="py-2.5 pr-3 pl-3 whitespace-nowrap">
        <span className={`inline-block border-l-2 pl-2.5 ${VERIFIED_RAIL[verifiedState(row.currentFields, row.fields)]}`}>
          {verifiedText(row.currentFields, row.fields)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <span className="inline-flex items-center justify-end gap-2">
          <RunDot status={runState} detail={row.lastRun ? lastRunText(row.lastRun) : undefined} />
          <span className="font-mono text-muted-foreground">{lastRunText(row.lastRun)}</span>
        </span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">{moneyText(row.spentThisMonthUsd)}</td>
    </tr>
  );
}

/** Three rows the shape of real ones — two lines in the name cell, so nothing jumps when the data lands. */
function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-line last:border-0">
          <td className="px-4 py-2.5">
            <Skeleton className="h-3.5 w-40 bg-raised" />
            <Skeleton className="mt-1.5 h-3 w-28 bg-raised" />
          </td>
          <td colSpan={4} />
        </tr>
      ))}
    </>
  );
}
