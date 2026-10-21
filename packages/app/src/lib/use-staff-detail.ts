import { useRouteContext } from '@tanstack/react-router';
import { showsMoney } from './money-visibility';

/** Whether this viewer reads stored capture detail (spec 2026-10-21 §2): the same people who see money. */
export function useStaffDetail(): boolean {
  const { session } = useRouteContext({ from: '/_app' });
  return showsMoney(session);
}
