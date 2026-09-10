// packages/dashboard/src/components/page-header-cell.tsx
import { useEffect, useRef, useState } from 'react';
import { Pencil, Loader2, Check, AlertTriangle, Clock } from 'lucide-react';
import { shortUrl } from '../lib/schema-grid';
import { screenshotUrl } from '../lib/screenshot-url';
import type { ColumnState } from '../lib/schema-tab-view';

const STATE_LABEL: Record<ColumnState, string> = { idle: '', queued: 'queued', capturing: 'capturing…', captured: 'captured', not_captured: 'not captured' };

/** A proof-page column header (spec 5.6): shortened path, page number, capture state, and a pencil that opens the URL popover with "find pages from a listing". */
export function PageHeaderCell({ index, url, state, blockedReason, screenshotUrl: shot, disabled, onChange, onFindPages }: {
  index: number; url: string; state: ColumnState; blockedReason?: string; screenshotUrl?: string | null; disabled: boolean;
  onChange: (url: string) => void; onFindPages: (listingUrl: string) => Promise<string[]>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [listing, setListing] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!open) setDraft(url); }, [url, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) commit(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft(url); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  });

  function commit() {
    const next = draft.trim();
    if (next !== url) onChange(next);
    setOpen(false);
  }

  async function find() {
    setFindError(null); setCandidates([]); setFinding(true);
    try { setCandidates(await onFindPages(listing.trim())); } catch (err) { setFindError(err instanceof Error ? err.message : String(err)); } finally { setFinding(false); }
  }

  const icon = state === 'captured' ? <Check className="h-3 w-3 text-emerald-600" /> : state === 'capturing' ? <Loader2 className="h-3 w-3 animate-spin text-gray-500" /> : state === 'queued' ? <Clock className="h-3 w-3 text-gray-400" /> : state === 'not_captured' ? <AlertTriangle className="h-3 w-3 text-amber-600" /> : null;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1 font-mono text-xs font-medium text-gray-700" title={url || undefined}>
        <span className="truncate">{url ? shortUrl(url) : `Page ${index + 1}`}</span>
        {!disabled && <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Edit page ${index + 1}`} title="Edit this page" className="text-gray-300 hover:text-gray-600"><Pencil className="h-3 w-3" /></button>}
      </div>
      <div className="mt-0.5 flex h-4 items-center gap-1 font-sans text-[11px] font-normal text-gray-500" title={blockedReason}>
        {icon}<span className="truncate">{state === 'not_captured' && blockedReason ? `not captured: ${blockedReason}` : STATE_LABEL[state] || `page ${index + 1}`}</span>
        {state === 'not_captured' && shot && <a href={screenshotUrl(shot) ?? '#'} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">screenshot</a>}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg" role="dialog" aria-label={`Page ${index + 1}`}>
          <label className="block text-xs text-gray-600">Page {index + 1}
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs focus:border-accent-500 focus:outline-none" placeholder="https://shop.example/p/…" />
          </label>
          <p className="mt-3 text-xs text-gray-600">Don't have product pages yet? Find some from a listing page.</p>
          <div className="mt-1 flex gap-1">
            <input value={listing} onChange={(e) => setListing(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs focus:border-accent-500 focus:outline-none" placeholder="https://shop.example/category" />
            <button type="button" className="btn-quiet h-7 flex-shrink-0" disabled={finding || !listing.trim()} onClick={find}>{finding ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Find pages</button>
          </div>
          {findError && <p className="mt-1 text-xs text-red-700">{findError}</p>}
          {candidates.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
              {candidates.map((c) => (
                <li key={c} className="flex items-center gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-gray-600" title={c}>{c}</span>
                  <button type="button" className="btn-quiet px-1.5 py-0 text-[10px]" onClick={() => { setDraft(c); onChange(c); setOpen(false); }}>Use as page {index + 1}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-quiet h-7" onClick={() => { setDraft(url); setOpen(false); }}>Cancel</button>
            <button type="button" className="btn-primary h-7 text-xs" onClick={commit}>Use this page</button>
          </div>
        </div>
      )}
    </div>
  );
}
