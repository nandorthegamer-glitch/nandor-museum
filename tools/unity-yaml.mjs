// Lettura dei file di un progetto Unity salvati in YAML testuale, senza aprire Unity:
// mesh (.asset), scene e prefab (gerarchia, MeshFilter, MeshRenderer), materiali (.mat).
// Usato dai convertitori per le stanze del museo (tools/*-export.mjs).

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- guid -> file

export function guidIndex(assetsDir) {
  const map = new Map();
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.meta')) {
        const m = fs.readFileSync(p, 'utf8').match(/guid: (\w+)/);
        if (m) map.set(m[1], p.slice(0, -5));
      }
    }
  })(assetsDir);
  return map;
}

// ---------------------------------------------------------------- mesh

// { pos, nor, uv, col, idx, sub: [{ start, count }] } (indici gia' assoluti)
export function readMesh(file) {
  const t = fs.readFileSync(file, 'utf8');
  const num = (re) => Number(t.match(re)[1]);
  const vcount = num(/m_VertexCount: (\d+)/);
  const size = num(/m_DataSize: (\d+)/);
  const data = Buffer.from(t.match(/_typelessdata: ([0-9a-f]*)/)[1], 'hex');
  const idx32 = num(/m_IndexFormat: (\d+)/) === 1;
  const ib = Buffer.from(t.match(/m_IndexBuffer: ([0-9a-f]*)/)[1], 'hex');
  const block = t.slice(t.indexOf('m_Channels:'), t.indexOf('m_DataSize'));
  const ch = [...block.matchAll(/stream: (\d+)\s+offset: (\d+)\s+format: (\d+)\s+dimension: (\d+)/g)]
    .map((m) => ({ stream: +m[1], offset: +m[2], format: +m[3], dim: +m[4] }));
  // canali letti: 0 posizione, 1 normale, 3 colore, 4 uv (devono essere float); gli altri
  // (tangenti, pesi e indici delle ossa...) contano solo per la larghezza degli stream
  for (const i of [0, 1, 3, 4]) if (ch[i].dim && ch[i].format !== 0) throw new Error(file + ': canale ' + i + ' non float');
  const FORMAT_SIZE = [4, 2, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4];
  const strides = [];
  for (const c of ch) if (c.dim) strides[c.stream] = Math.max(strides[c.stream] || 0, c.offset + c.dim * FORMAT_SIZE[c.format]);
  // gli stream stanno uno dopo l'altro, ognuno allineato a 16 byte
  const starts = [];
  let at = 0;
  for (let s = 0; s < strides.length; s++) {
    starts[s] = at;
    at += (strides[s] || 0) * vcount;
    at = Math.ceil(at / 16) * 16;
  }
  if (strides.length === 1 && strides[0] * vcount !== size) throw new Error(file + ': dimensione vertici inattesa');
  const read = (c, n, fill) => {
    const out = new Float32Array(vcount * n);
    for (let i = 0; i < vcount; i++) for (let k = 0; k < n; k++) {
      out[i * n + k] = c.dim > k ? data.readFloatLE(starts[c.stream] + i * strides[c.stream] + c.offset + k * 4) : fill;
    }
    return out;
  };
  const pos = read(ch[0], 3, 0);
  const nor = read(ch[1], 3, 0);
  const col = ch[3].dim ? read(ch[3], 4, 1) : null;
  const uv = ch[4].dim ? read(ch[4], 2, 0) : null;
  const n = ib.length / (idx32 ? 4 : 2);
  const all = new Uint32Array(n);
  for (let i = 0; i < n; i++) all[i] = idx32 ? ib.readUInt32LE(i * 4) : ib.readUInt16LE(i * 2);
  const subBlock = t.slice(t.indexOf('m_SubMeshes:'), t.indexOf('m_Shapes:'));
  const sub = [...subBlock.matchAll(/firstByte: (\d+)\s+indexCount: (\d+)\s+topology: \d+\s+baseVertex: (\d+)/g)]
    .map((m) => ({ start: +m[1] / (idx32 ? 4 : 2), count: +m[2], base: +m[3] }));
  for (const s of sub) if (s.base) for (let i = s.start; i < s.start + s.count; i++) all[i] += s.base;
  return { pos, nor, uv, col, idx: all, sub, name: (t.match(/m_Name: (.*)/) || [])[1]?.trim() };
}

// ---------------------------------------------------------------- materiale

// { name, shader (nome file), texture (percorso png o null), color [r,g,b,a], transparent }
export function readMaterial(file, guids) {
  const t = fs.readFileSync(file, 'utf8');
  const shaderGuid = (t.match(/m_Shader: \{fileID: \d+, guid: (\w+)/) || [])[1];
  const shader = shaderGuid && guids.get(shaderGuid) ? path.basename(guids.get(shaderGuid), '.shader') : 'builtin';
  const tex = (name) => {
    const m = t.match(new RegExp(`- ${name}:\\s+m_Texture: \\{fileID: \\d+, guid: (\\w+)`));
    return m && guids.get(m[1]) ? guids.get(m[1]) : null;
  };
  const color = (name) => {
    const m = t.match(new RegExp(`- ${name}: \\{r: ([-\\d.e]+), g: ([-\\d.e]+), b: ([-\\d.e]+), a: ([-\\d.e]+)\\}`));
    return m ? m.slice(1).map(Number) : null;
  };
  const float = (name) => { const m = t.match(new RegExp(`- ${name}: ([-\\d.e]+)`)); return m ? +m[1] : null; };
  return {
    name: t.match(/m_Name: (.*)/)[1].trim(),
    shader,
    texture: tex('_BaseMap') || tex('_MainTex'),
    color: color('_BaseColor') || color('_Color') || [1, 1, 1, 1],
    emission: color('_EmissionColor'),
    transparent: /Transparent/i.test(shader) || float('_Surface') === 1,
  };
}

// ---------------------------------------------------------------- scena / prefab

export function readHierarchy(file) {
  const text = fs.readFileSync(file, 'utf8');
  const docs = new Map();
  for (const part of text.split(/\n--- !u!/).slice(1)) {
    const h = part.match(/^(\d+) &(-?\d+)/);
    docs.set(h[2], { cls: +h[1], body: part });
  }
  const vec = (s, key) => {
    const m = s.match(new RegExp(key + ': \\{x: ([-\\d.e]+), y: ([-\\d.e]+), z: ([-\\d.e]+)(?:, w: ([-\\d.e]+))?\\}'));
    return m ? m.slice(1).filter((v) => v !== undefined).map(Number) : null;
  };
  const ref = (s, key) => (s.match(new RegExp(key + ': \\{fileID: (-?\\d+)')) || [])[1];
  const gos = new Map();
  for (const [id, d] of docs) {
    // gli oggetti 'stripped' delle varianti di prefab non hanno nome
    if (d.cls === 1) gos.set(id, { id, name: (d.body.match(/m_Name: (.*)/) || [])[1]?.trim() ?? '', active: !/m_IsActive: 0/.test(d.body) });
  }
  const transforms = new Map();
  for (const [id, d] of docs) {
    if (d.cls === 4) {
      const go = ref(d.body, 'm_GameObject');
      const t = { id, go, father: ref(d.body, 'm_Father'), p: vec(d.body, 'm_LocalPosition'), q: vec(d.body, 'm_LocalRotation'), s: vec(d.body, 'm_LocalScale') };
      transforms.set(id, t);
      if (gos.has(go)) gos.get(go).transform = id;
    }
    if (d.cls === 33) {
      const go = gos.get(ref(d.body, 'm_GameObject'));
      const g = (d.body.match(/m_Mesh: \{fileID: \d+, guid: (\w+)/) || [])[1];
      if (go && g) go.mesh = g;
    }
    if (d.cls === 23 || d.cls === 137) {
      const go = gos.get(ref(d.body, 'm_GameObject'));
      if (!go) continue;
      go.materials = [...d.body.matchAll(/- \{fileID: \d+, guid: (\w+), type: 2\}/g)].map((m) => m[1]);
      go.rendererOn = !/m_Enabled: 0/.test(d.body);
    }
  }
  return { gos, transforms, docs };
}

// matrice 4x4 (colonne) da posizione, quaternione, scala
export function trs(p, q, s) {
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
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export const apply = (m, v, w) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// matrice di un transform fino a (esclusa) la radice rootT; attivo se tutta la catena lo e'
export function chainTo(h, tid, rootT = null) {
  let m = IDENTITY, active = true, t = tid, under = rootT === null;
  while (t && t !== '0') {
    if (t === rootT) { under = true; break; }
    const tr = h.transforms.get(t);
    if (!tr) break;
    tr.local ??= trs(tr.p, tr.q, tr.s);
    m = mul(tr.local, m);
    active = active && (h.gos.get(tr.go)?.active ?? true);
    t = tr.father;
  }
  return { m, active, under };
}
