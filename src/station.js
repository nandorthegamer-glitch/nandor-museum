// Costruisce la stazione dai dati: atrio, arrivo della navetta, spina a segmenti,
// e per ogni attracco camera stagna + stanza (aperta) o portellone sigillato (chiusa).
//
// Assi: x = est, z = sud, y = su. La spina parte dal lato nord dell'atrio e va verso -z.

import * as THREE from 'three';
import { T } from './lang.js';
import { Door } from './door.js';
import { buildSpace } from './space.js';
import { makeMats, box, slab, wall, sign, drawLines, drawTape, FACE, WALL_T } from './kit.js';
import * as D from './details.js';
import { buildNandor } from './nandor.js';
import { buildExhibits } from './exhibits.js';
import { mediaUrl } from './media.js';
import { makeWoodTextures } from './textures.js';

const ATRIUM = 6;       // mezzo lato dell'atrio
const ATRIUM_H = 5;
const SPINE = 1.5;      // mezza larghezza della spina
const SPINE_H = 3;
const LOCK = 3;         // profondita' e larghezza della camera stagna
const DOOR_W = 2;
const DOOR_H = 2.4;
const DEFAULT_SIZE = { w: 10, d: 12, h: 4 };
const WINDOW_W = 8;     // finestroni dell'atrio
const WINDOW_SILL = 0.9;
const WINDOW_TOP = 4.2;
const HOLO_COLOR = 0x3dff8a; // Nandor: verde, come un'IA alla SHODAN

const TXT = {
  subtitle: { it: 'il museo dei lavori di Nandor', en: "a museum of Nandor's works" },
  closed: { it: 'IN ALLESTIMENTO', en: 'COMING SOON' },
  free: { it: 'ATTRACCO LIBERO', en: 'FREE DOCK' },
  freeSub: { it: 'qui attraccherà il prossimo lavoro', en: 'the next work will dock here' },
  open: { it: 'APERTO', en: 'OPEN' },
  map: { it: 'MAPPA DELLA STAZIONE', en: 'STATION MAP' },
  here: { it: 'VOI SIETE QUI', en: 'YOU ARE HERE' },
  contacts: { it: 'CONTATTI', en: 'CONTACTS' },
  open: { it: '[E] APRI', en: '[E] OPEN' },
  module: { it: 'MODULO', en: 'MODULE' },
  nandorSub: { it: 'come è nato il suo volto', en: 'how his face was made' },
  pressE: { it: '[E] LEGGI', en: '[E] READ' },
  works: { it: 'IN COSTRUZIONE', en: 'UNDER CONSTRUCTION' },
  worksSub: { it: 'la stazione cresce: nuovi moduli in arrivo', en: 'the station is growing: new modules on the way' },
};

// getViewer() -> { x, z } del visitatore (Nandor si gira verso di lui)
export function buildStation(stations, rooms, { onCreate = () => {}, getViewer } = {}) {
  const ctx = {
    group: new THREE.Group(), colliders: [], doors: [], updaters: [], interactables: [], musicZones: [],
    mats: makeMats(), onCreate, getViewer,
  };
  const docks = [];

  buildSpace(ctx);
  buildArrival(ctx);
  buildAtrium(ctx);

  // --- spina: segmenti da due attracchi ---
  const ids = stations.docks;
  let zs = -ATRIUM;
  for (let i = 0; i * 2 < ids.length; i++) {
    const west = ids[i * 2] ? rooms[ids[i * 2]] : null;
    const east = ids[i * 2 + 1] ? rooms[ids[i * 2 + 1]] : null;
    const L = Math.max(sizeOf(west).w, sizeOf(east).w) + 2;
    const zc = zs - L / 2;
    slab(ctx, -SPINE, SPINE, zs - L, zs, SPINE_H);
    for (const side of [-1, 1]) {
      wall(ctx, 'z', side * SPINE, zs, zs - L, SPINE_H, [{ c: zc, w: DOOR_W, h: DOOR_H }]);
      const room = side < 0 ? west : east;
      const n = i * 2 + (side < 0 ? 0 : 1) + 1;
      buildDock(ctx, side, zc, room, n);
      D.floorHazard(ctx, side * (SPINE - 0.15), side * (SPINE - 0.45), zc - DOOR_W / 2, zc + DOOR_W / 2);
      docks.push({ seg: i, side, room, n });
    }
    D.spineSegment(ctx, zs, L, SPINE, SPINE_H, zc, i);
    zs -= L;
  }
  D.spineEnd(ctx, zs, SPINE, SPINE_H);
  buildWorks(ctx, zs);

  // fondo della spina: finestrone sullo spazio (per ora un pannello scuro)
  wall(ctx, 'x', zs, -SPINE, SPINE, SPINE_H);
  box(ctx.group, -1.2, 1.2, 0.8, 2.4, zs + WALL_T / 2, zs + WALL_T / 2 + 0.02, ctx.mats.glow(0x0a1838));

  buildMap(ctx, docks);

  return {
    group: ctx.group,
    colliders: ctx.colliders,
    doors: ctx.doors,
    interactables: ctx.interactables,
    musicZones: ctx.musicZones,
    nandor: ctx.nandor,
    atrium: { half: ATRIUM }, // per sapere quando il visitatore entra nell'atrio
    update: (t) => ctx.updaters.forEach((f) => f(t)),
    spawn: { x: 0, z: 8.8, yaw: 0 },
  };
}

// Fondo della spina: transenna "in costruzione" e un robot umanoide che lava per terra.
// zs = muro di fondo. Il robot va avanti e indietro davanti alla transenna passando il mocio.
function buildWorks(ctx, zs) {
  const zb = zs + 3.2; // transenna: il robot lavora dietro, fra lei e il muro di fondo
  const hazard = ctx.mats.hazard;
  const post = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
  const x0 = SPINE - WALL_T / 2 - 0.25;
  for (const sx of [-1, 1]) {
    const x = sx * x0;
    box(ctx.group, x - 0.05, x + 0.05, 0, 1.25, zb - 0.05, zb + 0.05, post); // bassa: il robot si vede sopra
    box(ctx.group, x - 0.07, x + 0.07, 0, 0.04, zb - 0.3, zb + 0.3, post); // piede
    // lampeggiante ambra in cima al paletto
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffa020 });
    box(ctx.group, x - 0.06, x + 0.06, 1.25, 1.37, zb - 0.06, zb + 0.06, lamp);
    const l = D.light(ctx, x, 1.5, zb + 0.4, 0xffa020, 3, 5);
    const phase = sx > 0 ? Math.PI : 0;
    ctx.updaters.push((t) => {
      const on = Math.sin(t * 5 + phase) > 0;
      lamp.color.setHex(on ? 0xffa020 : 0x301800);
      l.intensity = on ? 3 : 0;
    });
  }
  for (const y of [0.25, 0.55]) box(ctx.group, -x0, x0, y, y + 0.16, zb - 0.03, zb + 0.03, hazard);
  sign(ctx, {
    w: 2.1, h: 0.45, x: 0, y: 0.98, z: zb + 0.04, face: FACE.S,
    draw: (g, W, H) => drawLines(g, W, H, [
      { text: T(TXT.works), size: 0.42, bold: true, color: '#ffb020' },
      { text: T(TXT.worksSub), size: 0.2, color: '#f4e4c4' },
    ], { bg: '#141008', border: '#ffb020' }),
  });

  // --- robot: scatole low-poly, ~1.75 m ---
  const metal = new THREE.MeshLambertMaterial({ color: 0xc8ccd4 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c3038 });
  const eye = new THREE.MeshBasicMaterial({ color: D.NEON_G });
  const wood = new THREE.MeshLambertMaterial({ color: 0x9a7a4a });
  const rag = new THREE.MeshLambertMaterial({ color: 0xd8d4c4 });
  const zr = zs + 1.2;
  D.light(ctx, 0, SPINE_H - 0.3, zr + 0.6, 0xfff0d8, 4, 5); // luce di servizio sul robot
  const bot = new THREE.Group();
  bot.position.set(0, 0, zr);
  ctx.group.add(bot);
  const legs = [-1, 1].map((sx) => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.13, 0.92, 0);
    bot.add(hip);
    box(hip, -0.07, 0.07, -0.46, 0, -0.07, 0.07, dark);       // coscia
    box(hip, -0.06, 0.06, -0.88, -0.46, -0.06, 0.06, metal);  // stinco
    box(hip, -0.08, 0.08, -0.92, -0.86, -0.08, 0.16, dark);   // piede
    return hip;
  });
  const body = new THREE.Group();
  body.position.y = 0.92;
  bot.add(body);
  box(body, -0.2, 0.2, 0, 0.12, -0.12, 0.12, dark);           // bacino
  box(body, -0.25, 0.25, 0.14, 0.62, -0.15, 0.15, metal);     // busto
  box(body, -0.12, 0.12, 0.38, 0.46, 0.15, 0.17, eye);        // spia sul petto
  const head = new THREE.Group();
  head.position.y = 0.66;
  body.add(head);
  box(head, -0.03, 0.03, 0, 0.06, -0.03, 0.03, dark);         // collo
  box(head, -0.12, 0.12, 0.06, 0.28, -0.12, 0.12, metal);
  box(head, -0.1, 0.1, 0.15, 0.2, 0.12, 0.13, eye);           // visore
  box(head, -0.01, 0.01, 0.28, 0.4, -0.01, 0.01, dark);       // antenna
  // braccia + mocio: un unico rig che ruota davanti al busto
  const rig = new THREE.Group();
  rig.position.y = 0.55;
  body.add(rig);
  // il manico passa per le due mani: la sinistra in alto vicino al petto, la destra piu'
  // in basso e in avanti; la testa del mocio poggia a terra davanti al robot
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const floor = -(0.92 + 0.55); // y del pavimento nel sistema del rig
  const mopHead = V(0, floor + 0.05, 0.9);
  const handUp = V(-0.1, -0.15, 0.25);
  const handLow = handUp.clone().lerp(mopHead, 0.28);
  const topEnd = handUp.clone().addScaledVector(mopHead.clone().sub(handUp).normalize(), -0.25);
  limb(rig, topEnd, mopHead, 0.04, wood);                             // manico
  box(rig, -0.22, 0.22, floor, floor + 0.08, 0.82, 0.98, rag);         // mocio
  for (const [sx, hand] of [[-1, handUp], [1, handLow]]) {
    const shoulder = V(sx * 0.29, 0, 0);
    const elbow = shoulder.clone().lerp(hand, 0.5).add(V(sx * 0.08, -0.06, -0.04));
    limb(rig, shoulder, elbow, 0.08, metal);                          // braccio
    limb(rig, elbow, hand, 0.07, dark);                               // avambraccio
    box(rig, hand.x - 0.05, hand.x + 0.05, hand.y - 0.05, hand.y + 0.05, hand.z - 0.05, hand.z + 0.05, metal); // mano
  }
  // si passa solo fino alla transenna
  ctx.colliders.push({ minX: -SPINE, maxX: SPINE, minZ: zs, maxZ: zb + 0.1 });
  ctx.updaters.push((t) => {
    const sweep = Math.sin(t * 2.2);
    rig.rotation.y = sweep * 0.55;
    body.rotation.y = sweep * 0.12;
    bot.position.x = Math.sin(t * 0.35) * 0.5; // passo laterale lento
    const step = Math.sin(t * 0.35 * 2 * 3);
    legs[0].rotation.x = step * 0.12;
    legs[1].rotation.x = -step * 0.12;
    body.position.y = 0.92 + Math.abs(step) * 0.01;
    head.rotation.x = 0.25 + Math.sin(t * 1.1) * 0.05; // guarda per terra
  });
}

// Parallelepipedo di spessore t steso fra due punti (braccia, manici)
function limb(parent, a, b, t, mat) {
  const d = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, d.length(), t), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m);
  return m;
}

function sizeOf(room) {
  return { ...DEFAULT_SIZE, ...(room?.size || {}) };
}

function buildArrival(ctx) {
  // corridoio dell'arrivo a sud dell'atrio, chiuso dal portello della navetta
  const z0 = ATRIUM, z1 = ATRIUM + 4;
  slab(ctx, -SPINE, SPINE, z0, z1, SPINE_H);
  wall(ctx, 'z', -SPINE, z0, z1, SPINE_H);
  wall(ctx, 'z', SPINE, z0, z1, SPINE_H);
  wall(ctx, 'x', z1, -SPINE, SPINE, SPINE_H, [{ c: 0, w: DOOR_W, h: DOOR_H }]);
  new Door(ctx, 'x', z1, 0, { locked: true, quiet: true });
  D.doorFrame(ctx, 'x', z1, 0, -1);
  D.arrival(ctx, SPINE, SPINE_H, z0, z1);
}

function buildAtrium(ctx) {
  const A = ATRIUM;
  slab(ctx, -A, A, -A, A, ATRIUM_H);
  const gate = [{ c: 0, w: SPINE * 2, h: SPINE_H }];
  wall(ctx, 'x', -A, -A, A, ATRIUM_H, gate); // nord: verso la spina
  wall(ctx, 'x', A, -A, A, ATRIUM_H, gate);  // sud: verso l'arrivo

  // est e ovest: finestroni sullo spazio
  const win = { c: 0, w: WINDOW_W, y0: WINDOW_SILL, h: WINDOW_TOP };
  for (const side of [-1, 1]) {
    wall(ctx, 'z', side * A, -A, A, ATRIUM_H, [win]);
    buildWindow(ctx, side * A);
  }

  buildHolo(ctx);
  D.atrium(ctx, A, ATRIUM_H, HOLO_COLOR);

  const inset = WALL_T / 2 + 0.01;
  const northZ = -A + inset;

  // insegna sopra il varco della spina
  sign(ctx, {
    w: 5, h: 1.3, x: 0, y: 4.1, z: northZ, face: FACE.S,
    draw: (g, W, H) => drawLines(g, W, H, [
      { text: 'NANDOR ORBITAL MUSEUM', size: 0.3, bold: true, color: '#3dff8a' },
      { text: T(TXT.subtitle), size: 0.17, color: '#ff8ae6' },
    ], { border: '#ff3bd4' }),
  });

  // contatti a destra del varco: con E si apre il pannello con i link (panels.js)
  sign(ctx, {
    w: 2.6, h: 1.8, x: 4.1, y: 1.8, z: northZ, face: FACE.S,
    draw: (g, W, H) => drawLines(g, W, H, [
      { text: T(TXT.contacts), size: 0.2, bold: true, color: '#ff3bd4' },
      { text: 'email  ·  Thunderstore', size: 0.12 },
      { text: T(TXT.open), size: 0.14, bold: true, color: '#3dff8a' },
    ], { border: '#3dff8a' }),
  });
  ctx.interactables.push({ id: 'contatti', x: 4.1, z: -A + 0.3, radius: 2.6 });
}

// Vetro e montanti di un finestrone nel muro est/ovest dell'atrio (x = posizione del muro)
function buildWindow(ctx, x) {
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW_W, WINDOW_TOP - WINDOW_SILL),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.015, // si mescola in lineare: poco basta
      depthWrite: false, side: THREE.DoubleSide }),
  );
  glass.position.set(x, (WINDOW_SILL + WINDOW_TOP) / 2, 0);
  glass.rotation.y = Math.PI / 2;
  ctx.group.add(glass);
  const t = WALL_T / 2 + 0.03;
  for (const zm of [-WINDOW_W / 6, WINDOW_W / 6]) {
    box(ctx.group, x - t, x + t, WINDOW_SILL, WINDOW_TOP, zm - 0.06, zm + 0.06, ctx.mats.trim);
  }
  // davanzale che sporge verso l'interno
  const inward = -Math.sign(x);
  box(ctx.group, Math.min(x, x + inward * 0.35), Math.max(x, x + inward * 0.35),
    WINDOW_SILL - 0.06, WINDOW_SILL, -WINDOW_W / 2, WINDOW_W / 2, ctx.mats.trim);
}

// Proiettore olografico al centro dell'atrio con Nandor (l'ex SHODAN) dentro, e
// davanti, verso l'arrivo, un leggio: con E spiega come e' stato fatto il volto.
function buildHolo(ctx) {
  const R = 0.9, H = 0.45;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.1, H, 24), ctx.mats.trim);
  base.position.y = H / 2;
  ctx.group.add(base);
  ctx.colliders.push({ minX: -R * 0.85, maxX: R * 0.85, minZ: -R * 0.85, maxZ: R * 0.85 });

  const glow = (opacity) => new THREE.MeshBasicMaterial({
    color: HOLO_COLOR, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const emitter = new THREE.Mesh(new THREE.CircleGeometry(R * 0.65, 24), glow(0.9));
  emitter.rotation.x = -Math.PI / 2;
  emitter.position.y = H + 0.01;
  ctx.group.add(emitter);

  const beamH = 3.3;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.65, beamH, 24, 1, true), glow(0.1));
  beam.position.y = H + beamH / 2;
  ctx.group.add(beam);

  // grande: a 240 righe un volto piccolo diventa una macchia
  ctx.nandor = buildNandor(ctx, { y: 2.75, size: 1.6, getViewer: ctx.getViewer });
  ctx.updaters.push((t) => {
    beam.material.opacity = 0.08 + Math.sin(t * 7) * 0.015;
  });

  // leggio: colonnina e schermo inclinato verso chi arriva da sud
  const lz = 1.95;
  box(ctx.group, -0.2, 0.2, 0, 0.95, lz - 0.12, lz + 0.12, ctx.mats.trim);
  box(ctx.group, -0.45, 0.45, 0, 0.04, lz - 0.3, lz + 0.3, ctx.mats.trim);
  ctx.colliders.push({ minX: -0.45, maxX: 0.45, minZ: lz - 0.3, maxZ: lz + 0.3 });
  const screen = sign(ctx, {
    w: 0.9, h: 0.55, x: 0, y: 1.08, z: lz + 0.05, face: FACE.S,
    draw: (g, W, H) => drawLines(g, W, H, [
      { text: 'NANDOR', size: 0.2, bold: true, color: '#3dff8a' },
      { text: T(TXT.nandorSub), size: 0.11, color: '#d6ffe8' },
      { text: T(TXT.pressE), size: 0.13, bold: true, color: '#ff3bd4' },
    ], { border: '#3dff8a' }),
  });
  screen.rotation.x = -0.6; // inclinato all'indietro, come un leggio
  ctx.interactables.push({ id: 'nandor', x: 0, z: lz, y: 1.08, radius: 2.4 });
}

function buildDock(ctx, side, zc, room, n) {
  const open = room?.status === 'open';
  const x0 = side * SPINE;
  const x1 = side * (SPINE + LOCK);
  const color = room?.color || '#808890';
  const face = side < 0 ? FACE.E : FACE.W; // verso l'interno della spina
  const inset = WALL_T / 2 + 0.01;

  // camera stagna
  slab(ctx, x0, x1, zc - LOCK / 2, zc + LOCK / 2, SPINE_H);
  wall(ctx, 'x', zc - LOCK / 2, x0, x1, SPINE_H);
  wall(ctx, 'x', zc + LOCK / 2, x0, x1, SPINE_H);
  new Door(ctx, 'z', x0, zc, { locked: !open });
  D.doorFrame(ctx, 'z', x0, zc, -side);
  D.airlock(ctx, x0, x1, zc, LOCK / 2, SPINE_H);

  // pannello accanto al portellone, lato spina
  sign(ctx, {
    w: 2.3, h: 1.4, x: x0 - side * inset, y: 1.65, z: zc + 2.35, face,
    draw: (g, W, H) => {
      const num = `${T(TXT.module)} ${String(n).padStart(2, '0')}`;
      if (!room) {
        drawLines(g, W, H, [
          { text: num, size: 0.13, color: '#7f99aa' },
          { text: T(TXT.free), size: 0.2, bold: true },
          { text: T(TXT.freeSub), size: 0.12, color: '#9fb4c2' },
        ], { border: '#3a5364' });
        return;
      }
      drawLines(g, W, H, [
        { text: num, size: 0.12, color: '#7f99aa' },
        { text: T(room.title), size: 0.22, bold: true, color },
        { text: T(room.tagline), size: 0.12 },
        { text: open ? T(TXT.open) : T(TXT.closed), size: 0.14, bold: true, color: open ? '#40ff70' : '#f0c020' },
      ], { border: color });
    },
  });

  if (!open) {
    // portellone sigillato: nastro incrociato e cartello, stanza non costruita
    wall(ctx, 'z', x1, zc - LOCK / 2, zc + LOCK / 2, SPINE_H);
    const xs = x0 - side * 0.2;
    for (const [i, tilt] of [0.28, -0.28].entries()) {
      const m = sign(ctx, { w: 2.5, h: 0.22, x: xs - side * i * 0.01, y: 1.25, z: zc, face, draw: drawTape });
      m.rotation.z = tilt;
    }
    sign(ctx, {
      w: 1.9, h: 0.45, x: xs - side * 0.03, y: 1.9, z: zc, face,
      draw: (g, W, H) => drawLines(g, W, H, [
        { text: room ? T(TXT.closed) : T(TXT.free), size: 0.42, bold: true, color: '#111' },
      ], { bg: '#f0c020' }),
    });
    return;
  }

  // stanza
  const s = sizeOf(room);
  const x2 = side * (SPINE + LOCK + s.d);
  const za = zc - s.w / 2, zb = zc + s.w / 2;
  const theme = room.theme === 'dungeon' ? dungeonMats(room) : room.theme === 'wood' ? woodMats() : null;
  if (room.shell === 'unity') {
    // stanza fatta dal set del gioco (pareti, pavimento, soffitto nel pacchetto): il museo
    // costruisce solo la parete d'ingresso col portellone; il resto sono i reperti
    const nearWall = room.textures?.wall ? dungeonMats(room).wall : ctx.mats.roomWall(color);
    wall(ctx, 'z', x1, za, zb, s.h, [{ c: zc, w: DOOR_W, h: DOOR_H }], nearWall);
    new Door(ctx, 'z', x1, zc);
    buildExhibits(ctx, room, { x1, side, zc, d: s.d, w: s.w, h: s.h, theme: null });
    if (room.music) {
      ctx.musicZones.push({
        minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minZ: za, maxZ: zb,
        url: mediaUrl(room.id, room.music), vol: room.musicVolume ?? 0.5,
      });
    }
    return;
  }
  slab(ctx, x1, x2, za, zb, s.h, theme || ctx.mats);
  const rw = theme ? theme.wall : ctx.mats.roomWall(color);
  wall(ctx, 'z', x1, za, zb, s.h, [{ c: zc, w: DOOR_W, h: DOOR_H }], rw);
  wall(ctx, 'z', x2, za, zb, s.h, [], rw);
  wall(ctx, 'x', za, x1, x2, s.h, [], rw);
  wall(ctx, 'x', zb, x1, x2, s.h, [], rw);
  new Door(ctx, 'z', x1, zc);
  if (theme) {
    // dungeon e locanda: niente neon ne' costolature; luce calda di fondo, il resto lo fanno le torce
    D.light(ctx, (x1 + x2) / 2, s.h - 0.6, zc, 0xff9a60, 5, 16);
  } else {
    D.doorFrame(ctx, 'z', x1, zc, side);
    D.room(ctx, x1, x2, za, zb, s.h, color, room.colorLight ?? 1);
  }
  buildExhibits(ctx, room, { x1, side, zc, d: s.d, w: s.w, h: s.h, theme });
  if (room.music) {
    ctx.musicZones.push({
      minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minZ: za, maxZ: zb,
      url: mediaUrl(room.id, room.music), vol: room.musicVolume ?? 0.5,
    });
  }

  // striscia luminosa del colore della stanza lungo il soffitto (non nel dungeon)
  const glow = ctx.mats.glow(color);
  if (!theme) box(ctx.group, Math.min(x1, x2), Math.max(x1, x2), s.h - 0.06, s.h, zc - 0.15, zc + 0.15, glow);

  // titolo sul muro di fondo (room.json "titleSign": false per toglierlo)
  if (room.titleSign !== false) sign(ctx, {
    w: Math.min(7, s.w - 1), h: 1.3, x: x2 - side * inset, y: room.exhibits?.length ? s.h - 0.75 : 2.6, z: zc, face,
    draw: (g, W, H) => drawLines(g, W, H, [
      { text: T(room.title), size: 0.36, bold: true, color },
      { text: T(room.tagline), size: 0.16 },
    ], { border: color }),
  });
}

// Materiali di una stanza a tema dungeon: le texture di pietra prese dal gioco
// (room.json: textures.wall / floor / ceil, file in rooms/<id>/media/)
function dungeonMats(room) {
  const load = (rel) => {
    const t = new THREE.TextureLoader().load(mediaUrl(room.id, rel));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter;
    return t;
  };
  const mat = (rel, color = 0xffffff) => {
    const m = new THREE.MeshLambertMaterial({ map: load(rel), color });
    m.userData.tile = [1.5, 1.5];
    return m;
  };
  const tx = room.textures || {};
  return { wall: mat(tx.wall), floor: mat(tx.floor), ceil: mat(tx.ceil || tx.wall, 0x707070) };
}

// Locanda di legno (stanza di Races of Valheim): texture dipinte da codice
let woodCache = null;
function woodMats() {
  if (woodCache) return woodCache;
  const tex = makeWoodTextures();
  const mat = (t, color = 0xffffff) => {
    const m = new THREE.MeshLambertMaterial({ map: t, color });
    m.userData.tile = [1.6, 1.6];
    return m;
  };
  return (woodCache = { wall: mat(tex.wall), floor: mat(tex.floor), ceil: mat(tex.ceil) });
}

// Mappa schematica sul muro est dell'atrio, generata dagli attracchi
function buildMap(ctx, docks) {
  const segs = Math.max(1, ...docks.map((d) => d.seg + 1));
  sign(ctx, {
    w: 2.6, h: 2.8, x: -4.1, y: 2.0, z: -ATRIUM + WALL_T / 2 + 0.01, face: FACE.S,
    draw: (g, W, H) => {
      g.fillStyle = '#0e0a18';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#3dff8a';
      g.lineWidth = 4;
      g.strokeRect(2, 2, W - 4, H - 4);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#3dff8a';
      g.font = `bold ${H * 0.045}px Consolas, monospace`;
      g.fillText(T(TXT.map), W / 2, H * 0.06);

      // atrio in basso, spina verso l'alto
      const top = H * 0.13, atriumTop = H * 0.74;
      const segH = (atriumTop - top) / segs;
      const sw = W * 0.08;
      g.strokeStyle = '#7f99aa';
      g.lineWidth = 3;
      g.strokeRect(W / 2 - sw / 2, top, sw, atriumTop - top);
      g.strokeRect(W / 2 - W * 0.17, atriumTop, W * 0.34, H * 0.15);
      g.fillStyle = '#cfe3ee';
      g.font = `${H * 0.03}px Consolas, monospace`;
      g.fillStyle = '#3dff8a';
      g.fillText('NANDOR', W / 2, atriumTop + H * 0.05);
      g.fillStyle = '#ff3bd4';
      g.fillText(T(TXT.here), W / 2, atriumTop + H * 0.105);

      for (const d of docks) {
        const cy = atriumTop - (d.seg + 0.5) * segH;
        const bw = W * 0.34, bh = Math.min(segH * 0.7, H * 0.09);
        const bx = d.side < 0 ? W / 2 - sw / 2 - bw - W * 0.02 : W / 2 + sw / 2 + W * 0.02;
        const open = d.room?.status === 'open';
        g.fillStyle = open ? d.room.color : '#1a232c';
        g.globalAlpha = open ? 0.25 : 1;
        g.fillRect(bx, cy - bh / 2, bw, bh);
        g.globalAlpha = 1;
        g.strokeStyle = d.room ? (open ? d.room.color : '#f0c020') : '#3a5364';
        g.strokeRect(bx, cy - bh / 2, bw, bh);
        g.fillStyle = d.room ? '#cfe3ee' : '#6d8494';
        let label = d.room ? T(d.room.title) : T(TXT.free);
        g.font = `${H * 0.03}px Consolas, monospace`;
        while (g.measureText(label).width > bw * 0.92 && label.length > 4) label = label.slice(0, -2) + '.';
        g.fillText(label, bx + bw / 2, cy);
      }
    },
  });
}
