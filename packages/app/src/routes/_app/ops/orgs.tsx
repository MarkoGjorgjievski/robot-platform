import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Page } from '../../../components/page';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { LIMIT_REACHED, matchesOrgQuery, opsOrgMonths, opsOrgsView, type OpsOrgRow } from '../../../lib/ops-orgs-view';
import { trpc } from '../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../lib/use-unauthorized-redirect';

/** Shareable state: the month and the name filter. */
export type OpsOrgsSearch = { month?: string; q?: string };

/**
 * Organisations (spec 2026-10-24 metering §2.4): every org's month — pages, runs, AI spend against its monthly limit,
 * Jev apart. Read-only. The server's FORBIDDEN on `ops.orgs` is the real gate; a non-operator is sent away first.
 */
export const Route = createFileRoute('/_app/ops/orgs')({
  validateSearch: (search: Record<string, unknown>): OpsOrgsSearch => ({
    month: typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) ? search.month : undefined,
    q: typeof search.q === 'string' && search.q.length > 0 ? search.q : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: OpsOrgsPage,
});

const NUM = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';

function OpsOrgsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const months = opsOrgMonths(new Date());
  const month = months.some((m) => m.key === search.month) ? search.month! : months[0]!.key;
  const query = trpc.ops.orgs.useQuery({ month });
  const unauthorized = useUnauthorizedRedirect(query);
  if (unauthorized) return null;

  const patch = (p: Partial<OpsOrgsSearch>) => void navigate({ to: '/ops/orgs', search: (prev) => ({ ...prev, ...p }), replace: true });
  const rows = opsOrgsView(((query.data?.rows ?? []) as OpsOrgRow[]).filter((r) => matchesOrgQuery(r, search.q ?? '')));

  return (
    <Page title="Organisations" subtitle="Each organisation's month: pages, runs and AI spend against its monthly limit.">
      <div className="rise mb-3 flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={(v) => patch({ month: v === months[0]!.key ? undefined : v })}>
          <SelectTrigger aria-label="Month" className="min-w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input id="ops-orgs-search" aria-label="Filter organisations" placeholder="Filter organisations" value={search.q ?? ''} onChange={(e) => patch({ q: e.target.value || undefined })} className="w-[240px] max-w-full" />
      </div>
      {query.isError ? (
        <p role="alert" className="rise text-base text-fail">Organisations could not be loaded. Try again.</p>
      ) : (
        <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
          <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
            <table className="w-full min-w-[860px] border-collapse text-base md:min-w-0">
              <thead>
                <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
                  <th className="px-4 text-left text-sm">Organisation</th>
                  <th className="px-3 text-right text-sm">Websites</th>
                  <th className="px-3 text-right text-sm">Pages</th>
                  <th className="px-3 text-right text-sm">Runs</th>
                  <th className="px-3 text-right text-sm">AI spend</th>
                  <th className="px-3 text-right text-sm">Limit</th>
                  <th className="px-3 text-right text-sm">Used</th>
                  <th className="px-4 text-right text-sm">Jev</th>
                </tr>
              </thead>
              <tbody>
                {query.isPending
                  ? [0, 1, 2].map((i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5"><Skeleton className="h-3.5 w-40 bg-raised" /></td>
                        <td colSpan={7} />
                      </tr>
                    ))
                  : rows.map((r) => (
                      <tr key={r.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                        <td className="max-w-0 truncate px-4 py-2.5 text-text">{r.name}</td>
                        <td className={`${NUM} text-muted-foreground`}>{r.websitesLabel}</td>
                        <td className={`${NUM} text-muted-foreground`}>{r.pagesLabel}</td>
                        <td className={`${NUM} text-muted-foreground`}>{r.runsLabel}</td>
                        <td className={NUM}>{r.aiLabel}</td>
                        <td className={NUM}>{r.capLabel}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <span className="font-mono tabular-nums">{r.percentLabel}</span>
                          {r.reached ? <span className="ml-2 rounded-full border border-fail px-2 text-sm text-fail">{LIMIT_REACHED}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground opacity-70">{r.jevLabel}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {!query.isPending && rows.length === 0 ? <p className="px-4 py-10 text-center text-base text-muted-foreground">No organisations match.</p> : null}
        </div>
      )}
    </Page>
  );
}
