import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Activity, FolderKanban, Gauge, Settings, UserRound } from 'lucide-react';
import { projectsView } from '../../lib/projects-view';
import { trpc } from '../../lib/trpc';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';

const PAGES = [
  { to: '/projects', label: 'Projects', Icon: FolderKanban },
  { to: '/runs', label: 'Runs', Icon: Activity },
  { to: '/usage', label: 'Usage', Icon: Gauge },
  { to: '/settings', label: 'Settings', Icon: Settings },
  { to: '/account', label: 'Account', Icon: UserRound },
] as const;

/** ⌘K anywhere in the app. Returns nothing; it only flips the caller's state. */
export function useCommandMenuShortcut(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  // Only asked for once the palette has been opened — the sidebar should not
  // cost a query on every page load for a search nobody has started.
  const projects = trpc.projects.list.useQuery(undefined, { enabled: open });
  const rows = projectsView(projects.data ?? []);

  function go(to: (typeof PAGES)[number]['to']) {
    onOpenChange(false);
    void navigate({ to });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The title and description live inside the content, where Radix looks
          for them — a dialog without them logs an accessibility error. */}
      <DialogContent showCloseButton={false} className="overflow-hidden p-0 sm:max-w-[520px]">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search projects and pages.</DialogDescription>
        {/* Transparent, so the dialog's own panel is the single surface here
            rather than a raised block inside a panel. */}
        <Command loop className="bg-transparent">
          <CommandInput placeholder="Search projects and pages…" />
          <CommandList className="max-h-[320px] px-1 pb-1">
            <CommandEmpty className="py-8 text-base text-muted-foreground">Nothing matches that.</CommandEmpty>

            {rows.length > 0 ? (
              <CommandGroup heading="Projects">
                {rows.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`project ${project.name}`}
                    // Plan 2 gives projects their own page; until it lands the
                    // list is where a project is looked at.
                    onSelect={() => go('/projects')}
                    className="text-base"
                  >
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="shrink-0 font-mono text-sm text-muted-foreground">
                      {project.countsLabel}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            <CommandGroup heading="Go to">
              {PAGES.map(({ to, label, Icon }) => (
                <CommandItem key={to} value={`page ${label}`} onSelect={() => go(to)} className="gap-2 text-base">
                  <Icon className="size-3.5" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
