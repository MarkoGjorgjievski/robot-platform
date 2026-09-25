import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PRODUCTS_MAX, type Card } from '../../lib/site/verification-model';
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
 */
function AddProductCard({
  disabled,
  canAddFromQueue,
  onAdd,
  hostProblem,
}: {
  disabled: boolean;
  canAddFromQueue: boolean;
  onAdd: (url?: string) => void;
  hostProblem: (url: string) => string | null;
}) {
  const [editing, setEditing] = useState(false);
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
    onAdd(value);
    setDraft('');
    setProblem(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => (canAddFromQueue ? onAdd() : setEditing(true))}
        className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-line text-sm text-muted-foreground hover:border-line-hover hover:text-text"
      >
        + Add product
      </button>
    );
  }

  return (
    <div className="flex min-h-[120px] flex-col justify-center gap-2 rounded-[6px] border border-dashed border-line p-2">
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
      <div className="flex gap-1.5">
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
