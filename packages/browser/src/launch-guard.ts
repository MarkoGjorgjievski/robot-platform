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

// A process that cleans up after itself (the worker) names the browsers it launches: each Chromium
// carries `--robot-owner=<owner>` on its command line (Chromium ignores a switch it does not know), so a
// later start of that process can find — and close — the ones a hard kill left running.
let owner: string | null = null;
export const BROWSER_OWNER_SWITCH = '--robot-owner=';
export function setBrowserOwner(next: string | null): void { owner = next; }
/** The launch arguments that name this process's browsers; none unless an owner is set. */
export function browserOwnerArgs(): string[] { return owner ? [`${BROWSER_OWNER_SWITCH}${owner}`] : []; }
