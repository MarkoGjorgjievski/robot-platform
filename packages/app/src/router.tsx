import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Start calls this once per request on the server and once on the client.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
