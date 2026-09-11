import { useParams, Link } from '@tanstack/react-router';
import { Globe, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { useProjectName } from '../lib/use-project-name';

export default function ProjectDomainsList() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/domains' });
  const projectName = useProjectName(projectSlug);
  const listQuery = trpc.domains.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading domains..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const domains = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-600">
        <Link to="/projects" className="hover:text-gray-900">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-900">{projectName}</Link>
        <span>/</span>
        <span className="text-gray-900">Domains</span>
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
          action={
            <Link to="/projects/$project" params={{ project: projectSlug }} className="btn-primary h-9">
              Go to the project
            </Link>
          }
        />
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr className="sheet-row">
                <th className="sheet-head px-3 py-2 text-left">Domain</th>
                <th className="sheet-head px-3 py-2 text-right">Sources</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.hostname} className="sheet-row h-8 transition-colors hover:bg-gray-100/60">
                  <td className="px-3 py-1.5">
                    <Link
                      to="/projects/$project/domains/$domain"
                      params={{ project: projectSlug, domain: d.hostname }}
                      className="flex items-center gap-2 font-mono text-[13px] text-gray-900 hover:text-accent-700"
                    >
                      <Globe className="h-4 w-4 text-gray-600" />
                      {d.hostname}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] text-gray-600">{d.sourceCount}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Link to="/projects/$project/domains/$domain" params={{ project: projectSlug, domain: d.hostname }} aria-label={`Open ${d.hostname}`}>
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
