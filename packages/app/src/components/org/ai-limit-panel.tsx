import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { AI_LIMIT_TITLE, aiLimitView } from '../../lib/ai-limit-view';
import { LIMIT_REACHED } from '../../lib/ops-orgs-view';
import { mutationErrorText } from '../../lib/mutation-error';
import { trpc } from '../../lib/trpc';

/**
 * "Monthly AI limit" (spec 2026-10-24 metering §2.4): staff only — Settings draws it for an operator (their own org,
 * or a customer's while working as staff). It reads `ops.orgs` for this org and saves through `orgs.setAiCap`.
 */
export function AiLimitPanel({ orgId }: { orgId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.ops.orgs.useQuery({ orgId });
  const [draft, setDraft] = useState<string | null>(null);
  const save = trpc.orgs.setAiCap.useMutation({
    onSuccess: async () => {
      await utils.ops.orgs.invalidate();
      setDraft(null);
    },
  });
  const v = aiLimitView(query.data?.rows[0] ?? null, draft);

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">{AI_LIMIT_TITLE}</h2>
      <div className="space-y-2 px-4 py-3">
        {query.isError ? (
          <p role="alert" className="text-sm text-fail">The limit could not be loaded.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span data-testid="ai-limit-state" className="font-mono tabular-nums text-muted-foreground">
              {[v.spentLine, v.capLine, v.remainingLine].filter(Boolean).join(' · ')}
            </span>
            {v.reached ? <span className="rounded-full border border-fail px-2 text-sm text-fail">{LIMIT_REACHED}</span> : null}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="ai-limit" className="text-sm text-muted-foreground">Limit in USD</Label>
          <Input id="ai-limit" inputMode="decimal" value={v.draft} onChange={(e) => setDraft(e.target.value)} className="w-[140px]" />
          <Button size="sm" variant="outline" onClick={() => save.mutate({ capUsd: v.capUsd })} disabled={!!v.saveReason || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {v.saveReason && !save.isPending ? <span className="text-sm text-muted-foreground">{v.saveReason}</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">{v.hint}</p>
        {save.isError ? <p role="alert" className="text-sm text-fail">{mutationErrorText(save.error, true)}</p> : null}
      </div>
    </section>
  );
}
