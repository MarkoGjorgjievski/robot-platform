import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function SourceOverview() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source/',
  });

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  if (listQuery.isLoading) return <Spinner label="Loading..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
      <Stat label="Dataset" value={source.datasetName ?? '—'} />
      <Stat label="Strategy" value={source.inputStrategy ?? '—'} />
      <Stat label="Mode" value={source.listingMode ?? '—'} />
      <Stat label="Domain" value={source.domainName ?? '—'} />
      <Stat label="Active" value={source.isActive ? 'yes' : 'no'} />
      <Stat label="Created" value={new Date(source.createdAt).toLocaleDateString()} />
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
