"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClockIcon, AlertTriangleIcon } from "lucide-react";
import { SourceForm } from "@/components/source-form";
import { CollectionProvider } from "./collection-context";

interface SourceItem {
  id: string;
  name: string;
  slug: string;
  href: string;
  country: string;
  locale: string | null;
  currency: string | null;
  runnerFramework: string | null;
  dataCenter: string | null;
  proxyType: string | null;
  loginPool: string | null;
  maximumInputs: number | null;
  isActive: boolean;
  updatedAt: Date;
  domainId: string | null;
  robotTemplate: string;
  variant: string;
  schemaValues: Record<string, string>;
}

interface CollectionShellProps {
  sources: SourceItem[];
  collectionId: string;
  basePath: string;
  hasSchema: boolean;
  collectionSchema: Array<{ name: string; type: string; required: boolean; description?: string }>;
  domains: Array<{ id: string; name: string }>;
  onCreateSource: (data: {
    collectionId: string;
    name: string;
    slug: string;
    country: string;
    locale?: string | null;
    currency?: string | null;
    runnerFramework?: string | null;
    domainId?: string | null;
    variant?: string;
    robotTemplate?: string;
    schemaValues?: Record<string, string>;
    dataCenter?: string | null;
    proxyType?: string | null;
    loginPool?: string | null;
    maximumInputs?: number | null;
  }) => Promise<{ slug: string }>;
  onCreateDomain: (name: string) => Promise<{ id: string; name: string }>;
  header: React.ReactNode;
  children: React.ReactNode;
}

const TABS = [
  { key: "sources", label: "Sources" },
  { key: "schema", label: "Schema" },
] as const;

export function CollectionShell({
  sources,
  collectionId,
  basePath,
  hasSchema,
  collectionSchema,
  domains,
  onCreateSource,
  onCreateDomain,
  header,
  children,
}: CollectionShellProps) {
  const pathname = usePathname();
  const [panel, setPanel] = useState<
    { mode: "create" } | { mode: "view"; slug: string } | null
  >(null);

  const selectedSource =
    panel?.mode === "view"
      ? sources.find((s) => s.slug === panel.slug) ?? null
      : null;

  // Recent: sorted by updatedAt desc, take 10
  const recent = [...sources]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 10);

  const contextValue = useMemo(
    () => ({
      selectedSlug: panel?.mode === "view" ? panel.slug : null,
      selectSource: (slug: string) => setPanel({ mode: "view", slug }),
      createSource: () => setPanel({ mode: "create" }),
    }),
    [panel]
  );

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 3rem)" }}>
      {/* Left: Recent */}
      <div
        className="w-56 shrink-0 overflow-y-auto rounded-lg"
        style={{
          background: "var(--ws-surface)",
          border: "1px solid var(--ws-border)",
        }}
      >
        <div
          className="px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
        >
          <div className="flex items-center gap-1.5">
            <ClockIcon
              className="size-3"
              style={{ color: "var(--ws-text-dim)" }}
            />
            <span
              className="text-[0.6rem] font-bold uppercase tracking-widest"
              style={{ color: "var(--ws-text-muted)" }}
            >
              Recent
            </span>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <span
              className="text-[0.6rem]"
              style={{ color: "var(--ws-text-dim)" }}
            >
              No recent sources
            </span>
          </div>
        ) : (
          <div className="py-1">
            {recent.map((s) => (
              <Link
                key={s.slug}
                href={s.href}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--ws-surface-hover)]"
              >
                <div
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background: s.isActive
                      ? "var(--ws-success)"
                      : "var(--ws-text-dim)",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[0.65rem] font-medium"
                    style={{ color: "var(--ws-text)" }}
                  >
                    {s.name}
                  </p>
                  <p
                    className="text-[0.5rem]"
                    style={{ color: "var(--ws-text-dim)" }}
                  >
                    {s.country}
                    {s.runnerFramework ? ` · ${s.runnerFramework}` : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Middle: Content area */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl">
          {header}

          {/* Tabs with +New Source */}
          <div
            className="mb-5 flex items-center"
            style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
          >
            <div className="flex items-center gap-0">
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

          </div>

          <CollectionProvider value={contextValue}>
            {children}
          </CollectionProvider>
        </div>
      </div>

      {/* Right: Create / View panel */}
      <div
        className="w-80 shrink-0 rounded-lg overflow-hidden"
        style={{
          background: panel ? "var(--ws-surface)" : "transparent",
          border: panel
            ? "1px solid var(--ws-border)"
            : "1px solid transparent",
        }}
      >
        {panel?.mode === "create" ? (
          <SourceForm
            mode="create"
            existingSlugs={sources.map((s) => s.slug)}
            collectionId={collectionId}
            collectionSchema={collectionSchema}
            domains={domains}
            onSubmit={onCreateSource}
            onCreateDomain={onCreateDomain}
            onClose={() => setPanel(null)}
          />
        ) : panel?.mode === "view" && selectedSource ? (
          <SourceForm
            key={selectedSource.slug}
            mode="view"
            source={selectedSource}
            existingSlugs={sources
              .filter((s) => s.slug !== selectedSource.slug)
              .map((s) => s.slug)}
            collectionId={collectionId}
            collectionSchema={collectionSchema}
            domains={domains}
            onSubmit={onCreateSource}
            onCreateDomain={onCreateDomain}
            onClose={() => setPanel(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
