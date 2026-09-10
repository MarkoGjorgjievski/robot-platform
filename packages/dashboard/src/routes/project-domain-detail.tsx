import { useParams, Link } from '@tanstack/react-router';
import { Globe, Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function ProjectDomainDetail() {
  const { project: projectSlug, domain } = useParams({
    from: '/projects/$project/domains/$domain',
  });
  const detailQuery = trpc.domains.detailByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
    domain,
  });

  if (detailQuery.isLoading) return <Spinner label="Loading domain..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Domain "${domain}"`} />;

  const { sources, intelligence } = detailQuery.data;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-700">Project</Link>
        <span>/</span>
        <Link to="/projects/$project/domains" params={{ project: projectSlug }} className="hover:text-gray-700">Domains</Link>
        <span>/</span>
        <span className="font-mono text-gray-700">{domain}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Globe className="h-5 w-5 text-gray-400" />
        <h1 className="font-mono text-2xl font-medium">{domain}</h1>
      </div>

      {intelligence && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-900">Cached intelligence</h2>
          <p className="mt-1 text-xs text-gray-600">
            Cross-customer knowledge accumulated for this domain.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="Page type" value={intelligence.pageType} />
            <Stat label="Runs (total)" value={String(intelligence.totalRuns)} />
            <Stat label="Successful" value={String(intelligence.successfulRuns)} />
            <Stat label="Consecutive failures" value={String(intelligence.consecutiveFailures)} />
          </dl>
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium text-gray-900">
        Sources in this project touching {domain} ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <EmptyState
          title="No sources hit this domain in this project"
          description="If you see this on a domain page you navigated to, the project's sources changed since the listing was generated."
        />
      ) : (
        <ul className="mt-2 divide-y divide-gray-200">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/projects/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.datasetName}, {s.urlTemplate}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-soft">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
