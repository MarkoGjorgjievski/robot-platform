import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Loader2, Lock } from 'lucide-react';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export type StripTone = 'neutral' | 'warn' | 'fail';

export type StripAction = {
  label: string;
  disabled: boolean;
  reason?: string;
  busy?: boolean;
  onClick: () => void;
  /** Called when the customer clicks the button while it is disabled. */
  onDisabledClick?: () => void;
};

/**
 * A disabled `<button>` fires no pointer events, so anything that has to hear
 * about a pointer — a tooltip, or the tab's "they tried, show them the
 * problems" handler — hangs off a wrapper around it rather than off the button.
 * The reason is written out under the strip as well; a tooltip alone is not a
 * visible reason (spec §6).
 */
function Reasoned({ reason, onDisabledClick, children }: { reason?: string; onDisabledClick?: () => void; children: ReactNode }) {
  const wrapped = <span onClick={onDisabledClick}>{children}</span>;
  if (!reason) return wrapped;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-block" onClick={onDisabledClick}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The fixed-height strip above the grid (spec §5.6): what the verification
 * knows on the left, what you can do about it on the right.
 *
 * Fixed height is the point — it sits directly over a table, and a strip that
 * grew a line when a stage arrived would push the whole grid down mid-run. Both
 * halves therefore reserve their second line whether or not they have one to
 * put there.
 *
 * Tone is a 2 px left rail and the colour of the note, never a fill behind the
 * text (spec §4): a whole panel washed amber reads as the website being wrong
 * rather than as one run having stalled.
 */
export function StatusStrip({
  summary,
  stage,
  progress,
  note,
  tone = 'neutral',
  lockNote,
  save,
  verify,
  extract,
}: {
  summary: string;
  /** "capturing 2/3" and friends, while a run is in flight. */
  stage?: string | null;
  /** 0–1 while a verification is running, `null` otherwise. */
  progress?: number | null;
  /** A stalled run's sentence or a failed run's message; coloured by `tone`. */
  note?: string | null;
  tone?: StripTone;
  lockNote?: string | null;
  save: StripAction;
  verify: StripAction;
  extract: { disabled: boolean; reason: string; project: string; site: string };
}) {
  const rail = tone === 'warn' ? 'border-l-warn' : tone === 'fail' ? 'border-l-fail' : 'border-l-line';
  const noteColour = tone === 'warn' ? 'text-warn' : tone === 'fail' ? 'text-fail' : 'text-muted-foreground';
  // One reason at a time, in the order a customer meets them: what stops the
  // run, then what stops the save, then what the run has not unlocked yet.
  const reason =
    (verify.disabled ? verify.reason : undefined) ??
    (save.disabled ? save.reason : undefined) ??
    (extract.disabled ? extract.reason : undefined) ??
    '';

  return (
    <div className={`rise rounded-[6px] border border-line border-l-2 bg-panel px-4 py-3 [box-shadow:var(--shadow)] ${rail}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {/* The live region is this column, not the strip: the summary and the
            stage are what change as a verification runs, and a screen reader
            announcing them should not read the three button labels and the
            reason line out again with every update. */}
        <div role="status" aria-live="polite" className="min-w-0 flex-1">
          <p className="truncate text-base font-medium" title={summary}>
            {summary}
          </p>
          {/* Always here, empty or not: this strip's height is the grid's top edge. */}
          <div className="mt-1 flex min-h-[17px] min-w-0 items-center gap-2 text-sm text-muted-foreground">
            {progress !== null && progress !== undefined ? (
              <Progress value={Math.round(progress * 100)} className="w-[92px] shrink-0" aria-label="Verification progress" />
            ) : null}
            {stage ? (
              <span className="truncate" title={stage}>
                {stage}
              </span>
            ) : null}
            {note ? (
              <span className={`truncate ${noteColour}`} title={note}>
                {note}
              </span>
            ) : null}
            {lockNote ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                <Lock className="size-3 shrink-0" />
                {lockNote}
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Reasoned reason={save.disabled ? save.reason : undefined}>
              <Button variant="outline" size="sm" disabled={save.disabled} onClick={save.onClick}>
                {save.busy ? <Loader2 className="animate-spin" /> : null}
                {save.label}
              </Button>
            </Reasoned>

            <Reasoned
              reason={verify.disabled ? verify.reason : undefined}
              onDisabledClick={verify.disabled ? verify.onDisabledClick : undefined}
            >
              <Button variant="outline" size="sm" disabled={verify.disabled} onClick={verify.onClick}>
                {verify.busy ? <Loader2 className="animate-spin" /> : null}
                {verify.label}
              </Button>
            </Reasoned>

            {extract.disabled ? (
              // Outline while it is off, filled once it is on: a disabled solid
              // button is the loudest thing on the strip and the one thing that
              // cannot be pressed. The fill is the reward for going green.
              <Reasoned reason={extract.reason}>
                <Button variant="outline" size="sm" disabled>
                  Go to Extract
                  <ArrowRight />
                </Button>
              </Reasoned>
            ) : (
              <Button size="sm" asChild>
                <Link to="/projects/$project/sites/$site/extract" params={{ project: extract.project, site: extract.site }}>
                  Go to Extract
                  <ArrowRight />
                </Link>
              </Button>
            )}
          </div>

          <p className="mt-1 min-h-[17px] truncate text-right text-sm text-muted-foreground" title={reason}>
            {reason}
          </p>
        </div>
      </div>
    </div>
  );
}
