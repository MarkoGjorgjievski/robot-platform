import { ArrowRight, Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

const SAVE_LABEL: Record<'idle' | 'pending' | 'saving' | 'error', { text: string; className: string }> = {
  idle: { text: 'saved', className: 'text-muted-foreground' },
  pending: { text: 'saving…', className: 'text-muted-foreground' },
  saving: { text: 'saving…', className: 'text-muted-foreground' },
  error: { text: 'Not saved — it will try again on your next change or when you verify', className: 'text-warn' },
};

/**
 * The bar above the verification table (spec 2026-09-28 A1): Accept all
 * agreed, the Verify gate, the save line, the stage line, Go to Extract.
 * Moved from `fields-sidebar.tsx`'s footer, plus Accept all agreed, which is
 * new here.
 *
 * Locking is one flag for the whole tab, not one per row — `stage` is only
 * non-null while a Verify run is in flight (spec §2.5: "the rectangles, cards
 * and inputs lock" for that same span), so it doubles as the lock; the caller
 * folds it into every button's own `disabled`.
 */
export function VerifyBar({
  acceptAll,
  verify,
  saveState,
  saveError,
  extract,
  stage,
}: {
  acceptAll: { count: number; disabled: boolean; onClick: () => void };
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void };
  saveState: 'idle' | 'pending' | 'saving' | 'error';
  /** The server's reason the last save was refused, in one line; shown with the error state. */
  saveError?: string | null;
  extract: { enabled: boolean; project: string; site: string };
  /** Where a running Verify is, e.g. "checking product 2 of 3". `null` when nothing is running. */
  stage: string | null;
}) {
  const save =
    saveState === 'error' && saveError
      ? { ...SAVE_LABEL.error, text: `Not saved: ${saveError} — it will try again on your next change or when you verify` }
      : SAVE_LABEL[saveState];

  return (
    <div className="rise flex flex-col gap-2 rounded-[6px] border border-line bg-panel p-3 [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={acceptAll.disabled} onClick={acceptAll.onClick}>
            Accept all agreed ({acceptAll.count})
          </Button>
          {acceptAll.disabled && acceptAll.count === 0 ? (
            <span className="text-sm text-muted-foreground">Nothing agreed to accept</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={verify.disabled} onClick={verify.onClick}>
            {verify.busy ? <Loader2 className="animate-spin" /> : null}
            {verify.label}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {verify.disabled && verify.reason ? (
            <span className="min-w-0 truncate text-sm text-muted-foreground" title={verify.reason}>
              {verify.reason}
            </span>
          ) : null}
        </div>
      </div>

      <p className={cn('text-sm', save.className)}>{save.text}</p>

      {stage ? <p className="text-sm text-muted-foreground">{stage}</p> : null}

      {extract.enabled ? (
        <Link
          to="/projects/$project/sites/$site/extract"
          params={{ project: extract.project, site: extract.site }}
          className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}
        >
          Go to Extract
          <ArrowRight />
        </Link>
      ) : (
        <div>
          <Button size="sm" variant="outline" disabled className="w-fit">
            Go to Extract
            <ArrowRight />
          </Button>
          <p className="mt-1 text-sm text-muted-foreground">Unlocks when every field is verified</p>
        </div>
      )}
    </div>
  );
}
