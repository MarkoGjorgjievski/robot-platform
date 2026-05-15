import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function DatasetsList() {
  const { project } = useParams({ from: '/p/$project/datasets' });
  return <Placeholder title="Datasets" phase="Phase 3" params={{ project }} />;
}
