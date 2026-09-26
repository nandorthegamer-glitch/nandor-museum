// Esporta dal progetto Unity di Angri il plastico della citta' per la stanza del museo,
// senza aprire Unity (legge i Mesh .asset e la Texture2D della minimappa, YAML testuale).
//
// Gli edifici in Unity sono ~400.000 vertici (muri spezzati per piano e campata, per la
// luce per vertice): troppi per il web. Qui si RICOSTRUISCONO: i tetti sono piatti, quindi i
// triangoli rivolti in alto sopra il terreno sono gia' la sagoma di ogni edificio alla sua
// altezza vera; i loro bordi si estrudono fino a terra. Stessa forma, molti meno vertici.
//   - "terreno": griglia ricampionata ogni 8 m, con UV sulla minimappa
//   - "edifici": muri e tetti; chiese (rosse sulla minimappa) in rosso mattone
//   - "alberi": un cono per albero (in Unity sono billboard: nel mesh resta solo il piede)
//   - minimappa.png: la texture della minimappa del gioco (suoli, edifici, chiese)
// Uscita: rooms/angri/media/angri.json + angri.bin + minimappa.png
// Assi: Unity x est, z nord -> three x est, z SUD (z cambia segno, triangoli girati).
//
// Uso: node tools/angri-export.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const GEN = 'C:/Users/FERDINANDO/Desktop/JotunnModStub-master/Angri/Gioco/Angri/Assets/Angri/Generated';
const OUT = path.resolve('rooms/angri/media');
const HALF = 400;           // AngriImportSettings.halfSize
const GRID = 8;             // passo del terreno esportato (m)
const MIN_ROOF_AREA = 6;    // m2: sotto sono lampioni, fontane, panchine
const MIN_ROOF_HEIGHT = 2.2; // m sopra il terreno

// ---------------------------------------------------------------- lettura

function readMesh(file) {
  const t = fs.readFileSync(file, 'utf8');
  const num = (re) => Number(t.match(re)[1]);
  const vcount = num(/m_VertexCount: (\d+)/);
  const size = num(/m_DataSize: (\d+)/);
  const data = Buffer.from(t.match(/_typelessdata: ([0-9a-f]*)/)[1], 'hex');
  const idx32 = num(/m_IndexFormat: (\d+)/) === 1;
  const ib = Buffer.from(t.match(/m_IndexBuffer: ([0-9a-f]*)/)[1], 'hex');
  const block = t.slice(t.indexOf('m_Channels:'), t.indexOf('m_DataSize'));
  const ch = [...block.matchAll(/offset: (\d+)\s+format: (\d+)\s+dimension: (\d+)/g)].map((m) => ({ offset: +m[1], dim: +m[3] }));
  if ([...t.matchAll(/baseVertex: (\d+)/g)].some((m) => m[1] !== '0')) throw new Error(file + ': baseVertex non nullo');
  const stride = size / vcount;
  const pos = new Float32Array(vcount * 3);
  for (let i = 0; i < vcount; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = data.readFloatLE(i * stride + ch[0].offset + k * 4);
  const n = ib.length / (idx32 ? 4 : 2);
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = idx32 ? ib.readUInt32LE(i * 4) : ib.readUInt16LE(i * 2);
  return { pos, idx };
}

function readTexture(file) {
  const t = fs.readFileSync(file, 'utf8');
  const w = +t.match(/m_Width: (\d+)/)[1], h = +t.match(/m_Height: (\d+)/)[1];
  if (+t.match(/m_TextureFormat: (\d+)/)[1] !== 4) throw new Error('minimappa: attesa RGBA32');
  const data = Buffer.from(t.match(/_typelessdata: ([0-9a-f]*)/)[1], 'hex');
  return { w, h, data }; // riga 0 = sud
}

const files = (prefix) => fs.readdirSync(GEN).filter((f) => f.startsWith(prefix) && f.endsWith('.asset')).map((f) => path.join(GEN, f));

// ---------------------------------------------------------------- minimappa

const map = readTexture(path.join(GEN, 'minimappa.asset'));
// colore della minimappa in un punto (coordinate Unity x, z)
function mapColor(x, z) {
  const i = Math.min(map.w - 1, Math.max(0, Math.floor(((x + HALF) / (2 * HALF)) * map.w)));
  const j = Math.min(map.h - 1, Math.max(0, Math.floor(((z + HALF) / (2 * HALF)) * map.h)));
  const o = (j * map.w + i) * 4;
  return [map.data[o], map.data[o + 1], map.data[o + 2]];
}
const isChurch = ([r, g, b]) => r === 200 && g === 110 && b === 84; // colore delle chiese in SaveMinimap

function writePng(file, w, h, rgbaRows) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgbaRows(y).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------- terreno

// quota del terreno: media dei vertici per cella di 4 m, buchi riempiti dai vicini
const HC = 4, HN = Math.ceil((2 * (HALF + 40)) / HC);
const hSum = new Float64Array(HN * HN), hCnt = new Uint32Array(HN * HN);
let minGround = Infinity;
for (const f of files('Terreno_')) {
  const { pos } = readMesh(f);
  for (let i = 0; i < pos.length; i += 3) {
    const ci = Math.floor((pos[i] + HALF + 40) / HC), cj = Math.floor((pos[i + 2] + HALF + 40) / HC);
    if (ci < 0 || cj < 0 || ci >= HN || cj >= HN) continue;
    hSum[cj * HN + ci] += pos[i + 1]; hCnt[cj * HN + ci]++;
  }
}
const hGrid = new Float32Array(HN * HN).fill(NaN);
for (let k = 0; k < hGrid.length; k++) if (hCnt[k]) hGrid[k] = hSum[k] / hCnt[k];
for (let pass = 0; pass < 20; pass++) {
  let holes = 0;
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    if (!Number.isNaN(hGrid[j * HN + i])) continue;
    let s = 0, c = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = hGrid[(j + dj) * HN + i + di];
      if (i + di >= 0 && j + dj >= 0 && i + di < HN && j + dj < HN && !Number.isNaN(v)) { s += v; c++; }
    }
    if (c) hGrid[j * HN + i] = s / c; else holes++;
  }
  if (!holes) break;
}
function groundAt(x, z) {
  const fx = (x + HALF + 40) / HC - 0.5, fz = (z + HALF + 40) / HC - 0.5;
  const i = Math.max(0, Math.min(HN - 2, Math.floor(fx))), j = Math.max(0, Math.min(HN - 2, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
  const g = (a, b) => hGrid[(j + b) * HN + i + a];
  return (g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v;
}

// ---------------------------------------------------------------- uscita

const meshes = {};
const chunks = [];
let offset = 0;
// pos in coordinate Unity; z cambia segno e i triangoli si girano. base = quota sottratta
function addMesh(name, { pos, nor, col, uv, idx }, base) {
  const P = new Float32Array(pos.length), N = new Float32Array(nor.length);
  for (let i = 0; i < pos.length; i += 3) {
    P[i] = pos[i]; P[i + 1] = pos[i + 1] - base; P[i + 2] = -pos[i + 2];
    N[i] = nor[i]; N[i + 1] = nor[i + 1]; N[i + 2] = -nor[i + 2];
  }
  const I = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i += 3) { I[i] = idx[i]; I[i + 1] = idx[i + 2]; I[i + 2] = idx[i + 1]; }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  const e = { vertices: P.length / 3, indices: I.length, min, max };
  const put = (key, arr) => { e[key] = offset; chunks.push(Buffer.from(arr.buffer)); offset += arr.byteLength; };
  put('pos', P); put('nor', N); put('col', new Float32Array(col)); put('idx', I);
  if (uv) put('uv', new Float32Array(uv));
  meshes[name] = e;
}

// terreno esportato: griglia ogni GRID metri su +-HALF
{
  const n = (2 * HALF) / GRID + 1;
  const pos = [], nor = [], col = [], uv = [], idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -HALF + i * GRID, z = -HALF + j * GRID;
    const y = groundAt(x, z);
    minGround = Math.min(minGround, y);
    const dx = groundAt(x + 1, z) - groundAt(x - 1, z), dz = groundAt(x, z + 1) - groundAt(x, z - 1);
    const l = Math.hypot(dx, 2, dz);
    pos.push(x, y, z); nor.push(-dx / l, 2 / l, -dz / l); col.push(1, 1, 1, 1);
    uv.push(i / (n - 1), j / (n - 1)); // v = 0 a sud, come la riga 0 della minimappa
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const v = j * n + i;
    idx.push(v, v + n, v + 1, v + 1, v + n, v + n + 1);
  }
  var terrain = { pos, nor, col, uv, idx };
}

// edifici: tetti piatti (rivolti in alto, sopra il terreno) + muri estrusi dai loro bordi
const B = { pos: [], nor: [], col: [], idx: [] };
let roofCount = 0, churchCount = 0, dropped = 0;
const WALL = [0.74, 0.7, 0.63], ROOF = [0.6, 0.57, 0.52];
const BRICK_WALL = [0.74, 0.42, 0.32], BRICK_ROOF = [0.62, 0.34, 0.26];
for (const f of files('Edifici_')) {
  const { pos, idx } = readMesh(f);
  // vertici fusi per posizione (i muri sono spezzati: servono i vertici condivisi)
  const key = (i) => `${Math.round(pos[i * 3] * 50)},${Math.round(pos[i * 3 + 1] * 50)},${Math.round(pos[i * 3 + 2] * 50)}`;
  const weld = new Map(), wid = new Uint32Array(pos.length / 3);
  for (let i = 0; i < wid.length; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, weld.size); wid[i] = weld.get(k); }
  const roofTris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const p = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const A = p(a), Bv = p(b), C = p(c);
    const u = [Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n);
    if (len < 1e-6) continue;
    // Unity e' sinistrorso: un triangolo "davanti" verso l'alto ha normale (u x w) con y < 0
    if (Math.abs(n[1] / len) < 0.95) continue;
    const cx = (A[0] + Bv[0] + C[0]) / 3, cy = (A[1] + Bv[1] + C[1]) / 3, cz = (A[2] + Bv[2] + C[2]) / 3;
    if (cy - groundAt(cx, cz) < MIN_ROOF_HEIGHT) continue;
    roofTris.push({ v: [a, b, c], w: [wid[a], wid[b], wid[c]], area: len / 2, cx, cz });
  }
  // gruppi di triangoli di tetto connessi (union-find sui vertici fusi)
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const t of roofTris) for (const x of t.w) if (!parent.has(x)) parent.set(x, x);
  for (const t of roofTris) { const r = find(t.w[0]); parent.set(find(t.w[1]), r); parent.set(find(t.w[2]), find(t.w[0])); }
  const groups = new Map();
  for (const t of roofTris) { const r = find(t.w[0]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
  for (const tris of groups.values()) {
    const area = tris.reduce((s, t) => s + t.area, 0);
    if (area < MIN_ROOF_AREA) { dropped++; continue; }
    roofCount++;
    const cx = tris.reduce((s, t) => s + t.cx * t.area, 0) / area, cz = tris.reduce((s, t) => s + t.cz * t.area, 0) / area;
    const church = isChurch(mapColor(cx, cz));
    if (church) churchCount++;
    const roofCol = church ? BRICK_ROOF : ROOF, wallCol = church ? BRICK_WALL : WALL;
    const base = B.pos.length / 3;
    const local = new Map(); // indice originale -> indice nuovo (vertici del tetto)
    for (const t of tris) {
      for (const v of t.v) {
        if (local.has(v)) continue;
        local.set(v, B.pos.length / 3);
        B.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); B.nor.push(0, 1, 0); B.col.push(...roofCol, 1);
      }
      B.idx.push(local.get(t.v[0]), local.get(t.v[1]), local.get(t.v[2]));
    }
    // bordi: lati usati da un solo triangolo del gruppo
    const edges = new Map();
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const a = t.v[k], b = t.v[(k + 1) % 3];
      const wa = wid[a], wb = wid[b];
      const ek = wa < wb ? `${wa},${wb}` : `${wb},${wa}`;
      const e = edges.get(ek);
      if (e) e.count++; else edges.set(ek, { a, b, count: 1 });
    }
    for (const { a, b, count } of edges.values()) {
      if (count !== 1) continue;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const ga = groundAt(ax, az) - 0.5, gb = groundAt(bx, bz) - 0.5;
      // normale del muro: perpendicolare al lato, verso l'esterno (i triangoli del tetto
      // girano coerenti, quindi l'esterno sta sempre dallo stesso lato del lato a->b)
      let nx = bz - az, nz = -(bx - ax);
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const v0 = B.pos.length / 3;
      B.pos.push(ax, ay, az, bx, by, bz, bx, gb, bz, ax, ga, az);
      for (let k = 0; k < 4; k++) { B.nor.push(nx, 0, nz); B.col.push(...wallCol, 1); }
      // entrambe le facce: il verso del lato non e' garantito su ogni tetto
      B.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    }
    void base;
  }
}

// alberi: un cono a 5 lati per ogni piede di billboard
const T = { pos: [], nor: [], col: [], idx: [] };
const seen = new Set();
let treeCount = 0;
for (const f of files('Alberi_')) {
  const { pos } = readMesh(f);
  for (let i = 0; i < pos.length; i += 3) {
    const k = `${Math.round(pos[i] * 10)},${Math.round(pos[i + 2] * 10)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    treeCount++;
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const h = 3.5 + ((treeCount * 37) % 3), r = 2.8; // bassi: sul plastico c'e' l'esagerazione verticale
    const shade = 0.8 + ((treeCount * 13) % 5) * 0.06;
    const v0 = T.pos.length / 3;
    T.pos.push(x, y + h, z); T.nor.push(0, 1, 0); T.col.push(0.22 * shade, 0.42 * shade, 0.2 * shade, 1);
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      T.pos.push(x + Math.cos(a) * r, y + 1, z + Math.sin(a) * r);
      T.nor.push(Math.cos(a) * 0.8, 0.5, Math.sin(a) * 0.8);
      T.col.push(0.16 * shade, 0.32 * shade, 0.15 * shade, 1);
    }
    for (let s = 0; s < 5; s++) T.idx.push(v0, v0 + 1 + ((s + 1) % 5), v0 + 1 + s);
  }
}

addMesh('terreno', terrain, minGround);
addMesh('edifici', B, minGround);
addMesh('alberi', T, minGround);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'angri.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'angri.json'), JSON.stringify({ bin: 'angri.bin', half: HALF, meshes }, null, 1));
// minimappa: in PNG la prima riga e' in alto = nord (in Unity la riga 0 e' a sud)
writePng(path.join(OUT, 'minimappa.png'), map.w, map.h, (y) => map.data.subarray((map.h - 1 - y) * map.w * 4, (map.h - y) * map.w * 4));

console.log(`edifici: ${roofCount} tetti (${churchCount} chiese), scartati ${dropped} pezzetti; ${meshes.edifici.vertices} vertici`);
console.log(`terreno: ${meshes.terreno.vertices} vertici, quota minima ${minGround.toFixed(1)} m, dislivello ${(meshes.terreno.max[1]).toFixed(1)} m`);
console.log(`alberi: ${treeCount}; bin ${(offset / 1024).toFixed(0)} KB`);
