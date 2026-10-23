// Spec 2026-10-23 §4.4: page loads run in @robot/worker; this process must never start Chromium.
import { forbidBrowserLaunch } from '@robot/api/jobs';

export function configureApiProcess(): void {
  forbidBrowserLaunch('The api-server never starts a browser: page loads run in the worker (pnpm dev:all starts it).');
}
