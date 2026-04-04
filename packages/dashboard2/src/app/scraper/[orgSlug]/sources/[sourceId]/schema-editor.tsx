'use client';

import { useState } from 'react';
import { Pencil, Check, X, Plus, Save, Loader2, User, Bot, AlertCircle, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { FieldCorrector } from './field-corrector';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  xpath?: string;
  apiPath?: string;
  source?: string; // 'ai' | 'human' | 'cached'
};

export function SchemaEditor({
  sourceId,
  domain,
  pageType,
  url,
  initialFields,
  selectorsJson,
  extractedData,
}: {
  sourceId: string;
  domain: string;
  pageType: string;
  url: string;
  initialFields: SchemaField[];
  selectorsJson: unknown;
  extractedData?: Record<string, unknown>;
}) {
  const [fields, setFields] = useState<SchemaField[]>(() => {
    // Merge schema fields with selector data
    const selectors = selectorsJson as { fields?: Array<{ name: string; xpath: string; attribute: string }> } | null;
    return initialFields.map(f => {
      const selector = selectors?.fields?.find(s => s.name === f.name);
      return {
        ...f,
        xpath: selector?.xpath ?? f.xpath ?? '',
        source: f.source ?? 'ai',
      };
    });
  });

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editXpath, setEditXpath] = useState('');
  const [editApiPath, setEditApiPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field corrector (click-to-select)
  const [correctingField, setCorrectingField] = useState<string | null>(null);

  // Adding new field
  const [addingField, setAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('string');
  const [newFieldXpath, setNewFieldXpath] = useState('');

  function startEditing(field: SchemaField) {
    setEditingField(field.name);
    setEditXpath(field.xpath ?? '');
    setEditApiPath(field.apiPath ?? '');
  }

  function saveFieldEdit(fieldName: string) {
    setFields(prev => prev.map(f =>
      f.name === fieldName
        ? { ...f, xpath: editXpath, apiPath: editApiPath, source: 'human' }
        : f
    ));
    setEditingField(null);
  }

  function addField() {
    if (!newFieldName.trim()) return;
    setFields(prev => [
      ...prev,
      {
        name: newFieldName.trim().toLowerCase().replace(/\s+/g, '_'),
        type: newFieldType,
        description: 'Manually added field',
        xpath: newFieldXpath,
        source: 'human',
        required: false,
      },
    ]);
    setNewFieldName('');
    setNewFieldType('string');
    setNewFieldXpath('');
    setAddingField(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/scraper/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          domain,
          pageType,
          fields: fields.map(f => ({
            name: f.name,
            type: f.type,
            description: f.description,
            required: f.required,
            xpath: f.xpath,
            apiPath: f.apiPath,
            source: f.source,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Save failed');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const hasHumanEdits = fields.some(f => f.source === 'human');

  return (
    <div>
      {/* Save bar */}
      {hasHumanEdits && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
          <div className="flex items-center gap-2">
            <User className="size-3.5 text-amber-600" />
            <span className="text-xs font-medium text-amber-800">
              You have unsaved manual edits
            </span>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : saved ? <Check className="size-3" /> : <Save className="size-3" />}
            {saved ? 'Saved!' : 'Save Overrides'}
          </Button>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <AlertCircle className="size-3.5" />
          {error}
        </div>
      )}

      {/* Fields list */}
      <Card className="divide-y">
        {fields.map(field => (
          <div key={field.name} className="px-4 py-3">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span data-slot="mono" className="text-sm font-medium">{field.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
                  {field.required && (
                    <Badge className="bg-amber-100 text-amber-700 text-[10px]">required</Badge>
                  )}
                  {field.source === 'human' ? (
                    <Badge className="bg-blue-100 text-blue-700 text-[10px] gap-0.5">
                      <User className="size-2.5" /> manual
                    </Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground text-[10px] gap-0.5">
                      <Bot className="size-2.5" /> ai
                    </Badge>
                  )}
                </div>
                {field.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
                )}

                {/* Show current paths */}
                {editingField !== field.name && (field.xpath || field.apiPath) && (
                  <div className="mt-1.5 space-y-0.5">
                    {field.xpath && (
                      <p data-slot="mono" className="truncate rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        xpath: {field.xpath}
                      </p>
                    )}
                    {field.apiPath && (
                      <p data-slot="mono" className="truncate rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        api: {field.apiPath}
                      </p>
                    )}
                  </div>
                )}

                {/* Editing mode */}
                {editingField === field.name && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <Label className="text-[10px]">XPath Selector</Label>
                      <Input
                        value={editXpath}
                        onChange={(e) => setEditXpath(e.target.value)}
                        placeholder="//span[@class='price']"
                        className="mt-0.5 h-8 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">API JSON Path</Label>
                      <Input
                        value={editApiPath}
                        onChange={(e) => setEditApiPath(e.target.value)}
                        placeholder="data.product.price.current"
                        className="mt-0.5 h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => saveFieldEdit(field.name)}>
                        <Check className="size-3" /> Apply
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditingField(null)}>
                        <X className="size-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {editingField !== field.name && (
                <div className="flex gap-1">
                  {url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      title="Fix with visual picker"
                      onClick={() => setCorrectingField(field.name)}
                    >
                      <Crosshair className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-8 p-0"
                    title="Edit path manually"
                    onClick={() => startEditing(field)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Add field */}
        {addingField ? (
          <div className="px-4 py-3 space-y-2 bg-muted/30">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px]">Field Name</Label>
                <Input
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="field_name"
                  className="mt-0.5 h-8 text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-[10px]">Type</Label>
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                  className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="price">price</option>
                  <option value="url">url</option>
                  <option value="image_url">image_url</option>
                  <option value="boolean">boolean</option>
                  <option value="array">array</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px]">XPath (optional)</Label>
                <Input
                  value={newFieldXpath}
                  onChange={(e) => setNewFieldXpath(e.target.value)}
                  placeholder="//div[@class='...']"
                  className="mt-0.5 h-8 text-xs font-mono"
                />
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addField}>
                <Check className="size-3" /> Add Field
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setAddingField(false)}>
                <X className="size-3" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingField(true)}
            className="flex w-full items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            <Plus className="size-3.5" />
            Add custom field
          </button>
        )}
      </Card>

      {/* Field Corrector Modal */}
      {correctingField && (
        <FieldCorrector
          fieldName={correctingField}
          fieldType={fields.find(f => f.name === correctingField)?.type ?? 'string'}
          currentValue={extractedData?.[correctingField] != null ? String(extractedData[correctingField]) : null}
          url={url}
          onCancel={() => setCorrectingField(null)}
          onSave={(result) => {
            setFields(prev => prev.map(f =>
              f.name === correctingField
                ? { ...f, xpath: result.xpath ?? f.xpath, apiPath: result.apiPath ?? f.apiPath, source: 'human' }
                : f
            ));
            setCorrectingField(null);
          }}
        />
      )}
    </div>
  );
}
