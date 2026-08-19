import { API_URL } from './api-url';

/**
 * Download URL for a run's rows. The export lives on the api-server as a plain
 * HTTP route rather than a tRPC procedure, so this is a real link the browser
 * (or curl) can follow — no client-side blob assembly.
 */
export function runExportUrl(runId: string, format: 'csv' | 'json'): string {
  return `${API_URL}/export/runs/${runId}.${format}`;
}
