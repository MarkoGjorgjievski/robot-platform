import { Link, useParams } from '@tanstack/react-router';
import { RunDot } from '../run-dot';
import { runDotState } from '../../lib/run-dot-view';
import { PROJECT_NAV } from '../../lib/project-nav-view';
import { trpc } from '../../lib/trpc';

/** Reads the current project's slug from the URL anywhere in the shell; undefined outside a project. */
export function useProjectSlug(): string | undefined {
  const params = useParams({ strict: false }) as { project?: string };
  return params.project;
}

/**
 * The sidebar's project section (spec §3): under the org-wide nav, the project
 * the customer is in — its websites, then Fields and Output. Rendered only
 * inside a project; the query is the same one the screen runs.
 */
export function ProjectSection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useProjectSlug();
  const project = trpc.projects.get.useQuery({ projectSlug: slug! }, { enabled: !!slug });
  if (!slug || !project.data) return null;

  return (
    <div className="border-t border-line p-2">
      <p className="truncate px-2 pt-1 pb-1.5 text-sm text-muted-foreground">{project.data.name}</p>
      {/* Its own landmark: the org-wide nav above is a `nav`, and a screen-reader
          user navigating by landmark would otherwise find Projects/Runs/Usage/
          Settings and not this project's three screens. */}
      <nav aria-label="Project">
        {PROJECT_NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            params={{ project: slug }}
            activeOptions={{ exact: item.exact }}
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
            activeProps={{ className: 'bg-raised font-medium text-text!' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {/* The websites, one line each with the run dot — the "is anything running" glance (spec §4).
          Plain rows until plan 3 gives a website its page. */}
      {project.data.websites.length > 0 ? (
        <ul className="mt-1 border-t border-line pt-1">
          {project.data.websites.map((w) => (
            <li key={w.id} className="flex items-center gap-2.5 px-2 py-1 text-sm text-muted-foreground">
              <RunDot status={runDotState(w.lastRun)} />
              <span className="truncate">{w.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
