// Giocatore in prima persona: WASD + mouse (Pointer Lock), Shift corsa.
// Pavimento sempre a y = 0: niente gravita', collisioni solo sul piano XZ.

const EYE = 1.6;
const RADIUS = 0.3;
const WALK = 4.4;
const RUN = 7.7;
const SENS = 0.0012; // per 1 di sensibilita' (regolabile nel menu, player.sens)
const STEP = 0.1; // passo massimo per sotto-passo: non si attraversano muri da 0,2 m

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.sens = 1;

    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // dragMode: dove il Pointer Lock non e' permesso si guarda trascinando col mouse
    this.dragMode = false;
    this.frozen = false; // true mentre si legge un pannello
    this.cinematic = false; // true mentre un cabinato muove la telecamera
    addEventListener('mousemove', (e) => {
      if (!this.locked || this.frozen || (this.dragMode && !(e.buttons & 1))) return;
      // alcuni browser, col Pointer Lock, mandano ogni tanto un salto enorme: si scarta
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      this.yaw -= e.movementX * SENS * this.sens;
      this.pitch -= e.movementY * SENS * this.sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  get locked() {
    return this.dragMode || document.pointerLockElement === this.dom;
  }

  place(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
  }

  update(dt, boxes) {
    if (this.cinematic) return;
    if (this.locked && !this.frozen) {
      const k = this.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (f || s) {
        const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        // avanti = (-sin, -cos), destra = (cos, -sin)
        let dx = -sin * f + cos * s;
        let dz = -cos * f - sin * s;
        const len = Math.hypot(dx, dz);
        dx *= (speed * dt) / len;
        dz *= (speed * dt) / len;
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP));
        for (let i = 0; i < n; i++) {
          this.x += dx / n;
          this.z += dz / n;
          collide(this, boxes);
        }
      }
    }
    this.camera.position.set(this.x, EYE, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

// Spinge il cerchio del giocatore fuori da ogni box { minX, maxX, minZ, maxZ }
function collide(p, boxes) {
  const r = RADIUS;
  for (let it = 0; it < 3; it++) {
    for (const b of boxes) {
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d);
        p.z += (dz / d) * (r - d);
      } else {
        // centro dentro il box: esce dal lato piu' vicino
        const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
        const m = Math.min(l, rr, t, bt);
        if (m === l) p.x = b.minX - r;
        else if (m === rr) p.x = b.maxX + r;
        else if (m === t) p.z = b.minZ - r;
        else p.z = b.maxZ + r;
      }
    }
  }
}
