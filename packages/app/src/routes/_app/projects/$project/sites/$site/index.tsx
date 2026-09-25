import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../components/ui/skeleton';
import { ListingBar } from '../../../../../../components/verification/listing-bar';
import { ProductGrid } from '../../../../../../components/verification/product-grid';
import { PageViewer, type Overlay } from '../../../../../../components/verification/page-viewer';
import { MarkPopover } from '../../../../../../components/verification/mark-popover';
import { FieldsSidebar, type FieldsSidebarRow } from '../../../../../../components/verification/fields-sidebar';
import {
  PRODUCTS_MAX,
  PRODUCTS_MIN,
  answer,
  badge,
  boardFrom,
  canSave,
  dropCard,
  fieldsFor,
  liveSuggestions,
  mergeSuggestions,
  pointable,
  reverifyScope,
  segment,
  setCards,
  setDescription,
  shortUrl,
  toBindingInput,
  validateValue,
  valueFromBox,
  verifyGate,
  productsProblem,
  LISTING_ELSEWHERE,
  type Board,
  type Box,
  type Card,
  type Field,
  type Mark,
  type Suggestions,
} from '../../../../../../lib/site/verification-model';
import { createSaver } from '../../../../../../lib/site/saver';
import { tileHref, useProofCaptures } from '../../../../../../lib/site/use-proof-captures';
import { stripState, verifyButton } from '../../../../../../lib/site/verify-button';
import { verificationState, type VerificationResults } from '../../../../../../lib/site/verification-view';
import { trpc } from '../../../../../../lib/trpc';
import { useSite } from '../$site';

/**
 * What the URL remembers: which product is open (1-based), which field's row
 * is highlighted, and — from a run's "use as proof page" — a page to add.
 *
 * Every key is optional, and the annotation is what makes that true for the
 * router as well: a schema whose properties are required — even as `| undefined`
 * — makes `search` a required prop on every `<Link>` to this route anywhere in
 * the app, sidebar and command palette included.
 */
export type VerificationSearch = { product?: number; field?: string; addPage?: string };

export const Route = createFileRoute('/_app/projects/$project/sites/$site/')({
  validateSearch: (search: Record<string, unknown>): VerificationSearch => {
    const product = typeof search.product === 'number' ? search.product : typeof search.product === 'string' ? Number(search.product) : NaN;
    return {
      ...(Number.isInteger(product) && product >= 1 && product <= PRODUCTS_MAX ? { product } : {}),
      ...(typeof search.field === 'string' ? { field: search.field } : {}),
      ...(typeof search.addPage === 'string' ? { addPage: search.addPage } : {}),
    };
  },
  component: VerificationTab,
});

type SiteData = NonNullable<ReturnType<typeof useSite>['data']>;
type SaveState = 'idle' | 'pending' | 'saving' | 'error';

function definitionOf(schemaDefinition: unknown): Field[] {
  return Array.isArray(schemaDefinition) ? (schemaDefinition as Field[]) : [];
}

const NO_BOXES: Box[] = [];
const NO_TILES: string[] = [];

/**
 * Verification (spec 2026-09-25): find products from a listing, look at each
 * one's screenshot, point at a value and name its field, and prove it. The
 * website layout owns the title and the tab strip; this is the panels.
 */
function VerificationTab() {
  const { project: projectSlug } = Route.useParams();
  const site = useSite();
  const source = site.data;

  if (site.isPending) {
    return (
      <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
        <Skeleton className="h-[22px] w-64 bg-raised" />
        <Skeleton className="mt-3 h-[22px] w-full bg-raised" />
        <Skeleton className="mt-2 h-[22px] w-full bg-raised" />
      </div>
    );
  }
  if (!source) return null; // the layout has already said what went wrong

  if (definitionOf(source.schemaDefinition).length === 0) {
    return (
      <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
        <p className="text-base">This project has no fields yet</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects/$project/fields" params={{ project: projectSlug }}>
            Add fields
          </Link>
        </Button>
      </div>
    );
  }

  // Keyed on the website: the board is seeded once per mount, and the
  // captures hook keeps what it started — a website switch must start over.
  return <VerificationBody key={source.id} source={source} />;
}

/** The first box in `boxes` a stored mark points at — by XPath, else by the very same rectangle. */
function boxOfMark(boxes: Box[], mark: Mark | null): number | null {
  if (!mark) return null;
  const byXpath = boxes.findIndex((b) => b.xpaths.some((x) => mark.xpaths.includes(x)));
  if (byXpath >= 0) return byXpath;
  const r = mark.rect;
  const byRect = boxes.findIndex((b) => b.rect.x === r.x && b.rect.y === r.y && b.rect.w === r.w && b.rect.h === r.h);
  return byRect >= 0 ? byRect : null;
}

/** What each drawn rectangle stands for, so a click on it knows which field and which kind. */
type OverlayInfo = { fieldKey: string; kind: 'answer' | 'suggestion' };

type Popover = { url: string; box: number; at: { x: number; y: number }; mode: 'pick' | 'answer' | 'suggestion'; key?: string };

function VerificationBody({ source }: { source: SiteData }) {
  const { project: projectSlug, site: siteSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const sourceId = source.id;

  // A fresh array only when the project's field list itself changes.
  const fields = useMemo(() => definitionOf(source.schemaDefinition), [source.schemaDefinition]);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // Seeded once; afterwards local state is the truth — a background refetch of
  // the website must never clobber an answer being given.
  const [board, setBoard] = useState<Board>(() => boardFrom(source));
  const seededBoard = useRef(board);
  const boardRef = useRef(board);
  boardRef.current = board;

  /** The listing's products not on a card yet: what × and + draw from. Never saved (spec §5). */
  const [queue, setQueue] = useState<Card[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [popover, setPopover] = useState<Popover | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [arrival, setArrival] = useState<{ url: string; field?: string; note?: string } | null>(null);
  /** Why the last listing was refused, shown under the listing input. */
  const [listingNote, setListingNote] = useState<string | null>(null);

  // --- Invalidation: a save moves which fields are current (plan 3's reason),
  // and the project page's per-website badge reads the same currency.
  const invalidate = useCallback(
    () =>
      Promise.all([
        utils.sources.get.invalidate({ projectSlug, sourceSlug: siteSlug }),
        utils.projects.get.invalidate(),
        utils.sources.verifyEstimate.invalidate({ sourceId }),
        utils.sources.verificationStatus.invalidate({ sourceId }),
      ]).then(() => undefined),
    [utils, projectSlug, siteSlug, sourceId],
  );
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  // --- Autosave. Made in an effect rather than a memo so that a dev-mode
  // double mount (whose cleanup disposes the saver) gets a live one back.
  const saverRef = useRef<ReturnType<typeof createSaver<Board>> | null>(null);
  useEffect(() => {
    const saver = createSaver<Board>({
      delay: 600,
      save: (b) =>
        utils.client.sources.updateBinding
          .mutate({ sourceId, ...toBindingInput(b, fieldsRef.current) })
          .then(() => invalidateRef.current()),
      onState: setSaveState,
    });
    saverRef.current = saver;
    return () => {
      saverRef.current = null;
      // dispose() alone would drop a change still waiting out its debounce.
      void saver
        .flush()
        .catch(() => {})
        .finally(() => saver.dispose());
    };
  }, [utils, sourceId]);

  useEffect(() => {
    if (board === seededBoard.current) return; // the seed is what the server already has
    if (canSave(board)) saverRef.current?.push(board);
  }, [board]);

  // --- Verification status (plan 3's polling and stall rules).
  const stallQuery = trpc.sources.verifyEstimate.useQuery({ sourceId });
  const stallMs = stallQuery.data?.stallMs;
  const statusQuery = trpc.sources.verificationStatus.useQuery(
    { sourceId },
    {
      // Only while genuinely active: a stalled row is never coming back on its
      // own, and polling it forever is what used to wedge this screen.
      refetchInterval: (query) => (verificationState(query.state.data ?? null, { stallMs }) === 'active' ? 3000 : false),
    },
  );
  const status = statusQuery.data ?? null;
  const results = (status?.results ?? null) as VerificationResults | null;
  const strip = stripState({ verification: verificationState(status, { stallMs }), results });
  const active = strip === 'active';
  const locked = active || verifying;
  const currentKeys = useMemo(() => status?.currentKeys ?? [], [status?.currentKeys]);
  // A failure is shown only while the field still reads as it did when it failed.
  const unchangedKeys = useMemo(() => status?.unchangedKeys ?? [], [status?.unchangedKeys]);

  // A run that lands while the tab is open refreshes what it changed.
  const sawActive = useRef(false);
  useEffect(() => {
    if (active) {
      sawActive.current = true;
      return;
    }
    if (sawActive.current) {
      sawActive.current = false;
      void invalidateRef.current();
    }
  }, [active]);

  // --- Captures, one per product with a page.
  const urls = useMemo(() => board.cards.map((c) => c.url).filter((u) => u.trim() !== ''), [board.cards]);
  const captures = useProofCaptures(sourceId, urls);
  const captureIdsKey = JSON.stringify(captures.captureIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const captureIds = useMemo(() => captures.captureIds, [captureIdsKey]);
  const capturedUrls = urls.filter((u) => captures.byUrl[u]?.status === 'captured');

  // --- Suggestions from page data: one `suggestMarks` per captured product,
  // merged once per capture (a × must not be undone by a refetch).
  const suggestQueries = trpc.useQueries((t) =>
    capturedUrls.map((u) =>
      t.sources.suggestMarks({ captureId: captures.byUrl[u]!.captureId }, { staleTime: Infinity, refetchOnWindowFocus: false, retry: false }),
    ),
  );
  const mergedCaptures = useRef(new Set<string>());
  const suggestKey = suggestQueries.map((q) => q.data?.captureId ?? '').join(',');
  useEffect(() => {
    const landed = suggestQueries.map((q) => q.data).filter((d): d is NonNullable<typeof d> => !!d && !mergedCaptures.current.has(d.captureId));
    if (landed.length === 0) return;
    for (const d of landed) mergedCaptures.current.add(d.captureId);
    setSuggestions((prev) =>
      landed.reduce((acc, d) => {
        const url = Object.keys(captureIds).find((u) => captureIds[u] === d.captureId);
        if (!url) return acc;
        // A value no element shows (no boxes) is kept: it is offered on the
        // field's row rather than on the screenshot (spec §2.3).
        const incoming = Object.fromEntries(Object.entries(d.fields).map(([k, s]) => [k, s ? { value: s.value, boxes: s.boxes } : null]));
        return mergeSuggestions(acc, incoming, url, d.captureId, 'page-data', boardRef.current);
      }, prev),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey, captureIds]);

  /** What is drawn and counted: never an answered cell, never a stale capture's. */
  const live = useMemo(() => liveSuggestions(suggestions, board, captureIds), [suggestions, board, captureIds]);

  // --- Carry a tick to every other captured product, for that field only.
  const transfer = trpc.sources.transferMarks.useMutation();
  function carry(key: string, url: string, a: { value: string; mark: Mark | null }) {
    const b = boardRef.current;
    const toUrls = b.cards
      .map((c) => c.url)
      .filter((u) => u !== url && u.trim() !== '' && captures.byUrl[u]?.status === 'captured' && !b.answers[key]?.[u]);
    if (toUrls.length === 0) return;
    setTransferNote(null);
    transfer
      .mutateAsync({ sourceId, fromUrl: url, toUrls, fieldKeys: [key], from: { [key]: { value: a.value, ...(a.mark ? { mark: a.mark } : {}) } } })
      .then((out) => {
        setSuggestions((prev) => {
          let next = prev;
          for (const [u, r] of Object.entries(out)) {
            const t = r?.fields[key];
            if (!r || !t) continue;
            next = mergeSuggestions(next, { [key]: { value: t.value, boxes: t.boxes } }, u, r.captureId, 'from-product', boardRef.current);
          }
          return next;
        });
      })
      .catch(() => {
        const name = fieldsRef.current.find((f) => f.key === key)?.name ?? key;
        setTransferNote(`Could not carry ${name} to the other products; mark it on each one`);
      });
  }

  // --- Selection.
  const selected = Math.min(Math.max((search.product ?? 1) - 1, 0), Math.max(board.cards.length - 1, 0));
  const selectedUrl = board.cards[selected]?.url ?? '';
  const fieldKey = search.field ? (fields.find((f) => f.key === search.field) ?? fields.find((f) => f.name === search.field))?.key : undefined;

  const select = useCallback(
    (next: { product?: number; field?: string | null }) =>
      void navigate({
        to: '/projects/$project/sites/$site',
        params: { project: projectSlug, site: siteSlug },
        search: (s) => {
          const out: VerificationSearch = { ...s };
          if (next.product !== undefined) out.product = next.product;
          if (next.field === null) delete out.field;
          else if (next.field !== undefined) out.field = next.field;
          return out;
        },
        replace: true,
      }),
    [navigate, projectSlug, siteSlug],
  );

  // --- The board's edits.
  function hostProblem(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return 'Paste the full address, starting with https://';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Paste the full address, starting with https://';
    const others = boardRef.current.cards.map((c) => c.url.trim()).filter(Boolean);
    if (others.includes(url.trim())) return 'This product is already on the list';
    // The listing counts too: the server saves one website, listing included.
    const listing = boardRef.current.listingUrl.trim();
    if (listing) {
      try {
        if (new URL(listing).hostname.toLowerCase() !== parsed.hostname.toLowerCase()) return 'This product is not on the same website as the listing';
      } catch {
        /* a stored listing that is not a URL says nothing about this one */
      }
    }
    for (const o of others) {
      try {
        if (new URL(o).hostname.toLowerCase() !== parsed.hostname.toLowerCase()) return 'All products must be on the same website';
      } catch {
        /* a stored card that is not a URL says nothing about this one */
      }
    }
    return null;
  }

  /**
   * Why this listing cannot join these products, or null. The server counts
   * the listing's website in its one-website rule even for an autosave, so a
   * listing elsewhere would make every save fail (final review I4): refused
   * here, where it is typed, rather than kept and failing quietly.
   */
  function listingRefusal(listingUrl: string): string | null {
    if (listingUrl.trim() === '') return null;
    let listingHost: string;
    try {
      const u = new URL(listingUrl.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Paste the full listing address, starting with https://';
      listingHost = u.hostname.toLowerCase();
    } catch {
      return 'Paste the full listing address, starting with https://';
    }
    for (const c of boardRef.current.cards) {
      try {
        if (c.url.trim() && new URL(c.url.trim()).hostname.toLowerCase() !== listingHost) return LISTING_ELSEWHERE;
      } catch {
        /* a card that is not a URL says nothing about the listing */
      }
    }
    return null;
  }

  function onFound(listingUrl: string, products: Card[]) {
    const refused = listingRefusal(listingUrl);
    setListingNote(refused);
    if (refused) return;
    const b = boardRef.current;
    const onBoard = new Set(b.cards.map((c) => c.url));
    const fresh = products.filter((p) => !onBoard.has(p.url));
    // Cards already there keep their answers; blank ones are filled; the grid
    // is topped up to three; everything else waits in the queue.
    const cards = b.cards.map((c) => (c.url.trim() === '' && fresh.length > 0 ? fresh.shift()! : c));
    while (cards.length < PRODUCTS_MIN && fresh.length > 0) cards.push(fresh.shift()!);
    setBoard({ ...setCards(b, cards), listingUrl });
    setQueue(fresh);
  }

  function onNoListing(listingUrl: string) {
    const b = boardRef.current;
    // The listing URL is kept either way (spec §2.1) — unless it cannot be saved
    // with these products, when the old one stays and the input says why.
    const refused = listingRefusal(listingUrl);
    setListingNote(refused);
    const keep = !refused && listingUrl && listingUrl !== b.listingUrl;
    const withListing = keep ? { ...b, listingUrl } : b;
    if (b.cards.length >= PRODUCTS_MIN) {
      if (withListing !== b) setBoard(withListing);
      return;
    }
    const blanks = Array.from({ length: PRODUCTS_MIN - b.cards.length }, () => ({ url: '', title: '' }));
    setBoard(setCards(withListing, [...b.cards, ...blanks]));
  }

  function onDrop(i: number) {
    const b = boardRef.current;
    const [next, ...rest] = queue;
    let cards = dropCard(b, i).cards;
    if (next) {
      cards = [...cards.slice(0, i), next, ...cards.slice(i)];
      setQueue(rest);
    } else if (cards.length < PRODUCTS_MIN) {
      cards = [...cards.slice(0, i), { url: '', title: '' }, ...cards.slice(i)];
    }
    setBoard(setCards(b, cards));
    setPopover(null);
  }

  function onAdd(url?: string) {
    const b = boardRef.current;
    if (b.cards.length >= PRODUCTS_MAX) return;
    let card: Card | undefined;
    if (url) card = { url, title: shortUrl(url) };
    else {
      card = queue[0];
      setQueue((q) => q.slice(1));
    }
    if (!card) return;
    setBoard(setCards(b, [...b.cards, card]));
    select({ product: b.cards.length + 1 });
  }

  function onReplace(i: number, url: string) {
    const b = boardRef.current;
    setBoard(setCards(b, b.cards.map((c, j) => (j === i ? { url, title: shortUrl(url) } : c))));
  }

  // --- The selected product's screenshot. Tiles and boxes keep their identity
  // while the capture does: the viewer resets hover and scale when they change.
  const capture = selectedUrl ? captures.byUrl[selectedUrl] : undefined;
  const rawTiles = capture?.tiles;
  const tiles = useMemo(() => (rawTiles ?? NO_TILES).map((t) => tileHref(t)).filter((t): t is string => !!t), [rawTiles]);
  const boxes = capture?.boxes ?? NO_BOXES;

  function failedCell(key: string, url: string): boolean {
    return unchangedKeys.includes(key) && results?.[key]?.cells[url]?.status === 'fail';
  }

  const { overlays, overlayInfo } = useMemo(() => {
    const list: Overlay[] = [];
    const info = new Map<string, OverlayInfo>();
    if (!selectedUrl || boxes.length === 0) return { overlays: list, overlayInfo: info };
    for (const f of fields) {
      const a = board.answers[f.key]?.[selectedUrl];
      if (a) {
        const i = boxOfMark(boxes, a.mark);
        if (i === null) continue;
        const key = `a|${f.key}|${i}`;
        list.push({ box: i, label: f.name, tone: failedCell(f.key, selectedUrl) ? 'failed' : 'answered', key });
        info.set(key, { fieldKey: f.key, kind: 'answer' });
        continue;
      }
      const s = live[f.key]?.[selectedUrl];
      if (!s) continue;
      for (const i of pointable(boxes, s.boxes)) {
        const key = `s|${f.key}|${i}`;
        list.push({ box: i, label: f.name, tone: 'suggested', key });
        info.set(key, { fieldKey: f.key, kind: 'suggestion' });
      }
    }
    return { overlays: list, overlayInfo: info };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, board.answers, live, selectedUrl, boxes, results, unchangedKeys]);

  const highlight = fieldKey && selectedUrl ? boxOfMark(boxes, board.answers[fieldKey]?.[selectedUrl]?.mark ?? null) : null;

  // --- Marking.
  function tick(key: string) {
    const pop = popover;
    if (!pop) return;
    const field = fields.find((f) => f.key === key);
    const box = boxes[pop.box];
    if (!field || !box || pop.url !== selectedUrl) return;
    const read = valueFromBox(box, field.type);
    let given: { value: string; mark: Mark | null };
    if (pop.mode === 'suggestion' && pop.key === key && live[key]?.[pop.url]) {
      given = { value: live[key]![pop.url]!.value, mark: 'error' in read ? null : read.mark };
    } else {
      if ('error' in read) return;
      given = read;
    }
    setBoard((b) => {
      // One element answers one field: whatever else this element answered here goes.
      let next = b;
      for (const f of fields) {
        if (f.key === key) continue;
        const other = next.answers[f.key]?.[pop.url];
        if (other && boxOfMark(boxes, other.mark) === pop.box) next = answer(next, f.key, pop.url, null);
      }
      return answer(next, key, pop.url, given);
    });
    setPopover(null);
    select({ field: key });
    carry(key, pop.url, given);
  }

  const popoverView = (() => {
    if (!popover || popover.url !== selectedUrl) return null;
    const box = boxes[popover.box];
    if (!box) return null;
    const rows = fieldsFor(box, fields, board, popover.url);
    const initialKey = popover.key ?? rows[0]?.field.key;
    const initial = fields.find((f) => f.key === initialKey);
    let value = '';
    let err: string | undefined;
    if (initial) {
      const sug = popover.mode === 'suggestion' ? live[initial.key]?.[popover.url] : undefined;
      if (sug) {
        value = sug.value;
        err = validateValue(initial.type, value) ?? undefined;
      } else {
        const r = valueFromBox(box, initial.type);
        if ('error' in r) err = r.error;
        else {
          value = r.value;
          err = validateValue(initial.type, r.value) ?? undefined;
        }
      }
    }
    const pop = popover;
    return (
      <MarkPopover
        open
        at={pop.at}
        box={box}
        value={value}
        error={err}
        fields={rows}
        initialKey={initialKey}
        onTick={tick}
        onRemove={
          pop.mode === 'answer' && pop.key
            ? () => {
                setBoard((b) => answer(b, pop.key!, pop.url, null));
                setPopover(null);
              }
            : undefined
        }
        onReject={
          pop.mode === 'suggestion' && pop.key
            ? () => {
                setSuggestions((s) => {
                  const byUrl = { ...(s[pop.key!] ?? {}) };
                  delete byUrl[pop.url];
                  return { ...s, [pop.key!]: byUrl };
                });
                setPopover(null);
              }
            : undefined
        }
        onClose={() => setPopover(null)}
      />
    );
  })();

  // --- Arrival from a run: `?addPage=<url>&field=<key>`, consumed once, when
  // the board is seeded and no verification holds the grid.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !search.addPage) return;
    if (statusQuery.isPending || active) return;
    arrived.current = true;
    const url = search.addPage;
    const b = boardRef.current;
    const at = b.cards.findIndex((c) => c.url === url);
    let product: number | undefined;
    let note: string | undefined;
    if (at >= 0) product = at + 1;
    else {
      const problem = hostProblem(url);
      const blank = b.cards.findIndex((c) => c.url.trim() === '');
      if (problem) note = problem;
      else if (blank >= 0) {
        setBoard(setCards(b, b.cards.map((c, j) => (j === blank ? { url, title: shortUrl(url) } : c))));
        product = blank + 1;
      } else if (b.cards.length < PRODUCTS_MAX) {
        setBoard(setCards(b, [...b.cards, { url, title: shortUrl(url) }]));
        product = b.cards.length + 1;
      } else note = 'This website already checks six products — drop one to add this page';
    }
    setArrival({ url, ...(search.field ? { field: search.field } : {}), ...(note ? { note } : {}) });
    void navigate({
      to: '/projects/$project/sites/$site',
      params: { project: projectSlug, site: siteSlug },
      search: (s) => {
        const { addPage: _drop, ...rest } = s;
        return { ...rest, ...(product ? { product } : {}) };
      },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.addPage, statusQuery.isPending, active]);

  const arrivalField = arrival?.field ? fields.find((f) => f.key === arrival.field || f.name === arrival.field) : undefined;
  const arrivalPrompt =
    arrival && !arrival.note && arrivalField && selectedUrl === arrival.url && !board.answers[arrivalField.key]?.[selectedUrl]
      ? `Mark ${arrivalField.name} on this product`
      : null;

  // --- Verify.
  const problem = productsProblem(board);
  const gate: ReturnType<typeof verifyGate> = problem ? { ok: false, reason: problem } : verifyGate(board, fields, live);
  // A reason that lives on a field's row (its descriptor) opens that row, once per new reason.
  const gateField = gate.ok ? undefined : gate.field;
  useEffect(() => {
    if (gateField) setExpanded((e) => (e[gateField] ? e : { ...e, [gateField]: true }));
  }, [gateField]);
  const scope = reverifyScope(fields, results, currentKeys);
  const firstRun = strip === 'editing' || strip === 'none';
  const estimateQuery = trpc.sources.verifyEstimate.useQuery({ sourceId, ...(firstRun || !scope ? {} : { onlyKeys: scope }) });
  const estimate = estimateQuery.data;
  const button = verifyButton({
    state: strip,
    firstRun,
    fieldCount: fields.length,
    reverifyCount: scope?.length ?? fields.length,
    capturesFresh: !!estimate?.capturesFresh,
    aiAvailable: !!estimate?.aiAvailable,
    upperBoundUsd: estimate?.upperBoundUsd ?? 0,
    complete: gate.ok,
    busy: verifying,
  });
  const verifyMutation = trpc.sources.verify.useMutation();

  async function handleVerify() {
    setError(null);
    setNotice(null);
    setVerifying(true);
    try {
      // The server checks the record it has, so it must have this one.
      await saverRef.current?.flush();
      // The save just moved which fields are current: price the scope on what
      // the server says now, not on the render that drew the button.
      const fresh = utils.sources.verificationStatus.getData({ sourceId }) ?? status;
      const onlyKeys = reverifyScope(fields, (fresh?.results ?? null) as VerificationResults | null, fresh?.currentKeys ?? []);
      if (onlyKeys && onlyKeys.length === 0) {
        // The save put every field back to what was verified: nothing to check, and nothing spent.
        setNotice('Everything is verified; nothing has changed since');
        return;
      }
      await verifyMutation.mutateAsync({ sourceId, ...(onlyKeys ? { onlyKeys } : {}) });
      await invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  // --- The sidebar.
  function rejectSuggestion(key: string, url: string) {
    setSuggestions((s) => {
      const byUrl = { ...(s[key] ?? {}) };
      delete byUrl[url];
      return { ...s, [key]: byUrl };
    });
  }

  /**
   * What the row says about the selected product that the screenshot cannot:
   * a value the page data holds but no element shows (tick it as a typed
   * answer, or ×), or a suggestion outlined in several places.
   */
  function rowHint(f: Field): FieldsSidebarRow['hint'] {
    const s = selectedUrl ? live[f.key]?.[selectedUrl] : undefined;
    if (!s) return undefined;
    const url = selectedUrl;
    // Only elements big enough to click count: a suggestion on nothing but a
    // 1×1 anchor is offered here, like a value no element shows.
    const places = pointable(boxes, s.boxes).length;
    if (places === 0) {
      return {
        text: s.origin === 'page-data' ? 'page data' : 'from another product',
        value: s.value,
        onAccept: () => {
          const given = { value: s.value, mark: null };
          setBoard((b) => answer(b, f.key, url, given));
          select({ field: f.key });
          carry(f.key, url, given);
        },
        onReject: () => rejectSuggestion(f.key, url),
      };
    }
    if (places > 1) {
      return { text: `found in ${places} places — click the right one`, onReject: () => rejectSuggestion(f.key, url) };
    }
    return undefined;
  }

  const rows: FieldsSidebarRow[] = fields.map((f) => {
    const a = selectedUrl ? board.answers[f.key]?.[selectedUrl] : undefined;
    const typed = a && a.mark === null ? a.value : '';
    return {
      field: f,
      segments: board.cards.map((c) => segment(board, live, f.key, c.url, { failed: c.url !== '' && failedCell(f.key, c.url) })),
      badge: badge({ key: f.key, results, unchangedKeys, running: locked, cards: board.cards }),
      selected: fieldKey === f.key,
      productNumber: selected + 1,
      expanded: !!expanded[f.key],
      description: board.descriptions[f.key] ?? f.description,
      typed,
      typedError: typed.trim() !== '' ? (validateValue(f.type, typed) ?? undefined) : undefined,
      hint: rowHint(f),
      onSegment: (i) => {
        setPopover(null);
        select({ product: i + 1, field: f.key });
      },
      onToggle: () => setExpanded((e) => ({ ...e, [f.key]: !e[f.key] })),
      onType: (text) => {
        if (!selectedUrl) return;
        setBoard((b) => answer(b, f.key, selectedUrl, text.trim() ? { value: text, mark: null } : null));
      },
      onDescription: (text) => setBoard((b) => setDescription(b, f.key, text)),
    };
  });

  // Non-null locks the sidebar: from the click, not only once the server says the run is active.
  const stage = active ? (status?.stage ?? 'starting') : verifying ? 'starting' : null;
  const runNote =
    strip === 'stalled' ? 'The last verification stalled. Run it again.' : strip === 'failed' ? (status?.errorMessage ?? 'The last verification failed.') : null;
  const unsaved = board !== seededBoard.current && !canSave(board);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="rise space-y-4 rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
          <ListingBar
            listingUrl={board.listingUrl}
            disabled={locked}
            onFound={(listingUrl, products) => onFound(listingUrl, products)}
            onNoListing={onNoListing}
            extractOwnsInput={typeof (source.parameters as { inputMode?: unknown }).inputMode === 'string'}
            problem={listingNote}
          />
          {board.cards.length > 0 ? (
            <ProductGrid
              cards={board.cards}
              captures={captures.byUrl}
              selected={selected}
              disabled={locked}
              onSelect={(i) => {
                setPopover(null);
                select({ product: i + 1 });
              }}
              onDrop={onDrop}
              onAdd={onAdd}
              onReplace={onReplace}
              canAddFromQueue={queue.length > 0}
              onRetry={captures.retry}
              hostProblem={hostProblem}
            />
          ) : null}
          {unsaved ? <p className="text-sm text-muted-foreground">{problem ? `Not saved: ${problem}` : 'Not saved until every product has a page, all on this website'}</p> : null}
          {locked && active ? <p className="text-sm text-muted-foreground">Products and answers are locked while this verification runs</p> : null}
        </div>

        {runNote ? (
          <p role="alert" className={`border-l-2 pl-3 text-sm ${strip === 'failed' ? 'border-fail text-fail' : 'border-warn text-warn'}`}>
            {runNote}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm whitespace-pre-line text-fail">
            {error}
          </p>
        ) : null}
        {arrival?.note ? <p className="text-sm text-muted-foreground">{arrival.note}</p> : null}
        {transferNote ? <p className="text-sm text-warn">{transferNote}</p> : null}
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
        {arrivalPrompt ? <p className="text-base">{arrivalPrompt}</p> : null}

        <ProductView
          hasCards={board.cards.length > 0}
          url={selectedUrl}
          capture={capture}
          onRetry={() => captures.retry(selectedUrl)}
          locked={locked}
        >
          <PageViewer
            tiles={tiles}
            boxes={boxes}
            pageHeight={capture?.pageHeight ?? 0}
            capturedHeight={capture?.capturedHeight ?? 0}
            overlays={overlays}
            highlight={highlight}
            locked={locked}
            onPick={(box, at) => setPopover({ url: selectedUrl, box, at, mode: 'pick' })}
            onOverlay={(o, at) => {
              const info = overlayInfo.get(o.key);
              if (!info) return;
              setPopover({ url: selectedUrl, box: o.box, at, mode: info.kind, key: info.fieldKey });
              select({ field: info.fieldKey });
            }}
          />
        </ProductView>
        {locked ? null : popoverView}
      </div>

      <div className="space-y-2">
        <FieldsSidebar
          rows={rows}
          verify={{
            label: button.label,
            disabled: button.disabled || locked,
            reason: gate.ok ? button.reason : gate.reason,
            busy: verifying || verifyMutation.isPending,
            onClick: () => void handleVerify(),
          }}
          saveState={saveState}
          extract={{ enabled: !!(status?.current && status?.allPassed), project: projectSlug, site: siteSlug }}
          stage={stage}
        />
        <p className="px-1 text-sm text-muted-foreground">
          Field names and types come from the project.{' '}
          <Link to="/projects/$project/fields" params={{ project: projectSlug }} className="text-link underline-offset-4 hover:underline">
            Edit fields
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Below the grid: the selected product's screenshot once it has landed, and
 * its state until then.
 */
function ProductView({
  hasCards,
  url,
  capture,
  onRetry,
  locked,
  children,
}: {
  hasCards: boolean;
  url: string;
  capture: ReturnType<typeof useProofCaptures>['byUrl'][string];
  onRetry: () => void;
  locked: boolean;
  children: ReactNode;
}) {
  const panel = 'rise rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]';
  if (!hasCards) {
    return <div className={`${panel} text-base text-muted-foreground`}>Find products from a listing page, or paste product pages, to start.</div>;
  }
  if (!url) {
    return <div className={`${panel} text-base text-muted-foreground`}>Paste this product&apos;s page above.</div>;
  }
  if (!capture || capture.status === 'starting' || capture.status === 'capturing') {
    return (
      <div className={panel}>
        <p className="text-sm text-muted-foreground">Taking screenshot…</p>
        <Skeleton className="mt-3 h-[320px] w-full bg-raised" />
      </div>
    );
  }
  if (capture.status === 'failed') {
    return (
      <div className={`${panel} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm text-warn">{capture.error ?? 'The screenshot could not be taken'}</p>
        <Button variant="outline" size="sm" disabled={locked} onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
