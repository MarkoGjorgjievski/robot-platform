// packages/api/src/verify/jev-client.ts
// The real TypeSafe client for a Jev reading (spec 2026-10-16 §4), and the
// request/client types it shares with jev-reading.ts (which imports from here,
// never the other way). Never used in tests: `startJevReading` takes an
// injected client, and builds this one only when the switch (`JEV_SHADOW=1`
// and `TYPESAFE_API_KEY`) is on. Built the way the experiment CLI
// (`src/jev-images-run.ts` `makeClient`/`call`/`stateFor`/`questionFor`) built
// the requests that produced the measured results: model jev-1.14.0, the
// images header, the screenshot once in state, candidates as verbatim
// { id, value } items, questions keyed `q_<key>`.

export const JEV_MODEL = 'jev-1.14.0';
/** Per attempt. `runJevReading` aborts the request at this point; the SDK's own timeout is the same. */
export const JEV_TIMEOUT_MS = 10_000;

export type JevQuestion = {
  key: string; kind: 'field' | 'variant'; instructions: string; options: Array<{ id: string; label: string }>;
  /** The `none` option's wording (the experiments' own); the client falls back to a generic one. */
  noneLabel?: string;
};
export type JevRequest = { tileIndex: number; state: { page_title: string; candidates: Record<string, Array<{ id: string; value: string }>> }; questions: JevQuestion[] };
export interface JevClient {
  /** `signal` aborts the request when `runJevReading`'s timeout fires (a fake client may ignore it). */
  ask(req: { image: Buffer; state: JevRequest['state']; questions: JevQuestion[]; signal?: AbortSignal }): Promise<{ model: string; inputTokens: number; answers: Record<string, { choice: string; probabilities: Record<string, number> }> }>;
}

type Sdk = typeof import('@typesafe-ai/sdk');

export function typesafeJevClient(): JevClient {
  let made: Promise<{ sdk: Sdk; client: InstanceType<Sdk['TypeSafeClient']> }> | null = null;
  // The SDK reads TYPESAFE_API_KEY itself. Our timeout and one retry (runJevReading) govern: the SDK
  // never retries, and never waits longer than we do, so a timed-out call cannot overlap the retry.
  const get = () => (made ??= import('@typesafe-ai/sdk').then((sdk) => ({
    sdk,
    client: new sdk.TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' }, retry: { maxRetries: 0 }, timeout: JEV_TIMEOUT_MS, logLevel: 'error' }),
  })));
  return {
    async ask(req) {
      const { sdk, client } = await get();
      // The screenshot once, in state; the questions say "the screenshot" in words and never name it.
      const state = { screenshot: sdk.image(req.image), ...req.state };
      const questions = Object.fromEntries(req.questions.map((q) => [`q_${q.key}`, sdk.choice(q.instructions, {
        ...Object.fromEntries(q.options.map((o) => [o.id, o.label])),
        none: q.noneLabel ?? (q.kind === 'variant' ? 'None: the screenshot shows no variant as selected' : 'None of the candidates is the value the screenshot shows'),
      })]));
      const res = await client.systemOne(
        { model: JEV_MODEL, state: state as never, questions: questions as never },
        req.signal ? { signal: req.signal } : undefined,
      );
      const answers: Record<string, { choice: string; probabilities: Record<string, number> }> = {};
      for (const [key, a0] of Object.entries(res.answers as Record<string, unknown>)) {
        const a = a0 as { choice?: unknown; probabilities?: Record<string, number> };
        if (typeof a.choice !== 'string') continue;
        answers[key.replace(/^q_/, '')] = { choice: a.choice, probabilities: a.probabilities ?? {} };
      }
      const tokens = res.usage?.input_tokens;
      if (typeof tokens !== 'number') console.warn(`[jev] the TypeSafe response carried no input_tokens (model ${res.model}): this reading's cost is stored as 0`);
      return { model: res.model, inputTokens: typeof tokens === 'number' ? tokens : 0, answers };
    },
  };
}
