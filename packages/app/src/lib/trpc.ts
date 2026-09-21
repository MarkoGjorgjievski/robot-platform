import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@robot/api/routers';

/**
 * The api-server. `import type` above matters: the router's value side pulls in
 * Drizzle and the database, and must never reach a browser bundle.
 */
export const API_URL: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? 'http://localhost:4000';

export const trpc = createTRPCReact<AppRouter>();

/**
 * One client per request on the server, one per browser session on the client —
 * hence a factory rather than a module-level singleton.
 *
 * `credentials: 'include'` is what carries the `robot_session` cookie to :4000;
 * without it the browser drops it on every cross-origin call and every request
 * looks signed out.
 */
export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${API_URL}/trpc`,
        transformer: superjson,
        fetch: (url, options) => fetch(url, { ...options, credentials: 'include' }),
      }),
    ],
  });
}
