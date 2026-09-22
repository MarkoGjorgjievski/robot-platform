import { Check } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { StepState } from '../../lib/site/extract-view';
import type { SchemaStep } from '../../lib/site/schema-stepper-view';

export type StepCell = {
  step: SchemaStep;
  /** "1 · Fields" is composed here; this is the half after the number. */
  n: number;
  title: string;
  /** The ordinary second line — what the step already knows. */
  detail: string;
  /** Replaces `detail` while the cell is out of reach, so it says why. */
  reason?: string;
  state: StepState;
};

/**
 * The Schema tab's two steps, side by side above the panels (spec 2026-09-18
 * §2). Each cell is the way into its step, so each cell is a link — except one
 * that is out of reach, which is a disabled button carrying the reason on its
 * second line rather than a link that would land you nowhere.
 *
 * Monochrome throughout: the current step is the one wearing the text-colour
 * outline, a finished one is marked by a check beside its number, and an
 * unreachable one is simply quieter. There is no state colour here — where you
 * are in a stepper is not a pass or a failure (spec §4).
 */
export function StepperStrip({
  project,
  site,
  steps,
}: {
  project: string;
  site: string;
  steps: [StepCell, StepCell];
}) {
  return (
    <div role="list" className="rise mb-4 flex flex-col gap-2 sm:flex-row">
      {steps.map((cell) => {
        const current = cell.state === 'current';
        const done = cell.state === 'done';
        // `later` is the only state that is genuinely out of reach (step 2 of a
        // project with no fields). `locked` means only "you are on the other
        // step": it is quieter, but it is still the way there, and a disabled
        // cell would leave a customer on step 1 with nowhere to go.
        const out = cell.state === 'later';
        const quiet = out || cell.state === 'locked';
        // The border is the whole signal, so it is 1 px in every state and only
        // its colour moves — a current cell that grew a second pixel would
        // shift the two cells against each other by half a pixel each.
        const frame = `flex min-h-[54px] min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[6px] border px-3 py-2 text-left [box-shadow:var(--shadow)] ${
          current ? 'border-text bg-panel' : out ? 'border-line bg-panel' : 'border-line bg-panel hover:border-line-hover'
        }`;

        const body = (
          <>
            <span className={`flex items-center gap-1.5 text-base ${current ? 'font-medium text-text' : quiet ? 'text-muted-foreground' : 'text-text'}`}>
              {/* The number in mono, as every other counted thing in this app. */}
              <span className="font-mono text-sm">{cell.n}</span>
              <span aria-hidden className="text-faint">
                ·
              </span>
              <span className="truncate">{cell.title}</span>
              {done ? <Check aria-label="done" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
            </span>
            <span className="truncate text-sm text-muted-foreground">{out && cell.reason ? cell.reason : cell.detail}</span>
          </>
        );

        return (
          // `aria-current` lives on the cell, not on the anchor inside it:
          // TanStack writes its own `aria-current="page"` on an active link and
          // that is the wrong word for a stepper — and with no `?step` in the
          // URL at all (the default, step 2) no link is active, so nothing
          // would be marked as current at all.
          <div key={cell.step} role="listitem" aria-current={current ? 'step' : undefined} className="flex min-w-0 flex-1">
            {out ? (
              <button type="button" disabled className={`${frame} cursor-not-allowed`}>
                {body}
              </button>
            ) : (
              <Link
                to="/projects/$project/sites/$site"
                params={{ project, site }}
                // The other params ride along: an arrival's `addPage`/`field`
                // must not be dropped by a step change before it is consumed.
                search={(s) => ({ ...s, step: cell.step })}
                className={frame}
              >
                {body}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
