// Interazione con E: il visitatore guarda un punto interattivo vicino, compare
// "[E] ...", e con E si apre un pannello HTML a piena risoluzione (testo e immagini
// leggibili, fuori dallo strato PS1). E o Esc lo chiudono.

import { T, onLang } from './lang.js';
import { isTouch } from './touch.js';

const UI = {
  read: { it: '[E] Leggi', en: '[E] Read' },
  close: { it: 'E per chiudere', en: 'E to close' },
  // da telefono: tocco al posto di E; i minigiochi solo da PC
  readTouch: { it: 'Tocca per leggere', en: 'Tap to read' },
  closeTouch: { it: 'Tocca per chiudere', en: 'Tap to close' },
  pcOnly: { it: 'Minigioco disponibile solo da PC', en: 'Mini game available on PC only' },
};

export class Interact {
  // items: [{ id, x, z, radius }], panels: { id: { title, body: [..], image, caption } }
  constructor(player, items, panels) {
    this.player = player;
    this.items = items;
    this.panels = panels;
    this.target = null;
    this.openId = null;
    this.prompt = document.getElementById('prompt');
    this.panel = document.getElementById('panel');

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.openId) { this.close(); return; }
      if (e.code !== 'KeyE' || e.repeat) return;
      if (this.openId) this.close();
      else if (this.target && this.player.locked) {
        if (this.target.action) { if (!isTouch) this.onAction?.(this.target); } // es. giocare in un cabinato
        else this.open(this.target.id);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      // un pannello coi link libera il mouse apposta: non si chiude per questo
      if (!this.player.locked && this.openId && !this.panels[this.openId]?.links) this.close();
    });
    onLang(() => { if (this.openId) this.render(this.openId); });
    // da telefono un tocco sul pannello lo chiude (non sui link, non scorrendo il testo)
    if (isTouch) this.panel.addEventListener('click', (e) => { if (this.openId && !e.target.closest('a')) this.close(); });
  }

  update() {
    const p = this.player;
    let best = null, bestD = Infinity;
    if (p.locked && !this.openId && !p.cinematic) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      for (const it of this.items) {
        const dx = it.x - p.x, dz = it.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > it.radius || d < 1e-3) continue;
        if ((dx * fx + dz * fz) / d < 0.6) continue; // deve guardarlo, piu' o meno
        if (d < bestD) { best = it; bestD = d; }
      }
    }
    if (best !== this.target) {
      this.target = best;
      this.prompt.textContent = !best ? ''
        : best.action && isTouch ? T(UI.pcOnly)
        : best.label ? T(best.label)
        : `${T(isTouch ? UI.readTouch : UI.read)}: ${T(this.panels[best.id]?.title)}`;
      this.prompt.classList.toggle('on', !!best);
    }
  }

  open(id) {
    this.openId = id;
    this.player.frozen = true;
    this.prompt.classList.remove('on');
    this.target = null;
    this.render(id);
    this.panel.classList.add('on');
    // link cliccabili: serve il cursore
    if (this.panels[id]?.links && document.pointerLockElement) document.exitPointerLock();
  }

  close() {
    const hadLinks = this.panels[this.openId]?.links;
    this.openId = null;
    this.player.frozen = false;
    this.panel.classList.remove('on');
    if (hadLinks) this.onLinksClosed?.(); // il menu chiede un clic per ricatturare il mouse
  }

  render(id) {
    const p = this.panels[id];
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    this.panel.innerHTML = `
      <div class="card">
        <h2>${esc(T(p.title))}</h2>
        ${p.image ? `<figure><img src="${p.image}" alt=""><figcaption>${esc(T(p.caption))}</figcaption></figure>` : ''}
        ${p.body.map((b) => b.href
          ? `<p class="link"><span>${esc(T(b))}</span><a href="${b.href}" target="_blank" rel="noopener">${esc(b.text)}</a></p>`
          : `<p>${esc(T(b))}</p>`).join('')}
        <div class="close">${esc(T(isTouch ? UI.closeTouch : UI.close))}</div>
      </div>`;
  }
}
