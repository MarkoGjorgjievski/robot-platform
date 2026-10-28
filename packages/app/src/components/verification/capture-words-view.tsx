import { Clock, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import type { ProofCapture } from '../../lib/site/proof-capture-state';
import { barWords, cardWords, isWaiting, type CardIcon } from '../../lib/site/turned-away';
import { useNow } from '../../lib/use-now';
import { useStaffDetail } from '../../lib/use-staff-detail';

/** Ticks only while this capture shows a clock: counting up (capturing) or down (waiting). */
const counting = (c: ProofCapture | undefined) => c?.status === 'capturing' || c?.status === 'waiting';

function StateIcon({ icon }: { icon: CardIcon }) {
  if (icon === 'spinner') return <Loader2 aria-hidden className="mt-[2px] size-3.5 shrink-0 animate-spin" />;
  if (icon === 'clock') return <Clock aria-hidden className="mt-[2px] size-3.5 shrink-0" />;
  if (icon === 'alert') return <TriangleAlert aria-hidden className="mt-[2px] size-3.5 shrink-0" />;
  return null;
}

/**
 * One product's screenshot state in words (spec 2026-10-28 §3.6): the icon, every line in full (the
 * sentence wraps; nothing is clamped), and Try again / Swap product when the state offers them.
 * `size` follows where it sits: `xs` in a card under the column head, `sm` in the panel under the table.
 */
export function CaptureStateWords({
  capture,
  name,
  disabled,
  onRetry,
  onSwap,
  size = 'xs',
}: {
  capture: ProofCapture | undefined;
  /** The website's name (`sources.name`), as the breadcrumb shows it. */
  name: string | null | undefined;
  disabled: boolean;
  onRetry: () => void;
  onSwap: () => void;
  size?: 'xs' | 'sm';
}) {
  const staff = useStaffDetail();
  const now = useNow(counting(capture));
  const words = cardWords(capture, name, now, { staff });
  const tone = words.tone === 'warn' ? 'text-warn' : 'text-muted-foreground';
  return (
    <div className="min-w-0 space-y-1.5">
      <div className={`flex min-w-0 items-start gap-1.5 text-sm ${tone}`} role={isWaiting(capture) || capture?.status === 'failed' ? 'status' : undefined}>
        <StateIcon icon={words.icon} />
        <div className="min-w-0 space-y-0.5">
          {words.lines.map((line, i) => (
            <p key={i} className="break-words">
              {line}
            </p>
          ))}
        </div>
      </div>
      {words.actions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {words.actions.includes('retry') ? (
            <Button variant="outline" size={size} disabled={disabled} onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {words.actions.includes('swap') ? (
            <Button variant="outline" size={size} disabled={disabled} onClick={onSwap}>
              Swap product
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one bar above the fields table (spec §3.6) while any of the first three products waits for a
 * try or was given up: one line in the cards' warning tone. Nothing at all otherwise.
 */
export function TurnedAwayBar({ captures, name }: { captures: ReadonlyArray<ProofCapture | undefined>; name: string | null | undefined }) {
  const now = useNow(captures.slice(0, 3).some((c) => c?.status === 'waiting'));
  const text = barWords(captures, name, now);
  if (!text) return null;
  return (
    <p role="status" className="border-l-2 border-warn pl-3 text-sm text-warn">
      {text}
    </p>
  );
}
