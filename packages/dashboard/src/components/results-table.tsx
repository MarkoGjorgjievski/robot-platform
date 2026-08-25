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
  const fieldNames = fields.filter((f) => f.enabled !== false).map((f) => f.name);
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3 text-sm">
        {headerVariant === 'celebrate' ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="font-medium">Extraction complete</span>
          </>
        ) : (
          <span className="font-medium">Extraction results</span>
        )}
        {confidence != null && (
          <span className="text-xs text-gray-600">Confidence: {confidence}%</span>
        )}
      </div>
      {data.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-gray-500">
          No rows extracted.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                {fieldNames.map((name) => (
                  <th key={name} className="py-2 pr-4 text-left font-mono text-xs font-medium text-gray-600">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  {fieldNames.map((name) => (
                    <td key={name} className="py-2 pr-4 align-top font-mono text-xs">
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
          {data.length > 100 && (
            <p className="mt-2 text-xs text-gray-500">Showing 100 of {data.length} rows</p>
          )}
        </div>
      )}
    </div>
  );
}
