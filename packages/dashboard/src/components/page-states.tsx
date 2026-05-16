import { Loader2, AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, dismiss }: { message: string; dismiss?: () => void }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {dismiss && (
        <button onClick={dismiss} className="text-xs underline">dismiss</button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mt-8 rounded-md border border-dashed p-12 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function NotFound({ what }: { what: string }) {
  return <ErrorBanner message={`${what} not found.`} />;
}
