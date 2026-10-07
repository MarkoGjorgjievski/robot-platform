import { useRef, useState, type ReactNode } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { trpc, createTrpcClient } from '../lib/trpc';
import { isStaffSessionEnded } from '../lib/staff-view';
import { TooltipProvider } from './ui/tooltip';

/**
 * Both clients are created inside the component, not at module scope: on the
 * server a module-level QueryClient would be shared by every concurrent
 * request and would leak one visitor's data into another's render.
 *
 * Staff access (final review, 2026-10-07): a page left open past the 8 hours
 * gets every change refused with "Your staff session ended". One place
 * catches that for every mutation and reloads the router, so `_app`'s gate
 * sends the operator to ops, where `StaffExpiryNotice` says so and leaves.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: false } },
        mutationCache: new MutationCache({
          onError: (err) => {
            if (isStaffSessionEnded(err)) void routerRef.current.invalidate();
          },
        }),
      })
  );
  const [trpcClient] = useState(() => createTrpcClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* Radix requires one provider above every tooltip; 400 ms so a pointer
            crossing the run dots on its way somewhere else does not flash five
            of them. */}
        <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
