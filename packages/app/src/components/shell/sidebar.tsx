import { useEffect, useState, type ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity, ArrowLeftRight, FolderKanban, Gauge, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings } from 'lucide-react';
import type { Session } from '../../lib/session';
import { AvatarSquare } from './avatar';
import { OrgSwitcher } from './org-switcher';
import { ProjectSection } from './project-section';
import { UserMenu } from './user-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

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
export function SidebarBody({ session, onSearch, onNavigate, onCollapse }: SidebarProps & { onCollapse?: () => void }) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-line p-2">
        {/* In staff mode the customer org is not one to switch away from: the
            banner's "Back to ops" is the way out (spec 2026-10-07 §2.2). Same
            height as the switcher's trigger. */}
        {session.staff ? (
          <div className="flex w-full items-center gap-2 px-2 py-1.5 text-base text-text">
            <AvatarSquare initial={session.currentOrg.name} colour={session.user.avatarColour} />
            <span className="min-w-0 flex-1 truncate font-medium">{session.currentOrg.name}</span>
          </div>
        ) : (
          <OrgSwitcher session={session} />
        )}
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
        {/* Operators only (ops mode, 2026-10-06); a customer never sees this.
            In staff mode the banner carries "Back to ops" instead. */}
        {session.isOperator && !session.staff ? (
          <Link
            to="/ops"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
          >
            <ArrowLeftRight className="size-4 shrink-0" />
            Back to ops
          </Link>
        ) : null}

        <button
          type="button"
          onClick={onSearch}
          className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="shrink-0 font-mono text-sm">⌘K</kbd>
        </button>

        {/* Only on the desktop rail; the phone sheet closes itself. */}
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
          >
            <PanelLeftClose className="size-4 shrink-0" />
            <span className="flex-1 text-left">Collapse sidebar</span>
          </button>
        ) : null}

        <UserMenu session={session} />
      </div>
    </div>
  );
}

/** Where the rail's open/closed choice is kept, per browser. */
const COLLAPSED_KEY = 'robot.sidebar.collapsed';

/**
 * The rail proper, from `md` up. Sticky, so it never scrolls with a long table.
 * Collapsed to icons by default (Marko 2026-11-11) so the screens get the width;
 * the toggle opens it to 240 px and the choice is remembered in this browser.
 */
export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === '0') setCollapsed(false);
    } catch {
      // No storage (private window, blocked site data): the default stands.
    }
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // Not remembered; it still toggles.
      }
      return !c;
    });
  }

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 border-r border-line bg-panel transition-[width] duration-150 md:block ${collapsed ? 'w-[56px]' : 'w-[240px]'}`}
    >
      {collapsed ? <SidebarRail {...props} onExpand={toggle} /> : <SidebarBody {...props} onCollapse={toggle} />}
    </aside>
  );
}

/** One icon in the collapsed rail, named on hover. */
function RailItem({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

const RAIL_ICON = 'flex size-9 items-center justify-center rounded-[6px] text-muted-foreground hover:text-text';

/** The collapsed rail: the same places as `SidebarBody`, as icons. */
function SidebarRail({ session, onSearch, onExpand }: SidebarProps & { onExpand: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center">
      <div className="flex w-full flex-col items-center gap-1 border-b border-line p-2">
        {session.staff ? (
          <RailItem label={session.currentOrg.name}>
            <span className="flex size-9 items-center justify-center">
              <AvatarSquare initial={session.currentOrg.name} colour={session.user.avatarColour} />
            </span>
          </RailItem>
        ) : (
          <OrgSwitcher session={session} collapsed />
        )}
      </div>

      <div className="flex w-full flex-1 flex-col overflow-y-auto">
        <nav className="flex flex-col items-center gap-px p-2">
          {NAV.map(({ to, label, Icon }) => (
            <RailItem key={to} label={label}>
              <Link to={to} aria-label={label} className={RAIL_ICON} activeProps={{ className: 'bg-raised text-text!' }}>
                <Icon className="size-4" />
              </Link>
            </RailItem>
          ))}
        </nav>

        <ProjectSection collapsed />
      </div>

      <div className="flex w-full flex-col items-center gap-1 border-t border-line p-2">
        {session.isOperator && !session.staff ? (
          <RailItem label="Back to ops">
            <Link to="/ops" aria-label="Back to ops" className={RAIL_ICON}>
              <ArrowLeftRight className="size-4" />
            </Link>
          </RailItem>
        ) : null}
        <RailItem label="Search (⌘K)">
          <button type="button" aria-label="Search" onClick={onSearch} className={RAIL_ICON}>
            <Search className="size-4" />
          </button>
        </RailItem>
        <RailItem label="Open sidebar">
          <button type="button" aria-label="Open sidebar" onClick={onExpand} className={RAIL_ICON}>
            <PanelLeftOpen className="size-4" />
          </button>
        </RailItem>
        <UserMenu session={session} collapsed />
      </div>
    </div>
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
