import type { ReactNode } from 'react';

/**
 * Every screen's title row: the 20 px page title on the left (spec §4), its
 * actions on the right. The children are the screen's panels.
 *
 * The title row and the panels are siblings on purpose — the `.rise` stagger is
 * `nth-child`-based (styles/app.css), so the title lifts first and each panel
 * follows it by 60 ms. That is the single orchestrated moment on a page load;
 * nothing else moves.
 */
export function Page({
  title,
  actions,
  children,
}: {
  /**
   * A node, not a string: a screen whose title is the thing it is loading (a
   * project's name) puts a `Skeleton` here while the query is in flight, rather
   * than flashing a blank `h1` and then reflowing the row under it.
   */
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 pb-16 md:px-8">
      <div className="rise flex min-h-[72px] flex-wrap items-center justify-between gap-3 py-5">
        <h1 className="text-2xl font-semibold tracking-[-0.011em]">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </main>
  );
}

/** A screen that exists so the nav is real, and says so rather than pretending. */
export function ComingLater({ title }: { title: string }) {
  return (
    <Page title={title}>
      <p className="rise text-base text-muted-foreground">Coming in a later plan.</p>
    </Page>
  );
}
