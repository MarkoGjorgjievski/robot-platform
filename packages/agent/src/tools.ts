import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export const discoverSchemaTool: Tool = {
  name: 'propose_schema',
  description: 'Propose a data extraction schema for the web page. Identify repeating data elements and their fields.',
  input_schema: {
    type: 'object' as const,
    properties: {
      page_type: {
        type: 'string',
        enum: ['listing', 'detail', 'search_results', 'table', 'other'],
        description: 'The type of page being analyzed',
      },
      description: {
        type: 'string',
        description: 'Brief description of what data is on the page',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field name in snake_case' },
            type: {
              type: 'string',
              enum: ['string', 'number', 'boolean', 'url', 'image_url', 'date', 'price', 'array'],
            },
            description: { type: 'string', description: 'What this field contains' },
            required: { type: 'boolean' },
            example_value: { type: 'string', description: 'An example value from the page' },
            source: {
              type: 'string',
              enum: ['api', 'json-ld', 'meta', 'page'],
              description: 'Where the value was found: "api" (intercepted API JSON), "json-ld" (Schema.org), "meta" (meta tags), "page" (visible page content)',
            },
            api_path: {
              type: 'string',
              description: 'If source is "api": the dot-notation path to the value in the API JSON (e.g. "data.product.name", "items[0].price.current"). Required when source is "api".',
            },
          },
          required: ['name', 'type', 'description', 'required'],
        },
      },
    },
    required: ['page_type', 'description', 'fields'],
  },
};

export const generateSelectorsTool: Tool = {
  name: 'generate_selectors',
  description: 'Generate XPath expressions to extract data from the page. Provide a row XPath and field-level XPaths relative to each row.',
  input_schema: {
    type: 'object' as const,
    properties: {
      row_xpath: {
        type: 'string',
        description: 'XPath expression matching each repeating item container (e.g. //tr[@class="athing"], //div[@class="product-card"])',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            value: {
              type: 'string',
              description: 'The actual value you SEE for this field on the page/screenshot (e.g. "12.3 Ounce", "$62.17"). This is your extraction target — write an xpath that returns exactly this.',
            },
            xpath: {
              type: 'string',
              description: 'XPath expression relative to the row element. Can traverse siblings with following-sibling::, ancestors with ancestor::, etc. Use . prefix for descendants of the row (e.g. .//span[@class="price"])',
            },
            attribute: {
              type: 'string',
              description: 'What to extract: "textContent" for text, "href" for links, "src" for images, or any HTML attribute name',
            },
            transform: {
              type: 'string',
              enum: ['none', 'trim', 'parse_number', 'parse_date', 'absolute_url'],
            },
          },
          required: ['name', 'value', 'xpath', 'attribute', 'transform'],
        },
      },
    },
    required: ['row_xpath', 'fields'],
  },
};

export const extractFromApiTool: Tool = {
  name: 'extract_from_api',
  description: 'Extract field values from a raw API JSON response. For each requested field, find the value and its JSON path in the response.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The field name requested' },
            value: { description: 'The extracted value (string, number, boolean, or array of strings)' },
            json_path: { type: 'string', description: 'Dot-notation path to the value in the API response (e.g. "data.product.price.current")' },
            confidence: { type: 'number', description: '0-1 confidence that this is the correct value for this field' },
          },
          required: ['name', 'value', 'json_path', 'confidence'],
        },
      },
    },
    required: ['fields'],
  },
};

export const detectPaginationTool: Tool = {
  name: 'detect_pagination',
  description: 'Detect the pagination mechanism on a listing page. Identify how to navigate to the next page of results.',
  input_schema: {
    type: 'object' as const,
    properties: {
      has_pagination: {
        type: 'boolean',
        description: 'Whether the page has pagination (multiple pages of results)',
      },
      strategy: {
        type: 'string',
        enum: ['url-pattern', 'next-button', 'page-numbers', 'none'],
        description: 'The type of pagination mechanism found',
      },
      url_template: {
        type: 'string',
        description: 'For url-pattern: the URL with {N} as page number placeholder, e.g. "https://example.com/search?page={N}"',
      },
      next_selector: {
        type: 'string',
        description: 'For next-button: CSS selector for the next page button/link, e.g. "a[rel=next]", ".pagination .next a"',
      },
      page_selector: {
        type: 'string',
        description: 'For page-numbers: CSS selector for the pagination number links, e.g. ".pagination a", "nav[aria-label=Pagination] a"',
      },
    },
    required: ['has_pagination', 'strategy'],
  },
};

export const validateExtractionTool: Tool = {
  name: 'validate_extraction',
  description: 'Validate extracted data against the page screenshot. Check for missing items and incorrect values.',
  input_schema: {
    type: 'object' as const,
    properties: {
      is_complete: { type: 'boolean', description: 'Whether all visible items were extracted' },
      missing_items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Items visible on page but missing from extracted data',
      },
      incorrect_values: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            extracted: { type: 'string' },
            actual: { type: 'string' },
          },
          required: ['field', 'extracted', 'actual'],
        },
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-1 that the extraction is correct and complete',
      },
    },
    required: ['is_complete', 'missing_items', 'incorrect_values', 'confidence'],
  },
};
