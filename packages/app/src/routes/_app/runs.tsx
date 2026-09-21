import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../components/page';

export const Route = createFileRoute('/_app/runs')({
  component: () => <ComingLater title="Runs" />,
});
