import { Link, Outlet, createFileRoute, useParams } from '@tanstack/react-router';
import { Page } from '../../../../../components/page';
import { SiteHeader } from '../../../../../components/site/site-header';
import { Button } from '../../../../../components/ui/button';
import { trpc } from '../../../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../../../lib/use-unauthorized-redirect';
import { useProject } from '../../$project';

/**
 * The website layout: everything under /projects/:project/sites/:site. It owns
 * the one `sources.get` query, the title row, the address and the tab strip;
 * each tab renders only its own panels into the outlet.
 */
export const Route = createFileRoute('/_app/projects/$project/sites/$site')({
  component: SiteLayout,
});

/**
 * The website behind the current URL. Every tab calls this rather than running
 * its own query — one cache key serves the header, the breadcrumb and whichever
 * tab is open.
 */
export function useSite() {
  const { project, site } = Route.useParams();
  return trpc.sources.get.useQuery({ projectSlug: project, sourceSlug: site });
}

/** Reads the current website's slugs from the URL anywhere in the shell; undefined outside one. */
export function useSiteSlugs(): { project?: string; site?: string } {
  return useParams({ strict: false }) as { project?: string; site?: string };
}

function SiteLayout() {
  const { project: projectSlug, site: siteSlug } = Route.useParams();
  const site = useSite();
  // The project is already in cache — the sidebar and the breadcrumb both read
  // it — and it is the only place the project's name is when `sources.get` has
  // refused to hand one over.
  const project = useProject();
  // An ended session is a trip to /login, not a Retry button that can only fail
  // again; nothing is drawn while that navigation is in flight.
  const unauthorized = useUnauthorizedRedirect(site);
  // A slug that is not a website in this project, as opposed to a request that
  // failed: one is a wrong address, the other is something to retry.
  const missing = site.error?.data?.code === 'NOT_FOUND';

  if (unauthorized) return null;

  if (site.isError) {
    return (
      <Page title="Website">
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          {missing ? (
            <>
              {/* Not red: a slug that is not a website is a wrong address, not a
                  failure, and the red is what the customer must learn to read as
                  "something broke". Announced all the same. */}
              <p role="alert" className="text-base">
                This website does not exist in {project.data?.name ?? 'this project'}.
              </p>
              <Button variant="outline" asChild>
                <Link to="/projects/$project" params={{ project: projectSlug }}>
                  All websites
                </Link>
              </Button>
            </>
          ) : (
            <>
              {/* No cause is named: from here a failure could be the network,
                  the api-server, the database or a bug. Say what happened and
                  offer the one action that can change it. */}
              <p role="alert" className="text-base text-fail">
                Could not load the website.
              </p>
              <Button variant="outline" onClick={() => void site.refetch()} disabled={site.isFetching}>
                {site.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </>
          )}
        </div>
      </Page>
    );
  }

  return (
    <SiteHeader
      project={projectSlug}
      site={siteSlug}
      website={
        site.data ? { id: site.data.id, name: site.data.name, hostname: site.data.hostname } : null
      }
    >
      <Outlet />
    </SiteHeader>
  );
}
