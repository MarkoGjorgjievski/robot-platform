import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity, FolderKanban, Gauge, Menu, Search, Settings } from 'lucide-react';
import type { Session } from '../../lib/session';
import { OrgSwitcher } from './org-switcher';
import { ProjectSection } from './project-section';
import { UserMenu } from './user-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';

const NAV = [
  { to: '/projects', label: 'Projects', Icon: FolderKanban },
  { to: '/runs', label: 'Runs', Icon: Activity },
  { to: '/usage', label: 'Usage', Icon: Gauge },
  { to: '/settings', label: 'Settings', Icon: Settings },
] as const;

type SidebarProps = {
  session: Session;
  /** Opens the ⌘K palette, which the layout owns so there is only ever one of it. */
  onSearch: () => void;
  onNavigate?: () => void;
};

/**
 * The 240 px rail (spec §3). One panel-coloured column with a hairline on its
 * right edge: who you are working as at the top, where you can go in the
 * middle, how you search and who you are at the bottom.
 */
export function SidebarBody({ session, onSearch, onNavigate }: SidebarProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-line p-2">
        <OrgSwitcher session={session} />
      </div>

      {/* Nav and project section scroll together, so a project with many
          websites stays inside the rail rather than pushing the bottom block
          off screen. */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        <nav className="flex flex-col gap-px p-2">
          {NAV.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              // Only colour moves on hover. The active item keeps the raised chip;
              // giving hover a chip too would make every item look selected.
              className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
              activeProps={{ className: 'bg-raised font-medium text-text!' }}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        <ProjectSection onNavigate={onNavigate} />
      </div>

      <div className="flex flex-col gap-1 border-t border-line p-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="shrink-0 font-mono text-sm">⌘K</kbd>
        </button>

        <UserMenu session={session} />
      </div>
    </div>
  );
}

/** The rail proper, from `md` up. Sticky, so it never scrolls with a long table. */
export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 border-r border-line bg-panel md:block">
      <SidebarBody {...props} />
    </aside>
  );
}

/** Below `md` the same rail arrives as a sheet from the left (spec §3). */
export function SidebarSheet(props: SidebarProps) {
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
        <SidebarBody {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
