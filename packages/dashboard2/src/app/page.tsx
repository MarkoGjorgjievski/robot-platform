import Link from 'next/link';
import { api } from '@/trpc/server';
import { Plus, Building2, Globe, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default async function HomePage() {
  const orgs = await api.orgs.list();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage scraping projects for your customers
          </p>
        </div>
        <Link href="/new-customer">
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New Customer
          </Button>
        </Link>
      </div>

      {orgs.length === 0 ? (
        <Card className="mt-12 flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
            <Building2 className="size-6 text-muted-foreground" />
          </div>
          <CardTitle className="mt-4">No customers yet</CardTitle>
          <CardDescription className="mt-1">Get started by adding your first customer.</CardDescription>
          <Link href="/new-customer" className="mt-5">
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" />
              Add Customer
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => (
            <Link key={org.id} href={`/scraper/${org.slug}`}>
              <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-ring/30">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Building2 className="size-4" />
                    </div>
                  </div>
                  <CardTitle className="mt-1">{org.name}</CardTitle>
                  {org.description && (
                    <CardDescription className="line-clamp-2">{org.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FolderOpen className="size-3" />
                      {org.extractorCount} extractors
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
