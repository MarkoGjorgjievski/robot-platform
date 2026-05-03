import { db, quickExtractions } from '@robot/db';
import { desc } from 'drizzle-orm';
import { ExtractionsList } from './extractions-list';

export default async function ExtractionsPage() {
  const rows = await db
    .select()
    .from(quickExtractions)
    .orderBy(desc(quickExtractions.createdAt))
    .limit(50);

  // Group by domain
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = grouped.get(row.domain) ?? [];
    existing.push(row);
    grouped.set(row.domain, existing);
  }

  // Sort domains by most recent extraction
  const domains = Array.from(grouped.entries())
    .sort((a, b) => {
      const aDate = a[1][0].createdAt.getTime();
      const bDate = b[1][0].createdAt.getTime();
      return bDate - aDate;
    });

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Extractions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {rows.length} extraction{rows.length !== 1 ? 's' : ''} across {domains.length} domain{domains.length !== 1 ? 's' : ''}
      </p>

      <ExtractionsList domains={domains} />
    </div>
  );
}
