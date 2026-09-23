import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../../../../../../components/ui/button';
import { Skeleton } from '../../../../../../components/ui/skeleton';
import { SettingsRows } from '../../../../../../components/settings/settings-rows';
import { DeleteWebsiteDialog } from '../../../../../../components/settings/delete-website-dialog';
import { trpc } from '../../../../../../lib/trpc';
import { useSite } from '../$site';

/**
 * Settings: this website's own options (task 9 — rename, listing mode, budget,
 * active, delete). The layout owns the title and the tabs; this is one panel of
 * rows that are only ever read and corrected here, and the Danger zone below
 * it.
 */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/settings')({
  component: SettingsTab,
});

function SettingsTab() {
  const { project: projectSlug, site: siteSlug } = Route.useParams();
  const site = useSite();
  const source = site.data;
  // The same query key the Runs tab reads — this tab needs only its length,
  // for the delete dialog's count, and shares that tab's cache when it has
  // already been visited.
  const runs = trpc.runs.listBySource.useQuery({ sourceId: source?.id ?? '' }, { enabled: !!source });
  const [deleting, setDeleting] = useState(false);

  if (site.isPending) {
    return (
      <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
        <Skeleton className="h-[22px] w-64 bg-raised" />
        <Skeleton className="mt-3 h-[22px] w-full bg-raised" />
        <Skeleton className="mt-2 h-[22px] w-full bg-raised" />
      </div>
    );
  }
  if (!source) return null; // the layout has already said what went wrong

  return (
    <div className="space-y-3">
      <SettingsRows
        site={{
          id: source.id,
          name: source.name,
          url: source.url,
          listingMode: source.listingMode,
          confirmedAt: source.confirmedAt,
          budget: source.budget,
          isActive: source.isActive,
        }}
      />

      {/* A panel, not a red box: tone is the 2 px rail and nothing else
          (spec §4) — the same grammar the Extract tab's locked strip uses. */}
      <section className="rise rounded-[6px] border border-line border-l-2 border-l-fail bg-panel [box-shadow:var(--shadow)]">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-base font-medium">Danger zone</h3>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-muted-foreground">Delete this website and everything it collected.</p>
          {/* Quiet, not solid: the rail already carries the danger tone, and
              the panel this opens has the real, solid-red confirm — the same
              split the Fields table draws between its ghost trash icon and
              `DeleteFieldDialog`'s own destructive button. */}
          <Button
            variant="outline"
            size="sm"
            className="border-fail text-fail hover:border-fail hover:bg-raised"
            onClick={() => setDeleting(true)}
          >
            Delete website
          </Button>
        </div>
      </section>

      <DeleteWebsiteDialog
        open={deleting}
        onOpenChange={setDeleting}
        projectSlug={projectSlug}
        sourceSlug={siteSlug}
        sourceId={source.id}
        name={source.name}
        confirmedAt={source.confirmedAt}
        runCount={runs.data?.length ?? 0}
      />
    </div>
  );
}
