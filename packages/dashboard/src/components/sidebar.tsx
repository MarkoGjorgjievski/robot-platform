"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Building2, Bot, Globe } from "lucide-react";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/orgs", icon: Building2, label: "Organizations" },
  { href: "/legacy/extractors", icon: Bot, label: "Extractors (legacy)" },
  { href: "/legacy/domains", icon: Globe, label: "Domains (legacy)" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-50 flex w-12 flex-col items-center py-3 gap-1"
      style={{
        background: "var(--ws-panel-header)",
        borderRight: "1px solid var(--ws-border)",
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        className="mb-3 flex items-center justify-center rounded"
        style={{ width: 32, height: 32 }}
        title="Robot Platform"
      >
        <Bot className="size-5" style={{ color: "var(--ws-accent)" }} />
      </Link>

      <div className="w-5 mb-1" style={{ borderTop: "1px solid var(--ws-border)" }} />

      {/* Nav items */}
      {navItems.map(({ href, icon: Icon, label }) => {
        const isActive =
          href === "/" ? pathname === "/" : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            title={label}
            className="relative flex items-center justify-center rounded transition-colors"
            style={{
              width: 32,
              height: 32,
              color: isActive ? "var(--ws-text)" : "var(--ws-text-dim)",
              background: isActive ? "var(--ws-surface-hover)" : "transparent",
            }}
          >
            <Icon className="size-[16px]" />
            {isActive && (
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r"
                style={{ background: "var(--ws-accent)" }}
              />
            )}
          </Link>
        );
      })}
    </aside>
  );
}
