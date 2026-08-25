import { Link } from '@tanstack/react-router';
import { Loader2, Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { formatDate } from '../lib/format';
import { PageHeader } from '../components/page-header';

export default function SandboxIndex() {
  const listQuery = trpc.sandbox.list.useQuery();

  if (listQuery.isLoading) {
    return (
      <div className="mt-8 flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading recent sources...
      </div>
    );
  }

  if (listQuery.isError) {
    return <div className="mt-8 text-sm text-red-600">Error: {listQuery.error.message}</div>;
  }

  const sources = listQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Sandbox"
        description={`Throwaway drafts. ${sources.length} recent ${sources.length === 1 ? 'source' : 'sources'}.`}
      />

      {sources.length === 0 ? (
        <div className="card mt-8 border-dashed p-12 text-center text-sm text-gray-500">
          No sandbox sources yet.{' '}
          <Link to="/" className="font-medium text-accent-700 underline-offset-2 hover:underline">
            Paste a URL
          </Link>{' '}
          to get started.
        </div>
      ) : (
        <ul className="card mt-6 divide-y divide-gray-100">
          {sources.map((s) => {
            const host = (() => {
              try {
                return new URL(s.urlTemplate ?? '').hostname.replace(/^www\./, '');
              } catch {
                return s.urlTemplate ?? '';
              }
            })();
            return (
              <li key={s.slug}>
                <Link
                  to="/sandbox/$shortid"
                  params={{ shortid: s.slug }}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60"
                >
                  <Globe className="h-4 w-4 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate font-mono text-xs text-gray-500">{host}</div>
                  </div>
                  <span className="text-xs text-gray-400">{formatDate(new Date(s.updatedAt))}</span>
                  <ArrowRight className="h-4 w-4 text-gray-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
