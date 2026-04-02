export { ScraperPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js';
export { buildExtractionScript, type ExecutorResult } from './executor.js';
export { extractFromStructuredData } from './structured-extractor.js';
export { lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, type DomainCache, type FieldPathSet, type FieldPath } from './domain-cache.js';
