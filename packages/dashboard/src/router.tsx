import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b px-6 py-3 text-sm font-semibold">Robot Platform</header>
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <h1 className="text-xl font-bold">Robot Platform</h1>
      <p className="mt-2 text-sm text-gray-600">Phase 1 scaffold — Phase 2 will add Sandbox.</p>
    </div>
  ),
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
