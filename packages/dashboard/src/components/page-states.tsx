import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-gray-600">
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, dismiss }: { message: string; dismiss?: () => void }) {
  return (
    <div className="mt-4 flex items-start gap-3 border-l-[3px] border-l-fail bg-fail-tint px-4 py-3 text-fail">
      <div className="min-w-0 flex-1">
        <p className="label-soft text-fail">Error</p>
        <p className="mt-0.5 text-sm">{message}</p>
      </div>
      {dismiss && (
        <button
          onClick={dismiss}
          className="text-xs font-medium underline-offset-2 hover:underline"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-gray-300 px-8 py-14 text-center">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-600">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NotFound({ what }: { what: string }) {
  return <ErrorBanner message={`${what} not found.`} />;
}
