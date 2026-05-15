import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClient } from './lib/trpc';
import { queryClient } from './lib/query-client';
import { AppRouter } from './router';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>
);
