import { Link, useLocation } from '@tanstack/react-router';
import { SITE_TABS, activeTab } from '../../lib/site-nav-view';

/**
 * The website's tab strip (spec 2026-09-21 §3), sitting directly under the page
 * title so the two read as one object: the title names the website, the tabs
 * are the four things you can do to it.
 *
 * Which tab is lit is computed here rather than left to `activeProps`: the
 * router appends the active class string to the resting one, so `border-text`
 * and `border-transparent` would both be in the attribute and the stylesheet's
 * order — not the strip's — would decide. `activeOptions` is still passed, as
 * that is what puts `aria-current="page"` on the active link, and it is the
 * same rule `activeTab` applies, so the two can never disagree.
 */
export function SiteTabs({ project, site }: { project: string; site: string }) {
  const pathname = useLocation({ select: (l) => l.pathname });
  const current = activeTab(pathname, `/projects/${project}/sites/${site}`);

  return (
    // `-mt-1` pulls the strip up against the title row; the hairline is the
    // whole strip's, and each tab's own 2 px sits on top of it via `-mb-px`.
    <nav aria-label="Website" className="rise -mt-1 mb-4 flex gap-5 border-b border-line">
      {SITE_TABS.map((tab) => {
        const active = tab.label === current;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ project, site }}
            activeOptions={{ exact: tab.exact }}
            className={`-mb-px border-b-2 pb-2.5 text-base ${
              active ? 'border-text font-medium text-text' : 'border-transparent text-muted-foreground hover:text-text'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
