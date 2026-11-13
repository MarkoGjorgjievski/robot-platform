import { useEffect, useRef, useState } from 'react';
import { Check, ListPlus, Loader2, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import type { Card } from '../../lib/site/verification-model';
import { NO_PRODUCTS_FOUND } from '../../lib/site/extract-view';
import { captureWords } from '../../lib/capture-words';
import { useStaffDetail } from '../../lib/use-staff-detail';
import { cn } from '../../lib/utils';

/**
 * What Find products is doing while the customer waits, by elapsed seconds. The
 * listing check answers once (one job, no progress events), so these follow the
 * finder's own order — browser, page load (≤ 20 s), pop-ups, up to three rounds
 * of loading more (~10 s), the product cards — and say "still working" past it.
 */
export const FIND_STEPS: { from: number; label: string }[] = [
  { from: 0, label: 'Starting a browser' },
  { from: 3, label: 'Opening the page' },
  { from: 10, label: 'Closing pop-ups and cookie banners' },
  { from: 15, label: 'Scrolling to load more products' },
  { from: 25, label: 'Reading the product cards' },
];

/** What the bar last said for a website, kept for this browser tab's session so it survives a tab switch. */
type LastFind = { url: string; found: { productLinks: number; pagerSeen: boolean; message: string | null } | null; error: string | null };
const lastFinds = new Map<string, LastFind>();

/** The step shown at `seconds`, and a line for a slow website. */
export function findStep(seconds: number): { index: number; slow: boolean } {
  let index = 0;
  FIND_STEPS.forEach((step, i) => {
    if (seconds >= step.from) index = i;
  });
  return { index, slow: seconds >= 45 };
}

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
  openSignal,
  onPendingChange,
  compact,
  onAddProducts,
  onFoundMany,
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
  /**
   * Bumped by Swap product (spec 2026-10-28 §3.6): the bar comes into view with its input focused,
   * filled with the website's listing page when it has one, ready for Find products.
   */
  openSignal?: number;
  /** Find products started or settled — the route shows the product skeleton meanwhile. */
  onPendingChange?: (pending: boolean) => void;
  /**
   * Products are on the board (Marko 2026-11-13): the bar is one slim line — the address, the button, what
   * was found — instead of the centred question a new website opens with.
   */
  compact?: boolean;
  /**
   * Several addresses pasted at once are product pages: the route puts them on the board and answers
   * with one sentence when it left any out, else null.
   */
  onAddProducts?: (urls: string[]) => string | null;
  /**
   * Several listing pages were read (Marko 2026-11-13): the route takes one product from each before a
   * second from any, and answers per listing, in order — how many it put on the board, or why none.
   */
  onFoundMany?: (listings: { url: string; products: Card[] }[]) => { taken: number; note?: string }[];
}) {
  const kept = lastFinds.get(sourceId);
  const [url, setUrl] = useState(kept?.url ?? startUrl ?? listingUrl);
  // "No listing?" with the untouched pre-filled address says that address is not a listing: none is kept.
  const typedListing = () => (!listingUrl.trim() && startUrl && url.trim() === startUrl.trim() ? '' : url.trim());
  // Spec 2026-10-21: a customer reads a failed capture in customer words; staff read it as stored.
  const staff = useStaffDetail();
  const [found, setFound] = useState<LastFind['found']>(kept?.found ?? null);
  // The last failure, kept like `found`: the mutation's own error is gone once the tab remounts.
  const [failure, setFailure] = useState<string | null>(kept?.error ?? null);
  const check = trpc.sources.checkListingPage.useMutation();
  const inputRef = useRef<HTMLInputElement>(null);
  // Two or more addresses in the box are product pages to add, not a listing to read.
  const many = onAddProducts ? splitAddresses(url) : [];
  const adding = many.length >= 2;
  const [addNote, setAddNote] = useState<string | null>(null);
  // Several listings, read one after another: a line per address, kept until the next search.
  const [lines, setLines] = useState<ManyLine[] | null>(null);
  const [readingMany, setReadingMany] = useState(false);

  async function findOnMany() {
    if (!onFoundMany || !adding || readingMany) return;
    const urls = many.slice(0, MANY_MAX);
    setFound(null);
    setFailure(null);
    setAddNote(null);
    lastFinds.delete(sourceId);
    const next: ManyLine[] = urls.map((u) => ({ url: u, state: 'waiting' }));
    const show = (i: number, line: ManyLine) => {
      next[i] = line;
      setLines([...next]);
    };
    setLines([...next]);
    setReadingMany(true);
    const listings: { at: number; url: string; products: Card[] }[] = [];
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i]!;
      show(i, { url: u, state: 'reading' });
      try {
        const data = await check.mutateAsync({ listingUrl: u, sourceId });
        if (data.message) show(i, { url: u, state: 'unread', text: data.message });
        else if (data.productLinks === 0) show(i, { url: u, state: 'none' });
        else {
          show(i, { url: u, state: 'found', productLinks: data.productLinks, taken: 0 });
          listings.push({ at: i, url: u, products: data.products });
        }
      } catch (err) {
        show(i, { url: u, state: 'unread', text: err instanceof Error ? err.message : 'This page could not be read.' });
      }
    }
    if (listings.length > 0) {
      const answers = onFoundMany(listings.map(({ url: u, products }) => ({ url: u, products })));
      listings.forEach((l, k) => {
        const line = next[l.at]!;
        if (line.state === 'found') next[l.at] = { ...line, taken: answers[k]?.taken ?? 0, note: answers[k]?.note };
      });
      setLines([...next]);
      setUrl(listings[0]!.url);
    }
    setReadingMany(false);
  }

  function addProducts() {
    if (!onAddProducts || !adding) return;
    setFound(null);
    setFailure(null);
    setLines(null);
    setAddNote(onAddProducts(many));
    setUrl(listingUrl);
  }

  useEffect(() => {
    if (!openSignal) return;
    const listing = listingUrl.trim() || startUrl?.trim() || '';
    if (listing) setUrl(listing);
    const input = inputRef.current;
    if (!input) return;
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus({ preventScroll: true });
    // Only a new signal opens the bar; the listing it fills in is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

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

  useEffect(() => {
    onPendingChange?.(check.isPending);
    // Only the pending flag drives this; the callback is the route's and may change identity per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.isPending]);

  function findProducts() {
    const trimmed = url.trim();
    if (trimmed === '') return;
    setFound(null);
    setFailure(null);
    setLines(null);
    lastFinds.delete(sourceId);
    check.mutate(
      { listingUrl: trimmed, sourceId },
      {
        onSuccess: (data) => {
          const answer = { productLinks: data.productLinks, pagerSeen: data.pagerSeen, message: data.message };
          setFound(answer);
          lastFinds.set(sourceId, { url: trimmed, found: answer, error: null });
          // A page we could not read (a wall, no browser) says so and leaves the board alone: only a page
          // that was read and had no products switches to pasting product pages.
          if (data.message) return;
          if (data.productLinks === 0) {
            onNoListing(trimmed);
          } else {
            onFound(trimmed, data.products, { productLinks: data.productLinks, pagerSeen: data.pagerSeen });
          }
        },
        onError: (err) => {
          setFailure(err.message);
          lastFinds.set(sourceId, { url: trimmed, found: null, error: err.message });
        },
      },
    );
  }

  const step = findStep(seconds);
  const hero = !compact;
  // Centred under the question; in line with the address once the bar is slim.
  const note = hero ? 'text-center text-sm' : 'text-sm';

  const noListing = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onNoListing(typedListing())}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-line-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
    >
      <ListPlus className="size-3.5" aria-hidden />
      No listing? Paste product pages instead
    </button>
  );

  const summary = found ? (
    // The browser's verdict first (spec 2026-10-09 §A2): a block page or a
    // refusal is never reported as "no products found".
    found.message ? (
      <p role="alert" className={cn(note, 'text-warn')}>
        {captureWords(found.message, staff)}
      </p>
    ) : found.productLinks === 0 ? (
      <p className={cn(note, 'text-muted-foreground')}>{NO_PRODUCTS_FOUND} Paste product pages below.</p>
    ) : (
      <p className={cn(note, 'text-muted-foreground')}>
        {found.productLinks} {found.productLinks === 1 ? 'product' : 'products'} found{found.pagerSeen ? ' · a pager too' : ''}
      </p>
    )
  ) : null;

  return (
    <div className={hero ? 'relative space-y-4 px-2 py-6 sm:py-8' : 'relative space-y-2'}>
      {/* The question a new website opens with; gone once there are products, when the bar is one line. */}
      {hero ? (
        <div className="mx-auto max-w-[560px] space-y-1.5 text-center">
          <h2 className="text-xl font-semibold tracking-[-0.011em]">Where are the products?</h2>
          <p className="text-base text-muted-foreground">Paste a category or search results page — we&apos;ll find the products on it. You can paste several addresses at once, separated by commas, spaces or new lines.</p>
        </div>
      ) : null}

      <div className={hero ? undefined : 'flex flex-wrap items-center gap-x-3 gap-y-2'}>
        <div
          className={cn(
            'flex items-center gap-2 rounded-[10px] border border-line bg-bg/70 pr-1.5 pl-3 transition-colors focus-within:border-text',
            hero ? 'mx-auto h-12 max-w-[720px]' : 'h-10 min-w-[280px] flex-1',
            disabled && 'opacity-60',
          )}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setAddNote(null);
            }}
            onPaste={(e) => {
              // A one-line box drops the line breaks of a pasted list: keep its addresses apart.
              if (!onAddProducts) return;
              const pasted = splitAddresses(e.clipboardData.getData('text'));
              if (pasted.length < 2) return;
              e.preventDefault();
              setUrl(pasted.join(' '));
              setAddNote(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (adding) void findOnMany();
                else findProducts();
              }
            }}
            disabled={disabled}
            placeholder="Paste a listing page — a category or search results"
            aria-label="Listing page"
            className="h-full flex-1 border-0 bg-transparent px-1 font-mono focus-visible:border-0 disabled:opacity-100 dark:bg-transparent"
          />
          {adding ? (
            <>
              <Button size="sm" variant="outline" disabled={disabled || readingMany} onClick={addProducts} className="shrink-0">
                <ListPlus />
                Add as {many.length} products
              </Button>
              <Button size="sm" disabled={disabled || readingMany} onClick={() => void findOnMany()} className="shrink-0">
                {readingMany ? <Loader2 className="animate-spin" /> : <Search />}
                Find products on {Math.min(many.length, MANY_MAX)} pages
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={disabled || check.isPending || url.trim() === ''} onClick={findProducts} className="shrink-0">
              {check.isPending ? <Loader2 className="animate-spin" /> : <Search />}
              Find products
            </Button>
          )}
        </div>
        {hero ? null : noListing}
        {hero ? null : summary}
      </div>

      {hero ? <div className="flex flex-wrap items-center justify-center gap-2">{noListing}</div> : null}

      {adding && !readingMany ? (
        <p className={cn(note, 'text-muted-foreground')}>
          {many.length} addresses. If they are listing pages, Find products takes one product from each, so the products you check come from different parts of the
          website. If they are product pages, add them as they are.{many.length > MANY_MAX ? ` Only the first ${MANY_MAX} listing pages are read.` : ''}
        </p>
      ) : null}

      {lines ? (
        <ul className={cn('space-y-0.5 text-sm', hero && 'mx-auto max-w-[720px]')}>
          {lines.map((l) => (
            <li key={l.url} className="flex min-w-0 items-baseline gap-2">
              <span className="max-w-[45%] shrink-0 truncate font-mono text-muted-foreground" title={l.url}>
                {listingLabel(l.url)}
              </span>
              {l.state === 'waiting' ? <span className="text-muted-foreground/60">waiting</span> : null}
              {l.state === 'reading' ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  reading…
                </span>
              ) : null}
              {l.state === 'none' ? <span className="text-muted-foreground">{NO_PRODUCTS_FOUND}</span> : null}
              {l.state === 'unread' ? <span className="min-w-0 text-warn">{captureWords(l.text, staff)}</span> : null}
              {l.state === 'found' ? (
                <span className={l.note ? 'min-w-0 text-warn' : 'min-w-0'}>
                  {l.productLinks} {l.productLinks === 1 ? 'product' : 'products'}
                  {readingMany ? '' : l.note ? ` · ${l.note}` : ` · ${l.taken} taken${l.taken === 0 ? ', the rest wait for × and Add product' : ''}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {lines && !readingMany && lines.filter((l) => l.state === 'found' && !l.note).length > 1 ? (
        <p className={cn(note, 'text-muted-foreground')}>
          {extractOwnsInput
            ? 'These listings are kept for checking this website. What a run extracts is still set on the Extract tab.'
            : 'All of these listings are kept: a run extracts from each of them, and the check after Verify samples products from all of them.'}
        </p>
      ) : null}
      {addNote ? (
        <p role="alert" className={cn(note, 'text-warn')}>
          {addNote}
        </p>
      ) : null}

      {problem ? (
        <p role="alert" className={cn(note, 'text-fail')}>
          {problem}
        </p>
      ) : null}

      {check.isPending ? (
        <div role="status" aria-live="polite" className={cn('space-y-2', hero && 'mx-auto max-w-[720px]')}>
          <div className="h-0.5 overflow-hidden rounded-full bg-raised">
            <div className="find-progress h-full w-1/3 rounded-full bg-text/60" />
          </div>
          <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {FIND_STEPS.map((s, i) => (
              <li
                key={s.label}
                className={cn(
                  'inline-flex items-center gap-1.5',
                  i < step.index ? 'text-muted-foreground' : i === step.index ? 'text-text' : 'text-muted-foreground/50',
                )}
              >
                {i < step.index ? (
                  <Check className="size-3.5" aria-hidden />
                ) : i === step.index ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                )}
                {s.label}
                {i === step.index ? '…' : ''}
              </li>
            ))}
            <li className="ml-auto font-mono text-muted-foreground tabular-nums">{seconds} s</li>
          </ol>
          {step.slow ? <p className="text-sm text-muted-foreground">This website is slow to answer — still reading. It can take up to a minute and a half.</p> : null}
        </div>
      ) : null}

      {hero ? summary : null}

      {extractOwnsInput ? <p className={cn(note, 'text-muted-foreground')}>The Extract tab has its own pages; this listing only finds products to verify on.</p> : null}

      {failure && !check.isPending ? (
        <p role="alert" className={cn(note, 'text-fail')}>
          {captureWords(failure, staff)}
        </p>
      ) : null}
    </div>
  );
}

/** At most this many listing pages are read in one go: each is a page load, one after another. */
const MANY_MAX = 6;

/** One pasted listing address while several are read, and what came of it. */
type ManyLine =
  | { url: string; state: 'waiting' | 'reading' | 'none' }
  | { url: string; state: 'unread'; text: string }
  | { url: string; state: 'found'; productLinks: number; taken: number; note?: string };

/** A listing in a few words: the last part of its path ("cabinets-10409"), else its host. */
export function listingLabel(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

/** The addresses in a pasted or typed text: split on white space and commas, blanks dropped. */
export function splitAddresses(text: string): string[] {
  return text.split(/[\s,]+/).filter((t) => t !== '');
}
