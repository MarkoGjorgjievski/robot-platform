'use client';

import { useState } from 'react';
import { RefreshCw, Trash2, Loader2, Play } from 'lucide-react';
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

export function DomainDetailActions({ domain }: { domain: string }) {
  const [resetting, setResetting] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [revalidateOpen, setRevalidateOpen] = useState(false);
  const [revalidateUrl, setRevalidateUrl] = useState('');
  const [revalidateStatus, setRevalidateStatus] = useState<string | null>(null);

  async function handleReset() {
    if (!confirm(`Reset all cached data for ${domain}? This will force a fresh analysis on the next run.`)) return;
    setResetting(true);
    try {
      await fetch('/api/scraper/domain-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      window.location.reload();
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setResetting(false);
    }
  }

  async function handleRevalidate() {
    if (!revalidateUrl.trim()) return;
    setRevalidating(true);
    setRevalidateStatus('Capturing page...');

    try {
      // Step 1: Analyze
      setRevalidateStatus('Analyzing page structure...');
      const analyzeRes = await fetch('/api/scraper/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: revalidateUrl.trim() }),
      });

      if (!analyzeRes.ok) throw new Error('Analysis failed');
      const analyzeData = await analyzeRes.json();

      if (analyzeData.cached) {
        // Force fresh analysis by resetting first
        setRevalidateStatus('Resetting cache for fresh analysis...');
        await fetch('/api/scraper/domain-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        });

        // Re-analyze
        setRevalidateStatus('Running fresh analysis...');
        const freshRes = await fetch('/api/scraper/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: revalidateUrl.trim() }),
        });
        if (!freshRes.ok) throw new Error('Fresh analysis failed');
        const freshData = await freshRes.json();

        // Extract
        if (freshData.schema?.fields?.length > 0) {
          setRevalidateStatus(`Extracting ${freshData.schema.fields.length} fields...`);
          await fetch('/api/scraper/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: revalidateUrl.trim(),
              fields: freshData.schema.fields,
              pageType: freshData.schema.page_type,
            }),
          });
        }
      } else {
        // Run extraction on fresh analysis
        if (analyzeData.schema?.fields?.length > 0) {
          setRevalidateStatus(`Extracting ${analyzeData.schema.fields.length} fields...`);
          await fetch('/api/scraper/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: revalidateUrl.trim(),
              fields: analyzeData.schema.fields,
              pageType: analyzeData.schema.page_type,
            }),
          });
        }
      }

      setRevalidateStatus('Done! Reloading...');
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setRevalidateStatus(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setRevalidating(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Dialog open={revalidateOpen} onOpenChange={(v) => { if (!revalidating) setRevalidateOpen(v); }}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Play className="size-3.5" />
            Re-validate
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-validate {domain}</DialogTitle>
            <DialogDescription>
              Run a fresh extraction against this domain to verify cached selectors still work.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Sample URL from {domain}</Label>
              <Input
                value={revalidateUrl}
                onChange={(e) => setRevalidateUrl(e.target.value)}
                placeholder={`https://${domain}/some-page`}
                className="mt-1.5"
                disabled={revalidating}
                onKeyDown={(e) => e.key === 'Enter' && handleRevalidate()}
              />
            </div>
            {revalidateStatus && (
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                {revalidating && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                <span className="text-xs">{revalidateStatus}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevalidateOpen(false)} disabled={revalidating}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleRevalidate} disabled={revalidating || !revalidateUrl.trim()} className="gap-1.5">
                {revalidating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Run
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        size="sm"
        onClick={handleReset}
        disabled={resetting}
        className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
      >
        {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Reset Cache
      </Button>
    </div>
  );
}
