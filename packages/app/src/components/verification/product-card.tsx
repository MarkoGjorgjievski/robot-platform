import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { shortUrl, type Card } from '../../lib/site/verification-model';
import type { ProofCapture } from '../../lib/site/use-proof-captures';

/**
 * One product in the grid (spec §2.2): the listing's photo and title, the
 * page's own url in mono, and the background screenshot capture's state as a
 * 2 px rail — colour is never a wash (spec §4). A blank card (a dropped slot
 * with nothing left in the queue to take its place) is an inline URL input
 * instead, so the customer can point it at a page directly.
 */
export function ProductCard({
  card,
  index,
  selected,
  disabled,
  capture,
  onSelect,
  onDrop,
  onReplace,
  onRetry,
  hostProblem,
  compact,
}: {
  card: Card;
  index: number;
  selected: boolean;
  disabled: boolean;
  capture: ProofCapture | undefined;
  onSelect: () => void;
  onDrop: () => void;
  onReplace: (url: string) => void;
  onRetry: () => void;
  hostProblem: (url: string) => string | null;
  /** As a verification table's column head (spec 2026-09-28 A1): a shorter photo, one-line title. */
  compact?: boolean;
}) {
  if (card.url.trim() === '') {
    return <BlankProductCard index={index} disabled={disabled} onCommit={onReplace} onDrop={onDrop} hostProblem={hostProblem} />;
  }

  const status = capture?.status ?? 'starting';
  const rail = status === 'captured' ? 'bg-pass' : status === 'failed' ? 'bg-warn' : 'bg-text';

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-[6px] border ${selected ? 'border-text' : 'border-line hover:border-line-hover'}`}>
      <div className={`h-[2px] w-full shrink-0 ${rail}`} aria-hidden />

      <button type="button" disabled={disabled} onClick={onSelect} aria-pressed={selected} className="flex flex-col text-left disabled:cursor-not-allowed">
        <div className={`w-full shrink-0 bg-raised ${compact ? 'h-[56px]' : 'h-[120px]'}`}>
          {card.image ? <img src={card.image} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="space-y-0.5 px-2 py-1.5">
          <p className={compact ? 'line-clamp-1 text-base' : 'line-clamp-2 text-base'} title={card.title}>
            {card.title}
          </p>
          <p className="truncate font-mono text-sm text-muted-foreground" title={card.url}>
            {shortUrl(card.url)}
          </p>
        </div>
      </button>

      <div className="mt-auto flex items-center justify-between gap-2 px-2 py-1.5">
        {status === 'failed' ? (
          <>
            <span className="min-w-0 line-clamp-2 text-sm text-warn" title={capture?.error}>
              {capture?.error ?? 'The screenshot could not be taken'}
            </span>
            <Button variant="outline" size="xs" disabled={disabled} onClick={onRetry} className="shrink-0">
              Try again
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{status === 'captured' ? 'ready' : 'taking screenshot…'}</span>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        aria-label={`Drop product ${index + 1}`}
        onClick={onDrop}
        className="absolute top-1 right-1 text-muted-foreground hover:text-text"
      >
        ×
      </Button>
    </div>
  );
}

/** A card slot with no url yet — an inline input rather than a photo, product state, or drop button beyond the one shown. */
function BlankProductCard({
  index,
  disabled,
  onCommit,
  onDrop,
  hostProblem,
}: {
  index: number;
  disabled: boolean;
  onCommit: (url: string) => void;
  onDrop: () => void;
  hostProblem: (url: string) => string | null;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function commit() {
    const value = draft.trim();
    if (value === '') return;
    const p = hostProblem(value);
    if (p) {
      setProblem(p);
      return;
    }
    setProblem(null);
    onCommit(value);
  }

  return (
    <div className="relative flex h-full min-h-[210px] flex-col justify-center gap-2 rounded-[6px] border border-line p-2">
      <label className="block text-sm text-muted-foreground">
        Product {index + 1}
        <Input
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          disabled={disabled}
          placeholder="https://shop.example/p/…"
          className="mt-1 h-8 font-mono text-[16px] md:text-sm"
        />
      </label>
      <Button size="sm" disabled={disabled || draft.trim() === ''} onClick={commit}>
        Use this page
      </Button>
      {problem ? (
        <p role="alert" className="text-sm text-fail">
          {problem}
        </p>
      ) : null}

      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        aria-label={`Drop product ${index + 1}`}
        onClick={onDrop}
        className="absolute top-1 right-1 text-muted-foreground hover:text-text"
      >
        ×
      </Button>
    </div>
  );
}
