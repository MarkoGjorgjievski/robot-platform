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
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [pageType, setPageType] = useState('');
  const [pageDescription, setPageDescription] = useState('');

  const [extractedData, setExtractedData] = useState<Record<string, unknown>[]>([]);
  const [requestedResults, setRequestedResults] = useState<TieredResult[]>([]);
  const [discoveredResults, setDiscoveredResults] = useState<TieredResult[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [qualityIssues, setQualityIssues] = useState<Array<{ field: string; row?: number; type: 'warning' | 'error'; message: string; autoFixed?: boolean }>>([]);

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
      setCaptureId(data.captureId);
      setScreenshotUrl(data.screenshotUrl);
      setPageType(data.schema.page_type);
      setPageDescription(data.schema.description);
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
          fields: enabledFields.map(f => ({ name: f.name, type: f.type, description: f.description, tier: f.tier })),
          captureId,
          pageType,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Extraction failed');
      }

      const data = await res.json();
      setExtractedData(data.data ?? []);
      setConfidence(data.confidence ?? null);
      setQualityIssues(data.qualityIssues ?? []);
      setRequestedResults(data.fieldsByTier?.requested ?? []);
      setDiscoveredResults(data.fieldsByTier?.discovered ?? []);
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
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: Screenshot */}
          <div>
            {screenshotUrl ? (
              <Card className="overflow-hidden">
                <img src={screenshotUrl} alt="Page screenshot" className="w-full" />
              </Card>
            ) : (
              <Card className="flex aspect-video items-center justify-center border-dashed">
                <p className="text-sm text-muted-foreground">No screenshot available</p>
              </Card>
            )}
            <div className="mt-3 rounded-lg bg-muted p-3">
              <p data-slot="mono" className="text-xs text-muted-foreground truncate">{url}</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">{pageType}</Badge>
                <span className="text-xs text-muted-foreground">{pageDescription}</span>
              </div>
              {isCached && cacheStats && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Instant</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    Pre-analyzed domain — {cacheStats.successRate}% reliability
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Fields */}
          <div>
            {isCached && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-medium text-emerald-800">We know this website</p>
                <p className="mt-0.5 text-xs text-emerald-600">
                  These fields were discovered from {cacheStats?.totalRuns ?? 0} previous extractions. Select the ones you need.
                </p>
              </div>
            )}

            {/* Requested fields tier */}
            {fields.some(f => f.tier === 'requested') && (
              <div className="mb-4">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Your Requested Fields
                </Label>
                <Card className="mt-2 divide-y">
                  {fields.filter(f => f.tier === 'requested').map((field, _i) => {
                    const i = fields.indexOf(field);
                    return (
                      <label
                        key={field.name}
                        className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={() => {
                            const next = [...fields];
                            next[i] = { ...next[i], enabled: !next[i].enabled };
                            setFields(next);
                          }}
                          className="mt-1 size-4 rounded border-input accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
                            <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
                          </div>
                          {field.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
                          )}
                          {field.example_value && (
                            <p data-slot="mono" className="mt-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                              {String(field.example_value)}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </Card>
              </div>
            )}

            {/* Discovered fields tier */}
            {fields.some(f => f.tier !== 'requested') && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {fields.some(f => f.tier === 'requested') ? 'Also Discovered' : (isCached ? 'Available Fields' : 'Discovered Fields')}
                </Label>
                <Card className="mt-2 divide-y">
                  {fields.filter(f => f.tier !== 'requested').map((field, _i) => {
                    const i = fields.indexOf(field);
                    return (
                      <label
                        key={field.name}
                        className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={() => {
                            const next = [...fields];
                            next[i] = { ...next[i], enabled: !next[i].enabled };
                            setFields(next);
                          }}
                          className="mt-1 size-4 rounded border-input accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
                            <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
                          </div>
                          {field.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
                          )}
                          {field.example_value && (
                            <p data-slot="mono" className="mt-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                              {String(field.example_value)}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </Card>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
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
      {step === 'preview' && (
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

          {/* Requested fields tier */}
          {requestedResults.length > 0 && (
            <div className="mb-6">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your Requested Fields
              </Label>
              <Card className="mt-2 divide-y">
                {requestedResults.map((result) => (
                  <div key={result.name} className="flex items-center gap-3 px-4 py-3">
                    <div className="shrink-0">
                      {result.status === 'found' ? (
                        <div className="flex size-5 items-center justify-center rounded-full bg-emerald-100">
                          <Check className="size-3 text-emerald-600" />
                        </div>
                      ) : (
                        <div className="flex size-5 items-center justify-center rounded-full bg-muted">
                          <span className="text-[10px] text-muted-foreground">—</span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span data-slot="mono" className="text-sm font-medium">{result.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{result.type}</Badge>
                        {result.source && (
                          <Badge variant="outline" className="text-[10px]">{result.source}</Badge>
                        )}
                      </div>
                      {result.value != null ? (
                        <p data-slot="mono" className="mt-0.5 truncate text-xs text-muted-foreground">
                          {String(result.value)}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground/50">Not found</p>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* Discovered fields / full data table */}
          {discoveredResults.length > 0 && (
            <div className="mb-6">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {requestedResults.length > 0 ? 'Also Discovered' : 'Extracted Fields'}
              </Label>
              <Card className="mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoveredResults.map((result) => (
                      <TableRow key={result.name}>
                        <TableCell data-slot="mono" className="font-medium text-xs">{result.name}</TableCell>
                        <TableCell data-slot="mono" className="max-w-[300px] truncate text-xs text-muted-foreground">
                          {result.value != null ? String(result.value) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell>
                          {result.source && (
                            <Badge variant="outline" className="text-[10px]">{result.source}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* Fallback: full data table when no tier info */}
          {requestedResults.length === 0 && discoveredResults.length === 0 && extractedData.length > 0 && (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    {fields.filter(f => f.enabled).map(f => (
                      <TableHead key={f.name}>{f.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extractedData.slice(0, 20).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell data-slot="mono" className="text-muted-foreground">{i + 1}</TableCell>
                      {fields.filter(f => f.enabled).map(f => (
                        <TableCell key={f.name} data-slot="mono" className="max-w-[200px] truncate text-xs">
                          {row[f.name] != null ? String(row[f.name]) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {extractedData.length > 20 && (
                <div className="border-t p-3 text-xs text-muted-foreground">
                  Showing 20 of {extractedData.length} rows
                </div>
              )}
            </Card>
          )}

          {requestedResults.length === 0 && discoveredResults.length === 0 && extractedData.length === 0 && (
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
              size="sm"
              onClick={() => {
                setStep('url');
                setUrl('');
                setUserFieldsInput('');
                setFields([]);
                setExtractedData([]);
                setRequestedResults([]);
                setDiscoveredResults([]);
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
      )}
    </div>
  );
}
