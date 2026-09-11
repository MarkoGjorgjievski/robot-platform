import { useParams, Link } from '@tanstack/react-router';
import { Globe, Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { Stat } from '../components/stat';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { useProjectName } from '../lib/use-project-name';

export default function ProjectDomainDetail() {
  const { project: projectSlug, domain } = useParams({
    from: '/projects/$project/domains/$domain',
  });
  const projectName = useProjectName(projectSlug);
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
      <div className="flex items-center gap-1 text-xs text-gray-600">
        <Link to="/projects" className="hover:text-gray-900">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-900">{projectName}</Link>
        <span>/</span>
        <Link to="/projects/$project/domains" params={{ project: projectSlug }} className="hover:text-gray-900">Domains</Link>
        <span>/</span>
        <span className="font-mono text-gray-900">{domain}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Globe className="h-5 w-5 text-gray-600" />
        <h1 className="font-mono text-2xl font-medium">{domain}</h1>
      </div>

      {intelligence && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-900">Cached intelligence</h2>
          <p className="mt-1 text-xs text-gray-600">
            Cross-customer knowledge accumulated for this domain.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
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
          action={
            <Link to="/projects/$project/domains" params={{ project: projectSlug }} className="btn-primary h-9">
              Back to domains
            </Link>
          }
        />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr className="sheet-row">
                <th className="sheet-head px-3 py-2 text-left">Source</th>
                <th className="sheet-head px-3 py-2 text-left">Output</th>
                <th className="sheet-head px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="sheet-row h-8 transition-colors hover:bg-gray-100/60">
                  <td className="px-3 py-1.5">
                    <Link
                      to="/projects/$project/sources/$source"
                      params={{ project: projectSlug, source: s.slug }}
                      className="flex items-center gap-2 text-[13px] font-medium text-gray-900 hover:text-accent-700"
                    >
                      <Layers className="h-4 w-4 text-gray-600" />
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-[13px] text-gray-600">{s.datasetName}</td>
                  <td className="max-w-md truncate px-3 py-1.5 font-mono text-[13px] text-gray-600" title={s.urlTemplate ?? undefined}>
                    {s.urlTemplate}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link to="/projects/$project/sources/$source" params={{ project: projectSlug, source: s.slug }} aria-label={`Open ${s.name}`}>
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
