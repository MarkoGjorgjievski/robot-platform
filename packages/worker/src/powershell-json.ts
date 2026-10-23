/**
 * Parse `ConvertTo-Json` output from Windows PowerShell 5.1, which leaves a raw control character in a string
 * (a process's command line) unescaped: invalid JSON to a strict parser. Every control character becomes a
 * space first. Outside a string that is whitespace anyway; inside one the callers only look for a switch, so a
 * space in its place changes nothing they read.
 */
export function parsePowerShellJson(stdout: string): unknown {
  return JSON.parse(stdout.replace(/[\u0000-\u001f]/g, ' '));
}
