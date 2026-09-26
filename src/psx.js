// Strato PS1: la scena si disegna in un render target a bassa risoluzione (240 righe),
// poi si copia sullo schermo senza filtro riducendo i colori a 32 livelli per canale.
// I vertici si agganciano alla griglia dei pixel (il tremolio della PS1).
// Come in Angri/Styx: NIENTE warping affine delle texture; il dithering c'e' ma e' spento.
//
// Eccezione: gli oggetti sul layer CRISP (i pannelli di testo) restano fuori dal PS1.
// Si disegnano dopo, a piena risoluzione e senza tremolio, contro una copia della
// profondita' della scena fatta a piena risoluzione, cosi' restano nascosti dietro
// gli oggetti che li coprono. Il testo di un portfolio deve leggersi.

export const CRISP = 1;
// oggetti trasparenti (fascio e testa dell'ologramma...): dopo i cartelli si
// ridisegnano solo sopra i loro pixel (stencil), cosi' restano davanti al testo
const OVER = 2;

import * as THREE from 'three';

const SNAP_GLSL = /* glsl */`
  if (uPsxSnap > 0.5 && gl_Position.w > 0.0) {
    vec2 g = uPsxRes * 0.5;
    gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g + 0.5) / g * gl_Position.w;
  }
`;

export class PSX {
  constructor(renderer, { height = 240, levels = 32, dither = false } = {}) {
    this.renderer = renderer;
    this.height = height;
    this.enabled = true;
    this.uniforms = {
      uPsxRes: { value: new THREE.Vector2(320, 240) },
      uPsxSnap: { value: 1 },
    };
    this.target = new THREE.WebGLRenderTarget(320, 240, {
      type: THREE.HalfFloatType, // lineare senza bande: la quantizzazione la fa la copia
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });

    this.blit = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        res: { value: this.uniforms.uPsxRes.value },
        levels: { value: levels },
        dither: { value: dither ? 1 : 0 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform vec2 res; uniform float levels, dither;
        varying vec2 vUv;
        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        void main() {
          vec3 c = toSRGB(clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0));
          float n = levels - 1.0;
          float d = dither * (bayer4(floor(vUv * res)) - 0.5);
          gl_FragColor = vec4(floor(c * n + 0.5 + d) / n, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blit);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(width, height) {
    const h = this.height;
    const w = Math.max(1, Math.round((h * width) / height));
    this.target.setSize(w, h);
    this.uniforms.uPsxRes.value.set(w, h);
  }

  toggle(on = !this.enabled) {
    this.enabled = on;
    this.uniforms.uPsxSnap.value = on ? 1 : 0;
  }

  // Aggiunge il vertex snapping a tutti i materiali sotto root (anche agli
  // ShaderMaterial nostri). Da chiamare anche per gli oggetti creati dopo.
  patch(root) {
    root.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      if (o.layers.isEnabled(CRISP)) {
        // i cartelli segnano i loro pixel nello stencil
        for (const m of mats) {
          m.stencilWrite = true;
          m.stencilRef = 1;
          m.stencilFunc = THREE.AlwaysStencilFunc;
          m.stencilZPass = THREE.ReplaceStencilOp;
        }
        return;
      }
      if (mats.some((m) => m.transparent)) {
        (this.see ??= new Set()).add(o);
        o.layers.enable(OVER);
      }
      for (const m of mats) this.patchMaterial(m);
    });
  }

  patchMaterial(m) {
    if (m.userData.psx) return;
    m.userData.psx = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev?.call(m, shader, r);
      shader.uniforms.uPsxRes = this.uniforms.uPsxRes;
      shader.uniforms.uPsxSnap = this.uniforms.uPsxSnap;
      const vs = shader.vertexShader;
      const end = vs.lastIndexOf('}');
      shader.vertexShader = 'uniform vec2 uPsxRes;\nuniform float uPsxSnap;\n' + vs.slice(0, end) + SNAP_GLSL + vs.slice(end);
    };
    m.needsUpdate = true;
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      camera.layers.enable(CRISP);
      r.setRenderTarget(null);
      r.render(scene, camera);
      camera.layers.disable(CRISP);
      return;
    }
    // three converte il colore di sfondo in sRGB anche dentro il render target
    // lineare: lo compenso, se no il nero dello spazio diventa grigio-blu
    const bg = scene.background;
    if (bg?.isColor) scene.background = (this.bgLinear ??= new THREE.Color()).copy(bg).convertSRGBToLinear();
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    scene.background = bg;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);

    // profondita' a piena risoluzione (senza gli oggetti trasparenti: attraverso il
    // vetro o il fascio dell'ologramma i cartelli devono vedersi), poi i pannelli
    const hidden = [];
    for (const o of this.see ?? []) if (o.visible) { o.visible = false; hidden.push(o); }
    this.depthOnly ??= new THREE.MeshBasicMaterial({ colorWrite: false });
    scene.background = null;
    scene.overrideMaterial = this.depthOnly;
    r.autoClear = false;
    r.clearDepth();
    r.clearStencil();
    r.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of hidden) o.visible = true;
    // lo sfondo resta null: con uno sfondo a colore three pulisce lo schermo a ogni
    // render anche con autoClear spento, e cancellerebbe l'immagine PS1
    camera.layers.set(CRISP);
    r.render(scene, camera);

    // trasparenti davanti ai cartelli, solo dove c'e' un cartello (stencil = 1):
    // altrove sono gia' nell'immagine PS1 e non devono raddoppiare
    const mats = [];
    for (const o of this.see ?? []) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.stencilWrite = true;
        m.stencilRef = 1;
        m.stencilFunc = THREE.EqualStencilFunc;
        m.stencilZPass = THREE.KeepStencilOp;
        mats.push(m);
      }
    }
    camera.layers.set(OVER);
    r.render(scene, camera);
    for (const m of mats) m.stencilWrite = false;
    camera.layers.set(0);
    scene.background = bg;
    r.autoClear = true;
  }
}

// Texture in stile PS1: pixel netti quando sono vicine
export function psxTexture(tex) {
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
