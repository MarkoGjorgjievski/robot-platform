import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../../../components/page';

/** Settings: this website's own options. The layout owns the title and the tabs. */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/settings')({
  component: () => <ComingLater />,
});
