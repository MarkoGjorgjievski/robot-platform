"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";

interface CollectionTabsProps {
  basePath: string;
  hasSchema: boolean;
}

const TABS = [
  { key: "sources", label: "Sources" },
  { key: "schema", label: "Schema" },
] as const;

export function CollectionTabs({ basePath, hasSchema }: CollectionTabsProps) {
  const pathname = usePathname();

  return (
    <div className="mb-5 flex items-center gap-0" style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}>
      {TABS.map((tab) => {
        const href = `${basePath}/${tab.key}`;
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={tab.key}
            href={href}
            className="relative flex items-center gap-1.5 px-4 pb-2.5 pt-1 text-xs font-medium transition-colors"
            style={{
              color: isActive ? "var(--ws-accent)" : "var(--ws-text-muted)",
              borderBottom: isActive ? "2px solid var(--ws-accent)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
            {tab.key === "schema" && !hasSchema && (
              <AlertTriangleIcon className="size-2.5" style={{ color: "var(--ws-warning)" }} />
            )}
          </Link>
        );
      })}
    </div>
  );
}
