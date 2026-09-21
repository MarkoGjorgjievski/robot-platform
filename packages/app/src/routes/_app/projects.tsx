import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { RunDot } from '../../components/run-dot';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { projectsView } from '../../lib/projects-view';
import { trpc } from '../../lib/trpc';

export const Route = createFileRoute('/_app/projects')({
  component: ProjectsPage,
});

/** Plan 2 gives a project its own page; until then the name is text, and says so. */
const NAME_TITLE = 'Opens in plan 2';

function ProjectsPage() {
  const [creating, setCreating] = useState(false);
  const projects = trpc.projects.list.useQuery();
  const rows = projectsView(projects.data ?? []);

  // An empty table head over nothing is furniture: when there is no project
  // yet, the panel holds one sentence and the way out of it, and nothing else.
  const empty = !projects.isPending && !projects.isError && rows.length === 0;
  const showTable = projects.isPending || rows.length > 0;

  return (
    <Page
      title="Projects"
      // One "New project" on screen at a time: while the empty state is up it
      // carries the button, and two identical primaries 40 px apart is a tell.
      actions={empty ? undefined : <Button onClick={() => setCreating(true)}>New project</Button>}
    >
      <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
        {/* Below `md` the table keeps its real width and the container scrolls
            (spec §3). Letting it shrink instead crushed the project name — the
            one thing a row is identified by — down to "Co…". */}
        {showTable ? (
        <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
          <table className="w-full min-w-[660px] border-collapse text-base md:min-w-0">
            {/* The name takes what is left; everything measurable is a narrow
                column hard against the right edge, where the eye compares them. */}
            <colgroup>
              <col />
              <col className="w-[104px]" />
              <col className="w-[88px]" />
              <col className="w-[132px]" />
              <col className="w-[124px]" />
            </colgroup>
            <thead>
              {/* Sticky only from `md`: below it the table sits in a horizontal
                  scroll container, which is also a vertical scrollport, and a
                  sticky head there is pushed 48 px down over the first row. */}
              <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
                <th className="px-4 text-left text-sm">Name</th>
                <th className="px-3 text-right text-sm">Websites</th>
                <th className="px-3 text-right text-sm">Fields</th>
                <th className="px-3 text-right text-sm">Last run</th>
                <th className="px-4 text-right text-sm">Created</th>
              </tr>
            </thead>

            <tbody>
              {projects.isPending ? <LoadingRows /> : null}

              {!projects.isPending &&
                rows.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-line transition-colors last:border-0 hover:bg-raised"
                  >
                    <td className="max-w-0 truncate px-4 py-2.5">
                      <span title={NAME_TITLE}>{project.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{project.websites}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{project.fields}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-2">
                        <RunDot status={project.lastRunState} detail={project.lastRunLabel ?? undefined} />
                        <span className="font-mono text-muted-foreground">{project.lastRunLabel ?? '—'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap text-muted-foreground">
                      {project.createdLabel}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        ) : null}

        {empty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5">
            <p className="text-base text-muted-foreground">
              No projects yet. A project holds the websites you collect data from.
            </p>
            <Button onClick={() => setCreating(true)}>New project</Button>
          </div>
        ) : null}

        {projects.isError ? (
          <p role="alert" className="px-4 py-5 text-base text-fail">
            The projects could not be loaded. Check that the api-server is running.
          </p>
        ) : null}
      </div>

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-line last:border-0">
          <td className="px-4 py-2.5">
            <Skeleton className="h-3.5 w-40 bg-raised" />
          </td>
          <td colSpan={4} />
        </tr>
      ))}
    </>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.projects.create.useMutation();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim() });
      await utils.projects.list.invalidate();
      setName('');
      onOpenChange(false);
    } catch {
      setError('That project could not be created. Try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Name it after the data you are collecting. You can rename it later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="project-name" className="text-sm font-normal text-muted-foreground">
              Name
            </Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Competitor prices"
              autoFocus
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-fail">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
