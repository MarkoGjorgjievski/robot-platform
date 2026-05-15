import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function InputSetDetail() {
  const { project, inputset } = useParams({ from: '/p/$project/inputs/$inputset' });
  return <Placeholder title="Input Set Detail" phase="Phase 3" params={{ project, inputset }} />;
}
