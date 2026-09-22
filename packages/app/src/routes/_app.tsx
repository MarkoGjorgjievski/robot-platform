import { useCallback, useState } from 'react';
import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { CommandMenu, useCommandMenuShortcut } from '../components/shell/command-menu';
import { useProjectSlug } from '../components/shell/project-section';
import { Sidebar, SidebarSheet } from '../components/shell/sidebar';
import { crumbs } from '../lib/project-nav-view';
import { trpc } from '../lib/trpc';

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
          <Breadcrumb org={session.currentOrg.name} />
        </header>

        <Outlet />
      </div>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

/**
 * Where you are (spec §3): the organisation, then the project once you are in
 * one. The project's name comes from the same `projects.get` query the screen
 * and the sidebar run, so the crumb costs no extra round trip.
 */
function Breadcrumb({ org }: { org: string }) {
  const slug = useProjectSlug();
  const project = trpc.projects.get.useQuery({ projectSlug: slug! }, { enabled: !!slug });
  const items = crumbs(org, project.data ? { name: project.data.name, slug: project.data.slug } : null);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2">
          {/* The separator is a glyph, not text: the divider grey is right for
              it, and it is hidden from the screen reader either way. */}
          {i > 0 ? <span aria-hidden className="text-faint">/</span> : null}
          {c.to ? (
            <Link to={c.to} params={c.params} className="truncate hover:text-text">
              {c.label}
            </Link>
          ) : (
            <span className="truncate">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
