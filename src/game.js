// Giochi nei cabinati: E sul cabinato -> la telecamera entra nello schermo -> il gioco
// (build WebGL di Unity in public/games/...) parte a schermo intero in un iframe.
// Il gioco manda { source, type: 'done' | 'exit' } (Plugins/WebGL/MuseumBridge.jslib nel
// progetto Unity) e la telecamera esce dallo schermo. Esc o il pulsante in alto escono.

import * as THREE from 'three';
import { T, getLang } from './lang.js';

const IN_TIME = 1.1;
const OUT_TIME = 0.9;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const UI = {
  missing: {
    it: 'Il livello non è ancora stato esportato: in Unity, Vampaladin > 5 - Esporta per il museo (WebGL).',
    en: 'The level has not been exported yet: in Unity, Vampaladin > 5 - Export for the museum (WebGL).',
  },
  exit: { it: 'ESC  esci', en: 'ESC  exit' },
};

export class GameCabinet {
  constructor({ player, camera, audio, onExit }) {
    this.player = player;
    this.camera = camera;
    this.audio = audio;
    this.onExit = onExit;
    this.active = false;   // da E fino al ritorno completo
    this.playing = false;  // iframe a schermo (il museo non ha bisogno di disegnare)
    this.anim = null;

    this.flash = document.createElement('div');
    this.flash.className = 'game-flash';
    this.toast = document.createElement('div');
    this.toast.className = 'game-toast';
    document.body.append(this.flash, this.toast);

    addEventListener('message', (e) => {
      const d = e.data;
      if (!d || !['vampaladin', 'angrii'].includes(d.source) || !this.playing) return; // giochi col ponte del museo
      if (d.type === 'ready') this.frame?.focus();
      if (d.type === 'done' || d.type === 'exit') this.leave();
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.playing) this.leave(); // quando il fuoco e' sul museo
    });
  }

  // item: { url, screen: { pos: Vector3, normal: Vector3 } } dal cabinato
  async play(item) {
    if (this.active || !item?.screen) return;
    const url = item.url;
    // la build c'e'? (in sviluppo Vite risponde con la pagina del museo ai file mancanti)
    const ok = await fetch(url).then((r) => r.ok && r.text()).then((t) => !!t && t.includes('unity-canvas')).catch(() => false);
    if (!ok) { this.say(T(UI.missing)); return; }

    this.active = true;
    this.player.cinematic = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.duck(true);
    this.from = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    const to = item.screen.pos.clone().addScaledVector(item.screen.normal, 0.3);
    // convenzione delle telecamere: guardano lungo -z (Object3D.lookAt puntrebbe +z)
    const m = new THREE.Matrix4().lookAt(to, item.screen.pos, new THREE.Vector3(0, 1, 0));
    this.to = { pos: to, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
    await this.move(this.from, this.to, IN_TIME);
    await this.blink();
    this.open(url);
  }

  open(url) {
    this.playing = true;
    const box = (this.box = document.createElement('div'));
    box.className = 'game-box';
    const frame = (this.frame = document.createElement('iframe'));
    frame.src = `${url}?lang=${getLang()}`;
    frame.allow = 'autoplay; fullscreen; gamepad';
    const exit = document.createElement('button');
    exit.className = 'game-exit';
    exit.textContent = T(UI.exit);
    exit.addEventListener('click', () => this.leave());
    box.append(frame, exit);
    document.body.append(box);
    frame.addEventListener('load', () => frame.focus());
  }

  async leave() {
    if (!this.playing) return;
    this.playing = false;
    this.box.remove(); // chiude anche il gioco: niente Unity che gira di nascosto
    this.box = this.frame = null;
    await this.blink();
    await this.move(this.to, this.from, OUT_TIME);
    this.player.cinematic = false;
    this.audio.duck(false);
    this.active = false;
    this.onExit?.();
  }

  // animazione della telecamera fra due pose { pos, quat }
  move(a, b, time) {
    return new Promise((resolve) => { this.anim = { a, b, time, t: 0, resolve }; });
  }

  update(dt) {
    const m = this.anim;
    if (!m) return;
    m.t = Math.min(1, m.t + dt / m.time);
    const k = ease(m.t);
    this.camera.position.lerpVectors(m.a.pos, m.b.pos, k);
    this.camera.quaternion.slerpQuaternions(m.a.quat, m.b.quat, k);
    if (m.t >= 1) { this.anim = null; m.resolve(); }
  }

  // lampo di disturbo da vecchio monitor
  blink() {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
    return new Promise((r) => setTimeout(r, 260));
  }

  say(text) {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toast.classList.remove('on'), 5000);
  }
}
