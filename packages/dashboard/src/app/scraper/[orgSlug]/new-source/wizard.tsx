'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Search, Check, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  example_value?: string;
  enabled: boolean;
};

type ExistingSchema = {
  id: string;
  name: string;
  fields: Array<{ name: string; type: string }>;
};

type Props = {
  orgSlug: string;
  orgName: string;
  existingSchemas: ExistingSchema[];
};

type Step = 'url' | 'schema' | 'preview' | 'save';

export function NewSourceWizard({ orgSlug, orgName, existingSchemas }: Props) {
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analysis results
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [pageType, setPageType] = useState('');
  const [pageDescription, setPageDescription] = useState('');

  // Extraction results
  const [extractedData, setExtractedData] = useState<Record<string, unknown>[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);

  // Save
  const [sourceName, setSourceName] = useState('');

  const steps: { key: Step; label: string; num: number }[] = [
    { key: 'url', label: 'Enter URL', num: 1 },
    { key: 'schema', label: 'Review Schema', num: 2 },
    { key: 'preview', label: 'Preview Data', num: 3 },
    { key: 'save', label: 'Save', num: 4 },
  ];

  const currentIdx = steps.findIndex(s => s.key === step);

  async function handleAnalyze() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/scraper/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Analysis failed');
      }

      const data = await res.json();
      setScreenshotUrl(data.screenshotUrl);
      setPageType(data.schema.page_type);
      setPageDescription(data.schema.description);
      setFields(
        data.schema.fields.map((f: Omit<SchemaField, 'enabled'>) => ({
          ...f,
          enabled: true,
        }))
      );
      setStep('schema');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleExtract() {
    setLoading(true);
    setError(null);

    try {
      const enabledFields = fields.filter(f => f.enabled);
      const res = await fetch('/api/scraper/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          fields: enabledFields.map(f => ({ name: f.name, type: f.type })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Extraction failed');
      }

      const data = await res.json();
      setExtractedData(data.data ?? []);
      setConfidence(data.confidence ?? null);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleUseExistingSchema(schema: ExistingSchema) {
    setFields(
      schema.fields.map(f => ({
        name: f.name,
        type: f.type,
        enabled: true,
      }))
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Breadcrumb */}
      <Link
        href={`/scraper/${orgSlug}`}
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        <ArrowLeft className="size-3" />
        {orgName}
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
        New Source
      </h1>

      {/* Step Indicator */}
      <div className="mt-6 flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < currentIdx
                    ? 'bg-slate-900 text-white'
                    : i === currentIdx
                    ? 'bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-2'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {i < currentIdx ? <Check className="size-3.5" /> : s.num}
              </div>
              <span
                className={`text-xs font-medium ${
                  i <= currentIdx ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-3 h-px w-8 ${
                  i < currentIdx ? 'bg-slate-900' : 'bg-slate-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Step 1: URL Input */}
      {step === 'url' && (
        <div className="mt-12 flex flex-col items-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-slate-100">
            <Sparkles className="size-7 text-slate-400" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            Enter a URL to analyze
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Our AI will capture the page and discover extractable data fields.
          </p>

          <div className="mt-8 flex w-full max-w-xl gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
              placeholder="https://example.com/products"
              className="h-11 flex-1 rounded-lg border border-slate-200 px-4 text-sm shadow-sm"
              disabled={loading}
            />
            <Button
              onClick={handleAnalyze}
              disabled={loading || !url.trim()}
              className="h-11 gap-2 bg-slate-900 text-white hover:bg-slate-800"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Analyze
            </Button>
          </div>

          {loading && (
            <div className="mt-8 text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs text-slate-600">
                <Loader2 className="size-3 animate-spin" />
                Capturing page and analyzing structure...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Schema Review */}
      {step === 'schema' && (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: Screenshot */}
          <div>
            {screenshotUrl ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                <img
                  src={screenshotUrl}
                  alt="Page screenshot"
                  className="w-full"
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
                <p className="text-sm text-slate-400">No screenshot available</p>
              </div>
            )}
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <p className="font-mono text-xs text-slate-500 truncate">{url}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 uppercase">
                  {pageType}
                </span>
                <span className="text-xs text-slate-500">{pageDescription}</span>
              </div>
            </div>
          </div>

          {/* Right: Fields */}
          <div>
            {/* Use existing schema */}
            {existingSchemas.length > 0 && (
              <div className="mb-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Use existing schema
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {existingSchemas.map((schema) => (
                    <button
                      key={schema.id}
                      onClick={() => handleUseExistingSchema(schema)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900"
                    >
                      {schema.name}
                      <span className="ml-1 text-slate-400">({schema.fields.length})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Discovered Fields
            </label>
            <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {fields.map((field, i) => (
                <label
                  key={field.name}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={() => {
                      const next = [...fields];
                      next[i] = { ...next[i], enabled: !next[i].enabled };
                      setFields(next);
                    }}
                    className="mt-0.5 size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-slate-900">
                        {field.name}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {field.type}
                      </span>
                      {field.required && (
                        <span className="text-[10px] text-red-400">required</span>
                      )}
                    </div>
                    {field.description && (
                      <p className="mt-0.5 text-xs text-slate-400">{field.description}</p>
                    )}
                    {field.example_value && (
                      <p className="mt-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500">
                        {String(field.example_value)}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('url')}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleExtract}
                disabled={loading || fields.filter(f => f.enabled).length === 0}
                className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="size-3.5" />
                )}
                Extract Data
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Data Preview */}
      {step === 'preview' && (
        <div className="mt-8">
          {confidence !== null && (
            <div className="mb-4 flex items-center gap-3">
              <span className="text-xs font-medium text-slate-500">Confidence</span>
              <div className="h-2 flex-1 max-w-xs rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full transition-all ${
                    confidence > 0.8
                      ? 'bg-emerald-500'
                      : confidence > 0.5
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.round(confidence * 100)}%` }}
                />
              </div>
              <span className="font-mono text-xs text-slate-600">
                {Math.round(confidence * 100)}%
              </span>
            </div>
          )}

          {extractedData.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        #
                      </th>
                      {fields
                        .filter(f => f.enabled)
                        .map(f => (
                          <th
                            key={f.name}
                            className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
                          >
                            {f.name}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {extractedData.slice(0, 20).map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-50 transition-colors hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">
                          {i + 1}
                        </td>
                        {fields
                          .filter(f => f.enabled)
                          .map(f => (
                            <td
                              key={f.name}
                              className="max-w-[200px] truncate px-3 py-2 font-mono text-xs text-slate-700"
                            >
                              {row[f.name] != null ? String(row[f.name]) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {extractedData.length > 20 && (
                <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Showing 20 of {extractedData.length} rows
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
              <p className="text-sm text-slate-500">No data extracted.</p>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep('schema')}
            >
              <ArrowLeft className="size-3.5" />
              Adjust Schema
            </Button>
            <Button
              size="sm"
              onClick={() => setStep('save')}
              disabled={extractedData.length === 0}
              className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
            >
              <ArrowRight className="size-3.5" />
              Save Source
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Save */}
      {step === 'save' && (
        <div className="mt-12 flex flex-col items-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-emerald-50">
            <Check className="size-7 text-emerald-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            Save this source
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {extractedData.length} rows extracted with {fields.filter(f => f.enabled).length} fields
          </p>

          <div className="mt-8 w-full max-w-md space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Source Name
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. Amazon Product Listings"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm shadow-sm"
              />
            </div>

            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">
                <p><span className="font-medium text-slate-700">URL:</span> {url}</p>
                <p className="mt-1"><span className="font-medium text-slate-700">Type:</span> {pageType}</p>
                <p className="mt-1">
                  <span className="font-medium text-slate-700">Fields:</span>{' '}
                  {fields.filter(f => f.enabled).map(f => f.name).join(', ')}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('preview')}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                size="sm"
                disabled={!sourceName.trim()}
                className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                onClick={() => {
                  // TODO: Save via API
                  window.location.href = `/scraper/${orgSlug}`;
                }}
              >
                <Check className="size-3.5" />
                Save Source
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
