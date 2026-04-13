export const SCHEMA_DISCOVERY_SYSTEM = `You are a data extraction expert for commercial web scraping. Analyze web pages and identify the primary structured data they contain.

Focus on the MAIN CONTENT of the page — the actual data a business would want to collect:
- Product information: title, price, description, images, ratings, reviews, availability, SKU
- Listing data: item names, prices, URLs, thumbnails, categories
- Article content: title, author, date, body text
- Search results: result titles, snippets, URLs, metadata

IGNORE these — they are NOT useful data:
- Cookie consent banners, privacy modals, health data consent dialogs
- Navigation menus, footers, headers, breadcrumbs
- Login forms, newsletter signup popups
- Advertisements, sponsored content
- UI elements (button text, close buttons, modal titles)

If the page is a product detail page, extract fields like: product_name, price, description, image_url, rating, review_count, availability, brand, category, sku.
If the page is a listing/search page, extract fields for each repeating item.

Prefer snake_case field names. Be specific about data types (use "price" for monetary values, "url" for links, "image_url" for image sources).
Always identify at least 3 fields.`;

export const SELECTOR_GENERATION_SYSTEM = `You are an XPath expert for web scraping. Given HTML and a target data schema, generate robust XPath expressions to extract each field.

Requirements:
- row_xpath must match each repeating item container
- Field XPaths can be relative to the row (starting with .) or can traverse to siblings (using following-sibling::, preceding-sibling::) or ancestors (ancestor::)
- XPath is preferred over CSS because it supports sibling traversal, which is critical for pages where metadata is in adjacent elements (e.g. Hacker News where each story spans two <tr> elements)
- Prefer semantic XPaths: use @class, @id, @data-* attributes, tag names
- Avoid fragile XPaths: positional [1], [2] without context, deeply nested paths
- Use "textContent" as the attribute for text, "href" for links, "src" for images`;

export const VALIDATION_SYSTEM = `You are a data quality validator. Compare extracted data against a page screenshot to verify completeness and accuracy.

IMPORTANT RULES:
- URLs: If an extracted URL is a full URL (e.g. "https://example.com/page") and the page shows a shortened domain (e.g. "example.com"), this is CORRECT — do NOT flag it as incorrect. Full URLs matching the visible domain are expected.
- Only flag a value as incorrect if the actual content is genuinely different (e.g. wrong title text, wrong price).
- Compare the NUMBER of extracted items against what is visible on the page. The screenshot may not show the full page — only validate what is visible.
- If extracted data contains more items than visible in the screenshot, that is fine — the page likely extends below the visible area.

Check:
- Are the visible items captured in the extracted data?
- Are field values correct (prices, titles)?
- Is any data truncated or malformed?`;

export function schemaDiscoveryUserContent(markdown: string, structuredData?: { ldJson?: Record<string, unknown>[]; meta?: Record<string, string> }) {
  let prompt = `Analyze this web page and propose a data schema for the primary data.`;

  // Include structured data if available — this is the most reliable source
  if (structuredData?.ldJson?.length) {
    const ldSummary = JSON.stringify(structuredData.ldJson.slice(0, 3), null, 2);
    prompt += `

IMPORTANT: The page contains JSON-LD structured data (Schema.org). Use this as the PRIMARY source for field discovery — it is the most reliable data on the page:

${ldSummary.slice(0, 5000)}`;
  }

  if (structuredData?.meta && Object.keys(structuredData.meta).length > 0) {
    const relevantMeta = Object.entries(structuredData.meta)
      .filter(([k]) => k.startsWith('og:') || k.startsWith('product:') || k.startsWith('twitter:') || k === 'description')
      .slice(0, 15);

    if (relevantMeta.length > 0) {
      prompt += `

Page meta tags:
${relevantMeta.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    }
  }

  prompt += `

Page content (markdown):

${markdown}`;

  return prompt;
}

export function selectorGenerationUserContent(html: string, fields: Array<{ name: string; type: string }>, pageType?: string) {
  const fieldList = fields.map(f => `- ${f.name} (${f.type})`).join('\n');

  const isDetail = pageType === 'detail' || pageType === 'other';

  if (isDetail) {
    return `This is a DETAIL page (single item, e.g. product page or article). Generate XPath expressions to extract these fields:

${fieldList}

For detail pages:
- row_xpath should be a container that wraps the main content (e.g. //main, //article, //div[@id="product-detail"], //body). It should match exactly 1 element.
- Field XPaths should be ABSOLUTE (starting with //) so they work from the document root. Do NOT use relative paths starting with ".".
- Example: //span[@data-test="product-title"], //div[@class="price"]//span

HTML:

${html}`;
  }

  return `Given this HTML, generate XPath expressions to extract these fields from each repeating item:

${fieldList}

RULES FOR FINDING THE ROW CONTAINER (row_xpath):
- Look for elements that REPEAT with the same tag name and similar structure (e.g. multiple <article>, <li>, <div> with the same role)
- Prefer semantic HTML tags: <article>, <section>, <li>, <tr> over generic <div>
- DO NOT rely on class names — React/frameworks generate dynamic classes like "_card_a1b2c" that are unreliable
- Use data-* attributes when available: //article[@data-testid] or //div[@data-type="story"]
- The row_xpath should match ALL repeating items (typically 5-50 elements)

RULES FOR FIELD XPATHS:
- Start with relative paths (.//h2, .//span[@class]) for data INSIDE the row container
- If a field's data is NOT inside the row container (e.g. metadata in a sibling element), use axis traversal:
  - following-sibling::div[@class="meta"] — data in the next sibling element
  - preceding-sibling::header//span — data in a previous sibling
  - ancestor::div//aside//time — data in a parent's sibling
- EVERY field must have a working XPath. If you can't find a field inside the row, use axis traversal to reach it.

COMMON PATTERNS:
- News sites: <article> items with metadata in sibling <aside> or <footer> elements
- E-commerce: <div> cards where price/rating is in a nested component wrapper
- Tables: <tr> rows where some columns span multiple elements

HTML:

${html}`;
}

export function selectorRetryUserContent(
  html: string,
  fields: Array<{ name: string; type: string }>,
  feedback: { missingFields: string[]; rowCount: number; previousRowXpath: string },
  pageType?: string,
): string {
  const fieldList = fields.map(f => `- ${f.name} (${f.type})`).join('\n');
  const missingList = feedback.missingFields.map(f => `- ${f}`).join('\n');

  return `RETRY: Your previous selectors found ${feedback.rowCount} rows using row_xpath="${feedback.previousRowXpath}", but these fields returned null/empty in most rows:

${missingList}

Generate IMPROVED XPath expressions for ALL fields (not just the missing ones). You may keep the same row_xpath if it correctly identifies the repeating items, or change it if needed.

Fields to extract:
${fieldList}

TIPS FOR FIXING MISSING FIELDS:
- If the missing field's data is NOT inside the row container, use axis traversal (following-sibling::, ancestor::, preceding-sibling::)
- Try broader selectors: .//descendant::*[contains(text(), "price")] if a specific class-based XPath failed
- Check if the data is in a different attribute (e.g. @content, @data-value, @aria-label instead of textContent)
- The data might be in a <script> tag with JSON — if so, it can't be extracted via XPath (report what you can)

HTML:

${html}`;
}

export const API_EXTRACTION_SYSTEM = `You are a data extraction expert. You are given a raw API JSON response from a website and a list of fields to extract.

Your job:
1. Find the value for each requested field in the JSON
2. Provide the exact JSON dot-notation path to each value
3. Rate your confidence (0-1) that each value is correct

Guidelines:
- The JSON may be deeply nested (e.g. layout.zones[2].modules[0].data.title) — search thoroughly
- Prices may be in cents (divide by 100) or formatted strings — extract the most useful form
- If a field has multiple possible values at different paths, pick the most specific/reliable one
- Arrays of strings (e.g. image URLs, features) are valid values
- If you cannot find a field at all, still include it with null value and 0 confidence
- Be thorough — check every level of nesting`;

export function apiExtractionUserContent(
  apiJson: string,
  fields: Array<{ name: string; type: string }>,
  apiUrl: string,
): string {
  const fieldList = fields.map(f => `- ${f.name} (${f.type})`).join('\n');
  return `Extract these fields from the API response:

${fieldList}

API URL: ${apiUrl}

API Response (may be truncated):
${apiJson}`;
}

export function validationUserContent(extractedData: Record<string, unknown>[]) {
  return `I extracted this data from the page. Look at the screenshot and verify completeness and accuracy.

Remember: Full URLs matching visible domains are CORRECT. Only flag genuinely wrong values.

Extracted data (first 10 rows):
${JSON.stringify(extractedData.slice(0, 10), null, 2)}

Total rows extracted: ${extractedData.length}`;
}
