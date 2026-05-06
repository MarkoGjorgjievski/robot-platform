'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Search, Check, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  example_value?: string;
  source?: 'api' | 'json-ld' | 'meta' | 'page';
  api_path?: string;
  enabled: boolean;
  tier?: 'requested' | 'discovered';
};

type TieredResult = {
  name: string;
  type: string;
  value: unknown;
  status: 'found' | 'not_found';
  source: string | null;
};

type ExtractionRun = {
  url: string;
  confidence: number;
  data: Record<string, unknown>;
  sources: Record<string, string>;
  timestamp: Date;
};

type Step = 'url' | 'schema' | 'preview';

const steps: { key: Step; label: string }[] = [
  { key: 'url', label: 'URL' },
  { key: 'schema', label: 'Fields' },
  { key: 'preview', label: 'Results' },
];

export function ExtractionWizard() {
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userFieldsInput, setUserFieldsInput] = useState('');
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [pageType, setPageType] = useState('');

  const [extractedData, setExtractedData] = useState<Record<string, unknown>[]>([]);
  const [requestedResults, setRequestedResults] = useState<TieredResult[]>([]);
  const [discoveredResults, setDiscoveredResults] = useState<TieredResult[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [qualityIssues, setQualityIssues] = useState<Array<{ field: string; row?: number; type: 'warning' | 'error'; message: string; autoFixed?: boolean }>>([]);

  const [runs, setRuns] = useState<ExtractionRun[]>([]);

  const [isCached, setIsCached] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ totalRuns: number; successRate: number } | null>(null);

  const currentIdx = steps.findIndex(s => s.key === step);

  async function handleAnalyze() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/scraper/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          requestedFields: userFieldsInput.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Analysis failed');
      }

      const data = await res.json();

      // Debug: log Step 2 (analyze) response
      console.log('[Step 2 - Analyze Response]', JSON.stringify(data, null, 2));

      setCaptureId(data.captureId);
      setPageType(data.schema.page_type);
      setIsCached(data.cached ?? false);
      setCacheStats(data.cacheStats ?? null);
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
          fields: enabledFields.map(f => ({ name: f.name, type: f.type, description: f.description, tier: f.tier, source: f.source, api_path: f.api_path })),
          captureId,
          pageType,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Extraction failed');
      }

      const data = await res.json();

      // Debug: log Step 3 (extract) response
      console.log('[Step 3 - Extract Response]', JSON.stringify(data, null, 2));

      setExtractedData(data.data ?? []);
      setConfidence(data.confidence ?? null);
      setQualityIssues(data.qualityIssues ?? []);
      setRequestedResults(data.fieldsByTier?.requested ?? []);
      setDiscoveredResults(data.fieldsByTier?.discovered ?? []);

      // Accumulate run data for the table
      const runData: Record<string, unknown> = {};
      for (const r of [...(data.fieldsByTier?.requested ?? []), ...(data.fieldsByTier?.discovered ?? [])]) {
        runData[r.name] = r.value;
      }
      setRuns(prev => [...prev, {
        url: url.trim(),
        confidence: data.confidence ?? 0,
        data: runData,
        sources: data.sources ?? {},
        timestamp: new Date(),
      }]);

      setStep('preview');

      // Auto-save extraction
      try {
        await fetch('/api/scraper/save-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url.trim(),
            extractedData: data.data ?? [],
            fields: enabledFields.map(f => ({ name: f.name, type: f.type, description: f.description, tier: f.tier })),
            confidence: data.confidence ?? null,
            sources: data.sources ?? {},
          }),
        });
      } catch (err) {
        console.error('Auto-save failed (non-fatal):', err);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Extract Data</h1>

      {/* Step Indicator */}
      <div className="mt-6 flex items-center">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < currentIdx
                    ? 'bg-primary text-primary-foreground'
                    : i === currentIdx
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {i < currentIdx ? <Check className="size-3.5" /> : i + 1}
              </div>
              <span className={`text-xs font-medium ${i <= currentIdx ? 'text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-px w-8 ${i < currentIdx ? 'bg-primary' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <Card className="mt-6 border-[var(--status-error-border)] bg-[var(--status-error-bg)]">
          <CardContent className="flex items-start gap-2 p-3 text-sm text-[var(--status-error-fg)]">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* Step 1: URL */}
      {step === 'url' && (
        <div className="mt-16 flex flex-col items-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
            <Sparkles className="size-7 text-muted-foreground" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Enter a URL to analyze</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Our AI will capture the page and discover extractable data fields.
          </p>

          <div className="mt-8 flex w-full max-w-xl gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !userFieldsInput.trim() && handleAnalyze()}
              placeholder="https://example.com/products"
              className="h-11 flex-1"
              disabled={loading}
            />
            <Button
              onClick={handleAnalyze}
              disabled={loading || !url.trim()}
              className="h-11 gap-2"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Analyze
            </Button>
          </div>

          <div className="mt-4 w-full max-w-xl">
            <Label className="text-xs text-muted-foreground">
              Fields you need{' '}
              <span className="opacity-60">(optional — one per line or comma-separated)</span>
            </Label>
            <textarea
              value={userFieldsInput}
              onChange={(e) => setUserFieldsInput(e.target.value)}
              placeholder={"price\ntitle\nrating\navailability"}
              rows={4}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none font-mono"
              disabled={loading}
            />
          </div>

          {loading && (
            <div className="mt-8">
              <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                <Loader2 className="size-3 animate-spin" />
                Capturing page and analyzing structure...
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Schema */}
      {step === 'schema' && (
        <div className="mt-8">
          <div className="mb-4 flex items-center gap-3">
            <p data-slot="mono" className="text-xs text-muted-foreground truncate">{url}</p>
            <Badge variant="secondary" className="text-[10px] uppercase shrink-0">{pageType}</Badge>
            {isCached && cacheStats && (
              <Badge className="bg-emerald-100 text-emerald-700 text-[10px] shrink-0">
                Cached — {cacheStats.totalRuns} runs, {cacheStats.successRate}% reliability
              </Badge>
            )}
          </div>

          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                {/* Row 1: Checkbox + field names */}
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-background w-10">
                    <input
                      type="checkbox"
                      checked={fields.every(f => f.enabled)}
                      onChange={() => {
                        const allEnabled = fields.every(f => f.enabled);
                        setFields(fields.map(f => ({ ...f, enabled: !allEnabled })));
                      }}
                      className="size-4 rounded border-input accent-primary"
                    />
                  </TableHead>
                  {fields.map(field => (
                    <TableHead key={field.name} className="min-w-35">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={() => {
                            const i = fields.indexOf(field);
                            const next = [...fields];
                            next[i] = { ...next[i], enabled: !next[i].enabled };
                            setFields(next);
                          }}
                          className="size-3.5 rounded border-input accent-primary"
                        />
                        <span data-slot="mono" className="text-xs font-semibold">{field.name}</span>
                        <Badge variant="secondary" className="text-[9px]">{field.type}</Badge>
                      </label>
                    </TableHead>
                  ))}
                </TableRow>
                {/* Row 2: Descriptions */}
                {fields.some(f => f.description) && (
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-background" />
                    {fields.map(field => (
                      <TableHead key={field.name} className="font-normal">
                        <span className="text-[11px] text-muted-foreground">{field.description ?? ''}</span>
                      </TableHead>
                    ))}
                  </TableRow>
                )}
              </TableHeader>
              {/* Row 3: Example values */}
              {fields.some(f => f.example_value) && (
                <TableBody>
                  <TableRow>
                    <TableCell className="sticky left-0 z-10 bg-background">
                      <span className="text-[11px] text-muted-foreground">Example</span>
                    </TableCell>
                    {fields.map(field => (
                      <TableCell key={field.name}>
                        {field.example_value ? (
                          <span data-slot="mono" className="text-[11px] text-muted-foreground truncate block max-w-50" title={String(field.example_value)}>
                            {String(field.example_value)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              )}
            </Table>
          </Card>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {fields.filter(f => f.enabled).length} of {fields.length} fields selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep('url')}>
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleExtract}
                disabled={loading || fields.filter(f => f.enabled).length === 0}
                className="gap-1.5"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                Extract Data
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && (() => {
        // Collect all unique field names across all runs (preserves insertion order)
        const allFieldNames: string[] = [];
        const fieldMeta: Record<string, { type: string; description?: string }> = {};
        for (const f of fields.filter(f => f.enabled)) {
          if (!allFieldNames.includes(f.name)) {
            allFieldNames.push(f.name);
            fieldMeta[f.name] = { type: f.type, description: f.description };
          }
        }
        // Also include any fields from older runs that may have been toggled off since
        for (const run of runs) {
          for (const name of Object.keys(run.data)) {
            if (!allFieldNames.includes(name)) {
              allFieldNames.push(name);
              fieldMeta[name] = fieldMeta[name] ?? { type: 'string' };
            }
          }
        }

        return (
          <div className="mt-8">
            {confidence !== null && (
              <div className="mb-4 flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">Confidence</span>
                <div className="h-2 flex-1 max-w-xs rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.round(confidence * 100)}%`,
                      backgroundColor: confidence > 0.8 ? 'var(--status-ready-fg)' : confidence > 0.5 ? 'var(--status-running-fg)' : 'var(--status-error-fg)',
                    }}
                  />
                </div>
                <span data-slot="mono" className="text-xs text-muted-foreground">
                  {Math.round(confidence * 100)}%
                </span>
              </div>
            )}

            {qualityIssues.length > 0 && (
              <Card className="mb-4 divide-y">
                {qualityIssues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 px-4 py-2">
                    <Badge
                      className={`mt-0.5 text-[10px] shrink-0 ${
                        issue.type === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {issue.type}
                    </Badge>
                    <div className="min-w-0">
                      <span data-slot="mono" className="text-xs font-medium">{issue.field}</span>
                      <span className="text-xs text-muted-foreground ml-2">{issue.message}</span>
                      {issue.autoFixed && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">auto-fixed</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {/* Results table — fields as columns, runs as rows */}
            {runs.length > 0 ? (
              <Card className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {/* Row 1: Field names */}
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-background min-w-[80px]" />
                      {allFieldNames.map(name => (
                        <TableHead key={name} className="min-w-35">
                          <div className="flex items-center gap-1.5">
                            <span data-slot="mono" className="text-xs font-semibold">{name}</span>
                            <Badge variant="secondary" className="text-[9px]">{fieldMeta[name]?.type ?? 'string'}</Badge>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                    {/* Row 2: Descriptions */}
                    {allFieldNames.some(n => fieldMeta[n]?.description) && (
                      <TableRow>
                        <TableHead className="sticky left-0 z-10 bg-background" />
                        {allFieldNames.map(name => (
                          <TableHead key={name} className="font-normal">
                            <span className="text-[11px] text-muted-foreground">
                              {fieldMeta[name]?.description ?? ''}
                            </span>
                          </TableHead>
                        ))}
                      </TableRow>
                    )}
                  </TableHeader>
                  <TableBody>
                    {runs.map((run, i) => {
                      const domain = (() => { try { return new URL(run.url).hostname.replace(/^www\./, ''); } catch { return run.url; } })();
                      return (
                        <TableRow key={i}>
                          <TableCell className="sticky left-0 z-10 bg-background">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                                Run {i + 1}
                              </span>
                              <span className="text-[10px] text-muted-foreground/60 truncate max-w-[100px]" title={run.url}>
                                {domain}
                              </span>
                            </div>
                          </TableCell>
                          {allFieldNames.map(name => {
                            const value = run.data[name];
                            const source = run.sources[name];
                            return (
                              <TableCell key={name} className="align-top">
                                {value != null ? (
                                  <div className="flex flex-col gap-0.5">
                                    <span data-slot="mono" className="text-xs max-w-50 truncate block" title={String(value)}>
                                      {String(value)}
                                    </span>
                                    {source && (
                                      <Badge variant="outline" className="text-[9px] w-fit">{source}</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/30 text-xs">—</span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <Card className="border-dashed p-12 text-center">
                <p className="text-sm text-muted-foreground">No data extracted.</p>
              </Card>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep('schema')}>
                <ArrowLeft className="size-3.5" />
                Adjust Fields
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('url')}
                className="gap-1.5"
              >
                <ArrowRight className="size-3.5" />
                Extract Another URL
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setStep('url');
                  setUrl('');
                  setUserFieldsInput('');
                  setFields([]);
                  setExtractedData([]);
                  setRequestedResults([]);
                  setDiscoveredResults([]);
                  setRuns([]);
                  setConfidence(null);
                  setError(null);
                }}
                className="gap-1.5"
              >
                <Sparkles className="size-3.5" />
                New Extraction
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
