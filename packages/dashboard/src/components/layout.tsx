import { Outlet, Link } from '@tanstack/react-router';

const navLink =
  'rounded-md px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900';
const navLinkActive = 'bg-gray-100 font-medium text-gray-900';

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-2.5">
          <Link to="/" className="flex items-baseline gap-1.5 font-mono text-sm font-medium tracking-tight">
            <span className="text-accent-600">▮</span>
            <span>robot·platform</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/projects" className={navLink} activeProps={{ className: `${navLink} ${navLinkActive}` }}>
              Projects
            </Link>
            <Link
              to="/ops/domains"
              className={`${navLink} text-gray-400`}
              activeProps={{ className: `${navLink} ${navLinkActive}` }}
              title="Operator view of the domain cache"
            >
              Ops
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
