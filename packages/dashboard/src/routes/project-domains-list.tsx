import { useParams, Link } from '@tanstack/react-router';
import { Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function ProjectDomainsList() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/domains' });
  const listQuery = trpc.domains.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading domains..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const domains = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-700">Project</Link>
        <span>/</span>
        <span className="text-gray-700">Domains</span>
      </div>
      <div className="mt-2">
        <PageHeader
          title="Domains in this project"
          description="Distinct hostnames touched by this project's sources. Useful when fixing a site that affects multiple sources."
        />
      </div>

      {domains.length === 0 ? (
        <EmptyState
          title="No domains yet"
          description="As sources are added to this project, their domains appear here."
        />
      ) : (
        <ul className="card mt-6 divide-y divide-gray-100">
          {domains.map((d) => (
            <li key={d.hostname}>
              <Link
                to="/projects/$project/domains/$domain"
                params={{ project: projectSlug, domain: d.hostname }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60"
              >
                <Globe className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">{d.hostname}</div>
                </div>
                <span className="text-xs text-gray-400">
                  {d.sourceCount} {d.sourceCount === 1 ? 'source' : 'sources'}
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
