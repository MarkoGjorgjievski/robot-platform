import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';

const statusColors: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await api.runs.getById({ id });

  if (!run) {
    notFound();
  }

  const logs = run.logs ? JSON.parse(run.logs) as Array<{ timestamp: string; level: string; message: string }> : [];
  const results = run.results as Record<string, unknown> | null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/extractors/${run.extractorId}`}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          &larr; Back to Extractor
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            Run {run.id.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {run.extractor.org.name} / {run.extractor.domain.name}
            {run.inputLabel ? ` — input: ${run.inputLabel}` : ''}
          </p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusColors[run.status] ?? statusColors.queued}`}>
          {run.status}
        </span>
      </div>

      {/* Timing */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="font-medium text-gray-500">Created</p>
            <p className="text-gray-900">{new Date(run.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="font-medium text-gray-500">Started</p>
            <p className="text-gray-900">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</p>
          </div>
          <div>
            <p className="font-medium text-gray-500">Completed</p>
            <p className="text-gray-900">{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</p>
          </div>
        </div>
      </section>

      {/* Error */}
      {run.errorMessage && (
        <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="mb-2 text-lg font-semibold text-red-900">Error</h2>
          <pre className="whitespace-pre-wrap text-sm text-red-800">{run.errorMessage}</pre>
        </section>
      )}

      {/* Results */}
      {results && (
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">Results</h2>
          <div className="text-sm text-gray-700">
            <p>Final URL: {results.finalUrl as string}</p>
            <p>Response Status: {results.responseStatus as number}</p>
            <p>HTML Length: {(results.htmlLength as number)?.toLocaleString()} chars</p>
          </div>
          {!!results.screenshotBase64 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium text-gray-500">Screenshot</h3>
              <img
                src={`data:image/png;base64,${results.screenshotBase64}`}
                alt="Page screenshot"
                className="max-h-96 rounded-lg border border-gray-200"
              />
            </div>
          )}
        </section>
      )}

      {/* Logs */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Logs ({logs.length})</h2>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-3 border-b border-gray-100 px-6 py-2 text-xs">
              <span className="shrink-0 text-gray-400">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 font-medium uppercase ${
                entry.level === 'error' ? 'text-red-600' :
                entry.level === 'warn' ? 'text-yellow-600' : 'text-gray-500'
              }`}>
                {entry.level}
              </span>
              <span className="text-gray-800">{entry.message}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-gray-500">No logs yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
