import type { ReactNode } from 'react';

/** One row of the Settings definition list: a quiet label on the left, the control on the right. */
export function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0 sm:items-center">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
