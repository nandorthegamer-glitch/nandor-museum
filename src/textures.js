// Texture sci-fi dipinte da codice, piccole (PS1): pannelli d'acciaio blu-grigi,
// lamiera zigrinata, soffitti con griglie, portelloni con strisce di pericolo.
// Palette FREDDA; il caldo solo come accento (giallo/nero, arancio).
// Ogni texture copre una "piastrella" del mondo: la misura in metri e' in TILE.

import * as THREE from 'three';

export const TILE = {
  wall: [2, 1.5],
  floor: [2, 2],
  ceil: [2, 2],
  door: [1, 2.4],   // un'anta intera
  trim: [1, 1],
  hazard: [0.5, 0.5],
};

// generatore pseudo-casuale con seme: le texture escono uguali a ogni avvio
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  paint(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter; // pixel netti, niente sfarfallio da lontano
  return tex;
}

const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

// rumore fine su tutta la superficie (sporco, usura)
function grime(g, w, h, rand, amount = 10) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// pannello smussato: bordo chiaro in alto/sinistra, scuro in basso/destra
function bevel(g, x, y, w, h, base, lift = 22) {
  const [r, gg, b] = base;
  g.fillStyle = rgb(r, gg, b);
  g.fillRect(x, y, w, h);
  g.fillStyle = rgb(r + lift, gg + lift, b + lift);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = rgb(r - lift, gg - lift, b - lift);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x + w - 1, y, 1, h);
}

function rivet(g, x, y) {
  g.fillStyle = '#c9d2da';
  g.fillRect(x, y, 1, 1);
  g.fillStyle = '#39414a';
  g.fillRect(x + 1, y + 1, 1, 1);
}

export function makeTextures() {
  // Stile System Shock (remake 2023): superfici scure con un tono viola, e dentro le
  // texture pixel che brillano da soli (mappe *Glow = emissive): schermini verdi, LED magenta.
  const G = '#3dff8a', M = '#ff3bd4';

  // --- muro: due pannelli, uno con uno schermino verde, fascia bassa con LED magenta ---
  const wall = canvasTex(64, 48, (g, w, h) => {
    const rand = rng(11);
    g.fillStyle = '#16141e';
    g.fillRect(0, 0, w, h);
    bevel(g, 1, 1, 30, 30, [74, 70, 92], 18);
    bevel(g, 33, 1, 30, 30, [66, 63, 84], 18);
    bevel(g, 1, 33, 62, 14, [44, 42, 58], 14); // fascia bassa piu' scura
    for (const [x, y] of [[3, 3], [28, 3], [3, 28], [28, 28], [35, 3], [60, 3], [35, 28], [60, 28]]) rivet(g, x, y);
    g.fillStyle = '#0a1a12';
    g.fillRect(38, 6, 20, 16); // schermino spento (le righe accese sono nella mappa glow)
    g.fillStyle = '#26242f';
    for (let i = 0; i < 4; i++) g.fillRect(6, 16 + i * 3, 16, 1); // feritoie
    g.fillStyle = '#1c1a24';
    for (let x = 6; x < 60; x += 6) g.fillRect(x, 40, 3, 4);
    grime(g, w, h, rand, 10);
  });
  const wallGlow = canvasTex(64, 48, (g) => {
    const rand = rng(12);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = G;
    for (let y = 8; y < 21; y += 2) g.fillRect(40, y, 4 + Math.floor(rand() * 14), 1); // righe di codice
    g.fillStyle = '#1a6a3c';
    g.fillRect(38, 6, 20, 1);
    g.fillStyle = M;
    for (let x = 4; x < 62; x += 4) g.fillRect(x, 36, 2, 1); // LED magenta della fascia
    g.fillStyle = G;
    g.fillRect(8, 8, 2, 2); // spia verde
  });

  // --- pavimento: lamiera zigrinata scura a piastre da 1 m con bulloni ---
  const floor = canvasTex(64, 64, (g, w, h) => {
    const rand = rng(23);
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const x0 = px * 32, y0 = py * 32;
        bevel(g, x0, y0, 32, 32, [40, 40, 50], 12);
        g.fillStyle = '#34343f';
        for (let y = 3; y < 30; y += 4) {
          for (let x = 3 + ((y >> 2) % 2) * 2; x < 30; x += 4) g.fillRect(x0 + x, y0 + y, 2, 1);
        }
        for (const [x, y] of [[2, 2], [28, 2], [2, 28], [28, 28]]) rivet(g, x0 + x, y0 + y);
      }
    }
    grime(g, w, h, rand, 12);
  });

  // --- soffitto: pannelli scuri, la griglia di aerazione brilla di magenta ---
  const ceil = canvasTex(64, 64, (g, w, h) => {
    const rand = rng(37);
    bevel(g, 0, 0, 64, 64, [46, 44, 58], 12);
    bevel(g, 20, 20, 24, 24, [30, 28, 40], -10);
    for (const [x, y] of [[3, 3], [59, 3], [3, 59], [59, 59]]) rivet(g, x, y);
    grime(g, w, h, rand, 8);
  });
  const ceilGlow = canvasTex(64, 64, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#7a1c66';
    for (let i = 22; i < 42; i += 3) g.fillRect(22, i, 20, 1);
  });

  // --- anta del portellone: pannello chiaro, scanalature, chevron in basso ---
  const door = canvasTex(32, 64, (g, w, h) => {
    const rand = rng(41);
    bevel(g, 0, 0, 32, 64, [92, 88, 110], 18);
    g.fillStyle = '#4a4760';
    g.fillRect(4, 8, 24, 1);
    g.fillRect(4, 40, 24, 1);
    bevel(g, 6, 12, 20, 24, [78, 74, 96], -12);
    // strisce di pericolo in fondo
    for (let x = -8; x < 40; x += 8) {
      g.fillStyle = '#e8b818';
      g.beginPath();
      g.moveTo(x, 64); g.lineTo(x + 4, 64); g.lineTo(x + 10, 52); g.lineTo(x + 6, 52);
      g.fill();
    }
    g.fillStyle = '#1b1b1b';
    g.globalCompositeOperation = 'destination-over';
    g.fillRect(0, 52, 32, 12);
    g.globalCompositeOperation = 'source-over';
    grime(g, w, h, rand, 10);
  });

  const doorGlow = canvasTex(32, 64, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 32, 64);
    g.fillStyle = G;
    g.fillRect(1, 10, 1, 30); // fessure luminose sui due bordi dell'anta
    g.fillRect(30, 10, 1, 30);
  });

  // --- metallo scuro per cornici, costole, colonne ---
  const trim = canvasTex(32, 32, (g, w, h) => {
    const rand = rng(53);
    bevel(g, 0, 0, 32, 32, [44, 42, 56], 14);
    for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]]) rivet(g, x, y);
    grime(g, w, h, rand, 10);
  });

  // --- strisce di pericolo gialle e nere ---
  const hazard = canvasTex(16, 16, (g) => {
    g.fillStyle = '#181818';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#e0b020';
    for (let i = -16; i < 16; i += 8) {
      g.beginPath();
      g.moveTo(i, 16); g.lineTo(i + 4, 16); g.lineTo(i + 20, 0); g.lineTo(i + 16, 0);
      g.fill();
    }
  });

  return { wall, floor, ceil, door, trim, hazard, wallGlow, ceilGlow, doorGlow };
}

// Legno da locanda vichinga (stanza di Races of Valheim): assi verticali per i muri,
// tavole per pavimento e soffitto. Stesse regole: piccole, seme fisso, pixel netti.
export function makeWoodTextures() {
  const planks = (seed, base, vertical) => canvasTex(64, 64, (g, w, h) => {
    const rand = rng(seed);
    const n = 4; // quattro assi per piastrella
    for (let i = 0; i < n; i++) {
      const tone = (rand() - 0.5) * 26;
      const c = base.map((v) => v + tone);
      const x0 = (i * w) / n;
      g.fillStyle = rgb(...c);
      if (vertical) g.fillRect(x0, 0, w / n, h); else g.fillRect(0, x0, w, h / n);
      // venature
      g.fillStyle = rgb(...c.map((v) => v - 18));
      for (let k = 0; k < 6; k++) {
        const p = x0 + 2 + rand() * (w / n - 4);
        const a = rand() * h, len = 8 + rand() * 30;
        if (vertical) g.fillRect(p, a, 1, len); else g.fillRect(a, p, len, 1);
      }
      // nodo
      if (rand() < 0.6) {
        g.fillStyle = rgb(...c.map((v) => v - 34));
        const p = x0 + 4 + rand() * (w / n - 8), a = rand() * (h - 4);
        if (vertical) g.fillRect(p, a, 3, 2); else g.fillRect(a, p, 2, 3);
      }
      // fuga scura fra le assi e chiodi
      g.fillStyle = rgb(...base.map((v) => v - 50));
      if (vertical) g.fillRect(x0, 0, 1, h); else g.fillRect(0, x0, w, 1);
      g.fillStyle = '#2a2420';
      for (const a of [6, h - 8]) {
        const p = x0 + w / n / 2;
        if (vertical) g.fillRect(p, a, 1, 1); else g.fillRect(a, p, 1, 1);
      }
    }
    grime(g, w, h, rand, 10);
  });
  return {
    wall: planks(61, [104, 72, 46], true),
    floor: planks(67, [86, 60, 40], false),
    ceil: planks(71, [70, 50, 34], false),
  };
}

// UV nello spazio del mondo: la texture scorre continua da un pezzo all'altro.
// Per ogni faccia del box si proietta sul piano perpendicolare alla sua normale.
// offset = posizione del box (nel suo genitore), tile = [larghezza, altezza] in metri.
export function worldUV(geo, offset, tile) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x, y = pos.getY(i) + offset.y, z = pos.getZ(i) + offset.z;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    let u, v;
    if (ny > 0.5) { u = x / tile[0]; v = z / tile[1]; }
    else if (nx > 0.5) { u = z / tile[0]; v = y / tile[1]; }
    else { u = x / tile[0]; v = y / tile[1]; }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}
