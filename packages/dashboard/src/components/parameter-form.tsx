"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { FieldRenderer } from "@/components/fields";
import type { FieldDefinition } from "@robot/config";

interface ParameterFormProps {
  domainDefaults: Record<string, unknown>;
  extractorOverrides: Record<string, unknown>;
  definitions: FieldDefinition[];
  groups: Record<string, string[]>;
}

export function ParameterForm({
  domainDefaults,
  extractorOverrides,
  definitions,
  groups,
}: ParameterFormProps) {
  const [overrides, setOverrides] = useState<Record<string, unknown>>(
    extractorOverrides,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (name: string, value: unknown) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === undefined) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  // Build a set of parameter names that appear in groups
  const groupedNames = new Set(Object.values(groups).flat());

  // Find ungrouped visible parameters
  const ungrouped = definitions.filter(
    (d) => !d.ignore && !groupedNames.has(d.name),
  );

  const renderField = (def: FieldDefinition) => {
    if (def.ignore) return null;
    if (def.hide && !showAdvanced) return null;
    if (def.advanced && !showAdvanced) return null;

    return (
      <FieldRenderer
        key={def.name}
        definition={def}
        value={overrides[def.name]}
        defaultValue={domainDefaults[def.name] ?? def.default}
        onChange={(v) => handleChange(def.name, v)}
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Hidden input for form submission */}
      <input
        type="hidden"
        name="parameters"
        value={JSON.stringify(overrides)}
      />

      {/* Group sections */}
      {Object.entries(groups).map(([groupName, paramNames]) => {
        const groupDefs = paramNames
          .map((n) => definitions.find((d) => d.name === n))
          .filter((d): d is FieldDefinition => d != null);

        // Skip if all fields in group are hidden
        const visibleDefs = groupDefs.filter(
          (d) => !d.ignore && (showAdvanced || (!d.advanced && !d.hide)),
        );
        if (visibleDefs.length === 0) return null;

        return (
          <GroupSection key={groupName} title={groupName}>
            {groupDefs.map(renderField)}
          </GroupSection>
        );
      })}

      {/* Ungrouped fields */}
      {ungrouped.length > 0 && (
        <GroupSection title="Other">
          {ungrouped.map(renderField)}
        </GroupSection>
      )}

      {/* Advanced toggle */}
      <div className="pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "Hide advanced fields" : "Show advanced fields"}
        </Button>
      </div>
    </div>
  );
}

function GroupSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b pb-2 text-sm font-semibold"
        >
          <ChevronDownIcon
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          {title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
