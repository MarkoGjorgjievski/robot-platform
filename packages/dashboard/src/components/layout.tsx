import { Outlet, Link } from '@tanstack/react-router';

export function Layout() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="flex items-center justify-between border-b px-6 py-3 text-sm">
        <Link to="/" className="font-semibold">Robot Platform</Link>
        <nav className="flex gap-4 text-gray-600">
          <Link to="/sandbox" className="hover:text-gray-900">Sandbox</Link>
          <Link to="/domains" className="hover:text-gray-900">Domains</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
