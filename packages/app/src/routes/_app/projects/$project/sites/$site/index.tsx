import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../../../components/page';

/** Schema: the fields this website is verified on. The layout owns the title and the tabs. */
export const Route = createFileRoute('/_app/projects/$project/sites/$site/')({
  component: () => <ComingLater />,
});
