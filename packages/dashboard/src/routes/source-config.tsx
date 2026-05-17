import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

export default function SourceConfig() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source/config',
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
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Configuration</h2>
      <p className="mt-1 text-xs text-gray-500">Read-only. Editing comes in Phase 3b.</p>

      <dl className="mt-4 divide-y rounded-md border text-sm">
        <Row label="Strategy" value={source.inputStrategy ?? '—'} />
        <Row label="URL template" value={source.urlTemplate ?? '—'} mono />
        <Row label="Listing mode" value={source.listingMode ?? '—'} />
        <Row label="Dataset" value={source.datasetName ?? '—'} />
        <Row label="Domain" value={source.domainName ?? '—'} />
        <Row label="Active" value={source.isActive ? 'yes' : 'no'} />
      </dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[160px_1fr] px-4 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : 'text-sm'}>{value}</dd>
    </div>
  );
}
