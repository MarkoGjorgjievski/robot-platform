import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

// Finding 5 / ruling R7 (final-review-findings.md): the minimal REAL
// switch-mode — everything else on this page stays read-only (full editing
// is Phase 3b), but Listing mode is now a working toggle, not a stub value,
// and is what the Run detail page's "Switch mode" diagnosis button leads to.
export default function SourceConfig() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/p/$project/sources/$source/config',
  });
  const utils = trpc.useUtils();

  const listQuery = trpc.sources.listByProject.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
  });

  const updateMode = trpc.sources.update.useMutation({
    onSuccess: () => utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }),
  });

  if (listQuery.isLoading) return <Spinner label="Loading..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug);
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  const isListing = source.listingMode === 'listing_to_detail';

  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-gray-900">Configuration</h2>
      <p className="mt-1 text-xs text-gray-500">Mostly read-only — full editing comes in Phase 3b.</p>

      <dl className="card mt-4 divide-y divide-gray-100 text-sm">
        <Row label="Strategy" value={source.inputStrategy ?? '—'} />
        <Row label="URL template" value={source.urlTemplate ?? '—'} mono />
        <div className="grid grid-cols-[160px_1fr] items-center px-4 py-2">
          <dt className="micro-label">Listing mode</dt>
          <dd className="flex items-center gap-3">
            <span className="text-sm">{source.listingMode ?? '—'}</span>
            <button
              className="btn-quiet text-xs"
              disabled={updateMode.isPending}
              onClick={() => updateMode.mutate({
                id: source.id,
                listingMode: isListing ? 'detail' : 'listing_to_detail',
              })}
            >
              Switch to {isListing ? 'detail' : 'listing'}
            </button>
          </dd>
        </div>
        <Row label="Dataset" value={source.datasetName ?? '—'} />
        <Row label="Domain" value={source.domainName ?? '—'} />
        <Row label="Active" value={source.isActive ? 'yes' : 'no'} />
      </dl>
      {updateMode.isError && <p className="mt-2 text-xs text-red-600">{updateMode.error.message}</p>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[160px_1fr] px-4 py-2">
      <dt className="micro-label">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : 'text-sm'}>{value}</dd>
    </div>
  );
}
