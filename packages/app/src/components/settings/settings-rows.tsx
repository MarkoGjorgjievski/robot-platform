import { useEffect, useState, type ReactNode } from 'react';
import { InlineRename } from '../site/inline-rename';
import { NumberBox } from '../ui/number-box';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { budgetFromForm } from '../../lib/site/extract-view';
import { listingModeLabel, modeLockNote, budgetSummary } from '../../lib/site-settings-view';

/** Where a `custom` box starts when the dropdown flips to it — same starters as the Extract tab's. */
const DEFAULT_ITEMS = 40;
const DEFAULT_PAGES = 3;

type Budget = { max_items: number | 'all'; max_pages: number | 'all'; mode?: 'all' | 'first_n' } | null;

export type SettingsSite = {
  id: string;
  name: string;
  url: string | null;
  listingMode: 'listing_to_detail' | 'detail' | null;
  confirmedAt: Date | null;
  budget: Budget;
  isActive: boolean;
};

/**
 * The Settings tab's definition-list panel: Name, Address, Listing mode,
 * Budget, Active — everything a website has that is only ever read and
 * corrected here, not on the tabs that do the work. Owns its own
 * `sources.update` calls the same way `InlineRename` owns `sources.rename`:
 * one row's edit is one round trip, not a form with a single Save at the
 * bottom pretending five unrelated settings are one decision.
 */
export function SettingsRows({ site }: { site: SettingsSite }) {
  const utils = trpc.useUtils();
  const update = trpc.sources.update.useMutation();

  const locked = !!site.confirmedAt;
  const lockNote = modeLockNote(site.confirmedAt);

  const [modeError, setModeError] = useState<string | null>(null);
  async function setListingMode(mode: 'listing_to_detail' | 'detail') {
    setModeError(null);
    try {
      await update.mutateAsync({ id: site.id, listingMode: mode });
      await Promise.all([utils.sources.get.invalidate(), utils.projects.get.invalidate()]);
    } catch (e) {
      // The Select is already disabled with `lockNote` for the ordinary case;
      // this is only reached by a race (confirmed between load and click), so
      // the server's own reason is shown rather than a second, competing note.
      const err = e as { message?: string };
      setModeError(err.message ?? 'That could not be saved.');
    }
  }

  const [items, setItems] = useState<number | 'all'>(site.budget?.max_items ?? 'all');
  const [pages, setPages] = useState<number | 'all'>(site.budget?.max_pages ?? 'all');
  const [budgetDirty, setBudgetDirty] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  // The server is the authority on the budget: it follows a fresh `sources.get`
  // unless the customer is mid-edit, exactly as `InlineRename` follows the name.
  useEffect(() => {
    if (!budgetDirty) {
      setItems(site.budget?.max_items ?? 'all');
      setPages(site.budget?.max_pages ?? 'all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.budget?.max_items, site.budget?.max_pages, budgetDirty]);

  async function saveBudget() {
    setBudgetError(null);
    try {
      await update.mutateAsync({ id: site.id, budget: budgetFromForm(items, pages) });
      setBudgetDirty(false);
      await Promise.all([utils.sources.get.invalidate(), utils.projects.get.invalidate()]);
    } catch {
      setBudgetError('That budget could not be saved.');
    }
  }

  const [activeError, setActiveError] = useState<string | null>(null);
  async function toggleActive() {
    setActiveError(null);
    try {
      await update.mutateAsync({ id: site.id, isActive: !site.isActive });
      await Promise.all([utils.sources.get.invalidate(), utils.projects.get.invalidate()]);
    } catch {
      setActiveError('That could not be saved.');
    }
  }

  return (
    <dl className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <Row label="Name">
        <InlineRename sourceId={site.id} name={site.name} ariaLabel="Name" />
      </Row>

      <Row label="Address">
        <span className="block max-w-full font-mono text-base break-all">{site.url ?? '—'}</span>
      </Row>

      <Row label="Listing mode">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={site.listingMode ?? undefined}
            onValueChange={(v) => void setListingMode(v as 'listing_to_detail' | 'detail')}
            disabled={locked || update.isPending}
          >
            <SelectTrigger size="sm" aria-label="Listing mode" className="w-[176px]">
              <SelectValue placeholder={listingModeLabel(null)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="listing_to_detail">{listingModeLabel('listing_to_detail')}</SelectItem>
              <SelectItem value="detail">{listingModeLabel('detail')}</SelectItem>
            </SelectContent>
          </Select>
          {/* Every disabled control says why, within a line of it. */}
          {lockNote ? <span className="text-sm text-muted-foreground">{lockNote}</span> : null}
        </div>
        {modeError ? (
          <p role="alert" className="mt-1 text-sm text-fail">
            {modeError}
          </p>
        ) : null}
      </Row>

      <Row label="Budget">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="text-muted-foreground">Products</span>
            <Select
              value={items === 'all' ? 'all' : 'custom'}
              onValueChange={(v) => {
                setBudgetDirty(true);
                setItems(v === 'all' ? 'all' : DEFAULT_ITEMS);
              }}
            >
              <SelectTrigger size="sm" aria-label="How many products" className="w-[104px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="custom">custom</SelectItem>
              </SelectContent>
            </Select>
            {items !== 'all' ? (
              <NumberBox
                value={items}
                label="How many products"
                onValue={(n) => {
                  setBudgetDirty(true);
                  setItems(n);
                }}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="text-muted-foreground">Pages</span>
            <Select
              value={pages === 'all' ? 'all' : 'custom'}
              onValueChange={(v) => {
                setBudgetDirty(true);
                setPages(v === 'all' ? 'all' : DEFAULT_PAGES);
              }}
            >
              <SelectTrigger size="sm" aria-label="How many pages" className="w-[104px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="custom">custom</SelectItem>
              </SelectContent>
            </Select>
            {pages !== 'all' ? (
              <NumberBox
                value={pages}
                label="How many pages"
                onValue={(n) => {
                  setBudgetDirty(true);
                  setPages(n);
                }}
              />
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground">{budgetSummary({ max_items: items, max_pages: pages })}</p>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => void saveBudget()} disabled={update.isPending}>
              Save budget
            </Button>
            {budgetError ? (
              <span role="alert" className="text-sm text-fail">
                {budgetError}
              </span>
            ) : null}
          </div>
        </div>
      </Row>

      <Row label="Active">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={site.isActive}
            onClick={() => void toggleActive()}
            disabled={update.isPending}
          >
            <span
              aria-hidden
              className={`size-2 rounded-full ${site.isActive ? 'bg-text' : 'bg-muted-foreground'}`}
            />
            {site.isActive ? 'Active' : 'Inactive'}
          </Button>
          {activeError ? (
            <span role="alert" className="text-sm text-fail">
              {activeError}
            </span>
          ) : null}
        </div>
      </Row>
    </dl>
  );
}

/** One row of the definition list: a quiet label on the left, the control on the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0 sm:items-center">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
