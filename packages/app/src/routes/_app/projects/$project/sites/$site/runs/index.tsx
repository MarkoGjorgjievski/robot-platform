import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../../../../components/page';

/**
 * Runs: this website's extraction history (Task 6). The layout owns the title
 * and the tabs.
 *
 * `runs/index.tsx` rather than `runs.tsx`: a single run is a sibling screen, not
 * something drawn inside the list, and a `runs.tsx` beside a `runs/` directory
 * is a *layout* for it — its body would stay on screen above every run page.
 */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/runs/')({
  component: () => <ComingLater />,
});
