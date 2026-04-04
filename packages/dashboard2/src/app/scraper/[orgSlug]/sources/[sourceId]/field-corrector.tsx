'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowRight, Loader2, Check, AlertCircle, MousePointer, Type, Search, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type ClickedElement = {
  xpath: string;
  rawText: string;
  trimmedText: string;
  tag: string;
  attrs: Record<string, string>;
};

type FoundPaths = {
  xpath: { path: string; verified: boolean; rawText: string | null } | null;
  api: { path: string } | null;
  jsonLd: { path: string } | null;
  meta: { path: string } | null;
};

type CorrectionStep = 'value' | 'click' | 'confirm';

export function FieldCorrector({
  fieldName,
  fieldType,
  currentValue,
  url,
  onSave,
  onCancel,
}: {
  fieldName: string;
  fieldType: string;
  currentValue: string | null;
  url: string;
  onSave: (result: { xpath?: string; apiPath?: string; transform: string; desiredValue: string }) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<CorrectionStep>('value');
  const [desiredValue, setDesiredValue] = useState('');
  const [clickedElement, setClickedElement] = useState<ClickedElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [foundPaths, setFoundPaths] = useState<FoundPaths | null>(null);
  const [recommendedSource, setRecommendedSource] = useState<string | null>(null);
  const [transform, setTransform] = useState('trim');
  const [error, setError] = useState<string | null>(null);
  const [frameHtml, setFrameHtml] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === '__robot_element_selected') {
        setClickedElement({
          xpath: e.data.xpath,
          rawText: e.data.rawText,
          trimmedText: e.data.trimmedText,
          tag: e.data.tag,
          attrs: e.data.attrs ?? {},
        });
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Load the page frame when entering click step
  const loadFrame = useCallback(async () => {
    setLoadingFrame(true);
    try {
      const res = await fetch('/api/scraper/page-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const html = await res.text();
        setFrameHtml(html);
      }
    } catch {
      setError('Failed to load page preview');
    } finally {
      setLoadingFrame(false);
    }
  }, [url]);

  useEffect(() => {
    if (step === 'click' && !frameHtml) {
      loadFrame();
    }
  }, [step, frameHtml, loadFrame]);

  // Find the best extraction path
  async function findPath() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/scraper/find-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          fieldName,
          desiredValue,
          clickedElement,
        }),
      });

      if (!res.ok) throw new Error('Path search failed');

      const data = await res.json();
      setFoundPaths(data.paths);
      setRecommendedSource(data.recommendation);
      setTransform(data.transform);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    const result: { xpath?: string; apiPath?: string; transform: string; desiredValue: string } = {
      transform,
      desiredValue,
    };

    if (foundPaths?.xpath?.path) result.xpath = foundPaths.xpath.path;
    if (foundPaths?.api?.path) result.apiPath = foundPaths.api.path;

    // If no paths found but user clicked an element, use that XPath
    if (!result.xpath && !result.apiPath && clickedElement?.xpath) {
      result.xpath = clickedElement.xpath;
    }

    onSave(result);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold">Fix field: {fieldName}</h3>
            <p className="text-xs text-muted-foreground">
              {step === 'value' && 'Step 1 of 3 — What value do you expect?'}
              {step === 'click' && 'Step 2 of 3 — Click on the element'}
              {step === 'confirm' && 'Step 3 of 3 — Confirm extraction path'}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="size-8 p-0" onClick={onCancel}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="size-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Step 1: Enter desired value */}
          {step === 'value' && (
            <div className="space-y-4">
              {currentValue && (
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Current extracted value:</p>
                  <p data-slot="mono" className="mt-1 text-sm">{currentValue}</p>
                </div>
              )}

              <div>
                <Label>What should the correct value be?</Label>
                <Input
                  value={desiredValue}
                  onChange={(e) => setDesiredValue(e.target.value)}
                  placeholder={fieldType === 'price' ? '19.99' : fieldType === 'url' ? 'https://...' : 'Expected value'}
                  className="mt-1.5"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && desiredValue.trim() && setStep('click')}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Type the exact value you want extracted. We'll find the best way to get it from the page.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!desiredValue.trim()}
                  onClick={() => setStep('click')}
                  className="gap-1.5"
                >
                  Next
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Click on element */}
          {step === 'click' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                <MousePointer className="size-4 text-blue-600" />
                <span className="text-xs text-blue-700">
                  Click on the element that contains "{desiredValue}" on the page below
                </span>
              </div>

              {/* Page iframe */}
              <div className="relative rounded-lg border overflow-hidden" style={{ height: 400 }}>
                {loadingFrame ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                      <p className="mt-2 text-xs text-muted-foreground">Loading page...</p>
                    </div>
                  </div>
                ) : frameHtml ? (
                  <iframe
                    ref={iframeRef}
                    srcDoc={frameHtml}
                    className="h-full w-full"
                    sandbox="allow-scripts allow-same-origin"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-xs text-muted-foreground">Failed to load page</p>
                  </div>
                )}
              </div>

              {/* Show what was clicked */}
              {clickedElement && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-800">Element selected</p>
                  <div className="mt-1.5 space-y-1">
                    <p className="text-xs text-emerald-700">
                      <span className="font-medium">Text:</span> {clickedElement.trimmedText.slice(0, 100)}
                    </p>
                    <p data-slot="mono" className="text-[10px] text-emerald-600 truncate">
                      {clickedElement.xpath}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" size="sm" onClick={() => setStep('value')} className="gap-1.5">
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={findPath}
                    disabled={loading}
                    className="gap-1.5"
                  >
                    {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                    Skip click, just search
                  </Button>
                  <Button
                    size="sm"
                    disabled={!clickedElement || loading}
                    onClick={findPath}
                    className="gap-1.5"
                  >
                    {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                    Find path
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && foundPaths && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Desired value</span>
                  <span data-slot="mono" className="text-sm font-medium">{desiredValue}</span>
                </div>
                {clickedElement && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Element text</span>
                    <span data-slot="mono" className="text-xs">{clickedElement.trimmedText.slice(0, 60)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Transform</span>
                  <Badge variant="secondary" className="text-[10px]">{transform}</Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Found extraction paths</Label>

                {foundPaths.api && (
                  <div className={`flex items-start gap-2 rounded-lg border p-3 ${recommendedSource === 'api' ? 'border-emerald-300 bg-emerald-50' : ''}`}>
                    <Bot className="mt-0.5 size-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">API JSON path</span>
                        {recommendedSource === 'api' && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">recommended</Badge>}
                      </div>
                      <p data-slot="mono" className="mt-0.5 truncate text-[10px] text-muted-foreground">{foundPaths.api.path}</p>
                    </div>
                  </div>
                )}

                {foundPaths.xpath && (
                  <div className={`flex items-start gap-2 rounded-lg border p-3 ${recommendedSource === 'xpath' ? 'border-emerald-300 bg-emerald-50' : ''}`}>
                    <User className="mt-0.5 size-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">XPath selector</span>
                        {foundPaths.xpath.verified && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">verified</Badge>}
                        {recommendedSource === 'xpath' && !foundPaths.api && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">recommended</Badge>}
                      </div>
                      <p data-slot="mono" className="mt-0.5 truncate text-[10px] text-muted-foreground">{foundPaths.xpath.path}</p>
                      {foundPaths.xpath.rawText && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Raw: "{foundPaths.xpath.rawText}"</p>
                      )}
                    </div>
                  </div>
                )}

                {foundPaths.jsonLd && (
                  <div className={`flex items-start gap-2 rounded-lg border p-3 ${recommendedSource === 'jsonLd' ? 'border-emerald-300 bg-emerald-50' : ''}`}>
                    <Bot className="mt-0.5 size-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium">JSON-LD</span>
                      <p data-slot="mono" className="mt-0.5 truncate text-[10px] text-muted-foreground">{foundPaths.jsonLd.path}</p>
                    </div>
                  </div>
                )}

                {foundPaths.meta && (
                  <div className={`flex items-start gap-2 rounded-lg border p-3 ${recommendedSource === 'meta' ? 'border-emerald-300 bg-emerald-50' : ''}`}>
                    <Bot className="mt-0.5 size-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium">Meta tag</span>
                      <p data-slot="mono" className="mt-0.5 text-[10px] text-muted-foreground">{foundPaths.meta.path}</p>
                    </div>
                  </div>
                )}

                {!foundPaths.api && !foundPaths.xpath && !foundPaths.jsonLd && !foundPaths.meta && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    No automatic path found. The clicked element's XPath will be used as a manual override.
                  </div>
                )}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" size="sm" onClick={() => setStep('click')}>Back</Button>
                <Button size="sm" onClick={handleSave} className="gap-1.5">
                  <Check className="size-3.5" />
                  Save Override
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
