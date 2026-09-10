export function RunStatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'bg-pass'
    : status === 'partial' ? 'bg-warn'
    : status === 'failed' ? 'bg-fail'
    : status === 'extracting' || status === 'planning' || status === 'planned' || status === 'cancelling' ? 'bg-accent-600'
    : 'bg-changed';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
