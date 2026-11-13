import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { shortUrl, type Card } from '../../lib/site/verification-model';
import type { ProofCapture } from '../../lib/site/use-proof-captures';
import { CaptureStateWords } from './capture-words-view';
import { isWaiting } from '../../lib/site/turned-away';

/**
 * One product in the grid (spec §2.2): the listing's photo on a white tile (shop
 * photos are cut out on white, so it reads as one picture in both themes), the
 * title on two lines, the page's own url as a link that opens it, and the
 * background screenshot capture's state as a 2 px rail — colour is never a
 * wash (spec §4). A blank card (a dropped slot
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
  onSwap,
  hostProblem,
  compact,
  notChecked,
  websiteName,
  bare,
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
  /** Swap product (spec 2026-10-28 §3.6): drop this card and open Find products. */
  onSwap: () => void;
  hostProblem: (url: string) => string | null;
  /** As a verification table's column head (spec 2026-09-28 A1): a shorter photo, one-line title. */
  compact?: boolean;
  /** Why the last Verify could not check this product (spec 2026-10-20 §3.5.2); null when it did. */
  notChecked?: string | null;
  /** The website's name, as the breadcrumb shows it: a turned-away card names it. */
  websiteName?: string | null;
  /** Photo and title only: the table shows the link, the state and × in its Page row (`ProductPageCell`). */
  bare?: boolean;
}) {
  if (card.url.trim() === '') {
    return <BlankProductCard index={index} disabled={disabled} onCommit={onReplace} onDrop={onDrop} hostProblem={hostProblem} />;
  }

  const status = capture?.status ?? 'starting';
  // Amber through every try of a turned-away page, the running retries included, so it never flickers between tries.
  const rail = status === 'captured' ? 'bg-pass' : status === 'failed' || isWaiting(capture) ? 'bg-warn' : 'bg-text';

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-[6px] border ${selected ? 'border-text' : 'border-line hover:border-line-hover'}`}>
      <div className={`h-[2px] w-full shrink-0 ${rail}`} aria-hidden />

      <button type="button" disabled={disabled} onClick={onSelect} aria-pressed={selected} className="flex flex-col text-left disabled:cursor-not-allowed">
        <div className={`w-full shrink-0 ${card.image ? 'bg-white p-2' : 'bg-raised'} ${compact ? 'h-[128px]' : 'h-[140px]'}`}>
          {card.image ? <img src={card.image} alt="" className="h-full w-full object-contain" /> : null}
        </div>
        {/* Two lines, always: the heads stay one height whatever the titles' lengths. */}
        <p className={`line-clamp-2 min-h-[2lh] px-2 pt-2 text-base leading-snug font-medium ${bare ? 'pb-2' : ''}`} title={card.title}>
          {card.title}
        </p>
      </button>

      {bare ? null : (
        <div className="px-2 pt-1 pb-1.5">
          <ProductPageCell card={card} index={index} disabled={disabled} capture={capture} onDrop={onDrop} onRetry={onRetry} onSwap={onSwap} notChecked={notChecked} websiteName={websiteName} />
        </div>
      )}
    </div>
  );
}

/** A card slot with no url yet — an inline input rather than a photo, product state, or drop button beyond the one shown. */
export function BlankProductCard({
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
    <div className="relative flex h-full min-h-[160px] flex-col justify-center gap-2 rounded-[6px] border border-line p-2">
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

/**
 * A product's page, as the table's fixed first row shows it (Marko 2026-11-13): the link that opens
 * it, × to take the product off the board, and the screenshot capture's state in words — one quiet
 * word when it is ready, the whole sentence with Try again / Swap product when the website turned us
 * away. The same for every field, so it is a row of its own rather than part of the column head.
 */
export function ProductPageCell({
  card,
  index,
  disabled,
  capture,
  onDrop,
  onRetry,
  onSwap,
  notChecked,
  websiteName,
  from,
}: {
  card: Card;
  index: number;
  disabled: boolean;
  capture: ProofCapture | undefined;
  onDrop: () => void;
  onRetry: () => void;
  onSwap: () => void;
  notChecked?: string | null;
  websiteName?: string | null;
  /** The listing this product was found on, in a few words — only when several listings were read at once. */
  from?: string;
}) {
  const status = capture?.status ?? 'starting';
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1">
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          title={card.url}
          aria-label={`Open product ${index + 1}'s page in a new tab`}
          className="inline-flex min-w-0 flex-1 items-center gap-1 font-mono text-xs text-muted-foreground underline decoration-line-hover underline-offset-2 hover:text-text"
        >
          <span className="truncate">{shortUrl(card.url)}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={`Drop product ${index + 1}`}
          title="Remove this product"
          onClick={onDrop}
          className="shrink-0 text-muted-foreground hover:text-text"
        >
          ×
        </Button>
      </div>
      {from ? (
        <p className="truncate text-xs font-normal text-muted-foreground" title={from}>
          from {from}
        </p>
      ) : null}
      {notChecked && status !== 'failed' && status !== 'waiting' ? (
        <span className="block min-w-0 line-clamp-2 text-sm text-warn" title={notChecked}>
          {notChecked}
        </span>
      ) : (
        <CaptureStateWords capture={capture} name={websiteName} disabled={disabled} onRetry={onRetry} onSwap={onSwap} />
      )}
    </div>
  );
}

/**
 * A product's photo as its own table row (Marko 2026-11-13: rows, not a card): on a white tile, since
 * shop photos are cut out on white. A click shows this product's screenshot; the border says which one
 * is showing. A page pasted by hand has no photo, so the tile names the product instead.
 */
export function ProductImageButton({ card, index, selected, disabled, onSelect, taken }: { card: Card; index: number; selected: boolean; disabled: boolean; onSelect: () => void; /** When its screenshot was taken, as shown. */ taken?: string | null }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Show product ${index + 1}'s screenshot`}
      title={taken ? `Screenshot taken ${taken}` : undefined}
      className={`flex h-[112px] w-full items-center justify-center overflow-hidden rounded-[6px] border disabled:cursor-not-allowed ${selected ? 'border-text' : 'border-line hover:border-line-hover'} ${card.image ? 'bg-white p-2' : 'bg-raised'}`}
    >
      {card.image ? <img src={card.image} alt="" className="h-full w-full object-contain" /> : <span className="text-sm font-normal text-muted-foreground">Product {index + 1}</span>}
    </button>
  );
}

/** A product's title as its own table row: two lines at most, the whole of it on hover. A click shows its screenshot, like the photo. */
export function ProductTitleButton({ card, selected, disabled, onSelect }: { card: Card; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      title={card.title}
      className="line-clamp-2 w-full text-left text-base leading-snug font-medium underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:no-underline"
    >
      {card.title}
    </button>
  );
}
