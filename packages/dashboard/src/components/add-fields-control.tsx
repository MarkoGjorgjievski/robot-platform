import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { parseAddFields } from '../lib/add-fields';

/**
 * The add-fields control (Task 11 brief): a mono textarea parsed live via
 * `parseAddFields`, then TWO separate labeled actions — never chained
 * automatically (R6 philosophy, the funding freeze makes this
 * non-negotiable):
 *
 * 1. "Save requested fields" → `sources.requestFields`. Free — it only
 *    persists intent onto the Source (`sources.requestedFields`).
 * 2. "Re-analyze with N requested fields (may use AI for a new domain)" —
 *    appears only AFTER a successful save, fires the existing
 *    `sources.analyze` mutation. This is the costed click.
 *
 * Shared between the Set-up page (under FieldsTable) and the confirm gate's
 * "Request more fields" reveal (source-run-detail.tsx) — `onAnalyzed` is how
 * the gate navigates back to Set-up after firing; Set-up itself passes
 * nothing, since it's already the page the new schema appears on.
 */
export function AddFieldsControl({ sourceId, onAnalyzed }: { sourceId: string; onAnalyzed?: () => void }) {
  const [text, setText] = useState('');
  const utils = trpc.useUtils();

  const parsed = useMemo(() => parseAddFields(text), [text]);

  const requestFieldsMutation = trpc.sources.requestFields.useMutation({
    onSuccess: () => utils.sources.listByProject.invalidate(),
  });
  const analyzeMutation = trpc.sources.analyze.useMutation({
    onSuccess: () => {
      utils.sources.listByProject.invalidate();
      onAnalyzed?.();
    },
  });

  const requestedCount = requestFieldsMutation.data?.requestedFields.length ?? null;

  return (
    <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
      <label className="micro-label">Add fields</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="isbn: near the publisher line"
        rows={4}
        className="mt-1.5 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
      />

      {parsed.rejected.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          {parsed.rejected.length} line{parsed.rejected.length === 1 ? '' : 's'} skipped:{' '}
          {parsed.rejected.join('; ')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => requestFieldsMutation.mutate({ sourceId, fields: parsed.fields })}
          disabled={requestFieldsMutation.isPending || parsed.fields.length === 0}
          className="btn-quiet"
        >
          {requestFieldsMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save requested fields
        </button>

        {requestedCount !== null && (
          <button
            onClick={() => analyzeMutation.mutate({ sourceId })}
            disabled={analyzeMutation.isPending}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {analyzeMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Re-analyze with {requestedCount} requested field{requestedCount === 1 ? '' : 's'} (may use AI for a new domain)
          </button>
        )}
      </div>

      {requestFieldsMutation.isError && (
        <p className="mt-2 text-xs text-red-600">{requestFieldsMutation.error.message}</p>
      )}
      {analyzeMutation.isError && (
        <p className="mt-2 text-xs text-red-600">{analyzeMutation.error.message}</p>
      )}
    </div>
  );
}
