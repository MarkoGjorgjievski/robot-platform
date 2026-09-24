import { Skeleton } from '../ui/skeleton';
import { monthLabel, pagesLabel, usdLabel } from '../../lib/usage-view';

/**
 * The one 28 px figure in the app (spec §4): what the organisation spent in
 * the month shown. Pages captured is its secondary line — a count, not money,
 * so it does not compete for the headline.
 */
export function UsageTotal({
  month,
  spendUsd,
  pagesCaptured,
  loading,
}: {
  month: string;
  spendUsd: number;
  pagesCaptured: number;
  loading: boolean;
}) {
  return (
    <div className="rise rounded-[6px] border border-line bg-panel px-4 py-4 [box-shadow:var(--shadow)]">
      <div className="text-sm text-muted-foreground">Spend in {monthLabel(month)}</div>
      {loading ? (
        <Skeleton className="mt-1 h-8 w-32 bg-raised" />
      ) : (
        <div className="mt-1 font-mono text-3xl font-semibold tabular-nums" data-testid="usage-total">
          {usdLabel(spendUsd)}
        </div>
      )}
      <div className="mt-1 text-sm text-muted-foreground">{loading ? '' : `${pagesLabel(pagesCaptured)} captured`}</div>
    </div>
  );
}
