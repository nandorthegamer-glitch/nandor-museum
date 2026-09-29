// Stile ASCII di Angrii City: oggetti disegnati a caratteri colorati su fondo scuro, come
// nel gioco (celle a schermo, carattere scelto dalla luce: da . a @). Vanno sul layer CRISP
// (piena risoluzione, fuori dal PS1), se no le lettere si impasterebbero a 240 righe.

import * as THREE from 'three';
import { CRISP } from './psx.js';

export const RAMP = ' .:-=+*%#@';

let atlas = null;
function glyphAtlas() {
  if (atlas) return atlas;
  const W = 32, H = 48;
  const c = document.createElement('canvas');
  c.width = W * RAMP.length;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = `bold ${H * 0.8}px Consolas, "Courier New", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...RAMP].forEach((ch, i) => g.fillText(ch, i * W + W / 2, H / 2 + 2));
  atlas = new THREE.CanvasTexture(c);
  atlas.minFilter = THREE.LinearFilter;
  atlas.generateMipmaps = false;
  return atlas;
}

// color: colore sRGB dell'oggetto (oppure vertexColors: attributo "acol", RGB 0..1)
export function asciiMaterial({ color = '#3dff8a', vertexColors = false, cell = 9 } = {}) {
  const dpr = Math.min(devicePixelRatio, 2);
  return new THREE.ShaderMaterial({
    defines: vertexColors ? { USE_ACOL: '' } : {},
    uniforms: {
      uAtlas: { value: glyphAtlas() },
      uCell: { value: new THREE.Vector2(cell * dpr, cell * 1.5 * dpr) },
      // valori sRGB cosi' come sono: lo shader scrive direttamente il colore a schermo
      uColor: { value: new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace) },
      uGlyphs: { value: RAMP.length },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vCol;
      uniform vec3 uColor;
      #ifdef USE_ACOL
      attribute vec3 acol;
      #endif
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        #ifdef USE_ACOL
        vCol = acol;
        #else
        vCol = uColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform vec2 uCell;
      uniform float uGlyphs;
      varying vec3 vN;
      varying vec3 vCol;
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float l = 0.34 + 0.6 * max(dot(n, normalize(vec3(0.35, 0.85, 0.4))), 0.0)
                      + 0.25 * max(dot(n, normalize(vec3(-0.6, 0.2, -0.5))), 0.0);
        l = clamp(l, 0.0, 0.999);
        float idx = floor(pow(l, 0.8) * uGlyphs);
        vec2 f = fract(gl_FragCoord.xy / uCell);
        f.y = 1.0 - f.y;
        float m = texture2D(uAtlas, vec2((idx + f.x) / uGlyphs, f.y)).r;
        vec3 col = min(vCol * (0.75 + 0.7 * l), vec3(1.0));
        // un velo del colore dietro i caratteri: la sagoma si legge anche fra una lettera e l'altra
        gl_FragColor = vec4(mix(vCol * 0.1 + vec3(0.008, 0.014, 0.011), col, m), 1.0);
      }`,
  });
}

// Mette un oggetto (e i figli) sul layer CRISP, dove il materiale ASCII resta nitido
export function crisp(obj) {
  obj.traverse((o) => o.layers.set(CRISP));
  return obj;
}

// Pareti, pavimento e soffitto della stanza: griglie di caratteri tenui su fondo scuro,
// come la citta' del gioco vista da vicino
let wallCache = null;
export function asciiRoomMats() {
  if (wallCache) return wallCache;
  const make = (seed, density, palette, bg) => {
    const N = 8, S = 512, cw = S / N, ch = S / N;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    g.font = `bold ${ch * 0.78}px Consolas, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let r = seed;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (rnd() > density) continue;
        const k = Math.floor(rnd() * RAMP.length);
        g.fillStyle = palette[Math.floor(rnd() * palette.length)];
        g.fillText(RAMP[k] === ' ' ? '.' : RAMP[k], x * cw + cw / 2, y * ch + ch / 2);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const mat = (t, tint) => {
    const m = new THREE.MeshLambertMaterial({ map: t, color: tint, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
    m.userData.tile = [2.4, 2.4];
    return m;
  };
  const wall = make(7, 0.55, ['#1f5a3a', '#2c7a4e', '#1a3a4a', '#3dff8a', '#16402c'], '#07100c');
  const floor = make(11, 0.22, ['#1c3a2a', '#24503a', '#303830'], '#050806');
  const ceil = make(23, 0.25, ['#16302a', '#1c3a40'], '#040706');
  return (wallCache = { wall: mat(wall, 0xffffff), floor: mat(floor, 0xcfd8d0), ceil: mat(ceil, 0x8a9a90) });
}
