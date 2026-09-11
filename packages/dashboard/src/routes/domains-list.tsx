import { Link } from '@tanstack/react-router';
import { Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';

export default function DomainsList() {
  const listQuery = trpc.domains.intelligenceList.useQuery();

  if (listQuery.isLoading) return <Spinner label="Loading domains..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const domains = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-600">
        <span className="text-gray-900">Domains</span>
      </div>
      <div className="mt-2">
        <PageHeader
          title="Domain intelligence"
          description="Cross-customer cached knowledge per site. Read-only — the shared asset that makes repeat extractions free."
        />
      </div>

      {domains.length === 0 ? (
        <EmptyState
          title="No domain intelligence cached yet"
          description="Run an extraction and the system starts caching selectors per domain here."
          action={<Link to="/projects" className="btn-primary h-9">Go to projects</Link>}
        />
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr className="sheet-row">
                <th className="sheet-head px-3 py-2 text-left">Domain</th>
                <th className="sheet-head px-3 py-2 text-left">Page types</th>
                <th className="sheet-head px-3 py-2 text-right">Runs (ok/total)</th>
                <th className="sheet-head px-3 py-2 text-right">Success</th>
                <th className="sheet-head px-3 py-2 text-right">Fields</th>
                <th className="sheet-head px-3 py-2 text-right">Last verified</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.domain} className="sheet-row h-8 transition-colors hover:bg-gray-100/60">
                  <td className="px-3 py-1.5">
                    <Link
                      to="/ops/domains/$domain"
                      params={{ domain: d.domain }}
                      className="flex items-center gap-2 font-mono text-[13px] text-gray-900 hover:text-accent-700"
                    >
                      <Globe className="h-4 w-4 text-gray-600" />
                      {d.domain}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-gray-600">{d.pageTypes.join(', ')}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] text-gray-600">{d.successfulRuns}/{d.totalRuns}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] text-gray-600">{d.successRate}%</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] text-gray-600">{d.fieldCount}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] text-gray-600">
                    {new Date(d.lastVerifiedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link to="/ops/domains/$domain" params={{ domain: d.domain }}>
                      <ArrowRight className="h-4 w-4 text-gray-600" />
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
