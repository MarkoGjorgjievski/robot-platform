import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function DomainDetail() {
  const { domain } = useParams({ from: '/domains/$domain' });
  return <Placeholder title="Domain Detail" phase="Phase 5" params={{ domain }} />;
}
