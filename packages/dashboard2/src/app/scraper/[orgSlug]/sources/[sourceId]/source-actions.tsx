'use client';

import { useState } from 'react';
import { Play, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SourceActions({
  sourceId,
  url,
  orgSlug,
}: {
  sourceId: string;
  url: string;
  orgSlug: string;
}) {
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    try {
      const res = await fetch('/api/scraper/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      if (res.ok) {
        // Refresh the page to show new data
        window.location.reload();
      }
    } catch (err) {
      console.error('Run failed:', err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRun}
        disabled={running || !url}
        className="gap-1.5"
      >
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Run Extraction
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5">
        <Download className="size-3.5" />
        Export
      </Button>
    </div>
  );
}
