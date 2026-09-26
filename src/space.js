// Lo spazio fuori dalla stazione: stelle, pianeta (finestra ovest), luna (finestra est)
// e piccole navi che passano davanti alle finestre ogni tanto.
// Si vede solo dai finestroni dell'atrio: tutto il resto e' chiuso.

import * as THREE from 'three';
import { psxTexture } from './psx.js';

const SUN = new THREE.Vector3(0.35, 0.45, -0.82).normalize();

// il pianeta e' lontano (170 m) perche' il suo anello non tagli la corsia delle navi
const PLANET = { pos: new THREE.Vector3(-170, 10, 13), r: 60, tilt: 0.12, lean: 0.18 };
const MOON = { pos: new THREE.Vector3(138, 18, -12), r: 13 };

export function buildSpace(ctx) {
  const group = new THREE.Group();
  ctx.group.add(group);
  buildStars(group);
  const planet = buildPlanet(group);
  const moon = buildMoon(group);
  const ships = new ShipTraffic(group, ctx.onCreate);

  let last = 0;
  ctx.updaters.push((t) => {
    const dt = Math.min(t - last, 0.1);
    last = t;
    planet.rotation.y = t * 0.004;
    planet.userData.clouds.rotation.y = t * 0.0065;
    moon.rotation.y = t * 0.002;
    ships.update(t, dt);
  });
}

// ------------------------------------------------------------------ stelle

function buildStars(group) {
  const N = 2500, R = 500;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * R, u * R, Math.sin(a) * s * R], i * 3);
    const b = 0.35 + Math.random() ** 3 * 0.65;
    const warm = Math.random() < 0.2;
    col.set(warm ? [b, b * 0.85, b * 0.7] : [b * 0.85, b * 0.92, b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  group.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true })));
}

// ------------------------------------------------------------------ rumore 3D

function hash(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (v) => v * v * (3 - 2 * v);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x, y, z, oct = 5) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += noise(x, y, z) * a;
    n += a;
    x *= 2.03; y *= 2.03; z *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

// Texture equirettangolare: pixel(dir, lat) -> [r, g, b, a] (0-255), senza cuciture
// perche' il rumore e' campionato sulla sfera. Stessa mappatura UV di SphereGeometry.
function sphereTexture(W, H, pixel) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const th = ((y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const ph = ((x + 0.5) / W) * Math.PI * 2;
      const d = [-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)];
      img.data.set(pixel(d, d[1]), (y * W + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = psxTexture(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ materiali

// Illuminato solo dal "sole" (non dalle luci della stazione), terminatore morbido
function litMaterial(map, { transparent = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, sun: { value: SUN } },
    transparent,
    depthWrite: !transparent,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec2 vUv;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 sun;
      varying vec3 vN; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        float d = dot(normalize(vN), sun);
        float light = 0.035 + smoothstep(-0.12, 0.35, d) * 1.05;
        gl_FragColor = vec4(c.rgb * light, c.a);
        #include <colorspace_fragment>
      }`,
  });
}

// Alone dell'atmosfera: bordo luminoso piu' forte sul lato illuminato
function atmosphereMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { sun: { value: SUN }, color: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sun; uniform vec3 color;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.5);
        float lit = 0.15 + smoothstep(-0.3, 0.6, dot(normalize(vN), sun));
        gl_FragColor = vec4(color * rim * lit, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ pianeta

function buildPlanet(group) {
  // mondo inventato ma con i climi della Terra, e le piante sono VIOLA:
  // foreste pluviali all'equatore, deserti ocra attorno ai 25-30 gradi, foreste
  // temperate piu' su, tundra, poli ghiacciati, montagne rocciose con neve
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const DESERT = [196, 156, 98], SAVANNA = [150, 112, 122], FOREST = [104, 48, 132];
  const JUNGLE = [66, 22, 92], TUNDRA = [128, 116, 128], ROCK = [112, 100, 96], SAND = [206, 188, 140];
  const surface = sphereTexture(512, 256, (d, lat) => {
    const e = fbm(d[0] * 2.2 + 11, d[1] * 2.2, d[2] * 2.2);
    const m = fbm(d[0] * 5 + 40, d[1] * 5, d[2] * 5, 3);
    const a = Math.abs(lat);
    if (a + (m - 0.5) * 0.25 > 0.82) return [228, 236, 240, 255];
    if (e < 0.5) {
      const k = Math.max(0, Math.min(1, (e - 0.3) / 0.2));
      return [12 + 30 * k, 50 + 70 * k, 72 + 60 * k, 255];
    }
    if (e < 0.505) return [...SAND, 255];

    // umidita': rumore + fasce climatiche
    const wet = 0.06 + fbm(d[0] * 3.5 + 23, d[1] * 3.5, d[2] * 3.5, 4)
      + 0.22 * Math.exp(-((lat / 0.2) ** 2))              // equatore piovoso
      - 0.24 * Math.exp(-(((a - 0.44) / 0.12) ** 2))      // fascia dei deserti
      + 0.1 * Math.exp(-(((a - 0.66) / 0.1) ** 2));       // foreste temperate
    let c = wet < 0.46 ? mix(DESERT, SAVANNA, smooth(0.36, 0.46, wet)) : mix(SAVANNA, FOREST, smooth(0.46, 0.54, wet));
    c = mix(c, JUNGLE, smooth(0.6, 0.72, wet));
    c = mix(c, TUNDRA, smooth(0.66, 0.78, a));
    const k = (e - 0.5) / 0.18;                            // quota
    c = mix(c, ROCK, smooth(1.05, 1.35, k));
    c = mix(c, [236, 238, 242], smooth(1.5, 1.6, k));
    const v = 0.9 + (m - 0.5) * 0.35;                      // variazione fine
    return [c[0] * v, c[1] * v, c[2] * v, 255];
  });
  const clouds = sphereTexture(512, 256, (d) => {
    const c = fbm(d[0] * 4 + 70, d[1] * 7, d[2] * 4, 4);
    const a = Math.max(0, Math.min(1, (c - 0.52) / 0.15));
    return [255, 255, 255, a * 220];
  });

  // asse inclinato: il pianeta gira attorno all'asse del gruppo, l'anello sta
  // sul suo equatore e non gira
  const axis = new THREE.Group();
  axis.position.copy(PLANET.pos);
  axis.rotation.set(PLANET.lean, 0, PLANET.tilt);
  group.add(axis);

  const planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET.r, 64, 32), litMaterial(surface));
  axis.add(planet);

  const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET.r * 1.012, 64, 32), litMaterial(clouds, { transparent: true }));
  planet.add(cloudMesh);
  planet.userData.clouds = cloudMesh;

  const atmo = new THREE.Mesh(new THREE.SphereGeometry(PLANET.r * 1.06, 64, 32), atmosphereMaterial(0x60b8ff));
  axis.add(atmo);

  axis.add(buildRing(PLANET.r * 1.3, PLANET.r * 2.05));
  return planet;
}

// Anello: bande di polvere e ghiaccio con una divisione scura, in ombra dove il
// pianeta copre il sole. Le bande sono una texture 1D letta per distanza dal centro.
function buildRing(inner, outer) {
  const W = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 1;
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, 1);
  for (let i = 0; i < W; i++) {
    const t = i / (W - 1);
    let dens = 0.45 + (noise(t * 40, 0.5, 0.5) - 0.5) * 0.6 + (noise(t * 160, 3.5, 1.5) - 0.5) * 0.35;
    if (t > 0.6 && t < 0.66) dens *= 0.08;              // la divisione, quasi vuota
    if (t < 0.18) dens *= 0.35 + (t / 0.18) * 0.65;     // bordo interno sfumato
    if (t > 0.9) dens *= (1 - t) / 0.1;                 // bordo esterno sfumato
    dens = Math.max(0, Math.min(1, dens));
    const warm = noise(t * 12, 7.5, 2.5);
    img.data.set([200 + warm * 40, 180 + warm * 30, 150 + warm * 20, dens * 235], i * 4);
  }
  g.putImageData(img, 0, 0);
  const bands = new THREE.CanvasTexture(canvas);
  bands.colorSpace = THREE.SRGBColorSpace;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 160, 1),
    new THREE.ShaderMaterial({
      uniforms: {
        bands: { value: bands }, sun: { value: SUN }, inner: { value: inner }, outer: { value: outer },
        center: { value: PLANET.pos }, radius: { value: PLANET.r },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec2 vLocal; varying vec3 vWorld;
        void main() {
          vLocal = position.xy;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D bands; uniform vec3 sun; uniform float inner, outer;
        uniform vec3 center; uniform float radius;
        varying vec2 vLocal; varying vec3 vWorld;
        void main() {
          float t = (length(vLocal) - inner) / (outer - inner);
          vec4 c = texture2D(bands, vec2(clamp(t, 0.0, 1.0), 0.5));
          // ombra del pianeta: il raggio verso il sole incontra la sfera?
          vec3 oc = vWorld - center;
          float b = dot(oc, sun);
          float disc = b * b - (dot(oc, oc) - radius * radius);
          float shadow = (b < 0.0 && disc > 0.0) ? 0.06 : 1.0;
          gl_FragColor = vec4(c.rgb * 0.95 * shadow, c.a);
          #include <colorspace_fragment>
        }`,
    }),
  );
  ring.rotation.x = -Math.PI / 2; // RingGeometry sta nel piano xy: lo porto sull'equatore
  return ring;
}

// ------------------------------------------------------------------ luna

function buildMoon(group) {
  const craters = [];
  for (let i = 0; i < 70; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = 0.03 + Math.random() ** 2 * 0.16;
    craters.push({ c: [Math.cos(a) * s, u, Math.sin(a) * s], cos: Math.cos(r), rim: Math.cos(r * 1.25) });
  }
  const surface = sphereTexture(256, 128, (d) => {
    let v = 105 + (fbm(d[0] * 3 + 5, d[1] * 3, d[2] * 3) - 0.5) * 90;
    v += (fbm(d[0] * 14, d[1] * 14, d[2] * 14, 3) - 0.5) * 30;
    // mari scuri
    if (fbm(d[0] * 1.6 + 90, d[1] * 1.6, d[2] * 1.6, 3) > 0.58) v -= 35;
    for (const k of craters) {
      const dot = d[0] * k.c[0] + d[1] * k.c[1] + d[2] * k.c[2];
      if (dot > k.cos) v -= 22;
      else if (dot > k.rim) v += 18;
    }
    v = Math.max(20, Math.min(235, v));
    return [v, v * 0.98, v * 0.95, 255];
  });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON.r, 48, 24), litMaterial(surface));
  moon.position.copy(MOON.pos);
  group.add(moon);
  return moon;
}

// ------------------------------------------------------------------ navi

const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
const glow = (c) => new THREE.MeshBasicMaterial({ color: c });

function part(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Ogni nave e' costruita con il muso verso +z. Restituisce { ship, blink: [luci] }
const SHIP_TYPES = [
  function shuttle() {
    const s = new THREE.Group();
    const hull = lam(0xc8ccd0);
    part(s, 1.2, 0.8, 3.2, 0, 0, 0, hull);
    part(s, 0.9, 0.5, 0.6, 0, 0.2, 1.7, glow(0x6fc8ff));
    part(s, 3.4, 0.12, 1.1, 0, -0.15, -0.5, lam(0x8a9097));
    part(s, 0.8, 0.5, 0.2, 0, 0, -1.7, glow(0xff9a40));
    const blink = [part(s, 0.15, 0.15, 0.15, -1.7, -0.1, -0.5, glow(0xff2020)), part(s, 0.15, 0.15, 0.15, 1.7, -0.1, -0.5, glow(0x20ff40))];
    return { ship: s, blink };
  },
  function freighter() {
    const s = new THREE.Group();
    part(s, 0.8, 0.8, 11, 0, 0, 0, lam(0x6a7076));
    part(s, 1.8, 1.2, 1.6, 0, 0.3, 5.4, lam(0xb0b4ba));
    part(s, 1.2, 0.3, 0.3, 0, 0.55, 6.25, glow(0x6fc8ff));
    const cols = [0xc04030, 0x3070b0, 0xd0a030, 0x508050, 0x909090];
    for (let i = 0; i < 4; i++) {
      for (const sd of [-1, 1]) {
        part(s, 1.3, 1.3, 2.2, sd * 1.05, 0, 3 - i * 2.4, lam(cols[Math.floor(Math.random() * cols.length)]));
      }
    }
    part(s, 0.7, 0.7, 0.3, -0.5, 0, -5.6, glow(0xffb060));
    part(s, 0.7, 0.7, 0.3, 0.5, 0, -5.6, glow(0xffb060));
    const blink = [part(s, 0.2, 0.2, 0.2, 0, 1.0, 5.4, glow(0xffffff))];
    return { ship: s, blink };
  },
  function fighter() {
    const s = new THREE.Group();
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 4), lam(0x9aa0a8));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.6;
    s.add(nose);
    part(s, 0.8, 0.5, 1.4, 0, 0, -1.0, lam(0x80868e));
    const wing = lam(0x5a6068);
    for (const sd of [-1, 1]) {
      const w = part(s, 1.8, 0.08, 1.2, sd * 1.1, 0, -1.0, wing);
      w.rotation.z = sd * -0.25;
    }
    part(s, 0.5, 0.35, 0.15, 0, 0, -1.75, glow(0x60a0ff));
    const blink = [part(s, 0.12, 0.12, 0.12, -1.9, -0.25, -1.0, glow(0xff2020)), part(s, 0.12, 0.12, 0.12, 1.9, -0.25, -1.0, glow(0x20ff40))];
    return { ship: s, blink };
  },
];

class ShipTraffic {
  constructor(group, onCreate) {
    this.group = group;
    this.onCreate = onCreate;
    this.ships = [];
    // una corsia per finestra: ovest (-1) e est (+1). La prima nave arriva presto.
    this.next = { '-1': 3, '1': 9 };
  }

  spawn(side, t) {
    const type = SHIP_TYPES[Math.floor(Math.random() * SHIP_TYPES.length)];
    const { ship, blink } = type();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x = side * (24 + Math.random() * 34);
    const y = -3 + Math.random() * 11;
    const z = -dir * 95;
    ship.position.set(x, y, z);
    ship.rotation.y = dir > 0 ? 0 : Math.PI;
    ship.scale.setScalar(0.8 + Math.random() * 0.5);
    this.group.add(ship);
    this.onCreate(ship);
    this.ships.push({
      ship, blink, dir,
      speed: 6 + Math.random() * 10,
      climb: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * 10,
      born: t,
    });
  }

  update(t, dt) {
    for (const side of ['-1', '1']) {
      if (t >= this.next[side]) {
        this.spawn(Number(side), t);
        this.next[side] = t + 7 + Math.random() * 12;
      }
    }
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      s.ship.position.z += s.dir * s.speed * dt;
      s.ship.position.y += s.climb * dt;
      s.ship.rotation.z = Math.sin(t * 0.7 + s.phase) * 0.08; // lieve rollio
      const on = (t + s.phase) % 1.2 < 0.15;
      for (const b of s.blink) b.visible = on;
      if (Math.abs(s.ship.position.z) > 100) {
        this.group.remove(s.ship);
        s.ship.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        this.ships.splice(i, 1);
      }
    }
  }
}
