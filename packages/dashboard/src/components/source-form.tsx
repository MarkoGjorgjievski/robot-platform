"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SearchSelect } from "./search-select";
import { DomainPicker } from "./domain-picker";
import { PencilIcon, XIcon, SaveIcon, PlusIcon } from "lucide-react";
import { COUNTRIES, LANGUAGES, CURRENCIES, DATA_CENTERS, PROXY_TYPES, LOGIN_POOLS, RUNNER_FRAMEWORK_OPTIONS } from "@/lib/constants";

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

interface Domain {
  id: string;
  name: string;
}

interface SourceData {
  id: string;
  name: string;
  slug: string;
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

interface SourceFormProps {
  mode: "create" | "view";
  source?: SourceData;
  existingSlugs: string[];
  collectionId: string;
  onSubmit: (data: {
    collectionId: string;
    name: string;
    slug: string;
    country: string;
    locale?: string | null;
    currency?: string | null;
    runnerFramework?: string | null;
    dataCenter?: string | null;
    proxyType?: string | null;
    loginPool?: string | null;
    maximumInputs?: number | null;
    domainId?: string | null;
    variant?: string;
    robotTemplate?: string;
    schemaValues?: Record<string, string>;
  }) => Promise<{ slug: string }>;
  onClose: () => void;
  collectionSchema: SchemaField[];
  domains: Domain[];
  onCreateDomain: (name: string) => Promise<Domain>;
}

function toChain(name: string, country: string): string {
  const snake = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${snake}_${country.toLowerCase()}`;
}

const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));
const localeOptions = LANGUAGES.map((l) => ({ value: l.code, label: `${l.code} — ${l.name}` }));
const currencyOptions = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));
const runnerFrameworkOptions = RUNNER_FRAMEWORK_OPTIONS.map((rf) => ({ value: rf, label: rf }));
const dataCenterOptions = DATA_CENTERS.map((dc) => ({ value: dc, label: dc }));
const proxyTypeOptions = PROXY_TYPES.map((pt) => ({ value: pt, label: pt }));
const loginPoolOptions = LOGIN_POOLS.map((lp) => ({ value: lp, label: lp }));

export function SourceForm({
  mode: initialMode,
  source,
  existingSlugs,
  collectionId,
  onSubmit,
  onClose,
  collectionSchema,
  domains,
  onCreateDomain,
}: SourceFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(initialMode === "create");

  // Platform config
  const [name, setName] = useState(source?.name ?? "");
  const [country, setCountry] = useState(source?.country ?? "");
  const [locale, setLocale] = useState(source?.locale ?? "");
  const [currency, setCurrency] = useState(source?.currency ?? "");
  const [runnerFramework, setRunnerFramework] = useState(source?.runnerFramework ?? "");
  const [dataCenter, setDataCenter] = useState(source?.dataCenter ?? "");
  const [proxyType, setProxyType] = useState(source?.proxyType ?? "");
  const [loginPool, setLoginPool] = useState(source?.loginPool ?? "");
  const [maximumInputs, setMaximumInputs] = useState(source?.maximumInputs?.toString() ?? "");

  // Extractor config
  const [domainId, setDomainId] = useState(source?.domainId ?? "");
  const [robotTemplate, setRobotTemplate] = useState(source?.robotTemplate ?? "robots/san-antonio");
  const [variant, setVariant] = useState(source?.variant ?? "default");

  // Schema values — init from source or empty values for collection fields
  const [schemaValues, setSchemaValues] = useState<Record<string, string>>(() => {
    if (source?.schemaValues && Object.keys(source.schemaValues).length > 0) return source.schemaValues;
    const initial: Record<string, string> = {};
    for (const field of collectionSchema) {
      initial[field.name] = "";
    }
    return initial;
  });

  // Source-specific extra fields (not in collection schema)
  const [extraFields, setExtraFields] = useState<{ name: string; value: string }[]>(() => {
    if (!source?.schemaValues) return [];
    const collectionFieldNames = new Set(collectionSchema.map((f) => f.name));
    return Object.entries(source.schemaValues)
      .filter(([key]) => !collectionFieldNames.has(key))
      .map(([name, value]) => ({ name, value }));
  });

  // Domain picker
  const [availableDomains, setAvailableDomains] = useState<Domain[]>(domains);
  const [creatingDomain, setCreatingDomain] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const chain = useMemo(() => (name && country ? toChain(name, country) : ""), [name, country]);
  const slug = chain;
  const isView = initialMode === "view" && !editing;

  const validate = (): string => {
    if (name.trim().length < 2) return "Name must be at least 2 characters.";
    if (!country) return "Country is required.";
    if (slug && existingSlugs.includes(slug) && initialMode === "create") return "Source with this slug already exists.";
    return "";
  };

  const handleCreateDomain = async (domainName: string) => {
    setCreatingDomain(true);
    try {
      const newDomain = await onCreateDomain(domainName);
      setAvailableDomains((prev) => [...prev, newDomain].sort((a, b) => a.name.localeCompare(b.name)));
      setDomainId(newDomain.id);
    } catch {
      setError("Failed to create domain.");
    } finally {
      setCreatingDomain(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError("");
    try {
      // Merge collection schema values with extra fields
      const allSchemaValues: Record<string, string> = { ...schemaValues };
      for (const ef of extraFields) {
        if (ef.name.trim()) {
          allSchemaValues[ef.name.trim()] = ef.value;
        }
      }

      await onSubmit({
        collectionId,
        name: name.trim(),
        slug,
        country,
        locale: locale || null,
        currency: currency || null,
        runnerFramework: runnerFramework || null,
        dataCenter: dataCenter || null,
        proxyType: proxyType || null,
        loginPool: loginPool || null,
        maximumInputs: maximumInputs ? parseInt(maximumInputs, 10) : null,
        domainId: domainId || null,
        variant,
        robotTemplate,
        schemaValues: allSchemaValues,
      });
      router.refresh();
      if (initialMode === "create") onClose();
    } catch {
      setError("Failed to save source.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: "var(--ws-bg)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-muted)" }}>
          {initialMode === "create" ? "New Source" : source?.name}
        </h2>
        <div className="flex items-center gap-1">
          {initialMode === "view" && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
              title="Edit"
            >
              <PencilIcon className="size-3" style={{ color: "var(--ws-text-muted)" }} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
            title="Close"
          >
            <XIcon className="size-3" style={{ color: "var(--ws-text-muted)" }} />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-5">
        {/* Section: Schema */}
        {collectionSchema.length > 0 && (
          <fieldset>
            <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
              Schema
            </legend>
            <div className="space-y-2">
              {collectionSchema.map((field) => (
                <div key={field.name} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[0.6rem] font-mono truncate" style={{ color: "var(--ws-text-muted)" }} title={field.name}>
                    {field.name}
                  </span>
                  {isView ? (
                    <ReadOnly value={schemaValues[field.name] || "—"} />
                  ) : (
                    <input
                      type="text"
                      value={schemaValues[field.name] || ""}
                      onChange={(e) => setSchemaValues({ ...schemaValues, [field.name]: e.target.value })}
                      placeholder={`selector for ${field.name}`}
                      className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono outline-none"
                      style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
                    />
                  )}
                  <span className="shrink-0 text-[0.55rem] font-mono" style={{ color: "var(--ws-text-dim)" }}>
                    {field.type}
                  </span>
                </div>
              ))}

              {/* Source-specific extra fields */}
              {extraFields.map((ef, i) => (
                <div key={i} className="flex items-center gap-2">
                  {isView ? (
                    <span className="w-28 shrink-0 text-[0.6rem] font-mono truncate" style={{ color: "var(--ws-accent)" }} title={ef.name}>
                      {ef.name}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={ef.name}
                      onChange={(e) => {
                        const next = [...extraFields];
                        next[i] = { ...next[i], name: e.target.value };
                        setExtraFields(next);
                      }}
                      placeholder="field_name"
                      className="w-28 shrink-0 rounded px-2 py-1.5 text-[0.6rem] font-mono outline-none"
                      style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-accent-muted)", color: "var(--ws-accent)" }}
                    />
                  )}
                  {isView ? (
                    <ReadOnly value={ef.value || "—"} />
                  ) : (
                    <input
                      type="text"
                      value={ef.value}
                      onChange={(e) => {
                        const next = [...extraFields];
                        next[i] = { ...next[i], value: e.target.value };
                        setExtraFields(next);
                      }}
                      placeholder="selector"
                      className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono outline-none"
                      style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
                    />
                  )}
                  {!isView && (
                    <button
                      type="button"
                      onClick={() => setExtraFields(extraFields.filter((_, j) => j !== i))}
                      className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
                    >
                      <XIcon className="size-2.5" style={{ color: "var(--ws-text-dim)" }} />
                    </button>
                  )}
                </div>
              ))}

              {!isView && (
                <button
                  type="button"
                  onClick={() => setExtraFields([...extraFields, { name: "", value: "" }])}
                  className="flex items-center gap-1 text-[0.6rem] font-medium transition-colors hover:underline"
                  style={{ color: "var(--ws-accent)" }}
                >
                  <PlusIcon className="size-2.5" />
                  Add source-specific field
                </button>
              )}
            </div>
          </fieldset>
        )}

        {/* Section: Extractor Config */}
        <fieldset>
          <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
            Extractor Config
          </legend>
          <div className="space-y-3">
            <Field label="Robot Template">
              {isView ? (
                <ReadOnly value={robotTemplate} />
              ) : (
                <input
                  type="text"
                  value={robotTemplate}
                  onChange={(e) => setRobotTemplate(e.target.value)}
                  placeholder="robots/san-antonio"
                  className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                  style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
                />
              )}
            </Field>

            <Field label="Country">
              {isView ? (
                <ReadOnly value={country} />
              ) : (
                <SearchSelect options={countryOptions} value={country} onChange={setCountry} placeholder="Select country..." />
              )}
            </Field>

            <Field label="Domain">
              {isView ? (
                <ReadOnly value={availableDomains.find((d) => d.id === domainId)?.name || "—"} />
              ) : (
                <DomainPicker
                  domains={availableDomains}
                  value={domainId}
                  onChange={setDomainId}
                  onCreateNew={handleCreateDomain}
                  creating={creatingDomain}
                />
              )}
            </Field>

            <Field label="Schema Variant">
              {isView ? (
                <ReadOnly value={variant} />
              ) : (
                <input
                  type="text"
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  placeholder="e.g. singlePage, multiPages, screenshots"
                  className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                  style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
                />
              )}
            </Field>
          </div>
        </fieldset>

        {/* Section: Platform Config */}
        <fieldset>
          <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
            Platform Config
          </legend>
          <div className="space-y-3">
            <Field label="Name">
              {isView ? (
                <ReadOnly value={name} />
              ) : (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Best Buy"
                  className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                  style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
                />
              )}
            </Field>

            <Field label="Runner Framework">
              {isView ? (
                <ReadOnly value={runnerFramework || "—"} />
              ) : (
                <SearchSelect options={runnerFrameworkOptions} value={runnerFramework} onChange={setRunnerFramework} placeholder="Select runner framework..." />
              )}
            </Field>

            <Field label="Locale">
              {isView ? (
                <ReadOnly value={locale || "—"} />
              ) : (
                <SearchSelect options={localeOptions} value={locale} onChange={setLocale} placeholder="Select locale..." />
              )}
            </Field>

            <Field label="Currency">
              {isView ? (
                <ReadOnly value={currency || "—"} />
              ) : (
                <SearchSelect options={currencyOptions} value={currency} onChange={setCurrency} placeholder="Select currency..." />
              )}
            </Field>

            <Field label="Data Center">
              {isView ? (
                <ReadOnly value={dataCenter || "—"} />
              ) : (
                <SearchSelect options={dataCenterOptions} value={dataCenter} onChange={setDataCenter} placeholder="Select data center..." />
              )}
            </Field>

            <Field label="Proxy Type">
              {isView ? (
                <ReadOnly value={proxyType || "—"} />
              ) : (
                <SearchSelect options={proxyTypeOptions} value={proxyType} onChange={setProxyType} placeholder="Select proxy type..." />
              )}
            </Field>

            <Field label="Login Pool">
              {isView ? (
                <ReadOnly value={loginPool || "—"} />
              ) : (
                <SearchSelect options={loginPoolOptions} value={loginPool} onChange={setLoginPool} placeholder="Select login pool..." />
              )}
            </Field>

            <Field label="Maximum Inputs">
              {isView ? (
                <ReadOnly value={maximumInputs || "—"} />
              ) : (
                <input
                  type="number"
                  value={maximumInputs}
                  onChange={(e) => setMaximumInputs(e.target.value)}
                  placeholder="e.g. 100"
                  min={1}
                  className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                  style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
                />
              )}
            </Field>

            <Field label="Chain">
              <ReadOnly value={chain || "—"} />
            </Field>

            <Field label="Slug">
              <ReadOnly value={slug || "—"} />
            </Field>
          </div>
        </fieldset>

        {/* Error */}
        {error && (
          <p className="text-xs" style={{ color: "var(--ws-danger)" }}>{error}</p>
        )}

        {/* Actions */}
        {editing && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
              style={{ background: "var(--ws-accent)", color: "#fff" }}
            >
              <SaveIcon className="size-3" />
              {submitting ? "Saving..." : initialMode === "create" ? "Create" : "Save"}
            </button>
            {initialMode === "view" && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded px-3 py-1.5 text-xs transition-colors"
                style={{ color: "var(--ws-text-muted)" }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[0.6rem] font-medium uppercase tracking-wider" style={{ color: "var(--ws-text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnly({ value }: { value: string }) {
  return (
    <div
      className="rounded px-2.5 py-1.5 text-xs"
      style={{
        background: "var(--ws-surface)",
        border: "1px solid var(--ws-border-subtle)",
        color: "var(--ws-text-dim)",
      }}
    >
      {value}
    </div>
  );
}
