import { cn } from '../../lib/utils';
import type { Segment } from '../../lib/site/verification-model';

/**
 * One field's readiness across every product card, in card order (spec §2.4).
 * A row wash would say the whole field is one thing; this is a strip of small
 * independent facts instead — state colour lives only on the segment.
 */
const SEGMENT_CLASS: Record<Segment, string> = {
  empty: 'border border-line',
  suggested: 'bg-warn',
  answered: 'bg-pass',
  failed: 'bg-fail',
};

const SEGMENT_WORD: Record<Segment, string> = {
  empty: 'empty',
  suggested: 'suggested',
  answered: 'confirmed',
  failed: 'failed',
};

function summaryLabel(label: string, segments: Segment[]): string {
  const answered = segments.filter((s) => s === 'answered').length;
  const suggested = segments.filter((s) => s === 'suggested').length;
  const failed = segments.filter((s) => s === 'failed').length;
  let text = `${label}: ${answered} of ${segments.length} confirmed`;
  if (suggested > 0) text += `, ${suggested} suggested`;
  if (failed > 0) text += `, ${failed} failed`;
  return text;
}

export function Battery({
  segments,
  onSegment,
  label,
  disabled,
}: {
  segments: Segment[];
  onSegment: (i: number) => void;
  /** The field's name — the segments' own "Price on product n: …" labels are built from it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <span role="img" aria-label={summaryLabel(label, segments)} className="inline-flex shrink-0 items-center gap-1">
      {segments.map((segment, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onSegment(i)}
          aria-label={`${label} on product ${i + 1}: ${SEGMENT_WORD[segment]}`}
          className={cn('h-2 w-5 rounded-[2px] disabled:pointer-events-none disabled:opacity-50', SEGMENT_CLASS[segment])}
        />
      ))}
    </span>
  );
}
