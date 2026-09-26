// Esporta dal progetto Unity di Styx Diner la stanza del museo, senza aprire Unity.
//   - "sala": guscio e arredi della sala da pranzo, TAGLIATI sul piano z = CROP (la sala
//     vera e' lunga 30 m): i triangoli attraversati si spezzano, non si buttano
//   - "cucina": guscio, arredi e oggetti della cucina; la porta con l'oblo' spalancata
//   - "cortile": cortile con mucca, maiale, gallina e orto + un fondale di cielo chiuso
//   - personaggi: "gatto" (la posa "dorme" di CatVisitor.Pose ricostruita), "lax" (la
//     demonessa, posa del prefab: ali spiegate), "crociato" (posa del prefab, senza il
//     cucchiaio), "vecchio" (il mesh con scheletro nella posa del disegno)
// Materiali con texture (copiate in media/), colori, shader PSX Lit/Unlit.
// Coordinate: quelle del diner (sala z > 0, cucina z 0..-5, cortile piu' a sud), convertite
// in three (z cambia segno); i personaggi nel loro spazio locale.
// Uscita: rooms/styx-diner/media/styx.json + styx.bin + texture .png
//
// Uso: node tools/styx-export.mjs

import fs from 'node:fs';
import path from 'node:path';
import { guidIndex, readMesh, readMaterial, readHierarchy, chainTo, trs, mul, apply, IDENTITY } from './unity-yaml.mjs';

const A = 'C:/Users/FERDINANDO/Desktop/JotunnModStub-master/StixDiner/StixDiner/Assets';
const OUT = path.resolve('rooms/styx-diner/media');
const CROP = 11; // la sala tenuta: z da 0 (bancone) a 11 (fra due file di separe')

const guids = guidIndex(A);
const byName = new Map();
for (const [, f] of guids) if (f.endsWith('.asset')) byName.set(path.basename(f, '.asset'), f);

// ---------------------------------------------------------------- materiali

const materials = [];
const matIndex = new Map();
const textures = new Set();
function material(guid) {
  if (matIndex.has(guid)) return matIndex.get(guid);
  const file = guids.get(guid);
  const m = file ? readMaterial(file, guids) : { name: '?', shader: '?', texture: null, color: [1, 0, 1, 1] };
  const tex = m.texture ? path.basename(m.texture) : null;
  if (m.texture) textures.add(m.texture);
  materials.push({
    name: m.name, tex, color: m.color.slice(0, 3).map((v) => +v.toFixed(3)),
    unlit: /Unlit/i.test(m.shader), transparent: m.transparent,
  });
  matIndex.set(guid, materials.length - 1);
  return materials.length - 1;
}
// materiale fatto a mano (fondale del cielo)
function extraMaterial(name, texFile, unlit) {
  textures.add(path.join(A, 'Stix/Textures', texFile));
  materials.push({ name, tex: texFile, color: [1, 1, 1], unlit, transparent: false });
  return materials.length - 1;
}

// ---------------------------------------------------------------- composizione

// Un "oggetto" del pacchetto: pezzi (mesh + matrice + materiali) raccolti per materiale.
class Builder {
  constructor() { this.buckets = new Map(); this.colliders = []; }
  // tri: array di vertici { p, n, uv, c } in coordinate Unity gia' trasformate
  addTri(mat, tri) {
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(tri);
  }
  addMesh(meshFile, m4, matGuids, { clipZ = null } = {}) {
    const mesh = readMesh(meshFile);
    const vert = (i) => {
      const n = apply(m4, [mesh.nor[i * 3], mesh.nor[i * 3 + 1], mesh.nor[i * 3 + 2]], 0);
      const l = Math.hypot(...n) || 1;
      return {
        p: apply(m4, [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]], 1),
        n: n.map((v) => v / l),
        uv: mesh.uv ? [mesh.uv[i * 2], mesh.uv[i * 2 + 1]] : [0, 0],
        c: mesh.col ? [mesh.col[i * 4], mesh.col[i * 4 + 1], mesh.col[i * 4 + 2], mesh.col[i * 4 + 3]] : [1, 1, 1, 1],
      };
    };
    mesh.sub.forEach((s, si) => {
      const mat = material(matGuids[Math.min(si, matGuids.length - 1)]);
      for (let t = s.start; t < s.start + s.count; t += 3) {
        const tri = [vert(mesh.idx[t]), vert(mesh.idx[t + 1]), vert(mesh.idx[t + 2])];
        if (clipZ === null) this.addTri(mat, tri);
        else for (const piece of clipTri(tri, clipZ)) this.addTri(mat, piece);
      }
    });
    return mesh;
  }
}

// taglio col piano z = limit: si tiene z <= limit (Sutherland-Hodgman sul triangolo)
function clipTri(tri, limit) {
  const inside = tri.map((v) => v.p[2] <= limit);
  if (inside.every(Boolean)) return [tri];
  if (!inside.some(Boolean)) return [];
  const lerp = (a, b, k) => ({
    p: a.p.map((x, i) => x + (b.p[i] - x) * k), n: a.n.map((x, i) => x + (b.n[i] - x) * k),
    uv: a.uv.map((x, i) => x + (b.uv[i] - x) * k), c: a.c.map((x, i) => x + (b.c[i] - x) * k),
  });
  const poly = [];
  for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i + 1) % 3];
    if (a.p[2] <= limit) poly.push(a);
    if ((a.p[2] <= limit) !== (b.p[2] <= limit)) poly.push(lerp(a, b, (limit - a.p[2]) / (b.p[2] - a.p[2])));
  }
  const out = [];
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
  return out;
}

// ---------------------------------------------------------------- uscita

const meshes = {};
const chunks = [];
let offset = 0;
function emit(name, b, extra = {}) {
  const pos = [], nor = [], uv = [], col = [], idx = [], groups = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const [mat, tris] of b.buckets) {
    const start = idx.length;
    for (const tri of tris) {
      const base = pos.length / 3;
      for (const v of tri) {
        // Unity -> three: z cambia segno
        pos.push(v.p[0], v.p[1], -v.p[2]); nor.push(v.n[0], v.n[1], -v.n[2]);
        uv.push(v.uv[0], v.uv[1]); col.push(...v.c);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], k === 2 ? -v.p[2] : v.p[k]); max[k] = Math.max(max[k], k === 2 ? -v.p[2] : v.p[k]); }
      }
      idx.push(base, base + 2, base + 1); // triangoli girati
    }
    groups.push({ start, count: idx.length - start, mat });
  }
  const e = { vertices: pos.length / 3, indices: idx.length, min, max, groups, ...extra };
  const put = (key, arr) => { e[key] = offset; chunks.push(Buffer.from(arr.buffer)); offset += arr.byteLength; };
  put('pos', new Float32Array(pos)); put('nor', new Float32Array(nor)); put('col', new Float32Array(col));
  put('idx', new Uint32Array(idx)); put('uv', new Float32Array(uv));
  meshes[name] = e;
  console.log(`${name}: ${e.vertices} vertici, ${groups.length} materiali`);
}

// ---------------------------------------------------------------- scena del diner

const diner = readHierarchy(path.join(A, 'Stix/Scenes/Diner.unity'));
const inBox = (p, x0, x1, z0, z1) => p[0] >= x0 && p[0] <= x1 && p[2] >= z0 && p[2] <= z1;
const sala = new Builder(), cucina = new Builder(), cortile = new Builder(), mucca = new Builder();
const SKIP = /^(Cielo_|Neon_|Insegna|Diner_facciata|Parcheggio|Auto |Lampione|Terreno$|Tetto$)/;
for (const [, g] of diner.gos) {
  if (!g.mesh || !g.transform || g.rendererOn === false) continue;
  const { m, active } = chainTo(diner, g.transform);
  if (!active) continue;
  const file = guids.get(g.mesh);
  const meshName = path.basename(file, '.asset');
  if (SKIP.test(meshName)) continue;
  const at = apply(m, [0, 0, 0], 1);
  if (meshName.startsWith('Sala_')) { sala.addMesh(file, m, g.materials, { clipZ: CROP }); continue; }
  if (meshName.startsWith('Cortile_')) { cortile.addMesh(file, m, g.materials); continue; }
  if (meshName.startsWith('Cucina_') && meshName !== 'Cucina_Fiamma') { cucina.addMesh(file, m, g.materials); continue; }
  // la mucca si esporta da sola, nel suo spazio: nel museo sbircia dalla porta aperta
  if (meshName === 'Mucca') { mucca.addMesh(file, IDENTITY, g.materials); continue; }
  if (meshName === 'Porta_Oblo') {
    // spalancata verso il cortile: cardine nell'origine del pezzo, +x ruota verso -z
    const open = trs([0, 0, 0], [0, Math.sin((95 * Math.PI) / 360), 0, Math.cos((95 * Math.PI) / 360)], [1, 1, 1]);
    cucina.addMesh(file, mul(m, open), g.materials);
    continue;
  }
  if (inBox(at, -0.3, 7.3, -5.3, 0.3)) cucina.addMesh(file, m, g.materials);
  else if (inBox(at, -0.3, 7.3, -12.2, -5.2)) cortile.addMesh(file, m, g.materials);
}

// collisioni della sala: un riquadro per ogni pezzo d'arredo (vertici fusi, componenti
// connesse), in coordinate three. Le lampade appese (in alto) no.
{
  const mesh = readMesh(byName.get('Sala_Arredi'));
  const n = mesh.pos.length / 3;
  const key = (i) => `${Math.round(mesh.pos[i * 3] * 100)},${Math.round(mesh.pos[i * 3 + 1] * 100)},${Math.round(mesh.pos[i * 3 + 2] * 100)}`;
  const w = new Map(), id = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); if (!w.has(k)) w.set(k, w.size); id[i] = w.get(k); }
  const par = [...Array(w.size).keys()];
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const a = find(id[mesh.idx[t]]);
    par[find(id[mesh.idx[t + 1]])] = a; par[find(id[mesh.idx[t + 2]])] = a;
  }
  const boxes = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(id[i]);
    let b = boxes.get(r);
    if (!b) boxes.set(r, (b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }));
    for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], mesh.pos[i * 3 + k]); b.max[k] = Math.max(b.max[k], mesh.pos[i * 3 + k]); }
  }
  for (const b of boxes.values()) {
    if (b.min[2] > CROP || b.max[1] < 0.3 || b.min[1] > 1.5) continue;
    // three: x uguale, z = -z Unity
    sala.colliders.push([b.min[0], -Math.min(b.max[2], CROP), b.max[0], -b.min[2]].map((v) => +v.toFixed(3)));
  }
  // le pareti laterali della sala (il guscio)
  sala.colliders.push([-4.4, -CROP, -4.0, 0], [11.0, -CROP, 11.4, 0]);
}

// fondale del cortile: pareti e "soffitto" di cielo al tramonto, oltre i muri del cortile
{
  const sky = extraMaterial('Cielo_fondale', 'cielo.png', true);
  const quad = (a, b, c, d, uvs) => {
    // tramonto eterno: arancio in basso, viola in alto (nel gioco la cupola usa i colori dei vertici)
    const sunset = (y) => { const k = Math.min(1, y / 9); return [1 - 0.55 * k, 0.55 - 0.35 * k, 0.25 + 0.2 * k, 1]; };
    const v = (p, uv) => ({ p, n: [0, 0, 1], uv, c: sunset(p[1]) });
    cortile.addTri(sky, [v(a, uvs[0]), v(b, uvs[1]), v(c, uvs[2])]);
    cortile.addTri(sky, [v(a, uvs[0]), v(c, uvs[2]), v(d, uvs[3])]);
    cortile.addTri(sky, [v(a, uvs[0]), v(c, uvs[2]), v(b, uvs[1])]); // anche il retro
    cortile.addTri(sky, [v(a, uvs[0]), v(d, uvs[3]), v(c, uvs[2])]);
  };
  const U = [[0, 0.2], [1, 0.2], [1, 0.9], [0, 0.9]];
  quad([-1.5, 0, -13], [8.5, 0, -13], [8.5, 9, -13], [-1.5, 9, -13], U);   // fondo
  quad([-1.5, 0, -5.3], [-1.5, 0, -13], [-1.5, 9, -13], [-1.5, 9, -5.3], U); // ovest
  quad([8.5, 0, -13], [8.5, 0, -5.3], [8.5, 9, -5.3], [8.5, 9, -13], U);     // est
  quad([-1.5, 9, -13], [8.5, 9, -13], [8.5, 9, -5.3], [-1.5, 9, -5.3], [[0, 0.95], [1, 0.95], [1, 1], [0, 1]]);
}

emit('sala', sala, { colliders: sala.colliders });
emit('cucina', cucina);
emit('cortile', cortile);
emit('mucca', mucca);

// ---------------------------------------------------------------- personaggi (prefab)

const Q = {
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  axis: (ax, deg) => { const h = (deg * Math.PI) / 360; return [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)]; },
  // Quaternion.Euler di Unity: prima z, poi x, poi y
  euler: (x, y, z) => Q.mul(Q.axis([0, 1, 0], y), Q.mul(Q.axis([1, 0, 0], x), Q.axis([0, 0, 1], z))),
  // Quaternion.LookRotation(forward, up)
  look: (f, u) => {
    const nz = norm(f);
    const nx = norm(cross(u, nz));
    const ny = cross(nz, nx);
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [nx[0], ny[0], nz[0], nx[1], ny[1], nz[1], nx[2], ny[2], nz[2]];
    const tr = m00 + m11 + m22;
    let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
    return q;
  },
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const scl = (a, k) => a.map((x) => x * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function prefab(file) { return readHierarchy(path.join(A, file)); }
const tOf = (h, name) => [...h.transforms.values()].find((t) => h.gos.get(t.go)?.name === name);
function setLocal(t, p, q) { if (p) t.p = p; if (q) t.q = q; t.local = trs(t.p, t.q, t.s); }
// tutti i mesh attivi del prefab nel suo spazio (radice esclusa)
function exportPrefab(name, h, { skip = () => false, force = () => false } = {}) {
  const b = new Builder();
  const root = [...h.transforms.values()].find((t) => !h.transforms.has(t.father));
  for (const [, g] of h.gos) {
    if (!g.mesh || !g.transform || skip(g.name)) continue;
    const { m, active } = chainTo(h, g.transform, root.id);
    if (!active && !force(g.name)) continue;
    b.addMesh(guids.get(g.mesh), m, g.materials);
  }
  emit(name, b);
}

// --- il gatto che dorme: CatVisitor.Pose con curl = 1, walk = drink = 0, t = 0 ---
{
  const h = prefab('Stix/NPC/Carissimo.prefab');
  const doc = [...h.docs.values()].find((d) => d.cls === 114 && /legs:/.test(d.body)).body;
  const fid = (key) => doc.match(new RegExp(key + ': \\{fileID: (\\d+)'))[1];
  const body = h.transforms.get(fid('body'));
  const head = h.transforms.get(fid('head'));
  setLocal(body, [0, 0.1, -0.05], Q.euler(4, 0, 0));            // basso e piatto sul bancone
  setLocal(head, null, Q.euler(30, 0, 12));                      // appoggiata sulle zampe
  const tail = [...doc.slice(doc.indexOf('tail:'), doc.indexOf('legs:')).matchAll(/fileID: (\d+)/g)].map((m) => h.transforms.get(m[1]));
  for (const t of tail) setLocal(t, null, Q.euler(0, 26, 0));    // arrotolata attorno a lui
  const bodyM = trs(body.p, body.q, body.s);
  const legBlocks = doc.slice(doc.indexOf('legs:')).split('- upper:').slice(1);
  for (const lb of legBlocks) {
    const g = (k) => lb.match(new RegExp(k + ': \\{fileID: (\\d+)'))?.[1];
    const v = (k) => { const m = lb.match(new RegExp(k + ': \\{x: ([-\\d.e]+), y: ([-\\d.e]+), z: ([-\\d.e]+)\\}')); return m.slice(1).map(Number); };
    const up = h.transforms.get(lb.match(/^ \{fileID: (\d+)/)[1]);
    const low = h.transforms.get(g('lower')), paw = h.transforms.get(g('paw'));
    const root = v('root'), rest = v('rest');
    const a = +lb.match(/upperLength: ([\d.]+)/)[1], bl = +lb.match(/lowerLength: ([\d.]+)/)[1];
    const back = /backwards: 1/.test(lb);
    let foot = [rest[0] * 0.5, 0.02, rest[2] * 0.75 + (back ? 0.04 : -0.02)];
    const hip = apply(bodyM, root, 1);
    const hint = add(back ? [0, 0, -1] : [0, 0, 1], [0.2 * Math.sign(rest[0]), 0, 0]);
    // CatVisitor.Knee
    const d = sub(foot, hip);
    const dist0 = Math.hypot(...d);
    const dir = dist0 > 1e-4 ? scl(d, 1 / dist0) : [0, -1, 0];
    const dist = Math.min(a + bl - 0.001, Math.max(Math.abs(a - bl) + 0.005, dist0));
    foot = add(hip, scl(dir, dist));
    const x = (a * a - bl * bl + dist * dist) / (2 * dist);
    const hh = Math.sqrt(Math.max(0, a * a - x * x));
    let bend = sub(hint, scl(dir, dot(hint, dir)));
    bend = Math.hypot(...bend) > 1e-3 ? norm(bend) : [0, 0, 1];
    const knee = add(add(hip, scl(dir, x)), scl(bend, hh));
    // CatVisitor.Along: LookRotation(cross(right, dir), dir)
    const along = (dv) => { let f = cross([1, 0, 0], dv); if (Math.hypot(...f) < 1e-3) f = [0, 0, 1]; return Q.look(norm(f), dv); };
    setLocal(up, hip, along(norm(sub(knee, hip))));
    setLocal(low, knee, along(norm(sub(foot, knee))));
    if (paw) setLocal(paw, foot, [0, 0, 0, 1]);
  }
  // occhi chiusi (in gioco si accendono col sonno), la Z del sonno sopra la testa
  const zeta = tOf(h, 'Gatto_Zeta');
  const sonno = chainTo(h, tOf(h, 'Sonno').id, [...h.transforms.values()].find((t) => !h.transforms.has(t.father)).id);
  setLocal(zeta, add(apply(sonno.m, [0, 0, 0], 1), [0.04, 0.1, 0]), null);
  zeta.father = [...h.transforms.values()].find((t) => !h.transforms.has(t.father)).id;
  exportPrefab('gatto', h, { force: (n) => n === 'Gatto_Occhi_chiusi' || n === 'Gatto_Zeta', skip: (n) => n === 'Gatto_Lingua' || n === 'Aperto' });
}

exportPrefab('lax', prefab('Stix/NPC/LaxIra.prefab'), { skip: (n) => n === 'Lax_Bacio' });
exportPrefab('crociato', prefab('Stix/NPC/Crociato.prefab'), { skip: (n) => n === 'Crociato_Cucchiaio' });

// il Vecchio: mesh con scheletro, nella posa in cui e' costruito (quella del disegno)
{
  const b = new Builder();
  const mat = [...guids.entries()].find(([, f]) => f.endsWith(path.join('Generati', 'OldMan.mat')))[0];
  b.addMesh(path.join(A, 'NPC/OldMan/Generati/OldMan_mesh.asset'), IDENTITY, [mat]);
  emit('vecchio', b);
}

// ---------------------------------------------------------------- file

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'styx.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'styx.json'), JSON.stringify({ bin: 'styx.bin', crop: CROP, materials, meshes }, null, 1));
for (const t of textures) fs.copyFileSync(t, path.join(OUT, path.basename(t)));
for (const [from, to] of [
  [path.join(A, 'NPC/OldMan/Disegno/npc1.jpg'), 'artwork-vecchio.jpg'],
  ['C:/Users/FERDINANDO/Pictures/Screenshots/crociato.jpg', 'artwork-crociato.jpg'],
]) fs.copyFileSync(from, path.join(OUT, to));
console.log(`materiali ${materials.length}, texture ${textures.size}, bin ${(offset / 1024).toFixed(0)} KB`);
