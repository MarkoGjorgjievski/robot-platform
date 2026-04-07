export { ScraperPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js';
export { buildExtractionScript, type ExecutorResult } from './executor.js';
export { extractFromStructuredData } from './structured-extractor.js';
export { lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, type DomainCache, type FieldPathSet, type FieldPath } from './domain-cache.js';
export { extractBrand, extractRootDomain, areDomainsRelated, isSubdomain, getSubdomainPrefix } from './domain-utils.js';
export { acquireDomainLock, isDomainLocked, getActiveLocks } from './domain-lock.js';
export { detectSchemaChanges, formatSchemaChanges, type SchemaChange } from './schema-evolution.js';
export { validateExtractedData, type QualityIssue, type QualityResult } from './data-quality.js';
