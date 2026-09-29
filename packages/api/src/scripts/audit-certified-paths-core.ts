// Would a website's certified paths still certify under spec 2026-09-29 C2?
// A weak field (yes/no, or one value on every proof page) may stand only on a
// path the customer confirmed, an element they marked, or a structured path
// whose name fits the field. Read-only: the customer re-verifies a flagged
// field; nothing is re-certified automatically.
import { isWeakField, qualifiesForWeak, type CertifiedPath, type CustomerFieldType, type VerificationSet } from '@robot/scraper';

export type AuditRow = { website: string; field: string; paths: string[]; ok: boolean; why?: string };

const label = (p: { source: string; path: string }) => `${p.source} ${p.path}`;

export function auditField(args: {
  website: string;
  field: { key: string; name: string; type: CustomerFieldType; concept: string };
  set: VerificationSet;
  certified: Array<{ source: CertifiedPath['source']; path: string }>;
}): AuditRow {
  const { website, field, set, certified } = args;
  const paths = certified.map(label);
  const byUrl = set.expected[field.key] ?? {};
  const checked = set.urls.map((u) => byUrl[u] ?? '').filter((v) => v.trim() !== '');
  if (!isWeakField(field.type, checked)) return { website, field: field.name, paths, ok: true };

  const confirmed = Object.values(set.paths?.[field.key] ?? {});
  const markXPaths = Object.values(set.marks?.[field.key] ?? {}).flatMap((m) => m.xpaths);
  const def = { ...field, description: '' };
  const bad = certified.filter((c) => !qualifiesForWeak(def, { ...c, transform: 'identity' }, { confirmed, markXPaths }));
  if (bad.length === 0) return { website, field: field.name, paths, ok: true };
  const kind = field.type === 'boolean' ? 'yes/no field' : 'same value on every product';
  return { website, field: field.name, paths, ok: false, why: `${kind} certified on paths that do not name it: ${bad.map(label).join(', ')}` };
}
