// Offline: the proposed product-link rule over out2/<site>.json harvests.
import { readFileSync } from 'node:fs';
const sites = process.argv.slice(2);
const shape = (p) => p.split('/').filter(Boolean).map((s) => {
  const m = s.match(/^(.*?)(\.[a-z]{2,5})$/i); const [stem, ext] = m ? [m[1], m[2]] : [s, ''];
  return (/[\d_-]/.test(stem) || stem.length >= 12 ? '*' : stem) + ext;
}).join('/') || '/';
const near = (a, key) => a.lv.slice(0, 6).some((l) => l[key] && l.d <= 3 && l.len < 800);
for (const site of sites) {
  const h = JSON.parse(readFileSync(`out2/${site}.json`, 'utf8'));
  const base = new URL(h.url); const host = (x) => x.replace(/^www\./, '');
  const cands = [];
  for (const a of h.anchors) {
    let u; try { u = new URL(a.href, h.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || host(u.hostname) !== host(base.hostname)) continue;
    const key = u.hostname + u.pathname.replace(/\/+$/, '');
    if (key === base.hostname + base.pathname.replace(/\/+$/, '') || u.pathname === '/') continue;
    cands.push({ ...a, u, key, shape: shape(u.pathname), P: near(a, 'price') || a.selfPrice, I: near(a, 'img') || a.selfImg });
  }
  const content = cands.filter((a) => !a.chrome && a.visible);
  const groups = new Map();
  for (const a of content) { const g = groups.get(a.shape) ?? { keys: new Set(), pi: new Set(), sw: new Set() }; if (a.swatch) g.sw.add(a.key); else g.keys.add(a.key); if (a.P && a.I && !a.swatch) g.pi.add(a.key); groups.set(a.shape, g); }
  // merge shapes that differ in one literal segment when >=3 such shapes each carry priced+imaged links
  for (let pass = 0; pass < 2; pass++) {
    const byHole = new Map();
    for (const [sh, g] of groups) { if (!g.pi.size) continue; const segs = sh.split('/'); segs.forEach((seg, i) => { if (seg.startsWith('*')) return; const hole = segs.map((x, j) => j === i ? '*' : x).join('/'); (byHole.get(hole) ?? byHole.set(hole, []).get(hole)).push(sh); }); }
    for (const [hole, shs] of byHole) { if (shs.length < 3) continue; const m = groups.get(hole) ?? { keys: new Set(), pi: new Set(), sw: new Set() }; for (const sh of shs) { const g = groups.get(sh); if (!g || sh === hole) continue; g.keys.forEach((k) => m.keys.add(k)); g.pi.forEach((k) => m.pi.add(k)); g.sw.forEach((k) => m.sw.add(k)); groups.delete(sh); } groups.set(hole, m); }
  }
  const ranked = [...groups.entries()].map(([s, g]) => ({ s, keys: g.keys.size, pi: g.pi.size, sw: g.sw.size, ex: [...g.pi][0] ?? [...g.keys][0] })).sort((x, y) => y.pi - x.pi || y.keys - x.keys);
  const win = ranked[0];
  const il = (h.itemList || []).filter(Boolean);
  console.log(`== ${site}  winner ${win?.s} priced+imaged=${win?.pi} all=${win?.keys} swatchOnly=${win?.sw}  itemList=${il.length}`);
  for (const r of ranked.slice(1, 4)) console.log(`   next ${r.s} pi=${r.pi} all=${r.keys} ex=${r.ex}`);
  if (win) console.log('   sample', [...groups.get(win.s).pi].slice(0, 4).map((k) => k.replace(/^[^/]+/, '')).join('  '));
  if (il.length) { const k = new Set(il.map((x) => { const u = new URL(x, h.url); return u.hostname + u.pathname.replace(/\/+$/, ''); })); console.log(`   itemList distinct=${k.size} overlap with winner=${[...k].filter((x) => groups.get(win.s).keys.has(x)).length}`); }
}
