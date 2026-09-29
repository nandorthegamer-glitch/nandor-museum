// Reperti della stanza di Angrii City: panchina e lampione a caratteri, Alfonso in posa
// accanto al cabinato (esportato dal gioco, con l'idle), e lo schermo del menu dei
// potenziamenti che li accende uno alla volta.

import * as THREE from 'three';
import { box, sign } from './kit.js';
import { mediaUrl } from './media.js';
import { place, colliderFrom } from './exhibits.js';
import { asciiMaterial, crisp, RAMP } from './ascii.js';
import { T } from './lang.js';

export const ANGRII_TYPES = {
  // panchina da villa comunale: doghe di legno e fianchi di ghisa
  bench(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const wood = asciiMaterial({ color: ex.color || '#d08a48' });
    const iron = asciiMaterial({ color: '#46c070' });
    const L = 1.8;
    for (const z of [-0.2, -0.07, 0.06]) box(g, -L / 2, L / 2, 0.42, 0.46, z - 0.055, z + 0.055, wood); // seduta
    for (const y of [0.62, 0.78]) {
      const s = box(g, -L / 2, L / 2, y - 0.05, y + 0.05, 0.14, 0.18, wood);           // schienale
      s.rotation.x = -0.18;
    }
    for (const x of [-L / 2 + 0.12, L / 2 - 0.12]) {
      box(g, x - 0.03, x + 0.03, 0, 0.42, -0.24, -0.18, iron);   // gamba davanti
      box(g, x - 0.03, x + 0.03, 0, 0.86, 0.14, 0.2, iron);      // gamba dietro e schienale
      box(g, x - 0.03, x + 0.03, 0.38, 0.42, -0.26, 0.2, iron);  // traversa
      box(g, x - 0.035, x + 0.035, 0.44, 0.5, -0.26, 0.02, iron); // bracciolo
    }
    crisp(g);
    colliderFrom(ctx, g, [-L / 2, 0, -0.28], [L / 2, 0, 0.22], 0);
  },

  // lampione: palo verde, braccio, lanterna gialla che fa anche luce vera
  streetlamp(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const pole = asciiMaterial({ color: '#3aa864' });
    const lamp = asciiMaterial({ color: '#ffe27a' });
    const h = ex.height || 3.4;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 10), pole);
    p.position.y = h / 2;
    g.add(p);
    box(g, -0.14, 0.14, 0, 0.35, -0.14, 0.14, pole);                // basamento
    box(g, -0.03, 0.03, h - 0.06, h, -0.55, 0.04, pole);            // braccio verso la stanza (-z, dove guarda)
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 8), lamp);
    head.position.set(0, h - 0.24, -0.55);
    g.add(head);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.16, 8), pole);
    cap.position.set(0, h - 0.02, -0.55);
    g.add(cap);
    crisp(g);
    const light = new THREE.PointLight(0xffd890, ex.light ?? 5, 7, 2);
    light.position.set(0, h - 0.5, -0.55);
    g.add(light);
    colliderFrom(ctx, g, [-0.15, 0, -0.15], [0.15, 0, 0.15], 0);
  },

  // Alfonso in posa (tools: Unity, menu Angri > Museo > Esporta Alfonso in posa):
  // fotogrammi di posizioni e normali, fusi a scorrere sulla durata dell'idle
  alfonso(ctx, ex, frame, pack, room) {
    const g = place(ctx, frame, ex);
    colliderFrom(ctx, g, [-0.3, 0, -0.25], [0.3, 0, 0.25], 0);
    const url = mediaUrl(room.id, ex.src || 'media/alfonso.json');
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((meta) => fetch(mediaUrl(room.id, 'media/' + meta.bin)).then((r) => r.arrayBuffer()).then((bin) => [meta, bin]))
      .then(([meta, bin]) => {
        const { verts, indices, frames } = meta;
        let o = 0;
        const idx = new Uint32Array(bin, o, indices); o += indices * 4;
        const col = new Uint8Array(bin, o, verts * 3); o += Math.ceil((verts * 3) / 4) * 4;
        const pos = [], nor = [];
        for (let f = 0; f < frames; f++) { pos.push(new Float32Array(bin, o, verts * 3)); o += verts * 12; }
        for (let f = 0; f < frames; f++) { nor.push(new Float32Array(bin, o, verts * 3)); o += verts * 12; }
        const geo = new THREE.BufferGeometry();
        const P = new THREE.BufferAttribute(new Float32Array(pos[0]), 3);
        const N = new THREE.BufferAttribute(new Float32Array(nor[0]), 3);
        P.setUsage(THREE.DynamicDrawUsage);
        N.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', P);
        geo.setAttribute('normal', N);
        geo.setAttribute('acol', new THREE.BufferAttribute(col, 3, true));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, asciiMaterial({ vertexColors: true }));
        mesh.frustumCulled = false;
        g.add(crisp(mesh));
        ctx.onCreate(mesh);
        const len = meta.length || 4;
        ctx.updaters.push((t) => {
          const x = ((t % len) / len) * frames;
          const a = Math.floor(x) % frames, b = (a + 1) % frames, k = x - Math.floor(x);
          const pa = pos[a], pb = pos[b], na = nor[a], nb = nor[b];
          const PP = P.array, NN = N.array;
          for (let i = 0; i < PP.length; i++) {
            PP[i] = pa[i] + (pb[i] - pa[i]) * k;
            NN[i] = na[i] + (nb[i] - na[i]) * k;
          }
          P.needsUpdate = N.needsUpdate = true;
        });
      })
      .catch((e) => console.warn('Alfonso non caricato:', e));
  },

  // schermo col menu dei potenziamenti (dati: rooms/angri/media/implants.json, dal gioco):
  // Alfonso vitruviano a caratteri, e un impianto alla volta che si illumina
  augscreen(ctx, ex, frame, pack, room) {
    const g = place(ctx, frame, { ...ex, y: 0 });
    const [w, h] = ex.size || [2.8, 1.575];
    const state = { list: [], i: 0, blink: true };
    const s = sign(ctx, { w, h, x: 0, y: 0, z: 0, face: 0, draw: (c, W, H) => drawAugs(c, W, H, state) });
    g.add(s);
    s.position.set(0, ex.y ?? 1.85, -0.05);
    s.rotation.set(0, Math.PI, 0);
    box(g, -w / 2 - 0.06, w / 2 + 0.06, (ex.y ?? 1.85) - h / 2 - 0.06, (ex.y ?? 1.85) + h / 2 + 0.06, -0.04, 0.02,
      new THREE.MeshLambertMaterial({ color: 0x101512 }));
    fetch(mediaUrl(room.id, ex.src || 'media/implants.json')).then((r) => r.json()).then((list) => {
      state.list = list;
      s.userData.redraw();
    }).catch(() => {});
    let next = 0, blinkAt = 0;
    ctx.updaters.push((t) => {
      if (!state.list.length) return;
      let dirty = false;
      if (t > next) { state.i = (state.i + 1) % state.list.length; next = t + (ex.every || 2.6); dirty = true; }
      if (t > blinkAt) { state.blink = !state.blink; blinkAt = t + 0.45; dirty = true; }
      if (dirty) s.userData.redraw();
    });
  },
};

// --- menu dei potenziamenti ---------------------------------------------------------

// punti del corpo per slot (0 occhi ... 9 stomaco), nel quadrato 0..1 della figura
const PARTS = [
  { at: [0.5, 0.13], draw: (g) => g.fillRect(0.45, 0.115, 0.1, 0.03) },                                  // occhi
  { at: [0.43, 0.14], draw: (g) => { dot(g, 0.425, 0.14, 0.022); dot(g, 0.575, 0.14, 0.022); } },       // orecchie
  { at: [0.5, 0.36], draw: (g) => g.fillRect(0.485, 0.2, 0.03, 0.33) },                                  // schiena
  { at: [0.2, 0.25], draw: (g) => { g.fillRect(0.08, 0.225, 0.17, 0.05); g.fillRect(0.75, 0.225, 0.17, 0.05); } }, // avambracci
  { at: [0.38, 0.75], draw: (g) => { limb(g, 0.43, 0.66, 0.34, 0.9, 0.06); limb(g, 0.57, 0.66, 0.66, 0.9, 0.06); } }, // gambe
  { at: [0.6, 0.24], draw: (g) => { g.fillRect(0.4, 0.2, 0.2, 0.05); g.fillRect(0.39, 0.2, 0.03, 0.3); g.fillRect(0.58, 0.2, 0.03, 0.3); } }, // pelle
  { at: [0.55, 0.4], draw: (g) => g.fillRect(0.515, 0.37, 0.06, 0.05) },                                 // fegato
  { at: [0.46, 0.3], draw: (g) => dot(g, 0.46, 0.3, 0.03) },                                             // cuore
  { at: [0.33, 0.93], draw: (g) => { g.fillRect(0.28, 0.915, 0.08, 0.03); g.fillRect(0.64, 0.915, 0.08, 0.03); } }, // alluce
  { at: [0.5, 0.45], draw: (g) => g.fillRect(0.45, 0.42, 0.1, 0.06) },                                   // stomaco
];
function dot(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function limb(g, x0, y0, x1, y1, w) {
  g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function figure(g) {
  dot(g, 0.5, 0.13, 0.07);                                // testa
  g.fillRect(0.47, 0.19, 0.06, 0.03);                     // collo
  g.fillRect(0.41, 0.21, 0.18, 0.32);                     // busto
  limb(g, 0.42, 0.24, 0.07, 0.25, 0.05);                  // braccia aperte
  limb(g, 0.58, 0.24, 0.93, 0.25, 0.05);
  limb(g, 0.45, 0.52, 0.32, 0.92, 0.07);                  // gambe
  limb(g, 0.55, 0.52, 0.68, 0.92, 0.07);
  g.fillRect(0.27, 0.91, 0.09, 0.035);
  g.fillRect(0.64, 0.91, 0.09, 0.035);
}

// forma disegnata -> griglia di caratteri (copertura di ogni cella -> carattere della rampa)
const gridCache = new Map();
function asciiGrid(key, cols, rows, paint) {
  const k = key + cols + 'x' + rows;
  if (gridCache.has(k)) return gridCache.get(k);
  const S = 4;
  const c = document.createElement('canvas');
  c.width = cols * S;
  c.height = rows * S;
  const g = c.getContext('2d');
  g.scale(c.width, c.height);
  g.fillStyle = g.strokeStyle = '#fff';
  paint(g);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const out = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) sum += d[((y * S + j) * c.width + x * S + i) * 4];
      const cov = sum / (S * S * 255);
      line += cov < 0.06 ? ' ' : RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(cov * (RAMP.length - 1)))];
    }
    out.push(line);
  }
  gridCache.set(k, out);
  return out;
}

function wrap(g, text, maxW) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawAugs(g, W, H, st) {
  const green = '#3dff8a', dim = '#1f6a44', mag = '#ff3bd4', amber = '#ffd060';
  g.fillStyle = '#040806';
  g.fillRect(0, 0, W, H);
  const u = H / 36; // una riga di testo
  g.textBaseline = 'top';
  g.font = `bold ${u * 1.3}px Consolas, monospace`;
  g.fillStyle = green;
  g.fillText('AUGMENTATIONS', u * 1.5, u * 1.2);
  g.font = `${u * 0.9}px Consolas, monospace`;
  g.fillStyle = dim;
  g.fillText('FONZOTOR  //  MUNICIPAL CYBORG PROGRAMME  //  ANGRII CITY', u * 16, u * 1.55);
  g.fillStyle = dim;
  g.fillRect(u * 1.5, u * 3, W - u * 3, 2);
  const list = st.list;
  if (!list.length) return;
  const cur = list[st.i];

  // colonna sinistra: elenco degli impianti
  g.font = `${u * 1.02}px Consolas, monospace`;
  list.forEach((it, k) => {
    const y = u * (4.2 + k * 1.75);
    const on = k === st.i;
    if (on) { g.fillStyle = 'rgba(61,255,138,0.14)'; g.fillRect(u * 1.2, y - u * 0.25, W * 0.34, u * 1.55); }
    g.fillStyle = on ? green : dim;
    const tag = it.secret ? '[?]' : `[${k === st.i ? '■' : ' '}]`;
    g.fillText(`${on ? '>' : ' '} ${tag} ${it.name.toUpperCase()}`, u * 1.5, y);
    if (it.secret) { g.fillStyle = on ? mag : '#6a2458'; g.fillText('SECRET', W * 0.3, y); }
  });

  // al centro-destra: Alfonso vitruviano a caratteri, la parte dell'impianto illuminata
  const cols = 58, rows = 30;
  const side = u * 24; // quadrato della figura (celle strette e alte come i caratteri)
  const fx = W * 0.385, fy = u * 4.5, cw = side / cols, chh = side / rows;
  const base = asciiGrid('fig', cols, rows, (c) => {
    c.lineWidth = 0.008;
    c.beginPath(); c.arc(0.5, 0.5, 0.47, 0, Math.PI * 2); c.stroke(); // cerchio di Leonardo
    c.strokeRect(0.08, 0.06, 0.84, 0.9);                             // e il quadrato
    figure(c);
  });
  const part = asciiGrid('part' + cur.slot, cols, rows, (c) => PARTS[cur.slot]?.draw(c));
  g.font = `bold ${chh * 0.95}px Consolas, monospace`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = part[y][x];
      const ch = p !== ' ' ? p : base[y][x];
      if (ch === ' ') continue;
      g.fillStyle = p !== ' ' ? (st.blink ? mag : amber) : RAMP.indexOf(ch) > 5 ? green : dim;
      g.fillText(ch, fx + x * cw, fy + y * chh);
    }
  }
  // linea dall'elenco alla parte del corpo, come in Deus Ex
  const [px, py] = PARTS[cur.slot]?.at || [0.5, 0.5];
  const ly = u * (4.2 + st.i * 1.75) + u * 0.5;
  const tx = fx + px * cols * cw, ty = fy + py * rows * chh;
  g.strokeStyle = mag;
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(u * 1.5 + W * 0.345, ly); g.lineTo(fx - u, ly); g.lineTo(tx, ty); g.stroke();
  g.fillStyle = mag;
  g.fillRect(tx - 4, ty - 4, 8, 8);

  // colonna destra: scheda dell'impianto
  const bx = W * 0.775, bw = W - bx - u * 1.5;
  g.strokeStyle = green;
  g.strokeRect(bx, u * 4, bw, u * 30);
  g.font = `bold ${u * 1.05}px Consolas, monospace`;
  g.fillStyle = green;
  let y = u * 4.7;
  for (const l of wrap(g, cur.name.toUpperCase(), bw - u * 1.4)) { g.fillText(l, bx + u * 0.7, y); y += u * 1.3; }
  y += u * 0.5;
  g.font = `${u * 0.82}px Consolas, monospace`;
  cur.levels.forEach((lv, k) => {
    g.fillStyle = amber;
    g.fillText(`LEVEL ${k + 1}`, bx + u * 0.7, y); y += u * 1.05;
    g.fillStyle = '#cfe8d8';
    for (const l of wrap(g, lv, bw - u * 1.4)) { g.fillText(l, bx + u * 0.7, y); y += u * 1.0; }
    y += u * 0.5;
  });
  g.fillStyle = dim;
  for (const l of wrap(g, cur.desc, bw - u * 1.4)) { if (y > u * 33) break; g.fillText(l, bx + u * 0.7, y); y += u * 1.0; }
  // riga dei moduli in basso
  g.font = `${u * 0.9}px Consolas, monospace`;
  g.fillStyle = green;
  g.fillText(`MODULES AVAILABLE: 2${st.blink ? '_' : ' '}`, u * 1.5, H - u * 1.8);
  // righe del monitor
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let yy = 0; yy < H; yy += 4) g.fillRect(0, yy, W, 2);
}
