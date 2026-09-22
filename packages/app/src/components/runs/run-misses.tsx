import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { listingLabel, missLine } from '../../lib/site/run-misses-view';
import type { ResultColumn } from './results-table';

/**
 * Where this extraction came back empty, by field and by the listing each
 * product came from (spec 2026-09-17 §5).
 *
 * The reading this panel exists for: a listing whose products all miss the same
 * field is a second layout, not a broken extractor. "Use as proof page" takes
 * one of those products to the Schema tab with the field already picked, where
 * the customer types the one value it should have read and verifies — which is
 * how the website learns that layout.
 *
 * `crawl.misses` is a free read, but it is not gated here: the route mounts this
 * only on a settled, non-sample, non-repair extraction, exactly as the old
 * dashboard did. Nothing is drawn unless the website has a schema and a
 * verification set to add a page to (`proofSheet`) — without one the button
 * would lead somewhere with nothing to do.
 */
export function RunMisses({
  runId,
  project,
  site,
  columns,
}: {
  runId: string;
  project: string;
  site: string;
  /** The project's contract — the customer's own name for each field key. */
  columns: readonly ResultColumn[];
}) {
  const misses = trpc.crawl.misses.useQuery({ runId });
  // One field open at a time: this list is read by asking "what about price?",
  // not by unrolling every field's URLs at once.
  const [open, setOpen] = useState<string | null>(null);

  const data = misses.data;
  if (!data || !data.proofSheet || data.fields.length === 0) return null;

  // The engine keys a field by the contract's `key`; the heading it is read
  // under is the contract's `name`.
  const nameOf = (key: string) => columns.find((c) => c.key === key)?.name ?? key;

  return (
    <section className="rise mb-3 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="border-b border-line px-4 py-2.5">
        <h3 className="text-base font-medium">Empty cells</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A listing whose products all miss the same field usually lays that field out differently. Add one of
          them as a proof page to teach this website the second layout.
        </p>
      </div>

      <ul>
        {data.fields.map((field) => {
          const expanded = open === field.name;
          return (
            <li key={field.name} className="border-b border-line last:border-0">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : field.name)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-base transition-colors hover:bg-raised"
              >
                {/* The only rotation in the app that is not a spinner, and it
                    does not ease: colour is the one thing that transitions
                    here (spec §4). */}
                <ChevronRight
                  aria-hidden
                  className={`size-3 shrink-0 text-muted-foreground ${expanded ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0">{missLine(field, nameOf(field.name))}</span>
              </button>

              {expanded ? (
                <div className="border-t border-line px-4 py-2.5">
                  {field.groups.map((group) => (
                    <div key={group.listingUrl ?? 'direct'} className="mt-3 first:mt-0">
                      <p className="text-sm text-muted-foreground">
                        {group.count.toLocaleString('en-US')} from {listingLabel(group.listingUrl)}
                        {/* Said only when it is true: a group caps the URLs it
                            carries, and a list that is shorter than its own
                            count with no word about it reads as a miscount. */}
                        {group.count > group.urls.length ? ` · showing ${group.urls.length}` : ''}
                      </p>

                      <ul className="mt-1">
                        {group.urls.map((url) => (
                          <li key={url} className="flex flex-wrap items-center gap-3 py-1">
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={url}
                              className="flex min-w-0 items-center gap-1 font-mono text-base text-link underline-offset-4 hover:underline"
                            >
                              {/* The path, not the whole address: every URL in
                                  a group shares a host, so the path is the only
                                  part that tells two of them apart. */}
                              <span className="max-w-[420px] truncate">{listingLabel(url)}</span>
                              <ExternalLink aria-hidden className="size-3 shrink-0" />
                            </a>
                            <Button variant="outline" size="xs" asChild>
                              <Link
                                to="/projects/$project/sites/$site"
                                params={{ project, site }}
                                search={{ addPage: url, field: field.name, step: 'pages' as const }}
                              >
                                Use as proof page
                              </Link>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
