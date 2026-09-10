import { useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { Dialog } from '../components/dialog';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

// Finding 5 / ruling R7 (final-review-findings.md): the minimal REAL
// switch-mode — everything else on this page stays read-only (full editing
// is Phase 3b), but Listing mode is now a working toggle, not a stub value,
// and is what the Run detail page's "Switch mode" diagnosis button leads to.
export default function SourceConfig() {
  const { project: projectSlug, source: sourceSlug } = useParams({
    from: '/projects/$project/sources/$source/settings',
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
  if (!source) return <NotFound what={`Website "${sourceSlug}"`} />;

  const isListing = source.listingMode === 'listing_to_detail';
  // Re-review residual #1 (fix-wave-report.md): the toggle had no
  // confirmed-state guard, so a confirmed Source's mode could be flipped
  // silently — misrouting source-setup.tsx's Extract branch. Mirrors the
  // server-side lock in `sources.update`.
  const isLocked = !!source.confirmedAt;

  return (
    <div className="mt-6">
      <h2 className="name text-lg">Settings</h2>
      <p className="label-soft mt-0.5">Mostly read-only. Full editing comes later.</p>

      <dl className="mt-4 border-t-2 border-t-gray-900 [&>div:last-child]:border-b-0">
        <Row label="Strategy" value={source.inputStrategy ?? '—'} />
        <Row label="Address" value={source.urlTemplate ?? '—'} mono />
        <div className="grid h-8 grid-cols-[160px_1fr] items-center border-b border-gray-200 px-3">
          <dt className="label-soft">Listing mode</dt>
          <dd className="flex items-center gap-3">
            <span className="font-mono text-xs">{source.listingMode ?? '—'}</span>
            {isLocked ? (
              <span className="label-soft">Mode is locked once the website is confirmed</span>
            ) : (
              <button
                className="btn-quiet"
                disabled={updateMode.isPending}
                onClick={() => updateMode.mutate({
                  id: source.id,
                  listingMode: isListing ? 'detail' : 'listing_to_detail',
                })}
              >
                Switch to {isListing ? 'detail' : 'listing'}
              </button>
            )}
          </dd>
        </div>
        <Row label="Output" value={source.datasetName ?? '—'} />
        <Row label="Domain" value={source.domainName ?? '—'} mono />
        <Row label="Active" value={source.isActive ? 'yes' : 'no'} />
      </dl>
      {updateMode.isError && <p className="mt-2 text-xs text-fail">{updateMode.error.message}</p>}

      <DeleteWebsite projectSlug={projectSlug} sourceId={source.id} name={source.name} />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-h-8 grid-cols-[160px_1fr] items-center border-b border-gray-200 px-3">
      <dt className="label-soft">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs' : 'text-sm'}>{value}</dd>
    </div>
  );
}

/**
 * Delete lives here, where the spec puts it (5.8) — it used to sit on the run
 * detail page's diagnosis panel, which is where an operator debugging one run
 * would meet it by accident. `sources.delete` refuses a confirmed website; that
 * refusal is shown verbatim under the buttons rather than pre-empted here, so
 * the reason the customer reads is the reason the server gave.
 */
function DeleteWebsite({ projectSlug, sourceId, name }: { projectSlug: string; sourceId: string; name: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState(false);
  const deleteMutation = trpc.sources.delete.useMutation({
    onSuccess: () => {
      utils.sources.listByProject.invalidate();
      navigate({ to: '/projects/$project', params: { project: projectSlug } });
    },
  });

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <h2 className="name text-lg">Delete this website</h2>
      <p className="mt-1 text-xs text-gray-600">Its runs and results are deleted too. This cannot be undone.</p>
      <button
        type="button"
        className="btn-quiet mt-3 border-fail text-fail"
        onClick={() => setConfirming(true)}
      >
        Delete website
      </button>

      <Dialog
        open={confirming}
        title={`Delete ${name}?`}
        onClose={() => { if (!deleteMutation.isPending) setConfirming(false); }}
        preventClose={deleteMutation.isPending}
      >
        <p className="text-sm text-gray-600">Its runs and results are deleted too. This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn-quiet h-9"
            disabled={deleteMutation.isPending}
            onClick={() => setConfirming(false)}
          >
            Keep it
          </button>
          <button
            type="button"
            className="btn-primary h-9 bg-fail hover:bg-fail"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ sourceId })}
          >
            Delete website
          </button>
        </div>
        {deleteMutation.isError && <p className="mt-2 text-xs text-fail">{deleteMutation.error.message}</p>}
      </Dialog>
    </div>
  );
}
