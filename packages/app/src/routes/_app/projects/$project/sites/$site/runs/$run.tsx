import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../../../../components/page';

/** One run of this website. The layout owns the title and the tabs; Runs stays lit here. */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/runs/$run')({
  component: () => <ComingLater />,
});
