// The field catalogue behind step 1 of the Schema tab (spec 2026-09-18 §2.1):
// what a customer scraping a product page (or an article, a job, …) usually
// wants, as chips they add with one click. Static on purpose: no model, and a
// list a human wrote and can read. `concept` says what an entry IS in the
// engine's vocabulary, so a catalogue field suggests and caches correctly
// without going through `deriveConcept`'s name guessing (which read
// "price currency" as a price on 2026-09-18). `description` is the website's
// default location hint, the one the API requires per field.
import type { CustomerFieldType } from '@robot/scraper';

export const SCHEMA_TYPES = ['product', 'listing_item', 'article', 'job', 'property', 'event', 'custom'] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type CatalogueEntry = { key: string; name: string; type: CustomerFieldType; description: string; concept: string };
export type CatalogueGroup = { name: string; entries: CatalogueEntry[] };
export type Catalogue = Record<SchemaType, { label: string; groups: CatalogueGroup[] }>;

const e = (key: string, name: string, type: CustomerFieldType, description: string, concept = key): CatalogueEntry => ({ key, name, type, description, concept });

export const CATALOGUE: Catalogue = {
  product: {
    label: 'Product',
    groups: [
      { name: 'Identity', entries: [
        e('title', 'Title', 'text', 'The product name as shown in the page heading', 'product_name'),
        e('subtitle', 'Subtitle', 'text', 'The line under the product name: variant, colour or short description'),
        e('brand', 'Brand', 'text', 'The brand or manufacturer', 'brand'),
        e('sku', 'SKU', 'text', 'The seller\'s article number or product code', 'sku'),
        e('gtin', 'GTIN', 'text', 'The barcode number (EAN, UPC, ISBN)', 'sku'),
        e('product_url', 'Product URL', 'url', 'The canonical address of the product page', 'url'),
      ] },
      { name: 'Price', entries: [
        e('price', 'Price', 'money', 'The price the customer pays now', 'price'),
        e('was_price', 'Was price', 'money', 'The crossed-out or previous price', 'regular_price'),
        e('price_currency', 'Price currency', 'text', 'The currency of the price (code or symbol)', 'currency'),
        e('discount', 'Discount', 'text', 'The saving shown next to the price, as an amount or a percentage', 'discount_amount'),
        e('unit_price', 'Unit price', 'money', 'The price per unit of measure (per kg, per litre)'),
      ] },
      { name: 'Availability', entries: [
        e('in_stock', 'In stock', 'boolean', 'Whether the product can be bought now', 'availability'),
        e('stock_count', 'Stock count', 'number', 'How many are left, when the page says'),
        e('delivery', 'Delivery', 'text', 'The delivery promise or shipping information', 'shipping_info'),
      ] },
      { name: 'Content', entries: [
        e('description', 'Description', 'text', 'The main product description', 'description'),
        e('bullet_points', 'Bullet points', 'text_list', 'The highlights or key features list', 'product_features'),
        e('specifications', 'Specifications', 'text', 'The technical details or specification table', 'product_dimensions'),
      ] },
      { name: 'Media', entries: [
        e('main_image', 'Main image', 'image', 'The primary product photo', 'image_url'),
        e('gallery', 'Gallery', 'text_list', 'The other product photos', 'additional_images'),
      ] },
      { name: 'Rating', entries: [
        e('rating', 'Rating', 'number', 'The average customer rating', 'rating'),
        e('review_count', 'Review count', 'number', 'How many reviews the rating is based on', 'review_count'),
      ] },
      { name: 'Taxonomy', entries: [
        e('category', 'Category', 'text', 'The category the product is filed under', 'category'),
        e('breadcrumbs', 'Breadcrumbs', 'text_list', 'The breadcrumb trail above the product'),
        e('tags', 'Tags', 'text_list', 'Labels or badges shown on the product'),
      ] },
    ],
  },
  listing_item: {
    label: 'Listing item',
    groups: [
      { name: 'Item', entries: [
        e('title', 'Title', 'text', 'The item name on the listing card', 'product_name'),
        e('item_url', 'Item URL', 'url', 'The link from the card to the item page', 'url'),
        e('thumbnail', 'Thumbnail', 'image', 'The card image', 'image_url'),
        e('price', 'Price', 'money', 'The price on the card', 'price'),
        e('was_price', 'Was price', 'money', 'The crossed-out price on the card', 'regular_price'),
        e('rating', 'Rating', 'number', 'The rating on the card', 'rating'),
        e('review_count', 'Review count', 'number', 'The number of reviews on the card', 'review_count'),
        e('badge', 'Badge', 'text', 'A label such as New, Sale or Bestseller'),
        e('in_stock', 'In stock', 'boolean', 'Whether the card says it can be bought', 'availability'),
        e('position', 'Position', 'number', 'The item\'s position in the listing'),
      ] },
    ],
  },
  article: {
    label: 'Article',
    groups: [
      { name: 'Identity', entries: [
        e('headline', 'Headline', 'text', 'The article title', 'product_name'),
        e('subheading', 'Subheading', 'text', 'The standfirst or deck under the headline'),
        e('author', 'Author', 'text', 'The byline'),
        e('published_date', 'Published date', 'date', 'The publication date'),
        e('updated_date', 'Updated date', 'date', 'The last-updated date, when shown'),
        e('article_url', 'Article URL', 'url', 'The canonical address of the article', 'url'),
      ] },
      { name: 'Content', entries: [
        e('body', 'Body', 'text', 'The article text'),
        e('summary', 'Summary', 'text', 'The abstract or lead paragraph', 'description'),
        e('main_image', 'Main image', 'image', 'The lead image', 'image_url'),
        e('image_caption', 'Image caption', 'text', 'The caption under the lead image'),
      ] },
      { name: 'Taxonomy', entries: [
        e('section', 'Section', 'text', 'The section or category the article sits in', 'category'),
        e('tags', 'Tags', 'text_list', 'The topic tags'),
        e('word_count', 'Word count', 'number', 'The length, when shown'),
        e('comment_count', 'Comment count', 'number', 'The number of comments'),
      ] },
    ],
  },
  job: {
    label: 'Job',
    groups: [
      { name: 'Position', entries: [
        e('job_title', 'Job title', 'text', 'The position title', 'product_name'),
        e('company', 'Company', 'text', 'The employer', 'brand'),
        e('location', 'Location', 'text', 'Where the job is based'),
        e('remote', 'Remote', 'boolean', 'Whether the job can be done remotely'),
        e('employment_type', 'Employment type', 'text', 'Full-time, part-time, contract'),
        e('seniority', 'Seniority', 'text', 'The level: junior, senior, lead'),
        e('job_url', 'Job URL', 'url', 'The canonical address of the posting', 'url'),
      ] },
      { name: 'Pay', entries: [
        e('salary_from', 'Salary from', 'money', 'The lower end of the salary range', 'price'),
        e('salary_to', 'Salary to', 'money', 'The upper end of the salary range'),
        e('salary_period', 'Salary period', 'text', 'Per year, per month, per hour'),
        e('currency', 'Currency', 'text', 'The currency of the salary', 'currency'),
      ] },
      { name: 'Details', entries: [
        e('description', 'Description', 'text', 'The job description', 'description'),
        e('requirements', 'Requirements', 'text_list', 'The requirements list', 'product_features'),
        e('benefits', 'Benefits', 'text_list', 'The benefits list'),
        e('posted_date', 'Posted date', 'date', 'When the job was posted'),
        e('closing_date', 'Closing date', 'date', 'The application deadline'),
        e('department', 'Department', 'text', 'The team or department', 'category'),
      ] },
    ],
  },
  property: {
    label: 'Property',
    groups: [
      { name: 'Identity', entries: [
        e('title', 'Title', 'text', 'The listing headline', 'product_name'),
        e('address', 'Address', 'text', 'The street address or area'),
        e('property_type', 'Property type', 'text', 'House, flat, land', 'category'),
        e('listing_type', 'Listing type', 'text', 'For sale or to rent'),
        e('reference', 'Reference', 'text', 'The agent\'s reference number', 'sku'),
        e('property_url', 'Property URL', 'url', 'The canonical address of the listing', 'url'),
      ] },
      { name: 'Price', entries: [
        e('price', 'Price', 'money', 'The asking price or rent', 'price'),
        e('price_currency', 'Price currency', 'text', 'The currency of the price', 'currency'),
        e('price_period', 'Price period', 'text', 'Per month, per week, when renting'),
      ] },
      { name: 'Size', entries: [
        e('bedrooms', 'Bedrooms', 'number', 'The number of bedrooms'),
        e('bathrooms', 'Bathrooms', 'number', 'The number of bathrooms'),
        e('floor_area', 'Floor area', 'number', 'The internal area'),
        e('plot_area', 'Plot area', 'number', 'The land area'),
        e('year_built', 'Year built', 'number', 'The construction year'),
      ] },
      { name: 'Content', entries: [
        e('description', 'Description', 'text', 'The listing description', 'description'),
        e('features', 'Features', 'text_list', 'The features list', 'product_features'),
        e('main_image', 'Main image', 'image', 'The primary photo', 'image_url'),
        e('agent', 'Agent', 'text', 'The listing agent or agency', 'seller'),
        e('energy_rating', 'Energy rating', 'text', 'The energy performance rating'),
      ] },
    ],
  },
  event: {
    label: 'Event',
    groups: [
      { name: 'Identity', entries: [
        e('title', 'Title', 'text', 'The event name', 'product_name'),
        e('organiser', 'Organiser', 'text', 'Who runs the event', 'brand'),
        e('event_url', 'Event URL', 'url', 'The canonical address of the event page', 'url'),
        e('category', 'Category', 'text', 'Concert, conference, sport', 'category'),
      ] },
      { name: 'When and where', entries: [
        e('start_date', 'Start date', 'date', 'The start date'),
        e('end_date', 'End date', 'date', 'The end date'),
        e('venue', 'Venue', 'text', 'The venue name'),
        e('address', 'Address', 'text', 'The venue address'),
        e('online', 'Online', 'boolean', 'Whether the event is online'),
      ] },
      { name: 'Tickets', entries: [
        e('price', 'Price', 'money', 'The ticket price, or the lowest one', 'price'),
        e('price_currency', 'Price currency', 'text', 'The currency of the price', 'currency'),
        e('tickets_available', 'Tickets available', 'boolean', 'Whether tickets can still be bought', 'availability'),
      ] },
      { name: 'Content', entries: [
        e('description', 'Description', 'text', 'The event description', 'description'),
        e('main_image', 'Main image', 'image', 'The event image', 'image_url'),
        e('performers', 'Performers', 'text_list', 'Who performs or speaks'),
      ] },
    ],
  },
  custom: { label: 'Custom', groups: [] },
};

export function catalogueEntry(type: SchemaType, key: string): CatalogueEntry | undefined {
  return CATALOGUE[type].groups.flatMap((g) => g.entries).find((en) => en.key === key);
}
