import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel } from '../../lib/usage-view';

/**
 * Which month the screen shows. Back is always possible; forward stops at
 * the current month — and rather than a disabled button that would owe the
 * reader a reason, the forward arrow is simply not there past it. A spacer
 * keeps the label from shifting when the arrow comes and goes.
 */
export function MonthStepper({
  month,
  isCurrent,
  onChange,
}: {
  month: string;
  isCurrent: boolean;
  onChange: (delta: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(-1)}
        className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-raised hover:text-text"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[132px] text-center text-base" aria-live="polite">
        {monthLabel(month)}
      </span>
      {isCurrent ? (
        <span aria-hidden className="size-7" />
      ) : (
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onChange(1)}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-raised hover:text-text"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}
