import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { PRODUCTS_MAX, shortUrl, type Card } from '../../lib/site/verification-model';
import type { ProofCapture } from '../../lib/site/use-proof-captures';
import { ProductCard } from './product-card';

/**
 * The product grid (spec §2.2): three to six cards, each captured in the
 * background, plus the way to add one more. Nothing here saves — the route
 * owns the board (`Board.cards`) and the saver; every callback here just
 * says what the customer did.
 */
export function ProductGrid({
  cards,
  captures,
  selected,
  disabled,
  onSelect,
  onDrop,
  onAdd,
  onReplace,
  canAddFromQueue,
  onRetry,
  hostProblem,
}: {
  cards: Card[];
  captures: Record<string, ProofCapture | undefined>;
  selected: number;
  disabled: boolean;
  onSelect: (i: number) => void;
  onDrop: (i: number) => void;
  onAdd: (url?: string) => void;
  onReplace: (i: number, url: string) => void;
  canAddFromQueue: boolean;
  onRetry: (url: string) => void;
  hostProblem: (url: string) => string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
      {cards.map((card, i) => (
        <ProductCard
          key={i}
          card={card}
          index={i}
          selected={selected === i}
          disabled={disabled}
          capture={captures[card.url]}
          onSelect={() => onSelect(i)}
          onDrop={() => onDrop(i)}
          onReplace={(url) => onReplace(i, url)}
          onRetry={() => onRetry(card.url)}
          onSwap={() => onDrop(i)}
          hostProblem={hostProblem}
        />
      ))}

      {cards.length < PRODUCTS_MAX ? (
        <AddProductCard disabled={disabled} canAddFromQueue={canAddFromQueue} onAdd={onAdd} hostProblem={hostProblem} />
      ) : (
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-line p-2 text-center">
          <span className="text-sm text-muted-foreground">Six products is the most a website is checked on</span>
        </div>
      )}
    </div>
  );
}

/**
 * The "+ Add product" slot. From the queue it is a one-click button — the
 * route pulls the next unused listing product when `onAdd` is called with no
 * url. With no queue to draw from it opens as a URL input instead, so the
 * customer can add a page directly without first creating a blank card.
 *
 * Exported for the verification table's own `addHead` column (spec
 * 2026-09-28 A1) — `compact` shortens the slot to match `ProductCard`'s
 * compact height there: a small tile at the foot of a narrow column.
 */
/** How many found products the picker lists; the rest are a paste away. */
const FOUND_SHOWN = 30;

export function AddProductCard({
  disabled,
  canAddFromQueue,
  onAdd,
  hostProblem,
  compact,
  found = [],
  onPick,
}: {
  /** The products Find products read off the listing and has not put on the board yet (Marko 2026-11-18): offered by name, not taken blind. */
  found?: readonly Card[];
  onPick?: (card: Card) => void;
  disabled: boolean;
  canAddFromQueue: boolean;
  onAdd: (url?: string) => void;
  hostProblem: (url: string) => string | null;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const minHeight = compact ? 'min-h-[84px]' : 'min-h-[120px]';

  function commit() {
    const value = draft.trim();
    if (value === '') return;
    const p = hostProblem(value);
    if (p) {
      setProblem(p);
      return;
    }
    onAdd(value);
    setDraft('');
    setProblem(null);
    setEditing(false);
  }

  const [picking, setPicking] = useState(false);
  if (!editing && found.length > 0 && onPick) {
    return (
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`flex ${minHeight} w-full flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-line text-sm text-muted-foreground hover:border-line-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <span>+ Add product</span>
            <span className="text-xs">{found.length} found on your listing</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[340px] p-0" data-testid="found-products">
          <p className="border-b border-line px-3 py-2 text-sm text-muted-foreground">Found on your listing</p>
          <ul className="max-h-[320px] overflow-auto py-1">
            {found.slice(0, FOUND_SHOWN).map((card) => (
              <li key={card.url}>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(false);
                    onPick(card);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line bg-white">
                    {card.image ? <img src={card.image} alt="" className="h-full w-full object-contain" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base">{card.title}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{shortUrl(card.url)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
            <span className="text-xs text-muted-foreground">{found.length > FOUND_SHOWN ? `Showing ${FOUND_SHOWN} of ${found.length}` : ''}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setPicking(false);
                setEditing(true);
              }}
            >
              Paste an address instead
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => (canAddFromQueue ? onAdd() : setEditing(true))}
        className={`flex ${minHeight} w-full flex-col items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-line text-sm text-muted-foreground hover:border-line-hover hover:text-text`}
      >
        + Add product
      </button>
    );
  }

  return (
    <div className={`flex ${minHeight} flex-col justify-center gap-2 rounded-[6px] border border-dashed border-line p-2`}>
      <Input
        autoFocus
        aria-label="New product URL"
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
        className="h-8 font-mono text-[16px] md:text-sm"
      />
      <div className={compact ? 'flex flex-col gap-1.5' : 'flex gap-1.5'}>
        <Button size="sm" disabled={disabled || draft.trim() === ''} onClick={commit}>
          Use this page
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(false);
            setDraft('');
            setProblem(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-fail">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Add a product, as a plain button under the table (Marko 2026-11-18). Its menu offers, in order: the next product
 * of the listing the others came from, the rest of the products found there by name, and an address of your own.
 * `onNext` is absent when the website has no listing to read from.
 */
export function AddProductButton({
  disabled,
  found,
  onNext,
  nextNote,
  onPick,
  onAdd,
  hostProblem,
  busy = false,
}: {
  /** The listing is being read for its next product: the button says so until it lands. */
  busy?: boolean;
  disabled: boolean;
  found: readonly Card[];
  onNext?: () => void;
  /** Under "Next product from your listing": the product it will add, or that the listing is read again first. */
  nextNote?: string;
  onPick: (card: Card) => void;
  onAdd: (url: string) => void;
  hostProblem: (url: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const others = found.slice(1, 1 + FOUND_SHOWN);

  function commit() {
    const value = draft.trim();
    if (value === '') return;
    const p = hostProblem(value);
    if (p) {
      setProblem(p);
      return;
    }
    onAdd(value);
    setDraft('');
    setProblem(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? 'Reading your listing…' : '+ Add product'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0" data-testid="add-product-menu">
        {onNext ? (
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-base">Next product from your listing</p>
              {nextNote ? <p className="truncate text-sm text-muted-foreground" title={nextNote}>{nextNote}</p> : null}
            </div>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => {
                setOpen(false);
                onNext();
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
        {others.length > 0 ? (
          <>
            <p className="px-3 pt-2 pb-1 text-sm text-muted-foreground">Or pick one found there</p>
            <ul className="max-h-[240px] overflow-auto pb-1">
              {others.map((card) => (
                <li key={card.url}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onPick(card);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line bg-white">
                      {card.image ? <img src={card.image} alt="" className="h-full w-full object-contain" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base">{card.title}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{shortUrl(card.url)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="space-y-1.5 border-t border-line px-3 py-2.5">
          <label htmlFor="add-product-address" className="block text-sm text-muted-foreground">
            Or paste a product page's address
          </label>
          <div className="flex gap-1.5">
            <Input
              id="add-product-address"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
              }}
              placeholder="https://shop.example/p/…"
              className="h-8 font-mono text-[16px] md:text-sm"
            />
            <Button size="sm" disabled={draft.trim() === ''} onClick={commit}>
              Add
            </Button>
          </div>
          {problem ? (
            <p role="alert" className="text-sm text-fail">
              {problem}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
