"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParameterForm } from "@/components/parameter-form";
import { PARAMETER_DEFINITIONS, PARAMETER_GROUPS } from "@robot/config";

type Props = {
  orgs: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  domainDefaults?: Record<string, unknown>;
  extractor?: {
    id: string;
    orgId: string;
    domainId: string;
    country: string;
    variant: string;
    robotTemplate: string;
    parameters: unknown;
    isActive: boolean;
  };
  action: (formData: FormData) => Promise<void>;
};

export function ExtractorForm({
  orgs,
  domains,
  domainDefaults,
  extractor,
  action,
}: Props) {
  const isEdit = !!extractor;

  return (
    <form action={action} className="space-y-5">
      {isEdit && <input type="hidden" name="id" value={extractor.id} />}

      {/* Org */}
      <div className="space-y-2">
        <Label htmlFor="orgId">
          Organization <span className="text-destructive">*</span>
        </Label>
        <Select name="orgId" defaultValue={extractor?.orgId ?? ""} required>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an organization" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Domain */}
      <div className="space-y-2">
        <Label htmlFor="domainId">
          Domain <span className="text-destructive">*</span>
        </Label>
        <Select
          name="domainId"
          defaultValue={extractor?.domainId ?? ""}
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a domain" />
          </SelectTrigger>
          <SelectContent>
            {domains.map((domain) => (
              <SelectItem key={domain.id} value={domain.id}>
                {domain.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Country */}
      <div className="space-y-2">
        <Label htmlFor="country">
          Country <span className="text-destructive">*</span>
        </Label>
        <Input
          id="country"
          name="country"
          required
          defaultValue={extractor?.country ?? ""}
          placeholder="e.g. US"
        />
      </div>

      {/* Variant */}
      <div className="space-y-2">
        <Label htmlFor="variant">
          Variant <span className="text-destructive">*</span>
        </Label>
        <Input
          id="variant"
          name="variant"
          required
          defaultValue={extractor?.variant ?? ""}
          placeholder="e.g. default"
        />
      </div>

      {/* Robot Template */}
      <div className="space-y-2">
        <Label htmlFor="robotTemplate">Robot Template</Label>
        <Input
          id="robotTemplate"
          name="robotTemplate"
          defaultValue={extractor?.robotTemplate ?? "robots/san-antonio"}
        />
      </div>

      {/* Active */}
      <div className="flex items-center gap-3">
        <Checkbox
          id="isActive"
          name="isActive"
          defaultChecked={extractor?.isActive ?? true}
        />
        <Label htmlFor="isActive" className="cursor-pointer">
          Active
        </Label>
      </div>

      {/* Parameters — typed form */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Parameters</h3>
        <ParameterForm
          domainDefaults={domainDefaults ?? {}}
          extractorOverrides={
            (extractor?.parameters as Record<string, unknown>) ?? {}
          }
          definitions={PARAMETER_DEFINITIONS}
          groups={PARAMETER_GROUPS}
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit">
          {isEdit ? "Update Extractor" : "Create Extractor"}
        </Button>
      </div>
    </form>
  );
}
