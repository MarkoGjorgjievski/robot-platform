export type FieldType = 'string' | 'number' | 'boolean' | 'url' | 'image_url' | 'date' | 'price' | 'array';

export type SchemaField = {
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
  example_value?: string;
};

export type PageType = 'listing' | 'detail' | 'search_results' | 'table' | 'other';

export type DiscoveredSchema = {
  page_type: PageType;
  description: string;
  fields: SchemaField[];
};

export type SelectorField = {
  name: string;
  xpath: string;
  attribute: 'textContent' | 'href' | 'src' | 'alt' | 'value' | string;
  transform: 'none' | 'trim' | 'parse_number' | 'parse_date' | 'absolute_url';
};

export type ExtractionPlan = {
  row_xpath: string;
  fields: SelectorField[];
  page_type?: string;
};

export type ValidationResult = {
  is_complete: boolean;
  missing_items: string[];
  incorrect_values: Array<{ field: string; extracted: string; actual: string }>;
  confidence: number;
};

export type ApiFieldExtraction = {
  name: string;
  value: unknown;
  json_path: string;
  confidence: number;
};

export type ApiExtractionResult = {
  fields: ApiFieldExtraction[];
};

export type ExtractionResult = {
  data: Record<string, unknown>[];
  plan: ExtractionPlan;
  validation: ValidationResult;
};

export type RetryFeedback = {
  missingFields: string[];
  rowCount: number;
  previousRowXpath: string;
};
