import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { Globe, Layers, ArrowRight, RefreshCw } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound, EmptyState } from '../components/page-states';
import { formatValue, previewValue } from '../lib/format';
import type { CandidateCatalogue } from '../lib/candidate-picker';

export default function DomainDetail() {
  const { domain } = useParams({ from: '/ops/domains/$domain' });
  const detailQuery = trpc.domains.intelligenceDetail.useQuery({ domain });

  if (detailQuery.isLoading) return <Spinner label="Loading domain..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data || detailQuery.data.pageTypes.length === 0) {
    return <NotFound what={`Domain intelligence for "${domain}"`} />;
  }

  const { pageTypes, sources } = detailQuery.data;

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/ops/domains" className="hover:text-gray-700">Domains</Link>
        <span>/</span>
        <span className="font-mono text-gray-700">{domain}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Globe className="h-5 w-5 text-gray-400" />
        <h1 className="font-mono text-2xl font-medium">{domain}</h1>
      </div>

      <div className="mt-6 divide-y divide-gray-200">
        {pageTypes.map((pt) => (
          <div key={pt.pageType} className="py-6 first:pt-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-900">{pt.pageType}</h2>
              <div className="flex gap-2">
                {pt.hasJsonLd && <span className="rounded-full bg-changed-tint px-2.5 py-0.5 font-mono text-[10px] font-medium text-changed">JSON-LD</span>}
                {pt.hasNextData && <span className="rounded-full bg-changed-tint px-2.5 py-0.5 font-mono text-[10px] font-medium text-changed">NextData</span>}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Stat label="Runs (total)" value={String(pt.totalRuns)} />
              <Stat label="Successful" value={String(pt.successfulRuns)} />
              <Stat label="Success rate" value={`${pt.successRate}%`} />
              <Stat label="Last verified" value={new Date(pt.lastVerifiedAt).toLocaleDateString()} />
            </dl>
            <SelectorsTable selectors={pt.selectors} conflicts={pt.conflicts} domain={domain} pageType={pt.pageType} />
            <CandidateCatalogueSection catalogue={(pt.catalogue ?? {}) as CandidateCatalogue} domain={domain} pageType={pt.pageType} />
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-medium text-gray-900">
        Sources across customers touching {domain} ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <EmptyState title="No sources touch this domain yet" description="Nothing has been configured against this domain across projects." />
      ) : (
        <ul className="mt-2 divide-y divide-gray-200">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/projects/$project/sources/$source"
                params={{ project: s.projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.projectName}, {s.datasetName}, {s.urlTemplate}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Selector = {
  field: string; source: string | null; hits: number; misses: number;
  hitRate: number; lastValue: unknown; lastUsedAt: string | null;
  /** An operator pinned this path — visible here even when the field has no active conflict. */
  pinned: boolean;
};

/** A field whose cached paths currently return different values. */
type Conflict = {
  field: string;
  /** Ranked best-first — index 0 is what the cache serves today. */
  candidates: Array<{ source: string; path: string; value: unknown; pinned: boolean }>;
};

function SelectorsTable({
  selectors, conflicts, domain, pageType,
}: {
  selectors: Selector[]; conflicts: Conflict[]; domain: string; pageType: string;
}) {
  const [asc, setAsc] = useState(true);
  const utils = trpc.useUtils();
  const pin = trpc.domains.pinFieldPath.useMutation({
    onSuccess: () => utils.domains.intelligenceDetail.invalidate({ domain }),
  });
  if (selectors.length === 0) {
    return <p className="mt-3 text-xs text-gray-400">No cached field paths.</p>;
  }
  const sorted = [...selectors].sort((a, b) => (asc ? a.hitRate - b.hitRate : b.hitRate - a.hitRate));
  const conflictByField = new Map(conflicts.map((c) => [c.field, c]));
  return (
    <>
      {conflicts.length > 0 && (
        <div className="mt-4 border-l-[3px] border-l-fail bg-fail-tint p-3 text-xs">
          <p className="font-semibold text-fail">
            {conflicts.length} field{conflicts.length === 1 ? '' : 's'} with disagreeing paths
          </p>
          <p className="mt-1 text-gray-900">
            Two or more cached paths return different values. This is how a bad path shows
            itself — but a genuine change on the site looks the same, so nothing is discarded
            automatically. Review and pin the correct one.
          </p>
          {pin.isError && (
            <p className="mt-2 px-2 py-1 text-[11px] text-fail">{pin.error.message}</p>
          )}
          <ul className="mt-2 space-y-2">
            {conflicts.map((c) => (
              <li key={c.field} className="text-[11px]">
                <span className="font-mono font-semibold text-fail">{c.field}</span>
                <ul className="mt-1 space-y-1">
                  {c.candidates.map((cand, i) => (
                    <li key={`${cand.path}-${i}`} className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pin.isPending}
                        onClick={() => pin.mutate({
                          domain, pageType, field: c.field,
                          path: cand.pinned ? null : cand.path,
                        })}
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
                          cand.pinned
                            ? 'border-pass bg-pass text-white'
                            : 'border-fail bg-gray-50 text-fail hover:bg-fail-tint'
                        }`}
                      >
                        {cand.pinned ? 'Pinned' : 'Pin'}
                      </button>
                      <span className="font-mono text-gray-900">
                        {cand.source}
                        {i === 0 && !c.candidates.some((x) => x.pinned) && (
                          <span className="text-fail"> (served)</span>
                        )}
                        {': '}
                        {previewValue(cand.value).slice(0, 60)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="sheet-head px-3 py-2 text-left">Field</th>
              <th className="sheet-head px-3 py-2 text-left">Source</th>
              <th className="sheet-head cursor-pointer px-3 py-2 text-left" onClick={() => setAsc((v) => !v)}>
                Hit-rate {asc ? '▲' : '▼'}
              </th>
              <th className="sheet-head px-3 py-2 text-left">Hits/miss</th>
              <th className="sheet-head px-3 py-2 text-left">Conflict</th>
              <th className="sheet-head px-3 py-2 text-left">Last value</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              const resolved = s.source !== null;
              const weak = resolved && s.hitRate < 50;
              const conflict = conflictByField.get(s.field);
              // A disagreement outranks a weak hit rate: a path can be reliable and
              // reliably wrong, which is exactly the case worth looking at.
              const rail = conflict ? 'cell-rail-fail' : weak ? 'cell-rail-not-captured' : 'cell-rail-none';
              return (
                <tr key={`${s.field}-${i}`} className={`sheet-row h-8 transition-colors hover:bg-gray-100/60 ${resolved ? '' : 'text-gray-400'}`}>
                  <td className={`px-3 font-mono text-[13px] ${rail}`}>{s.field}</td>
                  <td className="px-3 text-gray-600">
                    {s.source ?? '—'}
                    {/* A pin is an operator ruling — it must show even for a
                        field with no active conflict, which the conflict card
                        above (the only other place pins render) never lists. */}
                    {s.pinned && (
                      <span className="ml-1.5 rounded-full bg-pass-tint px-1.5 py-0.5 font-mono text-[9px] font-medium text-pass">
                        pinned
                      </span>
                    )}
                  </td>
                  <td className="px-3 font-mono text-[13px]">{resolved ? `${s.hitRate}%` : '—'}</td>
                  <td className="px-3 font-mono text-[13px] text-gray-600">{resolved ? `${s.hits}/${s.misses}` : '—'}</td>
                  <td className="px-3">
                    {conflict ? (
                      <span
                        className="text-fail"
                        title={conflict.candidates.map((c) => `${c.source}: ${formatValue(c.value)}`).join('\n')}
                      >
                        ⚠ {conflict.candidates.length} values
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-3 font-mono text-[13px] text-gray-600">
                    {s.lastValue == null ? '—' : previewValue(s.lastValue).slice(0, 80)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * What this domain/pageType CAN yield per concept — labelled candidates
 * discovered once and refreshed only on operator request. Empty until a
 * discovery has run for this domain/pageType, which is the common case, so
 * this must render a clean empty state rather than nothing or a crash.
 */
/**
 * Worth a thumbnail? Plain cross-origin <img> tags are not subject to CORS —
 * only fetch/canvas reads are — so product CDNs render fine; a host that
 * blocks hotlinking just fires onError and the img hides itself.
 */
function looksLikeImageUrl(concept: string, value: unknown): boolean {
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) return false;
  return concept.includes('image') || /\.(jpe?g|png|webp|gif|avif)([?#]|$)/i.test(value);
}

function CandidateCatalogueSection({
  catalogue, domain, pageType,
}: {
  catalogue: CandidateCatalogue; domain: string; pageType: string;
}) {
  const utils = trpc.useUtils();
  const refresh = trpc.domains.refreshCatalogue.useMutation({
    onSuccess: () => utils.domains.intelligenceDetail.invalidate({ domain }),
  });
  const concepts = Object.entries(catalogue);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h3 className="label-soft">Candidate catalogue</h3>
        <button
          type="button"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate({ domain, pageType })}
          className="btn-quiet"
          title="Cleared now — rebuilt by the next successful run."
        >
          <RefreshCw className="h-3 w-3" />
          {refresh.isPending ? 'Refreshing...' : 'Refresh catalogue'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        Cleared now — rebuilt by the next successful run, not immediately.
      </p>
      {refresh.isError && (
        <p className="mt-2 text-xs text-fail">{refresh.error.message}</p>
      )}
      {concepts.length === 0 ? (
        <div className="mt-2 rounded border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-400">
          No candidates discovered yet for this page type.
        </div>
      ) : (
        <div className="mt-2 divide-y divide-gray-200">
          {concepts.map(([concept, candidates]) => (
            <div key={concept} className="px-3 py-2.5">
              <div className="label-soft">{concept}</div>
              <div className="mt-1.5 max-w-xl space-y-1.5">
                {candidates.map((c) => (
                  <div
                    key={c.label}
                    className={`flex items-center gap-3 rounded-md border px-2.5 py-1.5 ${
                      c.displayed ? 'border-accent-500 bg-accent-50/40' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    {looksLikeImageUrl(concept, c.sampleValue) && (
                      <img
                        src={c.sampleValue as string}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded border border-gray-200 object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {/* Hierarchy: the VALUE is the data and reads largest; the
                          label names it; the source is provenance trivia. */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-gray-800">{c.label}</span>
                        {c.displayed && (
                          <span className="shrink-0 rounded-full bg-accent-100 px-1.5 font-mono text-[9px] font-medium text-accent-700">
                            displayed
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-gray-400">{c.source}</div>
                      <div
                        className="mt-1 truncate font-mono text-sm text-gray-900"
                        title={formatValue(c.sampleValue)}
                      >
                        {formatValue(c.sampleValue)}
                      </div>
                      {c.scope && (
                        <div className="mt-0.5 truncate text-[10px] text-gray-400">
                          {Object.entries(c.scope).map(([k, v]) => `${k}: ${v}`).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-soft">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
