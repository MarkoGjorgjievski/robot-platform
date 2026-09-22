import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../../../components/page';

/** Extract: which pages of this website to collect from. The layout owns the title and the tabs. */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/extract')({
  component: () => <ComingLater />,
});
