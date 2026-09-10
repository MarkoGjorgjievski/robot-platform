import { formatValue } from '../lib/format';
import { fillBadge, cellState, type FieldCoverage } from '../lib/coverage-view';

type SchemaField = {
  /** The identifier a result row is keyed by. */
  name: string;
  /** Plain-language header text. Header only — every lookup still goes through `name`. */
  label?: string;
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
  const labelByName = new Map(visibleFields.map((f) => [f.name, f.label ?? f.name]));
  const coverageByName = new Map((coverage ?? []).map((c) => [c.name, c]));
  return (
    <div className="mt-8">
      {headerVariant !== 'none' && (
      <div className="mb-3 flex items-baseline gap-3">
        {/* No glyph on the celebrate variant: the accent tint behind the words
            is the mark that the run finished (spec 7). */}
        {headerVariant === 'celebrate' ? (
          <span className="rounded bg-accent-50 px-2 py-0.5 text-sm font-medium text-gray-900">
            Extraction complete
          </span>
        ) : (
          <h2 className="name text-lg leading-[1.25]">Extraction results</h2>
        )}
        <span className="text-xs text-gray-600">
          {data.length} {data.length === 1 ? 'row' : 'rows'}
        </span>
        {confidence != null && (
          <span className="label-soft rounded bg-changed-tint px-1.5 py-0.5 text-changed">
            {confidence}% confidence
          </span>
        )}
      </div>
      )}
      {data.length === 0 ? (
        <p className="py-6 text-sm text-gray-600">No rows extracted.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr className="sheet-head sheet-row h-8">
                {selectable && <th className="w-8 px-3" />}
                {fieldNames.map((name) => {
                  const candidate = candidateByName.get(name);
                  const heading = labelByName.get(name) ?? name;
                  const title = candidate ? `${name} · ${candidate.label}` : name;
                  const badge = fillBadge(coverageByName.get(name));
                  return (
                    <th key={name} title={title} className="px-3 text-left font-semibold">
                      <div className="flex items-center gap-1.5">
                        <span>{heading}</span>
                        {/* A badge only ever appears on a column with gaps
                            (`fillBadge` returns null on a clean one), so it is
                            always the warn token. */}
                        {badge && (
                          <button
                            type="button"
                            onClick={() => onFilterField?.(name)}
                            disabled={!onFilterField}
                            title={`${badge} filled — click to show only rows missing ${name}`}
                            className="label-soft rounded bg-warn-tint px-1 py-0.5 font-mono text-warn transition-colors enabled:hover:text-gray-900 disabled:cursor-default"
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
                  <tr key={i} className="sheet-row h-8 transition-colors last:border-b-0 hover:bg-gray-100">
                    {selectable && (
                      <td className="px-3">
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
                        <td key={name} className="px-3 font-mono text-[13px] text-gray-900">
                          {state === 'filled' ? (
                            <span className="block max-w-[300px] truncate" title={formatValue(row[name])}>
                              {formatValue(row[name])}
                            </span>
                          ) : state === 'absent' ? (
                            <span className="italic text-gray-600">not on page</span>
                          ) : (
                            <span className="text-gray-400">—</span>
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
        <p className="mt-2 text-xs text-gray-600">Showing 100 of {data.length} rows.</p>
      )}
    </div>
  );
}
