import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, ShieldCheck, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { trpc } from '../../lib/trpc';
import { createSaver, saveErrorReason } from '../../lib/site/saver';
import { useProofCaptures, type ProofCapture } from '../../lib/site/use-proof-captures';
import {
  confirmAnswer,
  fittingAnswers,
  reuseListAnswer,
  spotRows,
  stripColumnsFromProduct,
  variantCells,
  type SpotRow,
  type VariantAnswer,
  type VariantCell,
  type VariantResultView,
  type VariantsNeed,
} from '../../lib/site/variants-row-view';
import type { DetectResult, DetectedLinks } from '../../lib/site/variants-view';

/** How many confirmed labels a column lists before "and {k} more". */
const LABELS_SHOWN = 8;

type Saver = ReturnType<typeof createSaver<VariantAnswer | null>>;

/** `saveVariantAnswer`'s input: the same answer, with the list's source narrowed to what the server accepts. */
function toInput(a: VariantAnswer | null) {
  if (!a) return null;
  const { list, ...rest } = a;
  return list ? { ...rest, list: { source: list.source as 'json-ld' | 'api', path: list.path } } : rest;
}

/**
 * The website's variant answers, as the customer is giving them: the server's
 * (`verificationSet.variants`), with every unsaved change laid over them. One
 * saver per product, 300 ms after the last change, newest answer wins — the
 * fields' autosave pattern (`saver.ts`). After every save, `sources.get` and
 * `sources.verificationStatus` are invalidated; a change is dropped from the
 * overlay only once the refetched server copy carries it.
 */
export function useVariantAnswers(sourceId: string, server: Record<string, VariantAnswer>) {
  const utils = trpc.useUtils();
  const [overrides, setOverrides] = useState<Record<string, VariantAnswer | null>>({});
  /** Each product's last failed save, by url: cleared only by that product's own next successful save. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const savers = useRef(new Map<string, Saver>());

  useEffect(() => {
    const map = savers.current;
    return () => {
      // A change still waiting out its debounce must reach the server.
      for (const s of map.values()) void s.flush().catch(() => {}).finally(() => s.dispose());
      map.clear();
    };
  }, [sourceId]);

  const saverFor = useCallback(
    (url: string): Saver => {
      let s = savers.current.get(url);
      if (!s) {
        s = createSaver<VariantAnswer | null>({
          delay: 300,
          save: async (answer) => {
            try {
              await utils.client.sources.saveVariantAnswer.mutate({ sourceId, url, answer: toInput(answer) });
              setErrors((all) => {
                if (!(url in all)) return all;
                const next = { ...all };
                delete next[url];
                return next;
              });
            } catch (e) {
              setErrors((all) => ({ ...all, [url]: saveErrorReason(e) }));
              throw e;
            }
            await Promise.all([utils.sources.get.invalidate(), utils.sources.verificationStatus.invalidate({ sourceId })]);
            setOverrides((o) => {
              if (!(url in o) || o[url] !== answer) return o;
              const next = { ...o };
              delete next[url];
              return next;
            });
          },
        });
        savers.current.set(url, s);
      }
      return s;
    },
    [utils, sourceId],
  );

  /** Lays `answer` over the server's and saves it — now (`flush`) when the caller needs it on the server before going on. */
  const save = useCallback(
    (url: string, answer: VariantAnswer | null, now = false): Promise<void> => {
      setOverrides((o) => ({ ...o, [url]: answer }));
      const s = saverFor(url);
      s.push(answer);
      return now ? s.flush() : Promise.resolve();
    },
    [saverFor],
  );

  const flush = useCallback(() => Promise.all([...savers.current.values()].map((s) => s.flush())).then(() => undefined), []);

  const answers = useMemo(() => {
    const out = { ...server };
    for (const [url, a] of Object.entries(overrides)) {
      if (a) out[url] = a;
      else delete out[url];
    }
    return out;
  }, [server, overrides]);

  return { answers, save, flush, errors };
}

export type VariantsRowProps = {
  sourceId: string;
  method: 'list' | 'links';
  /** One per product column, in order; '' for a column with no page yet. */
  urls: string[];
  noun: string;
  detection: DetectResult | null;
  answers: Record<string, VariantAnswer>;
  result: VariantResultView | null;
  resultCurrent: boolean;
  need: VariantsNeed;
  /** The last variant check passed and is current. */
  passed: boolean;
  /** The variant-level fields and mapped columns, contract order then columns. */
  entryFields: Array<{ key: string; name: string }>;
  /** `entryFields`' keys that are mapped columns (axis entry fields) — these can never read "From the product page". */
  columnKeys: string[];
  save: (url: string, answer: VariantAnswer | null, now?: boolean) => Promise<void>;
  /** Each product's last failed save, by url. */
  saveErrors: Record<string, string>;
  /** The proof pages' own captures: a checked variant page that is itself a proof page reads its state from here. */
  proofCaptures: Record<string, ProofCapture | undefined>;
  onRetryProof: (url: string) => void;
  /** The product whose screenshot is in mark mode for its variant buttons, and the element clicked there. */
  mark: { url: string; xpath?: string } | null;
  onMark: (url: string) => void;
  onMarkDone: () => void;
};

const CELL_BORDER: Record<VariantCell['kind'], string> = {
  waiting: 'border-line',
  found: 'border-warn',
  'none-found': 'border-line',
  confirmed: 'border-pass',
  'confirmed-none': 'border-pass',
  failed: 'border-fail',
};

const SPOT_BORDER: Record<SpotRow['state'], string> = {
  suggested: 'border-warn',
  confirmed: 'border-pass',
  'from-product': 'border-pass',
  'needs-you': 'border-line',
};

const td = 'w-[190px] border-t border-line p-0 align-top';
const th = 'sticky left-0 z-10 w-[180px] border-t border-line bg-panel px-2 py-2 text-left align-top font-normal';

function LabelList({ labels, count, checked, onCheck, locked, product }: { labels: string[]; count: number; checked?: number; onCheck?: (i: number) => void; locked: boolean; product: number }) {
  const shown = labels.slice(0, LABELS_SHOWN);
  const more = Math.max(count - shown.length, 0);
  return (
    <ul className="space-y-0.5">
      {shown.map((label, i) => (
        <li key={i} className="flex min-w-0 items-center justify-between gap-1">
          <span className={cn('min-w-0 truncate font-mono text-sm', checked === i ? 'text-text' : 'text-muted-foreground')} title={label}>
            {label}
          </span>
          {onCheck ? (
            checked === i ? (
              <span className="shrink-0 text-sm text-muted-foreground">checked</span>
            ) : (
              <Button variant="ghost" size="xs" disabled={locked} aria-label={`Check ${label} on product ${product}`} onClick={() => onCheck(i)} className="h-5 shrink-0 px-1 text-sm">
                Check this one
              </Button>
            )
          ) : null}
        </li>
      ))}
      {more > 0 ? <li className="text-sm text-muted-foreground">and {more} more</li> : null}
    </ul>
  );
}

/**
 * The Verification table's Variants row (spec 2026-10-01 §4.1): one cell per
 * product saying how many variants it has — orange until confirmed with its
 * ✓, green once confirmed, grey when nothing was found, red with the page's
 * message after a failed Verify. Expanded, each product's column lists what
 * was confirmed, offers "Not right?", and checks one variant: for a list, a
 * sub-row per entry field (accept, type, or take it from the product page);
 * for linked pages, the checked variant page's screenshot.
 *
 * Rows of the table's own `<tbody>`, with the table's columns: the caller
 * says whether an add-product column follows the products.
 */
export function VariantsRow({ props, locked, hasAddHead }: { props: VariantsRowProps; locked: boolean; hasAddHead: boolean }) {
  const { sourceId, method, urls, noun, detection, result, resultCurrent, need, passed, entryFields, columnKeys, save, saveErrors, proofCaptures, onRetryProof, mark, onMark, onMarkDone } = props;
  // An answer given under the other method reads as unanswered everywhere in the row (final review I3).
  const answers = fittingAnswers(method, props.answers);
  const [expanded, setExpanded] = useState(false);
  const [notRight, setNotRight] = useState<Record<string, boolean>>({});
  const filled = urls.filter((u) => u.trim() !== '');
  const cells = variantCells({ method, urls: filled, detection, answers, result, resultCurrent, noun });
  const pageOf = (url: string) => detection?.pages.find((p) => p.url === url) ?? null;
  const singular = noun.replace(/s$/, '');

  // --- List method: each confirmed list, read off the product's capture, for its labels and suggestions.
  const listUrls = method === 'list' ? filled.filter((u) => (answers[u]?.count ?? 0) > 0 && answers[u]?.list) : [];
  const lists = trpc.useQueries((t) =>
    listUrls.map((u) =>
      t.sources.variantList(
        { sourceId, url: u, list: { source: answers[u]!.list!.source as 'json-ld' | 'api', path: answers[u]!.list!.path } },
        { staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
      ),
    ),
  );
  const listOf = (url: string) => {
    const i = listUrls.indexOf(url);
    return i >= 0 ? lists[i] : undefined;
  };

  // --- Links method: the checked variant page of each product, captured like a proof page.
  // `useProofCaptures` starts the capture of a new checked page by itself, once its answer is
  // saved; a checked page that is also a proof page reuses that page's own capture.
  const spotUrls =
    method === 'links'
      ? [...new Set(filled.map((u) => answers[u]?.spot?.url).filter((u): u is string => !!u && !filled.includes(u)))]
      : [];
  const spotCaptures = useProofCaptures(sourceId, spotUrls);
  const spotCapture = (u: string) => (filled.includes(u) ? proofCaptures[u] : spotCaptures.byUrl[u]);
  const retrySpot = (u: string) => (filled.includes(u) ? onRetryProof(u) : spotCaptures.retry(u));

  // --- Links method: what the clicked element on the screenshot groups into.
  const near = trpc.sources.variantLinksNear.useQuery(
    { sourceId, url: mark?.url ?? '', xpath: mark?.xpath ?? '' },
    { enabled: method === 'links' && !!mark?.xpath, staleTime: Infinity, retry: false },
  );

  function confirm(url: string) {
    const page = pageOf(url);
    if (!page) return;
    // An unchanged list keeps the stored spot: never send a column back in its fromProduct.
    const answer = stripColumnsFromProduct(confirmAnswer(method, page, answers[url]), columnKeys);
    void save(url, answer, true).catch(() => {});
  }

  function takeLinks(url: string, group: DetectedLinks) {
    const page = pageOf(url) ?? { url, captured: true, lists: [], links: [], pickers: [] };
    const answer = confirmAnswer('links', { ...page, links: [group] }, undefined);
    onMarkDone();
    setNotRight((n) => ({ ...n, [url]: false }));
    void save(url, answer, true).catch(() => {});
  }

  function spotChange(url: string, change: (spot: NonNullable<VariantAnswer['spot']>) => NonNullable<VariantAnswer['spot']>) {
    const a = answers[url];
    if (!a) return;
    const spot = a.spot ?? { index: 0, expected: {} };
    // Every spot save (accept, type, check another variant, from-product) drops a column a stale
    // answer still holds in fromProduct — the server refuses one (final review I1).
    const next = { ...a, spot: change({ ...spot, expected: { ...spot.expected }, ...(spot.paths ? { paths: { ...spot.paths } } : {}) }) };
    void save(url, stripColumnsFromProduct(next, columnKeys));
  }

  const statusText: ReactNode =
    need.kind === 'blocked' ? (
      <span className="text-sm text-muted-foreground">{need.reason}</span>
    ) : need.kind === 'pending' ? (
      <span className="text-sm text-muted-foreground">not verified yet</span>
    ) : passed ? (
      <span className="inline-flex items-center gap-1 text-sm text-text">
        <ShieldCheck aria-hidden className="size-3.5" />
        verified
      </span>
    ) : (
      <span className="text-sm text-fail">{result?.problem ?? 'some products failed'}</span>
    );

  const blankCols = (
    <>
      {hasAddHead ? <td className={td} /> : null}
      <td className="w-[220px] border-t border-line" />
    </>
  );

  return (
    <>
      <tr>
        <th scope="row" className={th}>
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)} className="flex min-w-0 items-center gap-1.5 text-left">
            <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
            <span className="min-w-0 truncate text-base">Variants</span>
          </button>
          <span className="block pl-[18px] text-sm text-muted-foreground">{method === 'list' ? 'In the page data' : 'Separate pages'}</span>
        </th>

        {urls.map((url, i) => {
          const cell = url.trim() ? cells[url] : undefined;
          const n = i + 1;
          if (!cell) return <td key={i} className={td} />;
          const tick =
            cell.kind === 'found' ? (
              <Button variant="outline" size="icon-xs" disabled={locked} aria-label={`Confirm the variants of product ${n}`} title={`Confirm the variants of product ${n}`} onClick={() => confirm(url)} className="absolute top-1/2 right-1 -translate-y-1/2 bg-panel">
                <Check aria-hidden className="size-3" />
              </Button>
            ) : cell.kind === 'none-found' ? (
              <Button
                variant="outline"
                size="icon-xs"
                disabled={locked}
                aria-label={`No variants on product ${n}`}
                title="No variants on this product"
                onClick={() => void save(url, { count: 0, labels: [] }, true).catch(() => {})}
                className="absolute top-1/2 right-1 -translate-y-1/2 bg-panel"
              >
                <Check aria-hidden className="size-3" />
              </Button>
            ) : null;
          return (
            <td key={i} className={cn(td, 'relative')}>
              <div
                aria-label={`Variants on product ${n}: ${cell.text}`}
                className={cn('flex h-full min-h-[38px] w-full items-center border-l-2 px-2 py-2', CELL_BORDER[cell.kind], tick && 'pr-8')}
              >
                <span
                  className={cn(
                    'min-w-0 text-base',
                    cell.kind === 'failed' ? 'text-sm text-fail' : 'truncate',
                    (cell.kind === 'waiting' || cell.kind === 'none-found') && 'text-sm text-muted-foreground',
                  )}
                  title={cell.text}
                >
                  {cell.text}
                </span>
              </div>
              {tick}
              {saveErrors[url] ? <p className="px-2 pb-2 text-sm text-warn">Not saved: {saveErrors[url]}</p> : null}
            </td>
          );
        })}

        {hasAddHead ? <td className={td} /> : null}
        <td className="w-[220px] border-t border-line px-2 py-2 align-top">
          {statusText}
          {filled.map((u) =>
            saveErrors[u] ? (
              <p key={u} className="mt-1 text-sm text-warn">
                Not saved on product {urls.indexOf(u) + 1}
              </p>
            ) : null,
          )}
        </td>
      </tr>

      {expanded ? (
        <>
          {/* What each product's variants are, and "Not right?". */}
          <tr>
            <th scope="row" className={cn(th, 'pl-[26px] text-sm text-muted-foreground')}>
              Found
            </th>
            {urls.map((url, i) => {
              const n = i + 1;
              const a = url.trim() ? answers[url] : undefined;
              const cell = url.trim() ? cells[url] : undefined;
              if (!cell) return <td key={i} className={td} />;
              const listData = method === 'list' ? listOf(url)?.data : undefined;
              const page = pageOf(url);
              const open = !!notRight[url];
              const marking = mark?.url === url;
              const others = method === 'list' && page ? page.lists.filter((l) => !(a?.list && l.source === a.list.source && l.path === a.list.path)) : [];
              const reuse = method === 'list' ? reuseListAnswer(a, listData) : null;
              return (
                <td key={i} className={cn(td, 'space-y-2 px-2 py-2')}>
                  {a && a.count > 0 ? (
                    <LabelList
                      labels={listData?.labels ?? a.labels}
                      count={listData?.count ?? a.count}
                      locked={locked}
                      product={n}
                      {...(method === 'list' && listData
                        ? {
                            checked: a.spot?.index ?? 0,
                            onCheck: (index: number) => spotChange(url, (s) => ({ ...s, index, expected: {}, paths: {} })),
                          }
                        : {})}
                    />
                  ) : cell.kind === 'found' ? (
                    <LabelList labels={cell.labels} count={cell.labels.length} locked={locked} product={n} />
                  ) : a ? (
                    <p className="text-sm text-muted-foreground">No variants on this product</p>
                  ) : null}

                  {page?.captured ? (
                    <div className="space-y-1">
                      <Button variant="ghost" size="xs" disabled={locked} aria-expanded={open} onClick={() => setNotRight((r) => ({ ...r, [url]: !open }))} className="h-6 px-1 text-sm text-muted-foreground">
                        Not right?
                      </Button>
                      {open ? (
                        <div className="space-y-1">
                          {reuse ? (
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={locked}
                              className="h-auto w-full justify-start py-1 text-left text-sm whitespace-normal"
                              onClick={() => {
                                setNotRight((r) => ({ ...r, [url]: false }));
                                void save(url, reuse, true).catch(() => {});
                              }}
                            >
                              Use this list again ({reuse.count})
                            </Button>
                          ) : null}
                          {method === 'list'
                            ? others.map((l) => (
                                <Button
                                  key={`${l.source}|${l.path}`}
                                  variant="outline"
                                  size="xs"
                                  disabled={locked}
                                  className="h-auto w-full justify-start py-1 text-left text-sm whitespace-normal"
                                  onClick={() => {
                                    setNotRight((r) => ({ ...r, [url]: false }));
                                    void save(url, confirmAnswer('list', { ...page, lists: [l] }, undefined), true).catch(() => {});
                                  }}
                                >
                                  Another list: {l.count} {l.count === 1 ? 'entry' : 'entries'}
                                </Button>
                              ))
                            : (
                                <Button variant="outline" size="xs" disabled={locked} className="h-auto w-full justify-start py-1 text-left text-sm whitespace-normal" onClick={() => onMark(url)}>
                                  Mark the {singular} buttons on the screenshot
                                </Button>
                              )}
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={locked}
                            className="h-auto w-full justify-start py-1 text-left text-sm whitespace-normal"
                            onClick={() => {
                              setNotRight((r) => ({ ...r, [url]: false }));
                              void save(url, { count: 0, labels: [] }, true).catch(() => {});
                            }}
                          >
                            No variants on this product
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {marking ? (
                    !mark?.xpath ? (
                      <p className="text-sm text-muted-foreground">Click one of the {singular} buttons on the screenshot below</p>
                    ) : near.isFetching ? (
                      <p className="text-sm text-muted-foreground">Looking near it…</p>
                    ) : near.data ? (
                      <div className="space-y-1 border-l-2 border-warn pl-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm">
                            {near.data.count} {noun}
                          </span>
                          <Button variant="outline" size="icon-xs" disabled={locked} aria-label={`Use these ${noun} on product ${n}`} title={`Use these ${noun} on product ${n}`} onClick={() => takeLinks(url, near.data!)}>
                            <Check aria-hidden className="size-3" />
                          </Button>
                        </div>
                        <LabelList labels={near.data.links.map((l) => l.label)} count={near.data.count} locked={locked} product={n} />
                      </div>
                    ) : (
                      <p className="text-sm text-warn">Nothing like that near it — try another button</p>
                    )
                  ) : null}
                </td>
              );
            })}
            {blankCols}
          </tr>

          {/* List: the checked variant, one sub-row per entry field. */}
          {method === 'list'
            ? entryFields.map((f) => (
                <tr key={f.key}>
                  <th scope="row" className={cn(th, 'pl-[26px]')}>
                    <span className="block min-w-0 truncate text-sm">{f.name}</span>
                    <span className="block text-sm text-muted-foreground">checked variant</span>
                  </th>
                  {urls.map((url, i) => {
                    const a = url.trim() ? answers[url] : undefined;
                    if (!a || a.count <= 0) return <td key={i} className={td} />;
                    const listData = listOf(url)?.data;
                    const index = a.spot?.index ?? 0;
                    const suggestions = listData ? (listData.suggestions[index] ?? null) : null;
                    const row = spotRows({ fields: [f], columnKeys, suggestions, answer: a })[0]!;
                    return (
                      <td key={i} className={cn(td, 'relative')}>
                        <SpotCell
                          row={row}
                          product={i + 1}
                          locked={locked}
                          isColumn={columnKeys.includes(f.key)}
                          onAccept={(s) =>
                            spotChange(url, (spot) => ({ ...spot, expected: { ...spot.expected, [f.key]: s.value }, paths: { ...(spot.paths ?? {}), [f.key]: s.path } }))
                          }
                          onType={(text) =>
                            spotChange(url, (spot) => {
                              const expected = { ...spot.expected };
                              const paths = { ...(spot.paths ?? {}) };
                              delete paths[f.key];
                              if (text.trim() === '') delete expected[f.key];
                              else expected[f.key] = text;
                              return { ...spot, expected, paths };
                            })
                          }
                          onFromProduct={(on) =>
                            spotChange(url, (spot) => {
                              const expected = { ...spot.expected };
                              const paths = { ...(spot.paths ?? {}) };
                              delete expected[f.key];
                              delete paths[f.key];
                              const rest = (spot.fromProduct ?? []).filter((k) => k !== f.key);
                              return { ...spot, expected, paths, fromProduct: on ? [...rest, f.key] : rest };
                            })
                          }
                        />
                      </td>
                    );
                  })}
                  {blankCols}
                </tr>
              ))
            : null}

          {/* Links: the checked variant page of each product. */}
          {method === 'links' ? (
            <tr>
              <th scope="row" className={cn(th, 'pl-[26px] text-sm text-muted-foreground')}>
                Checked page
              </th>
              {urls.map((url, i) => {
                const a = url.trim() ? answers[url] : undefined;
                const spotUrl = a?.spot?.url;
                if (!a || a.count <= 0 || !spotUrl) return <td key={i} className={td} />;
                const at = a.links?.indexOf(spotUrl) ?? -1;
                const label = (at >= 0 ? a.labels[at] : undefined) ?? 'variant';
                const cap = spotCapture(spotUrl);
                const page = resultCurrent ? result?.pages[url] : undefined;
                return (
                  <td key={i} className={cn(td, 'space-y-1 px-2 py-2')}>
                    <p className="text-sm">Checking the {label} page</p>
                    {!cap || cap.status === 'starting' || cap.status === 'capturing' ? (
                      <p className="text-sm text-muted-foreground">taking screenshot…</p>
                    ) : cap.status === 'captured' ? (
                      <p className="text-sm text-muted-foreground">ready</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-warn">{cap.error ?? 'The screenshot could not be taken'}</span>
                        <Button variant="outline" size="xs" disabled={locked} onClick={() => retrySpot(spotUrl)}>
                          Try again
                        </Button>
                      </div>
                    )}
                    {page?.status === 'pass' ? <p className="text-sm text-text">passed</p> : page?.status === 'fail' ? <p className="text-sm text-fail">{page.message}</p> : null}
                  </td>
                );
              })}
              {blankCols}
            </tr>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** One entry field of one product's checked variant: accept its suggestion, type it, or take it from the product page. */
function SpotCell({
  row,
  product,
  locked,
  isColumn,
  onAccept,
  onType,
  onFromProduct,
}: {
  row: SpotRow;
  product: number;
  locked: boolean;
  /** A column (an axis entry field) never offers "From the product page" (Global Constraints) — it differs per variant by definition. */
  isColumn: boolean;
  onAccept: (s: { value: string; path: string }) => void;
  onType: (text: string) => void;
  onFromProduct: (on: boolean) => void;
}) {
  const from = isColumn ? null : (
    <Button variant="ghost" size="xs" disabled={locked} aria-label={`${row.name} of product ${product} from the product page`} onClick={() => onFromProduct(true)} className="h-5 px-1 text-sm text-muted-foreground">
      From the product page
    </Button>
  );
  return (
    <div className={cn('space-y-1 border-l-2 px-2 py-2', SPOT_BORDER[row.state])}>
      {row.state === 'from-product' ? (
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm">From the product page</span>
          <Button variant="ghost" size="icon-xs" disabled={locked} aria-label={`Take ${row.name} of product ${product} from the list`} title="Take it from the list" onClick={() => onFromProduct(false)}>
            <X aria-hidden className="size-3" />
          </Button>
        </div>
      ) : row.state === 'suggested' ? (
        <>
          <div className="flex items-center justify-between gap-1">
            <span className="min-w-0 truncate font-mono text-base" title={row.suggestion!.value}>
              {row.suggestion!.value}
            </span>
            <Button variant="outline" size="icon-xs" disabled={locked} aria-label={`Accept ${row.name} of the checked variant on product ${product}`} title={`Accept ${row.name}`} onClick={() => onAccept(row.suggestion!)}>
              <Check aria-hidden className="size-3" />
            </Button>
          </div>
          {from}
        </>
      ) : (
        <>
          <Input
            aria-label={`${row.name} of the checked variant on product ${product}`}
            placeholder="Type the value"
            value={row.value ?? ''}
            disabled={locked}
            onChange={(e) => onType(e.target.value)}
            className="h-7 font-mono"
          />
          {from}
        </>
      )}
    </div>
  );
}

