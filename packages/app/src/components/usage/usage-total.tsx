import { Skeleton } from '../ui/skeleton';
import { usageHeadline } from '../../lib/usage-view';

/**
 * The one 28 px figure in the app (spec §4): what the organisation spent in
 * the month shown. Pages captured is its secondary line — a count, not money,
 * so it does not compete for the headline. Spend is staff-only (spec
 * 2026-10-17 §8a): a customer's headline is the pages captured, with no
 * secondary line (`usageHeadline`).
 */
export function UsageTotal({
  month,
  spendUsd,
  pagesCaptured,
  loading,
  showMoney,
}: {
  month: string;
  spendUsd: number;
  pagesCaptured: number;
  loading: boolean;
  showMoney: boolean;
}) {
  const headline = usageHeadline({ spendUsd, pagesCaptured }, month, showMoney);
  return (
    <div className="rise rounded-[6px] border border-line bg-panel px-4 py-4 [box-shadow:var(--shadow)]">
      <div className="text-sm text-muted-foreground">{headline.label}</div>
      {loading ? (
        <Skeleton className="mt-1 h-8 w-32 bg-raised" />
      ) : (
        <div className="mt-1 font-mono text-3xl font-semibold tabular-nums" data-testid="usage-total">
          {headline.figure}
        </div>
      )}
      {headline.sub ? <div className="mt-1 text-sm text-muted-foreground">{loading ? '' : headline.sub}</div> : null}
    </div>
  );
}
