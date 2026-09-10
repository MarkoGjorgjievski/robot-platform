import { Outlet, Link, useRouterState } from '@tanstack/react-router';

const navLink = 'border-b-2 px-0.5 py-1.5 text-sm transition-colors';
const navLinkActive = 'border-accent-600 text-gray-900';
const navLinkInactive = 'border-transparent text-gray-600 hover:text-gray-900';

export function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projectsActive = pathname === '/' || pathname.startsWith('/projects');
  const opsActive = pathname.startsWith('/ops');

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2.5">
          <Link to="/" className="font-serif text-base font-medium text-gray-900">
            robot platform
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/projects" className={`${navLink} ${projectsActive ? navLinkActive : navLinkInactive}`}>
              Projects
            </Link>
            <Link
              to="/ops/domains"
              className={`${navLink} ${opsActive ? navLinkActive : navLinkInactive}`}
              title="Operator view of the domain cache"
            >
              Ops
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
