import { Loader2, AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-gray-500">
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, dismiss }: { message: string; dismiss?: () => void }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <p className="micro-label text-red-600">Error</p>
        <p className="mt-0.5 text-sm text-red-800">{message}</p>
      </div>
      {dismiss && (
        <button
          onClick={dismiss}
          className="text-xs font-medium text-red-700 underline-offset-2 hover:underline"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white/50 px-8 py-14 text-center">
      <p className="text-sm font-medium text-gray-800">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NotFound({ what }: { what: string }) {
  return <ErrorBanner message={`${what} not found.`} />;
}
