import Link from 'next/link';
import { api } from '@/trpc/server';
import { Building2Icon, BotIcon, GlobeIcon } from 'lucide-react';

export default async function HomePage() {
  const [orgs, extractors, domains] = await Promise.all([
    api.orgs.list(),
    api.extractors.list(),
    api.domains.list(),
  ]);

  const activeExtractors = extractors.filter((e) => e.isActive).length;

  const stats = [
    { label: 'Organizations', value: orgs.length, href: '/orgs', icon: Building2Icon },
    { label: 'Extractors', value: extractors.length, href: '/legacy/extractors', icon: BotIcon },
    { label: 'Domains', value: domains.length, href: '/legacy/domains', icon: GlobeIcon },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold" style={{ color: 'var(--ws-text)' }}>
        Dashboard
      </h1>
      <p className="mt-1 text-xs" style={{ color: 'var(--ws-text-muted)' }}>
        Overview of your extractor platform
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="rounded-lg p-5 transition-colors"
            style={{
              background: 'var(--ws-surface)',
              border: '1px solid var(--ws-border)',
            }}
          >
            <div className="flex items-center gap-2">
              <stat.icon className="size-3.5" style={{ color: 'var(--ws-accent)' }} />
              <span className="text-[0.65rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ws-text-muted)' }}>
                {stat.label}
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums" style={{ color: 'var(--ws-text)' }}>
              {stat.value}
            </p>
          </Link>
        ))}
      </div>

      <div
        className="mt-4 rounded-lg px-4 py-3 text-xs"
        style={{
          background: 'var(--ws-surface)',
          border: '1px solid var(--ws-border)',
          color: 'var(--ws-text-muted)',
        }}
      >
        <span className="font-semibold" style={{ color: 'var(--ws-success)' }}>{activeExtractors}</span>
        {' '}active extractors out of{' '}
        <span className="font-semibold" style={{ color: 'var(--ws-text)' }}>{extractors.length}</span>
        {' '}total
      </div>
    </div>
  );
}
