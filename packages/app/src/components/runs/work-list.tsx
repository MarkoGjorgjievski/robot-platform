import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { groupWorkList, listingValuesLabel, pageStatusWord, summariseWorkList, type WorkListCounts } from '../../lib/site/work-list';
import { workListNote } from '../../lib/site/run-screen-view';
import { captureWords } from '../../lib/capture-words';
import { useStaffDetail } from '../../lib/use-staff-detail';

/** One row of `crawl.items`, narrowed to what this table reads. */
export type WorkListItem = {
  id: string;
  kind: string;
  url: string;
  status: string;
  pageNumber: number | null;
  inputIndex?: number | null;
  listingValues: unknown;
  error: string | null;
};

/** Enough rows to see the shape of a plan; the whole of a 5,000-URL crawl is not. */
const CAP = 200;

/**
 * The work list a plan produced: which listing pages were walked, and which
 * product URLs each one yielded.
 *
 * This is the inspection point the two-phase design exists for — the fan-out is
 * visible here BEFORE phase 2 turns it into requests, so a plan that queued the
 * wrong links (a facet sidebar, a privacy policy) is obvious rather than
 * expensive.
 */
export function WorkList({ items, counts, embedded = false }: { items: readonly WorkListItem[]; counts: WorkListCounts; /** Inside the run's tabbed card: no box and no head of its own. */ embedded?: boolean }) {
  // Spec 2026-10-21: a customer reads an item's capture failure in customer words; staff read it as stored.
  const staff = useStaffDetail();
  // Which listing pages are open (Marko 2026-11-18): with several, they start closed so the list reads as its listings.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) return null;
  // Each listing page, and under it the products found on it (Marko 2026-11-17). The cap counts rows as shown.
  const groups = groupWorkList(items);
  let room = CAP;
  const shownGroups = groups.flatMap((g) => {
    if (room <= 0) return [];
    const products = g.products.slice(0, Math.max(0, room - 1));
    room -= products.length + 1;
    return [{ ...g, products }];
  });
  const shownCount = shownGroups.reduce((n, g) => n + g.products.length + (g.listing ? 1 : 0), 0);
  const note = workListNote(shownCount, items.length);
  const startsOpen = groups.length <= 1;
  const idOf = (g: (typeof groups)[number], gi: number) => g.listing?.id ?? `products-${gi}`;
  const isOpen = (id: string) => toggled.has(id) !== startsOpen;
  const allOpen = shownGroups.every((g, gi) => isOpen(idOf(g, gi)));
  function toggleAll() {
    // Open them all, or close them all: the set holds whichever groups differ from how they start.
    const want = !allOpen;
    setToggled(want === startsOpen ? new Set() : new Set(shownGroups.map(idOf)));
  }

  return (
    <section className={embedded ? '' : 'rise mb-3 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]'}>
      {embedded ? null : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
          <h3 className="text-base font-medium">Pages</h3>
          <p className="text-sm text-muted-foreground">{summariseWorkList(counts)}</p>
        </div>
      )}

      {/* Below `md` the table keeps its real width and the container scrolls
          (spec §3); the head sticks only where the box is a real scrollport. */}
      <div className="overflow-auto md:max-h-[calc(100svh-320px)]">
        <table className="w-full min-w-max border-collapse text-base">
          <thead>
            <tr className="[&>th]:bg-panel [&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-sm [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground [&>th]:[box-shadow:inset_0_-1px_0_var(--border)] md:[&>th]:sticky md:[&>th]:top-0 md:[&>th]:z-10">
              <th>Product page</th>
              <th>Status</th>
              <th>
                <span className="flex items-center justify-between gap-3">
                  From the listing
                  {shownGroups.length > 1 ? (
                    <button type="button" onClick={toggleAll} className="text-sm text-muted-foreground underline-offset-4 hover:text-text hover:underline">
                      {allOpen ? 'Collapse all' : 'Expand all'}
                    </button>
                  ) : null}
                </span>
              </th>
            </tr>
          </thead>

          <tbody>
            {shownGroups.map((g, gi) => (
              <Fragment key={g.listing?.id ?? `products-${gi}`}>
                {/* The listing page is the group's head, not one more row among the products. */}
                <tr className="border-b border-line bg-raised" data-testid="work-list-listing">
                  <th scope="rowgroup" colSpan={3} className="px-4 py-2 text-left font-normal">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <button
                        type="button"
                        aria-expanded={isOpen(idOf(g, gi))}
                        onClick={() => setToggled((t) => { const n = new Set(t); const id = idOf(g, gi); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                        className="flex items-center gap-1.5 font-medium whitespace-nowrap"
                      >
                        <ChevronRight aria-hidden className={`size-3.5 text-muted-foreground transition-transform ${isOpen(idOf(g, gi)) ? 'rotate-90' : ''}`} />
                        {g.title}
                      </button>
                      {g.listing ? (
                        <a href={g.listing.url} target="_blank" rel="noopener noreferrer" title={g.listing.url} className="block max-w-[420px] min-w-0 truncate font-mono text-sm text-muted-foreground underline-offset-4 hover:underline">
                          {g.listing.url}
                        </a>
                      ) : null}
                      <span className={`ml-auto text-sm whitespace-nowrap ${g.products.some((p) => p.status === 'failed') ? 'text-fail' : 'text-muted-foreground'}`}>{g.summary}</span>
                    </span>
                    {g.listing?.status === 'failed' ? (
                      <span className="mt-0.5 block text-sm text-fail">{g.listing.error ? captureWords(g.listing.error, staff) : 'This listing page could not be read.'}</span>
                    ) : null}
                  </th>
                </tr>
                {(isOpen(idOf(g, gi)) ? g.products : []).map((item) => (
                  <tr key={item.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                    <td className="py-2 pr-4 pl-8 align-top">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.url} className="block max-w-[520px] truncate font-mono underline-offset-4 hover:underline">
                        {item.url}
                      </a>
                    </td>
                    <td className="px-4 py-2 align-top whitespace-nowrap">
                      {/* Colour only where it is state: a failed page is the reason to read this table, an
                          extracted one is the good case, and a page not tried yet is quiet, never a fault. */}
                      <span className={item.status === 'failed' ? 'text-fail' : item.status === 'done' ? 'text-pass' : 'text-muted-foreground'}>
                        {pageStatusWord(item.status)}
                      </span>
                      {item.error ? <div className="mt-0.5 max-w-[240px] text-sm whitespace-normal text-fail">{captureWords(item.error, staff)}</div> : null}
                    </td>
                    <td className="px-4 py-2 align-top font-mono text-sm text-muted-foreground">
                      <div className="max-w-[280px] truncate" title={listingValuesLabel(item.listingValues)}>
                        {listingValuesLabel(item.listingValues)}
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {note ? <p className="border-t border-line px-4 py-2.5 text-sm text-muted-foreground">{note}</p> : null}
    </section>
  );
}
