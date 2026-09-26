// Portellone scorrevole a due ante in un vano di un muro (vedi wall() in kit.js).
// Si apre da solo quando il giocatore e' vicino, a meno che sia bloccato.

import * as THREE from 'three';
import { box } from './kit.js';

const OPEN_DIST = 3;
const SPEED = 2.5; // aperture al secondo

const RED = new THREE.Color(0xff3020);
const GREEN = new THREE.Color(0x30ff60);

export class Door {
  // agganci per i suoni: onMove(door, dist, opening), onDenied(door, dist)
  static events = {};

  // axis/at come per wall(); c = centro del vano lungo l'asse
  // quiet: nessun bip di accesso negato (il portello della navetta accanto allo spawn)
  constructor(ctx, axis, at, c, { w = 2, h = 2.4, locked = false, quiet = false } = {}) {
    this.axis = axis;
    this.quiet = quiet;
    this.target = 0;
    this.wasNear = false;
    this.w = w;
    this.locked = locked;
    this.open = 0;
    this.cx = axis === 'x' ? c : at;
    this.cz = axis === 'x' ? at : c;

    this.group = new THREE.Group();
    this.group.position.set(this.cx, 0, this.cz);
    if (axis === 'z') this.group.rotation.y = Math.PI / 2;
    ctx.group.add(this.group);

    // nel gruppo il vano corre lungo x locale, da -w/2 a w/2
    const t = 0.06;
    this.leaves = [
      box(this.group, -w / 2, 0, 0, h, -t, t, ctx.mats.door),
      box(this.group, 0, w / 2, 0, h, -t, t, ctx.mats.door),
    ];
    this.light = new THREE.MeshBasicMaterial({ color: locked ? RED : GREEN });
    box(this.group, -w / 2, w / 2, h + 0.04, h + 0.14, -0.13, 0.13, this.light);

    const half = 0.15;
    this.box = axis === 'x'
      ? { minX: c - w / 2, maxX: c + w / 2, minZ: at - half, maxZ: at + half }
      : { minX: at - half, maxX: at + half, minZ: c - w / 2, maxZ: c + w / 2 };
    ctx.doors.push(this);
  }

  get blocking() {
    return this.open < 0.85;
  }

  setLocked(v) {
    this.locked = v;
    this.light.color.copy(v ? RED : GREEN);
  }

  update(dt, px, pz) {
    const dist = Math.hypot(px - this.cx, pz - this.cz);
    const near = dist < OPEN_DIST;
    const target = near && !this.locked ? 1 : 0;
    if (target !== this.target && (target ? this.open < 1 : this.open > 0)) Door.events.onMove?.(this, dist, target === 1);
    if (near && !this.wasNear && this.locked && !this.quiet) Door.events.onDenied?.(this, dist);
    this.target = target;
    this.wasNear = near;
    const d = target - this.open;
    this.open += Math.sign(d) * Math.min(Math.abs(d), SPEED * dt);
    const slide = (this.w / 2) * this.open;
    this.leaves[0].position.x = -this.w / 4 - slide;
    this.leaves[1].position.x = this.w / 4 + slide;
  }
}
