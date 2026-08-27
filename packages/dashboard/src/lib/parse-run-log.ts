// packages/dashboard/src/lib/parse-run-log.ts
// The exact inverse of `formatPlanLog` (packages/api/src/crawl/plan-source.ts):
//
//   const lines = [
//     ...warnings.map((w) => `warning: ${w}`),
//     ...errors.map((e) => `error: input ${e.inputIndex}: ${e.message}`),
//   ];
//
// `runs.logs` is the only place a completed run's plan warnings/errors survive
// — `planSource` returns them on the mutation response, but the confirm gate
// reads a PERSISTED run (`runs.getWithDetails`), not that response. Recovering
// the original strings (not the prefixed log lines) lets `diagnoseRun`'s
// regexes match exactly what they were written against.

export type ParsedRunLog = {
  warnings: string[];
  errors: string[];
};

const WARNING_PREFIX = /^warning: /;
const ERROR_PREFIX = /^error: input \d+: /;

export function parseRunLog(logs: string | null | undefined): ParsedRunLog {
  const lines = (logs ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    if (WARNING_PREFIX.test(line)) {
      warnings.push(line.replace(WARNING_PREFIX, ''));
    } else if (ERROR_PREFIX.test(line)) {
      errors.push(line.replace(ERROR_PREFIX, ''));
    }
  }
  return { warnings, errors };
}
