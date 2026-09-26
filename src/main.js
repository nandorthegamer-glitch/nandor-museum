import * as THREE from 'three';
import stations from '../stations.json';
import { buildStation } from './station.js';
import { Player } from './player.js';
import { setLang, getLang, onLang, T } from './lang.js';
import { PSX } from './psx.js';
import { StationAudio } from './audio.js';
import { Door } from './door.js';
import { Interact } from './interact.js';
import { PANELS } from './panels.js';
import { GameCabinet } from './game.js';
import { mediaUrl } from './media.js';

// Ogni cartella rooms/<id>/room.json diventa una stanza: basta aggiungerla
const rooms = {};
for (const r of Object.values(import.meta.glob('../rooms/*/room.json', { eager: true, import: 'default' }))) {
  rooms[r.id] = r;
}

const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080c);
scene.add(new THREE.HemisphereLight(0x9a86c8, 0x2a2436, 0.8));

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1000);

const psx = new PSX(renderer);
psx.setSize(innerWidth, innerHeight);

// onCreate: anche gli oggetti nati dopo (le navi) ricevono lo snapping PS1
const station = buildStation(stations, rooms, {
  onCreate: (o) => psx.patch(o),
  getViewer: () => player, // Nandor si gira verso il visitatore
});
scene.add(station.group);
psx.patch(scene);

const player = new Player(camera, renderer.domElement);
player.place(station.spawn.x, station.spawn.z, station.spawn.yaw);
// pannelli: quelli fissi (Nandor) + quelli di ogni stanza (room.json "panels")
const panels = { ...PANELS };
for (const r of Object.values(rooms)) {
  for (const [id, p] of Object.entries(r.panels || {})) {
    // immagini dei pannelli nella cartella media della stanza
    panels[id] = p.image?.startsWith('media/') ? { ...p, image: mediaUrl(r.id, p.image) } : p;
  }
}
const interact = new Interact(player, station.interactables, panels);

const audio = new StationAudio();
Door.events.onMove = (d, dist, opening) => audio.door(dist, opening);

// cabinati: al ritorno dal gioco si mostra il menu (serve un clic per ricatturare il mouse)
const game = new GameCabinet({
  player, camera, audio,
  onExit: () => { if (!player.locked) overlay.classList.remove('hidden'); },
});
interact.onAction = (item) => { if (item.action === 'game') game.play(item); };
interact.onLinksClosed = () => { if (!player.locked) overlay.classList.remove('hidden'); };

// --- schermata iniziale: le bandiere scelgono la lingua ed entrano ---
const overlay = document.getElementById('overlay');
const UI = {
  hint: {
    it: 'WASD per muoversi, mouse per guardare, Shift per correre, M audio, Esc per uscire',
    en: 'WASD to move, mouse to look, Shift to run, M audio, Esc to leave',
  },
  list: { it: 'VISTA ELENCO (presto)', en: 'LIST VIEW (soon)' },
};
onLang(() => {
  document.getElementById('hint').textContent = T(UI.hint);
  document.getElementById('list').textContent = T(UI.list);
});
for (const b of overlay.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    setLang(b.dataset.lang);
    audio.start();
    if (!audio.voiceBuffers) {
      const V = import.meta.env.BASE_URL + 'nandor/';
      audio.loadVoice({ it: V + 'voice-it.wav', en: V + 'voice-en.wav' }, { it: 0.45, en: 1.3 });
    }
    Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {
      player.dragMode = true;
      overlay.classList.add('hidden');
    });
  });
}
document.addEventListener('pointerlockchange', () => {
  if (game.active) return; // entrando nel cabinato il mouse si libera: niente menu
  if (interact.openId) return; // pannello coi link aperto: il mouse serve per cliccarli
  overlay.classList.toggle('hidden', player.locked);
});
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') psx.toggle(); // confronto PS1 acceso / spento
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'Escape' && player.dragMode) {
    player.dragMode = false;
    overlay.classList.remove('hidden');
  }
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  psx.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Nandor saluta quando il visitatore entra nell'atrio (non piu' di una volta ogni 30 s)
const GREETING = { it: 'Benvenuto, viaggiatore.', en: 'Welcome, traveler.' };
const subs = document.getElementById('subs');
let inAtrium = false, lastGreet = -Infinity, subsOff = 0;
function greet(t) {
  const h = station.atrium.half - 0.5;
  const inside = Math.abs(player.x) < h && Math.abs(player.z) < h;
  if (inside && !inAtrium && t - lastGreet > 30 && audio.say(getLang())) {
    lastGreet = t;
    subs.textContent = GREETING[getLang()];
    subs.classList.add('on');
    subsOff = t + 3;
  }
  inAtrium = inside;
  if (subsOff && t > subsOff) { subs.classList.remove('on'); subsOff = 0; }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const blockers = station.doors.filter((d) => d.blocking).map((d) => d.box);
  player.update(dt, blockers.length ? station.colliders.concat(blockers) : station.colliders);
  for (const d of station.doors) d.update(dt, player.x, player.z);
  station.update(clock.elapsedTime);
  interact.update();
  greet(clock.elapsedTime);
  station.nandor.setVoice(audio.voiceLevel());
  // musica della stanza in cui si trova il visitatore
  const want = {};
  for (const z of station.musicZones) {
    if (player.x > z.minX && player.x < z.maxX && player.z > z.minZ && player.z < z.maxZ) want[z.url] = z.vol;
  }
  audio.updateMusic(dt, game.active ? {} : want);
  game.update(dt);
  if (!game.playing) psx.render(scene, camera); // mentre si gioca il museo e' coperto
});

// per le prove dal browser
window.__museum = { player, station, scene, camera, psx, audio, Door, interact, game };
