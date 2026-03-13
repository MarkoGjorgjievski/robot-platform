import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-5 flex items-center gap-1 text-[0.65rem]">
      {items.map((crumb, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRightIcon className="size-2.5" style={{ color: "var(--ws-text-dim)" }} />
            )}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="transition-colors hover:underline"
                style={{ color: "var(--ws-text-muted)" }}
              >
                {crumb.label}
              </Link>
            ) : (
              <span style={{ color: isLast ? "var(--ws-text)" : "var(--ws-text-muted)" }}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
