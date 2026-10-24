import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { ACCOUNT_MESSAGES_LINE, EMAIL_PREF_LOAD_FAILED, EMAIL_PREF_SAVE_FAILED, emailPrefRows, type EmailPrefs } from '../../lib/account-view';
import { trpc } from '../../lib/trpc';

/**
 * Which emails this person gets (spec 2026-10-24 email §3.4). Each switch saves on change — shown at once, put back
 * if the save fails; account messages are always sent.
 */
export function EmailPanel() {
  const utils = trpc.useUtils();
  const prefs = trpc.account.emailPrefs.useQuery();
  const update = trpc.account.updateEmailPrefs.useMutation({
    onMutate: async (patch) => {
      // A refetch landing mid-save would overwrite the switch the person just flipped.
      await utils.account.emailPrefs.cancel();
      const before = utils.account.emailPrefs.getData();
      if (before) utils.account.emailPrefs.setData(undefined, { ...before, ...patch });
      return { before };
    },
    onError: (_err, patch, context) => {
      // Put back only the switch this save was for, so the other switch's save in flight is kept.
      const was = context?.before;
      if (!was) return;
      utils.account.emailPrefs.setData(undefined, (now) => (now ? { ...now, ...pick(was, patch) } : was));
    },
    onSuccess: (saved, patch) => {
      utils.account.emailPrefs.setData(undefined, (now) => (now ? { ...now, ...pick(saved, patch) } : saved));
    },
  });

  function change(key: keyof EmailPrefs, on: boolean) {
    update.mutate(key === 'attention' ? { attention: on } : { failedRuns: on });
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Email</h2>
      <div className="space-y-2 px-4 py-3">
        {emailPrefRows(prefs.data).map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <Switch id={`email-${r.key}`} checked={r.checked} disabled={r.disabled} onCheckedChange={(on) => change(r.key, on)} />
            <Label htmlFor={`email-${r.key}`} className="text-base font-normal">{r.label}</Label>
          </div>
        ))}
        <p className="pt-1 text-sm text-muted-foreground">{ACCOUNT_MESSAGES_LINE}</p>
        {prefs.isError ? <p role="alert" className="text-sm text-fail">{EMAIL_PREF_LOAD_FAILED}</p> : null}
        {update.isError ? <p role="alert" className="text-sm text-fail">{EMAIL_PREF_SAVE_FAILED}</p> : null}
      </div>
    </section>
  );
}

/** The values of `from` for the keys a save named. */
function pick(from: EmailPrefs, patch: Partial<EmailPrefs>): Partial<EmailPrefs> {
  const out: Partial<EmailPrefs> = {};
  for (const k of Object.keys(patch) as Array<keyof EmailPrefs>) out[k] = from[k];
  return out;
}
