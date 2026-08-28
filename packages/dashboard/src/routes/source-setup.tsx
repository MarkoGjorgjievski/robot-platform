import { useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { Loader2, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { screenshotUrl } from '../lib/screenshot-url';
import { formatValue } from '../lib/format';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { AddFieldsControl } from '../components/add-fields-control';

// The Source workspace — the paste-and-go wizard reborn (spec §1/§6): schema
// discovery, the field table with provenance badges, and a mode-aware Extract
// button, ported from the old sandbox-detail.tsx wizard (deleted in Task 11,
// the sandbox/graduate world's removal) onto a real Source instead of a
// throwaway sandbox one. The field table now has a working Enabled toggle
// (`sources.setFieldEnabled`, Task 8/11) and an add-fields control beneath it
// (`AddFieldsControl`, shared with the confirm gate's "Request more fields").

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  source?: string;
  api_path?: string;
  tier?: 'requested' | 'discovered';
  example_value?: string;
  example_source?: 'live' | 'cached';
  candidate?: { concept: string; label: string };
  enabled?: boolean;
};

type ListingReport = {
  rowsFound: number;
  paginationStrategy: string | null;
  sampleDetailUrls: string[];
};

type Schema = {
  fields?: SchemaField[];
  pageType?: string;
  cached?: boolean;
  liveExamples?: boolean;
  blockedReason?: string | null;
  screenshotUrl?: string | null;
  listing?: ListingReport | null;
  hints?: string[];
};

type SourceRow = {
  id: string;
  slug: string;
  name: string;
  urlTemplate: string | null;
  listingMode: string | null;
  confirmedAt: string | Date | null;
  urlCount: number;
  selectorsJson: unknown;
};

export default function SourceSetup() {
  const navigate = useNavigate();
  const { project: projectSlug, source: sourceSlug } = useParams({ from: '/p/$project/sources/$source' });
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const listQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const source = (listQuery.data ?? []).find((s) => s.slug === sourceSlug) as SourceRow | undefined;

  const analyzeMutation = trpc.sources.analyze.useMutation({
    onSuccess: () => utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }),
    onError: (err) => setError(err.message),
  });

  const planMutation = trpc.crawl.plan.useMutation();
  const executeMutation = trpc.crawl.execute.useMutation();
  const probeMutation = trpc.crawl.probeAndSample.useMutation();
  const extractPending = planMutation.isPending || executeMutation.isPending || probeMutation.isPending;

  async function handleExtract() {
    if (!source) return;
    setError(null);
    try {
      const isListing = source.listingMode === 'listing_to_detail';
      if (!isListing) {
        // Detail Source: plan (enumerates one detail item per input row),
        // then execute every one of them — there is no probe gate for a
        // Source the operator already pointed straight at product pages.
        //
        // M2 (final-review-findings.md): no `limit` here. It used to pass
        // `source.urlCount`, but `crawl.execute`'s Zod schema caps `limit` at
        // 100, so a detail Source with more than 100 input rows 400'd on
        // every Extract click. The limit was never doing anything a detail
        // run's own queue doesn't already do on its own: this run plans
        // exactly one item per input row, so `executeRun`'s loop stops the
        // same way regardless — `claim` returns null once every row is
        // claimed. Omitting `limit` extracts every row, at any count, with no
        // cap to raise and no silent truncation above 100.
        const plan = await planMutation.mutateAsync({ sourceId: source.id, probe: false });
        await executeMutation.mutateAsync({ runId: plan.runId });
        navigate({ to: '/p/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: plan.runId } });
        return;
      }
      if (!source.confirmedAt) {
        // Listing, unconfirmed: probe the first input + sample a few details.
        // The run-detail page's confirm gate takes it from here.
        const probe = await probeMutation.mutateAsync({ sourceId: source.id });
        navigate({ to: '/p/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: probe.runId } });
        return;
      }
      // Listing, already confirmed: a full plan across every input row, at
      // the Source's real budget — no probe this time. Extract-pending flow
      // on the run page from here, same as any other plan.
      const plan = await planMutation.mutateAsync({ sourceId: source.id, probe: false });
      navigate({ to: '/p/$project/sources/$source/runs/$run', params: { project: projectSlug, source: sourceSlug, run: plan.runId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (listQuery.isLoading) return <Spinner label="Loading source..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  if (!source) return <NotFound what={`Source "${sourceSlug}"`} />;

  const schema = source.selectorsJson as Schema | null;
  const hasSchema = !!(schema && Array.isArray(schema.fields) && schema.fields.length > 0);
  const isListing = source.listingMode === 'listing_to_detail';

  const extractLabel = !isListing
    ? 'Extract'
    : !source.confirmedAt
      ? 'Probe & sample'
      : 'Extract everything';

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <ModeChip isListing={isListing} />
        <span className="text-xs text-gray-500">
          {source.urlCount} URL{source.urlCount === 1 ? '' : 's'}
        </span>
      </div>

      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

      {/*
        Finding 2 (final-review-findings.md): a blocked analyze must render
        this banner whenever the persisted payload carries `blockedReason`,
        independent of `cached`/`hasSchema`. A COLD domain's blocked listing
        analyze has no cache to fall back to — `runListingAnalysis` persists
        `fields: []` with `blockedReason` set, so `hasSchema` is false and the
        old `hasSchema && cached && ...` condition never rendered anything:
        the operator saw "No schema yet" + Analyze, retried, and got the same
        silent outcome. A WARM domain's blocked analyze already had cached
        fields to show (`cached && liveExamples === false`) and rendered
        correctly before this fix — that branch is unchanged below.
      */}
      {(schema?.blockedReason || (hasSchema && schema!.cached && schema!.liveExamples === false)) && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="micro-label text-amber-700">
            {schema?.blockedReason ? 'Site blocked this request' : 'Page not captured'}
          </p>
          <p className="mt-0.5 text-sm text-amber-900">
            {schema?.blockedReason ? (
              <>
                {schema.blockedReason} The site is refusing automated requests from this machine
                right now (its screenshot shows the block page).{' '}
                {hasSchema
                  ? 'The schema and examples below come from earlier runs on this domain — not this URL.'
                  : 'No cached schema exists yet for this domain, so there is nothing to show below.'}
                {' '}Wait ~10 minutes and{' '}
              </>
            ) : (
              <>
                This page couldn't be loaded, so the schema, page type, and example values come from
                earlier runs on this domain — not from this URL. They may describe a different page
                entirely.{' '}
              </>
            )}
            <button
              className="font-medium text-accent-700 underline-offset-2 hover:underline"
              disabled={analyzeMutation.isPending}
              onClick={() => {
                setError(null);
                analyzeMutation.mutate({ sourceId: source.id });
              }}
            >
              re-run analyze
            </button>
            .
          </p>
        </div>
      )}

      {!hasSchema && analyzeMutation.isPending && (
        <div className="mt-8 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Capturing page and discovering schema (~30-60s)...</span>
        </div>
      )}

      {!hasSchema && !analyzeMutation.isPending && (
        <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">No schema yet.</p>
          <button
            className="btn-primary mt-3 h-9"
            onClick={() => {
              setError(null);
              analyzeMutation.mutate({ sourceId: source.id });
            }}
          >
            Analyze
          </button>
          <p className="mt-2 text-xs text-gray-500">
            Fetches the page and maps its fields — may use AI for a new domain.
          </p>
        </div>
      )}

      {hasSchema && schema!.hints && schema!.hints.length > 0 && (
        <div className="mt-4 space-y-2">
          {schema!.hints.map((hint, i) => (
            <div key={i} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {hint}
            </div>
          ))}
        </div>
      )}

      {hasSchema && isListing && schema!.listing && (
        <div className="card mt-4 px-4 py-3 text-sm">
          <p className="text-gray-800">
            <span className="font-medium">{schema!.listing.rowsFound}</span>{' '}
            product row{schema!.listing.rowsFound === 1 ? '' : 's'} found · pagination:{' '}
            {schema!.listing.paginationStrategy ?? 'none detected'}
          </p>
          {schema!.listing.sampleDetailUrls.length > 0 && (
            <ul className="mt-2 space-y-1">
              {schema!.listing.sampleDetailUrls.map((u) => (
                <li key={u}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-[520px] truncate font-mono text-xs text-gray-500 hover:text-accent-700"
                    title={u}
                  >
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hasSchema && (
        <FieldsTable
          fields={schema!.fields!}
          screenshotPath={schema!.screenshotUrl ?? null}
          sourceId={source.id}
          projectSlug={projectSlug}
        />
      )}

      {hasSchema && <AddFieldsControl sourceId={source.id} />}

      {hasSchema && (
        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={handleExtract}
            disabled={extractPending}
            className="btn-primary h-9"
          >
            {extractPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {extractLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function ModeChip({ isListing }: { isListing: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
        isListing ? 'bg-accent-50 text-accent-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {isListing ? 'LISTING' : 'DETAIL'}
    </span>
  );
}

function FieldsTable({
  fields, screenshotPath, sourceId, projectSlug,
}: {
  fields: SchemaField[];
  screenshotPath: string | null;
  sourceId: string;
  projectSlug: string;
}) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="micro-label py-2 text-left">Enabled</th>
              <th className="micro-label py-2 text-left">Field</th>
              <th className="micro-label py-2 text-left">Type</th>
              <th className="micro-label py-2 text-left">Example</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <FieldRow key={field.name} field={field} sourceId={sourceId} projectSlug={projectSlug} />
            ))}
          </tbody>
        </table>
      </div>
      {screenshotPath && (
        <div>
          <img src={screenshotUrl(screenshotPath) ?? ''} alt="Page screenshot" className="card w-full" />
        </div>
      )}
    </div>
  );
}

/**
 * One FieldsTable row, with its own `sources.setFieldEnabled` mutation
 * instance — simplest correct isolation so flipping one field's checkbox
 * never disables another row's. Optimistic UI is skipped on purpose (Task 11
 * brief): the checkbox just disables while its own mutation is pending, and
 * `sources.listByProject` is invalidated on settle (success or error alike,
 * matching this page's existing `analyzeMutation` invalidation at the top of
 * the file) so a failed flip snaps back to the server's real value instead of
 * silently sticking.
 */
function FieldRow({
  field, sourceId, projectSlug,
}: {
  field: SchemaField;
  sourceId: string;
  projectSlug: string;
}) {
  const utils = trpc.useUtils();
  const setFieldEnabledMutation = trpc.sources.setFieldEnabled.useMutation({
    onSettled: () => utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug }),
  });

  const enabled = field.enabled !== false;
  const isCached = field.example_source === 'cached';

  return (
    <tr className={`border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/60 ${enabled ? '' : 'opacity-50'}`}>
      <td className="py-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={setFieldEnabledMutation.isPending}
          onChange={(e) => setFieldEnabledMutation.mutate({ sourceId, field: field.name, enabled: e.target.checked })}
          aria-label={`Enable ${field.name}`}
        />
      </td>
      <td className="py-2 font-mono text-xs">{field.name}</td>
      <td className="py-2 text-xs text-gray-600">{field.type}</td>
      <td className="py-2 font-mono text-xs">
        {field.example_value ? (
          <span className="inline-flex max-w-[260px] items-center gap-1.5">
            <span
              className={`truncate ${isCached ? 'text-gray-400' : 'text-gray-500'}`}
              title={formatValue(field.example_value)}
            >
              {formatValue(field.example_value)}
            </span>
            {isCached && (
              <span className="micro-label shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[9px]">
                earlier run
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}
