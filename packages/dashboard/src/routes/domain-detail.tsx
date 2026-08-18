import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { Globe, Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, NotFound, EmptyState } from '../components/page-states';

export default function DomainDetail() {
  const { domain } = useParams({ from: '/domains/$domain' });
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
        <Link to="/domains" className="hover:text-gray-700">Domains</Link>
        <span>/</span>
        <span className="font-mono text-gray-700">{domain}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Globe className="h-5 w-5 text-gray-400" />
        <h1 className="font-mono text-xl font-bold tracking-tight">{domain}</h1>
      </div>

      {pageTypes.map((pt) => (
        <div key={pt.pageType} className="mt-6 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">{pt.pageType}</h2>
            <div className="flex gap-2 text-[10px] uppercase">
              {pt.hasJsonLd && <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">JSON-LD</span>}
              {pt.hasNextData && <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">NextData</span>}
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="Runs (total)" value={String(pt.totalRuns)} />
            <Stat label="Successful" value={String(pt.successfulRuns)} />
            <Stat label="Success rate" value={`${pt.successRate}%`} />
            <Stat label="Last verified" value={new Date(pt.lastVerifiedAt).toLocaleDateString()} />
          </dl>
          <SelectorsTable selectors={pt.selectors} conflicts={pt.conflicts} domain={domain} pageType={pt.pageType} />
        </div>
      ))}

      <h2 className="mt-8 text-sm font-semibold text-gray-700">
        Sources across customers touching {domain} ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <EmptyState title="No graduated sources touch this domain yet" description="Sandbox-only activity isn't listed here." />
      ) : (
        <ul className="mt-2 divide-y rounded-md border">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$project/sources/$source"
                params={{ project: s.projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {s.projectName} · {s.datasetName} · {s.urlTemplate}
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
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs">
          <p className="font-semibold text-red-800">
            {conflicts.length} field{conflicts.length === 1 ? '' : 's'} with disagreeing paths
          </p>
          <p className="mt-1 text-red-700">
            Two or more cached paths return different values. This is how a bad path shows
            itself — but a genuine change on the site looks the same, so nothing is discarded
            automatically. Review and pin the correct one.
          </p>
          {pin.isError && (
            <p className="mt-2 rounded bg-red-100 px-2 py-1 text-[11px] text-red-900">{pin.error.message}</p>
          )}
          <ul className="mt-2 space-y-2">
            {conflicts.map((c) => (
              <li key={c.field} className="text-[11px]">
                <span className="font-mono font-semibold text-red-900">{c.field}</span>
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
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase transition-colors disabled:opacity-50 ${
                          cand.pinned
                            ? 'border-green-600 bg-green-600 text-white'
                            : 'border-red-300 bg-white text-red-700 hover:bg-red-100'
                        }`}
                      >
                        {cand.pinned ? 'Pinned' : 'Pin'}
                      </button>
                      <span className="font-mono text-red-900">
                        {cand.source}
                        {i === 0 && !c.candidates.some((x) => x.pinned) && (
                          <span className="text-red-600"> (served)</span>
                        )}
                        <span className="text-red-500"> · </span>
                        {String(cand.value).slice(0, 60)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 overflow-hidden rounded border">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="cursor-pointer px-3 py-2 font-medium" onClick={() => setAsc((v) => !v)}>
                Hit-rate {asc ? '▲' : '▼'}
              </th>
              <th className="px-3 py-2 font-medium">Hits/miss</th>
              <th className="px-3 py-2 font-medium">Conflict</th>
              <th className="px-3 py-2 font-medium">Last value</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((s, i) => {
              const resolved = s.source !== null;
              const weak = resolved && s.hitRate < 50;
              const conflict = conflictByField.get(s.field);
              // A disagreement outranks a weak hit rate: a path can be reliable and
              // reliably wrong, which is exactly the case worth looking at.
              const rowClass = conflict ? 'bg-red-50' : weak ? 'bg-orange-50' : resolved ? '' : 'text-gray-400';
              return (
                <tr key={`${s.field}-${i}`} className={rowClass}>
                  <td className="px-3 py-1.5 font-mono">{s.field}</td>
                  <td className="px-3 py-1.5 text-gray-600">{s.source ?? '—'}</td>
                  <td className="px-3 py-1.5">{resolved ? `${s.hitRate}%` : '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600">{resolved ? `${s.hits}/${s.misses}` : '—'}</td>
                  <td className="px-3 py-1.5">
                    {conflict ? (
                      <span
                        className="text-red-700"
                        title={conflict.candidates.map((c) => `${c.source}: ${String(c.value)}`).join('\n')}
                      >
                        ⚠ {conflict.candidates.length} values
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-3 py-1.5 text-gray-600">
                    {s.lastValue == null ? '—' : String(s.lastValue).slice(0, 80)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
