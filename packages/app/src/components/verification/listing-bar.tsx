import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import type { Card } from '../../lib/site/verification-model';
import { NO_PRODUCTS_FOUND } from '../../lib/site/extract-view';
import { captureWords } from '../../lib/capture-words';
import { useStaffDetail } from '../../lib/use-staff-detail';

/**
 * The Verification tab's top bar (spec §2.1): one page load finds a listing
 * page's products, without visiting any of them, and fills the grid below.
 * Nothing here is saved — the route decides what `onFound`/`onNoListing`
 * mean for the board.
 */
export function ListingBar({
  sourceId,
  listingUrl,
  startUrl,
  disabled,
  onFound,
  onNoListing,
  extractOwnsInput,
  problem,
}: {
  /** The website whose listing this is: its page loads the way that website's pages do. */
  sourceId: string;
  listingUrl: string;
  /**
   * What the input starts with when it differs from `listingUrl` (first run 2026-10-25, D5): the address typed in
   * Add website when it can be a listing (`listingBarStart`). Nothing is saved until Find products answers.
   */
  startUrl?: string;
  disabled: boolean;
  onFound: (listingUrl: string, products: Card[], found: { productLinks: number; pagerSeen: boolean }) => void;
  /** The listing URL as typed (possibly blank): it is kept either way (spec §2.1). */
  onNoListing: (listingUrl: string) => void;
  extractOwnsInput: boolean;
  /** Why the route refused this listing (e.g. it is on another website than the products), shown under the input. */
  problem?: string | null;
}) {
  const [url, setUrl] = useState(startUrl ?? listingUrl);
  // "No listing?" with the untouched pre-filled address says that address is not a listing: none is kept.
  const typedListing = () => (!listingUrl.trim() && startUrl && url.trim() === startUrl.trim() ? '' : url.trim());
  // Spec 2026-10-21: a customer reads a failed capture in customer words; staff read it as stored.
  const staff = useStaffDetail();
  const [found, setFound] = useState<{ productLinks: number; pagerSeen: boolean; message: string | null } | null>(null);
  const check = trpc.sources.checkListingPage.useMutation();

  // A visible seconds counter while Find products is in flight (campaign 2,
  // 2026-10-11): a slow site used to leave the bar blank for up to 90 s with
  // nothing on screen. Counts from 0 on every new request; stops on settle.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!check.isPending) return;
    setSeconds(0);
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [check.isPending]);

  function findProducts() {
    const trimmed = url.trim();
    if (trimmed === '') return;
    setFound(null);
    check.mutate(
      { listingUrl: trimmed, sourceId },
      {
        onSuccess: (data) => {
          setFound({ productLinks: data.productLinks, pagerSeen: data.pagerSeen, message: data.message });
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

      {problem ? (
        <p role="alert" className="text-sm text-fail">
          {problem}
        </p>
      ) : null}

      <button type="button" disabled={disabled} onClick={() => onNoListing(typedListing())} className="text-base text-link underline-offset-4 hover:underline">
        No listing? Paste product pages instead
      </button>

      {check.isPending ? <p className="text-sm text-muted-foreground">Reading the listing… {seconds} s</p> : null}

      {found ? (
        // The browser's verdict first (spec 2026-10-09 §A2): a block page or a
        // refusal is never reported as "no products found".
        found.message ? (
          <p role="alert" className="text-sm text-warn">
            {captureWords(found.message, staff)}
          </p>
        ) : found.productLinks === 0 ? (
          <p className="text-sm text-muted-foreground">{NO_PRODUCTS_FOUND} Paste product pages below.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {found.productLinks} {found.productLinks === 1 ? 'product' : 'products'} found{found.pagerSeen ? ' · a pager too' : ''}
          </p>
        )
      ) : null}

      {extractOwnsInput ? (
        <p className="text-sm text-muted-foreground">The Extract tab has its own pages; this listing only finds products to verify on.</p>
      ) : null}

      {check.error ? (
        <p role="alert" className="text-sm text-fail">
          {captureWords(check.error.message, staff)}
        </p>
      ) : null}
    </div>
  );
}
