import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Loader2, AlertCircle, ArrowRight, ArrowUpCircle } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { screenshotUrl } from '../lib/screenshot-url';
import { formatValue } from '../lib/format';
import { ResultsTable } from '../components/results-table';
import { GraduateForm } from '../components/graduate-form';

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

export default function SandboxDetail() {
  const { shortid: slug } = useParams({ from: '/sandbox/$shortid' });
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [graduateExpanded, setGraduateExpanded] = useState(false);

  // Load source state. Refetches on mutation success via invalidation.
  const sourceQuery = trpc.sandbox.get.useQuery({ slug });

  // Auto-fire analyze if no schema yet. Guard against StrictMode double-fire.
  const analyzeMutation = trpc.sandbox.analyze.useMutation({
    onSuccess: () => utils.sandbox.get.invalidate({ slug }),
    onError: (err) => setError(err.message),
  });
  const extractMutation = trpc.sandbox.extract.useMutation({
    onSuccess: () => utils.sandbox.get.invalidate({ slug }),
    onError: (err) => setError(err.message),
  });

  const analyzeStartedRef = useRef(false);
  useEffect(() => {
    if (!sourceQuery.data) return;
    const schema = sourceQuery.data.source.selectorsJson as { fields?: unknown[] } | null;
    const hasFields = schema && Array.isArray(schema.fields) && schema.fields.length > 0;
    if (!hasFields && !analyzeStartedRef.current && !analyzeMutation.isPending) {
      analyzeStartedRef.current = true;
      analyzeMutation.mutate({ slug });
    }
  }, [sourceQuery.data, slug, analyzeMutation]);

  // Local field-toggle state, seeded from the source's schema. Re-syncs when source updates.
  const [fields, setFields] = useState<SchemaField[]>([]);
  useEffect(() => {
    if (!sourceQuery.data) return;
    const schema = sourceQuery.data.source.selectorsJson as { fields?: SchemaField[] } | null;
    if (schema && Array.isArray(schema.fields)) {
      setFields(schema.fields.map((f) => ({ ...f, enabled: f.enabled !== false })));
    }
  }, [sourceQuery.data]);

  if (sourceQuery.isLoading) {
    return <Spinner label="Loading..." />;
  }
  if (sourceQuery.isError) {
    return <ErrorBanner message={sourceQuery.error.message} />;
  }
  if (!sourceQuery.data) {
    return <ErrorBanner message={`Sandbox source not found: ${slug}`} />;
  }

  const { source, latestRun, latestExtraction, latestCapture } = sourceQuery.data;
  const schema = source.selectorsJson as {
    fields?: SchemaField[];
    pageType?: string;
    screenshotUrl?: string;
    cached?: boolean;
    liveExamples?: boolean;
  } | null;
  const hasSchema = schema && Array.isArray(schema.fields) && schema.fields.length > 0;

  return (
    <div>
      <Header source={source} schema={schema} />

      {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

      {hasSchema && schema.cached && schema.liveExamples === false && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="micro-label text-amber-700">Page not captured</p>
          <p className="mt-0.5 text-sm text-amber-900">
            This page couldn't be loaded, so the schema, page type, and example values come from
            earlier runs on this domain — not from this URL. They may describe a different page
            entirely.{' '}
            <button
              className="font-medium text-accent-700 underline-offset-2 hover:underline"
              onClick={() => {
                analyzeStartedRef.current = true;
                setError(null);
                analyzeMutation.mutate({ slug });
              }}
            >
              Re-run analyze
            </button>
          </p>
        </div>
      )}

      {!hasSchema && analyzeMutation.isPending && (
        <Spinner label="Capturing page and discovering schema (~30-60s)..." />
      )}

      {!hasSchema && !analyzeMutation.isPending && (
        <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          No schema yet.{' '}
          <button
            className="font-medium text-accent-700 underline-offset-2 hover:underline"
            onClick={() => {
              analyzeStartedRef.current = true;
              setError(null);
              analyzeMutation.mutate({ slug });
            }}
          >
            Re-run analyze
          </button>
        </div>
      )}

      {hasSchema && (
        <SchemaEditor
          fields={fields}
          onToggle={(name) =>
            setFields((prev) => prev.map((f) => (f.name === name ? { ...f, enabled: f.enabled === false } : f)))
          }
          onToggleAll={(enabled) => setFields((prev) => prev.map((f) => ({ ...f, enabled })))}
          screenshotPath={schema.screenshotUrl ?? latestCapture?.screenshotPath ?? null}
        />
      )}

      {hasSchema && (
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-gray-600">
            {fields.filter((f) => f.enabled !== false).length} of {fields.length} fields selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGraduateExpanded(true)}
              disabled={graduateExpanded || extractMutation.isPending}
              className="btn-quiet flex h-9 items-center gap-2 px-4 text-sm disabled:opacity-50"
            >
              <ArrowUpCircle className="h-4 w-4" />
              Graduate
            </button>
            <button
              onClick={() => {
                setError(null);
                extractMutation.mutate({ slug, fields });
              }}
              disabled={extractMutation.isPending || fields.filter((f) => f.enabled !== false).length === 0}
              className="btn-primary h-9"
            >
              {extractMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {latestRun ? 'Re-extract' : 'Extract'}
            </button>
          </div>
        </div>
      )}

      {graduateExpanded && (
        <GraduateForm
          sandboxSlug={slug}
          defaultSourceName={source.name}
          onCancel={() => setGraduateExpanded(false)}
        />
      )}

      {extractMutation.isPending && (
        <Spinner label="Running extraction (~30-90s). Leave this tab open." />
      )}

      {latestRun?.status === 'failed' && (
        <ErrorBanner message={`Extraction failed: ${latestRun.errorMessage ?? 'unknown error'}`} />
      )}

      {latestRun?.status === 'completed' && latestExtraction && !extractMutation.isPending && (
        <ResultsTable
          data={Array.isArray(latestExtraction.data) ? (latestExtraction.data as Record<string, unknown>[]) : []}
          confidence={latestExtraction.confidence}
          fields={fields}
          headerVariant="celebrate"
        />
      )}
    </div>
  );
}

// ─── Sub-components (inline for v1) ─────────────────────────────────────────

function Header({
  source,
  schema,
}: {
  source: { name: string; urlTemplate: string | null };
  schema: { pageType?: string; cached?: boolean } | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{source.name}</h1>
      {schema?.pageType && (
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-gray-600">
          {schema.pageType}
        </span>
      )}
      {source.urlTemplate && (
        <a
          href={source.urlTemplate}
          target="_blank"
          rel="noopener"
          className="ml-auto truncate font-mono text-xs text-gray-500 hover:text-accent-700"
        >
          {source.urlTemplate}
        </a>
      )}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function ErrorBanner({ message, dismiss }: { message: string; dismiss?: () => void }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {dismiss && (
        <button onClick={dismiss} className="text-xs underline">
          dismiss
        </button>
      )}
    </div>
  );
}

function SchemaEditor({
  fields,
  onToggle,
  onToggleAll,
  screenshotPath,
}: {
  fields: SchemaField[];
  onToggle: (name: string) => void;
  onToggleAll: (enabled: boolean) => void;
  screenshotPath: string | null;
}) {
  const allEnabled = fields.every((f) => f.enabled !== false);
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="w-8 py-2">
                <input
                  type="checkbox"
                  checked={allEnabled}
                  onChange={() => onToggleAll(!allEnabled)}
                  className="h-4 w-4"
                />
              </th>
              <th className="micro-label py-2 text-left">Field</th>
              <th className="micro-label py-2 text-left">Type</th>
              <th className="micro-label py-2 text-left">Example</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.name} className="border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/60">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={field.enabled !== false}
                    onChange={() => onToggle(field.name)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="py-2 font-mono text-xs">{field.name}</td>
                <td className="py-2 text-xs text-gray-600">{field.type}</td>
                <td className="py-2 font-mono text-xs text-gray-500">
                  {field.example_value ? (
                    <span className="block max-w-[200px] truncate" title={formatValue(field.example_value)}>
                      {formatValue(field.example_value)}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {screenshotPath && (
        <div>
          <img
            src={screenshotUrl(screenshotPath) ?? ''}
            alt="Page screenshot"
            className="card w-full"
          />
        </div>
      )}
    </div>
  );
}

