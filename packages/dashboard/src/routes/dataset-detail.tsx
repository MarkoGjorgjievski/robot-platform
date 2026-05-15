import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function DatasetDetail() {
  const { project, dataset } = useParams({ from: '/p/$project/datasets/$dataset' });
  return <Placeholder title="Dataset Detail" phase="Phase 3" params={{ project, dataset }} />;
}
