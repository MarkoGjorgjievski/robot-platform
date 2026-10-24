import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { trpc } from '../../lib/trpc';
import { mutationErrorText, type MutationErrorLike } from '../../lib/mutation-error';
import { useStaffDetail } from '../../lib/use-staff-detail';
import {
  COPY_FAILED, REPLACE_SECRET_TEXT, REPLACE_SECRET_TITLE, WEBHOOK_HELP, maskSecret, webhookSaveReason, withRotatedSecret,
} from '../../lib/site/recurring-view';
import { SettingsRow } from './settings-row';

/** How long "Copied" stays before the button reads "Copy" again. */
const COPIED_MS = 2000;

/** Spec 2026-10-24 §3.6: where a finished run is posted, and the secret that signs it. */
export function WebhookRow({ siteId, webhookUrl, webhookSecret }: { siteId: string; webhookUrl: string | null; webhookSecret: string | null }) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const staff = useStaffDetail();
  const save = trpc.sources.update.useMutation();
  const remove = trpc.sources.update.useMutation();
  const rotate = trpc.sources.rotateWebhookSecret.useMutation();
  const [url, setUrl] = useState(webhookUrl ?? '');
  const [dirty, setDirty] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!dirty) setUrl(webhookUrl ?? ''); }, [webhookUrl, dirty]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  /**
   * One action, then a fresh `sources.get`. The form stays "edited" until that refetch has landed, so the sync effect
   * never puts the old address back in the meantime; if the refetch fails the field keeps what was typed (and saved).
   */
  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(mutationErrorText(e as MutationErrorLike, staff));
      return false;
    }
    try {
      await utils.sources.get.invalidate(undefined, undefined, { throwOnError: true });
      setDirty(false);
    } catch {
      // Saved; the page just could not reload it. The field already shows what the server holds.
    }
    return true;
  }

  function copy(secret: string) {
    setError(null);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      setError(COPY_FAILED);
      return;
    }
    clipboard.writeText(secret).then(() => setCopied(true), () => setError(COPY_FAILED));
  }

  /** The new secret goes into every cached `sources.get` of this website straight from the answer (M4): the row shows it
   * even when the refetch after it fails, never the old one a customer might copy. */
  async function replaceSecret() {
    const { webhookSecret: secret } = await rotate.mutateAsync({ id: siteId });
    queryClient.setQueriesData({ queryKey: getQueryKey(trpc.sources.get) },
      (old) => withRotatedSecret(old as { id: string; webhookSecret: string | null } | undefined, siteId, secret));
  }

  /** Closing the confirm without replacing clears its error, so it never shows up later under the row. */
  function closeConfirm() {
    setConfirming(false);
    setError(null);
  }

  const saveReason = webhookSaveReason(dirty, url, !!webhookUrl);

  return (
    <SettingsRow label="Webhook">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Webhook address" inputMode="url" placeholder="Your endpoint’s web address" value={url}
            onChange={(e) => { setDirty(true); setError(null); setUrl(e.target.value); }} className="h-8 max-w-[420px]" />
          <Button size="sm" variant="outline" disabled={!!saveReason || save.isPending}
            onClick={() => void act(() => save.mutateAsync({ id: siteId, webhookUrl: url.trim() }))}>
            {save.isPending ? 'Saving…' : 'Save webhook'}
          </Button>
          {webhookUrl ? (
            <Button size="sm" variant="ghost" disabled={remove.isPending}
              onClick={() => void act(() => remove.mutateAsync({ id: siteId, webhookUrl: null }))}>
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          ) : null}
          {/* Every disabled control says why, within a line of it. */}
          {saveReason ? <span className="text-sm text-muted-foreground">{saveReason}</span> : null}
        </div>

        {webhookUrl && webhookSecret ? (
          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="text-muted-foreground">Signing secret</span>
            <code className="font-mono text-sm break-all">{shown ? webhookSecret : maskSecret(webhookSecret)}</code>
            <Button size="sm" variant="ghost" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</Button>
            <Button size="sm" variant="ghost" onClick={() => copy(webhookSecret)}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {/* Kept apart from Show / Copy, and confirmed: a new secret breaks links already sent. */}
            <Button size="sm" variant="outline" className="ml-2 border-fail text-fail hover:border-fail hover:bg-raised" disabled={rotate.isPending} onClick={() => { setError(null); setConfirming(true); }}>
              Replace secret
            </Button>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">{WEBHOOK_HELP}</p>
        {error && !confirming ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
      </div>

      <Dialog open={confirming} onOpenChange={(open) => { if (rotate.isPending) return; if (open) setConfirming(true); else closeConfirm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{REPLACE_SECRET_TITLE}</DialogTitle>
            <DialogDescription>{REPLACE_SECRET_TEXT}</DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm} disabled={rotate.isPending}>Cancel</Button>
            <Button variant="destructive" disabled={rotate.isPending}
              onClick={() => void act(replaceSecret).then((ok) => {
                if (ok) { setConfirming(false); setCopied(false); setShown(false); }
              })}>
              {rotate.isPending ? 'Replacing…' : 'Replace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsRow>
  );
}
