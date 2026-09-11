// packages/dashboard/src/components/extract-sample.tsx
// Step 2 of the Extract tab: proof that the walk works before anything runs
// at scale.
//
// This is the one section that reads its own data. The parent owns the
// *decision* (which run is the sample, whether it is stale, whether a new one
// is being kicked off) and this component owns everything that follows from a
// run id — progress, the evidence facts, the rows, and the honest note under
// any column that came back empty.
//
// Three queries, one run id:
//   crawl.status         — the sample's own status, polled while it moves
//   crawl.items          — the work-list counts and per-item confirmed-absent
//                          fields (the "not on page" cells)
//   runs.getWithDetails  — `run.logs` (the only place a persisted run's plan
//                          warnings survive, see parse-run-log.ts) and the
//                          extracted rows themselves
//
// In product-URL mode there is nothing to prove: the pages are known, so the
// section says exactly that and asks for nothing.
import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { parseRunLog } from '../lib/parse-run-log';
import { probeEvidence } from '../lib/probe-evidence';
import { isRunActive } from '../lib/run-progress';
import { emptyCellNote, sampleFacts, type ExtractMode } from '../lib/extract-view';
import { ResultsTable } from './results-table';

/** The one line the sample's own button promises, verbatim from the mockup. */
const SAMPLE_SENTENCE =
  'walks the first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free.';

const EMPTY_COUNTS = { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 };

/**
 * Still moving, so keep polling.
 *
 * The run lifecycle is `planning -> planned -> extracting -> completed |
 * partial | failed`, plus `cancelling`/`cancelled` (see `planSource` in
 * packages/api/src/crawl/plan-source.ts and `RunStatusBadge` in
 * routes/source-run-detail.tsx). `running` is an ITEM status — `run_items
 * .status` — that a run row never holds, so branching on it polls nothing.
 * `planning` is the one that matters most here: a sample observed while its
 * plan is still being built would otherwise never start polling at all, and
 * `refetchInterval` is only re-evaluated when the query updates.
 * `isRunActive` covers `extracting`/`cancelling` once phase 2 starts.
 */
function isActive(status: string): boolean {
  return status === 'planning' || status === 'planned' || isRunActive(status);
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

export function ExtractSample({
  mode,
  runId,
  sampling,
  onSample,
  onSampleAgain,
  columns,
  stale,
  readOnly,
}: {
  mode: ExtractMode;
  runId: string | null;
  sampling: boolean;
  onSample: () => void;
  onSampleAgain: () => void;
  /** The project's contract columns: `key` is what a result row is keyed by
   * (see `effectiveSchema` in packages/api — a keyed contract entry's `key`
   * becomes the extraction chain's field name), `name` is the plain-language
   * label. */
  columns: Array<{ key: string; name: string }>;
  stale: boolean;
  readOnly: boolean;
}) {
  const statusQuery = trpc.crawl.status.useQuery(
    { runId: runId ?? '' },
    {
      enabled: !!runId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status !== undefined && isActive(status) ? 2000 : false;
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

  const fields = useMemo(
    () =>
      columns.map((c) => ({
        name: c.key,
        // The header reads the field's plain-language name; the key is still
        // what every row lookup uses, and stays in the header's tooltip via
        // `candidate` ("key · Plain-language label").
        label: c.name,
        type: 'text',
        candidate: { concept: c.key, label: c.name },
      })),
    [columns],
  );

  // Every column that came back empty on at least one sampled row, with how
  // many rows it was empty on. One note per such column, under the table.
  const emptyNotes = useMemo(() => {
    if (rows.length === 0) return [];
    const notes: string[] = [];
    for (const column of columns) {
      const emptyOn = rows.filter((row) => isEmptyCell(row[column.key])).length;
      // `column.key` looks up the cell; `column.name` is what the note says.
      // The customer named the field on the contract and the table header two
      // elements up already uses that name — a note reading "price_currency
      // was empty on 2 of 3 sampled pages" leaks the key nobody chose.
      if (emptyOn > 0) notes.push(emptyCellNote(column.name, emptyOn, rows.length));
    }
    return notes;
  }, [columns, rows]);

  if (mode === 'detail') {
    return <p className="text-xs text-gray-600">No sample needed, the pages are known.</p>;
  }

  if (!runId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary h-8" disabled={readOnly || sampling} onClick={onSample}>
          {sampling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sample 3 products
        </button>
        <span className="text-xs text-gray-600">{SAMPLE_SENTENCE}</span>
      </div>
    );
  }

  const status = statusQuery.data?.status ?? null;
  const active = status !== null && isActive(status);
  const counts = itemsQuery.data?.counts ?? EMPTY_COUNTS;
  const warnings = parseRunLog(detailQuery.data?.run.logs ?? null).warnings;
  const evidence = probeEvidence({ counts: { listing: counts.listing, detail: counts.detail }, warnings });
  // The fourth fact is about the rows the sample produced, not about every
  // product link the walk found: a row counts as complete when every contract
  // column on it is filled.
  const completeRows = rows.filter((row) => columns.every((c) => !isEmptyCell(row[c.key]))).length;
  const facts = sampleFacts(evidence, { complete: completeRows, total: rows.length });

  return (
    <div className="space-y-3">
      {stale && (
        <p className="text-xs text-warn">Pages changed since this sample. Sample again to refresh it.</p>
      )}

      {/* Four facts, four columns. The label is secondary; the number is the
          thing being read, so it is a value in mono. */}
      <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="label-soft">{fact.label}</dt>
            {/* Wraps rather than truncates: three of the four facts are a
                number, but the pagination one is a strategy name and cutting
                it off would hide the very thing the fact reports. */}
            <dd className="mt-0.5 font-mono text-lg break-words text-gray-900">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {active && (
        <p className="flex items-center gap-2 text-xs text-gray-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Sampling · {counts.done} of {counts.detail} rows extracted
        </p>
      )}

      {statusQuery.data?.errorMessage && (
        <p className="text-xs text-fail">{statusQuery.data.errorMessage}</p>
      )}

      {/* Cell-level highlighting is deliberately left out: ResultsTable
          exposes no per-cell hook beyond `absentByUrl` (which renders a
          confirmed-absent cell as "not on page"). The notes below carry the
          same information without forking the table.

          `headerVariant="none"` because the section already has its own
          heading — the table's own <h2> under this section's <h3> would
          invert the document outline. */}
      <ResultsTable
        data={rows}
        confidence={null}
        fields={fields}
        absentByUrl={absentByUrl}
        headerVariant="none"
      />

      {emptyNotes.map((note) => (
        <p key={note} className="text-xs text-gray-600">
          {note}
        </p>
      ))}

      <div>
        <button type="button" className="btn-quiet" disabled={readOnly || sampling || active} onClick={onSampleAgain}>
          {sampling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sample again
        </button>
      </div>
    </div>
  );
}
