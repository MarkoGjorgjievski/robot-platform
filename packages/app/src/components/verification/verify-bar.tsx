import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import { verifySteps } from '../../lib/site/verify-steps';
import { dateTime, utcDateTime } from '../../lib/when';

/** Why Accept and Accept all agreed are disabled while a Verify runs. */
export const LOCKED_REASON = 'Locked while this verification runs';

const SAVE_LABEL: Record<'idle' | 'pending' | 'saving' | 'error', { text: string; className: string }> = {
  idle: { text: 'saved', className: 'text-muted-foreground' },
  pending: { text: 'saving…', className: 'text-muted-foreground' },
  saving: { text: 'saving…', className: 'text-muted-foreground' },
  error: { text: 'Not saved — it will try again on your next change or when you verify', className: 'text-warn' },
};

/**
 * The bar above the verification table: where the customer is (Products →
 * Check values → Verify → Extract) and the one thing to do next (Marko
 * 2026-11-13). Exactly one button is filled at a time — Accept all agreed
 * while rows agree, then Verify, then Go to Extract; the others are outlined
 * or absent, so nothing sits there disabled without being the next step.
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
  progress,
  verifiedAt,
}: {
  /** `locked`: a Verify is running. With nothing agreed, or locked, the button is not shown. */
  acceptAll: { count: number; disabled: boolean; locked?: boolean; onClick: () => void };
  /** `message` (spec 2026-10-20 §3.1): the one sentence about the last Verify — a refusal, a failed or a stalled run. */
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void; message?: string | null };
  saveState: 'idle' | 'pending' | 'saving' | 'error';
  /** The server's reason the last save was refused, in one line; shown with the error state. */
  saveError?: string | null;
  /** `variants`: this website's variants must be verified too. */
  extract: { enabled: boolean; project: string; site: string; variants?: boolean };
  /** Where a running Verify is, e.g. "checking product 2 of 3". `null` when nothing is running. */
  stage: string | null;
  /** What the rail counts: product columns with a page, and accepted fields of all. */
  progress: { products: number; accepted: number; total: number };
  /** When the last completed Verify finished; null when there is none (or only a failed one). */
  verifiedAt?: Date | string | null;
}) {
  const save =
    saveState === 'error' && saveError
      ? { ...SAVE_LABEL.error, text: `Not saved: ${saveError} — it will try again on your next change or when you verify` }
      : SAVE_LABEL[saveState];

  const steps = verifySteps({ ...progress, busy: verify.busy, stage: verify.busy ? stage : null, extract: extract.enabled, variants: !!extract.variants, verifiedAt: dateTime(verifiedAt, { short: true }) });
  const lastVerify = verify.busy ? null : dateTime(verifiedAt);
  const showAccept = acceptAll.count > 0 && !acceptAll.disabled;
  // The one filled button: the first of Accept all agreed, Verify, Go to Extract that can be pressed.
  const filled: 'accept' | 'verify' | 'extract' | null = showAccept ? 'accept' : !verify.disabled ? 'verify' : extract.enabled ? 'extract' : null;

  return (
    <div className="rise flex flex-col gap-2 rounded-[6px] border border-line bg-panel p-3 [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {steps.map((s, i) => (
            <li key={s.name} aria-current={s.state === 'now' ? 'step' : undefined} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs transition-colors duration-300',
                  s.state === 'done' && 'step-pop border-pass bg-pass text-bg',
                  s.state === 'now' && 'border-text bg-text text-bg',
                  s.state === 'next' && 'border-line-hover text-muted-foreground',
                )}
              >
                {s.state === 'done' ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className="flex flex-col leading-tight">
                <span className={cn('text-base font-medium', s.state === 'next' && 'text-muted-foreground')}>{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.sub}</span>
              </span>
              {i < steps.length - 1 ? <span aria-hidden className={cn('ml-1 hidden h-px w-6 sm:block', s.state === 'done' ? 'bg-pass/40' : 'bg-line')} /> : null}
            </li>
          ))}
        </ol>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Every disabled control says why, within a line of it. */}
          {verify.disabled && verify.reason && !verify.busy ? (
            <span className="min-w-0 truncate text-sm text-muted-foreground" title={verify.reason}>
              {verify.reason}
            </span>
          ) : null}
          {showAccept ? (
            <Button size="sm" onClick={acceptAll.onClick}>
              Accept all agreed ({acceptAll.count})
            </Button>
          ) : null}
          <Button size="sm" variant={filled === 'verify' ? 'default' : 'outline'} disabled={verify.disabled} onClick={verify.onClick}>
            {verify.busy ? <Loader2 className="animate-spin" /> : null}
            {verify.label}
          </Button>
          {extract.enabled ? (
            <Link
              to="/projects/$project/sites/$site/extract"
              params={{ project: extract.project, site: extract.site }}
              className={cn(buttonVariants({ size: 'sm', variant: filled === 'extract' ? 'default' : 'outline' }), 'w-fit')}
            >
              Go to Extract
              <ArrowRight />
            </Link>
          ) : null}
        </div>
      </div>

      {verify.message ? (
        <p role="alert" data-testid="verify-message" className="text-sm text-fail">
          {verify.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {/* While a Verify runs its stage is the Verify step's own line; this is the quiet check after it. */}
        <p className="text-sm text-muted-foreground">{verify.busy ? '' : (stage ?? '')}</p>
        <p className="flex flex-wrap items-center justify-end gap-x-3 text-sm">
          {/* Local time; the tooltip says it in UTC. The server renders in its own zone, hence the suppression. */}
          {lastVerify ? (
            <time dateTime={new Date(verifiedAt!).toISOString()} title={utcDateTime(verifiedAt) ?? undefined} className="text-muted-foreground" suppressHydrationWarning>
              Last verified {lastVerify}
            </time>
          ) : null}
          <span className={save.className}>{save.text}</span>
        </p>
      </div>
    </div>
  );
}
