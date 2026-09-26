// Dettagli sci-fi sopra il guscio: costolature, tubi, strisce luminose, cornici a
// strisce di pericolo, colonne, luci. Pochi poligoni (PS1), molta luce emissiva.

import * as THREE from 'three';
import { box, WALL_T } from './kit.js';

// palette System Shock (remake 2023): neon verde e magenta su superfici scure
export const NEON_G = 0x3dff8a;
export const NEON_M = 0xff3bd4;
const COOL = 0xb89cff;      // luce di riempimento, lilla
const STRIP = NEON_M;       // strisce luminose del soffitto

export function light(ctx, x, y, z, color = COOL, intensity = 8, distance = 12) {
  const l = new THREE.PointLight(color, intensity, distance, 2);
  l.position.set(x, y, z);
  ctx.group.add(l);
  return l;
}

// Cornice a strisce di pericolo attorno a un vano porta, su una faccia del muro.
// axis/at/c come per wall() e Door; f = +1/-1 verso quale lato del muro sporge.
export function doorFrame(ctx, axis, at, c, f, { w = 2, h = 2.4 } = {}) {
  const a = at + f * (WALL_T / 2), b = at + f * (WALL_T / 2 + 0.08);
  const [n0, n1] = [Math.min(a, b), Math.max(a, b)];
  const top = h + 0.3; // sopra la luce del portellone
  const piece = (u0, u1, y0, y1, mat) => (axis === 'x'
    ? box(ctx.group, u0, u1, y0, y1, n0, n1, mat)
    : box(ctx.group, n0, n1, y0, y1, u0, u1, mat));
  const t = ctx.mats.trim, neon = ctx.mats.glow(NEON_G);
  piece(c - w / 2 - 0.15, c - w / 2, 0, top, t);
  piece(c + w / 2, c + w / 2 + 0.15, 0, top, t);
  piece(c - w / 2 - 0.15, c + w / 2 + 0.15, h + 0.15, top, t);
  const e = at + f * (WALL_T / 2 + 0.085); // filo di neon appena davanti alla cornice
  const [e0, e1] = [Math.min(e, e + f * 0.01), Math.max(e, e + f * 0.01)];
  const strip = (u0, u1, y0, y1) => (axis === 'x'
    ? box(ctx.group, u0, u1, y0, y1, e0, e1, neon)
    : box(ctx.group, e0, e1, y0, y1, u0, u1, neon));
  strip(c - w / 2 - 0.05, c - w / 2 - 0.02, 0, h + 0.17);
  strip(c + w / 2 + 0.02, c + w / 2 + 0.05, 0, h + 0.17);
}

// Segmento di spina da zs a zs - L (verso nord), larghezza 2*half, altezza h
export function spineSegment(ctx, zs, L, half, h, zc, index = 0) {
  const z0 = zs - L, z1 = zs;
  const glow = ctx.mats.glow(STRIP);
  // due strisce luminose lungo il soffitto
  for (const x of [-0.7, 0.7]) box(ctx.group, x - 0.05, x + 0.05, h - 0.04, h, z0, z1, glow);
  // strisce verdi alla base dei muri
  const green = ctx.mats.glow(NEON_G);
  for (const s of [-1, 1]) {
    const x = s * (half - WALL_T / 2 - 0.02);
    box(ctx.group, Math.min(x, x - s * 0.03), Math.max(x, x - s * 0.03), 0.08, 0.12, z0, z1, green);
  }
  // tubi negli angoli alti: uno d'acciaio, uno arancio
  for (const [x, col] of [[-half + 0.2, 0x8a939c], [half - 0.2, 0xb4602c]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, L, 6), new THREE.MeshLambertMaterial({ color: col }));
    p.rotation.x = Math.PI / 2;
    p.position.set(x, h - 0.22, (z0 + z1) / 2);
    ctx.group.add(p);
  }
  // costole all'inizio del segmento e a meta' strada fra i portelloni
  for (const z of [zs - 0.2, zc - 4.2]) rib(ctx, z, half, h);
  light(ctx, 0, h - 0.4, zc, index % 2 ? NEON_G : NEON_M, 7, 10);
}

export function spineEnd(ctx, z, half, h) {
  rib(ctx, z + 0.2, half, h);
}

function rib(ctx, z, half, h) {
  const t = ctx.mats.trim;
  const x0 = half - WALL_T / 2;
  for (const s of [-1, 1]) {
    const a = s * x0, b = s * (x0 - 0.15);
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    box(ctx.group, lo, hi, 0, h, z - 0.15, z + 0.15, t);
    ctx.colliders.push({ minX: lo, maxX: hi, minZ: z - 0.15, maxZ: z + 0.15 });
  }
  box(ctx.group, -x0, x0, h - 0.15, h, z - 0.15, z + 0.15, t);
}

// Striscia di pericolo sul pavimento (soglie delle porte)
export function floorHazard(ctx, x0, x1, z0, z1) {
  box(ctx.group, Math.min(x0, x1), Math.max(x0, x1), 0, 0.006, Math.min(z0, z1), Math.max(z0, z1), ctx.mats.hazard);
}

export function atrium(ctx, A, h, holoColor) {
  const t = ctx.mats.trim;
  // colonne negli angoli
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (A - 0.5), z = sz * (A - 0.5);
      box(ctx.group, x - 0.35, x + 0.35, 0, h, z - 0.35, z + 0.35, t);
      ctx.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
      light(ctx, sx * (A - 1.6), h - 0.6, sz * (A - 1.6), sx * sz > 0 ? NEON_M : NEON_G, 10, 12);
    }
  }
  // anello di luce sul soffitto sopra l'ologramma, anello tenue sul pavimento
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.3, 32), ctx.mats.glow(STRIP));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h - 0.02;
  ctx.group.add(ring);
  const floorRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.55, 32), ctx.mats.glow(0x1f8a50));
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = 0.01;
  ctx.group.add(floorRing);
  light(ctx, 0, 1.6, 0, holoColor, 3, 6);
}

// Stanza: luce del suo colore, strisce luminose a pavimento lungo i muri laterali,
// costole ogni 2,5 m. x1 = muro verso la camera stagna, x2 = muro di fondo.
// colorLight: moltiplica la luce del colore della stanza (room.json "colorLight")
export function room(ctx, x1, x2, za, zb, h, color, colorLight = 1) {
  const glow = ctx.mats.glow(color);
  const [xa, xb] = [Math.min(x1, x2), Math.max(x1, x2)];
  const inner = WALL_T / 2;
  box(ctx.group, xa, xb, 0, 0.04, za + inner, za + inner + 0.06, glow);
  box(ctx.group, xa, xb, 0, 0.04, zb - inner - 0.06, zb - inner, glow);
  const t = ctx.mats.trim;
  for (let x = xa + 2.5; x < xb - 1; x += 2.5) {
    for (const [z0, z1] of [[za + inner, za + inner + 0.15], [zb - inner - 0.15, zb - inner]]) {
      box(ctx.group, x - 0.15, x + 0.15, 0, h, z0, z1, t);
      ctx.colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z0, maxZ: z1 });
    }
    box(ctx.group, x - 0.15, x + 0.15, h - 0.15, h, za, zb, t);
  }
  const cx = (x1 + x2) / 2, cz = (za + zb) / 2;
  light(ctx, cx, h - 0.5, cz, new THREE.Color(color), 70 * colorLight, 18);
  light(ctx, x1 + Math.sign(x2 - x1) * 2.5, h - 0.6, cz, COOL, 22, 12);
  light(ctx, x2 - Math.sign(x2 - x1) * 2.5, h - 0.6, cz, COOL, 22, 12);
}

// Camera stagna: striscia luminosa e strisce di pericolo alle due soglie
export function airlock(ctx, x0, x1, zc, half, h) {
  const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
  box(ctx.group, xa, xb, h - 0.04, h, zc - 0.05, zc + 0.05, ctx.mats.glow(NEON_G));
  floorHazard(ctx, xa + 0.1, xa + 0.4, zc - 1, zc + 1);
  floorHazard(ctx, xb - 0.4, xb - 0.1, zc - 1, zc + 1);
}

export function arrival(ctx, half, h, z0, z1) {
  for (const x of [-0.7, 0.7]) box(ctx.group, x - 0.05, x + 0.05, h - 0.04, h, z0, z1, ctx.mats.glow(STRIP));
  light(ctx, 0, h - 0.4, (z0 + z1) / 2, NEON_G, 5, 8);
  floorHazard(ctx, -1, 1, z1 - 0.5, z1 - 0.15);
}
