import type { ReactNode } from 'react';
import { Page } from '../page';
import { Skeleton } from '../ui/skeleton';
import { InlineRename } from './inline-rename';
import { SiteTabs } from './site-tabs';

/** What the header reads off `sources.get`. */
export type SiteHeaderWebsite = { id: string; name: string; hostname: string };

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
      actions={
        website?.hostname ? (
          <span className="font-mono text-sm text-muted-foreground">{website.hostname}</span>
        ) : undefined
      }
    >
      <SiteTabs project={project} site={site} />
      {children}
    </Page>
  );
}
