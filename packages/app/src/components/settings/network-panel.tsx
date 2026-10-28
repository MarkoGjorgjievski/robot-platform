import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { trpc } from '../../lib/trpc';
import { mutationErrorText, type MutationErrorLike } from '../../lib/mutation-error';
import {
  GO_DIRECT, NETWORK_HELP, NETWORK_TITLE, NO_COUNTRY, countryChoices, countryFromChoice, fallbackSwitchLine, proxySaveReason, proxyStateLine, useDefaultReason,
  type NetworkSettings,
} from '../../lib/site/network-view';
import { SettingsRow } from './settings-row';

/**
 * Spec 2026-10-24 proxy §2.3: the website's proxy and country, staff only. The saved address comes back masked and is
 * never filled into the field; typing a new one replaces it (Show reveals what is being typed). One mutation per
 * action, as the other rows do.
 */
export function NetworkPanel({ siteId, network }: { siteId: string; network: NetworkSettings }) {
  const utils = trpc.useUtils();
  const save = trpc.sources.update.useMutation();
  const useDefault = trpc.sources.update.useMutation();
  const setCountry = trpc.sources.update.useMutation();
  const goDirect = trpc.sources.update.useMutation();
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setError(null);
    try {
      await fn();
      after?.();
      await utils.sources.get.invalidate();
    } catch (e) {
      setError(mutationErrorText(e as MutationErrorLike, true));
    }
  }

  const saveReason = proxySaveReason(typed);
  const defaultReason = useDefaultReason(network);
  const switched = fallbackSwitchLine(network.fallbackProxyAt);

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">{NETWORK_TITLE}</h2>
      <dl>
        <SettingsRow label="Proxy">
          <div className="space-y-2">
            <p className="font-mono text-sm break-all" data-testid="proxy-state">{proxyStateLine(network)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="proxy-url" aria-label="New proxy address" type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                placeholder="http://user:pass@host:port" value={typed} className="h-8 max-w-[420px] font-mono"
                onChange={(e) => { setError(null); setTyped(e.target.value); }} />
              <Button size="sm" variant="ghost" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</Button>
              <Button size="sm" variant="outline" disabled={!!saveReason || save.isPending}
                onClick={() => void act(() => save.mutateAsync({ id: siteId, proxyUrl: typed.trim() }), () => { setTyped(''); setShown(false); })}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!defaultReason || useDefault.isPending}
                onClick={() => void act(() => useDefault.mutateAsync({ id: siteId, proxyUrl: null }))}>
                Use the default
              </Button>
            </div>
            {/* Every disabled control says why, within a line of it. */}
            {saveReason || defaultReason ? (
              <p className="text-sm text-muted-foreground">{[saveReason, defaultReason].filter(Boolean).join(' · ')}</p>
            ) : null}
            {network.problem ? <p role="alert" className="text-sm text-warn">{network.problem}</p> : null}
            {/* Spec 2026-10-28 §3.3 "Undo": the website switched to the fallback proxy on its own; staff can send it direct again. */}
            {switched ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="fallback-switch">
                <p className="text-sm">{switched}</p>
                <Button size="sm" variant="outline" disabled={goDirect.isPending}
                  onClick={() => void act(() => goDirect.mutateAsync({ id: siteId, fallbackProxy: false }))}>
                  {goDirect.isPending ? 'Saving…' : GO_DIRECT}
                </Button>
              </div>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow label="Country">
          <Select value={network.country ?? NO_COUNTRY} disabled={setCountry.isPending}
            onValueChange={(v) => void act(() => setCountry.mutateAsync({ id: siteId, country: countryFromChoice(v) }))}>
            <SelectTrigger size="sm" aria-label="Country" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {countryChoices(network.countries).map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </SettingsRow>
      </dl>
      <div className="space-y-1 border-t border-line px-4 py-3">
        <p className="text-sm text-muted-foreground">{NETWORK_HELP}</p>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
      </div>
    </section>
  );
}
