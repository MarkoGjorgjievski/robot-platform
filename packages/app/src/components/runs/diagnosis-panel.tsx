import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import type { Diagnosis } from '../../lib/site/diagnose-run';

/**
 * What the sample's own evidence says went wrong, and the one thing that can be
 * done about it from here.
 *
 * `diagnoseRun` is a cascade, not a list: the first category that matches is the
 * whole answer, so this panel usually holds exactly one explanation. The
 * exception is the extraction category, where each failed page is reported
 * verbatim under its own address, because no single sentence summarises "these
 * pages failed for these reasons" without losing what the customer needs.
 *
 * The one action is Settings. Changing which pages this website extracts from is
 * the Schema tab's job, and saying so in a line beats a second button that
 * lands somewhere the customer then has to work out.
 */
export function DiagnosisPanel({
  diagnosis,
  project,
  site,
}: {
  diagnosis: Diagnosis[];
  project: string;
  site: string;
}) {
  return (
    <div className="rise mb-3 rounded-[6px] border border-line bg-panel px-4 py-3 [box-shadow:var(--shadow)]">
      <h3 className="text-base font-medium">What went wrong</h3>

      {diagnosis.length === 0 ? (
        <p className="mt-1 text-base text-muted-foreground">
          Nothing in this extraction's own evidence points at a cause. Use your judgment, or take the action
          below.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {/* The state colour on the words, on a rail, with no tinted box behind
              them (spec §4). Keyed by position and title: two entries can
              genuinely carry the same address, and this list is only ever
              re-derived whole. */}
          {diagnosis.map((d, i) => (
            <li key={`${i}-${d.title}`} className="border-l-2 border-fail pl-3">
              <p className="text-base break-words text-fail">{d.title}</p>
              <p className="mt-0.5 text-base break-words">{d.detail}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-base text-muted-foreground">
        To change the pages this website extracts from, change its products on the Verification tab.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects/$project/sites/$site/settings" params={{ project, site }}>
            Go to Settings
          </Link>
        </Button>
      </div>
    </div>
  );
}
