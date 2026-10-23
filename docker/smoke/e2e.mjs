// The stack's end-to-end check (spec 2026-10-23 docker-compose §6), from the repo root with the stack up and
// the fixture started (docker compose --profile test up -d):  node docker/smoke/e2e.mjs
// End-to-end through the stack's api (:4200): sign in, a project, a website, a proof-page capture done by the worker, its tile served back.
const API = process.env.API ?? 'http://localhost:4200';
let cookie = '';
async function call(kind, path, input) {
  const enc = encodeURIComponent(JSON.stringify({ json: input }));
  const res = kind === 'query'
    ? await fetch(`${API}/trpc/${path}?input=${enc}`, { headers: { cookie } })
    : await fetch(`${API}/trpc/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ json: input }) });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('robot_session='));
  if (set) cookie = set.split(';')[0];
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.result.data.json;
}
const t0 = Date.now();
const me = await call('mutation', 'auth.signIn', { email: 'stack-smoke@example.com', password: 'x' });
console.log('signed in:', me.user.email, 'org', me.org.slug);
const project = await call('mutation', 'projects.create', { name: `Stack smoke ${new Date().toISOString().slice(11, 19)}` });
console.log('project:', project.slug ?? JSON.stringify(project).slice(0, 120));
const source = await call('mutation', 'sources.createInProject', { projectSlug: project.slug, name: 'Fixture Shop', url: 'http://fixture:8080/' });
const sourceId = source.id ?? source.source?.id ?? source.sourceId;
console.log('website:', sourceId);
const started = await call('mutation', 'sources.captureProofPage', { sourceId, url: 'http://fixture:8080/product.html' });
const captureId = started.captureId ?? started.id;
console.log('capture started:', captureId);
let cap;
for (let i = 0; i < 90; i++) {
  cap = await call('query', 'sources.proofPageCapture', { captureId });
  if (cap.status !== 'capturing' && cap.status !== 'queued' && cap.status !== 'pending') break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('capture:', cap.status, cap.title ? `title "${cap.title}"` : '', `tiles ${cap.tiles.length}, boxes ${cap.boxes.length}, page ${cap.pageHeight}px`, cap.error ?? '');
const tile = cap.tiles[0];
const tileUrl = typeof tile === 'string' ? tile : tile?.url ?? tile?.src;
if (tileUrl) {
  const res = await fetch(new URL(tileUrl, API), { headers: { cookie } });
  const bytes = (await res.arrayBuffer()).byteLength;
  console.log('tile served by the api:', tileUrl, res.status, res.headers.get('content-type'), `${bytes} bytes`);
  const anon = await fetch(new URL(tileUrl, API));
  console.log('same tile without a session:', anon.status);
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
