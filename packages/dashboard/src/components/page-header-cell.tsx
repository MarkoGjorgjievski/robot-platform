// packages/dashboard/src/components/page-header-cell.tsx
import { useEffect, useRef, useState } from 'react';
import { Pencil, Loader2 } from 'lucide-react';
import { shortUrl } from '../lib/schema-grid';
import { screenshotUrl } from '../lib/screenshot-url';
import type { ColumnState } from '../lib/schema-tab-view';

// Spec 7: no glyphs. The capture state is a word beside the page number.
const STATE_LABEL: Record<ColumnState, string> = { idle: '', queued: 'queued', capturing: 'capturing', captured: 'captured', not_captured: 'not captured' };

/** A proof-page column header (spec 5.6): shortened path, page number, capture state, and a pencil that opens the URL popover with "find pages from a listing". */
export function PageHeaderCell({ index, url, state, blockedReason, screenshotUrl: shot, disabled, onChange, onFindPages, onRemove }: {
  index: number; url: string; state: ColumnState; blockedReason?: string; screenshotUrl?: string | null; disabled: boolean;
  onChange: (url: string) => void; onFindPages: (listingUrl: string) => Promise<string[]>; onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [listing, setListing] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!open) setDraft(url); }, [url, open]);
  // The table locking while verifying (`disabled` going true) must close an
  // already-open popover, or its stale draft would sit there and commit onto
  // a Source the operator can no longer edit.
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  // Intentionally no deps array: this must re-subscribe on every render so
  // `commit()` always closes over the CURRENT `draft`/`url`, never a stale
  // one captured back when the popover opened.
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

  const capture = state === 'not_captured' && blockedReason ? `not captured: ${blockedReason}` : STATE_LABEL[state];

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1 font-mono text-[12px] font-medium text-gray-900" title={url || undefined}>
        {/* An empty column asks for what it needs; the page number is already on the line below. */}
        <span className={`truncate ${url ? '' : 'font-sans font-normal text-gray-600'}`}>{url ? shortUrl(url) : 'Add a product page'}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Edit page ${index + 1}`} title="Edit this page" className={disabled ? 'invisible' : 'text-gray-600 hover:text-gray-900'}><Pencil className="h-3 w-3" /></button>
      </div>
      <div className="label-soft mt-0.5 flex h-4 min-w-0 items-center gap-1.5" title={blockedReason}>
        <span className="flex-shrink-0">Page {index + 1}</span>
        {capture && <span className="truncate">{capture}</span>}
        {state === 'not_captured' && shot && <a href={screenshotUrl(shot) ?? '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 underline-offset-2 hover:underline">screenshot</a>}
      </div>

      {open && (
        <div className="card absolute left-0 top-full z-20 mt-1 w-80 p-3 text-left shadow-lg" role="dialog" aria-label={`Page ${index + 1}`}>
          <label className="block text-xs text-gray-600">Page {index + 1}
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="mt-1 w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-900" placeholder="https://shop.example/p/…" />
          </label>
          <p className="mt-3 text-xs text-gray-600">Don't have product pages yet? Find some from a listing page.</p>
          <div className="mt-1 flex gap-1">
            <input value={listing} onChange={(e) => setListing(e.target.value)} className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-900" placeholder="https://shop.example/category" />
            <button type="button" className="btn-quiet h-7 flex-shrink-0" disabled={finding || !listing.trim()} onClick={find}>{finding ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Find pages</button>
          </div>
          {findError && <p className="mt-1 text-xs text-fail">{findError}</p>}
          {onRemove && !disabled && (
            <button type="button" className="btn-quiet mt-2" onClick={onRemove} aria-label={`Remove page ${index + 1}`}>
              Remove this page
            </button>
          )}
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
