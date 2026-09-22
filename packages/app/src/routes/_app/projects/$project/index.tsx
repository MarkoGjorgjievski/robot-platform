import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../components/page';

export const Route = createFileRoute('/_app/projects/$project/')({
  component: () => <ComingLater title="Websites" />,
});
