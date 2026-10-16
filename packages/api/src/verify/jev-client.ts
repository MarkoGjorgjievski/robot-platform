// packages/api/src/verify/jev-client.ts
// The real TypeSafe client for a Jev reading (spec 2026-10-16 §4). Never used
// in tests: `startJevReading` takes an injected client, and builds this one
// only when the switch (`JEV_SHADOW=1` and `TYPESAFE_API_KEY`) is on. Built the
// way the experiment CLI (`src/jev-images-run.ts` `makeClient`/`call`/
// `stateFor`/`questionFor`) built the requests that produced the measured
// results: model jev-1.14.0, the images header, the screenshot once in state,
// candidates as verbatim { id, value } items, questions keyed `q_<key>`.
import { JEV_MODEL, type JevClient } from './jev-reading.js';

type Sdk = typeof import('@typesafe-ai/sdk');

export function typesafeJevClient(): JevClient {
  let made: Promise<{ sdk: Sdk; client: InstanceType<Sdk['TypeSafeClient']> }> | null = null;
  // The SDK reads TYPESAFE_API_KEY itself. Our own 10 s timeout and one retry
  // (runJevReading) govern; the SDK neither retries nor waits longer.
  const get = () => (made ??= import('@typesafe-ai/sdk').then((sdk) => ({
    sdk,
    client: new sdk.TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' }, retry: { maxRetries: 0 }, timeout: 15_000, logLevel: 'error' }),
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
      const res = await client.systemOne({ model: JEV_MODEL, state: state as never, questions: questions as never });
      const answers: Record<string, { choice: string; probabilities: Record<string, number> }> = {};
      for (const [key, a0] of Object.entries(res.answers as Record<string, unknown>)) {
        const a = a0 as { choice?: unknown; probabilities?: Record<string, number> };
        if (typeof a.choice !== 'string') continue;
        answers[key.replace(/^q_/, '')] = { choice: a.choice, probabilities: a.probabilities ?? {} };
      }
      return { model: res.model, inputTokens: res.usage.input_tokens ?? 0, answers };
    },
  };
}
