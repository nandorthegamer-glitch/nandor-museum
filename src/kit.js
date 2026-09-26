// Kit di costruzione: box, pavimenti/soffitti, muri con aperture, cartelli.
// ctx = { group, colliders, doors, mats }. Collider = { minX, maxX, minZ, maxZ }.

import * as THREE from 'three';
import { onLang } from './lang.js';
import { CRISP } from './psx.js';
import { makeTextures, worldUV, TILE } from './textures.js';

export const WALL_T = 0.2;

// Orientamenti per i piani (cartelli): verso dove guarda la faccia
export const FACE = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

// Materiali con texture: userData.tile dice a box() quanto e' grande la piastrella
export function makeMats() {
  const tex = makeTextures();
  const lam = (name, color = 0xffffff) => {
    const glow = tex[name + 'Glow'];
    const m = new THREE.MeshLambertMaterial({ color, map: tex[name], ...(glow && { emissiveMap: glow, emissive: 0xffffff }) });
    m.userData.tile = TILE[name];
    return m;
  };
  const tinted = new Map();
  return {
    wall: lam('wall'),
    floor: lam('floor'),
    ceil: lam('ceil'),
    door: lam('door'),
    trim: lam('trim'),
    hazard: lam('hazard'),
    // muro velato dal colore della stanza (ogni stanza ha UN colore suo)
    roomWall: (c) => {
      if (!tinted.has(c)) tinted.set(c, lam('wall', new THREE.Color(0xffffff).lerp(new THREE.Color(c), 0.22)));
      return tinted.get(c);
    },
    glow: (c) => new THREE.MeshBasicMaterial({ color: c }),
  };
}

export function box(parent, x0, x1, y0, y1, z0, z1, mat) {
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const m = new THREE.Mesh(geo, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  if (mat.userData.tile) worldUV(geo, m.position, mat.userData.tile);
  parent.add(m);
  return m;
}

export function solid(ctx, x0, x1, y0, y1, z0, z1, mat) {
  ctx.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
  return box(ctx.group, x0, x1, y0, y1, z0, z1, mat);
}

// Pavimento a y = 0 e soffitto a y = h sul rettangolo dato
export function slab(ctx, x0, x1, z0, z1, h, mats = ctx.mats) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
  box(ctx.group, ax, bx, -0.1, 0, az, bz, mats.floor);
  box(ctx.group, ax, bx, h, h + 0.1, az, bz, mats.ceil);
}

// Muro che corre lungo `axis` ('x' o 'z') alla coordinata fissa `at` sull'altro asse,
// da `from` a `to`, alto h. openings: [{ c, w, h, y0 }] = centro, larghezza, altezza
// del vano, davanzale (default 0 = porta). Un vano con davanzale e' una finestra:
// si vede attraverso ma non si passa.
export function wall(ctx, axis, at, from, to, h, openings = [], mat = ctx.mats.wall) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const t = WALL_T / 2;
  const piece = (a, b, y0, y1, isSolid) => {
    if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
    if (axis === 'x') box(ctx.group, a, b, y0, y1, at - t, at + t, mat);
    else box(ctx.group, at - t, at + t, y0, y1, a, b, mat);
    if (!isSolid) return;
    ctx.colliders.push(axis === 'x'
      ? { minX: a, maxX: b, minZ: at - t, maxZ: at + t }
      : { minX: at - t, maxX: at + t, minZ: a, maxZ: b });
  };
  const ops = openings
    .map((o) => ({ a: o.c - o.w / 2, b: o.c + o.w / 2, h: o.h, y0: o.y0 || 0 }))
    .sort((p, q) => p.a - q.a);
  let cur = lo;
  for (const o of ops) {
    piece(cur, o.a, 0, h, true);
    piece(o.a, o.b, o.h, h, false); // architrave sopra il vano
    if (o.y0 > 0) piece(o.a, o.b, 0, o.y0, true); // davanzale: blocca tutta la finestra
    cur = o.b;
  }
  piece(cur, hi, 0, h, true);
}

// Cartello: piano con una texture disegnata su canvas, ridisegnata al cambio lingua.
// draw(g, W, H) disegna nel canvas; il piano e' largo w e alto h metri.
// I cartelli stanno sul layer CRISP: fuori dallo strato PS1, nitidi e fermi.
export function sign(ctx, { w, h, x, y, z, face, draw }) {
  const ppm = Math.min(320, 2048 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ppm);
  canvas.height = Math.round(h * ppm);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8; // leggibili anche di sbieco
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = face;
  mesh.layers.set(CRISP);
  ctx.group.add(mesh);
  const redraw = () => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    draw(g, canvas.width, canvas.height);
    tex.needsUpdate = true;
  };
  mesh.userData.redraw = redraw; // per i cartelli che cambiano (es. dati caricati dopo)
  onLang(redraw);
  return mesh;
}

// Righe di testo centrate. lines: [{ text, size (frazione di H), color, bold }]
// Una riga troppo lunga va a capo invece di rimpicciolirsi; solo una parola che da
// sola non ci sta viene ridotta.
export function drawLines(g, W, H, lines, { bg = '#0e0a18', border = null } = {}) {
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(2, H * 0.03);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
  }
  const maxW = W * 0.88;
  const font = (l, px) => `${l.bold ? 'bold ' : ''}${px}px Consolas, "Courier New", monospace`;
  const rows = [];
  for (const l of lines) {
    let px = l.size * H;
    g.font = font(l, px);
    const parts = [];
    let cur = '';
    for (const word of l.text.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && g.measureText(next).width > maxW) { parts.push(cur); cur = word; } else cur = next;
    }
    parts.push(cur);
    const widest = Math.max(...parts.map((p) => g.measureText(p).width));
    if (widest > maxW) px *= maxW / widest;
    for (const p of parts) rows.push({ text: p, px, lh: px * 1.25, l });
  }
  // se andando a capo il testo supera l'altezza, si riduce tutto insieme
  let total = rows.reduce((s, r) => s + r.lh, 0);
  if (total > H * 0.9) {
    const k = (H * 0.9) / total;
    for (const r of rows) { r.px *= k; r.lh *= k; }
    total *= k;
  }
  let yy = (H - total) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const r of rows) {
    g.font = font(r.l, r.px);
    g.fillStyle = r.l.color || '#d6ffe8';
    g.fillText(r.text, W / 2, yy + r.lh / 2);
    yy += r.lh;
  }
}

// Strisce di pericolo gialle e nere su tutto il canvas
export function drawTape(g, W, H) {
  g.fillStyle = '#f0c020';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#111';
  const s = H * 0.5;
  for (let x = -H; x < W + H; x += s * 2) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + s, H);
    g.lineTo(x + s + H, 0);
    g.lineTo(x + H, 0);
    g.closePath();
    g.fill();
  }
}
