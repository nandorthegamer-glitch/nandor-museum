// Pacchetti di modelli esportati dai progetti Unity (vedi tools/vampaladin-export.mjs):
// un .json con l'indice e un .bin con posizioni, normali, colori e indici.

import * as THREE from 'three';

const cache = new Map();

// jsonUrl del .json; resolve(nomeFile) -> URL del .bin nominato dentro il .json.
// Restituisce una Promise di { names, get(name) -> BufferGeometry condivisa, meta(name) }
export function loadPack(jsonUrl, resolve) {
  if (cache.has(jsonUrl)) return cache.get(jsonUrl);
  const p = fetch(jsonUrl).then((r) => r.json())
    .then((index) => fetch(resolve(index.bin)).then((r) => r.arrayBuffer()).then((bin) => [index, bin]))
    .then(([index, bin]) => {
      const geos = new Map();
      const build = (name) => {
        const m = index.meshes[name];
        if (!m) throw new Error('mesh mancante: ' + name);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, m.pos, m.vertices * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin, m.nor, m.vertices * 3), 3));
        // colori RGBA -> RGB
        const rgba = new Float32Array(bin, m.col, m.vertices * 4);
        const rgb = new Float32Array(m.vertices * 3);
        for (let i = 0; i < m.vertices; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, m.idx, m.indices), 1));
        if (m.uv !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, m.uv, m.vertices * 2), 2));
        // gruppi per materiale (pacchetti con materials: indice nella lista del pacchetto)
        for (const gr of m.groups || []) g.addGroup(gr.start, gr.count, gr.mat);
        return g;
      };
      return {
        names: Object.keys(index.meshes),
        materials: index.materials || [],
        meta: (name) => index.meshes[name],
        get: (name) => {
          if (!geos.has(name)) geos.set(name, build(name));
          return geos.get(name);
        },
      };
    });
  cache.set(jsonUrl, p);
  return p;
}
