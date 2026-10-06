import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, List, Menu } from 'lucide-react';
import type { Session } from '../../lib/session';
import { UserMenu } from './user-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';

type OpsSidebarProps = {
  session: Session;
  onNavigate?: () => void;
};

/**
 * The ops shell's own rail (spec "Ops design → Ops mode"): a static "Robot
 * ops" header with "Staff" instead of the org switcher, one nav item ("All
 * websites" — later staff pages slot in beside it), and nothing of the
 * customer shell (Projects, Runs, Usage, Settings, the org switcher). Visible
 * only to operators — the route itself is the real gate (`ops.*` FORBIDDEN);
 * this is only what is shown.
 */
export function OpsSidebarBody({ session, onNavigate }: OpsSidebarProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b border-line p-2 px-3 py-2">
        <span className="text-base font-medium text-text">Robot ops</span>
        <span className="ml-auto text-sm text-muted-foreground">Staff</span>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        <nav aria-label="Ops" className="flex flex-col gap-px p-2">
          <Link
            to="/ops"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
            activeProps={{ className: 'bg-raised font-medium text-text!' }}
          >
            <List className="size-4 shrink-0" />
            All websites
          </Link>
        </nav>
      </div>

      <div className="flex flex-col gap-1 border-t border-line p-2">
        {/* Shown only to staff who also belong to a customer organisation — a
            staff account with none has nowhere this link could take it. */}
        {session.orgs.length > 0 ? (
          <Link
            to="/projects"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
          >
            <ArrowLeftRight className="size-4 shrink-0" />
            Switch to customer view
          </Link>
        ) : null}

        <UserMenu session={session} />
      </div>
    </div>
  );
}

/** The rail proper, from `md` up. Sticky, so it never scrolls with a long table. */
export function OpsSidebar(props: OpsSidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 border-r border-line bg-panel md:block">
      <OpsSidebarBody {...props} />
    </aside>
  );
}

/** Below `md` the same rail arrives as a sheet from the left. */
export function OpsSidebarSheet(props: OpsSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:text-text md:hidden"
        >
          <Menu className="size-4" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-[240px] gap-0 border-line bg-panel p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <OpsSidebarBody {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
