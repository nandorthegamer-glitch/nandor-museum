// Comandi da telefono/tablet: analogico a sinistra per muoversi, analogico a destra per
// guardare, un tocco altrove (al centro) vale come E. Pulsante in alto a sinistra per il menu.

// solo se il puntatore principale è il dito: i portatili con touchscreen restano da PC
export const isTouch = matchMedia('(pointer: coarse)').matches;

const LOOK_RATE = 2.0; // rad/s a analogico tutto spinto (per 1 di sensibilita')
const DEAD = 0.12;

export class TouchControls {
  constructor(player, { onMenu }) {
    this.player = player;
    this.el = document.getElementById('touch');
    this.move = this.stick(this.el.querySelector('.stick.left'));
    this.look = this.stick(this.el.querySelector('.stick.right'));
    this.el.querySelector('.menu').addEventListener('click', (e) => { e.stopPropagation(); onMenu(); });
    // schermo intero: entra / esci (non c'e' dove il browser non lo permette, es. iPhone)
    const fs = this.el.querySelector('.fs');
    if (canFullscreen()) {
      const label = () => { fs.textContent = fullscreenElement() ? 'ESCI ⤡' : 'SCHERMO ⤢'; };
      fs.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
      document.addEventListener('fullscreenchange', label);
      document.addEventListener('webkitfullscreenchange', label);
      label();
    } else fs.remove();
    // Safari ignora user-scalable=no: blocca lo zoom a pizzico e il doppio tocco
    if (isTouch) for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

    // tocco breve fuori dagli analogici: E (interagisci / chiudi)
    let tap = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.el) return;
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.el.addEventListener('pointerup', (e) => {
      if (!tap || tap.id !== e.pointerId) return;
      const quick = performance.now() - tap.t < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14;
      tap = null;
      if (quick) pressE();
    });
  }

  // un analogico: base fissa, pomello che segue il dito entro il raggio
  stick(base) {
    const knob = base.querySelector('i');
    const s = { x: 0, y: 0, id: null };
    const set = (e) => {
      const r = base.getBoundingClientRect();
      const R = r.width / 2;
      let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      s.x = dx / R;
      s.y = dy / R;
    };
    const reset = () => { s.id = null; s.x = s.y = 0; knob.style.transform = ''; };
    base.addEventListener('pointerdown', (e) => {
      s.id = e.pointerId;
      try { base.setPointerCapture(e.pointerId); } catch {}
      set(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === s.id) set(e); });
    base.addEventListener('pointerup', (e) => { if (e.pointerId === s.id) reset(); });
    base.addEventListener('pointercancel', reset);
    s.reset = reset;
    return s;
  }

  show(on) {
    this.el.classList.toggle('on', on);
    if (!on) { this.move.reset(); this.look.reset(); }
  }

  // chiamato ogni fotogramma prima di player.update
  update(dt) {
    const p = this.player;
    const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
    p.stick.x = dz(this.move.x);
    p.stick.y = dz(this.move.y);
    if (p.frozen || p.cinematic) return;
    const lx = dz(this.look.x), ly = dz(this.look.y);
    // curva: movimenti fini vicino al centro, veloci a fondo corsa
    p.yaw -= Math.sign(lx) * lx * lx * LOOK_RATE * p.sens * dt;
    p.pitch -= Math.sign(ly) * ly * ly * LOOK_RATE * 0.7 * p.sens * dt;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  }
}

// --- schermo intero, anche col prefisso webkit (Safari su iPad) ---
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
export const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export function enterFullscreen() {
  if (!canFullscreen() || fullscreenElement()) return;
  const de = document.documentElement;
  const req = de.requestFullscreen?.bind(de) || de.webkitRequestFullscreen?.bind(de);
  Promise.resolve(req?.({ navigationUI: 'hide' }))
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}
function toggleFullscreen() {
  if (!fullscreenElement()) { enterFullscreen(); return; }
  (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
}
// iPhone/iPad in Safari, non ancora aggiunto alla schermata Home
export const iosBrowser = /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

export function pressE() {
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' }));
}
