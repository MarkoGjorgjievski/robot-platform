import { useCallback, useState } from 'react';
import { Link, Outlet, createFileRoute, redirect, useLocation, useParams, useSearch } from '@tanstack/react-router';
import { CommandMenu, useCommandMenuShortcut } from '../components/shell/command-menu';
import { OpsSidebar, OpsSidebarSheet } from '../components/shell/ops-sidebar';
import { useProjectSlug } from '../components/shell/project-section';
import { Sidebar, SidebarSheet } from '../components/shell/sidebar';
import { decodeOpsOverviewState, isOpsPath } from '../lib/ops-view';
import { crumbs } from '../lib/project-nav-view';
import { trpc } from '../lib/trpc';
import { useSiteSlugs } from './_app/projects/$project/sites/$site';

/**
 * Everything behind the sign-in: the sidebar, the header, and one of the
 * screens. Pathless, so `/projects` stays `/projects`.
 *
 * `beforeLoad` both gates and narrows: returning the session puts a non-null
 * one into every child route's context, so no screen has to re-check it.
 *
 * A staff account with no organisation memberships never sees a customer
 * screen (ops mode, 2026-10-06): every org route sends it to `/ops` instead.
 * The check is `isOperator` only — a non-operator always has at least one
 * org (sign-in mints a personal one), so this can never loop with `/ops`'s
 * own non-operator redirect back to `/projects`. Final review M5: the
 * pathname check is `isOpsPath`, never bouncing a route already inside ops
 * mode (`/ops/websites/<id>`, not just the bare `/ops`).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) throw redirect({ to: '/login' });
    if (context.session.isOperator && context.session.orgs.length === 0 && !isOpsPath(location.pathname)) {
      throw redirect({ to: '/ops' });
    }
    return { session: context.session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useCommandMenuShortcut(openSearch);
  const inOps = isOpsPath(useLocation({ select: (l) => l.pathname }));

  return (
    <div className="flex min-h-screen">
      {inOps ? <OpsSidebar session={session} /> : <Sidebar session={session} onSearch={openSearch} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg px-5 md:px-8">
          {inOps ? (
            <OpsSidebarSheet session={session} />
          ) : (
            <SidebarSheet session={session} onSearch={openSearch} />
          )}
          {inOps ? <OpsBreadcrumb /> : <Breadcrumb org={session.currentOrg.name} />}
        </header>

        <Outlet />
      </div>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

/**
 * "Ops / All websites[ / {website}]" (spec "Ops design", `/ops` top bar).
 * The first two crumbs always return to `/ops`, restoring exactly the
 * search state the operator left it in: the website page's own `from`
 * search param carries it here, encoded by `encodeOpsOverviewState` on the
 * overview's row link and decoded back by `decodeOpsOverviewState` ("Ops
 * design": "keeping the overview's URL state").
 */
function OpsBreadcrumb() {
  const { sourceId } = useParams({ strict: false }) as { sourceId?: string };
  const search = useSearch({ strict: false }) as { from?: string };
  const website = trpc.ops.website.useQuery({ sourceId: sourceId! }, { enabled: !!sourceId });
  const backSearch = decodeOpsOverviewState(search.from);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <Link to="/ops" search={backSearch} className="truncate hover:text-text">
        Ops
      </Link>
      <span aria-hidden className="text-muted-foreground">/</span>
      {sourceId ? (
        <Link to="/ops" search={backSearch} className="truncate hover:text-text">
          All websites
        </Link>
      ) : (
        <span className="truncate">All websites</span>
      )}
      {sourceId ? (
        <>
          <span aria-hidden className="text-muted-foreground">/</span>
          <b className="truncate font-medium text-text">{website.data?.website.name ?? ''}</b>
        </>
      ) : null}
    </nav>
  );
}

/**
 * Where you are (spec §3): the organisation, then the project once you are in
 * one, then the website once you are in one of those. Both names come from the
 * same queries the screen and the sidebar run, so the crumb costs no extra
 * round trip.
 */
function Breadcrumb({ org }: { org: string }) {
  const slug = useProjectSlug();
  const { site: siteSlug } = useSiteSlugs();
  const project = trpc.projects.get.useQuery({ projectSlug: slug! }, { enabled: !!slug });
  const site = trpc.sources.get.useQuery(
    { projectSlug: slug!, sourceSlug: siteSlug! },
    { enabled: !!slug && !!siteSlug },
  );
  const items = crumbs(
    org,
    project.data ? { name: project.data.name, slug: project.data.slug } : null,
    site.data ? { name: site.data.name, slug: site.data.slug } : null,
  );

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2">
          {/* Hidden from the screen reader, so it costs nothing there — but it
              is still text on screen, and `text-faint` is the one token the
              theme's own comment calls a bug for that (styles/app.css). */}
          {i > 0 ? <span aria-hidden className="text-muted-foreground">/</span> : null}
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
