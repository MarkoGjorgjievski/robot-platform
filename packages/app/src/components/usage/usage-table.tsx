import { Link } from '@tanstack/react-router';
import { Skeleton } from '../ui/skeleton';
import type { UsageRowView } from '../../lib/usage-view';

/** Per project: what it cost and how many pages it took. Every project is a row, a quiet one at $0.00. */
export function UsageTable({ rows, loading }: { rows: UsageRowView[]; loading: boolean }) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
        <table className="w-full min-w-[480px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col />
            <col className="w-[116px]" />
            <col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
              <th className="px-4 text-left text-sm">Project</th>
              <th className="px-3 text-right text-sm">Spend</th>
              <th className="px-4 text-right text-sm">Pages captured</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1].map((i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5"><Skeleton className="h-3.5 w-32 bg-raised" /></td>
                    <td colSpan={2} />
                  </tr>
                ))
              : rows.map((r) => (
                  <tr key={r.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                    <td className="max-w-0 truncate px-4 py-2.5">
                      <Link to="/projects/$project" params={{ project: r.slug }} className="text-text underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">{r.spendLabel}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">{r.pagesLabel}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
