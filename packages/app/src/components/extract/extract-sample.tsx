import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { probeEvidence } from '../../lib/site/probe-evidence';
import { emptyCellNote, sampleFacts, type ExtractMode } from '../../lib/site/extract-view';
import {
  completeRowCount,
  emptyCellCounts,
  isProbeMoving,
  parseRunWarnings,
} from '../../lib/site/extract-screen-view';

/**
 * Step 2: proof that the walk works before anything runs at scale.
 *
 * This is the one section that reads its own data. The tab owns the decision —
 * which run is the sample, whether it is stale, whether a new one is being
 * kicked off — and this component owns everything that follows from a run id:
 * progress, the evidence facts, the rows, and the honest note under any column
 * that came back empty.
 *
 * Three queries, one run id:
 *   crawl.status         — the sample's own status, polled while it moves
 *   crawl.items          — the work-list counts and the per-item confirmed-absent
 *                          fields (the "not on page" cells)
 *   runs.getWithDetails  — `run.logs` (the only place a persisted run's plan
 *                          warnings survive) and the extracted rows themselves
 *
 * In product-URL mode there is nothing to prove: the pages are known, so the
 * section says exactly that and asks for nothing.
 */

/** The one line the sample's own button promises, verbatim from spec §5.7. */
const SAMPLE_SENTENCE =
  'walks the first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free.';

const EMPTY_COUNTS = { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 };

export function ExtractSample({
  mode,
  runId,
  sampling,
  onSample,
  columns,
  stale,
  disabledReason,
}: {
  mode: ExtractMode;
  runId: string | null;
  sampling: boolean;
  onSample: () => void;
  /** The project's contract columns: `key` is what a result row is keyed by, `name` is the plain-language label. */
  columns: Array<{ key: string; name: string }>;
  stale: boolean;
  /** Why sampling is not possible yet, shown beside the button. `null` when it is. */
  disabledReason: string | null;
}) {
  const statusQuery = trpc.crawl.status.useQuery(
    { runId: runId ?? '' },
    {
      enabled: !!runId,
      // Only while the probe is still moving. A settled run is never going to
      // change again, and polling it forever is what wedges a screen.
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status !== undefined && isProbeMoving(status) ? 2000 : false;
      },
    },
  );
  const itemsQuery = trpc.crawl.items.useQuery({ runId: runId ?? '' }, { enabled: !!runId });
  const detailQuery = trpc.runs.getWithDetails.useQuery({ id: runId ?? '' }, { enabled: !!runId });

  const absentByUrl = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of itemsQuery.data?.items ?? []) {
      const absent = Array.isArray(item.absentFields) ? (item.absentFields as string[]) : [];
      if (absent.length > 0) map.set(item.url, new Set(absent));
    }
    return map;
  }, [itemsQuery.data]);

  const rawRows = detailQuery.data?.extraction?.data;
  const rows = useMemo(
    () => (Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : []),
    [rawRows],
  );

  const notes = useMemo(() => emptyCellCounts(rows, columns), [rows, columns]);

  if (mode === 'detail') {
    return <p className="text-base text-muted-foreground">No sample needed, the pages are known.</p>;
  }

  if (!runId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={sampling || disabledReason !== null} onClick={onSample}>
          {sampling ? <Loader2 className="animate-spin" /> : null}
          Sample 3 products
        </Button>
        <span className="text-base text-muted-foreground">{disabledReason ?? SAMPLE_SENTENCE}</span>
      </div>
    );
  }

  const status = statusQuery.data?.status ?? null;
  const active = status !== null && isProbeMoving(status);
  const counts = itemsQuery.data?.counts ?? EMPTY_COUNTS;
  const warnings = parseRunWarnings(detailQuery.data?.run.logs);
  const evidence = probeEvidence({ counts: { listing: counts.listing, detail: counts.detail }, warnings });
  const facts = sampleFacts(evidence, { complete: completeRowCount(rows, columns), total: rows.length }, counts.done);

  return (
    <div className="space-y-3">
      {stale ? (
        <p className="border-l-2 border-warn pl-2.5 text-base text-warn">
          Pages changed since this sample. Sample again to refresh it.
        </p>
      ) : null}

      {/* Up to four facts, four columns. The label is secondary; the number is the
          thing being read, so it is a value in mono. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{fact.label}</dt>
            {/* Wraps rather than truncates: three of the four facts are a
                number, but the pagination one is a strategy name and cutting it
                off would hide the very thing the fact reports. */}
            <dd className="mt-0.5 font-mono text-lg break-words">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {active ? (
        <p className="flex items-center gap-2 text-base text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Sampling · {counts.done} of {counts.detail} rows extracted
        </p>
      ) : null}

      {statusQuery.data?.errorMessage ? (
        <p role="alert" className="text-base text-fail">
          {statusQuery.data.errorMessage}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-[6px] border border-line">
          <table className="w-full min-w-max border-collapse text-base">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-raised [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-sm [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
                {columns.map((column) => (
                  <th key={column.key} title={`${column.key} · ${column.name}`}>
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                // `_url` is the row's own address, written by the extractor
                // beside the contract's fields — the key `crawl.items` keys its
                // confirmed-absent fields by.
                const url = typeof row._url === 'string' ? row._url : '';
                const absent = absentByUrl.get(url);
                return (
                  <tr key={i} className="border-b border-line last:border-0">
                    {columns.map((column) => {
                      const value = row[column.key];
                      const empty = value === null || value === undefined || value === '';
                      return (
                        <td key={column.key} className="max-w-[280px] px-3 py-2 align-top">
                          {empty ? (
                            // "not on page" is the engine's own answer — the
                            // field was looked for and confirmed absent — and it
                            // is a different thing from a cell nobody could
                            // fill. Both stay quiet; neither is invented.
                            <span className="text-muted-foreground">
                              {absent?.has(column.key) ? 'not on page' : '—'}
                            </span>
                          ) : (
                            <div className="truncate" title={String(value)}>
                              {String(value)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {notes.map((note) => (
        <p key={note.name} className="text-base text-muted-foreground">
          {emptyCellNote(note.name, note.emptyOn, note.sampled)}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={sampling || active || disabledReason !== null}
          onClick={onSample}
        >
          {sampling ? <Loader2 className="animate-spin" /> : null}
          Sample again
        </Button>
        {/* Every disabled control says why, within a line of it. */}
        {disabledReason ? (
          <span className="text-base text-muted-foreground">{disabledReason}</span>
        ) : active ? (
          <span className="text-base text-muted-foreground">This sample is still running</span>
        ) : null}
      </div>
    </div>
  );
}
