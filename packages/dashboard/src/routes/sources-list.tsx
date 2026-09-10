import { useParams, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function SourcesList() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/sources' });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading websites..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const sources = listQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-600">
        <Link to="/projects" className="hover:text-gray-900">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-900">
          Project
        </Link>
        <span>/</span>
        <span className="text-gray-900">Websites</span>
      </div>
      <div className="mt-2">
        <PageHeader
          title="Websites"
          description={<>Every website in this project. {sources.length} {sources.length === 1 ? 'website' : 'websites'}.</>}
        />
      </div>

      {sources.length === 0 ? (
        <EmptyState
          title="No websites yet"
          description="Add a website on the project page and it appears here."
        />
      ) : (
        <table className="sheet mt-6">
          <thead>
            <tr className="sheet-row">
              <th className="sheet-head px-3 py-2 text-left">Name</th>
              <th className="sheet-head px-3 py-2 text-left">Address</th>
              <th className="sheet-head px-3 py-2 text-left">Pages</th>
              <th className="sheet-head px-3 py-2 text-left"> </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="sheet-row h-8">
                <td className="px-3"><span className="name text-[15px]">{s.name}</span></td>
                <td className="max-w-md truncate px-3 font-mono text-xs text-gray-600">{s.urlTemplate}</td>
                <td className="px-3 font-mono">{s.urlCount}</td>
                <td className="px-3 text-right">
                  <Link
                    to="/projects/$project/sources/$source"
                    params={{ project: projectSlug, source: s.slug }}
                    className="text-xs text-accent-700 underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
