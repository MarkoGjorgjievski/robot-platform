import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, createTrpcClient } from '../lib/trpc';
import { TooltipProvider } from './ui/tooltip';

/**
 * Both clients are created inside the component, not at module scope: on the
 * server a module-level QueryClient would be shared by every concurrent
 * request and would leak one visitor's data into another's render.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
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
