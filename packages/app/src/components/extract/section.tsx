import type { ReactNode } from 'react';

/**
 * One of the Extract tab's three sections. All three are always on screen, in
 * order, whatever state they are in — this tab has no wizard that swaps one
 * panel for another, because a step you cannot reach still has to say why, and a
 * step you have finished still has to show what it decided (spec §5.7).
 *
 * The number and title repeat the strip above deliberately: the strip is the
 * overview, and a panel four screens down that said only "Sample" would leave
 * the reader counting.
 */
export function Section({
  n,
  title,
  hint,
  action,
  children,
}: {
  n: number;
  title: string;
  /** What this step is for, in the register of the strip's second line. */
  hint: string;
  /** The section's own control, right-aligned in the header — "Edit pages". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-medium">
          {/* The number in mono, as every other counted thing in this app. */}
          <span className="font-mono text-sm text-muted-foreground">{n}</span>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span>{title}</span>
          <span className="text-sm font-normal text-muted-foreground">{hint}</span>
        </h2>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
