import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ScrollArea, ScrollAreaContent, ScrollAreaViewport } from '@ui-sdk/react/scroll-area';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { TYPE_LABELS } from '../../lib/fields-view';
import { sampledView, type SampledProduct } from '../../lib/site/sampled-view';
import { displayValue, type Field } from '../../lib/site/verification-model';
import { dateTime } from '../../lib/when';
import { tileHref, useProofCaptures } from '../../lib/site/use-proof-captures';
import { CaptureStateWords } from './capture-words-view';
import { PageViewer } from './page-viewer';
import { FittedPath } from './product-card';
import { SectionTitle } from './section-title';
import { ScreenshotPopover } from './screenshot-popover';
import { END_COLUMN } from './verification-table';

export type { SampledProduct } from '../../lib/site/sampled-view';

/**
 * The products the check read after Verify, shown and not only counted (Marko 2026-11-19): "every field was found
 * on all of them" asks to be taken on trust, and a value that is there but wrong is what a person sees at a glance
 * and the check cannot.
 *
 * Read-only, and said to be: these are values we read, not values anyone confirmed, so the rows carry no state
 * rail, no Accept and no tick, and nothing here counts as verified. The one action is "Use as proof page", which
 * moves the product up into the table above. A row's screenshot is taken only when asked for.
 *
 * Always open, with its own heading: it is part of the proof, not a detail behind a toggle (Marko 2026-11-19).
 */
export function SampledProducts({
  sourceId,
  websiteName,
  sampled: allSampled,
  proofUrls,
  fields,
  checkedAt,
  onUseAsProofPage,
}: {
  sourceId: string;
  websiteName: string | null | undefined;
  /** Everything the check sampled; the proof table's products and pages that could not be read are left out here. */
  sampled: readonly SampledProduct[];
  /** The proof table's product addresses. */
  proofUrls: readonly string[];
  /** The proof table's fields, in its order: the columns line up with it. */
  fields: readonly Field[];
  checkedAt: Date | string | null;
  /** Null when the table above is full, or while the tab is locked. */
  onUseAsProofPage: ((url: string) => void) | null;
}) {
  const view = useMemo(() => sampledView(allSampled, proofUrls), [allSampled, proofUrls]);
  const sampled = view.rows;
  const problems = sampled.filter((p) => (p.empty?.length ?? 0) > 0).length;
  const [shot, setShot] = useState<number | null>(null);
  // A check from before the values were kept knows only which fields were empty.
  const hasValues = sampled.some((p) => p.values !== undefined);
  const viewport = useRef<HTMLDivElement>(null);
  useScrollWithProofTable(viewport, sampled.length > 0);
  if (sampled.length === 0) return null;
  const when = dateTime(checkedAt, { short: true });

  return (
    <section className="space-y-3 pt-4" data-testid="sampled-products">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <SectionTitle
          title={view.heading}
          info={
            <>
              <p>
                <strong>A preview of how we read the rest of your website.</strong> After Verify, we read these products from your listing the same way we will read every product. Nobody has checked them yet.
              </p>
              <p>Look down each column. If a value is wrong, or <span className="text-warn">empty</span> where the page shows one:</p>
              <ul className="list-disc pl-5">
                <li>
                  Press <strong>Use as proof page</strong> on that row.
                </li>
                <li>The product moves up to Proof products, where you fix the value and verify again.</li>
              </ul>
            </>
          }
        />
        <div className="flex items-center gap-3">
          <span className={`text-sm ${problems > 0 ? 'text-warn' : 'text-muted-foreground'}`}>
            {problems > 0 ? `${problems} with something missing` : 'every field found'}
            {when ? ` · checked ${when}` : ''}
          </span>
        </div>
      </div>

      {/* The same columns as the proof table above (Marko 2026-11-19): photo, title, link, then a column per field at
          the same widths, and the two scroll sideways together, so a value here sits under its field there. */}
      <ScrollArea className="sample-scroll relative overflow-hidden rounded-[6px] border border-line bg-panel">
        <ScrollAreaViewport ref={viewport} className="w-full md:max-h-[480px]">
          <ScrollAreaContent>
            <table className="w-full table-fixed border-collapse" data-testid="sampled-grid" style={{ minWidth: 48 + 220 + 240 + fields.length * 190 + END_COLUMN }}>
              <colgroup>
                <col style={{ width: 48 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 240 }} />
                {fields.map((f) => (
                  <col key={f.key} />
                ))}
                <col style={{ width: END_COLUMN }} />
              </colgroup>
              <thead>
                <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-panel md:[&>th]:sticky md:[&>th]:top-0 md:[&>th]:z-10">
                  <th scope="col" className="left-0 !z-20 px-2 py-2 text-left text-sm font-normal text-muted-foreground md:sticky" aria-label="Image" />
                  <th scope="col" className="left-[48px] !z-20 px-2 py-2 text-left text-sm font-normal text-muted-foreground md:sticky">Title</th>
                  <th scope="col" className="border-l border-line px-2 py-2 text-left text-sm font-normal text-muted-foreground">Link</th>
                  {fields.map((f) => (
                    <th key={f.key} scope="col" className="border-l border-line px-2 py-2 text-left align-top font-normal">
                      <span className="flex min-w-0 items-baseline gap-1.5 pl-[18px]">
                        <span className="min-w-0 truncate text-base">{f.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{TYPE_LABELS[f.type]}</span>
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="right-0 !z-20 [box-shadow:inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] md:sticky" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sampled.map((p, i) => (
                  <tr key={p.url} className="h-[34px] [&>*]:border-b [&>*]:border-line [&:last-child>*]:border-b-0">
                    <td className="sticky left-0 z-[5] bg-panel px-2 py-1" />
                    <th scope="row" className="sticky left-[48px] z-[5] bg-panel px-2 py-1 text-left font-normal">
                      <span className="block truncate text-base">{p.values?.title ?? '—'}</span>
                    </th>
                    <td className="border-l border-line px-2 py-1">
                      <span className="flex min-w-0 items-center gap-0">
                        <button
                          type="button"
                          data-sample={i}
                          onClick={() => setShot(shot === i ? null : i)}
                          title="Show this product's screenshot"
                          className="flex min-w-0 font-mono text-sm text-muted-foreground underline decoration-line-hover underline-offset-2 hover:text-text"
                        >
                          <FittedPath url={p.url} />
                        </button>
                        <a href={p.url} target="_blank" rel="noreferrer" aria-label="Open this product's page in a new tab" className="shrink-0 text-muted-foreground hover:text-text">
                          <ExternalLink aria-hidden className="size-3" />
                        </a>
                      </span>
                    </td>
                    {fields.map((f) => {
                        const empty = p.empty?.includes(f.key) ?? false;
                        const value = p.values?.[f.key];
                        return (
                          <td key={f.key} className={`border-l px-2 py-1.5 ${empty ? 'border-l-2 border-l-warn' : 'border-line'}`}>
                            {empty ? (
                              <span className="text-sm text-warn">empty</span>
                            ) : (
                              <span className="block truncate font-mono text-base text-muted-foreground" title={value !== undefined ? displayValue(f, value) : undefined}>
                                {/* As the table above writes it: In stock, not the stored true. */}
                                {value !== undefined ? displayValue(f, value) : hasValues ? '—' : 'found'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    <td className="sticky right-0 z-[5] [box-shadow:inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] [tr:last-child>&]:[box-shadow:inset_1px_0_0_var(--border)] bg-panel px-2 py-1 text-right">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={!onUseAsProofPage}
                        title={onUseAsProofPage ? 'Move this product into the table above and confirm its values' : 'The table above already has six products'}
                        onClick={() => onUseAsProofPage?.(p.url)}
                      >
                        Use as proof page
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollAreaContent>
        </ScrollAreaViewport>
      </ScrollArea>
      {view.unread > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="sampled-unread">
          {view.unread === 1 ? '1 more product' : `${view.unread} more products`} could not be read this time.
        </p>
      ) : null}
      {hasValues ? null : (
        <p className="text-sm text-muted-foreground">This check is from before we kept the values, so it only knows each field was found. The next Verify fills them in.</p>
      )}

      <ScreenshotPopover open={shot !== null} anchor={`button[data-sample="${shot}"]`} onClose={() => setShot(null)} keepOpenWithin=".sample-scroll">
        {shot !== null && sampled[shot] ? <SampleShot key={sampled[shot]!.url} sourceId={sourceId} url={sampled[shot]!.url} websiteName={websiteName} /> : null}
      </ScreenshotPopover>
    </section>
  );
}

/**
 * Keeps this table's sideways scroll and the proof table's (`[data-sync-x]` inside `.table-scroll`) the same, both
 * ways, so their columns stay one above the other.
 */
function useScrollWithProofTable(mine: RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const a = mine.current;
    const b = document.querySelector<HTMLElement>('.table-scroll [data-sync-x]');
    if (!on || !a || !b) return;
    a.scrollLeft = b.scrollLeft;
    const fromA = () => {
      if (b.scrollLeft !== a.scrollLeft) b.scrollLeft = a.scrollLeft;
    };
    const fromB = () => {
      if (a.scrollLeft !== b.scrollLeft) a.scrollLeft = b.scrollLeft;
    };
    a.addEventListener('scroll', fromA, { passive: true });
    b.addEventListener('scroll', fromB, { passive: true });
    return () => {
      a.removeEventListener('scroll', fromA);
      b.removeEventListener('scroll', fromB);
    };
  }, [mine, on]);
}

/**
 * A sampled product's screenshot. The check reads these pages without taking a picture, so there is none until
 * someone asks: "Take screenshot" loads the page once (a stored one is shown instead when there is one).
 */
function SampleShot({ sourceId, url, websiteName }: { sourceId: string; url: string; websiteName: string | null | undefined }) {
  const [asked, setAsked] = useState(false);
  if (!asked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-3" data-testid="no-screenshot">
        <p className="text-base text-muted-foreground">No screenshot of this product yet.</p>
        <Button size="sm" onClick={() => setAsked(true)}>
          Take screenshot
        </Button>
      </div>
    );
  }
  return <SampleShotView sourceId={sourceId} url={url} websiteName={websiteName} />;
}

function SampleShotView({ sourceId, url, websiteName }: { sourceId: string; url: string; websiteName: string | null | undefined }) {
  const urls = useMemo(() => [url], [url]);
  const captures = useProofCaptures(sourceId, urls);
  const capture = captures.byUrl[url];
  const tiles = useMemo(() => (capture?.tiles ?? []).map((t) => tileHref(t)).filter((t): t is string => !!t), [capture?.tiles]);
  if (capture?.status === 'captured' && tiles.length > 0) {
    return <PageViewer tiles={tiles} boxes={NO_BOXES} pageHeight={capture.pageHeight} capturedHeight={capture.capturedHeight} overlays={NO_OVERLAYS} highlight={null} locked onPick={noop} onOverlay={noop} tall />;
  }
  return (
    <div className="px-2 py-3">
      <CaptureStateWords capture={capture} name={websiteName} disabled={false} onRetry={() => captures.retry(url)} onSwap={noop} size="sm" />
      {capture?.status === 'failed' ? null : <Skeleton className="mt-3 h-[280px] w-full bg-raised" />}
    </div>
  );
}

const NO_BOXES: never[] = [];
const NO_OVERLAYS: never[] = [];
function noop() {}
