// Esporta dal progetto Unity di Vampaladin i modelli per la stanza del museo, senza
// aprire Unity: legge i Mesh .asset (YAML testuale) e la scena Prova.unity.
//   - "statua": i pezzi del crociato fusi in un solo mesh nella posa salvata in scena
//   - "occhi": gli occhi del crociato (brilleranno di rosso)
//   - ogni arredo del dungeon (Generated/Arredi) e la sua parte luminosa (_Luce)
// Uscita: rooms/vampaladin/media/vampaladin.json + vampaladin.bin
// Assi: Unity e' sinistrorso, three destrorso: z cambia segno e i triangoli si girano.
//
// Uso: node tools/vampaladin-export.mjs

import fs from 'node:fs';
import path from 'node:path';

const UNITY = 'C:/Users/FERDINANDO/Desktop/JotunnModStub-master/Vampaladin/Vampaladin/Assets/Vampaladin';
const OUT = path.resolve('rooms/vampaladin/media');

// ---------------------------------------------------------------- mesh .asset

function readMesh(file) {
  const t = fs.readFileSync(file, 'utf8');
  const num = (re) => Number(t.match(re)[1]);
  const vcount = num(/m_VertexCount: (\d+)/);
  const size = num(/m_DataSize: (\d+)/);
  const data = Buffer.from(t.match(/_typelessdata: ([0-9a-f]*)/)[1], 'hex');
  const idxFormat = num(/m_IndexFormat: (\d+)/);
  const ib = Buffer.from(t.match(/m_IndexBuffer: ([0-9a-f]*)/)[1], 'hex');
  // canali nell'ordine di Unity: 0 posizione, 1 normale, 2 tangente, 3 colore, 4.. uv
  const block = t.slice(t.indexOf('m_Channels:'), t.indexOf('m_DataSize'));
  const ch = [...block.matchAll(/offset: (\d+)\s+format: (\d+)\s+dimension: (\d+)/g)]
    .map((m) => ({ offset: +m[1], format: +m[2], dim: +m[3] }));
  if (ch.some((c) => c.dim && c.format !== 0)) throw new Error(file + ': formato vertici non float');
  const stride = size / vcount;
  const get = (c, i, k) => data.readFloatLE(i * stride + c.offset + k * 4);
  const pos = [], nor = [], col = [];
  for (let i = 0; i < vcount; i++) {
    for (let k = 0; k < 3; k++) pos.push(get(ch[0], i, k));
    for (let k = 0; k < 3; k++) nor.push(ch[1].dim ? get(ch[1], i, k) : 0);
    for (let k = 0; k < 4; k++) col.push(ch[3].dim ? get(ch[3], i, k) : 1);
  }
  const idx = [];
  const n = ib.length / (idxFormat ? 4 : 2);
  for (let i = 0; i < n; i++) idx.push(idxFormat ? ib.readUInt32LE(i * 4) : ib.readUInt16LE(i * 2));
  return { pos, nor, col, idx };
}

// ---------------------------------------------------------------- scena

function readScene(file) {
  const t = fs.readFileSync(file, 'utf8');
  const docs = new Map();
  for (const part of t.split(/\n--- !u!/).slice(1)) {
    const head = part.match(/^(\d+) &(-?\d+)/);
    docs.set(head[2], { cls: +head[1], body: part });
  }
  return docs;
}

const vec = (s, key) => {
  const m = s.match(new RegExp(key + ': \\{x: ([-\\d.e]+), y: ([-\\d.e]+), z: ([-\\d.e]+)(?:, w: ([-\\d.e]+))?\\}'));
  return m ? m.slice(1).filter((v) => v !== undefined).map(Number) : null;
};
const ref = (s, key) => (s.match(new RegExp(key + ': \\{fileID: (-?\\d+)')) || [])[1];

// matrice 4x4 (colonne) da posizione, quaternione, scala
function trs(p, q, s) {
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    p[0], p[1], p[2], 1,
  ];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
  return m;
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const apply = (m, v, w) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);

// ---------------------------------------------------------------- uscita

const meshes = {};
const chunks = [];
let offset = 0;
function addMesh(name, mesh, extra = {}) {
  // Unity -> three: z negativo, triangoli girati
  const pos = new Float32Array(mesh.pos.length);
  const nor = new Float32Array(mesh.nor.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    pos[i] = mesh.pos[i]; pos[i + 1] = mesh.pos[i + 1]; pos[i + 2] = -mesh.pos[i + 2];
    nor[i] = mesh.nor[i]; nor[i + 1] = mesh.nor[i + 1]; nor[i + 2] = -mesh.nor[i + 2];
  }
  const col = new Float32Array(mesh.col);
  const idx = new Uint32Array(mesh.idx.length);
  for (let i = 0; i < mesh.idx.length; i += 3) {
    idx[i] = mesh.idx[i]; idx[i + 1] = mesh.idx[i + 2]; idx[i + 2] = mesh.idx[i + 1];
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]);
  }
  const entry = { vertices: pos.length / 3, min, max, ...extra };
  for (const [key, arr] of [['pos', pos], ['nor', nor], ['col', col], ['idx', idx]]) {
    entry[key] = offset;
    chunks.push(Buffer.from(arr.buffer));
    offset += arr.byteLength;
  }
  entry.indices = idx.length;
  meshes[name] = entry;
}

// guid -> file .asset
const guids = new Map();
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.asset.meta')) guids.set(fs.readFileSync(p, 'utf8').match(/guid: (\w+)/)[1], p.slice(0, -5));
  }
})(path.join(UNITY, 'Generated'));

// --- statua: gerarchia del crociato nella scena di prova ---
const docs = readScene(path.join(UNITY, 'Scenes/Prova.unity'));
const byGo = new Map(); // fileID GameObject -> { name, active, transform, meshGuid }
for (const [id, d] of docs) {
  if (d.cls === 1) byGo.set(id, { ...(byGo.get(id) || {}), name: d.body.match(/m_Name: (.*)/)[1].trim(), active: /m_IsActive: 1/.test(d.body) });
}
const transforms = new Map();
for (const [id, d] of docs) {
  if (d.cls === 4) {
    const go = ref(d.body, 'm_GameObject');
    const p = vec(d.body, 'm_LocalPosition'), q = vec(d.body, 'm_LocalRotation'), sc = vec(d.body, 'm_LocalScale');
    transforms.set(id, { go, father: ref(d.body, 'm_Father'), p, q, s: sc, local: trs(p, q, sc) });
    byGo.get(go).transform = id;
  }
  if (d.cls === 33) {
    const go = ref(d.body, 'm_GameObject');
    const g = (d.body.match(/m_Mesh: \{fileID: \d+, guid: (\w+)/) || [])[1];
    if (g) byGo.get(go).meshGuid = g;
  }
}
const rootGo = [...byGo.entries()].find(([, g]) => g.name === 'Crociato')[0];
const rootT = byGo.get(rootGo).transform;
// matrice relativa alla radice del crociato, e attivo solo se tutta la catena lo e'
function chain(tid) {
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  let active = true, t = tid, under = false;
  while (t && t !== '0') {
    if (t === rootT) { under = true; break; }
    const tr = transforms.get(t);
    m = mul(tr.local, m);
    active = active && byGo.get(tr.go).active;
    t = tr.father;
  }
  return { m, active, under };
}
// --- posa da statua: spada piantata a terra davanti, mani sull'impugnatura, testa china ---
// (nella scena il rig e' a riposo: braccia dritte giu' e spada parcheggiata di traverso)
const Q = {
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conj: (a) => [-a[0], -a[1], -a[2], a[3]],
  fromTo: (u, v) => {
    const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const q = [...c, 1 + u[0] * v[0] + u[1] * v[1] + u[2] * v[2]];
    const l = Math.hypot(...q);
    return q.map((x) => x / l);
  },
  axis: (ax, deg) => { const h = (deg * Math.PI) / 360; return [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)]; },
};
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const scl = (a, k) => a.map((x) => x * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => scl(a, 1 / Math.hypot(...a));
// solo le ossa del crociato: nella scena ci sono anche i nemici, con gli stessi nomi
const tByName = (n) => [...transforms.entries()].find(([id, t]) => byGo.get(t.go).name === n && chain(id).under);
function setLocal(n, p, q) {
  const [, t] = tByName(n);
  if (p) t.p = p;
  if (q) t.q = q;
  t.local = trs(t.p, t.q, t.s);
}
const worldPos = (n) => apply(chain(tByName(n)[0]).m, [0, 0, 0], 1);
// spada: elsa a 1,17 m (la lama e' lunga 1,17: la punta tocca il piedistallo), 33 cm davanti
const modelY = tByName('Modello')[1].p[1];
setLocal('Spada', [0, 1.17 - modelY, 0.33], Q.axis([1, 0, 0], 90)); // +z della lama -> giu'
// braccia: IK a due ossa verso l'impugnatura (destra sotto, sinistra sopra)
const DOWN = [0, -1, 0];
for (const [sideName, x, wrist] of [['Dx', 1, [0.02, 1.27, 0.3]], ['Sx', -1, [-0.02, 1.39, 0.3]]]) {
  const S = worldPos('Braccio' + sideName);
  const a = Math.abs(tByName('Avambraccio' + sideName)[1].p[1]);
  const b = Math.abs(tByName('Mano' + sideName)[1].p[1]);
  const toW = sub(wrist, S);
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, Math.hypot(...toW)));
  const n = norm(toW);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const pole = [x, -1, -0.2]; // gomiti aperti verso l'esterno e in basso
  const pp = norm(sub(pole, scl(n, dot(pole, n))));
  const E = add(add(S, scl(n, along)), scl(pp, h));
  const W = add(S, scl(n, d));
  const q1 = Q.fromTo(DOWN, norm(sub(E, S)));
  const q2 = Q.mul(Q.conj(q1), Q.fromTo(DOWN, norm(sub(W, E))));
  setLocal('Braccio' + sideName, null, q1);
  setLocal('Avambraccio' + sideName, null, q2);
}
setLocal('Testa', null, Q.axis([1, 0, 0], 10)); // testa china

const statue = { pos: [], nor: [], col: [], idx: [] };
const eyes = { pos: [], nor: [], col: [], idx: [] };
const parts = [];
for (const [, g] of byGo) {
  if (!g.meshGuid || !g.transform) continue;
  const { m, active, under } = chain(g.transform);
  if (!under || !active || g.name === 'Ombra') continue;
  const src = readMesh(guids.get(g.meshGuid));
  const dst = g.name === 'Occhi' ? eyes : statue;
  const base = dst.pos.length / 3;
  for (let i = 0; i < src.pos.length; i += 3) {
    dst.pos.push(...apply(m, src.pos.slice(i, i + 3), 1));
    const n = apply(m, src.nor.slice(i, i + 3), 0);
    const l = Math.hypot(...n) || 1;
    dst.nor.push(n[0] / l, n[1] / l, n[2] / l);
  }
  dst.col.push(...src.col);
  dst.idx.push(...src.idx.map((v) => v + base));
  parts.push(g.name);
}
addMesh('statua', statue, { parts });
addMesh('occhi', eyes);

// --- arredi del dungeon ---
const props = [];
for (const f of fs.readdirSync(path.join(UNITY, 'Generated/Arredi'))) {
  if (!f.endsWith('.asset')) continue;
  const name = f.slice(0, -6);
  addMesh(name, readMesh(path.join(UNITY, 'Generated/Arredi', f)));
  props.push(name);
}

// --- dove si aggancia ogni parte luminosa (_Luce) al suo arredo: dalla scena del dungeon ---
{
  const dd = readScene(path.join(UNITY, 'Scenes/Dungeon.unity'));
  const goMesh = new Map(), goT = new Map(), tInfo = new Map();
  for (const [id, d] of dd) {
    if (d.cls === 33) {
      const g = (d.body.match(/m_Mesh: \{fileID: \d+, guid: (\w+)/) || [])[1];
      if (g && guids.has(g)) goMesh.set(ref(d.body, 'm_GameObject'), path.basename(guids.get(g), '.asset'));
    }
    if (d.cls === 4) {
      goT.set(ref(d.body, 'm_GameObject'), id);
      tInfo.set(id, { go: ref(d.body, 'm_GameObject'), father: ref(d.body, 'm_Father'), pos: vec(d.body, 'm_LocalPosition') });
    }
  }
  for (const [go, name] of goMesh) {
    if (!name.endsWith('_Luce') || meshes[name].offset) continue;
    const t = tInfo.get(goT.get(go));
    const fatherMesh = goMesh.get(tInfo.get(t.father)?.go);
    if (fatherMesh !== name.slice(0, -5)) continue;
    meshes[name].offset = [t.pos[0], t.pos[1], -t.pos[2]];
  }
  console.log('agganci luci:', Object.entries(meshes).filter(([, m]) => m.offset).map(([n, m]) => `${n} ${m.offset.map((v) => v.toFixed(2))}`).join('; '));
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'vampaladin.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'vampaladin.json'), JSON.stringify({ bin: 'vampaladin.bin', meshes }, null, 1));
for (const tex of ['muro_pietra.png', 'pietra_grigia.png']) fs.copyFileSync(path.join(UNITY, 'Textures', tex), path.join(OUT, tex));
console.log('statua:', meshes.statua.vertices, 'vertici da', parts.length, 'pezzi:', parts.join(', '));
console.log('altezza statua:', (meshes.statua.max[1] - meshes.statua.min[1]).toFixed(2), 'm');
console.log('arredi:', props.map((p) => `${p} (${meshes[p].vertices}v, h ${(meshes[p].max[1] - meshes[p].min[1]).toFixed(2)})`).join('; '));
console.log('bin:', (offset / 1024).toFixed(0), 'KB');
