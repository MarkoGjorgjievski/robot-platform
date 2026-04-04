"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Sparkles, Building2, Globe, Settings } from "lucide-react"

const navItems = [
  { href: "/", icon: Sparkles, label: "Scraper" },
  { href: "/customers", icon: Building2, label: "Customers" },
  { href: "/domains", icon: Globe, label: "Domains" },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-14 flex-col items-center border-r border-border bg-sidebar py-4 gap-1">
      {/* Logo */}
      <Link
        href="/"
        className="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        title="Robot Platform"
      >
        <Sparkles className="size-4" />
      </Link>

      <div className="mx-auto mb-2 w-6 border-t border-border" />

      {navItems.map(({ href, icon: Icon, label }) => {
        const isActive =
          href === "/" ? pathname === "/" : pathname.startsWith(href)

        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={`relative flex size-9 items-center justify-center rounded-lg transition-colors ${
              isActive
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            }`}
          >
            <Icon className="size-[18px]" />
            {isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
            )}
          </Link>
        )
      })}

      <div className="mt-auto">
        <Link
          href="/settings"
          title="Settings"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Settings className="size-[18px]" />
        </Link>
      </div>
    </aside>
  )
}
