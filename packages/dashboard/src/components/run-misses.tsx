import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { missLine, listingLabel } from '../lib/run-misses-view';

/**
 * A verified website's empty cells, by field and by listing (spec 2026-09-17
 * §5). A listing whose products all miss the same field is a second layout;
 * "Use as proof page" takes one of those products to the Schema tab, where the
 * customer types the one missing value and verifies.
 */
export function RunMisses({ runId, projectSlug, sourceSlug, fields }: {
  runId: string; projectSlug: string; sourceSlug: string;
  /** The contract's fields, for the customer's own names. */
  fields: Array<{ name: string; label?: string }>;
}) {
  const query = trpc.crawl.misses.useQuery({ runId });
  const [open, setOpen] = useState<string | null>(null);
  const data = query.data;
  // M6: gated on proofSheet, not certified — a fourth proof page uncertifies
  // the website until the next verify passes, and if that verify then fails
  // the customer is right back here needing to pick another product. The
  // list must still be here: proofSheet only asks whether there is a schema
  // + verification set to add pages to, which stays true either way.
  if (!data || !data.proofSheet || data.fields.length === 0) return null;
  const labelOf = (name: string) => fields.find((f) => f.name === name)?.label ?? name;

  return (
    <section aria-label="Empty cells" className="mt-4">
      <h2 className="text-[13px] font-semibold text-gray-900">Empty cells</h2>
      <p className="mt-0.5 text-[12px] text-gray-600">
        A listing whose products all miss the same field usually lays that field out differently. Add one of them as a proof page to teach this website the second layout.
      </p>
      <ul className="mt-2">
        {data.fields.map((f) => (
          <li key={f.name} className="sheet-row py-1.5">
            <button type="button" className="btn-quiet text-left" aria-expanded={open === f.name} onClick={() => setOpen(open === f.name ? null : f.name)}>
              {missLine(f, labelOf(f.name))}
            </button>
            {open === f.name && (
              <div className="mt-1 pl-3">
                {f.groups.map((g) => (
                  <div key={g.listingUrl ?? 'direct'} className="mt-1">
                    <p className="text-[12px] text-gray-600">
                      {g.count.toLocaleString('en-US')} from {listingLabel(g.listingUrl)}{g.count > g.urls.length ? ` · showing ${g.urls.length}` : ''}
                    </p>
                    <ul>
                      {g.urls.map((url) => (
                        <li key={url} className="flex items-center gap-3 py-0.5 text-[12px]">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 font-mono text-gray-900 underline-offset-2 hover:underline">
                            <span className="truncate">{listingLabel(url)}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                          <Link
                            to="/projects/$project/sources/$source"
                            params={{ project: projectSlug, source: sourceSlug }}
                            search={{ addPage: url, field: f.name }}
                            className="btn-quiet flex-shrink-0"
                          >
                            Use as proof page
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
