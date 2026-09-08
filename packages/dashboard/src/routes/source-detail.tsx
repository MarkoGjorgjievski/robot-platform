import { useParams, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { SubTabNav } from '../components/sub-tab-nav';
import { InlineRename } from '../components/inline-rename';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function SourceDetailLayout() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/projects/$project/sources/$source',
  });

  // For Phase 3a, query via sources.listByProject and pick the matching one.
  // (The existing sources.getBySlug requires a datasetSlug we don't have here.
  // A dedicated sources.getByProjectAndSourceSlug procedure is a Phase 3b consideration.)
  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });
  const projectQuery = trpc.projects.getWithStats.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const utils = trpc.useUtils();
  const rename = trpc.sources.rename.useMutation({ onSuccess: () => utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }) });

  // Determine active tab from URL pathname
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sourceBasePath = `/projects/${projectSlug}/sources/${sourceSlug}`;
  let activeTo = '/projects/$project/sources/$source/';
  if (pathname.startsWith(`${sourceBasePath}/overview`)) activeTo = '/projects/$project/sources/$source/overview';
  else if (pathname.startsWith(`${sourceBasePath}/settings`)) activeTo = '/projects/$project/sources/$source/settings';
  else if (pathname.startsWith(`${sourceBasePath}/runs`)) activeTo = '/projects/$project/sources/$source/runs';

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          {projectQuery.data?.project.name ?? projectSlug}
        </Link>
      </div>

      <div className="mt-1 flex items-center gap-3">
        <InlineRename value={source.name} pending={rename.isPending} onSave={(name) => rename.mutate({ sourceId: source.id, name })} className="text-xl font-semibold tracking-tight" />
        {source.urlTemplate && (
          <a href={source.urlTemplate} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 truncate font-mono text-xs text-gray-500 hover:text-accent-700">
            <span className="max-w-md truncate">{hostOf(source.urlTemplate)}</span>
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        )}
      </div>

      <SubTabNav
        activeTo={activeTo}
        tabs={[
          { label: 'Schema', to: '/projects/$project/sources/$source/', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Overview', to: '/projects/$project/sources/$source/overview', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Runs', to: '/projects/$project/sources/$source/runs', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Settings', to: '/projects/$project/sources/$source/settings', params: { project: projectSlug, source: sourceSlug } },
        ]}
      />

      <Outlet />
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}
