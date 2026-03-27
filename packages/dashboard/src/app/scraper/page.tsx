import Link from 'next/link';
import { api } from '@/trpc/server';
import { Plus, Building2, FolderOpen, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default async function ScraperHomePage() {
  const orgs = await api.orgs.list();

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Customers
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage scraping projects for your customers
          </p>
        </div>
        <Link href="/scraper/new-customer">
          <Button size="sm" className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800">
            <Plus className="size-3.5" />
            New Customer
          </Button>
        </Link>
      </div>

      {/* Customer Grid */}
      {orgs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-slate-100">
            <Building2 className="size-7 text-slate-400" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">No customers yet</h3>
          <p className="mt-1 text-sm text-slate-500">Get started by adding your first customer.</p>
          <Link href="/scraper/new-customer" className="mt-4">
            <Button size="sm" className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800">
              <Plus className="size-3.5" />
              Add Customer
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/scraper/${org.slug}`}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-900 group-hover:text-white">
                  <Building2 className="size-4" />
                </div>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{org.name}</h3>
              {org.description && (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{org.description}</p>
              )}
              <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <FolderOpen className="size-3" />
                  {org.extractorCount} extractors
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
