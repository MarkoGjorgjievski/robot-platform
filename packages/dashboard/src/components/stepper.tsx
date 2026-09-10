// packages/dashboard/src/components/stepper.tsx
// The Extract tab's three-step shell (spec: Pages, Sample, Run).
//
// The rule the whole tab is built on: **nothing disappears**. A step that is
// finished locks and keeps its content on screen behind an "Edit" button; a
// step that is not reachable yet stays visible, dimmed, with the reason in
// place of its usual subtitle. Only the *interactivity* changes — a
// locked/later section wraps its children in `<div inert>` (React 19), so the
// content is still readable and still in the document, but nothing inside it
// can be clicked, typed into, or tabbed to.
//
// Visually (spec 7): none of this is a box. The strip is three quiet cells
// carrying a 2px rail under them — accent on the current step, pass on a
// finished one, rule-soft on one that is out of reach — and each section is a
// block on the paper separated from the one above by a single rule. No glyphs:
// a finished step is marked by the colour of its rail, not by a check.
import type { ReactNode } from 'react';
import type { StepState } from '../lib/extract-view';

export type Step = { n: number; title: string; detail: string; state: StepState };

/** The horizontal strip above the sections: where you are, and what each step already knows. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <div role="list" className="flex gap-2">
      {steps.map((step) => {
        const done = step.state === 'done';
        const current = step.state === 'current';
        return (
          <div
            key={step.n}
            role="listitem"
            aria-current={current ? 'step' : undefined}
            className={`flex min-w-0 flex-1 items-baseline gap-2 border-b-2 pb-2 ${
              current
                ? 'border-accent-600 text-gray-900'
                : done
                  ? 'border-pass text-gray-900'
                  : 'border-gray-200 text-gray-600'
            }`}
          >
            <span className="flex-shrink-0 font-mono text-[12px]">{step.n}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{step.title}</span>
              <span className="block truncate text-[11px] leading-[1.35] text-gray-600">{step.detail}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One numbered section of the stepper.
 *
 * `hint` is the ordinary subtitle ("where the products come from"). `reason`
 * replaces it while the section is locked or not yet reachable, so the dimmed
 * section says *why* it is dimmed rather than leaving the operator to guess.
 * `onEdit` is offered only on a `done` section — that is the handle that
 * reopens it.
 *
 * The rule above the heading is what separates one section from the next, so
 * the first section (n === 1) draws none: there is nothing above it to be
 * separated from.
 */
export function Section({
  n,
  title,
  hint,
  reason,
  state,
  onEdit,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  /** Shown instead of `hint` while the section is locked or not yet reachable. */
  reason?: string;
  state: StepState;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const dimmed = state === 'locked' || state === 'later';
  const headingId = `extract-step-${n}`;
  const subtitle = dimmed && reason ? reason : hint;
  return (
    <section
      aria-labelledby={headingId}
      aria-disabled={dimmed ? true : undefined}
      className={`mt-6 ${n > 1 ? 'border-t border-gray-200 pt-6' : ''} ${dimmed ? 'opacity-50' : ''}`}
    >
      <div className="flex items-baseline gap-3">
        <h3 id={headingId} className="flex flex-shrink-0 items-baseline gap-2">
          <span className="font-mono text-[12px] text-gray-600">{n}</span>
          <span className="name text-lg leading-[1.25]">{title}</span>
        </h3>
        {subtitle && <span className="min-w-0 flex-1 truncate text-xs text-gray-600">{subtitle}</span>}
        {state === 'done' && onEdit && (
          <button type="button" className="btn-quiet ml-auto flex-shrink-0" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      {/* Children always render — a locked section keeps everything it knows on
          screen; `inert` is what takes the interactivity away. A finished
          section keeps its content too, quieted to 60% rather than boxed off
          behind a grey background. */}
      <div className={`mt-3 ${state === 'done' ? 'opacity-60' : ''}`} inert={dimmed || undefined}>
        {children}
      </div>
    </section>
  );
}
