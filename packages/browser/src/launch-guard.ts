// A process that must never start Chromium (the api-server, spec 2026-10-23 §4.4) says so once at
// boot; from then on every PlaywrightBrowser.launch in that process throws before anything starts.
let forbidden: string | null = null;

export class BrowserForbiddenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BrowserForbiddenError';
  }
}

export function forbidBrowserLaunch(reason = 'This process does not start browsers.'): void { forbidden = reason; }
/** Tests only. */
export function allowBrowserLaunch(): void { forbidden = null; }
export function assertBrowserLaunchAllowed(): void { if (forbidden !== null) throw new BrowserForbiddenError(forbidden); }
