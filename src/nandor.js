// Nandor: il volto scansionato (3D Snap su iPhone) nell'ologramma al centro dell'atrio.
// Stessa scansione e stesso shader della pagina SHODAN (Desktop\...\Shodan\shodan.js),
// adattati al museo: scala da ologramma, niente post-processing (ci pensa lo strato
// PS1), la testa si gira lentamente verso il visitatore.

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const BASE = import.meta.env.BASE_URL + 'nandor/';

// Punti di riferimento sulla scansione (coordinate dell'OBJ, presi a raycast nella
// pagina SHODAN). La scansione guarda di traverso: la terna occhi/mento la raddrizza.
const LM = {
  eyeL:  [-0.1206, 0.2337, 0.0043],   // occhio a sinistra dello schermo (il destro di Nandor)
  eyeR:  [-0.0731, 0.2332, 0.0576],
  mouth: [-0.1089, 0.1634, 0.0446],
  mouthL:[-0.1238, 0.1616, 0.0218],
  mouthR:[-0.0868, 0.1631, 0.0582],
  chin:  [-0.0927, 0.1099, 0.0319],
};
const SCALE = 10;

const v3 = (a) => new THREE.Vector3(...a);
const eyeL = v3(LM.eyeL), eyeR = v3(LM.eyeR), chin = v3(LM.chin);
const eyeMid = eyeL.clone().add(eyeR).multiplyScalar(0.5);
const right = eyeR.clone().sub(eyeL).normalize();
let up = eyeMid.clone().sub(chin).normalize();
const forward = new THREE.Vector3().crossVectors(right, up).normalize();
up = new THREE.Vector3().crossVectors(forward, right).normalize();
const pivot = eyeMid.clone().lerp(v3(LM.mouth), 0.45).addScaledVector(forward, -0.07);
// matrice scansione -> spazio locale: x verso la guancia SINISTRA di Nandor, y su, z avanti
export const TO_LOCAL = new THREE.Matrix4().makeBasis(right, up, forward).transpose()
  .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
  .premultiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE));
const L = (k) => v3(LM[k]).applyMatrix4(TO_LOCAL);
const mouthC = L('mouth');
const eyeLl = L('eyeL'), eyeRl = L('eyeR'), chinL = L('chin');

const COMMON = /* glsl */`
  uniform float uTime, uOpen, uWide, uRound, uGlitch, uTalk, uMouthW;
  uniform vec3 uMouth, uEyeL, uEyeR;
  uniform vec2 uFaceC, uFaceR;
  float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float faceEdge(vec3 p) {
    vec2 e = (p.xy - uFaceC) / uFaceR;
    float a = atan(e.y, e.x);
    float wob = vnoise(vec2(a * 3.0, uTime * 0.6)) * 0.10 + vnoise(vec2(a * 11.0, uTime * 1.7)) * 0.05;
    return length(e) + wob;
  }
`;

// bocca (per quando parlera') e glitch a fasce orizzontali
const DEFORM = /* glsl */`
  vec3 deform(vec3 p, out float cav, out float shift) {
    vec3 d = p - uMouth;
    float lat = 1.0 - smoothstep(uMouthW * 0.8, uMouthW * 2.3, abs(d.x));
    float t = smoothstep(0.03, -0.03, d.y);
    float neck = 1.0 - smoothstep(0.9, 1.6, -d.y);
    float jaw = t * lat * neck;
    vec3 o = vec3(0.0);
    o.y -= uOpen * 0.17 * jaw;
    o.z -= uOpen * 0.07 * jaw;
    cav = uOpen * lat * (1.0 - abs(2.0 * t - 1.0)) * (1.0 - smoothstep(uMouthW * 0.9, uMouthW * 1.2, abs(d.x)));
    float fr = floor(uTime * 14.0);
    float band = floor(p.y * 9.0 + h11(fr) * 7.0);
    float r = h21(vec2(band, fr));
    shift = 0.0;
    if (r > 1.0 - uGlitch * 0.4) {
      shift = h21(vec2(band * 1.7, fr + 3.1)) - 0.5;
      o.x += shift * 0.45 * uGlitch;
      o.z += shift * 0.12 * uGlitch;
    }
    return p + o;
  }
`;

// Distorsione forte SOLO vicino al bordo del volto (richiesta dell'autore): il centro
// (occhi, naso, bocca) resta fermo, il contorno ondeggia, si gonfia e si strappa a fasce.
const EDGE_WARP = /* glsl */`
  uniform float uWarp, uEdgeW;
  attribute float aEdge; // distanza del vertice dal bordo VERO della scansione
  vec3 edgeWarp(vec3 p, vec3 rest, out float k) {
    float e = faceEdge(rest);
    // peso: vicino al bordo della mesh (tutto intorno, qualunque forma abbia) o fuori
    // dall'ellisse del viso. Il centro resta fermo.
    k = max(smoothstep(0.55, 1.0, e), 1.0 - smoothstep(0.0, uEdgeW, aEdge));
    vec2 dir = normalize(rest.xy - uFaceC + 1e-4);
    float ang = atan(dir.y, dir.x);
    float n1 = vnoise(vec2(ang * 4.0, uTime * 1.3 + rest.y * 1.5));
    float n2 = vnoise(vec2(rest.y * 5.0 - uTime * 2.6, rest.x * 5.0 + uTime));
    p.xy += dir * k * (n1 - 0.25) * 0.45 * uWarp;          // il contorno si gonfia e respira
    p.x  += k * (n2 - 0.5) * 0.35 * uWarp;                  // ondeggia di lato
    p.z  += k * (n1 - 0.5) * 0.4 * uWarp;
    float fr = floor(uTime * 11.0);
    float band = floor(rest.y * 12.0 + h11(fr) * 5.0);
    if (h21(vec2(band, fr)) > 0.72) p.x += k * (h21(vec2(band * 3.1, fr + 1.7)) - 0.5) * 0.9 * uWarp; // strappi
    return p;
  }
`;

const FACE_VERT = COMMON + DEFORM + EDGE_WARP + /* glsl */`
  varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying vec2 vUv; varying float vCav; varying float vShift; varying float vWarp;
  void main() {
    float cav, shift, k;
    vec3 p = edgeWarp(deform(position, cav, shift), position, k);
    vLocal = position; vCav = cav; vShift = shift; vUv = uv; vWarp = k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FACE_FRAG = COMMON + /* glsl */`
  uniform sampler2D uMap;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying vec2 vUv; varying float vCav; varying float vShift; varying float vWarp;
  void main() {
    float edge = faceEdge(vLocal);
    float pix = h21(floor(gl_FragCoord.xy) + floor(uTime * 9.0));
    if (edge > 1.0 - pix * 0.45 * smoothstep(0.7, 1.0, edge)) discard; // bordo che si disfa a pixel

    vec3 tex = texture2D(uMap, vUv).rgb;
    float lum = dot(tex, vec3(0.299, 0.587, 0.114));
    lum = pow(clamp((lum - 0.05) * 1.7, 0.0, 1.0), 0.85);
    vec3 col = mix(vec3(0.0, 0.015, 0.008), vec3(0.02, 0.42, 0.18), smoothstep(0.0, 0.55, lum));
    col = mix(col, vec3(0.45, 1.0, 0.62), smoothstep(0.55, 1.0, lum));

    vec3 N = normalize(vN), V = normalize(vView);
    if (!gl_FrontFacing) N = -N;
    float lit = max(dot(N, normalize(vec3(-0.45, 0.6, 0.65))), 0.0);
    col *= 0.45 + 0.85 * lit;
    col += vec3(0.05, 0.85, 0.75) * pow(1.0 - abs(dot(N, V)), 2.4) * 0.8;

    vec2 cell = floor(vLocal.xy * 5.0 + vec2(0.0, floor(uTime * 0.7)));
    float patchy = step(0.9 - smoothstep(0.5, 0.95, edge) * 0.55, h21(cell));
    vec2 g = abs(fract(vLocal.xy * 18.0) - 0.5);
    float grid = smoothstep(0.44, 0.49, max(g.x, g.y));
    float trace = smoothstep(0.47, 0.5, abs(fract(vLocal.y * 6.0 + h21(vec2(cell.x, 9.0)) * 3.0) - 0.5)) * step(0.5, h21(cell + 4.0));
    col = mix(col, col * 0.3 + vec3(0.0, 0.06, 0.03), patchy * 0.6);
    col += vec3(0.2, 1.0, 0.55) * (grid * 0.5 + trace) * patchy;

    float sweep = exp(-pow(fract(vLocal.y * 0.22 - uTime * 0.28) - 0.5, 2.0) * 900.0);
    col += vec3(0.15, 1.0, 0.55) * sweep * 0.7;

    float el = length(vLocal - uEyeL), er = length(vLocal - uEyeR);
    float eg = exp(-el * el / 0.006) + exp(-er * er / 0.006);
    float core = exp(-el * el / 0.0012) + exp(-er * er / 0.0012);
    float pulse = 0.85 + 0.15 * sin(uTime * 5.0) + uTalk * 0.5;
    col += vec3(0.3, 1.0, 0.6) * eg * 1.4 * pulse + vec3(0.9, 1.0, 0.95) * core * 2.2 * pulse;

    col = mix(col, vec3(0.0, 0.03, 0.015), clamp(vCav * 4.0, 0.0, 1.0));
    if (vWarp > 0.6 && pix < (vWarp - 0.6) * 1.6) discard; // il bordo vero si disfa a pixel
    col += vec3(0.25, 1.0, 0.65) * max(smoothstep(0.7, 1.0, edge), vWarp * vWarp) * (0.5 + pix * 1.3);
    // lampi magenta/ciano solo dove il bordo e' distorto
    float flick = step(0.93, h21(floor(vLocal.xy * 9.0) + floor(uTime * 12.0)));
    col += mix(vec3(1.0, 0.15, 0.8), vec3(0.1, 0.9, 1.0), step(0.5, pix)) * flick * vWarp * 0.9;
    col += mix(vec3(1.0, 0.1, 0.7), vec3(0.1, 0.9, 1.0), step(0.0, vShift)) * abs(vShift) * uGlitch * 2.5;

    // un ologramma non ha parti nere solide: nel bordo distorto i pixel scuri spariscono
    if (vWarp > 0.25 && dot(col, vec3(0.333)) < 0.07) discard;
    // colori pensati come valori a schermo: in lineare per il render target PS1
    gl_FragColor = vec4(pow(max(col, 0.0), vec3(2.2)), 1.0);
  }
`;

// Niente fil di ferro qui (nella pagina SHODAN c'e'): a 240 righe le sue diecimila
// linee si sommano in ogni pixel e coprono il volto di verde pieno.

const POINT_VERT = COMMON + DEFORM + EDGE_WARP + /* glsl */`
  attribute float aRnd;
  varying float vA;
  void main() {
    float cav, shift, k;
    vec3 p = edgeWarp(deform(position, cav, shift), position, k);
    float edge = faceEdge(position);
    float fly = max(smoothstep(0.75, 1.0, edge), k * k);
    float life = fract(uTime * (0.12 + aRnd * 0.2) + aRnd * 7.0);
    vec2 dir = normalize(position.xy - uFaceC + 1e-4);
    p.xy += dir * fly * life * (0.5 + aRnd * 1.2);
    p.z += fly * life * (aRnd - 0.3) * 0.8;
    // solo le particelle che volano via dal bordo: quelle ferme sul volto a 240 righe sono rumore
    vA = fly * (1.0 - life) * step(edge, 1.3 + life) * step(0.55, aRnd) * 0.7;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = 1.0 + aRnd * 1.5; // pixel del render target a 240 righe
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */`
  varying float vA;
  void main() {
    if (vA < 0.01) discard;
    gl_FragColor = vec4(pow(vec3(0.3, 1.0, 0.65) * vA, vec3(2.2)), 1.0);
  }
`;

// Attributo aEdge: per ogni vertice la distanza dal bordo aperto della scansione (lati che
// appartengono a un solo triangolo). I buchi interni vicino al centro del viso (occhi,
// narici, se ci sono) non contano, se no si distorcerebbe anche il centro.
function edgeDistance(geo, faceC, faceR) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const ids = new Int32Array(n);
  const uniq = [];
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const key = pos.getX(i).toFixed(4) + ',' + pos.getY(i).toFixed(4) + ',' + pos.getZ(i).toFixed(4);
    let id = map.get(key);
    if (id === undefined) { id = uniq.length; map.set(key, id); uniq.push(i); }
    ids[i] = id;
  }
  const edges = new Map();
  const idx = geo.index ? geo.index.array : null;
  const tri = idx ? idx.length / 3 : n / 3;
  for (let t = 0; t < tri; t++) {
    const v = [0, 1, 2].map((j) => ids[idx ? idx[t * 3 + j] : t * 3 + j]);
    for (let j = 0; j < 3; j++) {
      const a = v[j], b = v[(j + 1) % 3];
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const border = new Set();
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    border.add(Math.floor(key / 1e6));
    border.add(key % 1e6);
  }
  const bx = [], by = [], bz = [];
  for (const id of border) {
    const i = uniq[id];
    const ex = (pos.getX(i) - faceC.x) / faceR.x, ey = (pos.getY(i) - faceC.y) / faceR.y;
    if (Math.hypot(ex, ey) < 0.55) continue; // buco interno: ignorato
    bx.push(pos.getX(i)); by.push(pos.getY(i)); bz.push(pos.getZ(i));
  }
  const distU = new Float32Array(uniq.length);
  for (let u = 0; u < uniq.length; u++) {
    const i = uniq[u];
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let best = Infinity;
    for (let b = 0; b < bx.length; b++) {
      const d = (x - bx[b]) ** 2 + (y - by[b]) ** 2 + (z - bz[b]) ** 2;
      if (d < best) best = d;
    }
    distU[u] = Math.sqrt(best);
  }
  const aEdge = new Float32Array(n);
  for (let i = 0; i < n; i++) aEdge[i] = distU[ids[i]];
  geo.setAttribute('aEdge', new THREE.BufferAttribute(aEdge, 1));
  return { border: border.size, used: bx.length, verts: uniq.length };
}

// Carica la scansione nell'ologramma. y = altezza del centro della testa, size = altezza
// del volto in metri. getViewer() -> { x, z } del visitatore, per girarsi verso di lui.
export function buildNandor(ctx, { y = 2.05, size = 0.62, getViewer } = {}) {
  const U = {
    uTime: { value: 0 }, uOpen: { value: 0 }, uWide: { value: 0 }, uRound: { value: 0 },
    uGlitch: { value: 0.1 }, uTalk: { value: 0 }, uWarp: { value: 1 }, uEdgeW: { value: 0.5 },
    uMouth: { value: mouthC }, uMouthW: { value: L('mouthL').distanceTo(L('mouthR')) * 0.5 },
    uEyeL: { value: eyeLl }, uEyeR: { value: eyeRl },
    uFaceC: { value: new THREE.Vector2() }, uFaceR: { value: new THREE.Vector2(1, 1) },
    uMap: { value: null },
  };
  const head = new THREE.Group();
  head.position.y = y;
  ctx.group.add(head);

  const tex = new THREE.TextureLoader().load(BASE + 'diffuse.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  U.uMap.value = tex;

  new OBJLoader().load(BASE + 'face.obj', (obj) => {
    let geo = null;
    obj.traverse((m) => { if (m.isMesh) geo = m.geometry; });
    geo.applyMatrix4(TO_LOCAL);
    const top = eyeLl.y + (eyeLl.y - chinL.y) * 0.62;
    const bottom = chinL.y - 0.28;
    U.uFaceC.value.set((eyeLl.x + eyeRl.x) * 0.5, (top + bottom) * 0.5);
    U.uFaceR.value.set(Math.abs(eyeRl.x - eyeLl.x) * 1.45, (top - bottom) * 0.5);
    head.scale.setScalar(size / (top - bottom));
    U.uEdgeW.value = (top - bottom) * 0.2; // fascia distorta: 20% dell'altezza del viso
    edgeDistance(geo, U.uFaceC.value, U.uFaceR.value);

    const face = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: U, vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, side: THREE.DoubleSide,
    }));
    const rnd = new Float32Array(geo.attributes.position.count);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', geo.attributes.position);
    pgeo.setAttribute('normal', geo.attributes.normal);
    pgeo.setAttribute('aEdge', geo.attributes.aEdge);
    pgeo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    const points = new THREE.Points(pgeo, new THREE.ShaderMaterial({
      uniforms: U, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    head.add(face, points);
    ctx.onCreate(head); // snapping PS1 e gestione dei trasparenti
  });

  let yaw = 0;
  let voice = 0; // livello della voce, lo imposta setVoice()
  let last = 0;
  ctx.updaters.push((t) => {
    const dt = Math.min(t - last, 0.1);
    last = t;
    U.uTime.value = t;
    // bocca e occhi seguono la voce (salita rapida, discesa piu' morbida)
    const want = Math.min(1, Math.max(0, (voice - 0.02) * 5));
    U.uOpen.value += (want - U.uOpen.value) * Math.min(1, dt * (want > U.uOpen.value ? 30 : 12));
    U.uTalk.value = U.uOpen.value;
    // ogni tanto un glitch piu' forte
    U.uGlitch.value = 0.1 + (Math.sin(t * 0.7) > 0.97 ? 0.6 : 0);
    head.position.y = y + Math.sin(t * 1.3) * 0.03;
    if (getViewer) {
      const v = getViewer();
      const want = Math.atan2(v.x - head.position.x, v.z - head.position.z);
      let d = want - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 1.5);
      head.rotation.y = yaw;
    }
  });
  return { head, setVoice: (level) => { voice = level; } };
}
