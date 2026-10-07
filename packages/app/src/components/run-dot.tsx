import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import { runDotLabel, type RunDotStatus } from '../lib/run-dot-view';

/**
 * The run status dot (spec §4). Eight pixels, one per state, carried everywhere
 * a run is mentioned — so "is anything running?" is answerable from any screen
 * without reading a word.
 *
 * `running` is the only one that moves, and it is the only white one: a pulsing
 * white dot means work is in flight right now.
 */
const DOT: Record<RunDotStatus, string> = {
  idle: 'bg-faint',
  running: 'bg-text dot-running',
  done: 'bg-pass',
  failed: 'bg-fail',
  partial: 'bg-warn',
};

export function RunDot({
  status,
  detail,
  className,
  decorative = false,
}: {
  status: RunDotStatus;
  /** Appended to the state word in the tooltip, e.g. "3 h ago". */
  detail?: string;
  className?: string;
  /**
   * True for a dot that illustrates text already on the screen rather than
   * standing in for it (final review M6: the ops empty state's "Nothing
   * needs you right now" — the dot repeats what the sentence beside it
   * already says). Hidden from assistive tech instead of announced again,
   * and carries no tooltip to open.
   */
  decorative?: boolean;
}) {
  const label = runDotLabel(status);
  const tooltip = detail ? `${label} · ${detail}` : label;

  // A span, not a button: this is a status, not a control. `tabIndex` stays
  // off it so the keyboard walks the row's real actions instead.
  const dot = (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      // A literal 8px, not `size-2`: Tailwind's spacing scale is relative to
      // the root font size and ours is 13px, so `size-2` would be 6.5px and
      // the spec's dot is 8 (see the note in styles/app.css).
      className={cn('inline-block size-[8px] shrink-0 rounded-full align-middle', DOT[status], className)}
    />
  );
  if (decorative) return dot;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{dot}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
