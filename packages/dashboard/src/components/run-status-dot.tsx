export function RunStatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
    : status === 'running' ? 'bg-amber-500 animate-pulse'
    : 'bg-gray-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
