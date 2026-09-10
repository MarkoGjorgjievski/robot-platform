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
import { Check } from 'lucide-react';
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
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 ${
              current
                ? 'border-accent-500 bg-accent-50'
                : done
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : 'border-gray-200 bg-gray-50 opacity-60'
            }`}
          >
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                current
                  ? 'bg-accent-600 text-white'
                  : done
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-300 text-gray-700'
              }`}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : step.n}
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-xs font-medium ${current ? 'text-accent-700' : 'text-gray-900'}`}>
                {step.title}
              </span>
              <span className="block truncate text-[11px] text-gray-500">{step.detail}</span>
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
      className={`rounded-lg border border-gray-200 p-4 ${state === 'done' ? 'bg-gray-50' : 'bg-white'} ${
        dimmed ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-baseline gap-3">
        <h3 id={headingId} className="flex-shrink-0 text-sm font-medium text-gray-900">
          {n} · {title}
        </h3>
        {subtitle && <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{subtitle}</span>}
        {state === 'done' && onEdit && (
          <button type="button" className="btn-quiet ml-auto flex-shrink-0" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      {/* Children always render — a locked section keeps everything it knows on
          screen; `inert` is what takes the interactivity away. */}
      <div className="mt-3" inert={dimmed || undefined}>
        {children}
      </div>
    </section>
  );
}
