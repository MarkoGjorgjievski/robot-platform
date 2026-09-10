// packages/dashboard/src/components/status-strip.tsx
import { Loader2, ArrowRight, Lock } from 'lucide-react';

/** The Schema tab's fixed-height status strip (spec 5.6): summary, stage, progress, lock note, and the two buttons. Never changes height. */
export function StatusStrip({ summary, stage, progress, lockNote, tone = 'neutral', verify, extract }: {
  summary: string; stage?: string | null; progress?: number | null; lockNote?: string | null; tone?: 'neutral' | 'warn' | 'error';
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void; onDisabledClick?: () => void };
  extract: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void };
}) {
  const toneClass = tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-gray-200 bg-white text-gray-900';
  return (
    <div className={`flex h-[38px] items-center gap-3 rounded-lg border px-3 text-sm ${toneClass}`} role="status" aria-live="polite">
      <span className="font-medium">{summary}</span>
      {progress !== null && progress !== undefined && (
        <span className="relative inline-block h-1.5 w-28 overflow-hidden rounded bg-gray-200" aria-hidden>
          <span className="absolute inset-y-0 left-0 bg-accent-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      {stage && <span className="truncate text-xs text-gray-500">{stage}</span>}
      <span className="ml-auto flex flex-shrink-0 items-center gap-2">
        {lockNote && <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Lock className="h-3 w-3" />{lockNote}</span>}
        <span onClick={() => { if (verify.disabled) verify.onDisabledClick?.(); }} title={verify.disabled ? verify.reason : undefined}>
          <button type="button" className="btn-quiet h-7" disabled={verify.disabled} onClick={verify.onClick}>
            {verify.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{verify.label}
          </button>
        </span>
        <span title={extract.disabled ? extract.reason : undefined}>
          <button type="button" className="btn-primary h-7 text-xs" disabled={extract.disabled} onClick={extract.onClick}>
            {extract.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}{extract.label}
          </button>
        </span>
      </span>
    </div>
  );
}
