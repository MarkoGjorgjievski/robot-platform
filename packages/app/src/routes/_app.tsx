import { useCallback, useState } from 'react';
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { CommandMenu, useCommandMenuShortcut } from '../components/shell/command-menu';
import { Sidebar, SidebarSheet } from '../components/shell/sidebar';

/**
 * Everything behind the sign-in: the sidebar, the header, and one of the
 * screens. Pathless, so `/projects` stays `/projects`.
 *
 * `beforeLoad` both gates and narrows: returning the session puts a non-null
 * one into every child route's context, so no screen has to re-check it.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login' });
    return { session: context.session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useCommandMenuShortcut(openSearch);

  return (
    <div className="flex min-h-screen">
      <Sidebar session={session} onSearch={openSearch} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg px-5 md:px-8">
          <SidebarSheet session={session} onSearch={openSearch} />
          {/* One crumb today; the project and website join it in plan 2 (spec §3). */}
          <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted-foreground">
            <span className="truncate">{session.currentOrg.name}</span>
          </nav>
        </header>

        <Outlet />
      </div>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
