'use client';

import { useState } from 'react';
import { Plus, Loader2, RefreshCw, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';

type StepStatus = 'pending' | 'running' | 'done' | 'error';

type PreTrainStep = {
  label: string;
  status: StepStatus;
  detail?: string;
};

export function DomainActions() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [pageType, setPageType] = useState('auto');
  const [runExtraction, setRunExtraction] = useState(true);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<PreTrainStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  function updateStep(index: number, update: Partial<PreTrainStep>) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...update } : s));
  }

  async function handleStart() {
    if (!url.trim()) return;
    setRunning(true);
    setError(null);

    const initialSteps: PreTrainStep[] = [
      { label: 'Capturing page', status: 'pending' },
      { label: 'Analyzing structure', status: 'pending' },
      ...(runExtraction ? [
        { label: 'Extracting data', status: 'pending' as StepStatus },
        { label: 'Saving to cache', status: 'pending' as StepStatus },
      ] : [
        { label: 'Saving to cache', status: 'pending' as StepStatus },
      ]),
    ];
    setSteps(initialSteps);

    try {
      // Step 1: Analyze (captures page + discovers schema)
      updateStep(0, { status: 'running' });
      const analyzeRes = await fetch('/api/scraper/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!analyzeRes.ok) {
        const data = await analyzeRes.json();
        throw new Error(data.error ?? 'Analysis failed');
      }

      const analyzeData = await analyzeRes.json();
      updateStep(0, { status: 'done', detail: `${analyzeData.schema?.fields?.length ?? 0} fields found` });
      updateStep(1, { status: 'done', detail: `${analyzeData.schema?.page_type ?? 'unknown'} page` });

      if (analyzeData.cached) {
        // Already cached — skip extraction
        updateStep(0, { status: 'done', detail: 'Already cached' });
        updateStep(1, { status: 'done', detail: `${analyzeData.schema?.fields?.length ?? 0} cached fields` });
        const lastStep = initialSteps.length - 1;
        updateStep(lastStep, { status: 'done', detail: 'Domain already in cache' });
        return;
      }

      // Step 2: Extract (if enabled)
      if (runExtraction && analyzeData.schema?.fields?.length > 0) {
        const extractIdx = 2;
        updateStep(extractIdx, { status: 'running' });

        const extractRes = await fetch('/api/scraper/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url.trim(),
            fields: analyzeData.schema.fields.map((f: { name: string; type: string; description?: string }) => ({
              name: f.name,
              type: f.type,
              description: f.description,
            })),
            pageType: pageType === 'auto' ? analyzeData.schema.page_type : pageType,
          }),
        });

        if (extractRes.ok) {
          const extractData = await extractRes.json();
          const confidence = extractData.confidence != null ? Math.round(extractData.confidence * 100) : 0;
          updateStep(extractIdx, {
            status: 'done',
            detail: `${extractData.fieldCount?.found ?? 0}/${extractData.fieldCount?.total ?? 0} fields, ${confidence}% confidence`,
          });
        } else {
          updateStep(extractIdx, { status: 'error', detail: 'Extraction failed' });
        }
      }

      // Final step
      const lastStep = initialSteps.length - 1;
      updateStep(lastStep, { status: 'done', detail: 'Domain cached' });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pre-training failed');
      // Mark current running step as error
      setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    if (!running) {
      setOpen(false);
      setUrl('');
      setSteps([]);
      setError(null);
      // Refresh if we completed successfully
      if (steps.some(s => s.status === 'done')) {
        window.location.reload();
      }
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => window.location.reload()}
        className="gap-1.5"
      >
        <RefreshCw className="size-3.5" />
        Refresh
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!running) setOpen(v); }}>
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            Pre-train Domain
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pre-train Domain</DialogTitle>
            <DialogDescription>
              Analyze a URL to cache the domain's structure for future extractions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* URL Input */}
            <div>
              <Label>URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://target.com/p/some-product"
                className="mt-1.5"
                disabled={running}
                onKeyDown={(e) => e.key === 'Enter' && !running && handleStart()}
              />
            </div>

            {/* Page Type */}
            <div>
              <Label>Page Type</Label>
              <div className="mt-1.5 flex gap-2">
                {[
                  { value: 'auto', label: 'Auto-detect' },
                  { value: 'detail', label: 'Product detail' },
                  { value: 'listing', label: 'Product listing' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => !running && setPageType(opt.value)}
                    disabled={running}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      pageType === opt.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'text-muted-foreground hover:border-primary hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="run-extraction"
                checked={runExtraction}
                onChange={(e) => setRunExtraction(e.target.checked)}
                disabled={running}
                className="size-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="run-extraction" className="text-xs text-muted-foreground">
                Run extraction after analysis (populates cache with paths)
              </label>
            </div>

            {/* Live Status */}
            {steps.length > 0 && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                {steps.map((step, i) => {
                  const Icon = step.status === 'done' ? CheckCircle2
                    : step.status === 'running' ? Loader2
                    : step.status === 'error' ? XCircle
                    : Circle;
                  const iconClass = step.status === 'done' ? 'text-emerald-500'
                    : step.status === 'running' ? 'text-primary animate-spin'
                    : step.status === 'error' ? 'text-red-500'
                    : 'text-muted-foreground/30';

                  return (
                    <div key={i} className="flex items-start gap-2">
                      <Icon className={`mt-0.5 size-3.5 shrink-0 ${iconClass}`} />
                      <div className="min-w-0 flex-1">
                        <span className={`text-xs ${step.status === 'pending' ? 'text-muted-foreground/50' : 'text-foreground'}`}>
                          {step.label}
                        </span>
                        {step.detail && (
                          <p className="text-[10px] text-muted-foreground">{step.detail}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <XCircle className="size-3.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleClose} disabled={running}>
                {steps.some(s => s.status === 'done') && !running ? 'Done' : 'Cancel'}
              </Button>
              {!steps.some(s => s.status === 'done') && (
                <Button
                  size="sm"
                  onClick={handleStart}
                  disabled={running || !url.trim()}
                  className="gap-1.5"
                >
                  {running ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  {running ? 'Training...' : 'Start'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
