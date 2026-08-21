// What `crawl-execute.ts` should print and exit with, given how its poll
// loop ended. Split out as a pure function because the script itself is
// top-level-await CLI glue with no function boundary to unit test.
//
// The crawl this CLI drives runs INSIDE this CLI's own process (the browser
// is launched here, `crawl.execute` is called in-process via a direct tRPC
// caller — there is no separate api-server). Hitting the 240-tick / 20-minute
// poll cap while the run is still active does not mean the run finished: it
// means this process is about to exit while the run is mid-flight, which
// abandons the claimed item (`running` forever) and the run (stuck in
// whatever its live status was) — the opposite of the success the old
// unconditional `process.exit(0)` implied.
export function describeCrawlExecuteOutcome(
  status: string,
  hitPollCap: boolean,
): { message: string; exitCode: number } {
  if (hitPollCap) {
    return {
      message:
        `Poll cap reached (240 ticks / 20 minutes) while the run was still '${status}'. ` +
        `This crawl runs inside this CLI's own process — exiting now leaves it mid-flight: ` +
        `the claimed item stays 'running' and the run stays '${status}' until something ` +
        `resumes it. Re-run crawl-execute against the same runId to resume, or check ` +
        `crawl.status directly.`,
      exitCode: 1,
    };
  }
  if (status === 'failed') {
    return { message: `Run ${status}.`, exitCode: 1 };
  }
  return { message: `Run ${status}.`, exitCode: 0 };
}
