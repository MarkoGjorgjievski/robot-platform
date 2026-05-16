import { useParams, Link } from '@tanstack/react-router';
import { Layers, ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { SubTabNav } from '../components/sub-tab-nav';

const DEFAULT_ORG_SLUG = 'default';

export default function SourceDetail() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source',
  });

  // For Phase 3a, query via sources.listByProject and pick the matching one.
  // (The existing sources.getBySlug requires a datasetSlug we don't have here.
  // A dedicated sources.getByProjectAndSourceSlug procedure is a Phase 3b consideration.)
  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;

  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/projects" className="hover:text-gray-700">Projects</Link>
        <span>/</span>
        <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
          Project
        </Link>
        <span>/</span>
        <Link to="/p/$project/sources" params={{ project: projectSlug }} className="hover:text-gray-700">
          Sources
        </Link>
        <span>/</span>
        <span className="text-gray-700">{source.name}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Layers className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-bold tracking-tight">{source.name}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-600">
          {source.inputStrategy ?? 'unknown'}
        </span>
        {source.urlTemplate && (
          <a
            href={source.urlTemplate}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 truncate font-mono text-xs text-gray-500 hover:text-gray-700"
          >
            <span className="truncate max-w-md">{source.urlTemplate}</span>
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        )}
      </div>

      <SubTabNav
        activeTo="/p/$project/sources/$source"
        tabs={[
          { label: 'Overview', to: '/p/$project/sources/$source', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Config', to: '/p/$project/sources/$source/config', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Inputs', to: '/p/$project/sources/$source/inputs', params: { project: projectSlug, source: sourceSlug } },
          { label: 'Runs', to: '/p/$project/sources/$source/runs', params: { project: projectSlug, source: sourceSlug } },
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
        <Stat label="Dataset" value={source.datasetName ?? '—'} />
        <Stat label="Strategy" value={source.inputStrategy ?? '—'} />
        <Stat label="Mode" value={source.listingMode ?? '—'} />
        <Stat label="Domain" value={source.domainName ?? '—'} />
        <Stat label="Active" value={source.isActive ? 'yes' : 'no'} />
        <Stat label="Created" value={new Date(source.createdAt).toLocaleDateString()} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
