import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SandboxDetail() {
  const { shortid } = useParams({ from: '/sandbox/$shortid' });
  return <Placeholder title="Sandbox Source" phase="Phase 2" params={{ shortid }} />;
}
