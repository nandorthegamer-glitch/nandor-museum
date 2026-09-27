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
import { TouchControls, isTouch, enterFullscreen, canFullscreen, iosBrowser, standalone } from './touch.js';

// --- caricamento: conta le richieste di rete partite durante l'avvio (pacchetti dei
// modelli, dati, texture); le bandiere compaiono solo a caricamento e shader pronti ---
const loadingBar = document.querySelector('#loading .bar i');
const boot = { total: 0, done: 0, open: true };
const bootFetch = window.fetch;
window.fetch = (...args) => {
  const p = bootFetch(...args);
  if (!boot.open) return p;
  boot.total++;
  const settle = () => { boot.done++; loadingBar.style.width = Math.round((boot.done / boot.total) * 90) + '%'; };
  p.then((r) => (r.ok ? r.clone().arrayBuffer() : null)).then(settle, settle); // finito = corpo scaricato
  return p;
};
// texture caricate con TextureLoader (quadri, immagini): il manager dice quando ha finito
let texLoading = false;
THREE.DefaultLoadingManager.onStart = () => { texLoading = true; };
THREE.DefaultLoadingManager.onLoad = () => { texLoading = false; };

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
  onExit: () => resume(),
});
interact.onAction = (item) => { if (item.action === 'game') game.play(item); };
// chiuso un pannello coi link: si torna subito al gioco ricatturando il mouse (il tasto E
// conta come gesto dell'utente); solo se il browser rifiuta compare il menu
interact.onLinksClosed = () => resume();

// Si torna al museo ricatturando il mouse; se il browser vuole un gesto (per esempio a fine
// livello del cabinato), compare "clicca per continuare" invece del menu della lingua.
const resumeEl = document.getElementById('resume');
const RESUME = { it: 'CLICCA PER CONTINUARE', en: 'CLICK TO CONTINUE' };
function resume() {
  if (player.locked || player.dragMode || player.touchMode) return;
  const ask = () => { resumeEl.firstChild.textContent = T(RESUME); resumeEl.classList.add('on'); };
  Promise.resolve(renderer.domElement.requestPointerLock()).catch(ask);
}
resumeEl.addEventListener('click', () => {
  resumeEl.classList.remove('on');
  Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {
    player.dragMode = true; // dove il Pointer Lock non c'e' si guarda trascinando
  });
});

// --- schermata iniziale: le bandiere scelgono la lingua ed entrano ---
const overlay = document.getElementById('overlay');
const UI = {
  hint: isTouch ? {
    it: 'Analogico sinistro per muoversi, destro per guardare, tocca lo schermo per interagire',
    en: 'Left stick to move, right stick to look, tap the screen to interact',
  } : {
    it: 'WASD per muoversi, mouse per guardare, Shift per correre, M audio, Esc per uscire',
    en: 'WASD to move, mouse to look, Shift to run, M audio, Esc to leave',
  },
  list: { it: 'VISTA ELENCO (presto)', en: 'LIST VIEW (soon)' },
  sens: { it: 'SENSIBILITÀ MOUSE', en: 'MOUSE SENSITIVITY' },
};
// sensibilita' del mouse: cursore nel menu, ricordata dal browser
const sensInput = document.getElementById('sens');
const sensVal = document.getElementById('sens-val');
const setSens = (v) => {
  player.sens = v;
  sensInput.value = v;
  sensVal.textContent = v.toFixed(2);
};
try { const v = parseFloat(localStorage.getItem('nandor-sens')); if (v > 0) setSens(v); } catch {}
sensInput.addEventListener('input', () => {
  setSens(parseFloat(sensInput.value));
  try { localStorage.setItem('nandor-sens', sensInput.value); } catch {}
});
onLang(() => {
  document.getElementById('hint').textContent = T(UI.hint);
  document.getElementById('list').textContent = T(UI.list);
  document.getElementById('sens-label').textContent = T(UI.sens);
});
for (const b of overlay.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    setLang(b.dataset.lang);
    audio.start();
    if (!audio.voiceBuffers) {
      const V = import.meta.env.BASE_URL + 'nandor/';
      audio.loadVoice({ it: V + 'voice-it.wav', en: V + 'voice-en.wav' }, { it: 0.45, en: 1.3 });
    }
    if (isTouch) { enterTouch(); return; }
    Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {
      player.dragMode = true;
      overlay.classList.add('hidden');
    });
  });
}
// telefono: niente Pointer Lock, comandi a schermo; il pulsante II riporta al menu
const touch = new TouchControls(player, {
  onMenu: () => {
    player.touchMode = false;
    touch.show(false);
    overlay.classList.remove('hidden');
  },
});
function enterTouch() {
  player.touchMode = true;
  touch.show(true);
  overlay.classList.add('hidden');
  enterFullscreen();
}
// iPhone: Safari non concede lo schermo intero alle pagine; si ottiene aggiungendo il
// museo alla schermata Home (si apre come un'app, senza barre)
const IOS_HINT = {
  it: 'Su iPhone: tocca Condividi ⬆ e poi "Aggiungi alla schermata Home", poi apri il museo da lì per giocare a schermo intero. Meglio in orizzontale.',
  en: 'On iPhone: tap Share ⬆ then "Add to Home Screen", and open the museum from there to play full screen. Best in landscape.',
};
const iosHint = document.getElementById('ioshint');
if (isTouch && iosBrowser && !standalone && !canFullscreen()) {
  iosHint.classList.add('on');
  onLang(() => { iosHint.textContent = T(IOS_HINT); });
}
document.addEventListener('pointerlockchange', () => {
  if (player.locked) resumeEl.classList.remove('on');
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
  if (player.touchMode) touch.update(dt);
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

// Fine del caricamento: quando la rete tace, si compilano TUTTI gli shader (anche delle
// stanze fuori vista e dei cartelli sul layer CRISP) e si caricano le texture sulla GPU,
// cosi' i primi secondi di gioco non scattano. Poi compaiono le bandiere.
async function finishBoot() {
  const t0 = performance.now();
  let quiet = 0, last = -1;
  while (performance.now() - t0 < 20000) { // al massimo 20 s, poi si entra comunque
    await new Promise((r) => setTimeout(r, 100));
    const idle = boot.done >= boot.total && !texLoading;
    quiet = idle && boot.done === last ? quiet + 1 : 0;
    last = boot.done;
    if (quiet >= 3) break; // 300 ms senza nuove richieste
  }
  boot.open = false;
  loadingBar.style.width = '92%';
  const all = camera.clone();
  all.layers.enableAll();
  try { await renderer.compileAsync(scene, all); } catch { renderer.compile(scene, all); }
  const seen = new Set();
  scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap']) {
        const t = m[k];
        if (t && !seen.has(t) && !t.isVideoTexture && t.image) { seen.add(t); renderer.initTexture(t); }
      }
    }
  });
  loadingBar.style.width = '100%';
  await new Promise((r) => setTimeout(r, 250));
  overlay.classList.remove('loading');
}
finishBoot();

// per le prove dal browser
window.__museum = { player, station, scene, camera, psx, audio, Door, interact, game, touch };
