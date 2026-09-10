import { CheckCircle2 } from 'lucide-react';
import { formatValue } from '../lib/format';
import { fillBadge, cellState, type FieldCoverage } from '../lib/coverage-view';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  source?: string;
  api_path?: string;
  tier?: 'requested' | 'discovered';
  example_value?: string;
  enabled?: boolean;
  candidate?: { concept: string; label: string };
};

const EMPTY_ABSENT_SET = new Set<string>();

export function ResultsTable({
  data,
  confidence,
  fields,
  headerVariant = 'neutral',
  coverage,
  absentByUrl,
  selectable = false,
  selectedUrls,
  onToggleRow,
  onFilterField,
}: {
  data: Record<string, unknown>[];
  confidence: number | null;
  fields: SchemaField[];
  /**
   * `'none'` renders the table with no header of its own — no "Extraction
   * results" heading and no row count. For a caller that already has a
   * heading above it (the Extract tab's numbered sections), the table's own
   * <h2> would sit under that section's <h3> and invert the outline.
   */
  headerVariant?: 'neutral' | 'celebrate' | 'none';
  /** Per-field fill counts (Task 2's `crawl.coverage`) — drives the header's fill badges. */
  coverage?: FieldCoverage[];
  /** Per-row confirmed-absent field names, keyed by `_url`. Optional — see cellState's fallback below. */
  absentByUrl?: Map<string, Set<string>>;
  /** Renders a leading checkbox column. */
  selectable?: boolean;
  selectedUrls?: Set<string>;
  onToggleRow?: (url: string) => void;
  /** Fired when a fill badge is clicked — the Excel-style "filter to gaps" handle. */
  onFilterField?: (name: string) => void;
}) {
  const visibleFields = fields.filter((f) => f.enabled !== false);
  const fieldNames = visibleFields.map((f) => f.name);
  const candidateByName = new Map(visibleFields.map((f) => [f.name, f.candidate]));
  const coverageByName = new Map((coverage ?? []).map((c) => [c.name, c]));
  return (
    <div className="mt-8">
      {headerVariant !== 'none' && (
      <div className="mb-3 flex items-baseline gap-3">
        {headerVariant === 'celebrate' ? (
          <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Extraction complete
          </span>
        ) : (
          <h2 className="text-sm font-medium text-gray-900">Extraction results</h2>
        )}
        <span className="text-xs text-gray-500">
          {data.length} {data.length === 1 ? 'row' : 'rows'}
        </span>
        {confidence != null && (
          <span className="text-xs text-gray-500">· {confidence}% confidence</span>
        )}
      </div>
      )}
      {data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-500">
          No rows extracted.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                {selectable && <th className="w-8 px-3 py-2" />}
                {fieldNames.map((name) => {
                  const candidate = candidateByName.get(name);
                  const title = candidate ? `${name} · ${candidate.label}` : name;
                  const badge = fillBadge(coverageByName.get(name));
                  return (
                    <th key={name} title={title} className="px-3 py-2 text-left font-mono text-[11px] font-medium text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <span>{name}</span>
                        {badge && (
                          <button
                            type="button"
                            onClick={() => onFilterField?.(name)}
                            disabled={!onFilterField}
                            title={`${badge} filled — click to show only rows missing ${name}`}
                            className="micro-label rounded border border-gray-200 px-1 py-0.5 normal-case tracking-normal text-gray-500 transition-colors hover:border-accent-300 hover:text-accent-700 disabled:cursor-default disabled:hover:border-gray-200 disabled:hover:text-gray-500"
                          >
                            {badge}
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 100).map((row, i) => {
                const url = typeof row._url === 'string' ? row._url : undefined;
                const absentFields = (url && absentByUrl?.get(url)) || EMPTY_ABSENT_SET;
                return (
                  <tr key={i} className="border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/60">
                    {selectable && (
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={!!url && !!selectedUrls?.has(url)}
                          onChange={() => url && onToggleRow?.(url)}
                          disabled={!url}
                          aria-label={url ? `Select row ${url}` : 'Select row'}
                        />
                      </td>
                    )}
                    {fieldNames.map((name) => {
                      const state = cellState(row[name], name, absentFields);
                      return (
                        <td key={name} className="px-3 py-2 align-top font-mono text-xs text-gray-800">
                          {state === 'filled' ? (
                            <span className="block max-w-[300px] truncate" title={formatValue(row[name])}>
                              {formatValue(row[name])}
                            </span>
                          ) : state === 'absent' ? (
                            <span className="italic text-gray-400">not on page</span>
                          ) : (
                            <span className="text-gray-300">—</span>
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
      )}
      {data.length > 100 && (
        <p className="mt-2 text-xs text-gray-500">Showing 100 of {data.length} rows.</p>
      )}
    </div>
  );
}
