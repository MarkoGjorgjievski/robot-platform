// Capture-failure sentences in customer words (spec 2026-10-21). Moved to @robot/scraper/customer-copy (spec
// 2026-10-24 email §3.1) so the emails reword a stored sentence exactly as the app does; the app keeps this path.
export { BLOCKED_SENTENCE, PAGE_NOT_READ_SENTENCE, captureWords } from '@robot/scraper/customer-copy';
