import { Button } from '../ui/button';
import { formatStaffEntry, type StaffEntryView } from '../../lib/staff-view';

/**
 * The staff activity table (spec 2026-10-07 §2.4): When, Staff member,
 * optionally Customer, Website, and What happened — the same table
 * primitives the org Runs table uses (`components/runs/org-runs-table.tsx`).
 * Three call sites share it: the ops Staff activity page (every customer,
 * paged), a website's own "Staff activity" section (one website, no pager,
 * no customer column) and the customer's Settings (own org, paged, no
 * customer column). None of them add an outer panel border here — the
 * caller supplies whatever heading and panel chrome fits its own screen, so
 * this is only ever the table plus, when `onPage` is given, its pager.
 */
export function StaffActivityList({
  entries,
  showCustomer,
  total,
  page,
  pageSize,
  onPage,
  empty,
}: {
  entries: StaffEntryView[];
  showCustomer: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPage?: (page: number) => void;
  empty: string;
}) {
  const now = new Date();
  const colSpan = showCustomer ? 5 : 4;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(total, page * pageSize + entries.length);

  return (
    <div>
      <div className="overflow-x-auto md:overflow-x-visible">
        <table className="w-full min-w-[720px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col className="w-[96px]" />
            <col className="w-[200px]" />
            {showCustomer ? <col className="w-[160px]" /> : null}
            <col className="w-[160px]" />
            <col />
          </colgroup>
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
              <th className="px-4 text-left text-sm">When</th>
              <th className="px-3 text-left text-sm">Staff member</th>
              {showCustomer ? <th className="px-3 text-left text-sm">Customer</th> : null}
              <th className="px-3 text-left text-sm">Website</th>
              <th className="px-4 text-left text-sm">What happened</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              entries.map((e) => {
                const row = formatStaffEntry(e, now);
                return (
                  <tr key={e.id} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono text-sm text-muted-foreground">{row.when}</td>
                    <td className="max-w-0 px-3 py-2.5">
                      <div className="truncate">{row.who}</div>
                      {row.who !== row.whoDetail ? (
                        <div className="truncate text-sm text-muted-foreground">{row.whoDetail}</div>
                      ) : null}
                    </td>
                    {showCustomer ? <td className="max-w-0 truncate px-3 py-2.5">{e.org.name}</td> : null}
                    <td className="max-w-0 truncate px-3 py-2.5">{row.website}</td>
                    <td className="px-4 py-2.5">
                      {row.sentence}
                      {row.cost ? <span className="font-mono text-sm text-muted-foreground"> · {row.cost}</span> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {onPage ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-muted-foreground">
          <span>
            {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page === 0}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={to >= total}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
