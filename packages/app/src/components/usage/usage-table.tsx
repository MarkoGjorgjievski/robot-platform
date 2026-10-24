import { Link } from '@tanstack/react-router';
import { Skeleton } from '../ui/skeleton';
import type { UsageRowView } from '../../lib/usage-view';

/**
 * Per project: how many pages it took, how many runs it made and, for staff, what it cost. Every project is a row.
 * Amounts are staff-only (spec 2026-10-17 §8a): the Spend column, a quiet project's $0.00
 * included, is drawn only when `showMoney`; a customer's table is projects, pages and runs.
 */
export function UsageTable({ rows, loading, showMoney }: { rows: UsageRowView[]; loading: boolean; showMoney: boolean }) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
        <table className="w-full min-w-[480px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col />
            {showMoney ? <col className="w-[116px]" /> : null}
            <col className="w-[132px]" />
            <col className="w-[96px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
              <th className="px-4 text-left text-sm">Project</th>
              {showMoney ? <th className="px-3 text-right text-sm">Spend</th> : null}
              <th className="px-4 text-right text-sm">Pages captured</th>
              <th className="px-4 text-right text-sm">Runs</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1].map((i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5"><Skeleton className="h-3.5 w-32 bg-raised" /></td>
                    <td colSpan={showMoney ? 3 : 2} />
                  </tr>
                ))
              : rows.map((r) => (
                  <tr key={r.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                    <td className="max-w-0 truncate px-4 py-2.5">
                      <Link to="/projects/$project" params={{ project: r.slug }} className="text-text underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    {showMoney ? <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">{r.spendLabel}</td> : null}
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">{r.pagesLabel}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">{r.runsLabel}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
