import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { listingLabel } from '../../lib/site/run-misses-view';
import { unshownRows, type UnshownItem } from '../../lib/site/run-screen-view';
import type { FieldCoverage } from '../../lib/site/coverage-view';
import type { ResultColumn } from './results-table';

/**
 * "Values not shown on their page" (spec 2026-10-12 §5/§7): one row per field
 * the "shown on the page" check caught anything on, under the fill table,
 * same place and style as `RunMisses`' "Empty cells" — a different fact about
 * the same rows (a value that IS there, but not where the engine found it,
 * rather than a cell with nothing in it at all).
 *
 * Nothing is drawn when `unshownRows` comes back empty — an older run with no
 * `validation_result`, or one where the check never caught anything (spec §8
 * property 7) — so the route can mount this unconditionally, the same way
 * `RunMisses` is mounted unconditionally and decides for itself.
 */
export function UnshownPanel({
  project,
  site,
  coverage,
  unshownItems,
  columns,
}: {
  project: string;
  site: string;
  /** `crawl.coverage`'s per-field report. */
  coverage: readonly FieldCoverage[];
  /** `crawl.coverage`'s `unshownItems`. */
  unshownItems: readonly UnshownItem[];
  /** The project's contract — the customer's own name for each field key. */
  columns: readonly ResultColumn[];
}) {
  const nameOf = (key: string) => columns.find((c) => c.key === key)?.name ?? key;
  const rows = unshownRows(coverage, nameOf, unshownItems);
  if (rows.length === 0) return null;

  return (
    <section className="rise mb-3 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="border-b border-line px-4 py-2.5">
        <h3 className="text-base font-medium">Values not shown on their page</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A value the page does not show for that product is usually another product&apos;s or the page&apos;s
          SEO text. Add one of these products as a proof page and mark the field there.
        </p>
      </div>

      <ul>
        {rows.map((row) => (
          <li key={row.field} className="border-b border-line px-4 py-2.5 last:border-0">
            <p className="text-base">{row.line}</p>

            <ul className="mt-1">
              {row.urls.map((url) => (
                <li key={url} className="flex flex-wrap items-center gap-3 py-1">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={url}
                    className="flex min-w-0 items-center gap-1 font-mono text-base text-link underline-offset-4 hover:underline"
                  >
                    <span className="max-w-[420px] truncate">{listingLabel(url)}</span>
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </a>
                  <Button variant="outline" size="xs" asChild>
                    <Link
                      to="/projects/$project/sites/$site"
                      params={{ project, site }}
                      // `row.field` is the engine key (see `nameOf` above), which is what `?field` expects.
                      search={{ addPage: url, field: row.field }}
                    >
                      Use as proof page
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
