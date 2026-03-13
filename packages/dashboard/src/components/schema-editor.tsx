"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { updateSchema } from "@/app/legacy/extractors/actions";

interface SchemaField {
  name: string;
  xpath?: string;
  css?: string;
  jq?: string;
  regExp?: string;
  regExpReplace?: string;
  defaultValue?: unknown;
  downloadContent?: string;
  singleValue?: boolean;
  type?: string;
  description?: string;
  manualSelector?: string;
}

interface SchemaEditorProps {
  schemaName: string;
  schema: Record<string, unknown>;
  overrideId: string;
}

interface SchemaData {
  singleRecord?: boolean;
  regionsSelector?: string | null;
  recordSelector?: string | null;
  recordXPath?: string | null;
  fields?: SchemaField[];
}

function validateXpath(xpath: string): boolean {
  if (!xpath || xpath.trim() === "") return true;
  let brackets = 0;
  let parens = 0;
  for (const ch of xpath) {
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
    if (ch === "(") parens++;
    if (ch === ")") parens--;
    if (brackets < 0 || parens < 0) return false;
  }
  return brackets === 0 && parens === 0;
}

export function SchemaEditor({ schemaName, schema, overrideId }: SchemaEditorProps) {
  const initial = schema as SchemaData;
  const [singleRecord, setSingleRecord] = useState(initial.singleRecord ?? false);
  const [regionsSelector, setRegionsSelector] = useState(initial.regionsSelector ?? "");
  const [recordSelector, setRecordSelector] = useState(initial.recordSelector ?? "");
  const [recordXPath, setRecordXPath] = useState(initial.recordXPath ?? "");
  const [fields, setFields] = useState<SchemaField[]>(initial.fields ?? []);
  const [saving, setSaving] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Record<number, boolean>>({});

  const toggleExpanded = (idx: number) => {
    setExpandedFields((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const updateField = (idx: number, updates: Partial<SchemaField>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const addField = () => {
    setFields((prev) => [...prev, { name: "" }]);
  };

  const handleSave = async () => {
    setSaving(true);
    const formData = new FormData();
    formData.set("overrideId", overrideId);
    formData.set("schemaName", schemaName);
    formData.set(
      "schema",
      JSON.stringify({
        singleRecord,
        regionsSelector: regionsSelector || null,
        recordSelector: recordSelector || null,
        recordXPath: recordXPath || null,
        fields,
      })
    );
    await updateSchema(formData);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Top-level schema properties */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <Checkbox
            id="singleRecord"
            checked={singleRecord}
            onCheckedChange={(c) => setSingleRecord(c === true)}
          />
          <Label htmlFor="singleRecord">Single Record</Label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="regionsSelector">Regions Selector</Label>
          <Input
            id="regionsSelector"
            value={regionsSelector}
            onChange={(e) => setRegionsSelector(e.target.value)}
            placeholder="CSS selector"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recordSelector">Record Selector</Label>
          <Input
            id="recordSelector"
            value={recordSelector}
            onChange={(e) => setRecordSelector(e.target.value)}
            placeholder="CSS selector"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recordXPath">Record XPath</Label>
          <Input
            id="recordXPath"
            value={recordXPath}
            onChange={(e) => setRecordXPath(e.target.value)}
            placeholder="//div[...]"
            className={`font-mono text-xs ${recordXPath && !validateXpath(recordXPath) ? "border-destructive" : ""}`}
          />
        </div>
      </div>

      {/* Fields list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Fields</h3>
          <Badge variant="outline">{fields.length}</Badge>
        </div>

        <div className="space-y-2">
          {fields.map((field, idx) => (
            <Collapsible
              key={idx}
              open={expandedFields[idx] ?? false}
              onOpenChange={() => toggleExpanded(idx)}
            >
              <div className="rounded-md border">
                <div className="flex items-center gap-2 px-3 py-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon-xs" type="button">
                      <ChevronDownIcon
                        className={`transition-transform ${expandedFields[idx] ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <Input
                    value={field.name}
                    onChange={(e) => updateField(idx, { name: e.target.value })}
                    placeholder="Field name"
                    className="h-7 w-40 text-sm font-medium"
                  />
                  <Textarea
                    value={field.xpath ?? ""}
                    onChange={(e) => updateField(idx, { xpath: e.target.value })}
                    placeholder="XPath expression"
                    className={`flex-1 font-mono text-xs min-h-7 h-7 resize-none ${
                      field.xpath && !validateXpath(field.xpath) ? "border-destructive" : ""
                    }`}
                  />
                  {field.type && (
                    <Badge variant="secondary" className="text-[10px]">
                      {field.type}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    onClick={() => removeField(idx)}
                  >
                    <Trash2Icon className="text-muted-foreground" />
                  </Button>
                </div>

                <CollapsibleContent>
                  <div className="border-t px-3 py-3 space-y-3 bg-gray-50/50">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">CSS Selector</Label>
                        <Input
                          value={field.css ?? ""}
                          onChange={(e) => updateField(idx, { css: e.target.value || undefined })}
                          className="font-mono text-xs h-8"
                          placeholder="CSS selector"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">jq Filter</Label>
                        <Input
                          value={field.jq ?? ""}
                          onChange={(e) => updateField(idx, { jq: e.target.value || undefined })}
                          className="font-mono text-xs h-8"
                          placeholder=".prop.nested"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">RegExp</Label>
                        <Input
                          value={field.regExp ?? ""}
                          onChange={(e) => updateField(idx, { regExp: e.target.value || undefined })}
                          className="font-mono text-xs h-8"
                          placeholder="\\d+"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">RegExp Replace</Label>
                        <Input
                          value={field.regExpReplace ?? ""}
                          onChange={(e) =>
                            updateField(idx, { regExpReplace: e.target.value || undefined })
                          }
                          className="font-mono text-xs h-8"
                          placeholder="$1"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Default Value</Label>
                        <Input
                          value={field.defaultValue != null ? String(field.defaultValue) : ""}
                          onChange={(e) =>
                            updateField(idx, { defaultValue: e.target.value || undefined })
                          }
                          className="text-xs h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={field.type ?? ""}
                          onValueChange={(v) => updateField(idx, { type: v || undefined })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TEXT">TEXT</SelectItem>
                            <SelectItem value="NUMBER">NUMBER</SelectItem>
                            <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                            <SelectItem value="STRING">STRING</SelectItem>
                            <SelectItem value="DATETIME">DATETIME</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Manual Selector</Label>
                        <Input
                          value={field.manualSelector ?? ""}
                          onChange={(e) =>
                            updateField(idx, { manualSelector: e.target.value || undefined })
                          }
                          className="font-mono text-xs h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Download Content</Label>
                        <Input
                          value={field.downloadContent ?? ""}
                          onChange={(e) =>
                            updateField(idx, { downloadContent: e.target.value || undefined })
                          }
                          className="text-xs h-8"
                          placeholder="text"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`singleValue-${idx}`}
                          checked={field.singleValue ?? false}
                          onCheckedChange={(c) =>
                            updateField(idx, { singleValue: c === true ? true : undefined })
                          }
                        />
                        <Label htmlFor={`singleValue-${idx}`} className="text-xs">
                          Single Value
                        </Label>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description</Label>
                      <Input
                        value={field.description ?? ""}
                        onChange={(e) =>
                          updateField(idx, { description: e.target.value || undefined })
                        }
                        className="text-xs h-8"
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addField}>
          <PlusIcon /> Add Field
        </Button>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-4 border-t">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Schema"}
        </Button>
      </div>
    </div>
  );
}
