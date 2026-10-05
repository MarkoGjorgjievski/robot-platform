import type { ReactNode } from 'react';
import { Page } from '../page';
import { Skeleton } from '../ui/skeleton';
import { driftBadge } from '../../lib/site/drift-view';
import { InlineRename } from './inline-rename';
import { SiteTabs } from './site-tabs';

/** What the header reads off `sources.get`. */
export type SiteHeaderWebsite = { id: string; name: string; hostname: string; driftedFields: string[] | null };

/**
 * The website's page: its name on the left, the address it collects from on the
 * right, the four tabs under both, and then whichever tab is open.
 *
 * It owns the `Page` for the whole subtree rather than each tab owning one —
 * the title, the address and the strip belong to the website, not to the tab,
 * and a tab that re-rendered them would flash them on every tab change.
 */
export function SiteHeader({
  project,
  site,
  website,
  children,
}: {
  project: string;
  site: string;
  website: SiteHeaderWebsite | null;
  children: ReactNode;
}) {
  const badge = website ? driftBadge(website.driftedFields) : null;
  return (
    <Page
      // The title is the thing being loaded, so it waits as a bar rather than
      // as a blank line that reflows the page under it when the name arrives.
      title={
        website ? (
          <InlineRename sourceId={website.id} name={website.name} />
        ) : (
          // A `span`: the title's `h1` permits phrasing content only.
          <Skeleton as="span" className="inline-block h-[20px] w-[180px] bg-raised" />
        )
      }
      // Not a control, so it is not a button: the address is what this website
      // is, said once, quietly, in the mono the rest of the app uses for hosts.
      // A field that stopped extracting (plan 2026-10-05 Task 3) sits under it,
      // in warn colour — on every tab, not only Verification, since drift is
      // true of the website itself.
      actions={
        website && (website.hostname || badge) ? (
          <div className="flex max-w-[40vw] flex-col items-end gap-1">
            {/* `block` so `truncate` applies at all (overflow does nothing on an
                inline box), and a max-width so a long host caps its own
                min-content contribution instead of widening the title row on a
                phone. */}
            {website.hostname ? <span className="block w-full truncate font-mono text-sm text-muted-foreground">{website.hostname}</span> : null}
            {badge ? <span className="block w-full truncate text-sm text-warn">{badge}</span> : null}
          </div>
        ) : undefined
      }
    >
      <SiteTabs project={project} site={site} />
      {children}
    </Page>
  );
}
