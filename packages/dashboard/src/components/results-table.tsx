import { CheckCircle2 } from 'lucide-react';
import { formatValue } from '../lib/format';

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

export function ResultsTable({
  data,
  confidence,
  fields,
  headerVariant = 'neutral',
}: {
  data: Record<string, unknown>[];
  confidence: number | null;
  fields: SchemaField[];
  headerVariant?: 'neutral' | 'celebrate';
}) {
  const visibleFields = fields.filter((f) => f.enabled !== false);
  const fieldNames = visibleFields.map((f) => f.name);
  const candidateByName = new Map(visibleFields.map((f) => [f.name, f.candidate]));
  return (
    <div className="mt-8">
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
      {data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-500">
          No rows extracted.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                {fieldNames.map((name) => {
                  const candidate = candidateByName.get(name);
                  const title = candidate ? `${name} · ${candidate.label}` : name;
                  return (
                    <th key={name} title={title} className="px-3 py-2 text-left font-mono text-[11px] font-medium text-gray-500">
                      {name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/60">
                  {fieldNames.map((name) => (
                    <td key={name} className="px-3 py-2 align-top font-mono text-xs text-gray-800">
                      {row[name] != null ? (
                        <span className="block max-w-[300px] truncate" title={formatValue(row[name])}>
                          {formatValue(row[name])}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
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
