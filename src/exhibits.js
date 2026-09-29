// Reperti di una stanza, descritti in room.json ("exhibits"). Coordinate DELLA STANZA:
//   at: [u, v]  u = metri dalla porta verso il muro di fondo, v = metri a destra
//               (guardando dalla porta dentro la stanza), 0 = asse della stanza
//   rot: gradi; 0 = l'oggetto guarda verso la porta, 90 = verso sinistra (-v)...
//   y: quota da terra
// Cosi' la stessa disposizione vale per le stanze a ovest e a est della spina.
// I modelli guardano verso -z (convenzione di tools/vampaladin-export.mjs).

import * as THREE from 'three';
import { T, getLang } from './lang.js';
import { box, sign, drawLines, drawTape } from './kit.js';
import { mediaUrl } from './media.js';
import { loadPack } from './models.js';
import { CRISP } from './psx.js';
import gifuct from 'gifuct-js'; // CommonJS: Vite ne espone solo il default
import { ANGRII_TYPES } from './angrii.js';

const { parseGIF, decompressFrame } = gifuct;

const langTag = () => (getLang() === 'it' ? 'it-IT' : 'en-US');

const TORCH = new THREE.Color(1, 0.6, 0.3); // come le torce del dungeon di Vampaladin

// frame = { roomId, x1, side, zc, d, w, h }
export function buildExhibits(ctx, room, frame) {
  // pack: file del pacchetto; packRoom: stanza che lo contiene (default: questa)
  const packRoom = room.packRoom || room.id;
  const pack = room.pack
    ? loadPack(mediaUrl(packRoom, room.pack), (bin) => mediaUrl(packRoom, 'media/' + bin))
    : null;
  for (const ex of room.exhibits || []) {
    const make = TYPES[ex.type];
    if (!make) { console.warn('reperto sconosciuto:', ex.type); continue; }
    make(ctx, ex, frame, pack, room);
  }
}

// posizione e rotazione nel mondo; il gruppo restituito guarda "verso la porta" se rot = 0
export function place(ctx, frame, ex) {
  const [u, v] = ex.at || [0, 0];
  const g = new THREE.Group();
  g.position.set(frame.x1 + frame.side * u, ex.y || 0, frame.zc + frame.side * v);
  const r = THREE.MathUtils.degToRad(ex.rot || 0);
  const du = -Math.cos(r), dv = -Math.sin(r);          // direzione dello sguardo nella stanza
  const dx = frame.side * du, dz = frame.side * dv;    // ... nel mondo
  g.rotation.y = Math.atan2(-dx, -dz);                 // -z locale verso (dx, dz)
  if (ex.scale) g.scale.setScalar(ex.scale);
  ctx.group.add(g);
  return g;
}

// Easter egg: se il visitatore fissa il modello per piu' di "seconds" secondi, il modello
// si gira lentamente a guardarlo; appena il visitatore distoglie lo sguardo e il modello
// esce dall'inquadratura, torna com'era, senza che nessuno lo veda muoversi.
function stare(ctx, g, seconds) {
  const base = g.rotation.y;
  const fwd = new THREE.Vector3(), to = new THREE.Vector3(), eye = new THREE.Vector3();
  let gaze = 0, last = null;
  ctx.updaters.push((t) => {
    const dt = last === null ? 0 : Math.min(t - last, 0.1);
    last = t;
    const cam = ctx.getViewer?.()?.camera;
    if (!cam) return;
    cam.getWorldPosition(eye);
    cam.getWorldDirection(fwd);
    to.set(g.position.x, g.position.y + 1.2, g.position.z).sub(eye);
    const dist = to.length();
    const angle = fwd.angleTo(to.normalize());
    if (dist < 14 && angle < THREE.MathUtils.degToRad(14)) {
      gaze += dt;
      if (gaze > seconds) {
        // verso il visitatore: il -z locale del modello punta all'occhio
        const want = Math.atan2(-(eye.x - g.position.x), -(eye.z - g.position.z));
        let d = want - g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        g.rotation.y += Math.sign(d) * Math.min(Math.abs(d), 0.7 * dt); // lento: inquietante
      }
    } else {
      gaze = 0;
      if (angle > THREE.MathUtils.degToRad(65)) g.rotation.y = base; // fuori vista: torna normale
    }
  });
}

// collisione dal riquadro del modello, ruotato e spostato come il gruppo
export function colliderFrom(ctx, g, min, max, shrink = 0.05) {
  const s = g.scale.x;
  const c = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const x of [min[0], max[0]]) for (const z of [min[2], max[2]]) {
    const wx = g.position.x + (x * c + z * sn) * s;
    const wz = g.position.z + (-x * sn + z * c) * s;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
  }
  if (x1 - x0 > 2 * shrink && z1 - z0 > 2 * shrink) {
    ctx.colliders.push({ minX: x0 + shrink, maxX: x1 - shrink, minZ: z0 + shrink, maxZ: z1 - shrink });
  }
}

// statua: i colori dei pezzi diventano sfumature di pietra
function stoneColors(geo) {
  const src = geo.attributes.color.array;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const l = src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11;
    const v = 0.26 + l * 0.3;
    out[i] = v * 0.9; out[i + 1] = v * 0.93; out[i + 2] = v * 1.0; // grigio freddo: le torce lo scaldano
  }
  const g = geo.clone();
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

const vertexMat = new THREE.MeshLambertMaterial({ vertexColors: true });

// materiali di un pacchetto esportato da Unity (texture in media/, PSX Lit o Unlit)
const packMatCache = new Map();
function packMaterials(roomId, list) {
  const key = roomId + ':' + list.length;
  if (packMatCache.has(key)) return packMatCache.get(key);
  const mats = list.map((m) => {
    let map = null;
    if (m.tex) {
      map = new THREE.TextureLoader().load(mediaUrl(roomId, 'media/' + m.tex));
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapNearestFilter;
    }
    const opts = { map, color: new THREE.Color(...m.color), vertexColors: true, transparent: m.transparent, side: THREE.DoubleSide };
    if (m.transparent) { opts.opacity = 0.35; opts.depthWrite = false; }
    return m.unlit ? new THREE.MeshBasicMaterial(opts) : new THREE.MeshLambertMaterial(opts);
  });
  packMatCache.set(key, mats);
  return mats;
}

// texture della stanza a pixel netti (PS1)
function texturedMat(roomId, rel) {
  const t = new THREE.TextureLoader().load(mediaUrl(roomId, rel));
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  return new THREE.MeshLambertMaterial({ map: t });
}
const flameMat = new THREE.MeshBasicMaterial({ vertexColors: true });

function flicker(ctx, light, base) {
  const seed = Math.random() * 100;
  ctx.updaters.push((t) => {
    light.intensity = base * (0.82 + 0.1 * Math.sin(t * 9 + seed) + 0.08 * Math.sin(t * 23.7 + seed * 2));
  });
}

const TYPES = {
  // modello del pacchetto della stanza; look: 'vertex' (colori originali) o 'stone';
  // mesh puo' essere un nome o una lista; map: texture (media/...) per i mesh con UV;
  // scaleY: esagerazione verticale (plastico)
  model(ctx, ex, frame, pack, room) {
    const g = place(ctx, frame, ex);
    if (ex.scaleY) g.scale.y = (ex.scale || 1) * ex.scaleY;
    if (ex.stare) stare(ctx, g, ex.stare);
    const mapMat = ex.map ? texturedMat(room.id, ex.map) : null;
    pack.then((p) => {
      for (const name of [].concat(ex.mesh)) {
        const meta = p.meta(name);
        const hasUv = meta.uv !== undefined;
        const geo = ex.look === 'stone' ? stoneColors(p.get(name)) : p.get(name);
        const mat = meta.groups ? packMaterials(room.id, p.materials) : mapMat && hasUv ? mapMat : vertexMat;
        const mesh = new THREE.Mesh(geo, mat);
        if (ex.offset) mesh.position.set(...ex.offset);
        if (ex.yaw) mesh.rotation.y = THREE.MathUtils.degToRad(ex.yaw); // rotazione del modello nel suo gruppo
        g.add(mesh);
        // collisioni degli arredi calcolate dal convertitore ([minX, minZ, maxX, maxZ])
        if (ex.colliders && meta.colliders) {
          const o = ex.offset || [0, 0, 0];
          for (const [x0, z0, x1, z1] of meta.colliders) colliderFrom(ctx, g, [x0 + o[0], 0, z0 + o[2]], [x1 + o[0], 0, z1 + o[2]], 0.02);
        }
      }
      for (const [name, color] of Object.entries(ex.glow || {})) {
        g.add(new THREE.Mesh(p.get(name), new THREE.MeshBasicMaterial({ color })));
      }
      // riquadro d'ingombro come collisione (non per chi ha le sue collisioni pezzo per pezzo)
      if (!ex.noCollide && !ex.colliders) {
        const m = p.meta([].concat(ex.mesh)[0]), o = ex.offset || [0, 0, 0];
        colliderFrom(ctx, g, [m.min[0] + o[0], 0, m.min[2] + o[2]], [m.max[0] + o[0], 0, m.max[2] + o[2]]);
      }
      ctx.onCreate(g);
    });
  },

  // teca di vetro: basamento, vetro, spigoli di cromo, luce dall'alto. size [w, h, d] del vetro
  vitrine(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const [w, h, d] = ex.size || [1.4, 2.4, 1.4];
    const base = ex.base ?? 0.3;
    const baseMat = new THREE.MeshLambertMaterial({ color: ex.baseColor || 0x2a1a24 });
    const chrome = new THREE.MeshLambertMaterial({ color: 0xc8ccd0 });
    box(g, -w / 2 - 0.06, w / 2 + 0.06, 0, base, -d / 2 - 0.06, d / 2 + 0.06, baseMat);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({
      color: 0xcfeeff, transparent: true, opacity: 0.025, depthWrite: false, side: THREE.DoubleSide,
    }));
    glass.position.y = base + h / 2;
    g.add(glass);
    const e = 0.025;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, sx * w / 2 - e, sx * w / 2 + e, base, base + h, sz * d / 2 - e, sz * d / 2 + e, chrome);
    }
    for (const y of [base, base + h]) {
      for (const sz of [-1, 1]) box(g, -w / 2 - e, w / 2 + e, y - e, y + e, sz * d / 2 - e, sz * d / 2 + e, chrome);
      for (const sx of [-1, 1]) box(g, sx * w / 2 - e, sx * w / 2 + e, y - e, y + e, -d / 2 - e, d / 2 + e, chrome);
    }
    const light = new THREE.PointLight(ex.lightColor || 0xfff0dc, ex.light ?? 5, 3.5, 2);
    light.position.set(0, base + h - 0.15, 0);
    g.add(light);
    colliderFrom(ctx, g, [-w / 2 - 0.06, 0, -d / 2 - 0.06], [w / 2 + 0.06, 0, d / 2 + 0.06], 0);
  },

  // luce puntiforme libera: color, intensity, distance, y
  light(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const l = new THREE.PointLight(new THREE.Color(ex.color || '#ffe0b0'), ex.intensity ?? 6, ex.distance ?? 8, 2);
    g.add(l);
  },

  // quadro con cornice di legno: immagine (png/jpg/webp) o GIF animata (src: media/...),
  // oppure "GIF in arrivo". La cornice prende le PROPORZIONI della figura (niente tagli ne'
  // bande) e il suo lato lungo resta quello di size: la figura non si rimpicciolisce.
  // La tela sta sul layer CRISP: nitida, fuori dal PS1, alla risoluzione originale.
  painting(ctx, ex, frame, pack, room) {
    const g = place(ctx, frame, { ...ex, y: 0 });
    const [sw, sh] = ex.size || [1.4, 1];
    const y = ex.y ?? 1.8;
    const wood = new THREE.MeshLambertMaterial({ color: 0x3a2414 });
    const f = 0.09;
    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const canvasMat = new THREE.MeshBasicMaterial({ map: tex });
    let parts = [];
    // cornice + tela di w x h metri (rifatta quando si conoscono le proporzioni)
    const build = (w, h, mat) => {
      for (const p of parts) g.remove(p);
      const frameMesh = box(g, -w / 2 - f, w / 2 + f, y - h / 2 - f, y + h / 2 + f, -0.04, 0.04, wood);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(0, y, -0.045);
      mesh.rotation.y = Math.PI; // guarda verso -z, come i cartelli dei reperti
      mesh.layers.set(CRISP);
      g.add(mesh);
      parts = [frameMesh, mesh];
      ctx.onCreate(frameMesh);
    };
    // lato lungo = lato lungo di size, proporzioni della figura
    const fit = (pw, ph) => {
      const side = Math.max(sw, sh);
      return pw >= ph ? [side, (side * ph) / pw] : [(side * pw) / ph, side];
    };
    canvas.width = 320;
    canvas.height = Math.round((320 * sh) / sw);
    c.fillStyle = '#1a120c';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#c8a878';
    c.font = 'bold 22px Consolas, monospace';
    c.fillText(T(ex.title) || 'GIF', canvas.width / 2, canvas.height / 2 - 14);
    c.fillStyle = '#806850';
    c.font = '16px Consolas, monospace';
    c.fillText(T({ it: 'GIF in arrivo', en: 'GIF coming soon' }), canvas.width / 2, canvas.height / 2 + 16);
    build(sw, sh, canvasMat);
    if (!ex.src) return;
    const url = mediaUrl(room.id, ex.src);

    if (/\.(mp4|webm)$/i.test(ex.src)) {
      // video (le GIF convertite: molto piu' leggere): muto, in loop, parte da solo
      const video = document.createElement('video');
      Object.assign(video, { src: url, muted: true, loop: true, playsInline: true, autoplay: true, crossOrigin: 'anonymous' });
      video.addEventListener('loadedmetadata', () => {
        const t = new THREE.VideoTexture(video);
        t.colorSpace = THREE.SRGBColorSpace;
        build(...fit(video.videoWidth, video.videoHeight), new THREE.MeshBasicMaterial({ map: t }));
        video.play().catch(() => {});
      });
      // alcuni browser rifiutano l'avvio automatico fino al primo clic
      addEventListener('pointerdown', () => { if (video.paused) video.play().catch(() => {}); }, { once: true });
      return;
    }

    if (!/\.gif$/i.test(ex.src)) {
      // immagine fissa: texture diretta, risoluzione piena
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        const [w, h] = fit(t.image.width, t.image.height);
        build(w, h, new THREE.MeshBasicMaterial({ map: t }));
      });
      return;
    }

    fetch(url).then((r) => r.arrayBuffer()).then((buf) => {
      // un fotogramma alla volta, mentre gira: le GIF lunghe non riempiono la memoria
      const gif = parseGIF(buf);
      const raw = gif.frames.filter((fr) => fr.image);
      if (!raw.length) return;
      const frameAt = (k) => decompressFrame(raw[k], gif.gct, true);
      const W = gif.lsd.width, H = gif.lsd.height;
      canvas.width = W;
      canvas.height = H;
      tex.dispose(); // la tela ha cambiato misura
      build(...fit(W, H), canvasMat);
      const work = document.createElement('canvas');
      work.width = W;
      work.height = H;
      const wc = work.getContext('2d');
      const patch = document.createElement('canvas');
      const pc = patch.getContext('2d');
      let i = 0, next = 0, restore = null;
      const drawFrame = (fr) => {
        if (restore) { wc.putImageData(restore.data, restore.x, restore.y); restore = null; }
        const d = fr.dims;
        if (fr.disposalType === 3) restore = { data: wc.getImageData(d.left, d.top, d.width, d.height), x: d.left, y: d.top };
        patch.width = d.width;
        patch.height = d.height;
        pc.putImageData(new ImageData(fr.patch, d.width, d.height), 0, 0);
        wc.drawImage(patch, d.left, d.top);
        c.drawImage(work, 0, 0);
        tex.needsUpdate = true;
        if (fr.disposalType === 2) wc.clearRect(d.left, d.top, d.width, d.height);
      };
      ctx.updaters.push((t) => {
        const ms = t * 1000;
        if (ms < next) return;
        const fr = frameAt(i);
        drawFrame(fr);
        next = ms + Math.max(20, fr.delay || 100);
        i = (i + 1) % raw.length;
      });
    }).catch((e) => console.warn('GIF non caricata:', ex.src, e));
  },

  // ringhiera di legno da un punto all'altro (from/to: [u, v]) con aperture
  // (gaps: [[inizio, fine]] in metri lungo la ringhiera); i tratti pieni bloccano
  railing(ctx, ex, frame) {
    const [u0, v0] = ex.from, [u1, v1] = ex.to;
    const len = Math.hypot(u1 - u0, v1 - v0);
    const wood = new THREE.MeshLambertMaterial({ color: ex.color || 0x5a3a22 });
    const h = ex.height ?? 1.05;
    const gaps = ex.gaps || [];
    const inGap = (s) => gaps.some(([a, b]) => s > a && s < b);
    const cuts = [0, ...gaps.flat(), len].sort((a, b) => a - b);
    const rot = THREE.MathUtils.radToDeg(Math.atan2(v1 - v0, u1 - u0)) - 90;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k], b = cuts[k + 1];
      if (b - a < 0.05 || inGap((a + b) / 2)) continue;
      const mid = (a + b) / 2 / len;
      const g = place(ctx, frame, { at: [u0 + (u1 - u0) * mid, v0 + (v1 - v0) * mid], rot });
      const L = b - a;
      box(g, -L / 2, L / 2, h - 0.08, h, -0.05, 0.05, wood); // corrimano
      box(g, -L / 2, L / 2, h * 0.45, h * 0.45 + 0.06, -0.03, 0.03, wood);
      const n = Math.max(1, Math.ceil(L / 1.2));
      for (let p = 0; p <= n; p++) box(g, -L / 2 + (p * L) / n - 0.06, -L / 2 + (p * L) / n + 0.06, 0, h, -0.06, 0.06, wood);
      colliderFrom(ctx, g, [-L / 2, 0, -0.08], [L / 2, 0, 0.08], 0);
    }
  },

  // nastro giallo e nero fra due paletti (area in allestimento); blocca il passaggio
  tape(ctx, ex, frame) {
    const [u0, v0] = ex.from, [u1, v1] = ex.to;
    const L = Math.hypot(u1 - u0, v1 - v0);
    const rot = THREE.MathUtils.radToDeg(Math.atan2(v1 - v0, u1 - u0)) - 90;
    const g = place(ctx, frame, { at: [(u0 + u1) / 2, (v0 + v1) / 2], rot });
    const post = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const n = Math.max(1, Math.ceil(L / 2.5));
    for (let p = 0; p <= n; p++) box(g, -L / 2 + (p * L) / n - 0.04, -L / 2 + (p * L) / n + 0.04, 0, 1.0, -0.04, 0.04, post);
    for (const y of [0.95, 0.6]) {
      for (const turn of [0, Math.PI]) {
        const t = sign(ctx, { w: L, h: 0.09, x: 0, y: 0, z: 0, face: 0, draw: drawTape });
        g.add(t);
        t.position.set(0, y, 0);
        t.rotation.set(0, turn, 0);
      }
    }
    colliderFrom(ctx, g, [-L / 2, 0, -0.08], [L / 2, 0, 0.08], 0);
  },

  // tabellone: righe di testo; una riga puo' mostrare un dato da un json della stanza
  // ({ text, data: { src, key } }: nel testo {} diventa il numero)
  board(ctx, ex, frame, pack, room) {
    const g = place(ctx, frame, { ...ex, y: 0 });
    const [w, h] = ex.size || [3, 1.5];
    const values = {};
    const color = ex.color || '#e0a040';
    const s = sign(ctx, {
      w, h, x: 0, y: 0, z: 0, face: 0,
      draw: (c, W, H) => drawLines(c, W, H, ex.lines.map((l) => {
        let text = T(l.text);
        if (l.data) {
          const v = values[l.data.key];
          text = text.replace('{}', v === undefined ? '...' : typeof v === 'number' ? v.toLocaleString(langTag()) : String(v));
        }
        return { ...l, text };
      }), { bg: ex.bg || '#140c08', border: color }),
    });
    g.add(s);
    s.position.set(0, ex.y ?? 2, -0.05);
    s.rotation.set(0, Math.PI, 0);
    for (const l of ex.lines) {
      if (!l.data) continue;
      // prima il file della build, poi (se c'e') il dato dal vivo dall'hosting (data.live)
      const show = (j) => {
        if (j?.[l.data.key] === undefined) return;
        values[l.data.key] = j[l.data.key];
        s.userData.redraw?.();
      };
      const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null));
      get(mediaUrl(room.id, l.data.src)).then(show).catch(() => {})
        .then(() => l.data.live && get(l.data.live).then(show)).catch(() => {});
    }
  },

  // tavolo da plastico: piano scuro con bordo luminoso sul basamento. size [w, h, d]
  table(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const [w, h, d] = ex.size || [3, 0.85, 3];
    const color = ex.color || '#40e080';
    box(g, -w / 2 + 0.25, w / 2 - 0.25, 0, h - 0.06, -d / 2 + 0.25, d / 2 - 0.25, ctx.mats.trim);
    box(g, -w / 2, w / 2, h - 0.06, h, -d / 2, d / 2, ctx.mats.trim);
    const glow = ctx.mats.glow(color);
    box(g, -w / 2 + 0.24, w / 2 - 0.24, 0.1, 0.14, -d / 2 + 0.24, d / 2 - 0.24, glow); // striscia alla base
    box(g, -w / 2 - 0.01, w / 2 + 0.01, h - 0.035, h - 0.02, -d / 2 - 0.01, d / 2 + 0.01, glow); // filo sul bordo
    colliderFrom(ctx, g, [-w / 2, 0, -d / 2], [w / 2, 0, d / 2], 0);
    // luce neutra da vetrina: il plastico mostra i suoi colori, non quelli della stanza
    const spot = new THREE.PointLight(0xfff6e8, ex.light ?? 7, 5, 2);
    spot.position.set(0, h + 1.9, 0);
    g.add(spot);
  },

  // arredo del dungeon, con la sua fiamma (_Luce) e, se light: true, una luce che tremola
  prop(ctx, ex, frame, pack) {
    const g = place(ctx, frame, ex);
    pack.then((p) => {
      g.add(new THREE.Mesh(p.get(ex.name), vertexMat));
      const luce = ex.name + '_Luce';
      if (p.names.includes(luce)) {
        const off = p.meta(luce).offset || [0, 0, 0];
        const f = new THREE.Mesh(p.get(luce), flameMat);
        f.position.set(...off);
        g.add(f);
        const seed = Math.random() * 10;
        ctx.updaters.push((t) => { f.scale.y = 0.85 + 0.2 * Math.abs(Math.sin(t * 11 + seed)); });
        if (ex.light) {
          const l = new THREE.PointLight(TORCH, ex.light === true ? 9 : ex.light, 9, 2);
          l.position.set(off[0], off[1] + 0.15, off[2]);
          g.add(l);
          flicker(ctx, l, l.intensity);
        }
      }
      if (!ex.noCollide) { const m = p.meta(ex.name); colliderFrom(ctx, g, m.min, m.max); }
      ctx.onCreate(g);
    });
  },

  // piedistallo di pietra: size [larghezza, altezza, profondita']
  pedestal(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const [w, h, d] = ex.size || [1.2, 0.6, 1.2];
    const mat = frame.theme?.wall || ctx.mats.trim;
    box(g, -w / 2, w / 2, 0, h, -d / 2, d / 2, mat);
    box(g, -w / 2 - 0.08, w / 2 + 0.08, h, h + 0.08, -d / 2 - 0.08, d / 2 + 0.08, mat); // cornice
    colliderFrom(ctx, g, [-w / 2 - 0.08, 0, -d / 2 - 0.08], [w / 2 + 0.08, 0, d / 2 + 0.08], 0);
  },

  // travi di legno sul soffitto, di traverso, ogni "every" metri
  beams(ctx, ex, frame) {
    const wood = new THREE.MeshLambertMaterial({ color: 0x4a3222 });
    for (let u = ex.every || 2.5; u < frame.d - 0.5; u += ex.every || 2.5) {
      const g = place(ctx, frame, { at: [u, 0] });
      // nel gruppo z locale corre lungo la stanza: la trave va di traverso, lungo x
      box(g, -frame.w / 2, frame.w / 2, frame.h - 0.32, frame.h, -0.14, 0.14, wood);
    }
  },

  // leggio: con E apre il pannello ex.panel (testi in room.json "panels")
  lectern(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const stone = frame.theme?.wall || ctx.mats.trim;
    box(g, -0.22, 0.22, 0, 0.95, -0.14, 0.14, stone);
    box(g, -0.45, 0.45, 0, 0.06, -0.3, 0.3, stone);
    colliderFrom(ctx, g, [-0.45, 0, -0.3], [0.45, 0, 0.3], 0);
    const color = ex.color || '#c03040';
    const s = sign(ctx, {
      w: 0.9, h: 0.55, x: 0, y: 0, z: 0, face: 0,
      draw: (c, W, H) => drawLines(c, W, H, [
        { text: T(ex.title), size: 0.2, bold: true, color },
        { text: T(ex.sub), size: 0.11, color: '#e8d8c8' },
        { text: T({ it: '[E] LEGGI', en: '[E] READ' }), size: 0.13, bold: true, color: '#ff3bd4' },
      ], { bg: '#120a0c', border: color }),
    });
    g.add(s);
    s.position.set(0, 1.08, -0.05);
    s.rotation.set(-0.6, Math.PI, 0, 'YXZ'); // inclinato, guarda verso -z
    const wp = g.position;
    ctx.interactables.push({ id: ex.panel, x: wp.x, z: wp.z, radius: ex.radius || 2.4 });
  },

  // cabinato arcade: in futuro fara' provare il gioco
  arcade(ctx, ex, frame) {
    const g = place(ctx, frame, ex);
    const color = ex.color || '#e02838';
    const body = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.08) });
    const trim = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
    box(g, -0.38, 0.38, 0, 1.0, -0.42, 0.42, body);                 // mobile basso
    box(g, -0.38, 0.38, 1.0, 1.95, -0.02, 0.42, body);              // parte alta
    box(g, -0.4, -0.37, 0, 1.95, -0.44, 0.44, trim);                // fianchi rossi
    box(g, 0.37, 0.4, 0, 1.95, -0.44, 0.44, trim);
    const panel = box(g, -0.36, 0.36, 0.96, 1.02, -0.42, -0.02, new THREE.MeshLambertMaterial({ color: 0x2a1418 }));
    panel.rotation.x = -0.25;
    // leva e pulsanti
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    stick.position.set(-0.16, 1.1, -0.26);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshLambertMaterial({ color }));
    knob.position.set(-0.16, 1.17, -0.26);
    g.add(stick, knob);
    for (const [x, c] of [[0.06, color], [0.15, color], [0.24, 0xf0e0d0]]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), new THREE.MeshBasicMaterial({ color: c }));
      b.position.set(x, 1.06, -0.24);
      g.add(b);
    }
    colliderFrom(ctx, g, [-0.4, 0, -0.44], [0.4, 0, 0.44], 0);
    // schermo e insegna luminosa (testo nitido, fuori dal PS1)
    const screen = sign(ctx, {
      w: 0.62, h: 0.48, x: 0, y: 0, z: 0, face: 0,
      draw: (c, W, H) => drawLines(c, W, H, (ex.screen || []).map((l) => ({ ...l, text: T(l.text) })), { bg: '#050203', border: '#3a1016' }),
    });
    g.add(screen);
    screen.position.set(0, 1.42, -0.07); // abbastanza avanti: inclinato, il bordo alto non entra nel mobile
    screen.rotation.set(-0.12, Math.PI, 0, 'YXZ');
    const marquee = sign(ctx, {
      w: 0.74, h: 0.2, x: 0, y: 0, z: 0, face: 0,
      draw: (c, W, H) => drawLines(c, W, H, [{ text: T(ex.title), size: 0.62, bold: true, color }], { bg: '#08040a', border: color }),
    });
    g.add(marquee);
    marquee.position.set(0, 1.83, -0.03);
    marquee.rotation.set(0, Math.PI, 0);
    // se c'e' un gioco: E davanti al cabinato lo avvia (src/game.js)
    if (ex.game) {
      g.updateMatrixWorld(true);
      const pos = screen.getWorldPosition(new THREE.Vector3());
      const normal = screen.getWorldDirection(new THREE.Vector3());
      ctx.interactables.push({
        id: 'game:' + ex.game, x: g.position.x, z: g.position.z, radius: ex.radius || 2.2,
        action: 'game', url: import.meta.env.BASE_URL + ex.game, screen: { pos, normal },
        label: { it: '[E] Gioca: ' + T(ex.title), en: '[E] Play: ' + T(ex.title) },
      });
    }
    const glow = new THREE.PointLight(new THREE.Color(color), 2.5, 3.5, 2);
    glow.position.set(0, 1.5, -0.6);
    g.add(glow);
  },
};

// reperti di Angrii City (src/angrii.js)
Object.assign(TYPES, ANGRII_TYPES);
