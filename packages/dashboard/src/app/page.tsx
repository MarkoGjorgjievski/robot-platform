import { api } from '@/trpc/server';

export default async function HomePage() {
  const [orgs, extractors, domains] = await Promise.all([
    api.orgs.list(),
    api.extractors.list(),
    api.domains.list(),
  ]);

  const stats = [
    { label: 'Organizations', value: orgs.length, href: '/orgs' },
    { label: 'Extractors', value: extractors.length, href: '/extractors' },
    { label: 'Domains', value: domains.length, href: '/domains' },
  ];

  const activeExtractors = extractors.filter((e) => e.isActive).length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">
        Overview of your extractor platform
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {stats.map((stat) => (
          <a
            key={stat.label}
            href={stat.href}
            className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
          >
            <p className="text-sm font-medium text-gray-500">{stat.label}</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {stat.value}
            </p>
          </a>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-green-600">{activeExtractors}</span> active extractors out of{' '}
          <span className="font-semibold">{extractors.length}</span> total
        </p>
      </div>
    </div>
  );
}
