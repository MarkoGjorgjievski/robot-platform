import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import { mutationErrorText, type MutationErrorLike } from '../../lib/mutation-error';
import { useStaffDetail } from '../../lib/use-staff-detail';
import { WEBHOOK_HELP, maskSecret } from '../../lib/site/recurring-view';
import { SettingsRow } from './settings-row';

/** Spec 2026-10-24 §3.6: where a finished run is posted, and the secret that signs it. */
export function WebhookRow({ siteId, webhookUrl, webhookSecret }: { siteId: string; webhookUrl: string | null; webhookSecret: string | null }) {
  const utils = trpc.useUtils();
  const staff = useStaffDetail();
  const save = trpc.sources.update.useMutation();
  const remove = trpc.sources.update.useMutation();
  const rotate = trpc.sources.rotateWebhookSecret.useMutation();
  const [url, setUrl] = useState(webhookUrl ?? '');
  const [dirty, setDirty] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!dirty) setUrl(webhookUrl ?? ''); }, [webhookUrl, dirty]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await utils.sources.get.invalidate();
    } catch (e) {
      setError(mutationErrorText(e as MutationErrorLike, staff));
    }
  }

  return (
    <SettingsRow label="Webhook">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Webhook address" inputMode="url" placeholder="Your endpoint’s web address" value={url}
            onChange={(e) => { setDirty(true); setUrl(e.target.value); }} className="h-8 max-w-[420px]" />
          <Button size="sm" variant="outline" disabled={!dirty || url.trim() === '' || save.isPending}
            onClick={() => void act(async () => { await save.mutateAsync({ id: siteId, webhookUrl: url.trim() }); setDirty(false); })}>
            Save webhook
          </Button>
          {webhookUrl ? (
            <Button size="sm" variant="ghost" disabled={remove.isPending}
              onClick={() => void act(async () => { await remove.mutateAsync({ id: siteId, webhookUrl: null }); setDirty(false); })}>
              Remove
            </Button>
          ) : null}
        </div>

        {webhookUrl && webhookSecret ? (
          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="text-muted-foreground">Signing secret</span>
            <code className="font-mono text-sm break-all">{shown ? webhookSecret : maskSecret(webhookSecret)}</code>
            <Button size="sm" variant="ghost" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</Button>
            <Button size="sm" variant="ghost"
              onClick={() => void navigator.clipboard.writeText(webhookSecret).then(() => setCopied(true), () => setError('That could not be copied. Show the secret and copy it by hand.'))}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="outline" disabled={rotate.isPending}
              onClick={() => void act(async () => { await rotate.mutateAsync({ id: siteId }); setCopied(false); })}>
              Replace secret
            </Button>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">{WEBHOOK_HELP}</p>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}
