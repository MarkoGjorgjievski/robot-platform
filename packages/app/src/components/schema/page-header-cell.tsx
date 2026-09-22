import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { shortUrl } from '../../lib/site/schema-grid';
import type { ColumnState } from '../../lib/site/schema-tab-view';
import { API_URL } from '../../lib/trpc';

/** No glyphs: what happened to a page's capture is a word (spec §5.6). */
const STATE_LABEL: Record<ColumnState, string> = {
  idle: '',
  queued: 'queued',
  capturing: 'capturing',
  captured: 'captured',
  not_captured: 'not captured',
};

/**
 * The capture state as a 2 px rail over the column (spec §4: a rail, never a
 * wash). `idle` keeps the hairline, so the heads read as one rule across the
 * table and only a page with something to say breaks it. `capturing` is the
 * text colour rather than a state colour — a page mid-capture has not passed or
 * failed anything yet.
 */
const RAIL: Record<ColumnState, string> = {
  idle: 'bg-line',
  queued: 'bg-line',
  capturing: 'bg-text',
  captured: 'bg-pass',
  not_captured: 'bg-warn',
};

function screenshotHref(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * One proof page's column head: the shortened path, the page number, what
 * happened to its capture, and a pencil that opens the page's own popover —
 * the full URL, a way to find pages from a listing, and (past the third page)
 * a way to remove it.
 *
 * The popover commits on "Use this page" and on Enter, and discards on Escape
 * and on Cancel. Clicking away also commits, which is what the customer means
 * by walking off with a typed URL; the draft is reset from the prop whenever
 * the popover is shut, so the removed-page case that used to write one page's
 * URL onto the next cannot arise — `schema-grid` also remounts this component
 * whenever the URL at a slot changes.
 */
export function PageHeaderCell({
  index,
  url,
  state,
  blockedReason,
  screenshotUrl,
  disabled,
  onChange,
  onFindPages,
  onRemove,
}: {
  index: number;
  url: string;
  state: ColumnState;
  blockedReason?: string;
  screenshotUrl?: string | null;
  disabled: boolean;
  onChange: (url: string) => void;
  onFindPages: (listingUrl: string) => Promise<string[]>;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [listing, setListing] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  // Written and read in the same tick as the close, so a ref rather than state:
  // Escape and Cancel mean "forget what I typed", a click outside means "keep it".
  const discard = useRef(false);

  // The saved URL is the authority whenever the popover is shut.
  useEffect(() => {
    if (!open) setDraft(url);
  }, [url, open]);

  // The table locking while a run is in flight must shut an open popover, or a
  // stale draft would sit over a website the customer can no longer edit.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  /** Shut the popover, keeping the draft or throwing it away. */
  function shut(commit: boolean) {
    if (commit) {
      const value = draft.trim();
      if (value !== url) onChange(value);
    }
    discard.current = false;
    setOpen(false);
  }

  async function find() {
    setFindError(null);
    setCandidates([]);
    setFinding(true);
    try {
      setCandidates(await onFindPages(listing.trim()));
    } catch (err) {
      setFindError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinding(false);
    }
  }

  const label = state === 'not_captured' && blockedReason ? `not captured: ${blockedReason}` : STATE_LABEL[state];
  const shot = screenshotHref(screenshotUrl);

  return (
    <div className="min-w-0">
      {/* The rail is the head's own top rule, so it spans the column rather than
          just the words in it. */}
      <div className={`mb-2 h-0.5 w-full rounded-full ${RAIL[state]}`} aria-hidden />

      <div className="flex min-w-0 items-center gap-1">
        <span
          className={`min-w-0 truncate ${url ? 'font-mono text-base font-normal text-text' : 'text-base font-normal text-muted-foreground'}`}
          title={url || undefined}
        >
          {url ? shortUrl(url) : 'Add a product page'}
        </span>
        <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : shut(!discard.current))}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit page ${index + 1}`}
              disabled={disabled}
              className={`shrink-0 text-muted-foreground hover:text-text ${disabled ? 'invisible' : ''}`}
            >
              <Pencil />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            className="w-[340px] p-0"
            aria-label={`Page ${index + 1}`}
            // Escape means "forget what I typed"; a click outside keeps it.
            onEscapeKeyDown={() => {
              discard.current = true;
            }}
          >
            <label className="block p-3 text-sm text-muted-foreground">
              Page {index + 1}
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') shut(true);
                }}
                className="mt-1 h-8 font-mono text-[16px] md:text-sm"
                placeholder="https://shop.example/p/…"
              />
            </label>

            {/* A hairline, not a gap: the second block is a different errand —
                "I don't have a URL to paste" — and a popover of three stacked
                paragraphs reads as one long form without it. */}
            <div className="border-t border-line p-3">
              <p className="text-sm text-muted-foreground">Don&apos;t have product pages yet? Find some from a listing page.</p>
              <div className="mt-1.5 flex gap-1">
                <Input
                  value={listing}
                  onChange={(e) => setListing(e.target.value)}
                  className="h-8 font-mono text-[16px] md:text-sm"
                  placeholder="https://shop.example/category"
                  aria-label="Listing page"
                />
                <Button variant="outline" size="sm" className="shrink-0" disabled={finding || !listing.trim()} onClick={() => void find()}>
                  {finding ? <Loader2 className="animate-spin" /> : null}
                  Find pages
                </Button>
              </div>

              {findError ? (
                <p role="alert" className="mt-1.5 text-sm text-fail">
                  {findError}
                </p>
              ) : null}

              {candidates.length > 0 ? (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                  {candidates.map((candidate) => (
                    <li key={candidate} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground" title={candidate}>
                        {candidate}
                      </span>
                      <Button
                        variant="outline"
                        size="xs"
                        className="shrink-0"
                        onClick={() => {
                          setDraft(candidate);
                          onChange(candidate);
                          shut(false);
                        }}
                      >
                        Use as page {index + 1}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-line p-3">
              {onRemove ? (
                // Shut first, then remove: removing a page shifts every later
                // page down an index, and a popover still open over the slot
                // would commit the removed page's URL onto its successor.
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-fail"
                  aria-label={`Remove page ${index + 1}`}
                  onClick={() => {
                    shut(false);
                    onRemove();
                  }}
                >
                  Remove this page
                </Button>
              ) : null}
              <div className="ml-auto flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => shut(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={() => shut(true)}>
                  Use this page
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-normal text-muted-foreground" title={blockedReason}>
        <span className="shrink-0">Page {index + 1}</span>
        {label ? (
          <span className={`truncate ${state === 'not_captured' ? 'text-warn' : ''}`} title={label}>
            {label}
          </span>
        ) : null}
        {state === 'not_captured' && shot ? (
          <a href={shot} target="_blank" rel="noopener noreferrer" className="shrink-0 text-link underline-offset-4 hover:underline">
            screenshot
          </a>
        ) : null}
      </div>
    </div>
  );
}
