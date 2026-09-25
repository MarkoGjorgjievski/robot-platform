import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import type { Card } from '../../lib/site/verification-model';

/**
 * The Verification tab's top bar (spec §2.1): one page load finds a listing
 * page's products, without visiting any of them, and fills the grid below.
 * Nothing here is saved — the route decides what `onFound`/`onNoListing`
 * mean for the board.
 */
export function ListingBar({
  listingUrl,
  disabled,
  onFound,
  onNoListing,
  extractOwnsInput,
}: {
  listingUrl: string;
  disabled: boolean;
  onFound: (listingUrl: string, products: Card[], found: { productLinks: number; pagerSeen: boolean }) => void;
  /** The listing URL as typed (possibly blank): it is kept either way (spec §2.1). */
  onNoListing: (listingUrl: string) => void;
  extractOwnsInput: boolean;
}) {
  const [url, setUrl] = useState(listingUrl);
  const [found, setFound] = useState<{ productLinks: number; pagerSeen: boolean } | null>(null);
  const check = trpc.sources.checkListingPage.useMutation();

  function findProducts() {
    const trimmed = url.trim();
    if (trimmed === '') return;
    setFound(null);
    check.mutate(
      { listingUrl: trimmed },
      {
        onSuccess: (data) => {
          setFound({ productLinks: data.productLinks, pagerSeen: data.pagerSeen });
          if (data.productLinks === 0) {
            onNoListing(trimmed);
          } else {
            onFound(trimmed, data.products, { productLinks: data.productLinks, pagerSeen: data.pagerSeen });
          }
        },
      },
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              findProducts();
            }
          }}
          disabled={disabled}
          placeholder="Paste a listing page — a category or search results"
          aria-label="Listing page"
          className="font-mono"
        />
        <Button size="sm" disabled={disabled || check.isPending || url.trim() === ''} onClick={findProducts} className="shrink-0">
          {check.isPending ? <Loader2 className="animate-spin" /> : null}
          Find products
        </Button>
      </div>

      <button type="button" disabled={disabled} onClick={() => onNoListing(url.trim())} className="text-base text-link underline-offset-4 hover:underline">
        No listing? Paste product pages instead
      </button>

      {found ? (
        found.productLinks === 0 ? (
          <p className="text-sm text-muted-foreground">No product links found on this page. Paste product pages below.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {found.productLinks} products found{found.pagerSeen ? ' · a pager too' : ''}
          </p>
        )
      ) : null}

      {extractOwnsInput ? (
        <p className="text-sm text-muted-foreground">The Extract tab has its own pages; this listing only finds products to verify on.</p>
      ) : null}

      {check.error ? (
        <p role="alert" className="text-sm text-fail">
          {check.error.message}
        </p>
      ) : null}
    </div>
  );
}
