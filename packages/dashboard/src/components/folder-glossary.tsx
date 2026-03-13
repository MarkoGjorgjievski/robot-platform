import Link from "next/link";
import { FolderIcon } from "lucide-react";
import { Breadcrumbs } from "./breadcrumbs";

interface FolderItem {
  name: string;
  href: string;
  count?: number;
  description?: string | null;
}

interface Crumb {
  label: string;
  href?: string;
}

interface FolderGlossaryProps {
  items: FolderItem[];
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  children?: React.ReactNode;
}

export function FolderGlossary({
  items,
  title,
  description,
  breadcrumbs,
  children,
}: FolderGlossaryProps) {
  // Group items by first letter
  const grouped = new Map<string, FolderItem[]>();
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = item.name[0]?.toUpperCase() ?? "#";
    if (!grouped.has(letter)) grouped.set(letter, []);
    grouped.get(letter)!.push(item);
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumbs */}
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ws-text)" }}>
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-xs" style={{ color: "var(--ws-text-muted)" }}>
            {description}
          </p>
        )}
      </div>

      {/* Inline form slot (create new) */}
      {children && (
        <div className="mb-6">{children}</div>
      )}

      {/* Empty state */}
      {items.length === 0 && !children && (
        <div
          className="flex items-center justify-center rounded-lg py-20"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}
        >
          <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>
            Nothing here yet.
          </span>
        </div>
      )}

      {/* Glossary */}
      <div className="space-y-6">
        {[...grouped.entries()].map(([letter, folderItems]) => (
          <div key={letter}>
            {/* Letter heading */}
            <div
              className="mb-3 flex items-center gap-2"
              style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
            >
              <span
                className="pb-2 text-xs font-bold uppercase tracking-widest"
                style={{ color: "var(--ws-text-muted)" }}
              >
                {letter}
              </span>
            </div>

            {/* Folder grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {folderItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex flex-col items-center gap-2 rounded-lg px-3 py-4 transition-colors hover:bg-[var(--ws-surface-hover)]"
                >
                  <FolderIcon
                    className="size-10 transition-colors"
                    style={{ color: "var(--ws-text-dim)" }}
                    fill="var(--ws-surface-raised)"
                    strokeWidth={1}
                  />
                  <div className="w-full text-center min-w-0">
                    <p
                      className="truncate text-[0.68rem] font-medium"
                      style={{ color: "var(--ws-text)" }}
                      title={item.name}
                    >
                      {item.name}
                    </p>
                    {item.count != null && (
                      <p className="text-[0.55rem] tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                        {item.count} {item.count === 1 ? "item" : "items"}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
