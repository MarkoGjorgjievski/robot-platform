import { Link } from '@tanstack/react-router';
import { Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';

export default function DomainsList() {
  const listQuery = trpc.domains.intelligenceList.useQuery();

  if (listQuery.isLoading) return <Spinner label="Loading domains..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const domains = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <span className="text-gray-700">Domains</span>
      </div>
      <h1 className="mt-2 text-xl font-bold tracking-tight">Domain intelligence</h1>
      <p className="mt-1 text-sm text-gray-600">
        Cross-customer cached knowledge per site. Read-only — the shared asset that makes repeat extractions free.
      </p>

      {domains.length === 0 ? (
        <EmptyState
          title="No domain intelligence cached yet"
          description="Run an extraction and the system starts caching selectors per domain here."
        />
      ) : (
        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Domain</th>
                <th className="px-4 py-2 text-left font-medium">Page types</th>
                <th className="px-4 py-2 text-right font-medium">Runs (ok/total)</th>
                <th className="px-4 py-2 text-right font-medium">Success</th>
                <th className="px-4 py-2 text-right font-medium">Fields</th>
                <th className="px-4 py-2 text-right font-medium">Last verified</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {domains.map((d) => (
                <tr key={d.domain} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link
                      to="/domains/$domain"
                      params={{ domain: d.domain }}
                      className="flex items-center gap-2 font-mono text-gray-800 hover:text-gray-950"
                    >
                      <Globe className="h-4 w-4 text-gray-400" />
                      {d.domain}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{d.pageTypes.join(', ')}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{d.successfulRuns}/{d.totalRuns}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{d.successRate}%</td>
                  <td className="px-4 py-2 text-right text-gray-600">{d.fieldCount}</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {new Date(d.lastVerifiedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link to="/domains/$domain" params={{ domain: d.domain }}>
                      <ArrowRight className="h-4 w-4 text-gray-400" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
