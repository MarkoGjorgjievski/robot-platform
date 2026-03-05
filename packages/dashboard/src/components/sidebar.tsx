"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Building2, Bot, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/orgs", label: "Organizations", icon: Building2 },
  { href: "/extractors", label: "Extractors", icon: Bot },
  { href: "/domains", label: "Domains", icon: Globe },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-gray-900 text-gray-100 flex flex-col">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-800">
        <Bot className="h-6 w-6 text-blue-400" />
        <span className="text-lg font-semibold tracking-tight">
          Robot Platform
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
